from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date
from typing import List, Optional
import logging

from app.schemas.cost import CostRecord
from app.models.cost import CostCreate, CostSummary, CostSummaryByProject

logger = logging.getLogger(__name__)


class CostService:

    def get_all(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 100,
        service: Optional[str] = None,
        project: Optional[str] = None,
        source: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> tuple[List[CostRecord], int]:
        query = db.query(CostRecord)
        if service:
            query = query.filter(CostRecord.service.ilike(f"%{service}%"))
        if project:
            query = query.filter(CostRecord.project.ilike(f"%{project}%"))
        if source:
            query = query.filter(CostRecord.source.ilike(f"%{source}%"))
        if start_date:
            query = query.filter(CostRecord.cost_date >= start_date)
        if end_date:
            query = query.filter(CostRecord.cost_date <= end_date)
        total = query.count()
        items = query.order_by(CostRecord.cost_date.desc()).offset(skip).limit(limit).all()
        return items, total

    def get_by_id(self, db: Session, cost_id: int) -> Optional[CostRecord]:
        return db.query(CostRecord).filter(CostRecord.id == cost_id).first()

    def create(self, db: Session, cost_data: CostCreate, file_id: Optional[int] = None, user_id: Optional[int] = None) -> CostRecord:
        record = CostRecord(
            service=cost_data.service,
            project=cost_data.project,
            amount=cost_data.amount,
            currency=cost_data.currency,
            cost_date=cost_data.cost_date,
            description=cost_data.description,
            source=cost_data.source,
            source_ref=cost_data.source_ref,
            file_id=file_id,
            user_id=user_id,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    def create_bulk(self, db: Session, costs: List[dict], file_id: Optional[int] = None, user_id: Optional[int] = None) -> int:
        created = 0
        for c in costs:
            record = CostRecord(
                service=c.get("service"),
                project=c.get("project"),
                amount=float(c.get("amount", 0)),
                currency=c.get("currency", "EUR"),
                cost_date=c.get("cost_date"),
                description=c.get("description"),
                source=c.get("source"),
                source_ref=c.get("source_ref"),
                file_id=file_id,
                user_id=user_id,
            )
            db.add(record)
            created += 1
        db.commit()
        return created

    def update(self, db: Session, cost_id: int, cost_data: dict) -> Optional[CostRecord]:
        record = self.get_by_id(db, cost_id)
        if not record:
            return None
        for key, value in cost_data.items():
            if value is not None:
                setattr(record, key, value)
        db.commit()
        db.refresh(record)
        return record

    def delete(self, db: Session, cost_id: int) -> bool:
        record = self.get_by_id(db, cost_id)
        if not record:
            return False
        db.delete(record)
        db.commit()
        return True

    def get_summary_by_service(self, db: Session, user_id: Optional[int] = None) -> List[dict]:
        query = db.query(
            CostRecord.service,
            func.sum(CostRecord.amount).label("total"),
            func.count(CostRecord.id).label("count"),
        )
        if user_id:
            query = query.filter(CostRecord.user_id == user_id)
        results = query.group_by(CostRecord.service).order_by(func.sum(CostRecord.amount).desc()).all()
        return [{"service": r.service, "total": float(r.total or 0), "count": r.count} for r in results]

    def get_summary_by_project(self, db: Session, user_id: Optional[int] = None) -> List[dict]:
        query = db.query(
            CostRecord.project,
            func.sum(CostRecord.amount).label("total"),
            func.count(CostRecord.id).label("count"),
        )
        if user_id:
            query = query.filter(CostRecord.user_id == user_id)
        results = query.group_by(CostRecord.project).order_by(func.sum(CostRecord.amount).desc()).all()
        return [{"project": r.project, "total": float(r.total or 0), "count": r.count} for r in results]

    def get_total(self, db: Session, user_id: Optional[int] = None) -> dict:
        query = db.query(func.sum(CostRecord.amount), func.count(CostRecord.id))
        if user_id:
            query = query.filter(CostRecord.user_id == user_id)
        total, count = query.first()
        return {"total": float(total or 0), "count": count or 0}


cost_service = CostService()
