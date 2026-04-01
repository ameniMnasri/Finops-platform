import pandas as pd
import logging
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime, date
import hashlib

from app.config import settings

logger = logging.getLogger(__name__)

# ─── Regex helpers ────────────────────────────────────────────────────────────
UUID_RE = re.compile(
    r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    re.IGNORECASE,
)
HOSTNAME_RE = re.compile(
    r'(?:vps-[a-f0-9]+\.vps\.ovh\.\w+'
    r'|ns\d+\.\S+'
    r'|[a-z0-9-]+\.(?:vps|ip|dedicated|so)\.ovh\.\w+'
    r'|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
    re.IGNORECASE,
)

_CONTINUATION_RE = re.compile(
    r'^(?:\d{2}/\d{2}/\d{4}|Date\s+de\s+fin|Sans\s+engagement|\(\d{2}/\d{2}|Sous.?total)',
    re.IGNORECASE,
)

# Matches numeric amounts like "50,60", "1 234,56 €", "0,00"
_AMOUNT_RE = re.compile(r'^-?\d[\d\s,.]*(\s*€)?$')

_OVH_HEADER_WORDS = {
    'abonnement', 'référence', 'reference', 'réf', 'quantité', 'quantite',
    'prix unitaire', 'prix ht', 'montant',
}

# Column length limits matching the database schema
_MAX_SERVICE_NAME_LEN = 255
_MAX_SERVICE_NAME_DISPLAY = 52   # truncated display length for cleaned names
_MAX_RAW_DATA_LEN        = 1000

# French month names → month numbers
_FRENCH_MONTHS = {
    'janvier': 1, 'février': 2, 'mars': 3, 'avril': 4,
    'mai': 5, 'juin': 6, 'juillet': 7, 'août': 8,
    'septembre': 9, 'octobre': 10, 'novembre': 11, 'décembre': 12,
    # accented variants
    'aout': 8, 'fevrier': 2, 'decembre': 12,
}

# Regex to extract the official HT total from OVH invoice first-page text
# Matches: "Total de la facture HT 5 627,35 €"
_OVH_TOTAL_HT_RE = re.compile(
    r'Total\s+de\s+la\s+facture\s+HT\s+([\d\s\u00a0,]+)\s*€',
    re.IGNORECASE,
)

# Regex to extract invoice date from OVH invoice text
# Matches: "du 01 Janvier 2026"
_OVH_DATE_RE = re.compile(
    r'du\s+(\d{1,2})\s+(\w+)\s+(\d{4})',
    re.IGNORECASE,
)

# Regex to extract invoice reference (e.g. "FR74499764")
_OVH_REF_RE = re.compile(
    r'Facture\s+(FR\d+)',
    re.IGNORECASE,
)


def _is_valid_reference(val: str) -> bool:
    """Return True if val looks like a UUID or OVH hostname (no spaces)."""
    if not val:
        return False
    v = val.strip()
    if ' ' in v:
        return False
    return bool(UUID_RE.match(v) or HOSTNAME_RE.match(v))


def _is_continuation_text(text: str) -> bool:
    """Return True if the text is a continuation / footnote line, not a new service."""
    return bool(_CONTINUATION_RE.match(text.strip()))


def _is_ovh_header_row(cells: list) -> bool:
    """Detect repeated OVH header rows (each rubrique section repeats them)."""
    non_empty = [str(c).lower().strip() for c in cells if str(c).strip()]
    if not non_empty:
        return False
    if non_empty[0] in ('abonnement', 'abonnements'):
        return True
    hits = sum(1 for c in non_empty if any(h in c for h in _OVH_HEADER_WORDS))
    return hits >= 2


