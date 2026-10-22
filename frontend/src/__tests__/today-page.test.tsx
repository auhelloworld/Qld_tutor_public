import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TodayPage from '../app/today/page';
import { fetchTodayPlan } from '../lib/api';
import type { TodayStudyPlan, TodayStudyTask } from '../lib/api-types';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('../lib/api', () => ({ fetchTodayPlan: vi.fn() }));
vi.mock('../lib/preferences', () => ({
  getSubject: () => 'math',
  getYear: () => 'year7',
}));

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
    estimated_minutes: 25,
    remaining_minutes: 25,
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

const completedPlan = (tasks: TodayStudyTask[], overrides: Partial<TodayStudyPlan> = {}) => plan({
  question_completed: 9,
  remaining_minutes: 0,
  completed_tasks: tasks.length,
  total_tasks: tasks.length,
  complete: true,
  independent_secured: false,
  tasks,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/today?subject=math&year=year7');
  vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
    question_completed: 3,
    remaining_minutes: 8,
    next_task_id: 'focus',
    next_href: '/?today_task=focus',
    tasks: [task({
      id: 'focus',
      kind: 'focus',
      title: 'Practise on your own',
      reason: 'Practise until you get 3 of 4 right on your own (at most 10 questions).',
      estimated_minutes: 12,
      remaining_minutes: 8,
      question_target: 10,
      question_completed: 3,
    })],
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Today Study session controls', () => {
  it('shows Exit session in one place, before the title, and returns to scoped practice', async () => {
    render(<TodayPage />);

    // The accessible name matches the visible text.
    const exit = await screen.findByRole('link', { name: /Exit session/ });
    expect(exit.getAttribute('href')).toBe('/?subject=math&year=year7');
    expect(exit.getAttribute('title')).toContain('progress is saved');
    expect(exit.style.minHeight).toBe('44px');
    // It uses the site's back-link look and comes before the page title in reading order.
    expect(exit.style.color).toBe('var(--accent-color)');
    const title = screen.getByRole('heading', { name: 'Today’s Study', level: 1 });
    expect(exit.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no question-count choice: the steps stop on evidence', async () => {
    render(<TodayPage />);

    await screen.findByRole('heading', { name: 'Today’s Study', level: 1 });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(fetchTodayPlan).toHaveBeenCalledWith('math', 'year7', expect.anything());
    const taskLink = screen.getByRole('link', { name: /Continue: Practise on your own/i });
    expect(taskLink.getAttribute('href')).not.toContain('today_total');
    expect(decodeURIComponent(taskLink.getAttribute('href') || '')).toContain('return_to=/today?subject=math&year=year7');
  });

  it('shows steps and the time left, not a question total', async () => {
    render(<TodayPage />);

    expect(await screen.findByText('Step 1 of 1')).toBeTruthy();
    expect(screen.getByText('About 8 min left')).toBeTruthy();
    const steps = screen.getByRole('region', { name: 'Today session steps' });
    expect(within(steps).getByText('3 of up to 10 questions · about 8 min left')).toBeTruthy();
    const progress = screen.getByRole('progressbar', { name: 'Steps done today' });
    expect(progress.getAttribute('aria-valuetext')).toBe('0 of 1 steps done');
  });

  it('keeps the plan on screen while it refreshes after the tab returns', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    render(<TodayPage />);
    expect(await screen.findByRole('heading', { name: 'Today’s Study' })).toBeTruthy();

    vi.mocked(fetchTodayPlan).mockReturnValue(new Promise(() => {}));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(fetchTodayPlan).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('heading', { name: 'Today’s Study' })).toBeTruthy();
    expect(screen.queryByText(/Loading Today’s Study/)).toBeNull();
    visibility.mockRestore();
  });

  it('keeps the plan and offers a retry when a refresh fails', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    render(<TodayPage />);
    expect(await screen.findByRole('heading', { name: 'Today’s Study' })).toBeTruthy();

    vi.mocked(fetchTodayPlan).mockRejectedValueOnce(new Error('offline'));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not refresh/i);
    expect(screen.getByRole('heading', { name: 'Today’s Study' })).toBeTruthy();
    visibility.mockRestore();
  });

  it('does not nest a second main landmark inside the layout', async () => {
    render(<TodayPage />);
    await screen.findByRole('heading', { name: 'Today’s Study' });
    expect(screen.queryByRole('main')).toBeNull();
  });
});

