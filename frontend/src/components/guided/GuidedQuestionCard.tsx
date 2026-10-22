'use client';

import React, { useState } from 'react';
import QuestionContext from '../QuestionContext';
import MathSymbolKeyboard from '../MathSymbolKeyboard';
import MCQInput from '../tutor/MCQInput';
import MultiPartInput from '../tutor/MultiPartInput';
import type { Exercise, SubPartResult } from '../../lib/api-types';

interface GuidedQuestionCardProps {
  exercise: Exercise;
  answer: string;
  onSetAnswer: (val: string) => void;
  onSubmit: () => void;
  onSkip?: () => void;
  /** "I don't know": records a miss. Today practice shows it instead of Skip. */
  onDontKnow?: () => void;
  /** Opens help. Today practice shows it next to "I don't know". */
  onNeedHelp?: () => void;
  submitting: boolean;
  multiPartResults: SubPartResult[];
  activeMultipartLabel: string | null;
  onSetActivePart: (label: string | null) => void;
  subjectColor: string;
  showMathToolbar?: boolean;
  /** Extra controls between the answer and the buttons (Today: "How sure?"). */
  beforeActions?: React.ReactNode;
  /** A taller answer box that grows with the text (Today practice). */
  roomyAnswer?: boolean;
}

/** Grow a text box with its text, up to a limit, so long working stays in view. */
function growToFit(element: HTMLTextAreaElement, maxPx = 480) {
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight + 2, maxPx)}px`;
}

export default function GuidedQuestionCard({
  exercise,
  answer,
  onSetAnswer,
  onSubmit,
  onSkip,
  onDontKnow,
  onNeedHelp,
  submitting,
  multiPartResults,
  activeMultipartLabel,
  onSetActivePart,
  subjectColor,
  showMathToolbar = false,
  beforeActions,
  roomyAnswer = false,
}: GuidedQuestionCardProps) {
  const [textareaFocused, setTextareaFocused] = useState(false);

  const isMcq = exercise.question_type === 'multiple_choice';
  const isMultiPart = exercise.question_type === 'multi_part';
  const isReasoning = exercise.question_type === 'reasoning';
  const normaliseLabel = (label: unknown) => String(label || '').toLowerCase().trim();
  const selectedPart = isMultiPart && activeMultipartLabel
    ? exercise.sub_parts?.find(part => normaliseLabel(part.label) === activeMultipartLabel)
    : null;
  const nextRequiredPart = isMultiPart
    ? exercise.sub_parts?.find(part => {
        const result = multiPartResults.find(res => normaliseLabel(res.label) === normaliseLabel(part.label));
        return result?.is_correct !== true;
      })
    : null;
  const targetPart = selectedPart || nextRequiredPart;

  const canSubmit = isMultiPart
    ? Boolean(targetPart && answer.trim().length > 0)
    : answer.trim().length > 0;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey && canSubmit && !submitting) {
      onSubmit();
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '20px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Exercise Difficulty & Type Metadata */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {exercise.difficulty === 'foundational' ? '🟢 Foundational' 
            : exercise.difficulty === 'developing' ? '🔵 Developing' 
            : exercise.difficulty === 'extending' ? '🟣 Extending Challenge' 
            : '🏆 Competition (AMC)'}
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          {isReasoning && (
            <span style={{ fontSize: '11px', background: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', border: '1px solid rgba(168, 85, 247, 0.3)', padding: '2px 8px', borderRadius: '12px', fontWeight: 'bold' }}>
              📝 Reasoning
            </span>
          )}
          {isMultiPart && (
            <span style={{ fontSize: '11px', background: 'rgba(236, 72, 153, 0.15)', color: '#ec4899', border: '1px solid rgba(236, 72, 153, 0.3)', padding: '2px 8px', borderRadius: '12px', fontWeight: 'bold' }}>
              🔗 Multi-Part
            </span>
          )}
          {exercise.complexity === 'complex_unfamiliar' && (
            <span style={{ fontSize: '11px', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '2px 8px', borderRadius: '12px', fontWeight: 'bold' }}>
              🔴 Complex Unfamiliar
            </span>
          )}
        </div>
      </div>

      <QuestionContext question={exercise} />

      {/* Input area wrapper */}
      <div style={{ marginTop: '4px' }}>
        {isMcq && exercise.choices ? (
          <MCQInput choices={exercise.choices} selected={answer} onSelect={onSetAnswer} />
        ) : isMultiPart && exercise.sub_parts ? (
          <MultiPartInput
            key={exercise.id}
            subParts={exercise.sub_parts}
            multiPartResults={multiPartResults}
            activeMultipartLabel={activeMultipartLabel}
            answer={answer}
            onSetActivePart={onSetActivePart}
            onSetAnswer={onSetAnswer}
            onKeyDown={handleKeyDown as any}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="guided-answer-input" style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                {isReasoning ? 'Explain your working step-by-step:' : 'Your Answer:'}
              </label>
              {isReasoning && exercise.rubric?.max_score && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Marks: {exercise.rubric.max_score}
                </span>
              )}
            </div>

            {isReasoning ? (
              <textarea
                id="guided-answer-input"
                value={answer}
                maxLength={1000}
                onChange={e => onSetAnswer(e.target.value.slice(0, 1000))}
                onFocus={() => setTextareaFocused(true)}
                onBlur={() => setTextareaFocused(false)}
                placeholder="Type your explanation here... The AI tutor will grade your mathematical reasoning."
                style={{
                  width: '100%',
                  minHeight: '220px',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: textareaFocused ? `2px solid ${subjectColor}` : '1px solid var(--border-color)',
                  borderRadius: '12px',
                  padding: '14px',
                  fontSize: '16px',
                  fontFamily: 'inherit',
                  outline: 'none',
                  resize: 'vertical',
                  transition: 'border-color 0.2s ease',
                  boxShadow: textareaFocused ? `0 0 12px ${subjectColor}15` : 'none'
                }}
              />
            ) : (
              <textarea
                id="guided-answer-input"
                value={answer}
                maxLength={1000}
                onChange={e => {
                  onSetAnswer(e.target.value.slice(0, 1000));
                  if (roomyAnswer) growToFit(e.currentTarget);
                }}
                onFocus={() => setTextareaFocused(true)}
                onBlur={() => setTextareaFocused(false)}
                onKeyDown={handleKeyDown}
                placeholder="Type your final answer..."
                rows={roomyAnswer ? 5 : 3}
                style={{
                  width: '100%',
                  minHeight: roomyAnswer ? '140px' : '96px',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: textareaFocused ? `2px solid ${subjectColor}` : '1px solid var(--border-color)',
                  borderRadius: '12px',
                  padding: '14px',
                  fontSize: '16px',
                  fontFamily: 'inherit',
                  outline: 'none',
                  resize: 'vertical',
                  lineHeight: 1.45,
                  transition: 'border-color 0.2s ease',
                  boxShadow: textareaFocused ? `0 0 12px ${subjectColor}15` : 'none'
                }}
              />
            )}
          </div>
        )}
        {showMathToolbar && !isMcq && (
          <MathSymbolKeyboard
            textareaId={isMultiPart ? 'multipart-answer-input' : 'guided-answer-input'}
            onInsert={onSetAnswer}
            disabled={submitting}
          />
        )}
      </div>

      {beforeActions}

      {/* Submit Action Bar */}
      <div style={{ display: 'flex', justifyContent: onSkip || onDontKnow || onNeedHelp ? 'space-between' : 'flex-end', alignItems: 'center', gap: '12px', marginTop: '4px', flexWrap: 'wrap' }}>
        {(onDontKnow || onNeedHelp) && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {onDontKnow && (
              <button
                type="button"
                onClick={onDontKnow}
                disabled={submitting}
                className="btn-secondary"
                style={{ padding: '10px 14px', fontWeight: '600' }}
              >
                I don’t know
              </button>
            )}
            {onNeedHelp && (
              <button
                type="button"
                onClick={onNeedHelp}
                disabled={submitting}
                className="btn-secondary"
                style={{ padding: '10px 14px', fontWeight: '600' }}
              >
                Need help?
              </button>
            )}
          </div>
        )}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            disabled={submitting}
            style={{
              background: 'transparent',
              color: 'var(--text-muted)',
              padding: '10px 14px',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              fontWeight: '600',
              cursor: submitting ? 'default' : 'pointer',
            }}
          >
            Skip question
          </button>
        )}
        <button
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
          style={{
            background: subjectColor,
            color: 'white',
            padding: '12px 24px',
            borderRadius: '10px',
            fontWeight: '700',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'opacity 0.2s ease'
          }}
        >
          {submitting ? 'Checking answer...' : 'Submit Answer'}
        </button>
      </div>
    </div>
  );
}
