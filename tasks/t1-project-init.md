---
github_issue: N/A
title: 專案初始化與基礎架構
type: task
priority: high
status: done
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 第 1, 11 章
---

# T1 - 專案初始化與基礎架構

## 目標
建立專案骨架、Python 3.12 虛擬環境、pyproject.toml 鎖定套件版本、目錄結構、`.env` 範本、`opencode.json`（如需）。

## 驗收標準
- [ ] `pyproject.toml` 包含 spec 11.2 所列所有套件（duckdb, pandas, numpy, fastapi, uvicorn, httpx, pydantic, structlog, apscheduler, python-dotenv, scipy），且 requires-python = ">=3.12"
- [ ] 目錄結構：`src/`（含 `data/`, `strategies/`, `portfolio/`, `backtest/`, `api/`, `monitoring/`）、`tests/`、`data/`、`output/`
- [ ] `.env.example` 對應 spec 11.1 環境變數
- [ ] `README.md` 簡述專案用途
- [ ] 可透過 `pip install -e .` 安裝
- [ ] `git init` + `.gitignore`（含 `.env`, `*.duckdb`, `__pycache__`, `output/`）

## 備註
Python 3.14 相容性仍不明，鎖定 3.12。
