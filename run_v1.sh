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

# ─── 背景服務管理 ───
BG_FUNCS=()
BG_PIDS=()

bg_pid_of() {
  local func="$1" i
  for i in "${!BG_FUNCS[@]}"; do
    [[ "${BG_FUNCS[$i]}" == "$func" ]] && echo "${BG_PIDS[$i]}" && return 0
  done
  return 1
}

bg_kill_prev() {
  local func="$1" pid
  pid=$(bg_pid_of "$func") || return 0
  kill "$pid" 2>/dev/null || true
}

bg_start() {
  local func="$1"
  local label="${MENU_ITEMS[$sel]%% (*}"
  local logfile="/tmp/tw-quant-${func}-$$.log"
  bg_kill_prev "$func"
  "$func" > "$logfile" 2>&1 &
  local pid=$!
  BG_FUNCS+=("$func")
  BG_PIDS+=("$pid")
  printf '  ▶ %s 已在背景執行 (PID: %d)\n' "$label" "$pid"
  case "$func" in
    start_api)     printf '  \033[90m🔗 http://localhost:8000  |  Docs → http://localhost:8000/docs\033[0m\n' ;;
    start_frontend) printf '  \033[90m🔗 http://localhost:5173\033[0m\n' ;;
  esac
  printf '  \033[90m📄 tail -f %s\033[0m\n' "$logfile"
}

server_names="start_api|start_frontend"

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
  elif [[ "$func_name" =~ ^($server_names)$ ]]; then
    bg_start "$func_name"
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

start_api() {
  header "啟動 API 伺服器 (uvicorn)"
  check_venv || return 1
  check_port 8000 || {
    err "請先關閉佔用 process 後重試"
    return 1
  }
  ok "API → http://localhost:8000"
  ok "Docs → http://localhost:8000/docs"
  "$UVICORN_BIN" tw_quant_selector.api.app:app --reload --host 0.0.0.0 --port 8000
}

start_frontend() {
  header "啟動前端 Dev Server (Vite)"
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    info "安裝前端依賴..."
    (cd "$FRONTEND_DIR" && $NPM_BIN install)
  fi
  check_port 5173 || {
    err "請先關閉佔用 process 後重試"
    return 1
  }
  ok "Frontend → http://localhost:5173"
  (cd "$FRONTEND_DIR" && $NPM_BIN run dev)
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
  "$PYTHON_BIN" -c "
from tw_quant_selector.scheduler import run_daily_pipeline
run_daily_pipeline()
"
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
  if [ ${#BG_FUNCS[@]} -eq 0 ]; then
    ok "無背景服務執行中"
  else
    local i
    for i in "${!BG_FUNCS[@]}"; do
      if kill -0 "${BG_PIDS[$i]}" 2>/dev/null; then
        printf '  ▶ %s: PID %d (執行中)\n' "${BG_FUNCS[$i]}" "${BG_PIDS[$i]}"
      else
        printf '  ◼ %s: 已停止\n' "${BG_FUNCS[$i]}"
      fi
    done
  fi
}

# ─── 光棒選單 ───
MENU_ITEMS=(
  "🚀 啟動 API 伺服器 (uvicorn)"
  "🎨 啟動前端 Dev Server"
  "🧪 執行所有測試"
  "📈 執行回測 (2020-2024)"
  "📡 執行排程器 (Ingest)"
  "🐳 Docker Build"
  "🐳 Docker Compose Up"
  "🛑 Docker Compose Down"
  "💚 系統狀態"
  "👋 離開"
)

MENU_FUNCS=(start_api start_frontend run_tests run_backtest run_scheduler docker_build docker_up docker_down show_status)

CLEAR_LINE="\033[2K\033[G"

draw_menu() {
  local sel=$1
  printf '\n  \033[1;36m🌟 tw-quant-selector 執行選單 \033[0m\n'
  printf '  ─────────────────────────────\n'
  for i in "${!MENU_ITEMS[@]}"; do
    local num=$(( (i + 1) % 10 ))
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
        *) ;;
      esac
    elif [ "$key" = "" ]; then  # Enter
      break
    elif [ "$key" = "q" ] || [ "$key" = "Q" ]; then
      sel=$((rows - 1))
      break
    elif [[ "$key" =~ [0-9] ]]; then
      local idx=$(( key - 1 ))
      if [ "$key" = "0" ]; then
        idx=$((rows - 1))
      fi
      if [ "$idx" -ge 0 ] && [ "$idx" -lt "$rows" ]; then
        sel=$idx
        break
      fi
    fi
    # 回到儲存位置 + 清除到畫面底部 → 無殘影重繪
    printf '\033[u\033[J'
    draw_menu "$sel"
  done
  tput cnorm

  if [ "$sel" -eq $((rows - 1)) ]; then
    echo ""
    exit 0
  fi

  echo ""
  # 在 frame 中執行（tmux 分窗 or inline）
  run_in_frame "${MENU_FUNCS[$sel]}"

  if ! is_in_tmux; then
    echo ""
    read -rp "  按 Enter 返回選單..."
    if command -v tmux &>/dev/null; then
      printf '  \033[90m💡 用 tmux 體驗上下分窗：tmux new-session -A -s tw-quant\n\033[0m'
    fi
  fi
  menu_loop
}

# ─── Main ───

if [ $# -gt 0 ]; then
  # 直接模式: run.sh <command>
  case "$1" in
    api)          start_api ;;
    frontend)     start_frontend ;;
    test|tests)   shift; run_tests "$@" ;;
    backtest)     run_backtest ;;
    schedule|scheduler) run_scheduler ;;
    docker-build) docker_build ;;
    docker-up)    docker_up ;;
    docker-down)  docker_down ;;
    status)       show_status ;;
    *)            echo "用法: $0 {api|frontend|test|backtest|scheduler|docker-build|docker-up|docker-down|status}"; exit 1 ;;
  esac
  exit 0
fi

# 光棒選單模式
menu_loop
