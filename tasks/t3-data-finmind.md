---
github_issue: N/A
title: 資料擷取 - FinMind 整合
type: task
priority: high
status: done
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 第 2 章
---

# T3 - 資料擷取 - FinMind 整合

## 目標
實作 FinMind API 客戶端，擷取股價 OHLCV、財報、月營收、股東持股、除權息資料，支援分批下載以避免每日 600 次限制。

## 驗收標準
- [ ] `FinMindClient` 支援 `get_daily_prices()`, `get_financials()`, `get_monthly_revenue()`, `get_shareholding()`, `get_dividend()` 方法
- [ ] 使用 `FINMIND_TOKEN` 進行認證，Token 存入 `.env`
- [ ] 支援日期範圍查詢，非全量下載
- [ ] 自備 rate limiter（如每日配額接近 80% 時 log 警告）
- [ ] 失敗重試機制（retry 3 次，exponential backoff）
- [ ] 資料落地至 DuckDB（upsert 語意）
- [ ] 提供 `update_daily_prices()`, `update_monthly_revenue()`, `update_financials()` 等排程用函式
- [ ] 歷史資料深度符合 spec 2.3（日 K 線自 2010-01-01）

## 備註
FinMind 免費方案每日僅 600 次請求，首次全量下載需分批約 3-5 天。反洗錢注意 API Token 不可寫死。
