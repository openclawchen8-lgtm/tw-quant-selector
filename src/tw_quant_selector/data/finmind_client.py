import os
import time
from datetime import date, datetime
from typing import Any
import httpx
import structlog

log = structlog.get_logger()

FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data"
RATE_LIMIT_PER_DAY = 600


class FinMindClient:
    def __init__(self, token: str | None = None):
        self.token = token or os.getenv("FINMIND_TOKEN", "")
        if not self.token:
            raise ValueError("FINMIND_TOKEN is required")
        self._client = httpx.Client(timeout=60)
        self._headers = {"Authorization": f"Bearer {self.token}"}
        self._daily_call_count = 0
        self._reset_date = date.today()

    def _check_rate_limit(self):
        today = date.today()
        if today != self._reset_date:
            self._daily_call_count = 0
            self._reset_date = today
        self._daily_call_count += 1
        usage_pct = self._daily_call_count / RATE_LIMIT_PER_DAY
        if usage_pct > 0.8:
            log.warning("finmind.rate_limit.high", usage_pct=usage_pct, calls=self._daily_call_count)
        if self._daily_call_count >= RATE_LIMIT_PER_DAY:
            raise RuntimeError(f"FinMind daily limit reached ({RATE_LIMIT_PER_DAY})")

    def _request(self, dataset: str, params: dict[str, Any] | None = None) -> list[dict]:
        self._check_rate_limit()
        params = {"dataset": dataset, **(params or {})}
        for attempt in range(3):
            try:
                resp = self._client.get(FINMIND_BASE, headers=self._headers, params=params)
                resp.raise_for_status()
                data = resp.json()
                if data.get("msg") == "success":
                    return data.get("data", [])
                log.warning("finmind.api_error", dataset=dataset, msg=data.get("msg"))
                return []
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                if attempt < 2:
                    wait = 2 ** attempt
                    log.warning("finmind.retry", dataset=dataset, attempt=attempt, wait=wait)
                    time.sleep(wait)
                else:
                    log.error("finmind.failed", dataset=dataset, error=str(e))
                    raise

    def get_daily_prices(self, stock_id: str, start: date, end: date) -> list[dict]:
        return self._request("TaiwanStockPrice", {
            "data_id": stock_id, "start_date": start.isoformat(), "end_date": end.isoformat()
        })

    def get_financials(self, stock_id: str, start: str, end: str) -> list[dict]:
        return self._request("TaiwanStockFinancialStatements", {
            "data_id": stock_id, "start_date": start, "end_date": end
        })

    def get_monthly_revenue(self, stock_id: str, start: str, end: str) -> list[dict]:
        return self._request("TaiwanStockMonthRevenue", {
            "data_id": stock_id, "start_date": start, "end_date": end
        })

    def get_shareholding(self, stock_id: str, start: str, end: str) -> list[dict]:
        return self._request("TaiwanStockHoldingSharesPer", {
            "data_id": stock_id, "start_date": start, "end_date": end
        })

    def get_dividend(self, stock_id: str, start: str, end: str) -> list[dict]:
        return self._request("TaiwanStockDividend", {
            "data_id": stock_id, "start_date": start, "end_date": end
        })

    def get_per_pbr(self, stock_id: str, start: str, end: str) -> list[dict]:
        return self._request("TaiwanStockPER", {
            "data_id": stock_id, "start_date": start, "end_date": end
        })

    def get_balance_sheet(self, stock_id: str, start: str, end: str) -> list[dict]:
        return self._request("TaiwanStockBalanceSheet", {
            "data_id": stock_id, "start_date": start, "end_date": end
        })

    def close(self):
        self._client.close()
