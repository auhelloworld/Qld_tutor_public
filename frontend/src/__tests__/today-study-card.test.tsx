import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TodayStudyCard from '../components/TodayStudyCard';
import TodaySessionBar from '../components/TodaySessionBar';
import { fetchTodayPlan } from '../lib/api';
import type { TodayStudyPlan, TodayStudyTask } from '../lib/api-types';

vi.mock('next/link', () => ({
  // The marker shows which links use client-side navigation.
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href} data-next-link="true">{children}</a>,
}));

vi.mock('../lib/api', () => ({ fetchTodayPlan: vi.fn() }));

function task(overrides: Partial<TodayStudyTask> & Pick<TodayStudyTask, 'id' | 'kind'>): TodayStudyTask {
  return {
    title: 'Task',
    reason: 'Reason',
    estimated_minutes: 4,
    remaining_minutes: 4,
    question_target: 1,
    question_completed: 0,
    completed: false,
    href: `/?today_task=${overrides.id}`,
    ...overrides,
  };
}

function plan(overrides: Partial<TodayStudyPlan>): TodayStudyPlan {
  return {
    session_id: '2026-10-18:math:year7',
    date: '2026-10-18',
    subject: 'math',
    scope: 'year7',
    estimated_minutes: 20,
    remaining_minutes: 20,
    question_completed: 0,
    completed_tasks: 0,
    total_tasks: 1,
    complete: false,
    independent_secured: false,
    next_task_id: null,
    next_href: null,
    tasks: [],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Today's study card", () => {
  it('offers one-click start and shows the steps on request', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      remaining_minutes: 18,
      total_tasks: 3,
      next_task_id: 'revision',
      next_href: '/?today_task=revision',
      tasks: [
        task({ id: 'revision', kind: 'revision', title: 'Review topics that are due', reason: 'Due now', question_target: 2, topic_names: ['Squares and square roots'] }),
        task({ id: 'mistake', kind: 'mistake', title: 'Redo one mistake on your own', reason: 'Close the loop', href: '/mistakes' }),
        task({ id: 'focus', kind: 'focus', title: 'Practise on your own', reason: 'Next topic', question_target: 10 }),
      ],
    }));

    render(<TodayStudyCard subject="math" year="year7" refreshTrigger={0} />);

    const start = await screen.findByRole('link', { name: /Start Today’s Study/i });
    expect(start.getAttribute('href')).toBe('/today?subject=math&year=year7');
    expect(screen.getByRole('heading', { name: 'About 18 min left' })).toBeTruthy();
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    // No question total: the steps stop on evidence.
    expect(screen.queryByText(/questions · about/)).toBeNull();
    expect(screen.queryByText('Review topics that are due')).toBeNull();

    const toggle = screen.getByRole('button', { name: 'Show steps' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Hide steps');
    const list = document.getElementById(toggle.getAttribute('aria-controls') || '');
    expect(list?.tagName).toBe('OL');
    expect(screen.getByText('Review topics that are due')).toBeTruthy();
    expect(screen.getByText('Squares and square roots')).toBeTruthy();
    expect(screen.getByText('Redo one mistake on your own')).toBeTruthy();
    expect(screen.getByText('0 of up to 10 questions · about 4 min left')).toBeTruthy();
  });

  it('asks for the plan without a question target', async () => {
    localStorage.setItem('qld_today_question_target', '25');
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      next_task_id: 'focus',
      tasks: [task({ id: 'focus', kind: 'focus', question_target: 10 })],
    }));

    render(<TodayStudyCard subject="math" year="year7" refreshTrigger={0} />);

    await screen.findByRole('link', { name: /Start Today’s Study/i });
    expect(vi.mocked(fetchTodayPlan).mock.calls[0]).toHaveLength(3);
    expect(fetchTodayPlan).toHaveBeenCalledWith('math', 'year7', expect.anything());
  });

  it('continues from the next unfinished step after refresh', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      remaining_minutes: 9,
      question_completed: 4,
      completed_tasks: 1,
      total_tasks: 2,
      next_task_id: 'focus',
      next_href: '/?today_task=focus',
      tasks: [
        task({ id: 'done', kind: 'mistake', title: 'Done', completed: true, question_completed: 1, remaining_minutes: 0, href: '/mistakes' }),
        task({ id: 'focus', kind: 'focus', title: 'Focus', question_target: 10, question_completed: 3, remaining_minutes: 9 }),
      ],
    }));

    render(<TodayStudyCard subject="math" year="year7" refreshTrigger={2} />);

    await waitFor(() => expect(fetchTodayPlan).toHaveBeenCalled());
    const link = await screen.findByRole('link', { name: /Continue Today’s Study/i });
    expect(link.getAttribute('href')).toBe('/today?subject=math&year=year7');
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    const progress = screen.getByRole('progressbar', { name: "Today's study progress" });
    expect(progress.getAttribute('aria-valuetext')).toBe('1 of 2 steps done');
  });

  it('labels a finished reflection step as a reflection', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      completed_tasks: 1,
      total_tasks: 2,
      next_task_id: 'exit',
      next_href: '/?today_task=exit',
      tasks: [
        task({ id: 'cause', kind: 'mistake', title: 'Find out why an answer was wrong', question_target: 0, completed: true, independent_secured: true, href: '/mistakes' }),
        task({ id: 'exit', kind: 'exit', title: 'Final check: 2 questions on your own', question_target: 2 }),
      ],
    }));

    render(<TodayStudyCard subject="math" year="year7" refreshTrigger={0} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Show steps' }));
    expect(screen.getByText('Reflection recorded')).toBeTruthy();
    expect(screen.queryByText(/evidence secured|Done on your own/i)).toBeNull();
  });

  it('separates a finished day from independent evidence', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      remaining_minutes: 0,
      question_completed: 8,
      completed_tasks: 2,
      total_tasks: 2,
      complete: true,
      independent_secured: false,
      tasks: [
        task({ id: 'focus', kind: 'focus', question_target: 10, question_completed: 6, completed: true, independent_secured: true, remaining_minutes: 0 }),
        task({ id: 'exit', kind: 'exit', question_target: 2, question_completed: 2, completed: true, remaining_minutes: 0 }),
      ],
    }));

    render(<TodayStudyCard subject="math" year="year7" refreshTrigger={0} />);

    expect(await screen.findByText('Today’s Study is done')).toBeTruthy();
    expect(screen.getByText('Done · more review planned')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Start|Continue Today/i })).toBeNull();
  });

  it('says the goal is met only when the final check is secured', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      remaining_minutes: 0,
      completed_tasks: 1,
      total_tasks: 1,
      complete: true,
      independent_secured: true,
      tasks: [task({ id: 'exit', kind: 'exit', question_target: 2, question_completed: 2, completed: true, independent_secured: true })],
    }));

    render(<TodayStudyCard subject="math" year="year7" refreshTrigger={0} />);

    expect(await screen.findByText('Done · goal met')).toBeTruthy();
  });

  it('shows a recoverable error instead of silently removing today’s study', async () => {
    vi.mocked(fetchTodayPlan)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(plan({
        next_task_id: 'focus',
        tasks: [task({ id: 'focus', kind: 'focus', question_target: 10 })],
      }));

    render(<TodayStudyCard subject="math" year="year7" refreshTrigger={0} />);

    expect(await screen.findByText("Today's study could not load")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retry today['’]s study/i }));

    expect(await screen.findByRole('link', { name: /Start Today’s Study/i })).toBeTruthy();
    expect(fetchTodayPlan).toHaveBeenCalledTimes(2);
  });
});

