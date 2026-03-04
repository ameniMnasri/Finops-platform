from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date
from typing import List, Optional
import logging

from app.schemas.cost import CostRecord
from app.models.cost import CostCreate, CostSummary, CostSummaryByProject

logger = logging.getLogger(__name__)

class CostService:

    @staticmethod
    def create_cost(db: Session, cost_data: CostCreate) -> CostRecord:
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
        return db.query(CostRecord).filter(CostRecord.id == cost_id).first()

    @staticmethod
    def update_cost(db: Session, cost_id: int, cost_data: dict) -> Optional[CostRecord]:
        db_cost = db.query(CostRecord).filter(CostRecord.id == cost_id).first()
        if not db_cost:
            return None
        for key, value in cost_data.items():
            if value is not None:
                setattr(db_cost, key, value)
        db.commit()
        db.refresh(db_cost)
        return db_cost

    @staticmethod
    def delete_cost(db: Session, cost_id: int) -> bool:
        db_cost = db.query(CostRecord).filter(CostRecord.id == cost_id).first()
        if not db_cost:
            return False
        db.delete(db_cost)
        db.commit()
        return True

    @staticmethod
    def get_summary_by_service(db: Session) -> List[CostSummary]:
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
                service_name=r.service_name,
                total_amount=float(r.total_amount or 0),
                currency=r.currency or "EUR",
                count=r.count,
                avg_amount=float(r.avg_amount or 0),
                min_amount=float(r.min_amount or 0),
                max_amount=float(r.max_amount or 0),
            )
            for r in results
        ]

    @staticmethod
    def get_summary_by_project(db: Session) -> List[CostSummaryByProject]:
        """✅ FIX : fournir currency et services requis par Pydantic"""
        results = db.query(
            CostRecord.project_id,
            func.sum(CostRecord.amount).label("total_amount"),
            func.count(CostRecord.id).label("count")
        ).group_by(
            CostRecord.project_id
        ).all()

        summaries = []
        for r in results:
            # Récupérer les services distincts pour ce projet
            services_q = db.query(CostRecord.service_name).filter(
                CostRecord.project_id == r.project_id
            ).distinct().all()
            services_list = [s.service_name for s in services_q]

            summaries.append(CostSummaryByProject(
                project_id=r.project_id or "Non assigné",
                total_amount=float(r.total_amount or 0),
                currency="EUR",          # ✅ valeur par défaut
                count=r.count,
                services=services_list,  # ✅ liste des services
            ))

        return summaries

    @staticmethod
    def get_total_cost(db: Session, start_date=None, end_date=None):
        """Retourne un dict {total_ht, tva_amount, total_ttc, currency, count}"""
        query = db.query(
            func.sum(CostRecord.amount).label("total"),
            func.count(CostRecord.id).label("count"),
            func.sum(
                func.coalesce(CostRecord.amount * CostRecord.tva_rate, 0)
            ).label("tva_total"),
        )
        if start_date:
            query = query.filter(CostRecord.cost_date >= start_date)
        if end_date:
            query = query.filter(CostRecord.cost_date <= end_date)

        result = query.first()
        total_ht = float(result.total or 0)
        tva_amount = round(float(result.tva_total or 0), 2)

        return {
            "total":      total_ht,
            "total_ht":   total_ht,
            "tva_amount": tva_amount,
            "total_ttc":  round(total_ht + tva_amount, 2),
            "count":      result.count or 0,
            "currency":   "EUR",
        }


cost_service = CostService()