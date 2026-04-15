"""
generate_mock_metrics.py
Generate 7 days of synthetic resource metrics for testing anomaly detection.

Usage (from backend/):
    python -m app.scripts.generate_mock_metrics

Each server gets 7 daily samples with realistic variation.
A few servers include intentional anomaly spikes for validation.
"""

import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Allow running as a module from the backend directory
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.database import SessionLocal, init_db
from app.models.resource import ResourceMetric

DAYS = 7

# Representative server names (subset)
SERVERS = [
    "vps-188781ac.vps.ovh.net",
    "vps-3a996f60.vps.ovh.net",
    "vps-4e2e06ea.vps.ovh.net",
    "ns3007821.ip-149-202-66.eu",
    "ns3054852.ip-37-187-137.eu",
    "ns3072163.ip-217-182-138.eu",
    "ns3103176.ip-51-38-52.eu",
    "ns3148577.ip-51-91-15.eu",
    "ns3184885.ip-135-125-3.eu",
    "ns3260605.ip-51-83-122.eu",
]

# baseline profile per server: (base_cpu, base_ram, base_disk)
PROFILES = {
    "vps-188781ac.vps.ovh.net":     (25, 2.0, 10),
    "vps-3a996f60.vps.ovh.net":     (40, 4.0, 20),
    "vps-4e2e06ea.vps.ovh.net":     (60, 8.0, 50),
    "ns3007821.ip-149-202-66.eu":   (15, 16.0, 100),
    "ns3054852.ip-37-187-137.eu":   (30, 32.0, 200),
    "ns3072163.ip-217-182-138.eu":  (50, 64.0, 300),
    "ns3103176.ip-51-38-52.eu":     (20, 8.0, 80),
    "ns3148577.ip-51-91-15.eu":     (35, 4.0, 40),
    "ns3184885.ip-135-125-3.eu":    (45, 128.0, 500),
    "ns3260605.ip-51-83-122.eu":    (10, 2.0, 15),
}

# Servers that will have an anomaly spike on day 5
SPIKE_SERVERS = {"vps-4e2e06ea.vps.ovh.net", "ns3072163.ip-217-182-138.eu"}


def generate():
    init_db()
    db = SessionLocal()
    now = datetime.utcnow()

    created = 0
    for server in SERVERS:
        base_cpu, base_ram, base_disk = PROFILES[server]

        for day in range(DAYS):
            ts = now - timedelta(days=DAYS - 1 - day, hours=random.randint(0, 6))

            # Normal variation
            cpu = base_cpu + random.gauss(0, 5)
            ram = base_ram + random.gauss(0, base_ram * 0.05)
            disk = base_disk + random.gauss(0, base_disk * 0.02)

            # Inject spike on day 5 for selected servers
            if day == 4 and server in SPIKE_SERVERS:
                cpu = min(base_cpu + 50, 99)   # high CPU
                ram = base_ram * 1.4           # 40 % RAM increase

            # Clamp to valid ranges
            cpu = round(max(0.0, min(cpu, 100.0)), 2)
            ram = round(max(0.0, ram), 3)
            disk = round(max(0.0, disk), 3)

            db.add(ResourceMetric(
                cpu_usage=cpu,
                ram_usage=ram,
                disk_usage=disk,
                server_name=server,
                recorded_at=ts,
            ))
            created += 1

    db.commit()
    db.close()
    print(f"✅ Generated {created} synthetic metrics for {len(SERVERS)} servers over {DAYS} days.")


if __name__ == "__main__":
    generate()
