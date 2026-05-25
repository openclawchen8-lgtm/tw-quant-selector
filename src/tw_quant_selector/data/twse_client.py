import os
import httpx
import structlog
from datetime import date

log = structlog.get_logger()

TWSE_BASE = os.getenv("TWSE_BASE_URL", "https://opendata.twse.com.tw/v1")
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
        self._client = httpx.Client(timeout=30)

    def get_stock_list(self) -> list[dict]:
        resp = self._client.get(f"{TPEX_BASE}/tpex_mainboard_daily_close_quotes")
        resp.raise_for_status()
        return resp.json()

    def close(self):
        self._client.close()


def update_stock_list(db, twse: TWSEClient | None = None, tpex: TPEXClient | None = None):
    from tw_quant_selector.data.database import Database
    twse = twse or TWSEClient()
    tpex = tpex or TPEXClient()

    count = 0
    with db.connection() as conn:
        for source, client, market in [("TWSE", twse, "TSE"), ("TPEX", tpex, "OTC")]:
            try:
                rows = client.get_stock_list()
                for r in rows:
                    sid = str(r.get("Code", r.get("code", "")))
                    name = r.get("Name", r.get("name", "")) or sid
                    conn.execute(
                        """INSERT INTO stocks (stock_id, stock_name, market)
                           VALUES (?, ?, ?)
                           ON CONFLICT (stock_id) DO UPDATE SET stock_name = excluded.stock_name, market = excluded.market""",
                        [sid, name, market],
                    )
                count += len(rows)
                log.info("stock_list.updated", market=market, count=len(rows))
            except Exception as e:
                log.error("stock_list.failed", market=market, error=str(e))
    conn.commit()
    twse.close()
    tpex.close()
    log.info("stock_list.done", total=count)
    return count
