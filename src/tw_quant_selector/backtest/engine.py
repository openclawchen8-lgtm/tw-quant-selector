from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any
import uuid, json
import structlog
import pandas as pd

from tw_quant_selector.data.database import Database
from tw_quant_selector.portfolio.portfolio import Portfolio, INITIAL_CAPITAL
from tw_quant_selector.strategies.combiner import compute_composite_scores, DEFAULT_WEIGHTS
from tw_quant_selector.backtest.metrics import compute_metrics

log = structlog.get_logger()


def _get_price(db, stock_id: str, trade_date: date) -> Decimal | None:
    row = db.execute(
        """SELECT close FROM daily_prices
           WHERE stock_id = ? AND trade_date = ?""",
        [stock_id, trade_date],
    ).fetchone()
    return Decimal(str(row[0])) if row and row[0] else None


def _historical_universe(db, as_of_date: date) -> list[str]:
    rows = db.execute(
        """SELECT stock_id FROM stocks
           WHERE list_date <= ?
           AND (delist_date IS NULL OR delist_date > ?)""",
        [as_of_date, as_of_date],
    ).fetchall()
    return [r[0] for r in rows]


def _rebalance_dates(start: date, end: date) -> list[date]:
    dates: list[date] = []
    d = start
    while d <= end:
        if d.weekday() == 0:
            dates.append(d)
        d += timedelta(days=1)
    return dates


def run_backtest(
    db: Database,
    start_date: date,
    end_date: date | None = None,
    initial_capital: Decimal = INITIAL_CAPITAL,
    strategy_weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    run_id = str(uuid.uuid4())
    end_date = end_date or date.today()
    weights = strategy_weights or DEFAULT_WEIGHTS
    portfolio = Portfolio(initial_capital=initial_capital)
    all_trades: list[dict] = []
    benchmark_returns: list[float] = []
    portfolio_values: list[tuple[date, Decimal]] = []
    dp = None

    rebalance_dates = _rebalance_dates(start_date, end_date)

    for i, rb_date in enumerate(rebalance_dates):
        sig_date = rb_date
        universe = _historical_universe(db, rb_date)

        if not universe:
            continue

        result = compute_composite_scores(db, rb_date, weights, top_n_stocks=20, top_n_etfs=3)
        stock_scores = {s["stock_id"]: s["score"] for s in result.get("stocks", [])}
        etf_scores = {s["stock_id"]: s["score"] for s in result.get("etfs", [])}

        all_ids = list(stock_scores.keys()) + list(etf_scores.keys())
        prices = {}
        industries = {}
        for sid in all_ids:
            p = _get_price(db, sid, sig_date)
            if p:
                prices[sid] = p
            ind = db.execute(
                "SELECT industry FROM stocks WHERE stock_id = ?", [sid]
            ).fetchone()
            if ind:
                industries[sid] = ind[0]

        if not prices:
            continue

        new_stocks = [{"stock_id": sid, "score": sc}
                       for sid, sc in sorted(stock_scores.items(), key=lambda x: -x[1])[:20]]
        new_etfs = [{"stock_id": sid, "score": sc}
                     for sid, sc in sorted(etf_scores.items(), key=lambda x: -x[1])[:3]]

        trades = portfolio.rebalance(new_stocks, new_etfs, prices, industries, sig_date)
        for t in trades:
            t["run_id"] = run_id
            all_trades.append(t)
        portfolio_values.append((sig_date, portfolio.total_value(prices)))

        bm_price = _get_price(db, "0050", sig_date)
        if bm_price:
            benchmark_returns.append(float(bm_price))

        if (i + 1) % 50 == 0:
            log.info("backtest.progress", run_id=run_id, date=str(sig_date), progress=f"{i + 1}/{len(rebalance_dates)}")

    metrics = compute_metrics(portfolio_values, initial_capital, benchmark_returns)
    metrics["run_id"] = run_id
    metrics["start_date"] = start_date.isoformat()
    metrics["end_date"] = end_date.isoformat()
    metrics["strategy_config"] = weights

    _save_backtest(db, run_id, metrics)
    _save_trades(db, all_trades)
    _save_equity(db, run_id, portfolio_values, benchmark_returns)

    log.info("backtest.completed", run_id=run_id,
             total_return=metrics.get("total_return"), sharpe=metrics.get("sharpe"))
    return metrics


def _save_backtest(db, run_id: str, metrics: dict):
    with db.connection(read_only=False) as conn:
        conn.execute(
            """INSERT INTO backtest_runs
               (run_id, run_at, start_date, end_date, strategy_config,
                total_return, cagr, sharpe, max_drawdown, calmar, turnover)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [run_id, datetime.now(), metrics.get("start_date"), metrics.get("end_date"),
             json.dumps(metrics.get("strategy_config", {})),
             metrics.get("total_return"), metrics.get("cagr"),
             metrics.get("sharpe"), metrics.get("max_drawdown"),
             metrics.get("calmar"), metrics.get("turnover")],
        )
        conn.commit()


def _save_trades(db, trades: list[dict]):
    if not trades:
        return
    with db.connection(read_only=False) as conn:
        for t in trades:
            conn.execute(
                """INSERT INTO backtest_positions
                   (run_id, trade_date, stock_id, action, shares, price, value, weight)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                [t.get("run_id"), t.get("date"), t.get("stock_id"), t.get("action"),
                 t.get("shares"), t.get("price"), t.get("value"), None],
            )
        conn.commit()


def _save_equity(db, run_id: str, portfolio_values: list[tuple[date, Decimal]], benchmark_prices: list[float]):
    if not portfolio_values:
        return
    
    # Normalize benchmark to match initial capital
    initial_cap = float(portfolio_values[0][1])
    normalized_benchmark = []
    if benchmark_prices:
        first_bm = benchmark_prices[0]
        normalized_benchmark = [(p / first_bm) * initial_cap for p in benchmark_prices]
    
    # Calculate drawdown curve
    peak = 0.0
    with db.connection(read_only=False) as conn:
        for i, (d, val) in enumerate(portfolio_values):
            v = float(val)
            if v > peak:
                peak = v
            dd = (v - peak) / peak if peak > 0 else 0
            bm = normalized_benchmark[i] if i < len(normalized_benchmark) else None
            
            conn.execute(
                """INSERT INTO backtest_equity (run_id, trade_date, portfolio_value, benchmark_value, drawdown)
                   VALUES (?, ?, ?, ?, ?)""",
                [run_id, d, v, bm, dd]
            )
        conn.commit()

