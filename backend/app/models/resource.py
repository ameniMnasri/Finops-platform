from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ResourceMetricCreate(BaseModel):
    server_name: str
    server_type: str
    cpu_usage: Optional[float] = None
    ram_usage: Optional[float] = None
    disk_usage: Optional[float] = None
    recorded_at: Optional[datetime] = None


class ResourceMetricResponse(BaseModel):
    id: int
    server_name: str
    server_type: str
    cpu_usage: Optional[float] = None
    ram_usage: Optional[float] = None
    disk_usage: Optional[float] = None
    recorded_at: datetime
    created_at: datetime

    class Config:
        from_attributes = True


class OVHCredentials(BaseModel):
    app_key: str
    app_secret: str
    consumer_key: str


class ImportOVHMetricsRequest(BaseModel):
    app_key: str
    app_secret: str
    consumer_key: str


class ImportOVHMetricsResponse(BaseModel):
    total_servers: int
    metrics_created: int
    servers: List[str]
    errors: List[str] = []
