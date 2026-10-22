import type { ExamHistoryItem } from '../../lib/api-types';

interface ExamHistoryProps {
  exams: ExamHistoryItem[];
}

export default function ExamHistory({ exams }: ExamHistoryProps) {
  if (exams.length === 0) return null;

  return (
    <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>📝 Exam History</h2>
      {exams.slice(0, 5).map((exam) => {
        const percentage = Math.round(exam.percentage);
        return (
          <div key={exam.exam_id || `${exam.started_at}-${exam.exam_type || 'exam'}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-color)', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{new Date(exam.started_at).toLocaleDateString()}</span>
            <span style={{ fontSize: '14px', fontWeight: '600' }}>{exam.correct}/{exam.total_questions}</span>
            <span style={{ fontSize: '16px', fontWeight: '700', color: percentage >= 70 ? '#16a34a' : percentage >= 50 ? '#d97706' : '#dc2626' }}>
              {percentage}%
            </span>
            {exam.provisional && (
              <span title="Open responses are still awaiting parent review, so this result may change." style={{ fontSize: '11px', fontWeight: '700', color: '#d97706', border: '1px solid rgba(217,119,6,0.35)', borderRadius: '999px', padding: '2px 7px' }}>
                Provisional · pending review
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
