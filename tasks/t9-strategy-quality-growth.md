---
github_issue: N/A
title: 品質策略與成長策略實作
type: task
priority: high
status: pending
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 5.4, 5.5
---

# T9 - 品質策略與成長策略實作

## 目標
實作 Quality Strategy（ROE × 0.5 + 低負債 × 0.3 + 毛利率穩定性 × 0.2）與 Growth Strategy（營收年增率 × 0.6 + EPS 季增率 × 0.4）。

## 驗收標準
### Quality
- [ ] ROE score = `zscore(roe_ttm)`
- [ ] 槓桿 score = `zscore(-debt_to_equity)`
- [ ] 毛利率穩定性 = `zscore(-std(gross_margin_4q))`，至少需 4 季資料
- [ ] 合成權重正確：ROE×0.5, 槓桿×0.3, 穩定性×0.2

### Growth
- [ ] 月營收年增率：`(revenue_month / revenue_same_month_last_year) - 1`
- [ ] 近 3 個月 YoY 平均，減少單月異常
- [ ] EPS 季增率：`(eps_q / eps_q_last) - 1`
- [ ] 合成權重正確：營收×0.6, EPS×0.4
- [ ] Look-ahead bias 防護：使用 `announcement_date` 判斷資料可用性

### 共通
- [ ] 回傳 `{stock_id: score}`，Z-score 正規化
- [ ] 單元測試覆蓋

## 備註
成長策略的 `announcement_date` 使用是防 Look-ahead bias 的關鍵。月營收公告日為每月 10 日。
