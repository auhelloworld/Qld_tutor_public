'use client';

import React from 'react';
import MathMarkdown from './MathMarkdown';

export interface LearningReceiptProps {
  questionsCompleted: number;
  /** Omit when the session stops on evidence instead of a fixed number. */
  questionTarget?: number;
  securedCount: number;
  securedTarget: number;
  successCriterion?: string | null;
  criterionMet?: boolean;
  confidenceJudgements?: number;
  highConfidenceCorrect?: number;
  highConfidenceErrors?: number;
  lowConfidenceCorrect?: number;
  nextReviewAt?: string | null;
  nextAction?: string | null;
  evidenceLabel?: string;
  evidenceDetail?: string;
  evidencePending?: boolean;
  compact?: boolean;
  /** Heading level that fits the host page outline. */
  headingLevel?: 2 | 3;
}

function reviewLabel(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export default function LearningReceipt({
  questionsCompleted,
  questionTarget,
  securedCount,
  securedTarget,
  successCriterion,
  criterionMet = false,
  confidenceJudgements,
  highConfidenceCorrect = 0,
  highConfidenceErrors = 0,
  lowConfidenceCorrect = 0,
  nextReviewAt,
  nextAction,
  evidenceLabel = 'Independent evidence',
  evidenceDetail = 'secured without answer reveal',
  evidencePending = false,
  compact = false,
  headingLevel = 3,
}: LearningReceiptProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const nextReview = reviewLabel(nextReviewAt);
  const calibrationMessage = confidenceJudgements === undefined
    ? null
    : confidenceJudgements === 0
      ? 'Add a confidence judgement before submitting to practise calibration.'
      : highConfidenceErrors > 0
        ? `${highConfidenceErrors} high-confidence error${highConfidenceErrors === 1 ? '' : 's'} — revisit the rule before the next check.`
        : lowConfidenceCorrect > 0
          ? `${lowConfidenceCorrect} correct answer${lowConfidenceCorrect === 1 ? '' : 's'} with low confidence — the knowledge is stronger than it felt.`
          : `${highConfidenceCorrect}/${confidenceJudgements} confidence judgements were confident and correct.`;

  return (
    <section
      aria-label="Learning receipt"
      style={{
        width: '100%',
        padding: compact ? '14px' : '18px',
        borderRadius: '14px',
        border: '1px solid rgba(16,185,129,0.32)',
        background: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(59,130,246,0.06))',
        color: 'var(--text-primary)',
        textAlign: 'left',
      }}
    >
      <div style={{ fontSize: '12px', fontWeight: 850, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Learning receipt
      </div>
      <Heading style={{ margin: '4px 0 12px', fontSize: compact ? '17px' : '19px' }}>
        What you showed today
      </Heading>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '9px' }}>
        <div style={{ padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.45)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Completed</div>
          <strong style={{ fontSize: '20px' }}>{questionTarget === undefined ? questionsCompleted : `${questionsCompleted}/${questionTarget}`}</strong>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>questions</div>
        </div>
        <div style={{ padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.45)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{evidenceLabel}</div>
          <strong style={{ fontSize: '20px', color: evidencePending ? '#b45309' : securedTarget > 0 && securedCount >= securedTarget ? '#15803d' : '#b45309' }}>
            {evidencePending ? 'Pending' : `${securedCount}/${securedTarget}`}
          </strong>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{evidenceDetail}</div>
        </div>
      </div>

      {successCriterion && (
        <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '10px', background: criterionMet ? 'rgba(16,185,129,0.10)' : 'rgba(245,158,11,0.10)', border: criterionMet ? '1px solid rgba(16,185,129,0.28)' : '1px solid rgba(245,158,11,0.26)' }}>
          <div style={{ fontSize: '11px', fontWeight: 800, color: criterionMet ? '#15803d' : '#b45309' }}>
            {criterionMet ? '✓ Goal met' : '↻ Not yet'}
          </div>
          <div style={{ marginTop: '3px', fontSize: '13px', lineHeight: 1.45 }}><MathMarkdown inline>{successCriterion}</MathMarkdown></div>
        </div>
      )}

      {calibrationMessage && (
        <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--text-primary)' }}>Confidence check:</strong> {calibrationMessage}
        </div>
      )}
      <div style={{ marginTop: '5px', fontSize: '12px', color: 'var(--text-secondary)' }}>
        {nextAction ? (
          <><strong style={{ color: 'var(--text-primary)' }}>Next:</strong> {nextAction}</>
        ) : (
          <>
            <strong style={{ color: 'var(--text-primary)' }}>Next review:</strong>{' '}
            {nextReview ? `${nextReview}. Try it from memory before you look at help.` : criterionMet ? 'No extra review is planned.' : 'This will come back in a later review.'}
          </>
        )}
      </div>
    </section>
  );
}
