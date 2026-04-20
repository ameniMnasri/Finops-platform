from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import distinct, func
from typing import Any, Dict, List, Optional
from datetime import datetime, date
import re

from pydantic import BaseModel
import logging
from pydantic import BaseModel
from app.dependencies import get_db
from app.models.resource import ResourceMetric
from app.models.cost import CostRecord
from app.schemas.resource import (
    ResourceMetricCreate,
    ResourceMetricResponse,
    ResourceMetricList,
    ResourceAverageStats,
    ResourcePeakStats,
)
from app.services.resource_service import resource_service

router = APIRouter(
    prefix="/resources",
    tags=["Resources"],
)

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _parse_date(d: Optional[str], field: str) -> Optional[datetime]:
    """Convert a YYYY-MM-DD string to a datetime, or raise 400."""
    if d is None:
        return None
    try:
        return datetime.strptime(d, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid date format for '{field}'. Expected YYYY-MM-DD.",
        )



def _normalize_server_name(name: str) -> str:
    """
    Normalize a server hostname for deduplication.
    Removes all whitespace injected by PDF parsers and lowercases.
    e.g. "ns3260605.ip-51- 83-122.eu" → "ns3260605.ip-51-83-122.eu"
    """
    if not name:
        return ""
    return re.sub(r'\s+', '', name).lower()


def _fuzzy_server_key(name: str) -> str:
    """
    Ultra-aggressive normalization for cross-source matching.
    Strips ALL non-alphanumeric characters so that:
      "ns3081285.ip-147-135-253.eu"  → "ns3081285ip147135253eu"
      "ns3081285.ip147-135-253.eu"   → "ns3081285ip147135253eu"  (same!)
    This handles OVH invoice refs that omit the dash after "ip".
    """
    if not name:
        return ""
    # Remove -disk<N> suffixes before fuzzy matching
    base = re.sub(r'-disk\d+$', '', name.lower().strip())
    return re.sub(r'[^a-z0-9]', '', base)


def _detect_server_type_from_name(name: str) -> str:
    """Detect VPS vs Dedicated from server hostname."""
    if not name:
        return "VPS"
    # Normalize before matching (remove spaces injected by PDF parser)
    clean = re.sub(r'\s+', '', name).lower()
    # ns<digits>.ip-<digits>-<digits>.eu/net → Dedicated
    if re.match(r'^ns\d+\.', clean):
        return "DEDICATED"
    if clean.startswith('vps'):
        return "VPS"
    n = name.upper()
    dedicated_keywords = [
        'DEDICATED', 'DATABASE', 'EG-', 'ADVANCE', 'RISE', 'BIG-',
        'SP-', 'HG-', 'SCALE-', 'HGR-', 'KS-', 'SYS-', 'HOST-',
        'DEDIBOX', 'PROD-DEDICATED', 'SERVER',
    ]
    if any(k in n for k in dedicated_keywords):
        return "DEDICATED"
    return "VPS"


# ─────────────────────────────────────────────────────────────────────────────
# COST → RESOURCE SPEC HELPERS
# Parse RAM / Disk capacity from cost service_name / disk_size fields
# ─────────────────────────────────────────────────────────────────────────────

# RAM patterns: "32GB DDR4", "64GB DDR5", "128 GB DDR4", "VPS Comfort 4-8-160" (2nd digit = RAM)
_RAM_PATTERNS = [
    re.compile(r'(\d+)\s*GB\s+DDR\d', re.IGNORECASE),
    re.compile(r'(\d+)\s*GB\s+ECC', re.IGNORECASE),
    re.compile(r'(\d+)\s*GB\s+RAM', re.IGNORECASE),
]
_VPS_PLAN_PATTERN = re.compile(
    r'VPS\s+\w+\s+(\d+)-(\d+)-(\d+)', re.IGNORECASE
)  # e.g. "VPS Comfort 4-8-160" → cpu=4 ram=8 disk=160

