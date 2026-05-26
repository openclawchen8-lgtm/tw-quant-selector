import { useState, useRef, type ReactNode } from 'react';
import styles from './Tooltip.module.css';

interface Props {
  content: string;
  children: ReactNode;
}

export default function Tooltip({ content, children }: Props) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(true), 300);
  };

  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 150);
  };

  return (
    <span className={styles.wrapper} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {visible && (
        <span className={styles.tooltip} role="tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
