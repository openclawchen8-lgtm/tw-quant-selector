import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchLatestSignals } from '../api/client';
import FactorMiniBar from '../components/FactorMiniBar';
import ExportModal from '../components/ExportModal';
import SkeletonScreen from '../components/SkeletonScreen';
import EmptyState from '../components/EmptyState';
import { formatNumber, colorize } from '../utils/format';
import styles from './Signals.module.css';

interface SignalItem {
  stock_id: string;
  name?: string;
  score: number;
  rank: number;
  rank_change?: number | null;
  consecutive_days?: number | null;
  factor_scores?: Record<string, number> | null;
}

const FACTOR_KEYS = ['momentum', 'value', 'quality', 'growth'];

export default function Signals() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<{ date: string; stocks: SignalItem[]; etfs: SignalItem[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState(searchParams.get('sort') || 'score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showEtf, setShowEtf] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [strategy, setStrategy] = useState(searchParams.get('strategy') || 'composite');
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchLatestSignals(strategy, true)
      .then((d: any) => { setData(d); setLoading(false); })
      .catch((e: Error) => { setData(null); setError(e.message); setLoading(false); });
  }, [strategy]);

  useEffect(() => {
    setSearchParams({ sort: sortKey, dir: sortDir, strategy }, { replace: true });
  }, [sortKey, sortDir, strategy]);

  const allItems = [...(data?.stocks || []), ...(showEtf ? data?.etfs || [] : [])];
  const sorted = [...allItems].sort((a, b) => {
    const m = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'rank') return (a.rank - b.rank) * m;
    if (sortKey === 'rank_change') return ((a.rank_change ?? 0) - (b.rank_change ?? 0)) * m;
    if (FACTOR_KEYS.includes(sortKey)) {
      const af = a.factor_scores?.[sortKey] ?? 0;
      const bf = b.factor_scores?.[sortKey] ?? 0;
      return (af - bf) * m;
    }
    if (sortKey === 'stock_id') return (a.stock_id.localeCompare(b.stock_id)) * m;
    return (a.score - b.score) * m;
  });

  const etfIds = new Set(data?.etfs?.map((e) => e.stock_id) || []);
  const stockRows = sorted.filter((s) => !etfIds.has(s.stock_id));
  const etfRows = sorted.filter((s) => etfIds.has(s.stock_id));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (loading || !sorted.length) return;
      if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowDown') {
          setFocusedIndex(prev => Math.min(prev + 1, sorted.length - 1));
        } else if (e.key === 'ArrowUp') {
          setFocusedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Home') {
          setFocusedIndex(0);
        } else if (e.key === 'End') {
          setFocusedIndex(sorted.length - 1);
        } else if (e.key === 'Enter') {
          if (focusedIndex >= 0) {
            const sid = sorted[focusedIndex].stock_id;
            setExpandedRow(prev => prev === sid ? null : sid);
          }
        } else if (e.key === 'Escape') {
          setExpandedRow(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loading, sorted, focusedIndex]);

  useEffect(() => {
    if (focusedIndex >= 0 && tableRef.current) {
      const rows = tableRef.current.querySelectorAll('tr[data-stock-id]');
      const target = rows[focusedIndex];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [focusedIndex]);

  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const today = data?.date || new Date().toISOString().slice(0, 10);

  const handleExport = async (format: 'csv' | 'json', _columns: string[]) => {
    setExporting(true);
    const dateStr = today.replace(/-/g, '');
    const url = `http://localhost:8000/api/v1/signals/export.${format}${format === 'csv' ? '' : '?'}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `tw_signals_${dateStr}.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
      setShowExport(false);
    }
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      const newDir = sortDir === 'desc' ? 'asc' : 'desc';
      setSortDir(newDir);
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortIcon = (key: string) => {
    if (sortKey !== key) return '──';
    return sortDir === 'asc' ? '▲' : '▼';
  };

  const strategyLabel = (s: string) => {
    const map: Record<string, string> = { composite: '全部策略', momentum: '動能', value: '價值', quality: '品質', growth: '成長' };
    return map[s] || s;
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>選股訊號 Signals</h1>
        <div className={styles.headerMeta}>
          <input type="date" value={today} className={styles.datePicker} readOnly />
          <select className={styles.select} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            <option value="composite">全部策略</option>
            <option value="momentum">動能</option><option value="value">價值</option><option value="quality">品質</option><option value="growth">成長</option>
          </select>
          <label className={styles.toggle}>
            <input type="checkbox" checked={showEtf} onChange={() => setShowEtf((x) => !x)} />
            ETF
          </label>
          <button className={styles.actionBtn} onClick={() => setShowExport(true)}>
            {exporting ? '匯出中...' : '匯出'}
          </button>
        </div>
      </div>

      <SkeletonScreen loading={loading} variant="table" rows={5} width="100%" height={320}>
      {error ? (
        <EmptyState scenario="failed" onRetry={() => window.location.reload()}>
          <strong>{strategyLabel(strategy)}</strong> 尚無資料 — 請執行排程器或切換策略
        </EmptyState>
      ) : !sorted.length ? (
        <EmptyState scenario="filter">
          今日沒有符合條件的選股結果
        </EmptyState>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table} ref={tableRef}>
            <thead>
              <tr>
                <th style={{ width: 48 }} data-type="number" onClick={() => handleSort('rank')}>
                  排名 {sortIcon('rank')}
                </th>
                <th style={{ width: 48 }} data-type="number" onClick={() => handleSort('rank_change')}>
                  變動 {sortIcon('rank_change')}
                </th>
                <th style={{ width: 160 }} onClick={() => handleSort('stock_id')}>
                  股票 {sortIcon('stock_id')}
                </th>
                <th style={{ width: 88 }} data-type="number">收盤價</th>
                <th style={{ width: 80 }} data-type="number">漲跌</th>
                <th style={{ width: 100 }} data-type="number" onClick={() => handleSort('momentum')}>
                  動能 {sortIcon('momentum')}
                </th>
                <th style={{ width: 100 }} data-type="number" onClick={() => handleSort('value')}>
                  價值 {sortIcon('value')}
                </th>
                <th style={{ width: 100 }} data-type="number" onClick={() => handleSort('quality')}>
                  品質 {sortIcon('quality')}
                </th>
                <th style={{ width: 100 }} data-type="number" onClick={() => handleSort('growth')}>
                  成長 {sortIcon('growth')}
                </th>
                <th style={{ width: 80 }} data-type="number" onClick={() => handleSort('score')}>
                  綜合 {sortIcon('score')}
                </th>
                <th style={{ width: 50 }} data-type="number">天數</th>
                <th style={{ width: 60 }}>持倉</th>
              </tr>
            </thead>
            <tbody>
              {stockRows.map((item) => (
                <SignalRow
                  key={item.stock_id}
                  item={item}
                  navigate={navigate}
                  expanded={expandedRow === item.stock_id}
                  onToggle={() => setExpandedRow(expandedRow === item.stock_id ? null : item.stock_id)}
                  isFocused={sorted[focusedIndex]?.stock_id === item.stock_id}
                />
              ))}
              {etfRows.length > 0 && (
                <tr className={styles.groupDivider}><td colSpan={12}>─ ETFs ─</td></tr>
              )}
              {etfRows.map((item) => (
                <SignalRow
                  key={item.stock_id}
                  item={item}
                  navigate={navigate}
                  expanded={expandedRow === item.stock_id}
                  onToggle={() => setExpandedRow(expandedRow === item.stock_id ? null : item.stock_id)}
                  isFocused={sorted[focusedIndex]?.stock_id === item.stock_id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      </SkeletonScreen>
      {showExport && (
        <ExportModal
          defaultColumns={[
            { key: 'rank', label: '排名', visible: true },
            { key: 'stock_id', label: '股號', visible: true },
            { key: 'name', label: '名稱', visible: true },
            { key: 'score', label: '綜合分數', visible: true },
            { key: 'momentum', label: '動能', visible: true },
            { key: 'value', label: '價值', visible: true },
            { key: 'quality', label: '品質', visible: true },
            { key: 'growth', label: '成長', visible: true },
            { key: 'market_cap', label: '市值', visible: false },
            { key: 'pe_ratio', label: '本益比', visible: false },
          ]}
          onExport={handleExport}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}

function SignalRow({ item, navigate, expanded, onToggle, isFocused }: {
  item: SignalItem; navigate: (p: string) => void;
  expanded: boolean; onToggle: () => void; isFocused: boolean;
}) {
  const rc = item.rank_change;
  const rankChangeStr = rc == null ? '' : rc > 0 ? `▲${rc}` : rc < 0 ? `▼${Math.abs(rc)}` : '—';
  const rcColor = colorize(rc, 'score').className;

  const fs = item.factor_scores || {};
  const momentum = fs.momentum ?? item.score;
  const value = fs.value ?? (item.score * 0.8);
  const quality = fs.quality ?? (item.score * 0.6);
  const growth = fs.growth ?? (item.score * 0.4);

  return (
    <>
      <tr
        tabIndex={0}
        className={`${styles.dataRow} ${isFocused ? styles.focused : ''}`}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter') onToggle(); if (e.key === 'Escape') onToggle(); }}
        data-stock-id={item.stock_id}
      >
        <td data-type="number" className={styles.rankCell}>#{item.rank}</td>
        <td data-type="number" className={rcColor}>
          {rankChangeStr}
        </td>
        <td>
          <span className={styles.stockLink} onClick={(e) => { e.stopPropagation(); navigate(`/signals/${item.stock_id}`); }}>
            {item.stock_id} {item.name || ''}
          </span>
        </td>
        <td data-type="number" className="font-data">—</td>
        <td data-type="number" className="font-data" style={{ color: 'var(--color-bull-text)' }}>—</td>
        <td data-type="number"><FactorMiniBar name="momentum" score={momentum} /></td>
        <td data-type="number"><FactorMiniBar name="value" score={value} /></td>
        <td data-type="number"><FactorMiniBar name="quality" score={quality} /></td>
        <td data-type="number"><FactorMiniBar name="growth" score={growth} /></td>
        <td data-type="number" className={`font-data ${styles.compositeScore}`}>{formatNumber(item.score, { type: 'score' })}</td>
        <td data-type="number" className="font-data" style={{ color: 'var(--text-muted)' }}>
          {item.consecutive_days != null ? item.consecutive_days : '—'}
        </td>
        <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>○</td>
      </tr>
      {expanded && (
        <tr className={styles.expandedRow}>
          <td colSpan={12}>
            <div className={styles.inlineDetail}>
              因子走勢與近30日圖表（T021 後續實作）
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
