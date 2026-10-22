'use client';

import React from 'react';
import MathMarkdown from '../../MathMarkdown';

export interface ExplanationPanelProps {
  modelLimitations: string[];
  transferTopicId?: string;
  onTransfer?: () => void;
  isCompleted?: boolean;
}

function isCoverageNote(note: string): boolean {
  return /partial curriculum coverage|curriculum coverage|coverage is limited|coverage is restricted/i.test(note);
}

export default function ExplanationPanel({
  modelLimitations,
  transferTopicId,
  onTransfer,
  isCompleted = false,
}: ExplanationPanelProps) {
  const coverageNotes = modelLimitations.filter(isCoverageNote);
  const modelNotes = modelLimitations.filter((note) => !isCoverageNote(note));
  const noteListStyle: React.CSSProperties = {
    margin: 0,
    paddingLeft: '20px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  };

  return (
    <div
      className="glass-panel"
      style={{
        padding: '16px',
        borderRadius: '12px',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        marginBottom: '16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span aria-hidden="true" style={{ fontSize: '18px' }}>🔬</span>
        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
          Model Scope, Coverage & Scientific Limitations
        </h4>
      </div>

      {coverageNotes.length > 0 && (
        <section aria-labelledby="science-coverage-heading" style={{ marginBottom: '12px' }}>
          <h5
            id="science-coverage-heading"
            style={{ fontSize: '12px', color: 'var(--text-primary)', margin: '0 0 6px', fontWeight: 700 }}
          >
            Curriculum coverage
          </h5>
          <ul style={noteListStyle}>
            {coverageNotes.map((note) => (
              <li key={note}><MathMarkdown inline>{note}</MathMarkdown></li>
            ))}
          </ul>
        </section>
      )}

      {modelNotes.length > 0 && (
        <section aria-labelledby="science-model-notes-heading" style={{ marginBottom: '12px' }}>
          <h5
            id="science-model-notes-heading"
            style={{ fontSize: '12px', color: 'var(--text-primary)', margin: '0 0 6px', fontWeight: 700 }}
          >
            Model notes and limitations
          </h5>
          <ul style={noteListStyle}>
            {modelNotes.map((note) => (
              <li key={note}><MathMarkdown inline>{note}</MathMarkdown></li>
            ))}
          </ul>
        </section>
      )}

      {modelLimitations.length === 0 && (
        <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          No additional model limitations are listed for this activity.
        </p>
      )}

      {transferTopicId && onTransfer && (
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
          {isCompleted && (
            /* Completion records that the investigation was done. It is NOT
             * mastery evidence — only the independent transfer question is
             * (plan sections 6.1 and 7.6), so the wording must not imply it. */
            <div
              role="status"
              style={{
                marginBottom: '10px',
                padding: '8px 10px',
                borderRadius: '8px',
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                lineHeight: 1.45,
              }}
            >
              <strong style={{ color: '#047857' }}>
                <span aria-hidden="true">✓</span>{' '}Investigation complete.
              </strong>{' '}
              This records that you worked through the activity. It is not a mastery
              score — the independent question below is what counts towards your progress.
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
                <span aria-hidden="true">🚀</span>{' '}Ready to prove your understanding?
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Test your mastery on real exam practice questions for topic {transferTopicId}.
              </div>
            </div>
            <button
              type="button"
              onClick={onTransfer}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: isCompleted ? '2px solid #10b981' : 'none',
                background: 'var(--accent-color, #10b981)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'opacity 0.15s ease',
              }}
            >
              Start Transfer Practice →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
