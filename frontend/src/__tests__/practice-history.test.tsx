import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../app/page';
import {
  fetchContentAvailability,
  fetchCurriculum,
  fetchDailySummary,
  fetchExercises,
  fetchHealth,
  fetchProgress,
  fetchRecommend,
} from '../lib/api';

vi.mock('../components/CurriculumTree', () => ({
  default: ({ masteredTopics }: { masteredTopics?: Set<string> }) => (
    <div data-testid="curriculum-ticks">{[...(masteredTopics ?? [])].sort().join(' ')}</div>
  ),
}));
vi.mock('../components/TutorInterface', () => ({
  default: ({ topic }: { topic: string }) => (
    <div data-testid="active-tutor-topic">{topic}</div>
  ),
}));
vi.mock('../components/FrameworkSubjectYearPicker', () => ({ default: () => <div>Picker</div> }));
vi.mock('../components/ThemeToggle', () => ({ default: () => null }));
vi.mock('../components/MoreToolsPanel', () => ({ default: () => null }));
vi.mock('../components/ProgressiveDisclosure', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../lib/preferences', () => ({
  getSubject: () => 'math',
  getYear: () => 'year7',
}));
vi.mock('../lib/student_id', () => ({
  getDisplayName: () => '',
  clearDisplayName: vi.fn(),
  clearToken: vi.fn(),
  TOKEN_STORAGE_KEY: 'student_token',
}));
vi.mock('../lib/toast', () => ({ showToast: vi.fn() }));
vi.mock('../lib/feature-flags', () => ({
  ENABLE_GUIDED_PRACTICE: true,
  ENABLE_LEARNING_MAP: true,
  ENABLE_SCIENCE_LAB: true,
}));
vi.mock('../lib/api', () => ({
  analyticsScopeFromYear: () => ({ yearLevel: 7 }),
  fetchContentAvailability: vi.fn(),
  fetchCurriculum: vi.fn(),
  fetchExercises: vi.fn(),
  fetchRecommend: vi.fn(),
  fetchProgress: vi.fn(),
  diagnosticDismiss: vi.fn(),
  fetchDailySummary: vi.fn(),
  fetchHealth: vi.fn(),
  fetchTodayPlan: vi.fn(async () => ({
    session_id: 'test', date: '2026-07-31', subject: 'math', scope: 'year7',
    estimated_minutes: 0, completed_tasks: 0, total_tasks: 0, complete: false,
    next_task_id: null, next_href: null, tasks: [],
  })),
  syllabusSubjectFromPickerSubject: () => undefined,
}));

const curriculum = {
  math: {
    year7: {
      sequence: ['AC9M7N01', 'AC9M7N02'],
      AC9M7N01: { name: 'Topic one', strand: 'Number' },
      AC9M7N02: { name: 'Topic two', strand: 'Number' },
    },
  },
};

const authoredAvailability = {
  by_subject: { math: 2 },
  by_year: { math: { year7: 2 } },
  by_unit: {},
};

beforeEach(() => {
  vi.mocked(fetchContentAvailability).mockResolvedValue(authoredAvailability);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Practice browser history', () => {
  it('re-applies URL scope to the visible topic on popstate', async () => {
    vi.mocked(fetchCurriculum).mockResolvedValue(curriculum as never);
    vi.mocked(fetchExercises).mockResolvedValue([]);
    vi.mocked(fetchRecommend).mockResolvedValue({ recommendation_type: 'forward' });
    vi.mocked(fetchProgress).mockResolvedValue([]);
    vi.mocked(fetchDailySummary).mockResolvedValue({ today_attempts: 0, daily_goal: 10 });
    vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', message: 'ok', llm_status: 'mock', cors_origins: [] });
    window.history.replaceState(null, '', '/?subject=math&year=year7&topic=AC9M7N01');

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('active-tutor-topic').textContent).toBe('AC9M7N01'));

    act(() => {
      window.history.pushState(null, '', '/?subject=math&year=year7&topic=AC9M7N02');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => expect(screen.getByTestId('active-tutor-topic').textContent).toBe('AC9M7N02'));
  });
});


describe('Practice first use', () => {
  it('does not activate a curriculum content shell without authored exercises', async () => {
    const shellCurriculum = {
      senior_english: {
        unit1: {
          sequence: ['QCAA_EN_U1_T1'],
          QCAA_EN_U1_T1: { name: 'Senior English topic' },
        },
      },
    };
    vi.mocked(fetchCurriculum).mockResolvedValue(shellCurriculum as never);
    vi.mocked(fetchContentAvailability).mockResolvedValue({
      by_subject: {},
      by_year: {},
      by_unit: {},
    });
    vi.mocked(fetchExercises).mockResolvedValue([]);
    vi.mocked(fetchRecommend).mockResolvedValue({} as never);
    vi.mocked(fetchProgress).mockResolvedValue([]);
    vi.mocked(fetchDailySummary).mockResolvedValue({ today_attempts: 0, daily_goal: 20 } as never);
    vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', message: 'ok', llm_status: 'live', cors_origins: [] });
    window.history.replaceState(null, '', '/?subject=senior_english&unit=1');

    render(<App />);

    await screen.findByText(/No authored practice is available for this course scope yet/i);
    expect(screen.getByTestId('active-tutor-topic').textContent).toBe('');
    expect(fetchExercises).not.toHaveBeenCalled();
  });

  it('waits for an explicit topic choice and shows guidance without a display name', async () => {
    vi.mocked(fetchCurriculum).mockResolvedValue(curriculum as never);
    vi.mocked(fetchExercises).mockResolvedValue([]);
    vi.mocked(fetchRecommend).mockResolvedValue({} as never);
    vi.mocked(fetchProgress).mockResolvedValue([]);
    vi.mocked(fetchDailySummary).mockResolvedValue({ today_attempts: 0, daily_goal: 20, streak_days: 0 } as never);
    vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', message: 'ok', llm_status: 'live', cors_origins: [] });
    window.history.replaceState(null, '', '/');

    render(<App />);

    await waitFor(() => expect(fetchCurriculum).toHaveBeenCalled());
    expect(screen.getByTestId('active-tutor-topic').textContent).toBe('');
    expect(fetchExercises).not.toHaveBeenCalled();
    expect(await screen.findByText('Here’s how to get started:')).toBeTruthy();
  });
});

describe('Practice curriculum ticks', () => {
  it('ticks only the topics that the server calls mastered', async () => {
    vi.mocked(fetchCurriculum).mockResolvedValue(curriculum as never);
    vi.mocked(fetchExercises).mockResolvedValue([]);
    vi.mocked(fetchRecommend).mockResolvedValue({} as never);
    vi.mocked(fetchProgress).mockResolvedValue([
      // One right short answer: BKT is high, but the mastery rule is not met.
      { topic: 'AC9M7N01', bkt_mastery: 0.861, status: 'promising' },
      // Mastered weeks ago: the current estimate fell, but mastery stays.
      { topic: 'AC9M7N02', bkt_mastery: 0.4, status: 'mastered' },
    ] as never);
    vi.mocked(fetchDailySummary).mockResolvedValue({ today_attempts: 0, daily_goal: 20 } as never);
    vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', message: 'ok', llm_status: 'live', cors_origins: [] });
    window.history.replaceState(null, '', '/?subject=math&year=year7');

    render(<App />);

    await waitFor(() => expect(fetchProgress).toHaveBeenCalled());
    await waitFor(() => {
      const trees = screen.getAllByTestId('curriculum-ticks');
      expect(trees.length).toBeGreaterThan(0);
      for (const tree of trees) expect(tree.textContent).toBe('AC9M7N02');
    });
  });
});
