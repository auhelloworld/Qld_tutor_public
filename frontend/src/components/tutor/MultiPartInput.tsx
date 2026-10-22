'use client';

import { useEffect, useRef, useState } from 'react';
import MathMarkdown from '../MathMarkdown';
import { CheckCircle, XCircle } from 'lucide-react';
import type { SubPart, SubPartResult } from '../../lib/api-types';

/** Why the answer input is read-only. The parent unlocks it (Try Again, another part). */
export type AnswerLockReason = 'correct' | 'incorrect' | 'pending' | 'remediation';

interface MultiPartInputProps {
  subParts: SubPart[];
  multiPartResults: SubPartResult[];
  activeMultipartLabel: string | null;
  answer: string;
  lockReason?: AnswerLockReason | null;
  onSetActivePart: (label: string | null) => void;
  onSetAnswer: (val: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
}

export default function MultiPartInput({
  subParts, multiPartResults, activeMultipartLabel, answer, lockReason = null,
  onSetActivePart, onSetAnswer, onKeyDown,
}: MultiPartInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Unsent text of the parts that are not active. Switching parts never loses text.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const nextUnanswered = subParts?.find((p: SubPart) => {
    const partLabel = String(p.label || "").toLowerCase().trim();
    const r = multiPartResults.find((res: SubPartResult) => String(res.label || "").toLowerCase().trim() === partLabel);
    return !r || !r.student_answer;
  }) || subParts?.find((p: SubPart) => {
    const partLabel = String(p.label || "").toLowerCase().trim();
    const r = multiPartResults.find((res: SubPartResult) => String(res.label || "").toLowerCase().trim() === partLabel);
    return r?.is_correct === false && !!r.student_answer;
  });

  let activePart = nextUnanswered;
  if (activeMultipartLabel) {
    const selected = subParts?.find((p: SubPart) => String(p.label || "").toLowerCase().trim() === activeMultipartLabel);
    if (selected) {
      const r = multiPartResults.find((res: SubPartResult) => String(res.label || "").toLowerCase().trim() === activeMultipartLabel);
      if (!r?.is_correct) {
        activePart = selected;
      }
    }
  }
  const activePartLabel = activePart ? String(activePart.label).toLowerCase().trim() : null;
  const locked = lockReason !== null;
  const hasOtherOpenPart = subParts?.some((p: SubPart) => {
    const partLabel = String(p.label || "").toLowerCase().trim();
    const r = multiPartResults.find((res: SubPartResult) => String(res.label || "").toLowerCase().trim() === partLabel);
    return partLabel !== activePartLabel && !r?.is_correct;
  });
  const partName = activePart ? `Part (${activePart.label})` : 'This part';
  const lockMessage = lockReason === 'remediation'
    ? 'Review the concept, then choose Try Again to unlock.'
    : lockReason === 'incorrect'
      ? `Choose Try Again to answer ${partName} again${hasOtherOpenPart ? ', or choose another part' : ''}.`
      : lockReason === 'pending'
        ? `${partName} is saved for review.${hasOtherOpenPart ? ' Choose another part to continue.' : ''}`
        : lockReason === 'correct'
          ? `${partName} is marked.`
          : null;

  const selectPart = (label: string) => {
    if (label === activePartLabel) return;
    const nextDrafts = { ...drafts };
    if (activePartLabel) {
      if (answer.trim()) nextDrafts[activePartLabel] = answer;
      else delete nextDrafts[activePartLabel];
    }
    const restored = nextDrafts[label] ?? '';
    delete nextDrafts[label];
    setDrafts(nextDrafts);
    onSetActivePart(label);
    onSetAnswer(restored);
  };

  // The parent can move to the next part (after a correct part). Bring back
  // the draft of that part, if there is one.
  const shownPartRef = useRef(activePartLabel);
  useEffect(() => {
    if (shownPartRef.current === activePartLabel) return;
    shownPartRef.current = activePartLabel;
    if (!activePartLabel || drafts[activePartLabel] === undefined || answer) return;
    const restored = drafts[activePartLabel];
    setDrafts(prev => {
      const next = { ...prev };
      delete next[activePartLabel];
      return next;
    });
    onSetAnswer(restored);
  }, [activePartLabel, answer, drafts, onSetAnswer]);

  // Auto-focus input when active part changes
  useEffect(() => {
    if (activePartLabel && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activePartLabel]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {subParts?.map((part: SubPart, idx: number) => {
          const partLabel = String(part.label || "").toLowerCase().trim();
          const result = multiPartResults.find((r: SubPartResult) => String(r.label || "").toLowerCase().trim() === partLabel);
          const isPartCorrect = result?.is_correct ?? false;
          const studentAns = result?.student_answer ?? "";
          const isSelected = activePartLabel === partLabel;
          const isClickable = !isPartCorrect;
          const hasDraft = !isSelected && Boolean(drafts[partLabel]);

          return (
            <div
              key={idx}
              role={isClickable ? 'button' : undefined}
              tabIndex={isClickable ? 0 : undefined}
              aria-pressed={isClickable ? isSelected : undefined}
              onClick={isClickable ? () => selectPart(partLabel) : undefined}
              onKeyDown={isClickable ? (e) => {
                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                selectPart(partLabel);
              } : undefined}
              style={{
                padding: '12px 16px', borderRadius: '8px',
                border: isSelected ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                background: isSelected ? 'rgba(var(--accent-color-rgb, 124, 58, 237), 0.04)'
                  : isPartCorrect ? 'rgba(34, 197, 94, 0.05)'
                  : (result && studentAns) ? 'rgba(239, 68, 68, 0.05)'
                  : 'rgba(255, 255, 255, 0.02)',
                borderColor: isSelected ? 'var(--accent-color)'
                  : isPartCorrect ? 'rgba(34, 197, 94, 0.3)'
                  : (result && studentAns) ? 'rgba(239, 68, 68, 0.3)'
                  : 'var(--border-color)',
                cursor: isClickable ? 'pointer' : 'default',
                transition: 'all 0.2s ease',
                boxShadow: isSelected ? '0 0 12px rgba(var(--accent-color-rgb, 124, 58, 237), 0.15)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                    Part ({part.label}) — {part.marks || 1} mark{part.marks > 1 ? 's' : ''}
                  </span>
                  {isSelected && (
                    <span style={{ fontSize: '13px', background: 'var(--accent-color)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                      Active Input
                    </span>
                  )}
                </div>
                <span>
                  {isPartCorrect ? (
                    <span style={{ color: '#16a34a', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <CheckCircle size={16} /> Correct
                    </span>
                  ) : (result && studentAns) ? (
                    <span style={{ color: '#ef4444', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <XCircle size={16} /> Incorrect
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Unanswered</span>
                  )}
                </span>
              </div>
              <div style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                <MathMarkdown>
                  {part.question}
                </MathMarkdown>
              </div>
              {studentAns && (
                <div style={{ fontSize: '14px', color: 'var(--text-primary)', background: 'rgba(0,0,0,0.1)', padding: '6px 10px', borderRadius: '4px', display: 'inline-block' }}>
                  <strong>Your answer:</strong>{' '}
                  <MathMarkdown inline>{studentAns}</MathMarkdown>
                </div>
              )}
              {hasDraft && (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  📝 Draft kept: <MathMarkdown inline>{drafts[partLabel]}</MathMarkdown>
                </div>
              )}
              {isClickable && !isSelected && (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic' }}>
                  💡 Click to answer this part
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!activePart ? (
        <div style={{ textAlign: 'center', padding: '16px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '8px', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
          <span style={{ color: '#16a34a', fontWeight: '700', fontSize: '16px' }}>
            🎉 Excellent! You have answered all parts of this question correctly.
          </span>
        </div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border-color)', padding: '16px', borderRadius: '8px' }}>
          <label htmlFor="multipart-answer-input" style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: 'var(--accent-color)', marginBottom: '8px' }}>
            {activePart.choices ? `Select answer for Part (${activePart.label}):` : `✍️ Enter answer for Part (${activePart.label}):`}
          </label>
          {lockMessage && (
            <p id="multipart-lock-message" style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              🔒 {lockMessage}
            </p>
          )}
          {activePart.choices ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {activePart.choices.map((choice: string, cIdx: number) => {
                const isSelected = answer === choice || 
                  (String(activePart.answer || "").trim().length === 1 && 
                   answer.toUpperCase() === String.fromCharCode(65 + cIdx));
                return (
                  <label
                    key={cIdx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: isSelected ? 'rgba(var(--accent-color-rgb, 124, 58, 237), 0.1)' : 'var(--bg-secondary)',
                      cursor: locked ? 'not-allowed' : 'pointer',
                      opacity: locked ? 0.6 : 1,
                      transition: 'all 0.2s',
                    }}
                  >
                    <input
                      type="radio"
                      name={`multipart-choice-${activePartLabel}`}
                      value={choice}
                      checked={isSelected}
                      disabled={locked}
                      aria-describedby={lockMessage ? 'multipart-lock-message' : undefined}
                      onChange={() => {
                        const correctAns = String(activePart.answer || "").trim().toUpperCase();
                        const isLetterAnswer = /^[A-G]$/.test(correctAns);
                        if (isLetterAnswer) {
                          onSetAnswer(String.fromCharCode(65 + cIdx));
                        } else {
                          onSetAnswer(choice);
                        }
                      }}
                      style={{ accentColor: 'var(--accent-color)' }}
                    />
                    <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                      <MathMarkdown inline>{choice}</MathMarkdown>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <textarea
              ref={inputRef}
              id="multipart-answer-input"
              className="auto-growing-textarea"
              value={answer}
              maxLength={900}
              disabled={locked}
              aria-describedby={lockMessage ? 'multipart-lock-message' : undefined}
              onChange={e => onSetAnswer(e.target.value.slice(0, 900))}
              onKeyDown={onKeyDown}
              placeholder={locked ? '' : `Type your answer for part (${activePart.label}) here...`}
              rows={3}
              style={{
                width: '100%',
                minHeight: '88px',
                maxHeight: 'min(45dvh, 320px)',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontSize: '15px',
                fontFamily: 'inherit',
                resize: 'vertical',
                lineHeight: 1.45,
                outline: 'none',
                cursor: locked ? 'not-allowed' : undefined,
                opacity: locked ? 0.6 : 1,
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
