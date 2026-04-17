"""
ml_anomaly_service.py
Machine-learning-based anomaly detection using Isolation Forest.

Improvements over a naive implementation:
- StandardScaler normalises CPU %, RAM GB, and Disk GB to the same scale.
- Low contamination (0.01) avoids over-flagging in sparse datasets.
- Hybrid approach: threshold rules for servers with < 5 samples,
  Isolation Forest for data-rich servers (≥ 5 samples).
- OVH negative CPU sentinel values are excluded from the feature matrix.
- Anomaly-score confidence is mapped to severity levels.
"""

import logging
from collections import defaultdict
from datetime import date, datetime
from statistics import mean, median
from typing import Any, Dict, List, Optional

import numpy as np
from sqlalchemy.orm import Session

from app.models.cost import CostRecord
from app.models.resource import ResourceMetric
from app.services.resource_service import decode_cpu_sentinel
from app.services.anomaly_service import detect_threshold_anomalies

logger = logging.getLogger(__name__)

MIN_SAMPLES_FOR_ML = 5
CONTAMINATION = 0.01  # 1 % expected anomaly rate
MIN_COST_SAMPLES_FOR_IF = 8


def _month_key(value: Any) -> Optional[str]:
    """Return YYYY-MM for date-like values."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return f"{value.year:04d}-{value.month:02d}"
    if isinstance(value, date):
        return f"{value.year:04d}-{value.month:02d}"
    try:
        parsed = datetime.fromisoformat(str(value))
        return f"{parsed.year:04d}-{parsed.month:02d}"
    except Exception:
        return None


def _previous_month(month_key: str) -> str:
    year, month = [int(x) for x in month_key.split("-")]
    if month == 1:
        return f"{year - 1:04d}-12"
    return f"{year:04d}-{month - 1:02d}"


def _safe_variation_pct(current: float, previous: float) -> Optional[float]:
    if previous <= 0:
        return None
    return ((current - previous) / previous) * 100.0


def _build_if_samples(
    monthly_by_entity: Dict[str, Dict[str, float]]
) -> List[Dict[str, Any]]:
    """Build feature rows with consistent IF features: cost, trend, volatility."""
    samples: List[Dict[str, Any]] = []
    for entity, month_map in monthly_by_entity.items():
        ordered = sorted(month_map.items(), key=lambda x: x[0])
        history: List[float] = []
        prev_cost = 0.0
        for month, cost in ordered:
            trend = cost - prev_cost
            history.append(cost)
            volatility = float(np.std(np.array(history, dtype=float))) if len(history) > 1 else 0.0
            samples.append({
                "entity": entity,
                "month": month,
                "cost": float(cost),
                "trend": float(trend),
                "volatility": volatility,
            })
            prev_cost = cost
    return samples


def group_by_ref_id(records: List[CostRecord]) -> Dict[str, Dict[str, float]]:
    """Aggregate monthly costs by exact reference id."""
    grouped: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for rec in records:
        ref_id = (rec.reference or "").strip()
        if not ref_id:
            continue
        month = _month_key(rec.cost_date)
        if not month:
            continue
        grouped[ref_id][month] += float(rec.amount or 0.0)
    return {k: dict(v) for k, v in grouped.items()}


def group_by_service(records: List[CostRecord]) -> Dict[str, Dict[str, float]]:
    """Aggregate monthly costs by service name."""
    grouped: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for rec in records:
        service_name = (rec.service_name or "").strip()
        if not service_name:
            continue
        month = _month_key(rec.cost_date)
        if not month:
            continue
        grouped[service_name][month] += float(rec.amount or 0.0)
    return {k: dict(v) for k, v in grouped.items()}


def detect_cost_anomalies(
    db: Session,
    group_by: str = "ref_id",
    target_month: Optional[str] = None,
    expected_method: str = "median",
    contamination: float = 0.08,
    mom_threshold_pct: float = 50.0,
) -> Dict[str, Any]:
    """Cost anomaly detection with strict aggregation level separation.

    Aggregation:
      - ref_id: exact CostRecord.reference
      - service_name: CostRecord.service_name
    """
    query = db.query(CostRecord).filter(CostRecord.amount.isnot(None))
    records = query.all()

    if group_by == "service_name":
        monthly_by_entity = group_by_service(records)
    elif group_by == "ref_id":
        monthly_by_entity = group_by_ref_id(records)
    else:
        raise ValueError("group_by must be 'ref_id' or 'service_name'")

    if not monthly_by_entity:
        return {
            "group_by": group_by,
            "target_month": target_month,
            "entities": [],
            "anomalies": [],
            "summary": {"total_entities": 0, "total_anomalies": 0},
        }

    all_months = sorted({m for month_map in monthly_by_entity.values() for m in month_map.keys()})
    if not all_months:
        return {
            "group_by": group_by,
            "target_month": target_month,
            "entities": [],
            "anomalies": [],
            "summary": {"total_entities": 0, "total_anomalies": 0},
        }

    selected_month = target_month if target_month in all_months else all_months[-1]
    prev_month = _previous_month(selected_month)

    peers_values = [
        month_map.get(selected_month, 0.0)
        for month_map in monthly_by_entity.values()
        if selected_month in month_map
    ]
    expected_cost = 0.0
    if peers_values:
        expected_cost = float(median(peers_values) if expected_method == "median" else mean(peers_values))

    if_samples = _build_if_samples(monthly_by_entity)
    if_scores: Dict[str, Dict[str, Any]] = {}

    if len(if_samples) >= MIN_COST_SAMPLES_FOR_IF:
        try:
            from sklearn.ensemble import IsolationForest
            from sklearn.preprocessing import StandardScaler

            X = np.array(
                [[s["cost"], s["trend"], s["volatility"]] for s in if_samples],
                dtype=float,
            )
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)
            effective_contamination = max(min(contamination, 0.49), 0.001)
            model = IsolationForest(
                n_estimators=200,
                contamination=effective_contamination,
                random_state=42,
            )
            model.fit(X_scaled)
            preds = model.predict(X_scaled)
            scores = model.decision_function(X_scaled)
            score_threshold = float(np.quantile(scores, effective_contamination))

            for sample, pred, score in zip(if_samples, preds, scores):
                if_scores[f"{sample['entity']}::{sample['month']}"] = {
                    "pred": int(pred),
                    "score": float(score),
                    "threshold": score_threshold,
                    "is_if_anomaly": int(pred) == -1 and float(score) < score_threshold,
                }
        except Exception as e:
            logger.warning("Cost IsolationForest failed: %s", e)

    entities = []
    anomalies = []

    for entity, month_map in monthly_by_entity.items():
        current_cost = float(month_map.get(selected_month, 0.0))
        previous_cost = float(month_map.get(prev_month, 0.0))
        diff = current_cost - previous_cost
        variation_pct = _safe_variation_pct(current_cost, previous_cost)

        if_key = f"{entity}::{selected_month}"
        if_data = if_scores.get(
            if_key,
            {"pred": None, "score": None, "threshold": None, "is_if_anomaly": False},
        )

        mom_anomaly = variation_pct is not None and variation_pct > mom_threshold_pct
        # Peer anomaly compares each entity against the same-month peer baseline
        # (median or mean, same aggregation level), so signal is consistent.
        peer_anomaly = current_cost > expected_cost

        reasons = []
        if if_data["is_if_anomaly"]:
            reasons.append("isolation_forest")
        if mom_anomaly:
            reasons.append("mom")
        if peer_anomaly:
            reasons.append("peer")

        row = {
            "entity_id": entity,
            "group_by": group_by,
            "month": selected_month,
            "previous_month": prev_month,
            "current_month_cost": round(current_cost, 4),
            "previous_month_cost": round(previous_cost, 4),
            "diff": round(diff, 4),
            "variation_pct": round(variation_pct, 4) if variation_pct is not None else None,
            "expected_cost": round(expected_cost, 4),
            "if_pred": if_data["pred"],
            "if_score": round(if_data["score"], 8) if if_data["score"] is not None else None,
            "if_score_threshold": (
                round(if_data["threshold"], 8)
                if if_data["threshold"] is not None else None
            ),
            "signals": {
                "if_anomaly": bool(if_data["is_if_anomaly"]),
                "mom_anomaly": bool(mom_anomaly),
                "peer_anomaly": bool(peer_anomaly),
            },
            "is_anomaly": bool(reasons),
            "reasons": reasons,
        }
        entities.append(row)
        if row["is_anomaly"]:
            anomalies.append(row)

    entities_sorted = sorted(entities, key=lambda x: x["current_month_cost"], reverse=True)
    anomalies_sorted = sorted(
        anomalies,
        key=lambda x: (len(x["reasons"]), x["current_month_cost"]),
        reverse=True,
    )

    return {
        "group_by": group_by,
        "target_month": selected_month,
        "expected_method": expected_method,
        "mom_threshold_pct": mom_threshold_pct,
        "entities": entities_sorted,
        "anomalies": anomalies_sorted,
        "summary": {
            "total_entities": len(entities_sorted),
            "total_anomalies": len(anomalies_sorted),
            "peer_count_for_expected": len(peers_values),
            "if_trained": len(if_scores) > 0,
        },
    }


def detect_ml_anomalies(
    db: Session,
    server_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Run ML-based anomaly detection (Isolation Forest with scaling).

    For servers with < MIN_SAMPLES_FOR_ML records the function falls back to
    threshold-based detection.  For data-rich servers it fits an Isolation
    Forest on normalised features and converts the decision scores to
    human-readable anomaly dicts.

    Returns
    -------
    dict with keys: anomalies, total, by_severity, methods_used
    """
    query = db.query(ResourceMetric)
    if server_name:
        query = query.filter(ResourceMetric.server_name == server_name)
    all_metrics = query.all()

    if not all_metrics:
        return {
            "anomalies": [],
            "total": 0,
            "by_severity": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0},
            "methods_used": [],
        }

    # ── Group by server ─────────────────────────────────────────────────
    servers: Dict[str, List[ResourceMetric]] = {}
    for m in all_metrics:
        servers.setdefault(m.server_name or "unknown", []).append(m)

    ml_anomalies: List[Dict[str, Any]] = []
    threshold_fallback_metrics: List[ResourceMetric] = []
    methods_used = set()

    for srv, metrics in servers.items():
        # ── Build feature rows, excluding CPU-sentinel records ──────
        rows = []
        valid_metrics = []
        sentinel_metrics = []
        for m in metrics:
            valid_cpu, hw_cores = decode_cpu_sentinel(m.cpu_usage)
            if hw_cores is not None:
                # Exclude sentinel records from ML — 0.0 would distort model
                sentinel_metrics.append(m)
                continue
            rows.append([valid_cpu or 0.0, m.ram_usage or 0.0, m.disk_usage or 0.0])
            valid_metrics.append(m)

        # Sentinel-only servers fall back to threshold detection (RAM/Disk only)
        if sentinel_metrics and not valid_metrics:
            threshold_fallback_metrics.extend(sentinel_metrics)
            continue

        if len(rows) < MIN_SAMPLES_FOR_ML:
            # Fallback to threshold detection for sparse servers
            threshold_fallback_metrics.extend(valid_metrics)
            continue

        # ── Fit Isolation Forest with scaling ───────────────────────
        try:
            from sklearn.ensemble import IsolationForest
            from sklearn.preprocessing import StandardScaler

            X = np.array(rows, dtype=float)
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)

            effective_contamination = min(
                CONTAMINATION, (len(X) - 1) / len(X)
            )

            iso = IsolationForest(
                n_estimators=100,
                contamination=effective_contamination,
                random_state=42,
            )
            iso.fit(X_scaled)
            preds = iso.predict(X_scaled)
            scores = iso.decision_function(X_scaled)

            for i, (pred, score) in enumerate(zip(preds, scores)):
                if pred == -1:  # outlier
                    m = valid_metrics[i]
                    valid_cpu, _ = decode_cpu_sentinel(m.cpu_usage)

                    # Map decision score to 0-1 confidence
                    # More negative = more anomalous
                    confidence = min(max(-score, 0.0), 1.0)

                    if confidence >= 0.6:
                        severity = "CRITICAL"
                    elif confidence >= 0.3:
                        severity = "HIGH"
                    else:
                        severity = "MEDIUM"

                    desc_parts = []
                    if valid_cpu is not None:
                        desc_parts.append(f"CPU={valid_cpu:.1f}%")
                    desc_parts.append(f"RAM={m.ram_usage:.1f}GB")
                    desc_parts.append(f"Disk={m.disk_usage:.1f}GB")

                    ml_anomalies.append({
                        "server_name": srv,
                        "anomaly_type": "ml_outlier",
                        "severity": severity,
                        "description": (
                            f"ML outlier detected: {', '.join(desc_parts)} "
                            f"(confidence={confidence:.2f})"
                        ),
                        "anomaly_score": round(confidence, 3),
                        "metric": "multi_feature",
                        "actual_value": rows[i],
                        "detection_method": "isolation_forest",
                        "recorded_at": (
                            m.recorded_at.isoformat() if m.recorded_at else None
                        ),
                    })

            methods_used.add("isolation_forest")

        except ImportError:
            logger.warning(
                "scikit-learn not available — falling back to threshold detection"
            )
            threshold_fallback_metrics.extend(valid_metrics)
        except Exception as e:
            logger.error("ML detection failed for '%s': %s", srv, e)
            threshold_fallback_metrics.extend(valid_metrics)

    # ── Threshold fallback for sparse servers ───────────────────────────
    if threshold_fallback_metrics:
        ml_anomalies.extend(detect_threshold_anomalies(threshold_fallback_metrics))
        methods_used.add("threshold")

    by_severity = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0}
    for a in ml_anomalies:
        sev = a.get("severity", "MEDIUM")
        by_severity[sev] = by_severity.get(sev, 0) + 1

    return {
        "anomalies": ml_anomalies,
        "total": len(ml_anomalies),
        "by_severity": by_severity,
        "methods_used": sorted(methods_used),
    }
