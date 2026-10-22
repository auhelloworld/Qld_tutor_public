import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exercise } from '../lib/api-types';

const api = vi.hoisted(() => ({
  fetchCurriculum: vi.fn(),
  fetchContentAvailability: vi.fn(),
  fetchExercises: vi.fn(),
  fetchRecommend: vi.fn(),
  tutorSuggest: vi.fn(),
  tutorMark: vi.fn(),
  tutorExplain: vi.fn(),
  tutorDialogue: vi.fn(),
  fetchDailySummary: vi.fn(),
  fetchTopicWorkedExample: vi.fn(),
  fetchAdvancedLesson: vi.fn(),
  fetchProgress: vi.fn(),
  fetchParentNextSteps: vi.fn(),
  fetchMistakes: vi.fn(),
  updateTutorAttemptMetadata: vi.fn(),
}));

const mockRouterPush = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock('../lib/preferences', () => ({
  getSubject: () => 'math',
  getYear: () => 'year7',
}));

vi.mock('../lib/toast', () => ({ showToast: vi.fn() }));

vi.mock('../lib/api', () => ({
  ...api,
  analyticsScopeFromYear: () => ({ yearLevel: 7 }),
  syllabusSubjectFromPickerSubject: () => undefined,
}));

vi.mock('../components/guided/GuidedPracticeShell', () => ({
  default: ({
    children,
    isHighAchiever,
    highAchieverAppliesNext,
    allowHighAchiever = true,
    completedQuestions = 0,
    replacedQuestions = 0,
    onToggleHighAchiever,
    onFinishSession,
    onExit,
    selectionReason,
  }: {
    children: ReactNode;
    isHighAchiever: boolean;
    highAchieverAppliesNext?: boolean;
    allowHighAchiever?: boolean;
    completedQuestions?: number;
    replacedQuestions?: number;
    onToggleHighAchiever: () => void;
    onFinishSession?: () => void;
    onExit: () => void;
    selectionReason?: string;
  }) => (
    <div>
      <div data-testid="selection-reason">{selectionReason}</div>
      {allowHighAchiever && <button onClick={onToggleHighAchiever}>Toggle High Achiever</button>}
      <button onClick={onExit}>Exit guided practice</button>
      {onFinishSession && <button onClick={onFinishSession}>Finish current session</button>}
      <div data-testid="displayed-mode">{String(isHighAchiever)}</div>
      <div data-testid="pending-mode">{String(Boolean(highAchieverAppliesNext))}</div>
      <div data-testid="guided-progress">{`${completedQuestions} answered · ${replacedQuestions} replaced`}</div>
      {children}
    </div>
  ),
}));

vi.mock('../components/guided/GuidedQuestionCard', () => ({
  default: ({
    exercise,
    answer,
    onSetAnswer,
    onSubmit,
    onSkip,
  }: {
    exercise: Exercise;
    answer: string;
    onSetAnswer: (value: string) => void;
    onSubmit: () => void;
    onSkip?: () => void;
  }) => (
    <div>
      <div data-testid="question-id">{exercise.id}</div>
      <input
        aria-label="Guided answer"
        value={answer}
        onChange={event => onSetAnswer(event.target.value)}
      />
      <button onClick={onSubmit}>Submit guided answer</button>
      {onSkip && <button onClick={onSkip}>Skip guided question</button>}
    </div>
  ),
}));

