from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
import logging
import hashlib
import requests
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import date, datetime
from pydantic import BaseModel

from app.database import get_db
from app.schemas.file import File as FileModel, FileStatus, FileFormat
from app.schemas.user import User
from app.models.file import FileUploadResponse, FileListResponse
from app.models.cost import CostRecord as CostDB          # SQLAlchemy model
from app.models.resource import ResourceMetric as ResourceMetricDB  # SQLAlchemy model
from app.schemas.cost import CostCreate                    # Pydantic schema
from app.schemas.resource import ResourceMetricCreate      # Pydantic schema
from app.services.file_parser import file_parser
from app.services.cost_service import cost_service
from app.services import resource_service
from app.services.cloud_fetcher import get_fetcher, get_ovh_resource_fetcher
from app.dependencies import get_current_user
from app.config import settings
from app.schemas.cloud import OVHCredentials


# ==================== PYDANTIC SCHEMAS ====================

class ApiCostRecord(BaseModel):
    cost_date:     date
    amount:        float
    service_name:  str
    currency:      str           = "EUR"
    project_id:    Optional[str] = None
    team_id:       Optional[str] = None
    cost_category: Optional[str] = None
    description:   Optional[str] = None  # input only, not passed to CostCreate


class ApiImportRequest(BaseModel):
    source_name: str
    costs:       List[ApiCostRecord]
    metadata:    Optional[Dict[str, Any]] = {}


class FetchAndImportRequest(BaseModel):
    source_name:   str
    auth_fields:   Dict[str, Any]
    url:           Optional[str]            = None
    method:        str                      = "GET"
    start_date:    Optional[str]            = None
    end_date:      Optional[str]            = None
    extra_headers: Optional[Dict[str, Any]] = {}
    metadata:      Optional[Dict[str, Any]] = {}


class OVHResourceImportRequest(OVHCredentials):
    """OVH credentials for the /files/import-ovh-resources endpoint."""


# ==================== LIST FILES ====================

@router.get("/", response_model=List[FileListResponse])
def list_files(
    skip:         int     = Query(0,   ge=0),
    limit:        int     = Query(100, ge=1, le=500),
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user)
):
    logger.info(f"📋 Listing files for user {current_user.id}")
    files = db.query(FileModel).filter(
        FileModel.user_id == current_user.id
    ).order_by(FileModel.created_at.desc()).offset(skip).limit(limit).all()
    logger.info(f"✅ Found {len(files)} files")
    return files


# ==================== UPLOAD FILE ====================

@router.post("/upload", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file:         UploadFile = File(...),
    db:           Session    = Depends(get_db),
    current_user: User       = Depends(get_current_user)
):
    logger.info(f"📤 Upload started by {current_user.email}")
    try:
        if not file or not file.filename:
            raise HTTPException(status_code=400, detail="No file provided")

        file_ext = file.filename.split(".")[-1].lower()
        allowed  = ["xlsx", "xls", "csv", "pdf"]
        if file_ext not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Format non supporté. Formats acceptés: {', '.join(allowed)}"
            )

        try:
            file_format_enum = FileFormat[file_ext.upper()]
        except KeyError:
            raise HTTPException(status_code=400, detail="Format invalide")

        contents  = await file.read()
        file_size = len(contents)

        if file_size == 0:
            raise HTTPException(status_code=400, detail="Le fichier est vide")
        if file_size > 50 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Fichier trop grand (max 50MB)")

        file_hash = hashlib.sha256(contents).hexdigest()
        existing  = db.query(FileModel).filter(FileModel.file_hash == file_hash).first()
        if existing:
            logger.info(f"⚠️ Duplicate detected, returning existing ID={existing.id}")
            return existing

        upload_dir    = Path(settings.upload_dir)
        upload_dir.mkdir(parents=True, exist_ok=True)
        safe_filename = file.filename.replace(" ", "_").replace("/", "_")
        file_path     = upload_dir / f"{file_hash[:8]}_{safe_filename}"

        with open(file_path, "wb") as f:
            f.write(contents)

        db_file = FileModel(
            filename        = file.filename,
            file_hash       = file_hash,
            file_size_bytes = file_size,
            file_format     = file_format_enum,
            user_id         = current_user.id,
            parse_status    = FileStatus.PENDING,
        )
        db.add(db_file)
        db.commit()
        db.refresh(db_file)
        logger.info(f"✅ File uploaded: ID={db_file.id}")
        return db_file

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Upload error: {str(e)}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


# ==================== IMPORT VIA API (manual cost records) ====================

