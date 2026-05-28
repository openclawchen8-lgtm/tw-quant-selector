from datetime import date, datetime, timezone
from typing import Any, Optional
import csv
import io
import os
import uuid
from pathlib import Path
from fastapi import FastAPI, Query, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from tw_quant_selector.data.database import Database
from tw_quant_selector.strategies.base import get_strategy_schemas, list_strategies
from tw_quant_selector.strategies.combiner import compute_composite_scores, DEFAULT_WEIGHTS
from tw_quant_selector.backtest.engine import run_backtest

app = FastAPI(title="tw-quant-selector", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
db = Database()


def api_response(data: Any, meta: dict[str, Any] | None = None, error: dict[str, Any] | None = None) -> dict:
    return {
        "data": data,
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_as_of": None,
            "request_id": str(uuid.uuid4()),
            **(meta or {}),
        },
        "error": error,
    }


class HealthResponse(BaseModel):
    status: str
    db_connected: bool
    last_update: Optional[str] = None


class SignalItem(BaseModel):
    stock_id: str
    name: Optional[str] = None
    score: float
    rank: int
    rank_change: Optional[int] = None
    consecutive_days: Optional[int] = None
    factor_scores: Optional[dict[str, float]] = None


class SignalResponse(BaseModel):
    date: str
    stocks: list[SignalItem]
    etfs: list[SignalItem]


class BacktestRequest(BaseModel):
    start_date: str
    end_date: Optional[str] = None
    strategy_weights: Optional[dict[str, float]] = None


class BacktestResponse(BaseModel):
    run_id: str
    status: str


class PortfolioAlertRequest(BaseModel):
    stock_id: str
    stock_name: str = ""
    pnl: float = 0
    pnl_pct: float = 0
    threshold_type: str = "percent"
    threshold_value: float = 0
    avg_cost: float = 0
    current_price: float = 0
    shares: int = 0
    alert_enabled: bool = True


class DataStatusResponse(BaseModel):
    last_price_update: Optional[str] = None
    missing_dates: list[str] = []
    coverage: dict = {}


class AlertSettingsItem(BaseModel):
    key: str
    value: Optional[str] = None
    is_env_set: bool = False
    is_sensitive: bool = False


ALERT_KEYS = [
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
    "SMTP_SERVER", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD",
    "EMAIL_SENDER", "EMAIL_RECIPIENT",
    "PL_THRESHOLD", "PL_PERCENT_THRESHOLD"
]
SENSITIVE_KEYS = ["TELEGRAM_BOT_TOKEN", "SMTP_PASSWORD"]


@app.get("/api/v1/settings/alerts")
def get_alert_settings():
    db_settings = {r[0]: r[1] for r in db.execute("SELECT key, value FROM alert_settings").fetchall()}
    results = []
    for k in ALERT_KEYS:
        env_val = os.getenv(k)
        is_env = env_val is not None
        val = env_val if is_env else db_settings.get(k)
        is_sensitive = k in SENSITIVE_KEYS
        
        display_val = val
        if is_sensitive and val:
            display_val = "********"
            
        results.append(AlertSettingsItem(
            key=k,
            value=display_val,
            is_env_set=is_env,
            is_sensitive=is_sensitive
        ))
    return api_response(results)


@app.post("/api/v1/settings/alerts")
def update_alert_settings(settings: dict[str, str]):
    with db.connection() as conn:
        for k, v in settings.items():
            if k not in ALERT_KEYS:
                continue
            # Skip if set by env
            if os.getenv(k) is not None:
                continue
            
            is_sensitive = k in SENSITIVE_KEYS
            conn.execute(
                "INSERT INTO alert_settings (key, value, is_sensitive, updated_at) VALUES (?, ?, ?, now()) "
                "ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()",
                [k, v, is_sensitive]
            )
        conn.commit()
    return api_response({"status": "updated"})


