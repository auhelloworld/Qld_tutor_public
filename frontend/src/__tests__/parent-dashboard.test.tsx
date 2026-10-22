import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ParentDashboard from '../app/parent/page';

const api = vi.hoisted(() => ({
  PARENT_AUTH_INVALID_EVENT: 'parent-auth-invalid',
  safeFetch: vi.fn(),
  fetchDailySummary: vi.fn(),
  fetchWeeklyLearningSummary: vi.fn(),
  fetchProgressSummary: vi.fn(),
  fetchMistakes: vi.fn(),
  examHistory: vi.fn(),
  setDailyGoal: vi.fn(),
  fetchPendingReviews: vi.fn(),
  submitParentReview: vi.fn(),
  getPuMode: vi.fn(),
  setPuMode: vi.fn(),
  fetchParentNextSteps: vi.fn(),
  fetchLearningFacets: vi.fn(),
  fetchParentEnglishSummary: vi.fn(),
  fetchPSMTHistory: vi.fn(),
  fetchCurriculum: vi.fn(),
  analyticsScopeFromYear: vi.fn(() => ({ yearLevel: 7 })),
  syllabusSubjectFromPickerSubject: vi.fn(() => undefined),
  parentLogin: vi.fn(),
  diagnosticStatus: vi.fn(async () => ({ completed: false })),
}));

const toast = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('../lib/api', () => api);
vi.mock('../lib/toast', () => toast);
vi.mock('../lib/student_id', () => ({
  getStudentId: () => 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  getDisplayName: () => '',
  setDisplayName: vi.fn(),
  clearDisplayName: vi.fn(),
  resetStudentId: vi.fn(),
  getStudentToken: vi.fn(async () => 'student-token'),
  clearToken: vi.fn(),
  STORAGE_KEY: 'student_id',
}));
vi.mock('../lib/preferences', () => ({ getSubject: () => 'math', getYear: () => 'year7' }));
vi.mock('../lib/guided-subject-adapters', () => ({
  getSubjectAdapter: () => ({ facetDisplayName: (value: string) => value }),
}));
vi.mock('../lib/feature-flags', () => ({ ENABLE_GUIDED_PRACTICE: false }));

vi.mock('../components/parent/ParentAuth', () => ({
  default: ({ onSubmit, passwordError, passwordInput, onPasswordChange }: {
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    passwordError: string;
    passwordInput: string;
    onPasswordChange: (value: string) => void;
  }) => (
    <form onSubmit={onSubmit}>
      <div>Parent authentication required</div>
      <input aria-label="Parent password" value={passwordInput} onChange={event => onPasswordChange(event.target.value)} />
      {passwordError && <div>{passwordError}</div>}
      <button type="submit">Unlock</button>
    </form>
  ),
}));
vi.mock('../components/FrameworkSubjectYearPicker', () => ({
  default: ({ curriculum }: { curriculum: Record<string, unknown> | null }) => (
    <div>
      <span>Picker</span>
      <span data-testid="picker-subjects">{Object.keys(curriculum || {}).join(',')}</span>
    </div>
  ),
}));
vi.mock('../components/parent/PendingReviews', () => ({
  default: ({ reviews, onReview }: {
    reviews: Array<Record<string, unknown>>;
    onReview: (review: Record<string, unknown>, correct: boolean) => void;
  }) => (
    <div>
      <span data-testid="review-count">{reviews.length}</span>
      <button disabled={!reviews.length} onClick={() => onReview(reviews[0], true)}>Approve first</button>
    </div>
  ),
}));

vi.mock('../components/parent/DailySummaryCards', () => ({ default: () => <div data-testid="daily-summary" /> }));
vi.mock('../components/parent/AssessmentReadiness', () => ({ default: () => <div /> }));
vi.mock('../components/parent/ActivityCalendar', () => ({ default: () => <div /> }));
vi.mock('../components/parent/StrandProgress', () => ({ default: () => <div /> }));
vi.mock('../components/parent/CoverageConfidence', () => ({ default: () => <div /> }));
vi.mock('../components/parent/RecentMistakes', () => ({ default: () => <div /> }));
vi.mock('../components/parent/ErrorCauseChart', () => ({ default: () => <div /> }));
vi.mock('../components/parent/ExamHistory', () => ({ default: () => <div /> }));
vi.mock('../components/parent/StudentManagement', () => ({ default: () => <div data-testid="student-management" /> }));
vi.mock('../components/parent/RestoreModal', () => ({ default: () => <div /> }));
vi.mock('../components/parent/EnglishWeeklySummary', () => ({ default: () => <div /> }));

