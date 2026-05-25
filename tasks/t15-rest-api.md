---
github_issue: N/A
title: RESTful API（FastAPI）
type: task
priority: medium
status: done
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 9.1
---

# T15 - RESTful API（FastAPI）

## 目標
使用 FastAPI 實作 RESTful API，提供健康檢查、選股結果查詢、回測執行與查詢、資料狀態查詢。

## 驗收標準
- [ ] `GET /health` → `{"status": "ok", "db_connected": true, "last_update": "..."}`
- [ ] `GET /api/v1/signals/latest?strategy=composite&top_n=20&include_etf=false` 回傳最新選股結果
- [ ] `GET /api/v1/signals/{date}?strategy=composite` 指定日期選股結果
- [ ] `POST /api/v1/backtest/run` 啟動回測 → `{"run_id": "uuid", "status": "queued"}`
- [ ] `GET /api/v1/backtest/{run_id}` 查詢回測狀態與結果
- [ ] `GET /api/v1/data/status` 資料涵蓋率狀態
- [ ] Pydantic response models 定義完整
- [ ] uvicorn 可啟動，listen on port 8000

## 備註
API 為同步操作（回測除外，回測採非同步佇列模式）。
