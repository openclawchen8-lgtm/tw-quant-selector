import { Link } from 'react-router-dom';
import styles from './EmptyState.module.css';

interface Props {
  icon?: string;
  title?: string;
  message: string;
  reasons?: string[];
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}

export default function EmptyState({
  icon = '📭',
  title,
  message,
  reasons,
  actionLabel = '前往資料監控',
  actionHref = '/monitor',
  onAction,
}: Props) {
  return (
    <div className={styles.root}>
      <span className={styles.icon}>{icon}</span>
      {title && <h3 className={styles.title}>{title}</h3>}
      <p className={styles.message}>{message}</p>
      {reasons && reasons.length > 0 && (
        <ul className={styles.reasons}>
          {reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {onAction ? (
        <button className={styles.action} onClick={onAction}>{actionLabel}</button>
      ) : (
        actionHref.startsWith('/') ? (
          <Link className={styles.action} to={actionHref}>{actionLabel}</Link>
        ) : (
          <a className={styles.action} href={actionHref}>{actionLabel}</a>
        )
      )}
    </div>
  );
}
