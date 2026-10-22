'use client';

import { useState } from 'react';
import { Send, RefreshCw, Mic, SkipForward, BookOpenCheck } from 'lucide-react';
import Link from 'next/link';

interface TutorControlsProps {
  loading: boolean;
  answer: string;
  lastAnswerCorrect: boolean;
  lastAnswerIncorrect: boolean;
  lastAnswerPendingReview?: boolean;
  isListening: boolean;
  remediationRequired: boolean;
  nextStep: string | null;
  howToFixHints: { text: string; hint: string }[];
  showHowToFix: boolean;
  workedExample: { worked_example?: unknown } | null;
  topic: string;
  errorBookHref?: string;
  onSubmit: () => void;
  onNext: () => void;
  onToggleDictation: () => void;
  onRetry: () => void;
  onShowNextStepHint: () => void;
  onShowWorkedExample: () => void;
  onShowHowToFix: () => void;
  onExplainConcept?: () => void;
  /** When set, Next is disabled and this reason is shown beside it. */
  nextBlockedReason?: string;
}

export default function TutorControls({
  loading,
  answer,
  lastAnswerCorrect,
  lastAnswerIncorrect,
  lastAnswerPendingReview = false,
  isListening,
  remediationRequired,
  nextStep,
  howToFixHints,
  showHowToFix,
  workedExample,
  topic,
  errorBookHref = '/mistakes',
  onSubmit,
  onNext,
  onToggleDictation,
  onRetry,
  onShowNextStepHint,
  onShowWorkedExample,
  onShowHowToFix,
  onExplainConcept,
  nextBlockedReason,
}: TutorControlsProps) {
  const [showMoreHelp, setShowMoreHelp] = useState(false);
  const hasSecondaryHelp = Boolean(nextStep) || (howToFixHints.length > 0 && !showHowToFix) || Boolean(workedExample?.worked_example);
  const handleRetry = () => {
    setShowMoreHelp(false);
    onRetry();
  };
  return (
    <>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button 
          onClick={onSubmit} 
          disabled={loading || !answer.trim() || lastAnswerCorrect || lastAnswerIncorrect || lastAnswerPendingReview || remediationRequired}
          aria-busy={loading}
          style={{ flex: 1, display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', padding: '14px', fontSize: '16px', minHeight: '44px' }}
        >
          <Send size={18} aria-hidden="true" /> Submit Answer
        </button>
        <button 
          onClick={onToggleDictation}
          aria-label={isListening ? "Stop listening" : "Speak answer"}
          style={{ background: isListening ? '#ef4444' : 'var(--bg-secondary)', color: isListening ? 'white' : 'var(--text-primary)', border: '1px solid var(--border-color)', width: '52px', minHeight: '44px', display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '8px', transition: 'all 0.2s' }}
        >
          <Mic size={18} aria-hidden="true" className={isListening ? 'animate-pulse' : ''} />
        </button>
      </div>
      {/* Post-incorrect actions */}
      {lastAnswerIncorrect && !lastAnswerCorrect && (
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Primary action: try again. Secondary help is tucked away to keep one
              clear next step and avoid choice overload after a wrong answer. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button
              onClick={handleRetry}
              style={{
                flex: 1, display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center',
                padding: '12px', fontSize: '14px', fontWeight: '600',
                background: 'rgba(251,191,36,0.15)',
                border: '1px solid rgba(251,191,36,0.3)',
                color: '#d97706', borderRadius: '8px', cursor: 'pointer',
                minHeight: '44px', minWidth: '140px',
              }}
            >
              🔄 Try Again
            </button>
            {hasSecondaryHelp && (
              <button
                onClick={() => setShowMoreHelp(v => !v)}
                aria-expanded={showMoreHelp}
                style={{
                  display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'center',
                  padding: '12px', fontSize: '14px', fontWeight: '600',
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)', borderRadius: '8px', cursor: 'pointer',
                  minHeight: '44px', minWidth: '120px',
                }}
              >
                {showMoreHelp ? 'Hide help' : '＋ More help'}
              </button>
            )}
          </div>
          {showMoreHelp && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {nextStep && (
                <button
                  onClick={onShowNextStepHint}
                  style={{
                    flex: 1, display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center',
                    padding: '12px', fontSize: '14px', fontWeight: '600',
                    background: 'rgba(59,130,246,0.15)',
                    border: '1px solid rgba(59,130,246,0.3)',
                    color: '#3b82f6', borderRadius: '8px', cursor: 'pointer',
                    minHeight: '44px', minWidth: '160px',
                  }}
                >
                  💡 Reveal next nudge
                </button>
              )}
              {howToFixHints.length > 0 && !showHowToFix && (
                <button
                  onClick={onShowHowToFix}
                  style={{
                    flex: 1, display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center',
                    padding: '12px', fontSize: '14px', fontWeight: '600',
                    background: 'rgba(168,85,247,0.15)',
                    border: '1px solid rgba(168,85,247,0.3)',
                    color: '#c084fc', borderRadius: '8px', cursor: 'pointer',
                    minHeight: '44px', minWidth: '160px',
                  }}
                >
                  🔍 Why did I miss those points?
                </button>
              )}
              <button
                onClick={onShowWorkedExample}
                disabled={!workedExample?.worked_example}
                style={{
                  display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'center',
                  padding: '10px 12px', fontSize: '13px', fontWeight: '600',
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)', borderRadius: '8px', cursor: 'pointer',
                  minHeight: '40px', minWidth: '140px',
                  opacity: workedExample?.worked_example ? 0.85 : 0.45,
                }}
              >
                📖 Show Worked Example
              </button>
            </div>
          )}
        </div>
      )}
      {/* Reveal how_to_fix suggestions when student asks */}
      {showHowToFix && howToFixHints.length > 0 && (
        <div className="animate-fade-in" style={{
          padding: '14px', borderRadius: '8px',
          background: 'rgba(168,85,247,0.08)',
          border: '1px solid rgba(168,85,247,0.25)',
        }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#c084fc', marginBottom: '8px' }}>
            💡 Suggestions for improvement:
          </div>
          {howToFixHints.map((h, i) => (
            <div key={i} style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', lineHeight: '1.5' }}>
              <strong style={{ color: '#c084fc' }}>{h.text}:</strong> {h.hint}
            </div>
          ))}
        </div>
      )}
      {/* Post-correct CTA — prominent "Continue" prompt */}
      {lastAnswerCorrect && (
        <div className="animate-fade-in" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', width: '100%' }}>
          <button
            onClick={onNext}
            disabled={loading || Boolean(nextBlockedReason)}
            aria-describedby={nextBlockedReason ? 'next-blocked-reason' : undefined}
            style={{
              flex: 1, display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center',
              padding: '14px', fontSize: '15px', fontWeight: '700',
              background: 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(16,185,129,0.15))',
              border: '1px solid rgba(34,197,94,0.4)',
              color: '#16a34a', borderRadius: '10px', cursor: nextBlockedReason ? 'not-allowed' : 'pointer', minHeight: '44px',
              boxShadow: '0 0 16px rgba(34,197,94,0.15)',
              opacity: nextBlockedReason ? 0.55 : 1,
            }}
          >
            ✅ Next Question →
          </button>
          {onExplainConcept && (
            <button
              type="button"
              onClick={onExplainConcept}
              disabled={loading}
              style={{
                flex: 1, display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center',
                padding: '14px', fontSize: '14px', fontWeight: '600',
                background: 'rgba(99,102,241,0.15)',
                border: '1px solid rgba(99,102,241,0.3)',
                color: 'var(--accent-color)', borderRadius: '10px', cursor: 'pointer', minHeight: '44px',
              }}
            >
              📖 View Explanation
            </button>
          )}
          {nextBlockedReason && (
            <div id="next-blocked-reason" role="status" style={{ flexBasis: '100%', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {nextBlockedReason}
            </div>
          )}
        </div>
      )}
      {/* Post-pending-review CTA */}
      {lastAnswerPendingReview && (
        <div className="animate-fade-in" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', width: '100%' }}>
          <button
            onClick={onNext}
            disabled={loading}
            style={{
              flex: 1, display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center',
              padding: '14px', fontSize: '15px', fontWeight: '700',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(79, 70, 229, 0.15))',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              color: '#4f46e5', borderRadius: '10px', cursor: 'pointer', minHeight: '44px',
              boxShadow: '0 0 16px rgba(99, 102, 241, 0.15)',
            }}
          >
            👁️ Next Question →
          </button>
        </div>
      )}
      {!lastAnswerIncorrect && !lastAnswerCorrect && !lastAnswerPendingReview && (
        <button
          onClick={onNext}
          disabled={loading}
          aria-busy={loading}
          style={{
            display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center',
            padding: '14px', fontSize: '16px', fontWeight: '600', background: 'transparent',
            border: '1px solid var(--border-color)', color: 'var(--text-primary)', minHeight: '44px',
          }}
        >
          <RefreshCw size={18} aria-hidden="true" /> Next Question
        </button>
      )}
      {lastAnswerIncorrect && (
        <div
          aria-label="Other options after an incorrect answer"
          style={{
            display: 'flex', flexDirection: 'column', gap: '8px',
            marginTop: '4px', padding: '10px', borderRadius: '12px',
            background: 'rgba(99, 102, 241, 0.05)',
            border: '1px solid rgba(99, 102, 241, 0.16)',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Other ways to continue
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={onNext}
              disabled={loading}
              style={{
                flex: 1, display: 'flex', gap: '7px', alignItems: 'center', justifyContent: 'center',
                padding: '11px 14px', fontSize: '14px', fontWeight: 650,
                background: 'rgba(245, 158, 11, 0.10)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                color: '#b45309', borderRadius: '9px', cursor: loading ? 'default' : 'pointer',
                minHeight: '44px', minWidth: '180px', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
              }}
            >
              <SkipForward size={17} aria-hidden="true" /> Skip this question
            </button>
            <Link href={errorBookHref} style={{
              flex: 1, display: 'flex', gap: '7px', alignItems: 'center', justifyContent: 'center',
              padding: '11px 14px', fontSize: '14px', fontWeight: 650,
              background: 'rgba(99, 102, 241, 0.10)',
              border: '1px solid rgba(99, 102, 241, 0.32)',
              color: 'var(--accent-color)', borderRadius: '9px',
              textDecoration: 'none', minHeight: '44px', minWidth: '210px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
            }}>
              <BookOpenCheck size={17} aria-hidden="true" /> Review later in Error Book
            </Link>
          </div>
        </div>
      )}
      {!lastAnswerIncorrect && (
        <Link href={`/challenge?topic=${encodeURIComponent(topic)}`}
          style={{
            display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'center',
            padding: '10px 14px', fontSize: '14px', fontWeight: '600',
            background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)',
            color: '#f59e0b', borderRadius: '8px', cursor: 'pointer',
            textDecoration: 'none', whiteSpace: 'nowrap',
          }}
        >
          ⚡ Speed Round
        </Link>
      )}
    </>
  );
}
