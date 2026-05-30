import math
from datetime import date
from decimal import Decimal
from typing import Any
import numpy as np
import structlog

from tw_quant_selector.strategies.base import get_strategy, list_strategies, safe_zscore
from tw_quant_selector.portfolio.universe import get_universe, ETF_IDS

log = structlog.get_logger()

DEFAULT_WEIGHTS: dict[str, float] = {
    "momentum": 0.30,
    "value": 0.25,
    "quality": 0.25,
    "growth": 0.20,
}

DEFAULT_5FACTOR_WEIGHTS: dict[str, float] = {
    "momentum": 0.25,
    "value": 0.20,
    "quality": 0.20,
    "growth": 0.15,
    "guru": 0.20,
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

    # Apply guru filter if requested
    guru_filter_name = (strategy_params or {}).get("guru_filter")
    if guru_filter_name:
        from tw_quant_selector.strategies.guru_filters import get_guru_filter
        log.info("strategy.applying_guru_filter", guru=guru_filter_name)
        gf = get_guru_filter(guru_filter_name)
        filtered_stocks = []
        for sid in stock_ids:
            results = gf.get_pass_fail(db, sid, as_of_date)
            if all(results.values()):
                filtered_stocks.append(sid)
        stock_ids = filtered_stocks

    stock_scores, stock_individual = _combine(db, stock_ids, as_of_date, weights, strategy_params)
    etf_scores, etf_individual = _combine(db, etf_ids, as_of_date, weights, strategy_params)

    individual_scores = dict(stock_individual)
    for sid in etf_individual:
        if sid in individual_scores:
            individual_scores[sid].update(etf_individual[sid])
        else:
            individual_scores[sid] = dict(etf_individual[sid])

    stock_ranked = _rank_and_select(stock_scores, top_n_stocks)
    etf_ranked = _rank_and_select(etf_scores, top_n_etfs)

    _save_signals(db, as_of_date, stock_scores, etf_scores, stock_ranked, etf_ranked, individual_scores)

    return {
        "date": as_of_date.isoformat(),
        "stocks": stock_ranked,
        "etfs": etf_ranked,
        "total_candidates": len(stock_scores),
    }


def _combine(
    db, stock_ids: list[str], as_of_date: date, weights: dict[str, float],
    strategy_params: dict[str, dict[str, Any]] | None = None,
) -> tuple[dict[str, float], dict[str, dict[str, float]]]:
    combined: dict[str, list[float]] = {}
    dp = None
    from tw_quant_selector.strategies.base import DuckDBDataProvider
    dp = DuckDBDataProvider(db)

    individual: dict[str, dict[str, float]] = {}

    for name in list_strategies():
        if name not in weights or weights[name] == 0:
            continue
        params = (strategy_params or {}).get(name)
        strat = get_strategy(name, params)
        scores = strat.compute_score(stock_ids, as_of_date, dp if name == "momentum" else db)
        individual[name] = scores
        weight = weights[name]
        for sid, score in scores.items():
            if sid not in combined:
                combined[sid] = []
            combined[sid].append(score * weight)

    result: dict[str, float] = {}
    for sid, components in combined.items():
        result[sid] = float(np.mean(components))

    if not result:
        return {}, individual
    vals = np.array(list(result.values()))
    if np.std(vals) == 0:
        return {k: 0.0 for k in result}, individual
    z = safe_zscore(vals)
    return {sid: float(z[i]) for i, sid in enumerate(result)}, individual


def _rank_and_select(scores: dict[str, float], top_n: int) -> list[dict]:
    ranked = sorted(scores.items(), key=lambda x: -x[1])
    return [
        {"stock_id": sid, "score": round(score, 4), "rank": i + 1}
        for i, (sid, score) in enumerate(ranked[:top_n])
    ]


def _save_signals(db, as_of_date, stock_scores, etf_scores, stock_ranked, etf_ranked, individual_scores=None):
    ranked_ids = {r["stock_id"] for r in stock_ranked} | {r["stock_id"] for r in etf_ranked}
    all_scores = {**stock_scores, **etf_scores}
    strategies = ["composite"] + list_strategies()
    
    # 为每个策略独立计算排名
    strategy_rankings = {}
    for strategy in strategies:
        if strategy == "composite":
            # composite 使用传入的排名
            strategy_rankings[strategy] = {r["stock_id"]: r["rank"] for r in stock_ranked + etf_ranked}
        else:
            #  Individual strategies: 根据各自的分数重新排名
            scores = (individual_scores or {}).get(strategy, {})
            if not scores:
                strategy_rankings[strategy] = {}
                continue
            # 按分数从高到低排序
            sorted_stocks = sorted(scores.items(), key=lambda x: -x[1] if x[1] is not None and not np.isnan(x[1]) else 0)
            strategy_rankings[strategy] = {sid: i + 1 for i, (sid, _) in enumerate(sorted_stocks)}
    
    with db.connection(read_only=False) as conn:
        for strategy in strategies:
            for sid, score in all_scores.items():
                # 使用对应策略的排名
                rank = strategy_rankings.get(strategy, {}).get(sid)

                if strategy != "composite":
                    raw = (individual_scores or {}).get(strategy, {}).get(sid)
                    score_val = round(Decimal(str(raw)), 4) if raw is not None and not (isinstance(raw, (float, np.floating)) and np.isnan(raw)) else None
                else:
                    if score is None or (isinstance(score, (float, np.floating)) and (math.isnan(score) or np.isnan(score))):
                        score_val = None
                    else:
                        score_val = round(Decimal(str(score)), 4)

                conn.execute(
                    """INSERT INTO signals (signal_date, stock_id, strategy, score, rank, is_selected)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT (signal_date, stock_id, strategy)
                       DO UPDATE SET score = excluded.score, rank = excluded.rank, is_selected = excluded.is_selected""",
                    [as_of_date, sid, strategy, score_val, rank, sid in ranked_ids],
                )
        conn.commit()
    log.info("signals.saved", date=str(as_of_date), stocks=len(stock_ranked), etfs=len(etf_ranked))
