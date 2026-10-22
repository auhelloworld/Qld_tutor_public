'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { fetchTodayPlan } from '../../lib/api';
import { getSubject, getYear } from '../../lib/preferences';
import {
  buildPracticeHref,
  scopedSubjectFromSearchParams,
  scopedYearFromSearchParams,
  withTodaySessionHref,
} from '../../lib/scoped_navigation';
import type { Subject, TodayStudyTask, TodayStudyPlan, YearLevel } from '../../lib/api-types';
import LearningReceipt from '../../components/LearningReceipt';
import MathMarkdown from '../../components/MathMarkdown';
import TodayTopicPicker from '../../components/TodayTopicPicker';
import { BACK_TO_PRACTICE_STYLE } from '../../components/BackToPracticeLink';
import {
  STATUS_COLOURS,
  todayGoal,
  todayProgressFraction,
  todayScopeLabel,
  todayTaskMeta,
  todayTaskStatus,
  todayTaskTopicLine,
} from '../../lib/today-labels';

const KIND_ICON: Record<string, string> = {
  diagnostic: '🔍',
  revision: '🔄',
  mistake: '🧩',
  focus: '🎯',
  exit: '🎟️',
  extra: '➕',
  mixed: '🔀',
};

const PAGE_STYLE = { maxWidth: '880px', margin: '0 auto', padding: '24px 18px 48px' } as const;