def _clean_service_name(raw: str) -> str:
    """Strip OVH boilerplate from a service name and return the short form."""
    if not raw:
        return raw
    s = raw.strip()
    # Remove geographic prefix [EUROPE], [CANADA], etc.
    s = re.sub(r'^\[[A-Z]+\]\s*', '', s)
    # Remove "Monthly fees" and everything after
    s = re.sub(r'\s+Monthly\s+fees.*', '', s, flags=re.IGNORECASE)
    # Remove "rental for X month" and everything after
    s = re.sub(r'\s+rental\s+for\s+\d+.*', '', s, flags=re.IGNORECASE)
    # Remove "for X month/times" and everything after
    s = re.sub(r'\s+for\s+\d+\s+(?:month|time).*', '', s, flags=re.IGNORECASE)
    # Remove "(only applicable...)" patterns
    s = re.sub(r'\s*\(only\s+applicable[^)]*\)', '', s, flags=re.IGNORECASE)
    # Remove date ranges (01/01/2026-31/01/2026)
    s = re.sub(r'\s*\(\d{2}/\d{2}/\d{4}-\d{2}/\d{2}/\d{4}\)', '', s)
    # Remove "Date de fin d'engagement : ..."
    s = re.sub(r"\s*Date\s+de\s+fin\s+d'engagement\s*:.*", '', s, flags=re.IGNORECASE)
    # Remove "Sans engagement"
    s = re.sub(r'\s*Sans\s+engagement', '', s, flags=re.IGNORECASE)
    # Remove "Datacenter Class" and "Enterprise Class Soft RAID"
    s = re.sub(r'\s*(?:Datacenter|Enterprise)\s+Class(?:\s+Soft\s+RAID)?', '', s, flags=re.IGNORECASE)
    s = s.strip()
    # Truncate to display length max
    if len(s) > _MAX_SERVICE_NAME_DISPLAY:
        s = s[:_MAX_SERVICE_NAME_DISPLAY] + '…'
    return s


