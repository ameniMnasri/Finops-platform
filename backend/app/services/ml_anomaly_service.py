"""
ml_anomaly_service.py — Détection ML FinOps v9
═══════════════════════════════════════════════════════════════════════════════

DIAGNOSTIC — Pourquoi les anomalies affichent 0.00€ partout (image 1) :

  BUG A — Isolation Forest entraîné sur des entités à current_cost=0
    En mode 'ref', beaucoup de refs ont cost_current=0 (elles existent en
    février mais pas en mars → COST_DROP). IF se retrouve à entraîner sur
    une population où la majorité est à 0€, ce qui fait que les refs
    "normales" à 25€ ressortent comme outliers avec observed_value=0€.
    FIX : IF n'est entraîné QUE sur les entités actives (current_cost > 0).
    Les entités à 0€ sont détectées séparément via MoM (COST_DROP).

  BUG B — data_gap_risk déclenché trop largement
    DATA_GAP_DAY=10 → on est le 19 avril → la garde ne s'applique pas.
    Mais les entités à current=0 héritent quand même du statut qui envoie
    "Données manquantes" dans le JSX (isDataGap = observed==0 et expected>0).
    FIX : observed_value = current_cost (valeur réelle du mois M).
    Le flag is_cost_drop dans la description permet au JSX de l'interpréter
    correctement comme une disparition, pas un gap.

  BUG C — Mélange granularité service vs référence (image 2)
    Service "4x SSD NVMe 960GB Soft RAID" :
      ref ns3252628 → mars: 4.73€,  fév: 24.44€   (niveau ref)
      ref ns3260605 → mars: 25.71€, fév: 25.73€   (niveau ref)
      total service → mars: 30.44€, fév: 50.18€   (niveau service)
    En mode='service' : observed=30.44, expected=50.18 → MoM=-39.4% ✅
    En mode='ref'    : observed=4.73,  expected=24.44  → MoM=-80.6% ✅
    Le BUG était de comparer observed(ref) avec expected(service).
    FIX : _query_month_totals() utilise toujours le même group_col.

  BUG D — cur_end = today coupe le mois en cours
    Toujours documenté, pas corrigé (comportement voulu pour avoir
    les données à jour). Limitation : le mois en cours est partiel.

ARCHITECTURE v9 :
  1. MoM mensuel strict (même scope garanti)
  2. Séparation : actifs (current>0) / disparus / nouveaux
  3. IF sur actifs uniquement
  4. MoM pur sur disparus (COST_DROP) et spikes non IF
  5. Validation cohérence
"""

from __future__ import annotations

import logging
import statistics as _s
from datetime import datetime, timedelta, timezone, date
from calendar import monthrange
from typing import List, Optional, Dict, Tuple
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.orm import Session
from sqlalchemy import func, and_

from app.models.anomaly import Anomaly, AnomalyType, AnomalySeverity, AnomalyMethod
from app.models.cost import CostRecord

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
# ⚙️ CONFIGURATION
# ────────────────────────────────────────────────────────────────────────────

MIN_ENTITIES_FOR_IF     = 3
IF_SCORE_THRESHOLD      = -0.08
MOM_SPIKE_THRESHOLD     = 50.0    # % pour MoM pur spike
NEW_COST_MIN_EUR        = 10.0    # montant min pour alerter sur nouveau service
DATA_GAP_DAY            = 5       # avant ce jour du mois, current=0 peut être un gap

# ── Garde faux positifs IF ────────────────────────────────────────────────────
IF_MIN_DIFF_EUR         = 2.0     # € — diff |cur - prev| minimum pour alerter
IF_MIN_MOM_PCT          = 5.0     # % — |MoM%| minimum pour alerter

# ── Garde historique insuffisant ──────────────────────────────────────────────
# Un service sans historique (volatilité=0, previous=0) est exclu de IF :
# IF l'isolerait facilement non pas parce qu'il est anormal,
# mais parce qu'il n'a pas de voisins comparables.
# On le détecte via MoM pur (NEW_COST) à la place.
IF_MIN_PREVIOUS_EUR     = 1.0     # € — previous_cost minimum pour entrer dans IF

# ── Détection prorata MoM ─────────────────────────────────────────────────────
PRORATA_RATIO_THRESHOLD = 0.6     # si prev < 60% de M-2 → suspect prorata → ref=M-2

