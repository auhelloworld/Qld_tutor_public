import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const tutorApi = vi.hoisted(() => ({
  tutorExplain: vi.fn(),
  tutorMark: vi.fn(),
  tutorSuggest: vi.fn(),
  tutorDialogue: vi.fn(),
  fetchMisconceptions: vi.fn(),
  fetchTopicWorkedExample: vi.fn(),
  tutorReflect: vi.fn(),
  tutorShowAnswer: vi.fn(),
  updateTutorAttemptMetadata: vi.fn(),
}));
const toastApi = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('../lib/api', () => tutorApi);
vi.mock('../lib/toast', () => toastApi);
vi.mock('../lib/preferences', () => ({ getLocale: () => 'en-AU' }));

import TutorInterface from '../components/TutorInterface';
import TutorControls from '../components/tutor/TutorControls';
import LessonContentPanel from '../components/tutor/LessonContentPanel';

Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Lesson content disclosure', () => {
  it('shows full lesson content expanded without a hide/more detail toggle', () => {
    render(
      <LessonContentPanel
        topic="AC9M7A02"
        onDismiss={() => {}}
        lessonContent={{
          has_lesson_content: true,
          core_rule: 'Use the same operation on both sides.',
          lesson_content: {
            learning_objectives: ['Solve a simple equation.'],
            explanation_sections: [
              { type: 'concept', heading: 'Core idea', body: 'Keep the equation balanced.' },
              { type: 'example', heading: 'Second example', body: 'Subtract three from both sides.' },
            ],
            key_vocabulary: [{ term: 'inverse', definition: 'An operation that reverses another.' }],
            common_mistakes: ['Changing only one side.'],
          },
        }}
      />
    );

    expect(screen.getByText(/Core idea/)).toBeTruthy();
    expect(screen.getByText(/Second example/)).toBeTruthy();
    expect(screen.getByText('inverse:')).toBeTruthy();
    expect(screen.getByText(/Changing only one side/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /More lesson detail/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Hide lesson detail/i })).toBeNull();
  });
});

