from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime

class CostBase(BaseModel):
    cost_date: date = Field(..., description="Date du coût")
    amount: float = Field(..., gt=0, description="Montant du coût")
    currency: str = Field(default="EUR", description="Devise (EUR, USD, etc.)")
    service_name: str = Field(..., description="Nom du service (EC2, RDS, S3, etc.)")
    project_id: Optional[str] = Field(None, description="ID du projet")
    team_id: Optional[str] = Field(None, description="ID de l'équipe")
    cost_category: Optional[str] = Field(None, description="Catégorie (Compute, Storage, etc.)")

class CostCreate(CostBase):
    """Créer un coût"""
    pass

class CostUpdate(BaseModel):
    """Mettre à jour un coût"""
    cost_date: Optional[date] = None
    amount: Optional[float] = Field(None, gt=0)
    currency: Optional[str] = None
    service_name: Optional[str] = None
    project_id: Optional[str] = None
    team_id: Optional[str] = None
    cost_category: Optional[str] = None

class CostResponse(CostBase):
    """Réponse avec détails"""
    id: int
    file_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

class CostListResponse(BaseModel):
    """Coût dans une liste"""
    id: int
    cost_date: date
    service_name: str
    amount: float
    currency: str
    project_id: Optional[str] = None
    team_id: Optional[str] = None
    
    class Config:
        from_attributes = True

class CostSummary(BaseModel):
    """Résumé des coûts"""
    service_name: str
    total_amount: float
    currency: str
    count: int
    avg_amount: float
    min_amount: float
    max_amount: float
    
class CostSummaryByProject(BaseModel):
    """Résumé par projet"""
    project_id: Optional[str]
    total_amount: float
    currency: str
    count: int
    services: List[str]

class CostTrendResponse(BaseModel):
    """Tendance des coûts"""
    date: date
    amount: float
    currency: str
    service_name: str