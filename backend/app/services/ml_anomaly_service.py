"""
ml_anomaly_service.py — Détection ML FinOps v6 — CORRECTED
═══════════════════════════════════════════════════════════════════════════════

CORRECTIONS FINALES v7:

1. ✅ expected_value = MÉDIANE des pairs au même niveau d'agrégation
   - Ancien bug: moyenne globale (ex "82.45€") mélangeant les niveaux
   - Nouveau: médiane robuste sur service_name OU reference selon le mode

2. ✅ Pipeline strict par niveau (service vs ref_id/reference)
   - Par-ref : GROUP BY (reference, cost_date)
   - Par-service : GROUP BY (service_name, cost_date)
   - Résultat : jeux de données distincts, sans duplication

3. ✅ MoM et features IF cohérents avec le mode choisi
   - MoM calculé uniquement dans le même niveau
   - IF sur features numériques : total, avg_daily, volatility, trend
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone, date
from calendar import monthrange
from typing import List, Optional, Dict, Tuple
from decimal import Decimal, ROUND_HALF_UP
import statistics

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.anomaly import Anomaly, AnomalyType, AnomalySeverity, AnomalyMethod
from app.models.cost import CostRecord

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
# ⚙️ CONFIGURATION PRÉCISE
# ────────────────────────────────────────────────────────────────────────────

MIN_SERVICES_FOR_CROSS = 3
IF_SCORE_THRESHOLD_COST = -0.08
MOM_VARIATION_THRESHOLD = 50.0
MOM_COMBINED_THRESHOLD = 20.0

# Précision : tous les montants arrondis à 0.01€
COST_PRECISION = Decimal('0.01')

_MAX_ENTITY_NAME = 50
_MAX_THRESHOLD_TYP = 50


def _precise_round(value: float, decimals: int = 2) -> float:
    """Arrondi précis à 0.01€ avec Decimal pour sûreté."""
    if value is None:
        return 0.0
    d = Decimal(str(float(value))).quantize(
        Decimal(10) ** -decimals,
        rounding=ROUND_HALF_UP
    )
    return float(d)


def _trunc(s: str, n: int) -> str:
    return s[:n - 1] + "…" if s and len(s) > n else s


def _load_sklearn():
    try:
        from sklearn.ensemble import IsolationForest
        from sklearn.preprocessing import RobustScaler
        import numpy as np
        return IsolationForest, RobustScaler, np
    except ImportError as e:
        raise ImportError(
            "scikit-learn requis. Installation : pip install scikit-learn numpy"
        ) from e


def _severity_from_score(score: float) -> AnomalySeverity:
    """Sévérité basée sur score IF."""
    if score < -0.25:
        return AnomalySeverity.CRITICAL
    if score < -0.18:
        return AnomalySeverity.HIGH
    if score < -0.13:
        return AnomalySeverity.MEDIUM
    return AnomalySeverity.LOW


def _severity_from_mom(variation_pct: float) -> AnomalySeverity:
    """Sévérité basée sur variation MoM pure."""
    if variation_pct >= 200:
        return AnomalySeverity.CRITICAL
    if variation_pct >= 100:
        return AnomalySeverity.HIGH
    if variation_pct >= 50:
        return AnomalySeverity.MEDIUM
    return AnomalySeverity.LOW


def _to_aware(dt) -> datetime:
    """Convertit date→datetime UTC."""
    if isinstance(dt, datetime):
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    if hasattr(dt, 'year'):
        return datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


# ────────────────────────────────────────────────────────────────────────────
# 📅 CALCUL TRANSPARENT DU MoM
# ────────────────────────────────────────────────────────────────────────────

def _get_month_bounds() -> Tuple[date, date, date, date]:
    """
    Retourne les bornes des mois courant et précédent.
    
    Returns:
        (cur_start, cur_end, prev_start, prev_end)
    """
    today = datetime.now(timezone.utc).date()
    cur_start = today.replace(day=1)
    cur_end = today

    if cur_start.month == 1:
        prev_year, prev_month = cur_start.year - 1, 12
    else:
        prev_year, prev_month = cur_start.year, cur_start.month - 1

    prev_start = date(prev_year, prev_month, 1)
    prev_end = date(
        prev_year, prev_month,
        monthrange(prev_year, prev_month)[1]
    )

    return cur_start, cur_end, prev_start, prev_end


def aggregate_by_ref_id(
    db: Session,
    period: Tuple[date, date],
) -> Dict[str, List[Tuple[date, float]]]:
    """Agrège strictement par référence serveur (ref_id / reference) et date."""
    start_date, end_date = period
    rows = (
        db.query(
            CostRecord.reference,
            CostRecord.cost_date,
            func.sum(CostRecord.amount).label("total"),
        )
        .filter(
            CostRecord.cost_date >= start_date,
            CostRecord.cost_date <= end_date,
            CostRecord.reference.isnot(None),
            CostRecord.reference != "",
        )
        .group_by(CostRecord.reference, CostRecord.cost_date)
        .order_by(CostRecord.reference, CostRecord.cost_date)
        .all()
    )
    series: Dict[str, List[Tuple[date, float]]] = {}
    for ref, cost_day, total in rows:
        key = str(ref).strip()
        series.setdefault(key, []).append((cost_day, _precise_round(float(total or 0.0), 2)))
    return series


def aggregate_by_service(
    db: Session,
    period: Tuple[date, date],
) -> Dict[str, List[Tuple[date, float]]]:
    """Agrège strictement par service_name et date."""
    start_date, end_date = period
    rows = (
        db.query(
            CostRecord.service_name,
            CostRecord.cost_date,
            func.sum(CostRecord.amount).label("total"),
        )
        .filter(
            CostRecord.cost_date >= start_date,
            CostRecord.cost_date <= end_date,
        )
        .group_by(CostRecord.service_name, CostRecord.cost_date)
        .order_by(CostRecord.service_name, CostRecord.cost_date)
        .all()
    )
    series: Dict[str, List[Tuple[date, float]]] = {}
    for service_name, cost_day, total in rows:
        key = str(service_name).strip()
        series.setdefault(key, []).append((cost_day, _precise_round(float(total or 0.0), 2)))
    return series


def calculate_expected_cost(entity_value: float, all_peer_values: List[float]) -> float:
    """Retourne la médiane des coûts du même niveau d'agrégation."""
    _ = entity_value
    peers = [float(v) for v in all_peer_values if v is not None]
    if not peers:
        return 0.0
    return _precise_round(float(statistics.median(peers)), 2)


