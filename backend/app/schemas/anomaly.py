"""
Pydantic schemas for Anomaly — request/response models.
"""
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List
from app.models.anomaly import AnomalyType, AnomalySeverity, AnomalyMethod


# ── Response ──────────────────────────────────────────────────────────────────

class AnomalyResponse(BaseModel):
    id:               int
    entity_type:      str
    entity_name:      str
    anomaly_type:     AnomalyType
    severity:         AnomalySeverity
    method:           AnomalyMethod
    observed_value:   float
    expected_value:   Optional[float]
    std_dev:          Optional[float]
    z_score:          Optional[float]
    anomaly_score:    Optional[float]
    threshold_value:  Optional[float]
    threshold_type:   Optional[str]
    detected_at:      datetime
    created_at:       datetime
    description:      Optional[str]
    unit:             Optional[str]
    source_record_id: Optional[int]

    model_config = {"from_attributes": True}


# ── Detect request ─────────────────────────────────────────────────────────────

class DetectCostAnomaliesRequest(BaseModel):
    window_days:    int   = Field(30,  ge=7,  le=365, description="Lookback window in days")
    z_threshold:    float = Field(2.5, ge=1.0, le=5.0, description="Z-score threshold")
    service_filter: Optional[str] = Field(None, description="Filter by service name")
    save:           bool  = Field(True, description="Persist detected anomalies to DB")


class DetectResourceAnomaliesRequest(BaseModel):
    window_days:   int   = Field(30,  ge=7,  le=365)
    z_threshold:   float = Field(2.5, ge=1.0, le=5.0)
    server_filter: Optional[str] = Field(None, description="Filter by server name")
    metrics:       List[str] = Field(
        default=["cpu_usage", "ram_usage", "disk_usage"],
        description="Which metrics to analyse"
    )
    save:          bool = Field(True)


class DetectMLRequest(BaseModel):
    server_filter:     Optional[str] = None
    contamination:     float = Field(0.05, ge=0.01, le=0.5,
                                     description="Expected proportion of outliers (0.01–0.5)")
    n_estimators:      int   = Field(100, ge=10, le=500)
    window_days:       int   = Field(60,  ge=14, le=365)
    save:              bool  = Field(True)


# ── Summary ────────────────────────────────────────────────────────────────────

class AnomalySummary(BaseModel):
    total:         int
    critical:      int
    high:          int
    medium:        int
    low:           int
    cost_spikes:   int
    resource_high: int
    latest_at:     Optional[datetime]