function setSavedParentSession(activeAt = Date.now()) {
  sessionStorage.setItem('parent_auth', '1');
  sessionStorage.setItem('parent_token', 'saved-parent-token');
  sessionStorage.setItem('parent_active_at', String(activeAt));
}

const PARENT_IDLE_LIMIT_MS = 15 * 60 * 1000;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  api.safeFetch.mockResolvedValue({ students: [] });
  api.fetchDailySummary.mockResolvedValue({ daily_goal: 20 });
  api.fetchWeeklyLearningSummary.mockResolvedValue(null);
  api.fetchProgressSummary.mockResolvedValue({ topics: [], total_direct_attempts: 0 });
  api.fetchMistakes.mockResolvedValue({ mistakes: [] });
  api.examHistory.mockResolvedValue([]);
  api.fetchPendingReviews.mockResolvedValue({ pending: [] });
  api.fetchParentNextSteps.mockResolvedValue(null);
  api.fetchLearningFacets.mockResolvedValue(null);
  api.fetchParentEnglishSummary.mockResolvedValue(null);
  api.fetchPSMTHistory.mockResolvedValue(null);
  api.setDailyGoal.mockResolvedValue({ scope: 'all_subjects', daily_goal: 20 });
  api.fetchCurriculum.mockResolvedValue({ math: { year7: {} } });
  api.getPuMode.mockResolvedValue({ pu_mode: false });
  api.setPuMode.mockResolvedValue({ pu_mode: false });
  api.submitParentReview.mockResolvedValue({ ok: true });
  api.parentLogin.mockResolvedValue({ token: 'new-parent-token' });
});

afterEach(() => cleanup());

describe('Parent Dashboard authentication boundary', () => {
  it('does not request dashboard data while locked', async () => {
    render(<ParentDashboard />);

    await screen.findByText('Parent authentication required');
    expect(api.getPuMode).not.toHaveBeenCalled();
    expect(api.fetchDailySummary).not.toHaveBeenCalled();
    expect(api.fetchProgressSummary).not.toHaveBeenCalled();
    expect(api.fetchPendingReviews).not.toHaveBeenCalled();
    expect(api.safeFetch).not.toHaveBeenCalled();
  });

  it('validates a saved parent token before loading dashboard data', async () => {
    setSavedParentSession();
    let resolveValidation!: (value: { pu_mode: boolean }) => void;
    api.getPuMode
      .mockImplementationOnce(() => new Promise(resolve => { resolveValidation = resolve; }))
      .mockResolvedValue({ pu_mode: false });

    render(<ParentDashboard />);
    expect(await screen.findByText('Checking parent session...')).toBeTruthy();
    expect(api.fetchDailySummary).not.toHaveBeenCalled();

    resolveValidation({ pu_mode: false });
    await waitFor(() => expect(api.fetchDailySummary).toHaveBeenCalledTimes(1));
    expect(api.getPuMode).toHaveBeenCalledTimes(2);
  });

  it('clears an invalid saved session without loading dashboard data', async () => {
    setSavedParentSession();
    api.getPuMode.mockRejectedValueOnce(new Error('Parent session expired'));

    render(<ParentDashboard />);
    await screen.findByText('Parent authentication required');

    expect(sessionStorage.getItem('parent_token')).toBeNull();
    expect(sessionStorage.getItem('parent_auth')).toBeNull();
    expect(api.fetchDailySummary).not.toHaveBeenCalled();
  });

  it('relocks immediately when the API reports an expired parent session', async () => {
    setSavedParentSession();
    render(<ParentDashboard />);
    await screen.findByText('Picker');

    await act(async () => {
      window.dispatchEvent(new CustomEvent(api.PARENT_AUTH_INVALID_EVENT));
    });
    await screen.findByText('Parent authentication required');
    expect(sessionStorage.getItem('parent_token')).toBeNull();
  });
});

