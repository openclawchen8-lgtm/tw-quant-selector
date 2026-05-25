import os
import smtplib
from datetime import date, datetime, timedelta
from email.message import EmailMessage
import httpx
import structlog

log = structlog.get_logger()


class LineNotifier:
    def __init__(self, token: str | None = None):
        self.token = token or os.getenv("LINE_NOTIFY_TOKEN", "")

    def send(self, message: str):
        if not self.token:
            log.warning("alert.line_notify.no_token")
            return
        httpx.post(
            "https://notify-api.line.me/api/notify",
            headers={"Authorization": f"Bearer {self.token}"},
            data={"message": message},
        )
        log.info("alert.line_notify.sent")


class EmailNotifier:
    def __init__(self, recipient: str | None = None):
        self.recipient = recipient or os.getenv("ALERT_EMAIL", "")

    def send(self, subject: str, body: str):
        if not self.recipient:
            log.warning("alert.email.no_recipient")
            return
        msg = EmailMessage()
        msg.set_content(body)
        msg["Subject"] = subject
        msg["To"] = self.recipient
        log.info("alert.email.sent", to=self.recipient, subject=subject)


def format_alert(level: str, module: str, error: str, last_success: str | None = None) -> str:
    lines = [
        f"[tw-quant-selector] {level}",
        f"時間：{datetime.now():%Y-%m-%d %H:%M:%S}",
        f"模組：{module}",
        f"錯誤：{error}",
    ]
    if last_success:
        lines.append(f"最後成功：{last_success}")
    lines.append("行動：請確認系統狀態")
    return "\n".join(lines)


class AlertChecker:
    def __init__(self, db, line_notifier: LineNotifier | None = None,
                 email_notifier: EmailNotifier | None = None):
        self.db = db
        self.line = line_notifier or LineNotifier()
        self.email = email_notifier or EmailNotifier()

    def check_db_connection(self) -> bool:
        try:
            self.db.execute("SELECT 1").fetchone()
            return True
        except Exception as e:
            msg = format_alert("CRITICAL", "database", str(e))
            self.line.send(msg)
            self.email.send("[tw-quant-selector] CRITICAL 資料庫無法連線", msg)
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
            self.line.send(msg)
            self.email.send("[tw-quant-selector] CRITICAL 股價更新失敗", msg)
            return False
        return True

    def check_signals_empty(self) -> bool:
        row = self.db.execute(
            "SELECT COUNT(*) FROM signals WHERE signal_date = (SELECT MAX(signal_date) FROM signals)"
        ).fetchone()
        if row and row[0] == 0:
            msg = format_alert("HIGH", "signals", "選股結果為空（0 個標的）")
            self.line.send(msg)
            return False
        return True

    def check_all(self):
        self.check_db_connection()
        self.check_price_updates()
        self.check_signals_empty()
