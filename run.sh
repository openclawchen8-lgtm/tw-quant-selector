#!/usr/bin/env bash
set -euo pipefail

# ─── 設定 ───
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$PROJECT_DIR/.venv"
FRONTEND_DIR="$PROJECT_DIR/frontend"
PYTHON_BIN="$VENV_DIR/bin/python"
UVICORN_BIN="$VENV_DIR/bin/uvicorn"
NPM_BIN="npm"

# ─── 工具函數 ───
info()  { echo -e "\033[36mℹ\033[0m $*"; }
ok()    { echo -e "\033[32m✓\033[0m $*"; }
warn()  { echo -e "\033[33m⚠\033[0m $*"; }
err()   { echo -e "\033[31m✗\033[0m $*"; }
header(){ echo -e "\n\033[1;34m══════════════════════════════════════════\033[0m"; echo -e "  \033[1;37m$*\033[0m"; echo -e "\033[1;34m══════════════════════════════════════════\033[0m"; }

# ─── tmux frame 支援 ───
is_in_tmux()  { [ -n "${TMUX:-}" ]; }

# ─── 服務管理 ───
check_is_running() {
  local pat="$1" name="$2"
  if pgrep -f "$pat" >/dev/null 2>&1; then
    echo "$(pgrep -f "$pat" | head -1)"
    return 0
  fi
  return 1
}

server_names=""

run_in_frame() {
  local func_name="$1"
  if is_in_tmux; then
    local tmp
    tmp=$(mktemp /tmp/tw-quant-XXXX.sh)
    {
      printf '#!/usr/bin/env bash\nset -uo pipefail\n'
      printf 'cd %q\n' "$PROJECT_DIR"
      printf 'PROJECT_DIR=%q\n' "$PROJECT_DIR"
      printf 'VENV_DIR=%q\n' "$VENV_DIR"
      printf 'FRONTEND_DIR=%q\n' "$FRONTEND_DIR"
      printf 'PYTHON_BIN=%q\n' "$PYTHON_BIN"
      printf 'UVICORN_BIN=%q\n' "$UVICORN_BIN"
      printf 'NPM_BIN=%q\n' "$NPM_BIN"
      declare -f info ok warn err header check_venv check_port
      declare -f "$func_name"
      printf '%q\n' "$func_name"
      printf 'echo ""\n'
      printf 'read -p "  按 Enter 關閉此窗格..."\n'
    } > "$tmp"
    chmod +x "$tmp"
    tmux split-window -v -l 40% "$tmp"
  else
    "$func_name"
  fi
}

# ─── 環境檢查 ───
check_venv() {
  if [ -f "$PYTHON_BIN" ]; then
    ok "虛擬環境已啟用: $VENV_DIR"
    return 0
  else
    warn "虛擬環境未啟用 ($VENV_DIR)"
    warn "執行: source .venv/bin/activate"
    return 1
  fi
}

check_port() {
  local port=$1
  if lsof -i :"$port" -P -n 2>/dev/null | grep -q LISTEN; then
    warn "Port $port 已被佔用"
    return 1
  fi
  return 0
}

# ─── 功能函數 ───

_start_api_bg() {
  check_port 8000 || { err "API Port 8000 已被佔用"; return 1; }
  local log_api="/tmp/tw-quant-api-$$.log"
  "$UVICORN_BIN" tw_quant_selector.api.app:app --reload --host 0.0.0.0 --port 8000 > "$log_api" 2>&1 &
  printf '  ▶ API (PID: %d) → http://localhost:8000\n' "$!"
  printf '    Docs → http://localhost:8000/docs\n'
  printf '    📄 tail -f %s\n' "$log_api"
}

_start_frontend_bg() {
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    info "安裝前端依賴..."
    (cd "$FRONTEND_DIR" && $NPM_BIN install)
  fi
  check_port 5173 || { err "Frontend Port 5173 已被佔用"; return 1; }
  local log_fe="/tmp/tw-quant-frontend-$$.log"
  (cd "$FRONTEND_DIR" && $NPM_BIN run dev) > "$log_fe" 2>&1 &
  printf '  ▶ Frontend (PID: %d) → http://localhost:5173\n' "$!"
  printf '    📄 tail -f %s\n' "$log_fe"
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
  pkill -f "uvicorn tw_quant_selector" 2>/dev/null && { ok "API 已停止"; killed=1; } || warn "API 未執行"
  pkill -f "vite" 2>/dev/null && { ok "Frontend 已停止"; killed=1; } || warn "Frontend 未執行"
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
  info "使用預設參數: 2020-01-01 ~ 2024-12-31"
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
  if [ -z "$FINMIND_TOKEN" ]; then
    echo "❌ 需要設定 FINMIND_TOKEN 環境變數"
    return 1
  fi
  "$PYTHON_BIN" "$PROJECT_DIR/scripts/run_daily_pipeline.py" "$@"
}

