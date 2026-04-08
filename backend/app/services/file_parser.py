from email import header
import re
import pandas as pd
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime, date

from sqlalchemy import table
from app.config import settings

logger = logging.getLogger(__name__)

UUID_RE = re.compile(
    r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    re.IGNORECASE,
)

AMOUNT_RE = re.compile(r'^[\d\s\xa0]+[,.][\d]{2}\s*€?$')

# Hostname patterns: ns3012345.ip-1-2-3.eu, vps123456.vps.ovh.net, ip-1-2-3.eu, etc.
HOSTNAME_RE = re.compile(
    r'^(?:ns\d+\.|vps\d+\.|ip-[\d-]+\.|[a-z0-9]+-[a-z0-9-]+\.)',
    re.IGNORECASE,
)

# OVH header words — any row containing 2+ of these is a header row, not data
_OVH_HEADER_WORDS = {
    'abonnement', 'référence', 'reference', 'réf', 'quantité',
    'quantite', 'prix unitaire', 'prix ht', 'montant',
}

# ── Regex pour lire les totaux officiels dans le texte brut du PDF ──────────
_RE_TOTAL_HT  = re.compile(
    r'(?:prix\s+ht|total\s+ht|sous[- ]total\s+ht)\s+([\d\s\xa0]+[,.]\d{2})\s*€?',
    re.IGNORECASE,
)
_RE_TOTAL_TTC = re.compile(
    r'(?:total\s+ttc|total\s+de\s+la\s+facture|montant\s+ttc)\s+([\d\s\xa0]+[,.]\d{2})\s*€?',
    re.IGNORECASE,
)
# Référence facture OVH : "FR74499764", "FR75801382", etc.
_RE_INVOICE_REF = re.compile(r'\b(FR\d{7,10})\b', re.IGNORECASE)

# ── Date patterns ────────────────────────────────────────────────────────────
# 1) Numeric:  "01/01/2026"  or  "2026-01-01"
_RE_INVOICE_DATE_NUMERIC = re.compile(
    r'\b(\d{2}/\d{2}/\d{4}|\d{4}-\d{2}-\d{2})\b'
)
# 2) French long form: "01 Janvier 2026", "1 Mars 2026", etc.
_RE_INVOICE_DATE_FR = re.compile(
    r'\b(\d{1,2})\s+'
    r'(janvier|f\xe9vrier|fevrier|mars|avril|mai|juin|juillet|ao\xfbt|aout|'
    r'septembre|octobre|novembre|d\xe9cembre|decembre)'
    r'\s+(\d{4})\b',
    re.IGNORECASE,
)

_FR_MONTHS = {
    'janvier': 1, 'février': 2, 'fevrier': 2, 'mars': 3,
    'avril': 4, 'mai': 5, 'juin': 6, 'juillet': 7,
    'août': 8, 'aout': 8, 'septembre': 9, 'octobre': 10,
    'novembre': 11, 'décembre': 12, 'decembre': 12,
}

# Anchor phrases — date found right after these is the invoice date
_DATE_ANCHORS = re.compile(
    r"(?:date\s+d['\u2019\u0060][\xe9e]mission"
    r"|date\s+de\s+facturation|[\xe9e]mis\s+le"
    r"|facture\s+(?:fr\d+\s+)?du)\s*:?\s*",
    re.IGNORECASE,
)


def _parse_fr_amount(s: str) -> Optional[float]:
    """Parse a French-formatted amount string like '4 864,36' → 4864.36"""
    if not s:
        return None
    cleaned = (
        str(s)
        .replace('\xa0', '').replace(' ', '')
        .replace(',', '.')
        .replace('€', '').strip()
    )
    try:
        return float(cleaned)
    except ValueError:
        return None


