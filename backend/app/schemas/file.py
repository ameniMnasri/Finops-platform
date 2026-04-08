from sqlalchemy import Column, Integer, String, ForeignKey, Enum, DateTime, Float, Date
from sqlalchemy.orm import relationship
from enum import Enum as PyEnum
from datetime import datetime

from app.schemas.base import Base, TimeStampMixin


class FileFormat(PyEnum):
    XLSX = "xlsx"
    XLS  = "xls"
    PDF  = "pdf"
    CSV  = "csv"


class FileStatus(PyEnum):
    PENDING = "pending"
    PARSING = "parsing"
    SUCCESS = "success"
    FAILED  = "failed"


class File(Base, TimeStampMixin):
    """Modèle fichiers uploadés"""
    __tablename__ = "files"

    id              = Column(Integer, primary_key=True, index=True)
    filename        = Column(String(255), nullable=False)
    file_hash       = Column(String(64),  unique=True, index=True)
    file_size_bytes = Column(Integer)
    file_format     = Column(Enum(FileFormat), nullable=False)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Status
    parse_status       = Column(Enum(FileStatus), default=FileStatus.PENDING)
    parse_error        = Column(String(500))
    data_quality_score = Column(Integer)

    # ── Totaux officiels de la facture (lus dans le PDF, pas calculés) ──
    # Remplis au moment du parse — restent NULL si le parseur ne les trouve pas.
    invoice_total_ht  = Column(Float,        nullable=True, default=None)
    invoice_total_ttc = Column(Float,        nullable=True, default=None)
    invoice_date      = Column(Date,         nullable=True, default=None)
    invoice_reference = Column(String(100),  nullable=True, default=None)

    # Relations
    user = relationship("User", back_populates="files")

    def __repr__(self):
        return f"<File {self.filename}>"