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
- [即時同步](#即時同步)
- [即時監控](#即時監控)
- [專案結構](#專案結構)

---

## 功能概覽

| 功能 | 說明 |
|------|------|
| **資料擷取** | 從 **TWSE STOCK_DAY_ALL**（主要）、FinMind（備援）、TPEX 自動抓取股價/月營收/財報/本益比/淨值比 |
| **分級桶 ingestion** | 98 個分桶，分批輪詢避免超過 FinMind 免費限額（600 req/day） |
| **大師策略庫** | 支援巴菲特、葛拉漢、歐尼爾等 6 位大師的**篩選器**與**評分因子**實作 |
| **5 大策略因子** | 動能、價值、品質、成長 + **大師評分 (Guru Score)** |
| **綜合評分** | Z-score 標準化 + 權重組合，輸出排名選股 |
| **因子歷史趨勢** | 個股四因子（動能/價值/品質/成長）百分位數走勢 SVG 折線圖 |
| **回測引擎** | 自訂期間/權重，支援交易成本、最大回撤、Sharpe、Calmar、**互動淨值曲線**、**明細交易表** |
| **投組再平衡** | 定期再平衡（月/季），支援部分換股與閾值觸發 |
| **SSE 即時同步** | Server-Sent Events 推送投組異動，前端自動刷新 |
| **REST API** | FastAPI 提供完整 CRUD、評分/回測端點與**系統設定 API** |
| **前端儀表板** | React + TypeScript 全功能 UI，含**日曆日期選取**、**工具提示**、**列印樣式**、即時訊號、**大師預設快選** |
| **告警系統** | 支援 **Telegram Bot** 與 **Email (SMTP)** 損益監控與系統異常通知 |
| **即時監控 (Live)** | 對接 **TWSE MIS API** 進行盤中損益監控，具備冷卻機制避免重複轟炸 |
| **靈活配置** | 支援**環境變數優先級**設定與**動態資料庫路徑**熱切換 |
| **匯出** | CSV / JSON 格式匯出選股訊號（支援欄位自定義） |

---

## 專案進度

**📊 開發任務進度 (86/86)**

| 狀態 | 數量 |
|------|------|
| ✅ 已完成 | 84 |
| 🚧 進行中 | 1 |
| 📋 待處理 | 1 |

---

## 架構

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)           │
│  Dashboard │ Signals │ Stock Detail │ Backtest      │
│  Strategy │ Portfolio │ Monitor │ Settings          │
│  SSE EventSource ← 即時同步                          │
└──────────────────┬──────────────────────────────────┘
                   │ HTTP (localhost:8000 / Vite proxy)
┌──────────────────▼──────────────────────────────────┐
│              FastAPI Backend (Python)                │
│  REST API │ EventBus(SSE) │ Strategy │ Backtest      │
│  Alert Manager │ Response: { data, meta, error }     │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│               DuckDB (單檔資料庫)                     │
│  stocks │ daily_prices │ valuations │ portfolio      │
│  monthly_revenue │ financials │ signals │ alert_log  │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│          Data Sources (擷取來源)                      │
│  TWSE (STOCK_DAY_ALL, 主要) │ FinMind (備援/TPEX)     │
│  TWSE MIS (即時) │ TWSE/TPEX (清單)                  │
│  98 buckets │ 循環機制 │ 健康檢查整合 (Alerting)      │
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

設定 API Token（可至 [FinMind](https://finmindtrade.com/) 申請）：

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
- 建立所有資料表（含 `portfolio`, `alert_log` 等新表）
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

### Docker 開發

```bash
cd ~/Projects/tw-quant-selector
docker compose up -d app frontend
# 前端 http://localhost:5173, API http://localhost:8000
# 程式碼熱更新已掛載 ./src:/app/src
```

---

## 執行腳本 (run.sh)

專案提供 `run.sh` 統一管理所有常用操作，支援 **選單模式** 與 **直接指令模式**。

### 選單模式

```bash
cd ~/Projects/tw-quant-selector
chmod +x run.sh
./run.sh
```

### 直接指令模式

```bash
./run.sh api             # 啟動 API
./run.sh frontend        # 啟動前端
./run.sh test            # 執行測試
./run.sh scheduler       # 執行分片排程擷取
./run.sh pipeline        # 執行完整每日流程 (含健康檢查)
./run.sh live-check      # 執行即時損益監控
./run.sh status          # 顯示系統狀態
```

---

## 資料來源與擷取

### 支援的資料集

| 資料集 | 來源 | 說明 |
|--------|------|------|
| `stocks` | TWSE + TPEX | 台股清單，含 ETF 標記 |
| `daily_prices` | TWSE (主力) + FinMind (備援) | 歷史收盤價、開高低、成交量。TWSE `STOCK_DAY_ALL` 1 次 API 取得全部 ~1361 檔，無速率限制 |
| `live_prices` | TWSE MIS API | **盤中即時成交價**（監控用） |
| `valuations` | FinMind | 本益比、淨值比、殖利率 |
| `monthly_revenue` | FinMind | 月營收與年增率 |
| `financials` | FinMind | 季財報（營收、EPS、ROE、毛利率、負債比） |

### 每日完整流程 (run_daily_pipeline.py)

執行 `python scripts/run_daily_pipeline.py` 會自動跑完以下流程：
1. **同步清單**：從 twstock.codes 更新最新的上市櫃股票代號。
2. **批次擷取**：TWSE主力擷取股價，FinMind備援TPEX與基本面數據。
3. **計算評分**：產出當日選股訊號（含個別因子分數）。
4. **系統檢查**：最後觸發 `AlertChecker` 檢查 Ingestion 狀態與資料庫連線。

---

## 策略架構

### 五大核心策略

| 策略 | 子因子 | 說明 |
|------|--------|------|
| **動能 (Momentum)** | 1m / 3m / 6m / 12m 報酬率 | 追蹤趨勢延續性 |
| **價值 (Value)** | PE、PB、殖利率 | 尋找相對低估值 |
| **品質 (Quality)** | ROE、毛利率、負債比、盈餘穩定性 | 財務體質健檢 |
| **成長 (Growth)** | 營收/EPS 年增率 (YoY) | 獲利成長動能 |
| **大師評分 (Guru)** | 巴菲特、葛拉漢、林區等選股準則 | 專家策略達成率 |

### 大師應用模式

1.  **快速預設 (Preset)**：載入大師建議的 4 大因子權重，附帶藍色反饋提示條。
2.  **評分因子 (Scoring)**：將大師準則轉化為 Z-score 標準化後的評分因子。
3.  **硬性篩選 (Filter)**：僅保留通過大師條件的股票進入後續排名。

### 策略設定持久化

權重、參數、選股範圍自動儲存至 `localStorage`，頁面重整後自動復原。

---

## API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| `GET` | `/api/v1/portfolio` | 取得投組庫存（含即時價格） |
| `POST` | `/api/v1/portfolio` | 新增投組部位（觸發 SSE 廣播） |
| `DELETE` | `/api/v1/portfolio/{stock_id}` | 刪除投組部位（觸發 SSE 廣播） |
| `GET` | `/api/v1/portfolio/events` | **SSE 串流** — 即時監聽投組異動事件 |
| `GET` | `/api/v1/signals` | 指定日期的選股訊號（支援參數化查詢） |
| `GET` | `/api/v1/signals/calendar` | 訊號日期列表（供日曆選擇器） |
| `GET` | `/api/v1/signals/latest` | 最新選股訊號 |
| `GET` | `/api/v1/stock/{id}/factor-history` | 個股四因子歷史趨勢（動能/價值/品質/成長） |
| `GET` | `/api/v1/stock/{id}` | 個股詳細資料（價格/K線/財務/因子分數） |
| `GET` | `/api/v1/dashboard` | 今日總覽儀表板（含排名/庫存/持倉） |
| `GET` | `/api/v1/data/status` | 資料庫健康狀態（含各 dataset 更新時間/🟢🔴🟡) |
| `POST` | `/api/v1/strategies/run` | 執行策略評分（可選參數與大師篩選） |
| `GET` | `/api/v1/strategies/config` | 策略設定與參數 schema |
| `GET` | `/api/v1/backtest/{run_id}/equity` | 回測淨值曲線 |
| `GET` | `/api/v1/backtest/{run_id}/detail` | 回測詳細績效（含交易明細表） |
| `DELETE` | `/api/v1/backtest/{run_id}` | 刪除回測結果 |
| `POST` | `/api/v1/backtest/run` | 執行回測 |
| `GET` | `/api/v1/backtest/history` | 回測歷史紀錄（含設定 diff） |
| `GET` | `/api/v1/monitor/logs` | 監控日誌 |
| `GET` | `/api/v1/monitor/datasets` | 資料集歷史擷取狀態 |
| `GET` | `/api/v1/settings/alerts` | 告警設定 |
| `POST` | `/api/v1/portfolio/alert` | 觸發投組損益告警 |

### SSE 事件格式

```json
data: {"type": "portfolio_update", "data": null}
```

支援事件類型：
- `portfolio_update` — 投組新增/刪除後觸發，前端自動重新載入

---

## 前端儀表板

### 頁面一覽

| 頁面 | 路徑 | 功能 |
|------|------|------|
| **今日總覽** | `/` | 大盤指標、排行、投組摘要、**資料狀態面板（dataset 即時狀態）** |
| **選股訊號** | `/signals` | **日曆日期選取**、因子排名、價格變化（▲▼ 漲跌紅綠）、**工具提示** |
| **個股詳情** | `/stock/:id` | **四因子趨勢折線圖**、K線、財報、分數 |
| **投組追蹤** | `/portfolio` | **SSE 即時同步**、加減碼、損益計算、門檻設定 |
| **回測分析** | `/backtest` | 歷史列表（含設定 diff）、**明細頁面**（7 大指標 + 交易表 + 列印） |
| **策略設定** | `/strategy` | 權重/參數設定、大師預設快選（附反饋條）、**設定持久化** |
| **資料監控** | `/monitor` | 排程日誌、dataset 狀態 |
| **系統設定** | `/settings` | 告警設定、工具提示 |

### 顯示慣例

台股顏色慣例：**漲 = 紅色 ▲**、**跌 = 綠色 ▼**（適用於價格、變化值、列印樣式）

目前的這部分不需要修改，因為變數名稱 `color-bull` 已對應至 `color-negative`（紅色），`color-bear` 已對應至 `color-positive`（綠色）。

---

## 回測

支援自訂策略權重、期間、交易成本。

### 回測結果頁面

- **7 大指標卡**：總報酬率、年化報酬率 (CAGR)、最大回撤 (MDD)、Sharpe Ratio、Calmar Ratio、交易次數、週轉率
- **明細交易表**：每筆交易的進出場日期、價格、損益
- **列印功能**：A4 直向、台股紅漲綠跌配色、重複表頭

---

## Docker

```bash
# 啟動服務
docker compose up -d app frontend

# 執行排程（自動管理 app 生命週期避免 DuckDB 鎖衝突）
docker compose run --rm scheduler --scope TWSE

# 開發模式（原始碼熱更新）
# docker-compose.yml 已掛載 ./src:/app/src，修改 Python 程式碼即時生效
```

### DuckDB 鎖定管理

- 同一時間 **只能有一個寫入者**（app container / scheduler / 本地 API server 不能並行）
- `run.sh` 的 `docker_scheduler()` 自動下線 app → 執行 scheduler → 重新上線 app
- `database.py` 的 `_close_all_ro()` 確保寫入前關閉所有唯讀連線

---

## 測試

```bash
# 執行所有測試
pytest

# 前端型別檢查
cd frontend && npx tsc --noEmit

# 前端建置
cd frontend && npm run build
```

---

## 排程與輪詢

FinMind API 免費方案每日限額 600 次請求，系統將全部台股分為 98 個分桶：

- 每日約處理 2-3 個桶位，完全輪詢一次約需 **1.5 個月**
- 優先處理桶位 000（最大權值股），每日可更新約 **120 檔股票**的基本面數據
- TWSE `STOCK_DAY_ALL` **無速率限制**，1 次 API 呼叫即可取得全部上市股價，作為主要價格來源

---

## 即時同步

系統使用 **Server-Sent Events (SSE)** 實現後端資料庫更新即時通知前端。

```
POST/DELETE portfolio → EventBus.broadcast("portfolio_update")
                              ↓
                    SSE endpoint (GET /api/v1/portfolio/events)
                              ↓
                    Frontend EventSource → refreshPortfolio()
```

- **EventBus**：執行緒安全的 Queue 管理器，支援 sync producer / async consumer
- **Heartbeat**：每 30 秒送出 keep-alive，確保連線穩定
- **Auto-reconnect**：前端 EventSource 內建自動重連，網路中斷後自動恢復
- **事件類型**：`portfolio_update`（投組異動時觸發）

---

## 即時監控 (Live Monitoring)

系統支援盤中即時損益監控，詳情請參閱 [LIVE_MONITORING.md](./LIVE_MONITORING.md)。

- **同步機制**：`scripts/export_portfolio.py` 將資料庫庫存轉為監控 JSON。
- **執行頻率**：建議每 10-15 分鐘執行一次 `scripts/check_live_alerts.py`。
- **智慧告警**：整合冷卻機制 (4 hrs) 與 P/L 門檻判斷。

---

## 專案結構

```
tw-quant-selector/
├── src/
│   └── tw_quant_selector/
│       ├── api/                # FastAPI 路由、SSE EventBus、回應格式
│       ├── backtest/           # 回測引擎核心
│       ├── data/               # 資料存取層 (DuckDB, Clients, Ingestion)
│       │   ├── database.py     # DuckDB 連接管理、跨執行緒鎖定處理
│       │   ├── scheduler.py    # 分桶擷取排程邏輯
│       │   ├── twstock_client.py # TWSE STOCK_DAY_ALL 價格擷取
│       │   └── finmind_client.py # FinMind 基本面與備援價格
│       ├── strategies/         # 量化策略實作
│       │   ├── base.py         # 策略基底、註冊機制、DuckDBDataProvider
│       │   ├── combiner.py     # 綜合評分組合器
│       │   ├── momentum.py     # 動能策略
│       │   ├── value.py        # 價值策略
│       │   ├── quality.py      # 品質策略
│       │   ├── growth.py       # 成長策略
│       │   ├── guru.py         # 大師評分策略
│       │   └── guru_filters.py # 大師篩選器邏輯
│       ├── monitoring/         # 告警與監控 (Alerting, Health Check)
│       └── portfolio/          # 投組與再平衡
├── frontend/                   # React + TypeScript 前端應用
│   └── src/
│       ├── api/client.ts       # 型別化 API 客戶端
│       ├── components/         # 共用元件 (Tooltip, EmptyState, etc.)
│       ├── pages/              # 各頁面組件
│       ├── utils/              # 工具函式 (color.ts, format.ts)
│       └── styles/             # CSS 變數、全域樣式、列印樣式
├── scripts/
│   ├── run_daily_pipeline.py   # 每日完整流程入口
│   ├── run_demo.py             # 初始化資料庫與範例資料
│   ├── export_portfolio.py     # 庫存同步工具
│   ├── check_live_alerts.py    # 即時損益監控腳本
│   └── migrate_portfolio.py    # 資料庫遷移
├── tests/                      # 單元測試與整合測試
├── LIVE_MONITORING.md          # 即時監控使用手冊
├── pyproject.toml
├── docker-compose.yml          # 開發設定（含 src volume mount）
└── README.md
```

---

## Apache License 2.0 授權

本專案僅供個人量化研究與教育用途。資料來源（FinMind、TWSE、TPEX）之使用請遵守各平台之服務條款。
