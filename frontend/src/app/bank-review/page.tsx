'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PARENT_AUTH_INVALID_EVENT } from '../../lib/api';
import { clearParentSession, hasFreshParentSession, useParentIdleLock } from '../../lib/parent-session';
import BankReviewPanel from '../../components/parent/BankReviewPanel';

/**
 * Standalone bank-review page under Parent Control.
 * Requires the same parent session as /parent (password unlock).
 */
export default function BankReviewPage() {
  const [ready, setReady] = useState(false);
  const [hasParentSession, setHasParentSession] = useState(false);

  useEffect(() => {
    const fresh = hasFreshParentSession();
    // An idle session must be unlocked again on /parent.
    if (!fresh) clearParentSession();
    setHasParentSession(fresh);
    setReady(true);
  }, []);

  const lockForIdle = useCallback(() => {
    clearParentSession();
    setHasParentSession(false);
  }, []);
  useParentIdleLock(hasParentSession, lockForIdle);

  useEffect(() => {
    const handleParentAuthInvalid = () => {
      setHasParentSession(false);
      setReady(true);
    };
    window.addEventListener(PARENT_AUTH_INVALID_EVENT, handleParentAuthInvalid);
    return () => window.removeEventListener(PARENT_AUTH_INVALID_EVENT, handleParentAuthInvalid);
  }, []);

  if (!ready) {
    return <div style={{ padding: 40, color: 'var(--text-secondary)' }}>Loading…</div>;
  }

  if (!hasParentSession) {
    return (
      <div style={{ maxWidth: 560, margin: '48px auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, marginBottom: 12 }}>Exercise bank review</h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Unlock the Parent Dashboard first (same password). This tool is part of parent controls
          and uses your parent session.
        </p>
        <Link
          href="/parent"
          style={{
            display: 'inline-block',
            marginTop: 12,
            padding: '10px 16px',
            borderRadius: 8,
            background: 'var(--accent-color)',
            color: '#fff',
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Open Parent Dashboard →
        </Link>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      boxSizing: 'border-box',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 1440,
        margin: '0 auto',
        padding: 'clamp(12px, 2vw, 24px) clamp(12px, 3vw, 32px) 40px',
        boxSizing: 'border-box',
      }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}>
          <div style={{ minWidth: 0, flex: '1 1 220px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.04em' }}>
              PARENT CONTROL
            </div>
            <h1 style={{ margin: 0, fontSize: 'clamp(18px, 2.5vw, 22px)' }}>Exercise bank review</h1>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Import · preview every item · live mark · append to production banks
            </p>
          </div>
          <Link
            href="/parent"
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '8px 14px',
              borderRadius: 8,
              background: 'rgba(99,102,241,0.12)',
              color: 'var(--accent-color)',
              border: '1px solid rgba(99,102,241,0.3)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            ← Parent Dashboard
          </Link>
        </header>
        <BankReviewPanel />
      </div>
    </div>
  );
}
