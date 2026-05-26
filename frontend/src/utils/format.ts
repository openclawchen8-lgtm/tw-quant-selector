export function formatPrice(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  const fixed = v >= 100 ? v.toFixed(0) : v.toFixed(2);
  return fixed;
}

export function formatReturn(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(2)}%`;
}

export function formatFactorScore(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toFixed(2);
}

export function formatSharpe(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toFixed(2);
}

export function formatPercentile(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

export function formatMarketCap(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  const yi = v / 100_000_000;
  return `${yi.toFixed(1)}億`;
}

export function formatVolume(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  const wanZhang = v / 10000;
  return `${wanZhang.toFixed(1)}萬張`;
}

export function formatMoney(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `$${v.toLocaleString()}`;
}
