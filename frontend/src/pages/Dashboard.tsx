import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchDashboard, fetchLatestSignals, type DashboardData } from '../api/client';
import StatCard from '../components/StatCard';
import FactorMiniBar from '../components/FactorMiniBar';
import styles from './Dashboard.module.css';

interface SignalItem {
  stock_id: string;
  name?: string;
  score: number;
  rank: number;
}

interface SignalsData {
  date: string;
  stocks: SignalItem[];
  etfs: SignalItem[];
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [signals, setSignals] = useState<SignalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, s] = await Promise.all([
        fetchDashboard(),
        fetchLatestSignals(true).catch(() => null),
      ]);
      setDash(d);
      setSignals(s);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = new Date();
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()];

  const allItems = [...(signals?.stocks || []), ...(signals?.etfs || [])];
  const sorted = [...allItems].sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'rank') return (a.rank - b.rank) * mul;
    return (a.score - b.score) * mul;
  });

  const etfIds = new Set(signals?.etfs?.map((e) => e.stock_id) || []);
  const stockItems = sorted.filter((s) => !etfIds.has(s.stock_id));
  const etfItems = sorted.filter((s) => etfIds.has(s.stock_id));

  return (
    <div className={styles.page}>
      {/* Page header */}
      <div className={styles.header}>
        <h1 className={styles.title}>今日總覽 Dashboard</h1>
        <span className={styles.headerDate}>
          {today.toISOString().slice(0, 10)}（{weekday}）台股收盤
        </span>
        <button className={styles.refreshBtn} onClick={load} disabled={loading}>
          {loading ? '⋯' : '↻ 重新整理'}
        </button>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          ⚠ 載入失敗：{error}
          <button className={styles.retryBtn} onClick={load}>重試</button>
        </div>
      )}

      {/* KPI row */}
      <div className={styles.kpiRow} role="group" aria-label="關鍵指標總覽">
        <StatCard label="今日選股" value={signals?.stocks.length ?? 0} variant="highlight" loading={loading} />
        <StatCard label="入選ETF" value={signals?.etfs.length ?? 0} loading={loading} />
        <StatCard
          label="組合分數"
          value={signals?.stocks.reduce((s, i) => s + i.score, 0) ?? 0}
          format="raw"
          loading={loading}
        />
        <StatCard
          label="大盤概況"
          value={loading ? 0 : '加權'}
          format="raw"
          loading={loading}
          delta={0.003}
          deltaLabel="vs 昨日"
        />
      </div>

      {/* Weekly portfolio P&L */}
      <div className={styles.weeklyPnl}>
        <span className={styles.pnlLabel}>本週持倉損益</span>
        <span className={styles.pnlBull}>+2.4%</span>
        <span className={styles.pnlLabel}>vs 0050</span>
        <span className={styles.pnlMuted}>+1.1%</span>
        <span className={styles.pnlLabel}>超額</span>
        <span className={styles.pnlBull}>+1.3%</span>
      </div>

      {/* Signal table */}
      <div className={styles.sectionHeader}>
        <h2>今日入選個股 Top {signals?.stocks.length || 20}</h2>
        <div className={styles.headerActions}>
          <button className={styles.actionBtn} onClick={() => navigate('/signals')}>詳細訊號</button>
          <button className={styles.actionBtn}>匯出CSV</button>
        </div>
      </div>

      {loading ? (
        <div className={styles.tableSkeleton}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={styles.skelRow}>
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
      ) : allItems.length === 0 ? (
        <div className={styles.emptyState}>
          今日沒有符合條件的選股結果
          <div className={styles.emptyReasons}>
            可能原因：市場休市、資料尚未更新、篩選條件過嚴
          </div>
          <button className={styles.actionBtn} onClick={() => navigate('/monitor')}>
            查看資料監控
          </button>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table} role="grid" aria-label="最新選股訊號表格">
            <thead>
              <tr>
                <th style={{ width: 48 }} data-type="number">排名</th>
                <th style={{ width: 160 }}>股票</th>
                <th style={{ width: 88 }} data-type="number">收盤價</th>
                <th style={{ width: 80 }} data-type="number">今日漲跌</th>
                <th style={{ width: 100 }} data-type="number">動能</th>
                <th style={{ width: 100 }} data-type="number">價值</th>
                <th style={{ width: 100 }} data-type="number">品質</th>
                <th style={{ width: 100 }} data-type="number">成長</th>
                <th style={{ width: 80 }} data-type="number">綜合分數</th>
              </tr>
            </thead>
            <tbody>
              {/* Stocks */}
              {stockItems.map((item) => (
                <SignalRow key={item.stock_id} item={item} navigate={navigate} />
              ))}
              {/* ETF separator */}
              {etfItems.length > 0 && (
                <tr className={styles.groupDivider}>
                  <td colSpan={9}>─ ETFs ─</td>
                </tr>
              )}
              {etfItems.map((item) => (
                <SignalRow key={item.stock_id} item={item} navigate={navigate} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Factor contribution & weekly changes */}
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

function SignalRow({ item, navigate }: { item: SignalItem; navigate: (p: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr
        tabIndex={0}
        className={styles.dataRow}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => { if (e.key === 'Enter') setExpanded((x) => !x); if (e.key === 'Escape') setExpanded(false); }}
      >
        <td data-type="number" className={styles.rankCell}>#{item.rank}</td>
        <td>
          <span
            className={styles.stockLink}
            onClick={(e) => { e.stopPropagation(); navigate(`/signals/${item.stock_id}`); }}
          >
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
      </tr>
      {expanded && (
        <tr className={styles.expandedRow}>
          <td colSpan={9}>
            <div className={styles.inlineDetail}>
              因子趨勢與近 30 日圖（T021 實作）
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
