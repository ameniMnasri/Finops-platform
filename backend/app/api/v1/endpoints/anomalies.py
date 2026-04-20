"""
anomalies.py — FastAPI router  /anomalies
══════════════════════════════════════════
Endpoints:
  GET    /anomalies/                        — list anomalies (filterable)
  GET    /anomalies/summary                 — global stats
  POST   /anomalies/detect/costs            — run statistical cost detection
  POST   /anomalies/detect/resources        — run statistical resource detection
  POST   /anomalies/detect/ml               — run Isolation Forest detection
  DELETE /anomalies/{anomaly_id}            — delete a record
  DELETE /anomalies/                        — purge all anomalies
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
import logging

from app.database import get_db
from app.dependencies import get_current_user
from app.schemas.user import User

from app.models.anomaly import AnomalyType, AnomalySeverity, AnomalyMethod, Anomaly
from app.schemas.anomaly import (
    AnomalyResponse,
    AnomalySummary,
    DetectCostAnomaliesRequest,
    DetectResourceAnomaliesRequest,
    DetectMLRequest,
)
from app.services.anomaly_service import (
    detect_cost_anomalies,
    detect_resource_anomalies,
    get_anomalies,
    get_anomaly_summary,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/anomalies", tags=["anomalies"])


# ── GET /anomalies/summary ────────────────────────────────────────────────────

@router.get("/summary", response_model=AnomalySummary)
def anomaly_summary(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Résumé global des anomalies (compteurs par sévérité et type)."""
    try:
        return get_anomaly_summary(db)
    except Exception as e:
        logger.error(f"❌ Summary error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── GET /anomalies/ ───────────────────────────────────────────────────────────

@router.get("/", response_model=List[AnomalyResponse])
def list_anomalies(
    skip:         int                       = Query(0,   ge=0),
    limit:        int                       = Query(100, ge=1, le=1000),
    entity:       Optional[str]             = Query(None, description="Filter by entity name (partial match)"),
    anomaly_type: Optional[AnomalyType]     = Query(None),
    severity:     Optional[AnomalySeverity] = Query(None),
    method:       Optional[AnomalyMethod]   = Query(None),
    since_days:   Optional[int]             = Query(None, ge=1, description="Only anomalies from last N days"),
    db:           Session                   = Depends(get_db),
    current_user: User                      = Depends(get_current_user),
):
    """Lister les anomalies avec filtres optionnels."""
    try:
        results = get_anomalies(
            db,
            skip=skip,
            limit=limit,
            entity_filter=entity,
            anomaly_type=anomaly_type,
            severity_filter=severity,
            method_filter=method,
            since_days=since_days,
        )
        logger.info(f"📋 Listed {len(results)} anomalies")
        return results
    except Exception as e:
        logger.error(f"❌ List anomalies error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── POST /anomalies/detect/costs ──────────────────────────────────────────────

@router.post("/detect/costs", response_model=List[AnomalyResponse])
def detect_costs(
    req:          DetectCostAnomaliesRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Lancer la détection statistique des pics de coût.

    Utilise une moyenne mobile + écart-type sur une fenêtre glissante.
    Les anomalies dont le z-score dépasse `z_threshold` sont enregistrées.
    """
    try:
        logger.info(
            f"🚀 Cost anomaly detection triggered by {current_user.email} | "
            f"window={req.window_days}d z≥{req.z_threshold}"
        )
        anomalies = detect_cost_anomalies(
            db,
            window_days=req.window_days,
            z_threshold=req.z_threshold,
            service_filter=req.service_filter,
            save=req.save,
        )
        logger.info(f"✅ Detected {len(anomalies)} cost anomalies")
        return anomalies
    except Exception as e:
        logger.error(f"❌ Cost detection error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── POST /anomalies/detect/resources ─────────────────────────────────────────

@router.post("/detect/resources", response_model=List[AnomalyResponse])
def detect_resources(
    req:          DetectResourceAnomaliesRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Lancer la détection statistique des surconsommations CPU / RAM / Disk.

    Analyse chaque métrique indépendamment via z-score glissant.
    """
    try:
        logger.info(
            f"🚀 Resource anomaly detection triggered by {current_user.email} | "
            f"metrics={req.metrics} window={req.window_days}d z≥{req.z_threshold}"
        )
        anomalies = detect_resource_anomalies(
            db,
            window_days=req.window_days,
            z_threshold=req.z_threshold,
            server_filter=req.server_filter,
            metrics=req.metrics,
            save=req.save,
        )
        logger.info(f"✅ Detected {len(anomalies)} resource anomalies")
        return anomalies
    except Exception as e:
        logger.error(f"❌ Resource detection error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── POST /anomalies/detect/ml ─────────────────────────────────────────────────

@router.post("/detect/ml", response_model=List[AnomalyResponse])
def detect_ml(
    req:          DetectMLRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Lancer la détection ML via Isolation Forest sur CPU/RAM/Disk.

    Requiert: `pip install scikit-learn numpy`
    Détecte les outliers multivariés sans données labellisées.
    """
    try:
        from app.services.ml_anomaly_service import detect_resource_anomalies_ml
    except ImportError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"scikit-learn non installé: {str(e)}. "
                   f"Installez avec: pip install scikit-learn numpy",
        )

    try:
        logger.info(
            f"🤖 ML detection triggered by {current_user.email} | "
             f"contamination={req.contamination} n_est={req.n_estimators} mode={req.mom_groupby}"        )
        anomalies = detect_resource_anomalies_ml(
            db,
            server_filter=req.server_filter,
            contamination=req.contamination,
            n_estimators=req.n_estimators,
            window_days=req.window_days,
             mom_groupby=req.mom_groupby,
            save=req.save,
        )
        logger.info(f"✅ ML detected {len(anomalies)} anomalies")
        return anomalies
    except Exception as e:
        logger.error(f"❌ ML detection error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── DELETE /anomalies/{anomaly_id} ────────────────────────────────────────────

@router.delete("/{anomaly_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_anomaly(
    anomaly_id:   int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Supprimer une anomalie par ID."""
    obj = db.query(Anomaly).filter(Anomaly.id == anomaly_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail=f"Anomaly {anomaly_id} not found")
    db.delete(obj)
    db.commit()
    logger.info(f"🗑️ Anomaly {anomaly_id} deleted by {current_user.email}")


# ── DELETE /anomalies/ (purge) ────────────────────────────────────────────────

@router.delete("/", status_code=status.HTTP_200_OK)
def purge_anomalies(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Purger toutes les anomalies (utile pour les tests ou reset)."""
    count = db.query(Anomaly).delete()
    db.commit()
    logger.info(f"🧹 Purged {count} anomalies by {current_user.email}")
    return {"deleted": count, "message": f"{count} anomalies supprimées"}