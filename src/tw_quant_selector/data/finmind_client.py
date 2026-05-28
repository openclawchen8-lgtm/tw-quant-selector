import os
import time
from datetime import date, datetime, timedelta
from typing import Any
import httpx
import structlog

log = structlog.get_logger()

FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data"
RATE_LIMIT_PER_DAY = 600  # 免費方案: 600 req/hour（認證後）


class FinMindClient:
    def __init__(self, token: str | None = None):
        self.token = token or os.getenv("FINMIND_TOKEN", "")
        if not self.token:
            raise ValueError("FINMIND_TOKEN is required")
        self._client = httpx.Client(timeout=60)
        self._headers = {"Authorization": f"Bearer {self.token}"}
        self._daily_call_count = 0
        self._reset_date = date.today()
        self._banned_until: datetime | None = None
        self._banned_logged: float = 0

    def _check_banned(self) -> bool:
        if self._banned_until is None:
            return False
        now = datetime.now()
        if now >= self._banned_until:
            self._banned_until = None
            self._banned_logged = 0
            return False
        if now.timestamp() - self._banned_logged > 60:
            remaining = int((self._banned_until - now).total_seconds())
            log.warning("finmind.banned_skip", remaining_sec=remaining,
                        remaining_min=remaining // 60,
                        eta=self._banned_until.strftime("%H:%M:%S"))
            self._banned_logged = now.timestamp()
        return True

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
        if self._check_banned():
            return []
        self._check_rate_limit()
        params = {"dataset": dataset, **(params or {})}
        for attempt in range(2):
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
                if retry_after > 0:
                    eta = datetime.now() + timedelta(seconds=retry_after)
                    eta_str = eta.strftime("%H:%M:%S")
                    readable = f"{detail} (~{retry_after//60}min, 預計 {eta_str} 恢復)"
                else:
                    readable = detail
                if status == 402:
                    wait_sec = retry_after if retry_after > 0 else 60
                    self._banned_until = datetime.now() + timedelta(seconds=wait_sec)
                    self._banned_logged = datetime.now().timestamp()
                    log.error("finmind.rate_limited_402", dataset=dataset, wait_sec=wait_sec,
                               msg=readable, retry_after=wait_sec)
                    log.error("FinMind 402 rate limited, backing off {wait_sec}s", wait_sec=wait_sec)
                    return []  # stop retrying this dataset, move to next
                if status in (400, 403, 404):
                    if retry_after > 0:
                        self._banned_until = datetime.now() + timedelta(seconds=retry_after)
                        self._banned_logged = datetime.now().timestamp()
                    log.warning("finmind.skipped", dataset=dataset, status=status,
                                msg=readable, retry_after=retry_after)
                    return []
            except (httpx.TimeoutException, httpx.TransportError) as e:
                if attempt == 0:
                    wait = 2
                    log.warning("finmind.retry", dataset=dataset, attempt=attempt, wait=wait)
                    time.sleep(wait)
                else:
                    log.error("finmind.failed", dataset=dataset, error=str(e))
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
