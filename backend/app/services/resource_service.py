from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List, Tuple
from datetime import datetime
import logging

from app.models.resource import ResourceMetric
from app.schemas.resource import ResourceMetricCreate

logger = logging.getLogger(__name__)


def decode_cpu_sentinel(cpu_value: float) -> Tuple[Optional[float], Optional[int]]:
    """Decode OVH negative CPU sentinel values.

    OVH returns negative CPU values when RTM is unavailable.
    The absolute value represents the hardware core count, not CPU usage %.

    Returns:
        (valid_cpu_pct, hw_core_count):
        - If cpu_value >= 0: (cpu_value, None)  → valid usage percentage
        - If cpu_value < 0:  (None, abs(value))  → sentinel; core count stored
    """
    if cpu_value is None:
        return None, None
    if cpu_value < 0:
        return None, abs(int(cpu_value))
    return cpu_value, None


def create_resource_metric(db: Session, data: ResourceMetricCreate) -> ResourceMetric:
    """Create a new resource usage metric entry."""
    metric = ResourceMetric(
        cpu_usage=data.cpu_usage,
        ram_usage=data.ram_usage,
        disk_usage=data.disk_usage,
        server_name=data.server_name,
        recorded_at=data.recorded_at or datetime.utcnow(),
    )
    db.add(metric)
    db.commit()
    db.refresh(metric)
    return metric


def get_resource_metrics(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    server_name: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
) -> tuple[int, List[ResourceMetric]]:
    """List resource metrics with optional filtering."""
    query = db.query(ResourceMetric)

    if server_name:
        query = query.filter(ResourceMetric.server_name == server_name)
    if from_date:
        query = query.filter(ResourceMetric.recorded_at >= from_date)
    if to_date:
        query = query.filter(ResourceMetric.recorded_at <= to_date)

    total = query.count()
    items = query.order_by(ResourceMetric.recorded_at.desc()).offset(skip).limit(limit).all()
    return total, items


def get_resource_metric_by_id(db: Session, metric_id: int) -> Optional[ResourceMetric]:
    """Get a single resource metric by its ID."""
    return db.query(ResourceMetric).filter(ResourceMetric.id == metric_id).first()


def get_average_stats(
    db: Session,
    server_name: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
) -> dict:
    """Calculate average CPU, RAM, and Disk usage.

    Negative CPU sentinel values (OVH RTM unavailable) are excluded
    from the CPU average but counted in total_records.
    """
    base_filter = db.query(ResourceMetric)
    if server_name:
        base_filter = base_filter.filter(ResourceMetric.server_name == server_name)
    if from_date:
        base_filter = base_filter.filter(ResourceMetric.recorded_at >= from_date)
    if to_date:
        base_filter = base_filter.filter(ResourceMetric.recorded_at <= to_date)

    # Total count includes all records
    total = base_filter.count()

    # CPU average: only valid (>= 0) values
    cpu_result = base_filter.filter(ResourceMetric.cpu_usage >= 0).with_entities(
        func.avg(ResourceMetric.cpu_usage)
    ).scalar()

    # RAM and Disk averages: all records
    ram_disk = base_filter.with_entities(
        func.avg(ResourceMetric.ram_usage),
        func.avg(ResourceMetric.disk_usage),
    ).one()

    return {
        "avg_cpu_usage": round(cpu_result or 0.0, 2),
        "avg_ram_usage": round(ram_disk[0] or 0.0, 3),
        "avg_disk_usage": round(ram_disk[1] or 0.0, 3),
        "total_records": total,
    }


def get_peak_stats(
    db: Session,
    server_name: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
) -> dict:
    """Find peak (max) values for CPU, RAM, and Disk usage.

    Negative CPU sentinel values are excluded from peak CPU calculation.
    """
    base_query = db.query(ResourceMetric)

    if server_name:
        base_query = base_query.filter(ResourceMetric.server_name == server_name)
    if from_date:
        base_query = base_query.filter(ResourceMetric.recorded_at >= from_date)
    if to_date:
        base_query = base_query.filter(ResourceMetric.recorded_at <= to_date)

    # Peak CPU — only valid (>= 0) values
    peak_cpu_record = (
        base_query.filter(ResourceMetric.cpu_usage >= 0)
        .order_by(ResourceMetric.cpu_usage.desc())
        .first()
    )
    # Peak RAM
    peak_ram_record = base_query.order_by(ResourceMetric.ram_usage.desc()).first()
    # Peak Disk
    peak_disk_record = base_query.order_by(ResourceMetric.disk_usage.desc()).first()

    return {
        "peak_cpu_usage": peak_cpu_record.cpu_usage if peak_cpu_record else 0.0,
        "peak_cpu_server": peak_cpu_record.server_name if peak_cpu_record else None,
        "peak_cpu_recorded_at": peak_cpu_record.recorded_at if peak_cpu_record else None,

        "peak_ram_usage": peak_ram_record.ram_usage if peak_ram_record else 0.0,
        "peak_ram_server": peak_ram_record.server_name if peak_ram_record else None,
        "peak_ram_recorded_at": peak_ram_record.recorded_at if peak_ram_record else None,

        "peak_disk_usage": peak_disk_record.disk_usage if peak_disk_record else 0.0,
        "peak_disk_server": peak_disk_record.server_name if peak_disk_record else None,
        "peak_disk_recorded_at": peak_disk_record.recorded_at if peak_disk_record else None,
    }