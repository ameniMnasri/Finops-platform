"""
anomaly_service.py — Statistical anomaly detection
══════════════════════════════════════════════════════════════
FIXES APPLIED:
  1. cutoff window extended: now fetches window_days * 4 of history
     (was *2, silently returned nothing if data was > 60 days old)
  2. Cost detection: cutoff comparison now uses date objects correctly,
     and falls back to full-table scan when no recent data is found
  3. detected_at for cost anomalies: now produces a timezone-aware datetime
     instead of a naive one (was causing silent DB write failures with
     DateTime(timezone=True) columns)
  4. Minimum baseline lowered to 2 points (was 3) so sparse cost data
     (weekly/bi-weekly records) still gets analysed
  5. Resource detection: same cutoff & min-baseline fixes applied
  6. get_anomaly_summary: now counts resource_high correctly using all
     HIGH_CPU / HIGH_RAM / HIGH_DISK / RESOURCE_SPIKE types
"""
from __future__ import annotations

import logging
import statistics
from datetime import datetime, timedelta, timezone, date
from typing import List, Optional, Dict, Tuple

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.anomaly  import Anomaly, AnomalyType, AnomalySeverity, AnomalyMethod
from app.models.cost     import CostRecord
from app.models.resource import ResourceMetric

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _severity_from_z(z: float) -> AnomalySeverity:
    az = abs(z)
    if az >= 4.0:
        return AnomalySeverity.CRITICAL
    if az >= 3.0:
        return AnomalySeverity.HIGH
    if az >= 2.0:
        return AnomalySeverity.MEDIUM
    return AnomalySeverity.LOW


def _moving_stats(values: List[float]) -> Tuple[float, float]:
    if not values:
        return 0.0, 0.0
    mean = statistics.mean(values)
    std  = statistics.pstdev(values) if len(values) >= 2 else 0.0
    return mean, std


def _utcnow() -> datetime:
    """Timezone-aware UTC now (avoids Python 3.12 deprecation of utcnow)."""
    return datetime.now(timezone.utc)


# ─────────────────────────────────────────────────────────────────────────────
# COST ANOMALY DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def detect_cost_anomalies(
    db:             Session,
    window_days:    int   = 30,
    z_threshold:    float = 2.5,
    service_filter: Optional[str] = None,
    save:           bool  = True,
) -> List[Anomaly]:
    """
    Detect abnormal cost spikes per service using moving average + dynamic threshold.

    FIX 1: History window is now window_days * 4 (was *2) so older datasets
            are included in the baseline.
    FIX 2: Falls back to full history if the windowed query returns nothing.
    FIX 3: detected_at is now timezone-aware.
    FIX 4: Minimum baseline reduced to 2 points.
    """
    logger.info(
        f"🔍 [Statistical] Cost anomaly detection | window={window_days}d z≥{z_threshold}"
    )

    # ── FIX 1: use 4× multiplier so we always get enough baseline history ────
    cutoff_dt = _utcnow() - timedelta(days=window_days * 4)
    cutoff_date: date = cutoff_dt.date()

    query = (
        db.query(
            CostRecord.cost_date,
            CostRecord.service_name,
            func.sum(CostRecord.amount).label("daily_total"),
        )
        .filter(CostRecord.cost_date >= cutoff_date)
    )
    if service_filter:
        query = query.filter(CostRecord.service_name.ilike(f"%{service_filter}%"))

    query = query.group_by(CostRecord.cost_date, CostRecord.service_name).order_by(
        CostRecord.service_name, CostRecord.cost_date
    )

    rows = query.all()

    # ── FIX 2: if still empty, try without any date filter ───────────────────
    if not rows:
        logger.warning(
            f"⚠️  No cost data found since {cutoff_date} — retrying without date filter"
        )
        fallback_query = (
            db.query(
                CostRecord.cost_date,
                CostRecord.service_name,
                func.sum(CostRecord.amount).label("daily_total"),
            )
            .group_by(CostRecord.cost_date, CostRecord.service_name)
            .order_by(CostRecord.service_name, CostRecord.cost_date)
        )
        if service_filter:
            fallback_query = fallback_query.filter(
                CostRecord.service_name.ilike(f"%{service_filter}%")
            )
        rows = fallback_query.all()

    if not rows:
        logger.info("ℹ️ No cost data found for anomaly detection (table empty?)")
        return []

    logger.info(f"📊 Loaded {len(rows)} cost rows across services")

    # Group by service
    by_service: Dict[str, List[Tuple]] = {}
    for r in rows:
        by_service.setdefault(r.service_name, []).append((r.cost_date, float(r.daily_total)))

    detected: List[Anomaly] = []

    for service, series in by_service.items():
        series.sort(key=lambda x: x[0])

        for i, (day, cost) in enumerate(series):
            baseline_start = max(0, i - window_days)
            baseline_vals  = [v for _, v in series[baseline_start:i]]

            # ── FIX 4: lowered minimum baseline from 3 → 2 ───────────────────
            if len(baseline_vals) < 2:
                continue

            mean, std = _moving_stats(baseline_vals)
            if std == 0:
                continue

            z = (cost - mean) / std

            if z > z_threshold:
                severity = _severity_from_z(z)
                description = (
                    f"Coût journalier de {cost:.2f} € pour '{service}' "
                    f"dépasse la moyenne mobile de {mean:.2f} € "
                    f"(σ={std:.2f}, z={z:.2f})"
                )

                # ── FIX 3: produce a timezone-aware datetime ─────────────────
                if isinstance(day, date) and not isinstance(day, datetime):
                    detected_at = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
                elif isinstance(day, datetime) and day.tzinfo is None:
                    detected_at = day.replace(tzinfo=timezone.utc)
                else:
                    detected_at = day

                anomaly = Anomaly(
                    entity_type     = "cost_service",
                    entity_name     = service,
                    anomaly_type    = AnomalyType.COST_SPIKE,
                    severity        = severity,
                    method          = AnomalyMethod.STATISTICAL,
                    observed_value  = cost,
                    expected_value  = mean,
                    std_dev         = std,
                    z_score         = z,
                    threshold_value = mean + z_threshold * std,
                    threshold_type  = f"mean+{z_threshold}std",
                    detected_at     = detected_at,
                    description     = description,
                    unit            = "€",
                )
                detected.append(anomaly)
                logger.warning(
                    f"⚠️  Cost anomaly: {service} | {day} | {cost:.2f}€ z={z:.2f} [{severity}]"
                )

    if save and detected:
        db.add_all(detected)
        db.commit()
        for a in detected:
            db.refresh(a)
        logger.info(f"✅ {len(detected)} cost anomalies saved to DB")
    else:
        logger.info(f"ℹ️ {len(detected)} cost anomalies detected (save={save})")

    return detected


