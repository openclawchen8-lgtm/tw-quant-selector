import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

const navItems = [
  { path: '/', label: '今日總覽', icon: '▣' },
  { path: '/signals', label: '選股訊號', icon: '≡' },
  { path: '/portfolio', label: '投組追蹤', icon: '◎' },
  { path: '/backtest', label: '回測分析', icon: '∿' },
  { path: '/strategy', label: '策略設定', icon: '♟' },
  { path: '/monitor', label: '資料監控', icon: '●' },
  { path: '/settings', label: '系統設定', icon: '⚙' },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  alertOnMonitor?: boolean;
}

export default function Sidebar({ collapsed, onToggle, alertOnMonitor }: SidebarProps) {
  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : styles.expanded}`}>
      <div className={styles.logo} onClick={onToggle}>
        {collapsed ? '◉' : '◉  tw-quant'}
      </div>
      <div className={styles.divider} />
      <nav className={styles.nav}>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            <span className={styles.icon}>
              {item.path === '/monitor' && alertOnMonitor ? (
                <span className={styles.alertDot}>{item.icon}</span>
              ) : (
                item.icon
              )}
            </span>
            {!collapsed && <span className={styles.label}>{item.label}</span>}
          </NavLink>
        ))}
      </nav>
      <div className={styles.divider} />
      <div className={styles.footer}>
        {!collapsed && (
          <>
            <div className={styles.footerRow}>
              <span className={styles.footerLabel}>最後更新</span>
              <span className={styles.footerValue} id="last-update">—</span>
            </div>
            <div className={styles.footerRow}>
              <span className={styles.footerLabel}>資料狀態</span>
              <span className={styles.footerValue} id="data-status">● 正常</span>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
