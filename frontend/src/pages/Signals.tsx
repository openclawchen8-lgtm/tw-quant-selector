import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchLatestSignals } from '../api/client';
import FactorMiniBar from '../components/FactorMiniBar';
import ExportModal from '../components/ExportModal';
import styles from './Signals.module.css';

interface SignalItem {
  stock_id: string;
  name?: string;
  score: number;
  rank: number;
}

export default function Signals() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<{ date: string; stocks: SignalItem[]; etfs: SignalItem[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState(searchParams.get('sort') || 'score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showEtf, setShowEtf] = useState(true);
  const [dense, setDense] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    fetchLatestSignals(true).then((d: any) => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const allItems = [...(data?.stocks || []), ...(showEtf ? data?.etfs || [] : [])];
  const sorted = [...allItems].sort((a, b) => {
    const m = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'rank') return (a.rank - b.rank) * m;
    return (a.score - b.score) * m;
  });

  const etfIds = new Set(data?.etfs?.map((e) => e.stock_id) || []);
  const stockRows = sorted.filter((s) => !etfIds.has(s.stock_id));
  const etfRows = sorted.filter((s) => etfIds.has(s.stock_id));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (loading || !sorted.length) return;
      if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowDown') {
          setFocusedIndex(prev => Math.min(prev + 1, sorted.length - 1));
        } else if (e.key === 'ArrowUp') {
          setFocusedIndex(prev => Math.max(prev - 1, 0));
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
      setSearchParams({ sort: key, dir: newDir });
    } else {
      setSortKey(key);
      setSortDir('desc');
      setSearchParams({ sort: key, dir: 'desc' });
    }
  };

  const sortIcon = (key: string) => {
    if (sortKey !== key) return '──';
    return sortDir === 'asc' ? '▲' : '▼';
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>選股訊號 Signals</h1>
        <div className={styles.headerMeta}>
          <input type="date" value={today} className={styles.datePicker} />
          <select className={styles.select}>
            <option>全部策略</option>
            <option>動能</option><option>價值</option><option>品質</option><option>成長</option>
          </select>
          <label className={styles.toggle}>
            <input type="checkbox" checked={showEtf} onChange={() => setShowEtf((x) => !x)} />
            ETF
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={dense} onChange={() => setDense((x) => !x)} />
            密集
          </label>
          <button className={styles.actionBtn} onClick={() => setShowExport(true)}>
            {exporting ? '匯出中...' : '匯出'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className={styles.tableSkeleton}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={styles.skelRow}>
              <div className={styles.skelCell} style={{ width: 40 }} />
              <div className={styles.skelCell} style={{ width: 40 }} />
              <div className={styles.skelCell} style={{ width: 140 }} />
              <div className={styles.skelCell} style={{ width: 70 }} />
              <div className={styles.skelCell} style={{ width: 60 }} />
              <div className={styles.skelCell} style={{ width: 80 }} />
              <div className={styles.skelCell} style={{ width: 80 }} />
              <div className={styles.skelCell} style={{ width: 80 }} />
              <div className={styles.skelCell} style={{ width: 80 }} />
              <div className={styles.skelCell} style={{ width: 60 }} />
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={`${styles.table} ${dense ? styles.dense : ''}`} ref={tableRef}>
            <thead>
              <tr>
                <th style={{ width: 48 }} data-type="number" onClick={() => handleSort('rank')}>
                  排名 {sortIcon('rank')}
                </th>
                <th style={{ width: 48 }} data-type="number">變動</th>
                <th style={{ width: 160 }}>股票</th>
                <th style={{ width: 88 }} data-type="number">收盤價</th>
                <th style={{ width: 80 }} data-type="number">漲跌</th>
                <th style={{ width: 100 }} data-type="number">動能</th>
                <th style={{ width: 100 }} data-type="number">價值</th>
                <th style={{ width: 100 }} data-type="number">品質</th>
                <th style={{ width: 100 }} data-type="number">成長</th>
                <th style={{ width: 80 }} data-type="number" onClick={() => handleSort('score')}>
                  綜合 {sortIcon('score')}
                </th>
                <th style={{ width: 50 }} data-type="number">天數</th>
                <th style={{ width: 60 }}>持倉</th>
              </tr>
            </thead>
            <tbody>
              {stockRows.map((item, i) => (
                <SignalRow
                  key={item.stock_id}
                  item={item}
                  index={i}
                  navigate={navigate}
                  expanded={expandedRow === item.stock_id}
                  onToggle={() => setExpandedRow(expandedRow === item.stock_id ? null : item.stock_id)}
                  isFocused={sorted[focusedIndex]?.stock_id === item.stock_id}
                />
              ))}
              {etfRows.length > 0 && (
                <tr className={styles.groupDivider}><td colSpan={12}>─ ETFs ─</td></tr>
              )}
              {etfRows.map((item, i) => (
                <SignalRow
                  key={item.stock_id}
                  item={item}
                  index={i + stockRows.length}
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

function SignalRow({ item, index, navigate, expanded, onToggle, isFocused }: {
  item: SignalItem; index: number; navigate: (p: string) => void;
  expanded: boolean; onToggle: () => void; isFocused: boolean;
}) {
  const rankChange = index === 0 ? 2 : index === 1 ? -1 : index === 2 ? 0 : null;
  const rankChangeStr = rankChange === null ? '' : rankChange > 0 ? `▲${rankChange}` : rankChange < 0 ? `▼${Math.abs(rankChange)}` : '—';

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
        <td data-type="number" style={{ color: rankChange && rankChange > 0 ? 'var(--color-bull-text)' : rankChange && rankChange < 0 ? 'var(--color-bear-text)' : 'var(--text-muted)' }}>
          {rankChangeStr}
        </td>
        <td>
          <span className={styles.stockLink} onClick={(e) => { e.stopPropagation(); navigate(`/signals/${item.stock_id}`); }}>
            {item.stock_id} {item.name || ''}
          </span>
        </td>
        <td data-type="number" className="font-data">—</td>
        <td data-type="number" className="font-data" style={{ color: 'var(--color-bull-text)' }}>—</td>
        <td data-type="number"><FactorMiniBar name="momentum" score={item.score} /></td>
        <td data-type="number"><FactorMiniBar name="value" score={item.score * 0.8} /></td>
        <td data-type="number"><FactorMiniBar name="quality" score={item.score * 0.6} /></td>
        <td data-type="number"><FactorMiniBar name="growth" score={item.score * 0.4} /></td>
        <td data-type="number" className={`font-data ${styles.compositeScore}`}>{item.score.toFixed(2)}</td>
        <td data-type="number" className="font-data" style={{ color: 'var(--text-muted)' }}>—</td>
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