# Disk patterns from service_name or disk_size field:
# "2x SSD NVMe 512GB", "4x HDD SATA 6TB", "2x 450GB SSD"
_DISK_PATTERNS = [
    re.compile(r'(\d+)\s*[xX]\s*(?:SSD\s+NVMe\s+|HDD\s+SATA\s+|SSD\s+)?(\d+(?:\.\d+)?)\s*(TB|GB)', re.IGNORECASE),
    re.compile(r'(\d+(?:\.\d+)?)\s*(TB|GB)\s+(?:SSD|HDD|NVMe|SATA)', re.IGNORECASE),
]
_DISK_SIZE_FIELD = re.compile(r'(\d+(?:\.\d+)?)\s*(TB|GB)', re.IGNORECASE)


def _to_gb(value: float, unit: str) -> float:
    return value * 1024 if unit.upper() == 'TB' else value


def _parse_ram_gb(service_name: str) -> Optional[float]:
    """Extract RAM capacity (GB) from a cost service_name string."""
    if not service_name:
        return None

    # VPS plan pattern first: "VPS Comfort 4-8-160" → RAM = 8 GB
    m = _VPS_PLAN_PATTERN.search(service_name)
    if m:
        return float(m.group(2))

    for pat in _RAM_PATTERNS:
        m = pat.search(service_name)
        if m:
            return float(m.group(1))
    return None


def _parse_disk_gb(service_name: str, disk_size_field: Optional[str] = None) -> Optional[float]:
    """Extract total disk capacity (GB) from service_name or disk_size field."""
    # Try the dedicated disk_size field first (e.g. "2x NVMe 512GB")
    source = disk_size_field or ""
    if not source:
        source = service_name or ""

    # Multi-disk pattern: "2x SSD NVMe 512GB" → 2 * 512 = 1024 GB
    m = _DISK_PATTERNS[0].search(source)
    if m:
        qty  = float(m.group(1))
        size = float(m.group(2))
        unit = m.group(3)
        return qty * _to_gb(size, unit)

    # Single disk: "960GB NVMe", "4TB HDD"
    m = _DISK_PATTERNS[1].search(source)
    if m:
        return _to_gb(float(m.group(1)), m.group(2))

    # VPS plan pattern: "VPS Comfort 4-8-160" → disk = 160 GB
    m = _VPS_PLAN_PATTERN.search(source)
    if m:
        return float(m.group(3))

    # Fallback: generic NNxGB or NNTB in the disk_size_field
    if disk_size_field:
        m = _DISK_SIZE_FIELD.search(disk_size_field)
        if m:
            return _to_gb(float(m.group(1)), m.group(2))

    return None


def _build_invoice_specs_from_costs(db: Session) -> Dict[str, Dict]:
    """
    Scan all CostRecord rows to extract per-server RAM & Disk capacity
    derived from invoice line items.

    Returns a dict keyed by server reference (e.g. "vps-3a996f60.vps.ovh.net"):
        {
            "ram_gb":    float or None,
            "disk_gb":   float or None,
            "server_type": "VPS" | "DEDICATED",
        }
    """
    specs: Dict[str, Dict] = {}       # keyed by normalized name
    fuzzy_index: Dict[str, str] = {}  # fuzzy_key → normalized name (for cross-match)

    # Query all cost records that have a reference (server identifier)
    rows = (
        db.query(
            CostRecord.reference,
            CostRecord.service_name,
            CostRecord.cost_category,
        )
        .filter(CostRecord.reference.isnot(None))
        .filter(CostRecord.reference != '')
        .all()
    )

    for row in rows:
        ref          = _normalize_server_name((row.reference or '').strip())
        service_name = row.service_name or ''
        category     = (row.cost_category or '').upper()

        if not ref:
            continue

        # Determine server type from category or ref name
        if category == 'VPS' or re.match(r'^vps', ref, re.IGNORECASE):
            stype = 'VPS'
        elif category in ('DEDICATED', 'DÉDIÉ', 'DEDIE'):
            stype = 'DEDICATED'
        else:
            stype = _detect_server_type_from_name(ref)

        existing = specs.setdefault(ref, {
            'ram_gb': None, 'disk_gb': None, 'server_type': stype,
        })
        fkey = _fuzzy_server_key(ref)
        if fkey and fkey not in fuzzy_index:
            fuzzy_index[fkey] = ref

        # Try parsing RAM from this line
        ram = _parse_ram_gb(service_name)
        if ram and (existing['ram_gb'] is None or ram > existing['ram_gb']):
            existing['ram_gb'] = ram

        # Try parsing Disk from this line
        disk = _parse_disk_gb(service_name)
        if disk and (existing['disk_gb'] is None or disk > existing['disk_gb']):
            existing['disk_gb'] = disk

    return specs, fuzzy_index


