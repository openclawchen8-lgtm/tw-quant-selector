from abc import ABC, abstractmethod
from datetime import date
from typing import Any, Protocol
import pandas as pd


class DataProvider(Protocol):
    def get_daily_prices(self, stock_id: str, start: date, end: date) -> pd.DataFrame:
        ...

    def get_universe(self, as_of_date: date) -> list[str]:
        ...


class DuckDBDataProvider:
    def __init__(self, db):
        self._db = db

    def get_daily_prices(self, stock_id: str, start: date, end: date) -> pd.DataFrame:
        with self._db.connection() as conn:
            return conn.execute(
                """SELECT trade_date, open, high, low, close, volume, amount, adj_close
                   FROM daily_prices
                   WHERE stock_id = ? AND trade_date >= ? AND trade_date <= ?
                   ORDER BY trade_date""",
                [stock_id, start, end],
            ).fetchdf()

    def get_universe(self, as_of_date: date) -> list[str]:
        from tw_quant_selector.portfolio.universe import get_universe
        result = get_universe(self._db, as_of_date)
        return [s["stock_id"] for s in result["stocks"]]


class BaseStrategy(ABC):
    name: str = "base"

    @abstractmethod
    def compute_score(self, universe: list[str], as_of_date: date) -> dict[str, float]:
        ...

    @abstractmethod
    def get_required_data(self) -> list[str]:
        ...


_strategy_registry: dict[str, type[BaseStrategy]] = {}


def register_strategy(cls: type[BaseStrategy]):
    _strategy_registry[cls.name] = cls
    return cls


def get_strategy(name: str) -> BaseStrategy:
    if name not in _strategy_registry:
        raise KeyError(f"Unknown strategy: {name}. Available: {list(_strategy_registry.keys())}")
    return _strategy_registry[name]()


def list_strategies() -> list[str]:
    return list(_strategy_registry.keys())
