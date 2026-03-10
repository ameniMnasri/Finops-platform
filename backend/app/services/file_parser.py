import re
import pandas as pd
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime, date
import hashlib
from app.config import settings

logger = logging.getLogger(__name__)

# ─── Module-level regex patterns ─────────────────────────────────────────────

UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE,
)

HOSTNAME_RE = re.compile(
    r'(?:vps-[a-f0-9]+\.vps\.ovh\.\w+(?:-\w+)*|'   # vps-xxxxxxxx.vps.ovh.net[-linux]
    r'ns\d+\.\S+|'                                    # ns3037791.ip-164-132-1.eu
    r'[a-z0-9\-]+\.(?:vps|ip|dedicated|so)\.ovh\.\w+(?:-\w+)*|'
    r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',  # UUID
    re.IGNORECASE,
)

AMOUNT_RE = re.compile(
    r'^-?\d[\d\s]*(?:[.,]\d+)?\s*€?$'
)

_DATE_NOTE_RE = re.compile(
    r'^(?:'
    r'\d{2}/\d{2}/\d{4}'           # 01/01/2026
    r'|Date\s+de\s+fin'            # Date de fin d'engagement
    r'|Sans\s+engagement'          # Sans engagement
    r'|\(\d{2}/\d{2}'              # (01/01/2026...
    r'|Sous.total'                 # Sous total
    r')',
    re.IGNORECASE,
)

# ─── Module-level helper functions ───────────────────────────────────────────

def _is_valid_reference(val: str) -> bool:
    """Returns True if val looks like a real OVH reference (UUID or hostname)."""
    if not val:
        return False
    v = val.strip()
    if ' ' in v:
        return False
    return bool(UUID_RE.match(v) or HOSTNAME_RE.match(v))


def _is_date_or_note(text: str) -> bool:
    """Returns True if text is a continuation/note row, not a service name."""
    return bool(_DATE_NOTE_RE.match(text.strip()))


def _is_header_row(cells: List[str]) -> bool:
    """Returns True if this row looks like a repeated table header."""
    if not cells:
        return False
    first = cells[0].strip().lower()
    return first in ('abonnement', 'service', 'description', 'produit', 'product')


def _clean_service_name(name: str) -> str:
    """Clean up OVH service name by removing trailing fee/date annotations."""
    if not name:
        return name
    # Remove trailing "Monthly fees", "mensuel", etc.
    name = re.sub(
        r'\s+(?:monthly\s+fees?|mensuel(?:les)?|frais\s+mens\w*)\s*$',
        '',
        name,
        flags=re.IGNORECASE,
    ).strip()
    return name


# ─── FileParser class ─────────────────────────────────────────────────────────