describe('Today session bar', () => {
  it('keeps Today session progress retryable when refresh fails', async () => {
    vi.mocked(fetchTodayPlan)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(plan({
        next_task_id: 'focus',
        tasks: [task({ id: 'focus', kind: 'focus', question_target: 10, question_completed: 2 })],
      }));

    render(<TodaySessionBar subject="math" year="year7" activeTaskId="focus" />);

    expect(await screen.findByText(/Today['’]s progress could not refresh/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('link', { name: /Today’s plan/i })).toBeTruthy();
    expect(fetchTodayPlan).toHaveBeenCalledTimes(2);
  });

  it('shows the step, the time left and the answers in the active step', async () => {
    window.history.replaceState({}, '', '/guided-practice?today_session=1&today_task=focus');
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      remaining_minutes: 8,
      question_completed: 4,
      next_task_id: 'focus',
      next_href: '/guided-practice?today_task=focus',
      tasks: [task({ id: 'focus', kind: 'focus', title: 'Practise on your own', question_target: 10, question_completed: 4, remaining_minutes: 8 })],
    }));

    render(<TodaySessionBar subject="math" year="year7" activeTaskId="focus" />);

    const link = await screen.findByRole('link', { name: /Today’s plan/i });
    expect(fetchTodayPlan).toHaveBeenCalledWith('math', 'year7', expect.anything());
    expect(link.getAttribute('href')).toBe('/today?subject=math&year=year7');
    expect(screen.getByText('Step 1 of 1 · about 8 min left · 4 done in this step')).toBeTruthy();
    const progress = screen.getByRole('progressbar', { name: 'Steps done today' });
    expect(progress.getAttribute('aria-valuetext')).toBe('0 of 1 steps done');
  });

  it('reports each loaded plan to the practice page', async () => {
    const loaded = plan({
      remaining_minutes: 0,
      question_completed: 2,
      completed_tasks: 1,
      complete: true,
      tasks: [task({ id: 'exit', kind: 'exit', question_target: 2, question_completed: 2, completed: true })],
    });
    vi.mocked(fetchTodayPlan).mockResolvedValue(loaded);
    const onPlanChange = vi.fn();

    render(<TodaySessionBar subject="math" year="year7" activeTaskId="exit" onPlanChange={onPlanChange} />);

    await waitFor(() => expect(onPlanChange).toHaveBeenCalledWith(loaded));
  });

  it('opens the next step with a full page load, because it can be on the same page', async () => {
    // Practice pages read their Today task from the URL when they load. A
    // client-side navigation to the same route keeps the old task, so answers
    // would be recorded against the finished task.
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      completed_tasks: 1,
      total_tasks: 2,
      next_task_id: 'exit',
      next_href: '/?today_task=exit&today_kind=exit',
      tasks: [
        task({ id: 'revision', kind: 'revision', title: 'Review topics that are due', question_target: 4, question_completed: 3, completed: true }),
        task({ id: 'exit', kind: 'exit', title: 'Final check: 2 questions on your own', question_target: 2, href: '/?today_task=exit&today_kind=exit' }),
      ],
    }));

    render(<TodaySessionBar subject="math" year="year7" activeTaskId="revision" />);

    const next = await screen.findByRole('link', { name: /Next: Final check/ });
    expect(next.getAttribute('href')).toContain('today_task=exit');
    expect(next.getAttribute('data-next-link')).toBeNull();
  });

  it('names a more practice step after the day is done', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      remaining_minutes: 0,
      completed_tasks: 1,
      complete: true,
      tasks: [task({ id: 'exit', kind: 'exit', question_target: 2, question_completed: 2, completed: true })],
      more_practice: [task({ id: 'mixed', kind: 'mixed', title: 'Mixed practice', question_target: 4, question_completed: 1 })],
    }));

    render(<TodaySessionBar subject="math" year="year7" activeTaskId="mixed" />);

    expect(await screen.findByText('More practice: Mixed practice')).toBeTruthy();
    // More practice is not one of the day's steps.
    expect(screen.getByText('Optional · 1 done in this step')).toBeTruthy();
  });
});

