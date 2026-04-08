from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
import logging
import hashlib
from pathlib import Path
from typing import List

from app.database import get_db
from app.schemas.file import File as FileModel, FileStatus, FileFormat
from app.schemas.user import User
from app.models.file import FileUploadResponse, FileListResponse, FileDetailResponse
from app.services.file_parser import file_parser
from app.dependencies import get_current_user
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/files", tags=["files"])

UPLOAD_DIR = Path(settings.upload_dir)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.get("/", response_model=List[FileListResponse])
def list_files(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    files = db.query(FileModel).order_by(FileModel.created_at.desc()).offset(skip).limit(limit).all()
    return files


@router.post("/upload", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    content = await file.read()
    if len(content) > settings.max_upload_size:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")

    file_hash = hashlib.md5(content).hexdigest()
    ext = Path(file.filename).suffix.lstrip(".").lower()
    if ext not in ("xlsx", "xls", "csv", "pdf"):
        raise HTTPException(status_code=400, detail=f"Unsupported format: {ext}")

    # Check duplicate
    existing = db.query(FileModel).filter(FileModel.original_filename == file.filename).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"File already uploaded: {file.filename}")

    saved_path = UPLOAD_DIR / f"{file_hash}.{ext}"
    saved_path.write_bytes(content)

    try:
        fmt = FileFormat[ext]
    except KeyError:
        fmt = FileFormat.csv

    db_file = FileModel(
        filename=file.filename,
        original_filename=file.filename,
        file_format=fmt,
        file_size_bytes=len(content),
        file_path=str(saved_path),
        parse_status=FileStatus.PENDING,
        user_id=current_user.id,
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)
    return db_file


@router.post("/{file_id}/parse")
def parse_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_file = db.query(FileModel).filter(FileModel.id == file_id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found")

    db_file.parse_status = FileStatus.PARSING
    db.commit()

    try:
        records = file_parser.parse(db_file.file_path, db_file.file_format.value)
        from app.services.cost_service import cost_service
        created = cost_service.create_bulk(db, records, file_id=file_id, user_id=current_user.id)
        from datetime import datetime
        db_file.parse_status = FileStatus.SUCCESS
        db_file.parsed_at = datetime.utcnow()
        db.commit()
        return {"file_id": file_id, "costs_created": created, "status": "SUCCESS"}
    except Exception as e:
        logger.error(f"Parse error for file {file_id}: {e}")
        db_file.parse_status = FileStatus.FAILED
        db.commit()
        raise HTTPException(status_code=500, detail=f"Parse failed: {str(e)}")


@router.post("/api-test")
async def api_test(payload: dict, current_user: User = Depends(get_current_user)):
    """Test connectivity to an external API."""
    from app.services.cloud_fetcher import CloudFetcher
    try:
        fetcher = CloudFetcher(payload)
        result = fetcher.test_connection()
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/import-api")
async def import_api(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Import costs from an external API."""
    from app.services.cloud_fetcher import CloudFetcher
    try:
        fetcher = CloudFetcher(payload)
        costs, meta = fetcher.fetch_costs()

        # Create a virtual file record for this API import
        db_file = FileModel(
            filename=f"API Import — {payload.get('source_name', 'Unknown')}",
            original_filename=None,
            file_format=FileFormat.api,
            file_size_bytes=0,
            file_path=None,
            parse_status=FileStatus.SUCCESS,
            user_id=current_user.id,
        )
        db.add(db_file)
        db.commit()
        db.refresh(db_file)

        from app.services.cost_service import cost_service
        created = cost_service.create_bulk(db, costs, file_id=db_file.id, user_id=current_user.id)

        return {
            "source_name": payload.get("source_name"),
            "total_sent": len(costs),
            "costs_created": created,
            "costs_skipped": len(costs) - created,
            "errors": meta.get("errors", []),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{file_id}", response_model=FileDetailResponse)
def get_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_file = db.query(FileModel).filter(FileModel.id == file_id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found")
    return db_file


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_file = db.query(FileModel).filter(FileModel.id == file_id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found")
    if db_file.file_path:
        try:
            Path(db_file.file_path).unlink(missing_ok=True)
        except Exception:
            pass
    db.delete(db_file)
    db.commit()
