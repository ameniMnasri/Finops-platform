from sqlalchemy import Column, Integer, Float, DateTime, String, func
from app.schemas.base import Base

class ResourceMetric(Base):
    __tablename__ = "resource_metrics"

    id = Column(Integer, primary_key=True, index=True)
    cpu_usage = Column(Float, nullable=True, comment="CPU usage in percentage (0-100), NULL = monitoring unavailable")
    ram_usage = Column(Float, nullable=False, comment="RAM usage in GB")
    disk_usage = Column(Float, nullable=False, comment="Disk usage in GB")
    server_name = Column(String(255), nullable=True, comment="Optional server/host identifier")
    server_type = Column(String(20), nullable=True, comment="VPS or DEDICATED")
    recorded_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)