# ─────────────────────────────────────────────────────────────────────────────
# RESOURCE ANOMALY DETECTION
# ─────────────────────────────────────────────────────────────────────────────

_METRIC_CONFIG = {
    "cpu_usage":  {"type": AnomalyType.HIGH_CPU,  "unit": "%",  "label": "CPU"},
    "ram_usage":  {"type": AnomalyType.HIGH_RAM,  "unit": "GB", "label": "RAM"},
    "disk_usage": {"type": AnomalyType.HIGH_DISK, "unit": "GB", "label": "Disk"},
}


def detect_resource_anomalies(
    db:            Session,
    window_days:   int   = 30,
    z_threshold:   float = 2.5,
    server_filter: Optional[str] = None,
    metrics:       List[str] = None,
    save:          bool  = True,
) -> List[Anomaly]:
    """
    Detect CPU / RAM / Disk over-consumption using rolling z-score.

    FIX 1: History window extended to window_days * 4.
    FIX 2: Falls back to full history if windowed query is empty.
    FIX 4: Minimum baseline reduced to 2 points.
    """
    if metrics is None:
        metrics = ["cpu_usage", "ram_usage", "disk_usage"]

    logger.info(
        f"🔍 [Statistical] Resource anomaly detection | "
        f"window={window_days}d z≥{z_threshold} metrics={metrics}"
    )

    # ── FIX 1: extended window ────────────────────────────────────────────────
    cutoff = _utcnow() - timedelta(days=window_days * 4)

    query = db.query(ResourceMetric).filter(ResourceMetric.recorded_at >= cutoff)
    if server_filter:
        query = query.filter(ResourceMetric.server_name.ilike(f"%{server_filter}%"))

    all_metrics = query.order_by(
        ResourceMetric.server_name, ResourceMetric.recorded_at
    ).all()

    # ── FIX 2: fallback to full history ──────────────────────────────────────
    if not all_metrics:
        logger.warning(
            f"⚠️  No resource metrics since {cutoff.date()} — retrying without date filter"
        )
        fallback_q = db.query(ResourceMetric)
        if server_filter:
            fallback_q = fallback_q.filter(
                ResourceMetric.server_name.ilike(f"%{server_filter}%")
            )
        all_metrics = fallback_q.order_by(
            ResourceMetric.server_name, ResourceMetric.recorded_at
        ).all()

    if not all_metrics:
        logger.info("ℹ️ No resource metrics found (table empty?)")
        return []

    logger.info(f"📊 Loaded {len(all_metrics)} resource metric rows")

    # Group by server
    by_server: Dict[str, List[ResourceMetric]] = {}
    for m in all_metrics:
        by_server.setdefault(m.server_name, []).append(m)

    detected: List[Anomaly] = []

    for server, records in by_server.items():
        records.sort(key=lambda r: r.recorded_at)

        for metric_key in metrics:
            cfg = _METRIC_CONFIG.get(metric_key)
            if not cfg:
                continue

            series = [
                (r.recorded_at, getattr(r, metric_key))
                for r in records
                if getattr(r, metric_key) is not None and getattr(r, metric_key) >= 0
            ]

            if len(series) < 3:
                continue

            for i, (ts, val) in enumerate(series):
                baseline_start = max(0, i - window_days)
                baseline_vals  = [v for _, v in series[baseline_start:i]]

                # ── FIX 4: minimum baseline 2 instead of 3 ───────────────────
                if len(baseline_vals) < 2:
                    continue

                mean, std = _moving_stats(baseline_vals)
                if std == 0:
                    continue

                z = (val - mean) / std

                if z > z_threshold:
                    severity = _severity_from_z(z)

                    # Ensure timezone-aware detected_at
                    if isinstance(ts, datetime) and ts.tzinfo is None:
                        ts_aware = ts.replace(tzinfo=timezone.utc)
                    else:
                        ts_aware = ts

                    description = (
                        f"Serveur '{server}' — {cfg['label']} à {val:.2f}{cfg['unit']} "
                        f"dépasse la moyenne mobile {mean:.2f}{cfg['unit']} "
                        f"(σ={std:.2f}, z={z:.2f})"
                    )
                    anomaly = Anomaly(
                        entity_type     = "server",
                        entity_name     = server,
                        anomaly_type    = cfg["type"],
                        severity        = severity,
                        method          = AnomalyMethod.STATISTICAL,
                        observed_value  = val,
                        expected_value  = mean,
                        std_dev         = std,
                        z_score         = z,
                        threshold_value = mean + z_threshold * std,
                        threshold_type  = f"mean+{z_threshold}std",
                        detected_at     = ts_aware,
                        description     = description,
                        unit            = cfg["unit"],
                    )
                    detected.append(anomaly)
                    logger.warning(
                        f"⚠️  Resource anomaly: {server} | "
                        f"{metric_key}={val:.2f} z={z:.2f} [{severity}]"
                    )

    if save and detected:
        db.add_all(detected)
        db.commit()
        for a in detected:
            db.refresh(a)
        logger.info(f"✅ {len(detected)} resource anomalies saved to DB")
    else:
        logger.info(f"ℹ️ {len(detected)} resource anomalies detected (save={save})")

    return detected


