import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name ?? 'unknown'}]`, error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '1rem',
            color: 'var(--status-error)',
            fontFamily: 'var(--font-mono)',
            background: 'var(--bg-panel)',
            border: '1px solid var(--status-error)',
            margin: '4px',
          }}
        >
          <strong>⚠ {this.props.name ?? 'Component'} crashed</strong>
          <pre style={{ fontSize: '11px', marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: '0.5rem',
              color: 'var(--accent-amber)',
              background: 'transparent',
              border: '1px solid var(--accent-amber)',
              padding: '4px 8px',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