vi.mock('../components/TodaySessionBar', () => ({ default: () => <div>Today session</div> }));
vi.mock('../components/guided/GuidedHelpDrawer', () => ({ default: () => null }));
vi.mock('../components/guided/GuidedFeedbackCard', () => ({
  default: ({ markResponse, onContinuePart, onNext, onTryAgain, onSkipQuestion, requiresCorrection }: { markResponse: { is_correct: boolean; feedback?: string }; onContinuePart?: () => void; onNext?: () => void; onTryAgain?: () => void; onSkipQuestion?: () => void; requiresCorrection?: boolean }) => (
    <div>
      <span>Guided feedback</span>
      <span data-testid="feedback-verdict">{markResponse.is_correct ? 'correct' : 'incorrect'}</span>
      {markResponse.feedback && <span data-testid="feedback-text">{markResponse.feedback}</span>}
      {requiresCorrection && <span>Correction required without adding a question</span>}
      {onContinuePart && !requiresCorrection && <button onClick={onContinuePart}>Continue part</button>}
      {requiresCorrection && onTryAgain && <button onClick={onTryAgain}>Retry correction</button>}
      {!requiresCorrection && !markResponse.is_correct && onTryAgain && <button onClick={onTryAgain}>Try again after feedback</button>}
      {requiresCorrection && onSkipQuestion && <button onClick={onSkipQuestion}>Skip unavailable question</button>}
      {onNext && !requiresCorrection && <button onClick={onNext}>Next guided question</button>}
    </div>
  ),
}));
vi.mock('../components/guided/GuidedSessionSummary', () => ({
  default: ({ attempted, score, errorTypes, independentCorrect }: { attempted: number; score: number; errorTypes: Record<string, number>; independentCorrect?: number }) => (
    <div data-testid="session-stats">{JSON.stringify({ attempted, score, errorTypes, independentCorrect })}</div>
  ),
}));
vi.mock('../components/guided/ParentNextStepsCard', () => ({ default: () => null }));
vi.mock('../components/guided/AdvancedLessonExtension', () => ({ default: () => null }));

import GuidedPracticePage from '../app/guided-practice/page';

const questionA: Exercise = {
  id: 'question-a',
  topic: 'Topic A',
  topic_ids: ['A'],
  question: 'Question A',
  answer: '1',
  question_type: 'short_answer',
  difficulty: 'developing',
};
const questionB: Exercise = {
  id: 'question-b',
  topic: 'Topic B',
  topic_ids: ['B'],
  question: 'Question B',
  answer: '2',
  question_type: 'reasoning',
  difficulty: 'extending',
  complexity: 'complex_unfamiliar',
};
const multiPartQuestion: Exercise = {
  id: 'question-multi',
  topic: 'Topic A',
  topic_ids: ['A'],
  question: 'Answer both parts',
  answer: 'See parts',
  question_type: 'multi_part',
  sub_parts: [
    { label: 'a', question: '2 + 2', answer: '4', marks: 1 },
    { label: 'b', question: '3 + 3', answer: '6', marks: 1 },
  ],
};

const curriculum = {
  math: {
    year7: {
      sequence: ['A', 'B'],
      A: { name: 'Topic A' },
      B: { name: 'Topic B' },
    },
  },
};

