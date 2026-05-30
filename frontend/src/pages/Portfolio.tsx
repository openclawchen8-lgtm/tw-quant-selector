import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { formatNumber } from '../utils/format';
import { trendIcon } from '../utils/color';
import styles from './Portfolio.module.css';

const API = 'http://localhost:8000';
async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'API error');
  return (body.data ?? body) as T;
}

interface Lot {
  id: string;
  stock_id: string;
  date: string;
  shares: number;
  cost: number;
}

interface AggregatedHolding {
  stock_id: string;
  lots: Lot[];
  totalShares: number;
  avgCost: number;
  current_price: number | null;
  name: string;
  pl_pct_thod: number | null;
  pl_thod: number | null;
}

interface StockAlertConfig {
  pl_thod?: number;
  pl_pct_thod?: number;
  alert_enabled: boolean;
}

interface GlobalThresholds {
  pl_threshold: number | null;
  pl_percent_threshold: number | null;
}

const STORAGE_KEY = 'tw_quant_lots';
const ALERT_CONFIG_KEY = 'tw_quant_alert_configs';

function loadLots(): Lot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function loadAlertConfigs(): Record<string, StockAlertConfig> {
  try {
    return JSON.parse(localStorage.getItem(ALERT_CONFIG_KEY) || '{}');
  } catch { return {}; }
}

