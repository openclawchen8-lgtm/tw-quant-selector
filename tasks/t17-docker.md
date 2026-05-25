---
github_issue: N/A
title: Docker 化部署
type: task
priority: medium
status: pending
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 第 12 章
---

# T17 - Docker 化部署

## 目標
撰寫 Dockerfile 與 docker-compose.yml，實現容器化部署，含 volume 掛載與 healthcheck。

## 驗收標準
- [ ] `Dockerfile` 以 Python 3.12-slim 為基底
- [ ] `docker-compose.yml` 符合 spec 12 規格（port 8000, volumes, env vars, healthcheck, restart policy）
- [ ] 資料持久化：`./data:/data`（DuckDB）、`./output:/output`（回測結果）
- [ ] `docker compose up` 可一鍵啟動
- [ ] `.dockerignore` 排除非必要檔案

## 備註
Docker 為選項部署方式，不強制但建議提供。
