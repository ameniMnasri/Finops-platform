"""
cloud.py — Shared Pydantic schemas for cloud provider integrations.
"""
from pydantic import BaseModel


class OVHCredentials(BaseModel):
    """OVHcloud HMAC API credentials shared across import endpoints."""
    app_key:      str
    app_secret:   str
    consumer_key: str
