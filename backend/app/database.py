from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
import logging
import os
from app.config import settings

logger = logging.getLogger(__name__)

# ─── Engine setup ────────────────────────────────────────────────────────────

if 'sqlite' in settings.database_url:
    engine = create_engine(
        settings.database_url,
        connect_args={'check_same_thread': False},
        echo=settings.database_echo,
    )
else:
    engine = create_engine(
        settings.database_url,
        echo=settings.database_echo,
    )

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
    from app.schemas.base import Base
    logger.info('Creating database tables...')
    Base.metadata.create_all(bind=engine)
    logger.info('✅ Database initialized')


def run_migrations():
    """Apply incremental schema changes that create_all cannot handle."""
    migrations = [
        'ALTER TABLE cost_records ADD COLUMN IF NOT EXISTS tva_rate FLOAT',
        'ALTER TABLE cost_records ADD COLUMN IF NOT EXISTS source VARCHAR(100)',
        'ALTER TABLE cost_records ADD COLUMN IF NOT EXISTS source_ref VARCHAR(500)',
    ]
    try:
        with engine.begin() as conn:
            for stmt in migrations:
                conn.execute(text(stmt))
        logger.info('✅ Migrations applied')
    except Exception as e:
        logger.warning(f'⚠️ Migration warning (non-fatal): {e}')


def check_db_connection():
    """Check database connection"""
    try:
        with engine.begin() as conn:
            conn.execute(text('SELECT 1'))
        logger.info('✅ Database connected')
    except Exception as e:
        logger.warning(f'⚠️ Database connection warning: {e}')
