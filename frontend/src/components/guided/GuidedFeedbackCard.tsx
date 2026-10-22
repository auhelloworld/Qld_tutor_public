'use client';

import React, { useState } from 'react';
import { Check, X, MessageCircle, RotateCcw, ArrowRight, Target, BookOpen, Wrench, Eye, Flag } from 'lucide-react';
import MathMarkdown from '../MathMarkdown';
import { tutorFlagReview } from '../../lib/api';
import { ERROR_TYPE_LABELS } from '../../lib/constants';
import { humanise } from '../../lib/format';
import type { TutorMarkResponse, Exercise } from '../../lib/api-types';

interface GuidedFeedbackCardProps {
  markResponse: TutorMarkResponse;
  exercise?: Exercise;
  studentAnswer?: string;
  onNext: () => void;
  onExplainMyAnswer: () => void;
  onTryAgain: () => void;
  onSkipQuestion?: () => void;
  onShowWorkedExample?: () => void;
  isLastQuestion: boolean;
  subjectColor: string;
  partialSuccessLabel: { label: string; tone: string };
  isMultiPart?: boolean;
  multiPartHasRemaining?: boolean;
  onContinuePart?: () => void;
  requiresCorrection?: boolean;
  independentPhase?: boolean;
  /** False hides every "try again" action (final check, or after the answer is shown). */
  allowRetry?: boolean;
  /** Replaces the default Next / Finish Session label. */
  nextLabel?: string;
  /** Replaces the default text of the "correct it once" note. */
  correctionNote?: string;
  /** True keeps Next disabled (for example while a short explanation is due). */
  nextDisabled?: boolean;
  /** Extra content above the action buttons (for example the right answer). */
  children?: React.ReactNode;
}

