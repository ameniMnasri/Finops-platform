from pydantic import BaseModel, Field, validator
from typing import Optional, List
from datetime import datetime


class ResourceMetricCreate(BaseModel):
    cpu_usage: float = Field(..., description="CPU usage % (0-100) or negative OVH sentinel (core count)")
    ram_usage: float = Field(..., ge=0, description="RAM usage in GB")
    disk_usage: float = Field(..., ge=0, description="Disk usage in GB")
    server_name: Optional[str] = Field(None, max_length=255, description="Server or host identifier")
    recorded_at: Optional[datetime] = Field(None, description="Timestamp of the metric (defaults to now)")

    @validator("cpu_usage")
    def validate_cpu(cls, v):
        # Allow negative values (OVH sentinel: negative = hardware core count)
        if v > 100:
            raise ValueError("CPU usage must be ≤ 100")
        return round(v, 2)

    @validator("ram_usage", "disk_usage")
    def validate_positive(cls, v):
        if v < 0:
            raise ValueError("Value must be non-negative")
        return round(v, 3)


class ResourceMetricResponse(BaseModel):
    id: int
    cpu_usage: float
    ram_usage: float
    disk_usage: float
    server_name: Optional[str]
    recorded_at: datetime
    created_at: datetime

    class Config:
        from_attributes = True


class ResourceMetricList(BaseModel):
    total: int
    items: List[ResourceMetricResponse]


class ResourceAverageStats(BaseModel):
    avg_cpu_usage: float = Field(..., description="Average CPU usage (%)")
    avg_ram_usage: float = Field(..., description="Average RAM usage (GB)")
    avg_disk_usage: float = Field(..., description="Average Disk usage (GB)")
    total_records: int


class ResourcePeakStats(BaseModel):
    peak_cpu_usage: float = Field(..., description="Peak CPU usage (%)")
    peak_cpu_server: Optional[str]
    peak_cpu_recorded_at: Optional[datetime]

    peak_ram_usage: float = Field(..., description="Peak RAM usage (GB)")
    peak_ram_server: Optional[str]
    peak_ram_recorded_at: Optional[datetime]

    peak_disk_usage: float = Field(..., description="Peak Disk usage (GB)")
    peak_disk_server: Optional[str]
    peak_disk_recorded_at: Optional[datetime]