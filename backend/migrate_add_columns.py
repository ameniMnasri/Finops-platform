"""
Run once: python migrate_add_columns.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from app.database import engine

statements = [
    "ALTER TABLE cost_records ADD COLUMN IF NOT EXISTS reference   VARCHAR(255) DEFAULT NULL",
    "ALTER TABLE cost_records ADD COLUMN IF NOT EXISTS source      VARCHAR(50)  DEFAULT 'Fichier'",
    "ALTER TABLE cost_records ADD COLUMN IF NOT EXISTS source_file VARCHAR(255) DEFAULT NULL",
]

print("🚀 Running migration...")
with engine.connect() as conn:
    for sql in statements:
        try:
            conn.execute(text(sql))
            conn.commit()
            print(f"  ✅ {sql[:60]}...")
        except Exception as e:
            print(f"  ⚠️  Already exists or error: {e}")

print("\n✅ Done! Now restart server and re-import your OVH file.")