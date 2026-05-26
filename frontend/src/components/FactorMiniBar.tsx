import styles from './FactorMiniBar.module.css';

const FACTOR_COLORS: Record<string, string> = {
  momentum: '#a78bfa',
  value: '#34d399',
  quality: '#f59e0b',
  growth: '#38bdf8',
};

const FACTOR_LABELS: Record<string, string> = {
  momentum: '動能',
  value: '價值',
  quality: '品質',
  growth: '成長',
};

interface FactorMiniBarProps {
  name: string;
  score: number;
}

export default function FactorMiniBar({ name, score }: FactorMiniBarProps) {
  const pct = Math.max(0, Math.min(100, ((score + 3) / 6) * 100));
  const extreme = score > 2;
  const color = FACTOR_COLORS[name] || '#666';

  const label = FACTOR_LABELS[name] || name;
  return (
    <div
      className={`${styles.bar} font-data`}
      role="img"
      aria-label={`${label} 因子：分數 ${score >= 0 ? '+' : ''}${score.toFixed(2)}，百分位 ${pct.toFixed(1)}%，趨勢 ${score > 0 ? '上升' : '下降'}`}
    >
      <div
        className={`${styles.fill} ${extreme ? styles.extreme : ''}`}
        style={{ width: `${pct}%`, backgroundColor: color }}
        aria-hidden="true"
      />
    </div>
  );
}
