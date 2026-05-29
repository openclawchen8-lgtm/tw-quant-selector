import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import Tooltip from '../components/Tooltip';
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
}

interface StockAlertConfig {
  pl_threshold?: number;
  pl_percent_threshold?: number;
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
    const old = localStorage.getItem('tw_quant_portfolio');
    if (old) {
      const oldData: { id?: string; stock_id: string; date?: string; shares: number; cost: number }[] = JSON.parse(old);
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
      const fixed = lots.map((l) => ({ ...l, date: l.date || new Date().toISOString().split('T')[0] }));
      if (fixed.some((l, i) => l !== lots[i])) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(fixed));
      }
      return fixed;
    }
    return [];
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
  const [newRows, setNewRows] = useState<Set<string>>(new Set());
  const [exitingLots, setExitingLots] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  // ── Alert / Threshold states ──
  const [alertConfigs, setAlertConfigs] = useState<Record<string, StockAlertConfig>>(loadAlertConfigs);
  const [globalThresholds, setGlobalThresholds] = useState<GlobalThresholds>({ pl_threshold: null, pl_percent_threshold: null });
  const [configuringStock, setConfiguringStock] = useState<string | null>(null);

  // Load global thresholds from backend
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

  // Persist per-stock configs
  useEffect(() => {
    localStorage.setItem(ALERT_CONFIG_KEY, JSON.stringify(alertConfigs));
  }, [alertConfigs]);

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
    const newErrors: Record<string, boolean> = {};
    if (!sid) newErrors.stockId = true;
    if (!shares || sh <= 0) newErrors.shares = true;
    if (!cost || co <= 0) newErrors.cost = true;
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    setAdding(true);
    try {
      const p = await apiFetch<Record<string, { name: string; close: number | null }>>(`/api/v1/stocks/prices?ids=${sid}`);
      if (p[sid]) setPrices((prev) => ({ ...prev, [sid]: p[sid] }));
      addToast(`${sid} 已加入投組`, 'low');
    } catch {
      addToast(`${sid} 價格查詢失敗，仍以成本價計算`, 'medium');
    }
    const newId = `${sid}-${dt}-${Date.now()}`;
    setLots((prev) => [...prev, { id: newId, stock_id: sid, date: dt, shares: sh, cost: co }]);
    setNewRows((prev) => new Set(prev).add(sid));
    setTimeout(() => setNewRows((prev) => { const n = new Set(prev); n.delete(sid); return n; }), 500);
    setStockId(''); setShares(''); setCost(''); setErrors({});
    setAdding(false);
  };

  const removeLot = (id: string) => {
    setExitingLots((prev) => new Set(prev).add(id));
  };

  const finishRemoveLot = (id: string) => {
    setLots((prev) => prev.filter((l) => l.id !== id));
    setExitingLots((prev) => { const n = new Set(prev); n.delete(id); return n; });
    addToast('持股已刪除', 'low');
  };

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

  // ── Alert helpers ──
  const getEffectiveThreshold = (stockId: string, type: 'pl' | 'pct'): number | null => {
    const perStock = alertConfigs[stockId];
    if (type === 'pl') {
      if (perStock?.pl_threshold != null) return perStock.pl_threshold;
      return globalThresholds.pl_threshold;
    }
    if (perStock?.pl_percent_threshold != null) return perStock.pl_percent_threshold;
    return globalThresholds.pl_percent_threshold;
  };

  const getBreachStatus = (stockId: string, pnl: number, pnlPct: number): { breached: boolean; type: 'pl' | 'pct' | null; value: number | null } => {
    const plT = getEffectiveThreshold(stockId, 'pl');
    const pctT = getEffectiveThreshold(stockId, 'pct');
    if (plT != null && Math.abs(pnl) >= plT) return { breached: true, type: 'pl', value: plT };
    if (pctT != null && Math.abs(pnlPct * 100) >= pctT) return { breached: true, type: 'pct', value: pctT };
    return { breached: false, type: null, value: null };
  };

  const hasAnyThreshold = (stockId: string): boolean => {
    return getEffectiveThreshold(stockId, 'pl') != null || getEffectiveThreshold(stockId, 'pct') != null;
  };

  const updateConfig = (stockId: string, updates: Partial<StockAlertConfig>) => {
    setAlertConfigs(prev => {
      const current = prev[stockId] || { alert_enabled: true };
      return {
        ...prev,
        [stockId]: { ...current, ...updates }
      };
    });
  };

  const clearConfig = (stockId: string) => {
    setAlertConfigs(prev => {
      const next = { ...prev };
      delete next[stockId];
      return next;
    });
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>投組追蹤 Portfolio</h1>

      {/* Add form */}
      <div className={styles.addForm}>
        <input className={`${styles.input} ${errors.stockId ? 'input-error' : ''}`} placeholder="股號 (e.g. 2330)" value={stockId} onChange={(e) => { setStockId(e.target.value.toUpperCase()); setErrors((p) => ({ ...p, stockId: false })); }} />
        <input className={`${styles.input} ${errors.shares ? 'input-error' : ''}`} type="number" placeholder="股數" value={shares} onChange={(e) => { setShares(e.target.value); setErrors((p) => ({ ...p, shares: false })); }} />
        <input className={`${styles.input} ${errors.cost ? 'input-error' : ''}`} type="number" placeholder="每股成本" value={cost} onChange={(e) => { setCost(e.target.value); setErrors((p) => ({ ...p, cost: false })); }} />
        <input className={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className={`${styles.addBtn}${adding ? ' btn-loading' : ''}`} onClick={addLot} disabled={adding}>加入</button>
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
              {s.pct ? formatNumber(s.value, { type: 'percent' }) : `$${formatNumber(Math.round(Number(s.value)), { type: 'market_cap' }).replace('億', '')}`}
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
              <th data-type="number">警示</th><th data-type="number">權重</th><th>日期</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {holdings.length === 0 ? (
              <tr><td colSpan={11} className={styles.emptyCell}><EmptyState scenario="initial">尚無持股，上方輸入股號加入</EmptyState></td></tr>
            ) : (
              holdings.map((h) => {
                const curPrice = h.current_price ?? h.avgCost;
                const pnl = (curPrice - h.avgCost) * h.totalShares;
                const pnlPct = (curPrice - h.avgCost) / h.avgCost;
                const weight = totalCost > 0 ? (h.avgCost * h.totalShares) / totalCost : 0;
                const isOpen = expanded === h.stock_id;
                const isConfigOpen = configuringStock === h.stock_id;
                const breach = getBreachStatus(h.stock_id, pnl, pnlPct);

                return (
                  <tr key={h.stock_id} className={`${styles.dataRow} ${newRows.has(h.stock_id) ? 'row-new' : ''}`}>
                    <td className={styles.stockLink} onClick={() => navigate(`/signals/${h.stock_id}`)}>{h.stock_id}</td>
                    <td>{h.name}</td>
                    <td data-type="number">{formatNumber(h.totalShares, { type: 'volume' }).replace('萬張', '')}</td>
                    <td data-type="number">{formatNumber(h.avgCost, { type: 'price' })}</td>
                    <td data-type="number">{formatNumber(h.current_price, { type: 'price' })}</td>
                    <td data-type="number" className={pnl >= 0 ? styles.bullText : styles.bearText}>
                      <span className={styles.pnlIcon}>{trendIcon(pnl) || '—'}</span>
                      ${formatNumber(Math.round(pnl), { type: 'market_cap' }).replace('億', '')}
                    </td>
                    <td data-type="number" className={pnl >= 0 ? styles.bullText : styles.bearText}>
                      {pnl >= 0 ? '+' : ''}{formatNumber(pnlPct, { type: 'percent' })}
                    </td>
                    {/* Alert status column */}
                    <td data-type="number">
                      {hasAnyThreshold(h.stock_id) ? (
                        <button
                          className={`${styles.alertBtn} ${breach.breached ? styles.alertBreached : styles.alertOk}`}
                          onClick={() => setConfiguringStock(isConfigOpen ? null : h.stock_id)}
                          title={breach.breached
                            ? `超標！${breach.type === 'pl' ? '金額' : '百分比'}門檻 ${breach.value}`
                            : '點擊設定門檻'}
                        >
                          {breach.breached ? '⚠' : '✔'}
                        </button>
                      ) : (
                        <button
                          className={styles.alertNone}
                          onClick={() => setConfiguringStock(isConfigOpen ? null : h.stock_id)}
                          title="點擊設定門檻"
                        >
                          —
                        </button>
                      )}
                    </td>
                    <td data-type="number">{formatNumber(weight, { type: 'percent' })}</td>
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

      {/* ── Config sub-rows (inside tbody, after the table) ── */}
      {configuringStock && groups[configuringStock] && (
        <div className={styles.configPanel}>
          <div className={styles.configHeader}>
            <span className={styles.configTitle}>⚙ 門檻設定 — {configuringStock} {prices[configuringStock]?.name ?? ''}</span>
            <button className={styles.configCloseBtn} onClick={() => setConfiguringStock(null)}>✕</button>
          </div>
          <div className={styles.configBody}>
            {/* Amount threshold */}
            <div className={styles.configField}>
              <label className={styles.configLabel} htmlFor={`pl-amt-${configuringStock}`}>
                <Tooltip content="單一持股累計損益達到此金額時觸發通知。留空則套用全域設定或預設值。">金額門檻 (±TWD)</Tooltip>
              </label>
              <input
                id={`pl-amt-${configuringStock}`}
                className={styles.configInput}
                type="number"
                placeholder={globalThresholds.pl_threshold != null ? `全域 ${globalThresholds.pl_threshold}` : '未設定'}
                value={alertConfigs[configuringStock]?.pl_threshold ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  updateConfig(configuringStock, { pl_threshold: v ? Number(v) : undefined });
                }}
              />
              {alertConfigs[configuringStock]?.pl_threshold == null && globalThresholds.pl_threshold != null && (
                <span className={styles.configHint}>套用全域: ±{globalThresholds.pl_threshold}</span>
              )}
            </div>

            {/* Percent threshold */}
            <div className={styles.configField}>
              <label className={styles.configLabel} htmlFor={`pl-pct-${configuringStock}`}>
                <Tooltip content="單一持股損益百分比（相對於成本）達到此值時觸發通知。留空則套用全域設定或預設值。">百分比門檻 (±%)</Tooltip>
              </label>
              <input
                id={`pl-pct-${configuringStock}`}
                className={styles.configInput}
                type="number"
                step="0.1"
                placeholder={globalThresholds.pl_percent_threshold != null ? `全域 ${globalThresholds.pl_percent_threshold}` : '未設定'}
                value={alertConfigs[configuringStock]?.pl_percent_threshold ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  updateConfig(configuringStock, { pl_percent_threshold: v ? Number(v) : undefined });
                }}
              />
              {alertConfigs[configuringStock]?.pl_percent_threshold == null && globalThresholds.pl_percent_threshold != null && (
                <span className={styles.configHint}>套用全域: ±{globalThresholds.pl_percent_threshold}%</span>
              )}
            </div>

            {/* Alert enabled toggle */}
            <div className={styles.configToggleRow}>
              <label className={styles.configToggleLabel} htmlFor={`alert-enable-${configuringStock}`}>
                <input
                  id={`alert-enable-${configuringStock}`}
                  type="checkbox"
                  checked={alertConfigs[configuringStock]?.alert_enabled ?? true}
                  onChange={(e) => updateConfig(configuringStock, { alert_enabled: e.target.checked })}
                  className={styles.configCheckbox}
                />
                <span className={styles.configToggleText}>啟用通知 (Telegram / Email)</span>
              </label>
            </div>

            {/* Clear button */}
            <div className={styles.configActions}>
              {alertConfigs[configuringStock] && (
                <button
                  className={styles.configClearBtn}
                  onClick={() => { clearConfig(configuringStock); setConfiguringStock(null); }}
                >
                  清除個股設定，回退至全域
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
                  <tr key={l.id} className={`${styles.detailRow} ${exitingLots.has(l.id) ? 'row-exiting' : ''}`}
                    onAnimationEnd={exitingLots.has(l.id) ? () => finishRemoveLot(l.id) : undefined}>
                    <td data-type="number">{l.date}</td>
                    <td data-type="number">{formatNumber(l.shares, { type: 'volume' }).replace('萬張', '')}</td>
                    <td data-type="number">{formatNumber(l.cost, { type: 'price' })}</td>
                    <td data-type="number">{formatNumber(cur, { type: 'price' })}</td>
                    <td data-type="number" className={lpnl >= 0 ? styles.bullText : styles.bearText}>
                      <span className={styles.pnlIcon}>{trendIcon(lpnl) || '—'}</span>
                      ${formatNumber(Math.round(lpnl), { type: 'market_cap' }).replace('億', '')}
                    </td>
                    <td data-type="number" className={lpnl >= 0 ? styles.bullText : styles.bearText}>
                      {(trendIcon(lpnl) || '—')} {lpnlPct >= 0 ? '+' : ''}{formatNumber(lpnlPct, { type: 'percent' })}
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
