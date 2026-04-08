from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime


class CostBase(BaseModel):
    cost_date:     date  = Field(...,          description="Date du coût")
    amount:        float = Field(...,  gt=0,   description="Montant du coût")
    currency:      str   = Field("EUR",        description="Devise (EUR, USD, etc.)")
    service_name:  str   = Field(...,          description="Nom du service")
    cost_category: Optional[str] = Field(None, description="Catégorie OVH détectée (VPS, Dedicated, IP…)")

    # ✅ Référence UUID — colonne "Référence" de la facture OVH
    # Exemple : "60f36728-62a9-446a-8ce6-74071acb0c6f"
    reference:     Optional[str] = Field(None, description="UUID référence OVH (ex: 60f36728-…)")

    # ✅ Source — "OVHcloud", "AWS", "Azure", "GCP", "Fichier", "Manuel"
    source:        Optional[str] = Field("Fichier", description="Origine de la donnée")

    # ✅ Nom du fichier source (pour détection OVH côté frontend)
    source_file:   Optional[str] = Field(None, description="Nom du fichier importé")

    # kept for backward compat — not displayed anymore but still stored
    project_id:    Optional[str] = Field(None, description="ID du projet")
    team_id:       Optional[str] = Field(None, description="ID de l'équipe")
    description: Optional[str] = Field(None, description="Note libre")


class CostCreate(CostBase):
    """Créer un coût manuellement"""
    pass


class CostUpdate(BaseModel):
    """Mettre à jour un coût (tous les champs optionnels)"""
    cost_date:     Optional[date]  = None
    amount:        Optional[float] = Field(None, gt=0)
    currency:      Optional[str]   = None
    service_name:  Optional[str]   = None
    cost_category: Optional[str]   = None
    reference:     Optional[str]   = None   # ✅ UUID éditable
    source:        Optional[str]   = None   # ✅ source éditable
    source_file:   Optional[str]   = None
    project_id:    Optional[str]   = None
    team_id:       Optional[str]   = None


class CostResponse(CostBase):
    """Réponse complète avec tous les champs"""
    id:         int
    file_id:    Optional[int]      = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CostListResponse(BaseModel):
    """Coût dans une liste (vue tableau)"""
    id:           int
    cost_date:    date
    service_name: str
    amount:       float
    currency:     str
    cost_category: Optional[str]  = None

    # ✅ Champs OVH
    reference:    Optional[str]   = None   # UUID colonne "Référence"
    source:       Optional[str]   = None   # OVHcloud / AWS / Fichier…
    source_file:  Optional[str]   = None   # nom du fichier source

    # kept for compat
    project_id:   Optional[str]   = None
    team_id:      Optional[str]   = None

    class Config:
        from_attributes = True


class CostSummary(BaseModel):
    """Résumé des coûts par service"""
    service_name: str
    total_amount: float
    currency:     str
    count:        int
    avg_amount:   float
    min_amount:   float
    max_amount:   float


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