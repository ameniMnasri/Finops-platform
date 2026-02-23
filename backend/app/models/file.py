from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class FileUploadResponse(BaseModel):
    """Response après upload"""
    id: int
    filename: str
    file_format: str
    file_size_bytes: int
    parse_status: str
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class FileListResponse(BaseModel):
    """File dans une liste"""
    id: int
    filename: str
    file_format: str
    parse_status: str
    file_size_bytes: int
    created_at: datetime

    class Config:
        from_attributes = True


class FileDetailResponse(BaseModel):
    """Détails complets d'un fichier"""
    id: int
    filename: str
    file_format: str
    file_size_bytes: int
    parse_status: str
    user_id: int
    parse_error: Optional[str] = None
    data_quality_score: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True