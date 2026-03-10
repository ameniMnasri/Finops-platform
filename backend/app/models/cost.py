from pydantic import BaseModel, Field, computed_field
from typing import Optional, List
from datetime import datetime, date


class CostBase(BaseModel):
    cost_date:     date           = Field(...,   description="Date du coût")
    amount:        float          = Field(0,     description="Montant HT du coût")
    currency:      str            = Field('EUR', description="Devise (EUR, USD, etc.)")
    service_name:  str            = Field(...,   description="Nom du service (EC2, RDS, S3, etc.)")
    project_id:    Optional[str]  = Field(None,  description="ID du projet")
    team_id:       Optional[str]  = Field(None,  description="ID de l'équipe")
    cost_category: Optional[str]  = Field(None,  description="Catégorie (Compute, Storage, etc.)")
    tva_rate:      Optional[float] = Field(None, description="Taux de TVA (ex: 0.20 pour 20%)")
    source:        Optional[str]  = None
    reference:     Optional[str]  = None


class CostCreate(CostBase):
    """Créer un coût"""


class CostUpdate(BaseModel):
    """Mettre à jour un coût"""
    cost_date:     Optional[date]  = Field(None)
    amount:        Optional[float] = Field(None)
    currency:      Optional[str]   = Field(None)
    service_name:  Optional[str]   = Field(None)
    project_id:    Optional[str]   = Field(None)
    team_id:       Optional[str]   = Field(None)
    cost_category: Optional[str]   = Field(None)
    tva_rate:      Optional[float] = Field(None)
    source:        Optional[str]   = Field(None)
    reference:     Optional[str]   = Field(None)


class CostResponse(CostBase):
    """Réponse avec détails"""
    id:         int
    file_id:    Optional[int]      = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @computed_field
    @property
    def tva_amount(self) -> float:
        """Montant de la TVA calculé à partir du taux"""
        return round((self.tva_rate or 0) * self.amount, 2)

    @computed_field
    @property
    def amount_ttc(self) -> float:
        """Montant TTC (HT + TVA)"""
        return round((1 + (self.tva_rate or 0)) * self.amount, 2)

    class Config:
        from_attributes = True


class CostListResponse(BaseModel):
    """Coût dans une liste"""
    id:           int
    cost_date:    date
    service_name: str
    amount:       float
    currency:     str
    project_id:   Optional[str]   = None
    team_id:      Optional[str]   = None
    tva_rate:     Optional[float] = None
    source:       Optional[str]   = None
    reference:    Optional[str]   = None

    @computed_field
    @property
    def tva_amount(self) -> float:
        """Montant de la TVA calculé à partir du taux"""
        return round((self.tva_rate or 0) * self.amount, 2)

    @computed_field
    @property
    def amount_ttc(self) -> float:
        """Montant TTC (HT + TVA)"""
        return round((1 + (self.tva_rate or 0)) * self.amount, 2)

    class Config:
        from_attributes = True


class CostSummary(BaseModel):
    """Résumé des coûts"""
    service_name:  str
    total_amount:  float
    currency:      str
    count:         int
    avg_amount:    float
    min_amount:    float
    max_amount:    float


class CostSummaryByProject(BaseModel):
    """Résumé par projet"""
    project_id:   Optional[str]
    total_amount: float
    currency:     str
    count:        int
    services:     List[str]


class CostTrendResponse(BaseModel):
    """Tendance des coûts"""
    date:         date
    amount:       float
    currency:     str
    service_name: str
