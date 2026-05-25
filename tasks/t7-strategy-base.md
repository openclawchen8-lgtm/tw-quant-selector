---
github_issue: N/A
title: 基礎策略架構與 DataProvider 介面
type: task
priority: high
status: done
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 9.2
---

# T7 - 基礎策略架構與 DataProvider 介面

## 目標
實作 `BaseStrategy` 抽象類別（含 `compute_score()`, `get_required_data()`）、`DataProvider` Protocol，以及策略註冊與工廠機制。

## 驗收標準
- [ ] `BaseStrategy` 定義 `compute_score(universe, as_of_date) -> dict[str, float]` 與 `get_required_data() -> list[str]`
- [ ] `DataProvider` Protocol 定義 `get_daily_prices()` 與 `get_universe()`（spec 9.2）
- [ ] 實作 `DuckDBDataProvider` 實作上述 Protocol
- [ ] 策略註冊機制：可透過裝飾器或 dict 註冊策略類別
- [ ] `StrategyFactory` 依名稱回傳策略實例
- [ ] 資料缺失檢查：若策略所需資料不足，拋出明確錯誤

## 備註
所有策略繼承此基底，確保統一介面後才能被 Combiner 使用。
