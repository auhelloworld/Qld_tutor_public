'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { CheckCircle, XCircle, Lightbulb, ArrowRight, Trophy, X, RefreshCw, Sparkles } from 'lucide-react';
import type { LabActivityMeta, LearnStep } from '../../lib/lab-activities';
import { normaliseMathAnswer } from '../../lib/lab-answer-normalise';
import { answersEquivalent } from '../../lib/lab-answer-equivalence';
import { hasVariants } from '../../lib/lab-variants';
import MathSymbolKeyboard from '../MathSymbolKeyboard';

interface LearnPanelProps {
  activity: LabActivityMeta;
  onComplete: (activityId: string, success: boolean) => void;
  onExit: () => void;
  onRevealChange?: (revealed: boolean) => void;
  onStepChange?: (stepIndex: number) => void;
  /** Optional variant seed; when set the panel uses externally-generated steps. */
  variantSeed?: number | null;
  /** Externally-generated variant steps (must be provided when variantSeed is set). */
  variantSteps?: LearnStep[];
  /** Callback to request a new random variant seed. */
  onNewVariant?: () => void;
}

/**
 * Shared learning mode panel for Maths Lab activities.
 * Shows objective → step-by-step prompts → deterministic feedback → completion.
 * Never calls any backend/mastery API.
 *
 * Marking layers, in order: exact match after bilateral normalisation, numeric
 * tolerance, then — only for steps that declare `equivalence` — numeric-sampling
 * expression equivalence. Hints are freely available and carry no penalty: the
 * result depends only on whether every core step was answered correctly.
 */
