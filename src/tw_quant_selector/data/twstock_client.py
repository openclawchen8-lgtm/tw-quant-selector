import re
import os
from typing import Literal

import warnings
import httpx
import structlog

try:
    import twstock

    _HAS_TWSTOCK = True
except ImportError:
    _HAS_TWSTOCK = False

from tw_quant_selector.data.database import Database

MarketScope = Literal["TWSE", "TPEX", "ALL"]

warnings.filterwarnings("ignore", message=".*SSL.*", module="tw_quant_selector.data.twstock_client")

log = structlog.get_logger()

# ─── Config & helpers ────────────────────────────────────────────────────────

TWSE_BASE = os.getenv("TWSE_BASE_URL", "https://openapi.twse.com.tw/v1")
TPEX_BASE = os.getenv("TPEX_BASE_URL", "https://www.tpex.org.tw/openapi/v1")
DEFAULT_MARKET_SCOPE = os.getenv("STOCK_MARKET_SCOPE", "TWSE").upper()

_ETF_CODE_RE = re.compile(r"^00\d{3,4}$")

_ROC_EPOCH = 1911


def _safe_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _safe_int(v) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None

# Keep only real investable securities; skip listed warrants / CBBCs / beneficiary securities.
KEEP_TYPES = frozenset({
    "股票", "ETF", "ETN", "特別股", "創新板",
    "臺灣存託憑證(TDR)",
    "受益證券-不動產投資信託",
    "受益證券-資產基礎證券",
})

# Regex for FinMind-compatible stock IDs. Supports letter suffixes.
_FINMIND_VALID_ID = re.compile(
    r"^\d{4}$|^00\d{3,4}$|^\d{5}[A-Z]?$|^\d{4}[A-Z]\d{0,2}$|^\d{6}[A-Z]?$"
)

_MARKET_MAP = {
    "上市": "TSE",
    "上市臺灣創新板": "TSE",
    "上櫃": "OTC",
}


def is_etf(stock_id: str) -> bool:
    return bool(_ETF_CODE_RE.match(stock_id))


def is_finmind_valid(stock_id: str) -> bool:
    return bool(_FINMIND_VALID_ID.match(stock_id))


# ─── TWSE: fetch from STOCK_DAY_ALL API ────────────────────────────────────

def _roc_to_ad(roc_date: str) -> str:
    """Convert ROC calendar date to AD date. e.g. '1150528' -> '2026-05-28'"""
    year = int(roc_date[:3]) + _ROC_EPOCH
    return f"{year}-{roc_date[3:5]}-{roc_date[5:7]}"


def _fetch_twse_codes() -> list[tuple[str, str]]:
    """Fetch all stock codes from TWSE STOCK_DAY_ALL API."""
    client = httpx.Client(timeout=30)
    try:
        resp = client.get(f"{TWSE_BASE}/exchangeReport/STOCK_DAY_ALL")
        resp.raise_for_status()
        rows = resp.json()
        results = []
        for r in rows:
            code = r.get("Code")
            name = r.get("Name", "")
            if code:
                results.append((str(code), str(name or code)))
        log.info("twstock_client.twse.fetched", count=len(results))
        return results
    finally:
        client.close()


def fetch_twse_daily_prices_all() -> list[dict]:
    """Fetch latest daily OHLCV data for all TWSE stocks from STOCK_DAY_ALL.
    
    Returns list of dicts with keys matching daily_prices table schema.
    Covers ~1089 regular stocks plus ETFs in a single API call.
    """
    client = httpx.Client(timeout=60)
    try:
        resp = client.get(f"{TWSE_BASE}/exchangeReport/STOCK_DAY_ALL")
        resp.raise_for_status()
        rows = resp.json()
        results = []
        for r in rows:
            code = r.get("Code", "")
            date_str = r.get("Date", "")
            if not code or not date_str:
                continue
            try:
                trade_date = _roc_to_ad(date_str)
            except (ValueError, IndexError):
                continue
            results.append({
                "stock_id": code,
                "trade_date": trade_date,
                "open": _safe_float(r.get("OpeningPrice")),
                "high": _safe_float(r.get("HighestPrice")),
                "low": _safe_float(r.get("LowestPrice")),
                "close": _safe_float(r.get("ClosingPrice")),
                "volume": _safe_int(r.get("TradeVolume")),
                "amount": _safe_float(r.get("TradeValue")),
            })
        log.info("twstock_client.daily_prices.fetched",
                 date=results[0]["trade_date"] if results else None,
                 count=len(results))
        return results
    finally:
        client.close()


# ─── TPEX: fetch from twstock.codes ─────────────────────────────────────────

def _fetch_tpex_codes() -> list[tuple[str, str]]:
    """
    Fetch TPEX stock list from twstock.codes.
    Returns list of (code, name) tuples.
    """
    if not _HAS_TWSTOCK:
        raise ImportError("twstock is not installed: pip install twstock")

    twstock.codes.update()

    kept = []
    for code, info in twstock.codes.items():
        if info.market != "上櫃":
            continue
        if info.type not in KEEP_TYPES:
            continue
        kept.append((str(code), str(info.name or code)))
    return kept


# ─── Main update function ────────────────────────────────────────────────────

def update_stock_list(db, *, scope: MarketScope | None = None) -> int:
    """
    Sync stock list into the stocks table.

    TWSE source : STOCK_DAY_ALL API → exact 1,361 codes (or whatever API returns)
    TPEX source : twstock.codes    → ~1,009 investable securities

    Args:
        db: Database instance.
        scope: "TWSE" (default), "TPEX", or "ALL".

    Returns:
        Number of stocks written.
    """
    scope = (scope or DEFAULT_MARKET_SCOPE or "TWSE").upper()
    if scope not in ("TWSE", "TPEX", "ALL"):
        raise ValueError(f"Invalid scope: {scope!r} (expected TWSE|TPEX|ALL)")

    log.info("twstock_client.update.start", scope=scope)

    count_written = 0

    with db.connection() as conn:
        # Always full-refresh: wipe then rebuild.
        conn.execute("DELETE FROM stocks")

        # ── TWSE: STOCK_DAY_ALL ─────────────────────────────────────────
        if scope in ("TWSE", "ALL"):
            twse_codes = _fetch_twse_codes()
            for sid, name in sorted(twse_codes, key=lambda x: x[0]):
                conn.execute(
                    """INSERT INTO stocks (stock_id, stock_name, market, is_etf)
                       VALUES (?, ?, ?, ?)
                       ON CONFLICT (stock_id) DO UPDATE SET
                          stock_name = excluded.stock_name,
                          market    = excluded.market,
                          is_etf    = excluded.is_etf""",
                    [sid, name, "TSE", is_etf(sid)],
                )
                count_written += 1
            log.info("twstock_client.twse.done", written=len(twse_codes))

        # ── TPEX: twstock.codes ─────────────────────────────────────────
        if scope in ("TPEX", "ALL"):
            tpex_rows = _fetch_tpex_codes()
            for sid, name in sorted(tpex_rows, key=lambda x: x[0]):
                conn.execute(
                    """INSERT INTO stocks (stock_id, stock_name, market, is_etf)
                       VALUES (?, ?, ?, ?)
                       ON CONFLICT (stock_id) DO UPDATE SET
                          stock_name = excluded.stock_name,
                          market    = excluded.market,
                          is_etf    = excluded.is_etf""",
                    [sid, name, "OTC", is_etf(sid)],
                )
                count_written += 1
            log.info("twstock_client.tpex.done", written=len(tpex_rows))

        conn.commit()

    log.info("twstock_client.update.done", scope=scope, written=count_written)
    return count_written