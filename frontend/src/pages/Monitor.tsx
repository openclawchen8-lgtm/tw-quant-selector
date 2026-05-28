import { useState, useEffect, useRef } from 'react';
import { fetchDashboard, fetchMonitorLogs, fetchMonitorDatasets,
  type DashboardData, type LogEntry, type DatasetInfo } from '../api/client';
import SkeletonLoader from '../components/SkeletonLoader';
import EmptyState from '../components/EmptyState';
import styles from './Monitor.module.css';

type HealthLevel = 'normal' | 'warning' | 'critical' | 'offline';

export default function Monitor() {
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const load = () => {
    Promise.all([
      fetchDashboard(),
      fetchMonitorLogs().catch(() => [] as LogEntry[]),
      fetchMonitorDatasets().catch(() => [] as DatasetInfo[]),
    ]).then(([d, l, ds]) => {
      if (!mountedRef.current) return;
      setDash(d); setLogs(l); setDatasets(ds); setLoading(false);
    }).catch(() => { if (mountedRef.current) setLoading(false); });
  };

  useEffect(() => {
    mountedRef.current = true;
    load();
    intervalRef.current = setInterval(load, 60_000);
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const lastPriceDate = dash?.price_date_range?.max;
  const hoursSinceUpdate = lastPriceDate
    ? (Date.now() - new Date(lastPriceDate + 'T00:00:00+08:00').getTime()) / 3_600_000
    : Infinity;

  let health: HealthLevel = 'offline';
  let healthText = '離線';
  if (dash) {
    if (hoursSinceUpdate <= 24) {
      health = 'normal';
      healthText = '系統正常';
    } else if (hoursSinceUpdate <= 48) {
      health = 'warning';
      healthText = '注意 — 資料超過24小時未更新';
    } else {
      health = 'critical';
      healthText = '異常 — 資料停滯';
    }
  }

  if (loading) {
    return <div className={styles.page}><SkeletonLoader variant="card" /><SkeletonLoader variant="table" rows={6} /></div>;
  }

  if (!dash) {
    return (
      <div className={styles.page}>
        <EmptyState
          scenario="failed"
          title="連線錯誤"
          message="無法取得監控資料，後端可能尚未啟動"
          actionLabel="重試"
          actionHref=""
          onAction={() => { setLoading(true); load(); }}
        />
      </div>
    );
  }

  const statusLabel = (s: string) =>
    s === 'done' || s === 'completed' ? '✓ 完成' : s === 'running' ? '⟳ 執行中' : s === 'error' ? '✗ 錯誤' : s === 'pending' ? '⏳ 待執行' : s === 'failed' ? '✗ 失敗' : s === 'skipped' ? '⊘ 跳過' : '—';
  const statusClass = (s: string) =>
    s === 'done' || s === 'completed' ? styles.ok : s === 'running' ? styles.running : s === 'error' || s === 'failed' ? styles.err : '';

  const missing = datasets
    .filter((d) => d.status === 'error' || d.count === 0)
    .reduce<Record<string, string[]>>((acc, d) => {
      if (!acc[d.dataset]) acc[d.dataset] = [];
      acc[d.dataset].push(`${d.dataset} (${d.count} 筆)`);
      return acc;
    }, {});

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>資料監控 Monitor</h1>

      {/* Health indicator */}
      <div className={`${styles.health} ${styles[health]}`}>
        <span className={styles.healthDot}>●</span>
        <span>{healthText}</span>
        <span className={styles.healthSub}>
          {lastPriceDate ? `最後更新: ${lastPriceDate.slice(0, 10)}` : '暫無更新紀錄'}
        </span>
      </div>

      {/* Dataset table */}
      <h2 className={styles.sectionTitle}>資料集狀態 Datasets</h2>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>資料集 Dataset</th>
              <th data-type="number">筆數</th>
              <th>最後更新</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(
              datasets.reduce<Record<string, { count: number; last_updated: string | null; statuses: string[] }>>((acc, ds) => {
                if (!acc[ds.dataset]) acc[ds.dataset] = { count: 0, last_updated: null, statuses: [] };
                acc[ds.dataset].count += ds.count;
                if (ds.last_updated) {
                  const existing = acc[ds.dataset].last_updated;
                  if (!existing || ds.last_updated > existing) {
                    acc[ds.dataset].last_updated = ds.last_updated;
                  }
                }
                if (ds.status && !acc[ds.dataset].statuses.includes(ds.status)) {
                  acc[ds.dataset].statuses.push(ds.status);
                }
                return acc;
              }, {})
            ).map(([name, { count, last_updated, statuses }]) => (
              <tr key={name} className={styles.dataRow}>
                <td className={styles.datasetName}>{name}</td>
                <td data-type="number">{count}</td>
                <td className={count === 0 ? styles.stale : ''}>
                  {last_updated ?? '—'}
                </td>
                <td>
                  {statuses.length === 0 ? (
                    <span className={`${styles.statusDot} `}>—</span>
                  ) : statuses.map((s) => (
                    <span key={s} className={`${styles.statusDot} ${statusClass(s)}`}>
                      {statusLabel(s)}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Operation log */}
      <h2 className={styles.sectionTitle}>近7日操作記錄</h2>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>時間</th><th>模組</th><th>事件</th><th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>暫無操作記錄</td></tr>
            ) : (
              logs.map((log, i) => (
                <tr key={log.id ?? i} className={styles.dataRow}>
                  <td className={styles.logTime}>{log.timestamp ? log.timestamp.slice(0, 16) : ''}</td>
                  <td><span className={styles.moduleTag}>{log.module}</span></td>
                  <td>{log.event}</td>
                  <td className={log.severity === 'info' ? styles.logOk : log.severity === 'warn' ? styles.logWarn : styles.logErr}>
                    {log.severity === 'info' ? '✓' : log.severity === 'warn' ? '⚠' : '✗'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Missing data */}
      <h2 className={styles.sectionTitle}>
        <button className={styles.collapseBtn} onClick={() => setExpanded(!expanded)}>
          {expanded ? '▼' : '▶'} 缺失資料
        </button>
      </h2>
      {expanded && (
        <div className={styles.missingGrid}>
          {Object.keys(missing).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', padding: '1rem' }}>無缺失資料</p>
          ) : (
            Object.entries(missing).map(([dataset, items]) => (
              <div key={dataset} className={styles.missingCard}>
                <h3 className={styles.missingDataset}>{dataset}</h3>
                <ul className={styles.missingList}>
                  {items.map((s) => (
                    <li key={s} className={styles.missingItem}>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