class FileParser:
    """Service pour parser Excel/PDF/CSV et extraire les coûts"""

    def parse_excel(self, file_path) -> List[Dict]:
        logger.info(f'Parsing Excel: {file_path}')
        try:
            df = pd.read_excel(file_path)
            df.columns = [str(c).lower().strip().replace(' ', '_') for c in df.columns]
            logger.info(f'✅ Excel parsed: {len(df)} rows, cols: {list(df.columns)}records')
            return df.to_dict('records')
        except Exception as e:
            logger.error(f'❌ Excel error: {e}')
            return []

    def parse_csv(self, file_path) -> List[Dict]:
        logger.info(f'Parsing CSV: {file_path}')
        try:
            df = None
            for enc in ('utf-8', 'latin-1', 'cp1252'):
                try:
                    df = pd.read_csv(file_path, encoding=enc)
                    break
                except UnicodeDecodeError:
                    pass
            if df is None:
                return []
            df.columns = [str(c).lower().strip().replace(' ', '_') for c in df.columns]
            logger.info(f'✅ CSV parsed: {len(df)} rows, cols: {list(df.columns)}records')
            return df.to_dict('records')
        except Exception as e:
            logger.error(f'❌ CSV error: {e}')
            return []

    def parse_pdf(self, file_path) -> List[Dict]:
        import pdfplumber
        records = []
        try:
            with pdfplumber.open(file_path) as pdf:
                filename_lower = file_path.name.lower()
                first_page_text = (pdf.pages[0].extract_text() if pdf.pages else '') or ''
                is_ovh = filename_lower.startswith('facture_fr') or 'ovh' in first_page_text.lower()

                skipped = 0
                for page in pdf.pages:
                    for table in (page.extract_tables() or []):
                        if is_ovh:
                            if self._is_parasite_table(table):
                                skipped += sum(1 for r in table if any(c for c in r if c))
                                continue
                            records.extend(self._parse_ovh_table(table))
                        else:
                            if len(table) <= 1:
                                continue
                            headers = [str(h).lower().replace(' ', '_') for h in table[0]]
                            for row in table[1:]:
                                records.append(dict(zip(headers, row)))

                if is_ovh:
                    logger.info(f'✅ OVH PDF parsed: {len(records)} rows, {skipped} parasite rows skipped')
                else:
                    logger.info(f'✅ PDF parsed: {len(records)} rows')
        except Exception as e:
            logger.error(f'❌ PDF error: {e}')
            return []
        return records

    def _is_parasite_table(self, table) -> bool:
        """Detect OVH summary/total tables that should NOT be parsed as services."""
        if not table:
            return True
        real_rows = [r for r in table if any(str(c).strip() for c in r if c)]
        if not real_rows:
            return True
        num_cols = sum(1 for c in real_rows[0] if c is not None)
        if num_cols == 2 and len(real_rows) <= 4:
            for row in real_rows:
                cells = [str(c or '').strip().lower() for c in row if c is not None]
                joined = ' '.join(cells)
                if any(kw in joined for kw in ('prix ht', 'total ttc', 'tva', 'total de la facture', 'abonnement', 'sous total')):
                    return True
        return False

    def _parse_ovh_table(self, table) -> List[Dict[str, Any]]:
        """
        OVH invoice columns:
          col 0: Abonnement  — service description (may be multiline = multiple rows)
          col 1: Référence   — UUID or vps-XXXX.vps.ovh.net hostname
          col 2: Quantité
          col 3: Prix unitaire
          col 4: Prix HT     — amount

        Because pdfplumber splits multiline cells into multiple rows, we use a
        state-machine approach: accumulate service/reference/amount across rows
        for the same subscription block, then emit when the block is complete.

        A new block starts when:
          - col 0 is non-empty AND looks like a service description (not a date/note)
          - AND it is different from the current pending service

        A block is finalized (record emitted) when:
          - We have accumulated both a service name AND an amount
          - A new block is about to start
        """
        records = []
        if not table or len(table) < 2:
            return records

        header = [str(c or '').strip().lower() for c in table[0]]
        n_cols = len(header)

        # Detect column indices
        amt_idx = n_cols - 1
        ref_idx = 1
        for i, h in enumerate(header):
            if 'prix ht' in h or 'prix_ht' in h:
                amt_idx = i
            if 'référence' in h or 'reference' in h or 'réf' in h:
                ref_idx = i

        logger.debug(f'  OVH table header={header}, ref_idx={ref_idx}, amt_idx={amt_idx}')

        # State machine
        pending_service   = None
        pending_reference = None
        pending_amount    = None

        def flush():
            """Emit the current pending block if it has enough data."""
            nonlocal pending_service, pending_reference, pending_amount
            if pending_service and pending_amount is not None:
                records.append({
                    'service_name': _clean_service_name(pending_service),
                    'amount':       pending_amount,
                    'reference':    pending_reference,  # may be None — that's OK
                    'source':       'OVHcloud',
                    'tva_rate':     0.2,
                })
                logger.debug(
                    f"  ✅ flush: service='{pending_service[:30]}' "
                    f"ref='{pending_reference}' amt='{pending_amount}'"
                )
            pending_service   = None
            pending_reference = None
            pending_amount    = None

        for row in table[1:]:
            cells = [str(c or '').strip() for c in row]
            while len(cells) < n_cols:
                cells.append('')

            if not any(cells):
                continue

            # Skip pure header rows
            if _is_header_row(cells):
                continue

            col0 = cells[0]
            col_ref = cells[ref_idx].strip() if ref_idx < len(cells) else ''
            col_amt = cells[amt_idx].strip() if amt_idx < len(cells) else ''

            # Skip explicit header label rows
            if col0.strip().lower() in ('abonnement', 'référence', 'reference', 'réf.', 'ref.'):
                continue

            # Skip SOUS TOTAL rows
            if col0.lower().startswith('sous total') or col0.lower().startswith('sous-total'):
                continue

            # Detect if col0 looks like a service description (not a date/note/continuation)
            is_service_row = bool(col0) and not _is_date_or_note(col0)

            # Detect if this row carries a valid reference
            valid_ref = col_ref if _is_valid_reference(col_ref) else None

            # Detect if this row carries a valid amount
            valid_amt = None
            if col_amt and AMOUNT_RE.match(col_amt):
                valid_amt = col_amt
            else:
                # Try scanning all cells right-to-left for an amount
                for c in reversed(cells):
                    if c and AMOUNT_RE.match(c.strip()):
                        valid_amt = c.strip()
                        break

            # ── State machine transitions ──

            if is_service_row:
                # New subscription block starting — flush previous
                flush()
                pending_service = col0

            # Accumulate reference (take the first valid one seen for this block)
            if valid_ref and pending_reference is None:
                pending_reference = valid_ref

            # Accumulate amount (take the last/best amount seen — Prix HT column)
            if valid_amt:
                pending_amount = valid_amt

        # Flush last pending block
        flush()

        logger.debug(f'  _parse_ovh_table → {len(records)} records')
        return records

    def parse_file(self, file_path, file_format):
        fmt = file_format
        if hasattr(fmt, 'lower'):
            fmt = fmt.lower()
        else:
            fmt = str(fmt).lower().strip().split('.')[-1]
        if fmt == 'csv':
            return self.parse_csv(file_path)
        elif fmt == 'pdf':
            return self.parse_pdf(file_path)
        else:
            return self.parse_excel(file_path)

    def _map_column(self, record, candidates, default=None):
        """Cherche la première colonne candidate dans un record"""
        for col in candidates:
            if col in record and record[col] is not None:
                if str(record[col]).strip() not in ('', 'nan', 'None'):
                    return record[col]
        return default

    def extract_cost_data(self, records) -> List[Dict]:
        """Extrait les données de coût depuis les records bruts"""
        cost_records = []
        for i, record in enumerate(records):
            try:
                # ── Amount ──────────────────────────────────────────────────
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
                        .replace(',', '.')
                        .replace(' ', '')
                        .replace('€', '')
                        .replace('$', '')
                    )
                except (ValueError, TypeError):
                    continue

                # Keep 0-amount rows (e.g. OS Linux, bandwidth)
                if amount < 0:
                    continue

                # ── Service name ─────────────────────────────────────────────
                service = str(self._map_column(record, [
                    'service_name', 'service', 'product', 'produit', 'resource',
                    'ressource', 'type', 'category', 'product_name', 'service_type',
                    'nom_service',
                ], default='Unknown'))[:255]

                # ── Date ─────────────────────────────────────────────────────
                date_val = self._map_column(record, [
                    'cost_date', 'date', 'period', 'période', 'month', 'mois',
                    'billing_date', 'invoice_date', 'usage_date', 'start_date',
                    'end_date', 'timestamp',
                ])
                cost_date = self._parse_date(date_val)

                # ── Currency ─────────────────────────────────────────────────
                currency = str(self._map_column(record, [
                    'currency', 'devise', 'cur', 'unit',
                ], default='EUR'))[:10].upper().strip()
                if currency not in ('EUR', 'USD', 'GBP', 'CHF', 'TND'):
                    currency = 'EUR'

                # ── Project ──────────────────────────────────────────────────
                project = self._map_column(record, [
                    'project_id', 'project', 'projet', 'account', 'account_id',
                    'subscription', 'environment', 'env', 'workspace', 'namespace',
                ])
                project_id = str(project)[:100] if project else None

                # ── Team ─────────────────────────────────────────────────────
                team = self._map_column(record, [
                    'team_id', 'team', 'equipe', 'équipe', 'owner',
                    'department', 'groupe', 'group',
                ])
                team_id = str(team)[:100] if team else None

                # ── Category ─────────────────────────────────────────────────
                category = self._map_column(record, [
                    'cost_category', 'category', 'catégorie', 'categorie',
                    'type', 'usage_type', 'charge_type',
                ])
                cost_category = str(category)[:100] if category else None

                # ── TVA rate ─────────────────────────────────────────────────
                tva_rate_val = self._map_column(record, ['tva_rate'])
                tva_rate = None
                if tva_rate_val is not None:
                    try:
                        tva_rate = float(tva_rate_val)
                    except (ValueError, TypeError):
                        tva_rate = None

                # ── Source ───────────────────────────────────────────────────
                source_raw = self._map_column(record, ['source'])
                source = str(source_raw)[:100] if source_raw else None

                # ── Reference (source_ref) ───────────────────────────────────
                ref_raw = self._map_column(record, [
                    'reference', 'référence', 'réference', 'ref',
                    'resource_id', 'external_id', 'subscription_id', 'uuid',
                ])
                source_ref = None
                if ref_raw:
                    ref_str = str(ref_raw).strip()
                    if _is_valid_reference(ref_str):
                        source_ref = ref_str

                cost_records.append({
                    'amount':        amount,
                    'service_name':  service,
                    'cost_date':     cost_date,
                    'currency':      currency,
                    'project_id':    project_id,
                    'team_id':       team_id,
                    'cost_category': cost_category,
                    'tva_rate':      tva_rate,
                    'source':        source,
                    'source_ref':    source_ref,
                })

            except Exception as e:
                logger.warning(f'⚠️ Skipping row {i}: {e}')

        return cost_records

    def _parse_date(self, date_val):
        """Parse une valeur date en objet date Python"""
        if date_val is None:
            return datetime.today().date()
        if isinstance(date_val, date):
            return date_val
        if hasattr(date_val, 'date'):
            return date_val.date()
        date_str = str(date_val).strip()
        formats = (
            '%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y',
            '%Y/%m/%d', '%d.%m.%Y', '%Y-%m', '%m/%Y',
            '%B %Y', '%b %Y', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S',
        )
        for fmt in formats:
            try:
                return datetime.strptime(date_str, fmt).date()
            except (ValueError, TypeError):
                pass
        logger.warning(f'⚠️ Cannot parse date: {date_val!r}, using today')
        return datetime.today().date()

    def parse(self, db_file, db):
        """
        Parse un fichier DB et sauvegarde les coûts extraits.
        Appelé avec : file_parser.parse(db_file, db)
        """
        from app.schemas.cost import CostRecord
        from app.config import settings

        logger.info(f'⚙️ Starting parse for file ID={db_file.id} ({db_file.filename})')

        upload_dir = Path(settings.upload_dir)
        file_format = db_file.file_format
        if hasattr(file_format, 'value'):
            fmt_str = file_format.value
        else:
            fmt_str = str(file_format).lower().split('.')[-1]

        safe_name = db_file.filename.replace(' ', '_').replace('/', '_')

        matching = list(upload_dir.glob(f'*_{safe_name}'))
        if not matching:
            matching = list(upload_dir.glob(f'*{safe_name}'))
        if not matching:
            matching = list(upload_dir.glob(f'*.{fmt_str}'))

        if not matching:
            raise FileNotFoundError(f'Fichier physique introuvable pour {db_file.filename} dans {upload_dir}')

        file_path = matching[0]
        logger.info(f'📂 Found file: {file_path}')

        raw_records = self.parse_file(file_path, fmt_str)
        logger.info(f'📊 Raw records: {len(raw_records)}')

        if not raw_records:
            return {'costs_created': 0, 'rows_imported': 0, 'rows_skipped': 0}

        cost_data = self.extract_cost_data(raw_records)
        logger.info(f'💰 Extracted cost records: {len(cost_data)}')

        # Delete existing records for this file
        deleted = db.query(CostRecord).filter(CostRecord.file_id == db_file.id).delete()
        if deleted:
            logger.info(f'🗑️ Deleted {deleted} existing cost records for file {db_file.id}')

        created = 0
        skipped = 0
        for data in cost_data:
            try:
                cost = CostRecord(
                    amount=data['amount'],
                    service_name=data['service_name'],
                    cost_date=data['cost_date'],
                    currency=data['currency'],
                    project_id=data.get('project_id'),
                    team_id=data.get('team_id'),
                    cost_category=data.get('cost_category'),
                    tva_rate=data.get('tva_rate'),
                    file_id=db_file.id,
                    source=data.get('source'),
                    source_ref=data.get('source_ref'),
                )
                db.add(cost)
                created += 1
            except Exception as e:
                logger.warning(f'⚠️ Skipping cost record: {e}')
                skipped += 1

        db.commit()
        logger.info(f'✅ Parse done: {created} costs created, {skipped} skipped')

        return {
            'costs_created': created,
            'rows_imported': len(raw_records),
            'rows_skipped': skipped + (len(raw_records) - len(cost_data)),
        }


file_parser = FileParser()
