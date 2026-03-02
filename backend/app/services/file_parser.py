import pandas as pd
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime, date
import hashlib

from app.config import settings

logger = logging.getLogger(__name__)


class FileParser:
    """Service pour parser Excel/PDF/CSV et extraire les coûts"""

    def __init__(self):
        self.supported_formats = ["xlsx", "xls", "csv", "pdf"]

    # ── Parsers bruts ────────────────────────────────────────────────

    def parse_excel(self, file_path: Path) -> List[Dict[str, Any]]:
        try:
            logger.info(f"Parsing Excel: {file_path}")
            df = pd.read_excel(file_path)
            df.columns = df.columns.str.lower().str.strip().str.replace(" ", "_")
            logger.info(f"✅ Excel parsed: {len(df)} rows, cols: {list(df.columns)}")
            return df.to_dict('records')
        except Exception as e:
            logger.error(f"❌ Excel error: {e}")
            raise

    def parse_csv(self, file_path: Path) -> List[Dict[str, Any]]:
        try:
            logger.info(f"Parsing CSV: {file_path}")
            # Essayer plusieurs encodages
            for enc in ['utf-8', 'latin-1', 'cp1252']:
                try:
                    df = pd.read_csv(file_path, encoding=enc)
                    break
                except UnicodeDecodeError:
                    continue
            df.columns = df.columns.str.lower().str.strip().str.replace(" ", "_")
            logger.info(f"✅ CSV parsed: {len(df)} rows, cols: {list(df.columns)}")
            return df.to_dict('records')
        except Exception as e:
            logger.error(f"❌ CSV error: {e}")
            raise

    def parse_pdf(self, file_path: Path) -> List[Dict[str, Any]]:
        try:
            import pdfplumber
            records = []
            with pdfplumber.open(file_path) as pdf:
                for page in pdf.pages:
                    for table in (page.extract_tables() or []):
                        if len(table) > 1:
                            headers = [str(h).lower().replace(" ", "_") for h in table[0]]
                            for row in table[1:]:
                                records.append(dict(zip(headers, row)))
            logger.info(f"✅ PDF parsed: {len(records)} rows")
            return records
        except Exception as e:
            logger.error(f"❌ PDF error: {e}")
            return []

    def parse_file(self, file_path: Path, file_format: str) -> List[Dict[str, Any]]:
        fmt = file_format.lower().strip() if hasattr(file_format, 'lower') else str(file_format).lower()
        # Gérer les enums FastAPI/SQLAlchemy (ex: FileFormat.CSV → "csv")
        if '.' in fmt:
            fmt = fmt.split('.')[-1]
        if fmt in ["xlsx", "xls"]:
            return self.parse_excel(file_path)
        elif fmt == "csv":
            return self.parse_csv(file_path)
        elif fmt == "pdf":
            return self.parse_pdf(file_path)
        else:
            raise ValueError(f"Format non supporté: {fmt}")

    # ── Mapping colonnes → champs coût ──────────────────────────────

    def _map_column(self, record: Dict, candidates: List[str], default=None):
        """Cherche la première colonne candidate dans un record"""
        for col in candidates:
            if col in record and record[col] is not None and str(record[col]).strip() not in ('', 'nan', 'None'):
                return record[col]
        return default

    def extract_cost_data(self, records: List[Dict]) -> List[Dict]:
        """Extrait les données de coût depuis les records bruts"""
        cost_records = []

        for i, record in enumerate(records):
            try:
                # ── Montant ──────────────────────────────────────────
                amount_val = self._map_column(record, [
                    'amount', 'montant', 'cost', 'coût', 'cout', 'price', 'prix',
                    'total', 'total_amount', 'value', 'valeur', 'charge', 'frais',
                    'blended_cost', 'unblended_cost', 'net_cost',
                ])
                if amount_val is None:
                    continue
                try:
                    amount = float(str(amount_val).replace(',', '.').replace(' ', '').replace('€', '').replace('$', ''))
                    if amount <= 0:
                        continue
                except (ValueError, TypeError):
                    continue

                # ── Service ──────────────────────────────────────────
                service = str(self._map_column(record, [
                    'service_name', 'service', 'product', 'produit',
                    'resource', 'ressource', 'type', 'category',
                    'product_name', 'service_type', 'nom_service',
                ], default='Unknown'))[:255]

                # ── Date ─────────────────────────────────────────────
                date_val = self._map_column(record, [
                    'cost_date', 'date', 'period', 'période', 'month',
                    'mois', 'billing_date', 'invoice_date', 'usage_date',
                    'start_date', 'end_date', 'timestamp',
                ])
                cost_date = self._parse_date(date_val)

                # ── Devise ───────────────────────────────────────────
                currency = str(self._map_column(record, [
                    'currency', 'devise', 'cur', 'unit',
                ], default='EUR'))[:10].upper().strip()
                if currency not in ['EUR', 'USD', 'GBP', 'CHF', 'TND']:
                    currency = 'EUR'

                # ── Projet ───────────────────────────────────────────
                project = self._map_column(record, [
                    'project_id', 'project', 'projet', 'account',
                    'account_id', 'subscription', 'environment', 'env',
                    'workspace', 'namespace',
                ])
                project_id = str(project)[:100] if project else None

                # ── Équipe ───────────────────────────────────────────
                team = self._map_column(record, [
                    'team_id', 'team', 'equipe', 'équipe', 'owner',
                    'department', 'groupe', 'group',
                ])
                team_id = str(team)[:100] if team else None

                # ── Catégorie ────────────────────────────────────────
                category = self._map_column(record, [
                    'cost_category', 'category', 'catégorie', 'categorie',
                    'type', 'usage_type', 'charge_type',
                ])
                cost_category = str(category)[:100] if category else None

                cost_records.append({
                    'amount':        amount,
                    'service_name':  service,
                    'cost_date':     cost_date,
                    'currency':      currency,
                    'project_id':    project_id,
                    'team_id':       team_id,
                    'cost_category': cost_category,
                })

            except Exception as e:
                logger.warning(f"⚠️ Skipping row {i}: {e}")
                continue

        return cost_records

    def _parse_date(self, date_val) -> date:
        """Parse une valeur date en objet date Python"""
        if date_val is None:
            return datetime.today().date()
        if isinstance(date_val, date):
            return date_val
        if hasattr(date_val, 'date'):
            return date_val.date()

        date_str = str(date_val).strip()
        formats = [
            '%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y',
            '%d-%m-%Y', '%Y/%m/%d', '%d.%m.%Y',
            '%Y-%m', '%m/%Y', '%B %Y', '%b %Y',
            '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S',
        ]
        for fmt in formats:
            try:
                return datetime.strptime(date_str[:len(fmt)], fmt).date()
            except (ValueError, TypeError):
                continue

        logger.warning(f"⚠️ Cannot parse date: {date_val!r}, using today")
        return datetime.today().date()

    # ── ✅ MÉTHODE PRINCIPALE — appelée depuis files.py ──────────────

    def parse(self, db_file, db) -> Dict[str, Any]:
        """
        Parse un fichier DB et sauvegarde les coûts extraits.
        Appelé avec : file_parser.parse(db_file, db)
        """
        from app.schemas.cost import CostRecord
        from app.config import settings

        logger.info(f"⚙️ Starting parse for file ID={db_file.id} ({db_file.filename})")

        # ── Trouver le chemin physique du fichier ────────────────────
        upload_dir = Path(settings.upload_dir)
        file_format = db_file.file_format

        # Gérer les enums SQLAlchemy (FileFormat.CSV → "csv")
        if hasattr(file_format, 'value'):
            fmt_str = file_format.value
        else:
            fmt_str = str(file_format).lower().split('.')[-1]

        # Chercher le fichier sur disque
        safe_name = db_file.filename.replace(" ", "_").replace("/", "_")
        # Le nom contient les 8 premiers chars du hash
        matching = list(upload_dir.glob(f"*_{safe_name}"))
        if not matching:
            # Fallback : chercher par nom uniquement
            matching = list(upload_dir.glob(f"*{safe_name}"))
        if not matching:
            # Deuxième fallback : chercher par extension
            matching = list(upload_dir.glob(f"*.{fmt_str}"))

        if not matching:
            raise FileNotFoundError(
                f"Fichier physique introuvable pour {db_file.filename} dans {upload_dir}"
            )

        file_path = matching[0]
        logger.info(f"📂 Found file: {file_path}")

        # ── Parser le fichier ────────────────────────────────────────
        raw_records = self.parse_file(file_path, fmt_str)
        logger.info(f"📊 Raw records: {len(raw_records)}")

        if not raw_records:
            return {"costs_created": 0, "rows_imported": 0, "rows_skipped": 0}

        # ── Extraire les données de coût ─────────────────────────────
        cost_data = self.extract_cost_data(raw_records)
        logger.info(f"💰 Extracted cost records: {len(cost_data)}")

        # ── Sauvegarder en DB ────────────────────────────────────────
        created = 0
        skipped = 0

        for data in cost_data:
            try:
                cost = CostRecord(
                    amount=        data['amount'],
                    service_name=  data['service_name'],
                    cost_date=     data['cost_date'],
                    currency=      data['currency'],
                    project_id=    data.get('project_id'),
                    team_id=       data.get('team_id'),
                    cost_category= data.get('cost_category'),
                    file_id=       db_file.id,
                )
                db.add(cost)
                created += 1
            except Exception as e:
                logger.warning(f"⚠️ Skipping cost record: {e}")
                skipped += 1

        db.commit()
        logger.info(f"✅ Parse done: {created} costs created, {skipped} skipped")

        return {
            "costs_created": created,
            "rows_imported": len(raw_records),
            "rows_skipped":  skipped + (len(raw_records) - len(cost_data)),
        }


# Instance globale
file_parser = FileParser()