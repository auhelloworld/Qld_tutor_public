import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  examStart: vi.fn(),
  examSave: vi.fn(),
  examSaveOnExit: vi.fn(),
  examSubmit: vi.fn(),
  examHistory: vi.fn(),
  examActive: vi.fn(async () => ({ active: null })),
  examResume: vi.fn(),
  examDiscard: vi.fn(),
  examListPapers: vi.fn(),
  fetchContentAvailability: vi.fn(),
  fetchCurriculum: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  ...api,
  analyticsScopeFromYear: () => ({ yearLevel: 7 }),
  syllabusSubjectFromPickerSubject: () => undefined,
}));
vi.mock('../lib/preferences', () => ({
  getSubject: () => 'math',
  getYear: () => 'year7',
}));
vi.mock('../lib/toast', () => ({ showToast: vi.fn() }));
vi.mock('../components/exam/ExamSetup', () => ({
  default: ({ handleStart }: { handleStart: () => void }) => (
    <button onClick={handleStart}>Start test exam</button>
  ),
}));
vi.mock('../components/exam/ExamInProgress', () => ({
  default: ({
    responses,
    setResponses,
    timeLeft,
    handleSubmit,
    submitError,
    saveStatus,
    saveError,
    onRetryAutosave,
  }: {
    responses: Record<string, string>;
    setResponses: Dispatch<SetStateAction<Record<string, string>>>;
    timeLeft: number;
    handleSubmit: () => void;
    submitError?: string | null;
    saveStatus?: string;
    saveError?: string | null;
    onRetryAutosave?: () => void;
  }) => (
    <div>
      <output data-testid="time-left">{timeLeft}</output>
      <output data-testid="save-status">{saveStatus || 'idle'}</output>
      <input
        aria-label="Exam answer"
        value={responses.q1 || ''}
        onChange={event => setResponses(previous => ({ ...previous, q1: event.target.value }))}
      />
      {submitError && <div role="alert">{submitError}</div>}
      {saveError && <div role="alert">{saveError}</div>}
      {saveStatus === 'retry_queued' && (
        <button onClick={onRetryAutosave}>Retry autosave</button>
      )}
      <button onClick={handleSubmit}>Submit test exam</button>
    </div>
  ),
}));
vi.mock('../components/exam/ExamResults', () => ({ default: () => <div>Exam results</div> }));

import ExamPage from '../app/exam/page';

// The page reopens the exam stored for this tab; keep each test independent.
beforeEach(() => sessionStorage.clear());

const question = {
  id: 'q1',
  question: 'What is 2 + 2?',
  question_type: 'short_answer' as const,
  difficulty: 'foundational',
  complexity: null,
  topic_ids: ['AC9M7N01'],
};

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ExamPage reliability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.clearAllMocks();
    api.fetchCurriculum.mockResolvedValue({});
    api.fetchContentAvailability.mockResolvedValue({});
    api.examHistory.mockResolvedValue([]);
    api.examListPapers.mockResolvedValue([]);
    api.examSave.mockResolvedValue({ ok: true });
    api.examSaveOnExit.mockReturnValue(true);
    api.examStart.mockResolvedValue({
      exam_id: 'exam-1',
      questions: [question],
      total_questions: 1,
      time_limit_minutes: 1,
      deadline_at: '2026-01-01T00:01:00Z',
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('restarts the absolute-deadline timer and shows retry UI after submit fails', async () => {
    api.examSubmit.mockRejectedValue(new Error('offline'));
    render(<ExamPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Start test exam' }));
    await flushPromises();
    expect(screen.getByTestId('time-left').textContent).toBe('60');

    fireEvent.click(screen.getByRole('button', { name: 'Submit test exam' }));
    await flushPromises();
    expect(screen.getByRole('alert').textContent).toContain('Failed to submit exam');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('time-left').textContent).toBe('59');
  });

  it('flushes only the changed response through the exit keepalive path', async () => {
    api.examStart.mockResolvedValue({
      exam_id: 'exam-1',
      questions: [question],
      total_questions: 1,
      time_limit_minutes: 1,
      deadline_at: '2026-01-01T00:01:00Z',
      responses: { q1: 'old', q2: 'same' },
    });
    render(<ExamPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Start test exam' }));
    await flushPromises();
    fireEvent.change(screen.getByLabelText('Exam answer'), { target: { value: 'new' } });
    window.dispatchEvent(new Event('pagehide'));

    expect(api.examSaveOnExit).toHaveBeenCalledWith(
      'exam-1',
      { responses: { q1: 'new' }, current_index: 0, flagged: [], revision: expect.any(Number) },
      'math',
    );
    expect(api.examSave).not.toHaveBeenCalled();
  });
});


describe('ExamPage scope and unload safeguards', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.clearAllMocks();
    api.fetchCurriculum.mockResolvedValue({});
    api.fetchContentAvailability.mockResolvedValue({});
    api.examHistory.mockResolvedValue([]);
    api.examListPapers.mockResolvedValue([]);
    api.examStart.mockResolvedValue({
      exam_id: 'exam-1',
      questions: [question],
      total_questions: 1,
      time_limit_minutes: 1,
      deadline_at: '2026-01-01T00:01:00Z',
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('requests history with the selected analytics scope', async () => {
    render(<ExamPage />);
    await flushPromises();

    expect(api.examHistory).toHaveBeenCalledWith(
      'math',
      expect.anything(),
      { yearLevel: 7, syllabusSubject: undefined },
    );
  });

  it('sets returnValue while an exam is in progress', async () => {
    render(<ExamPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Start test exam' }));
    await flushPromises();

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    // jsdom exposes returnValue as a boolean; assigning the browser-compatible
    // empty string produces false while still exercising the assignment path.
    expect(event.returnValue).toBe(false);
  });
});



describe('ExamPage autosave retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.clearAllMocks();
    api.fetchCurriculum.mockResolvedValue({});
    api.fetchContentAvailability.mockResolvedValue({});
    api.examHistory.mockResolvedValue([]);
    api.examListPapers.mockResolvedValue([]);
    api.examStart.mockResolvedValue({
      exam_id: 'exam-1',
      questions: [question],
      total_questions: 1,
      time_limit_minutes: 1,
      deadline_at: '2026-01-01T00:01:00Z',
    });
    api.examSave.mockRejectedValueOnce(new Error('save unavailable'))
      .mockResolvedValue({ ok: true, stale: false });
    api.examSaveOnExit.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('retries a failed online autosave with backoff and reaches saved state', async () => {
    render(<ExamPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Start test exam' }));
    await flushPromises();
    fireEvent.change(screen.getByLabelText('Exam answer'), { target: { value: '4' } });

    act(() => {
      vi.advanceTimersByTime(700);
    });
    await flushPromises();

    expect(api.examSave).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('save-status').textContent).toBe('retry_queued');
    expect(screen.getByRole('alert').textContent).toContain('save unavailable');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();

    expect(api.examSave).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('save-status').textContent).toBe('saved');
  });
});