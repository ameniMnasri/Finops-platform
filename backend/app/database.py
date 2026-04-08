from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
import logging
import os

from app.config import settings

logger = logging.getLogger(__name__)

# Ensure database directory exists for file-based databases (e.g., SQLite)
_db_path = settings.database_url.replace("sqlite:///", "")
if "/" in _db_path:
    os.makedirs(os.path.dirname(_db_path), exist_ok=True)

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
    echo=settings.database_echo,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app.schemas.base import Base
    import app.schemas.user   # noqa: F401
    import app.schemas.file   # noqa: F401
    import app.schemas.cost   # noqa: F401
    import app.schemas.resource  # noqa: F401
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created")


def run_migrations():
    init_db()


def check_db_connection():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("Database connection OK")
        return True
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        return False
