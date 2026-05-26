import re
from datetime import date, timedelta
from typing import Any
import structlog

from tw_quant_selector.data.database import Database
from tw_quant_selector.data.finmind_client import FinMindClient
from tw_quant_selector.data.ingestion import (
    update_daily_prices,
    update_valuations,
    update_monthly_revenue,
    update_financials,
)

log = structlog.get_logger()

DATASETS = ["price", "per", "revenue", "financials", "balance_sheet"]

_FINMIND_VALID_ID = re.compile(r"^\d{4}$|^00\d{3,4}$")


def is_finmind_valid(stock_id: str) -> bool:
    return bool(_FINMIND_VALID_ID.match(stock_id))

DATASET_REQUESTS = {
    "price": 1,
    "per": 1,
    "revenue": 1,
    "financials": 1,
    "balance_sheet": 1,
}

REQUESTS_PER_STOCK = sum(DATASET_REQUESTS.values())

STOCKS_PER_DAY = 120

FINANCIAL_START = "2022-01-01"
REVENUE_START = "2020-01-01"
PRICE_LOOKBACK_DAYS = 600


def _hash_bucket(stock_id: str, num_buckets: int) -> int:
    return (hash(stock_id) % num_buckets + num_buckets) % num_buckets


def _init_tracker(db: Database, as_of_date: date) -> dict[str, int]:
    with db.connection() as conn:
        existing = {
            (r["stock_id"], r["dataset"])
            for r in conn.execute(
                "SELECT stock_id, dataset FROM ingestion_tracker"
            ).fetchdf().to_dict("records")
        }
        stocks = conn.execute(
            "SELECT stock_id FROM stocks"
        ).fetchdf()

    if stocks.empty:
        return {}

    total_stocks = len(stocks)
    num_buckets = max(1, total_stocks // STOCKS_PER_DAY + (1 if total_stocks % STOCKS_PER_DAY else 0))

    bucket_counts: dict[int, int] = {}
    with db.connection() as conn:
        for _, row in stocks.iterrows():
            sid = row["stock_id"]
            b = _hash_bucket(sid, num_buckets)
            bucket_counts[b] = bucket_counts.get(b, 0) + 1
            for ds in DATASETS:
                if (sid, ds) not in existing:
                    conn.execute(
                        "INSERT INTO ingestion_tracker VALUES (?, ?, ?, NULL, NULL, NULL)",
                        [sid, ds, b]
                    )
        conn.commit()

    log.info("scheduler.tracker.init",
             total_stocks=total_stocks, buckets=num_buckets,
             new_rows=total_stocks * len(DATASETS) - len(existing))
    return bucket_counts


def _get_requests_per_stock(sid: str, is_etf: bool) -> int:
    if is_etf:
        return 2
    return REQUESTS_PER_STOCK


def get_todays_batch(db: Database, run_date: date | None = None) -> list[dict]:
    run_date = run_date or date.today()
    bucket_counts = _init_tracker(db, run_date)
    if not bucket_counts:
        return []

    total_buckets = len(bucket_counts)
    day_offset = run_date.toordinal() % total_buckets

    with db.connection() as conn:
        rows = conn.execute(
            "SELECT DISTINCT stock_id, bucket FROM ingestion_tracker WHERE bucket = ?",
            [day_offset],
        ).fetchdf()

    result = []
    for _, row in rows.iterrows():
        sid = row["stock_id"]
        with db.connection() as conn:
            etf_row = conn.execute(
                "SELECT is_etf FROM stocks WHERE stock_id = ?", [sid]
            ).fetchone()
        is_etf = bool(etf_row and etf_row[0]) if etf_row else False
        result.append({"stock_id": sid, "is_etf": is_etf})

    log.info("scheduler.todays_batch", date=run_date.isoformat(),
             bucket=day_offset, count=len(result))
    return result


def _update_tracker(db: Database, sid: str, ds: str, status: str, error: str | None = None):
    with db.connection() as conn:
        conn.execute(
            "UPDATE ingestion_tracker SET last_updated = ?, last_status = ?, error_msg = ? WHERE stock_id = ? AND dataset = ?",
            [date.today(), status, error, sid, ds]
        )
        conn.commit()


def run_daily_update(db: Database, client: FinMindClient, run_date: date | None = None) -> dict[str, Any]:
    run_date = run_date or date.today()
    batch = get_todays_batch(db, run_date)
    if not batch:
        return {"status": "skipped", "reason": "no stocks in batch", "stocks": 0}

    stock_ids = [s["stock_id"] for s in batch]
    etf_ids = [s["stock_id"] for s in batch if s["is_etf"]]
    stock_ids_only = [s["stock_id"] for s in batch if not s["is_etf"]]
    finmind_valid = [s for s in stock_ids if is_finmind_valid(s)]

    results: dict[str, Any] = {
        "date": run_date.isoformat(),
        "stocks_in_batch": len(batch),
        "finmind_valid": len(finmind_valid),
        "invalid_skipped": len(stock_ids) - len(finmind_valid),
        "datasets": {},
    }

    price_start = run_date - timedelta(days=PRICE_LOOKBACK_DAYS)
    day_iso = run_date.isoformat()

    try:
        n = update_daily_prices(db, client, finmind_valid, price_start, run_date)
        results["datasets"]["price"] = n
    except Exception as e:
        log.error("scheduler.price_failed", error=str(e))

    for ds, func, args in [
        ("per", update_valuations, (db, client, finmind_valid, "2022-01-01", day_iso)),
        ("revenue", update_monthly_revenue, (db, client, stock_ids_only, REVENUE_START, day_iso)),
        ("financials", update_financials, (db, client, stock_ids_only, FINANCIAL_START, day_iso)),
    ]:
        try:
            n = func(*args)
            results["datasets"][ds] = n
        except Exception as e:
            log.error("scheduler.dataset_failed", dataset=ds, error=str(e))
            results["datasets"][ds] = 0

    n_ok_price = results["datasets"].get("price", 0) > 0
    n_ok_per = results["datasets"].get("per", 0) > 0
    n_ok_fin = results["datasets"].get("financials", 0) > 0
    n_ok_rev = results["datasets"].get("revenue", 0) > 0

    for s in batch:
        sid = s["stock_id"]
        is_etf = s["is_etf"]
        if is_etf:
            status = "ok" if n_ok_price and n_ok_per else "failed"
        elif is_finmind_valid(sid):
            status = "ok" if n_ok_price and n_ok_per and n_ok_fin and n_ok_rev else "failed"
        else:
            _update_tracker(db, sid, "price", "skipped", "invalid_id")
            continue
        for ds in (["price", "per"] if is_etf else DATASETS):
            _update_tracker(db, sid, ds, status)

    log.info("scheduler.daily_complete",
             date=run_date.isoformat(),
             stocks=len(stock_ids_only),
             etfs=len(etf_ids),
             valid=len(finmind_valid),
             skipped=len(stock_ids) - len(finmind_valid),
             datasets={k: v for k, v in results["datasets"].items() if v})

    return results
