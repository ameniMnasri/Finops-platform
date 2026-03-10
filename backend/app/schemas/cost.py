from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey
from sqlalchemy.orm import relationship
from app.schemas.base import Base, TimeStampMixin


class CostRecord(Base, TimeStampMixin):
    """Modèle coûts"""
    __tablename__ = 'cost_records'

    id          = Column(Integer, primary_key=True, index=True)
    cost_date   = Column(Date,    nullable=False, index=True)
    amount      = Column(Float,   nullable=False)
    currency    = Column(String(3),   default='EUR')
    tva_rate    = Column(Float,   nullable=True, default=None)

    project_id    = Column(String(100), nullable=True, index=True)
    team_id       = Column(String(100), nullable=True, index=True)
    service_name  = Column(String(255), nullable=False)
    cost_category = Column(String(100))

    # Origin / source tracking
    source        = Column(String(100), nullable=True, index=True)
    source_ref    = Column(String(500), nullable=True)

    file_id  = Column(Integer, ForeignKey('files.id'))
    raw_data = Column(String(1000))

    def __repr__(self):
        return f'<Cost {self.cost_date} {self.amount}>'