describe('Guided Practice page state transitions', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/guided-practice');
    vi.clearAllMocks();
    api.fetchCurriculum.mockResolvedValue(curriculum);
    api.fetchContentAvailability.mockResolvedValue({
      by_subject: { math: 2 },
      by_year: { math: { year7: 2 } },
      by_unit: {},
    });
    api.fetchRecommend.mockResolvedValue({ topic_id: 'A', recommendation_type: 'practice' });
    api.fetchDailySummary.mockResolvedValue(null);
    api.fetchProgress.mockResolvedValue([]);
    api.fetchMistakes.mockResolvedValue({ mistakes: [] });
    api.tutorSuggest.mockResolvedValue({ question: questionA });
    api.tutorExplain.mockResolvedValue({});
    api.fetchTopicWorkedExample.mockResolvedValue({ has_worked_example: false });
    api.fetchAdvancedLesson.mockResolvedValue(null);
    api.fetchParentNextSteps.mockResolvedValue(null);
    api.updateTutorAttemptMetadata.mockResolvedValue({ success: true });
  });

  afterEach(() => cleanup());

  it('keeps the current question and typed answer when mode changes mid-answer', async () => {
    render(<GuidedPracticePage />);

    await screen.findByText('question-a');
    fireEvent.change(screen.getByLabelText('Guided answer'), { target: { value: 'my working' } });
    const suggestCallsBeforeToggle = api.tutorSuggest.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Toggle High Achiever' }));

    expect((screen.getByLabelText('Guided answer') as HTMLInputElement).value).toBe('my working');
    expect(screen.getByText('question-a')).toBeTruthy();
    expect(screen.getByTestId('displayed-mode').textContent).toBe('true');
    expect(screen.getByTestId('pending-mode').textContent).toBe('true');
    await waitFor(() => expect(api.tutorSuggest).toHaveBeenCalledTimes(suggestCallsBeforeToggle));
  });

  it('shows a safe empty-content state before requesting guided questions', async () => {
    api.fetchContentAvailability.mockResolvedValue({
      by_subject: {},
      by_year: { math: { year7: 0 } },
      by_unit: {},
    });

    render(<GuidedPracticePage />);

    await screen.findByText(/No authored exercises are available for the selected course scope yet/i);
    expect(api.fetchExercises).not.toHaveBeenCalled();
    expect(api.tutorSuggest).not.toHaveBeenCalled();
  });

  it('records a completed multi-part question without a stale unanswered error', async () => {
    api.tutorSuggest.mockResolvedValue({ question: multiPartQuestion });
    api.tutorMark
      .mockResolvedValueOnce({
        is_correct: false,
        outcome: 'unanswered',
        error_type: 'unanswered',
        feedback: 'Part b is unanswered.',
        question_type: 'multi_part',
        part_results: [
          { label: 'a', is_correct: true, outcome: 'correct', student_answer: '4' },
          { label: 'b', is_correct: false, outcome: 'unanswered', student_answer: '' },
        ],
      })
      .mockResolvedValueOnce({
        is_correct: true,
        outcome: 'correct',
        error_type: null,
        feedback: 'Both parts are correct.',
        question_type: 'multi_part',
        part_results: [
          { label: 'a', is_correct: true, outcome: 'correct', student_answer: '4' },
          { label: 'b', is_correct: true, outcome: 'correct', student_answer: '6' },
        ],
      });

    render(<GuidedPracticePage />);
    await screen.findByText('question-multi');

    fireEvent.change(screen.getByLabelText('Guided answer'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit guided answer' }));
    await screen.findByText('Guided feedback');
    expect(screen.getByTestId('feedback-verdict').textContent).toBe('correct');
    expect(screen.getByTestId('feedback-text').textContent).toContain('Part (A) is correct');
    expect(screen.queryByText('Part b is unanswered.')).toBeNull();
    expect(api.tutorMark).toHaveBeenNthCalledWith(
      1,
      'question-multi',
      '{"a":"4"}',
      undefined,
      expect.objectContaining({ firstAttempt: true }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue part' }));

    fireEvent.change(await screen.findByLabelText('Guided answer'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit guided answer' }));
    await waitFor(() => expect(api.tutorMark).toHaveBeenCalledTimes(2));
    expect(api.tutorMark).toHaveBeenNthCalledWith(
      2,
      'question-multi',
      '{"b":"6"}',
      undefined,
      expect.objectContaining({ firstAttempt: false }),
    );
    await screen.findByText('Guided feedback');
    fireEvent.click(screen.getByRole('button', { name: 'Finish current session' }));

    expect((await screen.findByTestId('session-stats')).textContent).toContain('"attempted":1');
  });

  it('requires one retry before a wrong multi-part sub-part can be skipped', async () => {
    api.tutorSuggest.mockResolvedValue({ question: multiPartQuestion });
    const wrongPart = {
      is_correct: false,
      outcome: 'incorrect',
      error_type: 'incorrect_value',
      feedback: 'Part a is incorrect.',
      question_type: 'multi_part',
      part_results: [
        { label: 'a', is_correct: false, outcome: 'incorrect', student_answer: '3' },
        { label: 'b', is_correct: false, outcome: 'unanswered', student_answer: '' },
      ],
    };
    api.tutorMark.mockResolvedValue(wrongPart);

    render(<GuidedPracticePage />);
    await screen.findByText('question-multi');
    fireEvent.change(screen.getByLabelText('Guided answer'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit guided answer' }));
    await screen.findByText(/Correction required without adding a question/i);
    expect(screen.queryByRole('button', { name: 'Continue part' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry correction' }));
    fireEvent.change(screen.getByLabelText('Guided answer'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit guided answer' }));
    await screen.findByRole('button', { name: 'Continue part' });
    expect(screen.queryByText(/Correction required without adding a question/i)).toBeNull();
  });

  it('without a recommendation, starts at the first topic that the server does not call mastered', async () => {
    api.fetchRecommend.mockResolvedValue({});
    api.fetchProgress.mockResolvedValue([
      // One right short answer: BKT is high, but the mastery rule is not met.
      { topic: 'A', bkt_mastery: 0.861, status: 'promising', attempts_count: 1, accuracy: 1 },
      { topic: 'B', bkt_mastery: 0.4, status: 'mastered', attempts_count: 4, accuracy: 1 },
    ]);

    render(<GuidedPracticePage />);

    await waitFor(() => expect(api.tutorSuggest).toHaveBeenCalled());
    expect(api.tutorSuggest.mock.calls[0][0]).toBe('A');
  });

  it.each([
    ['a sure right answer counts', false, 2],
    ['a guessed right answer does not count', true, 0],
  ])('final independent check: %s', async (_name, guess, secured) => {
    const questions = ['g-1', 'g-2', 'g-3', 'g-4', 'g-5'].map(id => ({ ...questionA, id }));
    let served = 0;
    // No "once" queue: it would leak into the next test if this one fails.
    api.tutorSuggest.mockImplementation(async () => ({ question: questions[Math.min(served++, questions.length - 1)] }));
    api.fetchExercises.mockResolvedValue([]);
    api.tutorMark.mockResolvedValue({ is_correct: true, outcome: 'correct', feedback: 'Correct.', attempt_id: 'att-1' });

    render(<GuidedPracticePage />);
    for (const [index, item] of questions.entries()) {
      await screen.findByText(item.id);
      fireEvent.change(screen.getByLabelText('Guided answer'), { target: { value: '1' } });
      // The last two questions are the independent check.
      if (guess && index >= 3) fireEvent.click(screen.getByRole('button', { name: 'Guessing' }));
      fireEvent.click(screen.getByRole('button', { name: 'Submit guided answer' }));
      await screen.findByText('Guided feedback');
      const explanation = screen.queryByLabelText('Self explanation');
      if (explanation) {
        fireEvent.change(explanation, { target: { value: 'I applied the inverse operation.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save explanation' }));
        await waitFor(() => expect(screen.queryByLabelText('Self explanation')).toBeNull());
      }
      fireEvent.click(screen.getByRole('button', { name: 'Next guided question' }));
    }

    expect((await screen.findByTestId('session-stats')).textContent).toContain(`"independentCorrect":${secured}`);
  });

  it('stages a cross-topic High Achiever question without refetching its pools', async () => {
    window.history.replaceState({}, '', '/guided-practice?mode=high-achiever');
    api.fetchProgress.mockResolvedValue([
      { topic: 'A', bkt_mastery: 0.2, attempts_count: 2, accuracy: 0.5 },
      { topic: 'B', bkt_mastery: 0.75, attempts_count: 3, accuracy: 0.9 },
    ]);
    api.fetchExercises.mockImplementation(async (topic: string) => (
      topic === 'B' ? [questionB] : [questionA]
    ));

    render(<GuidedPracticePage />);

    await screen.findByText('question-b');
    expect(api.fetchExercises).toHaveBeenCalledTimes(2);
    expect(api.fetchExercises.mock.calls.map(call => call[0]).sort()).toEqual(['A', 'B']);
    expect(api.tutorSuggest).not.toHaveBeenCalled();
  });

  it('requires one correction retry without increasing the session question index', async () => {
    api.tutorMark
      .mockResolvedValueOnce({ is_correct: false, outcome: 'incorrect', error_type: 'concept_gap', feedback: 'Try again.' })
      .mockResolvedValueOnce({ is_correct: true, outcome: 'correct', attempt_id: 'attempt-corrected', feedback: 'Correct.' });

    render(<GuidedPracticePage />);
    await screen.findByText('question-a');
    fireEvent.change(screen.getByLabelText('Guided answer'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit guided answer' }));

    await screen.findByText(/Correction required without adding a question/i);
    expect(screen.queryByRole('button', { name: 'Next guided question' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry correction' }));
    expect(screen.getByText('question-a')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Guided answer'), { target: { value: 'corrected' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit guided answer' }));
    await screen.findByLabelText('Self explanation');
    fireEvent.change(screen.getByLabelText('Self explanation'), { target: { value: 'because' } });
    expect((screen.getByRole('button', { name: 'Save explanation' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Self explanation'), { target: { value: 'I applied the inverse operation.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save explanation' }));
    await waitFor(() => expect(api.updateTutorAttemptMetadata).toHaveBeenCalledWith(
      'question-a',
      'attempt-corrected',
      'I applied the inverse operation.',
    ));

    expect(api.tutorMark).toHaveBeenNthCalledWith(
      2,
      'question-a',
      'corrected',
      undefined,
      expect.objectContaining({ firstAttempt: false, correctionCompleted: true }),
    );
  });
  it('allows an unavailable question to be skipped after the first scored error', async () => {
    api.tutorSuggest
      .mockResolvedValueOnce({ question: questionA })
      .mockResolvedValueOnce({ question: questionB });
    api.tutorMark.mockResolvedValue({
      is_correct: false,
      outcome: 'incorrect',
      error_type: 'concept_gap',
      feedback: 'Try again.',
    });

    render(<GuidedPracticePage />);
    await screen.findByText('question-a');
    fireEvent.change(screen.getByLabelText('Guided answer'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit guided answer' }));

    await screen.findByText(/Correction required without adding a question/i);
    fireEvent.click(screen.getByRole('button', { name: 'Skip unavailable question' }));

    await screen.findByText('question-b');
    expect(api.tutorMark).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('guided-progress').textContent).toBe('1 answered · 0 replaced');
  });

  it('moves on without adding a replacement after an already-counted attempt', async () => {
    api.tutorSuggest
      .mockResolvedValueOnce({ question: questionA })
      .mockResolvedValueOnce({ question: questionB });
    api.tutorMark.mockResolvedValue({
      is_correct: false,
      outcome: 'incorrect',
      error_type: 'concept_gap',
      feedback: 'Try again.',
    });

    render(<GuidedPracticePage />);
    await screen.findByText('question-a');
    fireEvent.change(screen.getByLabelText('Guided answer'), { target: { value: 'wrong once' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit guided answer' }));
    await screen.findByRole('button', { name: 'Retry correction' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry correction' }));

    fireEvent.change(screen.getByLabelText('Guided answer'), { target: { value: 'wrong twice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit guided answer' }));
    await screen.findByRole('button', { name: 'Try again after feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'Try again after feedback' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip guided question' }));

    await screen.findByText('question-b');
    expect(api.tutorMark).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('guided-progress').textContent).toBe('1 answered · 0 replaced');
  });

  it('skips an unanswered question without creating a fake marked attempt', async () => {
    api.tutorSuggest
      .mockResolvedValueOnce({ question: questionA })
      .mockResolvedValueOnce({ question: questionB });

    render(<GuidedPracticePage />);
    await screen.findByText('question-a');

    fireEvent.click(screen.getByRole('button', { name: 'Skip guided question' }));

    await screen.findByText('question-b');
    expect(api.tutorMark).not.toHaveBeenCalled();
    expect(screen.getByTestId('guided-progress').textContent).toBe('0 answered · 1 replaced');
  });

  it('protects a typed answer before exiting guided practice', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<GuidedPracticePage />);
    await screen.findByText('question-a');
    fireEvent.change(screen.getByLabelText('Guided answer'), { target: { value: 'unfinished work' } });

    fireEvent.click(screen.getByRole('button', { name: 'Exit guided practice' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(mockRouterPush).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Exit guided practice' }));
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledOnce());
    confirm.mockRestore();
  });
});



describe('Guided Practice Today task context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchCurriculum.mockResolvedValue(curriculum);
    api.fetchContentAvailability.mockResolvedValue({
      by_subject: { math: 2 },
      by_year: { math: { year7: 2 } },
      by_unit: {},
    });
    api.fetchRecommend.mockResolvedValue({ topic_id: 'A', recommendation_type: 'practice' });
    api.fetchDailySummary.mockResolvedValue(null);
    api.fetchProgress.mockResolvedValue([]);
    api.fetchMistakes.mockResolvedValue({ mistakes: [] });
    api.tutorExplain.mockResolvedValue({});
    api.fetchTopicWorkedExample.mockResolvedValue({ has_worked_example: false });
    api.fetchAdvancedLesson.mockResolvedValue(null);
    api.fetchParentNextSteps.mockResolvedValue(null);
    api.updateTutorAttemptMetadata.mockResolvedValue({ success: true });
  });

  it('runs a normal guided set inside a Today visit and returns to Today', async () => {
    window.history.replaceState({}, '', '/guided-practice?subject=math&year=year7&topic=A&today_session=1&return_to=%2Ftoday%3Fsubject%3Dmath%26year%3Dyear7');
    api.tutorSuggest.mockResolvedValue({ question: questionA });
    api.tutorMark.mockResolvedValue({
      is_correct: true,
      outcome: 'correct',
      feedback: 'Correct',
      question_type: 'short_answer',
    });

    render(<GuidedPracticePage />);
    await screen.findByText('question-a');
    fireEvent.change(screen.getByLabelText('Guided answer'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit guided answer' }));
    await screen.findByText('Guided feedback');

    expect(screen.getByText('Today session')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Toggle High Achiever' })).toBeNull();
    // Today steps run on /today/practice; this set sends no Today step.
    const metadata = api.tutorMark.mock.calls[0][3];
    expect(metadata).not.toHaveProperty('todayTaskId');
    expect(metadata).not.toHaveProperty('reviewSource');
    expect(metadata).toEqual(expect.objectContaining({ guidedPhase: 'guided' }));

    fireEvent.click(screen.getByRole('button', { name: 'Exit guided practice' }));
    expect(mockRouterPush).toHaveBeenCalledWith('/today?subject=math&year=year7');
  });

  it('names the real source of a topic link instead of always blaming the parent dashboard', async () => {
    api.tutorSuggest.mockResolvedValue({ question: questionA });
    window.history.replaceState({}, '', '/guided-practice?subject=math&year=year7&topic=A');
    const first = render(<GuidedPracticePage />);
    await screen.findByText('question-a');
    expect(screen.getByTestId('selection-reason').textContent).toBe('Practice for the topic you opened.');
    first.unmount();

    window.history.replaceState({}, '', '/guided-practice?subject=math&year=year7&topic=A&mode=parent-focus');
    render(<GuidedPracticePage />);
    await screen.findByText('question-a');
    expect(screen.getByTestId('selection-reason').textContent).toBe('Targeted practice from the parent dashboard.');
  });
});
