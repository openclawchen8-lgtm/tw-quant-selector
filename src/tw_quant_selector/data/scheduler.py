import re
from datetime import date, timedelta
from typing import Any
import structlog

from tw_quant_selector.data.database import Database
from tw_quant_selector.data.finmind_client import FinMindClient
from tw_quant_selector.data.ingestion import (
    update_daily_prices,
    update_daily_prices_from_twse,
    update_valuations,
    update_monthly_revenue,
    update_financials,
)

log = structlog.get_logger()

DATASETS = ["price", "per", "revenue", "financials"]

_FINMIND_VALID_ID = re.compile(r"^\d{4}$|^00\d{3,4}$|^\d{5}[A-Z]?$|^\d{4}[A-Z]\d{0,2}$|^\d{6}[A-Z]?$")


def is_finmind_valid(stock_id: str) -> bool:
    return bool(_FINMIND_VALID_ID.match(stock_id))

DATASET_REQUESTS = {
    "price": 1,
    "per": 1,
    "revenue": 1,
    "financials": 1,
}

REQUESTS_PER_STOCK = sum(DATASET_REQUESTS.values())

STOCKS_PER_DAY = 120

FINANCIAL_START = "2022-01-01"
REVENUE_START = "2020-01-01"
PRICE_LOOKBACK_DAYS = 600


def _hash_bucket(stock_id: str, num_buckets: int) -> int:
    return (hash(stock_id) % num_buckets + num_buckets) % num_buckets


