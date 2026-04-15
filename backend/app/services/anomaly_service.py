"""
anomaly_service.py
Threshold-based and statistical anomaly detection for resource metrics.

Works with sparse data (even 1 sample per server) by using fixed
thresholds as a fallback when z-score detection requires ≥ 2 samples.
Properly handles OVH negative CPU sentinel values.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.resource import ResourceMetric
from app.services.resource_service import decode_cpu_sentinel

logger = logging.getLogger(__name__)

# ── Thresholds ──────────────────────────────────────────────────────────────
CPU_HIGH_THRESHOLD = 85.0        # % — above this is a HIGH severity anomaly
CPU_CRITICAL_THRESHOLD = 95.0    # % — above this is CRITICAL
RAM_HIGH_RATIO = 0.90            # 90 % of max observed RAM → HIGH
DISK_HIGH_RATIO = 0.90           # 90 % of max observed Disk → HIGH
Z_SCORE_THRESHOLD = 2.0          # standard deviations for statistical detection
MIN_SAMPLES_FOR_ZSCORE = 2       # need at least 2 points for std-dev


def _severity(score: float) -> str:
    if score >= 0.8:
        return "CRITICAL"
    if score >= 0.5:
        return "HIGH"
    return "MEDIUM"


# ─────────────────────────────────────────────────────────────────────────────
# 1. Threshold-based detection (works with ≥ 1 sample)
# ─────────────────────────────────────────────────────────────────────────────
def detect_threshold_anomalies(
    metrics: List[ResourceMetric],
    ram_capacity: Optional[float] = None,
    disk_capacity: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """Detect anomalies using fixed thresholds.

    Parameters
    ----------
    metrics : list of ResourceMetric
        All metrics to evaluate (may span multiple servers).
    ram_capacity : float, optional
        Known RAM capacity (GB) for ratio-based detection.
        If None, uses the max RAM observed in the dataset.
    disk_capacity : float, optional
        Known Disk capacity (GB) for ratio-based detection.
        If None, uses the max Disk observed in the dataset.

    Returns
    -------
    list of anomaly dicts ready for API response.
    """
    anomalies: List[Dict[str, Any]] = []

    if not metrics:
        return anomalies

    # Compute fleet-wide max for ratio comparison when capacity unknown
    all_ram = [m.ram_usage for m in metrics if m.ram_usage is not None]
    all_disk = [m.disk_usage for m in metrics if m.disk_usage is not None]
    max_ram = ram_capacity or (max(all_ram) if all_ram else 256.0)
    max_disk = disk_capacity or (max(all_disk) if all_disk else 500.0)

    sentinel_count = 0

    for m in metrics:
        valid_cpu, hw_cores = decode_cpu_sentinel(m.cpu_usage)

        # ── CPU sentinel logging ────────────────────────────────────
        if hw_cores is not None:
            sentinel_count += 1
            # Skip CPU anomaly check for sentinel servers
        elif valid_cpu is not None:
            # CPU threshold check
            if valid_cpu >= CPU_CRITICAL_THRESHOLD:
                anomalies.append({
                    "server_name": m.server_name,
                    "anomaly_type": "cpu_critical",
                    "severity": "CRITICAL",
                    "description": (
                        f"CPU usage {valid_cpu:.1f}% exceeds critical "
                        f"threshold ({CPU_CRITICAL_THRESHOLD}%)"
                    ),
                    "anomaly_score": min(valid_cpu / 100.0, 1.0),
                    "metric": "cpu_usage",
                    "actual_value": valid_cpu,
                    "threshold": CPU_CRITICAL_THRESHOLD,
                    "detection_method": "threshold",
                    "recorded_at": m.recorded_at.isoformat() if m.recorded_at else None,
                })
            elif valid_cpu >= CPU_HIGH_THRESHOLD:
                anomalies.append({
                    "server_name": m.server_name,
                    "anomaly_type": "cpu_high",
                    "severity": "HIGH",
                    "description": (
                        f"CPU usage {valid_cpu:.1f}% exceeds high "
                        f"threshold ({CPU_HIGH_THRESHOLD}%)"
                    ),
                    "anomaly_score": valid_cpu / 100.0,
                    "metric": "cpu_usage",
                    "actual_value": valid_cpu,
                    "threshold": CPU_HIGH_THRESHOLD,
                    "detection_method": "threshold",
                    "recorded_at": m.recorded_at.isoformat() if m.recorded_at else None,
                })

        # ── RAM threshold check ─────────────────────────────────────
        if m.ram_usage is not None and max_ram > 0:
            ram_ratio = m.ram_usage / max_ram
            if ram_ratio >= RAM_HIGH_RATIO:
                score = min(ram_ratio, 1.0)
                anomalies.append({
                    "server_name": m.server_name,
                    "anomaly_type": "ram_high",
                    "severity": _severity(score),
                    "description": (
                        f"RAM usage {m.ram_usage:.1f} GB is "
                        f"{ram_ratio * 100:.0f}% of capacity ({max_ram:.0f} GB)"
                    ),
                    "anomaly_score": score,
                    "metric": "ram_usage",
                    "actual_value": m.ram_usage,
                    "threshold": max_ram * RAM_HIGH_RATIO,
                    "detection_method": "threshold",
                    "recorded_at": m.recorded_at.isoformat() if m.recorded_at else None,
                })

        # ── Disk threshold check ────────────────────────────────────
        if m.disk_usage is not None and max_disk > 0:
            disk_ratio = m.disk_usage / max_disk
            if disk_ratio >= DISK_HIGH_RATIO:
                score = min(disk_ratio, 1.0)
                anomalies.append({
                    "server_name": m.server_name,
                    "anomaly_type": "disk_high",
                    "severity": _severity(score),
                    "description": (
                        f"Disk usage {m.disk_usage:.1f} GB is "
                        f"{disk_ratio * 100:.0f}% of capacity ({max_disk:.0f} GB)"
                    ),
                    "anomaly_score": score,
                    "metric": "disk_usage",
                    "actual_value": m.disk_usage,
                    "threshold": max_disk * DISK_HIGH_RATIO,
                    "detection_method": "threshold",
                    "recorded_at": m.recorded_at.isoformat() if m.recorded_at else None,
                })

    if sentinel_count:
        logger.warning(
            "⚠️ %d metric(s) have negative CPU (OVH sentinel). "
            "CPU anomaly detection skipped for these servers.",
            sentinel_count,
        )

    return anomalies


# ─────────────────────────────────────────────────────────────────────────────
# 2. Statistical z-score detection (requires ≥ 2 samples per server)
# ─────────────────────────────────────────────────────────────────────────────
def detect_statistical_anomalies(
    db: Session,
    server_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Detect anomalies using z-score per server.

    Groups metrics by server and computes z-scores for CPU, RAM, and Disk.
    Servers with < MIN_SAMPLES_FOR_ZSCORE are skipped (use threshold instead).
    """
    anomalies: List[Dict[str, Any]] = []

    query = db.query(ResourceMetric)
    if server_name:
        query = query.filter(ResourceMetric.server_name == server_name)

    all_metrics = query.order_by(ResourceMetric.server_name).all()
    if not all_metrics:
        return anomalies

    # Group by server
    servers: Dict[str, List[ResourceMetric]] = {}
    for m in all_metrics:
        servers.setdefault(m.server_name or "unknown", []).append(m)

    for srv, metrics in servers.items():
        if len(metrics) < MIN_SAMPLES_FOR_ZSCORE:
            logger.debug(
                "Server '%s' has only %d sample(s) — skipping z-score",
                srv, len(metrics),
            )
            continue

        # Collect valid CPU values (skip sentinels)
        cpu_vals = []
        for m in metrics:
            valid_cpu, _ = decode_cpu_sentinel(m.cpu_usage)
            if valid_cpu is not None:
                cpu_vals.append(valid_cpu)

        ram_vals = [m.ram_usage for m in metrics if m.ram_usage is not None]
        disk_vals = [m.disk_usage for m in metrics if m.disk_usage is not None]

        for metric_name, values, unit in [
            ("cpu_usage", cpu_vals, "%"),
            ("ram_usage", ram_vals, "GB"),
            ("disk_usage", disk_vals, "GB"),
        ]:
            if len(values) < MIN_SAMPLES_FOR_ZSCORE:
                continue

            arr = np.array(values, dtype=float)
            mean = np.mean(arr)
            std = np.std(arr, ddof=1)  # sample std-dev

            if std == 0:
                continue  # all values identical — no anomaly

            for i, val in enumerate(values):
                z = abs(val - mean) / std
                if z >= Z_SCORE_THRESHOLD:
                    score = min(z / 4.0, 1.0)  # normalize to 0-1
                    anomalies.append({
                        "server_name": srv,
                        "anomaly_type": f"{metric_name}_zscore",
                        "severity": _severity(score),
                        "description": (
                            f"{metric_name} value {val:.1f}{unit} deviates "
                            f"{z:.1f}σ from mean {mean:.1f}{unit} "
                            f"(std={std:.2f})"
                        ),
                        "anomaly_score": round(score, 3),
                        "metric": metric_name,
                        "actual_value": val,
                        "expected_value": round(mean, 2),
                        "z_score": round(z, 2),
                        "detection_method": "statistical",
                        "recorded_at": (
                            metrics[i].recorded_at.isoformat()
                            if metrics[i].recorded_at else None
                        ),
                    })

    return anomalies


