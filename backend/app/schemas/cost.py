from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey
from sqlalchemy.orm import relationship

from app.schemas.base import Base, TimeStampMixin


class CostRecord(Base, TimeStampMixin):
    __tablename__ = "cost_records"

    id = Column(Integer, primary_key=True, index=True)
    service = Column(String, nullable=True)
    project = Column(String, nullable=True)
    amount = Column(Float, nullable=False, default=0.0)
    currency = Column(String, default="EUR")
    cost_date = Column(Date, nullable=True)
    description = Column(String, nullable=True)
    source = Column(String, nullable=True)
    source_ref = Column(String, nullable=True)
    file_id = Column(Integer, ForeignKey("files.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    source_file = relationship("File", back_populates="cost_records")
    owner = relationship("User", back_populates="cost_records")