describe('Parent Dashboard lock (shared family computer)', () => {
  it('clears the typed password on lock, so unlocking again needs new input', async () => {
    render(<ParentDashboard />);
    fireEvent.change(await screen.findByLabelText('Parent password'), { target: { value: 'family-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByText('Picker');
    expect(api.parentLogin).toHaveBeenCalledWith('family-secret');

    fireEvent.click(screen.getByRole('button', { name: /Lock Dashboard/ }));
    const input = await screen.findByLabelText('Parent password') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(sessionStorage.getItem('parent_token')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Enter the parent password.')).toBeTruthy();
    expect(api.parentLogin).toHaveBeenCalledTimes(1);
  });

  it('does not restore a saved session after the idle limit', async () => {
    setSavedParentSession(Date.now() - PARENT_IDLE_LIMIT_MS - 1000);
    render(<ParentDashboard />);

    await screen.findByText('Parent authentication required');
    expect(api.getPuMode).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('parent_token')).toBeNull();
  });

  it('locks when the next input comes after the idle limit', async () => {
    setSavedParentSession();
    render(<ParentDashboard />);
    await screen.findByText('Picker');

    sessionStorage.setItem('parent_active_at', String(Date.now() - PARENT_IDLE_LIMIT_MS - 1000));
    fireEvent.pointerDown(window);

    await screen.findByText('Parent authentication required');
    expect(sessionStorage.getItem('parent_token')).toBeNull();
    expect((screen.getByLabelText('Parent password') as HTMLInputElement).value).toBe('');
  });
});

describe('Parent Dashboard subject scope', () => {
  it('keeps Science available and does not render multi-student management', async () => {
    setSavedParentSession();
    api.fetchCurriculum.mockResolvedValue({
      math: { year7: {} },
      science: { year7: {} },
    });

    render(<ParentDashboard />);

    await waitFor(() => expect(screen.getByTestId('picker-subjects').textContent).toContain('science'));
    expect(api.fetchPendingReviews).toHaveBeenCalledWith(
      'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      'math',
      expect.anything(),
      expect.objectContaining({ yearLevel: 7, includeUnattempted: true }),
    );
    expect(screen.queryByText(/student management/i)).toBeNull();
    expect(screen.queryByText(/switch student/i)).toBeNull();
  });
});

describe('Parent Dashboard mutation rollback', () => {
  it('keeps a review visible when the backend returns ok false', async () => {
    setSavedParentSession();
    const review = {
      topic: 'AC9M7N01', question_id: 'q1', student_answer: '12', question: 'Question', correct_answer: '14',
    };
    api.fetchPendingReviews.mockResolvedValue({ pending: [review] });
    api.submitParentReview.mockResolvedValue({ ok: false, message: 'Review not found.' });

    render(<ParentDashboard />);
    await waitFor(() => expect(screen.getByTestId('review-count').textContent).toBe('1'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve first' }));

    await waitFor(() => expect(api.submitParentReview).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('review-count').textContent).toBe('1');
    expect(toast.showToast).toHaveBeenCalledWith('Review failed. Try again.', 'error');
  });

  it('rolls back the Parent Review Mode toggle when persistence fails', async () => {
    setSavedParentSession();
    api.setPuMode.mockRejectedValue(new Error('network failure'));

    render(<ParentDashboard />);
    const checkbox = await screen.findByRole('checkbox');
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    fireEvent.click(checkbox);

    await waitFor(() => expect(api.setPuMode).toHaveBeenCalledWith(true));
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(toast.showToast).toHaveBeenCalledWith('Failed to update Parent Review Mode.', 'error');
  });
});


describe('Parent Dashboard failure disclosure', () => {
  it('shows a retryable partial-data alert instead of silently presenting failed progress as empty', async () => {
    setSavedParentSession();
    api.fetchProgressSummary.mockRejectedValue(new Error('offline'));

    render(<ParentDashboard />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('progress');
    expect(alert.textContent).toContain('Saved learning data has not been deleted');
    fireEvent.click(screen.getByRole('button', { name: /Retry unavailable sections/i }));
    await waitFor(() => expect(api.fetchProgressSummary).toHaveBeenCalledTimes(2));
  });

  it('reports a failed all-subject daily-goal save', async () => {
    setSavedParentSession();
    api.setDailyGoal.mockRejectedValue(new Error('offline'));

    render(<ParentDashboard />);
    const save = await screen.findByRole('button', { name: 'Save' });
    fireEvent.click(save);

    await waitFor(() => expect(api.setDailyGoal).toHaveBeenCalledTimes(1));
    expect(toast.showToast).toHaveBeenCalledWith('Failed to save the daily goal. Try again.', 'error');
  });
});
