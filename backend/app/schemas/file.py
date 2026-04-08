from sqlalchemy import Column, Integer, String, ForeignKey, Enum, DateTime
from sqlalchemy.orm import relationship
from enum import Enum as PyEnum
from datetime import datetime

from app.schemas.base import Base, TimeStampMixin


class FileFormat(PyEnum):
    xlsx = "xlsx"
    xls = "xls"
    csv = "csv"
    pdf = "pdf"
    api = "api"


class FileStatus(PyEnum):
    PENDING = "PENDING"
    PARSING = "PARSING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"


class File(Base, TimeStampMixin):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    original_filename = Column(String, nullable=True)
    file_format = Column(Enum(FileFormat), nullable=False)
    file_size_bytes = Column(Integer, nullable=True)
    file_path = Column(String, nullable=True)
    parse_status = Column(Enum(FileStatus), default=FileStatus.PENDING)
    parsed_at = Column(DateTime, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    owner = relationship("User", back_populates="files")
    cost_records = relationship("CostRecord", back_populates="source_file", cascade="all, delete-orphan")
