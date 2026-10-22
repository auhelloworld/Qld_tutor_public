'use client';

import { useId, useState } from 'react';
import MathMarkdown from './MathMarkdown';
import QuestionContext from './QuestionContext';
import LessonContentPanel from './tutor/LessonContentPanel';
import { formatStudentAnswer } from '../lib/format';
import { getErrorCauseOptions, type ErrorCauseCode } from '../lib/constants';
import { MIN_SELF_EXPLANATION_WORDS, hasMinimumSelfExplanation } from '../lib/metacognition';
import type { AnswerConfidence } from '../lib/api';
import type { Mistake, TutorExplainResponse, WorkedExample } from '../lib/api-types';

/** Parts of the Today practice page that only show content. */

const PANEL = { padding: '18px 20px', borderRadius: '14px' } as const;

function SolutionSteps({ steps }: { steps: string[] }) {
  return (
    <ol style={{ margin: 0, paddingLeft: '22px', display: 'grid', gap: '4px', fontSize: '14px' }}>
      {steps.map((step, index) => (
        <li key={index}><MathMarkdown>{step}</MathMarkdown></li>
      ))}
    </ol>
  );
}

export function TodayWorkedExample({ example }: { example: WorkedExample | null }) {
  const worked = example?.has_worked_example ? example.worked_example : undefined;
  if (!worked) return null;
  return (
    <div style={{ padding: '14px 16px', borderRadius: '12px', background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.28)' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: '15px', color: '#15803d' }}>Worked example</h3>
      {example?.core_rule && (
        <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
          <MathMarkdown>{example.core_rule}</MathMarkdown>
        </div>
      )}
      <div style={{ fontWeight: 650, marginBottom: '6px' }}>
        <MathMarkdown>{worked.question}</MathMarkdown>
      </div>
      <ol style={{ margin: 0, paddingLeft: '22px', display: 'grid', gap: '4px', fontSize: '14px' }}>
        {worked.steps.map(step => (
          <li key={step.step}>
            <MathMarkdown>{`${step.instruction} → ${step.result}`}</MathMarkdown>
          </li>
        ))}
      </ol>
      <div style={{ marginTop: '8px', fontWeight: 700, color: '#15803d' }}>
        <MathMarkdown>{`Answer: ${worked.answer}`}</MathMarkdown>
      </div>
    </div>
  );
}

/** The learn step of a new topic: the goal, a short lesson and an example. No answers are recorded. */
export function TodayLearnStep({
  goal,
  topicName,
  lesson,
  workedExample,
  loading,
  onStart,
}: {
  goal?: string | null;
  topicName: string;
  lesson: TutorExplainResponse | null;
  workedExample: WorkedExample | null;
  loading: boolean;
  onStart: () => void;
}) {
  const hasLesson = Boolean(lesson?.has_lesson_content && lesson.lesson_content);
  const hasExample = Boolean(workedExample?.has_worked_example && workedExample.worked_example);
  // A short lesson: the idea, the common mistakes and one example. The goal box
  // shows the "I can" statement. The full lesson stays under "Need help?".
  const content = hasLesson ? lesson?.lesson_content : undefined;
  const lessonBody = lesson && content
    ? { ...lesson, lesson_content: { explanation_sections: content.explanation_sections, common_mistakes: content.common_mistakes } }
    : null;
  const lessonHasExample = Boolean(content?.explanation_sections?.some(section => section.type === 'example'));
  return (
    <section className="glass-panel" aria-label="Learn first" style={{ ...PANEL, display: 'grid', gap: '14px' }}>
      <h2 style={{ margin: 0, fontSize: '18px' }}>Learn first: {topicName}</h2>
      {goal && (
        <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.24)' }}>
          <div style={{ fontSize: '12px', fontWeight: 850, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today’s goal</div>
          <div style={{ marginTop: '3px' }}><MathMarkdown>{goal}</MathMarkdown></div>
        </div>
      )}
      {lessonBody && <LessonContentPanel lessonContent={lessonBody} topic={topicName} />}
      {!hasLesson && lesson?.explanation && <MathMarkdown>{lesson.explanation}</MathMarkdown>}
      {!lessonHasExample && <TodayWorkedExample example={workedExample} />}
      {loading && !hasLesson && !hasExample && (
        <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>Loading the lesson…</p>
      )}
      {!loading && !hasLesson && !hasExample && !lesson?.explanation && (
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          This topic has no lesson yet. Start with a question. Help is open while you practise.
        </p>
      )}
      <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>
        Next you practise. Try each question first. Help is here when you need it.
      </p>
      <button type="button" className="btn-primary" onClick={onStart} style={{ justifySelf: 'start', minHeight: '44px' }}>
        Start practising →
      </button>
    </section>
  );
}

/** Shown when the student cannot answer: the right answer, its steps and, outside the final check, a worked example. */
export function TodayAnswerReveal({
  answer,
  steps,
  workedExample,
}: {
  /** From the server after a final miss. Question payloads carry no answer key. */
  answer?: string | null;
  /** The question's own steps, sent with the answer. */
  steps?: string[] | null;
  workedExample: WorkedExample | null;
}) {
  const hasSteps = Boolean(steps?.length);
  const hasExample = Boolean(workedExample?.has_worked_example && workedExample.worked_example);
  return (
    <section aria-label="How to answer it" style={{ display: 'grid', gap: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
      {answer && (
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px' }}>Right answer</h3>
          <div style={{ whiteSpace: 'pre-line' }}>
            <MathMarkdown>{answer}</MathMarkdown>
          </div>
        </div>
      )}
      {hasSteps && (
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: '15px' }}>How to get it</h3>
          <SolutionSteps steps={steps ?? []} />
        </div>
      )}
      {/* The steps of this question come first. The topic example is one more model. */}
      {hasExample && (hasSteps ? (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: '14px', fontWeight: 700, color: 'var(--accent-color)' }}>See another example</summary>
          <div style={{ marginTop: '8px' }}><TodayWorkedExample example={workedExample} /></div>
        </details>
      ) : (
        <TodayWorkedExample example={workedExample} />
      ))}
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
        This counts as a miss. It changes what you review next. It does not add work today.
      </p>
    </section>
  );
}

