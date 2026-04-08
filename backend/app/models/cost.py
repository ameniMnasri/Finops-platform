from pydantic import BaseModel, Field, computed_field
from typing import Optional, List
from datetime import datetime, date


class CostBase(BaseModel):
    service: Optional[str] = None
    project: Optional[str] = None
    amount: float = 0.0
    currency: str = "EUR"
    cost_date: Optional[date] = None
    description: Optional[str] = None
    source: Optional[str] = None
    source_ref: Optional[str] = None


class CostCreate(CostBase):
    pass


class CostUpdate(BaseModel):
    service: Optional[str] = None
    project: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    cost_date: Optional[date] = None
    description: Optional[str] = None


class CostResponse(CostBase):
    id: int
    file_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class CostListResponse(BaseModel):
    items: List[CostResponse]
    total: int
    skip: int
    limit: int


class CostSummary(BaseModel):
    service: Optional[str] = None
    total: float
    count: int


class CostSummaryByProject(BaseModel):
    project: Optional[str] = None
    total: float
    count: int


class CostTrendResponse(BaseModel):
    month: str
    total: float
    count: int
