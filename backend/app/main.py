from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import logging

from app.config import settings
from app.database import init_db, check_db_connection, SessionLocal
from app.api.v1.api import api_router

# Setup logging
logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)

# ── Scheduler ─────────────────────────────────────────────────────────────────
scheduler = AsyncIOScheduler(timezone="UTC")


async def _collect_resource_metrics():
    """
    Scheduled job: collect OVH resource metrics every hour.
    Calls the same service used by the /resources/collect endpoint
    so we don't need an internal HTTP call (no token needed).
    """
    try:
        from app.services.resource_service import collect_all_metrics  # adjust import to your project
        db = SessionLocal()
        try:
            count = await collect_all_metrics(db)   # adapt signature if sync
            logger.info(f"⏰ [Scheduler] Collected {count} resource metrics")
        finally:
            db.close()
    except ImportError:
        # Fallback: call the endpoint via HTTP if no direct service function exists
        try:
            import httpx, os
            token = os.getenv("SCHEDULER_TOKEN", "")
            async with httpx.AsyncClient(timeout=60) as client:
                r = await client.post(
                    f"http://127.0.0.1:{os.getenv('PORT', 8000)}/api/v1/resources/collect",
                    headers={"Authorization": f"Bearer {token}"},
                )
                logger.info(f"⏰ [Scheduler] /resources/collect → {r.status_code}")
        except Exception as e:
            logger.warning(f"⏰ [Scheduler] collect failed: {e}")
    except Exception as e:
        logger.error(f"⏰ [Scheduler] Unexpected error: {e}", exc_info=True)


async def _run_anomaly_detection():
    """
    Scheduled job: run statistical anomaly detection every 24 h.
    Calls the service layer directly (no HTTP round-trip).
    """
    try:
        from app.services.anomaly_service import detect_cost_anomalies, detect_resource_anomalies
        db = SessionLocal()
        try:
            cost_anomalies     = detect_cost_anomalies(db,     window_days=30, z_threshold=2.5, save=True)
            resource_anomalies = detect_resource_anomalies(db, window_days=30, z_threshold=2.5, save=True)
            logger.info(
                f"⏰ [Scheduler] Auto-detection done | "
                f"cost={len(cost_anomalies)} resource={len(resource_anomalies)}"
            )
        finally:
            db.close()
    except Exception as e:
        logger.error(f"⏰ [Scheduler] Anomaly detection error: {e}", exc_info=True)


# ── Lifespan (replaces on_event startup/shutdown) ─────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── STARTUP ──────────────────────────────────────────────────────────────
    logger.info("🚀 Starting FinOps Platform...")

    # Database
    if not check_db_connection():
        logger.warning("⚠️ Database not connected yet (will retry)")
    try:
        init_db()
        logger.info("✅ Database initialized")
    except Exception as e:
        logger.error(f"❌ DB init error: {e}")

    # Schedule jobs
    scheduler.add_job(
        _collect_resource_metrics,
        trigger=IntervalTrigger(hours=1),
        id="collect_resource_metrics",
        name="Collect OVH resource metrics",
        replace_existing=True,
        misfire_grace_time=300,       # tolerate up to 5 min late
    )
    scheduler.add_job(
        _run_anomaly_detection,
        trigger=IntervalTrigger(hours=24),
        id="auto_anomaly_detection",
        name="Automatic anomaly detection",
        replace_existing=True,
        misfire_grace_time=600,
    )
    scheduler.start()
    logger.info("⏰ Scheduler started (resource collection every 1h, anomaly detection every 24h)")

    yield  # ← app runs here

    # ── SHUTDOWN ─────────────────────────────────────────────────────────────
    scheduler.shutdown(wait=False)
    logger.info("🛑 Scheduler stopped. Shutting down.")


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    debug=settings.debug,
    description="FinOps Platform API",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/")
def root():
    return {
        "message": f"Welcome to {settings.app_name}",
        "version": settings.app_version,
        "docs":    "/docs",
        "api":     settings.api_prefix,
    }


@app.get("/scheduler/status")
def scheduler_status():
    """Check scheduled jobs status (useful for debugging)."""
    jobs = [
        {
            "id":       job.id,
            "name":     job.name,
            "next_run": str(job.next_run_time),
        }
        for job in scheduler.get_jobs()
    ]
    return {"running": scheduler.running, "jobs": jobs}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.debug,
    )