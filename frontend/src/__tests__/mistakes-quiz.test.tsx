import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MistakeQuizView,
  isMistakeQuizAnswerComplete,
  mistakeQuizSummary,
  type MistakeQuizResult,
} from '../app/mistakes/page';
import type { Mistake } from '../lib/api-types';

vi.mock('../components/MathMarkdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/QuestionContext', () => ({
  default: ({ question }: { question: { question?: string; diagram_data?: { type?: string } | null; image?: string | null } }) => (
    <div
      data-testid="question-context"
      data-diagram-type={question.diagram_data?.type || ''}
      data-image={question.image || ''}
    >
      {question.question}
    </div>
  ),
}));

afterEach(cleanup);

const shortQuestion = {
  question_id: 'source-1',
  topic_id: 'AC9M7N01',
  question: 'What is 2 + 2?',
  question_type: 'short_answer',
  correct_answer: '4',
} as Mistake;

const multiQuestion = {
  ...shortQuestion,
  question_id: 'source-multi',
  question: 'Answer both parts.',
  question_type: 'multi_part',
  sub_parts: [
    { label: 'a', question: 'What is 2 + 2?', answer: '4', marks: 1 },
    { label: 'b', question: 'What is 3 + 3?', answer: '6', marks: 1 },
  ],
} as Mistake;

const choiceQuestion = {
  ...shortQuestion,
  question_id: 'source-choice',
  question: 'Choose the even number.',
  question_type: 'multiple_choice',
  choices: ['Three', 'Four', 'Five'],
  correct_answer: 'B',
} as Mistake;

const mixedMultiQuestion = {
  ...multiQuestion,
  question_id: 'source-mixed-multi',
  sub_parts: [
    {
      label: 'A', question: 'Choose 4.', answer: 'B', correct_choice: 'B', choices: ['3', '4'], marks: 1,
      diagram_data: { type: 'number_line' },
    },
    {
      label: 'B', question: 'Explain why 4 is even.', answer: 'It is divisible by 2.', marks: 2,
      image: '/part-b.png',
    },
  ],
} as Mistake;

const reasoningQuestion = {
  ...shortQuestion,
  question_id: 'source-reasoning',
  question: 'Explain your reasoning.',
  question_type: 'reasoning',
} as Mistake;

const baseProps = {
  subject: 'math',
  questions: [shortQuestion],
  currentIndex: 0,
  answer: '4',
  setAnswer: vi.fn(),
  multiPartAnswers: {},
  setMultiPartAnswers: vi.fn(),
  results: [] as MistakeQuizResult[],
  submitting: false,
  markResult: null,
  feedback: '',
  onSubmit: vi.fn(),
  onNext: vi.fn(),
  onFinish: vi.fn(),
  finishing: false,
  onCancel: vi.fn(),
};

