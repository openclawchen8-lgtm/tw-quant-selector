import { useEffect, useState } from 'react';
import { getMarketStatus, type MarketStatusInfo } from '../utils/format';
import styles from './MarketStatus.module.css';

const STATUS_CONFIG: Record<string, { icon: string; label: string }> = {
  trading: { icon: '🟢', label: '交易中' },
  pre_market: { icon: '🟡', label: '已收盤' },
  post_market: { icon: '🟠', label: '收盤中' },
  closed: { icon: '⚫', label: '已收盤' },
  holiday: { icon: '🔴', label: '休市中' },
};

export default function MarketStatus() {
  const [statusInfo, setStatusInfo] = useState<MarketStatusInfo>(() => getMarketStatus());

  useEffect(() => {
    const timer = setInterval(() => {
      setStatusInfo(getMarketStatus());
    }, 60000); // 每分鐘更新一次

    return () => clearInterval(timer);
  }, []);

  const config = STATUS_CONFIG[statusInfo.status] || STATUS_CONFIG.closed;

  return (
    <div className={`${styles.container} ${styles[statusInfo.status]}`}>
      <div className={styles.statusRow}>
        <span className={styles.icon}>{config.icon}</span>
        <span className={styles.label}>{config.label}</span>
        <span className={styles.updateTime}>
          Last updated: {statusInfo.lastUpdated}
        </span>
      </div>
    </div>
  );
}
