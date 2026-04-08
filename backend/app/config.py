from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # App
    app_name: str = "FinOps Platform API"
    app_version: str = "1.0.0"
    debug: bool = False

    # Database
    database_url: str = "sqlite:///./finops.db"
    database_echo: bool = False

    # Auth
    secret_key: str = "supersecretkey-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440  # 24h

    # Log
    log_level: str = "INFO"

    # API prefix
    api_prefix: str = "/api/v1"

    # Upload
    upload_dir: str = "./uploads"
    max_upload_size: int = 52_428_800  # 50 MB

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