# ─────────────────────────────────────────────────────────────────────────────
# SCHEMAS (inline — move to app/schemas/resource.py if preferred)
# ─────────────────────────────────────────────────────────────────────────────

class OVHAuthFields(BaseModel):
    app_key: str
    app_secret: str
    consumer_key: str


class ImportOVHMetricsRequest(BaseModel):
    auth_fields: OVHAuthFields


class ImportOVHMetricsResponse(BaseModel):
    servers_found: int
    metrics_created: int
    errors: List[str] = []
    message: str


# ─────────────────────────────────────────────────────────────────────────────
# BASIC CRUD — POST + GET list (no path params → safe to be first)
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=ResourceMetricResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a resource metric",
    description="Record a new CPU/RAM/Disk usage snapshot.",
)
def create_metric(
    data: ResourceMetricCreate,
    db: Session = Depends(get_db),
):
    return resource_service.create_resource_metric(db, data)


@router.get(
    "/",
    response_model=ResourceMetricList,
    summary="List resource metrics",
    description="Retrieve a paginated list of resource metrics with optional filters.",
)
def list_metrics(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Max records to return"),
    server_name: Optional[str] = Query(None, description="Filter by server/host name"),
    from_date: Optional[datetime] = Query(None, description="Filter from this datetime (ISO 8601)"),
    to_date: Optional[datetime] = Query(None, description="Filter up to this datetime (ISO 8601)"),
    db: Session = Depends(get_db),
):
    total, items = resource_service.get_resource_metrics(
        db, skip=skip, limit=limit, server_name=server_name,
        from_date=from_date, to_date=to_date,
    )
    return {"total": total, "items": items}


# ─────────────────────────────────────────────────────────────────────────────
# GLOBAL STATS  — must come before /{metric_id} !
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/stats/average",
    response_model=ResourceAverageStats,
    summary="Average resource stats (all servers)",
    description="Get average CPU (%), RAM (GB), and Disk (GB) usage across all metrics.",
)
def average_stats(
    server_name: Optional[str] = Query(None, description="Filter by server/host name"),
    from_date: Optional[datetime] = Query(None, description="Filter from this datetime"),
    to_date: Optional[datetime] = Query(None, description="Filter up to this datetime"),
    db: Session = Depends(get_db),
):
    return resource_service.get_average_stats(
        db, server_name=server_name, from_date=from_date, to_date=to_date,
    )


@router.get(
    "/stats/peak",
    response_model=ResourcePeakStats,
    summary="Peak resource consumption (all servers)",
    description="Get the peak (maximum) CPU, RAM, and Disk usage with timestamps.",
)
def peak_stats(
    server_name: Optional[str] = Query(None, description="Filter by server/host name"),
    from_date: Optional[datetime] = Query(None, description="Filter from this datetime"),
    to_date: Optional[datetime] = Query(None, description="Filter up to this datetime"),
    db: Session = Depends(get_db),
):
    return resource_service.get_peak_stats(
        db, server_name=server_name, from_date=from_date, to_date=to_date,
    )


