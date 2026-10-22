'use client';

import { ArrowRight, CheckCircle2 } from 'lucide-react';
import LearningReceipt from '../LearningReceipt';

interface GuidedSessionSummaryProps {
  total: number;
  attempted?: number;
  pendingReview?: number;
  hintClicks: number;
  dialogueTurns?: number;
  workedExamplesOpened: number;
  readyToFade?: boolean;
  todaySession?: boolean;
  replacedQuestions?: number;
  independentCorrect?: number;
  independentTotal?: number;
  successCriterion?: string | null;
}

export default function GuidedSessionSummary({
  total,
  attempted,
  pendingReview = 0,
  hintClicks,
  dialogueTurns = 0,
  workedExamplesOpened,
  readyToFade = false,
  todaySession = false,
  replacedQuestions = 0,
  independentCorrect = 0,
  independentTotal = 0,
  successCriterion,
}: GuidedSessionSummaryProps) {
  const questionsCompleted = attempted ?? total;
  const evidencePending = pendingReview > 0 && independentTotal === 0;
  const independentlySecured = independentTotal > 0 && independentCorrect >= independentTotal;
  const supportWasUsed = hintClicks > 0 || dialogueTurns > 0 || workedExamplesOpened > 0;
  const StatusIcon = independentlySecured ? CheckCircle2 : ArrowRight;

  const title = evidencePending
    ? 'Review pending'
    : independentlySecured
      ? 'Independent check secured'
      : readyToFade
        ? 'Ready for an independent check'
        : 'Guided practice complete';

  const evidenceMessage = independentlySecured
    ? `${independentCorrect}/${independentTotal} check questions were correct without help.`
    : independentTotal > 0
      ? `${independentCorrect}/${independentTotal} check questions were correct without help. Guided progress is not yet the same as secured evidence.`
      : pendingReview > 0
        ? `${pendingReview} response${pendingReview === 1 ? ' is' : 's are'} awaiting parent review. Independent evidence will be decided afterwards.`
        : 'This set built supported progress. An unaided check is still needed before the skill is called secure.';

  const nextStep = pendingReview > 0
    ? 'Wait for the review result; no extra work is needed now.'
    : todaySession
      ? 'Return to Today Study and follow its single next priority.'
      : independentlySecured
        ? 'Stop here and retrieve this skill again when review is scheduled.'
        : readyToFade
          ? 'Try the next short set without Concept, Chat or a revealed answer.'
          : 'Take a short break, then use a brief independent retrieval set.';

  return (
    <div
      className="glass-panel"
      style={{
        padding: '30px',
        borderRadius: '20px',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.7), rgba(255,255,255,0.65))',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '18px',
        animation: 'fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        style={{
          width: '54px',
          height: '54px',
          borderRadius: '50%',
          background: independentlySecured ? 'rgba(16,185,129,0.12)' : 'rgba(99,102,241,0.10)',
          color: independentlySecured ? '#15803d' : 'var(--accent-color)',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <StatusIcon size={28} aria-hidden="true" />
      </div>

      <div style={{ textAlign: 'center', maxWidth: '540px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
          {title}
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: '7px 0 0', lineHeight: 1.55 }}>
          {evidenceMessage}
        </p>
      </div>

      <LearningReceipt
        questionsCompleted={questionsCompleted}
        questionTarget={total}
        securedCount={independentCorrect}
        securedTarget={independentTotal}
        successCriterion={successCriterion}
        criterionMet={independentlySecured}
        evidenceDetail={evidencePending ? `${pendingReview} awaiting parent review` : 'first response, support level 0, no reveal'}
        evidencePending={evidencePending}
        nextAction={nextStep}
      />

      {supportWasUsed && (
        <div
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '10px',
            background: 'rgba(99,102,241,0.07)',
            color: 'var(--text-secondary)',
            fontSize: '12.5px',
            lineHeight: 1.5,
          }}
        >
          Support helped during practice. That progress is useful, while only the unaided check above counts as secured evidence.
        </div>
      )}

      {replacedQuestions > 0 && (
        <div style={{ width: '100%', color: 'var(--text-secondary)', fontSize: '12px' }}>
          {replacedQuestions} replaced question{replacedQuestions === 1 ? ' was' : 's were'} not counted as completed.
        </div>
      )}

    </div>
  );
}
