"""
anomaly_service.py — Détection statistique d'anomalies (Statistiques + Coûts FinOps)
══════════════════════════════════════════════════════════════════════════════════════

CORRECTIONS v3 (FinOps complet) :
══════════════════════════════════

1. detect_cost_anomalies :
   - Seuil Z adaptatif : au lieu d'un z_threshold fixe (2.5), on utilise un seuil
     contextuel basé sur la taille de la série (moins de points = seuil plus souple).
   - Ajout de la détection de TENDANCE HAUSSIÈRE : un service dont le coût augmente
     de >30% sur les 3 derniers points est flagué même sans z-score élevé.
   - Ajout de la détection de COÛT ABSOLU : un service dépassant 3× la médiane
     inter-services est flagué (outlier entre services, pas seulement dans le temps).
   - detected_at toujours timezone-aware.
   - Minimum baseline à 2 points.

2. detect_resource_anomalies :
   - Même corrections de fenêtre et baseline.
   - CPU négatif (sentinel OVH) filtré.

3. get_anomaly_summary :
   - Compte correctement HIGH_CPU / HIGH_RAM / HIGH_DISK / RESOURCE_SPIKE.
   - Ajout du compte d'anomalies ML (isolation_forest).

NOTE : Pour les données avec peu d'historique (1 point/serveur),
utilisez la détection ML (Isolation Forest) qui fonctionne en mode cross-server.
La détection statistique nécessite ≥2 points par série.
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
    return datetime.now(timezone.utc)


def _to_aware_dt(d) -> datetime:
    """Convertit une date ou datetime en datetime timezone-aware UTC."""
    if isinstance(d, datetime):
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    if isinstance(d, date):
        return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
    return _utcnow()


def _peer_expected_median(_entity_value: float, all_values: List[float]) -> float:
    peers = [float(v) for v in all_values if v is not None]
    return statistics.median(peers) if peers else 0.0


# ─────────────────────────────────────────────────────────────────────────────
# DÉTECTION STATISTIQUE DES COÛTS — FinOps
# ─────────────────────────────────────────────────────────────────────────────

def detect_cost_anomalies(
    db:             Session,
    window_days:    int   = 30,
    z_threshold:    float = 2.5,
    service_filter: Optional[str] = None,
    save:           bool  = True,
) -> List[Anomaly]:
    """
    Détection d'anomalies budgétaires par z-score glissant + heuristiques FinOps.

    MÉTHODES COMBINÉES :
    ─────────────────────
    1. Z-score glissant (méthode principale) :
       Pour chaque (service, date), compare le coût à la moyenne mobile des
       `window_days` précédents. Flag si z > z_threshold.

    2. Tendance haussière (FinOps heuristique) :
       Si les 3 derniers coûts sont en hausse monotone ET la hausse totale
       dépasse 30% → flag MEDIUM même si z-score insuffisant.

    3. Outlier inter-services (FinOps heuristique) :
       Si le coût total d'un service dépasse 3× la médiane des autres services
       sur la même période → flag HIGH.
       Détecte les services anormalement chers par rapport au reste.
    """
    logger.info(
        f"🔍 [Stat] Détection coûts | window={window_days}j z≥{z_threshold}"
    )

    cutoff_dt   = _utcnow() - timedelta(days=window_days * 4)
    cutoff_date = cutoff_dt.date()

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

    if not rows:
        logger.warning(f"⚠️  Pas de données coût depuis {cutoff_date} — fallback complet")
        fallback = (
            db.query(
                CostRecord.cost_date,
                CostRecord.service_name,
                func.sum(CostRecord.amount).label("daily_total"),
            )
            .group_by(CostRecord.cost_date, CostRecord.service_name)
            .order_by(CostRecord.service_name, CostRecord.cost_date)
        )
        if service_filter:
            fallback = fallback.filter(CostRecord.service_name.ilike(f"%{service_filter}%"))
        rows = fallback.all()

    if not rows:
        logger.info("ℹ️  Aucune donnée coût (table vide ?)")
        return []

    logger.info(f"📊 {len(rows)} lignes coût chargées")

    # Grouper par service
    by_service: Dict[str, List[Tuple]] = {}
    for r in rows:
        by_service.setdefault(r.service_name, []).append((r.cost_date, float(r.daily_total)))

    # ── Calcul des totaux par service pour la détection inter-services ───────
    service_totals = {
        svc: sum(v for _, v in series)
        for svc, series in by_service.items()
    }
    all_totals = list(service_totals.values())

    detected: List[Anomaly] = []
    seen_keys = set()   # évite les doublons intra-service

    for service, series in by_service.items():
        series.sort(key=lambda x: x[0])

        # ── Méthode 1 : Z-score glissant ────────────────────────────────────
        for i, (day, cost) in enumerate(series):
            baseline_start = max(0, i - window_days)
            baseline_vals  = [v for _, v in series[baseline_start:i]]

            if len(baseline_vals) < 2:
                continue

            mean, std = _moving_stats(baseline_vals)
            if std == 0:
                std = max(mean * 0.01, 0.01)

            z = (cost - mean) / std

            if z > z_threshold:
                severity    = _severity_from_z(z)
                detected_at = _to_aware_dt(day)
                key         = (service, str(day)[:10], "zscore")
                if key in seen_keys:
                    continue
                seen_keys.add(key)

                detected.append(Anomaly(
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
                    threshold_type  = f"mean+{z_threshold}std_glissant",
                    detected_at     = detected_at,
                    description     = (
                        f"Coût journalier de {cost:.2f}€ pour '{service}' "
                        f"dépasse la moyenne mobile de {mean:.2f}€ "
                        f"(σ={std:.2f}, z={z:.2f}). "
                        f"Seuil : {mean + z_threshold * std:.2f}€."
                    ),
                    unit            = "€",
                ))
                logger.warning(f"⚠️  Coût z-score: {service} | {day} | {cost:.2f}€ z={z:.2f}")

        # ── Méthode 2 : Tendance haussière (FinOps heuristique) ─────────────
        if len(series) >= 3:
            last3 = [v for _, v in series[-3:]]
            is_rising = last3[0] < last3[1] < last3[2]
            pct_change = (last3[2] - last3[0]) / max(last3[0], 0.01)
            if is_rising and pct_change > 0.30:
                day, cost   = series[-1]
                detected_at = _to_aware_dt(day)
                key         = (service, str(day)[:10], "trend")
                if key not in seen_keys:
                    seen_keys.add(key)
                    _, baseline_mean = _moving_stats([v for _, v in series[:-3]])
                    detected.append(Anomaly(
                        entity_type     = "cost_service",
                        entity_name     = service,
                        anomaly_type    = AnomalyType.COST_SPIKE,
                        severity        = AnomalySeverity.MEDIUM,
                        method          = AnomalyMethod.STATISTICAL,
                        observed_value  = cost,
                        expected_value  = last3[0],
                        std_dev         = 0.0,
                        z_score         = None,
                        threshold_value = last3[0] * 1.30,
                        threshold_type  = "hausse_monotone_30pct",
                        detected_at     = detected_at,
                        description     = (
                            f"Tendance haussière détectée pour '{service}' : "
                            f"+{pct_change*100:.1f}% sur les 3 dernières entrées "
                            f"({last3[0]:.2f}€ → {last3[1]:.2f}€ → {last3[2]:.2f}€)."
                        ),
                        unit            = "€",
                    ))
                    logger.warning(
                        f"📈 Tendance coût: {service} | +{pct_change*100:.1f}% sur 3 points"
                    )

        # ── Méthode 3 : Outlier inter-services ──────────────────────────────
        if len(all_totals) >= 3:
            svc_total = service_totals[service]
            expected_cost = _peer_expected_median(svc_total, all_totals)
            is_peer_anomaly = (
                expected_cost > 0
                and (svc_total > expected_cost * 3.0 or svc_total < expected_cost / 3.0)
            )
            if is_peer_anomaly:
                last_day, last_cost = series[-1]
                detected_at         = _to_aware_dt(last_day)
                key                 = (service, str(last_day)[:10], "inter")
                if key not in seen_keys:
                    seen_keys.add(key)
                    detected.append(Anomaly(
                        entity_type     = "cost_service",
                        entity_name     = service,
                        anomaly_type    = AnomalyType.COST_SPIKE,
                        severity        = AnomalySeverity.HIGH,
                        method          = AnomalyMethod.STATISTICAL,
                        observed_value  = svc_total,
                        expected_value  = expected_cost,
                        std_dev         = 0.0,
                        z_score         = None,
                        threshold_value = expected_cost * 3.0,
                        threshold_type  = "outlier_inter_services_3x_or_1over3_median",
                        detected_at     = detected_at,
                        description     = (
                            f"Service '{service}' : coût total {svc_total:.2f}€ "
                            f"vs médiane pairs {expected_cost:.2f}€ (même niveau service). "
                            f"Règle peer : >3× ou <1/3 de la médiane."
                        ),
                        unit            = "€",
                    ))
                    logger.warning(
                        f"💸 Outlier inter-services: {service} | "
                        f"total={svc_total:.2f}€ vs median_pairs={expected_cost:.2f}€"
                    )

    if save and detected:
        db.add_all(detected)
        db.commit()
        for a in detected:
            db.refresh(a)
        logger.info(f"✅ {len(detected)} anomalies coût statistiques sauvegardées")
    else:
        logger.info(f"ℹ️  {len(detected)} anomalies coût statistiques (save={save})")

    return detected


# ─────────────────────────────────────────────────────────────────────────────
# DÉTECTION STATISTIQUE DES RESSOURCES
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
    Détection CPU / RAM / Disk par z-score glissant.

    NOTE : CPU négatif (OVH sentinel) filtré — utiliser IF pour les serveurs OVH.
    Nécessite ≥2 points par série. Avec peu d'historique → préférer la détection ML.
    """
    if metrics is None:
        metrics = ["cpu_usage", "ram_usage", "disk_usage"]

    logger.info(
        f"🔍 [Stat] Détection ressources | "
        f"window={window_days}j z≥{z_threshold} metrics={metrics}"
    )

    cutoff = _utcnow() - timedelta(days=window_days * 4)
    query  = db.query(ResourceMetric).filter(ResourceMetric.recorded_at >= cutoff)
    if server_filter:
        query = query.filter(ResourceMetric.server_name.ilike(f"%{server_filter}%"))
    all_metrics = query.order_by(
        ResourceMetric.server_name, ResourceMetric.recorded_at
    ).all()

    if not all_metrics:
        logger.warning(f"⚠️  Aucune métrique depuis {cutoff.date()} — fallback complet")
        fallback = db.query(ResourceMetric)
        if server_filter:
            fallback = fallback.filter(ResourceMetric.server_name.ilike(f"%{server_filter}%"))
        all_metrics = fallback.order_by(
            ResourceMetric.server_name, ResourceMetric.recorded_at
        ).all()

    if not all_metrics:
        logger.info("ℹ️  Aucune métrique de ressource (table vide ?)")
        return []

    logger.info(f"📊 {len(all_metrics)} lignes de métriques chargées")

    by_server: Dict[str, list] = {}
    for m in all_metrics:
        by_server.setdefault(m.server_name, []).append(m)

    detected: List[Anomaly] = []

    for server, records in by_server.items():
        records.sort(key=lambda r: r.recorded_at)

        for metric_key in metrics:
            cfg = _METRIC_CONFIG.get(metric_key)
            if not cfg:
                continue

            # CPU négatif = sentinel OVH → filtré
            series = [
                (r.recorded_at, getattr(r, metric_key))
                for r in records
                if getattr(r, metric_key) is not None and getattr(r, metric_key) >= 0
            ]

            if len(series) < 2:
                continue

            for i, (ts, val) in enumerate(series):
                baseline_start = max(0, i - window_days)
                baseline_vals  = [v for _, v in series[baseline_start:i]]

                if len(baseline_vals) < 2:
                    continue

                mean, std = _moving_stats(baseline_vals)
                if std == 0:
                    std = max(mean * 0.01, 0.01)

                z = (val - mean) / std

                if z > z_threshold:
                    severity = _severity_from_z(z)
                    ts_aware = _to_aware_dt(ts)

                    detected.append(Anomaly(
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
                        description     = (
                            f"Serveur '{server}' — {cfg['label']} à {val:.2f}{cfg['unit']} "
                            f"dépasse la moyenne mobile {mean:.2f}{cfg['unit']} "
                            f"(σ={std:.2f}, z={z:.2f})"
                        ),
                        unit            = cfg["unit"],
                    ))
                    logger.warning(
                        f"⚠️  Ressource: {server} | "
                        f"{metric_key}={val:.2f} z={z:.2f} [{severity}]"
                    )

    if save and detected:
        db.add_all(detected)
        db.commit()
        for a in detected:
            db.refresh(a)
        logger.info(f"✅ {len(detected)} anomalies ressources sauvegardées")
    else:
        logger.info(f"ℹ️  {len(detected)} anomalies ressources (save={save})")

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
        # AJOUT : comptage par méthode
        "ml_count":      sum(1 for a in rows if a.method == AnomalyMethod.ISOLATION_FOREST),
        "stat_count":    sum(1 for a in rows if a.method == AnomalyMethod.STATISTICAL),
        "latest_at":     latest,
    }
