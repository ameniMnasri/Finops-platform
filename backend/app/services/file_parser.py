import pandas as pd
import logging
from pathlib import Path
from typing import List, Dict, Any
import hashlib
from datetime import datetime

logger = logging.getLogger(__name__)

class FileParser:
    """Service pour parser Excel/PDF/CSV"""
    
    def __init__(self):
        self.supported_formats = ["xlsx", "xls", "csv", "pdf"]
    
    def parse_excel(self, file_path: Path) -> List[Dict[str, Any]]:
        """Parse Excel file and return list of records"""
        try:
            logger.info(f"Parsing Excel file: {file_path}")
            
            # Read Excel
            df = pd.read_excel(file_path)
            
            # Normalize column names (lowercase, remove spaces)
            df.columns = df.columns.str.lower().str.replace(" ", "_")
            
            logger.info(f"✅ Excel parsed: {len(df)} rows")
            
            # Convert to list of dicts
            records = df.to_dict('records')
            return records
            
        except Exception as e:
            logger.error(f"❌ Excel parsing error: {e}")
            raise
    
    def parse_csv(self, file_path: Path) -> List[Dict[str, Any]]:
        """Parse CSV file and return list of records"""
        try:
            logger.info(f"Parsing CSV file: {file_path}")
            
            # Read CSV
            df = pd.read_csv(file_path)
            
            # Normalize column names
            df.columns = df.columns.str.lower().str.replace(" ", "_")
            
            logger.info(f"✅ CSV parsed: {len(df)} rows")
            
            # Convert to list of dicts
            records = df.to_dict('records')
            return records
            
        except Exception as e:
            logger.error(f"❌ CSV parsing error: {e}")
            raise
    
    def parse_pdf(self, file_path: Path) -> List[Dict[str, Any]]:
        """Parse PDF file (tables) and return list of records"""
        try:
            logger.info(f"Parsing PDF file: {file_path}")
            
            import pdfplumber
            
            records = []
            
            with pdfplumber.open(file_path) as pdf:
                for page_num, page in enumerate(pdf.pages, 1):
                    tables = page.extract_tables()
                    
                    if tables:
                        for table in tables:
                            # First row is header
                            if len(table) > 1:
                                headers = [str(h).lower().replace(" ", "_") for h in table[0]]
                                
                                for row in table[1:]:
                                    record = dict(zip(headers, row))
                                    records.append(record)
            
            logger.info(f"✅ PDF parsed: {len(records)} rows")
            return records
            
        except Exception as e:
            logger.error(f"❌ PDF parsing error: {e}")
            # Return empty list au lieu de crasher
            return []
    
    def parse_file(self, file_path: Path, file_format: str) -> List[Dict[str, Any]]:
        """Parse file based on format"""
        
        if file_format in ["xlsx", "xls"]:
            return self.parse_excel(file_path)
        elif file_format == "csv":
            return self.parse_csv(file_path)
        elif file_format == "pdf":
            return self.parse_pdf(file_path)
        else:
            raise ValueError(f"Unsupported format: {file_format}")
    
    def extract_cost_data(self, records: List[Dict]) -> List[Dict]:
        """Extract cost-related data from parsed records"""
        
        cost_records = []
        
        for record in records:
            # Map common column names
            cost_record = {
                "date": record.get("date") or record.get("cost_date") or record.get("date"),
                "amount": record.get("amount") or record.get("cost") or record.get("price"),
                "currency": record.get("currency") or "EUR",
                "service": record.get("service") or record.get("service_name") or "Unknown",
                "project": record.get("project") or record.get("project_id") or None,
                "team": record.get("team") or record.get("team_id") or None,
                "category": record.get("category") or record.get("cost_category") or None,
            }
            
            # Validate required fields
            if cost_record.get("date") and cost_record.get("amount"):
                cost_records.append(cost_record)
        
        return cost_records

# Singleton instance
file_parser = FileParser()