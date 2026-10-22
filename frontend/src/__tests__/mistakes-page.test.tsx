import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MistakesPage from '../app/mistakes/page';

const apiMocks = vi.hoisted(() => ({
  fetchCurriculum: vi.fn(),
  fetchErrorTaxonomy: vi.fn(),
  fetchMistakes: vi.fn(),
  fetchTrapNotebook: vi.fn(),
  resolveMistakeReview: vi.fn(),
  recordMistakeCause: vi.fn(),
  tutorMark: vi.fn(),
  tutorSuggest: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  ...apiMocks,
  analyticsScopeFromYear: (year: string) => ({ yearLevel: Number(year.replace('year', '')) }),
  syllabusSubjectFromPickerSubject: () => undefined,
}));

vi.mock('../lib/preferences', () => ({
  getSubject: () => 'math',
  getYear: () => 'year7',
}));

vi.mock('../lib/student_id', () => ({ getStudentId: () => 'student-error-book' }));
vi.mock('../components/FrameworkSubjectYearPicker', () => ({ default: () => <div>Scope picker</div> }));
vi.mock('../components/MathMarkdown', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../components/QuestionContext', () => ({
  default: ({ question }: { question: { diagram_data?: { type?: string } | null; image?: string | null; passage?: string | null } }) => (
    <div
      data-testid="question-context"
      data-diagram-type={question.diagram_data?.type || ''}
      data-image={question.image || ''}
      data-passage={question.passage || ''}
    />
  ),
}));
vi.mock('../components/BackToPracticeLink', () => ({ default: () => <span>Back</span> }));

beforeEach(() => {
  window.history.replaceState({}, '', '/mistakes');
  apiMocks.fetchCurriculum.mockResolvedValue({
    math: { year7: {} },
    english: { year8: {} },
  });
  apiMocks.fetchErrorTaxonomy.mockResolvedValue({ error_types: [] });
  apiMocks.fetchTrapNotebook.mockResolvedValue({ entries: [] });
  apiMocks.fetchMistakes.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Error Book loading failures', () => {
  it('shows a retryable error instead of the celebratory empty state', async () => {
    apiMocks.fetchMistakes
      .mockRejectedValueOnce(new Error('Mistake service unavailable'))
      .mockResolvedValueOnce({ mistakes: [], total: 0, returned: 0, offset: 0, has_more: false });

    render(<MistakesPage />);

    expect(await screen.findByText('Could not load the Error Book')).toBeTruthy();
    expect(screen.getByText('Mistake service unavailable')).toBeTruthy();
    expect(screen.queryByText('No mistakes yet!')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(apiMocks.fetchMistakes).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No mistakes yet!')).toBeTruthy();
  });
});


describe('Error Book scope and analytics semantics', () => {
  it('uses the URL-derived subject/year for the first mistakes request', async () => {
    window.history.replaceState({}, '', '/mistakes?subject=english&year=year8');
    apiMocks.fetchMistakes.mockResolvedValue({
      mistakes: [], total: 0, returned: 0, offset: 0, has_more: false,
    });

    render(<MistakesPage />);

    await waitFor(() => expect(apiMocks.fetchMistakes).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'english', yearLevel: 8, status: 'active', limit: 50, offset: 0,
      }),
      expect.any(AbortSignal),
    ));
  });

  it('labels raw historical counts as frequency rather than weakest mastery', async () => {
    apiMocks.fetchMistakes.mockResolvedValue({
      mistakes: [
        {
          question_id: 'q1', topic_id: 'AC9M7N01', question: 'Q1', correct_answer: '1',
          question_type: 'short_answer', timestamp: '2026-01-01T00:00:00+00:00', resolved: false,
        },
        {
          question_id: 'q2', topic_id: 'AC9M7N01', question: 'Q2', correct_answer: '2',
          question_type: 'short_answer', timestamp: '2026-01-02T00:00:00+00:00', resolved: false,
        },
      ],
      total: 2, returned: 2, offset: 0, has_more: false,
    });

    render(<MistakesPage />);

    expect(await screen.findByText(/Most Frequent Historical Mistake Topic:/i)).toBeTruthy();
    expect(screen.queryByText(/Weakest Topic:/i)).toBeNull();
  });
});


