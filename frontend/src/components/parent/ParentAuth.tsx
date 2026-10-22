'use client';

import BackToPracticeLink from '../BackToPracticeLink';

interface ParentAuthProps {
  passwordInput: string;
  passwordError: string;
  onPasswordChange: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export default function ParentAuth({ passwordInput, passwordError, onPasswordChange, onSubmit }: ParentAuthProps) {
  return (
    <div style={{ maxWidth: '400px', margin: '80px auto', padding: '32px', textAlign: 'center' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
      <h1 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '8px' }}>Parent Dashboard</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
        Enter the parent password to access student management and review tools.
      </p>
      <form onSubmit={onSubmit}>
        <label htmlFor="parent-password" style={{ display: 'block', textAlign: 'left', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>
          Parent password
        </label>
        <input
          id="parent-password"
          type="password"
          value={passwordInput}
          onChange={e => onPasswordChange(e.target.value)}
          placeholder="Enter parent password"
          autoComplete="current-password"
          aria-invalid={Boolean(passwordError)}
          aria-describedby={passwordError ? 'parent-password-error' : undefined}
          autoFocus
          style={{
            width: '100%', padding: '12px 16px', fontSize: '16px',
            borderRadius: '8px', border: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)', color: 'var(--text-primary)',
            boxSizing: 'border-box', marginBottom: '12px',
          }}
        />
        {passwordError && (
          <p id="parent-password-error" role="alert" style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{passwordError}</p>
        )}
        <button
          type="submit"
          style={{
            width: '100%', padding: '12px', fontSize: '16px', fontWeight: '600',
            borderRadius: '8px', border: 'none', cursor: 'pointer',
            background: 'var(--accent-color)', color: 'white',
          }}
        >
          Unlock Dashboard
        </button>
      </form>
      <div style={{ marginTop: '24px' }}>
        <BackToPracticeLink />
      </div>
    </div>
  );
}