# ─────────────────────────────────────────────────────────────────────────────
# DB QUERY HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def get_anomalies(
    db:              Session,
    skip:            int  = 0,
    limit:           int  = 100,
    entity_filter:   Optional[str] = None,
    anomaly_type:    Optional[AnomalyType] = None,
    severity_filter: Optional[AnomalySeverity] = None,
    method_filter:   Optional[AnomalyMethod] = None,
    since_days:      Optional[int] = None,
) -> List[Anomaly]:
    q = db.query(Anomaly)
    if entity_filter:
        q = q.filter(Anomaly.entity_name.ilike(f"%{entity_filter}%"))
    if anomaly_type:
        q = q.filter(Anomaly.anomaly_type == anomaly_type)
    if severity_filter:
        q = q.filter(Anomaly.severity == severity_filter)
    if method_filter:
        q = q.filter(Anomaly.method == method_filter)
    if since_days:
        cutoff = _utcnow() - timedelta(days=since_days)
        q = q.filter(Anomaly.detected_at >= cutoff)
    return q.order_by(Anomaly.detected_at.desc()).offset(skip).limit(limit).all()


def get_anomaly_summary(db: Session) -> dict:
    rows = db.query(Anomaly).all()
    resource_types = {
        AnomalyType.HIGH_CPU,
        AnomalyType.HIGH_RAM,
        AnomalyType.HIGH_DISK,
        AnomalyType.RESOURCE_SPIKE,
    }
    latest = max((a.detected_at for a in rows), default=None)
    return {
        "total":         len(rows),
        "critical":      sum(1 for a in rows if a.severity == AnomalySeverity.CRITICAL),
        "high":          sum(1 for a in rows if a.severity == AnomalySeverity.HIGH),
        "medium":        sum(1 for a in rows if a.severity == AnomalySeverity.MEDIUM),
        "low":           sum(1 for a in rows if a.severity == AnomalySeverity.LOW),
        "cost_spikes":   sum(1 for a in rows if a.anomaly_type == AnomalyType.COST_SPIKE),
        "resource_high": sum(1 for a in rows if a.anomaly_type in resource_types),
        "latest_at":     latest,
    }