import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DiagnosticPage from '../app/diagnostic/page';
import { diagnosticDismiss, diagnosticRespond, diagnosticStart, diagnosticStatus } from '../lib/api';

const mockPreferences = vi.hoisted(() => ({ subject: 'math', year: 'year7' }));
const mockRouterPush = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock('../components/FrameworkSubjectYearPicker', () => ({
  default: ({ value }: { value: { subject: string; year: string } }) => (
    <div data-testid="subject-year-picker">{value.subject} {value.year}</div>
  ),
}));

vi.mock('../components/MathMarkdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/MathSymbolKeyboard', () => ({
  default: () => <div data-testid="math-keyboard" />,
}));

vi.mock('../components/TodaySessionBar', () => ({
  default: () => <div data-testid="today-session-bar" />,
}));

vi.mock('../lib/preferences', () => ({
  getSubject: () => mockPreferences.subject,
  getYear: () => mockPreferences.year,
}));

vi.mock('../lib/api', () => ({
  fetchCurriculum: vi.fn(async () => ({
    math: { year7: {} },
    senior_math: { unit3: {} },
  })),
  diagnosticStatus: vi.fn(async () => ({
    completed: true,
    report_id: 'completed-report',
    completed_at: '2026-01-01T00:00:00+00:00',
    in_progress: false,
    current: 2,
    total: 2,
    areas: {
      Number: {
        band: 'start_here', ability: -1.1, questions: 2, correct: 0, start_topic: 'AC9M7N04',
        confident_errors: [], misconception_notes: [], previous_band: 'building',
      },
      Algebra: {
        band: 'building', ability: 0.1, questions: 3, correct: 2, start_topic: 'AC9M7A01',
        confident_errors: [], misconception_notes: [],
      },
      Statistics: {
        band: 'secure', ability: 1.0, questions: 2, correct: 2, start_topic: null,
        confident_errors: [], misconception_notes: [],
      },
    },
    start_topics: ['AC9M7N04', 'AC9M7A01'],
    responses_count: 2,
  })),
  diagnosticStart: vi.fn(),
  diagnosticRespond: vi.fn(),
  diagnosticDismiss: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/diagnostic');
  mockPreferences.subject = 'math';
  mockPreferences.year = 'year7';
});

describe('Diagnostic completed status', () => {
  it('groups areas into Start here, Building and Secure with one starting point', async () => {
    render(<DiagnosticPage />);

    await waitFor(() => {
      expect(screen.getByText('Diagnostic Complete')).toBeTruthy();
    });
    const startHere = screen.getByRole('region', { name: 'Start here' });
    expect(within(startHere).getByText('Number')).toBeTruthy();
    expect(within(startHere).getByText(/0 of 2 correct · was Building/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Building' })).getByText('Algebra')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Secure' })).getByText('Statistics')).toBeTruthy();

    const guided = screen.getByRole('link', { name: 'Start Guided Practice' });
    expect(guided.getAttribute('href')).toContain('topic=AC9M7N04');
    expect(guided.getAttribute('href')).toContain('subject=math');
    expect(guided.getAttribute('href')).toContain('year=year7');
    expect(screen.getByRole('link', { name: 'Practise AC9M7N04' }).getAttribute('href')).toContain('subject=math');
    expect(screen.getAllByRole('button', { name: 'Retest this area' })).toHaveLength(3);
    expect(screen.queryByRole('link', { name: /Error Book/ })).toBeNull();
    expect(screen.getByText(/not added to the Error Book/)).toBeTruthy();
    // One primary action: the starting point. Return to Practice stays visible as secondary.
    expect(document.querySelectorAll('.btn-primary')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Return to Practice' }).className).toBe('btn-secondary');
  });

  it('retests one area from the results', async () => {
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'retest-report',
      question: { id: 'retest-q', question: 'Solve x + 1 = 3.', question_type: 'short_answer' },
      progress: { current: 1, total: 2, area_current: 1, area_total: 1 },
    });
    render(<DiagnosticPage />);

    const algebra = within(await screen.findByRole('region', { name: 'Building' }));
    fireEvent.click(algebra.getByRole('button', { name: 'Retest this area' }));

    expect(await screen.findByText('Retest: Algebra')).toBeTruthy();
    expect(screen.getByText('Area 1 of 1 · Question 1')).toBeTruthy();
    expect(diagnosticStart).toHaveBeenCalledWith('math', 7, undefined, 'Algebra');
  });

  it('shows not-scored warnings instead of a mastery claim for an invalid completion', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: true,
      report_id: 'unscored-report',
      completed_at: '2026-07-10T00:00:00+00:00',
      in_progress: false,
      current: 3,
      total: 3,
      areas: {},
      responses_count: 3,
      scored_responses: 0,
      unscored_responses: 3,
      valid_completion: false,
      grading_warnings: ['3 responses could not be scored.', 'No cooldown has been started.'],
    });

    render(<DiagnosticPage />);

    expect(await screen.findByText('Not enough scored evidence')).toBeTruthy();
    expect(screen.getByText(/No result was produced/i)).toBeTruthy();
    expect(screen.getByText(/not scored/i)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Secure' })).toBeNull();
    // Every action button carries a style class: a bare <button> inherits the
    // global white-on-gradient text and became invisible on a transparent background.
    expect(screen.getByRole('button', { name: 'Return to Practice' }).className).toBe('btn-secondary');
    expect(document.querySelectorAll('.btn-primary')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retake Diagnostic' }));
    expect(await screen.findByRole('button', { name: 'Start Diagnostic' })).toBeTruthy();
  });

  it('submits all diagnostic multi-part answers as one structured response', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false,
      report_id: null,
      completed_at: null,
      in_progress: false,
      current: 0,
      total: 0,
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'multipart-report',
      question: {
        id: 'multi-1',
        question: 'Answer both parts.',
        question_type: 'multi_part',
        topic_ids: ['AC9M7N01'],
        sub_parts: [
          { label: 'a', question: '2 + 2?', marks: 1 },
          { label: 'b', question: '3 + 3?', marks: 1 },
        ],
      },
      progress: { current: 1, total: 1 },
    });
    vi.mocked(diagnosticRespond).mockResolvedValueOnce({
      completed: true,
      report_id: 'multipart-report',
      areas: {},
      valid_completion: true,
      response_outcome: 'correct',
    });

    render(<DiagnosticPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Diagnostic' }));
    const inputs = await screen.findAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: '4' } });
    fireEvent.change(inputs[1], { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(diagnosticRespond).toHaveBeenCalledWith(
      'multipart-report',
      'multi-1',
      JSON.stringify({ a: '4', b: '6' }),
      undefined,
      undefined,
      { notLearned: false, confidence: null },
    ));
  });

  it('matches the main exercise question card and answer-box sizing', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false,
      report_id: null,
      completed_at: null,
      in_progress: false,
      current: 0,
      total: 0,
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'short-answer-report',
      question: {
        id: 'short-answer-q',
        question: 'What is 2 + 2?',
        question_type: 'short_answer',
        difficulty: 'developing',
      },
      progress: { current: 1, total: 1 },
    });

    render(<DiagnosticPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Diagnostic' }));

    const answerBox = await screen.findByRole('textbox', { name: 'Your answer' });
    expect(answerBox.tagName).toBe('TEXTAREA');
    expect((answerBox as HTMLTextAreaElement).style.minHeight).toBe('120px');
    expect(screen.getByText('Developing')).toBeTruthy();
    expect(screen.getByText('What is 2 + 2?')).toBeTruthy();
  });

  it('does not silently run senior unit diagnostics as Year 7', async () => {
    mockPreferences.subject = 'senior_math';
    mockPreferences.year = 'unit3';

    render(<DiagnosticPage />);

    await waitFor(() => {
      expect(screen.getByText(/Senior\/unit diagnostics are not available yet/i)).toBeTruthy();
    });
    expect(diagnosticStatus).not.toHaveBeenCalled();
  });

  it('does not carry an answer verdict into the next diagnostic question', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false,
      report_id: null,
      completed_at: null,
      in_progress: false,
      current: 0,
      total: 0,
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'verdict-lifecycle-report',
      question: {
        id: 'question-one',
        question: 'What is 2 + 2?',
        question_type: 'short_answer',
      },
      progress: { current: 1, total: 2 },
    });
    vi.mocked(diagnosticRespond).mockResolvedValueOnce({
      completed: false,
      report_id: 'verdict-lifecycle-report',
      question: {
        id: 'question-two',
        question: 'What is 3 + 3?',
        question_type: 'short_answer',
      },
      progress: { current: 2, total: 2 },
      response_outcome: 'incorrect',
      is_correct: false,
    });

    render(<DiagnosticPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Diagnostic' }));
    const answerBox = await screen.findByRole('textbox', { name: 'Your answer' });
    fireEvent.change(answerBox, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('What is 3 + 3?')).toBeTruthy();
    expect(screen.queryByText(/Correct! Moving to the next question|Incorrect\. Try the next question|Not scored\./i)).toBeNull();
  });
});