def compute_mom_per_service(db: Session, verbose: bool = True) -> Dict[str, dict]:
    """
    MoM groupé par SERVICE_NAME — vue agrégée (ex: toutes les lignes "RISE-3").
    
    Returns:
        {
            "RISE-3": {
                "current_cost": 150.25,
                "previous_cost": 120.00,
                "diff": 30.25,
                "variation_pct": 25.21,
                "overcost": 30.25,
                "has_previous": True,
            },
            ...
        }
    """
    cur_start, cur_end, prev_start, prev_end = _get_month_bounds()

    current_series = aggregate_by_service(db, (cur_start, cur_end))
    previous_series = aggregate_by_service(db, (prev_start, prev_end))
    current_map = {
        key: _precise_round(sum(v for _, v in values), 2)
        for key, values in current_series.items()
    }
    previous_map = {
        key: _precise_round(sum(v for _, v in values), 2)
        for key, values in previous_series.items()
    }
    all_keys = set(current_map) | set(previous_map)

    result: Dict[str, dict] = {}
    for key in sorted(all_keys):
        current = current_map.get(key, 0.0)
        previous = previous_map.get(key, 0.0)
        diff = _precise_round(current - previous, 2)

        if previous > 0:
            variation_pct = _precise_round((diff / previous) * 100.0, 2)
        elif current > 0:
            variation_pct = 100.0
        else:
            variation_pct = 0.0

        result[key] = {
            "current_cost": current,
            "previous_cost": previous,
            "diff": diff,
            "variation_pct": variation_pct,
            "overcost": max(0.0, diff),
            "has_previous": previous > 0,
        }

        if verbose and (abs(variation_pct) > 0.1 or current > 0):
            sign = "+" if diff >= 0 else ""
            logger.debug(
                f"  📊 [Service] {key:40s} | "
                f"Mois précédent: {previous:10.2f}€ → "
                f"Mois courant: {current:10.2f}€ | "
                f"Δ: {sign}{diff:8.2f}€ ({sign}{variation_pct:6.2f}%)"
            )

    if verbose:
        logger.info(
            f"📅 [MoM par SERVICE] {cur_start} → {cur_end} vs "
            f"{prev_start} → {prev_end} | "
            f"{len(result)} services analysés"
        )

    return result


