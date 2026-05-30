# tw-quant-selector 程式碼審查報告

**審查日期**：2026-05-30  
**審查範圍**：前端 + 後端 + 配置檔  
**審查目標**：找出潛在問題、硬編碼假資料、安全性問題、程式碼品質問題

---

## 執行摘要

| 嚴重程度 | 數量 | 說明 |
|---------|------|------|
| 🔴 嚴重 | 3 | 硬編碼假資料、安全性漏洞 |
| 🟡 中等 | 7 | 潛在 Bug、效能問題 |
| 🟢 輕微 | 5 | 程式碼品質、最佳實踐 |

---

## 🔴 嚴重問題

### 1. Strategy 頁面「大師策略庫」使用硬編碼假資料

**位置**：`frontend/src/pages/Strategy.tsx` 第 83-144 行

**問題描述**：
`GURU_LIST` 中的每個大師條件都有 `passCount` 欄位，顯示「預計篩選通過檔數」，但這些數字是 **完全硬編碼的假資料**，並未實際查詢數據庫。

**假資料範例**：
```typescript
{ name: 'ROE > 15%', source: 'financials', threshold: '>15%', passCount: 420 },
{ name: '負債比 < 50%', source: 'financials', threshold: '<50%', passCount: 380 },
{ name: '毛利率 > 30%', source: 'financials', threshold: '>30%', passCount: 350 },
// ... 所有數字都是亂填的！
```

**影響**：
- 使用者看到「預計通過 420 檔」會誤以為是真的統計數字
- 實際上這些數字沒有任何意義，嚴重誤導使用者

**修復建議**：
1. **移除 `passCount` 欄位**（最簡單）
2. **或新增後端 API** `/api/v1/guru/pass-count`，實際查詢符合每個條件的股票數量
3. 前端改為呼叫 API 取得真實數字

**優先級**：🔥 最高（已建立 T089 處理 `estimateUniverseSize()`，但 `passCount` 也需要處理）

---

### 2. CORS 允許所有來源（安全性漏洞）

**位置**：`src/tw_quant_selector/api/app.py` 第 23-27 行

**問題描述**：
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ⚠️ 允許所有來源！
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**影響**：
- 任何網站都可以透過瀏覽器呼叫您的 API
- 可能導致 CSRF 攻擊
- 敏感資料（Telegram Token、SMTP 密碼）可能被惡意網站讀取

**修復建議**：
```python
allow_origins=[
    "http://localhost:5173",  # 前端開發伺服器
    "http://localhost:3000",  # 如果有 React 開發伺服器
    "https://yourdomain.com",  # 生產環境網域
]
```

**優先級**：🔥 高（安全性問題）

---

### 3. 敏感資訊透過 API 暴露

**位置**：`src/tw_quant_selector/api/app.py` 第 318-341 行

**問題描述**：
`/api/v1/alert-settings` 端點會返回所有 Alert 設定，包括：
- `TELEGRAM_BOT_TOKEN`
- `SMTP_PASSWORD`

雖然前端有標記 `is_sensitive = True` 並顯示為 `****`，但 **API 回傳的 JSON 中仍然包含這些敏感資訊**。

**風險**：
- 任何有權限呼叫 API 的人都能看到這些敏感資訊
- 瀏覽器開發者工具（F12）→ Network → 可以直接看到 Token 和密碼

**修復建議**：
```python
@app.get("/api/v1/alert-settings")
def get_alert_settings():
    db_settings = {r[0]: r[1] for r in db.execute("SELECT key, value FROM alert_settings").fetchall()}
    
    result = []
    for key in ALERT_KEYS:
        is_sensitive = key in SENSITIVE_KEYS
        result.append({
            "key": key,
            "value": "***" if is_sensitive else db_settings.get(key),  # ← 敏感資訊返回 ***
            "is_env_set": key in os.environ,
            "is_sensitive": is_sensitive,
        })
    return api_response(result)
```

**優先級**：🔥 高（安全性問題）

---

## 🟡 中等問題

### 4. `estimateUniverseSize()` 假估算函數

