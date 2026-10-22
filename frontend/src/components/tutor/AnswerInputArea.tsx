'use client';

import MCQInput from './MCQInput';
import MultiPartInput, { type AnswerLockReason } from './MultiPartInput';
import MathSymbolKeyboard from '../MathSymbolKeyboard';
import type { SubPartResult } from '../../lib/api-types';

const LOCK_MESSAGES: Record<AnswerLockReason, string> = {
  correct: 'Your answer is marked correct. Continue with the button below.',
  incorrect: 'Choose Try Again to answer again.',
  pending: 'Your answer is saved for review. Continue with the button below.',
  remediation: 'Review the concept, then choose Try Again to unlock.',
};

interface AnswerInputAreaProps {
  exercise: any;
  answer: string;
  multiPartResults: SubPartResult[];
  activeMultipartLabel: string | null;
  remediationRequired: boolean;
  /** When set, the shown answer is marked and cannot change until the parent unlocks it. */
  lockReason?: AnswerLockReason | null;
  showMathToolbar?: boolean;
  onSetAnswer: (val: string) => void;
  onSetActivePart: (label: string | null) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  onShowWorkedExample?: () => void;
  onExplainConcept?: () => void;
  onUnlock?: () => void;
}

export default function AnswerInputArea({
  exercise: ex,
  answer,
  multiPartResults,
  activeMultipartLabel,
  remediationRequired,
  lockReason = null,
  showMathToolbar = false,
  onSetAnswer,
  onSetActivePart,
  onKeyDown,
  onShowWorkedExample,
  onExplainConcept,
  onUnlock,
}: AnswerInputAreaProps) {
  const hasValidSubParts = Array.isArray(ex.sub_parts) && ex.sub_parts.length > 0;
  const lockMessage = lockReason ? LOCK_MESSAGES[lockReason] : null;
  const lockNote = lockMessage && (
    <p id="answer-lock-message" style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
      🔒 {lockMessage}
    </p>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* MCQ: Radio button choices */}
      {ex.question_type === 'multiple_choice' && ex.choices ? (
        <>
          <MCQInput choices={ex.choices} selected={answer} onSelect={onSetAnswer} disabled={Boolean(lockReason)} />
          {lockNote}
        </>
      ) : ex.question_type === 'multi_part' && !hasValidSubParts ? (
        <div
          role="alert"
          style={{
            padding: '14px 16px',
            borderRadius: '8px',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            background: 'rgba(239, 68, 68, 0.08)',
            color: 'var(--text-primary)',
            fontSize: '13px',
            lineHeight: 1.5,
          }}
        >
          This multi-part question is missing its parts. Try another question.
        </div>
      ) : ex.question_type === 'multi_part' ? (
        <MultiPartInput
          key={ex.id}
          subParts={ex.sub_parts}
          multiPartResults={multiPartResults}
          activeMultipartLabel={activeMultipartLabel}
          answer={answer}
          lockReason={lockReason}
          onSetActivePart={onSetActivePart}
          onSetAnswer={onSetAnswer}
          onKeyDown={onKeyDown}
        />
      ) : (
        <>
          {/* Reasoning or Short Answer: textarea */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label htmlFor="answer-textarea" style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-secondary)' }}>
              {ex.question_type === 'reasoning' ? 'Your Reasoning' : 'Your Answer'}
            </label>
            {ex.question_type === 'reasoning' && ex.rubric?.max_score && (
              <span style={{
                fontSize: '13px',
                padding: '2px 8px',
                borderRadius: '10px',
                fontWeight: '600',
                background: 'rgba(168, 85, 247, 0.15)',
                color: '#c084fc',
                border: '1px solid rgba(168, 85, 247, 0.3)',
              }}>
                {ex.rubric.max_score} points
              </span>
            )}
          </div>
          {showMathToolbar && (
            <MathSymbolKeyboard
              textareaId="answer-textarea"
              onInsert={onSetAnswer}
              disabled={Boolean(lockReason)}
            />
          )}
          <textarea 
            id="answer-textarea"
            className="auto-growing-textarea"
            value={answer}
            onChange={e => onSetAnswer(e.target.value)}
            onKeyDown={onKeyDown}
            readOnly={Boolean(lockReason)}
            aria-describedby={lockMessage ? 'answer-lock-message' : undefined}
            maxLength={1000}
            placeholder={
              ex.question_type === 'reasoning'
                ? "Explain your reasoning clearly. Show your working and justify each step... (Cmd/Ctrl+Enter to submit)"
                : "Type your answer here... (Cmd/Ctrl+Enter to submit)"
            }
            style={{
              minHeight: ex.question_type === 'reasoning' ? '180px' : '120px',
              maxHeight: 'min(45dvh, 420px)',
              resize: 'vertical',
              opacity: lockReason ? 0.7 : 1,
              cursor: lockReason ? 'not-allowed' : undefined,
            }}
          />
          {lockNote}
        </>
      )}
      {remediationRequired && (
        <div style={{
          padding: '18px', borderRadius: '12px', marginBottom: '12px',
          background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(251,191,36,0.08))',
          border: '1px solid rgba(245,158,11,0.3)',
          color: 'var(--text-primary)', fontSize: '13.5px', lineHeight: '1.6',
        }}>
          <div style={{ fontWeight: '700', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px', color: '#d97706' }}>
            💡 Concept Study Break
          </div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: '14px' }}>
            It seems this question is a bit tricky. We suggest reading the concept explanation or reviewing the worked example below. Click “Try Again” when you are ready to unlock.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {onExplainConcept && (
              <button
                type="button"
                onClick={onExplainConcept}
                style={{
                  padding: '6px 12px', fontSize: '13px', fontWeight: '600',
                  borderRadius: '6px', border: '1px solid rgba(99,102,241,0.4)',
                  background: 'rgba(99,102,241,0.1)', color: 'var(--accent-color)', cursor: 'pointer'
                }}
              >
                📖 Explain Concept
              </button>
            )}
            {onShowWorkedExample && (
              <button
                type="button"
                onClick={onShowWorkedExample}
                style={{
                  padding: '6px 12px', fontSize: '13px', fontWeight: '600',
                  borderRadius: '6px', border: '1px solid rgba(168,85,247,0.4)',
                  background: 'rgba(168,85,247,0.1)', color: 'var(--accent-purple, #a855f7)', cursor: 'pointer'
                }}
              >
                📖 Worked Example
              </button>
            )}
            {onUnlock && (
              <button
                type="button"
                onClick={onUnlock}
                style={{
                  padding: '6px 12px', fontSize: '13px', fontWeight: '700',
                  borderRadius: '6px', border: '1px solid rgba(16,185,129,0.4)',
                  background: 'rgba(16,185,129,0.1)', color: '#10b981', cursor: 'pointer'
                }}
              >
                🔄 Try Again
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
