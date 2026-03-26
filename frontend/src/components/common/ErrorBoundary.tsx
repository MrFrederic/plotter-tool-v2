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
            color: '#ff3366',
            fontFamily: 'monospace',
            background: '#1a0a10',
            border: '1px solid #ff3366',
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
              color: '#00f0ff',
              background: 'transparent',
              border: '1px solid #00f0ff',
              padding: '4px 8px',
              cursor: 'pointer',
              fontFamily: 'monospace',
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