**位置**：`frontend/src/pages/Strategy.tsx` 第 217-234 行

**問題描述**：
此函數使用 **線性縮放公式** 估算篩選後的股票數量，但實際上台股市值分佈是 **冪次法則（Power Law）**，線性公式完全不準確。

**範例**：
```
最低市值：200 億
→ 函數估算：剩 1242 檔
→ 實際數量：約 80-120 檔
```

**影響**：
- 顯示的「篩選結果」數字嚴重誤導
- 使用者會以為篩選後還有 700+ 檔，實際上只有 80 檔

**修復建議**：
- 已建立 **T089**：新增後端 API `/api/v1/universe/count`，實際查詢數據庫

**優先級**：🔥 高（已建立任務）

---

### 5. Backtest 只在前星期一執行再平衡

**位置**：`src/tw_quant_selector/backtest/engine.py` 第 39 行

**問題描述**：
```python
def _rebalance_dates(start: date, end: date) -> list[date]:
    dates: list[date] = []
    d = start
    while d <= end:
        if d.weekday() == 0:  # ← 只在前星期一再平衡
            dates.append(d)
        d += timedelta(days=1)
    return dates
```

**問題**：
- 台股每週有 5 個交易日（週一到週五）
- 只在前星期一再平衡會 **錯過 4 個交易日** 的訊號變化
- 回測結果會與實際情況有較大偏差

**修復建議**：
```python
def _rebalance_dates(start: date, end: date) -> list[date]:
    """每週再平衡（週一），但每天檢查訊號"""
    dates: list[date] = []
    d = start
    while d <= end:
        if d.weekday() < 5:  # 週一到週五都是交易日
            dates.append(d)
        d += timedelta(days=1)
    return dates

# 或：改為每週再平衡，但每天檢查停損停利
```

**優先級**：🟡 中等（影響回測準確性）

---

### 6. `combiner.py` 中 `Decimal` 與 `np.isnan` 混用

**位置**：`src/tw_quant_selector/strategies/combiner.py` 第 156-165 行

**問題描述**：
```python
if strategy != "composite":
    raw = (individual_scores or {}).get(strategy, {}).get(sid)
    if raw is not None and not (isinstance(raw, (float, np.floating)) and np.isnan(raw)):
        score_val = round(Decimal(str(raw)), 4)
    else:
        score_val = None
else:
    if score is None or (isinstance(score, (float, np.floating)) and (math.isnan(score) or np.isnan(score))):
        score_val = None
    else:
        score_val = round(Decimal(str(score)), 4)
```

**問題**：
1. `np.isnan()` 只能用於 `float`，不能用於 `Decimal`
2. 如果 `raw` 是 `Decimal`，`isinstance(raw, (float, np.floating))` 會返回 `False`，導致 `np.isnan()` 不會被執行（這反而是好事）
3. 但程式碼邏輯混亂，難以維護

**修復建議**：
```python
def _safe_decimal(val):
    """安全轉換為 Decimal，處理 NaN/None"""
    if val is None:
        return None
    if isinstance(val, Decimal):
        return val
    if isinstance(val, (float, int)):
        if math.isnan(val):
            return None
        return Decimal(str(val))
    return None

# 使用：
score_val = _safe_decimal(raw)
```

**優先級**：🟡 中等（潛在 Bug）

---

### 7. 前端大量使用 `any` 型別

**位置**：`frontend/src/**/*.tsx` 多個檔案

**問題描述**：
- `BaseTable.tsx`：14 處 `any`
- `SignalRowDetail.tsx`：4 處 `any`
- `Strategy.tsx`：11 處 `any`
- `Backtest.tsx`：5 處 `any`

**影響**：
- TypeScript 型別檢查失效
- 容易出現執行時期錯誤（Runtime Error）
- 重構時難以追蹤型別變更

**修復建議**：
1. 定義明確的 `interface` 或 `type`
2. 避免使用 `as any` 強制轉型
3. 使用 `unknown` 代替 `any`（需要明確型別守衛）

**優先級**：🟢 輕微（程式碼品質）

