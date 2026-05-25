---
github_issue: N/A
title: 資料模型與 DuckDB Schema 實作
type: task
priority: high
status: done
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 第 8 章
---

# T2 - 資料模型與 DuckDB Schema 實作

## 目標
依 spec 8.1 在 DuckDB 中建立所有表格（stocks, daily_prices, monthly_revenue, financials, valuations, signals, backtest_runs, backtest_positions），以及對應的 Python 資料模型（Pydantic）。

## 驗收標準
- [ ] DuckDB 資料庫檔案可透過 `DUCKDB_PATH` 環境變數指定
- [ ] 8 張表格全部建立，含正確的 PRIMARY KEY、資料型別與預設值
- [ ] 提供 `init_db()` 函式，支援「已存在則跳過」（idempotent）
- [ ] Pydantic models 對應各 table row 結構，含欄位驗證
- [ ] 提供 `Database` class 封裝 DuckDB 連線，支援 context manager

## 備註
spec 8.1 使用 `DECIMAL` 型別，DuckDB 原生支援。注意 `announcement_date` 在回測中的關鍵地位。
