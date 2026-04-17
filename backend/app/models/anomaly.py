"""
SQLAlchemy model — Anomaly table
Stores detected anomalies for both cost spikes and resource over-consumption.
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, Enum, Text, ForeignKey
from sqlalchemy.sql import func
import enum


from app.schemas.base import Base


class AnomalyType(str, enum.Enum):
    COST_SPIKE     = "cost_spike"      # Pic anormal de coût
    HIGH_CPU       = "high_cpu"        # Surconsommation CPU
    HIGH_RAM       = "high_ram"        # Surconsommation RAM
    HIGH_DISK      = "high_disk"       # Surconsommation Disk
    RESOURCE_SPIKE = "resource_spike"  # Pic général ressource (ML)


class AnomalySeverity(str, enum.Enum):
    LOW      = "low"       # 1–2 σ au-delà du seuil
    MEDIUM   = "medium"    # 2–3 σ
    HIGH     = "high"      # 3+ σ ou ML score élevé
    CRITICAL = "critical"  # Extrême


class AnomalyMethod(str, enum.Enum):
    STATISTICAL  = "statistical"   # Moving average + std dev
    ISOLATION_FOREST = "isolation_forest"  # ML outlier detection


class Anomaly(Base):
    __tablename__ = "anomalies"

    id              = Column(Integer, primary_key=True, index=True)

    # What entity triggered the anomaly
    entity_type     = Column(String(50), nullable=False)     # "server" | "cost_service"
    entity_name     = Column(String(255), nullable=False, index=True)
    
    anomaly_type    = Column(Enum(AnomalyType),     nullable=False, index=True)
    severity        = Column(Enum(AnomalySeverity), nullable=False)
    method          = Column(Enum(AnomalyMethod),   nullable=False)

    # The anomalous value and its statistical context
    observed_value  = Column(Float, nullable=False)
    expected_value  = Column(Float, nullable=True)   # moving average baseline
    std_dev         = Column(Float, nullable=True)   # std dev of the window
    z_score         = Column(Float, nullable=True)   # (observed - expected) / std_dev
    anomaly_score   = Column(Float, nullable=True)   # ML score (Isolation Forest)

    # Threshold that was breached
    threshold_value = Column(Float, nullable=True)
    threshold_type  = Column(String(50), nullable=True)  # e.g. "mean+3std"

    # Timestamps
    detected_at     = Column(DateTime(timezone=True), nullable=False)  # when anomaly occurred
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    # Human-readable details
    description     = Column(Text, nullable=True)
    unit            = Column(String(20), nullable=True)   # "€", "%", "GB"

    # Optional: link back to original record
    source_record_id = Column(Integer, nullable=True)  # cost_id or metric_id