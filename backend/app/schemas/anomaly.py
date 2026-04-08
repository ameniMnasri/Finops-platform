from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean
from datetime import datetime

from app.schemas.base import Base

class Anomaly(Base):
    """Modèle anomalies détectées"""
    __tablename__ = "anomalies"
    
    id = Column(Integer, primary_key=True, index=True)
    anomaly_type = Column(String(50), nullable=False)
    severity = Column(String(20), nullable=False)
    description = Column(String(500))
    anomaly_score = Column(Float)
    detection_date = Column(DateTime, default=datetime.utcnow)
    
    project_id = Column(String(100), index=True)
    team_id = Column(String(100), index=True)
    
    expected_value = Column(Float)
    actual_value = Column(Float)
    
    is_resolved = Column(Boolean, default=False)
    
    def __repr__(self):
        return f"<Anomaly {self.anomaly_type}>"