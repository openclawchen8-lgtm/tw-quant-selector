# 台股 + ETF 自動選股系統｜完整規格書 v1.0

---

## 0. 文件目的與範圍

本規格書補全原始需求中未定義的邊界條件，作為 AI 實作的唯一真相來源（Single Source of Truth）。
所有未在本文件定義的行為，實作方須明確回報，不得自行假設。

---

## 1. 系統定位

| 項目 | 定義 |
|------|------|
| 系統名稱 | `tw-quant-selector` |
| 版本 | 1.0.0 |
| 目標用途 | 個人量化研究與回測，非正式交易建議 |
| 授權聲明 | 系統輸出結果不構成投資建議 |

---

## 2. 資料來源規格

### 2.1 主要資料來源

| 資料類型 | 來源 | 方案 | 備注 |
|----------|------|------|------|
| 股價 OHLCV | [FinMind](https://finmindtrade.com/) | 免費方案（每日 600 次請求） | Token 須存於 `.env` |
| 財報資料 | FinMind `TaiwanStockFinancialStatements` | 同上 | 季更新 |
| 月營收 | FinMind `TaiwanStockMonthRevenue` | 同上 | 月更新 |
| 股東持股 | FinMind `TaiwanStockHoldingSharesPer` | 同上 | 週更新 |
| 除權息資料 | FinMind `TaiwanStockDividend` | 同上 | 事件驅動 |
| ETF 成份股 | TWSE 公開資料 (`opendata.twse.com.tw`) | 免費 | 月更新 |
| 上市股票清單 | TWSE `https://opendata.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL` | 免費 | 日更新 |
| 上櫃股票清單 | TPEX `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes` | 免費 | 日更新 |

### 2.2 資料更新 SLA

| 資料集 | 更新頻率 | 最晚到位時間 | 失敗容忍次數 |
|--------|----------|-------------|-------------|
| 日 K 線 | 每個交易日 | 收盤後 19:00 | 連續 3 次失敗觸發告警 |
| 月營收 | 每月 10 日前 | 當月 12 日 00:00 | 1 次失敗觸發告警 |
| 季財報 | 每季結束後 45 日內 | 法定申報截止日 | 1 次失敗觸發告警 |
| ETF 成份 | 每月 | 月初第 2 個交易日 | 1 次失敗觸發告警 |

### 2.3 歷史資料深度

| 資料集 | 起始日期 | 說明 |
|--------|----------|------|
| 日 K 線 | 2010-01-01 | 提供足夠的回測樣本 |
| 財報 | 2010-Q1 | 與 K 線對齊 |
| 月營收 | 2010-01 | 同上 |
| ETF 成份 | 2015-01-01 | FinMind 資料起點 |

### 2.4 停牌 / 下市處理

```
停牌：
  - 當日無成交量記錄，填入前一日收盤價，成交量填 0
  - 連續停牌超過 30 個交易日，從選股宇宙移除
  - 恢復交易後重新納入，需觀察 5 個交易日

下市 / 終止上市：
  - 標記 is_delisted = TRUE，保留歷史資料（回測需用）
  - 下市日期後不再更新該股資料
  - 回測引擎須包含已下市股票（處理倖存者偏差）
```

---

## 3. 選股宇宙（Universe）定義

### 3.1 篩選條件

```
初始宇宙 = 上市股票 ∪ 上櫃股票 ∪ 指定 ETF 清單

靜態篩選（每月第一個交易日重新計算）：
  ├── 市值 > 30 億新台幣（以月底收盤價 × 股本計算）
  ├── 非金融類股（因財務結構不同，單獨處理）
  ├── 非 KY 股（外國企業，資訊透明度不足）
  └── 非全額交割股

動態篩選（每日計算）：
  ├── 近 20 交易日平均日成交金額 > 1,000 萬新台幣
  ├── 當日非停牌狀態
  └── is_delisted = FALSE
```

### 3.2 ETF 清單

以下 ETF 加入選股宇宙，與個股分開追蹤：

| 代號 | 名稱 | 類型 |
|------|------|------|
| 0050 | 元大台灣50 | 市值型 |
| 0051 | 元大中型100 | 市值型 |
| 0052 | 富邦科技 | 產業型 |
| 0056 | 元大高股息 | 股息型 |
| 00878 | 國泰永續高股息 | ESG型 |
| 00881 | 國泰台灣5G+ | 主題型 |
| 006208 | 富邦台50 | 市值型 |

> ETF 選股策略與個股策略分開執行，不混合排名。

### 3.3 宇宙規模預估

| 類別 | 預估標的數 |
|------|-----------|
| 上市個股（篩後） | ~700 |
| 上櫃個股（篩後） | ~400 |
| ETF | 7 |
| 總計 | ~1,107 |

---

## 4. 交易成本模型

所有回測及訊號計算**必須**納入以下成本：

```python
class TransactionCost:
    COMMISSION_RATE = 0.001425   # 0.1425%，買賣雙向
    TAX_RATE_STOCK = 0.003       # 0.3%，賣出時
    TAX_RATE_ETF = 0.001         # 0.1%，ETF 賣出時（減半）
    SLIPPAGE_RATE = 0.001        # 0.1%，買賣各單向（模擬市場衝擊）
    MIN_COMMISSION = 20          # 最低手續費 20 元

def calc_buy_cost(price, shares, is_etf=False):
    """計算買入總成本"""
    value = price * shares
    commission = max(value * COMMISSION_RATE, MIN_COMMISSION)
    slippage = value * SLIPPAGE_RATE
    return value + commission + slippage

def calc_sell_cost(price, shares, is_etf=False):
    """計算賣出淨收入"""
    value = price * shares
    commission = max(value * COMMISSION_RATE, MIN_COMMISSION)
    tax = value * (TAX_RATE_ETF if is_etf else TAX_RATE_STOCK)
    slippage = value * SLIPPAGE_RATE
    return value - commission - tax - slippage
```

---

## 5. 選股策略規格

### 5.1 策略架構

所有策略繼承 `BaseStrategy`，以分數（Score）形式輸出，再透過合成器（Combiner）加權合併。

```
输入: Universe × 因子資料
输出: {stock_id: score} 排行榜，分數越高越好
```

### 5.2 策略一：動能策略（Momentum）

**量化定義：**

```
# 計算 12-1 月動能（排除最近一個月，避免短期反轉）
momentum_score = (close[T-22] / close[T-252]) - 1

# 流動性加權
liquidity_weight = log(avg_volume_20d)

# 最終分數（Z-score 正規化）
momentum_factor = zscore(momentum_score × liquidity_weight)
```

**策略說明：**
- 過去 12 個月（扣除最近 1 個月）報酬率高的股票，未來 1 個月傾向延續上漲
- 採用「12-1 月」是學術上的標準做法，排除短期反轉效應
- 流動性加權確保小市值、難交易的股票不會因為小幅波動而得高分
- Z-score 正規化讓不同策略的分數可以加總比較

**參數：**
| 參數 | 預設值 | 說明 |
|------|-------|------|
| lookback_long | 252 | 長期回顧天數（約1年） |
| lookback_short | 22 | 排除近期天數（約1個月） |
| min_data_days | 252 | 最少需要的資料天數 |

### 5.3 策略二：價值策略（Value）

**量化定義：**

```
# 價值因子（三個指標等權合成）
pb_score    = zscore(-log(pb_ratio))      # 低本淨比 → 高分
pe_score    = zscore(-log(pe_ratio))      # 低本益比 → 高分（僅 PE > 0）
yield_score = zscore(dividend_yield)      # 高殖利率 → 高分

# 合成（缺少任一指標者，用剩餘指標平均）
value_factor = nanmean([pb_score, pe_score, yield_score])
```

**策略說明：**
- 市場對股票的估值常常偏離基本面，被低估的股票長期有超額報酬
- 使用三個互補指標：本淨比（資產面）、本益比（獲利面）、殖利率（現金流量面）
- 取 log 後計算 Z-score，減少極端值影響
- PE 為負（虧損股）時不計入該指標，避免「越虧越便宜」的錯誤邏輯

**參數：**
| 參數 | 預設值 | 說明 |
|------|-------|------|
| max_pb | 30 | 本淨比上限，超過視為資料異常 |
| max_pe | 100 | 本益比上限 |
| min_yield | 0 | 殖利率下限 |

### 5.4 策略三：品質策略（Quality）

**量化定義：**

```
# ROE（股東權益報酬率）—— 衡量獲利能力
roe_score = zscore(roe_ttm)

# 財務槓桿逆指標 —— 低負債比得高分
leverage_score = zscore(-debt_to_equity)

# 毛利率穩定性 —— 近4季毛利率標準差越小越好
gp_stability = zscore(-std(gross_margin_4q))

# 合成
quality_factor = (roe_score × 0.5 + leverage_score × 0.3 + gp_stability × 0.2)
```

**策略說明：**
- 高 ROE 代表公司能有效運用股東資本，是護城河的直接體現
- 低財務槓桿降低系統性風險，在市場下行時提供保護
- 毛利率穩定性排除週期性波動，找出真正具定價能力的公司
- 三者加權合成，ROE 佔比最高因為它綜合了獲利能力與資本效率

**參數：**
| 參數 | 預設值 | 說明 |
|------|-------|------|
| roe_weight | 0.5 | ROE 權重 |
| leverage_weight | 0.3 | 槓桿指標權重 |
| stability_weight | 0.2 | 毛利率穩定性權重 |
| lookback_quarters | 4 | 回顧季數 |

### 5.5 策略四：成長策略（Growth）

**量化定義：**

```
# 月營收年增率（Year-over-Year）
rev_yoy = (revenue_month / revenue_same_month_last_year) - 1

# 近 3 個月 YoY 平均（減少單月異常）
rev_growth_3m = mean(rev_yoy[-3:])

# EPS 季增率（QoQ）
eps_qoq = (eps_q / eps_q_last) - 1

# 合成（營收為主，EPS 為輔）
growth_factor = zscore(rev_growth_3m × 0.6 + eps_qoq × 0.4)
```

**策略說明：**
- 月營收是台股獨特的高頻財務資訊，每月 10 日公布
- YoY（年增率）排除季節性因素，更能反映真實成長
- 使用 3 個月平均，避免「一次性大訂單」造成的假象
- EPS 作為輔助驗證，確認收入成長能轉化為獲利

**參數：**
| 參數 | 預設值 | 說明 |
|------|-------|------|
| rev_weight | 0.6 | 營收成長權重 |
| eps_weight | 0.4 | EPS 成長權重 |
| rev_months | 3 | 營收均值月數 |

### 5.6 策略合成器（Score Combiner）

```
# 預設加權（可在設定檔調整）
STRATEGY_WEIGHTS = {
    "momentum": 0.30,
    "value":    0.25,
    "quality":  0.25,
    "growth":   0.20,
}

# 合成步驟
1. 各策略分別計算因子分數（已 Z-score 正規化）
2. 加權加總：composite_score = Σ(weight_i × factor_i)
3. 再次 Z-score 正規化整體分數
4. 依分數由高到低排序，取前 N 名
```

**信號衝突解決規則：**
- 各策略分數獨立計算，不互相影響
- 加權合成天然處理衝突：某策略得分高、其他低，合成後居中
- 所有因子缺失（無法計算任一分數）的股票，從當日選股中排除

---

## 6. 持倉與再平衡規格

### 6.1 持倉規格

| 參數 | 值 | 說明 |
|------|---|------|
| 個股持倉數 | Top 20 | 分數最高的 20 檔個股 |
| ETF 持倉數 | Top 3 | 分數最高的 3 支 ETF |
| 個股配置方式 | 等權重（1/20 = 5%） | 避免過度集中 |
| ETF 配置方式 | 等權重（1/3） | 同上 |
| 單一持倉上限 | 10% | 即使等權重，加權後不超過 10% |
| 單一產業上限 | 40% | 防止產業集中（以 TWSE 產業分類） |
| 個股 / ETF 資金比例 | 可設定，預設 80% / 20% | |

### 6.2 再平衡規格

```
再平衡頻率：每週一（台股開盤日）
執行時間：開盤後第 5 分鐘（09:05）的開盤價成交（回測用收盤價代替）

換股邏輯：
  新選股清單 = 當週選出的 Top 20
  保留股 = current_portfolio ∩ new_list
  賣出股 = current_portfolio - new_list
  買入股 = new_list - current_portfolio

  # 降低換手率的緩衝設計
  如果 |composite_score(持倉股) - composite_score(候選股)| < threshold(0.5 std),
  則保留持倉股（避免頻繁換股）
```

### 6.3 初始資金設定

| 參數 | 預設值 |
|------|-------|
| 初始資金 | 1,000,000 新台幣 |
| 最小交易單位 | 1 張（1000 股） |
| 無法整張時 | 向下取整張數，剩餘現金保留 |

---

## 7. 回測引擎規格

### 7.1 回測參數

```yaml
backtest:
  start_date: "2015-01-01"
  end_date: "today"  # 動態取當日
  initial_capital: 1_000_000
  benchmark: "0050"   # 基準指數
  frequency: "weekly" # 再平衡頻率
```

### 7.2 倖存者偏差處理

```
回測宇宙定義（關鍵）：
  在 date=T 這一天，只有在 T 日「當時存在」的股票才能進入宇宙
  
  實作方式：
    all_stocks_at_T = stocks WHERE list_date <= T AND (delist_date IS NULL OR delist_date > T)
  
  禁止行為：
    ✗ 用「現在還在交易的股票清單」回套歷史
    ✓ 用「當時存在的股票清單」
```

### 7.3 Look-ahead Bias 防護

```
資料使用規則（任何策略計算必須遵守）：

  交易日 T 的選股決策只能用 T 日「已知」的資料：
    - 日 K 線：T-1 日及以前的收盤價 ✓
    - 月營收：T 日以前「已公布」的最新月份 ✓
    - 季財報：T 日以前「已申報」的最新一季 ✓

  財報發布延遲處理（重要）：
    - 財報申報截止日：
        Q1 (1-3月) → 最晚 5 月 15 日
        Q2 (4-6月) → 最晚 8 月 14 日
        Q3 (7-9月) → 最晚 11 月 14 日
        Q4 (10-12月) → 最晚次年 3 月 31 日
    
    - 回測引擎「不得」在截止日前使用該季財報
    - 即使資料庫中有該資料，也需依 announcement_date 欄位判斷是否可用
```

### 7.4 績效評估指標

回測結果必須輸出以下指標：

```
報酬指標：
  - 總報酬率（Total Return）
  - 年化報酬率（CAGR）
  - 相對基準（0050）超額報酬

風險指標：
  - 年化標準差（Annualized Std Dev）
  - 最大回撤（Max Drawdown）及發生區間
  - 最大回撤恢復時間（Recovery Days）
  - Value at Risk（95% confidence, 1-day）

風險調整報酬：
  - Sharpe Ratio（無風險利率使用台灣一年期定存利率）
  - Sortino Ratio
  - Calmar Ratio（年化報酬 / 最大回撤）
  - Information Ratio（相對基準）

交易統計：
  - 年化換手率（Turnover）
  - 平均持倉期間（天）
  - 勝率（正報酬交易 / 總交易次數）
  - 平均盈虧比（平均獲利 / 平均虧損）
  - 年化交易成本佔比
```

### 7.5 基準比較

| 基準 | 說明 |
|------|------|
| 0050 | 台灣前50大市值，主要比較基準 |
| 大盤（TWII） | 整體市場參考 |
| 定存（1.5%） | 無風險利率下限 |

---

## 8. 資料模型規格

### 8.1 DuckDB Schema

```sql
-- 股票基本資料
CREATE TABLE stocks (
    stock_id        VARCHAR PRIMARY KEY,  -- 如 '2330'
    stock_name      VARCHAR NOT NULL,
    market          VARCHAR NOT NULL,     -- 'TSE'(上市) | 'OTC'(上櫃)
    industry        VARCHAR,              -- TWSE 產業分類
    list_date       DATE,
    delist_date     DATE,                 -- NULL = 仍在交易
    is_etf          BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT now()
);

-- 日K線（調整後股價）
CREATE TABLE daily_prices (
    stock_id        VARCHAR NOT NULL,
    trade_date      DATE NOT NULL,
    open            DECIMAL(10,2),
    high            DECIMAL(10,2),
    low             DECIMAL(10,2),
    close           DECIMAL(10,2),
    volume          BIGINT,               -- 成交股數
    amount          DECIMAL(18,2),        -- 成交金額
    adj_factor      DECIMAL(10,6),        -- 還原係數
    adj_close       DECIMAL(10,4),        -- 還原後收盤價
    PRIMARY KEY (stock_id, trade_date)
);

-- 月營收
CREATE TABLE monthly_revenue (
    stock_id        VARCHAR NOT NULL,
    year_month      VARCHAR NOT NULL,     -- 格式: '2024-01'
    revenue         BIGINT,               -- 千元
    revenue_yoy     DECIMAL(8,4),         -- 年增率
    announcement_date DATE,               -- 實際公告日（用於回測時間點判斷）
    PRIMARY KEY (stock_id, year_month)
);

-- 季財報
CREATE TABLE financials (
    stock_id        VARCHAR NOT NULL,
    year_quarter    VARCHAR NOT NULL,     -- 格式: '2024Q1'
    revenue         BIGINT,
    gross_profit    BIGINT,
    operating_income BIGINT,
    net_income      BIGINT,
    eps             DECIMAL(8,2),
    roe             DECIMAL(8,4),
    roa             DECIMAL(8,4),
    gross_margin    DECIMAL(8,4),
    operating_margin DECIMAL(8,4),
    debt_to_equity  DECIMAL(8,4),
    announcement_date DATE,               -- 申報日（重要：回測用）
    PRIMARY KEY (stock_id, year_quarter)
);

-- 估值指標（每日快照）
CREATE TABLE valuations (
    stock_id        VARCHAR NOT NULL,
    trade_date      DATE NOT NULL,
    pe_ratio        DECIMAL(10,2),        -- 本益比（NULL = 虧損）
    pb_ratio        DECIMAL(10,2),        -- 本淨比
    dividend_yield  DECIMAL(8,4),         -- 殖利率（前12個月股息/現價）
    market_cap      DECIMAL(18,2),        -- 市值（元）
    PRIMARY KEY (stock_id, trade_date)
);

-- 選股結果
CREATE TABLE signals (
    signal_date     DATE NOT NULL,
    stock_id        VARCHAR NOT NULL,
    strategy        VARCHAR NOT NULL,     -- 'momentum'|'value'|'quality'|'growth'|'composite'
    score           DECIMAL(8,4),
    rank            INTEGER,
    is_selected     BOOLEAN,              -- 是否進入當日投組
    PRIMARY KEY (signal_date, stock_id, strategy)
);

-- 回測結果
CREATE TABLE backtest_runs (
    run_id          VARCHAR PRIMARY KEY,  -- UUID
    run_at          TIMESTAMP,
    start_date      DATE,
    end_date        DATE,
    strategy_config JSON,
    total_return    DECIMAL(8,4),
    cagr            DECIMAL(8,4),
    sharpe          DECIMAL(8,4),
    max_drawdown    DECIMAL(8,4),
    calmar          DECIMAL(8,4),
    turnover        DECIMAL(8,4),
    result_path     VARCHAR               -- CSV 存放路徑
);

-- 回測持倉歷史
CREATE TABLE backtest_positions (
    run_id          VARCHAR NOT NULL,
    trade_date      DATE NOT NULL,
    stock_id        VARCHAR NOT NULL,
    action          VARCHAR NOT NULL,     -- 'BUY'|'SELL'|'HOLD'
    shares          INTEGER,
    price           DECIMAL(10,2),
    value           DECIMAL(18,2),
    weight          DECIMAL(8,4),
    PRIMARY KEY (run_id, trade_date, stock_id)
);
```

### 8.2 除權息還原（關鍵）

```python
# adj_close 計算邏輯
# 使用「前復權」（Back-adjusted）方式：
#   以最新股價為基準，向過去調整
#
# 還原係數計算：
#   發生除權息時，adj_factor = close_before_dividend / close_after_dividend
#   所有該日期之前的價格乘以此係數

def calc_adj_factor(stock_id: str, event_date: date) -> float:
    """
    Input:  股票代號、除權息日期
    Output: 還原係數（float）
    """
    ...
```

---

## 9. API 介面規格

### 9.1 RESTful API（FastAPI）

```
基礎 URL：http://localhost:8000/api/v1

健康檢查：
  GET /health
  Output: {"status": "ok", "db_connected": true, "last_update": "2024-01-15T18:00:00"}

選股結果：
  GET /signals/latest
  Query: ?strategy=composite&top_n=20&include_etf=false
  Output: {"date": "...", "stocks": [{"id": "2330", "name": "...", "score": 1.23, "rank": 1}]}

  GET /signals/{date}
  Query: ?strategy=composite
  Output: 同上，指定日期

回測：
  POST /backtest/run
  Body: {"start_date": "2015-01-01", "end_date": "2024-12-31", "strategy_weights": {...}}
  Output: {"run_id": "uuid", "status": "queued"}

  GET /backtest/{run_id}
  Output: {"status": "completed", "metrics": {...}, "download_url": "..."}

資料狀態：
  GET /data/status
  Output: {"last_price_update": "...", "missing_dates": [...], "coverage": {...}}
```

### 9.2 介面定義（未實作資料時的 Stub）

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Protocol

class DataProvider(Protocol):
    """資料提供者介面，允許替換不同資料來源"""
    
    def get_daily_prices(self, stock_id: str, start: date, end: date) -> pd.DataFrame:
        """
        Input:  股票代號、起始日、結束日
        Output: DataFrame [date, open, high, low, close, volume, adj_close]
        """
        ...
    
    def get_universe(self, as_of_date: date) -> list[str]:
        """
        Input:  查詢日期（重要：必須回傳「當時」的宇宙，非現在）
        Output: 股票代號清單
        """
        ...

class StrategyBase(ABC):
    """選股策略基礎類別"""
    
    @abstractmethod
    def compute_score(self, universe: list[str], as_of_date: date) -> dict[str, float]:
        """
        Input:  股票宇宙、計算日期
        Output: {stock_id: score}，分數越高越佳
        """
        ...
    
    @abstractmethod
    def get_required_data(self) -> list[str]:
        """
        Output: 此策略需要的資料集清單（用於依賴檢查）
        """
        ...
```

---

## 10. 告警與監控規格

### 10.1 告警條件

| 告警等級 | 觸發條件 | 通知方式 |
|---------|---------|---------|
| CRITICAL | 資料庫無法連線 | Line Notify + Email |
| CRITICAL | 連續 3 個交易日無法取得股價 | Line Notify + Email |
| HIGH | 選股結果為空（0 個標的） | Line Notify |
| HIGH | 回測引擎執行失敗 | Line Notify |
| MEDIUM | 資料更新延遲超過 SLA | Email |
| LOW | FinMind API 請求數超過 80% 上限 | Log |

### 10.2 通知格式

```
[tw-quant-selector] CRITICAL 資料更新失敗
時間：2024-01-15 19:30:00
模組：data.ingestion.daily_price
錯誤：FinMind API 回傳 429 (Rate Limit)
最後成功：2024-01-12 18:45:00
行動：請確認 FinMind Token 是否有效，或等待 API 配額重置
```

### 10.3 Log 規格

```python
# 所有模組使用統一 structured logging
import structlog

log = structlog.get_logger()
log.info("signal.computed", 
    date="2024-01-15", 
    strategy="composite",
    universe_size=1100,
    selected_count=20,
    duration_ms=1234
)
```

---

## 11. 環境與設定規格

### 11.1 環境變數（`.env`）

```bash
# 資料來源
FINMIND_TOKEN=your_token_here
TWSE_BASE_URL=https://opendata.twse.com.tw/v1
TPEX_BASE_URL=https://www.tpex.org.tw/openapi/v1

# 資料庫
DUCKDB_PATH=/data/tw_quant.duckdb

# 通知
LINE_NOTIFY_TOKEN=your_line_token
ALERT_EMAIL=your_email@example.com

# 排程
SCHEDULER_TIMEZONE=Asia/Taipei
DAILY_UPDATE_CRON="0 18 * * 1-5"   # 週一至週五 18:00
SIGNAL_CRON="30 18 * * 1-5"        # 週一至週五 18:30

# 回測
BACKTEST_OUTPUT_DIR=/output/backtest
```

### 11.2 Python 套件版本鎖定

```toml
[project]
requires-python = ">=3.12"   # 注意：3.14 仍在 alpha，建議 3.12
                              # 若必須用 3.14，需說明相容性風險

dependencies = [
    "duckdb>=0.10.0",
    "pandas>=2.0.0",
    "numpy>=1.26.0",
    "fastapi>=0.110.0",
    "uvicorn>=0.27.0",
    "httpx>=0.27.0",         # 替代 requests，支援 async
    "pydantic>=2.0.0",
    "structlog>=24.1.0",
    "apscheduler>=3.10.0",
    "python-dotenv>=1.0.0",
    "scipy>=1.12.0",          # Z-score 計算
]
```

---

## 12. Docker 規格

```yaml
# docker-compose.yml
version: "3.9"
services:
  app:
    build: .
    environment:
      - FINMIND_TOKEN=${FINMIND_TOKEN}
      - DUCKDB_PATH=/data/tw_quant.duckdb
    volumes:
      - ./data:/data           # DuckDB 持久化
      - ./output:/output       # 回測結果輸出
    ports:
      - "8000:8000"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

---

## 13. 測試規格

### 13.1 測試層級

```
Unit Tests：
  ├── 每個策略的 compute_score() 輸入/輸出格式
  ├── 交易成本計算正確性
  ├── 除權息還原計算正確性
  └── Look-ahead bias 防護（使用 announcement_date 欄位）

Integration Tests：
  ├── FinMind API 連線（使用 mock，不呼叫真實 API）
  ├── DuckDB 讀寫正確性
  └── API endpoint 回應格式

Backtest Sanity Tests：
  ├── 0050（被動投組）回測報酬應與實際 0050 報酬接近（誤差 < 2%）
  ├── 隨機選股回測不應穩定超越大盤（統計顯著性 p > 0.05）
  └── 回測期間內不存在未來資料使用（自動掃描違規）

Regression Tests：
  ├── 固定 random seed，同一策略回測結果應完全可重現
  └── 新增模組不得改變既有模組輸出
```

### 13.2 測試資料

```python
# tests/fixtures/ 目錄提供：
# - 10 檔股票的 2 年假資料（確定性，不依賴真實 API）
# - 已知除權息事件的還原計算答案
# - 各策略的預期輸出（golden file）
```

---

## 14. 已知限制與風險聲明

| 限制 | 說明 | 影響 |
|------|------|------|
| FinMind 免費版限制 | 每日 600 次 API 請求 | 首次全量下載需分批執行（約 3-5 天） |
| Python 3.14 相容性 | 多數套件尚未支援 | **建議降至 3.12**，待套件跟進後升級 |
| 財報延遲 | 有些公司晚申報 | 回測中此段期間資料缺失，用前一季代替 |
| ETF 追蹤誤差 | ETF 淨值 ≠ 市價 | 策略使用市價，溢折價未建模 |
| 台股流動性 | 中小型股買賣價差大 | 0.1% 滑價可能低估實際成本 |

---

*文件版本：v1.0 | 最後更新：2025-05*
*請勿將本系統輸出作為實際投資依據*
