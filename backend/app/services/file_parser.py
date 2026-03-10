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
                is_ovh = filename_lower.startswith('facture_fr') or 'ovh' in filename_lower
                skipped = 0
                for page in pdf.pages:
                    for table in page.extract_tables():
                        if is_ovh:
                            if self._is_parasite_table(table):
                                skipped += sum(
                                    1 for r in table if any(str(c).strip() for c in r)
                                )
                            else:
                                records.extend(self._parse_ovh_table(table))
                        else:
                            if not table:
                                continue
                            h = [
                                str(c).replace(' ', '_').lower() if c else f'col_{i}'
                                for i, c in enumerate(table[0])
                            ]
                            headers = h
                            for row in table[1:]:
                                records.append(dict(zip(headers, row)))
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

    def _is_parasite_table(self, table) -> bool:
        """Detect OVH summary/total tables that should NOT be parsed as services."""
        real_rows = [row for row in table if any(str(c).strip() for c in row)]
        if len(real_rows) < 2:
            return True
        num_cols = sum(1 for c in real_rows[0] if str(c).strip())
        if num_cols < 4:
            return True
        cells = ' '.join(
            str(c).lower()
            for row in real_rows[:2]
            for c in row
            if str(c).strip()
        )
        return False

    def _parse_ovh_table(self, table) -> List[Dict[str, Any]]:
        """
        OVH columns: Abonnement | Référence | Quantité | Prix unitaire | Prix HT
        pdfplumber splits multiline cells into multiple rows. Use a state-machine
        to group rows into blocks, accumulate reference + amount across all rows
        of a block, and emit one record when the next block starts.
        """
        records: List[Dict[str, Any]] = []
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
                })
            pending_service = None
            pending_reference = None
            pending_amount = None

        for row in table:
            cells = [str(c).strip() if c is not None else '' for c in row]
            if not any(cells):
                continue

            # Skip repeated header rows
            if _is_ovh_header_row(cells):
                continue

            col0 = cells[0] if cells else ''

            # Determine if this row starts a new block
            is_new_block = bool(col0) and not _is_continuation_text(col0)

            if is_new_block:
                flush()
                pending_service = col0

            # Process this row within the current block (pick up reference/amount)
            if pending_service is not None:
                # Scan all cells for a valid reference (keep first found)
                if pending_reference is None:
                    for cell in cells:
                        if _is_valid_reference(cell):
                            pending_reference = cell
                            break

                # Take amount from the last column that looks like a number (Prix HT)
                # Iterate in reverse to prefer the last numeric column
                for cell in reversed(cells):
                    if cell and _AMOUNT_RE.match(cell):
                        pending_amount = cell
                        break

        # Flush the last block
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
                        .replace(' ', '')
                        .replace('€', '')
                        .replace('$', '')
                        .strip()
                    )
                except (ValueError, TypeError):
                    amount = 0.0

                # Skip negative amounts (not zero — 0€ services like OS Linux and
                # bandwidth are legitimate line items that should be kept)
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

                # Date
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
