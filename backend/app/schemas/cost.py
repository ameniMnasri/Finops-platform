from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey
from sqlalchemy.orm import relationship
from app.schemas.base import Base, TimeStampMixin


class CostRecord(Base, TimeStampMixin):
    """Modèle coûts"""
    __tablename__ = 'cost_records'

    id           = Column(Integer, primary_key=True)
    cost_date    = Column(Date)
    amount       = Column(Float)
    currency     = Column(String, default='EUR')
    tva_rate     = Column(Float)
    project_id   = Column(String)
    team_id      = Column(String)
    service_name = Column(String)
    cost_category = Column(String)
    file_id      = Column(Integer, ForeignKey('files.id'))
    raw_data     = Column(String)
    # Added: source tracking and OVH reference
    source       = Column(String)
    reference    = Column(String)
    source_file  = Column(String)

    def __repr__(self):
        return f'<Cost {self.cost_date} {self.amount}>'
