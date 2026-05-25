---
github_issue: N/A
title: 資料擷取 - TWSE/TPEX 整合
type: task
priority: high
status: pending
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 第 2 章
---

# T4 - 資料擷取 - TWSE/TPEX 整合

## 目標
實作 TWSE 與 TPEX API 客戶端，取得上市/上櫃股票清單、ETF 成份股清單，並與 FinMind 資料互補。

## 驗收標準
- [ ] `TWSEClient` 支援取得上市股票日行情（`exchangeReport/STOCK_DAY_ALL`）
- [ ] `TPEXClient` 支援取得上櫃股票日收盤行情（`tpex_mainboard_daily_close_quotes`）
- [ ] ETF 成份股可從 TWSE 公開資料取得（`opendata.twse.com.tw`）
- [ ] 取得股票清單後寫入 `stocks` 表格（含市場別 `TSE`/`OTC`、產業分類）
- [ ] 支援 `update_stock_list()` 排程函式（每月第一個交易日執行）
- [ ] 資料更新符合 spec 2.2 SLA

## 備註
TWSE/TPEX 資料為免費、不需 Token，但需注意回應格式可能變動（無版控保證）。
