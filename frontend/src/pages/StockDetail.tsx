import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { fetchStockDetail } from '../api/client';
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
  const validTabs = ['factors', 'financials', 'history'] as const;
  const rawTab = searchParams.get('tab');
  const initialTab = validTabs.includes(rawTab as any) ? rawTab as 'factors' | 'financials' | 'history' : 'factors';
  const [tab, setTab] = useState<'factors' | 'financials' | 'history'>(initialTab);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchStockDetail(id).then((d: any) => { setData(d); setLoading(false); }).catch(() => setLoading(false));
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
          <div className={styles.factorGrid}>
            {['momentum', 'value', 'quality', 'growth'].map((f) => {
              const score = factor_scores?.[f] ?? 0;
              return (
                <div key={f} className={styles.sparkCard}>
                  <div className={styles.sparkHeader}>
                    <span style={{ color: `var(--color-${f})`, fontWeight: 600 }}>
                      {f === 'momentum' ? '動能' : f === 'value' ? '價值' : f === 'quality' ? '品質' : '成長'}
                    </span>
                    <FactorMiniBar name={f} score={score} showLabels />
                  </div>
                  <div className={styles.sparkline}>
                    <svg width="100%" height="80" viewBox="0 0 300 80" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id={`grad-${f}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={`var(--color-${f})`} stopOpacity="0.3" />
                          <stop offset="100%" stopColor={`var(--color-${f})`} stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <line x1="0" y1="40" x2="300" y2="40" stroke="var(--bg-border)" strokeWidth="1" strokeDasharray="4 2" />
                      <path d={generateSparklinePath(20)} fill={`url(#grad-${f})`} />
                      <path d={generateSparklinePath(20)} fill="none" stroke={`var(--color-${f})`} strokeWidth="1.5" className="sparkline-path" style={{ '--path-len': '400' } as React.CSSProperties} />
                      <circle cx="300" cy="30" r="3" fill={`var(--color-${f})`} />
                    </svg>
                  </div>
                </div>
              );
            })}
          </div>
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

function generateSparklinePath(n: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 300;
    const y = 20 + Math.random() * 40;
    pts.push([x, y]);
  }
  const avg = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${40 - (p[1] - avg)}`).join('');
  return d;
}
