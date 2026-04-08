from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
import logging

from app.database import get_db
from app.schemas.resource import ResourceMetric
from app.models.resource import (
    ResourceMetricResponse,
    ImportOVHMetricsRequest,
    ImportOVHMetricsResponse,
)
from app.dependencies import get_current_user
from app.schemas.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/resources", tags=["resources"])


@router.post("/import-ovh-metrics", response_model=ImportOVHMetricsResponse)
def import_ovh_metrics(
    credentials: ImportOVHMetricsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Fetch real CPU, RAM, Disk metrics from OVHcloud for all VPS and Dedicated servers,
    then store them in the ResourceMetric table.
    """
    from app.services.ovh_resource_fetcher import OVHResourceFetcher

    try:
        fetcher = OVHResourceFetcher(
            app_key=credentials.app_key,
            app_secret=credentials.app_secret,
            consumer_key=credentials.consumer_key,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OVH authentication error: {str(e)}")

    try:
        raw_metrics = fetcher.fetch_all_metrics()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OVH API fetch error: {str(e)}")

    errors: List[str] = []
    created = 0
    servers: List[str] = []
    now = datetime.utcnow()

    for m in raw_metrics:
        try:
            metric = ResourceMetric(
                server_name=m["server_name"],
                server_type=m["server_type"],
                cpu_usage=m.get("cpu_usage"),
                ram_usage=m.get("ram_usage"),
                disk_usage=m.get("disk_usage"),
                recorded_at=now,
                user_id=current_user.id,
            )
            db.add(metric)
            servers.append(m["server_name"])
            created += 1
        except Exception as e:
            errors.append(f"{m.get('server_name', '?')}: {str(e)}")

    if created > 0:
        db.commit()

    return ImportOVHMetricsResponse(
        total_servers=len(raw_metrics),
        metrics_created=created,
        servers=servers,
        errors=errors,
    )


@router.get("/metrics", response_model=List[ResourceMetricResponse])
def list_metrics(
    server_name: Optional[str] = Query(None),
    server_type: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List stored resource metrics, optionally filtered by server name or type."""
    query = db.query(ResourceMetric)
    if server_name:
        query = query.filter(ResourceMetric.server_name.ilike(f"%{server_name}%"))
    if server_type:
        query = query.filter(ResourceMetric.server_type == server_type)
    return query.order_by(ResourceMetric.recorded_at.desc()).offset(skip).limit(limit).all()


@router.get("/metrics/latest", response_model=List[ResourceMetricResponse])
def get_latest_metrics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return the most recent metric record for each server.
    Uses a subquery to get the latest recorded_at per server_name.
    """
    from sqlalchemy import func

    # Subquery: max recorded_at per server_name
    subq = (
        db.query(
            ResourceMetric.server_name,
            func.max(ResourceMetric.recorded_at).label("max_ts"),
        )
        .group_by(ResourceMetric.server_name)
        .subquery()
    )

    results = (
        db.query(ResourceMetric)
        .join(
            subq,
            (ResourceMetric.server_name == subq.c.server_name)
            & (ResourceMetric.recorded_at == subq.c.max_ts),
        )
        .order_by(ResourceMetric.server_type, ResourceMetric.server_name)
        .all()
    )
    return results


@router.get("/metrics/history/{server_name}", response_model=List[ResourceMetricResponse])
def get_server_history(
    server_name: str,
    days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return historical metrics for a specific server over the last N days."""
    since = datetime.utcnow() - timedelta(days=days)
    results = (
        db.query(ResourceMetric)
        .filter(
            ResourceMetric.server_name == server_name,
            ResourceMetric.recorded_at >= since,
        )
        .order_by(ResourceMetric.recorded_at.asc())
        .all()
    )
    return results
