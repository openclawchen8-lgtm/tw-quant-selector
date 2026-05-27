import os
import smtplib
import time
import uuid
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from typing import Any
import httpx
import structlog

log = structlog.get_logger()


def get_alert_config(db) -> dict[str, Any]:
    # Keys we support
    keys = [
        "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
        "SMTP_SERVER", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD",
        "EMAIL_SENDER", "EMAIL_RECIPIENT",
        "PL_THRESHOLD", "PL_PERCENT_THRESHOLD"
    ]

    db_settings = {r[0]: r[1] for r in db.execute("SELECT key, value FROM alert_settings").fetchall()}
    config = {}
    for k in keys:
        val = os.getenv(k) or db_settings.get(k)
        config[k] = val
    return config


class TelegramNotifier:
    def __init__(self, token: str | None = None, chat_id: str | None = None):
        self.token = token
        self.chat_id = chat_id

    def send(self, message: str):
        if not self.token or not self.chat_id:
            log.warning("alert.telegram.missing_config")
            return
        url = f"https://api.telegram.org/bot{self.token}/sendMessage"
        try:
            resp = httpx.post(url, json={"chat_id": self.chat_id, "text": message}, timeout=10.0)
            resp.raise_for_status()
            log.info("alert.telegram.sent")
        except Exception as e:
            log.error("alert.telegram.failed", error=str(e))


class EmailNotifier:
    def __init__(self, config: dict | None = None):
        self.config = config or {}

    def send(self, subject: str, body: str):
        c = self.config
        server_addr = c.get("SMTP_SERVER")
        port = int(c.get("SMTP_PORT") or 587)
        user = c.get("SMTP_USER")
        pwd = c.get("SMTP_PASSWORD")
        sender = c.get("EMAIL_SENDER") or user
        recipient = c.get("EMAIL_RECIPIENT")

        if not all([server_addr, user, pwd, recipient]):
            log.warning("alert.email.missing_config")
            return

        msg = EmailMessage()
        msg.set_content(body)
        msg["Subject"] = subject
        msg["From"] = sender
        msg["To"] = recipient

        try:
            with smtplib.SMTP(server_addr, port, timeout=15) as server:
                server.starttls()
                server.login(user, pwd)
                server.send_message(msg)
            log.info("alert.email.sent", to=recipient)
        except Exception as e:
            log.error("alert.email.failed", error=str(e))


