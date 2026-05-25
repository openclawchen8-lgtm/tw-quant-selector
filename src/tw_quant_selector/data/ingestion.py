from datetime import date, datetime
from typing import Any
import structlog

from tw_quant_selector.data.database import Database
from tw_quant_selector.data.finmind_client import FinMindClient

log = structlog.get_logger()


def _upsert(conn, table: str, rows: list[dict], column_map: dict[str, str], pk_cols: list[str]):
    if not rows:
        return 0
    mapped = []
    for r in rows:
        mapped.append({column_map.get(k, k): v for k, v in r.items() if k in column_map})
    cols = list(mapped[0].keys())
    placeholders = ", ".join(f"${i + 1}" for i in range(len(cols)))
    col_names = ", ".join(cols)
    pk_condition = " AND ".join(f"{c} = ${len(cols) + i + 1}" for i, c in enumerate(pk_cols))
    for row in mapped:
        vals = [row.get(c) for c in cols]
        pk_vals = [row.get(c) for c in pk_cols]
        conn.execute(f"DELETE FROM {table} WHERE {pk_condition}", pk_vals)
        conn.execute(f"INSERT INTO {table} ({col_names}) VALUES ({placeholders})", vals)
    conn.commit()
    return len(mapped)


PRICE_COLUMNS = {
    "stock_id": "stock_id", "date": "trade_date", "open": "open",
    "high": "high", "low": "low", "close": "close",
    "volume": "volume", "amount": "amount",
    "adjustment_factor": "adj_factor", "adjustment_close": "adj_close",
}

REVENUE_COLUMNS = {
    "stock_id": "stock_id", "year_month": "year_month",
    "revenue": "revenue", "revenue_yoy": "revenue_yoy",
    "announce_date": "announcement_date",
}

FINANCIAL_COLUMNS = {
    "stock_id": "stock_id", "year_quarter": "year_quarter",
    "revenue": "revenue", "gross_profit": "gross_profit",
    "operating_income": "operating_income", "net_income": "net_income",
    "eps": "eps", "roe": "roe", "roa": "roa",
    "gross_margin": "gross_margin", "operating_margin": "operating_margin",
    "debt_to_equity": "debt_to_equity",
    "announce_date": "announcement_date",
}


def update_daily_prices(db: Database, client: FinMindClient, stock_ids: list[str], start: date, end: date):
    total = 0
    with db.connection() as conn:
        for sid in stock_ids:
            rows = client.get_daily_prices(sid, start, end)
            total += _upsert(conn, "daily_prices", rows, PRICE_COLUMNS, ["stock_id", "trade_date"])
    log.info("ingestion.daily_prices", stocks=len(stock_ids), rows=total)
    return total


def update_monthly_revenue(db: Database, client: FinMindClient, stock_ids: list[str], start: str, end: str):
    total = 0
    with db.connection() as conn:
        for sid in stock_ids:
            rows = client.get_monthly_revenue(sid, start, end)
            total += _upsert(conn, "monthly_revenue", rows, REVENUE_COLUMNS, ["stock_id", "year_month"])
    log.info("ingestion.monthly_revenue", stocks=len(stock_ids), rows=total)
    return total


def update_financials(db: Database, client: FinMindClient, stock_ids: list[str], start: str, end: str):
    total = 0
    with db.connection() as conn:
        for sid in stock_ids:
            rows = client.get_financials(sid, start, end)
            total += _upsert(conn, "financials", rows, FINANCIAL_COLUMNS, ["stock_id", "year_quarter"])
    log.info("ingestion.financials", stocks=len(stock_ids), rows=total)
    return total
