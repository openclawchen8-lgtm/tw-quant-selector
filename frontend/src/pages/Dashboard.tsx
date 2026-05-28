import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchLatestSignals } from '../api/client';
import { usePageCache } from '../hooks/usePageCache';
import BaseTable from '../components/BaseTable';
import StatCard from '../components/StatCard';
import FactorMiniBar from '../components/FactorMiniBar';
import EmptyState from '../components/EmptyState';
import ErrorBoundary from '../components/ErrorBoundary';
import { useToast } from '../components/Toast';
import { formatNumber, colorize } from '../utils/format';
import MarketStatus from '../components/MarketStatus';
import type { ColumnDef } from '@tanstack/react-table';
import styles from './Dashboard.module.css';

interface SignalItem {
  stock_id: string;
  name?: string;
  score: number;
  rank: number;
  factor_scores?: Record<string, number> | null;
}

interface SignalsData {
  date: string;
  stocks: SignalItem[];
  etfs: SignalItem[];
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [signals, setSignals] = useState<SignalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();

  const { getCached, setCached } = usePageCache<SignalsData>('dashboard');
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStale(false);
    try {
      const s = await fetchLatestSignals('composite', true).catch(() => null);
      if (s) {
        setSignals(s as SignalsData);
        setCached(s as SignalsData);
      } else {
        const cached = getCached();
        if (cached) { setSignals(cached); setStale(true); }
        else setSignals(null);
      }
    } catch (e: any) {
      const cached = getCached();
      if (cached) { setSignals(cached); setStale(true); setError('無法更新，顯示快取資料'); addToast('無法更新，顯示快取資料', 'high'); }
      else { setError(e.message); addToast(`載入失敗: ${e.message}`, 'high'); }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = new Date();
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()];

  const allItems = [...(signals?.stocks || []), ...(signals?.etfs || [])];
  const sorted = [...allItems].sort((a, b) => a.rank - b.rank);

  const etfIds = new Set(signals?.etfs?.map((e) => e.stock_id) || []);
  const stockItems = sorted.filter((s) => !etfIds.has(s.stock_id));
  const etfItems = sorted.filter((s) => etfIds.has(s.stock_id));
  const displayData = [...stockItems, ...etfItems];

