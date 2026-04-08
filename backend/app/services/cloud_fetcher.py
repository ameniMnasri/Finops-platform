"""
cloud_fetcher.py
Universal cloud cost fetcher.
- OVHcloud  : real HMAC-signed implementation
- AWS       : stub (ready to implement)
- Azure     : stub (ready to implement)
- GCP       : stub (ready to implement)
- Custom    : generic header-based proxy
"""

import hashlib
import time
import logging
from abc import ABC, abstractmethod
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────
# Base class — every fetcher implements these two methods
# ─────────────────────────────────────────────────────────────────────
class BaseFetcher(ABC):

    @abstractmethod
    def test_connection(self, auth_fields: Dict[str, str]) -> Dict[str, Any]:
        """Returns { success: bool, message: str, records_found: int }"""

    @abstractmethod
    def fetch_costs(
        self,
        auth_fields: Dict[str, str],
        start_date:  Optional[str] = None,
        end_date:    Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Returns list of normalized cost dicts ready for CostCreate"""


# ─────────────────────────────────────────────────────────────────────
# OVHcloud — HMAC SHA1 signature
# ─────────────────────────────────────────────────────────────────────
class OVHFetcher(BaseFetcher):
    BASE_URL = "https://eu.api.ovh.com/1.0"

    # ── Internal helpers ──────────────────────────────────────────
    def _timestamp(self) -> str:
        return str(int(time.time()))

    def _sign(
        self,
        app_secret:   str,
        consumer_key: str,
        method:       str,
        url:          str,
        body:         str,
        timestamp:    str,
    ) -> str:
        pre_hash = "+".join([app_secret, consumer_key,
                             method.upper(), url, body, timestamp])
        return "$1$" + hashlib.sha1(pre_hash.encode("utf-8")).hexdigest()

    def _request(
        self,
        method:       str,
        path:         str,
        app_key:      str,
        app_secret:   str,
        consumer_key: str,
    ) -> Any:
        url       = f"{self.BASE_URL}{path}"
        timestamp = self._timestamp()
        signature = self._sign(app_secret, consumer_key,
                               method, url, "", timestamp)
        headers = {
            "X-Ovh-Application": app_key,
            "X-Ovh-Consumer":    consumer_key,
            "X-Ovh-Timestamp":   timestamp,
            "X-Ovh-Signature":   signature,
            "Content-Type":      "application/json",
            "Accept":            "application/json",
        }
        resp = requests.request(method, url, headers=headers, timeout=20)
        resp.raise_for_status()
        return resp.json()

    def _keys(self, auth_fields: Dict) -> tuple:
        return (
            auth_fields.get("app_key", "").strip(),
            auth_fields.get("app_secret", "").strip(),
            auth_fields.get("consumer_key", "").strip(),
        )

    # ── Public interface ──────────────────────────────────────────
    def test_connection(self, auth_fields: Dict) -> Dict[str, Any]:
        app_key, app_secret, consumer_key = self._keys(auth_fields)
        if not all([app_key, app_secret, consumer_key]):
            return {
                "success": False,
                "message": "Application Key, Application Secret et Consumer Key requis",
                "records_found": 0,
            }
        try:
            # /me validates credentials without heavy data fetch
            me = self._request("GET", "/me", app_key, app_secret, consumer_key)
            # Also peek at bill count
            bills = self._request("GET", "/me/bill", app_key, app_secret, consumer_key)
            count = len(bills) if isinstance(bills, list) else 0
            return {
                "success":       True,
                "message":       f"Connecté en tant que {me.get('nichandle', 'inconnu')} — {count} facture(s) disponible(s)",
                "records_found": count,
            }
        except requests.exceptions.HTTPError as e:
            status = e.response.status_code if e.response is not None else "?"
            if status == 403:
                msg = "Accès refusé — vérifiez vos droits Consumer Key (GET /me/bill requis)"
            elif status == 401:
                msg = "Clés invalides ou expirées"
            else:
                msg = f"OVH API error {status}"
            return {"success": False, "message": msg, "records_found": 0}
        except Exception as e:
            return {"success": False, "message": str(e), "records_found": 0}

    def fetch_costs(
        self,
        auth_fields: Dict,
        start_date:  Optional[str] = None,
        end_date:    Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        app_key, app_secret, consumer_key = self._keys(auth_fields)
        if not all([app_key, app_secret, consumer_key]):
            raise ValueError("Application Key, Application Secret et Consumer Key requis")

        # 1. Get list of bill IDs
        bill_ids = self._request("GET", "/me/bill", app_key, app_secret, consumer_key)
        if not isinstance(bill_ids, list):
            logger.warning("OVH /me/bill returned unexpected format")
            return []

        # 2. Filter by date if provided
        start = datetime.strptime(start_date, "%Y-%m-%d").date() if start_date else None
        end   = datetime.strptime(end_date,   "%Y-%m-%d").date() if end_date   else None

        costs = []
        # Process latest 50 bills max to avoid timeout
        for bill_id in bill_ids[:50]:
            try:
                detail = self._request(
                    "GET", f"/me/bill/{bill_id}",
                    app_key, app_secret, consumer_key
                )

                # Parse date
                raw_date = detail.get("date", "")
                try:
                    bill_date = datetime.fromisoformat(raw_date[:10]).date()
                except Exception:
                    bill_date = date.today()

                # Apply date filter
                if start and bill_date < start:
                    continue
                if end and bill_date > end:
                    continue

                # Extract HT amount
                price_ht = detail.get("priceWithoutTax", {})
                amount   = float(price_ht.get("value", 0) or 0)
                currency = price_ht.get("currencyCode", "EUR")

                if amount <= 0:
                    logger.debug(f"Skipping bill {bill_id} — amount={amount}")
                    continue

                costs.append({
                    "cost_date":     str(bill_date),
                    "amount":        amount,
                    "service_name":  f"OVHcloud — {bill_id}",
                    "currency":      currency,
                    "reference":     bill_id,
                    "cost_category": "compute",
                    "source":        "OVHcloud",
                    "description":   f"Facture OVHcloud {bill_id} du {bill_date}",
                })
                logger.info(f"✅ Bill {bill_id}: {amount} {currency} ({bill_date})")

            except requests.exceptions.HTTPError as e:
                logger.warning(f"⚠️ Could not fetch bill {bill_id}: {e}")
                continue
            except Exception as e:
                logger.warning(f"⚠️ Error processing bill {bill_id}: {e}")
                continue

        logger.info(f"✅ OVH fetch done: {len(costs)} bills retrieved")
        return costs


# ─────────────────────────────────────────────────────────────────────
# AWS — stub (ready to implement with boto3 or AWS4 signing)
# ─────────────────────────────────────────────────────────────────────
class AWSFetcher(BaseFetcher):

    def test_connection(self, auth_fields: Dict) -> Dict[str, Any]:
        access_key = auth_fields.get("access_key", "").strip()
        secret_key = auth_fields.get("secret_key", "").strip()
        if not access_key or not secret_key:
            return {"success": False, "message": "Access Key ID et Secret Access Key requis", "records_found": 0}
        # TODO: implement AWS4 signature + Cost Explorer API
        return {
            "success":       False,
            "message":       "AWS Cost Explorer — intégration à venir. Clés reçues ✓",
            "records_found": 0,
        }

    def fetch_costs(self, auth_fields: Dict, start_date=None, end_date=None) -> List[Dict]:
        # TODO: implement with requests + AWS4 HMAC signing
        # Endpoint: POST https://ce.us-east-1.amazonaws.com/
        # Action: GetCostAndUsage
        raise NotImplementedError("AWS Cost Explorer — intégration à venir")


# ─────────────────────────────────────────────────────────────────────
# Azure — stub (ready to implement with OAuth2 + Cost Management API)
# ─────────────────────────────────────────────────────────────────────
class AzureFetcher(BaseFetcher):

    def test_connection(self, auth_fields: Dict) -> Dict[str, Any]:
        tenant_id     = auth_fields.get("tenant_id", "").strip()
        client_id     = auth_fields.get("client_id", "").strip()
        client_secret = auth_fields.get("client_secret", "").strip()
        if not all([tenant_id, client_id, client_secret]):
            return {"success": False, "message": "Tenant ID, Client ID et Client Secret requis", "records_found": 0}
        # TODO: POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
        return {
            "success":       False,
            "message":       "Azure Cost Management — intégration à venir. Credentials reçus ✓",
            "records_found": 0,
        }

    def fetch_costs(self, auth_fields: Dict, start_date=None, end_date=None) -> List[Dict]:
        # TODO: implement OAuth2 token fetch then Cost Management query
        raise NotImplementedError("Azure Cost Management — intégration à venir")


# ─────────────────────────────────────────────────────────────────────
# GCP — stub (ready to implement with API Key or Service Account JWT)
# ─────────────────────────────────────────────────────────────────────
class GCPFetcher(BaseFetcher):

    def test_connection(self, auth_fields: Dict) -> Dict[str, Any]:
        api_key    = auth_fields.get("api_key", "").strip()
        project_id = auth_fields.get("project_id", "").strip()
        if not api_key or not project_id:
            return {"success": False, "message": "Project ID et API Key requis", "records_found": 0}
        # TODO: GET https://cloudbilling.googleapis.com/v1/billingAccounts?key={api_key}
        return {
            "success":       False,
            "message":       "Google Cloud Billing — intégration à venir. Credentials reçus ✓",
            "records_found": 0,
        }

    def fetch_costs(self, auth_fields: Dict, start_date=None, end_date=None) -> List[Dict]:
        # TODO: implement Cloud Billing API with API key or JWT service account
        raise NotImplementedError("Google Cloud Billing — intégration à venir")


# ─────────────────────────────────────────────────────────────────────
# Custom — generic: injects custom headers and forwards the request
# ─────────────────────────────────────────────────────────────────────
class CustomFetcher(BaseFetcher):

    def test_connection(self, auth_fields: Dict) -> Dict[str, Any]:
        return {
            "success":       True,
            "message":       "Mode Custom — la connexion sera testée lors de l'import",
            "records_found": 0,
        }

    def fetch_costs(
        self,
        auth_fields:   Dict,
        start_date:    Optional[str] = None,
        end_date:      Optional[str] = None,
        url:           Optional[str] = None,
        method:        str           = "GET",
        extra_headers: Optional[Dict] = None,
    ) -> List[Dict]:
        if not url:
            raise ValueError("URL requise pour le mode Custom")

        headers = {"Content-Type": "application/json", "Accept": "application/json"}

        # Inject custom auth header
        auth_header = auth_fields.get("auth_header", "Authorization")
        auth_value  = auth_fields.get("auth_value", "")
        if auth_value:
            headers[auth_header] = auth_value

        if extra_headers:
            headers.update(extra_headers)

        resp = requests.request(method, url, headers=headers, timeout=20)
        resp.raise_for_status()
        data = resp.json()

        # Best-effort normalization — works if API returns a list of objects
        # with amount/cost/price + date + service/name fields
        if not isinstance(data, list):
            data = data.get("data", data.get("items", data.get("costs", data.get("records", []))))

        costs = []
        for item in (data if isinstance(data, list) else []):
            try:
                amount = float(
                    item.get("amount") or item.get("cost") or
                    item.get("price")  or item.get("total") or 0
                )
                if amount <= 0:
                    continue
                raw_date = (
                    item.get("date") or item.get("cost_date") or
                    item.get("timestamp") or str(date.today())
                )
                costs.append({
                    "cost_date":     str(raw_date)[:10],
                    "amount":        amount,
                    "service_name":  item.get("service") or item.get("name") or item.get("description") or "Custom",
                    "currency":      item.get("currency", "EUR"),
                    "cost_category": item.get("category") or item.get("type"),
                    "source":        "Custom",
                    "description":   item.get("description") or item.get("detail"),
                })
            except Exception as e:
                logger.warning(f"⚠️ Could not normalize custom item: {e}")
                continue

        logger.info(f"✅ Custom fetch done: {len(costs)} records")
        return costs


# ─────────────────────────────────────────────────────────────────────
# Factory — returns the right fetcher for a given source name
# ─────────────────────────────────────────────────────────────────────
_FETCHERS: Dict[str, BaseFetcher] = {
    "ovhcloud": OVHFetcher(),
    "ovh":      OVHFetcher(),
    "aws":      AWSFetcher(),
    "azure":    AzureFetcher(),
    "gcp":      GCPFetcher(),
    "custom":   CustomFetcher(),
}

def get_fetcher(source_name: str) -> BaseFetcher:
    key = source_name.lower().strip()
    fetcher = _FETCHERS.get(key)
    if not fetcher:
        # fallback to custom for unknown sources
        logger.warning(f"No fetcher for '{source_name}' — using CustomFetcher")
        return _FETCHERS["custom"]
    return fetcher