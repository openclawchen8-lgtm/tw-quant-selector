import { useEffect, useRef } from 'react';
import { animateNumber } from '../utils/animate';
import styles from './StatCard.module.css';

interface StatCardProps {
  label: string;
  value: string | number;
  delta?: number;
  deltaLabel?: string;
  format?: 'number' | 'percent' | 'currency' | 'raw';
  variant?: 'default' | 'highlight' | 'alert';
  loading?: boolean;
  error?: boolean;
}

function formatValue(v: string | number, fmt: StatCardProps['format']): string {
  if (fmt === 'percent' && typeof v === 'number') {
    const sign = v >= 0 ? '+' : '';
    return `${sign}${(v * 100).toFixed(2)}%`;
  }
  if (fmt === 'currency' && typeof v === 'number') {
    return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

function deltaColorClass(delta: number | undefined): string {
  if (delta == null) return '';
  if (delta > 0) return styles.bull;
  if (delta < 0) return styles.bear;
  return styles.neutral;
}

function deltaIcon(delta: number | undefined): string {
  if (delta == null) return '';
  return delta > 0 ? '▲' : delta < 0 ? '▼' : '';
}

export default function StatCard({
  label, value, delta, deltaLabel, format = 'number',
  variant = 'default', loading = false, error = false,
}: StatCardProps) {
  if (loading) {
    return (
      <div className={`${styles.card} ${styles[variant]}`}>
        <div className={styles.skelLabel} />
        <div className={styles.skelValue} />
        <div className={styles.skelDelta} />
      </div>
    );
  }

  const formatted = error ? '—' : formatValue(value, format);
  const errorStyle = error ? styles.error : '';
  const valueRef = useRef<HTMLDivElement>(null);
  const prevValue = useRef(value);

  useEffect(() => {
    if (loading || error || value === prevValue.current) return;
    const el = valueRef.current;
    if (!el) return;
    const fmt = (v: number) => formatValue(v, format);
    const isNumeric = typeof value === 'number' && typeof prevValue.current === 'number';
    const cancel = isNumeric
      ? animateNumber(el, prevValue.current as number, value as number, 400, fmt)
      : (() => { el.textContent = formatted; return () => {}; })();
    prevValue.current = value;
    return cancel;
  }, [value, format, loading, error, formatted]);

  const ariaDesc = delta != null
    ? `${label}: ${formatted}（${deltaIcon(delta)} ${Math.abs(delta * 100).toFixed(2)}%）`
    : `${label}: ${formatted}`;
  return (
    <div className={`${styles.card} ${styles[variant]} ${errorStyle}`} role="figure" aria-label={ariaDesc}>
      <div className={styles.label}>{label}</div>
      <div ref={valueRef} className={`${styles.value} font-data`} aria-hidden="true">{formatted}</div>
      {delta != null && (
        <div className={`${styles.delta} ${deltaColorClass(delta)}`} aria-hidden="true">
          {deltaIcon(delta)} {deltaLabel ? `${formatValue(Math.abs(delta), 'percent')} ${deltaLabel}` : formatValue(delta, 'percent')}
        </div>
      )}
    </div>
  );
}
