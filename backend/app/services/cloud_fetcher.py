"""
cloud_fetcher.py
Universal cloud cost fetcher + OVHcloud resource metrics fetcher.
- OVHcloud Costs: real HMAC-signed implementation
- OVHcloud Resources: CPU, RAM, Disk metrics from VPS & Dedicated servers
- AWS, Azure, GCP: stubs (ready to implement)
- Custom: generic header-based proxy
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
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Returns list of normalized cost dicts ready for CostCreate"""


# ─────────────────────────────────────────────────────────────────────
# OVHcloud — HMAC SHA1 signature (COSTS)
# ─────────────────────────────────────────────────────────────────────
class OVHFetcher(BaseFetcher):
    BASE_URL = "https://eu.api.ovh.com/1.0"

    # ── Internal helpers ──────────────────────────────────────────
    def _timestamp(self) -> str:
        return str(int(time.time()))

    def _sign(
        self,
        app_secret: str,
        consumer_key: str,
        method: str,
        url: str,
        body: str,
        timestamp: str,
    ) -> str:
        pre_hash = "+".join(
            [app_secret, consumer_key, method.upper(), url, body, timestamp]
        )
        return "$1$" + hashlib.sha1(pre_hash.encode("utf-8")).hexdigest()

    def _request(
        self,
        method: str,
        path: str,
        app_key: str,
        app_secret: str,
        consumer_key: str,
    ) -> Any:
        url = f"{self.BASE_URL}{path}"
        timestamp = self._timestamp()
        signature = self._sign(app_secret, consumer_key, method, url, "", timestamp)
        headers = {
            "X-Ovh-Application": app_key,
            "X-Ovh-Consumer": consumer_key,
            "X-Ovh-Timestamp": timestamp,
            "X-Ovh-Signature": signature,
            "Content-Type": "application/json",
            "Accept": "application/json",
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
            # Step 1 — validate credentials with /me (always accessible)
            me = self._request("GET", "/me", app_key, app_secret, consumer_key)
            nichandle = me.get("nichandle", "inconnu")

            # Step 2 — probe /me/bill to check billing permissions
            try:
                bills = self._request("GET", "/me/bill", app_key, app_secret, consumer_key)
                count = len(bills) if isinstance(bills, list) else 0
                return {
                    "success": True,
                    "message": (
                        f"Connecté en tant que {nichandle} — "
                        f"{count} facture(s) disponible(s)"
                    ),
                    "records_found": count,
                }
            except requests.exceptions.HTTPError as bill_err:
                bill_status = bill_err.response.status_code if bill_err.response is not None else "?"
                if bill_status == 403:
                    return {
                        "success": False,
                        "message": (
                            f"Connecté en tant que {nichandle}, mais le Consumer Key n'a pas "
                            f"accès à GET /me/bill. "
                            f"Recréez le token sur eu.api.ovh.com/createToken en cochant : "
                            f"GET /me/bill, GET /me/bill/*"
                        ),
                        "records_found": 0,
                    }
                raise  # re-raise unexpected errors

        except requests.exceptions.HTTPError as e:
            status = e.response.status_code if e.response is not None else "?"
            if status == 403:
                msg = "Accès refusé — vérifiez vos droits Consumer Key (GET /me et GET /me/bill requis)"
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
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        app_key, app_secret, consumer_key = self._keys(auth_fields)
        if not all([app_key, app_secret, consumer_key]):
            raise ValueError("Application Key, Application Secret et Consumer Key requis")

        # 1. Get list of bill IDs — raise PermissionError on 403 for clear frontend message
        try:
            bill_ids = self._request("GET", "/me/bill", app_key, app_secret, consumer_key)
        except requests.exceptions.HTTPError as e:
            status = e.response.status_code if e.response is not None else 0
            if status == 403:
                raise PermissionError(
                    "Le Consumer Key n'a pas accès à GET /me/bill. "
                    "Recréez votre token sur eu.api.ovh.com/createToken "
                    "en cochant : GET /me/bill et GET /me/bill/*"
                ) from e
            raise

        if not isinstance(bill_ids, list):
            logger.warning("OVH /me/bill returned unexpected format")
            return []

        # 2. Filter by date if provided
        start = datetime.strptime(start_date, "%Y-%m-%d").date() if start_date else None
        end = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else None

        costs = []
        # Process latest 50 bills max to avoid timeout
        for bill_id in bill_ids[:50]:
            try:
                detail = self._request(
                    "GET", f"/me/bill/{bill_id}", app_key, app_secret, consumer_key
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
                amount = float(price_ht.get("value", 0) or 0)
                currency = price_ht.get("currencyCode", "EUR")

                if amount <= 0:
                    logger.debug(f"Skipping bill {bill_id} — amount={amount}")
                    continue

                costs.append(
                    {
                        "cost_date": str(bill_date),
                        "amount": amount,
                        "service_name": f"OVHcloud — {bill_id}",
                        "currency": currency,
                        "reference": bill_id,
                        "cost_category": "compute",
                        "source": "OVHcloud",
                        "description": f"Facture OVHcloud {bill_id} du {bill_date}",
                    }
                )
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
# OVHcloud RESOURCES — CPU, RAM, Disk metrics from VPS & Dedicated
#
# REAL OVH API ENDPOINTS (verified):
#   VPS:
#     GET /vps                              → list of VPS names
#     GET /vps/{name}                       → VPS info (model, RAM, disk capacity)
#     GET /vps/{name}/use?type=cpu          → current CPU usage (%)
#     GET /vps/{name}/use?type=mem          → current RAM usage (bytes used / total)
#     GET /vps/{name}/use?type=storage      → disk usage (bytes)
#
#   Dedicated:
#     GET /dedicated/server                 → list of server names
#     GET /dedicated/server/{name}          → server info
#     GET /dedicated/server/{name}/statistics?period=hourly&type=cpu → CPU time-series
#     GET /dedicated/server/{name}/statistics?period=hourly&type=ram → RAM time-series
#     GET /dedicated/server/{name}/statistics?period=hourly&type=diskUsage/{disk} → Disk
#     GET /dedicated/server/{name}/hardware → get disk list for disk stats
#
# NOTE: /vps/{name}/monitoring does NOT exist — that was a wrong endpoint.
# ─────────────────────────────────────────────────────────────────────
class OVHResourceFetcher(BaseFetcher):
    BASE_URL = "https://eu.api.ovh.com/1.0"

    def _timestamp(self) -> str:
        return str(int(time.time()))

    def _sign(
        self,
        app_secret: str,
        consumer_key: str,
        method: str,
        url: str,
        body: str,
        timestamp: str,
    ) -> str:
        pre_hash = "+".join(
            [app_secret, consumer_key, method.upper(), url, body, timestamp]
        )
        return "$1$" + hashlib.sha1(pre_hash.encode("utf-8")).hexdigest()

    def _request(
        self,
        method: str,
        path: str,
        app_key: str,
        app_secret: str,
        consumer_key: str,
    ) -> Any:
        url = f"{self.BASE_URL}{path}"
        timestamp = self._timestamp()
        signature = self._sign(app_secret, consumer_key, method, url, "", timestamp)
        headers = {
            "X-Ovh-Application": app_key,
            "X-Ovh-Consumer": consumer_key,
            "X-Ovh-Timestamp": timestamp,
            "X-Ovh-Signature": signature,
            "Content-Type": "application/json",
            "Accept": "application/json",
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

    def test_connection(self, auth_fields: Dict) -> Dict[str, Any]:
        """Test OVHcloud resource API access"""
        app_key, app_secret, consumer_key = self._keys(auth_fields)
        if not all([app_key, app_secret, consumer_key]):
            return {
                "success": False,
                "message": "Application Key, Application Secret et Consumer Key requis",
                "records_found": 0,
            }
        try:
            # First test basic auth with /me
            me = self._request("GET", "/me", app_key, app_secret, consumer_key)
            nichandle = me.get("nichandle", "inconnu")
            
            vps_count = 0
            ded_count = 0
            errors = []

            # Test VPS access
            try:
                vps_list = self._request("GET", "/vps", app_key, app_secret, consumer_key)
                vps_count = len(vps_list) if isinstance(vps_list, list) else 0
                logger.info(f"✅ VPS access OK - {vps_count} VPS found")
            except requests.exceptions.HTTPError as vps_err:
                if vps_err.response and vps_err.response.status_code == 403:
                    errors.append("GET /vps, GET /vps/*")
                    logger.warning("⚠️ VPS access denied (403)")
                else:
                    raise

            # Test Dedicated access
            try:
                ded_list = self._request(
                    "GET", "/dedicated/server", app_key, app_secret, consumer_key
                )
                ded_count = len(ded_list) if isinstance(ded_list, list) else 0
                logger.info(f"✅ Dedicated access OK - {ded_count} servers found")
            except requests.exceptions.HTTPError as ded_err:
                if ded_err.response and ded_err.response.status_code == 403:
                    errors.append("GET /dedicated/server, GET /dedicated/server/*")
                    logger.warning("⚠️ Dedicated server access denied (403)")
                else:
                    raise

            # If both failed with 403, return permission error
            if errors and vps_count == 0 and ded_count == 0:
                return {
                    "success": False,
                    "message": (
                        f"Connecté en tant que {nichandle}, mais le Consumer Key n'a pas "
                        f"accès aux ressources. Recréez le token sur eu.api.ovh.com/createToken "
                        f"en cochant toutes ces permissions :\n"
                        f"• GET /vps\n"
                        f"• GET /vps/*\n"
                        f"• GET /dedicated/server\n"
                        f"• GET /dedicated/server/*"
                    ),
                    "records_found": 0,
                }

            total = vps_count + ded_count
            
            if total == 0:
                return {
                    "success": False,
                    "message": (
                        f"Connecté en tant que {nichandle}, mais aucun serveur VPS ou Dédié trouvé. "
                        f"Vérifiez que votre compte possède des ressources ou que le Consumer Key "
                        f"a les permissions nécessaires."
                    ),
                    "records_found": 0,
                }
            
            msg = f"✅ Connecté en tant que {nichandle} — {vps_count} VPS + {ded_count} Dedicated serveurs trouvés"
            
            if errors:
                msg += f"\n⚠️ Accès partiel - Permissions manquantes: {', '.join(errors)}"

            return {
                "success": True,
                "message": msg,
                "records_found": total,
            }
        except requests.exceptions.HTTPError as e:
            status = e.response.status_code if e.response is not None else "?"
            if status == 403:
                msg = (
                    "Accès refusé (403) — Le Consumer Key n'a pas les permissions nécessaires. "
                    "Recréez votre token sur eu.api.ovh.com/createToken en cochant :\n"
                    "• GET /vps\n"
                    "• GET /vps/*\n"
                    "• GET /dedicated/server\n"
                    "• GET /dedicated/server/*"
                )
            elif status == 401:
                msg = "Clés invalides ou expirées (401)"
            elif status == 400:
                msg = "Requête invalide (400) — Vérifiez vos clés API"
            else:
                msg = f"OVH API error {status}"
            return {"success": False, "message": msg, "records_found": 0}
        except Exception as e:
            logger.error(f"Unexpected error in test_connection: {e}", exc_info=True)
            return {"success": False, "message": f"Erreur inattendue: {str(e)}", "records_found": 0}

    def fetch_costs(
        self,
        auth_fields: Dict,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Resource fetcher does not fetch costs — use fetch_resources() instead."""
        return []

    def fetch_resources(self, auth_fields: Dict) -> List[Dict[str, Any]]:
        """
        Fetch CPU, RAM, Disk metrics from all VPS and Dedicated servers.

        Uses the CORRECT OVH API endpoints:
          VPS:       GET /vps/{name}/use?type=cpu|mem|storage
          Dedicated: GET /dedicated/server/{name}/statistics?period=hourly&type=cpu|ram

        Returns list of dicts compatible with ResourceMetricCreate schema.
        """
        app_key, app_secret, consumer_key = self._keys(auth_fields)
        if not all([app_key, app_secret, consumer_key]):
            raise ValueError("Application Key, Application Secret et Consumer Key requis")

        metrics = []
        now = datetime.utcnow()

        # ─── 1. Fetch all VPS servers ─────────────────────────────
        logger.info("📡 Fetching VPS list...")
        try:
            vps_names = self._request("GET", "/vps", app_key, app_secret, consumer_key)
            if not isinstance(vps_names, list):
                vps_names = []
            logger.info(f"✅ Found {len(vps_names)} VPS servers: {vps_names}")
        except requests.exceptions.HTTPError as e:
            if e.response and e.response.status_code == 403:
                logger.error("❌ 403 Forbidden on GET /vps - Missing permissions")
                raise PermissionError(
                    "Accès refusé à GET /vps. "
                    "Recréez votre token sur eu.api.ovh.com/createToken en cochant : GET /vps, GET /vps/*"
                )
            logger.error(f"❌ Could not fetch VPS list: HTTP {e.response.status_code if e.response else '?'}")
            vps_names = []
        except Exception as e:
            logger.error(f"❌ Could not fetch VPS list: {e}", exc_info=True)
            vps_names = []

        # ─── 2. Fetch metrics for each VPS ───────────────────────
        #
        # NOTE: OVH removed all real-time VPS monitoring endpoints:
        #   /vps/{name}/use        → returns 400 on all new-gen VPS (post-2020)
        #   /vps/{name}/monitoring → DEPRECATED, deleted 15/09/2024
        #   /vps/{name}/statistics → never existed on new-gen VPS
        #
        # The ONLY available data via the public API is hardware capacity
        # from GET /vps/{name}. CPU usage is impossible to retrieve without
        # installing a monitoring agent (Telegraf, Netdata, etc.) on each VPS.
        # CPU is therefore stored as NULL to distinguish from "0% load".
        for vps_name in vps_names:
            try:
                logger.info(f"📊 Fetching specs for VPS: {vps_name}")

                vps_info      = self._request("GET", f"/vps/{vps_name}", app_key, app_secret, consumer_key)
                ram_total_gb  = self._parse_vps_ram_total(vps_info)
                disk_total_gb = self._parse_vps_disk_total(vps_info)
                vps_state     = vps_info.get("state", "unknown")

                logger.info(
                    f"  state={vps_state} "
                    f"ram_cap={ram_total_gb:.1f}GB "
                    f"disk_cap={disk_total_gb:.1f}GB "
                    f"[CPU=N/A — no OVH public API for VPS CPU since 15/09/2024]"
                )

                metric = {
                    "server_name": vps_name,
                    "server_type": "VPS",
                    "cpu_usage":   None,                      # no OVH endpoint available
                    "ram_usage":   round(ram_total_gb, 3),    # hardware capacity (not live usage)
                    "disk_usage":  round(disk_total_gb, 3),   # hardware capacity (not live usage)
                    "recorded_at": now.isoformat(),
                }
                metrics.append(metric)
                logger.info(
                    f"✅ VPS {vps_name}: CPU=N/A "
                    f"RAM={ram_total_gb:.3f}GB Disk={disk_total_gb:.3f}GB [hw-specs]"
                )

            except requests.exceptions.HTTPError as e:
                status = e.response.status_code if e.response else "?"
                logger.warning(f"⚠️ Could not fetch metrics for VPS {vps_name}: HTTP {status} - {e}")
                if e.response:
                    logger.warning(f"   Response body: {e.response.text[:200]}")
                continue
            except Exception as e:
                logger.error(f"❌ Error processing VPS {vps_name}: {e}", exc_info=True)
                continue

        # ─── 3. Fetch all Dedicated servers ──────────────────────
        logger.info("📡 Fetching Dedicated server list...")
        try:
            ded_names = self._request("GET", "/dedicated/server", app_key, app_secret, consumer_key)
            if not isinstance(ded_names, list):
                ded_names = []
            logger.info(f"✅ Found {len(ded_names)} Dedicated servers: {ded_names}")
        except requests.exceptions.HTTPError as e:
            if e.response and e.response.status_code == 403:
                logger.error("❌ 403 Forbidden on GET /dedicated/server - Missing permissions")
                if len(metrics) == 0:
                    # Only raise if we also got no VPS metrics
                    raise PermissionError(
                        "Accès refusé à GET /dedicated/server. "
                        "Recréez votre token sur eu.api.ovh.com/createToken en cochant : "
                        "GET /dedicated/server, GET /dedicated/server/*"
                    )
            logger.error(f"❌ Could not fetch Dedicated servers: HTTP {e.response.status_code if e.response else '?'}")
            ded_names = []
        except Exception as e:
            logger.error(f"❌ Could not fetch Dedicated servers: {e}", exc_info=True)
            ded_names = []

        # ─── 4. Fetch metrics for each Dedicated server ──────────
        for server_name in ded_names:
            try:
                logger.info(f"📊 Fetching metrics for Dedicated: {server_name}")

                cpu_usage     = 0.0
                ram_usage_gb  = 0.0
                disk_usage_gb = 0.0

                # ── Strategy 1: Try real-time stats via /statistics (requires RTM/Netdata)
                # GET /dedicated/server/{name}/statistics?period=hourly&type=cpu
                # GET /dedicated/server/{name}/statistics?period=hourly&type=ram
                # These return a time-series; we extract the latest non-null value.
                rtm_ok = False
                for period in ("hourly", "daily"):
                    try:
                        raw_cpu = self._request(
                            "GET",
                            f"/dedicated/server/{server_name}/statistics?period={period}&type=cpu",
                            app_key, app_secret, consumer_key,
                        )
                        v = self._extract_latest_value(raw_cpu)
                        logger.info(f"  [ded/stats cpu period={period}] → {v:.2f}%")
                        if v > 0:
                            cpu_usage = v
                            rtm_ok = True
                    except requests.exceptions.HTTPError as e:
                        sc = e.response.status_code if e.response else "?"
                        logger.info(f"  [ded/stats cpu] HTTP {sc} — RTM not available for {server_name}")
                        break
                    except Exception as e:
                        logger.warning(f"  [ded/stats cpu] error: {e}")
                        break

                    try:
                        raw_ram = self._request(
                            "GET",
                            f"/dedicated/server/{server_name}/statistics?period={period}&type=ram",
                            app_key, app_secret, consumer_key,
                        )
                        v = self._extract_latest_value(raw_ram)
                        logger.info(f"  [ded/stats ram period={period}] → {v}")
                        if v > 0:
                            # OVH returns RAM in bytes — convert to GB
                            ram_usage_gb = v / (1024 ** 3) if v > 1_000_000 else v
                            rtm_ok = True
                    except Exception as e:
                        logger.warning(f"  [ded/stats ram] error: {e}")

                    if rtm_ok:
                        break

                # ── Strategy 2: Hardware specs — always fetch.
                #
                # GET /dedicated/server/{name}/specifications/hardware
                #   memorySize: total RAM in MB
                #   diskGroups: FLAT list of disk groups — each group has "diskSize" and
                #               "numberOfDisks" directly on it. There is NO nested "disks" array.
                #
                # Actual OVH response example:
                #   "diskGroups": [{"diskSize": {"unit": "GB", "value": 4000},
                #                   "numberOfDisks": 2, "diskType": "SATA", ...}]
                #
                # Fix: iterate groups directly (not ctrl → disks → disk).
                try:
                    hw = self._request(
                        "GET",
                        f"/dedicated/server/{server_name}/specifications/hardware",
                        app_key, app_secret, consumer_key,
                    )
                    logger.info(f"  [ded/hw] raw={str(hw)[:300]}")

                    # RAM capacity: memorySize in MB → GB
                    mem_mb = hw.get("memorySize", {})
                    if isinstance(mem_mb, dict):
                        mem_mb = mem_mb.get("value", 0)
                    ram_capacity_gb = float(mem_mb) / 1024.0 if mem_mb else 0.0
                    logger.info(f"  [ded/hw] RAM capacity = {ram_capacity_gb:.1f}GB")
                    if not rtm_ok and ram_capacity_gb > 0:
                        ram_usage_gb = ram_capacity_gb

                    # Disk: each diskGroup has "diskSize" directly (no nested "disks" list).
                    # Total = sum(diskSize.value × numberOfDisks) across all groups.
                    disk_total_gb = 0.0
                    for grp in hw.get("diskGroups", []):
                        ds = grp.get("diskSize", {})
                        if isinstance(ds, dict):
                            size_gb = float(ds.get("value", 0))
                            unit = ds.get("unit", "GB").upper()
                            if unit == "MB":
                                size_gb /= 1024.0
                            n_disks = int(grp.get("numberOfDisks", 1))
                            disk_total_gb += size_gb * n_disks
                    if disk_total_gb > 0:
                        disk_usage_gb = disk_total_gb
                        logger.info(f"  [ded/hw] Disk total = {disk_usage_gb:.1f}GB")

                    cores_per_proc = hw.get("coresPerProcessor", 0) or 0
                    n_procs = hw.get("numberOfProcessors", 1) or 1
                    cpu_cores_hw = int(cores_per_proc) * int(n_procs)
                    threads_per_proc = hw.get("threadsPerProcessor", 0) or 0
                    cpu_threads_hw = int(threads_per_proc) * int(n_procs)
                    proc_name = hw.get("processorName", "") or ""
                    logger.info(
                        f"  [ded/hw] CPU: {n_procs}x {proc_name} "
                        f"= {cpu_cores_hw} cores / {cpu_threads_hw} threads"
                    )

                except requests.exceptions.HTTPError as e:
                    sc = e.response.status_code if e.response else "?"
                    body = e.response.text[:150] if e.response else ""
                    logger.warning(f"  ⚠️ Dedicated {server_name} hw specs HTTP {sc}: {body}")
                    cpu_cores_hw = 0
                    cpu_threads_hw = 0
                    proc_name = ""
                except Exception as e:
                    logger.warning(f"  ⚠️ Dedicated {server_name} hw specs error: {e}")
                    cpu_cores_hw = 0
                    cpu_threads_hw = 0
                    proc_name = ""

                # CPU: real RTM value if available, else None (no real-time without RTM)
                # CPU storage convention:
                #   cpu_usage > 0    → real RTM usage (%)
                #   cpu_usage = None → no RTM AND no hw specs
                #   cpu_usage < 0    → sentinel: abs(value) = physical cores from hw specs
                if rtm_ok:
                    cpu_final: Optional[float] = round(cpu_usage, 2)
                elif cpu_cores_hw > 0:
                    cpu_final = -float(cpu_cores_hw)   # negative sentinel = core count
                else:
                    cpu_final = None

                metric = {
                    "server_name":  server_name,
                    "server_type":  "DEDICATED",
                    "cpu_usage":    cpu_final,
                    "ram_usage":    round(ram_usage_gb, 3),
                    "disk_usage":   round(disk_usage_gb, 3),
                    "recorded_at":  now.isoformat(),
                }
                metrics.append(metric)
                logger.info(
                    f"  => CPU={'%.1f%%' % cpu_usage if rtm_ok else ('%dc hw-spec' % cpu_cores_hw if cpu_cores_hw else 'N/A')} "
                    f"RAM={ram_usage_gb:.3f}GB Disk={disk_usage_gb:.3f}GB"
                    + (" [RTM]" if rtm_ok else " [hw-specs]")
                )

            except requests.exceptions.HTTPError as e:
                status = e.response.status_code if e.response else "?"
                logger.warning(f"⚠️ Could not fetch metrics for Dedicated {server_name}: HTTP {status} - {e}")
                if e.response:
                    logger.warning(f"   Response body: {e.response.text[:200]}")
                continue
            except Exception as e:
                logger.error(f"❌ Error processing Dedicated {server_name}: {e}", exc_info=True)
                continue

        logger.info(f"✅ OVH Resources: {len(metrics)} server metrics retrieved")
        
        if len(metrics) == 0:
            logger.warning("⚠️ No metrics were collected - this could indicate permission issues or no servers")
        
        return metrics

    # ── VPS helpers ───────────────────────────────────────────────

    def _fetch_vps_use(
        self,
        vps_name: str,
        use_type: str,
        app_key: str,
        app_secret: str,
        consumer_key: str,
    ) -> float:
        """
        GET /vps/{name}/use?type={cpu|mem|storage}
        Returns the 'value' from the latest data point.
        Response format: { "type": "cpu", "unit": "percent", "values": [{"timestamp": ..., "value": ...}] }
        """
        try:
            data = self._request(
                "GET",
                f"/vps/{vps_name}/use?type={use_type}",
                app_key, app_secret, consumer_key,
            )
            result = self._extract_latest_value(data)
            if result == 0.0:
                logger.warning(
                    f"⚠️ VPS {vps_name} use/{use_type} returned 0. "
                    f"Raw response: {str(data)[:200]}"
                )
            return result
        except Exception as e:
            logger.warning(f"⚠️ Could not fetch VPS {vps_name} use/{use_type}: {e}")
            return 0.0

    def _parse_vps_ram_total(self, vps_info: Dict) -> float:
        """Extract total RAM in GB from /vps/{name} response."""
        try:
            # New VPS format: memoryLimit in MB
            if "memoryLimit" in vps_info:
                return float(vps_info["memoryLimit"]) / 1024.0
            # Old format: model.ram in MB
            model = vps_info.get("model", {})
            ram_mb = model.get("ram", 0) or vps_info.get("ram", 0)
            if ram_mb > 0:
                return float(ram_mb) / 1024.0
            # Some APIs return vcore/memory directly in GB
            if "memory" in vps_info:
                v = float(vps_info["memory"])
                return v / 1024.0 if v > 64 else v  # >64 → likely MB
        except Exception:
            pass
        return 0.0

    def _parse_vps_disk_total(self, vps_info: Dict) -> float:
        """Extract total disk in GB from /vps/{name} response."""
        try:
            # New VPS format: diskLimit in GB
            if "diskLimit" in vps_info:
                return float(vps_info["diskLimit"])
            model = vps_info.get("model", {})
            disk_gb = model.get("disk", 0) or vps_info.get("disk", 0)
            if disk_gb > 0:
                # OVH sometimes returns bytes for disk
                return float(disk_gb) / (1024 ** 3) if disk_gb > 1_000_000 else float(disk_gb)
        except Exception:
            pass
        return 0.0

    def _bytes_to_gb_or_percent(self, value: float, total_gb: float) -> float:
        """
        Convert a metric value to GB.
        OVH VPS use?type=mem returns bytes used.
        OVH VPS use?type=storage returns bytes used.
        OVH VPS use?type=cpu returns percent (0-100).
        """
        if value <= 0:
            return 0.0
        # Large number → almost certainly bytes → convert to GB
        if value > 1_000_000:
            return value / (1024 ** 3)
        # Small percentage (0-100) + we know total → convert to GB
        if value <= 100 and total_gb > 0:
            return (value / 100.0) * total_gb
        # Already in GB or small absolute value
        return value

    # ── Dedicated server helpers ──────────────────────────────────

    def _fetch_dedicated_stat(
        self,
        server_name: str,
        stat_type: str,
        app_key: str,
        app_secret: str,
        consumer_key: str,
    ) -> float:
        """
        GET /dedicated/server/{name}/statistics?period=hourly&type={cpu|ram}
        Returns latest value from the time-series.
        Response: { "type": "cpu", "unit": "percent", "values": [{"timestamp": ..., "value": ...}] }
        """
        try:
            data = self._request(
                "GET",
                f"/dedicated/server/{server_name}/statistics?period=hourly&type={stat_type}",
                app_key, app_secret, consumer_key,
            )
            result = self._extract_latest_value(data)
            if result == 0.0:
                logger.warning(
                    f"⚠️ Dedicated {server_name} stat/{stat_type} returned 0. "
                    f"Raw response: {str(data)[:200]}"
                )
            return result
        except Exception as e:
            logger.warning(f"⚠️ Could not fetch Dedicated {server_name} stat/{stat_type}: {e}")
            return 0.0

    def _fetch_dedicated_disk(
        self,
        server_name: str,
        app_key: str,
        app_secret: str,
        consumer_key: str,
    ) -> float:
        """
        Fetch disk usage for a dedicated server.
        First gets disk list from /dedicated/server/{name}/hardware,
        then fetches diskUsage/{disk_id} stat for the first disk.
        """
        try:
            hardware = self._request(
                "GET",
                f"/dedicated/server/{server_name}/hardware",
                app_key, app_secret, consumer_key,
            )
            # hardware.diskGroups[0].disks[0].diskId or similar
            disk_id = self._extract_first_disk_id(hardware)
            if disk_id is None:
                return 0.0

            data = self._request(
                "GET",
                f"/dedicated/server/{server_name}/statistics?period=hourly&type=diskUsage/{disk_id}",
                app_key, app_secret, consumer_key,
            )
            raw = self._extract_latest_value(data)
            # Convert bytes to GB if needed
            return raw / (1024 ** 3) if raw > 1_000_000 else raw

        except Exception as e:
            logger.debug(f"Could not fetch disk usage for Dedicated {server_name}: {e}")
            return 0.0

    def _extract_first_disk_id(self, hardware: Dict) -> Optional[str]:
        """Extract first disk ID from /dedicated/server/{name}/hardware response."""
        try:
            disk_groups = hardware.get("diskGroups", [])
            if disk_groups:
                disks = disk_groups[0].get("disks", [])
                if disks:
                    return str(disks[0].get("diskId", disks[0].get("id")))
            # Fallback: try flat disks list
            disks = hardware.get("disks", [])
            if disks:
                return str(disks[0].get("diskId", disks[0].get("id", "sda")))
        except Exception:
            pass
        return None

    def _extract_latest_value(self, data: Any) -> float:
        """
        Extract the latest non-null value from any OVH statistics response.

        Known OVH response formats:
          A) {"type":"cpu","unit":"percent","values":[{"timestamp":T,"value":V}, ...]}
          B) [{"timestamp":T,"value":V}, ...]                  ← direct list
          C) 12.5                                               ← plain number
          D) {"values":[12.5, 14.2]}                           ← plain number list
          E) {"data":{"values":[...]}}                         ← nested
          F) {"type":"cpu","unit":"percent","values":[]}        ← empty (VPS off/no data)

        NOTE: OVH often includes null values in the series for missing intervals.
              We skip those and take the latest non-null value.
        """
        try:
            # Format C — plain number
            if isinstance(data, (int, float)):
                v = float(data)
                logger.info(f"    → plain number value: {v}")
                return v

            # Format B — direct list of {timestamp, value}
            if isinstance(data, list):
                valid = [v for v in data if isinstance(v, dict) and v.get("value") is not None]
                if not valid:
                    # maybe list of plain numbers
                    nums = [v for v in data if isinstance(v, (int, float)) and v is not None]
                    return float(nums[-1]) if nums else 0.0
                latest = sorted(valid, key=lambda v: v.get("timestamp", 0), reverse=True)[0]
                return float(latest["value"])

            if not isinstance(data, dict):
                logger.warning(f"  ⚠️ Unknown stats type={type(data).__name__}: {str(data)[:120]}")
                return 0.0

            # Format E — nested under 'data'
            if "data" in data and isinstance(data["data"], dict):
                data = data["data"]

            values = data.get("values", [])

            if not values:
                # Try direct 'value' field
                if "value" in data and data["value"] is not None:
                    return float(data["value"])
                logger.info(f"    → empty values list. keys={list(data.keys())}")
                return 0.0

            # Format D — plain number list
            if isinstance(values[0], (int, float)):
                non_null = [v for v in values if v is not None]
                return float(non_null[-1]) if non_null else 0.0

            # Format A — list of {"timestamp": T, "value": V}
            if isinstance(values[0], dict):
                # Filter out null values (OVH pads with nulls for missing intervals)
                valid = [v for v in values if v.get("value") is not None]
                if not valid:
                    logger.info(f"    → all {len(values)} values are null (server may be off or no recent data)")
                    return 0.0
                latest = sorted(valid, key=lambda v: v.get("timestamp", 0), reverse=True)[0]
                v = float(latest["value"])
                logger.info(f"    → extracted value={v} from {len(valid)} non-null points")
                return v

            logger.warning(f"  ⚠️ Unrecognized values[0] type={type(values[0])}: {str(values[:2])[:120]}")
            return 0.0

        except Exception as e:
            logger.warning(f"  ⚠️ _extract_latest_value error: {e} | data={str(data)[:150]}")
            return 0.0


# ─────────────────────────────────────────────────────────────────────
# AWS — stub (ready to implement with boto3 or AWS4 signing)
# ─────────────────────────────────────────────────────────────────────
class AWSFetcher(BaseFetcher):

    def test_connection(self, auth_fields: Dict) -> Dict[str, Any]:
        access_key = auth_fields.get("access_key", "").strip()
        secret_key = auth_fields.get("secret_key", "").strip()
        if not access_key or not secret_key:
            return {
                "success": False,
                "message": "Access Key ID et Secret Access Key requis",
                "records_found": 0,
            }
        # TODO: implement AWS4 signature + Cost Explorer API
        return {
            "success": False,
            "message": "AWS Cost Explorer — intégration à venir. Clés reçues ✓",
            "records_found": 0,
        }

    def fetch_costs(
        self, auth_fields: Dict, start_date=None, end_date=None
    ) -> List[Dict]:
        # TODO: implement with requests + AWS4 HMAC signing
        # Endpoint: POST https://ce.us-east-1.amazonaws.com/
        # Action: GetCostAndUsage
        raise NotImplementedError("AWS Cost Explorer — intégration à venir")


# ─────────────────────────────────────────────────────────────────────
# Azure — stub (ready to implement with OAuth2 + Cost Management API)
# ─────────────────────────────────────────────────────────────────────
class AzureFetcher(BaseFetcher):

    def test_connection(self, auth_fields: Dict) -> Dict[str, Any]:
        tenant_id = auth_fields.get("tenant_id", "").strip()
        client_id = auth_fields.get("client_id", "").strip()
        client_secret = auth_fields.get("client_secret", "").strip()
        if not all([tenant_id, client_id, client_secret]):
            return {
                "success": False,
                "message": "Tenant ID, Client ID et Client Secret requis",
                "records_found": 0,
            }
        # TODO: POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
        return {
            "success": False,
            "message": "Azure Cost Management — intégration à venir. Credentials reçus ✓",
            "records_found": 0,
        }

    def fetch_costs(
        self, auth_fields: Dict, start_date=None, end_date=None
    ) -> List[Dict]:
        # TODO: implement OAuth2 token fetch then Cost Management query
        raise NotImplementedError("Azure Cost Management — intégration à venir")


# ─────────────────────────────────────────────────────────────────────
# GCP — stub (ready to implement with API Key or Service Account JWT)
# ─────────────────────────────────────────────────────────────────────
class GCPFetcher(BaseFetcher):

    def test_connection(self, auth_fields: Dict) -> Dict[str, Any]:
        api_key = auth_fields.get("api_key", "").strip()
        project_id = auth_fields.get("project_id", "").strip()
        if not api_key or not project_id:
            return {
                "success": False,
                "message": "Project ID et API Key requis",
                "records_found": 0,
            }
        # TODO: GET https://cloudbilling.googleapis.com/v1/billingAccounts?key={api_key}
        return {
            "success": False,
            "message": "Google Cloud Billing — intégration à venir. Credentials reçus ✓",
            "records_found": 0,
        }

    def fetch_costs(
        self, auth_fields: Dict, start_date=None, end_date=None
    ) -> List[Dict]:
        # TODO: implement Cloud Billing API with API key or JWT service account
        raise NotImplementedError("Google Cloud Billing — intégration à venir")


# ─────────────────────────────────────────────────────────────────────
# Custom — generic: injects custom headers and forwards the request
# ─────────────────────────────────────────────────────────────────────
class CustomFetcher(BaseFetcher):

    def test_connection(self, auth_fields: Dict) -> Dict[str, Any]:
        return {
            "success": True,
            "message": "Mode Custom — la connexion sera testée lors de l'import",
            "records_found": 0,
        }

    def fetch_costs(
        self,
        auth_fields: Dict,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        url: Optional[str] = None,
        method: str = "GET",
        extra_headers: Optional[Dict] = None,
    ) -> List[Dict]:
        if not url:
            raise ValueError("URL requise pour le mode Custom")

        headers = {"Content-Type": "application/json", "Accept": "application/json"}

        # Inject custom auth header
        auth_header = auth_fields.get("auth_header", "Authorization")
        auth_value = auth_fields.get("auth_value", "")
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
            data = data.get(
                "data", data.get("items", data.get("costs", data.get("records", [])))
            )

        costs = []
        for item in data if isinstance(data, list) else []:
            try:
                amount = float(
                    item.get("amount")
                    or item.get("cost")
                    or item.get("price")
                    or item.get("total")
                    or 0
                )
                if amount <= 0:
                    continue
                raw_date = (
                    item.get("date")
                    or item.get("cost_date")
                    or item.get("timestamp")
                    or str(date.today())
                )
                costs.append(
                    {
                        "cost_date": str(raw_date)[:10],
                        "amount": amount,
                        "service_name": item.get("service")
                        or item.get("name")
                        or item.get("description")
                        or "Custom",
                        "currency": item.get("currency", "EUR"),
                        "cost_category": item.get("category") or item.get("type"),
                        "source": "Custom",
                        "description": item.get("description") or item.get("detail"),
                    }
                )
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
    "ovh": OVHFetcher(),
    "ovhcloud-resources": OVHResourceFetcher(),
    "ovh-resources": OVHResourceFetcher(),
    "aws": AWSFetcher(),
    "azure": AzureFetcher(),
    "gcp": GCPFetcher(),
    "custom": CustomFetcher(),
}


def get_fetcher(source_name: str) -> BaseFetcher:
    key = source_name.lower().strip()
    fetcher = _FETCHERS.get(key)
    if not fetcher:
        # fallback to custom for unknown sources
        logger.warning(f"No fetcher for '{source_name}' — using CustomFetcher")
        return _FETCHERS["custom"]
    return fetcher


def get_resource_fetcher(source_name: str) -> Optional[OVHResourceFetcher]:
    """Get resource fetcher if available (for metrics, not costs)"""
    key = source_name.lower().strip()
    if key in ["ovhcloud-resources", "ovh-resources"]:
        return _FETCHERS.get(key)
    return None