describe('Diagnostic recovery, capability and accessibility', () => {
  it('shows saved progress and resumes an in-progress diagnostic', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false,
      report_id: 'saved-report',
      completed_at: null,
      in_progress: true,
      current: 4,
      total: 15,
      coverage: {
        reduced: false,
        available_difficulty_bands: ['foundational', 'developing', 'extending'],
        missing_difficulty_bands: [],
        subject: 'math',
      },
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'saved-report',
      question: {
        id: 'resume-q',
        question: 'What is 2 + 2?',
        question_type: 'short_answer',
      },
      progress: { current: 5, total: 15 },
    });

    render(<DiagnosticPage />);

    expect(await screen.findByText(/4 answers recorded/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume Diagnostic' }));
    expect(await screen.findByText('Question 5')).toBeTruthy();
    expect(diagnosticStart).toHaveBeenCalledWith('math', 7, undefined, undefined);
  });

  it('shows a status failure and retries the status request', async () => {
    vi.mocked(diagnosticStatus).mockRejectedValueOnce(new Error('Status service unavailable'));

    render(<DiagnosticPage />);

    expect(await screen.findByText('Status service unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Diagnostic Complete')).toBeTruthy();
    expect(diagnosticStatus).toHaveBeenCalledTimes(2);
  });

  it('does not navigate away when dismiss persistence fails', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false,
      report_id: null,
      completed_at: null,
      in_progress: false,
      current: 0,
      total: 0,
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'dismiss-report',
      question: {
        id: 'dismiss-q',
        question: 'What is 3 + 3?',
        question_type: 'short_answer',
      },
      progress: { current: 1, total: 15 },
    });
    vi.mocked(diagnosticDismiss).mockRejectedValueOnce(new Error('Dismiss was not saved'));

    render(<DiagnosticPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Diagnostic' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop and don’t remind me' }));

    expect(await screen.findByText('Dismiss was not saved')).toBeTruthy();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('discloses reduced diagnostic coverage before starting', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false,
      report_id: null,
      completed_at: null,
      in_progress: false,
      current: 0,
      total: 0,
      coverage: {
        reduced: true,
        available_difficulty_bands: ['foundational'],
        missing_difficulty_bands: ['developing', 'extending'],
        subject: 'english',
        message: 'This diagnostic may not measure the full grade-level ceiling.',
      },
    });

    render(<DiagnosticPage />);

    expect(await screen.findByText('Reduced diagnostic coverage.')).toBeTruthy();
    expect(screen.getByText(/may not measure the full grade-level ceiling/i)).toBeTruthy();
  });

  it('gives each multi-part radio group a part-and-question accessible name', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false,
      report_id: null,
      completed_at: null,
      in_progress: false,
      current: 0,
      total: 0,
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'radio-report',
      question: {
        id: 'radio-q',
        question: 'Answer each part.',
        question_type: 'multi_part',
        sub_parts: [
          { label: 'a', question: 'Which value is even?', choices: ['1', '2'], marks: 1 },
          { label: 'b', question: 'Which value is odd?', choices: ['3', '4'], marks: 1 },
        ],
      },
      progress: { current: 1, total: 2 },
    });

    render(<DiagnosticPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Diagnostic' }));

    expect(await screen.findByRole('group', { name: /Part A.*Which value is even/i })).toBeTruthy();
    expect(screen.getByRole('group', { name: /Part B.*Which value is odd/i })).toBeTruthy();
  });

  it('submits "not learned yet" without an answer and sends optional confidence', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false,
      report_id: null,
      completed_at: null,
      in_progress: false,
      current: 0,
      total: 0,
      coverage: {
        reduced: false,
        available_difficulty_bands: ['foundational', 'developing', 'extending'],
        missing_difficulty_bands: [],
        subject: 'english',
        area_count: 3,
        estimated_questions: 12,
      },
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'honest-report',
      question: { id: 'honest-q1', question: 'Name the device.', question_type: 'short_answer' },
      progress: { current: 1, total: 12, area_current: 1, area_total: 3 },
    });
    vi.mocked(diagnosticRespond).mockResolvedValueOnce({
      completed: false,
      report_id: 'honest-report',
      question: { id: 'honest-q2', question: 'Name the tense.', question_type: 'short_answer' },
      progress: { current: 2, total: 12, area_current: 1, area_total: 3 },
    });

    render(<DiagnosticPage />);
    expect(await screen.findByText(/about 12 questions across 3 areas/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start Diagnostic' }));
    expect(await screen.findByText('Area 1 of 3 · Question 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'I haven’t learned this yet' }));
    await waitFor(() => expect(diagnosticRespond).toHaveBeenCalledWith(
      'honest-report', 'honest-q1', '', undefined, undefined, { notLearned: true, confidence: null },
    ));

    await screen.findByText('Name the tense.');
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'past' } });
    fireEvent.click(screen.getByRole('button', { name: 'Certain' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(diagnosticRespond).toHaveBeenLastCalledWith(
      'honest-report', 'honest-q2', 'past', undefined, undefined, { notLearned: false, confidence: 'sure' },
    ));
  });
});



