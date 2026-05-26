import math
from datetime import date
from decimal import Decimal
from typing import Any
import numpy as np
from scipy.stats import zscore
import structlog

from tw_quant_selector.strategies.base import get_strategy, list_strategies
from tw_quant_selector.portfolio.universe import get_universe, ETF_IDS

log = structlog.get_logger()

DEFAULT_WEIGHTS: dict[str, float] = {
    "momentum": 0.30,
    "value": 0.25,
    "quality": 0.25,
    "growth": 0.20,
}


def compute_composite_scores(
    db, as_of_date: date, weights: dict[str, float] | None = None,
    top_n_stocks: int = 20, top_n_etfs: int = 3,
    strategy_params: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    weights = weights or DEFAULT_WEIGHTS
    universe = get_universe(db, as_of_date)
    stock_ids = [s["stock_id"] for s in universe["stocks"]]
    etf_ids = [s["stock_id"] for s in universe["etfs"]]

    stock_scores = _combine(db, stock_ids, as_of_date, weights, strategy_params)
    etf_scores = _combine(db, etf_ids, as_of_date, weights, strategy_params)

    stock_ranked = _rank_and_select(stock_scores, top_n_stocks)
    etf_ranked = _rank_and_select(etf_scores, top_n_etfs)

    _save_signals(db, as_of_date, stock_scores, etf_scores, stock_ranked, etf_ranked)

    return {
        "date": as_of_date.isoformat(),
        "stocks": stock_ranked,
        "etfs": etf_ranked,
        "total_candidates": len(stock_scores),
    }


def _combine(
    db, stock_ids: list[str], as_of_date: date, weights: dict[str, float],
    strategy_params: dict[str, dict[str, Any]] | None = None,
) -> dict[str, float]:
    combined: dict[str, list[float]] = {}
    dp = None
    from tw_quant_selector.strategies.base import DuckDBDataProvider
    dp = DuckDBDataProvider(db)

    for name in list_strategies():
        if name not in weights or weights[name] == 0:
            continue
        params = (strategy_params or {}).get(name)
        strat = get_strategy(name, params)
        scores = strat.compute_score(stock_ids, as_of_date, dp if name == "momentum" else db)
        weight = weights[name]
        for sid, score in scores.items():
            if sid not in combined:
                combined[sid] = []
            combined[sid].append(score * weight)

    result: dict[str, float] = {}
    for sid, components in combined.items():
        result[sid] = float(np.mean(components))

    if not result:
        return {}
    vals = np.array(list(result.values()))
    if np.std(vals) == 0:
        return {k: 0.0 for k in result}
    z = zscore(vals)
    return {sid: float(z[i]) for i, sid in enumerate(result)}


def _rank_and_select(scores: dict[str, float], top_n: int) -> list[dict]:
    ranked = sorted(scores.items(), key=lambda x: -x[1])
    return [
        {"stock_id": sid, "score": round(score, 4), "rank": i + 1}
        for i, (sid, score) in enumerate(ranked[:top_n])
    ]


def _save_signals(db, as_of_date, stock_scores, etf_scores, stock_ranked, etf_ranked):
    ranked_ids = {r["stock_id"] for r in stock_ranked} | {r["stock_id"] for r in etf_ranked}
    all_scores = {**stock_scores, **etf_scores}
    with db.connection() as conn:
        for sid, score in all_scores.items():
            rank = None
            for i, r in enumerate(stock_ranked + etf_ranked):
                if r["stock_id"] == sid:
                    rank = i + 1
                    break
            if score is None or (isinstance(score, (float, np.floating)) and (math.isnan(score) or np.isnan(score))):
                score_val = None
            else:
                score_val = round(Decimal(str(score)), 4)
            conn.execute(
                """INSERT INTO signals (signal_date, stock_id, strategy, score, rank, is_selected)
                   VALUES (?, ?, 'composite', ?, ?, ?)
                   ON CONFLICT (signal_date, stock_id, strategy)
                   DO UPDATE SET score = excluded.score, rank = excluded.rank, is_selected = excluded.is_selected""",
                [as_of_date, sid, score_val, rank, sid in ranked_ids],
            )
        conn.commit()
    log.info("signals.saved", date=str(as_of_date), stocks=len(stock_ranked), etfs=len(etf_ranked))
