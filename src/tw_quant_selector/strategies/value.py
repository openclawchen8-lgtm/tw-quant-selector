from datetime import date, timedelta
from math import log

import numpy as np

from tw_quant_selector.strategies.base import BaseStrategy, register_strategy, safe_zscore


@register_strategy
class ValueStrategy(BaseStrategy):
    name = "value"

    def __init__(self, max_pb: float = 30, max_pe: float = 100, min_yield: float = 0):
        self.max_pb = max_pb
        self.max_pe = max_pe
        self.min_yield = min_yield

    def get_required_data(self) -> list[str]:
        return ["valuations"]

    def compute_score(self, universe: list[str], as_of_date: date, db=None) -> dict[str, float]:
        scores: dict[str, float] = {}
        for sid in universe:
            row = db.execute(
                """SELECT pe_ratio, pb_ratio, dividend_yield
                   FROM valuations
                   WHERE stock_id = ? AND trade_date <= ?
                   ORDER BY trade_date DESC LIMIT 1""",
                [sid, as_of_date],
            ).fetchone()
            if not row:
                continue

            pb, pe, div_yield = row
            components = []

            if pb is not None and 0 < pb <= self.max_pb:
                components.append(safe_zscore(np.array([-log(float(pb))]))[0])
            if pe is not None and pe > 0 and pe <= self.max_pe:
                components.append(safe_zscore(np.array([-log(float(pe))]))[0])
            if div_yield is not None and div_yield >= self.min_yield:
                components.append(safe_zscore(np.array([float(div_yield)]))[0])

            if components:
                scores[sid] = float(np.mean(components))

        if not scores:
            return {}

        vals = np.array(list(scores.values()))
        if np.std(vals) == 0:
            return {k: 0.0 for k in scores}

        z = safe_zscore(vals)
        return {sid: float(z[i]) for i, sid in enumerate(scores)}