describe('Diagnostic Today context', () => {
  it('returns to Today without adding practice after the diagnostic', async () => {
    window.history.replaceState({}, '', '/diagnostic?subject=math&year=year7&today_session=1&today_task=diagnostic-task');
    render(<DiagnosticPage />);

    expect(await screen.findByText('Diagnostic Complete')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Start Guided Practice' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue Today’s Study' })).toBeTruthy();
  });

  it('locks the assigned subject and year before a Today diagnostic starts', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false,
      report_id: null,
      completed_at: null,
      in_progress: false,
      current: 0,
      total: 0,
    });
    window.history.replaceState({}, '', '/diagnostic?subject=math&year=year7&today_session=1&today_task=diagnostic-task');
    render(<DiagnosticPage />);

    expect(await screen.findByRole('button', { name: 'Start Diagnostic' })).toBeTruthy();
    expect(screen.queryByLabelText(/subject/i)).toBeNull();
    expect(screen.queryByLabelText(/year/i)).toBeNull();
  });
});


describe('Diagnostic answer-entry consistency', () => {
  it('keeps the question and draft when submission fails, then allows Ctrl+Enter retry', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false, report_id: null, completed_at: null,
      in_progress: false, current: 0, total: 0,
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'retry-report',
      question: {
        id: 'retry-q', question: 'Explain your calculation.',
        question_type: 'short_answer', subject: 'math',
      },
      progress: { current: 1, total: 2 },
    });
    vi.mocked(diagnosticRespond)
      .mockRejectedValueOnce(new Error('Submission unavailable'))
      .mockResolvedValueOnce({
        completed: false,
        question: { id: 'next-q', question: 'Next question', question_type: 'short_answer', subject: 'math' },
        progress: { current: 2, total: 2 },
      });

    render(<DiagnosticPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Diagnostic' }));
    const answerBox = await screen.findByRole('textbox', { name: 'Your answer' });
    fireEvent.change(answerBox, { target: { value: 'My working\ncontinues here' } });
    fireEvent.keyDown(answerBox, { key: 'Enter' });
    expect(diagnosticRespond).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Submission unavailable')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value)
      .toBe('My working\ncontinues here');
    expect(screen.getByText('Explain your calculation.')).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your answer' }), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(diagnosticRespond).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Next question')).toBeTruthy();
  });

  it('uses the shared exercise MCQ choice styling', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false, report_id: null, completed_at: null,
      in_progress: false, current: 0, total: 0,
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'mcq-report',
      question: {
        id: 'mcq-q', question: 'Choose one.', question_type: 'multiple_choice',
        subject: 'math', choices: ['A value', 'B value'],
      },
      progress: { current: 1, total: 1 },
    });

    render(<DiagnosticPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Diagnostic' }));
    const option = await screen.findByLabelText('A value');
    expect(option.closest('label')?.classList.contains('choice-label')).toBe(true);
  });

  it('shows the math keyboard for maths reasoning but not English short answers', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false, report_id: null, completed_at: null,
      in_progress: false, current: 0, total: 0,
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'reasoning-report',
      question: {
        id: 'reasoning-q', question: 'Justify the result.',
        question_type: 'reasoning', subject: 'math',
      },
      progress: { current: 1, total: 1 },
    });

    const first = render(<DiagnosticPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Diagnostic' }));
    expect(await screen.findByTestId('math-keyboard')).toBeTruthy();
    first.unmount();

    mockPreferences.subject = 'english';
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false, report_id: null, completed_at: null,
      in_progress: false, current: 0, total: 0,
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'english-report',
      question: {
        id: 'english-q', question: 'State the main idea.',
        question_type: 'short_answer', subject: 'english',
      },
      progress: { current: 1, total: 1 },
    });

    render(<DiagnosticPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Diagnostic' }));
    expect(await screen.findByRole('textbox', { name: 'Your answer' })).toBeTruthy();
    expect(screen.queryByTestId('math-keyboard')).toBeNull();
  });

  it('keeps the Today session bar visible during active questions', async () => {
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false, report_id: null, completed_at: null,
      in_progress: false, current: 0, total: 0,
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'today-report',
      question: { id: 'today-q', question: 'What is 4 + 4?', question_type: 'short_answer', subject: 'math' },
      progress: { current: 1, total: 15 },
    });
    window.history.replaceState({}, '', '/diagnostic?subject=math&year=year7&today_session=1&today_task=diagnostic-task');

    render(<DiagnosticPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Diagnostic' }));
    expect(await screen.findByText('What is 4 + 4?')).toBeTruthy();
    expect(screen.getByTestId('today-session-bar')).toBeTruthy();
  });
});


