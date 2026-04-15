import sys
sys.path.insert(0, '.')
from app.config import settings
from sqlalchemy import create_engine, text

engine = create_engine(settings.database_url)
with engine.connect() as conn:
    # 1. Create alembic_version table if it doesn't exist
    conn.execute(text("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"))
    # 2. Mark existing migration as already applied
    conn.execute(text("INSERT INTO alembic_version (version_num) VALUES ('a1b2c3d4e5f6') ON CONFLICT DO NOTHING"))
    # 2. Make cpu_usage nullable
    conn.execute(text("ALTER TABLE resource_metrics ALTER COLUMN cpu_usage DROP NOT NULL"))
    # 3. Add server_type column
    conn.execute(text("ALTER TABLE resource_metrics ADD COLUMN IF NOT EXISTS server_type VARCHAR(20)"))
    conn.commit()
    print("Done! DB updated successfully.")