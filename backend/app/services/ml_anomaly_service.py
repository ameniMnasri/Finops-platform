"""
ml_anomaly_service.py — ML-based anomaly detection (Semaine 9)
═══════════════════════════════════════════════════════════════
Method: Isolation Forest (scikit-learn)

Why Isolation Forest?
  • Unsupervised — no labelled data needed
  • Works well on small datasets (dozens of servers × metrics)
  • Naturally handles multivariate outliers (CPU + RAM + Disk together)
  • Fast inference, no training corpus required

Fixes applied:
  • Removed hard filter on cpu_usage — many OVH servers store cpu as a
    negative sentinel (= core count from hw specs, not a real % reading).
    Filtering those out was silently eliminating most servers.
  • Feature matrix is now built adaptively: only columns that have at
    least one valid (non-null, non-sentinel) value are included.
    A server with only RAM+Disk data will still be analysed on 2 features.
  • Minimum records threshold lowered to 10 (was already 10, kept).
  • datetime.utcnow() replaced with timezone-aware equivalent to silence
    the Python 3.12 deprecation warning.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Dict

from sqlalchemy.orm import Session

from app.models.anomaly  import Anomaly, AnomalyType, AnomalySeverity, AnomalyMethod
from app.models.resource import ResourceMetric

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Lazy import of sklearn (optional dependency)
# ─────────────────────────────────────────────────────────────────────────────

def _load_sklearn():
    try:
        from sklearn.ensemble import IsolationForest
        import numpy as np
        return IsolationForest, np
    except ImportError as e:
        raise ImportError(
            "scikit-learn is required for ML anomaly detection. "
            "Install it with: pip install scikit-learn numpy"
        ) from e


# ─────────────────────────────────────────────────────────────────────────────
# ISOLATION FOREST DETECTION
# ─────────────────────────────────────────────────────────────────────────────

# All possible feature columns with their metadata
_FEATURE_META = [
    {"key": "cpu_usage",  "unit": "%",  "label": "CPU",  "type": AnomalyType.HIGH_CPU},
    {"key": "ram_usage",  "unit": "GB", "label": "RAM",  "type": AnomalyType.HIGH_RAM},
    {"key": "disk_usage", "unit": "GB", "label": "Disk", "type": AnomalyType.HIGH_DISK},
]

MIN_RECORDS = 10   # minimum data points per server to run IF


def _is_valid_value(v) -> bool:
    """
    A metric value is valid for ML if it is not None AND not a negative
    sentinel (OVH stores cpu core-count as a negative float when RTM is
    unavailable — those are specs, not usage percentages).
    """
    return v is not None and v >= 0


def detect_resource_anomalies_ml(
    db:            Session,
    server_filter: Optional[str] = None,
    contamination: float = 0.05,
    n_estimators:  int   = 100,
    window_days:   int   = 60,
    save:          bool  = True,
) -> List[Anomaly]:
    """
    Detect resource outliers using Isolation Forest on
    (cpu_usage, ram_usage, disk_usage) feature vectors.

    For each server:
        1. Collect the last `window_days` days of ResourceMetric rows.
        2. Determine which features have valid data (skip cpu sentinel negatives).
        3. Build a feature matrix X with only usable columns.
        4. Fit an IsolationForest and predict -1 (outlier) or +1 (normal).
        5. For each outlier, create an Anomaly record for the most deviant metric.

    Args:
        contamination: Expected fraction of outliers (0.01–0.5).
        n_estimators:  Number of trees in the forest.
        window_days:   How far back to look (default 60 days).
    """
    IsolationForest, np = _load_sklearn()

    logger.info(
        f"🤖 [IsolationForest] Resource ML detection | "
        f"contamination={contamination} n_est={n_estimators} window={window_days}d"
    )

    # ── FIX: use timezone-aware datetime (Python 3.12 deprecates utcnow) ─────
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)

    # ── FIX: removed the hard .filter(cpu_usage >= 0) ────────────────────────
    # Previously, this filter silently excluded every server that stores the
    # OVH cpu core-count as a negative sentinel, leaving 0 servers for ML.
    # We now fetch all records and handle sentinel values per-feature below.
    query = (
        db.query(ResourceMetric)
        .filter(ResourceMetric.recorded_at >= cutoff)
    )
    if server_filter:
        query = query.filter(ResourceMetric.server_name.ilike(f"%{server_filter}%"))

    all_records = query.order_by(
        ResourceMetric.server_name, ResourceMetric.recorded_at
    ).all()

    if not all_records:
        logger.info("ℹ️ No resource metrics for ML detection")
        return []

    # Group by server
    by_server: Dict[str, List[ResourceMetric]] = {}
    for r in all_records:
        by_server.setdefault(r.server_name, []).append(r)

    detected: List[Anomaly] = []

    for server, records in by_server.items():

        if len(records) < MIN_RECORDS:
            logger.debug(
                f"  ⏭️  {server}: only {len(records)} records, "
                f"skipping (need ≥{MIN_RECORDS})"
            )
            continue

        # ── Determine which features have valid data for this server ──────────
        active_features = [
            meta for meta in _FEATURE_META
            if any(_is_valid_value(getattr(r, meta["key"])) for r in records)
        ]

        if not active_features:
            logger.debug(f"  ⏭️  {server}: no valid feature values, skipping")
            continue

        logger.debug(
            f"  🔬 {server}: {len(records)} records | "
            f"features={[m['key'] for m in active_features]}"
        )

        # ── Build feature matrix (only active columns) ────────────────────────
        X = np.array([
            [
                float(getattr(r, meta["key"])) if _is_valid_value(getattr(r, meta["key"])) else 0.0
                for meta in active_features
            ]
            for r in records
        ])

        # ── Fit & predict ─────────────────────────────────────────────────────
        clf = IsolationForest(
            n_estimators=n_estimators,
            contamination=contamination,
            random_state=42,
        )
        preds  = clf.fit_predict(X)   # -1 = outlier, +1 = normal
        scores = clf.score_samples(X) # more negative = more anomalous

        col_means = X.mean(axis=0)

        for i, (record, pred, score) in enumerate(zip(records, preds, scores)):
            if pred != -1:
                continue  # normal point — skip

            x = X[i]

            # Which active feature deviates the most from its column mean?
            deviations = np.abs(x - col_means)
            worst_idx  = int(np.argmax(deviations))
            meta       = active_features[worst_idx]

            observed = float(x[worst_idx])
            expected = float(col_means[worst_idx])

            # Map score to severity
            # score_samples returns negative values; more negative = worse outlier
            abs_score = abs(score)
            if abs_score >= 0.15:
                severity = AnomalySeverity.CRITICAL
            elif abs_score >= 0.10:
                severity = AnomalySeverity.HIGH
            elif abs_score >= 0.06:
                severity = AnomalySeverity.MEDIUM
            else:
                severity = AnomalySeverity.LOW

            description = (
                f"[Isolation Forest] Serveur '{server}' — {meta['label']} outlier détecté: "
                f"{observed:.2f}{meta['unit']} (moy. fenêtre: {expected:.2f}{meta['unit']}). "
                f"Score d'anomalie: {score:.4f}. "
                f"Features actives: {[m['key'] for m in active_features]}"
            )

            anomaly = Anomaly(
                entity_type      = "server",
                entity_name      = server,
                anomaly_type     = meta["type"],
                severity         = severity,
                method           = AnomalyMethod.ISOLATION_FOREST,
                observed_value   = observed,
                expected_value   = expected,
                std_dev          = None,
                z_score          = None,
                anomaly_score    = float(score),
                threshold_value  = None,
                threshold_type   = f"isolation_forest_contamination={contamination}",
                detected_at      = record.recorded_at,
                description      = description,
                unit             = meta["unit"],
                source_record_id = record.id,
            )
            detected.append(anomaly)
            logger.warning(
                f"🤖 ML outlier: {server} | {meta['label']}={observed:.2f}{meta['unit']} "
                f"score={score:.4f} [{severity}]"
            )

    if save and detected:
        db.add_all(detected)
        db.commit()
        for a in detected:
            db.refresh(a)
        logger.info(f"✅ {len(detected)} ML anomalies saved to DB")
    else:
        logger.info(f"ℹ️ {len(detected)} ML anomalies detected (save=False)")

    return detected