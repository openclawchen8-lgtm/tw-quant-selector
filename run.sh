#!/usr/bin/env bash
set -euo pipefail

# ─── 設定 ───
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$PROJECT_DIR/.venv"
FRONTEND_DIR="$PROJECT_DIR/frontend"
PYTHON_BIN="$VENV_DIR/bin/python"
UVICORN_BIN="$VENV_DIR/bin/uvicorn"
NPM_BIN="npm"
BG_LOG_DIR="/tmp/tw-quant"

# 載入 .env，並 auto-export 方便子行程讀取
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
fi

mkdir -p "$BG_LOG_DIR"

# ─── 工具函數 ───
info()  { echo -e "\033[36mℹ\033[0m $*"; }
ok()    { echo -e "\033[32m✓\033[0m $*"; }
warn()  { echo -e "\033[33m⚠\033[0m $*"; }
err()   { echo -e "\033[31m✗\033[0m $*"; }
header(){ echo -e "\n\033[1;34m══════════════════════════════════════════\033[0m"; echo -e "  \033[1;37m$*\033[0m"; echo -e "\033[1;34m══════════════════════════════════════════\033[0m"; }

# ─── 背景任務管理 ───
BG_FILE="$BG_LOG_DIR/active"

bg_start() {
  local name="$1" log="$BG_LOG_DIR/$2"
  printf '%s|%s' "$name" "$log" > "$BG_FILE"
  printf '%s|%s\n' "$name" "$log"
}

bg_get() {
  if [ -f "$BG_FILE" ]; then
    local content
    content=$(<"$BG_FILE")
    local name="${content%%|*}"
    local log="${content#*|}"
    local pid_file="$log.pid"
    if [ -f "$pid_file" ] && kill -0 "$(<"$pid_file")" 2>/dev/null; then
      echo "$content"
      return 0
    fi
  fi
  return 1
}

bg_stop() {
  local info
  info=$(bg_get) || return 1
  local log="${info#*|}"
  local pid_file="$log.pid"
  if [ -f "$pid_file" ]; then
    local pid
    pid=$(<"$pid_file")
    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file" "$BG_FILE"
  fi
}

# ─── 畫面工具 ───
MENU_HEIGHT=18

clear_output() {
  local rows
  rows=$(tput lines)
  local i
  for ((i = MENU_HEIGHT; i < rows; i++)); do
    tput cup "$i" 0
    printf '\033[2K'
  done
  tput cup "$MENU_HEIGHT" 0
}

tail_log() {
  local log="$1" lines="${2:-20}"
  if [ -f "$log" ]; then
    tail -n "$lines" "$log" 2>/dev/null
  fi
}

draw_menu() {
  local sel=$1
  tput cup 0 0
  printf '  \033[1;36m🌟 tw-quant-selector 執行選單 \033[0m\n'
  printf '  ─────────────────────────────\n'
  for i in "${!MENU_ITEMS[@]}"; do
    local num=$(( i + 1 ))
    if [ "$i" -eq "$sel" ]; then
      printf '  \033[48;5;229m\033[30m %s) %s \033[0m\n' "$num" "${MENU_ITEMS[$i]}"
    else
      printf '  %s) %s\n' "$num" "${MENU_ITEMS[$i]}"
    fi
  done
  printf '  ─────────────────────────────\n'
  printf '  \033[90m↑↓ 移動  Enter 執行  數字鍵選取  l 看Log  q 離開\033[0m'
}

# ─── 環境檢查 ───
check_venv() {
  if [ -f "$PYTHON_BIN" ]; then
    ok "虛擬環境已啟用: $VENV_DIR"
    return 0
  else
    warn "虛擬環境未啟用 ($VENV_DIR)"
    return 1
  fi
}

check_port() {
  local port=$1
  if lsof -i :"$port" -P -n 2>/dev/null | grep -q LISTEN; then
    return 1
  fi
  return 0
}

# ─── 功能函數 ───

_start_api_bg() {
  check_port 8000 || { err "API Port 8000 已被佔用"; return 1; }
  local log="$BG_LOG_DIR/api.log"
  "$UVICORN_BIN" tw_quant_selector.api.app:app --reload --host 0.0.0.0 --port 8000 >> "$log" 2>&1 &
  local pid=$!
  printf '%d' "$pid" > "$log.pid"
  printf '  ▶ API (PID: %d) → http://localhost:8000\n' "$pid"
  printf '    Docs → http://localhost:8000/docs\n'
}