export default function TodayPage() {
  const [scope, setScope] = useState<{ subject: Subject; year: YearLevel } | null>(null);
  const [plan, setPlan] = useState<TodayStudyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setScope({
      subject: scopedSubjectFromSearchParams(params, getSubject()),
      year: scopedYearFromSearchParams(params, getYear()),
    });
  }, []);

  // Only the first load replaces the page with a placeholder. A refresh keeps
  // the current plan and scroll position on screen until the new plan arrives.
  const loadPlan = useCallback((signal?: AbortSignal) => {
    if (!scope) return Promise.resolve();
    setError(null);
    return fetchTodayPlan(scope.subject, scope.year, signal)
      .then(setPlan)
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load today’s study session.');
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, [scope]);

  useEffect(() => {
    if (!scope) return;
    const abort = new AbortController();
    void loadPlan(abort.signal);
    return () => abort.abort();
  }, [loadPlan, refreshKey, scope]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setRefreshKey(value => value + 1);
    };
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  useEffect(() => {
    document.title = 'Today’s Study — QLD AI Tutor';
    return () => { document.title = 'QLD AI Tutor'; };
  }, []);

  // The root layout already provides <main>; this page only adds a section.
  if (!scope || (loading && !plan)) {
    return (
      <div style={{ ...PAGE_STYLE, maxWidth: '820px' }}>
        <div className="glass-panel" role="status" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Loading Today’s Study…
        </div>
      </div>
    );
  }

  const practiceHref = buildPracticeHref(scope);

  if (error && !plan) {
    return (
      <div style={{ ...PAGE_STYLE, maxWidth: '820px' }}>
        <div className="glass-panel" role="alert" style={{ padding: '32px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '22px', marginBottom: '8px' }}>Could not load Today’s Study</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '18px' }}>{error}</p>
          <button className="btn-primary" onClick={() => setRefreshKey(value => value + 1)} style={{ padding: '10px 18px' }}>Try again</button>
          <div style={{ marginTop: '14px' }}><Link href={practiceHref}>Return to practice</Link></div>
        </div>
      </div>
    );
  }

  if (!plan || plan.total_tasks === 0) {
    return (
      <div style={{ ...PAGE_STYLE, maxWidth: '820px' }}>
        <div className="glass-panel" style={{ padding: '36px', textAlign: 'center' }}>
          <div aria-hidden style={{ fontSize: '40px', marginBottom: '10px' }}>🌱</div>
          <h1 style={{ fontSize: '24px', marginBottom: '8px' }}>You’re ready to practise</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '18px' }}>Nothing is planned for this subject today.</p>
          <Link href={practiceHref} className="btn-primary" style={{ display: 'inline-block', padding: '10px 18px', textDecoration: 'none' }}>Choose a topic</Link>
        </div>
      </div>
    );
  }

  const nextTask = plan.tasks.find(task => task.id === plan.next_task_id) ?? null;
  const nextHref = plan.next_href ?? null;
  const progress = Math.round(todayProgressFraction(plan) * 100);
  const isDiagnosticDay = plan.tasks.some(task => task.kind === 'diagnostic');
  const finalCheck = plan.tasks.find(task => task.kind === 'exit') ?? null;
  const evidenceTarget = isDiagnosticDay ? 1 : (finalCheck?.question_target ?? 0);
  const evidenceCount = isDiagnosticDay
    ? (plan.independent_secured ? 1 : 0)
    : (finalCheck?.independent_correct_count ?? 0);
  const goal = todayGoal(plan);
  const scopeLabel = todayScopeLabel(scope.subject, scope.year);
  const stepNumber = Math.min(plan.completed_tasks + (plan.complete ? 0 : 1), plan.total_tasks);
  const hrefFor = (href: string) => withTodaySessionHref(href, scope);
  const morePractice = plan.complete ? plan.more_practice ?? [] : [];
  const stepList = (
    <section className="glass-panel" aria-label="Today session steps" style={{ padding: '6px 18px' }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {plan.tasks.map((task, index) => (
          <TaskRow key={task.id} task={task} index={index} isCurrent={task.id === plan.next_task_id} hrefFor={hrefFor} />
        ))}
      </ol>
    </section>
  );

  return (
    <div className="today-plan">
      {/* Exit has one place at every screen width: the top line, before the title. */}
      <div className="today-plan__top">
        <Link
          href={practiceHref}
          title="Leave Today’s Study. Your progress is saved."
          style={{ ...BACK_TO_PRACTICE_STYLE, minHeight: '44px', fontSize: '14px' }}
        >
          <span aria-hidden="true">←</span> Exit session
        </Link>
        <span style={{ fontSize: '12px', fontWeight: 850, color: 'var(--accent-color)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {scopeLabel}{isDiagnosticDay ? ' · Diagnostic' : ''}
        </span>
      </div>

      <header className="glass-panel" style={{
        padding: '22px 24px',
        border: '1px solid rgba(99,102,241,0.3)',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.14), rgba(14,165,233,0.06))',
      }}>
        <h1 style={{ fontSize: '30px', margin: '0 0 6px' }}>{plan.complete ? 'Today’s Study is done' : 'Today’s Study'}</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.55, maxWidth: '680px' }}>
          {isDiagnosticDay
            ? 'Today you take a short diagnostic. It shows the tutor where you should start.'
            : plan.complete
              ? 'You can stop here. Your next review is planned.'
              : 'Fix old mistakes and review first. Then learn the next topic. Each step stops when you show you can do it.'}
        </p>

        {error && (
          <div role="alert" style={{ marginTop: '14px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', fontSize: '13px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Could not refresh Today’s Study. Your saved work is unchanged.</span>
            <button type="button" className="btn-secondary" onClick={() => setRefreshKey(value => value + 1)} style={{ padding: '6px 12px', fontSize: '12px' }}>
              Try again
            </button>
          </div>
        )}

        {!plan.complete && (
          <aside aria-label="Today’s goal" style={{ marginTop: '14px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.24)' }}>
            <div style={{ fontSize: '12px', fontWeight: 850, color: STATUS_COLOURS.positive, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today’s goal</div>
            <div style={{ marginTop: '3px', fontSize: '14px', color: 'var(--text-primary)' }}><MathMarkdown inline>{goal}</MathMarkdown></div>
          </aside>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '18px', marginBottom: '8px', fontSize: '13px', gap: '12px', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '15px' }}>Step {stepNumber} of {plan.total_tasks}</strong>
          {!plan.complete && <span style={{ color: 'var(--text-secondary)' }}>About {plan.remaining_minutes} min left</span>}
        </div>
        <div
          role="progressbar"
          aria-label="Steps done today"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-valuetext={`${plan.completed_tasks} of ${plan.total_tasks} steps done`}
          style={{ height: '8px', borderRadius: '999px', overflow: 'hidden', background: 'var(--bg-secondary)' }}
        >
          <div style={{ width: `${progress}%`, height: '100%', background: plan.complete ? STATUS_COLOURS.positive : 'var(--accent-color)', transition: 'width 0.3s ease' }} />
        </div>

        {!plan.complete && nextTask && nextHref && (
          <Link
            href={withTodaySessionHref(nextHref, scope)}
            className="btn-primary"
            style={{
              display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '56px',
              marginTop: '18px', padding: '13px 20px', textDecoration: 'none', fontSize: '16px', fontWeight: 850,
              borderRadius: '12px', background: 'linear-gradient(135deg, var(--accent-color), #4f46e5)',
              boxShadow: '0 10px 24px rgba(79,70,229,0.28)',
            }}
          >
            {nextTask.question_completed > 0 ? 'Continue' : 'Start'}: {nextTask.title} →
          </Link>
        )}
        {plan.complete && (
          <div style={{ marginTop: '16px' }}>
            <LearningReceipt
              questionsCompleted={plan.question_completed}
              securedCount={evidenceCount}
              securedTarget={evidenceTarget}
              successCriterion={isDiagnosticDay ? null : goal}
              criterionMet={plan.independent_secured}
              nextReviewAt={plan.next_review_at}
              evidenceLabel={isDiagnosticDay ? 'Diagnostic' : 'Final check on your own'}
              evidenceDetail={isDiagnosticDay ? 'completed as planned' : 'right the first time, with no help'}
              headingLevel={2}
              compact
            />
          </div>
        )}
      </header>

      {morePractice.length > 0 && (
        <section className="glass-panel" aria-label="More practice" style={{ padding: '10px 18px' }}>
          <h2 style={{ fontSize: '16px', margin: '8px 0 2px' }}>More practice</h2>
          <p style={{ margin: '0 0 4px', fontSize: '13px', color: 'var(--text-secondary)' }}>Optional. Stop when you like.</p>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {morePractice.map((task, index) => (
              <TaskRow key={task.id} task={task} index={index} isCurrent={false} hrefFor={hrefFor} />
            ))}
          </ol>
        </section>
      )}

      {plan.complete && (
        <section className="glass-panel" aria-labelledby="today-what-next" style={{ padding: '16px 18px' }}>
          <h2 id="today-what-next" style={{ fontSize: '16px', margin: '0 0 10px' }}>Done for today</h2>
          <Link href={practiceHref} style={{ fontSize: '13px', color: 'var(--accent-color)' }}>
            Practise a topic you choose
          </Link>
        </section>
      )}

      {/* When the day is done, the finished steps fold away under one line. */}
      {plan.complete ? (
        <details className="glass-panel" style={{ padding: '6px 18px' }}>
          <summary style={{ cursor: 'pointer', padding: '12px 0', fontSize: '14px', fontWeight: 750 }}>
            Today’s steps · {plan.completed_tasks} done
          </summary>
          {stepList}
        </details>
      ) : stepList}

      {!isDiagnosticDay && (
        <details className="glass-panel" style={{ padding: '6px 18px' }}>
          <summary style={{ cursor: 'pointer', padding: '12px 0', fontSize: '14px', fontWeight: 750, color: 'var(--accent-color)' }}>
            Why these steps?
          </summary>
          <ul style={{ margin: '0 0 12px', paddingLeft: '20px', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.6 }}>
            <li>Old mistakes come first. When you fix a mistake soon, you remember the right method.</li>
            <li>Review comes next. Answer from memory first; help opens after your first answer. One right answer is enough.</li>
            <li>A new topic starts with a short lesson and an example. The step stops when you get 3 of 4 right on your own.</li>
            <li>You can choose another new topic before you answer its first question. A topic that builds on a topic you have not learned says so.</li>
            <li>You can do the steps in any order. The final check is last: 2 questions with no help, one on today’s topic and one on an older topic.</li>
            <li>A wrong answer does not add work today. It changes what you review next.</li>
            <li>After the day is done, more practice is optional: one more topic, or rounds of mixed questions.</li>
          </ul>
        </details>
      )}
    </div>
  );
}

function TaskRow({
  task,
  index,
  isCurrent,
  hrefFor,
}: {
  task: TodayStudyTask;
  index: number;
  isCurrent: boolean;
  hrefFor: (href: string) => string;
}) {
  const status = todayTaskStatus(task);
  const topicLine = todayTaskTopicLine(task);
  const verb = task.question_completed > 0 ? 'Continue' : 'Start';
  const picker = !task.completed && !task.locked && Boolean(task.topic_options?.length);
  // The current step already has the main button, so its row has no second link.
  const action = task.completed || picker ? null : task.locked ? (
    <span style={{ color: 'var(--text-secondary)', fontSize: '12.5px', fontWeight: 700 }}>Opens after the other steps.</span>
  ) : !isCurrent ? (
    <Link
      href={hrefFor(task.href)}
      className="btn-secondary"
      aria-label={`${verb}: ${task.title}`}
      style={{ display: 'inline-flex', alignItems: 'center', minHeight: '40px', padding: '6px 14px', textDecoration: 'none', fontSize: '14px', fontWeight: 750 }}
    >
      {verb} →
    </Link>
  ) : null;
  return (
    <li className="today-step" aria-current={isCurrent ? 'step' : undefined}>
      <span aria-hidden style={{ width: '30px', height: '30px', display: 'grid', placeItems: 'center', borderRadius: '50%', background: task.completed ? 'rgba(34,197,94,0.12)' : isCurrent ? 'rgba(99,102,241,0.14)' : 'var(--bg-secondary)', fontSize: '14px' }}>
        {task.completed ? '✓' : KIND_ICON[task.kind] || index + 1}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: '15px', margin: 0 }}>{task.title}</h3>
          {isCurrent && <span style={{ padding: '1px 7px', borderRadius: '999px', background: 'rgba(99,102,241,0.13)', color: 'var(--accent-color)', fontSize: '12px', fontWeight: 800 }}>Now</span>}
        </div>
        {topicLine && (
          <div style={{ marginTop: '2px', fontSize: '13px', fontWeight: 650, color: 'var(--text-primary)' }}>{topicLine}</div>
        )}
        {/* A finished step shows only its result; an open step says what to do and how long it takes. */}
        {!task.completed && (
          <div style={{ marginTop: '2px', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.45 }}>
            {task.reason}{' '}
            <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{todayTaskMeta(task)}</span>
          </div>
        )}
        {status && (
          <div style={{ marginTop: '2px', color: status.positive ? STATUS_COLOURS.positive : STATUS_COLOURS.pending, fontSize: '12.5px', fontWeight: 750 }}>
            {status.label}
          </div>
        )}
      </div>
      {action && <div className="today-step__action">{action}</div>}
      {picker && (
        <div className="today-step__wide">
          <TodayTopicPicker task={task} hrefFor={hrefFor} />
        </div>
      )}
    </li>
  );
}