/** "How sure are you?" before the answer is sent. Optional; a second click clears it. */
export function TodayConfidencePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: AnswerConfidence | null;
  onChange: (value: AnswerConfidence | null) => void;
  disabled?: boolean;
}) {
  const options: [AnswerConfidence, string][] = [['guess', 'Guessing'], ['maybe', 'Probably'], ['sure', 'Sure']];
  return (
    <div role="group" aria-label="How sure are you? (optional)" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px', color: 'var(--text-secondary)' }}>
      <span aria-hidden="true">How sure are you? <span style={{ opacity: 0.8 }}>(optional)</span></span>
      {options.map(([option, label]) => (
        <button
          key={option}
          type="button"
          className="btn-secondary"
          aria-pressed={value === option}
          disabled={disabled}
          onClick={() => onChange(value === option ? null : option)}
          style={{
            minHeight: '36px', padding: '5px 12px', fontSize: '13px', fontWeight: 650,
            border: value === option ? '2px solid var(--accent-color)' : undefined,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** One sentence after a corrected or guessed right answer: what made it work? */
export function TodaySelfExplanation({
  value,
  onChange,
  onSave,
  saving,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  const inputId = useId();
  return (
    <div style={{ display: 'grid', gap: '8px', padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.06)' }}>
      <label htmlFor={inputId} style={{ fontWeight: 700 }}>In one sentence: What made it work?</label>
      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
        Use at least {MIN_SELF_EXPLANATION_WORDS} words. Saying it helps you remember it.
      </span>
      <textarea
        id={inputId}
        value={value}
        maxLength={300}
        rows={2}
        disabled={saving}
        onChange={event => onChange(event.target.value)}
        placeholder="It works because…"
        style={{ boxSizing: 'border-box', width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', font: 'inherit' }}
      />
      {error && <div role="alert" style={{ fontSize: '13px', color: '#b91c1c' }}>{error}</div>}
      <button
        type="button"
        className="btn-secondary"
        onClick={onSave}
        disabled={saving || !hasMinimumSelfExplanation(value)}
        style={{ justifySelf: 'start', minHeight: '40px' }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

/**
 * The cause step of a past mistake: the question, the student's answer, the
 * right answer and its steps (folded), then one cause and an optional plan.
 */
export function TodayCauseStep({
  mistake,
  subject,
  saving,
  error,
  onSave,
}: {
  mistake: Mistake;
  subject: string;
  saving: boolean;
  error: string | null;
  onSave: (cause: ErrorCauseCode, plan: string) => void;
}) {
  const [cause, setCause] = useState<ErrorCauseCode | null>(null);
  const [plan, setPlan] = useState(mistake.if_then_strategy || '');
  const planId = useId();
  const options = getErrorCauseOptions(mistake.subject || subject);
  const steps = mistake.solution_steps ?? [];
  return (
    <section className="glass-panel" aria-label="Find the cause" style={{ ...PANEL, display: 'grid', gap: '14px' }}>
      <h2 style={{ margin: 0, fontSize: '18px' }}>What went wrong?</h2>
      <div style={{ fontSize: '16px', lineHeight: 1.6 }}>
        <QuestionContext question={mistake} />
      </div>
      {mistake.student_answer && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#b91c1c' }}>Your answer</span>
          <span style={{ fontWeight: 650 }}><MathMarkdown inline>{formatStudentAnswer(mistake.student_answer)}</MathMarkdown></span>
        </div>
      )}
      {(mistake.correct_answer || steps.length > 0) && (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--accent-color)' }}>Show the right answer and steps</summary>
          <div style={{ display: 'grid', gap: '8px', marginTop: '8px' }}>
            {mistake.correct_answer && (
              <div><strong>Right answer:</strong> <MathMarkdown inline>{mistake.correct_answer}</MathMarkdown></div>
            )}
            {steps.length > 0 && <SolutionSteps steps={steps} />}
          </div>
        </details>
      )}
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
        <legend style={{ fontWeight: 700, marginBottom: '8px' }}>What caused the mistake?</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {options.map(option => (
            <label
              key={option.value}
              className={`choice-label ${cause === option.value ? 'choice-label-selected' : ''}`}
              style={{ flex: '0 1 auto', minHeight: '40px', padding: '6px 12px' }}
            >
              <input
                type="radio"
                name="today-mistake-cause"
                value={option.value}
                checked={cause === option.value}
                disabled={saving}
                onChange={() => setCause(option.value)}
                style={{ accentColor: 'var(--accent-color)' }}
              />
              <span>{option.emoji} {option.shortLabel}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div style={{ display: 'grid', gap: '6px' }}>
        <label htmlFor={planId} style={{ fontSize: '14px', fontWeight: 650 }}>Plan for next time (optional)</label>
        <textarea
          id={planId}
          value={plan}
          maxLength={300}
          rows={2}
          disabled={saving}
          onChange={event => setPlan(event.target.value)}
          placeholder="If I notice…, then I will…"
          style={{ boxSizing: 'border-box', width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', font: 'inherit' }}
        />
      </div>
      {error && <div role="alert" style={{ color: '#b91c1c', fontSize: '14px' }}>{error}</div>}
      <button
        type="button"
        className="btn-primary"
        disabled={!cause || saving}
        onClick={() => cause && onSave(cause, plan)}
        style={{ justifySelf: 'start', minHeight: '44px' }}
      >
        {saving ? 'Saving…' : 'Save and go back →'}
      </button>
    </section>
  );
}

/** A full-width message with a way back to Today. */
export function TodayStepNotice({
  title,
  message,
  onBack,
  onRetry,
}: {
  title: string;
  message?: string;
  onBack: () => void;
  onRetry?: () => void;
}) {
  return (
    <section className="glass-panel" role={onRetry ? 'alert' : undefined} style={{ ...PANEL, display: 'grid', gap: '10px', textAlign: 'center', justifyItems: 'center' }}>
      <h2 style={{ margin: 0, fontSize: '19px' }}>{title}</h2>
      {message && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{message}</p>}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {onRetry && (
          <button type="button" className="btn-secondary" onClick={onRetry} style={{ minHeight: '44px' }}>
            Try again
          </button>
        )}
        <button type="button" className="btn-primary" onClick={onBack} style={{ minHeight: '44px' }}>
          Back to Today’s Study
        </button>
      </div>
    </section>
  );
}
