'use client';

import { BrainCircuit } from 'lucide-react';
import { subjectDisplayName } from '../../lib/format';

interface TutorHeaderProps {
  currentEx: Record<string, unknown> | null;
  onExplain: () => void;
  feedbackWidth: number;
  topic: string;
  /** Curriculum name; the topic code is only a fallback. */
  topicName?: string;
  subject: string;
  yearLevel?: string | number;
  unit?: string | number;
  sessionCorrect?: number;
  sessionTotal?: number;
}

export default function TutorHeader({
  currentEx,
  onExplain,
  feedbackWidth,
  topic,
  topicName,
  subject,
  yearLevel,
  unit,
  sessionCorrect = 0,
  sessionTotal = 0,
}: TutorHeaderProps) {
  const subjectLabel = subjectDisplayName(subject);
  const scopeLabel = unit
    ? `Unit ${String(unit).replace(/^unit/i, '')}`
    : yearLevel
      ? `Year ${String(yearLevel).replace(/^year/i, '')}`
      : '';
  const topicLabel = topicName || topic.replace(/_/g, ' ');

  return (
    <div className="tutor-header" style={{ display: 'flex', padding: 0, borderBottom: '1px solid var(--border-color)', alignItems: 'stretch' }}>
      {/* Left part of header matching tutor-question-column */}
      <div className="tutor-header-question" style={{
        flex: 1,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '20px 28px',
        borderRight: '1px solid var(--border-color)'
      }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
            Practice
          </h2>
          <div style={{
            marginTop: '3px', fontSize: '12px', color: 'var(--text-secondary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 'min(52vw, 620px)',
          }}>
            {[subjectLabel, scopeLabel, topicLabel].filter(Boolean).join(' · ')}
          </div>
          {/* Session mastery momentum bar */}
          {sessionTotal > 0 && (
            <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ flex: 1, maxWidth: '140px', height: '6px', borderRadius: '3px', background: 'var(--border-color)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: '3px',
                  width: `${Math.round((sessionCorrect / Math.max(sessionTotal, 1)) * 100)}%`,
                  background: sessionCorrect >= 5 && sessionCorrect / sessionTotal >= 0.8
                    ? 'linear-gradient(90deg, #16a34a, #22c55e)'
                    : 'linear-gradient(90deg, #6366f1, #818cf8)',
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                {sessionCorrect}/{sessionTotal}
                {sessionCorrect >= 4 && sessionCorrect / sessionTotal >= 0.8 && ' 🔥'}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={onExplain}
          disabled={!currentEx}
          style={{
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            color: '#4f46e5',
            padding: '8px 14px',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: 'none',
          }}
        >
          <BrainCircuit size={16} aria-hidden="true" /> Explain Concept
        </button>
      </div>

      {/* Resize handle spacer - matches splitter width */}
      <div className="tutor-header-spacer" style={{ width: '20px', flexShrink: 0 }} />

      {/* Right header cell — same row as Practice, matches DialoguePanel width */}
      <div
        className="tutor-header-feedback"
        style={{
          width: `${feedbackWidth}px`,
          flexShrink: 0,
          padding: '20px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          boxSizing: 'border-box',
          background: 'rgba(255, 255, 255, 0.15)',
        }}
      >
        <h2 style={{ fontSize: '20px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
          AI Tutor Feedback
        </h2>
        <div style={{ marginTop: '3px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          Continuous log · clears on next question
        </div>
      </div>
    </div>
  );
}
