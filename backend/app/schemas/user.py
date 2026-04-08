from sqlalchemy import Column, Integer, String, Boolean, Enum
from sqlalchemy.orm import relationship
from enum import Enum as PyEnum

from app.schemas.base import Base, TimeStampMixin


class UserRole(PyEnum):
    admin = "admin"
    user = "user"


class User(Base, TimeStampMixin):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    role = Column(Enum(UserRole), default=UserRole.user)

    files = relationship("File", back_populates="owner", cascade="all, delete-orphan")
    cost_records = relationship("CostRecord", back_populates="owner", cascade="all, delete-orphan")
