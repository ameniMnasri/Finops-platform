import pandas as pd
import logging
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime, date

from app.config import settings

logger = logging.getLogger(__name__)


class FileParser:
    def __init__(self):
        self.supported_formats = ('xlsx', 'xls', 'csv', 'pdf')

    # ─────────────────────────────────────────────────────────────────
    # Excel / CSV / PDF raw parsers
    # ─────────────────────────────────────────────────────────────────

    def parse_excel(self, file_path):
        logger.info(f'Parsing Excel: {file_path}')
        try:
            df = pd.read_excel(file_path)
            df.columns = [str(c).lower().strip().replace(' ', '_') for c in df.columns]
            logger.info(f'✅ Excel parsed: {len(df)} rows, cols: {list(df.columns)}')
            return df.to_dict('records')
        except Exception as e:
            logger.error(f'❌ Excel error: {e}')
            return []

    def parse_csv(self, file_path):
        logger.info(f'Parsing CSV: {file_path}')
        for enc in ('utf-8', 'latin-1', 'cp1252'):
            try:
                df = pd.read_csv(file_path, encoding=enc)
                df.columns = [str(c).lower().strip().replace(' ', '_') for c in df.columns]
                logger.info(f'✅ CSV parsed: {len(df)} rows, cols: {list(df.columns)}')
                return df.to_dict('records')
            except UnicodeDecodeError:
                continue
            except Exception as e:
                logger.error(f'❌ CSV error: {e}')
                return []
        return []

    def parse_pdf(self, file_path):
        import pdfplumber
        records = []
        try:
            with pdfplumber.open(file_path) as pdf:
                filename_lower = file_path.name.lower()
                first_page_text = (pdf.pages[0].extract_text() if pdf.pages else '') or ''

                is_ovh = (
                    filename_lower.startswith('facture_fr')
                    or 'ovh' in first_page_text.lower()
                )

                skipped = 0
                for page in pdf.pages:
                    for table in (page.extract_tables() or []):
                        if is_ovh:
                            if self._is_parasite_table(table):
                                skipped += sum(1 for r in table if any(c for c in r if c))
                                continue
                            records.extend(self._parse_ovh_table(table))
                        else:
                            if len(table) > 1:
                                headers = [
                                    str(h).lower().replace(' ', '_')
                                    for h in table[0]
                                ]
                                for row in table[1:]:
                                    records.append(dict(zip(headers, row)))

                if is_ovh:
                    logger.info(
                        f'✅ OVH PDF parsed: {len(records)} rows, {skipped} parasite rows skipped'
                    )
                else:
                    logger.info(f'✅ PDF parsed: {len(records)} rows')

        except Exception as e:
            logger.error(f'❌ PDF error: {e}')
            return []
        return records

    # ─────────────────────────────────────────────────────────────────
    # OVH-specific table helpers
    # ─────────────────────────────────────────────────────────────────

    def _is_parasite_table(self, table):
        """Detect OVH summary/total tables that should NOT be parsed as services."""
        if not table:
            return True

        real_rows = [r for r in table if any(c for c in r if c and str(c).strip())]

        if not real_rows:
            return True

        num_cols = sum(1 for c in real_rows[0] if c is not None)

        if num_cols == 2 and len(real_rows) <= 4:
            for row in real_rows:
                cells = [
                    str(c if c else '').strip().lower()
                    for c in row
                    if c is not None
                ]
                joined = ' '.join(cells)
                if any(
                    kw in joined
                    for kw in ('prix ht', 'total ttc', 'tva', 'total de la facture',
                               'abonnement', 'sous total')
                ):
                    return True

        return False

    def _parse_ovh_table(self, table):
        """Parse a single OVH service table, skipping header and subtotal rows."""
        records = []
        if not table or len(table) < 2:
            return records

        # Regex to detect a pure date like "06/07/2026"
        _date_re = re.compile(r'^\d{2}/\d{2}/\d{4}$')

        for row in table[1:]:  # skip header row
            # Normalise every cell to a stripped string (empty string if None/blank)
            cells = [str(c if c else '').strip() for c in row]

            # (i, value) pairs for non-empty cells
            non_empty = [(i, c) for i, c in enumerate(cells) if c]

            # Need at least service name + amount to be a valid data row
            if len(non_empty) < 2:
                continue

            first_lower = non_empty[0][1].lower()

            # Skip subtotal rows
            if first_lower.startswith('sous total') or first_lower.startswith('sous-total'):
                continue

            # Bug 3 fix: skip multi-line continuation rows.
            # These appear when pdfplumber splits a single table cell across rows.
            # They start with "(", "Date", or a bare date string and have no
            # reference (col 1) and no amount (last col).
            first_cell = non_empty[0][1]
            if (
                first_cell.startswith('(')
                or first_cell.startswith('Date')
                or _date_re.match(first_cell)
            ):
                ref_cell = cells[1] if len(cells) > 1 else ''
                last_cell = cells[-1] if cells else ''
                if not ref_cell and not re.search(r'\d', last_cell):
                    continue

            service_name = non_empty[0][1]
            amount_str   = non_empty[-1][1]

            # Bug 2 fix: extract col 1 as reference (UUID, VPS hostname, etc.)
            reference = cells[1] if len(cells) > 1 and cells[1] else None

            records.append({
                'service_name': service_name,
                'amount':       amount_str,
                'tva_rate':     0.2,
                'reference':    reference,
            })

        return records

    # ─────────────────────────────────────────────────────────────────
    # Generic file dispatcher
    # ─────────────────────────────────────────────────────────────────

    def parse_file(self, file_path, file_format):
        if hasattr(file_format, 'value'):
            fmt = file_format.value
        else:
            fmt = str(file_format).lower().strip().split('.')[-1]

        if fmt in ('xlsx', 'xls'):
            return self.parse_excel(file_path)
        elif fmt == 'csv':
            return self.parse_csv(file_path)
        elif fmt == 'pdf':
            return self.parse_pdf(file_path)
        else:
            raise ValueError(f'Format non supporté: {fmt}')

    # ─────────────────────────────────────────────────────────────────
    # Cost-data extraction helpers
    # ─────────────────────────────────────────────────────────────────

    def _map_column(self, record, candidates, default=None):
        """Cherche la première colonne candidate dans un record"""
        for col in candidates:
            val = record.get(col)
            if val is not None:
                s = str(val).strip()
                if s not in ('', 'nan', 'None'):
                    return val
        return default

    def extract_cost_data(self, records):
        """Extrait les données de coût depuis les records bruts"""
        cost_records = []
        for i, record in enumerate(records):
            try:
                # ── Amount ────────────────────────────────────────────
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

                # Bug 1 fix: was `<= 0`, changed to `< 0` — keep 0 € rows (free
                # services like "OS Linux Monthly fees" are real and must appear)
                if amount < 0:
                    continue

                # ── Service name ──────────────────────────────────────
                service = str(self._map_column(record, [
                    'service_name', 'service', 'product', 'produit', 'resource',
                    'ressource', 'type', 'category', 'product_name', 'service_type',
                    'nom_service',
                ], default='Unknown'))[:255]

                # ── Date ──────────────────────────────────────────────
                date_val = self._map_column(record, [
                    'cost_date', 'date', 'period', 'période', 'month', 'mois',
                    'billing_date', 'invoice_date', 'usage_date', 'start_date',
                    'end_date', 'timestamp',
                ])
                cost_date = self._parse_date(date_val)

                # ── Currency ──────────────────────────────────────────
                currency = str(self._map_column(record, [
                    'currency', 'devise', 'cur', 'unit',
                ], default='EUR'))[:10].upper().strip()
                if currency not in ('EUR', 'USD', 'GBP', 'CHF', 'TND'):
                    currency = 'EUR'

                # ── Project ───────────────────────────────────────────
                project    = self._map_column(record, [
                    'project_id', 'project', 'projet', 'account', 'account_id',
                    'subscription', 'environment', 'env', 'workspace', 'namespace',
                ])
                project_id = str(project)[:100] if project else None

                # ── Team ──────────────────────────────────────────────
                team    = self._map_column(record, [
                    'team_id', 'team', 'equipe', 'équipe', 'owner', 'department',
                    'groupe', 'group',
                ])
                team_id = str(team)[:100] if team else None

                # ── Category ──────────────────────────────────────────
                category      = self._map_column(record, [
                    'cost_category', 'category', 'catégorie', 'categorie',
                    'type', 'usage_type', 'charge_type',
                ])
                cost_category = str(category)[:100] if category else None

                # ── TVA rate ──────────────────────────────────────────
                tva_rate_val = self._map_column(record, ['tva_rate'])
                tva_rate = None
                if tva_rate_val is not None:
                    try:
                        tva_rate = float(tva_rate_val)
                    except (ValueError, TypeError):
                        tva_rate = None

                # ── Bug 2 fix: reference (UUID, VPS hostname, etc.) ───
                reference_val = self._map_column(record, [
                    'reference', 'référence', 'ref', 'resource_id', 'external_id',
                ])
                reference = str(reference_val)[:255] if reference_val else None

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
            '%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y', '%Y/%m/%d',
            '%d.%m.%Y', '%Y-%m', '%m/%Y', '%B %Y', '%b %Y',
            '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S',
        )

        for fmt in formats:
            try:
                return datetime.strptime(date_str, fmt).date()
            except (ValueError, TypeError):
                continue

        logger.warning(f'⚠️ Cannot parse date: {date_val}, using today')
        return datetime.today().date()

    # ─────────────────────────────────────────────────────────────────
    # Main entry point
    # ─────────────────────────────────────────────────────────────────

    def parse(self, db_file, db):
        """
        Parse un fichier DB et sauvegarde les coûts extraits.
        Appelé avec : file_parser.parse(db_file, db)
        """
        from app.schemas.cost import CostRecord
        from app.config import settings

        logger.info(f'⚙️ Starting parse for file ID={db_file.id} ({db_file.filename})')

        upload_dir  = Path(settings.upload_dir)
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
            raise FileNotFoundError(
                f'Fichier physique introuvable pour {db_file.filename} dans {upload_dir}'
            )

        file_path = matching[0]
        logger.info(f'📂 Found file: {file_path}')

        raw_records = self.parse_file(file_path, fmt_str)
        logger.info(f'📊 Raw records: {len(raw_records)}')

        if not raw_records:
            return {'costs_created': 0, 'rows_imported': 0, 'rows_skipped': 0}

        cost_data = self.extract_cost_data(raw_records)
        logger.info(f'💰 Extracted cost records: {len(cost_data)}')

        deleted = db.query(CostRecord).filter(CostRecord.file_id == db_file.id).delete()
        if deleted:
            logger.info(f'🗑️ Deleted {deleted} existing cost records for file {db_file.id}')

        # Determine source from filename pattern
        filename_lower = db_file.filename.lower()
        if filename_lower.startswith('facture_fr') or 'ovh' in filename_lower:
            source = 'OVHcloud'
        else:
            source = 'Fichier'

        created = 0
        skipped = 0
        for data in cost_data:
            try:
                cost = CostRecord(
                    amount        = data['amount'],
                    service_name  = data['service_name'],
                    cost_date     = data['cost_date'],
                    currency      = data['currency'],
                    project_id    = data.get('project_id'),
                    team_id       = data.get('team_id'),
                    cost_category = data.get('cost_category'),
                    tva_rate      = data.get('tva_rate'),
                    file_id       = db_file.id,
                    source        = source,
                    reference     = data.get('reference'),
                    source_file   = db_file.filename,
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
            'rows_imported': created,
            'rows_skipped':  skipped,
            'source':        source,
        }


file_parser = FileParser()
