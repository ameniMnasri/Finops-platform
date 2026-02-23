from sqlalchemy import Column, Integer, String, Float, Date

from app.schemas.base import Base, TimeStampMixin

class Resource(Base, TimeStampMixin):
    """Modèle utilisation ressources (CPU, RAM, Disque)"""
    __tablename__ = "resources"
    
    id = Column(Integer, primary_key=True, index=True)
    resource_date = Column(Date, nullable=False, index=True)
    
    project_id = Column(String(100), index=True)
    team_id = Column(String(100), index=True)
    service_name = Column(String(255), nullable=False)
    
    cpu_usage_percent = Column(Float)
    ram_usage_gb = Column(Float)
    disk_usage_gb = Column(Float)
    
    def __repr__(self):
        return f"<Resource {self.service_name}>"