def compute_mom_per_ref(db: Session, verbose: bool = True) -> Dict[str, dict]:
    """
    MoM groupé par RÉFÉRENCE SERVEUR — vue précise (ex: ns31546254.ip-141-94-196.eu).
    
    Cette version regroupe par référence OVH exacte pour voir le MoM 
    d'un serveur SPÉCIFIQUE, pas juste du service global.
    
    Returns:
        {
            "ns31546254.ip-141-94-196.eu": {
                "current_cost": 50.75,
                "previous_cost": 45.00,
                "diff": 5.75,
                "variation_pct": 12.78,
                "overcost": 5.75,
                "has_previous": True,
            },
            ...
        }
    """
    cur_start, cur_end, prev_start, prev_end = _get_month_bounds()

    current_series = aggregate_by_ref_id(db, (cur_start, cur_end))
    previous_series = aggregate_by_ref_id(db, (prev_start, prev_end))
    current_map = {
        key: _precise_round(sum(v for _, v in values), 2)
        for key, values in current_series.items()
    }
    previous_map = {
        key: _precise_round(sum(v for _, v in values), 2)
        for key, values in previous_series.items()
    }
    all_keys = set(current_map) | set(previous_map)

    result: Dict[str, dict] = {}
    for key in sorted(all_keys):
        current = current_map.get(key, 0.0)
        previous = previous_map.get(key, 0.0)
        diff = _precise_round(current - previous, 2)

        if previous > 0:
            variation_pct = _precise_round((diff / previous) * 100.0, 2)
        elif current > 0:
            variation_pct = 100.0
        else:
            variation_pct = 0.0

        result[key] = {
            "current_cost": current,
            "previous_cost": previous,
            "diff": diff,
            "variation_pct": variation_pct,
            "overcost": max(0.0, diff),
            "has_previous": previous > 0,
        }

        if verbose and (abs(variation_pct) > 0.1 or current > 0):
            sign = "+" if diff >= 0 else ""
            logger.debug(
                f"  🖥️  [Ref] {key:50s} | "
                f"Mois précédent: {previous:10.2f}€ → "
                f"Mois courant: {current:10.2f}€ | "
                f"Δ: {sign}{diff:8.2f}€ ({sign}{variation_pct:6.2f}%)"
            )

    if verbose:
        logger.info(
            f"📅 [MoM par RÉFÉRENCE] {cur_start} → {cur_end} vs "
            f"{prev_start} → {prev_end} | "
            f"{len(result)} références serveur analysées"
        )

    return result


# ────────────────────────────────────────────────────────────────────────────
# 🤖 ANOMALIES DE COÛT — IF + MoM
# ────────────────────────────────────────────────────────────────────────────

