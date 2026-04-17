from datetime import datetime, timezone, date
from calendar import monthrange

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.schemas.base import Base
import app.schemas.file  # noqa: F401 (required for FK metadata)
import app.schemas.user  # noqa: F401 (required for FK metadata)
from app.models.cost import CostRecord
from app.services.ml_anomaly_service import (
    aggregate_by_ref_id,
    aggregate_by_service,
    calculate_expected_cost,
    compute_mom_per_ref,
    compute_mom_per_service,
)


def _month_windows(today: date):
    cur_start = today.replace(day=1)
    cur_day = today.replace(day=min(today.day, 15))
    if cur_start.month == 1:
        prev_year, prev_month = cur_start.year - 1, 12
    else:
        prev_year, prev_month = cur_start.year, cur_start.month - 1
    prev_day = date(prev_year, prev_month, min(15, monthrange(prev_year, prev_month)[1]))
    return cur_start, cur_day, prev_day


def _seed_cost_data(db):
    today = datetime.now(timezone.utc).date()
    _, cur_day, prev_day = _month_windows(today)
    db.add_all(
        [
            CostRecord(cost_date=cur_day, service_name="Abonnement/Srv1", amount=50.0, reference="ns1234.ip-1.eu"),
            CostRecord(cost_date=cur_day, service_name="Abonnement/Srv1", amount=75.0, reference="ns5678.ip-2.eu"),
            CostRecord(cost_date=cur_day, service_name="Abonnement/Srv2", amount=100.0, reference="ns9012.ip-3.eu"),
            CostRecord(cost_date=prev_day, service_name="Abonnement/Srv1", amount=40.0, reference="ns1234.ip-1.eu"),
            CostRecord(cost_date=prev_day, service_name="Abonnement/Srv1", amount=70.0, reference="ns5678.ip-2.eu"),
            CostRecord(cost_date=prev_day, service_name="Abonnement/Srv2", amount=100.0, reference="ns9012.ip-3.eu"),
        ]
    )
    db.commit()
    return today


def _build_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_ref_and_service_aggregation_are_distinct():
    db = _build_session()
    today = _seed_cost_data(db)
    cur_start = today.replace(day=1)

    by_ref = aggregate_by_ref_id(db, (cur_start, today))
    by_service = aggregate_by_service(db, (cur_start, today))

    assert sorted(by_ref.keys()) == ["ns1234.ip-1.eu", "ns5678.ip-2.eu", "ns9012.ip-3.eu"]
    assert sorted(by_service.keys()) == ["Abonnement/Srv1", "Abonnement/Srv2"]
    assert sum(v for _, v in by_service["Abonnement/Srv1"]) == 125.0
    assert sum(v for _, v in by_service["Abonnement/Srv2"]) == 100.0

    mom_ref = compute_mom_per_ref(db, verbose=False)
    mom_service = compute_mom_per_service(db, verbose=False)
    assert "ns1234.ip-1.eu" in mom_ref
    assert "Abonnement/Srv1" in mom_service
    assert mom_ref["ns1234.ip-1.eu"]["current_cost"] == 50.0
    assert mom_service["Abonnement/Srv1"]["current_cost"] == 125.0


def test_expected_cost_uses_median_peer_baseline():
    ref_expected = calculate_expected_cost(75.0, [50.0, 75.0, 100.0])
    service_expected = calculate_expected_cost(125.0, [125.0, 100.0])

    assert ref_expected == 75.0
    assert service_expected == 112.5
