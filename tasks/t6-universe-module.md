---
github_issue: N/A
title: 選股宇宙（Universe）模組
type: task
priority: high
status: done
assignee: OpenCode DeepSeek V4 Flash
created: 2026-05-25
updated: 2026-05-25
howto: 依 spec 第 3 章
---

# T6 - 選股宇宙（Universe）模組

## 目標
實作靜態篩選（市值>30億、非金融、非KY、非全額交割）與動態篩選（日均成交金額>1000萬、非停牌、未下市），產出每日可交易的股票與 ETF 清單。

## 驗收標準
- [ ] `get_universe(as_of_date)` 回傳當日可用標的清單（含個股 + ETF）
- [ ] 靜態篩選：每月第一個交易日重算，市值以月底收盤價×股本
- [ ] 動態篩選：每日計算，近20日平均成交金額 > 1,000 萬
- [ ] 停牌邏輯（spec 2.4）：停牌>30日移除、恢復後觀察5日
- [ ] 下市標記：`is_delisted = TRUE`，保留歷史資料
- [ ] 指定 ETF 清單（spec 3.2：0050, 0051, 0052, 0056, 00878, 00881, 006208）固定納入
- [ ] 回傳格式：`{"stocks": [...], "etfs": [...], "total_count": N}`
- [ ] 回測模式：只能回傳「當時存在」的股票（spec 7.2）

## 備註
宇宙規模預估 ~1,107 檔（上市~700 + 上櫃~400 + ETF 7）。此模組是所有策略的入口依賴。