def _extract_date_from_text(text: str) -> Optional[date]:
    """
    Try to extract the invoice emission date from raw PDF text.

    Priority:
      1. Anchored numeric date  — "Date d'émission : 01/03/2026"
      2. Anchored French date   — "Facture FR75801382 du 01 Mars 2026"
      3. First French long date anywhere on the page
      4. First numeric date     — "01/01/2026" or "2026-01-01"
    """
    # 1 & 2 — anchored search
    for m_anchor in _DATE_ANCHORS.finditer(text):
        after = text[m_anchor.end(): m_anchor.end() + 40]

        # numeric after anchor
        mn = _RE_INVOICE_DATE_NUMERIC.match(after.strip())
        if mn:
            raw = mn.group(1)
            for fmt in ('%d/%m/%Y', '%Y-%m-%d'):
                try:
                    return datetime.strptime(raw, fmt).date()
                except ValueError:
                    continue

        # French long form after anchor
        mf = _RE_INVOICE_DATE_FR.match(after.strip())
        if mf:
            try:
                return date(
                    int(mf.group(3)),
                    _FR_MONTHS[mf.group(2).lower()],
                    int(mf.group(1)),
                )
            except (KeyError, ValueError):
                pass

    # 3 — first French long date anywhere
    mf = _RE_INVOICE_DATE_FR.search(text)
    if mf:
        try:
            return date(
                int(mf.group(3)),
                _FR_MONTHS[mf.group(2).lower()],
                int(mf.group(1)),
            )
        except (KeyError, ValueError):
            pass

    # 4 — first numeric date
    mn = _RE_INVOICE_DATE_NUMERIC.search(text)
    if mn:
        raw = mn.group(1)
        for fmt in ('%d/%m/%Y', '%Y-%m-%d'):
            try:
                return datetime.strptime(raw, fmt).date()
            except ValueError:
                continue

    return None


def _extract_ovh_invoice_meta(pdf) -> Dict[str, Any]:
    """
    Scan all pages of the PDF and extract:
      - invoice_total_ht   : float  (official Prix HT from the summary table)
      - invoice_total_ttc  : float  (official Total TTC)
      - invoice_date       : date   (emission date from header)
      - invoice_reference  : str    (FR-prefixed invoice number)
    """
    meta: Dict[str, Any] = {
        'invoice_total_ht':  None,
        'invoice_total_ttc': None,
        'invoice_date':      None,
        'invoice_reference': None,
    }

    all_text_pages = []
    for page in pdf.pages:
        t = page.extract_text() or ''
        all_text_pages.append(t)

    full_text = '\n'.join(all_text_pages)
    page1_text = all_text_pages[0] if all_text_pages else full_text

    # ── Invoice reference ────────────────────────────────────────────
    m = _RE_INVOICE_REF.search(full_text)
    if m:
        meta['invoice_reference'] = m.group(1).upper()
        logger.debug(f"  invoice_reference = {meta['invoice_reference']}")

    # ── Invoice date — enhanced extractor on page 1 first ───────────
    invoice_date = _extract_date_from_text(page1_text)
    if invoice_date is None:
        invoice_date = _extract_date_from_text(full_text)
    if invoice_date:
        meta['invoice_date'] = invoice_date
        logger.info(f"  invoice_date = {meta['invoice_date']}")
    else:
        logger.warning("  ⚠️  Could not extract invoice date from PDF")

    # ── Total HT / TTC — try structured tables first ────────────────
    for page in pdf.pages:
        for table in (page.extract_tables() or []):
            real = [r for r in table if any(c for c in r if c and str(c).strip())]
            if not real or len(real[0]) > 3:
                continue
            for row in real:
                cells = [str(c or '').strip().lower() for c in row]
                joined = ' '.join(cells)
                if any(k in joined for k in ('prix ht', 'total ht', 'sous-total ht', 'sous total ht')):
                    for c in reversed(row):
                        amt = _parse_fr_amount(str(c or ''))
                        if amt is not None and amt > 0:
                            meta['invoice_total_ht'] = amt
                            logger.debug(f"  invoice_total_ht (table) = {amt}")
                            break
                if any(k in joined for k in ('total ttc', 'total de la facture', 'montant ttc')):
                    for c in reversed(row):
                        amt = _parse_fr_amount(str(c or ''))
                        if amt is not None and amt > 0:
                            meta['invoice_total_ttc'] = amt
                            logger.debug(f"  invoice_total_ttc (table) = {amt}")
                            break

    # Fallback: regex on raw text (last match = grand total)
    if meta['invoice_total_ht'] is None:
        for m in _RE_TOTAL_HT.finditer(full_text):
            amt = _parse_fr_amount(m.group(1))
            if amt and amt > 0:
                meta['invoice_total_ht'] = amt
        if meta['invoice_total_ht']:
            logger.debug(f"  invoice_total_ht (regex) = {meta['invoice_total_ht']}")

    if meta['invoice_total_ttc'] is None:
        for m in _RE_TOTAL_TTC.finditer(full_text):
            amt = _parse_fr_amount(m.group(1))
            if amt and amt > 0:
                meta['invoice_total_ttc'] = amt
        if meta['invoice_total_ttc']:
            logger.debug(f"  invoice_total_ttc (regex) = {meta['invoice_total_ttc']}")

    return meta


