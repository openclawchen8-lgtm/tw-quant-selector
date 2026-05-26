import { useState, useEffect } from 'react';
import SkeletonLoader from '../components/SkeletonLoader';
import { DesktopOnly, MobileMessage } from '../utils/responsive';
import styles from './Strategy.module.css';

const API = 'http://localhost:8000';
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'API error');
  return (body.data ?? body) as T;
}

interface StrategyConfig {
  strategies: Record<string, {
    params: Record<string, number | boolean>;
    param_types: Record<string, string>;
  }>;
  default_weights: Record<string, number>;
  universe_defaults: {
    include_etf: boolean;
    min_market_cap: number;
    exclude_financial: boolean;
    top_n_stocks: number;
    top_n_etfs: number;
  };
}

const STRATEGY_LABELS: Record<string, string> = {
  momentum: '動能',
  value: '價值',
  quality: '品質',
  growth: '成長',
};

const STRATEGY_COLORS: Record<string, string> = {
  momentum: 'var(--color-momentum)',
  value: 'var(--color-value)',
  quality: 'var(--color-quality)',
  growth: 'var(--color-growth)',
};

export default function Strategy() {
  const [config, setConfig] = useState<StrategyConfig | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [params, setParams] = useState<Record<string, Record<string, number | boolean>>>({});
  const [includeEft, setIncludeEft] = useState(false);
  const [minMarketCap, setMinMarketCap] = useState(3_000_000_000);
  const [excludeFinancial, setExcludeFinancial] = useState(true);
  const [topN, setTopN] = useState(20);
  const [topNEtf, setTopNEtf] = useState(3);
  const [lockedSlider, setLockedSlider] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [impactText, setImpactText] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<StrategyConfig>('/api/v1/strategies/config')
      .then((cfg) => {
        setConfig(cfg);
        setWeights({ ...cfg.default_weights });
        const p: Record<string, Record<string, number | boolean>> = {};
        for (const [name, strat] of Object.entries(cfg.strategies)) {
          p[name] = { ...strat.params };
        }
        setParams(p);
        setIncludeEft(cfg.universe_defaults.include_etf);
        setMinMarketCap(cfg.universe_defaults.min_market_cap);
        setExcludeFinancial(cfg.universe_defaults.exclude_financial);
        setTopN(cfg.universe_defaults.top_n_stocks);
        setTopNEtf(cfg.universe_defaults.top_n_etfs);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const updateWeight = (name: string, val: number) => {
    const clamped = Math.round(val / 5) * 5;
    if (lockedSlider === name) {
      setWeights((w) => ({ ...w, [name]: clamped }));
      return;
    }
    const others = Object.keys(weights).filter((k) => k !== name && k !== lockedSlider);
    const otherSum = others.reduce((s, k) => s + weights[k], 0);
    if (otherSum === 0) {
      setWeights((w) => ({ ...w, [name]: clamped }));
      return;
    }
    const remaining = 100 - clamped;
    const scale = remaining / otherSum;
    const newWeights = { ...weights, [name]: clamped };
    for (const k of others) {
      const v = Math.round(weights[k] * scale / 5) * 5;
      newWeights[k] = v;
    }
    const total = Object.values(newWeights).reduce((s, v) => s + v, 0);
    if (total !== 100) {
      const diff = 100 - total;
      const adjustK = others.find((k) => newWeights[k] > 0) || others[0];
      if (adjustK) newWeights[adjustK] = Math.max(0, newWeights[adjustK] + diff);
    }
    setWeights(newWeights);
  };

  const toggleLock = (name: string) => {
    setLockedSlider(lockedSlider === name ? null : name);
  };

  const updateParam = (strategy: string, key: string, val: number | boolean) => {
    setParams((p) => ({ ...p, [strategy]: { ...p[strategy], [key]: val } }));
  };

  const resetToDefaults = () => {
    if (!config) return;
    setWeights({ ...config.default_weights });
    const p: Record<string, Record<string, number | boolean>> = {};
    for (const [name, strat] of Object.entries(config.strategies)) {
      p[name] = { ...strat.params };
    }
    setParams(p);
    setIncludeEft(config.universe_defaults.include_etf);
    setMinMarketCap(config.universe_defaults.min_market_cap);
    setExcludeFinancial(config.universe_defaults.exclude_financial);
    setTopN(config.universe_defaults.top_n_stocks);
    setTopNEtf(config.universe_defaults.top_n_etfs);
    setLockedSlider(null);
  };

  const handleApply = async () => {
    if (!config) return;
    setShowModal(true);
    try {
      const data = await apiFetch<{ stocks?: unknown[]; etfs?: unknown[]; total_candidates?: number }>('/api/v1/strategies/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weights,
          strategy_params: params,
          include_etf: includeEft,
          top_n_stocks: topN,
          top_n_etfs: topNEtf,
        }),
      });
      const totalStocks = (data.stocks?.length || 0) + (data.etfs?.length || 0);
      setPreviewCount(totalStocks);
      setImpactText(`若套用此設定，今日選股將有 ${totalStocks} 檔標的入選`);
    } catch {
      setPreviewCount(0);
      setImpactText('回測 API 目前無法連線，請稍後再試');
    }
  };

  const confirmApply = async () => {
    setShowModal(false);
  };

  const strats = config ? Object.keys(config.strategies) : ['momentum', 'value', 'quality', 'growth'];

  if (loading) {
    return <div className={styles.page}><SkeletonLoader variant="card" /><SkeletonLoader variant="table" rows={4} /></div>;
  }

  return (
    <div className={styles.page}>
      <DesktopOnly>
        <div className={styles.header}>
          <h1 className={styles.title}>策略設定 Strategy</h1>
          <div className={styles.headerActions}>
            <button className={styles.resetBtn} onClick={resetToDefaults}>↺ 重設</button>
          </div>
        </div>
        <div className={styles.grid}>
          <div className={styles.card}>
            <h3>策略權重</h3>
            <p className={styles.hint}></p>
            {strats.map((name) => (
              <div key={name} className={styles.sliderRow}>
                <label style={{ color: STRATEGY_COLORS[name] || 'var(--text-primary)' }}>
                  {STRATEGY_LABELS[name] || name}
                </label>
                <input type="range" min={0} max={100} step={5} value={weights[name] || 0}
                  onChange={(e) => updateWeight(name, Number(e.target.value))} />
                <span className="font-data">{weights[name] || 0}%</span>
                <button className={`${styles.lockBtn} ${lockedSlider === name ? styles.locked : ''}`}
                  onClick={() => toggleLock(name)}
                  title="鎖定此權重，其餘自動補足">
                  {lockedSlider === name ? '🔒' : '🔓'}
                </button>
              </div>
            ))}
            <div className={styles.totalWeight}>
              總和: <span className={`font-data ${Object.values(weights).reduce((s, v) => s + v, 0) === 100 ? styles.ok : styles.warn}`}>
                {Object.values(weights).reduce((s, v) => s + v, 0)}%
              </span>
            </div>
          </div>
          <div className={styles.card}>
            <h3>各策略參數</h3>
            {strats.map((name) => (
              <details key={name} className={styles.stratDetails}>
                <summary style={{ color: STRATEGY_COLORS[name] }}>
                  {STRATEGY_LABELS[name] || name}
                </summary>
                {config?.strategies[name]?.params && Object.entries(config.strategies[name].params).map(([k, _v]) => {
                  const v = params[name]?.[k] ?? _v;
                  const type = config?.strategies[name].param_types[k] || 'number';
                  return (
                    <div key={k} className={styles.paramRow}>
                      <label>{k}</label>
                      {type === 'boolean' ? (
                        <input type="checkbox" checked={!!v} onChange={(e) => updateParam(name, k, e.target.checked)} />
                      ) : (
                        <input type="number" value={Number(v)} step={type === 'int' ? 1 : 0.01}
                          onChange={(e) => updateParam(name, k, Number(e.target.value))} />
                      )}
                    </div>
                  );
                })}
              </details>
            ))}
          </div>
          <div className={styles.card}>
            <h3>篩選條件</h3>
            <div className={styles.filterRow}>
              <label>包含 ETF</label>
              <input type="checkbox" checked={includeEft} onChange={(e) => setIncludeEft(e.target.checked)} />
            </div>
            <div className={styles.filterRow}>
              <label>最低市值</label>
              <select value={minMarketCap} onChange={(e) => setMinMarketCap(Number(e.target.value))}>
                <option value={0}>不限</option>
                <option value={1_000_000_000}>10 億</option>
                <option value={3_000_000_000}>30 億</option>
                <option value={5_000_000_000}>50 億</option>
                <option value={10_000_000_000}>100 億</option>
                <option value={50_000_000_000}>500 億</option>
              </select>
            </div>
            <div className={styles.filterRow}>
              <label>排除金融股</label>
              <input type="checkbox" checked={excludeFinancial} onChange={(e) => setExcludeFinancial(e.target.checked)} />
            </div>
            <div className={styles.filterRow}>
              <label>選股數量</label>
              <input type="number" value={topN} min={1} max={100}
                onChange={(e) => setTopN(Number(e.target.value))} />
            </div>
            <div className={styles.filterRow}>
              <label>ETF 數量</label>
              <input type="number" value={topNEtf} min={0} max={20}
                onChange={(e) => setTopNEtf(Number(e.target.value))} />
            </div>
          </div>
          <div className={styles.card}>
            <h3>預覽</h3>
            <div className={styles.previewArea}>
              {previewCount != null ? (
                <p>若套用此設定，今日選股將有 <strong className={styles.highlight}>{previewCount}</strong> 檔變動</p>
              ) : (
                <p className={styles.muted}>點擊「套用」查看影響</p>
              )}
            </div>
            <button className={styles.applyBtn} onClick={handleApply}>▶ 套用設定</button>
          </div>
        </div>
        {showModal && (
          <div className={styles.modalOverlay} onClick={() => setShowModal(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <h3>確認套用</h3>
              <p className={styles.impactText}>{impactText}</p>
              <div className={styles.modalActions}>
                <button className={styles.resetBtn} onClick={() => setShowModal(false)}>取消</button>
                <button className={styles.applyBtn} onClick={confirmApply}>確認套用</button>
              </div>
            </div>
          </div>
        )}
      </DesktopOnly>
      <MobileMessage message="請在桌面環境設定策略" />
    </div>
  );
}