describe('Error Book server pagination', () => {
  it('requests the next offset and appends the next server page', async () => {
    const summary = {
      total: 2,
      active: 2,
      resolved: 0,
      reviews: 0,
      topic_counts: { AC9M7N01: 2 },
      error_type_counts: { concept_gap: 2 },
      topic_progress: { AC9M7N01: { total: 2, overcome: 0, reviews: 0 } },
    };
    apiMocks.fetchMistakes
      .mockResolvedValueOnce({
        mistakes: [{
          question_id: 'q1', topic_id: 'AC9M7N01', question: 'Q1', correct_answer: '1',
          question_type: 'short_answer', timestamp: '2026-01-02T00:00:00+00:00',
          resolved: false, error_type: 'concept_gap', misconception_id: null,
        }],
        total: 2, returned: 1, offset: 0, has_more: true, summary,
      })
      .mockResolvedValueOnce({
        mistakes: [{
          question_id: 'q2', topic_id: 'AC9M7N01', question: 'Q2', correct_answer: '2',
          question_type: 'short_answer', timestamp: '2026-01-01T00:00:00+00:00',
          resolved: false, error_type: 'concept_gap', misconception_id: null,
        }],
        total: 2, returned: 1, offset: 1, has_more: false, summary,
      });

    render(<MistakesPage />);

    const loadMore = await screen.findByRole('button', { name: /Load More \(1 remaining\)/i });
    fireEvent.click(loadMore);

    await waitFor(() => expect(apiMocks.fetchMistakes).toHaveBeenCalledTimes(2));
    expect(apiMocks.fetchMistakes).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'active', limit: 50, offset: 1 }),
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: /Load More/i })).toBeNull());
  });
});


describe('Error Book closure stages', () => {
  it('records a cause before advancing an active mistake to retry', async () => {
    apiMocks.recordMistakeCause.mockResolvedValue({
      closure_stage: 'needs_retry',
      error_cause: 'concept_gap',
      cause_recorded_at: '2026-07-31T10:00:00+00:00',
    });
    apiMocks.fetchMistakes.mockResolvedValue({
      mistakes: [{
        question_id: 'q-cause', topic_id: 'AC9M7N01', question: 'Q', correct_answer: '1',
        question_type: 'short_answer', timestamp: '2026-07-31T09:00:00+00:00',
        resolved: false, closure_stage: 'needs_understanding', error_type: 'concept_gap',
        misconception_id: null,
      }],
      total: 1, returned: 1, offset: 0, has_more: false,
      summary: {
        total: 1, active: 1, resolved: 0, reviews: 0,
        topic_counts: { AC9M7N01: 1 }, error_type_counts: { concept_gap: 1 },
        topic_progress: { AC9M7N01: { total: 1, overcome: 0, reviews: 0 } },
      },
    });

    render(<MistakesPage />);

    expect(await screen.findByText('1 · Understand the error')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Concept unclear/ }));

    await waitFor(() => expect(apiMocks.recordMistakeCause).toHaveBeenCalledWith(
      expect.objectContaining({
        question_id: 'q-cause', topic_id: 'AC9M7N01', error_cause: 'concept_gap',
      }),
    ));
  });

  it('reuses an existing reflection without asking for the cause again', async () => {
    apiMocks.fetchMistakes.mockResolvedValue({
      mistakes: [{
        question_id: 'q-reflected', topic_id: 'AC9E8LY01', subject: 'english',
        question: 'Q', correct_answer: 'A', question_type: 'short_answer',
        timestamp: '2026-07-31T09:00:00+00:00', resolved: false,
        closure_stage: 'needs_retry', error_type: 'reading_comprehension',
        error_cause: 'vocabulary_gap', misconception_id: null,
      }],
      total: 1, returned: 1, offset: 0, has_more: false,
      summary: {
        total: 1, active: 1, resolved: 0, reviews: 0,
        topic_counts: { AC9E8LY01: 1 }, error_type_counts: { reading_comprehension: 1 },
        topic_progress: { AC9E8LY01: { total: 1, overcome: 0, reviews: 0 } },
      },
    });

    render(<MistakesPage />);

    expect(await screen.findByText('2 · Redo independently')).toBeTruthy();
    expect(screen.getByText(/Recorded cause:/).textContent).toContain('Vocabulary/spelling gap');
    expect(screen.queryByText('First, what caused this error?')).toBeNull();
    expect(apiMocks.recordMistakeCause).not.toHaveBeenCalled();
  });
});


