from sqlalchemy import Column, Integer, String, Boolean, Enum
from sqlalchemy.orm import relationship
from enum import Enum as PyEnum

from app.schemas.base import Base, TimeStampMixin

class UserRole(PyEnum):
    ADMIN = "admin"
    ANALYST = "analyst"
    VIEWER = "viewer"
    UPLOADER = "uploader"

class User(Base, TimeStampMixin):
    """Modèle utilisateur"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255))
    role = Column(Enum(UserRole), default=UserRole.VIEWER)
    is_active = Column(Boolean, default=True)
    
    # Relations (avec backref, pas back_populates)
    files = relationship("File", back_populates="user", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<User {self.email}>"