# ── Garde couverture mois courant ────────────────────────────────────────────
# Si le mois courant a moins de MIN_COVERAGE_PCT % des entités du mois
# précédent, on considère que les données ne sont pas encore disponibles
# et on skip toute détection MoM pour éviter les faux DROP.
# Ex : avril a 0 entrées / mars en avait 82 → coverage=0% → skip.
MIN_COVERAGE_PCT        = 20.0    # % minimum d'entités courantes vs précédentes
# Nombre minimum absolu d'entités dans le mois courant pour déclencher MoM.
# Évite les faux positifs quand seulement 1-2 lignes sont déjà facturées.
MIN_CURRENT_ENTITIES    = 3

_MAX_ENTITY_NAME        = 60
_MAX_THRESHOLD_TYP      = 60


# ────────────────────────────────────────────────────────────────────────────
# HELPERS
# ────────────────────────────────────────────────────────────────────────────

def _r(v: float, d: int = 2) -> float:
    if v is None:
        return 0.0
    return float(Decimal(str(float(v))).quantize(
        Decimal(10) ** -d, rounding=ROUND_HALF_UP
    ))


def _trunc(s: str, n: int) -> str:
    return s[:n - 1] + "…" if s and len(s) > n else (s or "")


def _load_sklearn():
    try:
        from sklearn.ensemble import IsolationForest
        from sklearn.preprocessing import RobustScaler
        import numpy as np
        return IsolationForest, RobustScaler, np
    except ImportError as e:
        raise ImportError("pip install scikit-learn numpy") from e


def _to_aware(dt) -> datetime:
    if isinstance(dt, datetime):
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    if hasattr(dt, 'year'):
        return datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def _sev_score(score: float) -> AnomalySeverity:
    if score < -0.25: return AnomalySeverity.CRITICAL
    if score < -0.18: return AnomalySeverity.HIGH
    if score < -0.13: return AnomalySeverity.MEDIUM
    return AnomalySeverity.LOW


def _sev_pct(pct: float) -> AnomalySeverity:
    a = abs(pct)
    if a >= 200: return AnomalySeverity.CRITICAL
    if a >= 100: return AnomalySeverity.HIGH
    if a >= 50:  return AnomalySeverity.MEDIUM
    return AnomalySeverity.LOW


# ────────────────────────────────────────────────────────────────────────────
# BORNES MENSUELLES
# ────────────────────────────────────────────────────────────────────────────

def _get_month_bounds() -> Tuple[date, date, date, date]:
    """
    cur  = [1er du mois courant, aujourd'hui]   ← mois partiel si en cours
    prev = [1er du mois précédent, dernier jour du mois précédent]  ← complet
    """
    today     = datetime.now(timezone.utc).date()
    cur_start = today.replace(day=1)
    cur_end   = today

    prev_year  = cur_start.year  if cur_start.month > 1 else cur_start.year - 1
    prev_month = cur_start.month - 1 if cur_start.month > 1 else 12
    prev_start = date(prev_year, prev_month, 1)
    prev_end   = date(prev_year, prev_month, monthrange(prev_year, prev_month)[1])

    return cur_start, cur_end, prev_start, prev_end


def _get_m2_bounds() -> Tuple[date, date]:
    """Retourne [1er, dernier] du mois M-2 (deux mois avant aujourd'hui)."""
    today     = datetime.now(timezone.utc).date()
    cur_start = today.replace(day=1)
    y1 = cur_start.year  if cur_start.month > 1 else cur_start.year - 1
    m1 = cur_start.month - 1 if cur_start.month > 1 else 12
    y2 = y1 if m1 > 1 else y1 - 1
    m2 = m1 - 1 if m1 > 1 else 12
    return date(y2, m2, 1), date(y2, m2, monthrange(y2, m2)[1])


def _apply_prorata_fallback(
    prev_map: Dict[str, float],
    m2_map:   Dict[str, float],
    label:    str = "",
) -> Tuple[Dict[str, float], set]:
    """
    Si M-1 < PRORATA_RATIO_THRESHOLD * M-2 pour un service,
    remplace M-1 par M-2 comme référence MoM.
    Ex : M-2=164€, M-1=58€ → ratio=0.35 < 0.6 → prorata détecté → ref=M-2.
    """
    corrected = dict(prev_map)
    patched   = set()
    for key, prev_val in prev_map.items():
        m2_val = m2_map.get(key, 0.0)
        if m2_val > 0 and prev_val > 0:
            ratio = prev_val / m2_val
            if ratio < PRORATA_RATIO_THRESHOLD:
                corrected[key] = m2_val
                patched.add(key)
                logger.info(
                    "  🔄 [PRORATA %s] %s | M-1=%.2f€ M-2=%.2f€ ratio=%.2f "
                    "< %.2f → référence MoM remplacée par M-2",
                    label, key, prev_val, m2_val, ratio, PRORATA_RATIO_THRESHOLD,
                )
    if patched:
        logger.info("  ✅ [PRORATA %s] %d clé(s) corrigée(s)", label, len(patched))
    return corrected, patched


