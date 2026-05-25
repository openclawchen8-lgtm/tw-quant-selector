---
github_issue: N/A
title: 持倉管理與再平衡模組
type: task
priority: high
status: pending
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 第 6 章
---

# T12 - 持倉管理與再平衡模組

## 目標
實作持倉資料結構、再平衡邏輯（每週一 09:05）、換股緩衝區、資金分配、產業上限控管。

## 驗收標準
- [ ] `Portfolio` class 管理持倉：股票代號、股數、均價、權重、當前市值
- [ ] 再平衡頻率：每週一開盤日（回測用收盤價）
- [ ] 換股邏輯：`保留股 = current ∩ new`, `賣出股 = current - new`, `買入股 = new - current`
- [ ] 緩衝設計：若 `|composite_score(持倉) - composite_score(候選)| < 0.5 std` 則保留
- [ ] 個股等權重（1/20=5%），ETF 等權重（1/3），資金比例 80%/20%（可設定）
- [ ] 單一持倉上限 10%，單一產業上限 40%
- [ ] 最小交易單位 1 張（1000 股），無法整張時向下取整，現金保留
- [ ] 初始資金 1,000,000 新台幣

## 備註
緩衝設計可降低換手率與交易成本。產業分類以 TWSE 分類為準。
