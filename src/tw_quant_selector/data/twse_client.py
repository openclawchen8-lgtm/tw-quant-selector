import os
import re
import warnings
import httpx
import structlog
from datetime import date

warnings.filterwarnings("ignore", message=".*SSL.*", module="tw_quant_selector.data.twse_client")

log = structlog.get_logger()

TWSE_BASE = os.getenv("TWSE_BASE_URL", "https://openapi.twse.com.tw/v1")
TPEX_BASE = os.getenv("TPEX_BASE_URL", "https://www.tpex.org.tw/openapi/v1")


class TWSEClient:
    def __init__(self):
        self._client = httpx.Client(timeout=30)

    def get_stock_list(self) -> list[dict]:
        resp = self._client.get(f"{TWSE_BASE}/exchangeReport/STOCK_DAY_ALL")
        resp.raise_for_status()
        return resp.json()

    def close(self):
        self._client.close()


class TPEXClient:
    def __init__(self):
        self._client = httpx.Client(timeout=30, verify=False)

    def get_stock_list(self) -> list[dict]:
        resp = self._client.get(f"{TPEX_BASE}/tpex_mainboard_daily_close_quotes")
        resp.raise_for_status()
        return resp.json()

    def close(self):
        self._client.close()


ETF_CODE_PATTERN = re.compile(r"^00\d{3,4}$")

def _is_etf_stock_id(sid: str) -> bool:
    return bool(ETF_CODE_PATTERN.match(sid))

def update_stock_list(db, twse: TWSEClient | None = None, tpex: TPEXClient | None = None):
    twse = twse or TWSEClient()
    tpex = tpex or TPEXClient()

    count = 0
    with db.connection() as conn:
        for source, client, market in [("TWSE", twse, "TSE"), ("TPEX", tpex, "OTC")]:
            try:
                rows = client.get_stock_list()
                for r in rows:
                    sid = str(r.get("Code") or r.get("SecuritiesCompanyCode") or r.get("code", ""))
                    name = str(r.get("Name") or r.get("CompanyName") or r.get("name", "")) or sid
                    is_etf = _is_etf_stock_id(sid)
                    conn.execute(
                        """INSERT INTO stocks (stock_id, stock_name, market, is_etf)
                           VALUES (?, ?, ?, ?)
                           ON CONFLICT (stock_id) DO UPDATE SET stock_name = excluded.stock_name, market = excluded.market, is_etf = excluded.is_etf""",
                        [sid, name, market, is_etf],
                    )
                count += len(rows)
                log.info("stock_list.updated", market=market, count=len(rows), etfs=sum(1 for r in rows if _is_etf_stock_id(str(r.get("Code") or r.get("SecuritiesCompanyCode") or ""))))
                conn.commit()
            except Exception as e:
                log.error("stock_list.failed", market=market, error=str(e))
    twse.close()
    tpex.close()
    log.info("stock_list.done", total=count)
    return count
