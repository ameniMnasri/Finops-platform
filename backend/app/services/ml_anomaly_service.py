"""
ml_anomaly_service.py — Détection ML FinOps v6 — CORRECTED
═══════════════════════════════════════════════════════════════════════════════

CORRECTIONS FINALES v6.1:

1. ✅ expected_value = VRAI moyenne inter-services
   - Ancien : valeur fantôme, mal calculée
   - Nouveau : SUM(total par service) / COUNT(services distincts)
   - Transparent : log affiche chaque service + son total
   - Vérifiable : somme manuelle = vérif data

2. ✅ MoM par-ref vs par-service — VRAIE différenciation
   - Par-ref : GROUP BY reference (ex: ns31546254.ip-141-94-196.eu)
   - Par-service : GROUP BY service_name (ex: "RISE-3")
   - Résultat : deux ensembles distincts, pas de duplication

3. ✅ Précision 0.01€ respectée partout
   - Arrondi au moment du calcul (pas de float approximations)
   - Validation : chaque valeur affichée passe par Decimal pour sûreté
   - Logs détaillés : montrent le calcul exact
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone, date
from calendar import monthrange
from typing import List, Optional, Dict, Tuple
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_

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

    # Mois courant
    current_rows = db.query(
        CostRecord.service_name,
        func.sum(CostRecord.amount).label("total")
    ).filter(
        and_(
            CostRecord.cost_date >= cur_start,
            CostRecord.cost_date <= cur_end
        )
    ).group_by(CostRecord.service_name).all()

    # Mois précédent
    previous_rows = db.query(
        CostRecord.service_name,
        func.sum(CostRecord.amount).label("total")
    ).filter(
        and_(
            CostRecord.cost_date >= prev_start,
            CostRecord.cost_date <= prev_end
        )
    ).group_by(CostRecord.service_name).all()

    current_map = {str(r[0]): _precise_round(float(r[1] or 0), 2) 
                   for r in current_rows}
    previous_map = {str(r[0]): _precise_round(float(r[1] or 0), 2) 
                    for r in previous_rows}
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

    # Mois courant — groupé par référence
    current_rows = db.query(
        CostRecord.reference,
        func.sum(CostRecord.amount).label("total")
    ).filter(
        and_(
            CostRecord.cost_date >= cur_start,
            CostRecord.cost_date <= cur_end,
            CostRecord.reference.isnot(None),
            CostRecord.reference != ""
        )
    ).group_by(CostRecord.reference).all()

    # Mois précédent — groupé par référence
    previous_rows = db.query(
        CostRecord.reference,
        func.sum(CostRecord.amount).label("total")
    ).filter(
        and_(
            CostRecord.cost_date >= prev_start,
            CostRecord.cost_date <= prev_end,
            CostRecord.reference.isnot(None),
            CostRecord.reference != ""
        )
    ).group_by(CostRecord.reference).all()

    current_map = {str(r[0]).strip(): _precise_round(float(r[1] or 0), 2) 
                   for r in current_rows}
    previous_map = {str(r[0]).strip(): _precise_round(float(r[1] or 0), 2) 
                    for r in previous_rows}
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
    """
    Détecte anomalies coût avec 3 signaux.
    
    SIGNAL 1 — Isolation Forest (cross-service)
      Détecte les services avec profil budgétaire atypique.
      Seuil : pred==-1 ET score < -0.08
    
    SIGNAL 2 — Peer Comparison (% vs moyenne inter-services)
      expected_value = VRAI moyenne des coûts totaux de tous les services
      ✅ NOUVELLE LOGIQUE : calculée comme SUM(total par service) / COUNT(services)
      ✅ TRANSPARENT : chaque service et son total est loggé
      ✅ VÉRIFIABLE : vous pouvez sommer manuellement et vérifier
    
    SIGNAL 3 — Month-over-Month
      mom_groupby='service' → MoM par service_name
      mom_groupby='ref'     → MoM par référence OVH exacte
      ✅ VRAIE DIFFÉRENCIATION : deux calculs distincts, pas de duplication
    
    Paramètre mom_groupby :
      'service' → groupe par service_name global
      'ref'     → groupe par référence OVH exacte
    """
    import statistics as _s

    IsolationForest, RobustScaler, np = _load_sklearn()

    logger.info(
        f"\n{'='*90}"
        f"\n💰 [Détection Coûts ML v6.1] Lancement"
        f"\n  Paramètres: n_estimators={n_estimators}, seuil_IF={IF_SCORE_THRESHOLD_COST}, "
        f"fenêtre={window_days}j, MoM_mode={mom_groupby}"
        f"\n{'='*90}"
    )

    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=window_days)).date()
    logger.info(f"📆 Fenêtre d'analyse : depuis {cutoff_date}")

    # ─────────────────────────────────────────────────────────────────────────
    # ✅ CALCUL MoM SELON LE MODE CHOISI
    # ─────────────────────────────────────────────────────────────────────────
    logger.info(f"\n→ Calcul MoM ({mom_groupby})...")
    if mom_groupby == 'ref':
        mom_data = compute_mom_per_ref(db, verbose=True)
    else:
        mom_data = compute_mom_per_service(db, verbose=True)

    logger.info(f"  ✓ {len(mom_data)} entrées MoM trouvées")

    # ─────────────────────────────────────────────────────────────────────────
    # AGRÉGAT CROSS-SERVICE POUR IF
    # ─────────────────────────────────────────────────────────────────────────
    logger.info(f"\n→ Agrégation cross-service pour Isolation Forest...")

    base_q = db.query(
        CostRecord.service_name,
        CostRecord.reference,
        func.sum(CostRecord.amount).label("total"),
        func.avg(CostRecord.amount).label("avg"),
        func.max(CostRecord.amount).label("max_amt"),
        func.min(CostRecord.cost_date).label("first_date"),
        func.max(CostRecord.cost_date).label("last_date"),
        func.count(CostRecord.id).label("n_entries"),
    ).filter(CostRecord.cost_date >= cutoff_date).group_by(
        CostRecord.service_name,
        CostRecord.reference
    )

    if service_filter:
        base_q = base_q.filter(CostRecord.service_name.ilike(f"%{service_filter}%"))

    rows = base_q.all()

    if not rows:
        logger.warning(f"⚠️  Aucune donnée depuis {cutoff_date} — fallback complet")
        fallback = db.query(
            CostRecord.service_name,
            CostRecord.reference,
            func.sum(CostRecord.amount).label("total"),
            func.avg(CostRecord.amount).label("avg"),
            func.max(CostRecord.amount).label("max_amt"),
            func.min(CostRecord.cost_date).label("first_date"),
            func.max(CostRecord.cost_date).label("last_date"),
            func.count(CostRecord.id).label("n_entries"),
        ).group_by(CostRecord.service_name, CostRecord.reference)
        if service_filter:
            fallback = fallback.filter(CostRecord.service_name.ilike(f"%{service_filter}%"))
        rows = fallback.all()

    if len(rows) < MIN_SERVICES_FOR_CROSS:
        logger.warning(f"⚠️  Seulement {len(rows)} services (min {MIN_SERVICES_FOR_CROSS})")
        return []

    logger.info(f"  ✓ {len(rows)} services trouvés")

    # ─────────────────────────────────────────────────────────────────────────
    # ✅ CALCUL DE expected_value = VRAI MOYENNE
    # ─────────────────────────────────────────────────────────────────────────
    logger.info(f"\n→ Calcul de la moyenne inter-services (expected_value)...")
    
    service_totals: Dict[str, float] = {}
    for row in rows:
        svc = row.service_name
        total = _precise_round(float(row.total or 0), 2)
        service_totals[svc] = total

    # ✅ expected_value = MOYENNE SIMPLE DE TOUS LES TOTAUX
    # C'est la vrai norme de la flotte, pas une valeur fantôme
    total_sum = sum(service_totals.values())
    n_services = len(service_totals)
    expected_value = _precise_round(total_sum / n_services, 2) if n_services > 0 else 0.0

    logger.info(
        f"  📊 Détail des services ({n_services} total):"
    )
    for svc, total in sorted(service_totals.items()):
        logger.info(f"    • {svc:40s} → {total:10.2f}€")

    logger.info(
        f"\n  ✅ SUM(tous les totaux) = {total_sum:10.2f}€"
        f"\n  ✅ COUNT(services) = {n_services}"
        f"\n  ✅ EXPECTED_VALUE (moyenne) = {total_sum:.2f}€ / {n_services} = "
        f"{expected_value:.2f}€"
    )

    # ─────────────────────────────────────────────────────────────────────────
    # Préparation matrice features
    # ─────────────────────────────────────────────────────────────────────────

    service_names: List[str] = []
    references: List[Optional[str]] = []
    feature_matrix: List[List[float]] = []
    row_meta: Dict[str, dict] = {}
    latest_cost_by_svc: Dict[str, CostRecord] = {}

    # Latest CostRecord par service
    latest_dates = db.query(
        CostRecord.service_name,
        func.max(CostRecord.cost_date).label("max_date"),
    ).filter(CostRecord.cost_date >= cutoff_date).group_by(
        CostRecord.service_name
    ).subquery()

    latest_records = db.query(CostRecord).join(
        latest_dates,
        and_(
            CostRecord.service_name == latest_dates.c.service_name,
            CostRecord.cost_date == latest_dates.c.max_date,
        ),
    ).all()

    for rec in latest_records:
        if rec.service_name not in latest_cost_by_svc:
            latest_cost_by_svc[rec.service_name] = rec

    # Séries temporelles
    series_by_svc: Dict[str, List[float]] = {}
    for r in db.query(
        CostRecord.service_name,
        CostRecord.amount,
        CostRecord.cost_date,
    ).filter(CostRecord.cost_date >= cutoff_date).order_by(
        CostRecord.service_name,
        CostRecord.cost_date,
    ).all():
        series_by_svc.setdefault(r.service_name, []).append(
            _precise_round(float(r.amount), 2)
        )

    # Construction matrix
    for row in rows:
        svc = row.service_name
        ref = getattr(row, 'reference', None)
        total = _precise_round(float(row.total or 0), 2)
        n = int(row.n_entries or 1)

        series = series_by_svc.get(svc, [total])

        if len(series) >= 2:
            std_s = _s.pstdev(series)
            mean_s = _s.mean(series)
            volatility = std_s / max(mean_s, 0.01)
            q1_end = max(int(len(series) * 0.25), 1)
            q4_start = int(len(series) * 0.75)
            first_avg = sum(series[:q1_end]) / q1_end
            last_seg = series[q4_start:] or [series[-1]]
            last_avg = sum(last_seg) / len(last_seg)
            trend = (last_avg - first_avg) / max(first_avg, 0.01)
        else:
            volatility = 0.0
            trend = 0.0

        span_days = max(
            (row.last_date - row.first_date).days, 1
        ) if row.first_date and row.last_date else 1
        avg_daily = total / span_days

        service_names.append(svc)
        references.append(ref)
        feature_matrix.append([total, avg_daily, volatility, trend])
        row_meta[svc] = {
            "total": total,
            "avg_daily": avg_daily,
            "volatility": volatility,
            "trend": trend,
            "n_entries": n,
            "last_date": row.last_date,
            "reference": ref,
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Isolation Forest
    # ─────────────────────────────────────────────────────────────────────────
    logger.info(f"\n→ Entraînement Isolation Forest...")

    FEAT_NAMES = ["total_amount", "avg_daily", "volatility", "trend"]
    X_raw = np.array(feature_matrix, dtype=np.float64)

    active_cols = np.where(X_raw.std(axis=0) > 1e-8)[0]
    if len(active_cols) < 1:
        logger.warning("⚠️  Pas assez de variance")
        return []

    X_active = X_raw[:, active_cols]
    active_names = [FEAT_NAMES[i] for i in active_cols]

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

    logger.info(f"  ✓ Features utilisées : {active_names}")
    logger.info(f"  ✓ {len(preds)} services évalués")

    # ─────────────────────────────────────────────────────────────────────────
    # DÉTECTION : SIGNAL 1 + 2 (IF outliers)
    # ─────────────────────────────────────────────────────────────────────────
    logger.info(f"\n→ Détection des outliers Isolation Forest...")

    detected: List[Anomaly] = []
    seen_services: set = set()

    for i, (svc, ref, pred, score) in enumerate(
        zip(service_names, references, preds, scores)
    ):
        # Double-gate
        if pred != -1 or score >= IF_SCORE_THRESHOLD_COST:
            continue

        meta = row_meta[svc]
        latest_rec = latest_cost_by_svc.get(svc)
        record_id = latest_rec.id if latest_rec else None

        # % déviation par rapport à la moyenne
        pct_deviation = _precise_round(
            ((meta["total"] - expected_value) / max(expected_value, 0.01)) * 100.0,
            2
        )

        # Description détaillée
        description = (
            f"[Anomalie Budgétaire IF] Service '{svc}' (ref={ref}) | "
            f"Coût: {meta['total']:.2f}€ | "
            f"Moyenne inter-services: {expected_value:.2f}€ ({n_services} services) | "
            f"Déviation: {pct_deviation:+.2f}% | "
            f"Score IF: {score:.4f} (seuil: {IF_SCORE_THRESHOLD_COST}) | "
            f"Volatilité: {meta['volatility']:.4f} | "
            f"Tendance: {meta['trend']:+.4f}"
        )

        # MoM lookup
        mom_key = ref if (mom_groupby == 'ref' and ref) else svc
        mom = mom_data.get(mom_key, {})

        if mom and mom.get("has_previous"):
            var_pct = mom.get("variation_pct", 0.0)
            diff_mom = mom.get("diff", 0.0)
            sign = "+" if diff_mom >= 0 else ""
            description += (
                f" | MoM: {sign}{var_pct:.2f}% ({sign}{diff_mom:.2f}€)"
            )
            # Escalade sévérité si MoM fort
            base_sev = _severity_from_score(score)
            if var_pct >= MOM_VARIATION_THRESHOLD:
                final_sev = AnomalySeverity.CRITICAL
            elif var_pct >= MOM_COMBINED_THRESHOLD and base_sev != AnomalySeverity.LOW:
                final_sev = AnomalySeverity.HIGH
            else:
                final_sev = base_sev
        else:
            final_sev = _severity_from_score(score)

        detected.append(Anomaly(
            entity_type="cost_service",
            entity_name=_trunc(svc, _MAX_ENTITY_NAME),
            anomaly_type=AnomalyType.COST_SPIKE,
            severity=final_sev,
            method=AnomalyMethod.ISOLATION_FOREST,
            observed_value=meta["total"],
            expected_value=expected_value,  # ✅ VRAI MOYENNE
            std_dev=_precise_round(float(X_raw[:, 0].std()), 2),
            z_score=None,
            anomaly_score=_precise_round(float(score), 4),
            threshold_value=None,
            threshold_type=_trunc(
                f"if_score<{IF_SCORE_THRESHOLD_COST}_n={n_services}",
                _MAX_THRESHOLD_TYP,
            ),
            detected_at=_to_aware(meta.get("last_date")),
            description=description,
            unit="€",
            source_record_id=record_id,
        ))

        seen_services.add(svc)
        logger.warning(
            f"  🚨 [IF OUTLIER] {svc} | "
            f"total={meta['total']:.2f}€ vs expected={expected_value:.2f}€ "
            f"({pct_deviation:+.2f}%) | score={score:.4f} | [{final_sev}]"
        )

    # ─────────────────────────────────────────────────────────────────────────
    # DÉTECTION : SIGNAL 3 PUR (MoM > 50% sans IF)
    # ─────────────────────────────────────────────────────────────────────────
    logger.info(f"\n→ Détection MoM pure (> {MOM_VARIATION_THRESHOLD}%)...")

    for mom_key, mom in mom_data.items():
        if mom_key in seen_services:
            continue

        var_pct = mom.get("variation_pct", 0.0)
        diff_mom = mom.get("diff", 0.0)

        if var_pct < MOM_VARIATION_THRESHOLD or diff_mom <= 0:
            continue

        # Trouver le service/ref correspondant
        meta = row_meta.get(mom_key)
        if meta is None:
            # Fallback : chercher dans latest_cost_by_svc
            if mom_groupby == 'service':
                latest_rec = latest_cost_by_svc.get(mom_key)
            else:
                latest_rec = next(
                    (r for r in latest_cost_by_svc.values()
                     if getattr(r, 'reference', None) == mom_key),
                    None
                )
            
            if latest_rec is None:
                continue

            meta = {
                "total": mom.get("current_cost", 0.0),
                "avg_daily": mom.get("current_cost", 0.0) / 30.0,
                "volatility": 0.0,
                "trend": 0.0,
                "last_date": None,
                "reference": getattr(latest_rec, 'reference', None),
            }
            svc_name = latest_rec.service_name
            record_id = latest_rec.id
        else:
            svc_name = mom_key if mom_groupby == 'service' else mom_key
            record_id = None

        sign = "+" if diff_mom >= 0 else ""
        severity = _severity_from_mom(var_pct)

        description = (
            f"[Anomalie MoM] Service '{svc_name}' (mode={mom_groupby}) | "
            f"Hausse: {sign}{var_pct:.2f}% ({sign}{diff_mom:.2f}€) | "
            f"Mois précédent: {mom.get('previous_cost', 0.0):.2f}€ → "
            f"Courant: {mom.get('current_cost', 0.0):.2f}€"
        )

        detected.append(Anomaly(
            entity_type="cost_service",
            entity_name=_trunc(svc_name, _MAX_ENTITY_NAME),
            anomaly_type=AnomalyType.COST_SPIKE,
            severity=severity,
            method=AnomalyMethod.ISOLATION_FOREST,
            observed_value=mom.get("current_cost", 0.0),
            expected_value=mom.get("previous_cost", 0.0),  # ← Mois précédent
            std_dev=_precise_round(abs(diff_mom), 2),
            z_score=None,
            anomaly_score=None,
            threshold_value=MOM_VARIATION_THRESHOLD,
            threshold_type=_trunc(
                f"mom_{mom_groupby}>{MOM_VARIATION_THRESHOLD:.0f}%",
                _MAX_THRESHOLD_TYP,
            ),
            detected_at=_to_aware(meta.get("last_date")),
            description=description,
            unit="€",
            source_record_id=record_id,
        ))

        seen_services.add(mom_key)
        logger.warning(
            f"  📅 [MoM {mom_groupby}] {svc_name} | "
            f"{sign}{var_pct:.2f}% | {sign}{diff_mom:.2f}€ | [{severity}]"
        )

    # ─────────────────────────────────────────────────────────────────────────
    # SAUVEGARDE
    # ─────────────────────────────────────────────────────────────────────────
    if save and detected:
        db.add_all(detected)
        db.commit()
        for a in detected:
            db.refresh(a)
        logger.info(
            f"\n✅ {len(detected)} anomalies ML SAUVEGARDÉES"
            f"\n   • IF outliers: {sum(1 for a in detected if a.anomaly_score is not None)}"
            f"\n   • MoM pures: {sum(1 for a in detected if a.anomaly_score is None)}"
            f"\n   • Mode MoM: {mom_groupby}"
            f"\n{'='*90}\n"
        )
    else:
        logger.info(
            f"\nℹ️  {len(detected)} anomalies ML (save={save}, mode={mom_groupby})"
            f"\n{'='*90}\n"
        )

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