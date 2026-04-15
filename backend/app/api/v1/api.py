from fastapi import APIRouter

from app.api.v1.endpoints import health, auth, files ,costs,resources , anomalies

api_router = APIRouter()

# Include routers
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(files.router)
api_router.include_router(costs.router)
api_router.include_router(resources.router)
api_router.include_router(anomalies.router)