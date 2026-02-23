from fastapi import APIRouter
from app.config import settings

router = APIRouter(tags=["health"])

@router.get("/health")
def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "app": settings.app_name,
        "version": settings.app_version
    }