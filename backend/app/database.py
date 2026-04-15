from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
import logging
import os

from app.config import settings

logger = logging.getLogger(__name__)

# Create engine
if "sqlite" in settings.database_url:
    # SQLite
    engine = create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False},
        echo=settings.database_echo
    )
else:
    # PostgreSQL
    engine = create_engine(
        settings.database_url,
        echo=settings.database_echo
    )

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db() -> Session:
    """Dependency: Get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """Initialize database"""
    logger.info("Creating database tables...")
    from app.schemas.base import Base
    import app.schemas.user  # Importer tous les modèles pour que Base les connaisse
    import app.schemas.file # Importer tous les modèles pour que Base les connaisse
    import app.models.cost  # Importer tous les modèles pour que Base les connaisse
    import app.models.resource  # Importer tous les modèles pour que Base les connaisse 
    import app.models.anomaly  # Importer tous les modèles pour que Base les connaisse    
    Base.metadata.create_all(bind=engine)
    logger.info("✅ Database initialized")

def check_db_connection():
    """Check database connection"""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))  # ✅ Ajoute text()
            logger.info("✅ Database connected")
            return True
    except Exception as e:
        logger.error(f"⚠️ Database connection warning: {e}")
        # Continue même si la DB n'est pas disponible
        return True