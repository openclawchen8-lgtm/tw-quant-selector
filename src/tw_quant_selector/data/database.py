import os
from contextlib import contextmanager
from pathlib import Path
import duckdb


CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS stocks (
    stock_id        VARCHAR PRIMARY KEY,
    stock_name      VARCHAR NOT NULL,
    market          VARCHAR NOT NULL,
    industry        VARCHAR,
    list_date       DATE,
    delist_date     DATE,
    is_etf          BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_prices (
    stock_id        VARCHAR NOT NULL,
    trade_date      DATE NOT NULL,
    open            DECIMAL(10,2),
    high            DECIMAL(10,2),
    low             DECIMAL(10,2),
    close           DECIMAL(10,2),
    volume          BIGINT,
    amount          DECIMAL(18,2),
    adj_factor      DECIMAL(10,6),
    adj_close       DECIMAL(10,4),
    PRIMARY KEY (stock_id, trade_date)
);

CREATE TABLE IF NOT EXISTS monthly_revenue (
    stock_id        VARCHAR NOT NULL,
    year_month      VARCHAR NOT NULL,
    revenue         BIGINT,
    revenue_yoy     DECIMAL(8,4),
    announcement_date DATE,
    PRIMARY KEY (stock_id, year_month)
);

CREATE TABLE IF NOT EXISTS financials (
    stock_id        VARCHAR NOT NULL,
    year_quarter    VARCHAR NOT NULL,
    revenue         BIGINT,
    gross_profit    BIGINT,
    operating_income BIGINT,
    net_income      BIGINT,
    eps             DECIMAL(8,2),
    roe             DECIMAL(8,4),
    roa             DECIMAL(8,4),
    gross_margin    DECIMAL(8,4),
    operating_margin DECIMAL(8,4),
    debt_to_equity  DECIMAL(8,4),
    announcement_date DATE,
    PRIMARY KEY (stock_id, year_quarter)
);

CREATE TABLE IF NOT EXISTS valuations (
    stock_id        VARCHAR NOT NULL,
    trade_date      DATE NOT NULL,
    pe_ratio        DECIMAL(10,2),
    pb_ratio        DECIMAL(10,2),
    dividend_yield  DECIMAL(8,4),
    market_cap      DECIMAL(18,2),
    PRIMARY KEY (stock_id, trade_date)
);

CREATE TABLE IF NOT EXISTS signals (
    signal_date     DATE NOT NULL,
    stock_id        VARCHAR NOT NULL,
    strategy        VARCHAR NOT NULL,
    score           DECIMAL(8,4),
    rank            INTEGER,
    is_selected     BOOLEAN,
    PRIMARY KEY (signal_date, stock_id, strategy)
);

CREATE TABLE IF NOT EXISTS backtest_runs (
    run_id          VARCHAR PRIMARY KEY,
    run_at          TIMESTAMP,
    start_date      DATE,
    end_date        DATE,
    strategy_config JSON,
    total_return    DECIMAL(8,4),
    cagr            DECIMAL(8,4),
    sharpe          DECIMAL(8,4),
    max_drawdown    DECIMAL(8,4),
    calmar          DECIMAL(8,4),
    turnover        DECIMAL(8,4),
    result_path     VARCHAR
);

CREATE TABLE IF NOT EXISTS backtest_positions (
    run_id          VARCHAR NOT NULL,
    trade_date      DATE NOT NULL,
    stock_id        VARCHAR NOT NULL,
    action          VARCHAR NOT NULL,
    shares          INTEGER,
    price           DECIMAL(10,2),
    value           DECIMAL(18,2),
    weight          DECIMAL(8,4),
    PRIMARY KEY (run_id, trade_date, stock_id)
);

CREATE TABLE IF NOT EXISTS ingestion_tracker (
    stock_id        VARCHAR NOT NULL,
    dataset         VARCHAR NOT NULL,
    bucket          INTEGER,
    last_updated    DATE,
    last_status     VARCHAR,
    error_msg       VARCHAR,
    PRIMARY KEY (stock_id, dataset)
);
"""


class Database:
    def __init__(self, db_path: str | None = None):
        self.db_path = db_path or os.getenv("DUCKDB_PATH", str(Path.cwd() / "data" / "tw_quant.duckdb"))
        self._conn: duckdb.DuckDBPyConnection | None = None

    def connect(self) -> duckdb.DuckDBPyConnection:
        if self._conn is None:
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
            self._conn = duckdb.connect(self.db_path)
        return self._conn

    def close(self):
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    @contextmanager
    def connection(self):
        conn = self.connect()
        try:
            yield conn
        finally:
            pass

    def execute(self, query: str, params: list | None = None):
        return self.connect().execute(query, params or [])

    def init_db(self):
        with self.connection() as conn:
            for stmt in CREATE_TABLES_SQL.strip().split(";"):
                stmt = stmt.strip()
                if stmt:
                    conn.execute(stmt + ";")
            conn.commit()
