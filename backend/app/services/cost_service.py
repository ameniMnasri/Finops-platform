from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date
from typing import List, Optional
import logging

from app.schemas.cost import CostRecord
from app.models.cost import CostCreate, CostSummary, CostSummaryByProject

logger = logging.getLogger(__name__)

class CostService:
    """Service pour gérer les coûts"""
    
    @staticmethod
    def create_cost(db: Session, cost_data: CostCreate) -> CostRecord:
        """Créer un coût"""
        db_cost = CostRecord(**cost_data.dict())
        db.add(db_cost)
        db.commit()
        db.refresh(db_cost)
        logger.info(f"✅ Cost created: {db_cost.id}")
        return db_cost
    
    @staticmethod
    def get_costs(
        db: Session,
        skip: int = 0,
        limit: int = 100,
        service_filter: Optional[str] = None,
        project_filter: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> List[CostRecord]:
        """Lister les coûts avec filtres"""
        query = db.query(CostRecord)
        
        if service_filter:
            query = query.filter(CostRecord.service_name.ilike(f"%{service_filter}%"))
        
        if project_filter:
            query = query.filter(CostRecord.project_id == project_filter)
        
        if start_date:
            query = query.filter(CostRecord.cost_date >= start_date)
        
        if end_date:
            query = query.filter(CostRecord.cost_date <= end_date)
        
        return query.order_by(CostRecord.cost_date.desc()).offset(skip).limit(limit).all()
    
    @staticmethod
    def get_cost_by_id(db: Session, cost_id: int) -> Optional[CostRecord]:
        """Obtenir un coût par ID"""
        return db.query(CostRecord).filter(CostRecord.id == cost_id).first()
    
    @staticmethod
    def update_cost(db: Session, cost_id: int, cost_data: dict) -> Optional[CostRecord]:
        """Mettre à jour un coût"""
        db_cost = db.query(CostRecord).filter(CostRecord.id == cost_id).first()
        
        if not db_cost:
            return None
        
        for key, value in cost_data.items():
            if value is not None:
                setattr(db_cost, key, value)
        
        db.commit()
        db.refresh(db_cost)
        logger.info(f"✅ Cost updated: {cost_id}")
        return db_cost
    
    @staticmethod
    def delete_cost(db: Session, cost_id: int) -> bool:
        """Supprimer un coût"""
        db_cost = db.query(CostRecord).filter(CostRecord.id == cost_id).first()
        
        if not db_cost:
            return False
        
        db.delete(db_cost)
        db.commit()
        logger.info(f"✅ Cost deleted: {cost_id}")
        return True
    
    @staticmethod
    def get_summary_by_service(db: Session) -> List[CostSummary]:
        """Résumé des coûts par service"""
        results = db.query(
            CostRecord.service_name,
            func.sum(CostRecord.amount).label("total_amount"),
            CostRecord.currency,
            func.count(CostRecord.id).label("count"),
            func.avg(CostRecord.amount).label("avg_amount"),
            func.min(CostRecord.amount).label("min_amount"),
            func.max(CostRecord.amount).label("max_amount")
        ).group_by(
            CostRecord.service_name,
            CostRecord.currency
        ).all()
        
        return [
            CostSummary(
                service_name=r[0],
                total_amount=float(r[1]) if r[1] else 0,
                currency=r[2],
                count=r[3],
                avg_amount=float(r[4]) if r[4] else 0,
                min_amount=float(r[5]) if r[5] else 0,
                max_amount=float(r[6]) if r[6] else 0
            )
            for r in results
        ]
    
    @staticmethod
    def get_summary_by_project(db: Session) -> List[CostSummaryByProject]:
        """Résumé des coûts par projet"""
        results = db.query(
            CostRecord.project_id,
            func.sum(CostRecord.amount).label("total_amount"),
            CostRecord.currency,
            func.count(CostRecord.id).label("count")
        ).group_by(
            CostRecord.project_id,
            CostRecord.currency
        ).all()
        
        return [
            CostSummaryByProject(
                project_id=r[0],
                total_amount=float(r[1]) if r[1] else 0,
                currency=r[2],
                count=r[3],
                services=[]
            )
            for r in results
        ]
    
    @staticmethod
    def get_total_cost(
        db: Session,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> dict:
        """Coût total pour une période"""
        query = db.query(
            func.sum(CostRecord.amount).label("total"),
            CostRecord.currency,
            func.count(CostRecord.id).label("count")
        )
        
        if start_date:
            query = query.filter(CostRecord.cost_date >= start_date)
        
        if end_date:
            query = query.filter(CostRecord.cost_date <= end_date)
        
        result = query.first()
        
        if not result[0]:
            return {"total": 0, "currency": "EUR", "count": 0}
        
        return {
            "total": float(result[0]),
            "currency": result[1],
            "count": result[2]
        }

# Singleton instance
cost_service = CostService()