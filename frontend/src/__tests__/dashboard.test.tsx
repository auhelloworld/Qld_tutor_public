import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Dashboard from '../app/dashboard/page';
import { fetchMisconceptions, fetchProgressSummary } from '../lib/api';
import type { TopicProgress } from '../lib/api-types';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock('../components/FrameworkSubjectYearPicker', () => ({
  default: ({ value }: { value: { subject: string; year: string } }) => (
    <div data-testid="subject-year-picker">{value.subject} {value.year}</div>
  ),
}));

vi.mock('../lib/preferences', () => ({
  getSubject: () => 'math',
  getYear: () => 'year7',
  getNavView: () => 'learning',
  setNavView: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  API_BASE: 'http://localhost:8000/api',
  analyticsScopeFromYear: vi.fn(() => ({ yearLevel: 7 })),
  fetchCurriculum: vi.fn(async () => ({
    math: {
      year7: {
        AC9M7N01: { topic_id: 'AC9M7N01', name: 'Topic One', strand: 'Number' },
        AC9M7N02: { topic_id: 'AC9M7N02', name: 'Topic Two', strand: 'Number' },
      },
    },
  })),
  fetchProgressSummary: vi.fn(async () => ({ topics: [], total_direct_attempts: 0 })),
  fetchStudyPlans: vi.fn(async () => ({ plans: {} })),
  fetchMisconceptions: vi.fn(async () => []),
  fetchDailySummary: vi.fn(async () => ({
    today_attempts: 5,
    today_correct: 4,
    today_accuracy: 80,
    daily_goal: 20,
    streak_days: 2,
    streak_message: '2 day streak',
  })),
  fetchWeeklyLearningSummary: vi.fn(async () => null),
  safeFetch: vi.fn(),
  syllabusSubjectFromPickerSubject: vi.fn(() => undefined),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function progressSummary(topics: TopicProgress[]) {
  const directKeys = new Set(
    topics
      .filter(topic => topic.direct_attempts_count === undefined || topic.direct_attempts_count > 0)
      .flatMap(topic => topic.scored_attempt_keys ?? []),
  );
  return { topics, total_direct_attempts: directKeys.size };
}

describe('Dashboard analytics summary', () => {
  it('counts unique physical scored attempts and does not master a thin high-BKT signal', async () => {
    vi.mocked(fetchProgressSummary).mockResolvedValueOnce(progressSummary([
      {
        topic: 'AC9M7N01', bkt_mastery: 0.95, accuracy: 1, attempts_count: 2,
        evidence_count: 1, confidence: 'low', status: 'promising',
        scored_attempt_keys: ['event-1'], top_errors: {},
      },
      {
        topic: 'AC9M7N02', bkt_mastery: 0.9, accuracy: 1, attempts_count: 2,
        evidence_count: 2, confidence: 'low', status: 'promising',
        scored_attempt_keys: ['event-1', 'event-2'], top_errors: {},
      },
    ] satisfies TopicProgress[]));

    render(<Dashboard />);

    expect(await screen.findByText('2 direct attempts')).toBeTruthy();
    expect(screen.getByText(/Physical scored events, excluding strand estimates/i)).toBeTruthy();
    expect(screen.getByText('0/2 topics')).toBeTruthy();
    expect(screen.getAllByText('Promising early signal').length).toBeGreaterThan(0);
  });

  it('separates direct coverage from inferred strand estimates and recommends a directly tested topic', async () => {
    vi.mocked(fetchProgressSummary).mockResolvedValueOnce(progressSummary([
      {
        topic: 'AC9M7N01', bkt_mastery: 0.55, accuracy: 1, attempts_count: 1,
        evidence_count: 1, direct_attempts_count: 0, diagnostic_attempts_count: 1,
        confidence: 'low', status: 'promising', scored_attempt_keys: ['pseudo-1'],
        diagnostic_evidence: { direct_questions: 0, inferred_from_strand: true, confidence: 'low' },
        top_errors: { concept_gap: 1 },
      },
      {
        topic: 'AC9M7N02', bkt_mastery: 0.4, accuracy: 0.5, attempts_count: 1,
        evidence_count: 1, direct_attempts_count: 1, diagnostic_attempts_count: 0,
        confidence: 'low', status: 'emerging', scored_attempt_keys: ['event-2'],
        diagnostic_evidence: null, top_errors: {},
      },
    ] satisfies TopicProgress[]));

    render(<Dashboard />);

    expect(await screen.findByText('1/2 direct')).toBeTruthy();
    expect(screen.getByText('1 estimated · 0 not started')).toBeTruthy();
    expect(screen.getByText('1 direct attempt')).toBeTruthy();
    expect(screen.getByText(/Continue with .*Topic Two/i)).toBeTruthy();
    expect(screen.getAllByText('Not directly tested').length).toBeGreaterThan(0);
    expect(screen.getByText('No direct accuracy yet')).toBeTruthy();
    expect(screen.getByText('Practise to confirm →')).toBeTruthy();
  });

  it('displays backend daily accuracy percentage without multiplying it again', async () => {
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText(/80% accuracy/)).toBeTruthy();
    });
    expect(screen.queryByText(/8000% accuracy/)).toBeNull();
    expect(screen.getByText('Across all subjects today')).toBeTruthy();
  });

  it('does not count Show Answer-only evidence as direct coverage or recommend it', async () => {
    vi.mocked(fetchProgressSummary).mockResolvedValueOnce(progressSummary([{
      topic: 'AC9M7N01', bkt_mastery: 0.99, accuracy: 1, attempts_count: 3,
      evidence_count: 3, direct_attempts_count: 0, diagnostic_attempts_count: 0,
      confidence: 'low', status: 'promising', scored_attempt_keys: ['shown-1', 'shown-2', 'shown-3'],
      diagnostic_evidence: null, top_errors: {},
    }] satisfies TopicProgress[]));

    render(<Dashboard />);

    expect(await screen.findByText('0/1 direct')).toBeTruthy();
    expect(screen.getByText('0 direct attempts')).toBeTruthy();
    expect(screen.queryByText('Recommended next step')).toBeNull();
    expect(screen.getByText('0 direct evidence')).toBeTruthy();
  });

  it('shows a retryable error instead of a false no-data state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(fetchProgressSummary)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(progressSummary([]));

    render(<Dashboard />);

    expect((await screen.findByRole('alert')).textContent).toContain('Analytics unavailable');
    expect(screen.queryByText(/No learning data/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/No learning data for Year 7/i)).toBeTruthy();
    expect(fetchProgressSummary).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it('keeps core analytics visible when optional misconception guidance fails', async () => {
    vi.mocked(fetchMisconceptions).mockRejectedValueOnce(new Error('taxonomy offline'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Dashboard />);

    expect(await screen.findByText(/No learning data for Year 7/i)).toBeTruthy();
    expect(screen.getByText(/Optional misconception guidance is unavailable/i)).toBeTruthy();
    expect(screen.queryByText('Analytics unavailable')).toBeNull();
    consoleWarn.mockRestore();
  });

  it('exposes selected sort state and mastery progress semantics', async () => {
    vi.mocked(fetchProgressSummary).mockResolvedValueOnce(progressSummary([{
      topic: 'AC9M7N01', bkt_mastery: 0.55, accuracy: 0.75, attempts_count: 3,
      evidence_count: 3, direct_attempts_count: 3, confidence: 'medium', status: 'developing',
      scored_attempt_keys: ['a', 'b', 'c'], top_errors: {},
    }] satisfies TopicProgress[]));

    render(<Dashboard />);

    expect((await screen.findByRole('button', { name: 'Weakest first' })).getAttribute('aria-pressed')).toBe('true');
    const progressbar = screen.getByRole('progressbar', { name: /Current mastery for .*Topic One/i });
    expect(progressbar.getAttribute('aria-valuenow')).toBe('55');
    expect(progressbar.getAttribute('aria-valuetext')).toBe('Developing');
  });

  it('exposes the Interactive Maths Lab tool entry', async () => {
    render(<Dashboard />);

    const link = await screen.findByRole('link', { name: /Interactive Maths Lab/i });
    expect(link.getAttribute('href')).toBe('/lab');
  });
});
