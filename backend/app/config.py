from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    """Configuration de l'application"""
    
    # App
    app_name: str = "FinOps Platform"
    app_version: str = "1.0.0"
    debug: bool = False
    
    # API
    api_prefix: str = "/api/v1"
    
    # Database
    database_url: str = "postgresql://admin:admin123@localhost:5432/finops_db"
    database_echo: bool = False
    # Security
    secret_key: str = "your-secret-key"
    algorithm: str = "HS256"
    jwt_secret: str = "jwt-secret-key"
    access_token_expire_minutes: int = 30
    
    # Uploads
    upload_dir: str = "./uploads"
    max_upload_size_mb: int = 50
    allowed_extensions: list = ["xlsx", "xls", "pdf", "csv"]
    
    # Logging
    log_level: str = "INFO"
    log_file: str = "./logs/app.log"
    
    # Features
    enable_anomaly_detection: bool = True
    enable_scheduling: bool = True
    
    class Config:
        env_file = ".env"
        case_sensitive = False

# Load settings
settings = Settings()