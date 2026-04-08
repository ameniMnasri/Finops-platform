from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey
from sqlalchemy.orm import relationship

from app.schemas.base import Base, TimeStampMixin


class CostRecord(Base, TimeStampMixin):
    """Modèle coûts"""
    __tablename__ = "cost_records"

    id            = Column(Integer,      primary_key=True, index=True)
    cost_date     = Column(Date,         nullable=False, index=True)
    amount        = Column(Float,        nullable=False)
    currency      = Column(String(3),    default="EUR")

    service_name  = Column(String(255),  nullable=False)
    cost_category = Column(String(100),  nullable=True)

    project_id    = Column(String(100),  index=True, nullable=True)
    team_id       = Column(String(100),  index=True, nullable=True)

    # ✅ UUID reference from OVH invoice column "Référence"
    # e.g. "60f36728-62a9-446a-8ce6-74071acb0c6f"
    reference     = Column(String(255),  nullable=True, index=True)

    # ✅ Source: "OVHcloud", "AWS", "Azure", "GCP", "Fichier", "Manuel"
    source        = Column(String(50),   nullable=True, default='Fichier')

    # ✅ Source file name (for OVH auto-detection on frontend)
    source_file   = Column(String(255),  nullable=True)

    file_id       = Column(Integer, ForeignKey("files.id"), nullable=True)
    raw_data      = Column(String(1000), nullable=True)

    def __repr__(self):
        return (
            f"<Cost {self.cost_date} {self.amount} "
            f"ref={self.reference} src={self.source}>"
        )