export default function GuidedFeedbackCard({
  markResponse,
  exercise,
  studentAnswer,
  onNext,
  onExplainMyAnswer,
  onTryAgain,
  onSkipQuestion,
  onShowWorkedExample,
  isLastQuestion,
  subjectColor,
  partialSuccessLabel,
  isMultiPart = false,
  multiPartHasRemaining = false,
  onContinuePart,
  requiresCorrection = false,
  independentPhase = false,
  allowRetry = true,
  nextLabel,
  correctionNote,
  nextDisabled = false,
  children,
}: GuidedFeedbackCardProps) {
  const [showReasoningRubric, setShowReasoningRubric] = useState(true);
  const [reviewState, setReviewState] = useState<'idle' | 'sending' | 'sent'>('idle');

  const isCorrect = markResponse.is_correct;
  // A pending or retryable response is neutral: the marker did not produce a
  // trustworthy verdict, so never present it as an incorrect answer or open
  // misconception/remediation actions.
  const isPendingReview = markResponse.outcome === 'pending'
    || markResponse.error_type === 'parent_review_pending'
    || markResponse.retryable === true;
  const hasReasoningScore = markResponse.question_type === 'reasoning'
    && typeof markResponse.score === 'number'
    && typeof markResponse.max_score === 'number';
  const hasReasoningCredit = hasReasoningScore && (markResponse.score ?? 0) > 0;
  const isReasoningPartial = isCorrect && markResponse.question_type === 'reasoning'
    && markResponse.score !== undefined && markResponse.max_score !== undefined
    && markResponse.score < markResponse.max_score;
  const isPartiallyCorrect = !isPendingReview
    && (isReasoningPartial || (!isCorrect && (!hasReasoningScore || hasReasoningCredit) && partialSuccessLabel.tone !== 'needs_work'));

  // Derive a short coaching tip from the detected error type
  const errorCoachingTips: Record<string, string> = {
    incorrect_value: 'Slow down on arithmetic — write each calculation step on paper before entering your answer.',
    concept_gap: 'Review the core rule or definition for this topic, then re-read the question to spot which rule applies.',
    unit_conversion: 'Check units carefully — convert everything to the same unit before calculating.',
    sign_error: 'Watch positive/negative signs. Re-check each step where a sign changes.',
    rounding_error: 'Check whether the question asks for exact or rounded answers, and at which step.',
    misread_question: 'Re-read the question slowly and underline what it is asking you to find.',
  };
  const coachingTip = !isCorrect && !isPendingReview && markResponse.error_type
    ? errorCoachingTips[markResponse.error_type] || 'Review the feedback above and identify the step where your working went off track.'
    : null;

  // Human-review escalation: parent_review_pending items are already queued;
  // deterministic verdicts (e.g. a numeric answer the auto-marker judged wrong)
  // can be disputed by the student so a parent can adjudicate.
  const alreadyQueued = !isCorrect && markResponse.error_type === 'parent_review_pending';
  const canRequestReview = !isCorrect && !alreadyQueued && !!markResponse.deterministic && !!exercise?.id;
  const requestReview = async () => {
    if (!exercise?.id) return;
    setReviewState('sending');
    try {
      await tutorFlagReview(exercise.id, studentAnswer || '');
      setReviewState('sent');
    } catch {
      setReviewState('idle');
    }
  };

  const getHeaderStyle = () => {
    if (isPendingReview) return { bg: 'rgba(99, 102, 241, 0.10)', color: '#4f46e5', icon: <Eye size={18} />, border: '1px solid rgba(99, 102, 241, 0.3)' };
    if (isCorrect && !isPartiallyCorrect) return { bg: 'rgba(16, 185, 129, 0.12)', color: '#16a34a', icon: <Check size={18} />, border: '1px solid rgba(16, 185, 129, 0.3)' };
    if (isPartiallyCorrect) return { bg: 'rgba(245, 158, 11, 0.12)', color: '#d97706', icon: <Target size={18} />, border: '1px solid rgba(245, 158, 11, 0.3)' };
    return { bg: 'rgba(239, 68, 68, 0.12)', color: '#dc2626', icon: <X size={18} />, border: '1px solid rgba(239, 68, 68, 0.3)' };
  };
  const header = getHeaderStyle();

  // Format the student's answer for display
  const formatStudentAnswer = () => {
    if (!studentAnswer) return null;
    if (exercise?.question_type === 'multiple_choice' && exercise?.choices) {
      const match = exercise.choices.find((c: string) => c === studentAnswer);
      return match || studentAnswer;
    }
    return studentAnswer;
  };

  return (
    <div className="glass-panel" style={{
      padding: '20px',
      borderRadius: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }}>
      {/* Feedback Header — result banner */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        background: header.bg,
        color: header.color,
        border: header.border,
        padding: '12px 16px',
        borderRadius: '12px',
        fontWeight: '700',
        fontSize: '15px'
      }}>
        {header.icon}
        {isPendingReview ? (markResponse.retryable && markResponse.error_type !== 'parent_review_pending'
          ? 'Could not confirm this answer — not marked yet'
          : 'Saved for review — not yet marked')
          : isCorrect && !isPartiallyCorrect ? 'Correct!'
            : isPartiallyCorrect ? partialSuccessLabel.label
              : 'Not quite right'}
      </div>

      {/* Reasoning rubric score line */}
      {hasReasoningScore && !isPendingReview && markResponse.score !== undefined && markResponse.max_score !== undefined && (
        <div style={{ fontSize: '15px', color: 'var(--text-secondary)', fontWeight: '600' }}>
          Rubric Points: {markResponse.score} / {markResponse.max_score}
        </div>
      )}

      {/* Question + Answer context */}
      {exercise && (
        <div style={{
          background: 'rgba(255,255,255,0.02)',
          borderRadius: '10px',
          padding: '12px 14px',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          {/* Question text (truncated) */}
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Question</div>
          <div style={{ fontSize: '16px', color: 'var(--text-primary)', lineHeight: '1.5' }}>
            <MathMarkdown>{exercise.question}</MathMarkdown>
          </div>

          {/* Student's answer */}
          {studentAnswer && (
            <div style={{ marginTop: '4px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <span style={{
                fontSize: '12px',
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: isCorrect ? '#16a34a' : isPendingReview ? '#4f46e5' : isPartiallyCorrect ? '#d97706' : '#dc2626',
                flexShrink: 0,
                marginTop: '2px'
              }}>
                Your answer:
              </span>
              <span style={{
                fontSize: '15px',
                color: 'var(--text-primary)',
                fontWeight: '600',
                lineHeight: '1.4'
              }}>
                <MathMarkdown>{formatStudentAnswer() || studentAnswer}</MathMarkdown>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Feedback explanation */}
      {markResponse.feedback && (
        <div style={{
          fontSize: '16px',
          lineHeight: '1.6',
          color: 'var(--text-secondary)',
          padding: '0 2px'
        }}>
          <MathMarkdown>{markResponse.feedback}</MathMarkdown>
        </div>
      )}

      {!isPendingReview && markResponse.next_step && (
        <div
          data-testid="guided-next-step"
          style={{
            padding: '12px 14px',
            borderRadius: '10px',
            border: `1px solid ${subjectColor}55`,
            background: `${subjectColor}12`,
            color: 'var(--text-secondary)',
            lineHeight: '1.55',
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
            Next step
          </div>
          <MathMarkdown>{markResponse.next_step}</MathMarkdown>
        </div>
      )}

      {!isPendingReview && !isCorrect && markResponse.misconception_explanation && (
        <div
          data-testid="guided-misconception-explanation"
          style={{
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            background: 'rgba(245, 158, 11, 0.08)',
            color: 'var(--text-secondary)',
            lineHeight: '1.55',
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
            Check this misconception
          </div>
          <MathMarkdown>{markResponse.misconception_explanation}</MathMarkdown>
        </div>
      )}

      {/* Human-review escalation */}
      {alreadyQueued && (
        <div style={{
          display: 'flex', gap: '8px', alignItems: 'center',
          background: 'rgba(99, 102, 241, 0.06)', border: '1px solid rgba(99, 102, 241, 0.2)',
          padding: '10px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, color: '#4f46e5',
        }}>
          <Flag size={15} /> Saved for parent review.
        </div>
      )}
      {canRequestReview && (
        reviewState === 'sent' ? (
          <div style={{
            display: 'flex', gap: '8px', alignItems: 'center',
            background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)',
            padding: '10px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, color: '#16a34a',
          }}>
            <Check size={15} /> Sent for parent review.
          </div>
        ) : (
          <button
            onClick={requestReview}
            disabled={reviewState === 'sending'}
            style={{
              display: 'flex', gap: '6px', alignItems: 'center', alignSelf: 'flex-start',
              background: 'transparent', border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)', padding: '8px 14px', borderRadius: '8px',
              fontSize: '13px', fontWeight: 600,
              cursor: reviewState === 'sending' ? 'default' : 'pointer',
              opacity: reviewState === 'sending' ? 0.6 : 1, boxShadow: 'none',
            }}
          >
            <Flag size={14} /> {reviewState === 'sending' ? 'Sending…' : 'Think this is right? Request a review'}
          </button>
        )
      )}

      {/* Partial success reasoning banner */}
      {isPartiallyCorrect && (
        <div style={{
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.2)',
          padding: '10px 14px',
          borderRadius: '10px',
          fontSize: '14px',
          fontWeight: '600',
          color: '#b45309'
        }}>
          <MessageCircle size={16} />
          Your reasoning is developing — review the feedback above to strengthen your steps.
        </div>
      )}

      {/* Incorrect: Misconception tag */}
      {!isCorrect && !isPendingReview && markResponse.error_type && (
        <div style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          fontSize: '12px',
          color: 'var(--text-muted)',
          background: 'rgba(255,255,255,0.02)',
          padding: '8px 12px',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <span style={{ fontWeight: '700' }}>Pattern detected:</span>
          <span style={{
            background: 'rgba(255,255,255,0.05)',
            padding: '2px 8px',
            borderRadius: '12px',
            fontWeight: '600'
          }}>
            {ERROR_TYPE_LABELS[markResponse.error_type] ?? humanise(markResponse.error_type)}
          </span>
        </div>
      )}

      {/* Repair this pattern — targeted mistake block */}
      {!independentPhase && !isCorrect && !isPendingReview && (markResponse.error_type || markResponse.misconception_id) && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.05)',
          border: '1px solid rgba(239, 68, 68, 0.18)',
          borderRadius: '12px',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '700', color: '#dc2626' }}>
            <Wrench size={15} /> Repair this pattern
          </div>
          {coachingTip && (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {coachingTip}
            </p>
          )}
          {markResponse.new_misconception && (
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5, fontStyle: 'italic' }}>
              Common misconception: <strong>{markResponse.new_misconception.name}</strong> — {markResponse.new_misconception.student_facing_explanation}
            </p>
          )}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={onExplainMyAnswer}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.25)',
                color: '#4f46e5',
                padding: '7px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                boxShadow: 'none',
              }}
            >
              <MessageCircle size={14} /> Explain my corrected step
            </button>
            {onShowWorkedExample && (
              <button
                onClick={onShowWorkedExample}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                  padding: '7px 12px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  boxShadow: 'none',
                }}
              >
                <Eye size={14} /> Show worked example
              </button>
            )}
          </div>
        </div>
      )}

      {/* Key points missed — shown as improvement targets */}
      {markResponse.key_points_missed && markResponse.key_points_missed.length > 0 && (
        <div style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
          Still missing: {markResponse.key_points_missed.length} rubric point{markResponse.key_points_missed.length === 1 ? '' : 's'} need more work.
        </div>
      )}

      {/* Key points breakdown for reasoning questions */}
      {!isPendingReview && markResponse.question_type === 'reasoning' && markResponse.key_points && markResponse.key_points.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button
            onClick={() => setShowReasoningRubric(prev => !prev)}
            style={{
	                  background: 'transparent',
	                  border: '1px solid var(--border-color)',
	                  color: 'var(--text-muted)',
          padding: '8px 12px',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: '600',
          cursor: 'pointer',
          boxShadow: 'none',
          alignSelf: 'flex-start'
        }}
      >
        {showReasoningRubric ? 'Hide' : 'Show'} Marking Details ({markResponse.score}/{markResponse.max_score})
          </button>
          {showReasoningRubric && (
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              padding: '12px',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              fontSize: '14px',
              color: 'var(--text-secondary)',
              lineHeight: '1.6',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              {markResponse.key_points.map((kp, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    gap: '10px',
                    alignItems: 'flex-start',
                    padding: '10px 12px',
                    borderRadius: '9px',
                    background: kp.met ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.07)',
                    border: kp.met ? '1px solid rgba(16,185,129,0.18)' : '1px solid rgba(245,158,11,0.22)',
                  }}
                >
                  <span style={{ color: kp.met ? '#16a34a' : '#d97706', fontWeight: '700', flexShrink: 0 }}>
                    {kp.met ? '✓' : '△'}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>
                        <MathMarkdown inline>{kp.text?.trim() || 'Reasoning criterion'}</MathMarkdown>
                      </strong>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: kp.met ? '#15803d' : '#b45309' }}>
                        {kp.met ? 'Achieved' : 'Needs work'}
                      </span>
                    </div>
                    {!kp.met && kp.why_missed && (
                      <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                        <strong>What was missing:</strong>{' '}
                        <MathMarkdown inline>{kp.why_missed}</MathMarkdown>
                      </div>
                    )}
                    {!kp.met && kp.how_to_fix && (
                      <div style={{ fontSize: '13px', color: '#b45309' }}>
                        <strong>Try next:</strong>{' '}
                        <MathMarkdown inline>{kp.how_to_fix}</MathMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {requiresCorrection && !isCorrect && !isPendingReview && (
        <div style={{
          padding: '10px 12px', borderRadius: '10px',
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
          color: '#b45309', fontSize: '13px', fontWeight: 600, lineHeight: 1.5,
        }}>
          <div>{correctionNote ?? 'Make one short correction attempt before moving on. This retry stays on the same question and does not increase your session question count.'}</div>
          {onSkipQuestion && (
            <button
              type="button"
              onClick={onSkipQuestion}
              style={{
                marginTop: '9px', padding: '7px 10px', borderRadius: '8px',
                border: '1px solid rgba(180,83,9,0.35)', background: 'transparent',
                color: '#b45309', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                boxShadow: 'none',
              }}
            >
              Question unavailable or broken? Skip it
            </button>
          )}
        </div>
      )}

      {children}

      {/* Action Buttons */}
      <div style={{
        display: 'flex',
        gap: '10px',
        marginTop: '4px',
        flexWrap: 'wrap'
      }}>
        {isMultiPart && multiPartHasRemaining && onContinuePart && !requiresCorrection ? (
          <>
            <button
              onClick={onContinuePart}
              style={{
                flex: 1,
                background: subjectColor,
                color: 'white',
                padding: '12px 20px',
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                minWidth: '180px'
              }}
            >
              {isCorrect ? 'Continue to next part' : 'Skip part & continue'} <ArrowRight size={16} />
            </button>
            {!isCorrect && allowRetry && (
              <button
                onClick={onTryAgain}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-muted)',
                  padding: '11px 16px',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  minWidth: '120px'
                }}
              >
                <RotateCcw size={16} /> Try this part again
              </button>
            )}
          </>
        ) : isCorrect && !isPendingReview ? (
          <button
            onClick={onNext}
            disabled={nextDisabled}
            style={{
              flex: 1,
              background: subjectColor,
              color: 'white',
              padding: '12px 20px',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: '700',
              cursor: nextDisabled ? 'not-allowed' : 'pointer',
              opacity: nextDisabled ? 0.55 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              minWidth: '160px'
            }}
          >
            {nextLabel ?? (isLastQuestion ? 'Finish Session' : 'Next Question')} <ArrowRight size={16} />
          </button>
        ) : isPendingReview ? (
          <div style={{ display: 'flex', gap: '10px', flex: 1, flexWrap: 'wrap' }}>
            {markResponse.retryable && (
              <button
                type="button"
                onClick={onTryAgain}
                style={{
                  flex: 1,
                  background: subjectColor,
                  color: 'white',
                  padding: '10px 16px',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  minWidth: '150px',
                }}
              >
                <RotateCcw size={16} /> Retry submission
              </button>
            )}
            <button
              type="button"
              onClick={onNext}
              style={{
                flex: 1,
                background: markResponse.retryable ? 'transparent' : subjectColor,
                color: markResponse.retryable ? 'var(--text-muted)' : 'white',
                border: markResponse.retryable ? '1px solid var(--border-color)' : 'none',
                padding: '10px 16px',
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                minWidth: '150px',
              }}
            >
              {nextLabel ?? (isLastQuestion ? 'Finish Session' : 'Continue')} <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          <>
            {allowRetry && (
            <button
              onClick={onTryAgain}
              style={{
                flex: 1,
                background: subjectColor,
                color: 'white',
                padding: '10px 16px',
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                minWidth: '130px'
              }}
            >
              <RotateCcw size={16} /> Try Again
            </button>
            )}
            {!requiresCorrection && (
              <button
                onClick={onNext}
                style={allowRetry ? {
                  flex: 1,
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-muted)',
                  padding: '9px 14px',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  minWidth: '120px'
                } : {
                  // The only action, so it is the main button.
                  flex: 1,
                  background: subjectColor,
                  color: 'white',
                  padding: '12px 20px',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  minWidth: '160px'
                }}
              >
                {nextLabel ?? (isLastQuestion ? 'Finish Session' : 'Next')} <ArrowRight size={16} />
              </button>
            )}
          </>
        )}
        {isMultiPart && multiPartHasRemaining && onSkipQuestion && !requiresCorrection && (
          <button
            type="button"
            onClick={onSkipQuestion}
            style={{
              flexBasis: '100%', background: 'transparent',
              border: '1px solid var(--border-color)', color: 'var(--text-muted)',
              padding: '8px 12px', borderRadius: '9px', fontSize: '12px',
              fontWeight: 650, cursor: 'pointer', boxShadow: 'none',
            }}
          >
            Replace this whole question
          </button>
        )}
      </div>
      {!independentPhase && !isCorrect && !isPendingReview && (
        <div style={{
          display: 'flex',
          gap: '8px',
          borderTop: '1px solid var(--border-color)',
          paddingTop: '12px'
        }}>
          <button
            onClick={onExplainMyAnswer}
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
              flex: 1
            }}
          >
            <BookOpen size={14} /> Explain my answer
          </button>
        </div>
      )}
    </div>
  );
}
