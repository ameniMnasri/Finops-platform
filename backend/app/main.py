from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from app.config import settings
from app.database import init_db, check_db_connection
from app.api.v1.api import api_router
from app.api.v1.endpoints.resources import router as resources_router

# Setup logging
logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    debug=settings.debug,
    description="FinOps Platform API"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event():
    """Run on startup"""
    logger.info("🚀 Starting FinOps Platform...")
    
    # Check database
    if not check_db_connection():
        logger.warning("⚠️ Database not connected yet (will retry)")
    
    # Initialize database
    try:
        init_db()
        logger.info("✅ Startup complete!")
    except Exception as e:
        logger.error(f"❌ Startup error: {e}")

@app.on_event("shutdown")
def shutdown_event():
    """Run on shutdown"""
    logger.info("🛑 Shutting down...")

# Include API routes
app.include_router(api_router, prefix=settings.api_prefix)

# Root endpoint
@app.get("/")
def root():
    """Root endpoint"""
    return {
        "message": f"Welcome to {settings.app_name}",
        "version": settings.app_version,
        "docs": "/docs",
        "api": settings.api_prefix
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.debug
    )
