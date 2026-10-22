import type { ExamHistoryItem, PSMTHistoryItem } from '../../lib/api-types';

interface AssessmentReadinessProps {
  exams: ExamHistoryItem[];
  latestPsmt: PSMTHistoryItem | null;
  showPsmt?: boolean;
}

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function examTrend(exams: ExamHistoryItem[]) {
  const valid = [...exams]
    .filter(exam => typeof exam.percentage === 'number' && !exam.provisional)
    .sort((a, b) => String(b.completed_at || b.started_at || '').localeCompare(String(a.completed_at || a.started_at || '')));
  if (valid.length === 0) return { label: 'No final exams yet', detail: 'Run and fully score a practice set to create an assessment baseline.', tone: '#d97706' };

  const latestExam = valid[0];
  const comparable = valid.filter(exam =>
    (exam.subject || '') === (latestExam.subject || '')
    && (exam.year_level ?? null) === (latestExam.year_level ?? null)
    && (exam.unit ?? null) === (latestExam.unit ?? null)
    && (exam.syllabus_subject || '') === (latestExam.syllabus_subject || '')
    && (exam.exam_type || 'mixed') === (latestExam.exam_type || 'mixed')
  );
  const latest = comparable[0].percentage;
  if (comparable.length < 4) {
    return {
      label: `${Math.round(latest)}% latest`,
      detail: `${comparable.length} comparable final exam${comparable.length === 1 ? '' : 's'} recorded. Two two-exam windows are required before showing a trend.`,
      tone: '#d97706',
    };
  }

  const latestWindow = comparable.slice(0, 2);
  const priorWindow = comparable.slice(2, 4);
  const average = (items: ExamHistoryItem[]) => items.reduce((sum, item) => sum + item.percentage, 0) / items.length;
  const delta = Math.round(average(latestWindow) - average(priorWindow));
  const direction = delta > 3 ? 'improving' : delta < -3 ? 'slipping' : 'steady';
  const tone = direction === 'improving' ? '#16a34a' : direction === 'slipping' ? '#dc2626' : '#d97706';
  return {
    label: `${Math.round(latest)}% latest`,
    detail: `${direction.charAt(0).toUpperCase()}${direction.slice(1)} across two comparable two-exam windows (${delta >= 0 ? '+' : ''}${delta} pts).`,
    tone,
  };
}

function psmtTone(readiness?: string) {
  if (readiness === 'ready') return '#16a34a';
  if (readiness === 'needs_attention') return '#dc2626';
  return '#d97706';
}

export default function AssessmentReadiness({ exams, latestPsmt, showPsmt = true }: AssessmentReadinessProps) {
  const trend = examTrend(exams);
  const nextAction = showPsmt
    ? latestPsmt?.next_revision_actions?.[0] || latestPsmt?.top_gaps?.[0] || 'Submit a PSMT section for feedback to create an IA1 revision signal.'
    : 'Run a scoped mock exam or guided session to create the next assessment signal.';

  return (
    <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 14px 0' }}>Assessment Readiness</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
        <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '14px', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Exam Trend</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: trend.tone }}>{trend.label}</div>
          <p style={{ margin: '6px 0 0 0', color: 'var(--text-secondary)', fontSize: '12.5px', lineHeight: 1.5 }}>{trend.detail}</p>
        </div>

        {showPsmt && (
          <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '14px', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>IA1 PSMT</div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: psmtTone(latestPsmt?.readiness_level) }}>
              {latestPsmt ? latestPsmt.readiness_level.replace('_', ' ') : 'No check yet'}
            </div>
            <p style={{ margin: '6px 0 0 0', color: 'var(--text-secondary)', fontSize: '12.5px', lineHeight: 1.5 }}>
              {latestPsmt ? `${latestPsmt.section_name} checked ${formatDate(latestPsmt.timestamp)}.` : 'No PSMT feedback history yet.'}
            </p>
          </div>
        )}
      </div>
      <div style={{ marginTop: '14px', padding: '12px 14px', borderRadius: '8px', background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)' }}>
        <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--accent-color)', marginBottom: '4px' }}>Next Assessment Action</div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{nextAction}</div>
      </div>
    </div>
  );
}
