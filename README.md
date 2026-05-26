# tw-quant-selector

台股 + ETF 自動選股系統 — 多因子量化評分、策略組合、投組回測、即時儀表板。

⚠️ 系統輸出結果僅供量化研究參考，**不構成任何投資建議**。

---

## 目錄

- [功能概覽](#功能概覽)
- [架構](#架構)
- [快速開始](#快速開始)
- [執行腳本 (run.sh)](#執行腳本-runsh)
- [資料來源與擷取](#資料來源與擷取)
- [策略架構](#策略架構)
- [API 端點](#api-端點)
- [前端儀表板](#前端儀表板)
- [回測](#回測)
- [Docker](#docker)
- [測試](#測試)
- [排程與輪詢](#排程與輪詢)
- [專案結構](#專案結構)

---

## 功能概覽

| 功能 | 說明 |
|------|------|
| **資料擷取** | 從 FinMind、TWSE、TPEX 自動抓取股價/月營收/財報/本益比/淨值比 |
| **分級桶 ingestion** | 98 個分桶，分批輪詢避免超過 FinMind 免費限額（600 req/day） |
| **4 大策略** | 動能、價值、品質、成長，每策略含多項子因子 |
| **綜合評分** | Z-score 標準化 + 權重組合，輸出排名選股 |
| **回測引擎** | 自訂期間/權重，支援交易成本、最大回撤、Sharpe、Calmar |
| **投組再平衡** | 定期再平衡（月/季），支援部分換股與閾值觸發 |
| **REST API** | FastAPI 提供完整 CRUD 與評分/回測端點 |
| **前端儀表板** | React + TypeScript 全功能 UI，含即時訊號、互動圖表、策略控制 |
| **匯出** | CSV / JSON 格式匯出選股訊號 |

---

## 架構

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)           │
│  Dashboard │ Signals │ Stock Detail │ Backtest      │
│  Strategy │ Portfolio │ Monitor │ Export            │
└──────────────────┬──────────────────────────────────┘
                   │ HTTP (localhost:8000)
┌──────────────────▼──────────────────────────────────┐
│              FastAPI Backend (Python)                │
│  REST API │ Strategy │ Backtest │ Export             │
│  Response wrapper: { data, meta, error }            │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│               DuckDB (單檔資料庫)                     │
│  stocks │ daily_prices │ valuations                  │
│  monthly_revenue │ financials │ signals              │
│  backtest_runs │ ingestion_tracker                   │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│          Data Sources (排程擷取)                      │
│  FinMind │ TWSE │ TPEX                               │
│  98 buckets │ ~10 天循環 │ 600 req/day              │
└─────────────────────────────────────────────────────┘
```

---

## 快速開始

### 1. 環境設定

```bash
cd ~/Projects/tw-quant-selector
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

設定 FinMind API Token（可至 [FinMind](https://finmindtrade.com/) 申請）：

```bash
export FINMIND_TOKEN="your_token_here"
```

### 2. 初始化資料庫

```bash
source .venv/bin/activate
python scripts/run_demo.py
```

此腳本會：
- 建立 `data/tw_quant.duckdb`
- 建立所有資料表
- 下載台股清單（TWSE + TPEX）
- 執行一次桶 000 的價量資料擷取

### 3. 啟動 API 後端

```bash
source .venv/bin/activate
uvicorn tw_quant_selector.api.app:app --reload --port 8000
```

Swagger UI：http://localhost:8000/docs

### 4. 啟動前端

```bash
cd ~/Projects/tw-quant-selector/frontend
npm install
npm run dev
```

瀏覽器開啟 http://localhost:5173

---

## 執行腳本 (run.sh)

專案提供 `run.sh` 統一管理所有常用操作，支援 **選單模式** 與 **直接指令模式**。

### 選單模式

```bash
cd ~/Projects/tw-quant-selector
chmod +x run.sh
./run.sh
```

顯示光棒選單（↑↓ 移動光棒、Enter 執行、數字鍵快速選取、q 離開）：

```
  tw-quant-selector 執行選單
  ─────────────────────────────
   1) 啟動 API 伺服器 (uvicorn)    ← 光棒反白
   2) 啟動前端 Dev Server
   3) 執行所有測試
   4) 執行回測 (2020-2024)
   5) 執行排程器 (Ingest)
   6) Docker Build
   7) Docker Compose Up
   8) Docker Compose Down
   9) 系統狀態
   0) 離開
  ─────────────────────────────
  ↑↓ 移動  Enter 執行  數字鍵快速選取  q 離開
```

### 直接指令模式

```bash
./run.sh api             # 啟動 API
./run.sh frontend        # 啟動前端
./run.sh test            # 執行測試
./run.sh test -k test_backtest -v  # 執行特定測試
./run.sh backtest        # 執行回測
./run.sh scheduler       # 執行排程擷取
./run.sh docker-build    # 建置 Docker image
./run.sh docker-up       # Docker Compose 啟動
./run.sh docker-down     # Docker Compose 停止
./run.sh status          # 顯示系統狀態
```

### 腳本功能

| 功能 | 說明 |
|------|------|
| 自動偵測 | 檢查 `.venv`、Node.js、Docker 是否就緒 |
| Port 檢查 | 啟動前檢查 8000 / 5173 是否被佔用 |
| 安全模式 | 使用 `set -euo pipefail`，錯誤即停止 |
| 錯誤提示 | 顏色區分 ℹ / ✓ / ⚠ / ✗ |

---

## 資料來源與擷取

### 支援的資料集

| 資料集 | 來源 | 說明 |
|--------|------|------|
| `stocks` | TWSE + TPEX | 台股清單，含 ETF 標記（股號以 `00` 開頭且長度 3-4 碼） |
| `daily_prices` | FinMind | 日收盤價、開高低、成交量。FinMind 免費方案不支援批次，故逐檔擷取 |
| `valuations` | FinMind | 本益比、淨值比、殖利率 |
| `monthly_revenue` | FinMind | 月營收與年增率 |
| `financials` | FinMind | 季財報（營收、EPS、ROE、毛利率、負債比） |

### 分級桶擷取 (Bucket-based Ingestion)

為遵守 FinMind 免費方案每日 600 次請求的限制，使用分級桶演算法：

1. 將全市場股票依 `stock_id` 雜湊分配到 **98 個桶**
2. 每排程週期只處理一個桶（約 118 檔股票）
3. 每個桶內逐檔擷取，每檔發 4 次 API 請求（價格/本益比/營收/財報）
4. 無 API key 時自動改以 **TWSE/TPEX 官方 CSV** 補足價格資料
5. HTTP 400/402/404 跳過不重試；其他錯誤最多重試 2 次
6. 率限制監控：達到 80% (480/600) 時輸出警告

完整循環約 **10 天**。

### 每日排程

```bash
# 手動觸發排程器（處理下一個待處理的桶）
python -c "from tw_quant_selector.scheduler import run_daily_pipeline; run_daily_pipeline()"
```

或使用內建排程器背景執行：

```python
from tw_quant_selector.scheduler import start_scheduler
start_scheduler()  # 每 24 小時執行一次
```

---

## 策略架構

### 四大核心策略

每策略皆繼承 `BaseStrategy`，包含多項子因子，最終輸出標準化 Z-score：

| 策略 | 子因子 | 說明 |
|------|--------|------|
| **動能 (Momentum)** | 1m / 3m / 6m / 12m 報酬率、近 5 日相對強度 | 追蹤趨勢延續性 |
| **價值 (Value)** | PE（反向）、PB（反向）、殖利率 | 尋找相對低估值 |
| **品質 (Quality)** | ROE、毛利率、負債比（反向）、盈餘穩定性 | 財務體質健檢 |
| **成長 (Growth)** | 營收年增率（YoY）、EPS 年增率、營收動能 | 獲利成長動能 |

### 綜合評分

1. 各策略內因子先經 **Z-score 標準化**
2. 策略內因子加權平均得策略分數
3. 策略間依權重加權得 **綜合分數**
4. 降冪排序輸出前 N 檔

預設權重：

```
動能 25% | 價值 25% | 品質 25% | 成長 25%
```

可透過 API 或前端動態調整。

### 資料過濾

- **靜態篩選**：排除 ETF、排除特定產業（金融股）、最低市值門檻
- **動態篩選**：暫停交易（暫停 > 5 日）自動排除、已下市剔除
- **除權息調整**：向前調整股價（NaN 安全防護）

---

## API 端點

所有端點回傳標準格式：`{ data, meta: { generated_at, data_as_of, request_id }, error? }`

### 系統

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/health` | 健康檢查 → `{ data: { status, db_connected, last_update }, meta }` |
| GET | `/api/v1/dashboard` | 儀表板統計、資料集追蹤、熱門股 |
| GET | `/api/v1/data/status` | 資料狀態（最後更新日、覆蓋率） |

### 股票

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/stocks/search?q=` | 搜尋股號或名稱 |
| GET | `/api/v1/stock/{id}` | 股票詳情（價量、本益比、財報、月營收） |
| GET | `/api/v1/stock/{id}/factor-history` | 近 52 週因子分數時間序列 |
| GET | `/api/v1/stocks/by_dataset/{dataset}` | 各資料集所涵蓋股票列表 |

### 訊號

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/signals?date=&strategy=&top_n=` | 查詢特定日期訊號 |
| GET | `/api/v1/signals/latest` | 最新選股訊號 |
| GET | `/api/v1/signals/{date}` | 指定日期訊號 |
| GET | `/api/v1/signals/calendar` | 有資料的交易日曆 |
| GET | `/api/v1/signals/export.csv` | 匯出 CSV |
| GET | `/api/v1/signals/export.json` | 匯出 JSON（含 meta） |

### 策略

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/strategies/config` | 取得策略參數結構與預設值 |
| POST | `/api/v1/strategies/run` | 執行策略評分（可自訂權重與參數） |

### 回測

| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | `/api/v1/backtest/run` | 執行回測 |
| GET | `/api/v1/backtest/history` | 回測歷史列表 |
| GET | `/api/v1/backtest/{run_id}` | 回測摘要 |
| GET | `/api/v1/backtest/{run_id}/detail` | 回測完整詳情 |

### 監控

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/monitor/datasets` | 資料集覆蓋率與最後更新時間 |
| GET | `/api/v1/monitor/logs` | 近 7 日操作日誌 |

---

## 前端儀表板

前端為 React + Vite + TypeScript SPA，支援以下頁面：

### 頁面一覽

| 路由 | 頁面 | 說明 |
|------|------|------|
| `/` | **Dashboard** | KPI 卡片、最新選股排行、因子貢獻、週變動、vs 0050 比較 |
| `/signals` | **Signals** | 完整訊號表（排序/篩選/密集模式/分組線）、ETF 切換 |
| `/signals/:id` | **Stock Detail** | 股票詳情（價格圖、PE/PB 表、財報表、月營收、因子走勢） |
| `/portfolio` | **Portfolio** | 模擬持倉（損益 ▲/▼ 著色）、交易歷史、摘要 |
| `/backtest` | **Backtest** | 參數設定、權重滑桿、回測執行、指標網格、年報酬條 |
| `/strategy` | **Strategy** | 四策略權重滑桿、各策略參數編輯、篩選條件、預覽 + 確認 Modal |
| `/monitor` | **Monitor** | 系統健康狀態、資料集表格、操作日誌、缺失資料區塊 |

### 設計特色

- **深色主題**：5 層背景色、4 層文字色、語意顏色（bull/bear/accent）
- **IBM Plex Mono + Syne** 字型，`tabular-nums` 確保數字等寬
- **響應式**：四種斷點（xl 1440 / lg 1024 / md 768 / sm 640），手機版顯示簡化提示
- **鍵盤操作**：↑↓ 移動表格焦點、Enter 展開明細、Esc 收起、Ctrl+B 切換側欄
- **無障礙**：aria-label、role、aria-live polite、▲/▼ 圖示輔助色碼
- **效能**：React.lazy 路由懶加載、TanStack Query 快取、TanStack Table 排序
- **共用元件**：BaseTable、SkeletonLoader、EmptyState、ErrorBoundary、Toast、Tooltip

### 設計系統 CSS 變數

```css
/* 背景 */
--bg-base: #0f172a        /* 最深，最外層頁面背景 */
--bg-surface: #1e293b     /* 卡片/元件表面 */
--bg-elevated: #334155    /* hover/輸入框/互動 */
--bg-overlay: #1e293b     /* 表格表頭/彈出背景 */
--bg-border: #334155      /* 邊框 */

/* 文字 */
--text-primary: #f1f5f9   /* 主要文字 */
--text-secondary: #94a3b8 /* 次要/表頭 */
--text-muted: #64748b     /* 輔助/提示 */
--color-accent: #38bdf8   /* 強調/連結 */

/* 因子色 */
--color-momentum: #a78bfa
--color-value: #34d399
--color-quality: #f59e0b
--color-growth: #38bdf8
```

---

## 回測

### 執行回測

```python
from tw_quant_selector.data.database import Database
from tw_quant_selector.backtest.engine import run_backtest
from datetime import date

db = Database()
db.init_db()
metrics = run_backtest(db, date(2020, 1, 1), date(2024, 12, 31))
print(metrics)
# → { total_return: 1.85, cagr: 0.184, sharpe: 1.24, max_drawdown: -0.283, calmar: 0.65 }
```

### 自訂權重

```python
metrics = run_backtest(
    db, date(2020, 1, 1), date(2024, 12, 31),
    strategy_weights={"momentum": 0.4, "value": 0.3, "quality": 0.2, "growth": 0.1}
)
```

### 產出指標

| 指標 | 說明 |
|------|------|
| `total_return` | 累積報酬率（如 1.85 = +185%） |
| `cagr` | 年化報酬率 |
| `sharpe` | Sharpe Ratio（無風險利率 = 0） |
| `max_drawdown` | 最大回撤（如 -0.283 = -28.3%） |
| `calmar` | Calmar Ratio = CAGR / |Max DD| |

### 內建防護

- **倖存者偏差**：使用回測當時的股票清單，而非今日清單
- **Look-ahead bias**：僅使用回測日期前可取得的資料
- **除權息調整**：向前調整價格，避免殖利率造成的偽報酬

---

## Docker

採用 **multi-stage build**，單一 Docker image 同時包含後端 API 與前端 SPA。

### 建置與啟動

```bash
cd ~/Projects/tw-quant-selector

# 建置（兩階段：Node 編譯前端 → Python 運行 API）
docker compose build

# 啟動（背景模式）
docker compose up -d

# 查看日誌
docker compose logs -f
```

服務運行於 http://localhost:8000 （API + 前端同一 port）

### Multi-stage Build 說明

Dockerfile 分兩階段：

| 階段 | Base Image | 工作內容 | 產出 |
|------|-----------|---------|------|
| `frontend-builder` | `node:20-alpine` | `npm ci` + `npm run build` | `frontend/dist/` |
| 最終 stage | `python:3.12-slim` | `pip install -e .` | API + 前端靜態檔 |

最終 image 只有 Python runtime + 已編譯的靜態檔（83KB gzipped），無需 Node.js。

### 前端如何被提供

當 `frontend/dist` 目錄存在時（Docker 情境），FastAPI 自動：
1. 掛載 `/assets/*` 為靜態檔（CSS / JS / 字型）
2. 根路徑 `/` 回傳 `index.html`（SPA entry）
3. 所有非 API 路徑（如 `/signals`、`/portfolio`）回傳 `index.html`，由 React Router 處理 client-side routing
4. API 路徑（`/api/*`、`/health`）完全不受影響

開發模式下仍使用 Vite dev server（port 5173），API 走 proxy 或直連 port 8000。

### 環境變數

可透過 `docker-compose.yml` 或 `.env` 檔案設定，參考 `.env.example`：

```env
FINMIND_TOKEN=your_token
DUCKDB_PATH=/data/tw_quant.duckdb
```

---

## 測試

```bash
cd ~/Projects/tw-quant-selector
source .venv/bin/activate

# 全部 27 項測試
pytest -v

# 僅測試 API
pytest tests/test_api.py -v

# 僅測試策略
pytest tests/test_strategies.py -v
```

測試涵蓋：
- API 健康檢查與回應格式
- 策略評分與標準化
- 策略參數結構
- 回測引擎

---

## 排程與輪詢

### 背景排程器

```python
from tw_quant_selector.scheduler import start_scheduler

# 啟動排程器（每 24 小時執行一次 ingest_next_bucket）
start_scheduler()
```

### 監控頁輪詢

前端 Monitor 頁面每 **60 秒** 自動重新整理資料狀態，切離頁面時自動清除輪詢（`useEffect` cleanup）。

---

## 專案結構

```
tw-quant-selector/
├── src/
│   └── tw_quant_selector/
│       ├── api/
│       │   └── app.py              # FastAPI 所有端點 + HTML dashboard
│       ├── backtest/
│       │   └── engine.py           # 回測引擎
│       ├── data/
│       │   ├── database.py         # DuckDB 連線/初始化
│       │   ├── finmind_client.py   # FinMind API 客戶端 + rate limiter
│       │   └── twse_tpex.py        # TWSE/TPEX 官方資料
│       ├── strategies/
│       │   ├── base.py             # BaseStrategy 抽象類別
│       │   ├── momentum.py         # 動能策略
│       │   ├── value.py            # 價值策略
│       │   ├── quality.py          # 品質策略
│       │   ├── growth.py           # 成長策略
│       │   └── combiner.py         # 綜合評分 + 權重組合
│       ├── portfolio/
│       │   └── rebalancer.py       # 投組再平衡
│       ├── scheduler.py            # 排程器
│       └── utils.py                # 共用工具
├── frontend/
│   ├── src/
│   │   ├── components/             # 共用元件
│   │   │   ├── BaseTable.tsx       # 泛用表格（排序/鍵盤/虛擬化）
│   │   │   ├── SkeletonLoader.tsx  # 骨架載入
│   │   │   ├── EmptyState.tsx      # 空狀態
│   │   │   ├── ErrorBoundary.tsx   # 錯誤邊界
│   │   │   ├── Toast.tsx           # Toast 通知系統
│   │   │   ├── Tooltip.tsx         # 提示框
│   │   │   ├── ExportModal.tsx     # 匯出設定 Modal
│   │   │   ├── StatCard.tsx        # KPI 卡片
│   │   │   ├── FactorMiniBar.tsx   # 因子進度條
│   │   │   ├── Sidebar.tsx         # 側欄導航
│   │   │   └── Layout.tsx          # 佈局外層
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx       # 儀表板
│   │   │   ├── Signals.tsx         # 選股訊號
│   │   │   ├── StockDetail.tsx     # 股票詳情
│   │   │   ├── Portfolio.tsx       # 投組追蹤
│   │   │   ├── Backtest.tsx        # 回測分析
│   │   │   ├── Strategy.tsx        # 策略設定
│   │   │   └── Monitor.tsx         # 資料監控
│   │   ├── api/client.ts           # API 客戶端
│   │   ├── utils/
│   │   │   ├── format.ts           # 數字格式化
│   │   │   ├── color.ts            # 顏色/圖示輔助
│   │   │   └── responsive.tsx      # 響應式元件
│   │   ├── styles/
│   │   │   ├── variables.css       # 設計系統變數
│   │   │   └── global.css          # 全域樣式
│   │   ├── App.tsx                 # 路由入口
│   │   └── main.tsx                # React 掛載點
│   ├── package.json
│   └── vite.config.ts
├── tasks/                          # 任務追蹤檔案 (T001-T031)
├── scripts/
│   └── run_demo.py                 # 一鍵 demo 腳本
├── tests/
│   ├── test_api.py                 # API 測試
│   ├── test_strategies.py          # 策略測試
│   └── test_backtest.py            # 回測測試
├── data/                           # DuckDB 資料庫 (gitignored)
├── output/                         # 匯出/報告 (gitignored)
├── pyproject.toml
├── docker-compose.yml
├── Dockerfile
└── README.md
```

---

## 授權

本專案僅供個人量化研究與教育用途。資料來源（FinMind、TWSE、TPEX）之使用請遵守各平台之服務條款。