describe('Today Study content', () => {
  it('uses the new topic’s “I can” statement as the goal', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      goal: 'I can find square roots of perfect squares.',
      next_task_id: 'focus',
      next_href: '/guided-practice?today_task=focus',
      tasks: [task({ id: 'focus', kind: 'focus', title: 'Learn something new', question_target: 10 })],
    }));

    render(<TodayPage />);

    const goal = await screen.findByRole('complementary', { name: 'Today’s goal' });
    expect(goal.textContent).toContain('I can find square roots of perfect squares.');
  });

  it('shows maths in the goal as maths, also in the learning receipt', async () => {
    const latexGoal = 'I can expand $(a+b)^n$ for small $n$.';
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      goal: latexGoal,
      next_task_id: 'focus',
      next_href: '/today/practice?today_task=focus',
      tasks: [task({ id: 'focus', kind: 'focus', title: 'Learn something new', question_target: 10 })],
    }));

    const { unmount } = render(<TodayPage />);

    const goal = await screen.findByRole('complementary', { name: 'Today’s goal' });
    expect(goal.querySelector('.katex')).not.toBeNull();
    expect(goal.textContent).not.toContain('$');
    unmount();

    vi.mocked(fetchTodayPlan).mockResolvedValue(completedPlan(
      [task({ id: 'exit', kind: 'exit', question_target: 2, question_completed: 2, completed: true })],
      { goal: latexGoal },
    ));
    render(<TodayPage />);

    const receipt = await screen.findByRole('region', { name: 'Learning receipt' });
    expect(receipt.querySelector('.katex')).not.toBeNull();
    expect(receipt.textContent).not.toContain('$');
  });

  it('shows the study scope, topic names, and a goal built from the final check topics', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      total_tasks: 2,
      next_task_id: 'revision',
      next_href: '/?today_task=revision',
      tasks: [
        task({
          id: 'revision', kind: 'revision', title: 'Review topics that are due',
          question_target: 4, topic_ids: ['AC9M7N01', 'AC9M7N02'],
          topic_names: ['Squares and square roots', 'Prime factorisation'],
        }),
        task({
          id: 'exit', kind: 'exit', title: 'Final check: 2 questions on your own',
          question_target: 2, topic_ids: ['AC9M7N01', 'AC9M7N02'],
          topic_names: ['Squares and square roots', 'Prime factorisation'],
        }),
      ],
    }));

    render(<TodayPage />);

    expect(await screen.findByText('Year 7 Mathematics')).toBeTruthy();
    const goal = screen.getByRole('complementary', { name: 'Today’s goal' });
    expect(goal.textContent).toContain(
      'I can get a question on Squares and square roots and a question on Prime factorisation right the first time, with no help.',
    );
    const steps = screen.getByRole('region', { name: 'Today session steps' });
    expect(within(steps).getAllByText('Squares and square roots · Prime factorisation')).toHaveLength(2);
    expect(within(steps).getByRole('heading', { name: 'Review topics that are due', level: 3 })).toBeTruthy();
  });

  it('labels a finished reflection step as a reflection, not as evidence', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      total_tasks: 2,
      completed_tasks: 1,
      next_task_id: 'exit',
      next_href: '/?today_task=exit',
      tasks: [
        task({
          id: 'cause', kind: 'mistake', title: 'Find out why an answer was wrong',
          question_target: 0, question_completed: 0,
          completed: true, independent_secured: true,
          closure_stage: 'needs_understanding',
        }),
        task({ id: 'exit', kind: 'exit', title: 'Final check', question_target: 2 }),
      ],
    }));

    render(<TodayPage />);

    expect(await screen.findByText('Reflection recorded')).toBeTruthy();
    expect(screen.queryByText(/Done on your own|evidence secured/i)).toBeNull();
  });
});

describe('Today Study completion', () => {
  it('shows the next review date from the plan in the learning receipt', async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const format = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    vi.mocked(fetchTodayPlan).mockResolvedValue(completedPlan(
      [task({ id: 'exit', kind: 'exit', question_target: 2, question_completed: 2, completed: true, independent_correct_count: 1 })],
      { next_review_at: future.toISOString() },
    ));

    render(<TodayPage />);

    const receipt = await screen.findByRole('region', { name: 'Learning receipt' });
    expect(receipt.textContent).toContain(format.format(future));
    expect(receipt.textContent).toContain('1/2');
    expect(within(receipt).getByRole('heading', { name: 'What you showed today', level: 2 })).toBeTruthy();
  });

  it('says the day is done and keeps free practice as a small link', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(completedPlan([
      task({ id: 'exit', kind: 'exit', question_target: 2, question_completed: 2, completed: true }),
    ]));

    render(<TodayPage />);

    expect(await screen.findByText('You can stop here. Your next review is planned.')).toBeTruthy();
    const done = await screen.findByRole('region', { name: 'Done for today' });
    // Other subjects start from the home page. A link to /today with another
    // subject kept the old plan until a reload: the page reads its URL once.
    expect(screen.queryByRole('link', { name: /Today’s Study →/ })).toBeNull();
    const practice = within(done).getByRole('link', { name: /Practise a topic you choose/ });
    expect(practice.getAttribute('href')).toBe('/?subject=math&year=year7');
    expect(practice.className).not.toContain('btn');
  });
});

describe('Today Study diagnostic-day completion', () => {
  it('does not claim independent evidence or a met goal after a diagnostic', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      session_id: 'diag-day', estimated_minutes: 30, remaining_minutes: 0, question_completed: 12,
      completed_tasks: 1, total_tasks: 1, complete: true, independent_secured: true,
      tasks: [task({
        id: 'diag', kind: 'diagnostic', title: 'Review today’s diagnostic results', reason: 'Diagnostic',
        estimated_minutes: 30, remaining_minutes: 0, completed: true,
        independent_secured: true, question_target: 12, question_completed: 12,
        href: '/diagnostic',
      })],
    }));

    render(<TodayPage />);

    expect(await screen.findByText('Diagnostic completed')).toBeTruthy();
    expect(screen.queryByText(/Done on your own|evidence secured/i)).toBeNull();
    expect(screen.queryByText(/Goal met/i)).toBeNull();
  });
});

