import { useEffect, useRef } from 'react';
import { getStudentId, getDisplayName } from '../../lib/student_id';

interface RestoreModalProps {
  target: { uuid: string; name: string | null };
  onCancel: () => void;
  onConfirm: () => void;
}

export default function RestoreModal({ target, onCancel, onConfirm }: RestoreModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      );
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
      previouslyFocused?.focus();
    };
  }, [onCancel]);

  const currentId = getStudentId();
  const currentLabel = getDisplayName() || `${currentId.slice(0, 8)}…`;
  const targetLabel = target.name || `${target.uuid.slice(0, 8)}…`;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: '20px',
    }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-student-title"
        aria-describedby="restore-student-description"
        className="glass-panel"
        style={{ padding: '32px', maxWidth: '440px', width: '100%', textAlign: 'center' }}
      >
        <div aria-hidden="true" style={{ fontSize: '32px', marginBottom: '12px' }}>🔄</div>
        <h3 id="restore-student-title" style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>Switch Student Identity?</h3>
        <p id="restore-student-description" style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '20px' }}>
          This will replace the current student ({currentLabel}) with{' '}
          <strong style={{ color: 'var(--text-primary)' }}>{targetLabel}</strong>.
          All practice data, BKT mastery, and logs for the target student will be loaded.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            style={{
              padding: '10px 20px', fontSize: '14px', fontWeight: '600',
              borderRadius: '8px', border: '1px solid var(--border-color)',
              background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: '10px 20px', fontSize: '14px', fontWeight: '600',
              borderRadius: '8px', border: 'none',
              background: 'var(--accent-color)', color: '#fff', cursor: 'pointer',
            }}
          >
            Confirm Switch
          </button>
        </div>
      </div>
    </div>
  );
}