@router.post("/import-api", status_code=status.HTTP_201_CREATED)
def import_via_api(
    payload:      ApiImportRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user)
):
    """Accept a pre-built list of cost records and save them directly."""
    logger.info(f"🔌 API import by {current_user.email}: {len(payload.costs)} records from '{payload.source_name}'")
    try:
        costs_created = 0
        costs_skipped = 0
        errors        = []

        for i, record in enumerate(payload.costs):
            try:
                if record.amount <= 0:
                    costs_skipped += 1
                    errors.append(f"Ligne {i+1}: montant invalide ({record.amount})")
                    continue

                cost_data = CostCreate(
                    cost_date     = record.cost_date,
                    amount        = record.amount,
                    service_name  = record.service_name,
                    currency      = record.currency,
                    project_id    = record.project_id,
                    team_id       = record.team_id,
                    cost_category = record.cost_category,
                    source        = payload.source_name,
                    source_file   = None,
                    reference     = None,
                )
                cost_service.create_cost(db, cost_data)
                costs_created += 1

            except Exception as e:
                costs_skipped += 1
                errors.append(f"Ligne {i+1}: {str(e)}")
                logger.error(f"❌ Record {i+1} failed: {str(e)}", exc_info=True)

        logger.info(f"✅ API import done: {costs_created} créés, {costs_skipped} ignorés")
        return {
            "message":       f"Import API réussi depuis '{payload.source_name}'",
            "source":        payload.source_name,
            "costs_created": costs_created,
            "costs_skipped": costs_skipped,
            "total_sent":    len(payload.costs),
            "errors":        errors[:10],
            "imported_at":   datetime.utcnow().isoformat(),
        }

    except Exception as e:
        logger.error(f"❌ API import error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Import API failed: {str(e)}")


# ==================== TEST CONNECTION ====================