# ─────────────────────────────────────────────────────────────────────────────
# OVH METRICS IMPORT
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/import-ovh-metrics",
    response_model=ImportOVHMetricsResponse,
    status_code=status.HTTP_200_OK,
    summary="Import CPU/RAM/Disk metrics from OVHcloud (VPS + Dedicated)",
    description=(
        "Calls the OVHcloud API to collect real-time CPU, RAM, and Disk metrics "
        "for every VPS and Dedicated server on the account, then persists them as "
        "ResourceMetric rows. Requires GET /vps/* and GET /dedicated/server/* rights "
        "on the Consumer Key."
    ),
)
def import_ovh_metrics(
    payload: ImportOVHMetricsRequest,
    db: Session = Depends(get_db),
):
    """
    POST /api/v1/resources/import-ovh-metrics
    Body: { "auth_fields": { "app_key": "...", "app_secret": "...", "consumer_key": "..." } }
    """
    import requests as _requests
    from app.services.cloud_fetcher import OVHResourceFetcher

    auth = {
        "app_key":      payload.auth_fields.app_key.strip(),
        "app_secret":   payload.auth_fields.app_secret.strip(),
        "consumer_key": payload.auth_fields.consumer_key.strip(),
    }

    if not all(auth.values()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="app_key, app_secret et consumer_key sont tous requis.",
        )

    fetcher = OVHResourceFetcher()
    errors: List[str] = []
    raw_metrics: List[dict] = []

    # ── 1. Collect metrics from OVH API ──────────────────────────────────
    try:
        logger.info("🔍 Starting OVH resource metrics collection...")
        logger.info(f"   Using app_key: {auth['app_key'][:10]}...")
        raw_metrics = fetcher.fetch_resources(auth)
        logger.info(f"✅ OVH API returned {len(raw_metrics)} metrics")
    except PermissionError as e:
        logger.error(f"❌ Permission error: {e}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Droits OVH insuffisants : {e}\n\n"
                "Recréez votre token sur eu.api.ovh.com/createToken en cochant toutes ces permissions :\n"
                "• GET /vps\n"
                "• GET /vps/*\n"
                "• GET /dedicated/server\n"
                "• GET /dedicated/server/*"
            ),
        )
    except _requests.exceptions.HTTPError as e:
        http_status = e.response.status_code if e.response is not None else "?"
        error_body = ""
        if e.response:
            try:
                error_body = e.response.text[:500]
            except:
                pass

        logger.error(f"❌ OVH API HTTP error {http_status}: {e}")
        if error_body:
            logger.error(f"   Response: {error_body}")

        if http_status == 401:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Clés OVH invalides ou expirées (HTTP 401). Vérifiez app_key, app_secret et consumer_key.",
            )
        elif http_status == 403:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Accès refusé par l'API OVH (403). Le Consumer Key n'a pas les permissions nécessaires.\n\n"
                    "Recréez votre token sur eu.api.ovh.com/createToken en cochant :\n"
                    "• GET /vps\n"
                    "• GET /vps/*\n"
                    "• GET /dedicated/server\n"
                    "• GET /dedicated/server/*"
                ),
            )
        elif http_status == 400:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Requête OVH invalide (400). Vérifiez vos clés API. Détails : {error_body[:200]}",
            )

        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Erreur OVH API (HTTP {http_status}) : {e}",
        )
    except Exception as e:
        logger.error(f"❌ OVH resource fetch failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Erreur lors de la collecte OVH : {str(e)}",
        )

    servers_found = len(raw_metrics)

    if servers_found == 0:
        logger.warning("⚠️ No metrics collected from OVH API")
        return ImportOVHMetricsResponse(
            servers_found=0,
            metrics_created=0,
            errors=["Aucun serveur VPS ou Dédié trouvé sur ce compte OVH, ou permissions insuffisantes."],
            message=(
                "Aucun serveur trouvé. Vérifiez que :\n"
                "1. Le compte possède des VPS ou serveurs dédiés actifs\n"
                "2. Le Consumer Key a les permissions GET /vps, GET /vps/*, GET /dedicated/server, GET /dedicated/server/*"
            ),
        )

    # ── 2. Persist each metric to the database (UPSERT) ─────────────────
    metrics_created = 0
    for raw in raw_metrics:
        try:
            recorded_at = raw.get("recorded_at")
            if isinstance(recorded_at, str):
                try:
                    recorded_at = datetime.fromisoformat(recorded_at)
                except ValueError:
                    recorded_at = datetime.utcnow()
            elif not isinstance(recorded_at, datetime):
                recorded_at = datetime.utcnow()

            server_name = raw["server_name"]

            # Wipe stale rows for this server so averages stay accurate
            deleted = (
                db.query(ResourceMetric)
                .filter(ResourceMetric.server_name == server_name)
                .delete(synchronize_session=False)
            )
            if deleted:
                logger.info(f"  🗑️  Deleted {deleted} stale row(s) for {server_name}")

            # ── Parse OVH service lifecycle dates ────────────────────────
            def _parse_ovh_date(val) -> Optional[datetime]:
                """Parse ISO-8601 date string from OVH API (e.g. '2023-03-15T00:00:00+01:00')."""
                if not val:
                    return None
                if isinstance(val, datetime):
                    return val
                try:
                    return datetime.fromisoformat(str(val))
                except (ValueError, TypeError):
                    return None

            metric_data = ResourceMetricCreate(
                server_name=server_name,
                server_type=raw.get("server_type"),
                cpu_usage=raw.get("cpu_usage"),
                ram_usage=float(raw.get("ram_usage") or 0),
                disk_usage=float(raw.get("disk_usage") or 0),
                recorded_at=recorded_at,
                # OVH service lifecycle dates — populated by cloud_fetcher via /serviceInfos
                creation_date=_parse_ovh_date(raw.get("creation_date")),
                expiration_date=_parse_ovh_date(
                    raw.get("expiration_date") or raw.get("expiration")
                ),
                ovh_state=raw.get("ovh_state") or raw.get("state"),
                ovh_offer=raw.get("ovh_offer") or raw.get("offer"),
            )
            resource_service.create_resource_metric(db, metric_data)
            metrics_created += 1
            cpu_display = f"{raw['cpu_usage']:.1f}%" if raw.get("cpu_usage") is not None else "N/A"
            logger.info(
                f"✅ Saved metric for {server_name} [{raw.get('server_type', '?')}]: "
                f"CPU={cpu_display} "
                f"RAM={raw.get('ram_usage', 0):.2f}GB "
                f"Disk={raw.get('disk_usage', 0):.2f}GB"
            )
        except Exception as e:
            err_msg = f"Erreur sauvegarde {raw.get('server_name', '?')}: {str(e)}"
            logger.warning(err_msg)
            errors.append(err_msg)

    logger.info(
        f"✅ OVH import done: {servers_found} servers found, "
        f"{metrics_created} metrics saved, {len(errors)} errors"
    )

    return ImportOVHMetricsResponse(
        servers_found=servers_found,
        metrics_created=metrics_created,
        errors=errors,
        message=(
            f"{metrics_created} métrique(s) enregistrée(s) pour "
            f"{servers_found} serveur(s) OVH."
        ),
    )