def _is_ovh_header_row(cells: list) -> bool:
    """True if this row is an OVH table header (repeated per rubrique section)."""
    non_empty = [str(c).lower().strip() for c in cells if str(c).strip()]
    if not non_empty:
        return False
    if non_empty[0] in ('abonnement', 'abonnements'):
        return True
    hits = sum(1 for c in non_empty if any(h in c for h in _OVH_HEADER_WORDS))
    return hits >= 2


def _looks_like_reference(text: str) -> bool:
    """True if text looks like an OVH reference/hostname."""
    if not text:
        return False
    t = text.strip()
    if UUID_RE.match(t):
        return True
    if HOSTNAME_RE.match(t):
        return True
    if '.' in t and ' ' not in t and len(t) > 5:
        return True
    return False


def _clean_service_name(raw: str) -> str:
    """Strips OVH boilerplate from service descriptions."""
    if not raw:
        return '—'
    s = raw
    s = re.sub(r'^\s*\[(?:EUROPE|CANADA|ASIA|US|APAC)\]\s*', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\s+[Mm]onthly\s+fees?\b.*', '', s)
    s = re.sub(r'\s+rental\s+for\s+\d+.*', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\s+for\s+\d+.*', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\s*\(only\s+applicable.*?\)', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\(only.*', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\s*\(\d{2}/\d{2}/\d{4}[^)]*\)', '', s)
    s = re.sub(r"Date\s+de\s+fin\s+d['']engagement\s*:?\s*[\d/]*", '', s, flags=re.IGNORECASE)
    s = re.sub(r'\s*Sans\s+engagement\s*', ' ', s, flags=re.IGNORECASE)
    s = re.sub(r'\s+Datacenter\s+Class\b', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\s+Enterprise\s+Class\s+Soft\s+RAID\b', '', s, flags=re.IGNORECASE)
    s = re.sub(r'[\s+)]+$', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    if len(s) > 52:
        s = s[:50] + '…'
    return s or raw[:50]


class FileParser:
    def __init__(self):
        self.supported_formats = ["xlsx", "xls", "csv", "pdf"]

    # ── Raw parsers ───────────────────────────────────────────────────────────

    def parse_excel(self, file_path: Path) -> List[Dict[str, Any]]:
        try:
            df = pd.read_excel(file_path)
            df.columns = df.columns.str.lower().str.strip().str.replace(" ", "_")
            logger.info(f"✅ Excel: {len(df)} rows, cols={list(df.columns)}")
            return df.to_dict('records')
        except Exception as e:
            logger.error(f"❌ Excel: {e}"); raise

    def parse_csv(self, file_path: Path) -> List[Dict[str, Any]]:
        try:
            df = None
            for enc in ['utf-8', 'latin-1', 'cp1252']:
                try:
                    df = pd.read_csv(file_path, encoding=enc); break
                except UnicodeDecodeError:
                    continue
            df.columns = df.columns.str.lower().str.strip().str.replace(" ", "_")
            logger.info(f"✅ CSV: {len(df)} rows")
            return df.to_dict('records')
        except Exception as e:
            logger.error(f"❌ CSV: {e}"); raise

    def parse_pdf(self, file_path: Path) -> Dict[str, Any]:
        """
        Parse OVH PDF invoice.
        Returns dict with keys:
          - records      : List[Dict]  (line items, each stamped with cost_date)
          - invoice_meta : Dict        (total_ht, total_ttc, date, reference)
        """
        try:
            import pdfplumber
            records = []
            invoice_meta = {
                'invoice_total_ht':  None,
                'invoice_total_ttc': None,
                'invoice_date':      None,
                'invoice_reference': None,
            }

            with pdfplumber.open(file_path) as pdf:
                fname      = file_path.name.lower()
                first_text = (pdf.pages[0].extract_text() or '') if pdf.pages else ''
                is_ovh     = (
                    fname.startswith('facture_fr')
                    or 'ovh' in first_text.lower()
                    or 'facture' in fname
                )

                if is_ovh:
                    # ── Extract official invoice meta FIRST ───────────────
                    invoice_meta = _extract_ovh_invoice_meta(pdf)
                    logger.info(
                        f"📊 Invoice meta: ref={invoice_meta['invoice_reference']} "
                        f"date={invoice_meta['invoice_date']} "
                        f"HT={invoice_meta['invoice_total_ht']} "
                        f"TTC={invoice_meta['invoice_total_ttc']}"
                    )

                # ✅ The date to stamp on every line item of this invoice
                invoice_date = invoice_meta.get('invoice_date')
                invoice_total_ht = invoice_meta.get('invoice_total_ht')

                skipped = 0
                all_ovh_records = []   # accumulate ALL line items across all tables
                seen_table_fingerprints: set = set()  # detect duplicate table extractions
                running_sum = [0.0]  # mutable so _parse_ovh_table can update it for logging

                for page in pdf.pages:
                    for table in (page.extract_tables() or []):
                        if is_ovh:
                            if self._is_parasite_table(table):
                                skipped += len([r for r in table if any(c for c in r if c)])
                                continue

                            # Fingerprint this table by its first 3 non-empty rows joined.
                            # pdfplumber sometimes returns the exact same table twice
                            # (overlapping extraction regions on the same page).
                            fp_rows = [
                                '|'.join(str(c or '').strip() for c in row)
                                for row in table
                                if any(c for c in row if c and str(c).strip())
                            ][:3]
                            fp = '||'.join(fp_rows)
                            if fp and fp in seen_table_fingerprints:
                                logger.debug(f"  🗑️ Duplicate table extraction skipped (fp={fp[:60]}…)")
                                continue
                            if fp:
                                seen_table_fingerprints.add(fp)

                            temp_recs = self._parse_ovh_table(
                                table,
                                invoice_date=invoice_date,
                                invoice_reference=invoice_meta.get('invoice_reference'),
                                running_sum=running_sum,
                            )
                            all_ovh_records.extend(temp_recs)

                        elif len(table) > 1:
                            headers = [str(h or '').lower().replace(' ', '_') for h in table[0]]
                            for row in table[1:]:
                                records.append(dict(zip(headers, row)))

                # Scale ALL OVH records once, after all tables are parsed
                if is_ovh and all_ovh_records:
                    raw_sum = sum(r['amount'] for r in all_ovh_records)
                    if invoice_total_ht and invoice_total_ht > 0 and raw_sum > 0:
                        scale = invoice_total_ht / raw_sum
                        logger.info(f"  ✅ OVH scaling: raw_sum={raw_sum:.2f} → invoice_total_ht={invoice_total_ht:.2f} (factor={scale:.6f})")
                        for r in all_ovh_records:
                            r['amount'] = round(r['amount'] * scale, 6)
                    else:
                        logger.info(f"  ℹ️ OVH: no scaling applied (raw_sum={raw_sum:.2f}, invoice_total_ht={invoice_total_ht})")
                    records.extend(all_ovh_records)

                logger.info(
                    f"✅ {'OVH ' if is_ovh else ''}PDF: {len(records)} rows"
                    + (f", {skipped} skipped" if is_ovh else "")
                )

            return {'records': records, 'invoice_meta': invoice_meta}

        except Exception as e:
            logger.error(f"❌ PDF: {e}")
            return {'records': [], 'invoice_meta': {}}

    def _is_parasite_table(self, table) -> bool:
        """Skip summary/total tables and pure-header tables."""
        if not table: return True
        real = [r for r in table if any(c for c in r if c and str(c).strip())]
        if not real: return True

        if len(real) == 1 and _is_ovh_header_row(real[0]):
            return True

        first_cols = [c for c in real[0] if c is not None]
        if len(first_cols) == 2 and len(real) <= 6:
            for row in real:
                joined = ' '.join(str(c or '').strip().lower() for c in row if c)
                if any(k in joined for k in [
                    'prix ht', 'total ttc', 'tva', 'total de la facture', 'sous total',
                ]):
                    return True
        return False

    def _parse_ovh_table(
        self,
        table,
        invoice_date: Optional[date] = None,
        invoice_reference: Optional[str] = None,
        running_sum: Optional[list] = None,  # mutable [float] for cross-table running total
    ) -> List[Dict]:
        """
        OVH invoice columns:
          col 0 → Abonnement  (service description)
          col 1 → Référence   (UUID / hostname)
          col 2 → Quantité
          col 3 → Prix unitaire
          col 4 → Prix HT

        Every record is stamped with invoice_date so months are correct.
        Handles continuation rows where the hostname is on a separate row.
        """
        records = []

        if not table or len(table) < 2:
            return records

        header = [str(c or '').strip().lower() for c in table[0]]
        n_cols = len(header)

        amt_idx = n_cols - 1
        ref_idx = 1
        for i, h in enumerate(header):
            if 'prix ht' in h or 'prix_ht' in h:
                amt_idx = i
            if 'rence' in h or h.strip() in ('ref', 'réf', 'référence', 'reference'):
                ref_idx = i

    # ✅ First pass: collect all line items and calculate their sum
        temp_records = []
        temp_sum = 0.0
    
        for row in table[1:]:
            cells = [str(c or '').strip() for c in row]
            while len(cells) < n_cols:
                cells.append('')

            if not any(cells):
                continue

            first = cells[0]
            first_low = first.lower().strip()

            if _is_ovh_header_row(cells):
                continue

            if first_low in ('abonnement', 'abonnements', 'référence', 'reference'):
                continue

            if first_low.startswith('sous total') or first_low.startswith('sous-total'):
                continue

            others_empty = all(cells[j] == '' for j in range(1, len(cells)))
            if others_empty and first:
                candidate = first.strip()
                if temp_records and _looks_like_reference(candidate):
                    if not temp_records[-1].get('reference'):
                        temp_records[-1]['reference'] = candidate
                continue

            if not first:
                continue

            # ── Extract reference ────────────────────────────────────────
            reference = cells[ref_idx].strip() if ref_idx < len(cells) else ''
            if not reference or not _looks_like_reference(reference):
                for j, c in enumerate(cells):
                    if j == 0:
                        continue
                    if c and _looks_like_reference(c):
                        reference = c
                        break
            reference = reference if reference else None

            # ── Extract amount ───────────────────────────────────────────
            amount_str = cells[amt_idx].strip() if amt_idx < len(cells) else ''
            if not amount_str:
                for c in reversed(cells):
                    if c and AMOUNT_RE.match(c.strip()):
                        amount_str = c.strip()
                        break

            try:
                amount = _parse_fr_amount(amount_str)
                if amount is None or amount < 0:
                    continue
            except:
                continue

            temp_records.append({
                'service_name': _clean_service_name(first),
                'amount': amount,
                'amount_str': amount_str,
                'reference': reference,
                'source': 'OVHcloud',
                'cost_date': invoice_date,
            })
            temp_sum += amount
            if running_sum is not None:
                running_sum[0] += amount
                logger.debug(f"  + {_clean_service_name(first)}: {amount} € (running total = {running_sum[0]:.2f})")
            else:
                logger.debug(f"  + {_clean_service_name(first)}: {amount} €")


        # Clean up internal-only key before returning
        for rec in temp_records:
            rec.pop('amount_str', None)

        return temp_records

    def parse_file(self, file_path: Path, file_format: str):
        """
        Returns:
          - For PDF  : {'records': [...], 'invoice_meta': {...}}
          - For other: List[Dict]
        """
        fmt = str(file_format).lower().strip()
        if '.' in fmt: fmt = fmt.split('.')[-1]
        if fmt in ["xlsx", "xls"]: return self.parse_excel(file_path)
        if fmt == "csv":           return self.parse_csv(file_path)
        if fmt == "pdf":           return self.parse_pdf(file_path)
        raise ValueError(f"Format non supporté: {fmt}")

    def _map_column(self, record: Dict, candidates: List[str], default=None):
        for col in candidates:
            v = record.get(col)
            if v is not None and str(v).strip() not in ('', 'nan', 'None'):
                return v
        return default

    def extract_cost_data(self, records: List[Dict]) -> List[Dict]:
        cost_records = []
        for i, record in enumerate(records):
            try:
                amount_val = self._map_column(record, [
                    'amount', 'montant', 'cost', 'coût', 'cout', 'price', 'prix',
                    'total', 'total_amount', 'value', 'valeur', 'charge', 'frais',
                    'blended_cost', 'unblended_cost', 'net_cost',
                ])
                if amount_val is None:
                    continue
                try:
                    amount = float(
                        str(amount_val)
                        .replace(',', '.').replace('\xa0', '').replace(' ', '')
                        .replace('€', '').replace('$', '')
                    )
                    if amount < 0:
                        continue
                except (ValueError, TypeError):
                    continue

                service = str(self._map_column(record, [
                    'service_name', 'service', 'product', 'produit',
                    'resource', 'ressource', 'product_name', 'nom_service',
                ], default='Unknown'))[:255]
                # 🔥 SAFETY FILTER FINAL - ignore Abonnement et Offres même si elles passent
                service_lower = service.lower()
                if 'offres' in service_lower or 'discount' in service_lower or 'promotion' in service_lower:
                    logger.info(f"  ⚠️ Safety filter - ligne ignorée (offre/discount) : {service}")
                    continue
                # ✅ 'cost_date' is now present in OVH PDF records from _parse_ovh_table
                # _parse_date receives a real date object → returns it directly, no fallback
                cost_date = self._parse_date(self._map_column(record, [
                    'cost_date', 'date', 'period', 'période', 'month', 'mois',
                    'billing_date', 'invoice_date', 'usage_date',
                    'start_date', 'end_date', 'timestamp',
                ]))

                currency = str(self._map_column(record, [
                    'currency', 'devise', 'cur', 'unit',
                ], default='EUR'))[:10].upper().strip()
                if currency not in ['EUR', 'USD', 'GBP', 'CHF', 'TND']:
                    currency = 'EUR'

                project  = self._map_column(record, ['project_id', 'project', 'projet', 'account', 'account_id'])
                team     = self._map_column(record, ['team_id', 'team', 'equipe', 'équipe', 'owner', 'department'])
                category = self._map_column(record, ['cost_category', 'category', 'catégorie', 'type', 'usage_type'])

                ref_raw = self._map_column(record, [
                    'reference', 'référence', 'réference', 'ref',
                    'resource_id', 'external_id', 'subscription_id', 'uuid',
                ])
                reference = str(ref_raw).strip() if ref_raw else None

                src_raw = self._map_column(record, [
                    'source', 'provider', 'fournisseur', 'cloud_provider',
                ])
                source = (
                    str(src_raw).strip()
                    if src_raw and str(src_raw).strip() not in ('', 'nan', 'None', 'Manuel')
                    else 'Fichier'
                )

                cost_records.append({
                    'amount':        amount,
                    'service_name':  service,
                    'cost_date':     cost_date,
                    'currency':      currency,
                    'project_id':    str(project)[:100]  if project  else None,
                    'team_id':       str(team)[:100]     if team     else None,
                    'cost_category': str(category)[:100] if category else None,
                    'reference':     reference,
                    'source':        source,
                })
            except Exception as e:
                logger.warning(f"⚠️ Skipping row {i}: {e}")
        return cost_records

    def _parse_date(self, date_val) -> date:
        """
        Robustly parse any date value into a date object.
        Handles: date, datetime, ISO strings, French DD/MM/YYYY, etc.
        Falls back to today only if nothing else works.
        """
        if date_val is None:
            return datetime.today().date()
        # ✅ Already a pure date object — return directly (handles invoice_date from PDF)
        if isinstance(date_val, date) and not isinstance(date_val, datetime):
            return date_val
        # datetime object
        if isinstance(date_val, datetime):
            return date_val.date()
        # pandas Timestamp or similar
        if hasattr(date_val, 'date'):
            return date_val.date()

        s = str(date_val).strip()

        for fmt in [
            '%Y-%m-%d',                # 2026-01-01
            '%d/%m/%Y',                # 01/01/2026  ← French format
            '%m/%d/%Y',                # 01/31/2026
            '%d-%m-%Y',                # 01-01-2026
            '%Y/%m/%d',                # 2026/01/01
            '%d.%m.%Y',                # 01.01.2026
            '%Y-%m',                   # 2026-01
            '%m/%Y',                   # 01/2026
            '%B %Y',                   # January 2026
            '%b %Y',                   # Jan 2026
            '%Y-%m-%dT%H:%M:%S',
            '%Y-%m-%d %H:%M:%S',
        ]:
            try:
                return datetime.strptime(s[:len(fmt) + 2], fmt).date()
            except (ValueError, TypeError):
                continue

        logger.warning(f"⚠️ Cannot parse date: {date_val!r} — using today as fallback")
        return datetime.today().date()

    def parse(self, db_file, db) -> Dict[str, Any]:
        from app.models.cost import CostRecord

        logger.info(f"⚙️ Parse: file ID={db_file.id} ({db_file.filename})")
        upload_dir = Path(settings.upload_dir)

        fmt_str = (
            db_file.file_format.value
            if hasattr(db_file.file_format, 'value')
            else str(db_file.file_format).lower().split('.')[-1]
        )

        is_ovh = bool(re.search(r'facture|ovh|invoice', db_file.filename, re.IGNORECASE))

        safe = db_file.filename.replace(' ', '_').replace('/', '_')
        matching = (
            list(upload_dir.glob(f"*_{safe}")) or
            list(upload_dir.glob(f"*{safe}"))  or
            list(upload_dir.glob(f"*.{fmt_str}"))
        )
        if not matching:
            raise FileNotFoundError(f"File not found: {db_file.filename} in {upload_dir}")

        file_path = matching[0]
        logger.info(f"📂 Found: {file_path}")

        # ── Parse file ────────────────────────────────────────────────────────
        parsed       = self.parse_file(file_path, fmt_str)
        invoice_meta = {}

        if isinstance(parsed, dict):
            raw_records  = parsed.get('records', [])
            invoice_meta = parsed.get('invoice_meta', {})
        else:
            raw_records = parsed

        logger.info(f"📊 Raw records: {len(raw_records)}")
        if not raw_records:
            return {
                "costs_created": 0, "rows_imported": 0, "rows_skipped": 0,
                **invoice_meta,
            }

        cost_data = self.extract_cost_data(raw_records)
        logger.info(f"💰 Extracted: {len(cost_data)}")

        deleted = db.query(CostRecord).filter(CostRecord.file_id == db_file.id).delete()
        if deleted:
            db.commit()
            logger.info(f"🗑️ Deleted {deleted} old records")

        created = skipped = 0
        for data in cost_data:
            try:
                final_source = data.get('source', 'Fichier')
                if is_ovh and final_source in ('Fichier', 'Manuel', None, ''):
                    final_source = 'OVHcloud'

                db.add(CostRecord(
                    amount=        data['amount'],
                    service_name=  data['service_name'],
                    cost_date=     data['cost_date'],
                    currency=      data['currency'],
                    project_id=    data.get('project_id'),
                    team_id=       data.get('team_id'),
                    cost_category= data.get('cost_category'),
                    source=        final_source,
                    reference=     data.get('reference'),
                    source_file=   db_file.filename,
                    file_id=       db_file.id,
                ))
                created += 1
            except Exception as e:
                logger.warning(f"⚠️ Skip: {e}")
                skipped += 1

        db.commit()
        logger.info(f"✅ Done: {created} created, {skipped} skipped | meta={invoice_meta}")

        return {
            "costs_created":      created,
            "rows_imported":      len(raw_records),
            "rows_skipped":       skipped + (len(raw_records) - len(cost_data)),
            "invoice_total_ht":   invoice_meta.get('invoice_total_ht'),
            "invoice_total_ttc":  invoice_meta.get('invoice_total_ttc'),
            "invoice_date":       invoice_meta.get('invoice_date'),
            "invoice_reference":  invoice_meta.get('invoice_reference'),
        }


file_parser = FileParser()