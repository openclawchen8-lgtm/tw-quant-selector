---
github_issue: N/A
title: 除權息還原模組
type: task
priority: high
status: pending
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 8.2
---

# T5 - 除權息還原模組

## 目標
實作「前復權」股價還原邏輯：計算 `adj_factor` 與 `adj_close`，寫入 `daily_prices` 表格。

## 驗收標準
- [ ] `calc_adj_factor()` 依 spec 8.2 公式計算還原係數
- [ ] `calc_adj_close()` 對歷史股價進行前復權
- [ ] 使用 FinMind `TaiwanStockDividend` 作為除權息事件來源
- [ ] `daily_prices.adj_close` 欄位正確填寫
- [ ] 還原後股價不會因除權息產生跳空（可視化驗證）
- [ ] 支援增量更新（僅處理新增的除權息事件）

## 備註
前復權方式：以最新股價為基準，向過去調整。除權息還原正確性對回測至關重要。