# ─────────────────────────────────────────────────────────────────────────────
# SERVER DISCOVERY
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/servers",
    summary="List all distinct server names",
    description=(
        "Returns the list of unique server names that have at least one metric "
        "recorded. The frontend uses this to populate the server table."
    ),
    response_model=dict,
)
def list_servers(db: Session = Depends(get_db)):
    rows = (
        db.query(distinct(ResourceMetric.server_name))
        .filter(ResourceMetric.server_name.isnot(None))
        .order_by(ResourceMetric.server_name)
        .all()
    )
    return {"servers": [r[0] for r in rows]}


# ─────────────────────────────────────────────────────────────────────────────
# PER-SERVER ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/servers/{server_name}/metrics",
    response_model=ResourceMetricList,
    summary="Time-series metrics for a specific server",
    description=(
        "Returns the paginated list of raw metric snapshots for one server. "
        "Used by the frontend charts tab. Dates are YYYY-MM-DD strings."
    ),
)
def get_server_metrics(
    server_name: str,
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    from_dt = _parse_date(start_date, "start_date")
    to_dt   = _parse_date(end_date,   "end_date")

    total, items = resource_service.get_resource_metrics(
        db,
        skip=skip,
        limit=limit,
        server_name=server_name,
        from_date=from_dt,
        to_date=to_dt,
    )
    return {"total": total, "items": items}


@router.get(
    "/servers/{server_name}/summary",
    summary="Avg + peak stats for a single server",
    description=(
        "Returns a combined object with average and peak CPU/RAM/Disk values "
        "for the given server. The frontend server-list table uses this to "
        "display real metrics instead of random numbers."
    ),
    response_model=dict,
)
def get_server_summary(
    server_name: str,
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    from_dt = _parse_date(start_date, "start_date")
    to_dt   = _parse_date(end_date,   "end_date")

    avg  = resource_service.get_average_stats(
        db, server_name=server_name, from_date=from_dt, to_date=to_dt,
    )
    peak = resource_service.get_peak_stats(
        db, server_name=server_name, from_date=from_dt, to_date=to_dt,
    )

    return {
        "server_name":    server_name,
        "avg_cpu":        avg["avg_cpu_usage"],
        "avg_ram":        avg["avg_ram_usage"],
        "avg_disk":       avg["avg_disk_usage"],
        "total_records":  avg["total_records"],
        "peak_cpu":       peak["peak_cpu_usage"],
        "peak_cpu_at":    peak["peak_cpu_recorded_at"],
        "peak_ram":       peak["peak_ram_usage"],
        "peak_ram_at":    peak["peak_ram_recorded_at"],
        "peak_disk":      peak["peak_disk_usage"],
        "peak_disk_at":   peak["peak_disk_recorded_at"],
    }


@router.get(
    "/servers/summary/all",
    summary="Bulk summary for ALL servers in one call (monitoring + invoice)",
    description=(
        "Returns an array of summary objects (avg + peak + invoice specs) for every "
        "server found in ResourceMetric OR CostRecord. "
        "Servers with OVH monitoring data use real avg/peak values. "
        "Servers only in invoices use invoice-parsed RAM/Disk capacity as specs. "
        "Each entry includes ram_source and disk_source: "
        "'monitoring' | 'invoice' | 'none'."
    ),
    response_model=list,
)
def get_all_servers_summary(
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    from_dt = _parse_date(start_date, "start_date")
    to_dt   = _parse_date(end_date,   "end_date")

    # ── 1. Build monitoring-based summaries (from ResourceMetric) ────────

    # monitoring_names already normalized — rebuild mapping raw_name->normalized
    raw_monitoring_rows = (
        db.query(distinct(ResourceMetric.server_name))
        .filter(ResourceMetric.server_name.isnot(None))
        .order_by(ResourceMetric.server_name)
        .all()
    )
    # Map normalized_name -> original_name (keep original for DB queries)
    norm_to_raw: Dict[str, str] = {}
    for r in raw_monitoring_rows:
        norm = _normalize_server_name(r[0])
        if norm not in norm_to_raw:
            norm_to_raw[norm] = r[0]

    monitoring_results: Dict[str, dict] = {}
    for norm_name, raw_name in norm_to_raw.items():
        avg  = resource_service.get_average_stats(
            db, server_name=raw_name, from_date=from_dt, to_date=to_dt,
        )
        peak = resource_service.get_peak_stats(
            db, server_name=raw_name, from_date=from_dt, to_date=to_dt,
        )

        # Detect server_type from the ResourceMetric rows themselves
        type_row = (
            db.query(ResourceMetric.server_type)
            .filter(ResourceMetric.server_name == raw_name)
            .filter(ResourceMetric.server_type.isnot(None))
            .first()
        )
        stype = (type_row[0] if type_row else None) or _detect_server_type_from_name(raw_name)

        raw_avg_cpu = avg["avg_cpu_usage"]

        # Decode cpu_usage sentinel: negative value = core count from hw specs (no RTM)
        cpu_cores_hw: Optional[float] = None
        cpu_source_val = "none"
        if raw_avg_cpu is not None and raw_avg_cpu < 0:
            cpu_cores_hw = abs(raw_avg_cpu)
            raw_avg_cpu = None   # not a real % usage — hide from avg_cpu
            cpu_source_val = "hw_specs"
        elif raw_avg_cpu is not None and raw_avg_cpu >= 0:
            cpu_source_val = "rtm"

        peak_cpu_raw = peak["peak_cpu_usage"]
        if peak_cpu_raw is not None and peak_cpu_raw < 0:
            peak_cpu_raw = None   # sentinel in peak too → hide

        # ── OVH service lifecycle dates stored in DB during import ──────────
        # Wrapped in try/except: gracefully handles the case where the migration
        # hasn't been run yet and the columns don't exist in the DB.
        dates_row = None
        try:
            dates_row = (
                db.query(
                    ResourceMetric.creation_date,
                    ResourceMetric.expiration_date,
                    ResourceMetric.ovh_state,
                    ResourceMetric.ovh_offer,
                )
                .filter(ResourceMetric.server_name == raw_name)
                .filter(ResourceMetric.creation_date.isnot(None))
                .order_by(ResourceMetric.recorded_at.desc())
                .first()
            )
        except Exception as _date_err:
            logger.debug(
                f"Could not query lifecycle dates for {raw_name} "
                f"(migration pending?): {_date_err}"
            )

        monitoring_results[norm_name] = {
            "server_name":    raw_name,
            "server_type":    stype,
            "avg_cpu":        raw_avg_cpu,
            "avg_ram":        avg["avg_ram_usage"],
            "avg_disk":       avg["avg_disk_usage"],
            "total_records":  avg["total_records"],
            "peak_cpu":       peak_cpu_raw,
            "peak_cpu_at":    peak["peak_cpu_recorded_at"],
            "peak_ram":       peak["peak_ram_usage"],
            "peak_ram_at":    peak["peak_ram_recorded_at"],
            "peak_disk":      peak["peak_disk_usage"],
            "peak_disk_at":   peak["peak_disk_recorded_at"],
            # CPU hw specs (from /specifications/hardware, stored as negative sentinel)
            "cpu_cores":      cpu_cores_hw,
            "cpu_source":     cpu_source_val,
            # Sources will be set below after invoice enrichment
            "ram_source":     "none",
            "disk_source":    "none",
            # ── OVH lifecycle dates (real dates from /serviceInfos) ──────────
            "creation_date":   dates_row.creation_date   if dates_row else None,
            "expiration_date": dates_row.expiration_date if dates_row else None,
            "ovh_state":       dates_row.ovh_state       if dates_row else None,
            "ovh_offer":       dates_row.ovh_offer       if dates_row else None,
        }

    # ── 2. Build invoice-based specs (from CostRecord) ────────────────────
    invoice_specs, invoice_fuzzy = _build_invoice_specs_from_costs(db)
    logger.info(f"📄 Invoice specs found for {len(invoice_specs)} servers")

    # ── 3. Merge: enrich monitoring servers + add invoice-only servers ────

    def _get_invoice_spec(monitor_name: str) -> Optional[Dict]:
        """Look up invoice specs for a monitoring server name.
        Tries exact normalized match first, then fuzzy match."""
        # 1. exact normalized
        if monitor_name in invoice_specs:
            return invoice_specs[monitor_name]
        # 2. fuzzy
        fkey = _fuzzy_server_key(monitor_name)
        if fkey and fkey in invoice_fuzzy:
            return invoice_specs.get(invoice_fuzzy[fkey])
        return None

    results: Dict[str, dict] = {}

    # Start with all monitoring servers
    for name, entry in monitoring_results.items():
        e = dict(entry)  # copy

        avg_ram  = e.get("avg_ram")  or 0.0
        avg_disk = e.get("avg_disk") or 0.0
        peak_ram  = e.get("peak_ram")  or 0.0
        peak_disk = e.get("peak_disk") or 0.0

        # Always attach invoice capacity (even when monitoring data exists)
        inv_spec = _get_invoice_spec(name)
        e["invoice_ram_gb"]  = inv_spec.get("ram_gb")  if inv_spec else None
        e["invoice_disk_gb"] = inv_spec.get("disk_gb") if inv_spec else None
        # cpu_cores and cpu_source are already set from the monitoring loop above

        # Determine RAM source
        if avg_ram > 0 or peak_ram > 0:
            e["ram_source"] = "monitoring"
        elif inv_spec and inv_spec.get("ram_gb"):
            inv_ram = inv_spec["ram_gb"]
            e["avg_ram"]    = inv_ram
            e["peak_ram"]   = inv_ram
            e["ram_source"] = "invoice"
        else:
            e["ram_source"] = "none"

        # Determine Disk source
        if avg_disk > 0 or peak_disk > 0:
            e["disk_source"] = "monitoring"
        elif inv_spec and inv_spec.get("disk_gb"):
            inv_disk = inv_spec["disk_gb"]
            e["avg_disk"]    = inv_disk
            e["peak_disk"]   = inv_disk
            e["disk_source"] = "invoice"
        else:
            e["disk_source"] = "none"

        results[name] = e

    # Add invoice-only servers (present in costs but NOT in ResourceMetric)
    # Build set of fuzzy keys already covered by monitoring
    monitoring_fuzzy_keys = {_fuzzy_server_key(k) for k in results.keys()}

    for ref, specs in invoice_specs.items():
        if ref in results:
            continue  # already handled above (exact match)
        if _fuzzy_server_key(ref) in monitoring_fuzzy_keys:
            continue  # already handled via fuzzy match — skip to avoid duplicate

        ram_gb  = specs.get("ram_gb")
        disk_gb = specs.get("disk_gb")

        # Skip if no useful spec data parsed at all
        if not ram_gb and not disk_gb:
            continue

        results[ref] = {
            "server_name":   ref,
            "server_type":   specs.get("server_type", _detect_server_type_from_name(ref)),
            # No real monitoring data
            "avg_cpu":       None,
            "avg_ram":       ram_gb  or 0.0,
            "avg_disk":      disk_gb or 0.0,
            "total_records": 0,
            "peak_cpu":      None,
            "peak_cpu_at":   None,
            "peak_ram":      ram_gb  or 0.0,
            "peak_ram_at":   None,
            "peak_disk":     disk_gb or 0.0,
            "peak_disk_at":  None,
            # Sources
            "ram_source":    "invoice" if ram_gb  else "none",
            "disk_source":   "invoice" if disk_gb else "none",
            # Invoice capacity (same as avg/peak for invoice-only servers)
            "invoice_ram_gb":  ram_gb,
            "invoice_disk_gb": disk_gb,
        }
        logger.info(
            f"📄 Invoice-only server added: {ref} "
            f"RAM={ram_gb}GB DISK={disk_gb}GB type={specs.get('server_type')}"
        )

    final = sorted(results.values(), key=lambda x: x["server_name"])
    logger.info(
        f"✅ get_all_servers_summary: {len(norm_to_raw)} monitoring + "
        f"{len(results) - len(norm_to_raw)} invoice-only = {len(final)} total"
    )
    return final


# ─────────────────────────────────────────────────────────────────────────────
# /{metric_id} — INTENTIONALLY LAST so it never shadows /stats/*, /servers/*,
#               /import-ovh-metrics, etc.
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/{metric_id}",
    response_model=ResourceMetricResponse,
    summary="Get a resource metric by ID",
)
def get_metric(
    metric_id: int,
    db: Session = Depends(get_db),
):
    metric = resource_service.get_resource_metric_by_id(db, metric_id)
    if not metric:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Resource metric with id={metric_id} not found.",
        )
    return metric