import os
import time
from datetime import date, datetime, timedelta
from typing import Any
import httpx
import structlog

log = structlog.get_logger()

FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data"
RATE_LIMIT_PER_HOUR = 600  # 認證後每小時 600 次
MAX_DAILY_CALLS = 10000    # 每日總上限

class FinMindClient:
    def __init__(self, token: str | None = None):
        self.token = token or os.getenv("FINMIND_TOKEN", "")
        if not self.token:
            raise ValueError("FINMIND_TOKEN is required")
        self._client = httpx.Client(timeout=60)
        self._headers = {"Authorization": f"Bearer {self.token}"}
        self._hourly_call_count = 0
        self._last_reset_hour = datetime.now().hour
        self._daily_call_count = 0
        self._reset_date = date.today()
        self._banned_until: datetime | None = None
        self._banned_logged: float = 0

    def _check_rate_limit(self):
        now = datetime.now()
        # Hourly reset
        if now.hour != self._last_reset_hour:
            self._hourly_call_count = 0
            self._last_reset_hour = now.hour
        
        # Daily reset
        if now.date() != self._reset_date:
            self._daily_call_count = 0
            self._reset_date = now.date()

        self._hourly_call_count += 1
        self._daily_call_count += 1

        if self._hourly_call_count > RATE_LIMIT_PER_HOUR * 0.9:
            log.warning("finmind.rate_limit.hourly_high", usage=self._hourly_call_count)
        
        if self._hourly_call_count >= RATE_LIMIT_PER_HOUR:
            # We don't necessarily want to raise error, 
            # but let the API 402 handler handle the backoff.
            pass

    def _request(self, dataset: str, params: dict[str, Any] | None = None) -> list[dict]:
        if self._check_banned():
            return []
        self._check_rate_limit()
        params = {"dataset": dataset, **(params or {})}
        
        retry_402_count = 0
        max_402_retries = 5
        
        while True:
            try:
                resp = self._client.get(FINMIND_BASE, headers=self._headers, params=params)
                resp.raise_for_status()
                data = resp.json()
                if data.get("msg") == "success":
                    return data.get("data", [])
                log.warning("finmind.api_error", dataset=dataset, msg=data.get("msg"))
                return []
            except httpx.HTTPStatusError as e:
                status = e.response.status_code
                body = {}
                try:
                    body = e.response.json()
                except Exception:
                    pass
                retry_after = body.get("retry_after", 0)
                detail = body.get("msg", e.response.text[:200])
                
                if status == 402:
                    retry_402_count += 1
                    if retry_402_count > max_402_retries:
                        log.error("finmind.rate_limit_exhausted", dataset=dataset, count=retry_402_count)
                        return [] # Give up after N retries

                    wait_sec = retry_after if retry_after > 0 else 60
                    log.warning("finmind.rate_limited_402", dataset=dataset, 
                                attempt=retry_402_count, wait_sec=wait_sec)
                    time.sleep(wait_sec)
                    continue  # Retry

                # Other errors (400, 403, 404, etc.)
                log.warning("finmind.skipped", dataset=dataset, status=status, msg=detail)
                return []

            except (httpx.TimeoutException, httpx.TransportError) as e:
                log.error("finmind.network_failed", dataset=dataset, error=str(e))
                return []

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