---

### 8. SQL 查詢使用 f-string（潛在 SQL 注入風險）

**位置**：`src/tw_quant_selector/api/app.py` 第 429-432 行

**問題描述**：
```python
tracker = db.execute(
    f"""SELECT trade_date FROM {t} ORDER BY trade_date DESC LIMIT 5"""
    #    ^^^^ f-string 組裝表名
).fetchall()
```

**風險評估**：
- **目前風險低**：因為 `t` 是硬編碼的 `signals`、`valuations` 等表名，不是使用者輸入
- **但未來風險**：如果有人修改程式碼，傳入使用者輸入的表名，就會有 SQL 注入風險

**修復建議**：
```python
# 方法 1：使用參數化查詢（推薦）
VALID_TABLES = {'signals', 'valuations', 'daily_prices', 'financials'}
if t not in VALID_TABLES:
    raise ValueError(f"Invalid table name: {t}")
tracker = db.execute(
    f"SELECT trade_date FROM {t} ORDER BY trade_date DESC LIMIT 5"
).fetchall()

# 方法 2：使用白名單
ALLOWED_TABLES = ["signals", "valuations", "daily_prices"]
if t in ALLOWED_TABLES:
    query = f"SELECT ... FROM {t} ..."
```

**優先級**：🟡 中等（防禦性程式設計）

---

### 9. 缺少 API 請求參數驗證

**位置**：`src/tw_quant_selector/api/app.py` 多個端點

**問題描述**：
部分 API 端點沒有驗證輸入參數，可能導致異常：

```python
@app.get("/api/v1/signals/{signal_date}")
def signals_by_date(
    signal_date: str,  # ← 沒有驗證格式（應該是 YYYY-MM-DD）
    strategy: str = "composite",
    top_n: int = Query(200, ge=1, le=500),
):
    # 如果 signal_date = "abc"，會導致 SQL 錯誤
    ...
```

**修復建議**：
```python
from datetime import datetime

@app.get("/api/v1/signals/{signal_date}")
def signals_by_date(
    signal_date: str = Path(..., regex="^\d{4}-\d{2}-\d{2}$"),  # ← 驗證格式
    strategy: str = "composite",
    top_n: int = Query(200, ge=1, le=500),
):
    try:
        parsed_date = datetime.strptime(signal_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD")
    ...
```

**優先級**：🟡 中等（穩健性）

---

### 10. DuckDB 連線未使用連線池

**位置**：`src/tw_quant_selector/data/database.py`

**問題描述**：
```python
class Database:
    def __init__(self, read_only: bool = True):
        self.conn = duckdb.connect(DB_PATH, read_only=read_only)
        #   ^^^^ 單一連線，沒有連線池
```

**影響**：
- 高併發時（多個 API 請求同時進來），會有連線衝突
- DuckDB 雖然支援多讀取，但寫入時會 Lock

**修復建議**：
```python
from queue import Queue

class Database:
    def __init__(self, read_only: bool = True, max_connections: int = 10):
        self.read_only = read_only
        self.pool = Queue(maxsize=max_connections)
        for _ in range(max_connections):
            conn = duckdb.connect(DB_PATH, read_only=read_only)
            self.pool.put(conn)
    
    def get_connection(self):
        return self.pool.get()
    
    def return_connection(self, conn):
        self.pool.put(conn)
```

**優先級**：🟢 輕微（目前使用者少，還不需要）

---

## 🟢 輕微問題（程式碼品質）

### 11. 硬編碼的預設參數

**位置**：多個策略檔案

| 檔案 | 硬編碼參數 | 建議 |
|------|------------|------|
| `value.py` | `max_pb=30, max_pe=100` | 應該從資料庫或設定檔讀取 |
| `momentum.py` | `lookback_long=252, lookback_short=22` | 應該開放使用者調整 |
| `quality.py` | `roe_weight=0.5, leverage_weight=0.3` | 應該開放使用者調整 |
| `growth.py` | `rev_weight=0.6, eps_weight=0.4` | 應該開放使用者調整 |

