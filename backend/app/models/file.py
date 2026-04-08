from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class FileUploadResponse(BaseModel):
    id: int
    filename: str
    original_filename: Optional[str] = None
    file_format: str
    file_size_bytes: Optional[int] = None
    parse_status: str
    created_at: datetime

    class Config:
        from_attributes = True


class FileListResponse(BaseModel):
    id: int
    filename: str
    original_filename: Optional[str] = None
    file_format: str
    file_size_bytes: Optional[int] = None
    parse_status: str
    created_at: datetime
    parsed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class FileDetailResponse(BaseModel):
    id: int
    filename: str
    original_filename: Optional[str] = None
    file_format: str
    file_size_bytes: Optional[int] = None
    parse_status: str
    created_at: datetime
    parsed_at: Optional[datetime] = None
    costs_count: Optional[int] = 0

    class Config:
        from_attributes = True