@app.post("/api/v1/settings/test-alert")
def test_alert():
    from tw_quant_selector.monitoring.alerting import AlertManager
    manager = AlertManager(db)
    try:
        manager.send_notification(
            "[tw-quant-selector] 測試告警",
            "這是一封測試告警郵件/訊息，如果您收到此訊息，表示設定正確。"
        )
        return api_response({"status": "sent"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/portfolio/alert")
def portfolio_alert(req: PortfolioAlertRequest):
    from tw_quant_selector.monitoring.alerting import AlertManager
    manager = AlertManager(db)
    result = manager.handle_pl_alert(req.model_dump())
    return api_response(result)


@app.get("/api/v1/settings/db-path")
def get_db_path():
    return api_response({
        "path": db.db_path,
        "is_env_set": os.getenv("DUCKDB_PATH") is not None
    })


@app.post("/api/v1/settings/db-path")
def update_db_path(data: dict[str, str]):
    new_path = data.get("path")
    if not new_path:
        raise HTTPException(400, "Path is required")
    try:
        updated_path = db.change_path(new_path)
        return api_response({"path": updated_path})
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/health")
def health():
    db_ok = True
    last = None
    try:
        row = db.execute("SELECT MAX(trade_date) FROM daily_prices").fetchone()
        if row and row[0]:
            last = row[0].isoformat()
    except Exception:
        db_ok = False
    return api_response(HealthResponse(status="ok", db_connected=db_ok, last_update=last).model_dump())


@app.get("/")
def root_redirect():
    return RedirectResponse(url="/docs")


@app.get("/api/v1/dashboard")
def dashboard_data():
    from datetime import date
    stats = {}
    for t in ["stocks", "daily_prices", "valuations", "monthly_revenue", "financials", "signals", "backtest_runs"]:
        n = db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()
        stats[t] = n[0] if n else 0
    price_range = db.execute("SELECT MIN(trade_date), MAX(trade_date) FROM daily_prices").fetchone()
    val_range = db.execute("SELECT MIN(trade_date), MAX(trade_date) FROM valuations").fetchone()
    tracker = db.execute(
        "SELECT dataset, last_status, COUNT(*) FROM ingestion_tracker WHERE last_updated IS NOT NULL GROUP BY dataset, last_status"
    ).fetchall()
    top_volume = db.execute(
        """SELECT stock_id, COUNT(*) as days FROM daily_prices
           GROUP BY stock_id ORDER BY days DESC LIMIT 10"""
    ).fetchall()
    return api_response({
        "table_counts": stats,
        "price_date_range": {"min": str(price_range[0]) if price_range and price_range[0] else None,
                             "max": str(price_range[1]) if price_range and price_range[1] else None},
        "val_date_range": {"min": str(val_range[0]) if val_range and val_range[0] else None,
                           "max": str(val_range[1]) if val_range and val_range[1] else None},
        "tracker": [{"dataset": r[0], "status": r[1], "count": r[2]} for r in tracker],
        "top_stocks": [{"stock_id": r[0], "days": r[1]} for r in top_volume],
    })


@app.get("/api/v1/stocks/by_dataset/{dataset}")
def stocks_by_dataset(dataset: str):
    mapping = {
        "daily_prices": "daily_prices",
        "valuations": "valuations",
        "monthly_revenue": "monthly_revenue",
        "financials": "financials",
    }
    tbl = mapping.get(dataset)
    if not tbl:
        raise HTTPException(400, f"Unknown dataset: {dataset}")
    rows = db.execute(
        f"SELECT s.stock_id, s.stock_name, s.market, COUNT(*) as cnt FROM {tbl} t JOIN stocks s ON s.stock_id = t.stock_id GROUP BY s.stock_id, s.stock_name, s.market ORDER BY cnt DESC LIMIT 100"
    ).fetchall()
    return api_response([{"stock_id": r[0], "name": r[1], "market": r[2], "count": r[3]} for r in rows])


@app.get("/api/v1/stocks/search")
def search_stocks(q: str = Query("", min_length=1)):
    like = f"%{q}%"
    rows = db.execute(
        "SELECT stock_id, stock_name, market, is_etf, industry FROM stocks WHERE stock_id LIKE ? OR stock_name LIKE ? LIMIT 20",
        [like, like]
    ).fetchall()
    return api_response([{"stock_id": r[0], "name": r[1], "market": r[2], "is_etf": bool(r[3]), "industry": r[4]} for r in rows])


@app.get("/api/v1/stocks/prices")
def stocks_prices(ids: str = Query(...)):
    stock_ids = [s.strip() for s in ids.split(",") if s.strip()]
    if not stock_ids:
        raise HTTPException(400, "No stock IDs provided")
    placeholders = ",".join(["?"] * len(stock_ids))
    rows = db.execute(
        f"SELECT dp.stock_id, s.stock_name, dp.close, dp.trade_date FROM daily_prices dp JOIN stocks s ON s.stock_id = dp.stock_id WHERE dp.stock_id IN ({placeholders}) AND dp.trade_date = (SELECT MAX(trade_date) FROM daily_prices WHERE stock_id = dp.stock_id)",
        stock_ids
    ).fetchall()
    result = {}
    for r in rows:
        result[r[0]] = {"name": r[1], "close": float(r[2]) if r[2] else None, "date": str(r[3]) if r[3] else None}
    return api_response(result)


@app.get("/api/v1/stock/{stock_id}")
def stock_detail(stock_id: str):
    info = db.execute("SELECT stock_id, stock_name, market, is_etf, industry FROM stocks WHERE stock_id = ?", [stock_id]).fetchone()
    if not info:
        raise HTTPException(404, "Stock not found")
    prices = db.execute(
        "SELECT trade_date, open, high, low, close, volume FROM daily_prices WHERE stock_id = ? ORDER BY trade_date DESC LIMIT 120",
        [stock_id]
    ).fetchall()
    vals = db.execute(
        "SELECT trade_date, pe_ratio, pb_ratio, dividend_yield FROM valuations WHERE stock_id = ? ORDER BY trade_date DESC LIMIT 10",
        [stock_id]
    ).fetchall()
    fins = db.execute(
        "SELECT year_quarter, revenue, eps, roe, gross_margin, debt_to_equity FROM financials WHERE stock_id = ? ORDER BY year_quarter DESC LIMIT 8",
        [stock_id]
    ).fetchall()
    revs = db.execute(
        "SELECT year_month, revenue, revenue_yoy FROM monthly_revenue WHERE stock_id = ? ORDER BY year_month DESC LIMIT 12",
        [stock_id]
    ).fetchall()
    return api_response({
        "info": {"stock_id": info[0], "name": info[1], "market": info[2], "is_etf": info[3], "industry": info[4]},
        "prices": [{"d": str(r[0]), "o": float(r[1]) if r[1] else None, "h": float(r[2]) if r[2] else None,
                    "l": float(r[3]) if r[3] else None, "c": float(r[4]) if r[4] else None, "v": r[5]} for r in prices],
        "valuations": [{"d": str(r[0]), "pe": float(r[1]) if r[1] else None, "pb": float(r[2]) if r[2] else None,
                        "dy": float(r[3]) if r[3] else None} for r in vals],
        "financials": [{"yq": r[0], "rev": r[1], "eps": float(r[2]) if r[2] else None,
                        "roe": float(r[3]) if r[3] else None, "gm": float(r[4]) if r[4] else None,
                        "de": float(r[5]) if r[5] else None} for r in fins],
        "revenue": [{"ym": r[0], "rev": r[1], "yoy": float(r[2]) if r[2] else None} for r in revs],
    })


@app.get("/api/v1/stock/{stock_id}/factor-history")
def stock_factor_history(stock_id: str):
    rows = db.execute(
        """SELECT signal_date, strategy, score, rank
           FROM signals WHERE stock_id = ? ORDER BY signal_date DESC LIMIT 52""",
        [stock_id]
    ).fetchall()
    return api_response([{
        "date": str(r[0]), "strategy": r[1], "score": float(r[2]) if r[2] else None,
        "rank": r[3] or 0,
    } for r in rows])


@app.get("/api/v1/monitor/datasets")
def monitor_datasets():
    rows = db.execute(
        """SELECT dataset, last_status, COUNT(*) as cnt,
                  MAX(last_updated) as last_upd
           FROM ingestion_tracker
           WHERE last_updated IS NOT NULL
           GROUP BY dataset, last_status"""
    ).fetchall()
    return api_response([{
        "dataset": r[0], "status": r[1], "count": r[2],
        "last_updated": str(r[3]) if r[3] else None,
    } for r in rows])


@app.get("/api/v1/monitor/logs")
def monitor_logs():
    rows = db.execute(
        """SELECT id, module, event, severity, created_at
           FROM operation_logs WHERE created_at >= CURRENT_DATE - 7
           ORDER BY created_at DESC LIMIT 100"""
    ).fetchall()
    return api_response([{
        "id": r[0], "module": r[1], "event": r[2],
        "severity": r[3], "timestamp": str(r[4]) if r[4] else None,
    } for r in rows])


@app.get("/api/v1/signals/export.csv")
def export_signals_csv(
    date: Optional[str] = Query(None),
    strategy: str = Query("composite"),
    top_n: int = Query(200, ge=1, le=500),
):
    sd = date
    if not sd:
        row = db.execute("SELECT MAX(signal_date) FROM signals WHERE strategy = ?", [strategy]).fetchone()
        if row and row[0]:
            sd = str(row[0])
    items = []
    if sd:
        rows = db.execute(
            """SELECT s.stock_id, st.stock_name, s.score, s.rank
               FROM signals s LEFT JOIN stocks st ON s.stock_id = st.stock_id
               WHERE s.signal_date = ? AND s.strategy = ?
               ORDER BY s.rank LIMIT ?""",
            [sd, strategy, top_n]
        ).fetchall()
        for r in rows:
            items.append({"stock_id": r[0], "name": r[1] or "", "score": f"{float(r[2]):.4f}" if r[2] else "", "rank": r[3] or 0})
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=["rank", "stock_id", "name", "score"])
    writer.writeheader()
    writer.writerows(items)
    fname = f"tw_signals_{sd.replace('-', '')}.csv" if sd else "tw_signals.csv"
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={fname}"})


@app.get("/api/v1/signals/export.json")
def export_signals_json(
    date: Optional[str] = Query(None),
    strategy: str = Query("composite"),
    top_n: int = Query(200, ge=1, le=500),
):
    sd = date
    if not sd:
        row = db.execute("SELECT MAX(signal_date) FROM signals WHERE strategy = ?", [strategy]).fetchone()
        if row and row[0]:
            sd = str(row[0])
    items = []
    if sd:
        rows = db.execute(
            """SELECT s.stock_id, st.stock_name, s.score, s.rank
               FROM signals s LEFT JOIN stocks st ON s.stock_id = st.stock_id
               WHERE s.signal_date = ? AND s.strategy = ?
               ORDER BY s.rank LIMIT ?""",
            [sd, strategy, top_n]
        ).fetchall()
        for r in rows:
            items.append({"stock_id": r[0], "name": r[1] or "", "score": float(r[2]) if r[2] else None, "rank": r[3] or 0})
    return api_response({"signals": items, "date": sd, "strategy": strategy})


@app.get("/api/v1/backtest/{run_id}/detail")
def get_backtest_detail(run_id: str):
    row = db.execute("SELECT * FROM backtest_runs WHERE run_id = ?", [run_id]).fetchone()
    if not row:
        raise HTTPException(404, "Backtest run not found")
    return api_response({
        "run_id": run_id,
        "created_at": str(row[1]) if row[1] else None,
        "start_date": str(row[2]) if row[2] else None,
        "end_date": str(row[3]) if row[3] else None,
        "metrics": {
            "total_return": float(row[6]) if row[6] else None,
            "cagr": float(row[7]) if row[7] else None,
            "sharpe": float(row[8]) if row[8] else None,
            "max_drawdown": float(row[9]) if row[9] else None,
            "calmar": float(row[10]) if row[10] else None,
        },
    })


@app.get("/api/v1/backtest/{run_id}/equity")
def get_backtest_equity(run_id: str):
    rows = db.execute(
        "SELECT trade_date, portfolio_value, benchmark_value, drawdown FROM backtest_equity WHERE run_id = ? ORDER BY trade_date",
        [run_id]
    ).fetchall()
    return api_response([{
        "date": str(r[0]),
        "value": float(r[1]) if r[1] else None,
        "benchmark": float(r[2]) if r[2] else None,
        "drawdown": float(r[3]) if r[3] else None,
    } for r in rows])


@app.get("/api/v1/signals")
def signals_query(
    date: Optional[str] = Query(None),
    strategy: str = Query("composite"),
    top_n: int = Query(50, ge=1, le=200),
    include_etf: bool = Query(False),
):
    if date:
        signal_date = date
    else:
        row = db.execute("SELECT MAX(signal_date) FROM signals WHERE strategy = ?", [strategy]).fetchone()
        if not row or not row[0]:
            raise HTTPException(404, "No signals found")
        signal_date = row[0].isoformat() if hasattr(row[0], 'isoformat') else str(row[0])
    return api_response(_get_signals(signal_date, strategy, top_n, include_etf).model_dump())


@app.get("/api/v1/signals/calendar")
def signals_calendar():
    rows = db.execute(
        "SELECT DISTINCT signal_date FROM signals ORDER BY signal_date DESC LIMIT 365"
    ).fetchall()
    dates = [str(r[0]) for r in rows]
    return api_response(dates)


@app.get("/api/v1/signals/latest")
def latest_signals(
    strategy: str = Query("composite"),
    top_n: int = Query(20, ge=1, le=100),
    include_etf: bool = Query(False),
):
    latest = db.execute("SELECT MAX(signal_date) FROM signals WHERE strategy = ?", [strategy]).fetchone()
    if not latest or not latest[0]:
        raise HTTPException(404, "No signals found")
    return api_response(_get_signals(latest[0], strategy, top_n, include_etf).model_dump())


@app.get("/api/v1/signals/{signal_date}")
def signals_by_date(
    signal_date: date,
    strategy: str = Query("composite"),
    top_n: int = Query(20, ge=1, le=100),
    include_etf: bool = Query(False),
):
    return api_response(_get_signals(signal_date, strategy, top_n, include_etf).model_dump())


def _get_signals(signal_date: date, strategy: str, top_n: int, include_etf: bool) -> SignalResponse:
    prev_date = db.execute(
        "SELECT MAX(signal_date) FROM signals WHERE signal_date < ? AND strategy = ?",
        [signal_date, strategy]
    ).fetchone()
    prev = prev_date[0] if prev_date and prev_date[0] else None

    rows = db.execute(
        """SELECT s.stock_id, st.stock_name, s.score, s.rank,
                  m.score AS momentum, v.score AS value, q.score AS quality, g.score AS growth,
                  p.rank AS prev_rank
           FROM signals s
           LEFT JOIN stocks st ON s.stock_id = st.stock_id
           LEFT JOIN signals m ON m.signal_date = s.signal_date AND m.stock_id = s.stock_id AND m.strategy = 'momentum'
           LEFT JOIN signals v ON v.signal_date = s.signal_date AND v.stock_id = s.stock_id AND v.strategy = 'value'
           LEFT JOIN signals q ON q.signal_date = s.signal_date AND q.stock_id = s.stock_id AND q.strategy = 'quality'
           LEFT JOIN signals g ON g.signal_date = s.signal_date AND g.stock_id = s.stock_id AND g.strategy = 'growth'
           LEFT JOIN signals p ON p.signal_date = ? AND p.stock_id = s.stock_id AND p.strategy = s.strategy
           WHERE s.signal_date = ? AND s.strategy = ?
           ORDER BY s.rank LIMIT ?""",
        [prev, signal_date, strategy, top_n],
    ).fetchall()

    stocks = []
    etfs = []
    for r in rows:
        factor_scores = {}
        for i, k in enumerate(['momentum', 'value', 'quality', 'growth']):
            v = r[4 + i]
            if v is not None:
                factor_scores[k] = float(v)

        prev_rank = r[8]
        current_rank = r[3] or 0
        rank_change = (prev_rank - current_rank) if prev_rank is not None else None

        item = SignalItem(
            stock_id=r[0], name=r[1],
            score=float(r[2]) if r[2] else 0,
            rank=current_rank,
            rank_change=rank_change,
            factor_scores=factor_scores if factor_scores else None,
        )
        if r[0] in {"0050", "0051", "0052", "0056", "00878", "00881", "006208"}:
            etfs.append(item)
        else:
            stocks.append(item)
    if not include_etf:
        etfs = []
    return SignalResponse(date=signal_date.isoformat(), stocks=stocks[:top_n], etfs=etfs)


@app.post("/api/v1/backtest/run", response_model=BacktestResponse)
def start_backtest(req: BacktestRequest):
    run_id = str(uuid.uuid4())
    start = date.fromisoformat(req.start_date)
    end = date.fromisoformat(req.end_date) if req.end_date else None
    weights = req.strategy_weights or DEFAULT_WEIGHTS
    run_backtest(db, start, end, strategy_weights=weights)
    return api_response(BacktestResponse(run_id=run_id, status="completed").model_dump())


@app.get("/api/v1/backtest/history")
def backtest_history():
    rows = db.execute(
        """SELECT run_id, run_at, start_date, end_date, total_return, cagr, sharpe, max_drawdown
           FROM backtest_runs ORDER BY run_at DESC LIMIT 20"""
    ).fetchall()
    return api_response([{
        "run_id": r[0], "created_at": str(r[1]) if r[1] else None,
        "start_date": str(r[2]) if r[2] else None, "end_date": str(r[3]) if r[3] else None,
        "total_return": float(r[4]) if r[4] else None,
        "cagr": float(r[5]) if r[5] else None,
        "sharpe": float(r[6]) if r[6] else None,
        "max_drawdown": float(r[7]) if r[7] else None,
    } for r in rows])


@app.get("/api/v1/backtest/{run_id}")
def get_backtest(run_id: str):
    row = db.execute(
        "SELECT * FROM backtest_runs WHERE run_id = ?", [run_id]
    ).fetchone()
    if not row:
        raise HTTPException(404, "Backtest run not found")
    return api_response({"status": "completed", "run_id": run_id, "metrics": {
        "total_return": float(row[6]) if row[6] else None,
        "cagr": float(row[7]) if row[7] else None,
        "sharpe": float(row[8]) if row[8] else None,
        "max_drawdown": float(row[9]) if row[9] else None,
        "calmar": float(row[10]) if row[10] else None,
    }})


@app.get("/api/v1/data/status")
def data_status():
    latest_price = db.execute("SELECT MAX(trade_date) FROM daily_prices").fetchone()
    stock_count = db.execute("SELECT COUNT(*) FROM stocks").fetchone()
    return api_response({
        "last_price_update": latest_price[0].isoformat() if latest_price and latest_price[0] else None,
        "stock_count": stock_count[0] if stock_count else 0,
        "missing_dates": [],
        "coverage": {},
    })


@app.get("/api/v1/strategies/config")
def strategy_config():
    schemas = get_strategy_schemas()
    return api_response({
        "strategies": {
            name: {
                "params": {k: v["default"] for k, v in p.items()},
                "param_types": {k: v["type"] for k, v in p.items()},
            }
            for name, p in schemas.items()
        },
        "default_weights": DEFAULT_WEIGHTS,
        "universe_defaults": {
            "include_etf": False,
            "min_market_cap": 3_000_000_000,
            "exclude_financial": True,
            "top_n_stocks": 20,
            "top_n_etfs": 3,
        },
    })


class StrategyRunRequest(BaseModel):
    weights: Optional[dict[str, float]] = None
    strategy_params: Optional[dict[str, dict[str, Any]]] = None
    as_of_date: Optional[str] = None
    top_n_stocks: int = 20
    top_n_etfs: int = 3


@app.post("/api/v1/strategies/run")
def run_strategies(req: StrategyRunRequest):
    from datetime import date as d_date
    as_of = d_date.fromisoformat(req.as_of_date) if req.as_of_date else d_date.today()
    result = compute_composite_scores(
        db, as_of,
        weights=req.weights,
        strategy_params=req.strategy_params,
        top_n_stocks=req.top_n_stocks,
        top_n_etfs=req.top_n_etfs,
    )
    return api_response(result)


class PreviewRequest(StrategyRunRequest):
    holdings: list[dict] = []


@app.post("/api/v1/strategy/preview")
def strategy_preview(req: PreviewRequest):
    from datetime import date as d_date
    from tw_quant_selector.portfolio.preview import preview_impact
    as_of = d_date.fromisoformat(req.as_of_date) if req.as_of_date else d_date.today()
    result = preview_impact(
        db, as_of, req.holdings,
        weights=req.weights,
        strategy_params=req.strategy_params,
        top_n_stocks=req.top_n_stocks,
        top_n_etfs=req.top_n_etfs,
    )
    return api_response(result)


@app.get("/api/v1/strategy/correlation")
def strategy_correlation(as_of_date: str | None = None, lookback_days: int = 252):
    from tw_quant_selector.strategies.correlation import compute_factor_correlation
    from datetime import date as d_date
    as_of = d_date.fromisoformat(as_of_date) if as_of_date else d_date.today()
    matrix = compute_factor_correlation(db, as_of, lookback_days)
    return api_response({"matrix": matrix, "as_of_date": as_of.isoformat()})


class GuruConfigRequest(BaseModel):
    enabled: bool = False
    selected_guru: str = "buffett"
    guru_weight: float = 0.20


_guru_config: dict[str, Any] = {
    "enabled": False,
    "selected_guru": "buffett",
    "guru_weight": 0.20,
}


@app.get("/api/v1/strategy/guru-config")
def get_guru_config():
    from tw_quant_selector.strategies.guru_filters import list_guru_filters
    return api_response({
        **_guru_config,
        "available_gurus": list_guru_filters(),
        "default_5factor_weights": {
            "momentum": 0.25, "value": 0.20,
            "quality": 0.20, "growth": 0.15, "guru": 0.20,
        },
    })


@app.put("/api/v1/strategy/guru-config")
def update_guru_config(req: GuruConfigRequest):
    _guru_config.update({
        "enabled": req.enabled,
        "selected_guru": req.selected_guru,
        "guru_weight": req.guru_weight,
    })
    return api_response(_guru_config)


@app.post("/api/v1/strategy/run-guru-scoring")
def run_guru_scoring():
    from datetime import date as d_date
    from tw_quant_selector.strategies.guru_scoring import run_guru_scoring as _run_scoring
    count = _run_scoring(db, d_date.today())
    return api_response({"scored": count})


@app.get("/api/v1/strategy/config-history")
def config_history(limit: int = 10, offset: int = 0):
    rows = db.execute(
        """SELECT * FROM strategy_config_history ORDER BY changed_at DESC LIMIT ? OFFSET ?""",
        [limit, offset],
    ).fetchall()
    cols = [desc[0] for desc in db.description]
    return api_response([dict(zip(cols, r)) for r in rows])


class SaveConfigRequest(BaseModel):
    weights: dict[str, float] = {}
    advanced_params: dict[str, Any] = {}
    guru_config: dict[str, Any] = {}
    universe_config: dict[str, Any] = {}
    changed_by: str = "user"
    note: str = ""


@app.post("/api/v1/strategy/config-history")
def save_config(req: SaveConfigRequest):
    import json
    db.execute(
        """INSERT INTO strategy_config_history (weights, advanced_params, guru_config, universe_config, changed_by, note)
           VALUES (?, ?, ?, ?, ?, ?)""",
        [json.dumps(req.weights), json.dumps(req.advanced_params),
         json.dumps(req.guru_config), json.dumps(req.universe_config),
         req.changed_by, req.note],
    )
    return api_response({"saved": True})


@app.delete("/api/v1/strategy/config-history/{config_id}")
def delete_config(config_id: int):
    db.execute("DELETE FROM strategy_config_history WHERE config_id = ?", [config_id])
    return api_response({"deleted": True})


# ── Serve Built Frontend (Docker / production) ──
_frontend_dist = Path(__file__).resolve().parent.parent.parent.parent / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount("/assets", StaticFiles(directory=str(_frontend_dist / "assets")), name="frontend_assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("health") or full_path in ("docs", "redoc", "openapi.json"):
            from fastapi.responses import JSONResponse
            return JSONResponse({"error": {"code": 404, "message": "Not found"}}, status_code=404)
        index = _frontend_dist / "index.html"
        if index.exists():
            return HTMLResponse(index.read_text(encoding="utf-8"))
        return HTMLResponse("<h1>Frontend not built</h1>", status_code=200)


_DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tw-quant-selector</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;padding:24px}
h1{font-size:1.4rem;color:#38bdf8;cursor:pointer;display:inline-block}
h2{font-size:1.1rem;margin:20px 0 10px;color:#94a3b8}
.sub{color:#64748b;font-size:.85rem;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-bottom:20px}
.card{background:#1e293b;border-radius:10px;padding:16px;border:1px solid #334155}
.card .label{font-size:.8rem;color:#64748b}
.card .value{font-size:1.5rem;font-weight:700;margin-top:4px}
.value.green{color:#22c55e}.value.yellow{color:#eab308}.value.blue{color:#38bdf8}
.tabs{display:flex;gap:4px;margin:16px 0;border-bottom:2px solid #1e293b}
.tab{padding:8px 18px;cursor:pointer;border-radius:8px 8px 0 0;color:#64748b;font-size:.9rem;font-weight:600;transition:.15s}
.tab:hover{color:#e2e8f0;background:#1e293b}
.tab.active{color:#38bdf8;background:#1e293b;border-bottom:2px solid #38bdf8;margin-bottom:-2px}
.tab-pane{display:none}
.tab-pane.active{display:block}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{text-align:left;padding:8px 10px;border-bottom:2px solid #334155;color:#94a3b8;font-weight:600}
td{padding:6px 10px;border-bottom:1px solid #1e293b}
tr{cursor:pointer}tr:hover td{background:#1e293b}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.75rem;font-weight:600}
.badge.ok{background:#166534;color:#86efac}
.badge.failed{background:#7f1d1d;color:#fca5a5}
.badge.skipped{background:#713f12;color:#fde047}
.badge.running{background:#1e3a5f;color:#93c5fd}
.clickable{color:#38bdf8;text-decoration:underline;cursor:pointer}
.loading{color:#64748b;font-style:italic}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100}
.modal{display:none;position:fixed;top:5%;left:5%;right:5%;bottom:5%;background:#0f172a;border:1px solid #334155;border-radius:12px;z-index:101;overflow:auto;padding:24px}
.modal-close{float:right;background:none;border:none;color:#94a3b8;font-size:1.5rem;cursor:pointer}
.modal-close:hover{color:#fff}
canvas{width:100%;height:280px;background:#1e293b;border-radius:8px;margin:12px 0}
input.search,select.search{width:100%;padding:10px 14px;background:#1e293b;border:1px solid #334155;border-radius:8px;color:#e2e8f0;font-size:1rem;margin-bottom:16px;outline:none}
input.search:focus,select.search:focus{border-color:#38bdf8}
input[type=number]{width:100%;padding:8px 10px;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:.85rem;outline:none}
input[type=number]:focus{border-color:#38bdf8}
label{font-size:.8rem;color:#94a3b8;display:block;margin-bottom:2px}
.ctrl-row{align-items:center;display:flex;gap:16px;margin-bottom:12px}
.ctrl-row label{flex:0 0 120px;margin:0}
.ctrl-row input,.ctrl-row select{flex:1}
.ctrl-row .val-label{min-width:50px;text-align:right;color:#e2e8f0;font-weight:600;font-size:.85rem}
.btn{padding:10px 24px;border:none;border-radius:8px;font-size:.95rem;font-weight:600;cursor:pointer;transition:.15s;display:inline-flex;align-items:center;gap:6px}
.btn-primary{background:#0b6bcb;color:#fff}
.btn-primary:hover{background:#0954a0}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-success{background:#166534;color:#fff}
.btn-success:hover{background:#14532d}
.btn-warning{background:#92400e;color:#fff}
.btn-warning:hover{background:#78350f}
.section{border:1px solid #334155;border-radius:10px;padding:16px;margin-bottom:16px}
.section h3{font-size:.95rem;color:#e2e8f0;margin-bottom:10px}
input[type=range]{width:100%;-webkit-appearance:none;background:#1e293b;height:6px;border-radius:3px;outline:none}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#38bdf8;cursor:pointer}
.param-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
.result-table{max-height:500px;overflow-y:auto}
@media(max-width:640px){.grid{grid-template-columns:repeat(2,1fr)}body{padding:12px}.modal{top:2%;left:2%;right:2%;bottom:2%;padding:16px}.ctrl-row{flex-wrap:wrap;gap:6px}.ctrl-row label{flex:0 0 80px}}
</style>
</head>
<body>
<div class="modal-overlay" id="modal-overlay" onclick="closeModal()"></div>
<div class="modal" id="modal"><button class="modal-close" onclick="closeModal()">&times;</button><div id="modal-body">載入中...</div></div>

<h1 onclick="location.href='/'">tw-quant-selector</h1>
<p class="sub" id="sub">載入中...</p>

<div class="tabs">
  <div class="tab active" data-tab="dash" onclick="switchTab('dash')">📊 儀表板(Dashboard)</div>
  <div class="tab" data-tab="strategy" onclick="switchTab('strategy')">⚙️ 策略(Strategy)</div>
  <div class="tab" data-tab="backtest" onclick="switchTab('backtest')">📈 回測(Backtest)</div>
</div>

<!-- ══════ TAB 1: DASHBOARD ══════ -->
<div class="tab-pane active" id="tab-dash">
  <div class="grid" id="stats-grid"></div>
  <h2>🔍 查詢股票(Search)</h2>
  <input class="search" placeholder="輸入股號或名稱 (2330、台積電…)" oninput="searchStock(this.value)">
  <table><thead><tr><th>股號(ID)</th><th>名稱(Name)</th><th>市場(Market)</th><th>類型(Type)</th></tr></thead><tbody id="search-body"></tbody></table>
  <h2>📋 資料擷取(Ingestion Tracker)</h2>
  <table><thead><tr><th>資料集(Dataset)</th><th>狀態(Status)</th><th>筆數(Count)</th></tr></thead><tbody id="tracker-body"></tbody></table>
  <h2>🏆 最多資料的股票(Top Stocks)</h2>
  <table><thead><tr><th>股號(ID)</th><th>交易日數(Days)</th></tr></thead><tbody id="top-body"></tbody></table>
  <h2>📈 最新訊號(Latest Signals)</h2>
  <table><thead><tr><th>股號(ID)</th><th>名稱(Name)</th><th>分數(Score)</th><th>排名(Rank)</th></tr></thead><tbody id="signal-body"></tbody></table>
</div>

<!-- ══════ TAB 2: STRATEGY CONTROL ══════ -->
<div class="tab-pane" id="tab-strategy">
  <div class="section" id="strategy-weights-section"><h3>🏋️ 策略權重(Weights)</h3></div>
  <div class="section" id="strategy-params-section"><h3>🔧 策略參數(Parameters)</h3></div>
  <div class="section">
    <h3>📋 篩選條件(Universe Filters)</h3>
    <div class="ctrl-row"><label>納入ETF(Include ETF)</label>
      <select id="uf-include-etf"><option value="false">否(No)</option><option value="true">是(Yes)</option></select>
    </div>
    <div class="ctrl-row"><label>最低市值(Min Market Cap)(億)</label>
      <input type="number" id="uf-min-cap" value="30">
    </div>
    <div class="ctrl-row"><label>前N檔股票(Top N Stocks)</label>
      <input type="number" id="uf-top-stocks" value="20" min="1" max="100">
    </div>
    <div class="ctrl-row"><label>前N檔ETF(Top N ETFs)</label>
      <input type="number" id="uf-top-etfs" value="3" min="0" max="20">
    </div>
    <div class="ctrl-row"><label>評分日期(Score Date)</label>
      <input type="date" id="uf-as-of">
    </div>
    <div style="margin-top:16px">
      <button class="btn btn-primary" id="btn-run-strategy" onclick="runStrategy()">▶ 執行評分(Run)</button>
      <span id="run-status" style="margin-left:12px;color:#64748b;font-size:.85rem"></span>
    </div>
  </div>
  <div class="section" id="result-section" style="display:none">
    <h3>✅ 評分結果(Results)</h3>
    <div class="result-table" id="result-body"></div>
  </div>
</div>

<!-- ══════ TAB 3: BACKTEST ══════ -->
<div class="tab-pane" id="tab-backtest">
  <div class="section">
    <h3>📈 回測設定(Backtest Settings)</h3>
    <div class="ctrl-row"><label>開始日期(Start)</label><input type="date" id="bt-start"></div>
    <div class="ctrl-row"><label>結束日期(End)</label><input type="date" id="bt-end"></div>
    <div style="margin-top:16px">
      <button class="btn btn-warning" onclick="runBacktest()">▶ 執行回測(Run Backtest)</button>
      <span id="bt-status" style="margin-left:12px;color:#64748b;font-size:.85rem"></span>
    </div>
  </div>
  <div class="section" id="bt-result-section" style="display:none">
    <h3>📊 回測結果(Results)</h3>
    <div id="bt-result-body"></div>
  </div>
  <div class="section">
    <h3>📜 歷史回測(History)</h3>
    <table><thead><tr><th>回測ID(Run ID)</th><th>區間(Period)</th><th>報酬率(Return)</th><th>CAGR</th><th>Sharpe</th><th>最大回撤(Max DD)</th></tr></thead><tbody id="bt-history-body"></tbody></table>
  </div>
</div>

<script>
let config = {};
let latestResult = null;

// ── Tab switching ──
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-'+name));
}

// ── Modal ──
function openModal(html) {
  document.getElementById('modal-overlay').style.display = 'block';
  document.getElementById('modal').style.display = 'block';
  document.getElementById('modal-body').innerHTML = html;
}
function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('modal').style.display = 'none';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Stock search ──
let searchTimer = null;
async function searchStock(q) {
  clearTimeout(searchTimer);
  const tb = document.getElementById('search-body');
  if (!q || q.length < 1) { tb.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    const rows = await fetch('/api/v1/stocks/search?q='+encodeURIComponent(q)).then(r=>r.json());
    tb.innerHTML = rows.map(r =>
      `<tr onclick="openStock('${r.stock_id}')"><td class="clickable">${r.stock_id}</td><td>${r.name}</td><td>${r.market}</td><td>${r.is_etf?'ETF':'個股(Stock)'}</td></tr>`
    ).join('');
  }, 200);
}

async function openStock(sid) {
  openModal('<p class="loading">載入中...</p>');
  try {
    const d = await fetch('/api/v1/stock/'+sid).then(r=>r.json());
    const i = d.info;
    let html = `<h2>${i.name} (${i.stock_id}) <span class="badge ${i.is_etf?'ok':'skipped'}">${i.is_etf?'ETF':'個股(Stock)'}</span> ${i.market} ${i.industry||''}</h2>`;
    if (d.prices.length) html += `<canvas id="pc"></canvas>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">`;
    if (d.valuations.length) {
      html += `<div style="grid-column:1/-1"><h3>📊 本益比/淨值比(PE/PB)</h3><table><thead><tr><th>日期(Date)</th><th>PE</th><th>PB</th><th>殖利率(Dividend Yield)</th></tr></thead><tbody>`;
      for (const v of d.valuations) html += `<tr><td>${v.d}</td><td>${v.pe??'-'}</td><td>${v.pb??'-'}</td><td>${v.dy!=null?(v.dy*100).toFixed(2)+'%':'-'}</td></tr>`;
      html += `</tbody></table></div>`;
    }
    if (d.financials.length) {
      html += `<div style="grid-column:1/-1"><h3>💰 財報(Financials)</h3><table><thead><tr><th>季度(Quarter)</th><th>營收(Revenue)</th><th>EPS</th><th>ROE</th><th>毛利率(Gross Margin)</th><th>負債比(D/E)</th></tr></thead><tbody>`;
      for (const f of d.financials) html += `<tr><td>${f.yq}</td><td>${f.rev!=null?Number(f.rev).toLocaleString():'-'}</td><td>${f.eps??'-'}</td><td>${f.roe!=null?(f.roe*100).toFixed(2)+'%':'-'}</td><td>${f.gm!=null?(f.gm*100).toFixed(2)+'%':'-'}</td><td>${f.de!=null?f.de.toFixed(2):'-'}</td></tr>`;
      html += `</tbody></table></div>`;
    }
    if (d.revenue.length) {
      html += `<div style="grid-column:1/-1"><h3>📅 月營收(Monthly Revenue)</h3><table><thead><tr><th>月份(Month)</th><th>營收(Revenue)</th><th>年增率(YoY)</th></tr></thead><tbody>`;
      for (const r of d.revenue) html += `<tr><td>${r.ym}</td><td>${r.rev!=null?Number(r.rev).toLocaleString():'-'}</td><td>${r.yoy!=null?(r.yoy*100).toFixed(2)+'%':'-'}</td></tr>`;
      html += `</tbody></table></div>`;
    }
    html += `</div>`;
    document.getElementById('modal-body').innerHTML = html;
    if (d.prices.length) setTimeout(() => drawChart(d.prices.reverse()), 50);
  } catch(e) { document.getElementById('modal-body').innerHTML = '<p>❌ 查無此股票</p>'; }
}

function drawChart(prices) {
  const c = document.getElementById('pc'); if (!c) return;
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio||1;
  const rect = c.getBoundingClientRect();
  c.width = rect.width*dpr; c.height = rect.height*dpr;
  ctx.scale(dpr,dpr);
  const w=rect.width, h=rect.height, pad={t:20,r:16,b:30,l:50}, cw=w-pad.l-pad.r, ch=h-pad.t-pad.b;
  const cls = prices.map(p=>p.c).filter(x=>x!=null);
  if (!cls.length) return;
  const mn=Math.min(...cls), mx=Math.max(...cls), range=mx-mn||1;
  ctx.clearRect(0,0,w,h); ctx.strokeStyle='#38bdf8'; ctx.lineWidth=2; ctx.beginPath();
  prices.forEach((p,i)=>{const x=pad.l+(i/(prices.length-1||1))*cw, y=pad.t+(1-(p.c-mn)/range)*ch; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
  ctx.stroke();
  ctx.fillStyle='#64748b'; ctx.font='11px -apple-system, sans-serif'; ctx.textAlign='center';
  const step=Math.max(1,Math.floor(prices.length/8));
  prices.forEach((p,i)=>{if(i%step===0||i===prices.length-1)ctx.fillText(p.d.slice(5),pad.l+(i/(prices.length-1||1))*cw,h-6);});
  ctx.textAlign='right';
  for(let v=Math.floor(mn/10)*10;v<=mx;v+=Math.max(1,Math.round(range/4))){const y=pad.t+(1-(v-mn)/range)*ch;ctx.fillText(v.toFixed(0),pad.l-4,y+4);ctx.strokeStyle='#1e293b';ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();}
}

async function openDataset(ds) {
  openModal('<p class="loading">載入中...</p>');
  try {
    const rows = await fetch('/api/v1/stocks/by_dataset/'+ds).then(r=>r.json());
    const labels={daily_prices:'股價(Prices)',valuations:'本益比/淨值比(PE/PB)',monthly_revenue:'月營收(Revenue)',financials:'財報(Financials)'};
    let html=`<h2>📁 ${labels[ds]||ds}</h2><p>共(Total) <strong>${rows.length}</strong> 檔(stocks)有資料</p><table><thead><tr><th>股號(ID)</th><th>名稱(Name)</th><th>市場(Market)</th><th>筆數(Count)</th></tr></thead><tbody>`;
    for(const r of rows) html+=`<tr onclick="openStock('${r.stock_id}')"><td class="clickable">${r.stock_id}</td><td>${r.name}</td><td>${r.market}</td><td>${r.count}</td></tr>`;
    html+=`</tbody></table>`;
    document.getElementById('modal-body').innerHTML = html;
  } catch(e) { document.getElementById('modal-body').innerHTML = '<p>❌ 查詢失敗</p>'; }
}

// ── Dashboard load ──
async function loadDashboard() {
  const d = await fetch('/api/v1/dashboard').then(r=>r.json());
  const s = await fetch('/api/v1/signals/latest?include_etf=true').then(r=>r.json()).catch(()=>null);
  document.getElementById('sub').textContent =
    `  股價(Prices) ${d.price_date_range.min||'?'} ~ ${d.price_date_range.max||'?'} · 本益比(PE/PB) ${d.val_date_range.min||'?'} ~ ${d.val_date_range.max||'?'}`;
  const labels={stocks:'股票(Stocks)',daily_prices:'股價(Prices)',valuations:'本益比(PE/PB)',monthly_revenue:'月營收(Revenue)',financials:'財報(Financials)',signals:'訊號(Signals)',backtest_runs:'回測(Backtests)'};
  for(const[k,v]of Object.entries(d.table_counts)){
    const color=k==='stocks'?'blue':k==='daily_prices'?'green':'yellow';
    document.getElementById('stats-grid').innerHTML+=`<div class="card"><div class="label">${labels[k]||k}</div><div class="value ${color}">${v.toLocaleString()}</div></div>`;
  }
  const dsLabels={daily_prices:'股價(Prices)',valuations:'本益比/淨值比(PE/PB)',monthly_revenue:'月營收(Revenue)',financials:'財報(Financials)',signals:'訊號(Signals)'};
  for(const r of d.tracker)
    document.getElementById('tracker-body').innerHTML+=`<tr onclick="openDataset('${r.dataset}')"><td class="clickable">${dsLabels[r.dataset]||r.dataset}</td><td><span class="badge ${r.status}">${r.status=='ok'?'成功(OK)':r.status=='failed'?'失敗(Failed)':r.status=='skipped'?'略過(Skipped)':r.status}</span></td><td>${r.count}</td></tr>`;
  for(const r of d.top_stocks)
    document.getElementById('top-body').innerHTML+=`<tr onclick="openStock('${r.stock_id}')"><td class="clickable">${r.stock_id}</td><td>${r.days}天</td></tr>`;
  if(s) for(const item of[...s.stocks,...s.etfs])
    document.getElementById('signal-body').innerHTML+=`<tr onclick="openStock('${item.stock_id}')"><td class="clickable">${item.stock_id}</td><td>${item.name||'-'}</td><td>${item.score.toFixed(4)}</td><td>#${item.rank}</td></tr>`;
  else
    document.getElementById('signal-body').innerHTML='<tr><td colspan="4" class="loading">尚無訊號 — 執行策略評分後產生(No signals yet — run Strategy Scoring)</td></tr>';
}

const STRAT_LABELS = {
  momentum:'動能(Momentum)', value:'價值(Value)', quality:'品質(Quality)', growth:'成長(Growth)',
  lookback_long:'回看天數(Lookback Long)', lookback_short:'短天期(Lookback Short)', min_data_days:'最少天數(Min Data)',
  max_pb:'最高PB(Max PB)', max_pe:'最高PE(Max PE)', min_yield:'最低殖利率(Min Yield)',
  roe_weight:'ROE權重(ROE Weight)', leverage_weight:'槓桿權重(Leverage Weight)', stability_weight:'穩定性權重(Stability Weight)', lookback_quarters:'回看季度(Quarters)',
  rev_weight:'營收權重(Rev Weight)', eps_weight:'EPS權重(EPS Weight)', rev_months:'營收月數(Rev Months)',
};

// ── Strategy Control ──
async function loadStrategyConfig() {
  const c = await fetch('/api/v1/strategies/config').then(r=>r.json());
  config = c;
  const wsHtml = Object.entries(c.default_weights).map(([k,v]) =>
    `<div class="ctrl-row"><label>${STRAT_LABELS[k]||k}</label>
      <input type="range" min="0" max="100" value="${Math.round(v*100)}" id="w-${k}" oninput="updateWeightLabel('${k}')">
      <span class="val-label" id="wl-${k}">${(v*100).toFixed(0)}%</span></div>`
  ).join('');
  document.querySelector('#strategy-weights-section').innerHTML = `<h3>🏋️ 策略權重(Weights)</h3>${wsHtml}`;

  let paramsHtml = '';
  for (const [name, s] of Object.entries(c.strategies)) {
    paramsHtml += `<div style="margin-bottom:12px"><strong style="color:#38bdf8">${STRAT_LABELS[name]||name}</strong>`;
    paramsHtml += `<div class="param-grid">`;
    for (const [pn, pv] of Object.entries(s.params)) {
      const t = s.param_types[pn] || 'number';
      paramsHtml += `<div><label>${STRAT_LABELS[pn]||pn}</label><input type="${t==='number'?'number':'text'}" value="${pv}" id="sp-${name}-${pn}" style="width:100%"></div>`;
    }
    paramsHtml += `</div></div>`;
  }
  document.querySelector('#strategy-params-section').innerHTML = `<h3>🔧 策略參數(Parameters)</h3>${paramsHtml}`;

  // Set default date
  document.getElementById('uf-as-of').value = new Date().toISOString().slice(0,10);
}

function updateWeightLabel(name) {
  document.getElementById('wl-'+name).textContent = document.getElementById('w-'+name).value + '%';
}

async function runStrategy() {
  const btn = document.getElementById('btn-run-strategy');
  const status = document.getElementById('run-status');
  btn.disabled = true; status.textContent = '執行中(Running)...';
  try {
    const weights = {};
    for (const name of Object.keys(config.default_weights)) {
      weights[name] = parseInt(document.getElementById('w-'+name).value) / 100;
    }
    const strategyParams = {};
    for (const [name, s] of Object.entries(config.strategies)) {
      const p = {};
      for (const pn of Object.keys(s.params)) {
        const el = document.getElementById('sp-'+name+'-'+pn);
        const v = el.value;
        p[pn] = isNaN(Number(v)) ? v : Number(v);
      }
      strategyParams[name] = p;
    }
    const body = {
      weights,
      strategy_params: strategyParams,
      top_n_stocks: parseInt(document.getElementById('uf-top-stocks').value),
      top_n_etfs: parseInt(document.getElementById('uf-top-etfs').value),
      as_of_date: document.getElementById('uf-as-of').value || null,
    };
    const res = await fetch('/api/v1/strategies/run', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body),
    });
    if (!res.ok) { status.textContent = '❌ 失敗(Failed)'; return; }
    const data = await res.json();
    latestResult = data;
    status.innerHTML = '✅ 完成(Done) — 共(Total) ' + data.total_candidates + ' 檔候選(Candidates)';
    renderResult(data);
    // switch to result
    document.getElementById('result-section').style.display = 'block';
    document.getElementById('result-section').scrollIntoView({behavior:'smooth'});
  } catch(e) { status.textContent = '❌ '+e.message; }
  finally { btn.disabled = false; }
}

function renderResult(data) {
  const all = [...(data.stocks||[]), ...(data.etfs||[])];
  if (!all.length) { document.getElementById('result-body').innerHTML = '<p class="loading">無結果(No results)</p>'; return; }
  let html = `<p>評分日期(Score Date): ${data.date} · 總候選(Total Candidates): ${data.total_candidates}</p>`;
  html += `<table><thead><tr><th>股號(ID)</th><th>分數(Score)</th><th>排名(Rank)</th></tr></thead><tbody>`;
  for (const item of all) {
    html += `<tr onclick="openStock('${item.stock_id}')"><td class="clickable">${item.stock_id}</td><td>${item.score}</td><td>#${item.rank}</td></tr>`;
  }
  html += `</tbody></table>`;
  document.getElementById('result-body').innerHTML = html;
}

// ── Backtest ──
async function loadBacktest() {
  document.getElementById('bt-start').value = '2024-01-01';
  document.getElementById('bt-end').value = new Date().toISOString().slice(0,10);
  const rows = await fetch('/api/v1/backtest/history').then(r=>r.json()).catch(()=>[]);
  const tb = document.getElementById('bt-history-body');
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="6" class="loading">尚無回測紀錄(No backtest history)</td></tr>'; return; }
  for (const r of rows) {
    tb.innerHTML += `<tr onclick="openStock('${r.run_id}')"><td style="font-family:monospace;font-size:.75rem">${(r.run_id||'').slice(0,8)}</td>
      <td>${r.start_date||''}→${r.end_date||''}</td>
      <td>${r.total_return!=null?(r.total_return*100).toFixed(2)+'%':'-'}</td>
      <td>${r.cagr!=null?(r.cagr*100).toFixed(2)+'%':'-'}</td>
      <td>${r.sharpe!=null?r.sharpe.toFixed(2):'-'}</td>
      <td>${r.max_drawdown!=null?r.max_drawdown.toFixed(2)+'%':'-'}</td></tr>`;
  }
}

async function runBacktest() {
  const btn = document.querySelector('#tab-backtest .btn-warning');
  const status = document.getElementById('bt-status');
  btn.disabled = true; status.textContent = '執行回測中(Backtesting)...';
  try {
    const weights = {};
    for (const name of Object.keys(config.default_weights || DEFAULT_WEIGHTS)) {
      const el = document.getElementById('w-'+name);
      weights[name] = el ? parseInt(el.value)/100 : (config.default_weights||{})[name];
    }
    const res = await fetch('/api/v1/backtest/run', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        start_date: document.getElementById('bt-start').value,
        end_date: document.getElementById('bt-end').value || null,
        strategy_weights: weights,
      }),
    });
    if (!res.ok) { status.textContent = '❌ 回測失敗(Backtest Failed)'; return; }
    const data = await res.json();
    status.innerHTML = '✅ 回測完成(Done) — ID: ' + data.run_id.slice(0,8) + '...';
    loadBacktest();
  } catch(e) { status.textContent = '❌ '+e.message; }
  finally { btn.disabled = false; }
}

// ── Init ──
loadDashboard();
loadStrategyConfig().then(() => { /* wait */ });
loadBacktest();
</script>
</body>
</html>"""
