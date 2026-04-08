from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List
from datetime import datetime

from app.models.resource import ResourceMetric
from app.schemas.resource import ResourceMetricCreate


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


def save_ovh_resource_metrics(
    db: Session,
    raw_resources: List[dict],
) -> dict:
    """
    Persist a list of raw OVHcloud resource records (as returned by
    OVHResourceFetcher.fetch_resources) to the ResourceMetric table.

    Returns a summary dict with keys:
        metrics_created, metrics_skipped, errors, imported_at
    """
    metrics_created = 0
    metrics_skipped = 0
    errors: List[str] = []

    for i, record in enumerate(raw_resources):
        try:
            recorded_at = None
            raw_ts = record.get("recorded_at")
            if raw_ts:
                try:
                    recorded_at = datetime.fromisoformat(raw_ts)
                except (ValueError, TypeError):
                    recorded_at = datetime.utcnow()

            metric_data = ResourceMetricCreate(
                cpu_usage   = float(record.get("cpu_usage",  0) or 0),
                ram_usage   = float(record.get("ram_usage",  0) or 0),
                disk_usage  = float(record.get("disk_usage", 0) or 0),
                server_name = record.get("server_name"),
                recorded_at = recorded_at,
            )
            create_resource_metric(db, metric_data)
            metrics_created += 1

        except Exception as e:
            metrics_skipped += 1
            errors.append(f"Record {i + 1} ({record.get('server_name', '?')}): {str(e)}")

    return {
        "metrics_created": metrics_created,
        "metrics_skipped": metrics_skipped,
        "total_fetched":   len(raw_resources),
        "errors":          errors[:10],
        "imported_at":     datetime.utcnow().isoformat(),
    }


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
    """Calculate average CPU, RAM, and Disk usage."""
    query = db.query(
        func.avg(ResourceMetric.cpu_usage).label("avg_cpu"),
        func.avg(ResourceMetric.ram_usage).label("avg_ram"),
        func.avg(ResourceMetric.disk_usage).label("avg_disk"),
        func.count(ResourceMetric.id).label("total"),
    )

    if server_name:
        query = query.filter(ResourceMetric.server_name == server_name)
    if from_date:
        query = query.filter(ResourceMetric.recorded_at >= from_date)
    if to_date:
        query = query.filter(ResourceMetric.recorded_at <= to_date)

    result = query.one()

    return {
        "avg_cpu_usage": round(result.avg_cpu or 0.0, 2),
        "avg_ram_usage": round(result.avg_ram or 0.0, 3),
        "avg_disk_usage": round(result.avg_disk or 0.0, 3),
        "total_records": result.total or 0,
    }


def get_peak_stats(
    db: Session,
    server_name: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
) -> dict:
    """Find peak (max) values for CPU, RAM, and Disk usage."""
    base_query = db.query(ResourceMetric)

    if server_name:
        base_query = base_query.filter(ResourceMetric.server_name == server_name)
    if from_date:
        base_query = base_query.filter(ResourceMetric.recorded_at >= from_date)
    if to_date:
        base_query = base_query.filter(ResourceMetric.recorded_at <= to_date)

    # Peak CPU
    peak_cpu_record = base_query.order_by(ResourceMetric.cpu_usage.desc()).first()
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