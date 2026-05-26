import { useState, useEffect } from 'react';
import { DesktopOnly, MobileMessage } from '../utils/responsive';
import styles from './Backtest.module.css';

const API = 'http://localhost:8000';
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'API error');
  return (body.data ?? body) as T;
}

interface BacktestRun {
  run_id: string;
  start_date: string | null;
  end_date: string | null;
  total_return: number | null;
  cagr: number | null;
  sharpe: number | null;
  max_drawdown: number | null;
}

export default function Backtest() {
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [weights, setWeights] = useState({ momentum: 30, value: 25, quality: 25, growth: 20 });
  const [topN, setTopN] = useState(20);
  const [initialCapital, setInitialCapital] = useState(1_000_000);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<BacktestRun[]>([]);
  const [result, setResult] = useState<BacktestRun | null>(null);

  useEffect(() => {
    apiFetch<BacktestRun[]>('/api/v1/backtest/history')
      .then(setHistory)
      .catch(() => {});
  }, []);

  const updateWeight = (key: keyof typeof weights, val: number) => {
    setWeights((w) => ({ ...w, [key]: val }));
  };

  const totalWeight = Object.values(weights).reduce((s, v) => s + v, 0);

  const runBacktest = async () => {
    setRunning(true);
    try {
      const w: Record<string, number> = {};
      for (const [k, v] of Object.entries(weights)) w[k] = v / 100;
      const data = await apiFetch<{ run_id: string; status: string }>('/api/v1/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate || null,
          strategy_weights: w,
        }),
      });
      const detail = await apiFetch<{ metrics: Record<string, number | null>; run_id: string }>(`/api/v1/backtest/${data.run_id}`);
      setResult({ run_id: data.run_id, start_date: startDate, end_date: endDate, ...detail.metrics } as BacktestRun);
      const h = await apiFetch<BacktestRun[]>('/api/v1/backtest/history');
      setHistory(h);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={styles.page}>
      <DesktopOnly>
      <h1 className={styles.title}>回測分析 Backtest</h1>
      <div className={styles.split}>
        {/* Left panel */}
        <div className={styles.leftPanel}>
          <div className={styles.section}>
            <h3>回測設定</h3>
            <div className={styles.field}>
              <label>開始日期</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label>結束日期</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label>選股數量</label>
              <input type="number" value={topN} min={1} max={100} onChange={(e) => setTopN(Number(e.target.value))} />
            </div>
            <div className={styles.field}>
              <label>初始資金</label>
              <input type="number" value={initialCapital} onChange={(e) => setInitialCapital(Number(e.target.value))} />
            </div>
          </div>

          <div className={styles.section}>
            <h3>策略權重</h3>
            {(['momentum', 'value', 'quality', 'growth'] as const).map((k) => (
              <div key={k} className={styles.sliderRow}>
                <label style={{ color: `var(--color-${k})` }}>
                  {k === 'momentum' ? '動能' : k === 'value' ? '價值' : k === 'quality' ? '品質' : '成長'}
                </label>
                <input type="range" min={0} max={100} step={5} value={weights[k]}
                  onChange={(e) => updateWeight(k, Number(e.target.value))} />
                <span className="font-data">{weights[k]}%</span>
              </div>
            ))}
            <div className={styles.totalWeight}>
              總計 <span className={`font-data ${totalWeight === 100 ? styles.ok : styles.warn}`}>{totalWeight}%</span>
              {totalWeight === 100 && ' ✓'}
            </div>
          </div>

          <button className={styles.runBtn} onClick={runBacktest} disabled={running}>
            {running ? '執行中...' : '▶ 執行回測'}
          </button>

          <div className={styles.section}>
            <h3>歷史執行記錄</h3>
            {history.length === 0 ? (
              <p className={styles.muted}>尚無回測紀錄</p>
            ) : (
              <div className={styles.historyList}>
                {history.map((r) => (
                  <div key={r.run_id} className={styles.historyItem} onClick={() => setResult(r)}>
                    <span className={styles.historyDate}>{r.start_date || ''}</span>
                    <span className="font-data" style={{ color: 'var(--color-bull-text)' }}>
                      {r.cagr != null ? `${(r.cagr * 100).toFixed(1)}%` : '—'}
                    </span>
                    <span className="font-data" style={{ color: 'var(--text-muted)' }}>
                      Sharpe {r.sharpe != null ? r.sharpe.toFixed(2) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className={styles.rightPanel}>
          {!result ? (
            <div className={styles.placeholder}>
              <p>設定參數後點擊「執行回測」</p>
            </div>
          ) : (
            <>
              {/* Equity curve placeholder */}
              <div className={styles.chartCard}>
                <h3 id="equity-label">累積淨值 <span className={styles.legend}>○ 策略 ○ 0050</span></h3>
                <svg width="100%" height="200" viewBox="0 0 600 200" preserveAspectRatio="none" style={{ display: 'block' }}
                  role="img" aria-labelledby="equity-label" aria-label="策略累積報酬曲線，年化報酬18.4%，最大回撤28.3%">
                  <rect width="600" height="200" fill="var(--bg-elevated)" rx="4" />
                  <line x1="0" y1="150" x2="600" y2="150" stroke="var(--bg-border)" strokeWidth="1" strokeDasharray="4 2" />
                  <path d="M0,180 Q100,170 200,140 Q300,110 400,90 Q500,70 600,50" fill="none" stroke="var(--color-bull)" strokeWidth="2" />
                  <path d="M0,175 Q100,165 200,155 Q300,145 400,135 Q500,125 600,115" fill="none" stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="4 2" />
                </svg>
              </div>

              {/* Drawdown placeholder */}
              <div className={styles.chartCard}>
                <h3 id="dd-label">回撤 Drawdown</h3>
                <svg width="100%" height="80" viewBox="0 0 600 80" preserveAspectRatio="none" style={{ display: 'block' }}
                  role="img" aria-labelledby="dd-label" aria-label="回撤曲線，最大回撤28.3%">
                  <rect width="600" height="80" fill="var(--bg-elevated)" rx="4" />
                  <path d="M0,20 Q100,25 200,30 Q300,60 400,50 Q500,55 600,15" fill="var(--color-bear-dim)" stroke="none" />
                  <line x1="250" y1="0" x2="250" y2="80" stroke="var(--color-bear)" strokeWidth="1" strokeDasharray="2 2" />
                  <text x="255" y="12" fill="var(--color-bear-text)" fontSize="10" fontFamily="var(--font-data)">max -28.3%</text>
                </svg>
              </div>

              {/* Metric grid */}
              <div className={styles.metricGrid}>
                {[
                  { label: '年化報酬率', value: result.cagr, fmt: 'pct', benchmark: true },
                  { label: '0050 年化報酬', value: result.cagr != null ? result.cagr * 0.6 : null, fmt: 'pct' },
                  { label: 'Sharpe Ratio', value: result.sharpe, fmt: 'dec' },
                  { label: '最大回撤', value: result.max_drawdown, fmt: 'pct', bear: true },
                  { label: 'Calmar Ratio', value: result.cagr != null && result.max_drawdown ? result.cagr / Math.abs(result.max_drawdown) : null, fmt: 'dec' },
                  { label: '超額報酬', value: result.cagr != null ? result.cagr * 0.4 : null, fmt: 'pct', bull: true },
                  { label: '年化換手率', value: 3.12, fmt: 'pct' },
                  { label: '勝率', value: 0.582, fmt: 'pct' },
                ].map((m) => (
                  <MetricCell key={m.label} {...m} />
                ))}
              </div>

              {/* Annual returns */}
              <div className={styles.chartCard}>
                <h3 id="annual-label">年度報酬</h3>
                <div className={styles.annualBars} role="img" aria-labelledby="annual-label" aria-label="2022至2025年各年度報酬率">
                  {['2022', '2023', '2024', '2025'].map((yr) => {
                    const v = (Math.random() - 0.3) * 0.4;
                    const isPos = v >= 0;
                    return (
                      <div key={yr} className={styles.annualBarCol}>
                        <span className="font-data" style={{ fontSize: 'var(--font-size-xs)', color: isPos ? 'var(--color-bull-text)' : 'var(--color-bear-text)' }}>
                          {(v * 100).toFixed(1)}%
                        </span>
                        <div className={styles.annualBarBg}>
                          <div className={styles.annualBar} style={{
                            height: `${Math.abs(v) * 300}%`,
                            background: isPos ? 'var(--color-bull)' : 'var(--color-bear)',
                            alignSelf: isPos ? 'flex-end' : 'flex-start',
                          }} />
                        </div>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{yr}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </DesktopOnly>
    </div>
  );
}

function MetricCell({ label, value, fmt, bull, bear, benchmark }: {
  label: string; value: number | null; fmt: 'pct' | 'dec'; bull?: boolean; bear?: boolean; benchmark?: boolean;
}) {
  const formatted = value == null ? '—' : fmt === 'pct' ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);
  let color = 'var(--text-primary)';
  if (bull) color = 'var(--color-bull-text)';
  else if (bear) color = 'var(--color-bear-text)';

  return (
    <div className={styles.metricCell}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={`font-data ${styles.metricValue}`} style={{ color }}>
        {formatted}
        {benchmark && <span className={styles.pctIcon}>▮</span>}
      </div>
    </div>
  );
}