describe('Diagnostic subject-specific answer controls', () => {
  it('hides the math keyboard for English questions even with math metadata', async () => {
    mockPreferences.subject = 'english';
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false,
      report_id: null,
      completed_at: null,
      in_progress: false,
      current: 0,
      total: 0,
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'english-report',
      question: {
        id: 'english-short-answer',
        question: 'Explain the effect of this language choice.',
        question_type: 'short_answer',
        subject: 'english',
        topic_ids: ['AC9E7LY01'],
        math_metadata: {},
      },
      progress: { current: 1, total: 1 },
    });

    render(<DiagnosticPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Diagnostic' }));

    expect(await screen.findByRole('textbox', { name: 'Your answer' })).toBeTruthy();
    expect(screen.queryByTestId('math-keyboard')).toBeNull();
  });
});



describe('Diagnostic draft recovery', () => {
  it('restores a draft only when report and question IDs match', async () => {
    localStorage.clear();
    localStorage.setItem('qld_tutor_diagnostic_draft_v1', JSON.stringify({
      reportId: 'draft-report',
      questionId: 'draft-q',
      answer: 'restored calculation',
      partAnswers: {},
      savedAt: '2026-01-01T00:00:00.000Z',
    }));
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false,
      report_id: 'draft-report',
      completed_at: null,
      in_progress: true,
      current: 2,
      total: 10,
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'draft-report',
      question: {
        id: 'draft-q',
        question: 'Continue the calculation.',
        question_type: 'short_answer',
        subject: 'math',
      },
      progress: { current: 3, total: 10 },
    });

    render(<DiagnosticPage />);

    expect(await screen.findByText(/2 answers recorded/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume Diagnostic' }));
    const answerBox = await screen.findByRole('textbox', { name: 'Your answer' });
    expect((answerBox as HTMLTextAreaElement).value).toBe('restored calculation');
  });

  it('clears the diagnostic draft after a successful response', async () => {
    localStorage.clear();
    vi.mocked(diagnosticStatus).mockResolvedValueOnce({
      completed: false,
      report_id: null,
      completed_at: null,
      in_progress: false,
      current: 0,
      total: 1,
    });
    vi.mocked(diagnosticStart).mockResolvedValueOnce({
      report_id: 'clear-report',
      question: {
        id: 'clear-q',
        question: 'What is 2 + 2?',
        question_type: 'short_answer',
        subject: 'math',
      },
      progress: { current: 1, total: 1 },
    });
    vi.mocked(diagnosticRespond).mockResolvedValueOnce({
      completed: true,
      report_id: 'clear-report',
      areas: {},
      valid_completion: true,
      response_outcome: 'correct',
    });

    render(<DiagnosticPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Diagnostic' }));
    const answerBox = await screen.findByRole('textbox', { name: 'Your answer' });
    fireEvent.change(answerBox, { target: { value: '4' } });
    await waitFor(() => {
      const rawDraft = localStorage.getItem('qld_tutor_diagnostic_draft_v1');
      expect(rawDraft && JSON.parse(rawDraft).answer).toBe('4');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(diagnosticRespond).toHaveBeenCalledWith(
      'clear-report', 'clear-q', '4', undefined, undefined, { notLearned: false, confidence: null },
    ));
    expect(localStorage.getItem('qld_tutor_diagnostic_draft_v1')).toBeNull();
  });
});