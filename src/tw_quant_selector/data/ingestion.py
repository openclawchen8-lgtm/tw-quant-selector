from datetime import date, datetime, timedelta
from typing import Any
import numpy as np
import pandas as pd
import structlog

from tw_quant_selector.data.database import Database
from tw_quant_selector.data.finmind_client import FinMindClient
from tw_quant_selector.data.twstock_client import fetch_twse_daily_prices_all

log = structlog.get_logger()

FINANCIAL_TYPE_MAP = {
    "Revenue": "revenue",
    "GrossProfit": "gross_profit",
    "OperatingIncome": "operating_income",
    "IncomeAfterTaxes": "net_income",
    "EPS": "eps",
    "CostOfGoodsSold": "cost_of_goods_sold",
    "OperatingExpenses": "operating_expenses",
}

BALANCE_SHEET_TYPE_MAP = {
    "EquityAttributableToOwnersOfParent": "equity",
    "Liabilities": "liabilities",
    "TotalAssets": "total_assets",
}

PRICE_COLUMNS = {
    "stock_id": "stock_id", "date": "trade_date", "open": "open",
    "max": "high", "min": "low", "close": "close",
    "Trading_Volume": "volume", "Trading_money": "amount",
}

VALUATION_COLUMNS = {
    "stock_id": "stock_id", "date": "trade_date",
    "PER": "pe_ratio", "PBR": "pb_ratio", "dividend_yield": "dividend_yield",
}

REVENUE_COLUMNS = {
    "stock_id": "stock_id", "revenue_month": "year_month",
    "revenue": "revenue", "date": "announcement_date",
}


def _clean_nan(v):
    if isinstance(v, float) and np.isnan(v):
        return None
    return v

def _upsert(conn, table: str, rows: list[dict], pk_cols: list[str]):
    if not rows:
        return 0
    cols = list(rows[0].keys())
    placeholders = ", ".join("?" for _ in cols)
    col_names = ", ".join(cols)
    pk_condition = " AND ".join(f"{c} = ?" for c in pk_cols)
    count = 0
    for row in rows:
        vals = [_clean_nan(row.get(c)) for c in cols]
        pk_vals = [row.get(c) for c in pk_cols]
        conn.execute(f"DELETE FROM {table} WHERE {pk_condition}", pk_vals)
        conn.execute(f"INSERT INTO {table} ({col_names}) VALUES ({placeholders})", vals)
        count += 1
    conn.commit()
    return count


def _date_to_year_quarter(d: str) -> str:
    dt = pd.Timestamp(d)
    return f"{dt.year}Q{(dt.month - 1) // 3 + 1}"


def _estimate_announcement_date(d: str) -> str:
    dt = pd.Timestamp(d)
    month = dt.month
    if month <= 3:
        offset = 75
    elif month <= 6:
        offset = 45
    elif month <= 9:
        offset = 45
    else:
        offset = 75
    return (dt + pd.Timedelta(days=offset)).strftime("%Y-%m-%d")


