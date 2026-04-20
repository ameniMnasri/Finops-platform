from pydantic import BaseModel, Field, validator
from typing import Optional, List
from datetime import datetime


class ResourceMetricCreate(BaseModel):
    # cpu_usage encoding:
    #   None         = monitoring unavailable (VPS: OVH removed CPU endpoint 15/09/2024)
    #   0.0 – 100.0  = real-time RTM usage percentage (Dedicated with RTM agent)
    #   negative     = SENTINEL: abs(value) = physical core count from /specifications/hardware
    #                  (Dedicated without RTM — we store cores so the UI can display them)
    cpu_usage: Optional[float] = Field(None, description="CPU usage % (0-100), None if unavailable, negative = core count sentinel")
    ram_usage: float = Field(..., ge=0, description="RAM usage in GB")
    disk_usage: float = Field(..., ge=0, description="Disk usage in GB")
    server_name: Optional[str] = Field(None, max_length=255, description="Server or host identifier")
    server_type: Optional[str] = Field(None, max_length=20, description="Server type: VPS or DEDICATED")
    recorded_at: Optional[datetime] = Field(None, description="Timestamp of the metric (defaults to now)")
    creation_date:   Optional[datetime] = None   # from /serviceInfos → "creation"
    expiration_date: Optional[datetime] = None   # from /serviceInfos → "expiration"
    ovh_state:       Optional[str]      = None   # "ok" | "expired" | "suspended"
    ovh_offer:       Optional[str]      = None   # offer/plan label
    @validator("cpu_usage", pre=True, always=True)
    def validate_cpu(cls, v):
        if v is None:
            return None
        v = float(v)
        # Negative values are intentional sentinels: -N means N physical cores (no RTM data)
        # The abs(value) should not exceed 512 cores (sanity check)
        if v < -512:
            raise ValueError("CPU core sentinel out of range (abs > 512 cores)")
        # Positive values must be a valid percentage
        if v > 100:
            raise ValueError("CPU usage must be between 0 and 100")
        return round(v, 2)

    @validator("ram_usage", "disk_usage")
    def validate_positive(cls, v):
        if v < 0:
            raise ValueError("Value must be non-negative")
        return round(v, 3)


class ResourceMetricResponse(BaseModel):
    id: int
    cpu_usage: Optional[float]      # None = monitoring unavailable
    ram_usage: float
    disk_usage: float
    server_name: Optional[str]
    server_type: Optional[str]      # "VPS" | "DEDICATED" | None
    recorded_at: datetime
    created_at: datetime

    class Config:
        from_attributes = True


class ResourceMetricList(BaseModel):
    total: int
    items: List[ResourceMetricResponse]


class ResourceAverageStats(BaseModel):
    avg_cpu_usage: Optional[float] = Field(None, description="Average CPU usage (%), None if no data")
    avg_ram_usage: float = Field(..., description="Average RAM usage (GB)")
    avg_disk_usage: float = Field(..., description="Average Disk usage (GB)")
    total_records: int


class ResourcePeakStats(BaseModel):
    peak_cpu_usage: Optional[float] = Field(None, description="Peak CPU usage (%), None if no data")
    peak_cpu_server: Optional[str]
    peak_cpu_recorded_at: Optional[datetime]

    peak_ram_usage: float = Field(..., description="Peak RAM usage (GB)")
    peak_ram_server: Optional[str]
    peak_ram_recorded_at: Optional[datetime]

    peak_disk_usage: float = Field(..., description="Peak Disk usage (GB)")
    peak_disk_server: Optional[str]
    peak_disk_recorded_at: Optional[datetime]