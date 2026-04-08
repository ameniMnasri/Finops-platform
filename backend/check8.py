# force_reimport.py
import sys
sys.path.insert(0, '.')
from app.database import SessionLocal
from app.models.cost import CostRecord

db = SessionLocal()
deleted = db.query(CostRecord).delete()
db.commit()
print(f"✅ {deleted} enregistrements supprimés — réimporte les 3 PDFs depuis l'interface")