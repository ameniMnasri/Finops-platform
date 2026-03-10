from sqlalchemy.orm import declarative_base
from sqlalchemy import Column, DateTime, func

Base = declarative_base()


class TimeStampMixin:
    """Ajoute created_at et updated_at à tous les modèles"""
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
