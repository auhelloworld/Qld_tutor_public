'use client';
import { useEffect, useState } from 'react';
import { Toast, subscribe, dismissToast, getToasts } from '../lib/toast';

export default function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    setToasts(getToasts());
    return subscribe(setToasts);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div aria-live="polite" style={{ position: 'fixed', top: 16, right: 16, zIndex: 10000, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            background: t.kind === 'error' ? 'rgba(239,68,68,0.9)' : t.kind === 'success' ? 'rgba(34,197,94,0.9)' : 'rgba(59,130,246,0.9)',
            color: 'white',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            maxWidth: 360,
          }}
        >
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