# ─────────────────────────────────────────────────────────────────────────────
# 3. Combined detection
# ─────────────────────────────────────────────────────────────────────────────
def detect_all_anomalies(
    db: Session,
    server_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Run all detection methods and return a combined result.

    Returns
    -------
    dict with keys:
        anomalies       : list of anomaly dicts
        total           : total anomaly count
        by_severity     : {CRITICAL: n, HIGH: n, MEDIUM: n}
        sentinel_servers: number of servers with negative CPU
        methods_used    : list of detection methods applied
    """
    query = db.query(ResourceMetric)
    if server_name:
        query = query.filter(ResourceMetric.server_name == server_name)
    all_metrics = query.all()

    # Count sentinel servers
    sentinel_servers = sum(
        1 for m in all_metrics if m.cpu_usage is not None and m.cpu_usage < 0
    )

    methods_used = []

    # 1. Threshold detection (always runs, works with 1+ samples)
    threshold_anomalies = detect_threshold_anomalies(all_metrics)
    methods_used.append("threshold")

    # 2. Statistical detection (runs when servers have ≥ 2 samples)
    stat_anomalies = detect_statistical_anomalies(db, server_name)
    if stat_anomalies:
        methods_used.append("statistical")

    # Merge and deduplicate (prefer higher-severity)
    combined = threshold_anomalies + stat_anomalies
    deduped = _deduplicate(combined)

    by_severity = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0}
    for a in deduped:
        sev = a.get("severity", "MEDIUM")
        by_severity[sev] = by_severity.get(sev, 0) + 1

    return {
        "anomalies": deduped,
        "total": len(deduped),
        "by_severity": by_severity,
        "sentinel_servers": sentinel_servers,
        "total_servers": len(set(m.server_name for m in all_metrics if m.server_name)),
        "methods_used": methods_used,
    }


def _deduplicate(anomalies: List[Dict]) -> List[Dict]:
    """Remove duplicate anomalies for the same server+metric, keeping the
    highest severity."""
    severity_order = {"CRITICAL": 3, "HIGH": 2, "MEDIUM": 1}
    best: Dict[str, Dict] = {}
    for a in anomalies:
        key = f"{a.get('server_name')}:{a.get('metric')}:{a.get('recorded_at')}"
        existing = best.get(key)
        if not existing or severity_order.get(
            a.get("severity"), 0
        ) > severity_order.get(existing.get("severity"), 0):
            best[key] = a
    return list(best.values())
