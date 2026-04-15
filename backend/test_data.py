# test_data.py — mets ce fichier dans ton backend/
from app.database import SessionLocal
from app.models.cost import CostRecord
from app.models.resource import ResourceMetric

db = SessionLocal()

cost_count = db.query(CostRecord).count()
resource_count = db.query(ResourceMetric).count()

print(f"CostRecords : {cost_count}")
print(f"ResourceMetrics : {resource_count}")
db.close()