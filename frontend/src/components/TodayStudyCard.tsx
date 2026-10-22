'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { fetchTodayPlan } from '../lib/api';
import { buildTodayHref } from '../lib/scoped_navigation';
import type { Subject, TodayStudyPlan, YearLevel } from '../lib/api-types';
import {
  STATUS_COLOURS,
  todayProgressFraction,
  todayTaskMeta,
  todayTaskStatus,
  todayTaskTopicLine,
} from '../lib/today-labels';

const KIND_ICON: Record<string, string> = {
  diagnostic: '🔍',
  revision: '🔄',
  mistake: '🧩',
  focus: '🎯',
  exit: '🎟️',
};

export default function TodayStudyCard({
  subject,
  year,
  refreshTrigger,
}: {
  subject: Subject;
  year: YearLevel;
  refreshTrigger: number;
}) {
  const [plan, setPlan] = useState<TodayStudyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const stepsId = useId();

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setLoadError(false);
    fetchTodayPlan(subject, year, abort.signal)
      .then(value => {
        setPlan(value);
        setLoadError(false);
      })
      .catch(error => {
        const aborted = error instanceof Error && error.name === 'AbortError';
        if (!aborted) {
          setPlan(null);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [subject, year, refreshTrigger, retryNonce]);

  if (loading) {
    return (
      <div className="glass-panel" role="status" style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
        Building today&apos;s study session…
      </div>
    );
  }
  if (loadError) {
    return (
      <section className="glass-panel" role="alert" aria-label={"Today's study unavailable"} style={{ padding: '16px' }}>
        <div style={{ fontSize: '14px', fontWeight: 750, color: 'var(--text-primary)' }}>Today&apos;s study could not load</div>
        <p style={{ marginTop: '4px', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          Check the connection and try again. Your saved progress has not changed.
        </p>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setRetryNonce(value => value + 1)}
          style={{ marginTop: '10px', padding: '8px 14px', fontSize: '13px' }}
        >
          Retry today&apos;s study
        </button>
      </section>
    );
  }
  if (!plan || plan.total_tasks === 0) return null;

  const nextTask = plan.tasks.find(task => task.id === plan.next_task_id);
  const progress = todayProgressFraction(plan);
  // A completed diagnostic shows the assessment was taken, not that learning was secured.
  const isDiagnosticDay = plan.tasks.some(task => task.kind === 'diagnostic');

  return (
    <section className="glass-panel" aria-label="Today's study session" style={{
      padding: '16px',
      border: '1px solid rgba(99,102,241,0.32)',
      background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(14,165,233,0.06))',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--accent-color)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Today&apos;s study
          </div>
          <h2 style={{ fontSize: '19px', margin: '3px 0 4px' }}>
            {plan.complete ? 'Today’s Study is done' : `About ${plan.remaining_minutes} min left`}
          </h2>
          <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            {isDiagnosticDay ? 'A short diagnostic finds where to start.' : 'Fix mistakes and review first. Then learn the next topic.'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>
            Step {Math.min(plan.completed_tasks + (plan.complete ? 0 : 1), plan.total_tasks)} of {plan.total_tasks}
          </div>
          {plan.complete && (
            <div style={{ fontSize: '12px', fontWeight: 750, marginTop: '5px', color: plan.independent_secured || isDiagnosticDay ? STATUS_COLOURS.positive : STATUS_COLOURS.pending }}>
              {isDiagnosticDay
                ? 'Done · diagnostic results are ready'
                : plan.independent_secured ? 'Done · goal met' : 'Done · more review planned'}
            </div>
          )}
        </div>
        <span aria-hidden style={{ fontSize: '26px' }}>{plan.complete ? '✅' : '🚀'}</span>
      </div>

      <div
        role="progressbar"
        aria-label="Today's study progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-valuetext={`${plan.completed_tasks} of ${plan.total_tasks} steps done`}
        style={{ height: '6px', background: 'var(--bg-secondary)', borderRadius: '999px', overflow: 'hidden', margin: '12px 0' }}
      >
        <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: plan.complete ? STATUS_COLOURS.positive : 'var(--accent-color)' }} />
      </div>

      {!plan.complete && nextTask && (
        <Link href={buildTodayHref({ subject, year })} className="btn-primary" style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '54px',
          padding: '11px 16px', textDecoration: 'none', fontSize: '15px', fontWeight: 800,
          borderRadius: '11px',
          background: 'linear-gradient(135deg, var(--accent-color), #4f46e5)',
          boxShadow: '0 8px 20px rgba(79,70,229,0.24)',
        }}>
          {plan.completed_tasks > 0 ? 'Continue Today’s Study' : 'Start Today’s Study'} →
        </Link>
      )}

      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={stepsId}
        onClick={() => setExpanded(value => !value)}
        style={{
          width: '100%', minHeight: '44px', marginTop: '6px', background: 'transparent', border: 0,
          color: 'var(--accent-color)', cursor: 'pointer', fontSize: '12px', fontWeight: 700,
        }}
      >
        {expanded ? 'Hide steps' : 'Show steps'}
      </button>

      {expanded && (
        <ol id={stepsId} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
          {plan.tasks.map(task => {
            const status = todayTaskStatus(task);
            const topicLine = todayTaskTopicLine(task);
            return (
              <li key={task.id} style={{
                display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', gap: '8px', alignItems: 'start',
                padding: '9px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)',
              }}>
                <span aria-hidden>{task.completed ? '✅' : KIND_ICON[task.kind] || '•'}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 700 }}>{task.title}</div>
                  {topicLine && (
                    <div style={{ fontSize: '11.5px', fontWeight: 650, color: 'var(--text-primary)' }}>{topicLine}</div>
                  )}
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{task.reason}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{todayTaskMeta(task)}</div>
                  {status && (
                    <div style={{ fontSize: '12px', marginTop: '2px', color: status.positive ? STATUS_COLOURS.positive : STATUS_COLOURS.pending, fontWeight: 700 }}>
                      {status.label}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
