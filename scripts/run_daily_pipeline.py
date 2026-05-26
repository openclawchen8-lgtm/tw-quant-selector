#!/usr/bin/env python3
"""
Daily pipeline: fetch data → compute scores → select top stocks/ETFs.
Run after rate limit resets (e.g. every weekday).

Usage:
    FINMIND_TOKEN=xxx python scripts/run_daily_pipeline.py
    FINMIND_TOKEN=xxx python scripts/run_daily_pipeline.py 2026-05-26
"""
import os, sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tw_quant_selector.data.database import Database
from tw_quant_selector.data.finmind_client import FinMindClient
from tw_quant_selector.data.scheduler import run_daily_update
from tw_quant_selector.data.twse_client import update_stock_list
from tw_quant_selector.strategies.combiner import compute_composite_scores

DB_PATH = os.environ.get("DUCKDB_PATH", str(os.path.join(
    os.path.dirname(__file__), "..", "data", "tw_quant.duckdb"
)))

token = os.environ.get("FINMIND_TOKEN", "")
if not token and len(sys.argv) > 1:
    token = sys.argv[1]
if not token:
    print("Usage: FINMIND_TOKEN=xxx python scripts/run_daily_pipeline.py [DATE]")
    sys.exit(1)

run_date = date.today()
if len(sys.argv) > 1:
    try:
        run_date = date.fromisoformat(sys.argv[1])
    except ValueError:
        pass

db = Database(DB_PATH)
db.init_db()
client = FinMindClient(token)

print(f"📋 Step 0: Sync stock list from TWSE/TPEX")
n_stocks = update_stock_list(db)
print(f"  {n_stocks} stocks in DB")

print(f"🏭 Step 1: Ingest data for {run_date}")
ingest = run_daily_update(db, client, run_date)
if ingest.get("status") == "skipped":
    print(f"  ⏭ {ingest.get('reason')} — make sure stocks table is populated")
    db.close()
    sys.exit(0)

print(f"  stocks_in_batch: {ingest['stocks_in_batch']}")
for ds, n in ingest.get("datasets", {}).items():
    print(f"    {ds}: {n} rows")

print(f"\n🧮 Step 2: Compute composite scores")
result = compute_composite_scores(db, run_date)

print(f"\n📊 Top {len(result['stocks'])} Stocks:")
for s in result["stocks"]:
    print(f"  #{s['rank']:2d} {s['stock_id']:6s}  score={s['score']:.4f}")

print(f"\n📊 Top {len(result['etfs'])} ETFs:")
for s in result["etfs"]:
    print(f"  #{s['rank']:2d} {s['stock_id']:6s}  score={s['score']:.4f}")

print(f"\n✅ Done — {result['total_candidates']} candidates evaluated")

db.close()