describe('Error Book transfer quiz', () => {
  const summary = {
    total: 1, active: 1, resolved: 0, reviews: 0,
    topic_counts: { AC9M7N01: 1 }, error_type_counts: { concept_gap: 1 },
    topic_progress: { AC9M7N01: { total: 1, overcome: 0, reviews: 0 } },
  };

  it('moves the mistake on right after the answer, with one request ID per answer', async () => {
    apiMocks.fetchMistakes.mockResolvedValue({
      mistakes: [{
        question_id: 'q-transfer', topic_id: 'AC9M7N01', question: 'Source', correct_answer: '1',
        question_type: 'short_answer', timestamp: '2026-07-31T09:00:00+00:00',
        resolved: false, closure_stage: 'needs_transfer', error_type: 'concept_gap', misconception_id: null,
      }],
      total: 1, returned: 1, offset: 0, has_more: false, summary,
    });
    apiMocks.tutorSuggest.mockResolvedValue({
      question: { id: 'q-variation', question: 'Transfer variation', question_type: 'short_answer' },
      variation_match: { eligible: true },
    });
    apiMocks.tutorMark.mockResolvedValue({
      is_correct: true, outcome: 'correct', feedback: 'Correct!', attempt_id: 'att-7', review_resolution_eligible: true,
    });
    apiMocks.resolveMistakeReview.mockResolvedValue({
      status: 'active', resolved: false, review_count: 1, closure_stage: 'needs_consolidation',
    });

    render(<MistakesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Do a transfer question/ }));
    fireEvent.change(await screen.findByLabelText('Your Answer:'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));

    // Saved at once: leaving the quiz now cannot lose the step.
    await waitFor(() => expect(apiMocks.resolveMistakeReview).toHaveBeenCalledWith(expect.objectContaining({
      question_id: 'q-transfer', topic_id: 'AC9M7N01', resolved: true,
      resolutionSource: 'demonstrated_correction', requestId: 'error-book-resolve-att-7',
    })));
    expect(apiMocks.tutorMark).toHaveBeenCalledWith('q-variation', '2', undefined, expect.objectContaining({
      reviewSource: 'error_book', reviewQuestionId: 'q-transfer',
    }));

    fireEvent.click(await screen.findByRole('button', { name: /Finish Challenge/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Return to Error Book/ }));
    await waitFor(() => expect(apiMocks.fetchMistakes).toHaveBeenCalledTimes(2));
    expect(apiMocks.resolveMistakeReview).toHaveBeenCalledTimes(1);
  });
});



describe('Error Book closure evidence semantics', () => {
  it('shows evidence-backed closures separately from dismissed items', async () => {
    apiMocks.fetchMistakes.mockResolvedValue({
      mistakes: [{
        question_id: 'q-active', topic_id: 'AC9M7N01', question: 'Q', correct_answer: '1',
        question_type: 'short_answer', timestamp: '2026-08-01T00:00:00+00:00',
        resolved: false, closure_stage: 'needs_understanding', error_type: 'concept_gap', misconception_id: null,
      }],
      total: 1, returned: 1, offset: 0, has_more: false,
      summary: {
        total: 4, active: 1, resolved: 3, closed: 2, dismissed: 1, reviews: 3,
        topic_counts: { AC9M7N01: 4 }, error_type_counts: { concept_gap: 4 },
        topic_progress: { AC9M7N01: { total: 4, overcome: 2, reviews: 3 } },
      },
    });

    render(<MistakesPage />);

    expect(await screen.findByText(/Closed with evidence/)).toBeTruthy();
    expect(screen.getByText('Dismissed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Closed / dismissed (3)' })).toBeTruthy();
  });
});


describe('Error Book reveal provenance', () => {
  it('carries Show Answer state into the primary redo link', async () => {
    apiMocks.fetchMistakes.mockResolvedValue({
      mistakes: [{
        question_id: 'q-reveal', topic_id: 'AC9M7N01', question: 'Q', correct_answer: '1',
        question_type: 'short_answer', timestamp: '2026-08-01T00:00:00+00:00',
        resolved: false, closure_stage: 'needs_retry', error_type: 'concept_gap', misconception_id: null,
      }],
      total: 1, returned: 1, offset: 0, has_more: false,
    });

    render(<MistakesPage />);

    const showAnswer = await screen.findByRole('button', { name: 'Show Answer' });
    const redo = screen.getByRole('link', { name: /Redo question/i });
    expect(redo.getAttribute('href')).not.toContain('show_answer=1');

    fireEvent.click(showAnswer);
    expect(screen.getByRole('link', { name: /Redo question/i }).getAttribute('href'))
      .toContain('show_answer=1');
  });
});
