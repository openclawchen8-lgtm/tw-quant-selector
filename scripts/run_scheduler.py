#!/usr/bin/env python3
"""
Daily ingestion scheduler for the full stock universe.
Rotates through buckets so all stocks are updated over ~10 days.

Usage:
    FINMIND_TOKEN=xxx python scripts/run_scheduler.py          # run for today
    FINMIND_TOKEN=xxx python scripts/run_scheduler.py 2026-05-20  # run for specific date
"""
import os, sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tw_quant_selector.data.database import Database
from tw_quant_selector.data.finmind_client import FinMindClient
from tw_quant_selector.data.scheduler import run_daily_update
from tw_quant_selector.data.twse_client import update_stock_list

DB_PATH = os.environ.get("DUCKDB_PATH", str(os.path.join(os.path.dirname(__file__), "..", "data", "tw_quant.duckdb")))
db = Database(DB_PATH)
db.init_db()

token = os.environ.get("FINMIND_TOKEN", "")
if not token and len(sys.argv) > 1:
    token = sys.argv[1]
if not token:
    print("Usage: FINMIND_TOKEN=xxx python scripts/run_scheduler.py [DATE]")
    sys.exit(1)

client = FinMindClient(token)

run_date = date.today()
if len(sys.argv) > 1:
    try:
        run_date = date.fromisoformat(sys.argv[1])
    except ValueError:
        pass

print(f"📋 Syncing stock list from TWSE/TPEX...")
n_stocks = update_stock_list(db)
print(f"  {n_stocks} stocks in DB")

print(f"🏭 Running daily ingestion for {run_date.isoformat()}...")
result = run_daily_update(db, client, run_date)

print(f"\n📊 Results:")
for k, v in result.items():
    print(f"  {k}: {v}")

db.close()
