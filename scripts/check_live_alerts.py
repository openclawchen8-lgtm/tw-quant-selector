#!/usr/bin/env python3
import json
import os
import sys
import httpx
import time
from pathlib import Path
from decimal import Decimal

# Add project root and src to path
root = Path(__file__).parent.parent
sys.path.insert(0, str(root))
sys.path.insert(0, str(root / "src"))

from tw_quant_selector.data.database import Database
from tw_quant_selector.monitoring.alerting import AlertManager, get_alert_config

TWSE_API_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"

def fetch_live_prices(stocks: list[dict]) -> dict[str, float]:
    """Fetch live prices from TWSE MIS API."""
    if not stocks:
        return {}
    
    # Format: ex_ch=tse_2330.tw|otc_6244.tw
    channels = []
    for s in stocks:
        market_prefix = "otc" if s["market"] == "OTC" else "tse"
        channels.append(f"{market_prefix}_{s['stock_id']}.tw")
    
    params = {"ex_ch": "|".join(channels), "_": int(time.time() * 1000)}
    
    try:
        resp = httpx.get(TWSE_API_URL, params=params, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
        
        prices = {}
        for item in data.get("msgArray", []):
            sid = item.get("c")
            price_str = item.get("z") # current price
            if price_str == "-" or not price_str:
                price_str = item.get("y") # fallback to yesterday close if no trade yet
            
            if sid and price_str and price_str != "-":
                prices[sid] = float(price_str)
        return prices
    except Exception as e:
        print(f"❌ Error fetching TWSE prices: {e}")
        return {}

def check_live_alerts():
    monitor_path = ".stock_monitor.json"
    if not Path(monitor_path).exists():
        print(f"⚠️ {monitor_path} not found. Run scripts/export_portfolio.py first.")
        return

    with open(monitor_path, "r", encoding="utf-8") as f:
        holdings = json.load(f)

    if not holdings:
        print("ℹ️ No holdings to monitor.")
        return

    db_path = os.environ.get("DUCKDB_PATH", "data/tw_quant.duckdb")
    db = Database(db_path)
    manager = AlertManager(db)
    config = get_alert_config(db)
    
    # Thresholds
    pct_threshold = float(config.get("PL_PERCENT_THRESHOLD") or 5.0) # Default 5%
    amt_threshold = float(config.get("PL_THRESHOLD") or 50000)      # Default 50k
    
    print(f"🔍 Monitoring {len(holdings)} holdings...")
    live_prices = fetch_live_prices(holdings)
    
    for h in holdings:
        sid = h["stock_id"]
        if sid not in live_prices:
            print(f"  ⚠️ No live price for {sid}")
            continue
            
        current_price = live_prices[sid]
        avg_cost = h["avg_cost"]
        shares = h["shares"]
        
        # P/L Calculation (Taiwan stocks are 1000 shares per lot usually, 
        # but our 'shares' should be the actual number of shares)
        pnl = (current_price - avg_cost) * shares
        pnl_pct = (current_price / avg_cost - 1) * 100
        
        print(f"  📊 {sid}: Cost={avg_cost:.2f}, Live={current_price:.2f}, P/L={pnl_pct:+.2f}% (${pnl:,.0f})")
        
        # Trigger alert if threshold met
        if abs(pnl_pct) >= pct_threshold or abs(pnl) >= amt_threshold:
            print(f"  🔔 Alert triggered for {sid}!")
            manager.handle_pl_alert({
                "stock_id": sid,
                "stock_name": sid, # In a real system, we'd lookup name
                "pnl": pnl,
                "pnl_pct": pnl_pct,
                "current_price": current_price,
                "avg_cost": avg_cost,
                "shares": shares,
                "threshold_value": pct_threshold if abs(pnl_pct) >= pct_threshold else amt_threshold,
                "threshold_type": "percent" if abs(pnl_pct) >= pct_threshold else "amount",
                "alert_enabled": True
            })

if __name__ == "__main__":
    check_live_alerts()
