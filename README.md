# tw-quant-selector

台股 + ETF 自動選股系統。個人量化研究與回測。

⚠️ 系統輸出結果不構成投資建議。

測試方式：

```bash
cd ~/Projects/tw-quant-selector
source .venv/bin/activate   # 進入虛擬環境
```

**1. 跑單元測試（26 項）：**
```bash
pytest -v
```

**2. 啟動 API 伺服器：**
```bash
uvicorn tw_quant_selector.api.app:app --reload
# http://localhost:8000/health
# http://localhost:8000/docs   ← Swagger UI
```

**3. 跑回測（需先有 FinMind Token 與資料）：**
```python
from tw_quant_selector.data.database import Database
from tw_quant_selector.backtest.engine import run_backtest
from datetime import date

db = Database("/tmp/test.duckdb")
db.init_db()
# 先匯入資料再執行：
metrics = run_backtest(db, date(2020, 1, 1), date(2024, 12, 31))
print(metrics)
```

**4. run_demo
```bash
export FINMIND_TOKEN="xxx"
cd ~/Projects/tw-quant-selector
source .venv/bin/activate
python scripts/run_demo.py
```

**5. frontend

可以啟動前端看資料：

```
cd ~/Projects/tw-quant-selector
source .venv/bin/activate
uvicorn tw_quant_selector.api.app:app --reload
```
然後打開瀏覽器 http://127.0.0.1:8000 就能看到：



