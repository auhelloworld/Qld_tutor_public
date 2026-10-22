import type { TopicProgress } from '../../lib/api-types';

interface CoverageConfidenceProps {
  progress: TopicProgress[];
}

function isUnattempted(topic: TopicProgress): boolean {
  return topic.status === 'not_started' || (topic.evidence_count ?? topic.attempts_count ?? 0) === 0;
}

function mastery(topic: TopicProgress): number {
  return topic.bkt_mastery ?? 0;
}

export default function CoverageConfidence({ progress }: CoverageConfidenceProps) {
  const total = progress.length;
  const unattempted = progress.filter(isUnattempted);
  const lowConfidence = progress.filter(t => t.confidence === 'none' || t.confidence === 'low');
  const mastered = progress.filter(t => t.status === 'mastered');
  const needsPractice = progress
    .filter(t => !isUnattempted(t) && mastery(t) < 0.65)
    .sort((a, b) => mastery(a) - mastery(b))
    .slice(0, 4);
  const firstGaps = unattempted.slice(0, 4);

  const summaryItems = [
    { label: 'Mastered', value: mastered.length, color: '#16a34a' },
    { label: 'Low confidence', value: lowConfidence.length, color: '#d97706' },
    { label: 'Not started', value: unattempted.length, color: '#dc2626' },
  ];

  return (
    <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 4px 0' }}>Coverage And Confidence</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>
            {total > 0 ? `${total} curriculum topics in this scope` : 'No scoped curriculum topics returned yet'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {summaryItems.map(item => (
            <div key={item.label} style={{ minWidth: '92px', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ fontSize: '20px', fontWeight: '800', color: item.color, lineHeight: 1 }}>{item.value}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        <div>
          <h3 style={{ fontSize: '13px', fontWeight: '700', margin: '0 0 8px 0' }}>First Coverage Gaps</h3>
          {firstGaps.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)', fontSize: '12.5px', lineHeight: 1.55 }}>
              {firstGaps.map(topic => (
                <li key={topic.topic}>{topic.topic}</li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '12.5px' }}>No unattempted topics in this scope.</p>
          )}
        </div>

        <div>
          <h3 style={{ fontSize: '13px', fontWeight: '700', margin: '0 0 8px 0' }}>Practice To Stabilise</h3>
          {needsPractice.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)', fontSize: '12.5px', lineHeight: 1.55 }}>
              {needsPractice.map(topic => (
                <li key={topic.topic}>
                  {topic.topic} <span style={{ color: 'var(--text-muted)' }}>({Math.round(mastery(topic) * 100)}% mastery)</span>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '12.5px' }}>No fragile attempted topics found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