def _is_data_gap_risk() -> bool:
    return datetime.now(timezone.utc).day < DATA_GAP_DAY


def _check_current_coverage(
    cur_map:  Dict[str, float],
    prev_map: Dict[str, float],
    label:    str = "",
) -> Tuple[bool, float]:
    """
    Vérifie si le mois courant a suffisamment de données pour comparer avec M-1.

    Retourne (ok: bool, coverage_pct: float).

    Règles :
    • Si cur_map est vide                         → coverage=0%  → NOK
    • Si n_current < MIN_CURRENT_ENTITIES         → NOK  (trop tôt)
    • Si n_current / n_previous < MIN_COVERAGE_PCT% → NOK  (données partielles)
    • Sinon                                       → OK

    Distingue trois cas :
      1. no_data      : cur_map totalement vide (facturation pas encore arrivée)
      2. partial_data : quelques lignes présentes mais couverture insuffisante
      3. sufficient   : couverture >= seuil -> comparaison fiable
    """
    n_cur  = len(cur_map)
    n_prev = len(prev_map)

    if n_prev == 0:
        # Pas de référence passée -> on ne peut pas juger
        logger.warning("  ⚠️ [COVERAGE %s] Aucune donnée M-1 — MoM impossible", label)
        return False, 0.0

    if n_cur == 0:
        logger.warning(
            "  🚫 [COVERAGE %s] Mois courant VIDE (0 entités) — "
            "données pas encore disponibles — MoM IGNORÉ",
            label,
        )
        return False, 0.0

    coverage_pct = (n_cur / n_prev) * 100.0

    if n_cur < MIN_CURRENT_ENTITIES:
        logger.warning(
            "  🚫 [COVERAGE %s] %d entités courantes < %d min — "
            "trop tôt pour comparer (couverture=%.1f%%) — MoM IGNORÉ",
            label, n_cur, MIN_CURRENT_ENTITIES, coverage_pct,
        )
        return False, coverage_pct

    if coverage_pct < MIN_COVERAGE_PCT:
        logger.warning(
            "  🚫 [COVERAGE %s] Couverture %.1f%% < %.1f%% min "
            "(%d/%d entités) — données partielles — MoM IGNORÉ",
            label, coverage_pct, MIN_COVERAGE_PCT, n_cur, n_prev,
        )
        return False, coverage_pct

    logger.info(
        "  ✅ [COVERAGE %s] Couverture %.1f%% (%d/%d entités) — MoM activé",
        label, coverage_pct, n_cur, n_prev,
    )
    return True, coverage_pct


# ────────────────────────────────────────────────────────────────────────────
# REQUÊTE AGRÉGATION MENSUELLE
# ────────────────────────────────────────────────────────────────────────────

def _query_month_totals(
    db:          Session,
    group_col,
    start:       date,
    end:         date,
    extra_filter = None,
) -> Dict[str, float]:
    """
    Somme les montants sur [start, end] groupés par group_col.
    RÈGLE : group_col doit toujours être le même niveau (service OU ref).
    current=0.00€ est une valeur valide et est conservée.
    """
    q = (
        db.query(group_col, func.sum(CostRecord.amount).label("total"))
          .filter(and_(CostRecord.cost_date >= start, CostRecord.cost_date <= end))
    )
    if extra_filter is not None:
        q = q.filter(extra_filter)

    out = {}
    for row in q.group_by(group_col).all():
        key = str(row[0]).strip() if row[0] else None
        if key:
            out[key] = _r(float(row[1] or 0))
    return out


# ────────────────────────────────────────────────────────────────────────────
# CALCUL MoM
# ────────────────────────────────────────────────────────────────────────────

