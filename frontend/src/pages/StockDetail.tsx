import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { fetchStockDetail, fetchFactorHistory } from '../api/client';
import type { FactorHistoryPoint } from '../api/client';
import FactorMiniBar from '../components/FactorMiniBar';
import SkeletonLoader from '../components/SkeletonLoader';
import EmptyState from '../components/EmptyState';
import { formatNumber, colorize } from '../utils/format';
import styles from './StockDetail.module.css';

interface StockInfo {
  stock_id: string; name: string; market: string; is_etf: boolean; industry: string | null;
}
interface PricePoint { d: string; o: number | null; h: number | null; l: number | null; c: number | null; v: number | null; }
interface ValPoint { d: string; pe: number | null; pb: number | null; dy: number | null; }
interface FinPoint { yq: string; rev: number | null; eps: number | null; roe: number | null; gm: number | null; de: number | null; }
interface RevPoint { ym: string; rev: number | null; yoy: number | null; }

export default function StockDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<{
    info: StockInfo; prices: PricePoint[]; valuations: ValPoint[];
    financials: FinPoint[]; revenue: RevPoint[]; factor_scores: Record<string, number> | null;
  } | null>(null);
  const [factorHistory, setFactorHistory] = useState<FactorHistoryPoint[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const validTabs = ['factors', 'financials', 'history'] as const;
  const rawTab = searchParams.get('tab');
  const initialTab = validTabs.includes(rawTab as any) ? rawTab as 'factors' | 'financials' | 'history' : 'factors';
  const [tab, setTab] = useState<'factors' | 'financials' | 'history'>(initialTab);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setHistoryLoading(true);
    setHistoryError(false);
    fetchStockDetail(id).then((d: any) => { setData(d); setLoading(false); }).catch(() => setLoading(false));
    fetchFactorHistory(id).then((h) => { setFactorHistory(h); setHistoryLoading(false); }).catch(() => { setHistoryError(true); setHistoryLoading(false); });
  }, [id]);

  useEffect(() => {
    setSearchParams(prev => { prev.set('tab', tab); return prev; }, { replace: true });
  }, [tab]);

  if (loading) {
    return <div className={styles.page}><SkeletonLoader variant="card" /><SkeletonLoader variant="table" rows={3} /></div>;
  }

  if (!data) {
    return <div className={styles.page}><EmptyState scenario="notrade">查無此股票資料</EmptyState></div>;
  }

  const { info, prices, valuations, financials, revenue, factor_scores } = data;
  const lastPrice = prices[0]?.c;

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <span className={styles.stockId}>{info.stock_id}</span>
          <span className={styles.stockName}>{info.name}</span>
          <span className={`${styles.badge} ${info.is_etf ? styles.etfBadge : styles.stockBadge}`}>
            {info.is_etf ? 'ETF' : '股票'}
          </span>
          <span className={styles.meta}>{info.market} {info.industry || ''}</span>
        </div>
        <div className={styles.priceSection}>
          <span className={styles.price}>{formatNumber(lastPrice, { type: 'price' })}</span>
          <span className={styles.change} style={{ color: 'var(--color-bull-text)' }}>▲—</span>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {(['factors', 'financials', 'history'] as const).map((t) => (
          <button key={t} className={`${styles.tab} ${tab === t ? styles.activeTab : ''}`} onClick={() => setTab(t)}>
            {t === 'factors' ? '因子分析' : t === 'financials' ? '財務摘要' : '歷史入選紀錄'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'factors' && (
        <div className={styles.tabContent}>
          {historyError ? (
            <EmptyState scenario="failed">無法載入因子歷史資料</EmptyState>
          ) : historyLoading ? (
            <div className={styles.factorGrid}>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className={styles.sparkCard}>
                  <SkeletonLoader variant="chart" />
                </div>
              ))}
            </div>
          ) : !factorHistory || factorHistory.length === 0 ? (
            <EmptyState scenario="notrade">尚無因子歷史資料</EmptyState>
          ) : (
            <FactorSparklines history={factorHistory} scores={factor_scores ?? {}} />
          )}
        </div>
      )}

      {tab === 'financials' && (
        <div className={styles.tabContent}>
          <div className={styles.finGrid}>
            <div className={styles.finPanel}>
              <h3>本益比/淨值比 PE/PB</h3>
              <table className={styles.finTable}>
                <thead><tr><th>日期</th><th>PE</th><th>PB</th><th>殖利率</th></tr></thead>
                <tbody>
                  {valuations.length === 0 ? (
                    <tr><td colSpan={4} className={styles.emptyCell}>尚無本益比資料，資料排程 ingesting 中</td></tr>
                  ) : valuations.slice(0, 8).map((v) => (
                    <tr key={v.d}><td>{v.d}</td><td className="font-data">{v.pe ?? '—'}</td><td className="font-data">{v.pb ?? '—'}</td>
                      <td className="font-data">{formatNumber(v.dy, { type: 'percent' })}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.finPanel}>
              <h3>財報 Financials</h3>
              <table className={styles.finTable}>
                <thead><tr><th>季度</th><th>營收</th><th>EPS</th><th>ROE</th><th>毛利率</th><th>負債比</th></tr></thead>
                <tbody>
                  {financials.length === 0 ? (
                    <tr><td colSpan={6} className={styles.emptyCell}>尚無財報資料，資料排程 ingesting 中</td></tr>
                  ) : financials.slice(0, 8).map((f) => (
                    <tr key={f.yq}>
                      <td>{f.yq}</td>
                      <td className="font-data">{formatNumber(f.rev, { type: 'market_cap' })}</td>
                      <td className="font-data">{f.eps ?? '—'}</td>
                      <td className="font-data">{formatNumber(f.roe, { type: 'percent' })}</td>
                      <td className="font-data">{formatNumber(f.gm, { type: 'percent' })}</td>
                      <td className="font-data">{formatNumber(f.de, { type: 'ratio', decimals: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.finPanel}>
              <h3>月營收 Monthly Revenue</h3>
              <table className={styles.finTable}>
                <thead><tr><th>月份</th><th>營收</th><th>年增率 YoY</th></tr></thead>
                <tbody>
                  {revenue.length === 0 ? (
                    <tr><td colSpan={3} className={styles.emptyCell}>尚無月營收資料，資料排程 ingesting 中</td></tr>
                  ) : revenue.slice(0, 12).map((r) => (
                    <tr key={r.ym}><td>{r.ym}</td>
                      <td className="font-data">{formatNumber(r.rev, { type: 'market_cap' })}</td>
                      <td className={`font-data ${r.yoy != null ? colorize(r.yoy, 'percent').className : ''}`}>
                        {formatNumber(r.yoy, { type: 'percent' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className={styles.tabContent}>
          <div className={styles.finPanel}>
            <h3>歷史入選紀錄</h3>
            <table className={styles.finTable}>
              <thead><tr><th>入選日期</th><th>排名</th><th>持有期間</th><th>期間報酬</th></tr></thead>
              <tbody>
                <tr><td colSpan={4} className={styles.emptyCell}>暫無歷史入選紀錄，待選股訊號累積後自動產生</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FactorSparklines({ history, scores }: { history: FactorHistoryPoint[]; scores: Record<string, number> }) {
  const factors = ['momentum', 'value', 'quality', 'growth'] as const;
  const labels: Record<string, string> = { momentum: '動能', value: '價值', quality: '品質', growth: '成長' };

  const series = useMemo(() => {
    return factors.map((f) => {
      const vals: number[] = [];
      for (let i = history.length - 1; i >= 0; i--) {
        const v = history[i][f];
        if (v != null) vals.push(v);
      }
      return { key: f, values: vals };
    });
  }, [history]);

  return (
    <div className={styles.factorGrid}>
      {series.map(({ key, values }) => {
        const score = scores[key] ?? 0;
        const { path, fillPath, dotY, pathLen } = buildSparklinePath(values);
        const gradId = `grad-${key}`;
        return (
          <div key={key} className={styles.sparkCard}>
            <div className={styles.sparkHeader}>
              <span style={{ color: `var(--color-${key})`, fontWeight: 600 }}>
                {labels[key]}
              </span>
              <FactorMiniBar name={key} score={score} showLabels />
            </div>
            <div className={styles.sparkline}>
              <svg width="100%" height="80" viewBox="0 0 300 80" preserveAspectRatio="none">
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={`var(--color-${key})`} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={`var(--color-${key})`} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line x1="0" y1="40" x2="300" y2="40" stroke="var(--bg-border)" strokeWidth="1" strokeDasharray="4 2" />
                {fillPath && <path d={fillPath} fill={`url(#${gradId})`} />}
                {path && <path d={path} fill="none" stroke={`var(--color-${key})`} strokeWidth="1.5" className="sparkline-path" style={{ '--path-len': pathLen } as React.CSSProperties} />}
                {dotY != null && <circle cx="300" cy={dotY} r="3" fill={`var(--color-${key})`} />}
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function buildSparklinePath(values: number[]) {
  if (values.length < 2) return { path: '', fillPath: '', dotY: null, pathLen: 0 };

  const w = 300, h = 80, pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const n = values.length;

  const pts = values.map((v, i) => {
    const x = (i / (n - 1)) * w;
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return [x, y] as [number, number];
  });

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const fill = `M${pts[0][0].toFixed(1)},${h}L${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}L${pts[n - 1][0].toFixed(1)},${h}Z`;

  return { path: line, fillPath: fill, dotY: pts[n - 1][1], pathLen: Math.round(w * 1.5) };
}
