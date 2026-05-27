import { useState, useEffect, useRef } from 'react';
import { createChart, ColorType, LineSeries, AreaSeries } from 'lightweight-charts';
import { fetchBacktestEquity, type EquityPoint } from '../api/client';
import { DesktopOnly } from '../utils/responsive';
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

import SkeletonLoader from '../components/SkeletonLoader';

export default function Backtest() {
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [weights, setWeights] = useState({ momentum: 30, value: 25, quality: 25, growth: 20 });
  const [topN, setTopN] = useState(20);
  const [initialCapital, setInitialCapital] = useState(1_000_000);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<BacktestRun[]>([]);
  const [result, setResult] = useState<BacktestRun | null>(null);
  const [equityData, setEquityData] = useState<EquityPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    apiFetch<BacktestRun[]>('/api/v1/backtest/history')
      .then(setHistory)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (result?.run_id) {
      setChartLoading(true);
      fetchBacktestEquity(result.run_id)
        .then(data => { setEquityData(data); setChartLoading(false); })
        .catch(() => { setEquityData([]); setChartLoading(false); });
    } else {
      setEquityData([]);
    }
  }, [result?.run_id]);

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
              {/* Equity curve chart */}
              <div className={styles.chartCard}>
                <h3 id="equity-label">累積淨值 <span className={styles.legend}><span style={{color:'var(--color-bull)'}}>● 策略</span> <span style={{color:'var(--text-muted)'}}>○ 0050</span></span></h3>
                <div style={{ position: 'relative' }}>
                  {chartLoading ? <SkeletonLoader variant="chart" height={250} children={<></>} /> : (
                    equityData.length === 0 ? <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>尚無淨值資料</div> : <BacktestChart data={equityData} height={250} />
                  )}
                </div>
              </div>

              {/* Drawdown chart */}
              <div className={styles.chartCard}>
                <h3 id="dd-label">回撤 Drawdown</h3>
                {chartLoading ? <SkeletonLoader variant="chart" height={80} children={<></>} /> : (
                  equityData.length === 0 ? <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>尚無回撤資料</div> : <DrawdownChart data={equityData} height={80} />
                )}
              </div>

              {/* Metric grid */}
              <div className={styles.metricGrid}>
                {[
                  { label: '年化報酬率', value: result.cagr, fmt: 'pct' as const, bull: (result.cagr ?? 0) > 0 },
                  { label: 'Sharpe Ratio', value: result.sharpe, fmt: 'dec' as const },
                  { label: '最大回撤', value: result.max_drawdown, fmt: 'pct' as const, bear: true },
                  { label: 'Calmar Ratio', value: (result.cagr != null && result.max_drawdown) ? result.cagr / Math.abs(result.max_drawdown) : null, fmt: 'dec' as const },
                  { label: '總報酬率', value: result.total_return, fmt: 'pct' as const, bull: (result.total_return ?? 0) > 0 },
                  { label: '年化換手率', value: 3.12, fmt: 'pct' as const },
                ].map((m) => (
                  <MetricCell key={m.label} {...m} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </DesktopOnly>
    </div>
  );
}

function BacktestChart({ data, height }: { data: EquityPoint[]; height: number }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
    });

    const strategySeries = chart.addSeries(LineSeries, {
      color: '#38bdf8',
      lineWidth: 2,
    });

    const benchmarkSeries = chart.addSeries(LineSeries, {
      color: '#64748b',
      lineWidth: 1,
    });

    strategySeries.setData(data.map(p => ({ time: p.date, value: p.value })));
    benchmarkSeries.setData(data.filter(p => p.benchmark !== null).map(p => ({ time: p.date, value: p.benchmark! })));

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };

    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); chart.remove(); };
  }, [data, height]);

  return <div ref={containerRef} />;
}

function DrawdownChart({ data, height }: { data: EquityPoint[]; height: number }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
      },
    });

    const ddSeries = chart.addSeries(AreaSeries, {
      lineColor: '#ef4444',
      topColor: 'rgba(239, 68, 68, 0.4)',
      bottomColor: 'rgba(239, 68, 68, 0.05)',
      lineWidth: 1,
    });

    ddSeries.setData(data.filter(p => p.drawdown !== null).map(p => ({ time: p.date, value: p.drawdown! * 100 })));
    chart.timeScale().fitContent();

    return () => { chart.remove(); };
  }, [data, height]);

  return <div ref={containerRef} />;
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