def _init_tracker(db: Database, as_of_date: date) -> dict[int, int]:
    """
    Initialize / validate ingestion_tracker bucket assignments.

    Bucket assignment is deterministic: stock_id → bucket = hash(stock_id) % HASH_MODULO.
    HASH_MODULO is recalculated only when stock count changes significantly, so
    bucket assignments stay stable across runs and each bucket ends up with ~STOCKS_PER_DAY stocks.

    Returns bucket_counts for get_todays_batch.
    """
    with db.connection() as conn:
        stocks_df = conn.execute("SELECT stock_id FROM stocks").fetchdf()

    if stocks_df.empty:
        return {}

    total_stocks = len(stocks_df)
    HASH_MODULO = max(1, total_stocks // STOCKS_PER_DAY)

    # Only rebuild if HASH_MODULO changed significantly (within ±2)
    HASH_MODULO_MIN = max(1, total_stocks // STOCKS_PER_DAY - 2)
    HASH_MODULO_MAX = max(1, total_stocks // STOCKS_PER_DAY + 2)

    with db.connection() as conn:
        rows = conn.execute("SELECT stock_id, bucket FROM ingestion_tracker LIMIT 1").fetchdf()
        needs_rebuild = rows.empty

        if not needs_rebuild:
            existing_count = conn.execute("SELECT COUNT(DISTINCT stock_id) FROM ingestion_tracker").fetchone()
            if existing_count and existing_count[0] != total_stocks:
                needs_rebuild = True

    if not needs_rebuild:
        bucket_counts: dict[int, int] = {}
        with db.connection() as conn:
            rows = conn.execute("SELECT bucket FROM ingestion_tracker").fetchdf()
            for _, r in rows.iterrows():
                bucket_counts[r["bucket"]] = bucket_counts.get(r["bucket"], 0) + 1
        log.info("scheduler.tracker.skip", total_stocks=total_stocks, buckets=len(bucket_counts),
                 stocks_per_bucket=round(total_stocks / max(1, len(bucket_counts)), 1))
        return bucket_counts

    log.info("scheduler.tracker.rebuild", total_stocks=total_stocks, hash_modulo=HASH_MODULO)

    with db.connection() as conn:
        conn.execute("DELETE FROM ingestion_tracker")
        conn.commit()

    bucket_counts: dict[int, int] = {}
    with db.connection() as conn:
        for _, row in stocks_df.iterrows():
            sid = row["stock_id"]
            b = _hash_bucket(sid, HASH_MODULO)
            bucket_counts[b] = bucket_counts.get(b, 0) + 1
            for ds in DATASETS:
                conn.execute(
                    "INSERT INTO ingestion_tracker VALUES (?, ?, ?, NULL, NULL, NULL)",
                    [sid, ds, b]
                )
        conn.commit()

    log.info("scheduler.tracker.init",
             total_stocks=total_stocks,
             hash_modulo=HASH_MODULO,
             buckets=len(bucket_counts),
             rows=total_stocks * len(DATASETS),
             stocks_per_bucket=round(total_stocks / max(1, len(bucket_counts)), 1),
             target=STOCKS_PER_DAY)
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
             bucket=day_offset, total_buckets=total_buckets, count=len(result))
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

    print(f"\n{'='*60}")
    print(f"📅 Scheduler 執行日期: {run_date.isoformat()}")
    print(f"{'='*60}")

    batch = get_todays_batch(db, run_date)
    if not batch:
        print("⚠️ 今日沒有股票需要處理（batch 為空）")
        return {"status": "skipped", "reason": "no stocks in batch", "stocks": 0}

    stock_ids = [s["stock_id"] for s in batch]
    etf_ids = [s["stock_id"] for s in batch if s["is_etf"]]
    stock_ids_only = [s["stock_id"] for s in batch if not s["is_etf"]]
    finmind_valid = [s for s in stock_ids if is_finmind_valid(s)]

    print(f"\n📦 今日批次資訊:")
    print(f"   總股票數: {len(batch)}")
    print(f"   ETF 數量: {len(etf_ids)}")
    print(f"   個股數量: {len(stock_ids_only)}")
    print(f"   FinMind 有效: {len(finmind_valid)} (格式符合)")
    print(f"   無效 ID (跳過): {len(stock_ids) - len(finmind_valid)}")
    print(f"\n📋 今日股票列表:")
    for i, s in enumerate(batch, 1):
        marker = " [ETF]" if s["is_etf"] else (" [INVALID]" if not is_finmind_valid(s["stock_id"]) else "")
        print(f"   {i:3d}. {s['stock_id']}{marker}")

    results: dict[str, Any] = {
        "date": run_date.isoformat(),
        "stocks_in_batch": len(batch),
        "finmind_valid": len(finmind_valid),
        "invalid_skipped": len(stock_ids) - len(finmind_valid),
        "datasets": {},
    }

    price_start = run_date - timedelta(days=PRICE_LOOKBACK_DAYS)
    day_iso = run_date.isoformat()

    print(f"\n{'─'*60}")
    print(f"🔄 開始下載資料集...")
    print(f"{'─'*60}")

    # ── Primary: TWSE for ALL stocks' latest prices (no rate limit) ──
    twse_date = None
    try:
        print(f"   [1a/4] 從 TWSE 取得所有股票最新股價...")
        n_twse, twse_date = update_daily_prices_from_twse(db)
        print(f"   ✅ TWSE 股價完成: {n_twse} 筆記錄 (日期: {twse_date})")
    except Exception as e:
        print(f"   ⚠️ TWSE 股價失敗，將以 FinMind 處理: {e}")
        log.warning("scheduler.twse_price_failed", error=str(e))

    # ── Fallback: FinMind for today's batch stocks TWSE didn't cover ──
    finmind_needed = []
    if twse_date:
        with db.connection() as conn:
            for sid in finmind_valid:
                row = conn.execute(
                    "SELECT 1 FROM daily_prices WHERE stock_id = ? AND trade_date = ?",
                    [sid, twse_date]
                ).fetchone()
                if not row:
                    finmind_needed.append(sid)
    else:
        finmind_needed = finmind_valid

    if finmind_needed:
        try:
            print(f"   [1b/4] 從 FinMind 補下載 {len(finmind_needed)} 檔股票股價...")
            n = update_daily_prices(db, client, finmind_needed, price_start, run_date)
            results["datasets"]["price"] = (results["datasets"].get("price", 0) or 0) + n
            print(f"   ✅ FinMind 股價完成: {n} 筆記錄")
        except Exception as e:
            print(f"   ❌ FinMind 股價失敗: {e}")
            log.error("scheduler.finmind_price_failed", error=str(e))
    else:
        print(f"   ℹ️ 所有 TWSE 股票已更新，無需 FinMind 補下載")

    try:
        print(f"   [2/4] 下載本益比 (per) for {len(finmind_valid)} 檔股票...")
        n = update_valuations(db, client, finmind_valid, "2022-01-01", day_iso)
        results["datasets"]["per"] = n
        print(f"   ✅ 本益比完成: {n} 筆記錄")
    except Exception as e:
        print(f"   ❌ 本益比失敗: {e}")
        log.error("scheduler.dataset_failed", dataset="per", error=str(e))
        results["datasets"]["per"] = 0

    try:
        print(f"   [3/4] 下載月營收 (revenue) for {len(stock_ids_only)} 檔股票...")
        n = update_monthly_revenue(db, client, stock_ids_only, REVENUE_START, day_iso)
        results["datasets"]["revenue"] = n
        print(f"   ✅ 月營收完成: {n} 筆記錄")
    except Exception as e:
        print(f"   ❌ 月營收失敗: {e}")
        log.error("scheduler.dataset_failed", dataset="revenue", error=str(e))
        results["datasets"]["revenue"] = 0

    try:
        print(f"   [4/4] 下載財報 (financials) for {len(stock_ids_only)} 檔股票...")
        n = update_financials(db, client, stock_ids_only, FINANCIAL_START, day_iso)
        results["datasets"]["financials"] = n
        print(f"   ✅ 財報完成: {n} 筆記錄")
    except Exception as e:
        print(f"   ❌ 財報失敗: {e}")
        log.error("scheduler.dataset_failed", dataset="financials", error=str(e))
        results["datasets"]["financials"] = 0

    n_ok_price = results["datasets"].get("price", 0) > 0
    n_ok_per = results["datasets"].get("per", 0) > 0
    n_ok_fin = results["datasets"].get("financials", 0) > 0
    n_ok_rev = results["datasets"].get("revenue", 0) > 0

    print(f"\n{'─'*60}")
    print(f"🔧 更新 ingestion_tracker 狀態...")
    print(f"{'─'*60}")

    ok_count = 0
    fail_count = 0
    skip_count = 0

    for s in batch:
        sid = s["stock_id"]
        is_etf = s["is_etf"]
        if is_etf:
            status = "ok" if n_ok_price and n_ok_per else "failed"
        elif is_finmind_valid(sid):
            status = "ok" if n_ok_price and n_ok_per and n_ok_fin and n_ok_rev else "failed"
        else:
            _update_tracker(db, sid, "price", "skipped", "invalid_id")
            skip_count += 1
            continue
        for ds in (["price", "per"] if is_etf else DATASETS):
            _update_tracker(db, sid, ds, status)
        if status == "ok":
            ok_count += 1
        else:
            fail_count += 1

    print(f"\n{'='*60}")
    print(f"📊 執行完成:")
    print(f"   日期: {run_date.isoformat()}")
    print(f"   成功: {ok_count} 檔")
    print(f"   失敗: {fail_count} 檔")
    print(f"   跳過: {skip_count} 檔")
    print(f"   資料集:")
    for ds, n in results["datasets"].items():
        print(f"     - {ds}: {n} 筆記錄")
    print(f"{'='*60}\n")

    log.info("scheduler.daily_complete",
             date=run_date.isoformat(),
             stocks=len(stock_ids_only),
             etfs=len(etf_ids),
             valid=len(finmind_valid),
             skipped=len(stock_ids) - len(finmind_valid),
             ok_count=ok_count,
             fail_count=fail_count,
             datasets={k: v for k, v in results["datasets"].items() if v})

    return results