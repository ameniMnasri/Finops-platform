"""
OVH Resource Fetcher — fetches CPU, RAM, and Disk metrics for VPS and Dedicated servers
using the OVH API with HMAC SHA1 signing.
"""

import hashlib
import hmac
import time
import urllib.request
import urllib.error
import json
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

OVH_API_BASE = "https://eu.api.ovh.com/1.0"


class OVHResourceFetcher:
    """Fetches server resource metrics (CPU, RAM, Disk) from OVHcloud API."""

    def __init__(self, app_key: str, app_secret: str, consumer_key: str):
        self.app_key = app_key
        self.app_secret = app_secret
        self.consumer_key = consumer_key
        self._time_delta: int = 0
        self._sync_time()

    # ─────────────────────────────── Auth helpers ───────────────────────────────

    def _sync_time(self) -> None:
        """Sync local time with OVH server time to avoid signature errors."""
        try:
            url = f"{OVH_API_BASE}/auth/time"
            with urllib.request.urlopen(url, timeout=10) as resp:
                server_time = int(resp.read().decode("utf-8"))
                self._time_delta = server_time - int(time.time())
        except Exception as e:
            logger.warning(f"Could not sync OVH server time: {e}")
            self._time_delta = 0

    def _get_timestamp(self) -> int:
        return int(time.time()) + self._time_delta

    def _sign_request(self, method: str, url: str, body: str, timestamp: int) -> str:
        """Compute HMAC SHA1 signature as required by OVH API."""
        pre_hash = "+".join([
            self.app_secret,
            self.consumer_key,
            method.upper(),
            url,
            body,
            str(timestamp),
        ])
        return "$1$" + hashlib.sha1(pre_hash.encode("utf-8")).hexdigest()

    def _request(self, method: str, path: str) -> Any:
        """Make an authenticated request to the OVH API."""
        url = f"{OVH_API_BASE}{path}"
        timestamp = self._get_timestamp()
        body = ""
        signature = self._sign_request(method, url, body, timestamp)

        req = urllib.request.Request(
            url,
            method=method.upper(),
            headers={
                "X-Ovh-Application": self.app_key,
                "X-Ovh-Consumer": self.consumer_key,
                "X-Ovh-Timestamp": str(timestamp),
                "X-Ovh-Signature": signature,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body_text = e.read().decode("utf-8", errors="ignore")
            logger.error(f"OVH API HTTP {e.code} on {path}: {body_text}")
            raise RuntimeError(f"OVH API error {e.code}: {body_text}")
        except urllib.error.URLError as e:
            logger.error(f"OVH API URL error on {path}: {e.reason}")
            raise RuntimeError(f"OVH API connection error: {e.reason}")

    # ─────────────────────────────── VPS ────────────────────────────────────────

    def _list_vps(self) -> List[str]:
        """Return list of VPS service names."""
        try:
            result = self._request("GET", "/vps")
            return result if isinstance(result, list) else []
        except Exception as e:
            logger.warning(f"Could not list VPS: {e}")
            return []

    def _get_vps_details(self, service_name: str) -> Optional[Dict]:
        """Return VPS details."""
        try:
            return self._request("GET", f"/vps/{service_name}")
        except Exception as e:
            logger.warning(f"Could not get VPS details for {service_name}: {e}")
            return None

    def _get_vps_monitoring(self, service_name: str) -> Optional[Dict]:
        """
        Return monitoring metrics for a VPS.
        Tries the monitoring endpoint; falls back to None if unavailable.
        """
        try:
            # Try: GET /vps/{serviceName}/monitoring?period=lastday&type=cpu:max,memoryUsed:max,diskUsed:max
            path = f"/vps/{service_name}/monitoring?period=lastday&type=cpu:max,memoryUsed:max,diskUsed:max"
            return self._request("GET", path)
        except Exception:
            pass
        try:
            # Fallback: GET /vps/{serviceName}/status
            return self._request("GET", f"/vps/{service_name}/status")
        except Exception as e:
            logger.warning(f"Could not get VPS monitoring for {service_name}: {e}")
            return None

    # ─────────────────────────────── Dedicated ──────────────────────────────────

    def _list_dedicated(self) -> List[str]:
        """Return list of dedicated server service names."""
        try:
            result = self._request("GET", "/dedicated/server")
            return result if isinstance(result, list) else []
        except Exception as e:
            logger.warning(f"Could not list dedicated servers: {e}")
            return []

    def _get_dedicated_details(self, service_name: str) -> Optional[Dict]:
        """Return dedicated server details."""
        try:
            return self._request("GET", f"/dedicated/server/{service_name}")
        except Exception as e:
            logger.warning(f"Could not get dedicated server details for {service_name}: {e}")
            return None

    def _get_dedicated_monitoring(self, service_name: str) -> Optional[Dict]:
        """
        Return monitoring metrics for a dedicated server.
        """
        try:
            path = f"/dedicated/server/{service_name}/monitoring?period=lastday&type=cpu:max,memoryUsed:max,diskUsed:max"
            return self._request("GET", path)
        except Exception:
            pass
        try:
            return self._request("GET", f"/dedicated/server/{service_name}/status")
        except Exception as e:
            logger.warning(f"Could not get dedicated monitoring for {service_name}: {e}")
            return None

    # ─────────────────────────────── Metric extraction ──────────────────────────

    @staticmethod
    def _extract_metric_value(data: Any, key: str) -> Optional[float]:
        """
        Extract a numeric value from various response shapes:
        - {key: [{timestamp, value}, ...]} → take last value
        - {key: value}
        - flat number
        """
        if data is None:
            return None
        if isinstance(data, (int, float)):
            return float(data)
        if isinstance(data, dict):
            val = data.get(key)
            if val is None:
                # Try nested: data may be {values: [{timestamp, value}]}
                val = data.get("values") or data.get("datas") or data.get("data")
            if isinstance(val, list) and val:
                last = val[-1]
                if isinstance(last, dict):
                    return float(last.get("value", 0) or 0)
                return float(last or 0)
            if isinstance(val, (int, float)):
                return float(val)
            if isinstance(val, dict):
                # Recursive
                inner = val.get("value") or val.get("values")
                if isinstance(inner, list) and inner:
                    last = inner[-1]
                    if isinstance(last, dict):
                        return float(last.get("value", 0) or 0)
                    return float(last or 0)
                if isinstance(inner, (int, float)):
                    return float(inner)
        return None

    @staticmethod
    def _parse_monitoring(data: Any, server_type: str) -> Dict[str, Optional[float]]:
        """
        Parse monitoring data into normalized cpu_usage (%), ram_usage (GB), disk_usage (GB).
        Handles multiple response shapes from OVH monitoring endpoints.
        """
        cpu: Optional[float] = None
        ram: Optional[float] = None
        disk: Optional[float] = None

        if data is None:
            return {"cpu_usage": cpu, "ram_usage": ram, "disk_usage": disk}

        # Attempt 1: list of {type, values/datas} objects
        if isinstance(data, list):
            for entry in data:
                if not isinstance(entry, dict):
                    continue
                etype = str(entry.get("type", "")).lower()
                val_list = entry.get("values") or entry.get("datas") or entry.get("data") or []
                if isinstance(val_list, list) and val_list:
                    last = val_list[-1]
                    raw_val = last.get("value") if isinstance(last, dict) else last
                    try:
                        fval = float(raw_val or 0)
                    except (TypeError, ValueError):
                        fval = 0.0
                    if "cpu" in etype:
                        cpu = min(fval, 100.0)
                    elif "memory" in etype or "mem" in etype or "ram" in etype:
                        # OVH reports memory in bytes — convert to GB
                        ram = fval / (1024 ** 3) if fval > 1_000_000 else fval
                    elif "disk" in etype:
                        disk = fval / (1024 ** 3) if fval > 1_000_000 else fval

        # Attempt 2: flat dict {cpu:val, memory:val, disk:val}
        elif isinstance(data, dict):
            for k, v in data.items():
                kl = k.lower()
                try:
                    fval = float(v or 0)
                except (TypeError, ValueError):
                    fval = 0.0
                if "cpu" in kl:
                    cpu = min(fval, 100.0)
                elif "memory" in kl or "mem" in kl or "ram" in kl:
                    ram = fval / (1024 ** 3) if fval > 1_000_000 else fval
                elif "disk" in kl:
                    disk = fval / (1024 ** 3) if fval > 1_000_000 else fval

        return {"cpu_usage": cpu, "ram_usage": ram, "disk_usage": disk}

    # ─────────────────────────────── Public API ─────────────────────────────────

    def fetch_all_metrics(self) -> List[Dict[str, Any]]:
        """
        Fetch CPU, RAM, Disk metrics for all VPS and Dedicated servers.

        Returns a list of normalized metric dicts:
        {
            server_name: str,
            server_type: "vps" | "dedicated",
            cpu_usage: float | None,   # %
            ram_usage: float | None,   # GB
            disk_usage: float | None,  # GB
        }
        """
        metrics: List[Dict[str, Any]] = []

        # ── VPS ──────────────────────────────────────────────────────────────
        vps_list = self._list_vps()
        logger.info(f"Found {len(vps_list)} VPS servers")

        for service_name in vps_list:
            try:
                monitoring = self._get_vps_monitoring(service_name)
                parsed = self._parse_monitoring(monitoring, "vps")
                metrics.append({
                    "server_name": service_name,
                    "server_type": "vps",
                    **parsed,
                })
                logger.debug(f"VPS {service_name}: cpu={parsed['cpu_usage']}, ram={parsed['ram_usage']}, disk={parsed['disk_usage']}")
            except Exception as e:
                logger.warning(f"Failed to fetch metrics for VPS {service_name}: {e}")
                metrics.append({
                    "server_name": service_name,
                    "server_type": "vps",
                    "cpu_usage": None,
                    "ram_usage": None,
                    "disk_usage": None,
                })

        # ── Dedicated servers ─────────────────────────────────────────────────
        dedicated_list = self._list_dedicated()
        logger.info(f"Found {len(dedicated_list)} dedicated servers")

        for service_name in dedicated_list:
            try:
                monitoring = self._get_dedicated_monitoring(service_name)
                parsed = self._parse_monitoring(monitoring, "dedicated")
                metrics.append({
                    "server_name": service_name,
                    "server_type": "dedicated",
                    **parsed,
                })
                logger.debug(f"Dedicated {service_name}: cpu={parsed['cpu_usage']}, ram={parsed['ram_usage']}, disk={parsed['disk_usage']}")
            except Exception as e:
                logger.warning(f"Failed to fetch metrics for dedicated {service_name}: {e}")
                metrics.append({
                    "server_name": service_name,
                    "server_type": "dedicated",
                    "cpu_usage": None,
                    "ram_usage": None,
                    "disk_usage": None,
                })

        logger.info(f"Total metrics fetched: {len(metrics)}")
        return metrics
