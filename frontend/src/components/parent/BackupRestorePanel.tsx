'use client';

interface BackupRestorePanelProps {
  backupKey: string;
  importKey: string;
  onExport: () => void;
  onImportKeyChange: (val: string) => void;
  onImport: () => void;
}

export default function BackupRestorePanel({
  backupKey,
  importKey,
  onExport,
  onImportKeyChange,
  onImport,
}: BackupRestorePanelProps) {
  return (
    <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: 'var(--accent-color)' }}>🔑 Progress Sync & Backup</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: '1.4' }}>
        This system is anonymous. Keep a copy of your <strong>Backup Key</strong> to restore progress on another browser or device, or if your browser cache is cleared. The backup includes your display name and learning data.
      </p>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: '700', minWidth: '120px' }}>Backup Key:</span>
          <input 
            type="text" 
            readOnly 
            value={backupKey} 
            style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '12px', fontFamily: 'monospace', flexGrow: 1, outline: 'none' }} 
          />
          <button onClick={onExport} style={{ padding: '8px 16px', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', cursor: 'pointer', fontSize: '13px', fontWeight: '600', transition: 'all 0.2s' }} className="hover-scale">
            Copy Key 📋
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', borderTop: '1px dashed var(--border-color)', paddingTop: '14px' }}>
          <span style={{ fontSize: '13px', fontWeight: '700', minWidth: '120px' }}>Restore Key:</span>
          <input 
            type="text" 
            placeholder="Paste your backup key here..." 
            value={importKey} 
            onChange={e => onImportKeyChange(e.target.value)} 
            style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '12px', fontFamily: 'monospace', flexGrow: 1, outline: 'none' }} 
          />
          <button onClick={onImport} style={{ padding: '8px 16px', borderRadius: '8px', background: 'var(--accent-color)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '600', transition: 'all 0.2s' }} className="hover-scale">
            Restore Progress 📥
          </button>
        </div>
      </div>
    </div>
  );
}
