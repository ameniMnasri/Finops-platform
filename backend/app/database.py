from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
import logging
import os

from app.config import settings

logger = logging.getLogger(__name__)

os.makedirs(os.path.dirname(settings.database_url.replace("sqlite:///", "")), exist_ok=True) if "/" in settings.database_url.replace("sqlite:///", "") else None

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
