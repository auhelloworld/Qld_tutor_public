'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { authRegister, authLogin } from '../lib/api';
import { STORAGE_KEY, TOKEN_STORAGE_KEY, DISPLAY_NAME_KEY } from '../lib/student_id';

interface AuthModalProps {
  onClose: () => void;
}

export default function AuthModal({ onClose }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    nameInputRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const res = mode === 'login'
        ? await authLogin(name.trim(), password)
        : await authRegister(name.trim(), password);
      localStorage.setItem(STORAGE_KEY, res.student_id);
      localStorage.setItem(TOKEN_STORAGE_KEY, res.access_token);
      localStorage.setItem(DISPLAY_NAME_KEY, res.display_name || name.trim());
      window.location.reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
    setLoading(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
    }}>
      <div
        ref={dialogRef}
        className="glass-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        style={{ width: 'min(380px, calc(100vw - 32px))', padding: '32px', borderRadius: '16px' }}
      >
        <h2 id={titleId} style={{ fontSize: '20px', fontWeight: '700', marginBottom: '4px' }}>
          {mode === 'login' ? 'Welcome back' : 'Create account'}
        </h2>
        <p id={descriptionId} style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
          {mode === 'login'
            ? 'Sign in to use the same learner profile on another device.'
            : 'Create an account to keep the same learner profile across devices.'}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label htmlFor="auth-name" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Name</label>
          <input
            ref={nameInputRef}
            id="auth-name"
            type="text"
            autoComplete="username"
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={50}
            style={{
              width: '100%', padding: '12px 14px', fontSize: '15px',
              borderRadius: '8px', border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)', color: 'var(--text-primary)',
              boxSizing: 'border-box',
            }}
          />
          <label htmlFor="auth-password" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Password</label>
          <input
            id="auth-password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            maxLength={100}
            style={{
              width: '100%', padding: '12px 14px', fontSize: '15px',
              borderRadius: '8px', border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)', color: 'var(--text-primary)',
              boxSizing: 'border-box',
            }}
          />

          {error && (
            <div role="alert" style={{ fontSize: '13px', color: '#ef4444', padding: '8px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !name.trim() || !password}
            style={{
              width: '100%', padding: '12px', fontSize: '15px', fontWeight: '700',
              borderRadius: '8px', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              background: 'var(--accent-color)', color: '#fff',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '13px', color: 'var(--text-secondary)' }}>
          {mode === 'login' ? (
            <>No account?{' '}<button onClick={() => { setMode('register'); setError(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontWeight: '600', fontSize: '13px', padding: 0 }}>Register here</button></>
          ) : (
            <>Already have an account?{' '}<button onClick={() => { setMode('login'); setError(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontWeight: '600', fontSize: '13px', padding: 0 }}>Sign in</button></>
          )}
        </div>

        <div style={{ marginTop: '12px', textAlign: 'center' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', padding: '4px' }}>
            Continue on this browser
          </button>
        </div>
      </div>
    </div>
  );
}
