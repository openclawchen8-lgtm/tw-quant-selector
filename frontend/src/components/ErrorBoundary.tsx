import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          padding: '24px', textAlign: 'center', color: 'var(--text-muted)',
          border: '1px solid var(--bg-border)', borderRadius: 'var(--radius-card)',
        }}>
          <p style={{ color: 'var(--color-bear-text)', marginBottom: '12px', fontSize: '14px' }}>
            ⚠ 頁面發生錯誤
          </p>
          <p style={{ fontSize: '12px', marginBottom: '16px', color: 'var(--text-muted)' }}>
            {this.state.error?.message || '未知錯誤'}
          </p>
          <button onClick={this.handleRetry} style={{
            padding: '8px 20px', background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
            borderRadius: 'var(--radius-btn)', color: 'var(--text-primary)', cursor: 'pointer',
            fontSize: '13px',
          }}>
            重試
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
