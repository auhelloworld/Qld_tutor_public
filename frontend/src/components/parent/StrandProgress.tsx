interface StrandProgressProps {
  strandStats: Record<string, { mastered: number; total: number }>;
}

export default function StrandProgress({ strandStats }: StrandProgressProps) {
  return (
    <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>📚 Strand Progress</h2>
      {Object.entries(strandStats).sort().map(([strand, stats]) => (
        <div key={strand} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
          <span style={{ width: '100px', fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)' }}>{strand}</span>
          <div
            role="progressbar"
            aria-label={`${strand}: ${stats.mastered} of ${stats.total} topics mastered`}
            aria-valuemin={0}
            aria-valuemax={stats.total}
            aria-valuenow={stats.mastered}
            aria-valuetext={`${stats.mastered} of ${stats.total} mastered`}
            style={{ flex: 1, height: '8px', background: 'var(--bg-secondary)', borderRadius: '4px', overflow: 'hidden' }}
          >
            <div style={{ width: `${stats.total > 0 ? (stats.mastered / stats.total) * 100 : 0}%`, height: '100%', background: stats.mastered / stats.total >= 0.8 ? '#16a34a' : stats.mastered / stats.total >= 0.4 ? '#d97706' : '#dc2626', borderRadius: '4px' }} />
          </div>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', minWidth: '60px', textAlign: 'right' }}>
            {stats.mastered}/{stats.total}
          </span>
        </div>
      ))}
      {Object.keys(strandStats).length === 0 && (
        <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>No progress data yet. Start practising!</div>
      )}
    </div>
  );
}
