import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  date: string; // YYYY-MM-DD
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
}

const STORAGE_KEY = 'tw_quant_lots';

function loadLots(): Lot[] {
  try {
    const old = localStorage.getItem('tw_quant_portfolio');
    if (old) {
      const oldData: { id?: string; stock_id: string; shares: number; cost: number }[] = JSON.parse(old);
      if (oldData.length > 0) {
        const migrated = oldData.map((h) => {
          const today = new Date().toISOString().split('T')[0];
          return {
            id: h.id ?? `${h.stock_id}-${today}-${Math.random()}`,
            stock_id: h.stock_id,
            date: h.date ?? today,
            shares: h.shares,
            cost: h.cost,
          };
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        localStorage.removeItem('tw_quant_portfolio');
        return migrated;
      }
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const lots: Lot[] = JSON.parse(raw);
      // Ensure each lot has a date
      const fixed = lots.map((l) => ({ ...l, date: l.date || new Date().toISOString().split('T')[0] }));
      if (fixed.some((l, i) => l !== lots[i])) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(fixed));
      }
      return fixed;
    }
    return [];
  } catch { return []; }
}

export default function Portfolio() {
  const navigate = useNavigate();
  const [lots, setLots] = useState<Lot[]>(loadLots());
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
  const [prices, setPrices] = useState<Record<string, { name: string; close: number | null }>>({});

  const refreshPrices = useCallback(async () => {
    const ids = [...new Set(lots.map((l) => l.stock_id))].join(',');
    if (!ids) return;
    try {
      const p = await apiFetch<Record<string, { name: string; close: number | null }>>(`/api/v1/stocks/prices?ids=${ids}`);
      setPrices(p);
    } catch { /* ignore */ }
  }, [lots]);

  useEffect(() => { refreshPrices(); }, []);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(lots)); }, [lots]);
  useEffect(() => { localStorage.setItem('tw_quant_cash', String(cashBalance)); }, [cashBalance]);

  const addLot = async () => {
    const sid = stockId.trim();
    const sh = Number(shares);
    const co = Number(cost);
    const dt = date;
    if (!sid || sh <= 0 || co <= 0) return;
    setAdding(true);
    try {
      const p = await apiFetch<Record<string, { name: string; close: number | null }>>(`/api/v1/stocks/prices?ids=${sid}`);
      if (p[sid]) setPrices((prev) => ({ ...prev, [sid]: p[sid] }));
    } catch { /* ignore */ }
    setLots((prev) => [...prev, { id: `${sid}-${dt}-${Date.now()}`, stock_id: sid, date: dt, shares: sh, cost: co }]);
    setStockId(''); setShares(''); setCost('');
    setAdding(false);
  };

  const removeLot = (id: string) => setLots((prev) => prev.filter((l) => l.id !== id));

  // Aggregate by stock_id
  const groups = lots.reduce<Record<string, AggregatedHolding>>((acc, l) => {
    if (!acc[l.stock_id]) acc[l.stock_id] = { stock_id: l.stock_id, lots: [], totalShares: 0, avgCost: 0, current_price: null, name: '' };
    acc[l.stock_id].lots.push(l);
    acc[l.stock_id].totalShares += l.shares;
    return acc;
  }, {});

  const holdings = Object.values(groups).map((g) => {
    const totalCost = g.lots.reduce((s, l) => s + l.shares * l.cost, 0);
    g.avgCost = g.totalShares > 0 ? totalCost / g.totalShares : 0;
    g.current_price = prices[g.stock_id]?.close ?? null;
    g.name = prices[g.stock_id]?.name ?? g.stock_id;
    return g;
  });

  const totalValue = holdings.reduce((s, h) => s + (h.current_price ?? h.avgCost) * h.totalShares, 0);
  const totalCost = holdings.reduce((s, h) => s + h.avgCost * h.totalShares, 0);
  const totalPnl = totalValue - totalCost;

  const toggleExpand = (sid: string) => setExpanded(expanded === sid ? null : sid);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>投組追蹤 Portfolio</h1>

      {/* Add form */}
      <div className={styles.addForm}>
        <input className={styles.input} placeholder="股號 (e.g. 2330)" value={stockId} onChange={(e) => setStockId(e.target.value.toUpperCase())} />
        <input className={styles.input} type="number" placeholder="股數" value={shares} onChange={(e) => setShares(e.target.value)} />
        <input className={styles.input} type="number" placeholder="每股成本" value={cost} onChange={(e) => setCost(e.target.value)} />
        <input className={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className={styles.addBtn} onClick={addLot} disabled={adding}>加入</button>
      </div>

      {/* Summary */}
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
              {s.pct ? `${(Number(s.value) * 100).toFixed(2)}%` : `$${Math.round(Number(s.value)).toLocaleString()}`}
            </div>
          </div>
        ))}
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>現金餘額</div>
          <input className={styles.cashInput} type="number" value={cashBalance} onChange={(e) => setCashBalance(Number(e.target.value))} />
        </div>
      </div>

      {/* Holdings */}
      <h2 className={styles.sectionTitle}>持倉 Holdings</h2>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>股號</th><th>名稱</th><th data-type="number">合計股數</th><th data-type="number">均價</th>
              <th data-type="number">現價</th><th data-type="number">損益</th><th data-type="number">損益%</th>
              <th data-type="number">權重</th><th>日期</th><th></th>
            </tr>
          </thead>
          <tbody>
            {holdings.length === 0 ? (
              <tr><td colSpan={11} className={styles.emptyCell}>尚無持股，上方輸入股號加入</td></tr>
            ) : (
              holdings.map((h) => {
                const curPrice = h.current_price ?? h.avgCost;
                const pnl = (curPrice - h.avgCost) * h.totalShares;
                const pnlPct = (curPrice - h.avgCost) / h.avgCost;
                const weight = totalCost > 0 ? (h.avgCost * h.totalShares) / totalCost : 0;
                const isOpen = expanded === h.stock_id;
                return (
                  <tr key={h.stock_id} className={styles.dataRow}>
                    <td className={styles.stockLink} onClick={() => navigate(`/signals/${h.stock_id}`)}>{h.stock_id}</td>
                    <td>{h.name}</td>
                    <td data-type="number">{h.totalShares.toLocaleString()}</td>
                    <td data-type="number">{h.avgCost.toFixed(2)}</td>
                    <td data-type="number">{h.current_price != null ? h.current_price.toFixed(2) : '—'}</td>
                    <td data-type="number" className={pnl >= 0 ? styles.bullText : styles.bearText}>
                      <span className={styles.pnlIcon}>{pnl >= 0 ? '▲' : '▼'}</span>
                      ${Math.round(pnl).toLocaleString()}
                    </td>
                    <td data-type="number" className={pnl >= 0 ? styles.bullText : styles.bearText}>
                      {pnl >= 0 ? '+' : ''}{(pnlPct * 100).toFixed(2)}%
                    </td>
                    <td data-type="number">{(weight * 100).toFixed(1)}%</td>
                    <td>{h.lots[0]?.date || ''}</td>
                    <td>
                      <button className={styles.expandBtn} onClick={() => toggleExpand(h.stock_id)}>
                        {isOpen ? '▲' : '▼'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Expanded detail: per-lot breakdown */}
      {expanded && groups[expanded] && (
        <div className={styles.expandedSection}>
          <h3 className={styles.expandedTitle}>{expanded} {prices[expanded]?.name ?? ''} 逐筆明細</h3>
          <table className={styles.detailTable}>
            <thead>
              <tr><th data-type="number">日期</th><th data-type="number">股數</th><th data-type="number">成本</th><th data-type="number">現價</th><th data-type="number">損益</th><th data-type="number">損益%</th><th></th></tr>
            </thead>
            <tbody>
              {groups[expanded].lots.map((l) => {
                const cur = prices[expanded]?.close ?? null;
                const lp = (cur ?? l.cost) * l.shares;
                const lc = l.cost * l.shares;
                const lpnl = lp - lc;
                const lpnlPct = (cur ?? l.cost) / l.cost - 1;
                return (
                  <tr key={l.id} className={styles.detailRow}>
                    <td data-type="number">{l.date}</td>
                    <td data-type="number">{l.shares.toLocaleString()}</td>
                    <td data-type="number">{l.cost.toFixed(2)}</td>
                    <td data-type="number">{cur != null ? cur.toFixed(2) : '—'}</td>
                    <td data-type="number" className={lpnl >= 0 ? styles.bullText : styles.bearText}>
                      ${Math.round(lpnl).toLocaleString()}
                    </td>
                    <td data-type="number" className={lpnl >= 0 ? styles.bullText : styles.bearText}>
                      {lpnlPct >= 0 ? '+' : ''}{(lpnlPct * 100).toFixed(2)}%
                    </td>
                    <td><button className={styles.delBtn} onClick={() => removeLot(l.id)}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {lots.length > 0 && (
        <p className={styles.hint}>💡 資料存於瀏覽器 localStorage，清除快取會遺失</p>
      )}
    </div>
  );
}