def _mom_entry(
    key:          str,
    current:      float,
    previous:     float,
    data_gap_risk: bool,
) -> dict:
    """
    Calcule une entrée MoM avec statut explicite.

    Tableau des états :
    ┌───────────────────────────────────────────────────────────────────┐
    │ previous=0, current>0  → NEW_COST   (nouveau service)            │
    │ previous>0, current=0  → COST_DROP  (service disparu)            │
    │ previous>0, current=0, early month → DATA_GAP (pas encore factu) │
    │ previous=0, current=0  → INACTIVE   (ignoré)                     │
    │ previous>0, current>0  → CHANGED    (variation normale ou spike)  │
    └───────────────────────────────────────────────────────────────────┘

    IMPORTANT : current=0.00€ est une valeur RÉELLE (COST_DROP).
    Ce n'est PAS "données manquantes". Les deux cas sont distingués
    par le flag is_data_gap vs is_cost_drop.
    """
    diff = _r(current - previous)

    if previous > 0:
        variation_pct = _r((diff / previous) * 100.0)
    elif current > 0:
        variation_pct = None   # NEW_COST : pas de base
    else:
        variation_pct = None   # INACTIVE

    if previous <= 0 and current > 0:
        status = "new"
    elif previous > 0 and current <= 0:
        status = "data_gap" if data_gap_risk else "disappeared"
    elif previous <= 0 and current <= 0:
        status = "inactive"
    else:
        status = "changed"

    return {
        "key":           key,
        "current_cost":  current,
        "previous_cost": previous,
        "diff":          diff,
        "variation_pct": variation_pct,
        "has_previous":  previous > 0,
        "status":        status,
        "is_data_gap":   status == "data_gap",
        "is_cost_drop":  status == "disappeared",
        "is_new_cost":   status == "new",
    }


def _build_mom_map(
    current_map:  Dict[str, float],
    previous_map: Dict[str, float],
    data_gap:     bool,
    label:        str = "",
) -> Dict[str, dict]:
    all_keys = set(current_map) | set(previous_map)
    result   = {}
    counts   = {"new": 0, "disappeared": 0, "data_gap": 0, "changed": 0, "inactive": 0}

    for key in sorted(all_keys):
        entry = _mom_entry(
            key,
            current_map.get(key, 0.0),
            previous_map.get(key, 0.0),
            data_gap,
        )
        result[key] = entry
        counts[entry["status"]] = counts.get(entry["status"], 0) + 1

    logger.info(
        "  [MoM %s] %d total | new=%d changed=%d disappeared=%d data_gap=%d inactive=%d",
        label, len(result),
        counts["new"], counts["changed"], counts["disappeared"],
        counts["data_gap"], counts["inactive"],
    )
    return result


def compute_mom_per_service(
    db:             Session,
    service_filter: Optional[str] = None,
    verbose:        bool = True,
) -> Dict[str, dict]:
    """MoM groupé par SERVICE_NAME. Scope identique pour current et previous."""
    cur_start, cur_end, prev_start, prev_end = _get_month_bounds()
    m2_start, m2_end = _get_m2_bounds()
    data_gap = _is_data_gap_risk()

    extra = CostRecord.service_name.ilike(f"%{service_filter}%") if service_filter else None

    cur_map  = _query_month_totals(db, CostRecord.service_name, cur_start,  cur_end,  extra)
    prev_map = _query_month_totals(db, CostRecord.service_name, prev_start, prev_end, extra)
    m2_map   = _query_month_totals(db, CostRecord.service_name, m2_start,   m2_end,   extra)

    if verbose:
        logger.info(
            "📅 [MoM SERVICE] cur=%s→%s (%d) | prev=%s→%s (%d) | m2=%s→%s (%d)",
            cur_start, cur_end, len(cur_map),
            prev_start, prev_end, len(prev_map),
            m2_start, m2_end, len(m2_map),
        )

    ok, _ = _check_current_coverage(cur_map, prev_map, "SERVICE")
    if not ok:
        return {}

    prev_map, _ = _apply_prorata_fallback(prev_map, m2_map, "SERVICE")
    return _build_mom_map(cur_map, prev_map, data_gap, "SERVICE")


def compute_mom_per_ref(
    db:             Session,
    service_filter: Optional[str] = None,
    verbose:        bool = True,
) -> Dict[str, dict]:
    """MoM groupé par RÉFÉRENCE. Comparaison 1-to-1 pour la même ref."""
    cur_start, cur_end, prev_start, prev_end = _get_month_bounds()
    m2_start, m2_end = _get_m2_bounds()
    data_gap = _is_data_gap_risk()

    ref_ok = and_(CostRecord.reference.isnot(None), CostRecord.reference != "")
    if service_filter:
        svc_f  = CostRecord.service_name.ilike(f"%{service_filter}%")
        cur_f  = and_(ref_ok, svc_f)
        prev_f = and_(ref_ok, svc_f)
    else:
        cur_f = prev_f = ref_ok

    cur_map  = _query_month_totals(db, CostRecord.reference, cur_start,  cur_end,  cur_f)
    prev_map = _query_month_totals(db, CostRecord.reference, prev_start, prev_end, prev_f)
    m2_map   = _query_month_totals(db, CostRecord.reference, m2_start,   m2_end,   prev_f)

    if verbose:
        logger.info(
            "📅 [MoM REF] cur=%s→%s (%d) | prev=%s→%s (%d) | m2=%s→%s (%d)",
            cur_start, cur_end, len(cur_map),
            prev_start, prev_end, len(prev_map),
            m2_start, m2_end, len(m2_map),
        )

    ok, _ = _check_current_coverage(cur_map, prev_map, "REF")
    if not ok:
        return {}

    prev_map, _ = _apply_prorata_fallback(prev_map, m2_map, "REF")
    return _build_mom_map(cur_map, prev_map, data_gap, "REF")


