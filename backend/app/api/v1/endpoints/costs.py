from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from datetime import date
from typing import List, Optional
import logging

from app.database import get_db
from app.schemas.cost import CostRecord
from app.models.cost import CostUpdate, CostResponse, CostListResponse, CostSummary, CostSummaryByProject
from app.services.cost_service import cost_service
from app.dependencies import get_current_user
from app.schemas.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/costs", tags=["costs"])


@router.get("/summary/service")
def get_summary_by_service(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return cost_service.get_summary_by_service(db)


@router.get("/summary/project")
def get_summary_by_project(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return cost_service.get_summary_by_project(db)


@router.get("/stats/total")
def get_total_cost(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return cost_service.get_total(db)


@router.get("/", response_model=CostListResponse)
def list_costs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    service: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items, total = cost_service.get_all(
        db, skip=skip, limit=limit,
        service=service, project=project, source=source,
        start_date=start_date, end_date=end_date,
    )
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@router.get("/{cost_id}", response_model=CostResponse)
def get_cost(
    cost_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    record = cost_service.get_by_id(db, cost_id)
    if not record:
        raise HTTPException(status_code=404, detail="Cost not found")
    return record


@router.put("/{cost_id}", response_model=CostResponse)
def update_cost(
    cost_id: int,
    cost_data: CostUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    record = cost_service.update(db, cost_id, cost_data.model_dump(exclude_none=True))
    if not record:
        raise HTTPException(status_code=404, detail="Cost not found")
    return record


@router.delete("/{cost_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cost(
    cost_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not cost_service.delete(db, cost_id):
        raise HTTPException(status_code=404, detail="Cost not found")