  const columns: ColumnDef<SignalItem, any>[] = [
    {
      id: 'rank',
      header: '排名',
      accessorKey: 'rank',
      meta: { width: 48, align: 'right' as const },
      cell: ({ getValue }) => <span className={styles.rankCell}>#{getValue<number>()}</span>,
    },
    {
      id: 'stock_id',
      header: '股票',
      accessorKey: 'stock_id',
      meta: { width: 160 },
      cell: ({ row }) => (
        <span className={styles.stockLink} onClick={(e) => { e.stopPropagation(); navigate(`/signals/${row.original.stock_id}`); }}>
          {row.original.stock_id} {row.original.name || ''}
        </span>
      ),
    },
    {
      id: 'close_price',
      header: '收盤價',
      meta: { width: 88, align: 'right' as const },
      cell: () => <span className="font-data">—</span>,
    },
    {
      id: 'change',
      header: '今日漲跌',
      meta: { width: 80, align: 'right' as const },
      cell: () => <span className="font-data" style={{ color: 'var(--color-bull-text)' }}>—</span>,
    },
    {
      id: 'momentum',
      header: '動能',
      accessorFn: (row: SignalItem) => row.factor_scores?.momentum ?? row.score,
      meta: { width: 100, align: 'right' as const },
      cell: ({ row }) => <FactorMiniBar name="momentum" score={row.original.factor_scores?.momentum ?? row.original.score} />,
    },
    {
      id: 'value',
      header: '價值',
      accessorFn: (row: SignalItem) => row.factor_scores?.value ?? row.score * 0.8,
      meta: { width: 100, align: 'right' as const },
      cell: ({ row }) => <FactorMiniBar name="value" score={row.original.factor_scores?.value ?? row.original.score * 0.8} />,
    },
    {
      id: 'quality',
      header: '品質',
      accessorFn: (row: SignalItem) => row.factor_scores?.quality ?? row.score * 0.6,
      meta: { width: 100, align: 'right' as const },
      cell: ({ row }) => <FactorMiniBar name="quality" score={row.original.factor_scores?.quality ?? row.original.score * 0.6} />,
    },
    {
      id: 'growth',
      header: '成長',
      accessorFn: (row: SignalItem) => row.factor_scores?.growth ?? row.score * 0.4,
      meta: { width: 100, align: 'right' as const },
      cell: ({ row }) => <FactorMiniBar name="growth" score={row.original.factor_scores?.growth ?? row.original.score * 0.4} />,
    },
    {
      id: 'score',
      header: '綜合分數',
      accessorKey: 'score',
      meta: { width: 80, align: 'right' as const },
      cell: ({ getValue }) => (
        <span className={`font-data ${styles.compositeScore}`}>{formatNumber(getValue<number>(), { type: 'score' })}</span>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>今日總覽 Dashboard</h1>
        <span className={styles.headerDate}>
          {today.toISOString().slice(0, 10)}（{weekday}）
        </span>
        <MarketStatus />
        <button className={`${styles.refreshBtn}${loading ? ' btn-loading' : ''}`} onClick={load} disabled={loading}>
          {loading ? '⋯' : '↻ 重新整理'}
        </button>
      </div>

      {stale && (
        <div className={styles.errorBanner} style={{ background: 'var(--color-warning-dim, rgba(245,158,11,0.15))' }}>
          ⚠ 無法連線，顯示快取資料（資料可能已過時）
          <button className={styles.retryBtn} onClick={load}>重試</button>
        </div>
      )}
      {error && !stale && (
        <div className={styles.errorBanner}>
          ⚠ 載入失敗：{error}
          <button className={styles.retryBtn} onClick={load}>重試</button>
        </div>
      )}

      <div className={styles.kpiRow} role="group" aria-label="關鍵指標總覽">
        <ErrorBoundary level="component" name="今日選股"><StatCard label="今日選股" value={signals?.stocks.length ?? 0} variant="highlight" loading={loading} /></ErrorBoundary>
        <ErrorBoundary level="component" name="入選ETF"><StatCard label="入選ETF" value={signals?.etfs.length ?? 0} loading={loading} /></ErrorBoundary>
        <ErrorBoundary level="component" name="組合分數"><StatCard
          label="組合分數"
          value={signals?.stocks.reduce((s, i) => s + i.score, 0) ?? 0}
          format="raw"
          loading={loading}
        /></ErrorBoundary>
        <ErrorBoundary level="component" name="大盤概況"><StatCard
          label="大盤概況"
          value={loading ? 0 : '加權'}
          format="raw"
          loading={loading}
          delta={0.003}
          deltaLabel="vs 昨日"
        /></ErrorBoundary>
      </div>

      <div className={styles.weeklyPnl}>
        <span className={styles.pnlLabel}>本週持倉損益</span>
        <span className={styles.pnlBull}>▲ +2.4%</span>
        <span className={styles.pnlLabel}>vs 0050</span>
        <span className={styles.pnlMuted}>▲ +1.1%</span>
        <span className={styles.pnlLabel}>超額</span>
        <span className={styles.pnlBull}>▲ +1.3%</span>
      </div>

      <div className={styles.sectionHeader}>
        <h2>今日入選個股 Top {signals?.stocks.length || 20}</h2>
        <div className={styles.headerActions}>
          <button className={styles.actionBtn} onClick={() => navigate('/signals')}>詳細訊號</button>
          <button className={styles.actionBtn}>匯出CSV</button>
        </div>
      </div>

      <BaseTable<SignalItem>
        columns={columns}
        data={displayData}
        loading={loading}
        emptyMessage="今日沒有符合條件的選股結果"
        sortable={false}
        getRowId={(row) => row.stock_id}
        renderRowDetail={() => (
          <div>因子趨勢與近 30 日圖（T021 實作）</div>
        )}
        groupLabel={(row, i, all) => {
          if (i > 0 && etfIds.has(row.stock_id) && !etfIds.has(all[i - 1].stock_id)) return 'ETF';
          return null;
        }}
      />

      <div className={styles.bottomGrid}>
        <div className={styles.panel}>
          <h3>因子貢獻摘要</h3>
          <div className={styles.factorContrib}>
            {['momentum', 'value', 'quality', 'growth'].map((f) => (
              <div key={f} className={styles.factorRow}>
                <span className={styles.factorLabel} style={{ color: `var(--color-${f})` }}>{f}</span>
                <div className={styles.factorBarBg}>
                  <div className={styles.factorBarFill} style={{
                    width: `${(f === 'momentum' ? 30 : f === 'value' ? 25 : f === 'quality' ? 25 : 20)}%`,
                    background: `var(--color-${f})`,
                  }} />
                </div>
                <span className={styles.factorPct}>
                  {f === 'momentum' ? 30 : f === 'value' ? 25 : f === 'quality' ? 25 : 20}%
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.panel}>
          <h3>本週換股異動</h3>
          <div className={styles.changeList}>
            <div className={styles.changeItem}>
              <span className={styles.changeBuy}>+ 買入</span>
              <span>3 檔</span>
            </div>
            <div className={styles.changeItems}>
              2330 台積電、2454 聯發科、2317 鴻海
            </div>
            <div className={styles.changeItem}>
              <span className={styles.changeSell}>- 賣出</span>
              <span>3 檔</span>
            </div>
            <div className={styles.changeItems}>
              2308 台達電、2881 富邦金、2412 中華電
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