# ────────────────────────────────────────────────────────────────────────────
# ENRICHISSEMENT SÉRIES TEMPORELLES
# ────────────────────────────────────────────────────────────────────────────

def _enrich_time_series(
    entities:  Dict[str, dict],
    db:        Session,
    cutoff:    date,
    group_col,
) -> None:
    """Ajoute volatility, trend, last_date à chaque entité. N'affecte pas observed/expected."""
    series:    Dict[str, List[float]] = {}
    last_date: Dict[str, date]        = {}

    for row in db.query(
        group_col, CostRecord.amount, CostRecord.cost_date,
    ).filter(
        and_(CostRecord.cost_date >= cutoff, CostRecord.amount.isnot(None))
    ).order_by(group_col, CostRecord.cost_date).all():
        k = str(row[0]).strip() if row[0] else None
        if not k or k not in entities:
            continue
        series.setdefault(k, []).append(_r(float(row[1])))
        d = row[2] if isinstance(row[2], date) else row[2].date()
        if k not in last_date or d > last_date[k]:
            last_date[k] = d

    for key, meta in entities.items():
        s = series.get(key, [meta["current_cost"]])
        meta["last_date"] = last_date.get(key)
        if len(s) >= 2:
            mean_s = _s.mean(s) or 0.01
            vol    = _s.pstdev(s) / mean_s
            q1     = max(int(len(s) * 0.25), 1)
            q4     = int(len(s) * 0.75)
            f_avg  = sum(s[:q1]) / q1
            l_seg  = s[q4:] or [s[-1]]
            l_avg  = sum(l_seg) / len(l_seg)
            trend  = (l_avg - f_avg) / max(f_avg, 0.01)
        else:
            vol, trend = 0.0, 0.0
        meta["volatility"] = _r(vol, 4)
        meta["trend"]      = _r(trend, 4)


# ────────────────────────────────────────────────────────────────────────────
# ISOLATION FOREST — ACTIFS UNIQUEMENT
# ────────────────────────────────────────────────────────────────────────────

