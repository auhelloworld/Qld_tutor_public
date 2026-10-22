import MathMarkdown from '../MathMarkdown';
import { formatStudentAnswer } from '../../lib/format';

interface RecentMistakesProps {
  mistakes: any[];
}

export default function RecentMistakes({ mistakes }: RecentMistakesProps) {
  return (
    <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '4px' }}>⚠️ This Week&apos;s Mistakes ({mistakes.length})</h2>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Last 7 days, including reviewed items. The Error Book page shows all unresolved mistakes regardless of date.
      </div>
      {mistakes.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>No mistakes this week — great work! 🎉</div>
      ) : (
        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {mistakes.slice(0, 10).map((m, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-color)', fontSize: '13px' }}>
              <div style={{ color: 'var(--text-primary)' }}><MathMarkdown inline>{m.question?.slice(0, 80) || ''}</MathMarkdown></div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '4px', color: 'var(--text-secondary)' }}>
                {m.student_answer && <span style={{ color: '#dc2626' }}>Wrote: <MathMarkdown inline>{formatStudentAnswer(m.student_answer)}</MathMarkdown></span>}
                <span style={{ color: '#16a34a' }}>Answer: <MathMarkdown inline>{m.correct_answer}</MathMarkdown></span>
                <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{m.topic_id}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
