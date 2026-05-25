---
github_issue: N/A
title: 交易成本模型
type: task
priority: medium
status: pending
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 第 4 章
---

# T11 - 交易成本模型

## 目標
實作交易成本計算模組，含手續費、證交稅、滑價，區分個股與 ETF 稅率。

## 驗收標準
- [ ] `calc_buy_cost(price, shares, is_etf)` 正確計算：`value + commission + slippage`
- [ ] `calc_sell_cost(price, shares, is_etf)` 正確計算：`value - commission - tax - slippage`
- [ ] 手續費率 0.1425%（買賣雙向），最低 20 元
- [ ] 證交稅：個股 0.3%、ETF 0.1%（賣出）
- [ ] 滑價 0.1%（買賣各單向）
- [ ] 單元測試覆蓋邊界條件（小額交易、ETF/個股差異）

## 備註
成本模型在回測與即時訊號計算都需使用。
