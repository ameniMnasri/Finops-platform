"""
CloudFetcher — handles API connections and cost data fetching for multiple cloud providers.
Supports OVHcloud, AWS, Azure, GCP, and custom APIs.
"""

import hashlib
import hmac
import time
import urllib.request
import urllib.error
import urllib.parse
import json
import logging
from typing import List, Dict, Any, Tuple, Optional

logger = logging.getLogger(__name__)

OVH_API_BASE = "https://eu.api.ovh.com/1.0"


class CloudFetcher:
    """Fetches cloud cost data from various providers."""

    def __init__(self, payload: dict):
        self.source_id = payload.get("source_id", "custom")
        self.source_name = payload.get("source_name", "Custom")
        self.url = payload.get("url", "")
        self.method = payload.get("method", "GET").upper()
        self.auth_type = payload.get("auth_type", "custom")
        self.auth_fields = payload.get("auth_fields", {})
        self.start_date = payload.get("start_date")
        self.end_date = payload.get("end_date")
        self.extra_headers = payload.get("extra_headers", {})

    # ─────────────────────────────── OVH helpers ────────────────────────────────

    def _ovh_sign(self, method: str, url: str, body: str, timestamp: int) -> str:
        app_secret = self.auth_fields.get("app_secret", "")
        consumer_key = self.auth_fields.get("consumer_key", "")
        pre_hash = "+".join([app_secret, consumer_key, method.upper(), url, body, str(timestamp)])
        return "$1$" + hashlib.sha1(pre_hash.encode("utf-8")).hexdigest()

    def _get_ovh_time_delta(self) -> int:
        try:
            with urllib.request.urlopen(f"{OVH_API_BASE}/auth/time", timeout=10) as resp:
                server_time = int(resp.read().decode("utf-8"))
                return server_time - int(time.time())
        except Exception:
            return 0

    def _ovh_request(self, method: str, path: str) -> Any:
        """Authenticated OVH API request."""
        url = f"{OVH_API_BASE}{path}"
        delta = self._get_ovh_time_delta()
        timestamp = int(time.time()) + delta
        body = ""
        signature = self._ovh_sign(method, url, body, timestamp)

        app_key = self.auth_fields.get("app_key", "")
        consumer_key = self.auth_fields.get("consumer_key", "")

        req = urllib.request.Request(
            url,
            method=method.upper(),
            headers={
                "X-Ovh-Application": app_key,
                "X-Ovh-Consumer": consumer_key,
                "X-Ovh-Timestamp": str(timestamp),
                "X-Ovh-Signature": signature,
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))

    # ─────────────────────────────── Generic request ────────────────────────────

    def _generic_request(self) -> Any:
        """Make a generic authenticated HTTP request."""
        headers = {"Accept": "application/json", **self.extra_headers}

        auth_type = self.auth_type
        if auth_type == "bearer":
            token = self.auth_fields.get("token") or self.auth_fields.get("access_token", "")
            headers["Authorization"] = f"Bearer {token}"
        elif auth_type == "api_key":
            api_key = self.auth_fields.get("api_key", "")
            headers["X-API-Key"] = api_key
        elif auth_type == "custom":
            header_name = self.auth_fields.get("auth_header", "Authorization")
            header_val = self.auth_fields.get("auth_value", "")
            if header_val:
                headers[header_name] = header_val

        req = urllib.request.Request(self.url, method=self.method, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))

    # ─────────────────────────────── OVH Bill parsing ───────────────────────────

    def _fetch_ovh_bills(self) -> Tuple[List[dict], dict]:
        """Fetch and parse OVH billing data."""
        from urllib.parse import urlparse
        parsed = urlparse(self.url)
        path = parsed.path

        costs = []
        errors = []

        try:
            bill_ids = self._ovh_request("GET", path)
            if not isinstance(bill_ids, list):
                bill_ids = []
        except Exception as e:
            return [], {"errors": [str(e)]}

        for bill_id in bill_ids[:50]:  # Limit to last 50 bills
            try:
                bill = self._ovh_request("GET", f"/me/bill/{bill_id}")
                if not isinstance(bill, dict):
                    continue

                amount_str = str(bill.get("priceWithTax", {}).get("value", 0) if isinstance(bill.get("priceWithTax"), dict) else bill.get("priceWithTax", 0))
                try:
                    amount = float(amount_str)
                except (ValueError, TypeError):
                    amount = 0.0

                currency = "EUR"
                if isinstance(bill.get("priceWithTax"), dict):
                    currency = bill["priceWithTax"].get("currencyCode", "EUR")

                cost_date = None
                date_str = bill.get("date", "")
                if date_str:
                    try:
                        from datetime import date
                        cost_date = date.fromisoformat(date_str[:10])
                    except Exception:
                        pass

                costs.append({
                    "service": bill.get("url", f"OVH Bill {bill_id}"),
                    "project": "OVHcloud",
                    "amount": amount,
                    "currency": currency,
                    "cost_date": cost_date,
                    "description": bill.get("url") or f"OVH Bill {bill_id}",
                    "source": "OVHcloud",
                    "source_ref": bill_id,
                })
            except Exception as e:
                errors.append(f"Bill {bill_id}: {str(e)}")

        return costs, {"errors": errors}

    # ─────────────────────────────── Public API ─────────────────────────────────

    def test_connection(self) -> dict:
        """Test API connectivity and return status."""
        try:
            if self.source_id == "ovh" or self.auth_type == "ovh_keys":
                from urllib.parse import urlparse
                path = urlparse(self.url).path
                data = self._ovh_request("GET", path)
                records = len(data) if isinstance(data, list) else 1
                return {
                    "status": "ok",
                    "records_found": records,
                    "message": f"Connected to OVH API — {records} records found",
                }
            else:
                data = self._generic_request()
                records = len(data) if isinstance(data, list) else 1
                return {
                    "status": "ok",
                    "records_found": records,
                    "message": f"Connection successful — {records} records found",
                }
        except Exception as e:
            raise RuntimeError(f"Connection failed: {str(e)}")

    def fetch_costs(self) -> Tuple[List[dict], dict]:
        """Fetch cost data and return (costs_list, metadata)."""
        if self.source_id == "ovh" or self.auth_type == "ovh_keys":
            return self._fetch_ovh_bills()

        # Generic fallback
        try:
            data = self._generic_request()
            from app.services.file_parser import file_parser
            costs = file_parser.parse_api_data(data, source_name=self.source_name)
            return costs, {"errors": []}
        except Exception as e:
            return [], {"errors": [str(e)]}
