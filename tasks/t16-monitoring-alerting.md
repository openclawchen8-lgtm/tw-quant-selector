---
github_issue: N/A
title: 告警、監控與 Logging
type: task
priority: medium
status: done
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 第 10 章
---

# T16 - 告警、監控與 Logging

## 目標
實作統一 structured logging（structlog）、告警條件檢查、通知發送（Line Notify / Email / Log）。

## 驗收標準
- [ ] 所有模組使用 `structlog`（spec 10.3 格式）
- [ ] 告警檢查器（`AlertChecker`）定時檢查 spec 10.1 所有條件
- [ ] CRITICAL：資料庫無法連線、連續3日無股價 → Line Notify + Email
- [ ] HIGH：選股結果為空、回測失敗 → Line Notify
- [ ] MEDIUM：資料更新延遲 → Email
- [ ] LOW：FinMind API 配額 > 80% → Log
- [ ] 告警通知格式符合 spec 10.2
- [ ] Line Notify 與 Email 發送模組可 mock（測試用）

## 備註
Line Notify Token 與 Email 設定透過 `.env` 傳入。
