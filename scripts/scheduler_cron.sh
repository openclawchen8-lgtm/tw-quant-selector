#!/usr/bin/env bash
# TW Quant Scheduler cron script
# 週一至五 21:00 執行每日資料下載
# Log: ~/logs/scheduler_cron.log

set -e

LOG_DIR="$HOME/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/scheduler_cron.log"

cd /Users/claw/Projects/tw-quant-selector

echo "========================================" >> "$LOG_FILE"
echo "$(date '+%Y-%m-%d %H:%M:%S') Scheduler cron started" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"

FINMIND_TOKEN="${FINMIND_TOKEN:-}" 
if [ -z "$FINMIND_TOKEN" ]; then
    # Try to source from env file
    if [ -f "$HOME/.env_finmind" ]; then
        source "$HOME/.env_finmind"
    fi
fi

if [ -z "$FINMIND_TOKEN" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: FINMIND_TOKEN not set" >> "$LOG_FILE"
    exit 1
fi

source .venv/bin/activate 2>/dev/null || true

FINMIND_TOKEN="$FINMIND_TOKEN" \
    python scripts/run_scheduler.py \
    >> "$LOG_FILE" 2>&1

echo "$(date '+%Y-%m-%d %H:%M:%S') Scheduler cron finished" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"