_start_frontend_bg() {
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    info "安裝前端依賴..."
    (cd "$FRONTEND_DIR" && $NPM_BIN install)
  fi
  check_port 5173 || { err "Frontend Port 5173 已被佔用"; return 1; }
  local log="$BG_LOG_DIR/frontend.log"
  (cd "$FRONTEND_DIR" && $NPM_BIN run dev) >> "$log" 2>&1 &
  local pid=$!
  printf '%d' "$pid" > "$log.pid"
  printf '  ▶ Frontend (PID: %d) → http://localhost:5173\n' "$pid"
}

start_server() {
  header "啟動伺服器 (API + Frontend)"
  check_venv || return 1
  _start_api_bg
  echo ""
  _start_frontend_bg
  ok "伺服器啟動完成"
}

stop_server() {
  header "關閉伺服器"
  local killed=0
  for pat in "uvicorn tw_quant_selector" "vite"; do
    local pid_file="$BG_LOG_DIR/${pat%% *}.pid"
    if [ -f "$pid_file" ]; then
      kill "$(<"$pid_file")" 2>/dev/null && killed=1 || true
      rm -f "$pid_file"
    fi
  done
  pkill -f "uvicorn tw_quant_selector" 2>/dev/null && killed=1 || true
  pkill -f "vite" 2>/dev/null && killed=1 || true
  [ "$killed" -eq 1 ] && ok "伺服器已關閉" || warn "沒有執行中的伺服器"
}

restart_server() {
  header "重啟伺服器"
  stop_server
  echo ""
  start_server
}

run_tests() {
  header "執行測試 (pytest)"
  check_venv || return 1
  "$VENV_DIR/bin/pytest" -v "$@"
}

run_backtest() {
  header "執行回測"
  check_venv || return 1
  "$PYTHON_BIN" -c "
from datetime import date
from tw_quant_selector.data.database import Database
from tw_quant_selector.backtest.engine import run_backtest
db = Database()
metrics = run_backtest(db, date(2020,1,1), date(2024,12,31))
for k, v in metrics.items():
    print(f'  {k}: {v}')
"
}

run_scheduler() {
  header "執行排程器 (Ingest Next Bucket)"
  check_venv || return 1
#  if [ -z "${FINMIND_TOKEN:-}" ]; then
#    echo "❌ 需要設定 FINMIND_TOKEN 環境變數"
#    return 1
#  fi

  # 清除殘留的 scheduler process，避免 DuckDB 鎖衝突
  local old_pids
  old_pids=$(pgrep -f "run_daily_pipeline\.py" 2>/dev/null || true)
  if [ -n "$old_pids" ]; then
    warn "發現殘留 scheduler (PID $old_pids)，強制終止..."
    kill $old_pids 2>/dev/null || true
    sleep 2
    # 確認真的死了，不死就 SIGKILL
    old_pids=$(pgrep -f "run_daily_pipeline\.py" 2>/dev/null || true)
    [ -n "$old_pids" ] && kill -9 $old_pids 2>/dev/null || true
  fi

  # 關掉本機 API server 釋放 DuckDB 鎖
  stop_server 2>/dev/null || true
  sleep 1

  local log="$BG_LOG_DIR/scheduler.log"
  touch "$log"
  "$PYTHON_BIN" "$PROJECT_DIR/scripts/run_daily_pipeline.py" "$@" >> "$log" 2>&1 &
  local pid=$!
  printf '%d' "$pid" > "$log.pid"

  bg_start "scheduler" "scheduler.log" > /dev/null
  printf '  ▶ 排程器 (PID: %d) 已在背景執行\n' "$pid"
  printf '    📄 tail -f %s\n' "$log"
  ok "已啟動，選單可繼續操作"
}

docker_build() {
  header "Docker Build (Compose)"
  docker compose build
  ok "Docker Compose images built successfully"
}

docker_up() {
  header "Docker Compose Up"
  docker compose up -d
  ok "Container started → http://localhost:8000"
}

docker_down() {
  header "Docker Compose Down"
  docker compose down
  ok "Container stopped"
}

docker_scheduler() {
  header "Docker Run Scheduler"
  docker compose down app 2>/dev/null || true
  docker compose run --rm --build scheduler "$@"
  docker compose up -d app
  ok "排程器執行完畢，App 已重啟"
}

show_status() {
  header "系統狀態"
  echo -n "  Python: "
  if check_venv 2>/dev/null; then
    "$PYTHON_BIN" --version
  else
    warn "未啟用"
  fi

  echo -n "  Node:   "
  if command -v node &>/dev/null; then
    ok "$(node --version)"
  else
    warn "未安裝"
  fi

  echo -n "  Docker: "
  if command -v docker &>/dev/null; then
    ok "$(docker --version 2>/dev/null | head -1)"
  else
    warn "未安裝"
  fi

  echo -n "  Port 8000: "
  if check_port 8000; then ok "閒置"; else warn "已佔用"; fi

  echo -n "  Port 5173: "
  if check_port 5173; then ok "閒置"; else warn "已佔用"; fi

  local bg
  bg=$(bg_get) || { ok "無背景任務"; return 0; }
  local name="${bg%%|*}"
  local log="${bg#*|}"
  if [ -f "$log.pid" ]; then
    printf '  ▶ %s (PID: %s) 執行中\n' "$name" "$(<"$log.pid")"
  fi
}

