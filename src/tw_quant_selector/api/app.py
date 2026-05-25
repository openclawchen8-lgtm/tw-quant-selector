from datetime import date, datetime
from typing import Optional
import uuid
from fastapi import FastAPI, Query, HTTPException
from pydantic import BaseModel

from tw_quant_selector.data.database import Database
from tw_quant_selector.strategies.combiner import compute_composite_scores, DEFAULT_WEIGHTS
from tw_quant_selector.backtest.engine import run_backtest

app = FastAPI(title="tw-quant-selector", version="1.0.0")
db = Database()


class HealthResponse(BaseModel):
    status: str
    db_connected: bool
    last_update: Optional[str] = None


class SignalItem(BaseModel):
    stock_id: str
    name: Optional[str] = None
    score: float
    rank: int


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


class DataStatusResponse(BaseModel):
    last_price_update: Optional[str] = None
    missing_dates: list[str] = []
    coverage: dict = {}


@app.get("/health", response_model=HealthResponse)
def health():
    db_ok = True
    last = None
    try:
        row = db.execute("SELECT MAX(trade_date) FROM daily_prices").fetchone()
        if row and row[0]:
            last = row[0].isoformat()
    except Exception:
        db_ok = False
    return HealthResponse(status="ok", db_connected=db_ok, last_update=last)


@app.get("/api/v1/signals/latest", response_model=SignalResponse)
def latest_signals(
    strategy: str = Query("composite"),
    top_n: int = Query(20, ge=1, le=100),
    include_etf: bool = Query(False),
):
    latest = db.execute("SELECT MAX(signal_date) FROM signals WHERE strategy = ?", [strategy]).fetchone()
    if not latest or not latest[0]:
        raise HTTPException(404, "No signals found")
    return _get_signals(latest[0], strategy, top_n, include_etf)


@app.get("/api/v1/signals/{signal_date}", response_model=SignalResponse)
def signals_by_date(
    signal_date: date,
    strategy: str = Query("composite"),
    top_n: int = Query(20, ge=1, le=100),
    include_etf: bool = Query(False),
):
    return _get_signals(signal_date, strategy, top_n, include_etf)


def _get_signals(signal_date: date, strategy: str, top_n: int, include_etf: bool) -> SignalResponse:
    rows = db.execute(
        """SELECT s.stock_id, st.stock_name, s.score, s.rank
           FROM signals s
           LEFT JOIN stocks st ON s.stock_id = st.stock_id
           WHERE s.signal_date = ? AND s.strategy = ?
           ORDER BY s.rank LIMIT ?""",
        [signal_date, strategy, top_n],
    ).fetchall()
    stocks = []
    etfs = []
    for r in rows:
        item = SignalItem(stock_id=r[0], name=r[1], score=float(r[2]) if r[2] else 0, rank=r[3] or 0)
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
    return BacktestResponse(run_id=run_id, status="completed")


@app.get("/api/v1/backtest/{run_id}")
def get_backtest(run_id: str):
    row = db.execute(
        "SELECT * FROM backtest_runs WHERE run_id = ?", [run_id]
    ).fetchone()
    if not row:
        raise HTTPException(404, "Backtest run not found")
    return {"status": "completed", "run_id": run_id, "metrics": {
        "total_return": float(row[6]) if row[6] else None,
        "cagr": float(row[7]) if row[7] else None,
        "sharpe": float(row[8]) if row[8] else None,
        "max_drawdown": float(row[9]) if row[9] else None,
        "calmar": float(row[10]) if row[10] else None,
    }}


@app.get("/api/v1/data/status")
def data_status():
    latest_price = db.execute("SELECT MAX(trade_date) FROM daily_prices").fetchone()
    stock_count = db.execute("SELECT COUNT(*) FROM stocks").fetchone()
    return {
        "last_price_update": latest_price[0].isoformat() if latest_price and latest_price[0] else None,
        "stock_count": stock_count[0] if stock_count else 0,
        "missing_dates": [],
        "coverage": {},
    }