def detect_cost_anomalies_ml(
    db: Session,
    service_filter: Optional[str] = None,
    n_estimators: int = 200,
    window_days: int = 90,
    save: bool = True,
    mom_groupby: str = 'service',  # 'service' ou 'ref'
) -> List[Anomaly]:
    """Détection coûts avec séparation stricte des niveaux (service/ref)."""
    mode = 'ref' if mom_groupby == 'ref' else 'service'
    today = datetime.now(timezone.utc).date()
    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=window_days)).date()
    cur_start, cur_end, _, _ = _get_month_bounds()

    IsolationForest, RobustScaler, np = _load_sklearn()

    logger.info(
        f"\n{'='*90}"
        f"\n💰 [Détection Coûts ML] mode={mode} fenêtre={window_days}j"
        f"\n   Rappel: expected_cost = médiane des pairs (pas moyenne, pas 82.45€ fantôme)"
        f"\n{'='*90}"
    )

    aggregate_fn = aggregate_by_ref_id if mode == 'ref' else aggregate_by_service
    mom_fn = compute_mom_per_ref if mode == 'ref' else compute_mom_per_service

    if mode == 'ref':
        total_window_rows = db.query(func.count(CostRecord.id)).filter(
            CostRecord.cost_date >= cutoff_date,
            CostRecord.cost_date <= today,
        ).scalar() or 0
        ref_window_rows = db.query(func.count(CostRecord.id)).filter(
            CostRecord.cost_date >= cutoff_date,
            CostRecord.cost_date <= today,
            CostRecord.reference.isnot(None),
            CostRecord.reference != "",
        ).scalar() or 0
        if total_window_rows > 0 and ref_window_rows < total_window_rows:
            missing_pct = _precise_round(
                (1.0 - (float(ref_window_rows) / float(total_window_rows))) * 100.0,
                2,
            )
            logger.info(
                f"📎 Data quality ref_id/reference: {ref_window_rows}/{total_window_rows} lignes exploitables "
                f"(~{missing_pct}% sans ref_id/reference)."
            )

    series_by_entity = aggregate_fn(db, (cutoff_date, today))
    current_month_series = aggregate_fn(db, (cur_start, cur_end))
    mom_data = mom_fn(db, verbose=True)

    entities = sorted(set(series_by_entity) | set(current_month_series) | set(mom_data))
    if not entities:
        logger.info("ℹ️ Aucune donnée coût à analyser")
        return []

    current_month_totals = {
        entity: _precise_round(sum(v for _, v in values), 2)
        for entity, values in current_month_series.items()
    }
    all_current_values = [current_month_totals.get(e, 0.0) for e in entities]

    row_meta: Dict[str, dict] = {}
    feature_entities: List[str] = []
    feature_matrix: List[List[float]] = []
    latest_by_entity: Dict[str, CostRecord] = {}

    latest_rows = (
        db.query(CostRecord)
        .filter(CostRecord.cost_date >= cutoff_date)
        .order_by(CostRecord.cost_date.desc())
        .all()
    )
    for rec in latest_rows:
        key = (
            (str(rec.reference).strip() if rec.reference else None)
            if mode == 'ref'
            else str(rec.service_name).strip()
        )
        if not key:
            continue
        if service_filter and (service_filter.lower() not in str(rec.service_name or "").lower()):
            continue
        if key not in latest_by_entity:
            latest_by_entity[key] = rec

    for entity in entities:
        if service_filter and mode == 'service' and (service_filter.lower() not in entity.lower()):
            continue
        if service_filter and mode == 'ref':
            latest_rec = latest_by_entity.get(entity)
            if latest_rec is None or service_filter.lower() not in str(latest_rec.service_name or "").lower():
                continue

        series = [v for _, v in series_by_entity.get(entity, [])]
        if not series:
            series = [current_month_totals.get(entity, 0.0)]

        total = _precise_round(sum(series), 2)
        days = max((today - cutoff_date).days + 1, 1)
        avg_daily = _precise_round(total / days, 6)
        mean_value = statistics.mean(series) if series else 0.0
        volatility = _precise_round(
            (statistics.pstdev(series) / max(mean_value, 0.01)) if len(series) >= 2 else 0.0,
            6,
        )
        week = max(min(7, len(series)), 1)
        first_week_avg = sum(series[:week]) / week
        last_week_avg = sum(series[-week:]) / week
        trend = _precise_round((last_week_avg - first_week_avg) / max(first_week_avg, 0.01), 6)

        row_meta[entity] = {
            "total_cost": total,
            "avg_daily": avg_daily,
            "volatility": volatility,
            "trend": trend,
            "current_cost": current_month_totals.get(entity, 0.0),
            "last_date": latest_by_entity.get(entity).cost_date if latest_by_entity.get(entity) else today,
            "service_name": latest_by_entity.get(entity).service_name if latest_by_entity.get(entity) else entity,
            "reference": latest_by_entity.get(entity).reference if latest_by_entity.get(entity) else (entity if mode == 'ref' else None),
        }
        feature_entities.append(entity)
        feature_matrix.append([total, avg_daily, volatility, trend])

    if not feature_entities:
        return []

    if_outliers: Dict[str, float] = {}
    if len(feature_entities) >= MIN_SERVICES_FOR_CROSS:
        X_raw = np.array(feature_matrix, dtype=np.float64)
        active_cols = np.where(X_raw.std(axis=0) > 1e-8)[0]
        if len(active_cols) > 0:
            X_active = X_raw[:, active_cols]
            scaler = RobustScaler()
            X_scaled = scaler.fit_transform(X_active)
            clf = IsolationForest(
                n_estimators=n_estimators,
                contamination="auto",
                random_state=42,
                bootstrap=True,
            )
            preds = clf.fit_predict(X_scaled)
            scores = clf.score_samples(X_scaled)
            for entity, pred, score in zip(feature_entities, preds, scores):
                if pred == -1 and score < IF_SCORE_THRESHOLD_COST:
                    if_outliers[entity] = _precise_round(float(score), 4)

    detected: List[Anomaly] = []
    for entity in feature_entities:
        meta = row_meta[entity]
        current_cost = _precise_round(float(meta["current_cost"]), 2)
        expected_cost = calculate_expected_cost(current_cost, all_current_values)
        mom = mom_data.get(entity, {})
        variation_pct = _precise_round(float(mom.get("variation_pct", 0.0)), 2)
        mom_anomaly = variation_pct > MOM_VARIATION_THRESHOLD
        peer_anomaly = (
            expected_cost > 0
            and (current_cost > (3.0 * expected_cost) or current_cost < (expected_cost / 3.0))
        )
        if_anomaly = entity in if_outliers

        if not (if_anomaly or mom_anomaly or peer_anomaly):
            continue

        threshold_flags: List[str] = [f"lvl={mode}"]
        if if_anomaly:
            threshold_flags.append(f"if<{IF_SCORE_THRESHOLD_COST}")
        if mom_anomaly:
            threshold_flags.append(f"mom>{MOM_VARIATION_THRESHOLD:.0f}")
        if peer_anomaly:
            threshold_flags.append("peer3x")

        anomaly_score = if_outliers.get(entity)
        severity = (
            _severity_from_score(anomaly_score)
            if anomaly_score is not None
            else _severity_from_mom(variation_pct if variation_pct > 0 else MOM_VARIATION_THRESHOLD)
        )
        if peer_anomaly and anomaly_score is None and not mom_anomaly:
            severity = AnomalySeverity.HIGH

        previous_cost = _precise_round(float(mom.get("previous_cost", 0.0)), 2)
        diff_cost = _precise_round(float(mom.get("diff", 0.0)), 2)
        peer_dev = _precise_round(
            ((current_cost - expected_cost) / expected_cost * 100.0) if expected_cost > 0 else 0.0,
            2,
        )
        description = (
            f"[Anomalie coût {mode}] entity={entity} ref={meta.get('reference')} | "
            f"Mois courant: {current_cost:.2f}€ | "
            f"Médiane pairs ({mode}): {expected_cost:.2f}€ | "
            f"Écart pairs: {peer_dev:+.2f}% | "
            f"Mois précédent: {previous_cost:.2f}€ | "
            f"MoM: {variation_pct:+.2f}% ({diff_cost:+.2f}€)"
        )
        if anomaly_score is not None:
            description += f" | IF score: {anomaly_score:.4f} (seuil {IF_SCORE_THRESHOLD_COST})"

        detected.append(
            Anomaly(
                entity_type="cost_service",
                entity_name=_trunc(str(entity), _MAX_ENTITY_NAME),
                anomaly_type=AnomalyType.COST_SPIKE,
                severity=severity,
                method=AnomalyMethod.ISOLATION_FOREST,
                observed_value=current_cost,
                expected_value=expected_cost,
                std_dev=_precise_round(abs(diff_cost), 2),
                z_score=None,
                anomaly_score=anomaly_score,
                threshold_value=None,
                threshold_type=_trunc("|".join(threshold_flags), _MAX_THRESHOLD_TYP),
                detected_at=_to_aware(meta.get("last_date")),
                description=description,
                unit="€",
                source_record_id=latest_by_entity.get(entity).id if latest_by_entity.get(entity) else None,
            )
        )

    if save and detected:
        db.add_all(detected)
        db.commit()
        for anomaly in detected:
            db.refresh(anomaly)
    logger.info(f"✅ {len(detected)} anomalies coût détectées (mode={mode})")
    return detected


def detect_resource_anomalies_ml(
    db: Session,
    server_filter: Optional[str] = None,
    contamination: float = 0.05,
    n_estimators: int = 200,
    window_days: int = 90,
    save: bool = True,
    mom_groupby: str = 'service',
) -> List[Anomaly]:
    """
    Point d'entrée principal — MODE COÛTS UNIQUEMENT.
    """
    return detect_cost_anomalies_ml(
        db=db,
        service_filter=server_filter,
        n_estimators=n_estimators * 2,
        window_days=window_days,
        save=save,
        mom_groupby=mom_groupby,
    )
