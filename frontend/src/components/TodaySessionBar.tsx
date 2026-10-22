'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTodayPlan } from '../lib/api';
import { buildTodayHref, withTodaySessionHref } from '../lib/scoped_navigation';
import type { Subject, TodayStudyPlan, YearLevel } from '../lib/api-types';
import { findTodayTask } from '../lib/today-practice';
import { STATUS_COLOURS, todayProgressFraction } from '../lib/today-labels';

interface TodaySessionBarProps {
  subject: Subject;
  year: YearLevel;
  activeTaskId?: string | null;
  refreshTrigger?: number | string | boolean;
  /** Receives every plan the bar loads, so a practice page can follow server progress. */
  onPlanChange?: (plan: TodayStudyPlan) => void;
}

export default function TodaySessionBar({
  subject,
  year,
  activeTaskId,
  refreshTrigger = 0,
  onPlanChange,
}: TodaySessionBarProps) {
  const [plan, setPlan] = useState<TodayStudyPlan | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const onPlanChangeRef = useRef(onPlanChange);

  useEffect(() => {
    onPlanChangeRef.current = onPlanChange;
  }, [onPlanChange]);

  useEffect(() => {
    const abort = new AbortController();
    setLoadError(false);
    const timer = window.setTimeout(() => {
      fetchTodayPlan(subject, year, abort.signal)
        .then(value => {
          setPlan(value);
          setLoadError(false);
          onPlanChangeRef.current?.(value);
        })
        .catch(error => {
          const aborted = error instanceof Error && error.name === 'AbortError';
          if (!aborted) {
            setPlan(null);
            setLoadError(true);
          }
        });
    }, refreshTrigger ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [subject, year, refreshTrigger, retryNonce]);

  const activeTask = useMemo(
    () => (plan && activeTaskId ? findTodayTask(plan, activeTaskId) : null),
    [activeTaskId, plan],
  );
  const nextTask = plan?.tasks.find(task => task.id === plan.next_task_id) ?? null;
  const morePractice = activeTask?.kind === 'extra' || activeTask?.kind === 'mixed';

  if (loadError) {
    return (
      <div role="alert" style={{ padding: '10px 16px', borderBottom: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.10)', fontSize: '13px' }}>
        Today&apos;s progress could not refresh. Your saved work is unchanged.{' '}
        <button type="button" onClick={() => setRetryNonce(value => value + 1)} style={{ padding: '6px 10px', marginLeft: '6px', fontSize: '12px' }}>
          Retry
        </button>
      </div>
    );
  }

  if (!plan || plan.total_tasks === 0) return null;

  const progress = Math.round(todayProgressFraction(plan) * 100);
  const currentFinished = Boolean(activeTask?.completed);
  const directNext = currentFinished && nextTask && nextTask.id !== activeTask?.id ? nextTask : null;
  const sessionScope = { subject, year };
  const sessionHref = buildTodayHref(sessionScope);
  const actionHref = directNext
    ? withTodaySessionHref(directNext.href, sessionScope)
    : sessionHref;
  const actionLabel = plan.complete
    ? 'See today’s summary'
    : directNext
      ? `Next: ${directNext.title}`
      : 'Today’s plan';
  const stepNumber = Math.min(plan.completed_tasks + (plan.complete ? 0 : 1), plan.total_tasks);
  const isDiagnosticDay = plan.tasks.some(task => task.kind === 'diagnostic');

  return (
    <section aria-label="Today session progress" className="today-session-bar">
      <div style={{ minWidth: 0 }}>
        <div className="today-session-bar__line">
          <strong className="today-session-bar__title">
            {morePractice && activeTask
              ? `More practice: ${activeTask.title}`
              : plan.complete ? 'Today’s Study is done' : activeTask?.title || nextTask?.title || 'Today’s Study'}
          </strong>
          <span className="today-session-bar__meta">
            {morePractice ? 'Optional' : `Step ${stepNumber} of ${plan.total_tasks}`}
            {plan.complete || morePractice ? '' : ` · about ${plan.remaining_minutes} min left`}
            {activeTask && !activeTask.completed && activeTask.question_target > 0
              ? ` · ${activeTask.question_completed} done in this step`
              : ''}
          </span>
          {plan.complete && (
            <span className="today-session-bar__badge" style={{ color: plan.independent_secured || isDiagnosticDay ? STATUS_COLOURS.positive : STATUS_COLOURS.pending }}>
              {isDiagnosticDay
                ? 'Diagnostic complete'
                : plan.independent_secured ? 'Goal met' : 'More review planned'}
            </span>
          )}
        </div>
        <div
          role="progressbar"
          aria-label="Steps done today"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-valuetext={`${plan.completed_tasks} of ${plan.total_tasks} steps done`}
          style={{ height: '4px', marginTop: '7px', borderRadius: '999px', overflow: 'hidden', background: 'var(--bg-primary)' }}
        >
          <div style={{ width: `${progress}%`, height: '100%', background: plan.complete ? STATUS_COLOURS.positive : 'var(--accent-color)', transition: 'width 0.25s ease' }} />
        </div>
      </div>
      {/* A plain anchor, not next/link: practice pages read their Today task from
          the URL when they load. A client-side navigation to the same route
          (for example, revision to the final check on "/") keeps the old task. */}
      <a
        href={actionHref}
        className="today-session-bar__action"
        style={{
          background: directNext ? 'var(--accent-color)' : 'rgba(99,102,241,0.12)',
          border: directNext ? '1px solid var(--accent-color)' : '1px solid rgba(99,102,241,0.28)',
          color: directNext ? '#fff' : 'var(--accent-color)',
        }}
      >
        <span className="today-session-bar__action-label">{actionLabel} →</span>
      </a>
    </section>
  );
}
