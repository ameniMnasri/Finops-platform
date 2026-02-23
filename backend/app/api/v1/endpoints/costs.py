from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from datetime import date
from typing import List, Optional
import logging

from app.database import get_db
from app.schemas.cost import CostRecord
from app.models.cost import (
    CostCreate, CostUpdate, CostResponse, CostListResponse,
    CostSummary, CostSummaryByProject
)
from app.services.cost_service import cost_service
from app.dependencies import get_current_user
from app.schemas.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/costs", tags=["costs"])

# ==================== CREATE ====================

@router.post("/", response_model=CostResponse, status_code=status.HTTP_201_CREATED)
def create_cost(
    cost_data: CostCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Créer un nouveau coût
    
    - **cost_date**: Date du coût (YYYY-MM-DD)
    - **amount**: Montant (doit être > 0)
    - **service_name**: Nom du service (EC2, RDS, S3, etc.)
    - **currency**: Devise (EUR, USD, etc.)
    - **project_id**: ID du projet (optionnel)
    - **team_id**: ID de l'équipe (optionnel)
    - **cost_category**: Catégorie (optionnel)
    """
    try:
        db_cost = cost_service.create_cost(db, cost_data)
        logger.info(f"✅ Cost created by {current_user.email}: {db_cost.id}")
        return db_cost
    
    except Exception as e:
        logger.error(f"❌ Create cost error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create cost: {str(e)}"
        )

# ==================== LIST ====================

@router.get("/", response_model=List[CostListResponse])
def list_costs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    service: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Lister les coûts avec filtres optionnels
    
    - **skip**: Nombre de coûts à sauter
    - **limit**: Nombre de coûts à retourner
    - **service**: Filtrer par service
    - **project**: Filtrer par projet
    - **start_date**: Date de début
    - **end_date**: Date de fin
    """
    try:
        costs = cost_service.get_costs(
            db,
            skip=skip,
            limit=limit,
            service_filter=service,
            project_filter=project,
            start_date=start_date,
            end_date=end_date
        )
        return costs
    
    except Exception as e:
        logger.error(f"❌ List costs error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to list costs: {str(e)}"
        )

# ==================== GET BY ID ====================

@router.get("/{cost_id}", response_model=CostResponse)
def get_cost(
    cost_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtenir les détails d'un coût"""
    try:
        cost = cost_service.get_cost_by_id(db, cost_id)
        
        if not cost:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Cost {cost_id} not found"
            )
        
        return cost
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Get cost error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to get cost: {str(e)}"
        )

# ==================== UPDATE ====================

@router.put("/{cost_id}", response_model=CostResponse)
def update_cost(
    cost_id: int,
    cost_data: CostUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Mettre à jour un coût"""
    try:
        db_cost = cost_service.update_cost(db, cost_id, cost_data.dict(exclude_unset=True))
        
        if not db_cost:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Cost {cost_id} not found"
            )
        
        logger.info(f"✅ Cost updated by {current_user.email}: {cost_id}")
        return db_cost
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Update cost error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to update cost: {str(e)}"
        )

# ==================== DELETE ====================

@router.delete("/{cost_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cost(
    cost_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Supprimer un coût"""
    try:
        success = cost_service.delete_cost(db, cost_id)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Cost {cost_id} not found"
            )
        
        logger.info(f"✅ Cost deleted by {current_user.email}: {cost_id}")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Delete cost error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to delete cost: {str(e)}"
        )

# ==================== SUMMARY ====================

@router.get("/summary/service", response_model=List[CostSummary])
def get_summary_by_service(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Résumé des coûts par service"""
    try:
        summary = cost_service.get_summary_by_service(db)
        return summary
    
    except Exception as e:
        logger.error(f"❌ Summary error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to get summary: {str(e)}"
        )

@router.get("/summary/project", response_model=List[CostSummaryByProject])
def get_summary_by_project(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Résumé des coûts par projet"""
    try:
        summary = cost_service.get_summary_by_project(db)
        return summary
    
    except Exception as e:
        logger.error(f"❌ Summary error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to get summary: {str(e)}"
        )

# ==================== STATS ====================

@router.get("/stats/total", response_model=dict)
def get_total_cost(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Coût total pour une période"""
    try:
        total = cost_service.get_total_cost(db, start_date, end_date)
        return total
    
    except Exception as e:
        logger.error(f"❌ Total cost error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to get total: {str(e)}"
        )