describe('TutorInterface state safety', () => {
  it('shows a loading state without claiming the topic has no exercises', () => {
    render(
      <TutorInterface
        topic="AC9M7A02"
        subject="math"
        exercises={[]}
        loadingExercises={true}
      />
    );

    expect(screen.getByText('Loading question...')).toBeTruthy();
    expect(screen.queryByText(/No exercises available/i)).toBeNull();
  });

  it('shows a retryable state after a standard-practice network failure', () => {
    const onRetryExercises = vi.fn();
    render(
      <TutorInterface
        topic="AC9M7A02"
        subject="math"
        exercises={[]}
        exerciseLoadError={true}
        onRetryExercises={onRetryExercises}
      />
    );

    expect(screen.getByText(/could not load this practice question/i)).toBeTruthy();
    expect(screen.getByText(/saved progress has not changed/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry question' }));
    expect(onRetryExercises).toHaveBeenCalledOnce();
  });

  it('shows symbol keyboards only for mathematics subjects', async () => {
    const question = {
      id: 'subject-toolbar-question',
      subject: 'english',
      topic: 'AC9E7LY01',
      topic_ids: ['AC9E7LY01'],
      question: 'Explain how the author creates tension.',
      question_type: 'short_answer',
      math_metadata: {},
    };
    tutorApi.tutorSuggest.mockResolvedValue({ question });
    tutorApi.fetchTopicWorkedExample.mockResolvedValue({ has_worked_example: false });

    const { rerender } = render(
      <TutorInterface
        topic="AC9E7LY01"
        subject="english"
        exercises={[question]}
      />
    );

    await screen.findByPlaceholderText('Type your answer here... (Cmd/Ctrl+Enter to submit)');
    expect(screen.queryByTitle('Pi')).toBeNull();

    rerender(
      <TutorInterface
        topic="AC9M7N01"
        subject="math"
        exercises={[{ ...question, subject: 'math', topic: 'AC9M7N01', topic_ids: ['AC9M7N01'] }]}
      />
    );
    await waitFor(() => expect(screen.getAllByTitle('Pi')).toHaveLength(2));
  });


  it('starts a fresh multi-part round on the first submitted part', async () => {
    const repeatedQuestion = {
      id: 'repeated-multipart',
      subject: 'math',
      topic: 'fractions',
      topic_ids: ['AC9M7N04'],
      question: 'Answer all three parts.',
      question_type: 'multi_part',
      sub_parts: [
        { label: 'a', question: '2 × 3?', answer: '6', marks: 1 },
        { label: 'b', question: '5 × 2?', answer: '10', marks: 1 },
        { label: 'c', question: '3 × 5?', answer: '15', marks: 1 },
      ],
    };
    tutorApi.tutorSuggest.mockResolvedValue({ question: repeatedQuestion });
    tutorApi.fetchTopicWorkedExample.mockResolvedValue({ has_worked_example: false });
    tutorApi.tutorMark.mockResolvedValue({
      is_correct: false,
      outcome: 'unanswered',
      feedback: 'Part a is correct. Continue with part b.',
      question_type: 'multi_part',
      part_results: [
        { label: 'a', is_correct: true, outcome: 'correct', student_answer: '6' },
        { label: 'b', is_correct: false, outcome: 'unanswered', student_answer: '' },
        { label: 'c', is_correct: false, outcome: 'unanswered', student_answer: '' },
      ],
    });

    render(
      <TutorInterface
        topic="AC9M7N04"
        subject="math"
        exercises={[repeatedQuestion]}
      />
    );

    const input = await screen.findByPlaceholderText('Type your answer for part (a) here...');
    fireEvent.change(input, { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));

    await waitFor(() => expect(tutorApi.tutorMark).toHaveBeenCalledTimes(1));
    expect(tutorApi.tutorMark).toHaveBeenCalledWith(
      'repeated-multipart',
      '{"a":"6"}',
      undefined,
      expect.objectContaining({ firstAttempt: true }),
    );
    await waitFor(() => expect(screen.getAllByText('Unanswered')).toHaveLength(2));
    expect(screen.queryByText('999')).toBeNull();
  });
  it('shows one accumulated stars reward for a completed multi-part question', async () => {
    const question = {
      id: 'stars-multipart',
      subject: 'math',
      topic: 'fractions',
      topic_ids: ['AC9M7N04'],
      question: 'Answer all three parts.',
      question_type: 'multi_part',
      sub_parts: [
        { label: 'a', question: '2 × 3?', answer: '6', marks: 1 },
        { label: 'b', question: '5 × 2?', answer: '10', marks: 1 },
        { label: 'c', question: '3 × 5?', answer: '15', marks: 1 },
      ],
    };
    tutorApi.tutorSuggest.mockResolvedValue({ question });
    tutorApi.fetchTopicWorkedExample.mockResolvedValue({ has_worked_example: false });
    tutorApi.tutorMark
      .mockResolvedValueOnce({
        is_correct: false,
        outcome: 'unanswered',
        feedback: 'Part a is correct. Continue with part b.',
        question_type: 'multi_part',
        quest_award: { awarded: 2, stars: 2, level: 1 },
        part_results: [
          { label: 'a', is_correct: true, outcome: 'correct', student_answer: '6' },
          { label: 'b', is_correct: false, outcome: 'unanswered', student_answer: '' },
          { label: 'c', is_correct: false, outcome: 'unanswered', student_answer: '' },
        ],
      })
      .mockResolvedValueOnce({
        is_correct: false,
        outcome: 'unanswered',
        feedback: 'Part b is correct. Continue with part c.',
        question_type: 'multi_part',
        quest_award: { awarded: 2, stars: 4, level: 1 },
        part_results: [
          { label: 'a', is_correct: true, outcome: 'correct', student_answer: '6' },
          { label: 'b', is_correct: true, outcome: 'correct', student_answer: '10' },
          { label: 'c', is_correct: false, outcome: 'unanswered', student_answer: '' },
        ],
      })
      .mockResolvedValueOnce({
        is_correct: true,
        outcome: 'correct',
        feedback: 'All parts are correct.',
        question_type: 'multi_part',
        quest_award: { awarded: 2, stars: 6, level: 1 },
        part_results: [
          { label: 'a', is_correct: true, outcome: 'correct', student_answer: '6' },
          { label: 'b', is_correct: true, outcome: 'correct', student_answer: '10' },
          { label: 'c', is_correct: true, outcome: 'correct', student_answer: '15' },
        ],
      });

    render(<TutorInterface topic="AC9M7N04" subject="math" exercises={[question]} />);

    for (const [partLabel, answer] of [['a', '6'], ['b', '10'], ['c', '15']] as const) {
      const input = await screen.findByPlaceholderText(`Type your answer for part (${partLabel}) here...`);
      fireEvent.change(input, { target: { value: answer } });
      fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));
      await waitFor(() => expect(tutorApi.tutorMark).toHaveBeenCalledTimes(partLabel === 'a' ? 1 : partLabel === 'b' ? 2 : 3));
      if (partLabel !== 'c') expect(toastApi.showToast).not.toHaveBeenCalled();
    }

    await waitFor(() => expect(toastApi.showToast).toHaveBeenCalledTimes(1));
    expect(toastApi.showToast).toHaveBeenCalledWith('+6⭐  (balance 6 · Lv.1)', 'success');
  });

  it('keeps the immediate stars reward for a single-part question', async () => {
    const question = {
      id: 'stars-short-answer',
      subject: 'math',
      topic: 'fractions',
      topic_ids: ['AC9M7N04'],
      question: 'What is 2 + 2?',
      question_type: 'short_answer',
      answer: '4',
    };
    tutorApi.tutorSuggest.mockResolvedValue({ question });
    tutorApi.fetchTopicWorkedExample.mockResolvedValue({ has_worked_example: false });
    tutorApi.tutorMark.mockResolvedValue({
      is_correct: true,
      outcome: 'correct',
      feedback: 'Correct.',
      quest_award: { awarded: 6, stars: 6, level: 1 },
    });

    render(<TutorInterface topic="AC9M7N04" subject="math" exercises={[question]} />);
    const input = await screen.findByPlaceholderText('Type your answer here... (Cmd/Ctrl+Enter to submit)');
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));

    await waitFor(() => expect(toastApi.showToast).toHaveBeenCalledTimes(1));
    expect(toastApi.showToast).toHaveBeenCalledWith('+6⭐  (balance 6 · Lv.1)', 'success');
  });

  it('disables answer submission after an incorrect verdict until retry', () => {
    render(
      <TutorControls
        loading={false}
        answer="D"
        lastAnswerCorrect={false}
        lastAnswerIncorrect={true}
        lastAnswerPendingReview={false}
        isListening={false}
        remediationRequired={false}
        nextStep={null}
        howToFixHints={[]}
        showHowToFix={false}
        workedExample={null}
        topic="AC9M7A02"
        onSubmit={vi.fn()}
        onNext={vi.fn()}
        onToggleDictation={vi.fn()}
        onRetry={vi.fn()}
        onShowNextStepHint={vi.fn()}
        onShowWorkedExample={vi.fn()}
        onShowHowToFix={vi.fn()}
      />
    );

    expect((screen.getByRole('button', { name: /Submit Answer/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeTruthy();
    const skipButton = screen.getByRole('button', { name: /Skip this question/i }) as HTMLButtonElement;
    const errorBookLink = screen.getByRole('link', { name: /Review later in Error Book/i }) as HTMLAnchorElement;
    expect(screen.getByText('Other ways to continue')).toBeTruthy();
    expect(skipButton.style.minHeight).toBe('44px');
    expect(skipButton.style.background).not.toBe('transparent');
    expect(skipButton.style.border).toContain('solid');
    expect(errorBookLink.style.minHeight).toBe('44px');
    expect(errorBookLink.style.background).not.toBe('transparent');
    expect(errorBookLink.style.border).toContain('solid');
    expect(errorBookLink.getAttribute('href')).toBe('/mistakes');
    expect(screen.queryByText(/Speed Round/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Next Question$/i })).toBeNull();
  });
});



describe('TutorInterface exercise recovery', () => {
  it('distinguishes a fetch failure from an empty topic and retries', () => {
    const onRetryExercises = vi.fn();
    render(
      <TutorInterface
        topic="AC9M7A02"
        subject="math"
        exercises={[]}
        exerciseLoadError
        onRetryExercises={onRetryExercises}
      />
    );

    expect(screen.getByText('We could not load this practice question')).toBeTruthy();
    expect(screen.queryByText(/No practice questions are available/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry question' }));
    expect(onRetryExercises).toHaveBeenCalledOnce();
  });
});


describe('TutorInterface mobile feedback order', () => {
  it('keeps the mobile feedback heading inside the feedback panel after the question column', () => {
    const { container } = render(
      <TutorInterface
        topic=""
        subject="math"
        exercises={[]}
      />
    );

    const questionColumn = container.querySelector('.tutor-question-column');
    const feedbackColumn = container.querySelector('.tutor-feedback-column');
    const mobileFeedbackHeading = container.querySelector('.tutor-feedback-mobile-header');
    const desktopFeedbackHeading = container.querySelector('.tutor-header-feedback');

    expect(questionColumn).toBeTruthy();
    expect(feedbackColumn).toBeTruthy();
    expect(mobileFeedbackHeading?.parentElement).toBe(feedbackColumn);
    expect(desktopFeedbackHeading).toBeTruthy();
    expect(
      questionColumn!.compareDocumentPosition(mobileFeedbackHeading!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});


describe('Full Exercise metacognition and momentum', () => {
  it('saves a required explanation to the exact supported attempt', async () => {
    window.history.replaceState({}, '', '/?show_answer=1');
    const question = {
      id: 'supported-q',
      subject: 'math',
      topic: 'AC9M7N02',
      topic_ids: ['AC9M7N02'],
      question: 'What is 2 + 2?',
      question_type: 'short_answer',
      answer: '4',
    };
    tutorApi.tutorMark.mockResolvedValue({
      is_correct: true,
      outcome: 'correct',
      attempt_id: 'supported-attempt',
      feedback: 'Correct',
    });
    tutorApi.updateTutorAttemptMetadata.mockResolvedValue({ success: true });

    render(
      <TutorInterface
        topic="AC9M7N02"
        subject="math"
        exercises={[question]}
        initialQuestionId="supported-q"
      />,
    );

    const input = await screen.findByPlaceholderText('Type your answer here... (Cmd/Ctrl+Enter to submit)');
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));

    const explanation = await screen.findByLabelText('Self explanation');
    expect((screen.getByRole('button', { name: 'Save explanation' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(explanation, { target: { value: 'The inverse operation balances both sides.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save explanation' }));

    await waitFor(() => expect(tutorApi.updateTutorAttemptMetadata).toHaveBeenCalledWith(
      'supported-q',
      'supported-attempt',
      'The inverse operation balances both sides.',
    ));
    await waitFor(() => expect(screen.queryByLabelText('Self explanation')).toBeNull());
  });

  it('counts a fully correct multi-part root question as one momentum event', async () => {
    const question = {
      id: 'momentum-multipart',
      subject: 'math',
      topic: 'fractions',
      topic_ids: ['AC9M7N04'],
      question: 'Answer both parts.',
      question_type: 'multi_part',
      sub_parts: [
        { label: 'a', question: '2 × 3?', answer: '6', marks: 1 },
        { label: 'b', question: '5 × 2?', answer: '10', marks: 1 },
      ],
    };
    tutorApi.tutorSuggest.mockResolvedValue({ question });
    tutorApi.fetchTopicWorkedExample.mockResolvedValue({ has_worked_example: false });
    tutorApi.tutorMark
      .mockResolvedValueOnce({
        is_correct: false,
        outcome: 'unanswered',
        feedback: 'Part a is correct. Continue with part b.',
        question_type: 'multi_part',
        part_results: [
          { label: 'a', is_correct: true, outcome: 'correct', student_answer: '6' },
          { label: 'b', is_correct: false, outcome: 'unanswered', student_answer: '' },
        ],
      })
      .mockResolvedValueOnce({
        is_correct: true,
        outcome: 'correct',
        feedback: 'Both parts are correct.',
        question_type: 'multi_part',
        part_results: [
          { label: 'a', is_correct: true, outcome: 'correct', student_answer: '6' },
          { label: 'b', is_correct: true, outcome: 'correct', student_answer: '10' },
        ],
      });

    render(<TutorInterface topic="AC9M7N04" subject="math" exercises={[question]} />);
    const firstInput = await screen.findByPlaceholderText('Type your answer for part (a) here...');
    fireEvent.change(firstInput, { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));
    await waitFor(() => expect(tutorApi.tutorMark).toHaveBeenCalledTimes(1));

    const secondInput = await screen.findByPlaceholderText('Type your answer for part (b) here...');
    fireEvent.change(secondInput, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));

    await waitFor(() => expect(screen.getByText('1/1')).toBeTruthy());
    expect(screen.queryByText('1/2')).toBeNull();
  });
});


describe('Show Answer provenance', () => {
  it('submits support level 4 when a redo URL carries show_answer=1', async () => {
    window.history.replaceState({}, '', '/?show_answer=1');
    const question = {
      id: 'revealed-redo',
      subject: 'math',
      topic: 'AC9M7N02',
      topic_ids: ['AC9M7N02'],
      question: 'What is 2 + 2?',
      question_type: 'short_answer',
      answer: '4',
    };
    tutorApi.tutorMark.mockResolvedValue({
      is_correct: true,
      outcome: 'correct',
      feedback: 'Correct',
    });

    render(
      <TutorInterface
        topic="AC9M7N02"
        subject="math"
        exercises={[question]}
        initialQuestionId="revealed-redo"
      />,
    );

    const input = await screen.findByPlaceholderText('Type your answer here... (Cmd/Ctrl+Enter to submit)');
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));

    await waitFor(() => expect(tutorApi.tutorMark).toHaveBeenCalledWith(
      'revealed-redo',
      '4',
      undefined,
      expect.objectContaining({ usedShowAnswer: true, supportLevel: 4 }),
    ));
  });
});


describe('Practice loop feedback and gates', () => {
  const question = {
    id: 'loop-q',
    subject: 'math',
    topic: 'AC9M7N01',
    topic_ids: ['AC9M7N01'],
    question: 'What is 6 × 6?',
    question_type: 'short_answer',
    answer: '36',
  };
  const wrong = { is_correct: false, outcome: 'incorrect', error_type: 'incorrect_value', feedback: 'Not quite.' };
  const right = { is_correct: true, outcome: 'correct', attempt_id: 'loop-attempt', feedback: 'Correct! Well done.' };

  const renderLoop = () => {
    tutorApi.fetchTopicWorkedExample.mockResolvedValue({ has_worked_example: false });
    return render(
      <TutorInterface topic="AC9M7N01" subject="math" exercises={[question]} initialQuestionId="loop-q" />,
    );
  };
  const answerWith = async (value: string) => {
    const input = await screen.findByPlaceholderText('Type your answer here... (Cmd/Ctrl+Enter to submit)');
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));
  };
  const controlTryAgain = () => {
    // The control-row button renders after the Concept Study Break panel.
    const buttons = screen.getAllByRole('button', { name: /Try Again/i });
    fireEvent.click(buttons[buttons.length - 1]);
  };

  it('does not show a broken empty-topic message when no topic is selected', () => {
    render(<TutorInterface topic="" subject="math" exercises={[]} />);
    expect(screen.queryByText(/No exercises available/i)).toBeNull();
  });

  it('unlocks submission from the control-row Try Again after repeated errors', async () => {
    tutorApi.tutorMark.mockResolvedValue(wrong);
    renderLoop();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await answerWith('99');
      await waitFor(() => expect(tutorApi.tutorMark).toHaveBeenCalledTimes(attempt));
      await screen.findAllByRole('button', { name: /Try Again/i });
      if (attempt < 3) controlTryAgain();
    }
    expect(await screen.findByText(/Concept Study Break/)).toBeTruthy();

    controlTryAgain();
    const input = await screen.findByPlaceholderText('Type your answer here... (Cmd/Ctrl+Enter to submit)');
    fireEvent.change(input, { target: { value: '36' } });
    expect((screen.getByRole('button', { name: /Submit Answer/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables Next with a visible reason while a required self-explanation is open', async () => {
    tutorApi.tutorMark.mockResolvedValueOnce(wrong).mockResolvedValueOnce(right);
    tutorApi.updateTutorAttemptMetadata.mockResolvedValue({ success: true });
    renderLoop();

    await answerWith('99');
    await screen.findAllByRole('button', { name: /Try Again/i });
    controlTryAgain();
    await answerWith('36');

    const explanation = await screen.findByLabelText('Self explanation');
    expect((screen.getByRole('button', { name: /Next Question/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Save your explanation to continue.')).toBeTruthy();

    fireEvent.change(explanation, { target: { value: 'Six groups of six make thirty six.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save explanation' }));
    await waitFor(() => expect(screen.queryByLabelText('Self explanation')).toBeNull());
    expect((screen.getByRole('button', { name: /Next Question/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says Correct once and does not offer a harder-question button that does not exist', async () => {
    tutorApi.tutorMark.mockResolvedValue(right);
    const { container } = renderLoop();

    await answerWith('36');
    await screen.findByRole('button', { name: /Next Question/i });
    const text = container.textContent || '';
    expect(text.match(/Correct!/g)?.length).toBe(1);
    expect(text).not.toMatch(/harder one/i);
  });

  it('gets the answer from the server for Show Answer, then marks the next answer as revealed', async () => {
    // Real question payloads have no answer key.
    const { answer: _answerKey, ...answerFree } = question;
    void _answerKey;
    tutorApi.tutorMark.mockResolvedValue(wrong);
    tutorApi.tutorShowAnswer.mockResolvedValue({ question_id: 'loop-q', correct_answer: '36' });
    tutorApi.fetchTopicWorkedExample.mockResolvedValue({ has_worked_example: false });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TutorInterface topic="AC9M7N01" subject="math" exercises={[answerFree]} initialQuestionId="loop-q" />);

    await answerWith('99');
    await screen.findAllByRole('button', { name: /Try Again/i });
    controlTryAgain();
    await answerWith('98');
    fireEvent.click(await screen.findByRole('button', { name: /Show Answer/ }));

    expect(await screen.findByText(/Answer: 36/)).toBeTruthy();
    expect(screen.queryByText(/not available/)).toBeNull();
    expect(tutorApi.tutorShowAnswer).toHaveBeenCalledWith('loop-q');

    controlTryAgain();
    tutorApi.tutorMark.mockResolvedValue(right);
    await answerWith('36');
    await waitFor(() => expect(tutorApi.tutorMark).toHaveBeenLastCalledWith(
      'loop-q', '36', undefined, expect.objectContaining({ usedShowAnswer: true, supportLevel: 4 }),
    ));
    confirm.mockRestore();
  });

  it('keeps the next answer independent when the answer cannot load', async () => {
    const { answer: _answerKey, ...answerFree } = question;
    void _answerKey;
    tutorApi.tutorMark.mockResolvedValue(wrong);
    tutorApi.tutorShowAnswer.mockRejectedValue(new Error('offline'));
    tutorApi.fetchTopicWorkedExample.mockResolvedValue({ has_worked_example: false });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TutorInterface topic="AC9M7N01" subject="math" exercises={[answerFree]} initialQuestionId="loop-q" />);

    await answerWith('99');
    await screen.findAllByRole('button', { name: /Try Again/i });
    controlTryAgain();
    await answerWith('98');
    fireEvent.click(await screen.findByRole('button', { name: /Show Answer/ }));

    await waitFor(() => expect(toastApi.showToast).toHaveBeenCalledWith('Could not load the answer. Try again.', 'error'));
    expect(screen.queryByText(/✅ Answer/)).toBeNull();
    expect((screen.getByRole('button', { name: /Show Answer/ }) as HTMLButtonElement).disabled).toBe(false);

    controlTryAgain();
    tutorApi.tutorMark.mockResolvedValue(right);
    await answerWith('36');
    await waitFor(() => expect(tutorApi.tutorMark).toHaveBeenLastCalledWith(
      'loop-q', '36', undefined, expect.objectContaining({ usedShowAnswer: false }),
    ));
    confirm.mockRestore();
  });
});

describe('Practice page names and entry points', () => {
  it('shows the curriculum topic name instead of the topic code', async () => {
    const question = {
      id: 'named-topic-question',
      subject: 'math',
      topic: 'AC9M7N01',
      topic_ids: ['AC9M7N01'],
      question: 'What is the square root of 49?',
      question_type: 'short_answer',
      math_metadata: {},
    };
    tutorApi.tutorSuggest.mockResolvedValue({ question });
    tutorApi.fetchTopicWorkedExample.mockResolvedValue({ has_worked_example: false });

    render(
      <TutorInterface
        topic="AC9M7N01"
        topicName="Squares and square roots"
        subject="math"
        yearLevel={7}
        exercises={[question]}
      />
    );

    await screen.findByText('What is the square root of 49?');
    expect(screen.getAllByText(/Squares and square roots/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/AC9M7N01/)).toBeNull();
  });

  it('links the empty practice state to the scoped Today Study session', () => {
    render(
      <TutorInterface
        topic=""
        subject="math"
        yearLevel={8}
        exercises={[]}
      />
    );

    const link = screen.getByRole('link', { name: /Start Today’s Study/i });
    // No question count in the link: /today reads the saved choice itself.
    expect(link.getAttribute('href')).toBe('/today?subject=math&year=year8');
  });
});