@router.post("/test-connection", status_code=status.HTTP_200_OK)
def test_connection(
    payload:      FetchAndImportRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user)
):
    """Test cloud API connectivity without importing anything."""
    logger.info(f"🔌 test-connection for '{payload.source_name}' by {current_user.email}")
    try:
        fetcher = get_fetcher(payload.source_name)
        result  = fetcher.test_connection(payload.auth_fields)
        return result
    except Exception as e:
        logger.error(f"❌ test-connection error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ==================== FETCH AND IMPORT FROM CLOUD API ====================

@router.post("/fetch-and-import", status_code=status.HTTP_201_CREATED)
def fetch_and_import(
    payload:      FetchAndImportRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user)
):
    """
    Fetch costs directly from a cloud API (OVHcloud, AWS, Azure, GCP, Custom)
    and save them to the database in one step.
    """
    logger.info(f"🌐 fetch-and-import from '{payload.source_name}' by {current_user.email}")
    try:
        fetcher = get_fetcher(payload.source_name)

        # ── 1. Fetch raw costs from cloud API ────────────────────
        try:
            if payload.source_name.lower() == "custom":
                raw_costs = fetcher.fetch_costs(
                    auth_fields   = payload.auth_fields,
                    start_date    = payload.start_date,
                    end_date      = payload.end_date,
                    url           = payload.url,
                    method        = payload.method,
                    extra_headers = payload.extra_headers or {},
                )
            else:
                raw_costs = fetcher.fetch_costs(
                    auth_fields = payload.auth_fields,
                    start_date  = payload.start_date,
                    end_date    = payload.end_date,
                )
        except NotImplementedError as e:
            raise HTTPException(status_code=501, detail=str(e))
        except requests.exceptions.HTTPError as e:
            code = e.response.status_code if e.response is not None else 502
            if code == 403:
                detail = "Accès refusé — vérifiez vos droits API (Consumer Key, permissions)"
            elif code == 401:
                detail = "Clés invalides ou expirées"
            else:
                detail = f"Erreur API cloud {code}"
            raise HTTPException(status_code=502, detail=detail)

        logger.info(f"📦 Fetched {len(raw_costs)} raw records from {payload.source_name}")

        # ── 2. Save to DB ─────────────────────────────────────────
        costs_created = 0
        costs_skipped = 0
        errors        = []

        for i, record in enumerate(raw_costs):
            try:
                amount = float(record.get("amount", 0) or 0)
                if amount <= 0:
                    costs_skipped += 1
                    continue

                cost_data = CostCreate(
                    cost_date     = record["cost_date"],
                    amount        = amount,
                    service_name  = record.get("service_name", payload.source_name),
                    currency      = record.get("currency", "EUR"),
                    cost_category = record.get("cost_category"),
                    reference     = record.get("reference"),
                    source        = payload.source_name,
                    source_file   = None,
                )
                cost_service.create_cost(db, cost_data)
                costs_created += 1

            except Exception as e:
                costs_skipped += 1
                errors.append(f"Record {i+1}: {str(e)}")
                logger.error(f"❌ Record {i+1} failed: {str(e)}", exc_info=True)

        logger.info(f"✅ fetch-and-import done: {costs_created} créés, {costs_skipped} ignorés")
        return {
            "message":       f"Import réussi depuis {payload.source_name}",
            "source":        payload.source_name,
            "costs_created": costs_created,
            "costs_skipped": costs_skipped,
            "total_sent":    len(raw_costs),
            "errors":        errors[:10],
            "imported_at":   datetime.utcnow().isoformat(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ fetch-and-import error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")


# ==================== PARSE ====================

@router.post("/{file_id}/parse")
def parse_file(
    file_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user)
):
    """Parse a file and extract costs — also stores official HT/TTC totals."""
    logger.info(f"⚙️ Parsing file {file_id}")
    db_file = db.query(FileModel).filter(
        FileModel.id      == file_id,
        FileModel.user_id == current_user.id
    ).first()

    if not db_file:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    try:
        db_file.parse_status = FileStatus.PARSING
        db.commit()

        result = file_parser.parse(db_file, db)
        db_file.parse_status = FileStatus.SUCCESS

        if isinstance(result, dict):
            if result.get("invoice_total_ht") is not None:
                db_file.invoice_total_ht  = float(result["invoice_total_ht"])
            if result.get("invoice_total_ttc") is not None:
                db_file.invoice_total_ttc = float(result["invoice_total_ttc"])
            if result.get("invoice_date") is not None:
                try:
                    v = result["invoice_date"]
                    db_file.invoice_date = (
                        v if isinstance(v, date)
                        else datetime.fromisoformat(str(v)).date()
                    )
                except Exception:
                    pass
            if result.get("invoice_reference") is not None:
                db_file.invoice_reference = str(result["invoice_reference"])

        db.commit()
        db.refresh(db_file)
        logger.info(f"✅ File {file_id} parsed: {result}")
        return {
            "message":           "Fichier parsé avec succès",
            "file_id":           file_id,
            "costs_created":     result.get("costs_created",    0)    if isinstance(result, dict) else 0,
            "rows_imported":     result.get("rows_imported",    0)    if isinstance(result, dict) else 0,
            "rows_skipped":      result.get("rows_skipped",     0)    if isinstance(result, dict) else 0,
            "invoice_total_ht":  result.get("invoice_total_ht", None) if isinstance(result, dict) else None,
            "invoice_total_ttc": result.get("invoice_total_ttc",None) if isinstance(result, dict) else None,
            "invoice_date":      str(result.get("invoice_date", None))if isinstance(result, dict) else None,
            "invoice_reference": result.get("invoice_reference",None) if isinstance(result, dict) else None,
        }

    except Exception as e:
        db_file.parse_status = FileStatus.FAILED
        db_file.parse_error  = str(e)[:500]
        db.commit()
        logger.error(f"❌ Parse error for file {file_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Parse failed: {str(e)}")


# ==================== IMPORT OVH RESOURCES ====================

@router.post("/import-ovh-resources", status_code=status.HTTP_201_CREATED)
def import_ovh_resources(
    payload:      OVHResourceImportRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Fetch VPS and Dedicated server metrics from OVHcloud and store them
    in the ResourceMetric table.  Returns the count of imported records.
    """
    logger.info(f"🌐 import-ovh-resources by {current_user.email}")
    try:
        fetcher = get_ovh_resource_fetcher()
        auth_fields = {
            "app_key":      payload.app_key,
            "app_secret":   payload.app_secret,
            "consumer_key": payload.consumer_key,
        }
        raw_resources = fetcher.fetch_resources(auth_fields)
        logger.info(f"📦 Fetched {len(raw_resources)} resource records from OVHcloud")

        result = resource_service.save_ovh_resource_metrics(db, raw_resources)
        logger.info(
            f"✅ import-ovh-resources done: {result['metrics_created']} created, "
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
        logger.error(f"❌ import-ovh-resources error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Import OVHcloud failed — consultez les logs serveur")


# ==================== DELETE ====================

@router.delete("/{file_id}")
def delete_file(
    file_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user)
):
    db_file = db.query(FileModel).filter(
        FileModel.id      == file_id,
        FileModel.user_id == current_user.id
    ).first()

    if not db_file:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    db.query(CostDB).filter(CostDB.file_id == file_id).delete()
    db.delete(db_file)
    db.commit()
    logger.info(f"✅ File {file_id} and its cost records deleted")
    return {"message": "Fichier supprimé"}