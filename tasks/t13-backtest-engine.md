---
github_issue: N/A
title: 回測引擎（含倖存者偏差 / Look-ahead bias 防護）
type: task
priority: high
status: pending
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 第 7 章
---

# T13 - 回測引擎（含倖存者偏差 / Look-ahead bias 防護）

## 目標
實作事件驅動回測引擎，支援每週再平衡、存活者偏差防護（僅用當時存在股票）、Look-ahead bias 防護（財報依 announcement_date 延遲使用）。

## 驗收標準
- [ ] 回測參數可設定：`start_date`, `end_date`, `initial_capital`, `benchmark`, `frequency`
- [ ] 倖存者偏差防護（spec 7.2）：`all_stocks_at_T = stocks WHERE list_date <= T AND (delist_date IS NULL OR delist_date > T)`
- [ ] Look-ahead bias 防護（spec 7.3）：財報僅在 `announcement_date` 後才可使用
- [ ] 支援 benchmark 比較（預設 0050）
- [ ] 回測結果寫入 `backtest_runs` 與 `backtest_positions` 表格
- [ ] 日誌輸出每個 rebalance 日的買賣動作
- [ ] 支援中斷續跑（checkpoint 機制）
- [ ] 回測結果可完全重現（fix random seed）

## 備註
此為整個系統最關鍵的模組。偏差防護做錯會導致回測結果樂觀偏誤。