**優先級**：🟢 輕微（功能完整性）

---

### 12. 前端缺少錯誤邊界處理

**位置**：`frontend/src/api/client.ts`

**問題描述**：
```typescript
export async function apiFetch<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);  // ← 只有丟出例外，沒有統一錯誤處理
  }
  return res.json();
}
```

**影響**：
- 每個頁面都要自己寫 `try-catch`
- 如果忘記寫，錯誤會直接顯示在控制台，使用者看不到

**修復建議**：
```typescript
// 統一錯誤處理 + Toast 通知
export async function apiFetch<T>(endpoint: string): Promise<T> {
  try {
    const res = await fetch(`${BASE_URL}${endpoint}`);
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new ApiError(res.status, errorData.message || `API error: ${res.status}`);
    }
    return res.json();
  } catch (error) {
    showToast(`錯誤：${error.message}`, "error");
    throw error;
  }
}
```

**優先級**：🟢 輕微（使用者體驗）

---

### 13. 缺少單元測試

**問題描述**：
- 後端：`tests/` 目錄不存在
- 前端：`__tests__/` 目錄不存在

**影響**：
- 修改程式碼後，無法快速驗證是否破壞現有功能
- 重構風險高

**修復建議**：
1. 新增 `pytest` 測試後端關鍵邏輯（策略計算、回測引擎）
2. 新增 `vitest` 測試前端元件

**優先級**：🟢 輕微（長期維護性）

---

### 14. 日誌（Logging）不一致

**位置**：後端多個檔案

**問題描述**：
- 有些地方用 `print()`
- 有些地方用 `structlog`
- 有些地方完全沒有日誌

**修復建議**：
統一使用 `structlog`：
```python
import structlog
log = structlog.get_logger()

log.info("strategy.computed", strategy="value", stocks=len(scores))
log.error("db.connection_failed", error=str(e))
```

**優先級**：🟢 輕微（除錯便利性）

---

### 15. 前端套件版本過舊

**位置**：`frontend/package.json`

**檢查項目**：
- `react`: ^18.2.0（最新 18.3.1）
- `typescript`: ^5.0.0（最新 5.5.4）
- `@tanstack/react-table`: ^8.9.3（最新 8.20.0）

**建議**：
定期更新套件（但小心 Breaking Changes）

**優先級**：🟢 輕微（功能性不受影響）

---

## 📋 修復優先級建議

### 立即修復（本週內）
1. ✅ **T089**：`estimateUniverseSize()` 假估算 → 新增 API
2. 🔴 **問題 2**：CORS 允許所有來源 → 限制允許網域
3. 🔴 **問題 3**：敏感資訊暴露 → 過濾敏感欄位

### 短期修復（本月內）
4. 🔴 **問題 1**：`passCount` 硬編碼假資料 → 移除或改為真實查詢
5. 🟡 **問題 5**：Backtest 再平衡邏輯 → 改為每日檢查
6. 🟡 **問題 6**：`Decimal` 與 `np.isnan` 混用 → 重構

### 長期優化（下個 sprint）
7. 🟡 **問題 7**：`any` 型別濫用 → 定義明確型別
8. 🟡 **問題 8**：SQL f-string → 加入白名單驗證
9. 🟡 **問題 9**：參數驗證 → 加入 Path/Query 驗證
10. 🟢 **問題 11-15**：程式碼品質提升

---

## 🎯 總結

**最嚴重的問題**：
1. **硬編碼假資料**（`passCount`、`estimateUniverseSize()`）→ 誤導使用者
2. **安全性漏洞**（CORS、敏感資訊暴露）→ 可能被攻擊

**建議下一步**：
1. 先修復安全性問題（CORS、敏感資訊過濾）
2. 然後處理硬編碼假資料（T089 + `passCount`）
3. 最後優化程式碼品質（型別、測試、日誌）

---

**報告產生者**：碼農1號  
**審查工具**：手動程式碼審查 + grep 關鍵字搜尋  
**報告版本**：v1.0  
**下次審查建議**：完成上述修復後，重新審查一次
