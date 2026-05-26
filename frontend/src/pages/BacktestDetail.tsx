import { useParams } from 'react-router-dom';

export default function BacktestDetail() {
  const { runId } = useParams();
  return (
    <div>
      <h2>回測詳情 {runId}</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
        單次回測完整結果 — T022
      </p>
    </div>
  );
}