describe('Diagnostic-day completion wording', () => {
  // Completing a diagnostic proves the assessment was taken, not that learning
  // was secured: answers can be wrong and still complete it.
  const diagnosticPlan = plan({
    session_id: 'diag-day',
    estimated_minutes: 30,
    remaining_minutes: 0,
    question_completed: 12,
    completed_tasks: 1,
    complete: true,
    independent_secured: true,
    tasks: [task({
      id: 'diag', kind: 'diagnostic', title: 'Review today’s diagnostic results', reason: 'Diagnostic',
      estimated_minutes: 30, remaining_minutes: 0, completed: true,
      independent_secured: true, question_target: 12, question_completed: 12,
      href: '/diagnostic',
    })],
  });

  it('says the diagnostic is complete instead of claiming secured evidence on the home card', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(diagnosticPlan);

    render(<TodayStudyCard subject="math" year="year7" refreshTrigger={0} />);

    expect(await screen.findByText('Done · diagnostic results are ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show steps' }));
    expect(screen.getByText('Diagnostic completed')).toBeTruthy();
    expect(screen.queryByText(/evidence secured|goal met/i)).toBeNull();
  });

  it('says the diagnostic is complete in the Today session bar', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(diagnosticPlan);

    render(<TodaySessionBar subject="math" year="year7" activeTaskId="diag" />);

    expect(await screen.findByText('Diagnostic complete')).toBeTruthy();
    expect(screen.queryByText(/evidence secured|goal met/i)).toBeNull();
  });
});
