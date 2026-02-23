from sqlalchemy.orm import declarative_base
from sqlalchemy import Column, DateTime, func

Base = declarative_base()

class TimeStampMixin:
    """Ajoute created_at et updated_at à tous les modèles"""
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)