describe('Today Study choices', () => {
  const option = (id: string, name: string, extra: Partial<TodayStudyTask> = {}) => task({
    id: `focus-${id}`, kind: 'focus', title: 'Learn something new', question_target: 10,
    href: `/today/practice?today_task=focus-${id}`, topic_id: id, topic_ids: [id], topic_names: [name], ...extra,
  });

  it('lets the student start any open step; the final check opens last', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      total_tasks: 3,
      next_task_id: 'review',
      next_href: '/today/practice?today_task=review',
      tasks: [
        task({ id: 'review', kind: 'revision', title: 'Review a topic that is due', href: '/today/practice?today_task=review', question_target: 2 }),
        task({ id: 'focus', kind: 'focus', title: 'Learn something new', href: '/today/practice?today_task=focus', question_target: 10 }),
        task({ id: 'exit', kind: 'exit', title: 'Final check: 2 questions on your own', href: '/today/practice?today_task=exit', question_target: 2, locked: true }),
      ],
    }));

    render(<TodayPage />);

    const steps = await screen.findByRole('region', { name: 'Today session steps' });
    // The current step (review) has the main button; another open step has its own link.
    expect(screen.getByRole('link', { name: /Start: Review a topic that is due/ }).getAttribute('href'))
      .toContain('today_task=review');
    expect(within(steps).getByRole('link', { name: 'Start: Learn something new' }).getAttribute('href'))
      .toContain('today_task=focus');
    expect(within(steps).queryByRole('link', { name: /Final check/ })).toBeNull();
    expect(within(steps).getByText('Opens after the other steps.')).toBeTruthy();
  });

  it('lets the student choose another topic for the new topic step', async () => {
    vi.mocked(fetchTodayPlan).mockResolvedValue(plan({
      next_task_id: 'focus-T1',
      next_href: '/today/practice?today_task=focus-T1',
      tasks: [option('T1', 'Squares', {
        topic_options: [
          option('T1', 'Squares', { recommended: true }),
          option('T2', 'Primes', { missing_prerequisites: ['T1'], missing_prerequisite_names: ['Squares'] }),
          option('T3', 'Powers', { mastered: true }),
        ],
      })],
    }));

    render(<TodayPage />);

    const steps = await screen.findByRole('region', { name: 'Today session steps' });
    const select = within(steps).getByLabelText('Choose a topic');
    expect(within(select).getAllByRole('option').map(item => item.textContent))
      .toEqual(['Squares (suggested)', 'Primes', 'Powers (mastered)']);
    expect(within(steps).getByRole('link', { name: 'Start: Squares' }).getAttribute('href')).toContain('today_task=focus-T1');

    fireEvent.change(select, { target: { value: 'focus-T2' } });

    expect(within(steps).getByText('This topic builds on Squares. It is easier to learn that first.')).toBeTruthy();
    expect(within(steps).getByRole('link', { name: 'Start: Primes' }).getAttribute('href')).toContain('today_task=focus-T2');
  });

  it('offers more practice after the day is done', async () => {
    const extra = task({
      id: 'extra-T4', kind: 'extra', title: 'Learn one more topic', question_target: 10,
      href: '/today/practice?today_task=extra-T4', topic_ids: ['T4'], topic_names: ['Ratios'],
      topic_options: [
        task({ id: 'extra-T4', kind: 'extra', title: 'Learn one more topic', href: '/today/practice?today_task=extra-T4', topic_ids: ['T4'], topic_names: ['Ratios'], recommended: true }),
        task({ id: 'extra-T5', kind: 'extra', title: 'Learn one more topic', href: '/today/practice?today_task=extra-T5', topic_ids: ['T5'], topic_names: ['Angles'] }),
      ],
    });
    const mixed = task({
      id: 'mixed', kind: 'mixed', title: 'Mixed practice', question_target: 4,
      href: '/today/practice?today_task=mixed', topic_ids: ['T1'], topic_names: ['Squares'],
    });
    vi.mocked(fetchTodayPlan).mockResolvedValue(completedPlan(
      [task({ id: 'exit', kind: 'exit', question_target: 2, question_completed: 2, completed: true })],
      { more_practice: [extra, mixed] },
    ));

    render(<TodayPage />);

    const more = await screen.findByRole('region', { name: 'More practice' });
    expect(within(more).getByText('Optional. Stop when you like.')).toBeTruthy();
    expect(within(more).getByLabelText('Choose a topic')).toBeTruthy();
    expect(within(more).getByRole('link', { name: 'Start: Ratios' }).getAttribute('href')).toContain('today_task=extra-T4');
    expect(within(more).getByRole('link', { name: 'Start: Mixed practice' }).getAttribute('href')).toContain('today_task=mixed');
  });
});
