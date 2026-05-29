#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

# Add project root and src to path
root = Path(__file__).parent.parent
sys.path.insert(0, str(root))
sys.path.insert(0, str(root / "src"))

from tw_quant_selector.data.database import Database

def export_portfolio():
    db_path = os.environ.get("DUCKDB_PATH", "data/tw_quant.duckdb")
    db = Database(db_path)
    db.init_db() # Ensure table exists
    
    rows = db.execute("""
        SELECT p.stock_id, p.avg_cost, p.shares, p.is_etf, s.market
        FROM portfolio p
        LEFT JOIN stocks s ON p.stock_id = s.stock_id
    """).fetchall()
    
    portfolio_data = []
    for r in rows:
        portfolio_data.append({
            "stock_id": r[0],
            "avg_cost": float(r[1]),
            "shares": int(r[2]),
            "is_etf": bool(r[3]),
            "market": (r[4] or "TSE").upper()
        })
    
    output_path = ".stock_monitor.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(portfolio_data, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Exported {len(portfolio_data)} holdings to {output_path}")

if __name__ == "__main__":
    export_portfolio()
