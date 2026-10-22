import type { DailySummary } from '../../lib/api-types';

interface DailySummaryCardsProps {
  daily: DailySummary | null;
  examsCount: number;
}

export default function DailySummaryCards({ daily, examsCount }: DailySummaryCardsProps) {
  const goalProgress = Math.max(0, Math.min(1, daily?.goal_progress || 0));
  const goalPercent = Math.round(goalProgress * 100);
  const independentAccuracy = daily?.today_independent_accuracy;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
      <div className="glass-panel" style={{ padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '36px', fontWeight: '800', color: daily?.goal_met ? '#16a34a' : 'var(--text-primary)' }}>
          {daily?.today_attempts || 0}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Questions across all subjects today</div>
        <div
          role="progressbar"
          aria-label="Progress toward the all-subject daily question goal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={goalPercent}
          aria-valuetext={`${daily?.today_attempts || 0} of ${daily?.daily_goal || 20} questions`}
          style={{ marginTop: '8px', height: '6px', background: 'var(--bg-secondary)', borderRadius: '3px', overflow: 'hidden' }}
        >
          <div style={{ width: `${goalPercent}%`, height: '100%', background: daily?.goal_met ? '#16a34a' : 'var(--accent-color)', borderRadius: '3px', transition: 'width 0.3s' }} />
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          All-subject goal: {daily?.daily_goal || 20} questions
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '36px', fontWeight: '800', color: '#d97706' }}>
          {daily?.streak_days || 0}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Across all subjects streak 🔥</div>
        {daily?.streak_message && (
          <div style={{ fontSize: '11px', color: '#d97706', marginTop: '6px', lineHeight: '1.3' }}>
            {daily.streak_message}
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '36px', fontWeight: '800', color: independentAccuracy === undefined || independentAccuracy === null ? 'var(--text-muted)' : independentAccuracy >= 70 ? '#16a34a' : '#dc2626' }}>
          {independentAccuracy === undefined || independentAccuracy === null ? '—' : `${independentAccuracy}%`}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Independent accuracy across all subjects today</div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Show Answer submissions are excluded · {daily?.today_independent_attempts || 0} independent answer{daily?.today_independent_attempts === 1 ? '' : 's'}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '36px', fontWeight: '800', color: 'var(--accent-color)' }}>
          {examsCount}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Mock exams in this scope</div>
      </div>
    </div>
  );
}
