from pydantic import BaseModel, Field, computed_field
from typing import Optional, List
from datetime import datetime, date


class CostBase(BaseModel):
    cost_date:     date           = Field(description='Date du coût')
    amount:        float          = Field(description='Montant HT du coût')
    currency:      str            = Field(default='EUR', description='Devise (EUR, USD, etc.)')
    service_name:  str            = Field(description='Nom du service (EC2, RDS, S3, etc.)')
    project_id:    Optional[str]  = Field(default=None, description='ID du projet')
    team_id:       Optional[str]  = Field(default=None, description="ID de l'équipe")
    cost_category: Optional[str]  = Field(default=None, description='Catégorie (Compute, Storage, etc.)')
    tva_rate:      Optional[float]= Field(default=None, description='Taux de TVA (ex: 0.20 pour 20%)')


class CostCreate(CostBase):
    """Créer un coût"""
    pass


class CostUpdate(BaseModel):
    """Mettre à jour un coût"""
    cost_date:     Optional[date]  = Field(default=None)
    amount:        Optional[float] = Field(default=None)
    currency:      Optional[str]   = Field(default=None)
    service_name:  Optional[str]   = Field(default=None)
    project_id:    Optional[str]   = Field(default=None)
    team_id:       Optional[str]   = Field(default=None)
    cost_category: Optional[str]   = Field(default=None)
    tva_rate:      Optional[float] = Field(default=None)


class CostResponse(CostBase):
    """Réponse avec détails"""
    id:          int
    file_id:     Optional[int]      = None
    created_at:  Optional[datetime] = None
    updated_at:  Optional[datetime] = None
    source:      Optional[str]      = None
    reference:   Optional[str]      = None
    source_file: Optional[str]      = None

    @computed_field
    @property
    def tva_amount(self) -> float:
        """Montant de la TVA calculé à partir du taux"""
        if self.tva_rate:
            return round(self.tva_rate * self.amount, 2)
        return 0.0

    @computed_field
    @property
    def amount_ttc(self) -> float:
        """Montant TTC (HT + TVA)"""
        if self.tva_rate:
            return round(self.amount * (1 + self.tva_rate), 2)
        return self.amount

    class Config:
        from_attributes = True


class CostListResponse(BaseModel):
    """Coût dans une liste"""
    id:            int
    cost_date:     date
    service_name:  str
    amount:        float
    currency:      str
    project_id:    Optional[str]   = None
    team_id:       Optional[str]   = None
    cost_category: Optional[str]   = None
    tva_rate:      Optional[float] = None
    source:        Optional[str]   = None
    reference:     Optional[str]   = None
    source_file:   Optional[str]   = None

    @computed_field
    @property
    def tva_amount(self) -> float:
        """Montant de la TVA calculé à partir du taux"""
        if self.tva_rate:
            return round(self.tva_rate * self.amount, 2)
        return 0.0

    @computed_field
    @property
    def amount_ttc(self) -> float:
        """Montant TTC (HT + TVA)"""
        if self.tva_rate:
            return round(self.amount * (1 + self.tva_rate), 2)
        return self.amount

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
    project_id:   Optional[str] = None
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