describe('Error Book quiz contracts', () => {
  it('requires every multi-part answer before submission', () => {
    expect(isMistakeQuizAnswerComplete(multiQuestion, '', {})).toBe(false);
    expect(isMistakeQuizAnswerComplete(multiQuestion, '', { a: '4' })).toBe(false);
    expect(isMistakeQuizAnswerComplete(multiQuestion, '', { a: '4', b: '  ' })).toBe(false);
    expect(isMistakeQuizAnswerComplete(multiQuestion, '', { a: '4', b: '6' })).toBe(true);
  });

  it('counts only transfer-safe correct results as resolved', () => {
    const results: MistakeQuizResult[] = [
      {
        question_id: 'eligible', outcome: 'correct', is_correct: true,
        resolution_eligible: true, student_answer: '4', correct_answer: '4', question: 'Eligible',
      },
      {
        question_id: 'not-eligible', outcome: 'correct', is_correct: true,
        resolution_eligible: false, student_answer: '4', correct_answer: '4', question: 'Not eligible',
      },
      {
        question_id: 'pending', outcome: 'pending', is_correct: false,
        resolution_eligible: false, student_answer: 'explanation', correct_answer: '', question: 'Pending',
      },
    ];

    expect(mistakeQuizSummary(results)).toEqual({ correct: 2, resolved: 1, pending: 1 });
    render(<MistakeQuizView {...baseProps} step="summary" questions={[shortQuestion, shortQuestion, shortQuestion]} results={results} />);
    const summaryText = screen.getByText((_, element) => (
      element?.tagName === 'P'
      && Boolean(element.textContent?.includes('You answered 2 of 3 correctly.'))
    ));
    expect(summaryText.textContent).toContain('1 mistake moved to the next Error Book stage.');
    expect(summaryText.textContent).toContain('awaiting review and not counted as incorrect.');
  });

  it('renders a pending semantic mark as awaiting review, not incorrect', () => {
    render(
      <MistakeQuizView
        {...baseProps}
        step="feedback"
        markResult={{ is_correct: false, outcome: 'pending', feedback: 'Saved for parent review.' }}
        feedback="Saved for parent review."
      />,
    );

    expect(screen.getByText(/Awaiting review — not marked incorrect/i)).toBeTruthy();
    expect(screen.queryByText(/Incorrect Answer/i)).toBeNull();
  });

  it('shows grading network failures while still on the question', () => {
    render(
      <MistakeQuizView
        {...baseProps}
        step="question"
        markResult={null}
        feedback="Failed to grade answer. Please try again."
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Failed to grade answer');
  });

  it('programmatically labels short and multi-part inputs', () => {
    const { rerender } = render(<MistakeQuizView {...baseProps} step="question" />);
    expect(screen.getByLabelText('Your Answer:')).toBeTruthy();

    rerender(
      <MistakeQuizView
        {...baseProps}
        step="question"
        questions={[multiQuestion]}
        answer=""
        multiPartAnswers={{ a: '', b: '' }}
      />,
    );
    expect(screen.getByLabelText(/Part A: What is 2 \+ 2/i)).toBeTruthy();
    expect(screen.getByLabelText(/Part B: What is 3 \+ 3/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit Answer' }).hasAttribute('disabled')).toBe(true);
  });

  it('submits top-level multiple-choice answers by option label', () => {
    const setAnswer = vi.fn();
    render(
      <MistakeQuizView
        {...baseProps}
        step="question"
        questions={[choiceQuestion]}
        answer=""
        setAnswer={setAnswer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /B.*Four/i }));
    expect(setAnswer).toHaveBeenCalledWith('B');
  });

  it('supports choices and expanded written answers inside multi-part questions', () => {
    const setMultiPartAnswers = vi.fn();
    render(
      <MistakeQuizView
        {...baseProps}
        step="question"
        questions={[mixedMultiQuestion]}
        answer=""
        multiPartAnswers={{ a: '', b: '' }}
        setMultiPartAnswers={setMultiPartAnswers}
      />,
    );

    const partAVisual = screen.getByLabelText('Part A visual');
    expect(partAVisual.querySelector('[data-diagram-type="number_line"]')).toBeTruthy();
    const partBVisual = screen.getByLabelText('Part B visual');
    expect(partBVisual.querySelector('[data-image="/part-b.png"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: '4' }));
    const choiceUpdater = setMultiPartAnswers.mock.calls[0][0] as (previous: Record<string, string>) => Record<string, string>;
    expect(choiceUpdater({})).toEqual({ a: 'B' });

    const writtenPart = screen.getByLabelText(/Part B: Explain why 4 is even/i) as HTMLTextAreaElement;
    expect(writtenPart.tagName).toBe('TEXTAREA');
    expect(writtenPart.style.minHeight).toBe('132px');
  });

  it('uses a large reasoning textarea with the shared symbol keyboard', () => {
    const setAnswer = vi.fn();
    render(
      <MistakeQuizView
        {...baseProps}
        step="question"
        questions={[reasoningQuestion]}
        answer=""
        setAnswer={setAnswer}
      />,
    );

    const textarea = screen.getByLabelText('Your Reasoning:') as HTMLTextAreaElement;
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.style.minHeight).toBe('220px');
    fireEvent.click(screen.getByRole('button', { name: 'Pi' }));
    expect(setAnswer).toHaveBeenCalledWith('π');
  });

  it('hides the symbol keyboard for English mistake review', () => {
    render(
      <MistakeQuizView
        {...baseProps}
        subject="english"
        step="question"
        questions={[{ ...reasoningQuestion, subject: 'english', topic_id: 'AC9E7LY01' }]}
        answer=""
      />,
    );

    expect(screen.getByLabelText('Your Reasoning:')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'π' })).toBeNull();
  });

  it('disables Finish while corrections are being saved', () => {
    render(<MistakeQuizView {...baseProps} step="summary" finishing />);
    const button = screen.getByRole('button', { name: 'Saving corrections...' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });
});