class AlertManager:
    def __init__(self, db):
        self.db = db
        self._last_alert_time: dict[str, float] = {}
        self.cooldown = 3600 * 4  # 4 hours

    def _should_alert(self, key: str) -> bool:
        now = time.time()
        if key in self._last_alert_time:
            if now - self._last_alert_time[key] < self.cooldown:
                return False
        self._last_alert_time[key] = now
        return True

    def check_pl_alerts(self):
        config = get_alert_config(self.db)

        # Get current portfolio value
        # For simplicity, we assume there is a way to get current P/L
        # In a real system, we would query the portfolio module
        # Here we mock it or query backtest_runs if it's a 'live' run

        # Implementation of P/L check logic...
        # (This would be called from a scheduler)
        pass

    def _log_alert(self, stock_id: str, pnl: float, pnl_pct: float,
                    threshold_type: str, threshold_value: float,
                    avg_cost: float, current_price: float, shares: int,
                    sent: bool, reason: str | None = None):
        try:
            self.db.execute(
                """INSERT INTO alert_log (log_id, stock_id, pnl, pnl_pct, threshold_type, threshold_value,
                                          avg_cost, current_price, shares, sent, reason)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [str(uuid.uuid4()), stock_id, pnl, pnl_pct, threshold_type, threshold_value,
                 avg_cost, current_price, shares, sent, reason]
            )
        except Exception as e:
            log.error("alert.log_failed", error=str(e))

    def handle_pl_alert(self, stock_data: dict) -> dict:
        stock_id = stock_data.get("stock_id", "")
        stock_name = stock_data.get("stock_name", stock_id)
        pnl = stock_data.get("pnl", 0)
        pnl_pct = stock_data.get("pnl_pct", 0)
        threshold_type = stock_data.get("threshold_type", "amount")
        threshold_value = stock_data.get("threshold_value", 0)
        avg_cost = stock_data.get("avg_cost", 0)
        current_price = stock_data.get("current_price", 0)
        shares = stock_data.get("shares", 0)
        alert_enabled = stock_data.get("alert_enabled", True)

        if not alert_enabled:
            self._log_alert(stock_id, pnl, pnl_pct, threshold_type, threshold_value,
                            avg_cost, current_price, shares, sent=False, reason="disabled")
            return {"sent": False, "reason": "disabled"}

        cooldown_key = f"pl_alert:{stock_id}"
        now = time.time()
        if cooldown_key in self._last_alert_time:
            elapsed = now - self._last_alert_time[cooldown_key]
            if elapsed < self.cooldown:
                remaining = self.cooldown - elapsed
                cooldown_until = datetime.fromtimestamp(now + remaining).isoformat()
                self._log_alert(stock_id, pnl, pnl_pct, threshold_type, threshold_value,
                                avg_cost, current_price, shares, sent=False, reason="cooldown")
                return {"sent": False, "reason": "cooldown", "cooldown_until": cooldown_until}
        self._last_alert_time[cooldown_key] = now

        direction = "上漲" if pnl >= 0 else "下跌"
        subject = f"[tw-quant-selector] 個股損益告警 — {stock_name} ({stock_id})"
        message = (
            f"股票：{stock_name} ({stock_id})\n"
            f"損益：{'+' if pnl >= 0 else ''}{pnl:,.0f} 元（{pnl_pct:+.2f}%）\n"
            f"門檻：{threshold_type} {threshold_value}\n"
            f"均價：{avg_cost:,.0f}\n"
            f"現價：{current_price:,.0f}\n"
            f"持有：{shares} 張\n"
            f"方向：{direction}突破門檻"
        )
        try:
            self.send_notification(subject, message)
            sent_ok = True
            reason_val = None
        except Exception as e:
            log.error("alert.pl_alert.send_failed", stock_id=stock_id, error=str(e))
            sent_ok = False
            reason_val = "send_failed"

        self._log_alert(stock_id, pnl, pnl_pct, threshold_type, threshold_value,
                        avg_cost, current_price, shares, sent=sent_ok, reason=reason_val)

        cooldown_until = datetime.fromtimestamp(
            self._last_alert_time.get(cooldown_key, now) + self.cooldown
        ).isoformat() if sent_ok else None
        return {"sent": sent_ok, "cooldown_until": cooldown_until, "reason": reason_val}

    def send_notification(self, subject: str, message: str):
        config = get_alert_config(self.db)

        tg = TelegramNotifier(config.get("TELEGRAM_BOT_TOKEN"), config.get("TELEGRAM_CHAT_ID"))
        tg.send(f"{subject}\n\n{message}")

        em = EmailNotifier(config)
        em.send(subject, message)


class AlertChecker:
    def __init__(self, db):
        self.db = db
        self.manager = AlertManager(db)

    def check_db_connection(self) -> bool:
        try:
            self.db.execute("SELECT 1").fetchone()
            return True
        except Exception as e:
            msg = format_alert("CRITICAL", "database", str(e))
            self.manager.send_notification("[tw-quant-selector] CRITICAL 資料庫無法連線", msg)
            return False

    def check_price_updates(self) -> bool:
        row = self.db.execute("SELECT MAX(trade_date) FROM daily_prices").fetchone()
        if not row or not row[0]:
            return True
        last = row[0]
        if isinstance(last, str):
            last = date.fromisoformat(last)
        days_since = (date.today() - last).days
        if days_since >= 3:
            msg = format_alert("CRITICAL", "data.ingestion.daily_price",
                               f"連續 {days_since} 日未更新股價資料", last_success=last.isoformat())
            self.manager.send_notification("[tw-quant-selector] CRITICAL 股價更新失敗", msg)
            return False
        return True

    def check_signals_empty(self) -> bool:
        row = self.db.execute(
            "SELECT COUNT(*) FROM signals WHERE signal_date = (SELECT MAX(signal_date) FROM signals)"
        ).fetchone()
        if row and row[0] == 0:
            msg = format_alert("HIGH", "signals", "選股結果為空（0 個標的）")
            self.manager.send_notification("[tw-quant-selector] HIGH 選股結果為空", msg)
            return False
        return True

    def check_all(self):
        self.check_db_connection()
        self.check_price_updates()
        self.check_signals_empty()