def _run_if(entities: Dict[str, dict], n_estimators: int) -> Dict[str, float]:
    """
    Entraîne IF UNIQUEMENT sur les entités avec current_cost > 0
    ET un historique suffisant (previous_cost > IF_MIN_PREVIOUS_EUR).

    Pourquoi exclure les services sans historique ?
    Un service avec previous=0 et volatility=0 (un seul point connu)
    est facilement isolé par IF non pas parce qu'il est anormal,
    mais parce qu'il n'a aucun voisin comparable dans l'espace des features.
    Ces services sont détectés via MoM pur (NEW_COST) à la place.

    Features : [cost_current, cost_previous, mom_diff, mom_pct_norm, volatility, trend]
    """
    IsolationForest, RobustScaler, np = _load_sklearn()

    active = {
        k: v for k, v in entities.items()
        if v["current_cost"] > 0
        and v["status"] not in ("inactive", "data_gap")
        and v["previous_cost"] >= IF_MIN_PREVIOUS_EUR   # ← exclut les sans-historique
    }

    skipped_no_history = [
        k for k, v in entities.items()
        if v["current_cost"] > 0
        and v["status"] not in ("inactive", "data_gap")
        and v["previous_cost"] < IF_MIN_PREVIOUS_EUR
    ]
    if skipped_no_history:
        logger.info(
            "  ⏭️  [IF SKIP no-history] %d service(s) exclus (previous < %.1f€) : %s",
            len(skipped_no_history), IF_MIN_PREVIOUS_EUR,
            ", ".join(skipped_no_history[:5]),
        )

    if len(active) < MIN_ENTITIES_FOR_IF:
        logger.warning("  ⚠️ [IF] %d entités actives < %d min — IF ignoré", len(active), MIN_ENTITIES_FOR_IF)
        return {}

    keys = list(active.keys())
    X    = np.array([
        [
            m["current_cost"],
            m["previous_cost"],
            m["diff"],
            (m["variation_pct"] or 0.0) / 100.0,
            m["volatility"],
            m["trend"],
        ]
        for m in active.values()
    ], dtype=np.float64)

    active_cols = np.where(X.std(axis=0) > 1e-8)[0]
    if len(active_cols) == 0:
        logger.warning("  ⚠️ [IF] Variance nulle — IF ignoré")
        return {}

    X_s    = RobustScaler().fit_transform(X[:, active_cols])
    clf    = IsolationForest(n_estimators=n_estimators, contamination="auto",
                             random_state=42, bootstrap=True)
    preds  = clf.fit_predict(X_s)
    scores = clf.score_samples(X_s)

    logger.info("  ✓ [IF] %d actifs | %d outliers bruts | seuil=%.2f",
                len(active), sum(p == -1 for p in preds), IF_SCORE_THRESHOLD)

    result = {}
    for i in range(len(keys)):
        if preds[i] != -1 or scores[i] >= IF_SCORE_THRESHOLD:
            continue
        meta     = active[keys[i]]
        diff_eur = abs(meta.get("diff", 0.0))
        mom_pct  = abs(meta.get("variation_pct") or 0.0)
        # Garde diff négligeable : score IF négatif mais coût quasi-stable
        if diff_eur < IF_MIN_DIFF_EUR and mom_pct < IF_MIN_MOM_PCT:
            logger.info(
                "  ⏭️  [IF SKIP negligible] %s | score=%.4f diff=%.2f€ mom=%.2f%% "
                "→ volatilité historique, pas une anomalie budgétaire",
                keys[i], scores[i], diff_eur, mom_pct,
            )
            continue
        result[keys[i]] = float(scores[i])
        logger.warning("  🚨 [IF] %s | cur=%.2f€ | score=%.4f | diff=%.2f€ | mom=%.1f%%",
                       keys[i], meta["current_cost"], scores[i], diff_eur, mom_pct)

    return result


# ────────────────────────────────────────────────────────────────────────────
# LOOKUP LATEST RECORD
# ────────────────────────────────────────────────────────────────────────────

def _latest_records(
    db:        Session,
    group_col,
    cutoff:    date,
) -> Dict[str, CostRecord]:
    sub = (
        db.query(group_col, func.max(CostRecord.cost_date).label("max_d"))
          .filter(CostRecord.cost_date >= cutoff)
          .group_by(group_col)
          .subquery()
    )
    out = {}
    for rec in db.query(CostRecord).join(
        sub,
        and_(group_col == sub.c[group_col.key], CostRecord.cost_date == sub.c.max_d),
    ).all():
        k = getattr(rec, group_col.key, None)
        if k:
            ks = str(k).strip()
            if ks not in out:
                out[ks] = rec
    return out


# ────────────────────────────────────────────────────────────────────────────
# CONSTRUCTION DES ANOMALIES
# ────────────────────────────────────────────────────────────────────────────

def _if_anomaly(
    key:       str,
    meta:      dict,
    score:     float,
    rec:       Optional[CostRecord],
    groupby:   str,
    n:         int,
    std_dev:   float,
) -> Anomaly:
    cur  = meta["current_cost"]     # ← mois M (jamais la fenêtre 90j)
    prv  = meta["previous_cost"] if meta["has_previous"] else None
    pct  = meta.get("variation_pct")
    diff = meta.get("diff", 0.0)
    sign = "+" if diff >= 0 else ""

    sev = _sev_score(score)
    if pct is not None and abs(pct) >= 100: sev = AnomalySeverity.CRITICAL
    elif pct is not None and abs(pct) >= 50 and sev != AnomalySeverity.LOW:
        sev = AnomalySeverity.HIGH

    ref_str = getattr(rec, "reference", key) if rec else key
    parts = [
        f"[Anomalie Budgétaire IF] Service '{key}' (mode={groupby})",
        f"ref={ref_str}",
        f"Coût: {cur:.2f}€",
        f"Score IF: {score:.4f} (seuil: {IF_SCORE_THRESHOLD})",
        f"Volatilité: {meta['volatility']:.4f}",
        f"Tendance: {meta['trend']:+.4f}",
    ]
    if prv is not None:
        if pct is not None:
            parts.append(f"MoM: {sign}{pct:.2f}% ({sign}{diff:.2f}€, prev={prv:.2f}€ → cur={cur:.2f}€)")
        else:
            parts.append(f"MoM: NEW (prev={prv:.2f}€ → cur={cur:.2f}€)")

    tt = _trunc(f"if_score<{IF_SCORE_THRESHOLD}_n={n}_mom={groupby}", _MAX_THRESHOLD_TYP)

    return Anomaly(
        entity_type      = "cost_ref" if groupby == "ref" else "cost_service",
        entity_name      = _trunc(key, _MAX_ENTITY_NAME),
        anomaly_type     = AnomalyType.COST_SPIKE,
        severity         = sev,
        method           = AnomalyMethod.ISOLATION_FOREST,
        observed_value   = cur,    # ✅ mois M uniquement
        expected_value   = prv,    # ✅ mois M-1 même scope
        std_dev          = _r(std_dev),
        z_score          = None,
        anomaly_score    = _r(score, 4),
        threshold_value  = None,
        threshold_type   = tt,
        detected_at      = _to_aware(meta.get("last_date")),
        description      = " | ".join(parts),
        unit             = "€",
        source_record_id = rec.id if rec else None,
    )


