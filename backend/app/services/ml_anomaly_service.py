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
from typing import Any, Dict, List, Optional

import numpy as np
from sqlalchemy.orm import Session

from app.models.resource import ResourceMetric
from app.services.resource_service import decode_cpu_sentinel
from app.services.anomaly_service import detect_threshold_anomalies

logger = logging.getLogger(__name__)

MIN_SAMPLES_FOR_ML = 5
CONTAMINATION = 0.01  # 1 % expected anomaly rate


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
        # ── Build feature rows, skipping CPU sentinels ──────────────
        rows = []
        valid_metrics = []
        for m in metrics:
            valid_cpu, hw_cores = decode_cpu_sentinel(m.cpu_usage)
            cpu = valid_cpu if valid_cpu is not None else 0.0
            rows.append([cpu, m.ram_usage or 0.0, m.disk_usage or 0.0])
            valid_metrics.append(m)

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
