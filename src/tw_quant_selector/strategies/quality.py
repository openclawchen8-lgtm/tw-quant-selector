from datetime import date, timedelta
from decimal import Decimal

import numpy as np
import pandas as pd

from tw_quant_selector.strategies.base import BaseStrategy, register_strategy, safe_zscore


@register_strategy
class QualityStrategy(BaseStrategy):
    name = "quality"

    def __init__(self, roe_weight: float = 0.5, leverage_weight: float = 0.3,
                 stability_weight: float = 0.2, lookback_quarters: int = 4):
        self.roe_weight = roe_weight
        self.leverage_weight = leverage_weight
        self.stability_weight = stability_weight
        self.lookback_quarters = lookback_quarters

    def get_required_data(self) -> list[str]:
        return ["financials"]

    def compute_score(self, universe: list[str], as_of_date: date, db=None) -> dict[str, float]:
        scores: dict[str, float] = {}
        for sid in universe:
            rows = db.execute(
                """SELECT roe, debt_to_equity, gross_margin
                   FROM financials
                   WHERE stock_id = ? AND announcement_date <= ?
                   ORDER BY year_quarter DESC LIMIT ?""",
                [sid, as_of_date, self.lookback_quarters],
            ).fetchdf()

            if rows.empty or len(rows) < self.lookback_quarters:
                continue

            roe_vals = rows["roe"].dropna()
            if roe_vals.empty:
                continue

            roe_score = safe_zscore(roe_vals.values)[-1] if len(roe_vals) > 1 else 0.0

            dte = rows["debt_to_equity"].iloc[0]
            lev_score = safe_zscore(np.array([-float(dte)]))[0] if dte is not None else 0.0

            gm = rows["gross_margin"].dropna()
            gp_std = float(gm.std()) if len(gm) > 1 else 0
            gp_stab = safe_zscore(np.array([-gp_std]))[0]

            score = (roe_score * self.roe_weight
                     + lev_score * self.leverage_weight
                     + gp_stab * self.stability_weight)
            scores[sid] = score

        if not scores:
            return {}
        vals = np.array(list(scores.values()))
        if np.std(vals) == 0:
            return {k: 0.0 for k in scores}
        z = safe_zscore(vals)
        return {sid: float(z[i]) for i, sid in enumerate(scores)}
