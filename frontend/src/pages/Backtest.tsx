import { useState, useEffect, useRef, useCallback } from 'react';
import { createChart, ColorType, LineSeries, AreaSeries, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import { fetchBacktestEquity, type EquityPoint } from '../api/client';
import { formatNumber } from '../utils/format';
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
                      {formatNumber(r.cagr, { type: 'percent' })}
                    </span>
                    <span className="font-data" style={{ color: 'var(--text-muted)' }}>
                      Sharpe {formatNumber(r.sharpe, { type: 'score' })}
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
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const strategySeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const benchmarkSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // T051: 重設縮放函式
  const resetZoom = useCallback(() => {
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, []);

  // T051: 移動時間範圍
  const panTimeRange = useCallback((direction: 'left' | 'right', large: boolean = false) => {
    if (!chartRef.current) return;
    const range = chartRef.current.timeScale().getVisibleRange();
    if (!range) return;
    
    const fromMs = typeof range.from === 'string' 
      ? new Date(range.from + 'T00:00:00Z').getTime() 
      : (range.from as number) * 1000;
    const toMs = typeof range.to === 'string' 
      ? new Date(range.to + 'T00:00:00Z').getTime() 
      : (range.to as number) * 1000;
    const rangeMs = toMs - fromMs;
    const shiftMs = large ? rangeMs * 0.5 : rangeMs * 0.2;
    const directionFactor = direction === 'left' ? -1 : 1;
    
    const newFromMs = fromMs + shiftMs * directionFactor;
    const newToMs = toMs + shiftMs * directionFactor;
    
    const msToTime = (ms: number): Time => {
      const d = new Date(ms);
      return d.toISOString().slice(0, 10);
    };
    
    chartRef.current.timeScale().setVisibleRange({
      from: msToTime(newFromMs),
      to: msToTime(newToMs),
    });
  }, []);

  // T051: 鍵盤快捷鍵
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!chartRef.current) return;
      
      // R: 重設縮放
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        resetZoom();
        return;
      }
      
      // 0 或 Home: 重設縮放
      if (e.key === '0' || e.key === 'Home') {
        e.preventDefault();
        resetZoom();
        return;
      }
      
      // 左右方向鍵
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        panTimeRange('left', e.shiftKey);
        return;
      }
      
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        panTimeRange('right', e.shiftKey);
        return;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resetZoom, panTimeRange]);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    // 建立 chart
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
      crosshair: {
        mode: 1, // Normal
        vertLine: {
          color: '#64748b',
          width: 1,
          style: 2, // Dashed
          labelBackgroundColor: '#1e293b',
        },
        horzLine: {
          color: '#64748b',
          width: 1,
          style: 2, // Dashed
          labelBackgroundColor: '#1e293b',
        },
      },
      rightPriceScale: {
        borderColor: '#334155',
      },
      timeScale: {
        borderColor: '#334155',
        timeVisible: false,
      },
    });

    chartRef.current = chart;

    // 策略線
    const strategySeries = chart.addSeries(LineSeries, {
      color: '#38bdf8',
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
    });
    strategySeriesRef.current = strategySeries;

    // 基準線
    const benchmarkSeries = chart.addSeries(LineSeries, {
      color: '#64748b',
      lineWidth: 1,
      lastValueVisible: true,
      priceLineVisible: false,
    });
    benchmarkSeriesRef.current = benchmarkSeries;

    // 設定資料
    strategySeries.setData(data.map(p => ({ time: p.date, value: p.value })));
    benchmarkSeries.setData(data.filter(p => p.benchmark !== null).map(p => ({ time: p.date, value: p.benchmark! })));

    // 建立 tooltip
    const tooltip = document.createElement('div');
    tooltip.className = styles.chartTooltip;
    tooltip.style.display = 'none';
    containerRef.current.appendChild(tooltip);
    tooltipRef.current = tooltip;

    // Crosshair move 事件 - 自製 tooltip
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !tooltipRef.current || !containerRef.current) {
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
        return;
      }

      // 取得 snap 的資料點
      const strategyData = param.seriesData.get(strategySeries);
      const benchmarkData = param.seriesData.get(benchmarkSeries);

      if (!strategyData) {
        tooltipRef.current.style.display = 'none';
        return;
      }

      const tv = strategyData as { time: string; value: number };
      const bv = benchmarkData as { time: string; value: number } | undefined;

      // 計算超額報酬
      const excessReturn = bv ? ((tv.value - bv.value) / bv.value) * 100 : null;

      // 更新 tooltip 內容
      tooltipRef.current.innerHTML = `
        <div class="${styles.tooltipDate}">${tv.time}</div>
        <div class="${styles.tooltipRow}">
          <span class="${styles.tooltipLabel}">策略</span>
          <span class="${styles.tooltipValue} font-data" style="color: var(--color-bull-text)">${formatNumber(tv.value, { type: 'price' })}</span>
        </div>
        <div class="${styles.tooltipRow}">
          <span class="${styles.tooltipLabel}">基準 (0050)</span>
          <span class="${styles.tooltipValue} font-data" style="color: var(--text-muted)">${bv ? formatNumber(bv.value, { type: 'price' }) : '-'}</span>
        </div>
        <div class="${styles.tooltipRow}">
          <span class="${styles.tooltipLabel}">超額報酬</span>
          <span class="${styles.tooltipValue} font-data" style="color: ${excessReturn && excessReturn > 0 ? 'var(--color-bull-text)' : 'var(--color-bear-text)'}">
            ${excessReturn !== null ? formatNumber(excessReturn / 100, { type: 'percent' }) : '-'}
          </span>
        </div>
      `;

      // 定位 tooltip(智慧定位:右側優先 → 左側)
      const containerRect = containerRef.current.getBoundingClientRect();
      const x = param.point?.x ?? 0;
      const y = param.point?.y ?? 0;
      const tooltipWidth = tooltipRef.current.offsetWidth;
      const tooltipHeight = tooltipRef.current.offsetHeight;

      let left = x + 20;
      let top = y - tooltipHeight / 2;

      // 右側空間不足 → 左側顯示
      if (left + tooltipWidth > containerRect.width) {
        left = x - tooltipWidth - 20;
      }

      // 超出上方 → 調整
      if (top < 0) top = 10;
      // 超出下方 → 調整
      if (top + tooltipHeight > containerRect.height) top = containerRect.height - tooltipHeight - 10;

      tooltipRef.current.style.left = `${left}px`;
      tooltipRef.current.style.top = `${top}px`;
      tooltipRef.current.style.display = 'block';
    });

    // Zoom: 監聽可視範圍變化，強制最小 22 交易日
    const MIN_DAYS = 22;
    
    // 將 Time 轉為毫秒數
    const timeToMs = (t: Time): number => {
      if (typeof t === 'string') {
        return new Date(t + 'T00:00:00Z').getTime();
      }
      return (t as number) * 1000; // UTC timestamp (seconds) -> milliseconds
    };
    
    // 將毫秒數轉回 Time (假設是 business day string)
    const msToTime = (ms: number): Time => {
      const d = new Date(ms);
      return d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
    };
    
    const enforceMinRange = () => {
      const range = chart.timeScale().getVisibleRange();
      if (!range) return;
      
      const fromMs = timeToMs(range.from);
      const toMs = timeToMs(range.to);
      const daysDiff = Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24));
      
      if (daysDiff < MIN_DAYS) {
        const newFromMs = toMs - (MIN_DAYS * 24 * 60 * 60 * 1000);
        chart.timeScale().setVisibleRange({
          from: msToTime(newFromMs),
          to: range.to,
        });
      }
    };
    
    chart.timeScale().subscribeVisibleTimeRangeChange(enforceMinRange);

    // Zoom: 滑鼠滾輪縮放（以滑鼠位置為中心）
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      const rect = containerRef.current!.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const range = chart.timeScale().getVisibleRange();
      if (!range) return;
      
      const fromMs = timeToMs(range.from);
      const toMs = timeToMs(range.to);
      const rangeMs = toMs - fromMs;
      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      
      // 以滑鼠位置為中心計算新的範圍
      const mouseTimeMs = fromMs + (toMs - fromMs) * (mouseX / rect.width);
      const newRangeMs = rangeMs * zoomFactor;
      
      const newFromMs = mouseTimeMs - (mouseX / rect.width) * newRangeMs;
      const newToMs = mouseTimeMs + ((rect.width - mouseX) / rect.width) * newRangeMs;
      
      chart.timeScale().setVisibleRange({ from: msToTime(newFromMs), to: msToTime(newToMs) });
    };
    
    containerRef.current!.addEventListener('wheel', handleWheel, { passive: false });

    // 初始 fit
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(enforceMinRange);
      if (containerRef.current) {
        containerRef.current.removeEventListener('wheel', handleWheel);
      }
      if (tooltipRef.current && containerRef.current) {
        containerRef.current.removeChild(tooltipRef.current);
      }
      chart.remove();
    };
  }, [data, height]);

  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} />
      {/* T051: 重設縮放按鈕 */}
      <button
        className={styles.resetZoomBtn}
        onClick={resetZoom}
        title="重設縮放 (R)"
        aria-label="重設縮放"
      >
        ⟲
      </button>
    </div>
  );
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
  const formatted = value == null ? '-' : fmt === 'pct' ? formatNumber(value, { type: 'percent' }) : formatNumber(value, { type: 'score' });
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