# ─── 光棒選單 ───
MENU_ITEMS=(
  "🚀 啟動伺服器 (API + Frontend)"
  "🔄 重啟伺服器"
  "🛑 關閉伺服器"
  "🧪 執行所有測試"
  "📈 執行回測 (2020-2024)"
  "📡 Docker Run Scheduler"
  "🐳 Docker Build"
  "🐳 Docker Compose Up"
  "🛑 Docker Compose Down"
  "💚 系統狀態"
  "👋 離開"
)

MENU_FUNCS=(start_server restart_server stop_server run_tests run_backtest docker_scheduler docker_build docker_up docker_down show_status)

# 背景執行型（不阻塞選單）
BG_FUNCS_REGEX="^(start_server|restart_server)$"

menu_loop() {
  local sel=0
  local rows=${#MENU_ITEMS[@]}

  tput civis

  while true; do
    # ── 清畫面 + 畫選單（避免 scroll region 造成的錯亂） ──
    clear
    draw_menu "$sel"

    # ── 顯示背景任務狀態與最近 log ──
    local bg_name="" bg_log=""
    if bg_info=$(bg_get 2>/dev/null); then
      bg_name="${bg_info%%|*}"
      bg_log="${bg_info#*|}"
      printf '\n  \033[1;37m▶ %s 背景執行中\033[0m (l=看完整 log, q=離開)\n' "$bg_name"
      tail_log "$bg_log" 5 2>/dev/null | sed 's/^/  /'
    fi

    # ── 讀取按鍵 ──
    tput cup $(( $(tput lines) - 1 )) 0
    local key
    IFS= read -rsn1 key

    # ── 按鍵處理 ──
    if [ "$key" = $'\033' ]; then
      read -rsn2 -t 1 key2 2>/dev/null || true
      case "$key2" in
        '[A') sel=$(( (sel - 1 + rows) % rows )) ;;
        '[B') sel=$(( (sel + 1) % rows )) ;;
      esac
      continue
    elif [ "$key" = "" ]; then
      # Enter → 執行 (若選到離開則直接跳)
      [ "$sel" -eq $((rows - 1)) ] && { tput cnorm; clear; exit 0; }
      :
    elif [ "$key" = "q" ] || [ "$key" = "Q" ]; then
      tput cnorm; clear; exit 0
    elif [ "$key" = "l" ] || [ "$key" = "L" ]; then
      clear
      if [ -n "$bg_name" ]; then
        printf '  \033[1;37m📋 %s 完整輸出:\033[0m\n' "$bg_name"
        tail_log "$bg_log" 50 2>/dev/null
      else
        printf '  ⚠ 沒有執行中的背景任務\n'
      fi
      printf '\n  \033[90m按 Enter 返回選單...\033[0m'
      read -rsn1
      continue
    elif [[ "$key" =~ [0-9] ]]; then
      local idx=$(( key - 1 ))
      [ "$key" = "0" ] && idx=$((rows - 1))
      [ "$idx" -ge 0 ] && [ "$idx" -lt "$rows" ] && sel=$idx || continue
    else
      continue
    fi

    # ── 執行選擇的功能 ──
    clear
    draw_menu "$sel"
    tput cnorm
    "${MENU_FUNCS[$sel]}"

    # ── 前景功能：等 Enter 後才回到選單 ──
    if [[ ! "${MENU_FUNCS[$sel]}" =~ $BG_FUNCS_REGEX ]]; then
      printf '\n  \033[90m按 Enter 返回選單...\033[0m'
      read -rsn1
    fi

    tput civis
    # 回到 while 頂端 → clear + draw_menu + 背景狀態
  done
}

# ─── Main ───

if [ $# -gt 0 ]; then
  case "$1" in
    start|server) start_server ;;
    restart)      restart_server ;;
    stop)         stop_server ;;
    test|tests)   shift; run_tests "$@" ;;
    backtest)     run_backtest ;;
    schedule|scheduler) run_scheduler ;;
    docker-scheduler)  docker_scheduler ;;
    docker-build) docker_build ;;
    docker-up)    docker_up ;;
    docker-down)  docker_down ;;
    status)       show_status ;;
    *)            echo "用法: $0 {start|restart|stop|test|backtest|scheduler|docker-scheduler|docker-build|docker-up|docker-down|status}"; exit 1 ;;
  esac
  exit 0
fi

menu_loop
