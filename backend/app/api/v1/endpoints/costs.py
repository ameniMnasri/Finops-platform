from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from datetime import date
from typing import List, Optional
import logging

from app.database import get_db

# ✅ SQLAlchemy model ONLY from models
from app.models.cost import CostRecord

# ✅ ALL Pydantic schemas from schemas (not from models)
from app.schemas.cost import (
    CostCreate,
    CostUpdate,
    CostResponse,
    CostListResponse,
    CostSummary,
    CostSummaryByProject,
)

from app.services.cost_service import cost_service
from app.dependencies import get_current_user
from app.schemas.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/costs", tags=["costs"])

# ==================== SUMMARY (DOIT ÊTRE AVANT LIST/GET) ====================

@router.get("/summary/service", response_model=List[CostSummary])
def get_summary_by_service(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Résumé des coûts par service"""
    try:
        logger.info("📊 Getting summary by service...")
        summary = cost_service.get_summary_by_service(db)
        logger.info(f"✅ Summary returned: {len(summary)} services")
        return summary
    except Exception as e:
        logger.error(f"❌ Summary error: {e}", exc_info=True)
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
        logger.info("📊 Getting summary by project...")
        summary = cost_service.get_summary_by_project(db)
        logger.info(f"✅ Summary returned: {len(summary)} projects")
        return summary
    except Exception as e:
        logger.error(f"❌ Summary error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to get summary: {str(e)}"
        )

# ==================== STATS ====================

@router.get("/stats/total", response_model=dict)
def get_total_cost(
    start_date: Optional[date] = Query(None),
    end_date:   Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Coût total pour une période"""
    try:
        logger.info("💰 Getting total cost...")
        total = cost_service.get_total_cost(db, start_date, end_date)
        logger.info(f"✅ Total: {total['total']} {total['currency']}")
        return total
    except Exception as e:
        logger.error(f"❌ Total cost error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to get total: {str(e)}"
        )

# ==================== CREATE ====================

@router.post("/", response_model=CostResponse, status_code=status.HTTP_201_CREATED)
def create_cost(
    cost_data: CostCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Créer un nouveau coût"""
    try:
        logger.info(f"📊 Creating cost for {cost_data.service_name}")
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
    skip:       int            = Query(0,     ge=0),
    limit:      int            = Query(100,   ge=1, le=10000),
    service:    Optional[str]  = Query(None),
    project:    Optional[str]  = Query(None),
    start_date: Optional[date] = Query(None),
    end_date:   Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Lister les coûts avec filtres optionnels"""
    try:
        logger.info("📂 Listing costs...")
        costs = cost_service.get_costs(
            db,
            skip=skip,
            limit=limit,
            service_filter=service,
            project_filter=project,
            start_date=start_date,
            end_date=end_date,
        )
        logger.info(f"✅ Found {len(costs)} costs")
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
        logger.info(f"🔍 Getting cost {cost_id}...")
        cost = cost_service.get_cost_by_id(db, cost_id)
        if not cost:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Cost {cost_id} not found"
            )
        logger.info(f"✅ Cost {cost_id} found")
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
    cost_id:   int,
    cost_data: CostUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Mettre à jour un coût"""
    try:
        logger.info(f"✏️ Updating cost {cost_id}...")
        db_cost = cost_service.update_cost(
            db, cost_id,
            cost_data.model_dump(exclude_unset=True)   # ✅ Pydantic v2 compatible
        )
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
        logger.info(f"🗑️ Deleting cost {cost_id}...")
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