docker_build() {
  header "Docker Build (multi-stage)"
  docker build -t tw-quant-selector "$PROJECT_DIR"
  ok "Image built: tw-quant-selector"
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
  check_port 8000 && ok "閒置" || warn "已佔用"

  echo -n "  Port 5173: "
  check_port 5173 && ok "閒置" || warn "已佔用"

  # 背景服務
  echo -n "  API: "
  if pgrep -f "uvicorn tw_quant_selector" >/dev/null 2>&1; then
    ok "執行中 (PID: $(pgrep -f 'uvicorn tw_quant_selector' | head -1))"
  else
    warn "未執行"
  fi
  echo -n "  Frontend: "
  if pgrep -f "vite" >/dev/null 2>&1; then
    ok "執行中 (PID: $(pgrep -f 'vite' | head -1))"
  else
    warn "未執行"
  fi
}

# ─── 光棒選單 ───
MENU_ITEMS=(
  "🚀 啟動伺服器 (API + Frontend)"
  "🔄 重啟伺服器"
  "🛑 關閉伺服器"
  "🧪 執行所有測試"
  "📈 執行回測 (2020-2024)"
  "📡 執行排程器 (Ingest)"
  "🐳 Docker Build"
  "🐳 Docker Compose Up"
  "🛑 Docker Compose Down"
  "💚 系統狀態"
  "👋 離開"
)

MENU_FUNCS=(start_server restart_server stop_server run_tests run_backtest run_scheduler docker_build docker_up docker_down show_status)

CLEAR_LINE="\033[2K\033[G"

draw_menu() {
  local sel=$1
  printf '\n  \033[1;36m🌟 tw-quant-selector 執行選單 \033[0m\n'
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
  printf '  \033[90m↑↓ 移動  Enter 執行  數字鍵快速選取  q 離開\033[0m\n'
}

menu_loop() {
  local sel=0
  local rows=${#MENU_ITEMS[@]}
  tput civis  # 隱藏游標
  printf '\033[s'  # 儲存游標位置（選單起點）
  draw_menu "$sel"

  while true; do
    IFS= read -rsn1 key
    if [ "$key" = $'\033' ]; then
      read -rsn2 -t 1 key2 2>/dev/null || true
      case "$key2" in
        '[A')  sel=$(( (sel - 1 + rows) % rows )) ;;
        '[B')  sel=$(( (sel + 1) % rows )) ;;
        '[C'|'[D') ;;
        *)     continue ;;
      esac
      # 重繪後繼續等待按鍵
      printf '\033[u\033[J'
      draw_menu "$sel"
      continue
    elif [ "$key" = "" ]; then  # Enter
      :
    elif [ "$key" = "q" ] || [ "$key" = "Q" ]; then
      sel=$((rows - 1))
      :
    elif [[ "$key" =~ [0-9] ]]; then
      local idx=$(( key - 1 ))
      if [ "$key" = "0" ]; then
        idx=$((rows - 1))
      fi
      if [ "$idx" -ge 0 ] && [ "$idx" -lt "$rows" ]; then
        sel=$idx
        :
      fi
    else
      continue
    fi

    # 離開
    if [ "$sel" -eq $((rows - 1)) ]; then
      printf '\033[u\033[J'
      tput cnorm
      echo ""
      exit 0
    fi

    # 清除選單並執行
    printf '\033[u\033[J'
    tput cnorm
    echo ""
    run_in_frame "${MENU_FUNCS[$sel]}"

    if ! is_in_tmux; then
      echo ""
      read -rp "  按 Enter 返回選單..."
      if command -v tmux &>/dev/null; then
        printf '  \033[90m💡 用 tmux 體驗上下分窗：tmux new-session -A -s tw-quant\n\033[0m'
      fi
    fi

    # 重繪選單
    tput civis
    printf '\033[s'
    draw_menu "$sel"
  done
}

# ─── Main ───

if [ $# -gt 0 ]; then
  # 直接模式: run.sh <command>
  case "$1" in
    start|server) start_server ;;
    restart)      restart_server ;;
    stop)         stop_server ;;
    test|tests)   shift; run_tests "$@" ;;
    backtest)     run_backtest ;;
    schedule|scheduler) run_scheduler ;;
    docker-build) docker_build ;;
    docker-up)    docker_up ;;
    docker-down)  docker_down ;;
    status)       show_status ;;
    *)            echo "用法: $0 {start|restart|stop|test|backtest|scheduler|docker-build|docker-up|docker-down|status}"; exit 1 ;;
  esac
  exit 0
fi

# 光棒選單模式
menu_loop