def _pivot_financials(rows: list[dict]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df = df[df["type"].isin(FINANCIAL_TYPE_MAP)]
    if df.empty:
        return pd.DataFrame()
    df["column"] = df["type"].map(FINANCIAL_TYPE_MAP)
    pivoted = df.pivot_table(
        index=["stock_id", "date"],
        columns="column",
        values="value",
        aggfunc="first",
    ).reset_index()
    pivoted.columns.name = None

    # Ensure all columns exist
    for col in FINANCIAL_TYPE_MAP.values():
        if col not in pivoted.columns:
            pivoted[col] = np.nan

    pivoted["year_quarter"] = pivoted["date"].apply(_date_to_year_quarter)
    pivoted["announcement_date"] = pivoted["date"].apply(_estimate_announcement_date)
    if "revenue" in pivoted.columns and pivoted["revenue"].notna().any():
        if "gross_profit" in pivoted.columns:
            pivoted["gross_margin"] = pivoted["gross_profit"] / pivoted["revenue"].replace(0, np.nan)
        if "operating_income" in pivoted.columns:
            pivoted["operating_margin"] = pivoted["operating_income"] / pivoted["revenue"].replace(0, np.nan)
    else:
        pivoted["gross_margin"] = np.nan
        pivoted["operating_margin"] = np.nan
    return pivoted


def _pivot_balance_sheet(rows: list[dict]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df = df[df["type"].isin(BALANCE_SHEET_TYPE_MAP)]
    if df.empty:
        return pd.DataFrame()
    df["column"] = df["type"].map(BALANCE_SHEET_TYPE_MAP)
    pivoted = df.pivot_table(
        index=["stock_id", "date"],
        columns="column",
        values="value",
        aggfunc="first",
    ).reset_index()
    pivoted.columns.name = None

    # Ensure all columns exist
    for col in BALANCE_SHEET_TYPE_MAP.values():
        if col not in pivoted.columns:
            pivoted[col] = np.nan

    return pivoted


def update_daily_prices(db: Database, client: FinMindClient, stock_ids: list[str], start: date, end: date):
    total = 0
    with db.connection() as conn:
        for sid in stock_ids:
            raw = client.get_daily_prices(sid, start, end)
            rows = [{PRICE_COLUMNS.get(k, k): v for k, v in r.items() if k in PRICE_COLUMNS} for r in raw]
            total += _upsert(conn, "daily_prices", rows, ["stock_id", "trade_date"])
    log.info("ingestion.daily_prices", stocks=len(stock_ids), rows=total)
    return total


def update_daily_prices_from_twse(db: Database) -> tuple[int, str]:
    """Update daily_prices using TWSE STOCK_DAY_ALL as primary source.
    
    Returns (rows_written, trade_date_iso).
    Falls back to nothing — caller should use FinMind for stocks not in TWSE.
    """
    rows = fetch_twse_daily_prices_all()
    if not rows:
        return 0, ""
    trade_date = rows[0]["trade_date"]
    with db.connection() as conn:
        n = _upsert(conn, "daily_prices", rows, ["stock_id", "trade_date"])
        conn.commit()
    log.info("ingestion.daily_prices.twse", rows=n, date=trade_date)
    return n, trade_date


def update_valuations(db: Database, client: FinMindClient, stock_ids: list[str], start: str, end: str):
    total = 0
    with db.connection() as conn:
        for sid in stock_ids:
            raw = client.get_per_pbr(sid, start, end)
            rows = [{VALUATION_COLUMNS.get(k, k): v for k, v in r.items() if k in VALUATION_COLUMNS} for r in raw]
            total += _upsert(conn, "valuations", rows, ["stock_id", "trade_date"])
    log.info("ingestion.valuations", stocks=len(stock_ids), rows=total)
    return total


def update_monthly_revenue(db: Database, client: FinMindClient, stock_ids: list[str], start: str, end: str):
    total = 0
    with db.connection() as conn:
        for sid in stock_ids:
            raw = client.get_monthly_revenue(sid, start, end)
            rows = []
            for r in raw:
                row = {}
                for k, v in r.items():
                    target = {"year_month": "year_month"}.get(k, k)
                    row[target] = v
                rev_cols = {"stock_id", "revenue_month", "revenue", "date", "announcement_date"}
                row = {k: v for k, v in row.items() if k in rev_cols}
                if "year_month" not in row and "revenue_month" in r:
                    row["year_month"] = r["revenue_month"]
                if "announcement_date" not in row and "date" in r:
                    row["announcement_date"] = r["date"]
                rows.append(row)

            if rows:
                rev_df = pd.DataFrame(rows)
                rev_df["revenue"] = pd.to_numeric(rev_df["revenue"], errors="coerce")
                rev_df["year_month"] = rev_df["year_month"].astype(str)
                rev_df = rev_df.sort_values(["stock_id", "year_month"])
                rev_df["revenue_prev"] = rev_df.groupby("stock_id")["revenue"].shift(12)
                rev_df["revenue_yoy"] = (rev_df["revenue"] / rev_df["revenue_prev"]) - 1
                rev_df = rev_df[rev_df["revenue_yoy"].notna()]
                result = rev_df[["stock_id", "year_month", "revenue", "revenue_yoy", "announcement_date"]].to_dict("records")
                total += _upsert(conn, "monthly_revenue", result, ["stock_id", "year_month"])
    log.info("ingestion.monthly_revenue", stocks=len(stock_ids), rows=total)
    return total


def update_financials(db: Database, client: FinMindClient, stock_ids: list[str], start: str, end: str):
    total = 0
    with db.connection() as conn:
        for sid in stock_ids:
            fin_raw = client.get_financials(sid, start, end)
            bs_raw = client.get_balance_sheet(sid, start, end)

            fin_df = _pivot_financials(fin_raw)
            bs_df = _pivot_balance_sheet(bs_raw)

            if fin_df.empty:
                continue

            if not bs_df.empty:
                merged = fin_df.merge(
                    bs_df[["stock_id", "date", "equity", "liabilities", "total_assets"]],
                    on=["stock_id", "date"], how="left"
                )
            else:
                merged = fin_df.copy()
                merged["equity"] = None
                merged["liabilities"] = None
                merged["total_assets"] = None

            for num, den, col in [
                ("net_income", "equity", "roe"),
                ("net_income", "total_assets", "roa"),
                ("liabilities", "equity", "debt_to_equity"),
            ]:
                if den in merged.columns and merged[den].notna().any():
                    merged[col] = merged[num] / merged[den].replace(0, pd.NA)
                else:
                    merged[col] = pd.NA

            out_cols = ["stock_id", "year_quarter", "revenue", "net_income", "eps",
                        "announcement_date"]
            for c in ["gross_profit", "operating_income", "roe", "roa",
                       "gross_margin", "operating_margin", "debt_to_equity"]:
                if c in merged.columns:
                    out_cols.append(c)
            result = merged[out_cols].to_dict("records")
            total += _upsert(conn, "financials", result, ["stock_id", "year_quarter"])
    log.info("ingestion.financials", stocks=len(stock_ids), rows=total)
    return total