class FileParser:
    """Service pour parser Excel/PDF/CSV et extraire les coûts"""

    def __init__(self):
        self.supported_formats = ['xlsx', 'xls', 'csv', 'pdf']

    # ─── Parsers ──────────────────────────────────────────────────────────────

    def parse_excel(self, file_path: Path) -> List[Dict[str, Any]]:
        logger.info('Parsing Excel: ' + str(file_path))
        try:
            df = pd.read_excel(file_path)
            df.columns = [str(c).lower().strip().replace(' ', '_') for c in df.columns]
            logger.info('✅ Excel parsed: ' + str(len(df)) + ' rows, cols: ' + str(list(df.columns)))
            return list(df.to_dict('records'))
        except Exception as e:
            logger.error('❌ Excel error: ' + str(e))
            return []

    def parse_csv(self, file_path: Path) -> List[Dict[str, Any]]:
        logger.info('Parsing CSV: ' + str(file_path))
        try:
            try:
                df = pd.read_csv(file_path)
            except UnicodeDecodeError:
                df = pd.read_csv(file_path, encoding='latin-1')
            df.columns = [str(c).lower().strip().replace(' ', '_') for c in df.columns]
            logger.info('✅ CSV parsed: ' + str(len(df)) + ' rows, cols: ' + str(list(df.columns)))
            return list(df.to_dict('records'))
        except Exception as e:
            logger.error('❌ CSV error: ' + str(e))
            return []

    def parse_pdf(self, file_path: Path) -> List[Dict[str, Any]]:
        import pdfplumber
        records = []
        try:
            with pdfplumber.open(file_path) as pdf:
                filename_lower = file_path.name.lower()
                first_page_text = (pdf.pages[0].extract_text() or '') if pdf.pages else ''
                is_ovh = (
                    filename_lower.startswith('facture_fr')
                    or 'ovh' in first_page_text.lower()
                )

                # ── OVH: extract official invoice totals from the first page ──
                invoice_meta: Dict[str, Any] = {}
                invoice_total_ht: Optional[float] = None
                invoice_date: Optional[date] = None
                if is_ovh:
                    invoice_meta = self._extract_ovh_invoice_meta(first_page_text)
                    invoice_total_ht = invoice_meta.get('invoice_total_ht')
                    invoice_date = invoice_meta.get('invoice_date')

                skipped = 0
                # Track whether we already emitted the consolidated record
                consolidated_done = False

                for page in pdf.pages:
                    for table in (page.extract_tables() or []):
                        if is_ovh:
                            # Skip if we already have the consolidated record
                            if consolidated_done:
                                skipped += sum(
                                    1 for r in table if any(str(c).strip() for c in r)
                                )
                                continue
                            if self._is_parasite_table(table):
                                skipped += sum(
                                    1 for r in table if any(str(c).strip() for c in r)
                                )
                                continue
                            rows = self._parse_ovh_table(
                                table,
                                invoice_date=invoice_date,
                                invoice_total_ht=invoice_total_ht,
                            )
                            records.extend(rows)
                            # If we just added the consolidated record, stop
                            # processing further tables to avoid duplicates
                            if invoice_total_ht is not None and rows:
                                consolidated_done = True
                        else:
                            if not table:
                                continue
                            h = [
                                str(c).replace(' ', '_').lower() if c else f'col_{i}'
                                for i, c in enumerate(table[0])
                            ]
                            for row in table[1:]:
                                records.append(dict(zip(h, row)))
            if is_ovh:
                logger.info(
                    '✅ OVH PDF parsed: ' + str(len(records)) + ' rows, '
                    + str(skipped) + ' parasite rows skipped'
                )
            else:
                logger.info('✅ PDF parsed: ' + str(len(records)) + ' rows')
        except Exception as e:
            logger.error('❌ PDF error: ' + str(e))
        return records

    def _extract_ovh_invoice_meta(self, first_page_text: str) -> Dict[str, Any]:
        """
        Extract the official invoice total (Prix HT) and invoice date from the
        first-page text of an OVH PDF invoice.

        Returns a dict with keys:
          - 'invoice_total_ht'  : float | None
          - 'invoice_date'      : date  | None
          - 'invoice_reference' : str   | None
        """
        meta: Dict[str, Any] = {
            'invoice_total_ht': None,
            'invoice_date': None,
            'invoice_reference': None,
        }

        if not first_page_text:
            return meta

        # ── Extract official HT total ────────────────────────────────────────
        m = _OVH_TOTAL_HT_RE.search(first_page_text)
        if m:
            raw_amount = m.group(1)
            # French format: "5 627,35" → 5627.35
            # Remove thousand-separator spaces/non-breaking spaces, swap decimal comma
            cleaned = (
                raw_amount
                .replace('\xa0', '')   # non-breaking space
                .replace('\u202f', '') # narrow no-break space
                .replace(' ', '')
                .replace(',', '.')
                .strip()
            )
            try:
                meta['invoice_total_ht'] = float(cleaned)
                logger.info(
                    '  💶 OVH invoice_total_ht extracted: '
                    + str(meta['invoice_total_ht']) + ' €'
                )
            except ValueError:
                logger.warning('  ⚠️ Could not parse OVH total HT: ' + repr(raw_amount))

        # ── Extract invoice date ─────────────────────────────────────────────
        m = _OVH_DATE_RE.search(first_page_text)
        if m:
            day_str, month_str, year_str = m.group(1), m.group(2), m.group(3)
            month_num = _FRENCH_MONTHS.get(month_str.lower().strip())
            if month_num:
                try:
                    meta['invoice_date'] = date(int(year_str), month_num, int(day_str))
                    logger.info(
                        '  📅 OVH invoice_date extracted: '
                        + str(meta['invoice_date'])
                    )
                except ValueError:
                    logger.warning(
                        '  ⚠️ Could not build date from: '
                        + day_str + ' ' + month_str + ' ' + year_str
                    )

        # ── Extract invoice reference ────────────────────────────────────────
        m = _OVH_REF_RE.search(first_page_text)
        if m:
            meta['invoice_reference'] = m.group(1)
            logger.info('  🔖 OVH invoice_reference extracted: ' + meta['invoice_reference'])

        return meta

    def _is_parasite_table(self, table) -> bool:
        """Detect OVH summary/total tables that should NOT be parsed as services."""
        real_rows = [row for row in table if any(str(c).strip() for c in row)]
        if len(real_rows) < 2:
            return True
        num_cols = sum(1 for c in real_rows[0] if str(c).strip())
        if num_cols < 4:
            return True
        return False

    def _parse_ovh_table(
        self,
        table,
        invoice_date: Optional[date] = None,
        invoice_total_ht: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """
        Parse a single OVH service table.

        If ``invoice_total_ht`` is provided (extracted from the official invoice
        summary), skip line-item parsing and return ONE consolidated record with
        the official Prix HT.  This ensures the monthly totals match the actual
        invoices and are not distorted by discounts / rounding in individual items.

        If ``invoice_total_ht`` is None, fall back to the original state-machine
        line-item parser (used when no official total could be extracted).
        """
        # ── FIX: use the official invoice total instead of line items ────────
        if invoice_total_ht is not None and invoice_total_ht > 0:
            logger.info(
                '  📊 OVH consolidation: using official Prix HT = '
                + str(invoice_total_ht) + ' €'
            )
            return [{
                'service_name': 'OVHcloud - Facturation consolidée',
                'amount':       str(invoice_total_ht),
                'reference':    None,
                'source':       'OVHcloud',
                'cost_date':    invoice_date,
            }]

        # ── Fallback: parse individual line items ────────────────────────────
        records: List[Dict[str, Any]] = []
        if not table:
            return records

        pending_service:   Optional[str] = None
        pending_reference: Optional[str] = None
        pending_amount:    Optional[str] = None

        def flush():
            nonlocal pending_service, pending_reference, pending_amount
            if pending_service is not None:
                records.append({
                    'service_name': _clean_service_name(pending_service),
                    'amount':       pending_amount,
                    'reference':    pending_reference,
                    'source':       'OVHcloud',
                    'cost_date':    invoice_date,
                })
            pending_service = None
            pending_reference = None
            pending_amount = None

        for row in table:
            cells = [str(c).strip() if c is not None else '' for c in row]
            if not any(cells):
                continue

            if _is_ovh_header_row(cells):
                continue

            col0 = cells[0] if cells else ''
            is_new_block = bool(col0) and not _is_continuation_text(col0)

            if is_new_block:
                flush()
                pending_service = col0

            if pending_service is not None:
                if pending_reference is None:
                    for cell in cells:
                        if _is_valid_reference(cell):
                            pending_reference = cell
                            break

                for cell in reversed(cells):
                    if cell and _AMOUNT_RE.match(cell):
                        pending_amount = cell
                        break

        flush()
        return records

    def parse_file(self, file_path: Path, file_format=None) -> List[Dict[str, Any]]:
        if hasattr(file_path, 'lower'):
            fmt = file_path.lower().strip().split('.')[-1]
        else:
            fmt = str(file_path).lower().split('.')[-1]
        if fmt == 'csv':
            return self.parse_csv(file_path)
        elif fmt == 'pdf':
            return self.parse_pdf(file_path)
        else:
            return self.parse_excel(file_path)

    # ─── Column mapper ────────────────────────────────────────────────────────

    def _map_column(self, record: Dict, candidates: List[str], default='') -> Any:
        """Cherche la première colonne candidate dans un record"""
        for col in candidates:
            val = record.get(col)
            if val is not None and str(val).strip() != '':
                return val
        return default

    # ─── Cost data extractor ──────────────────────────────────────────────────

    def extract_cost_data(self, records: List[Dict]) -> List[Dict]:
        """Extrait les données de coût depuis les records bruts"""
        cost_records = []
        for i, record in enumerate(records):
            try:
                # Amount
                amount_val = self._map_column(
                    record,
                    ['amount', 'montant', 'prix_ht', 'total', 'price', 'cout'],
                    '',
                )
                try:
                    amount = float(
                        str(amount_val)
                        .replace(',', '.')
                        .replace('\xa0', '')
                        .replace('\u202f', '')
                        .replace(' ', '')
                        .replace('€', '')
                        .replace('$', '')
                        .strip()
                    )
                except (ValueError, TypeError):
                    amount = 0.0

                # Skip negative amounts (discounts/credits)
                if amount < 0:
                    continue

                # Service name
                service = str(self._map_column(
                    record,
                    ['service_name', 'service', 'abonnement', 'description',
                     'nom_du_service', 'designation'],
                    'Unknown',
                ))
                if len(service) > _MAX_SERVICE_NAME_LEN:
                    service = service[:_MAX_SERVICE_NAME_LEN]

                # Date — prefer explicit cost_date (set by _parse_ovh_table when
                # it creates a consolidated record)
                date_val = self._map_column(
                    record,
                    ['cost_date', 'date', 'invoice_date', 'billing_date',
                     'date_facture', 'date_du_cout'],
                    None,
                )
                cost_date = self._parse_date(date_val)

                # Currency
                currency_raw = str(self._map_column(
                    record,
                    ['currency', 'devise', 'currency_code'],
                    'EUR',
                )).upper().strip()
                currency = currency_raw if currency_raw else 'EUR'

                # Project
                project = self._map_column(
                    record,
                    ['project_id', 'project', 'projet'],
                    None,
                )
                project_id = str(project)[:100] if project else None

                # Team
                team = self._map_column(
                    record,
                    ['team_id', 'team', 'equipe'],
                    None,
                )
                team_id = str(team)[:100] if team else None

                # Category
                category = self._map_column(
                    record,
                    ['cost_category', 'category', 'categorie', 'type'],
                    None,
                )
                cost_category = str(category)[:100] if category else None

                # TVA rate
                tva_rate_val = record.get('tva_rate')
                try:
                    tva_rate = float(tva_rate_val) if tva_rate_val is not None else None
                    if tva_rate is not None and tva_rate > 1:
                        tva_rate = tva_rate / 100.0
                except (ValueError, TypeError):
                    tva_rate = None

                # Reference (OVH UUID / hostname)
                raw_reference = record.get('reference')
                ref_str = str(raw_reference).strip() if raw_reference else ''
                reference = ref_str if ref_str and _is_valid_reference(ref_str) else None

                # Source
                source = record.get('source') or None

                cost_records.append({
                    'amount':        amount,
                    'service_name':  service,
                    'cost_date':     cost_date,
                    'currency':      currency,
                    'project_id':    project_id,
                    'team_id':       team_id,
                    'cost_category': cost_category,
                    'tva_rate':      tva_rate,
                    'reference':     reference,
                    'source':        source,
                })
            except Exception as e:
                logger.warning('⚠️ Skipping row ' + str(i) + ': ' + str(e))

        return cost_records

    # ─── Date parser ──────────────────────────────────────────────────────────

    def _parse_date(self, date_val) -> date:
        """Parse une valeur date en objet date Python"""
        if isinstance(date_val, date):
            return date_val
        if hasattr(date_val, 'date'):
            return date_val.date()
        if date_val is None:
            return datetime.today().date()
        date_str = str(date_val).strip()
        formats = [
            '%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y', '%m/%d/%Y',
            '%d/%m/%y', '%Y/%m/%d', '%d.%m.%Y',
        ]
        for fmt in formats:
            try:
                if len(date_str) >= 6:
                    return datetime.strptime(date_str[:10], fmt).date()
            except (ValueError, TypeError):
                continue
        logger.warning('⚠️ Cannot parse date: ' + str(date_val) + ', using today')
        return datetime.today().date()

    # ─── Main parse entry point ───────────────────────────────────────────────

    def parse(self, db_file, db):
        """
        Parse un fichier DB et sauvegarde les coûts extraits.
        Appelé avec : file_parser.parse(db_file, db)
        """
        from app.schemas.cost import CostRecord

        logger.info(
            '⚙️ Starting parse for file ID=' + str(db_file.id)
            + ' (' + str(db_file.filename) + ')'
        )

        # Determine file format string
        if hasattr(db_file.file_format, 'value'):
            file_format = db_file.file_format.value
        else:
            file_format = str(db_file.file_format)
        fmt_str = file_format.lower().split('.')[-1]

        # Locate the physical file
        safe_name = str(db_file.filename).lower().replace(' ', '_')
        upload_dir = Path(settings.upload_dir)

        matching = (
            list(upload_dir.glob(f'*_{db_file.id}/*.{fmt_str}'))
            + list(upload_dir.glob(f'*_{db_file.id}*.{fmt_str}'))
            + list(upload_dir.glob(f'{safe_name}'))
            + list(upload_dir.glob(f'*/{db_file.filename}'))
            + list(upload_dir.glob(f'**/{db_file.filename}'))
        )
        matching = [p for p in matching if p.is_file()]

        if not matching:
            raise FileNotFoundError(
                'Fichier physique introuvable pour '
                + str(db_file.filename)
                + ' dans '
                + str(upload_dir)
            )

        file_path = matching[0]
        logger.info('📂 Found file: ' + str(file_path))

        # Detect OVH by filename (used for source override below)
        filename_lower = str(db_file.filename).lower()
        is_ovh = filename_lower.startswith('facture_fr') or 'ovh' in filename_lower

        # Parse raw records
        raw_records = self.parse_file(file_path)
        logger.info('📊 Raw records: ' + str(len(raw_records)))

        # Extract structured cost data
        cost_data = self.extract_cost_data(raw_records)
        logger.info('💰 Extracted cost records: ' + str(len(cost_data)))

        # Delete existing costs for this file
        deleted = db.query(CostRecord).filter(CostRecord.file_id == db_file.id).delete()
        logger.info(
            '🗑️ Deleted ' + str(deleted)
            + ' existing cost records for file ' + str(db_file.id)
        )

        created = 0
        skipped = 0
        for data in cost_data:
            try:
                # Resolve source
                record_source = data.get('source') or None
                if is_ovh and (not record_source or record_source in ('Manuel', 'Fichier')):
                    record_source = 'OVHcloud'
                if not record_source:
                    record_source = 'Fichier'

                cost = CostRecord(
                    amount        = data['amount'],
                    service_name  = data['service_name'],
                    cost_date     = data['cost_date'],
                    currency      = data.get('currency', 'EUR'),
                    project_id    = data.get('project_id'),
                    team_id       = data.get('team_id'),
                    cost_category = data.get('cost_category'),
                    tva_rate      = data.get('tva_rate'),
                    reference     = data.get('reference'),
                    source        = record_source,
                    file_id       = db_file.id,
                    raw_data      = str(data)[:_MAX_RAW_DATA_LEN],
                )
                db.add(cost)
                created += 1
            except Exception as e:
                logger.warning('⚠️ Skipping cost record: ' + str(e))
                skipped += 1

        db.commit()
        logger.info(
            '✅ Parse done: ' + str(created)
            + ' costs created, ' + str(skipped) + ' skipped'
        )
        return {'costs_created': created, 'costs_skipped': skipped}


file_parser = FileParser()