export default function LearnPanel({ activity, onComplete, onExit, onRevealChange, onStepChange, variantSeed, variantSteps, onNewVariant }: LearnPanelProps) {
  const [phase, setPhase] = useState<'core' | 'extension'>('core');
  const [currentStep, setCurrentStep] = useState(0);
  const [answer, setAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [extensionCorrect, setExtensionCorrect] = useState<boolean | null>(null);
  const [completed, setCompleted] = useState(false);
  const previousActivityId = useRef(activity.id);
  const previousVariantSeed = useRef<number | null | undefined>(variantSeed);

  // Changing numbers changes the graded contract. Start the learner at the
  // first core step so a submitted answer from the old variant cannot remain
  // attached to the new prompt.
  useEffect(() => {
    const activityChanged = activity.id !== previousActivityId.current;
    const variantChanged = variantSeed !== previousVariantSeed.current;
    if (!activityChanged && !variantChanged) return;

    previousActivityId.current = activity.id;
    previousVariantSeed.current = variantSeed;
    setPhase('core');
    setCurrentStep(0);
    setAnswer('');
    setSubmitted(false);
    setIsCorrect(false);
    setShowHint(false);
    setCorrectCount(0);
    setExtensionCorrect(null);
    setCompleted(false);
    onRevealChange?.(false);
    onStepChange?.(0);
  }, [activity.id, variantSeed, onRevealChange, onStepChange]);

  // Use variant steps when provided, otherwise fall back to fixed activity steps
  const allSteps: LearnStep[] = variantSteps && variantSeed != null ? variantSteps : activity.steps;
  const coreSteps = useMemo(() => allSteps.filter((s) => s.tier !== 'extension'), [allSteps]);
  const extensionSteps = useMemo(() => allSteps.filter((s) => s.tier === 'extension'), [allSteps]);

  const activeSteps = phase === 'extension' ? extensionSteps : coreSteps;
  const step: LearnStep | undefined = activeSteps[currentStep];
  const totalSteps = activeSteps.length;
  const showNewVariant = hasVariants(activity.id) && onNewVariant;

  const checkAnswer = useCallback(
    (userAnswer: string, stepDef: LearnStep): boolean => {
      const normalised = normaliseMathAnswer(userAnswer);
      if (!normalised) return false;

      // Layer 1: exact string matches (bilateral normalisation)
      for (const accepted of stepDef.acceptedAnswers) {
        if (normalised === normaliseMathAnswer(accepted)) return true;
      }

      // Layer 2: numeric tolerance check — use normalised form for parsing
      if (stepDef.tolerance !== undefined) {
        const numericAnswer = Number(normalised);
        if (Number.isFinite(numericAnswer)) {
          for (const accepted of stepDef.acceptedAnswers) {
            const numericAccepted = Number(normaliseMathAnswer(accepted));
            if (Number.isFinite(numericAccepted)) {
              if (Math.abs(numericAnswer - numericAccepted) <= stepDef.tolerance) return true;
            }
          }
        }
      }

      // Layer 3: opt-in expression equivalence by deterministic numeric sampling.
      if (stepDef.equivalence) {
        for (const accepted of stepDef.acceptedAnswers) {
          if (answersEquivalent(normalised, normaliseMathAnswer(accepted), stepDef.equivalence)) {
            return true;
          }
        }
      }

      return false;
    },
    []
  );

  const handleSubmit = useCallback(() => {
    if (!step || submitted) return;
    const correct = checkAnswer(answer, step);
    setIsCorrect(correct);
    setSubmitted(true);
    onRevealChange?.(true);
    if (correct) {
      if (phase === 'extension') setExtensionCorrect(true);
      else setCorrectCount((c) => c + 1);
    } else if (phase === 'extension') {
      setExtensionCorrect(false);
    }
  }, [answer, step, submitted, checkAnswer, onRevealChange, phase]);

  const handleNext = useCallback(() => {
    const nextStep = currentStep + 1;
    if (nextStep >= totalSteps) {
      setCompleted(true);
      if (phase === 'core') {
        // Independent evidence: every core step must be correct.
        onComplete(activity.id, correctCount >= coreSteps.length);
      }
    } else {
      setCurrentStep(nextStep);
      setAnswer('');
      setSubmitted(false);
      setIsCorrect(false);
      setShowHint(false);
      onRevealChange?.(false);
      onStepChange?.(phase === 'extension' ? coreSteps.length + nextStep : nextStep);
    }
  }, [currentStep, totalSteps, correctCount, coreSteps.length, phase, activity.id, onComplete, onRevealChange, onStepChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !submitted) {
        handleSubmit();
      }
    },
    [submitted, handleSubmit]
  );

  const restartActivity = useCallback(() => {
    setPhase('core');
    setCurrentStep(0);
    setAnswer('');
    setSubmitted(false);
    setIsCorrect(false);
    setShowHint(false);
    setCorrectCount(0);
    setExtensionCorrect(null);
    setCompleted(false);
    onRevealChange?.(false);
    onStepChange?.(0);
  }, [onRevealChange, onStepChange]);

  const startExtension = useCallback(() => {
    setPhase('extension');
    setCurrentStep(0);
    setAnswer('');
    setSubmitted(false);
    setIsCorrect(false);
    setShowHint(false);
    setCompleted(false);
    onRevealChange?.(false);
    onStepChange?.(coreSteps.length);
  }, [coreSteps.length, onRevealChange, onStepChange]);

  if (completed) {
    const allCorrect = correctCount >= coreSteps.length;
    const extensionAvailable = allCorrect && extensionSteps.length > 0 && extensionCorrect === null;
    return (
      <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', textAlign: 'center' }}>
        <Trophy size={40} color={allCorrect ? 'var(--success)' : 'var(--accent-color)'} />
        <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0 }}>
          {allCorrect ? 'Every step correct' : 'Activity Complete'}
        </h3>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0 }}>
          You got {correctCount} out of {coreSteps.length} correct.
          {allCorrect
            ? ''
            : ' Review the feedback, then try the activity again to strengthen the idea.'}
          {!allCorrect && extensionSteps.length > 0
            ? ' Get every step right to unlock the bonus challenge.'
            : ''}
        </p>
        {extensionCorrect !== null && (
          <p role="status" style={{ fontSize: '13px', margin: 0, fontWeight: 600, color: extensionCorrect ? 'var(--success)' : 'var(--text-secondary)' }}>
            {extensionCorrect
              ? 'Extension challenge cleared.'
              : 'Extension challenge not cleared yet — the core activity still counts as complete.'}
          </p>
        )}
        <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {extensionAvailable && (
            <button
              type="button"
              onClick={startExtension}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: '700',
                borderRadius: '8px',
                cursor: 'pointer',
                border: 'none',
                background: 'var(--accent-purple)',
                color: 'white',
              }}
            >
              <Sparkles size={16} /> Extension challenge
            </button>
          )}
          <button
            type="button"
            onClick={restartActivity}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: '700',
              borderRadius: '8px',
              cursor: 'pointer',
              border: 'none',
              background: 'var(--accent-color)',
              color: 'white',
            }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onExit}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: '600',
              borderRadius: '8px',
              cursor: 'pointer',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
            }}
          >
            Back to Activities
          </button>
        </div>
      </div>
    );
  }

  if (!step) return null;

  return (
    <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header with objective */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 4px 0', color: 'var(--text-primary)' }}>
            {activity.title}
            {phase === 'extension' && (
              <span
                style={{
                  marginLeft: '8px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '999px',
                  background: 'var(--accent-purple)',
                  color: 'white',
                  verticalAlign: 'middle',
                }}
              >
                Extension
              </span>
            )}
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
            {phase === 'extension'
              ? 'Extension challenge — beyond the taught procedure. Your core result is already recorded.'
              : activity.objective}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {showNewVariant && (
            <button
              onClick={onNewVariant}
              aria-label="New numbers"
              title="New numbers"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: '600',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                cursor: 'pointer',
                color: 'var(--accent-color)',
              }}
            >
              <RefreshCw size={12} /> New numbers
            </button>
          )}
          <button
            onClick={onExit}
            aria-label="Exit learn mode"
            style={{
              padding: '4px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Progress indicator */}
      <div
        role="progressbar"
        aria-label="Activity progress"
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-valuenow={currentStep + 1}
        style={{ display: 'flex', gap: '4px', alignItems: 'center' }}
      >
        {activeSteps.map((_, idx) => (
          <div
            key={idx}
            style={{
              flex: 1,
              height: '4px',
              borderRadius: '2px',
              background:
                idx < currentStep
                  ? 'var(--success)'
                  : idx === currentStep
                  ? 'var(--accent-color)'
                  : 'var(--border-color)',
            }}
          />
        ))}
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '8px', whiteSpace: 'nowrap' }}>
          {currentStep + 1}/{totalSteps}
        </span>
      </div>
      {phase === 'core' && extensionSteps.length > 0 && (
        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '-12px 0 0' }}>
          Get all {coreSteps.length} steps right to unlock a bonus challenge.
        </p>
      )}

      {/* Prompt */}
      <div
        style={{
          background: 'rgba(99,102,241,0.04)',
          padding: '16px',
          borderRadius: '10px',
          border: '1px solid rgba(99,102,241,0.1)',
        }}
      >
        <p style={{ fontSize: '14px', fontWeight: '600', margin: 0, lineHeight: '1.5' }}>
          {step.prompt}
        </p>
      </div>

      {/* Answer input */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label htmlFor="learn-answer-input" style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
          Your answer:
        </label>
        <input
          id="learn-answer-input"
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitted}
          placeholder="Type your answer…"
          aria-describedby={submitted ? 'learn-feedback' : undefined}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: '15px',
            fontFamily: 'monospace',
            background: 'var(--bg-secondary)',
            border: `1px solid ${submitted ? (isCorrect ? 'var(--success)' : 'var(--error)') : 'var(--border-color)'}`,
            borderRadius: '8px',
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        {/* MathSymbolKeyboard — prop is named textareaId but supports HTMLInputElement internally */}
        <MathSymbolKeyboard
          textareaId="learn-answer-input"
          onInsert={setAnswer}
          disabled={submitted}
        />
      </div>

      {/* Hint */}
      {!submitted && step.hint && !showHint && (
        <button
          type="button"
          onClick={() => setShowHint(true)}
          aria-expanded="false"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: '600',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--accent-color)',
          }}
        >
          <Lightbulb size={14} /> Show hint
        </button>
      )}
      {!submitted && showHint && step.hint && (
        <p
          role="status"
          style={{
            margin: 0,
            padding: '8px 12px',
            borderLeft: '3px solid var(--accent-color)',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            lineHeight: 1.5,
          }}
        >
          <Lightbulb size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
          {step.hint}
        </p>
      )}

      {/* Feedback (hidden until submitted) */}
      {submitted && (
        <div
          id="learn-feedback"
          role="alert"
          aria-live="polite"
          style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'flex-start',
            padding: '12px',
            borderRadius: '8px',
            background: isCorrect ? 'rgba(34,197,94,0.06)' : 'color-mix(in srgb, var(--error) 6%, transparent)',
            border: `1px solid ${isCorrect ? 'rgba(34,197,94,0.2)' : 'color-mix(in srgb, var(--error) 20%, transparent)'}`,
          }}
        >
          {isCorrect ? (
            <CheckCircle size={18} color="var(--success)" style={{ flexShrink: 0, marginTop: '2px' }} />
          ) : (
            <XCircle size={18} color="var(--error)" style={{ flexShrink: 0, marginTop: '2px' }} />
          )}
          <p style={{ fontSize: '13px', margin: 0, lineHeight: '1.5', color: 'var(--text-primary)' }}>
            {isCorrect ? step.feedbackCorrect : step.feedbackIncorrect}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        {!submitted && (
          <button
            onClick={handleSubmit}
            disabled={!answer.trim()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 18px',
              fontSize: '14px',
              fontWeight: '700',
              borderRadius: '8px',
              cursor: answer.trim() ? 'pointer' : 'not-allowed',
              border: 'none',
              background: answer.trim() ? 'var(--accent-color)' : 'var(--border-color)',
              color: 'white',
              opacity: answer.trim() ? 1 : 0.5,
            }}
          >
            Submit
          </button>
        )}
        {submitted && (
          <button
            onClick={handleNext}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 18px',
              fontSize: '14px',
              fontWeight: '700',
              borderRadius: '8px',
              cursor: 'pointer',
              border: 'none',
              background: 'var(--accent-color)',
              color: 'white',
            }}
          >
            {currentStep + 1 >= totalSteps ? 'Finish' : 'Next'} <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