export default function Portfolio() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [lots, setLots] = useState<Lot[]>(loadLots);
  const [holdings, setHoldings] = useState<AggregatedHolding[]>([]);
  const [prices, setPrices] = useState<Record<string, { name: string; close: number | null }>>({});

  const refreshPortfolio = useCallback(async () => {
    try {
        const data = await apiFetch<AggregatedHolding[]>('/api/v1/portfolio');
        setHoldings(data);
        const mappedLots: Lot[] = data.flatMap(h => ({
            id: `${h.stock_id}-${Date.now()}`,
            stock_id: h.stock_id,
            date: new Date().toISOString().split('T')[0],
            shares: h.totalShares,
            cost: h.avgCost
        }));
        setLots(mappedLots);
        const ids = [...new Set(data.map((h) => h.stock_id))].join(',');
        if (ids) {
            const p = await apiFetch<Record<string, { name: string; close: number | null }>>(`/api/v1/stocks/prices?ids=${ids}`);
            setPrices(p);
        }
    } catch {
        // Fallback
    }
  }, []);

  useEffect(() => {
    refreshPortfolio();
  }, [refreshPortfolio]);

  const [cashBalance, setCashBalance] = useState(() => {
    try { return Number(localStorage.getItem('tw_quant_cash') || '0'); }
    catch { return 0; }
  });
  const [stockId, setStockId] = useState('');
  const [shares, setShares] = useState('');
  const [cost, setCost] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newRows, setNewRows] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const [alertConfigs, setAlertConfigs] = useState<Record<string, StockAlertConfig>>(loadAlertConfigs);
  const [globalThresholds, setGlobalThresholds] = useState<GlobalThresholds>({ pl_threshold: null, pl_percent_threshold: null });
  const [configuringStock, setConfiguringStock] = useState<string | null>(null);
  const [tempConfig, setTempConfig] = useState<StockAlertConfig | null>(null);

  useEffect(() => {
    apiFetch<{ key: string; value: string | null }[]>('/api/v1/settings/alerts').then(data => {
      const pl = data.find(s => s.key === 'PL_THRESHOLD');
      const pct = data.find(s => s.key === 'PL_PERCENT_THRESHOLD');
      setGlobalThresholds({
        pl_threshold: pl?.value ? Number(pl.value) : null,
        pl_percent_threshold: pct?.value ? Number(pct.value) : null,
      });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(ALERT_CONFIG_KEY, JSON.stringify(alertConfigs));
  }, [alertConfigs]);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(lots)); }, [lots]);
  useEffect(() => { localStorage.setItem('tw_quant_cash', String(cashBalance)); }, [cashBalance]);

  const addLot = async () => {
    const sid = stockId.trim();
    const sh = Number(shares);
    const co = Number(cost);
    if (!sid || sh <= 0 || co <= 0) {
        setErrors({ stockId: !sid, shares: sh <= 0, cost: co <= 0 });
        return;
    }
    setAdding(true);
    try {
      await fetch(`${API}/api/v1/portfolio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_id: sid, shares: sh, cost: co, is_etf: false })
      });
      addToast(`${sid} 已加入投組`, 'low');
      setNewRows((prev) => new Set(prev).add(sid));
      setTimeout(() => setNewRows((prev) => { const n = new Set(prev); n.delete(sid); return n; }), 500);
      await refreshPortfolio();
    } catch {
      addToast(`新增失敗`, 'medium');
    }
    setStockId(''); setShares(''); setCost(''); setErrors({});
    setAdding(false);
  };

  const removeLot = async (stockId: string) => {
    try {
        await fetch(`${API}/api/v1/portfolio/${stockId}`, { method: 'DELETE' });
        await refreshPortfolio();
        addToast('持股已刪除', 'low');
    } catch {
        addToast('刪除失敗', 'medium');
    }
  };

  const holdingsWithPrice = holdings.map(h => ({
    ...h,
    current_price: prices[h.stock_id]?.close ?? h.current_price
  }));

  const totalValue = holdingsWithPrice.reduce((s, h) => s + ((h.current_price ?? 0) || h.avgCost) * h.totalShares, 0);
  const totalCost = holdingsWithPrice.reduce((s, h) => s + h.avgCost * h.totalShares, 0);
  const totalPnl = totalValue - totalCost;

  const toggleExpand = (sid: string) => setExpanded(expanded === sid ? null : sid);

  const getBreachStatus = (h: AggregatedHolding, pnl: number, pnlPct: number): { breached: boolean; type: 'pl' | 'pct' | null; value: number | null } => {
    const plT = h.pl_thod ?? globalThresholds.pl_threshold;
    const pctT = h.pl_pct_thod ?? globalThresholds.pl_percent_threshold;
    if (plT != null && Math.abs(pnl) >= plT) return { breached: true, type: 'pl', value: plT };
    if (pctT != null && Math.abs(pnlPct * 100) >= pctT) return { breached: true, type: 'pct', value: pctT };
    return { breached: false, type: null, value: null };
  };

  const openConfig = (sid: string) => {
      setConfiguringStock(sid);
      setTempConfig(alertConfigs[sid] || { alert_enabled: true });
  }

  const saveConfig = () => {
    if (configuringStock && tempConfig) {
        setAlertConfigs(prev => ({ ...prev, [configuringStock]: tempConfig }));
        addToast('設定已儲存', 'low');
        setConfiguringStock(null);
    }
  };

  const clearConfig = () => {
    if (configuringStock) {
        setAlertConfigs(prev => {
            const next = { ...prev };
            delete next[configuringStock];
            return next;
        });
        setConfiguringStock(null);
        addToast('設定已清除', 'low');
    }
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>投組追蹤 Portfolio</h1>
      <div className={styles.addForm}>
        <input className={`${styles.input} ${errors.stockId ? 'input-error' : ''}`} placeholder="股號 (e.g. 2330)" value={stockId} onChange={(e) => setStockId(e.target.value.toUpperCase())} />
        <input className={`${styles.input} ${errors.shares ? 'input-error' : ''}`} type="number" placeholder="股數" value={shares} onChange={(e) => setShares(e.target.value)} />
        <input className={`${styles.input} ${errors.cost ? 'input-error' : ''}`} type="number" step="0.01" placeholder="每股成本" value={cost} onChange={(e) => setCost(e.target.value)} />
        <input className={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className={`${styles.addBtn}${adding ? ' btn-loading' : ''}`} onClick={addLot} disabled={adding}>加入</button>
      </div>

      <div className={styles.summary}>
        {[
          { label: '總市值', value: totalValue },
          { label: '總成本', value: totalCost },
          { label: '總損益', value: totalPnl, colored: true },
          { label: '報酬率', value: totalCost > 0 ? totalPnl / totalCost : 0, pct: true, colored: true },
        ].map((s) => (
          <div key={s.label} className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{s.label}</div>
            <div className={`${styles.summaryValue} ${s.colored && totalPnl >= 0 ? styles.bullText : s.colored && totalPnl < 0 ? styles.bearText : ''}`}>
              {s.pct ? formatNumber(s.value, { type: 'percent' }) : formatNumber(Number(s.value), { type: 'money' })}
            </div>
          </div>
        ))}
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>現金餘額</div>
          <input className={styles.cashInput} type="number" value={cashBalance} onChange={(e) => setCashBalance(Number(e.target.value))} />
        </div>
      </div>

      <h2 className={styles.sectionTitle}>持倉 Holdings</h2>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>股號</th><th>名稱</th><th data-type="number">合計股數</th><th data-type="number">均價</th>
              <th data-type="number">現價</th><th data-type="number">損益</th><th data-type="number">損益%</th>
              <th data-type="number">警示門檻 (金額/%)</th><th data-type="number">權重</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {holdingsWithPrice.length === 0 ? (
              <tr><td colSpan={10} className={styles.emptyCell}><EmptyState scenario="initial">尚無持股，上方輸入股號加入</EmptyState></td></tr>
            ) : (
              holdingsWithPrice.map((h) => {
                const curPrice = h.current_price ?? h.avgCost;
                const pnl = (curPrice - h.avgCost) * h.totalShares;
                const pnlPct = (curPrice - h.avgCost) / h.avgCost;
                const weight = totalCost > 0 ? (h.avgCost * h.totalShares) / totalCost : 0;
                const breach = getBreachStatus(h, pnl, pnlPct);
                const isOpen = expanded === h.stock_id;

                return (
                  <tr key={h.stock_id} className={`${styles.dataRow} ${newRows.has(h.stock_id) ? 'row-new' : ''}`}>
                    <td className={styles.stockLink} onClick={() => navigate(`/signals/${h.stock_id}`)}>{h.stock_id}</td>
                    <td>{h.name}</td>
                    <td data-type="number">{h.totalShares.toLocaleString()}</td>
                    <td data-type="number">{formatNumber(h.avgCost, { type: 'price' })}</td>
                    <td data-type="number">{formatNumber(h.current_price, { type: 'price' })}</td>
                    <td data-type="number" className={pnl >= 0 ? styles.bullText : styles.bearText}>
                      <span className={styles.pnlIcon}>{trendIcon(pnl) || '—'}</span>
                      {formatNumber(pnl, { type: 'money' })}
                    </td>
                    <td data-type="number" className={pnl >= 0 ? styles.bullText : styles.bearText}>
                      {pnl >= 0 ? '+' : ''}{formatNumber(pnlPct, { type: 'percent' })}
                    </td>
                    <td data-type="number" className={breach.breached ? styles.alertBreached : ''}>
                      <button className={styles.alertBtn} onClick={() => openConfig(h.stock_id)}>
                        {h.pl_thod ?? globalThresholds.pl_threshold ?? '—'}&nbsp;/&nbsp;{h.pl_pct_thod ?? globalThresholds.pl_percent_threshold ?? '—'}%
                      </button>
                    </td>
                    <td data-type="number">{formatNumber(weight, { type: 'percent' })}</td>
                    <td>
                      <button className={styles.expandBtn} onClick={(e) => { e.stopPropagation(); toggleExpand(h.stock_id); }}>{isOpen ? '▲' : '▼'}</button>
                      <button className={styles.delBtn} onClick={(e) => { e.stopPropagation(); removeLot(h.stock_id); }}>✕</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      
      {configuringStock && tempConfig && (
        <div className={styles.configPanel}>
            <div className={styles.configHeader}>
                <span className={styles.configTitle}>設定 {configuringStock} 門檻</span>
                <button className={styles.configCloseBtn} onClick={() => setConfiguringStock(null)}>✕</button>
            </div>
            <div className={styles.configBody}>
              <div className={styles.configField}>
                <label className={styles.configLabel}>金額門檻 (±TWD)</label>
                <input className={styles.configInput} type="number" 
                    value={tempConfig.pl_thod ?? ''}
                    onChange={(e) => setTempConfig(prev => prev ? {...prev, pl_thod: Number(e.target.value)} : null)}
                />
              </div>
              <div className={styles.configField}>
                <label className={styles.configLabel}>百分比門檻 (±%)</label>
                <input className={styles.configInput} type="number" 
                    value={tempConfig.pl_pct_thod ?? ''}
                    onChange={(e) => setTempConfig(prev => prev ? {...prev, pl_pct_thod: Number(e.target.value)} : null)}
                />
              </div>
              <div className={styles.configActions}>
                  <button className={styles.configSaveBtn} onClick={saveConfig}>儲存設定</button>
                  <button className={styles.configClearBtn} onClick={clearConfig}>清除設定</button>
              </div>
            </div>
        </div>
      )}
    </div>
  );
}