def _mom_anomaly(
    key:     str,
    mom:     dict,
    rec:     Optional[CostRecord],
    groupby: str,
    kind:    str,   # "SPIKE" | "DROP" | "NEW"
) -> Anomaly:
    cur  = mom["current_cost"]
    prv  = mom["previous_cost"]
    pct  = mom.get("variation_pct")
    diff = mom.get("diff", 0.0)
    sign = "+" if diff >= 0 else ""

    if kind == "DROP":
        tag = "Chute MoM"
        sev = AnomalySeverity.HIGH if prv > 50 else AnomalySeverity.MEDIUM
    elif kind == "NEW":
        tag = "Nouveau Coût"
        sev = AnomalySeverity.MEDIUM
    else:
        tag = "Hausse MoM"
        sev = _sev_pct(pct or 0)

    desc = (
        f"[{tag}] '{key}' (mode={groupby}) | "
        + (f"{sign}{pct:.2f}% ({sign}{diff:.2f}€) | " if pct is not None else "NOUVEAU | ")
        + f"prev={prv:.2f}€ → cur={cur:.2f}€"
    )
    tt = _trunc(f"mom_{groupby}>{MOM_SPIKE_THRESHOLD:.0f}%", _MAX_THRESHOLD_TYP)

    return Anomaly(
        entity_type      = "cost_ref" if groupby == "ref" else "cost_service",
        entity_name      = _trunc(key, _MAX_ENTITY_NAME),
        anomaly_type     = AnomalyType.COST_SPIKE,
        severity         = sev,
        method           = AnomalyMethod.ISOLATION_FOREST,
        observed_value   = cur,
        expected_value   = prv if prv > 0 else None,
        std_dev          = _r(abs(diff)),
        z_score          = None,
        anomaly_score    = None,
        threshold_value  = MOM_SPIKE_THRESHOLD,
        threshold_type   = tt,
        detected_at      = _to_aware(rec.cost_date if rec else None),
        description      = desc,
        unit             = "€",
        source_record_id = rec.id if rec else None,
    )


# ────────────────────────────────────────────────────────────────────────────
# PIPELINE PRINCIPALE
# ────────────────────────────────────────────────────────────────────────────

