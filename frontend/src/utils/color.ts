const BULL = 'var(--color-bull-text)';
const BEAR = 'var(--color-bear-text)';
const NEUTRAL = 'var(--text-secondary)';
const MUTED = 'var(--text-muted)';
const BULL_DIM = 'var(--color-bull-dim)';
const BEAR_DIM = 'var(--color-bear-dim)';

export function colorForChange(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return MUTED;
  if (v > 0) return BULL;
  if (v < 0) return BEAR;
  return NEUTRAL;
}

export function trendIcon(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '';
  if (v > 0) return '▲';
  if (v < 0) return '▼';
  return '';
}

export function bgForExtreme(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return 'transparent';
  if (v > 0.05) return BULL_DIM;
  if (v < -0.05) return BEAR_DIM;
  return 'transparent';
}

export const FACTOR_COLORS: Record<string, string> = {
  momentum: 'var(--color-momentum)',
  value: 'var(--color-value)',
  quality: 'var(--color-quality)',
  growth: 'var(--color-growth)',
};

export const FACTOR_LABELS: Record<string, string> = {
  momentum: '動能',
  value: '價值',
  quality: '品質',
  growth: '成長',
};
