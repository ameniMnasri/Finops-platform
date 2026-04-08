import pandas as pd
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import date, datetime
import hashlib

from app.config import settings

logger = logging.getLogger(__name__)


class FileParser:

    def parse(self, file_path: str, file_format: str) -> List[Dict[str, Any]]:
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        fmt = file_format.lower()
        if fmt in ("xlsx", "xls"):
            return self._parse_excel(path)
        elif fmt == "csv":
            return self._parse_csv(path)
        elif fmt == "pdf":
            return self._parse_pdf(path)
        else:
            raise ValueError(f"Unsupported format: {file_format}")

    def _parse_excel(self, path: Path) -> List[Dict[str, Any]]:
        records = []
        try:
            xl = pd.ExcelFile(path)
            for sheet in xl.sheet_names:
                df = pd.read_excel(xl, sheet_name=sheet)
                records.extend(self._df_to_costs(df, source=path.name))
        except Exception as e:
            logger.error(f"Error parsing Excel {path}: {e}")
            raise
        return records

    def _parse_csv(self, path: Path) -> List[Dict[str, Any]]:
        try:
            for enc in ("utf-8", "utf-8-sig", "latin-1"):
                try:
                    for sep in (",", ";", "\t"):
                        try:
                            df = pd.read_csv(path, encoding=enc, sep=sep)
                            if len(df.columns) > 1:
                                return self._df_to_costs(df, source=path.name)
                        except Exception:
                            continue
                except Exception:
                    continue
        except Exception as e:
            logger.error(f"Error parsing CSV {path}: {e}")
            raise
        return []

    def _parse_pdf(self, path: Path) -> List[Dict[str, Any]]:
        try:
            import pdfplumber
            records = []
            with pdfplumber.open(path) as pdf:
                for page in pdf.pages:
                    tables = page.extract_tables()
                    for table in tables:
                        if not table:
                            continue
                        headers = [str(h).lower().strip() if h else "" for h in table[0]]
                        for row in table[1:]:
                            record = self._row_to_cost(headers, row, source=path.name)
                            if record:
                                records.append(record)
            return records
        except ImportError:
            logger.warning("pdfplumber not installed, skipping PDF parsing")
            return []
        except Exception as e:
            logger.error(f"Error parsing PDF {path}: {e}")
            raise

    def _df_to_costs(self, df: pd.DataFrame, source: str = "") -> List[Dict[str, Any]]:
        df.columns = [str(c).lower().strip() for c in df.columns]
        records = []
        for _, row in df.iterrows():
            record = self._map_row(row.to_dict(), source)
            if record:
                records.append(record)
        return records

    def _row_to_cost(self, headers: List[str], row: list, source: str = "") -> Optional[Dict[str, Any]]:
        row_dict = {h: row[i] if i < len(row) else None for i, h in enumerate(headers)}
        return self._map_row(row_dict, source)

    def _map_row(self, row: dict, source: str = "") -> Optional[Dict[str, Any]]:
        # Try to find amount
        amount = None
        for key in ("amount", "total", "cost", "price", "montant", "prix", "total_ht", "total ht"):
            if key in row and row[key] is not None:
                try:
                    val = str(row[key]).replace(",", ".").replace("€", "").replace("$", "").strip()
                    amount = float(val)
                    break
                except (ValueError, TypeError):
                    continue

        if amount is None:
            return None

        # Service/description
        service = None
        for key in ("service", "description", "product", "item", "libelle", "désignation", "designation"):
            if key in row and row[key]:
                service = str(row[key]).strip()[:255]
                break

        # Project
        project = None
        for key in ("project", "projet", "client", "account"):
            if key in row and row[key]:
                project = str(row[key]).strip()[:255]
                break

        # Date
        cost_date = None
        for key in ("date", "cost_date", "billing_date", "invoice_date", "period"):
            if key in row and row[key]:
                try:
                    d = pd.to_datetime(row[key], errors="coerce")
                    if d is not pd.NaT:
                        cost_date = d.date()
                        break
                except Exception:
                    continue

        # Currency
        currency = "EUR"
        for key in ("currency", "devise", "monnaie"):
            if key in row and row[key]:
                currency = str(row[key]).strip().upper()[:3]
                break

        return {
            "service": service,
            "project": project,
            "amount": amount,
            "currency": currency,
            "cost_date": cost_date,
            "description": service,
            "source": source,
            "source_ref": None,
        }

    def parse_api_data(self, data: Any, source_name: str = "API") -> List[Dict[str, Any]]:
        records = []
        if isinstance(data, list):
            for item in data:
                record = self._map_row(item, source_name) if isinstance(item, dict) else None
                if record:
                    records.append(record)
        elif isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, list):
                    for item in value:
                        record = self._map_row(item, source_name) if isinstance(item, dict) else None
                        if record:
                            records.append(record)
        return records


file_parser = FileParser()
