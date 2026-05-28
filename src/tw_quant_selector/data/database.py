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
    revenue_yoy     DECIMAL(12,4),
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
    total_assets    BIGINT,
    total_liabilities BIGINT,
    cash            BIGINT,
    current_assets  BIGINT,
    current_liabilities BIGINT,
    net_fixed_assets BIGINT,
    ebit            BIGINT,
    enterprise_value BIGINT,
    roic            DECIMAL(8,4),
    peg             DECIMAL(8,4),
    current_ratio   DECIMAL(8,4),
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

CREATE TABLE IF NOT EXISTS guru_scores (
    score_date      DATE NOT NULL,
    stock_id        VARCHAR NOT NULL,
    guru            VARCHAR NOT NULL,
    score           DECIMAL(8,4),
    pass_filter     BOOLEAN,
    criteria_detail JSON,
    PRIMARY KEY (score_date, stock_id, guru)
);

CREATE SEQUENCE IF NOT EXISTS seq_strategy_config_history_id;
CREATE TABLE IF NOT EXISTS strategy_config_history (
    config_id       INTEGER DEFAULT nextval('seq_strategy_config_history_id') PRIMARY KEY,
    changed_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    weights         JSON,
    advanced_params JSON,
    guru_config     JSON,
    universe_config JSON,
    changed_by      VARCHAR DEFAULT 'user',
    note            VARCHAR
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

CREATE TABLE IF NOT EXISTS backtest_equity (
    run_id          VARCHAR NOT NULL,
    trade_date      DATE NOT NULL,
    portfolio_value DECIMAL(18,2),
    benchmark_value DECIMAL(18,2),
    drawdown        DECIMAL(8,4),
    PRIMARY KEY (run_id, trade_date)
);

CREATE TABLE IF NOT EXISTS alert_settings (
    key             VARCHAR PRIMARY KEY,
    value           VARCHAR,
    is_sensitive    BOOLEAN DEFAULT FALSE,
    updated_at      TIMESTAMP DEFAULT now()
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

CREATE SEQUENCE IF NOT EXISTS seq_operation_logs_id;
CREATE TABLE IF NOT EXISTS operation_logs (
    id          VARCHAR PRIMARY KEY DEFAULT 'log_' || nextval('seq_operation_logs_id'),
    module      VARCHAR NOT NULL,
    event       VARCHAR NOT NULL,
    severity    VARCHAR NOT NULL,
    created_at  TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_log (
    log_id          VARCHAR PRIMARY KEY,
    stock_id        VARCHAR NOT NULL,
    triggered_at    TIMESTAMP DEFAULT now(),
    pnl             DECIMAL(18,2),
    pnl_pct         DECIMAL(8,4),
    threshold_type  VARCHAR,
    threshold_value DECIMAL(18,2),
    avg_cost        DECIMAL(18,2),
    current_price   DECIMAL(10,2),
    shares          INTEGER,
    sent            BOOLEAN,
    reason          VARCHAR
);
"""


import threading
import time
import structlog

log = structlog.get_logger()

class Database:
    def __init__(self, db_path: str | None = None, read_only: bool = False):
        self.db_path = db_path or os.getenv("DUCKDB_PATH", str(Path.cwd() / "data" / "tw_quant.duckdb"))
        self.read_only = read_only
        self._local = threading.local()
        self._memory_conn: duckdb.DuckDBPyConnection | None = None

    def connect(self, read_only: bool | None = None) -> duckdb.DuckDBPyConnection:
        if read_only is None:
            read_only = self.read_only
        
        # Special handling for :memory:
        if self.db_path == ":memory:":
            if self._memory_conn is None:
                self._memory_conn = duckdb.connect(self.db_path, read_only=read_only)
            return self._memory_conn

        # Ensure file exists if we want read-only
        if read_only and not Path(self.db_path).exists():
            log.info("database.creating_missing_file", path=self.db_path)
            try:
                # Open once in read-write mode to create the file
                duckdb.connect(self.db_path, read_only=False).close()
            except Exception as e:
                log.warning("database.create_file_failed", error=str(e))

        if read_only:
            # Use thread-local connection for read-only to ensure stability
            if not hasattr(self._local, "conn") or self._local.conn is None:
                Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
                self._local.conn = duckdb.connect(self.db_path, read_only=True)
            return self._local.conn

        # For write access, open a new connection with retries
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        for i in range(10):
            try:
                return duckdb.connect(self.db_path, read_only=False)
            except duckdb.IOException as e:
                if "Conflicting lock" in str(e) and i < 9:
                    time.sleep(0.5)
                    continue
                raise

    def close(self):
        if self._memory_conn is not None:
            try: self._memory_conn.close()
            except: pass
            self._memory_conn = None
        if hasattr(self._local, "conn") and self._local.conn is not None:
            try: self._local.conn.close()
            except: pass
            self._local.conn = None

    @contextmanager
    def connection(self, read_only: bool | None = None):
        if self.db_path == ":memory:":
            yield self.connect(read_only=read_only)
            return

        is_ro = read_only if read_only is not None else self.read_only
        if is_ro:
            yield self.connect(read_only=True)
            return

        # Writer connection: open, yield, close
        conn = self.connect(read_only=False)
        try:
            yield conn
        finally:
            conn.close()

    def execute(self, query: str, params: list | None = None, read_only: bool | None = None):
        if read_only is None:
            q = query.strip().upper()
            if any(q.startswith(s) for s in ["INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER"]):
                read_only = False
            else:
                read_only = self.read_only
        
        # This is safe for queries because read-only connections are cached in _local
        return self.connect(read_only=read_only).execute(query, params or [])

    def change_path(self, new_path: str):
        # Validate path
        p = Path(new_path)
        if p.is_dir():
            p = p / "tw_quant.duckdb"
        
        # Security check: avoid sensitive dirs
        abs_p = str(p.absolute())
        if any(bad in abs_p for bad in ["/etc", "/root", "/var/log"]):
            raise ValueError("Invalid or restricted path")

        self.close()
        self.db_path = abs_p
        self.init_db()
        return self.db_path

    def init_db(self):
        # Database initialization always needs write access
        try:
            with self.connection(read_only=False) as conn:
                for stmt in CREATE_TABLES_SQL.strip().split(";"):
                    stmt = stmt.strip()
                    if stmt:
                        conn.execute(stmt + ";")
                conn.commit()
        except (duckdb.IOException, duckdb.ConnectionException) as e:
            # If the database is locked, it's likely another process is already initializing or writing.
            # In a read-only context (like the API), we can often ignore this if the DB exists.
            if "Conflicting lock" in str(e) and Path(self.db_path).exists():
                log.info("database.init_skipped_locked", path=self.db_path)
                return
            log.error("database.init_failed", error=str(e))
            raise
