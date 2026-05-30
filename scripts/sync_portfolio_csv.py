#!/usr/bin/env python3
import csv
import json
import sys
import os
from pathlib import Path

# Add src to path to import Database
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from tw_quant_selector.data.database import Database

def convert_csv_to_json(csv_path: str, json_path: str):
    holdings = []
    db = Database(read_only=False)
    
    try:
        with open(csv_path, mode='r', encoding='utf-8') as f:
            reader = csv.DictReader(f, skipinitialspace=True)
            for row in reader:
                holding = {
                    "stock_id": row["stock_id"].strip(),
                    "avg_cost": float(row["avg_cost"].strip()),
                    "shares": int(row["shares"].strip()),
                    "is_etf": row["is_etf"].strip().upper() == "TRUE",
                    "pl_pct_thod": float(row["pl_pct_thod"].strip()),
                    "pl_thod": float(row["pl_thod"].strip()),
                    "market": "TSE" 
                }
                holdings.append(holding)
        
        # 1. Update JSON
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(holdings, f, indent=2, ensure_ascii=False)
            
        # 2. Update Database
        with db.connection() as conn:
            for h in holdings:
                conn.execute("""
                    INSERT OR REPLACE INTO portfolio (stock_id, avg_cost, shares, is_etf, pl_pct_thod, pl_thod)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, [h["stock_id"], h["avg_cost"], h["shares"], h["is_etf"], h["pl_pct_thod"], h["pl_thod"]])
        
        print(f"✅ Successfully converted {csv_path} to {json_path} and updated DB")
        print(f"   Processed {len(holdings)} holdings.")
        
    except Exception as e:
        print(f"❌ Error converting CSV: {e}")
        sys.exit(1)

if __name__ == "__main__":
    base_dir = Path(__file__).parent.parent
    csv_file = base_dir / "stock_monitor.csv"
    json_file = base_dir / ".stock_monitor.json"
    
    convert_csv_to_json(str(csv_file), str(json_file))
