from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
import logging
import hashlib
from pathlib import Path

from app.database import get_db
from app.schemas.file import File as FileModel, FileStatus , FileFormat
from app.schemas.user import User
from app.models.file import FileUploadResponse, FileListResponse, FileDetailResponse
from app.services.file_parser import file_parser
from app.dependencies import get_current_user
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/files", tags=["files"])

# ==================== UPLOAD ====================

@router.post("/upload", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload a file (Excel/PDF/CSV)
    Supported formats: xlsx, xls, csv, pdf
    """

    logger.info(f"📤 Upload started by {current_user.email}")

    try:
        # ================= VALIDATION =================
        if not file or not file.filename:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No file provided"
            )

        # Extract extension
        file_ext = file.filename.split(".")[-1].lower()
        allowed = ["xlsx", "xls", "csv", "pdf"]

        if file_ext not in allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File format not allowed. Allowed: {', '.join(allowed)}"
            )

        # ================= ENUM FIX (IMPORTANT) =================
        try:
            file_format_enum = FileFormat[file_ext.upper()]
        except KeyError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid file format"
            )

        # ================= READ FILE =================
        contents = await file.read()
        file_size = len(contents)

        if file_size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File is empty"
            )

        if file_size > 50 * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_413_PAYLOAD_TOO_LARGE,
                detail="File too large. Max 50MB allowed"
            )

        # ================= HASH =================
        file_hash = hashlib.sha256(contents).hexdigest()

        # Check duplicate
        existing = db.query(FileModel).filter(FileModel.file_hash == file_hash).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="File already uploaded"
            )

        # ================= SAVE FILE =================
        upload_dir = Path(settings.upload_dir)
        upload_dir.mkdir(parents=True, exist_ok=True)

        safe_filename = file.filename.replace(" ", "_").replace("/", "_")
        file_path = upload_dir / f"{file_hash[:8]}_{safe_filename}"

        with open(file_path, "wb") as f:
            f.write(contents)

        # ================= SAVE TO DATABASE =================
        db_file = FileModel(
            filename=file.filename,
            file_hash=file_hash,
            file_size_bytes=file_size,
            file_format=file_format_enum,  # ✅ ENUM CORRECT
            user_id=current_user.id,
            parse_status=FileStatus.PENDING
        )

        db.add(db_file)
        db.commit()
        db.refresh(db_file)

        logger.info(f"✅ File uploaded successfully: ID={db_file.id}")

        return db_file

    except HTTPException:
        raise

    except Exception as e:
        logger.error(f"❌ Upload error: {str(e)}", exc_info=True)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {str(e)}"
        )