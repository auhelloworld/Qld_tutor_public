import type { WeeklyLearningSummary as WeeklyLearningSummaryData } from '../lib/api-types';

interface WeeklyLearningSummaryProps {
  summary: WeeklyLearningSummaryData | null;
  audience?: 'student' | 'parent';
}

function metricValue(value: number): string {
  return new Intl.NumberFormat('en-AU').format(value);
}

export default function WeeklyLearningSummary({
  summary,
  audience = 'student',
}: WeeklyLearningSummaryProps) {
  if (!summary) return null;

  const confidenceMessage = summary.confidence_judgements === 0
    ? 'No confidence ratings were recorded yet.'
    : summary.high_confidence_errors > 0
      ? `${summary.high_confidence_errors} high-confidence error${summary.high_confidence_errors === 1 ? '' : 's'} to revisit.`
      : summary.low_confidence_correct > 0
        ? `${summary.low_confidence_correct} correct answer${summary.low_confidence_correct === 1 ? '' : 's'} began as a guess — useful evidence of growing knowledge.`
        : 'Confidence and outcomes were aligned in the recorded judgements.';
  const rate = summary.independent_secured_per_10_active_minutes;

  return (
    <section className="glass-panel" aria-labelledby={`weekly-learning-summary-${audience}`} style={{ padding: '20px', borderRadius: '14px', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <div>
          <h2 id={`weekly-learning-summary-${audience}`} style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>
            Learning evidence · last {summary.days} days
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '12.5px' }}>
            Across all subjects · {summary.activity_days} active day{summary.activity_days === 1 ? '' : 's'} · {summary.attempts} scored attempt{summary.attempts === 1 ? '' : 's'}
          </p>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'right' }}>
          Observed activity span<br />
          <strong style={{ color: 'var(--text-primary)' }}>
            {summary.active_minutes_estimate > 0 ? `~${summary.active_minutes_estimate} min` : 'Not enough timestamp span'}
          </strong>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '10px' }}>
        <Metric label="First-try independent" value={metricValue(summary.first_independent_correct)} detail="secured evidence" />
        <Metric label="Supported correct" value={metricValue(summary.supported_correct)} detail="ready to fade support" />
        <Metric label="Revision / closure" value={`${summary.revision_attempts} / ${summary.mistake_closures}`} detail="attempts / mistakes closed" />
        <Metric label="Self-explanations" value={metricValue(summary.self_explanations)} detail="ideas made explicit" />
        <Metric
          label="Independent secured / 10 active min"
          value={rate === null ? '—' : rate.toFixed(2)}
          detail={rate === null ? 'needs a measurable activity span' : 'timestamp-window estimate'}
        />
      </div>

      <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(99,102,241,0.06)', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        <strong style={{ color: 'var(--text-primary)' }}>Confidence check:</strong> {confidenceMessage}
      </div>
      <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        <strong style={{ color: 'var(--text-primary)' }}>{audience === 'parent' ? 'Helpful prompt:' : 'Next learning move:'}</strong>{' '}
        {summary.next_action}
      </div>
      <p style={{ margin: '10px 0 0', fontSize: '10.5px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
        Time is not a stopwatch total. {summary.time_basis_note}
      </p>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: '9px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 700, lineHeight: 1.3 }}>{label}</div>
      <div style={{ marginTop: '3px', fontSize: '19px', fontWeight: 800, color: 'var(--text-primary)' }}>{value}</div>
      <div style={{ marginTop: '2px', fontSize: '10.5px', color: 'var(--text-secondary)' }}>{detail}</div>
    </div>
  );
}
