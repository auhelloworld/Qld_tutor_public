'use client';

import { Component, type ReactNode } from 'react';
import Link from 'next/link';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('Frontend error boundary caught an error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="glass-panel" style={{ padding: 40, textAlign: 'center', maxWidth: 600, margin: '40px auto' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '12px' }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px', lineHeight: 1.5 }}>
            This page could not be displayed. Your saved learning data has not been changed.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                padding: '10px 20px', borderRadius: '8px', background: 'var(--accent-color)',
                color: '#fff', border: 'none', cursor: 'pointer', fontWeight: '600', fontSize: '14px',
              }}
            >
              Try again
            </button>
            <Link
              href="/"
              style={{
                padding: '10px 20px', borderRadius: '8px', border: '1px solid var(--border-color)',
                color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 600, fontSize: '14px',
              }}
            >
              Return to practice
            </Link>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
