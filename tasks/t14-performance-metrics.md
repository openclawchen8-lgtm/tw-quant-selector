---
github_issue: N/A
title: 績效評估指標計算
type: task
priority: medium
status: done
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 7.4, 7.5
---

# T14 - 績效評估指標計算

## 目標
實作報酬指標、風險指標、風險調整報酬、交易統計等完整績效評估模組。

## 驗收標準
- [ ] 報酬指標：總報酬率、CAGR、相對 0050 超額報酬
- [ ] 風險指標：年化標準差、最大回撤（含發生區間）、恢復天數、VaR(95%, 1d)
- [ ] 風險調整：Sharpe Ratio（台灣一年期定存利率）、Sortino Ratio、Calmar Ratio、Information Ratio
- [ ] 交易統計：年化換手率、平均持倉天數、勝率、平均盈虧比、年化交易成本佔比
- [ ] 基準比較：0050、大盤 TWII、定存 1.5%
- [ ] 輸出格式：dict 與 DataFrame 兩種格式
- [ ] 支援多個回測結果比較

## 備註
無風險利率使用台灣一年期定存利率（非美債）。
