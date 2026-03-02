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


# ==================== LIST FILES ====================
@router.get("/", response_model=List[FileListResponse])
def list_files(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all files for the current user"""
    logger.info(f"📋 Listing files for user {current_user.id}")
    files = db.query(FileModel).filter(
        FileModel.user_id == current_user.id
    ).order_by(FileModel.created_at.desc()).offset(skip).limit(limit).all()
    logger.info(f"✅ Found {len(files)} files")
    return files


# ==================== UPLOAD ====================
@router.post("/upload", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload a file (Excel/PDF/CSV)"""
    logger.info(f"📤 Upload started by {current_user.email}")

    try:
        if not file or not file.filename:
            raise HTTPException(status_code=400, detail="No file provided")

        file_ext = file.filename.split(".")[-1].lower()
        allowed = ["xlsx", "xls", "csv", "pdf"]
        if file_ext not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Format non supporté. Formats acceptés: {', '.join(allowed)}"
            )

        try:
            file_format_enum = FileFormat[file_ext.upper()]
        except KeyError:
            raise HTTPException(status_code=400, detail="Format invalide")

        contents = await file.read()
        file_size = len(contents)

        if file_size == 0:
            raise HTTPException(status_code=400, detail="Le fichier est vide")
        if file_size > 50 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Fichier trop grand (max 50MB)")

        file_hash = hashlib.sha256(contents).hexdigest()

        # ✅ Retourner l'existant au lieu de 409
        existing = db.query(FileModel).filter(FileModel.file_hash == file_hash).first()
        if existing:
            logger.info(f"⚠️ Duplicate detected, returning existing ID={existing.id}")
            return existing

        # Sauvegarder sur disque
        upload_dir = Path(settings.upload_dir)
        upload_dir.mkdir(parents=True, exist_ok=True)
        safe_filename = file.filename.replace(" ", "_").replace("/", "_")
        file_path = upload_dir / f"{file_hash[:8]}_{safe_filename}"

        with open(file_path, "wb") as f:
            f.write(contents)

        # Sauvegarder en DB
        db_file = FileModel(
            filename=file.filename,
            file_hash=file_hash,
            file_size_bytes=file_size,
            file_format=file_format_enum,
            user_id=current_user.id,
            parse_status=FileStatus.PENDING
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


# ==================== PARSE ====================
@router.post("/{file_id}/parse")
def parse_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Parse a file and extract costs"""
    logger.info(f"⚙️ Parsing file {file_id}")

    db_file = db.query(FileModel).filter(
        FileModel.id == file_id,
        FileModel.user_id == current_user.id
    ).first()

    if not db_file:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    try:
        # ✅ CORRECT : PARSING (pas PROCESSING)
        db_file.parse_status = FileStatus.PARSING
        db.commit()

        result = file_parser.parse(db_file, db)

        # ✅ CORRECT : SUCCESS (pas COMPLETED)
        db_file.parse_status = FileStatus.SUCCESS
        db.commit()

        logger.info(f"✅ File {file_id} parsed: {result}")
        return {
            "message": "Fichier parsé avec succès",
            "file_id": file_id,
            "costs_created": result.get("costs_created", 0) if isinstance(result, dict) else 0,
            "rows_imported":  result.get("rows_imported",  0) if isinstance(result, dict) else 0,
            "rows_skipped":   result.get("rows_skipped",   0) if isinstance(result, dict) else 0,
        }

    except Exception as e:
        db_file.parse_status = FileStatus.FAILED
        db_file.parse_error  = str(e)[:500]
        db.commit()
        logger.error(f"❌ Parse error for file {file_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Parse failed: {str(e)}")


# ==================== DELETE ====================
@router.delete("/{file_id}")
def delete_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a file"""
    db_file = db.query(FileModel).filter(
        FileModel.id == file_id,
        FileModel.user_id == current_user.id
    ).first()

    if not db_file:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    db.delete(db_file)
    db.commit()
    logger.info(f"✅ File {file_id} deleted")
    return {"message": "Fichier supprimé"}