from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy import func
from sqlalchemy.orm import relationship

from app.schemas.base import Base, TimeStampMixin


class ResourceMetric(Base, TimeStampMixin):
    __tablename__ = "resource_metrics"

    id = Column(Integer, primary_key=True, index=True)
    server_name = Column(String, nullable=False, index=True)
    server_type = Column(String, nullable=False)  # "vps" or "dedicated"
    cpu_usage = Column(Float, nullable=True)        # percentage
    ram_usage = Column(Float, nullable=True)        # GB
    disk_usage = Column(Float, nullable=True)       # GB
    recorded_at = Column(DateTime, default=func.now(), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
