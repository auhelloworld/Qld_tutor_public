'use client';

import React, { useState } from 'react';
import MathMarkdown from '../MathMarkdown';
import QuestionContext from '../QuestionContext';
import MathSymbolKeyboard from '../MathSymbolKeyboard';
import { formatTime } from '../../lib/format';
import { isMathSubject } from '../../lib/subject_registry';
import type { ExamQuestion, Subject } from '../../lib/api-types';

interface ExamInProgressProps {
  subject: Subject;
  questions: ExamQuestion[];
  responses: Record<string, string>;
  setResponses: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  currentIdx: number;
  setCurrentIdx: (idx: number) => void;
  timeLeft: number;
  answeredCount: number;
  multiPartAnswers: Record<string, Record<string, string>>;
  setMultiPartAnswers: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>;
  handleSubmit: () => void;
  loading: boolean;
  submitError?: string | null;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'offline' | 'retry_queued' | 'conflict';
  saveError?: string | null;
  onRetryAutosave?: () => void;
}

export default function ExamInProgress({
  subject,
  questions,
  responses,
  setResponses,
  currentIdx,
  setCurrentIdx,
  timeLeft,
  answeredCount,
  multiPartAnswers,
  setMultiPartAnswers,
  handleSubmit,
  loading,
  submitError,
  saveStatus = 'idle',
  saveError,
  onRetryAutosave,
  flagged,
  setFlagged,
}: ExamInProgressProps & { flagged: Set<string>; setFlagged: React.Dispatch<React.SetStateAction<Set<string>>> }) {
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const currentQ = questions[currentIdx];
  if (!currentQ) return null;

  const showMathKeyboard = isMathSubject(subject);
  const isLowTime = timeLeft < 120;
  const announceTime = [600, 300, 120, 60, 30, 10].includes(timeLeft);
  // "Saved" only after the server confirms a save.
  const autosaveLabel = saveStatus === 'saving'
    ? 'Saving…'
    : saveStatus === 'offline'
      ? 'Offline — will retry'
      : saveStatus === 'retry_queued'
        ? 'Retry queued'
        : saveStatus === 'conflict'
          ? 'Not saved'
          : saveStatus === 'saved'
            ? 'Saved'
            : 'Autosave on';
  const autosaveColor = saveStatus === 'offline' || saveStatus === 'conflict'
    ? '#dc2626'
    : saveStatus === 'retry_queued'
      ? '#d97706'
      : saveStatus === 'saving'
        ? '#2563eb'
        : saveStatus === 'saved'
          ? '#16a34a'
          : 'var(--text-secondary)';

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
      {/* Timer bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          padding: '12px 16px',
          background: isLowTime ? 'rgba(239,68,68,0.1)' : 'rgba(59,130,246,0.1)',
          borderRadius: '8px',
          border: `1px solid ${isLowTime ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.3)'}`,
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: '600' }}>
          Question {currentIdx + 1} of {questions.length}
        </span>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          {answeredCount}/{questions.length} answered
        </span>
        <span
          role="status"
          aria-live="polite"
          title={saveError || undefined}
          style={{
            fontSize: '12px',
            color: autosaveColor,
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {autosaveLabel}
        </span>
        <span
          role="timer"
          aria-label={`Time remaining: ${formatTime(timeLeft)}`}
          style={{
            fontSize: '16px',
            fontWeight: '700',
            fontFamily: 'monospace',
            color: isLowTime ? '#dc2626' : 'var(--text-primary)',
          }}
        >
          ⏱ {formatTime(timeLeft)}
        </span>
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {announceTime ? `Time remaining: ${formatTime(timeLeft)}` : ''}
        </span>
      </div>

      {saveError && saveStatus !== 'saved' && (
        <div
          role="status"
          style={{
            marginBottom: '16px',
            padding: '9px 12px',
            borderRadius: '8px',
            border: `1px solid ${saveStatus === 'offline' || saveStatus === 'conflict' ? 'rgba(220,38,38,0.35)' : 'rgba(217,119,6,0.35)'}`,
            background: saveStatus === 'offline' || saveStatus === 'conflict' ? 'rgba(220,38,38,0.08)' : 'rgba(217,119,6,0.08)',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{saveError}</span>
          {onRetryAutosave && (saveStatus === 'retry_queued' || saveStatus === 'offline') && (
            <button
              type="button"
              onClick={onRetryAutosave}
              style={{
                marginLeft: '12px',
                padding: '3px 10px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '4px',
                border: '1px solid currentColor',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Retry Save
            </button>
          )}
          {saveStatus === 'conflict' && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                marginLeft: '12px',
                padding: '3px 10px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '4px',
                border: '1px solid currentColor',
                background: 'transparent',
                color: 'inherit',
                boxShadow: 'none',
                transform: 'none',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Reload
            </button>
          )}
        </div>
      )}

      {submitError && (
        <div
          role="alert"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '16px',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid rgba(220, 38, 38, 0.4)',
            background: 'rgba(220, 38, 38, 0.1)',
            color: 'var(--text-primary)',
          }}
        >
          <span>{submitError}</span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            style={{
              flexShrink: 0,
              padding: '8px 12px',
              border: 'none',
              borderRadius: '6px',
              background: '#dc2626',
              color: '#fff',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            Retry submit
          </button>
        </div>
      )}

      {/* Question */}
      <div className="glass-panel" style={{ padding: '24px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '10px',
              background: 'rgba(59,130,246,0.15)',
              color: '#60a5fa',
              fontWeight: '600',
            }}
          >
            {currentQ.difficulty === 'foundational' ? 'Foundational' : currentQ.difficulty === 'developing' ? 'Developing' : 'Extension'}
          </span>
          {currentQ.question_type !== 'short_answer' && (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '10px',
                background: 'rgba(168,85,247,0.15)',
                color: '#c084fc',
                fontWeight: '600',
              }}
            >
              {currentQ.question_type === 'multiple_choice'
                ? 'MCQ'
                : currentQ.question_type === 'multi_part'
                ? 'Multi-Part'
                : 'Reasoning'}
            </span>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <button
              onClick={() => setFlagged(prev => {
                const next = new Set(prev);
                if (next.has(currentQ.id)) next.delete(currentQ.id);
                else next.add(currentQ.id);
                return next;
              })}
              aria-label={flagged.has(currentQ.id) ? 'Unflag this question' : 'Flag this question for review'}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: '16px', padding: '4px 8px', borderRadius: '6px',
                color: flagged.has(currentQ.id) ? '#f59e0b' : 'var(--text-secondary)',
              }}
            >
              {flagged.has(currentQ.id) ? '⚑' : '⚐'}
            </button>
          </div>
        </div>
        <div style={{ marginBottom: '16px' }}>
          <QuestionContext question={currentQ} />
        </div>

        {/* Answer input */}
        {currentQ.question_type === 'multiple_choice' && currentQ.choices ? (
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend className="sr-only">Select your answer from the choices below</legend>
            {currentQ.choices.map((choice, i) => (
              <label
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  marginBottom: '6px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: '1px solid var(--border-color)',
                  background:
                    responses[currentQ.id] === choice ? 'rgba(59,130,246,0.1)' : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name={`exam-${currentQ.id}`}
                  value={choice}
                  checked={responses[currentQ.id] === choice}
                  onChange={e =>
                    setResponses(prev => ({ ...prev, [currentQ.id]: e.target.value }))
                  }
                />
                <span style={{ fontSize: '14px' }}>
                  <MathMarkdown inline>
                    {choice}
                  </MathMarkdown>
                </span>
              </label>
            ))}
          </fieldset>
        ) : currentQ.question_type === 'multi_part' && currentQ.sub_parts ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {currentQ.sub_parts.map(part => {
              const partLabel = String(part.label || '').toLowerCase().trim();
              const partAnswers = multiPartAnswers[currentQ.id] || {};
              return (
                <div
                  key={partLabel}
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
                >
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: '600',
                      marginBottom: '4px',
                      color: 'var(--accent-color)',
                    }}
                  >
                    Part ({part.label}) — {part.marks || 1} mark{part.marks > 1 ? 's' : ''}
                  </div>
                  <div style={{ fontSize: '14px', marginBottom: '8px' }}>
                    <MathMarkdown>
                      {part.question}
                    </MathMarkdown>
                  </div>
                  {part.choices ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                      {part.choices.map((choice, cIdx) => {
                        const isSelected = partAnswers[partLabel] === choice;
                        return (
                          <label
                            key={cIdx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '8px 12px',
                              borderRadius: '6px',
                              border: '1px solid var(--border-color)',
                              background: isSelected ? 'rgba(59,130,246,0.1)' : 'transparent',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                            }}
                          >
                            <input
                              type="radio"
                              name={`exam-choice-${currentQ.id}-${partLabel}`}
                              value={choice}
                              checked={isSelected}
                              onChange={() => {
                                setMultiPartAnswers(prev => ({
                                  ...prev,
                                  [currentQ.id]: { ...(prev[currentQ.id] || {}), [partLabel]: choice }
                                }));
                              }}
                              style={{ accentColor: 'var(--accent-color)' }}
                            />
                            <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                              <MathMarkdown inline>{choice}</MathMarkdown>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <textarea
                      value={partAnswers[partLabel] || ''}
                      onChange={e => {
                        const value = e.target.value;
                        setMultiPartAnswers(prev => ({
                          ...prev,
                          [currentQ.id]: { ...(prev[currentQ.id] || {}), [partLabel]: value },
                        }));
                      }}
                      placeholder={`Answer for (${part.label})`}
                      aria-label={`Answer for Part (${part.label})`}
                      rows={5}
                      style={{
                        width: '100%',
                        minHeight: '140px',
                        padding: '12px 14px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        fontSize: '15px',
                        fontFamily: 'inherit',
                        lineHeight: 1.5,
                        resize: 'vertical',
                        display: 'block',
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <>
            {showMathKeyboard && (
              <MathSymbolKeyboard
                textareaId="exam-answer-textarea"
                onInsert={val => setResponses(prev => ({ ...prev, [currentQ.id]: val }))}
              />
            )}
            <textarea
              id="exam-answer-textarea"
              value={responses[currentQ.id] || ''}
              onChange={e => setResponses(prev => ({ ...prev, [currentQ.id]: e.target.value }))}
              placeholder={
                currentQ.question_type === 'reasoning'
                  ? 'Explain your reasoning clearly...'
                  : 'Type your answer...'
              }
              style={{
                width: '100%',
                minHeight: currentQ.question_type === 'reasoning' ? '150px' : '80px',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                resize: 'vertical',
                fontSize: '14px',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
              }}
            />
          </>
        )}
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
          disabled={currentIdx === 0}
          style={{
            padding: '8px 16px',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            cursor: currentIdx === 0 ? 'not-allowed' : 'pointer',
            background: 'transparent',
            color: 'var(--text-primary)',
          }}
        >
          ← Previous
        </button>

        {/* Question dots */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '300px', justifyContent: 'center' }}>
          {questions.map((q, i) => {
            const isAnswered = !!(responses[q.id]?.trim() || (multiPartAnswers[q.id] && Object.values(multiPartAnswers[q.id]).some(v => v?.trim())));
            return (
              <button
                key={i}
                onClick={() => setCurrentIdx(i)}
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '10px',
                  fontWeight: '700',
                  background:
                    i === currentIdx
                      ? 'var(--accent-color)'
                      : isAnswered
                      ? '#16a34a'
                      : 'var(--bg-secondary)',
                  color: i === currentIdx || isAnswered ? '#fff' : 'var(--text-secondary)',
                  position: 'relative' as const,
                }}
              >
                {i + 1}
                {flagged.has(q.id) && (
                  <span style={{ position: 'absolute', top: '-4px', right: '-4px', fontSize: '10px', color: '#f59e0b' }}>
                    ⚑
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {currentIdx < questions.length - 1 ? (
          <button
            onClick={() => setCurrentIdx(currentIdx + 1)}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              background: 'transparent',
              color: 'var(--text-primary)',
            }}
          >
            Next →
          </button>
        ) : showSubmitConfirm ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => setShowSubmitConfirm(false)}
              style={{
                padding: '8px 16px', borderRadius: '6px',
                border: '1px solid var(--border-color)', cursor: 'pointer',
                background: 'transparent', color: 'var(--text-primary)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => { setShowSubmitConfirm(false); handleSubmit(); }}
              disabled={loading}
              style={{
                padding: '8px 16px', borderRadius: '6px',
                background: '#16a34a', color: '#fff', fontWeight: '700',
                border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Submitting...' : `Submit (${answeredCount}/${questions.length} answered)`}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowSubmitConfirm(true)}
            style={{
              padding: '8px 16px', borderRadius: '6px',
              background: '#16a34a', color: '#fff', fontWeight: '700',
              border: 'none', cursor: 'pointer',
            }}
          >
            Submit Exam
          </button>
        )}
      </div>
    </div>
  );
}
