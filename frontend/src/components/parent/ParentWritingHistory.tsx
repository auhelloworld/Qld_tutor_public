'use client';

import type { ParentWritingHistoryEntry, ParentWritingHistoryResponse } from '../../lib/api-types';

interface Props {
  data: ParentWritingHistoryResponse | null;
}

const PROMPT_LABELS: Record<string, string> = {
  persuasive: 'Persuasive',
  narrative: 'Narrative / Imaginative',
  analytical: 'Analytical',
  expository: 'Informative / Expository',
};

function labelFor(entry: ParentWritingHistoryEntry): string {
  if (entry.is_senior && entry.prompt_type === 'persuasive') return 'Public audience response';
  if (entry.is_senior && entry.prompt_type === 'narrative') return 'Imaginative response';
  return PROMPT_LABELS[entry.prompt_type] || entry.prompt_type;
}

function scoreLabel(entry: ParentWritingHistoryEntry): string {
  if (entry.insufficient_evidence) return 'Not scored — more evidence needed';
  if (entry.max_total_score <= 0) return 'No score recorded';
  return `${entry.total_score}/${entry.max_total_score} (${Math.round((entry.total_score / entry.max_total_score) * 100)}%)`;
}

export default function ParentWritingHistory({ data }: Props) {
  if (!data) return null;

  return (
    <section className="glass-panel" style={{ padding: '20px', marginTop: '24px', marginBottom: '24px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 6px' }}>✍️ Writing History</h2>
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 14px', lineHeight: 1.5 }}>
        Recent formative writing assessments for this English scope. Draft text and source material are not shown here.
      </p>
      {data.assessments.length === 0 ? (
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
          No writing assessments in this scope yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {data.assessments.slice(-8).reverse().map((entry) => (
            <div
              key={`${entry.timestamp}-${entry.prompt_type}`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(150px, 1fr) auto auto',
                gap: '10px',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
                  {labelFor(entry)} · Year {entry.year_level}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                  {new Date(entry.timestamp).toLocaleDateString('en-AU')} · {entry.word_count} words
                  {entry.topic_title ? ` · ${entry.topic_title}` : ''}
                </div>
              </div>
              <span style={{ fontSize: '12px', fontWeight: '700', color: entry.insufficient_evidence ? '#d97706' : 'var(--text-primary)', textAlign: 'right' }}>
                {scoreLabel(entry)}
              </span>
              {entry.revision_of ? (
                <span style={{ fontSize: '10px', color: 'var(--accent-color)', whiteSpace: 'nowrap' }}>Revision</span>
              ) : (
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Assessment</span>
              )}
            </div>
          ))}
        </div>
      )}
      {data.truncated && (
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '10px 0 0' }}>
          Showing the recent bounded history window.
        </p>
      )}
    </section>
  );
}
