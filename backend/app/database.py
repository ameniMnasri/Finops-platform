from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
import logging
import os
from app.config import settings

logger = logging.getLogger(__name__)

database_url  = settings.database_url
database_echo = settings.database_echo

if 'sqlite' in database_url:
    engine = create_engine(
        database_url,
        connect_args={'check_same_thread': False},
        echo=database_echo,
    )
else:
    engine = create_engine(database_url, echo=database_echo)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """Dependency: Get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database"""
    logger.info('Creating database tables...')
    from app.schemas.base import Base
    Base.metadata.create_all(bind=engine)
    logger.info('✅ Database initialized')


def run_migrations():
    """Apply incremental schema changes that create_all cannot handle."""
    try:
        with engine.begin() as conn:
            conn.execute(text('ALTER TABLE cost_records ADD COLUMN IF NOT EXISTS tva_rate FLOAT'))
            conn.execute(text('ALTER TABLE cost_records ADD COLUMN IF NOT EXISTS source TEXT'))
            conn.execute(text('ALTER TABLE cost_records ADD COLUMN IF NOT EXISTS reference TEXT'))
            conn.execute(text('ALTER TABLE cost_records ADD COLUMN IF NOT EXISTS source_file TEXT'))
        logger.info('✅ Migrations applied')
    except Exception as e:
        logger.warning(f'⚠️ Migration warning (non-fatal): {e}')


def check_db_connection():
    """Check database connection"""
    try:
        with engine.connect() as conn:
            conn.execute(text('SELECT 1'))
        logger.info('✅ Database connected')
    except Exception as e:
        logger.error(f'⚠️ Database connection warning: {e}')
