'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '40px',
        background: 'var(--bg-primary, #0a0a0a)',
        color: 'var(--text-primary, #f5f5f5)',
        fontFamily: 'var(--font-sans, system-ui)',
      }}
    >
      <div
        style={{
          maxWidth: '480px',
          textAlign: 'center',
          padding: '40px',
          borderRadius: '16px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
        }}
      >
        <h2 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '16px' }}>
          Something went wrong
        </h2>
        <p
          style={{
            fontSize: '14px',
            color: 'var(--text-secondary, #a0a0a0)',
            marginBottom: '24px',
            lineHeight: '1.6',
          }}
        >
          An unexpected error occurred in the application. Your learning
          progress has been saved.
        </p>
        <button
          onClick={reset}
          style={{
            padding: '12px 24px',
            fontSize: '14px',
            fontWeight: '600',
            background: 'var(--accent-color, #3b82f6)',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
