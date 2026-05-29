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
- [即時監控](#即時監控)
- [專案結構](#專案結構)

---

## 功能概覽

| 功能 | 說明 |
|------|------|
| **資料擷取** | 從 FinMind、TWSE、TPEX 自動抓取股價/月營收/財報/本益比/淨值比 |
| **分級桶 ingestion** | 98 個分桶，分批輪詢避免超過 FinMind 免費限額（600 req/day） |
| **大師策略庫** | 支援巴菲特、葛拉漢、歐尼爾等 6 位大師的**篩選器**與**評分因子**實作 |
| **5 大策略因子** | 動能、價值、品質、成長 + **大師評分 (Guru Score)** |
| **綜合評分** | Z-score 標準化 + 權重組合，輸出排名選股 |
| **回測引擎** | 自訂期間/權重，支援交易成本、最大回撤、Sharpe、Calmar、**互動淨值曲線** |
| **投組再平衡** | 定期再平衡（月/季），支援部分換股與閾值觸發 |
| **REST API** | FastAPI 提供完整 CRUD、評分/回測端點與**系統設定 API** |
| **前端儀表板** | React + TypeScript 全功能 UI，含**金融終端鍵盤導航**、即時訊號、**大師預設快選** |
| **告警系統** | 支援 **Telegram Bot** 與 **Email (SMTP)** 損益監控與系統異常通知 |
| **即時監控 (Live)** | 對接 **TWSE MIS API** 進行盤中損益監控，具備冷卻機制避免重複轟炸 |
| **靈活配置** | 支援**環境變數優先級**設定與**動態資料庫路徑**熱切換 |
| **匯出** | CSV / JSON 格式匯出選股訊號（支援欄位自定義） |

---

## 專案進度

**📊 開發任務進度 (79/82)**

| 狀態 | 數量 |
|------|------|
| ✅ 已完成 | 79 |
| 🚧 進行中 | 2 |
| 📋 待處理 | 1 |

---

## 架構

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)           │
│  Dashboard │ Signals │ Stock Detail │ Backtest      │
│  Strategy │ Portfolio │ Monitor │ Settings          │
└──────────────────┬──────────────────────────────────┘
                   │ HTTP (localhost:8000)
┌──────────────────▼──────────────────────────────────┐
│              FastAPI Backend (Python)                │
│  REST API │ Strategy │ Backtest │ Alert Manager      │
│  Response wrapper: { data, meta, error }            │
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
│  FinMind (歷史) │ TWSE MIS (即時) │ TWSE/TPEX (清單)  │
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
| `daily_prices` | FinMind | 歷史收盤價、開高低、成交量 |
| `live_prices` | TWSE MIS API | **盤中即時成交價**（監控用） |
| `valuations` | FinMind | 本益比、淨值比、殖利率 |
| `monthly_revenue` | FinMind | 月營收與年增率 |
| `financials` | FinMind | 季財報（營收、EPS、ROE、毛利率、負債比） |

### 每日完整流程 (run_daily_pipeline.py)

執行 `python scripts/run_daily_pipeline.py` 會自動跑完以下流程：
1. **同步清單**：更新最新的上市櫃股票代號。
2. **批次擷取**：抓取當日指定桶位 (Bucket) 的財務數據。
3. **計算評分**：產出當日選股訊號。
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

1.  **快速預設 (Preset)**：載入大師建議的 4 大因子權重。
2.  **評分因子 (Scoring)**：將大師準則轉化為 Z-score 標準化後的評分因子。
3.  **硬性篩選 (Filter)**：僅保留通過大師條件的股票進入後續排名。

---

## 即時監控 (Live Monitoring)

系統支援盤中即時損益監控，詳情請參閱 [LIVE_MONITORING.md](./LIVE_MONITORING.md)。

*   **同步機制**：`scripts/export_portfolio.py` 將資料庫庫存轉為監控 JSON。
*   **執行頻率**：建議每 10-15 分鐘執行一次 `scripts/check_live_alerts.py`。
*   **智慧告警**：整合冷卻機制 (4 hrs) 與 P/L 門檻判斷。

---

## 專案結構

```
tw-quant-selector/
├── src/
│   └── tw_quant_selector/
│       ├── api/                # FastAPI 路由與應用
│       ├── backtest/           # 回測引擎核心
│       ├── data/               # 資料存取層 (DuckDB, Clients, Ingestion)
│       │   ├── scheduler.py    # 分桶擷取排程邏輯
│       │   └── ...
│       ├── strategies/         # 量化策略實作
│       │   ├── guru.py         # 大師評分策略 (新增)
│       │   ├── guru_filters.py # 大師篩選器邏輯 (新增)
│       │   └── ...
│       ├── monitoring/         # 告警與監控 (Alerting, Health Check)
│       └── portfolio/          # 投組與再平衡
├── frontend/                   # React + TypeScript 前端應用
├── scripts/
│   ├── run_daily_pipeline.py   # 每日完整流程入口 (新增檢查)
│   ├── export_portfolio.py     # 庫存同步工具 (新增)
│   ├── check_live_alerts.py    # 即時損益監控腳本 (新增)
│   └── ...
├── tests/                      # 單元測試與整合測試
├── LIVE_MONITORING.md          # 即時監控使用手冊 (新增)
├── pyproject.toml
├── docker-compose.yml
└── README.md
```

---

## Apache License 2.0 授權

本專案僅供個人量化研究與教育用途。資料來源（FinMind、TWSE、TPEX）之使用請遵守各平台之服務條款。
