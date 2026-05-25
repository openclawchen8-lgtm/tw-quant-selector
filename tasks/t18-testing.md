---
github_issue: N/A
title: 測試框架與測試案例
type: task
priority: high
status: pending
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 第 13 章
---

# T18 - 測試框架與測試案例

## 目標
建立完整測試套件：Unit Tests（策略、成本、還原、bias 防護）、Integration Tests（API、DB）、Backtest Sanity Tests、Regression Tests。提供測試假資料（fixtures）。

## 驗收標準
- [ ] Unit Tests 覆蓋策略 `compute_score()` 輸入/輸出格式
- [ ] Unit Tests 覆蓋交易成本計算正確性
- [ ] Unit Tests 覆蓋除權息還原計算正確性
- [ ] Unit Tests 覆蓋 Look-ahead bias 防護（announcement_date 邏輯）
- [ ] Integration Tests：FinMind API mock、DuckDB 讀寫、API endpoint 回應格式
- [ ] Backtest Sanity Tests：0050 被動投組誤差 < 2%、隨機選股不穩定超越大盤
- [ ] Regression Tests：固定 seed 可完全重現、新增模組不改既有輸出
- [ ] `tests/fixtures/` 提供 10 檔股票的 2 年假資料 + 已知除權息事件答案 + golden files
- [ ] `pytest` 可一鍵執行全部測試

## 備註
測試資料必須是確定性假資料，不依賴真實 API。pytest-cov 可選。
