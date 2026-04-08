from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import distinct
from typing import Optional
from datetime import datetime

import requests

from app.dependencies import get_db, get_current_user
from app.models.resource import ResourceMetric
from app.schemas.resource import (
    ResourceMetricCreate,
    ResourceMetricResponse,
    ResourceMetricList,
    ResourceAverageStats,
    ResourcePeakStats,
)
from app.schemas.user import User
from app.services import resource_service
from app.services.cloud_fetcher import get_ovh_resource_fetcher
from app.schemas.cloud import OVHCredentials

import logging
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/resources",
    tags=["Resources"],
)


# ─────────────────────────────────────────────────────────────────────────────
# REQUEST SCHEMAS
# ─────────────────────────────────────────────────────────────────────────────

class OVHImportRequest(OVHCredentials):
    """OVH credentials for the /resources/import-ovh endpoint."""


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


# ─────────────────────────────────────────────────────────────────────────────
# BASIC CRUD
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


# ─────────────────────────────────────────────────────────────────────────────
# GLOBAL STATS
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
# SERVER DISCOVERY  ← NEW
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
# PER-SERVER ENDPOINTS  ← NEW
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
        # averages
        "avg_cpu":        avg["avg_cpu_usage"],
        "avg_ram":        avg["avg_ram_usage"],
        "avg_disk":       avg["avg_disk_usage"],
        "total_records":  avg["total_records"],
        # peaks
        "peak_cpu":       peak["peak_cpu_usage"],
        "peak_cpu_at":    peak["peak_cpu_recorded_at"],
        "peak_ram":       peak["peak_ram_usage"],
        "peak_ram_at":    peak["peak_ram_recorded_at"],
        "peak_disk":      peak["peak_disk_usage"],
        "peak_disk_at":   peak["peak_disk_recorded_at"],
    }


@router.get(
    "/servers/{server_name}/summary/all",
    summary="Bulk summary for ALL servers in one call",
    description=(
        "Returns an array of summary objects (avg + peak) for every server "
        "that matches the optional date filter. Designed to populate the "
        "full server table with a single HTTP request."
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

    # Get all distinct server names
    rows = (
        db.query(distinct(ResourceMetric.server_name))
        .filter(ResourceMetric.server_name.isnot(None))
        .order_by(ResourceMetric.server_name)
        .all()
    )
    server_names = [r[0] for r in rows]

    results = []
    for name in server_names:
        avg  = resource_service.get_average_stats(
            db, server_name=name, from_date=from_dt, to_date=to_dt,
        )
        peak = resource_service.get_peak_stats(
            db, server_name=name, from_date=from_dt, to_date=to_dt,
        )
        results.append({
            "server_name":   name,
            "avg_cpu":       avg["avg_cpu_usage"],
            "avg_ram":       avg["avg_ram_usage"],
            "avg_disk":      avg["avg_disk_usage"],
            "total_records": avg["total_records"],
            "peak_cpu":      peak["peak_cpu_usage"],
            "peak_cpu_at":   peak["peak_cpu_recorded_at"],
            "peak_ram":      peak["peak_ram_usage"],
            "peak_ram_at":   peak["peak_ram_recorded_at"],
            "peak_disk":     peak["peak_disk_usage"],
            "peak_disk_at":  peak["peak_disk_recorded_at"],
        })

    return results

# ─────────────────────────────────────────────────────────────────────────────
# OVHcloud DIRECT IMPORT  ← NEW
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/import-ovh",
    status_code=status.HTTP_201_CREATED,
    summary="Import OVHcloud VPS & Dedicated server metrics",
    description=(
        "Fetch CPU, RAM and Disk usage from all OVHcloud VPS and Dedicated "
        "servers using HMAC-signed API requests, then store the metrics in "
        "the ResourceMetric table.  Returns the count of records created."
    ),
)
def import_ovh_resources(
    payload: OVHImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    POST /resources/import-ovh
    Accepts OVHcloud credentials and imports server metrics.
    Requires a valid application user session.
    """
    logger.info(f"🌐 POST /resources/import-ovh by {current_user.email}")
    try:
        fetcher = get_ovh_resource_fetcher()
        auth_fields = {
            "app_key":      payload.app_key,
            "app_secret":   payload.app_secret,
            "consumer_key": payload.consumer_key,
        }
        raw_resources = fetcher.fetch_resources(auth_fields)
        logger.info(f"📦 Fetched {len(raw_resources)} resource record(s) from OVHcloud")

        result = resource_service.save_ovh_resource_metrics(db, raw_resources)
        logger.info(
            f"✅ import-ovh done: {result['metrics_created']} created, "
            f"{result['metrics_skipped']} skipped"
        )
        return {
            "message": (
                f"Import OVHcloud réussi — "
                f"{result['metrics_created']} métrique(s) enregistrée(s)"
            ),
            **result,
        }

    except requests.exceptions.HTTPError as e:
        code = e.response.status_code if e.response is not None else 502
        if code == 403:
            detail = "Accès refusé — vérifiez les permissions de votre Consumer Key (GET /vps, GET /dedicated/server)"
        elif code == 401:
            detail = "Clés OVHcloud invalides ou expirées"
        else:
            detail = f"Erreur API OVHcloud {code}"
        raise HTTPException(status_code=502, detail=detail)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"❌ import-ovh error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Import OVHcloud failed — consultez les logs serveur")