def detect_cost_anomalies_ml(
    db:             Session,
    service_filter: Optional[str] = None,
    n_estimators:   int   = 200,
    window_days:    int   = 90,
    save:           bool  = True,
    mom_groupby:    str   = "service",
) -> List[Anomaly]:
    """
    Pipeline de détection d'anomalies FinOps.

    Étapes :
    1. MoM mensuel strict (current = mois M, previous = mois M-1, même scope)
    2. IF sur actifs uniquement (current_cost > 0)
    3. MoM pur : COST_DROP (current=0), SPIKE (>50%), NEW_COST
    4. Sauvegarde
    """
    logger.info(
        "\n%s\n💰 [FinOps v9] n_est=%d | win=%dj | mode=%s | filtre=%s\n%s",
        "=" * 90, n_estimators, window_days, mom_groupby,
        service_filter or "—", "=" * 90,
    )

    cutoff    = (datetime.now(timezone.utc) - timedelta(days=window_days)).date()
    group_col = CostRecord.reference if mom_groupby == "ref" else CostRecord.service_name

    # ── 1. MoM mensuel strict ─────────────────────────────────────────────
    logger.info("\n→ [1] MoM mode='%s'...", mom_groupby)
    mom_data = (
        compute_mom_per_ref(db, service_filter=service_filter)
        if mom_groupby == "ref"
        else compute_mom_per_service(db, service_filter=service_filter)
    )
    if not mom_data:
        logger.warning(
            "  ⏭️  [MoM SKIP] Aucune donnée suffisante pour le mois courant "
            "(couverture insuffisante ou données pas encore disponibles) — "
            "0 anomalie générée pour éviter les faux DROP."
        )
        return []

    # ── 2. Entities (hors inactive) ───────────────────────────────────────
    logger.info("\n→ [2] Construction entities...")
    entities: Dict[str, dict] = {
        k: {**m, "volatility": 0.0, "trend": 0.0, "last_date": None}
        for k, m in mom_data.items()
        if m["status"] != "inactive"
    }
    logger.info("  %d entités (hors inactive)", len(entities))

    # ── 3. Enrichissement time-series ─────────────────────────────────────
    logger.info("\n→ [3] Time-series enrichment (fenêtre %dj)...", window_days)
    _enrich_time_series(entities, db, cutoff, group_col)

    # ── 4. Isolation Forest ───────────────────────────────────────────────
    logger.info("\n→ [4] Isolation Forest...")
    if_scores = _run_if(entities, n_estimators)

    active_costs = [m["current_cost"] for m in entities.values() if m["current_cost"] > 0]
    std_dev_ref  = _s.pstdev(active_costs) if len(active_costs) >= 2 else 0.0
    n_active     = len(active_costs)

    latest = _latest_records(db, group_col, cutoff)
    detected: List[Anomaly] = []
    seen:     set            = set()

    for key, score in if_scores.items():
        a = _if_anomaly(key, entities[key], score, latest.get(key), mom_groupby, n_active, std_dev_ref)
        detected.append(a)
        seen.add(key)
        logger.warning("  🚨 [IF] %s | cur=%.2f€ | score=%.4f | %s",
                       key, entities[key]["current_cost"], score, a.severity)

    # ── 5. MoM pur ────────────────────────────────────────────────────────
    logger.info("\n→ [5] MoM pur (DROP / SPIKE / NEW)...")
    for key, mom in mom_data.items():
        if key in seen:
            continue
        status = mom["status"]
        pct    = mom.get("variation_pct")
        rec    = latest.get(key)

        if status == "disappeared":
            a = _mom_anomaly(key, mom, rec, mom_groupby, "DROP")
            detected.append(a)
            seen.add(key)
            logger.warning("  📉 [DROP] %s | prev=%.2f€ → 0€", key, mom["previous_cost"])

        elif status == "changed" and pct is not None and pct >= MOM_SPIKE_THRESHOLD and mom["diff"] > 0:
            a = _mom_anomaly(key, mom, rec, mom_groupby, "SPIKE")
            detected.append(a)
            seen.add(key)
            logger.warning("  📈 [SPIKE] %s | +%.1f%%", key, pct)

        elif status == "new" and mom["current_cost"] >= NEW_COST_MIN_EUR:
            a = _mom_anomaly(key, mom, rec, mom_groupby, "NEW")
            detected.append(a)
            seen.add(key)
            logger.info("  🆕 [NEW] %s | %.2f€", key, mom["current_cost"])

    # ── 6. Sauvegarde ─────────────────────────────────────────────────────
    if save and detected:
        db.add_all(detected)
        db.commit()
        for a in detected:
            db.refresh(a)

    n_if  = sum(1 for a in detected if a.anomaly_score is not None)
    n_mom = len(detected) - n_if
    logger.info(
        "\n%s\n✅ %d anomalies (IF=%d, MoM=%d) | mode=%s\n%s\n",
        "=" * 90, len(detected), n_if, n_mom, mom_groupby, "=" * 90,
    )
    return detected


# ────────────────────────────────────────────────────────────────────────────
# POINT D'ENTRÉE FASTAPI
# ────────────────────────────────────────────────────────────────────────────

def detect_resource_anomalies_ml(
    db:            Session,
    server_filter: Optional[str] = None,
    contamination: float = 0.05,
    n_estimators:  int   = 200,
    window_days:   int   = 90,
    save:          bool  = True,
    mom_groupby:   str   = "service",
) -> List[Anomaly]:
    """Délègue à detect_cost_anomalies_ml."""
    return detect_cost_anomalies_ml(
        db             = db,
        service_filter = server_filter,
        n_estimators   = n_estimators,
        window_days    = window_days,
        save           = save,
        mom_groupby    = mom_groupby,
    )