import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExamInProgress from '../components/exam/ExamInProgress';
import type { ExamQuestion } from '../lib/api-types';

vi.mock('../components/MathMarkdown', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../components/QuestionContext', () => ({ default: () => <div>Question context</div> }));
vi.mock('../components/MathSymbolKeyboard', () => ({ default: () => <div data-testid="math-keyboard" /> }));

const question: ExamQuestion = {
  id: 'q1',
  question: 'What is 2 + 2?',
  question_type: 'short_answer',
  difficulty: 'foundational',
  complexity: null,
  topic_ids: ['AC9M7N01'],
};

afterEach(() => cleanup());

describe('ExamInProgress reliability and accessibility', () => {
  it('exposes the countdown as a named timer', () => {
    render(
      <ExamInProgress
        subject="math"
        questions={[question]}
        responses={{}}
        setResponses={vi.fn()}
        currentIdx={0}
        setCurrentIdx={vi.fn()}
        timeLeft={90}
        answeredCount={0}
        multiPartAnswers={{}}
        setMultiPartAnswers={vi.fn()}
        handleSubmit={vi.fn()}
        loading={false}
        flagged={new Set()}
        setFlagged={vi.fn()}
      />,
    );

    const timer = screen.getByRole('timer');
    expect(timer.getAttribute('aria-label')).toBe('Time remaining: 1:30');
    expect(timer.textContent).toContain('1:30');
  });

  it('keeps a submit failure visible and offers a retry action', () => {
    const handleSubmit = vi.fn();
    render(
      <ExamInProgress
        subject="math"
        questions={[question]}
        responses={{ q1: '4' }}
        setResponses={vi.fn()}
        currentIdx={0}
        setCurrentIdx={vi.fn()}
        timeLeft={300}
        answeredCount={1}
        multiPartAnswers={{}}
        setMultiPartAnswers={vi.fn()}
        handleSubmit={handleSubmit}
        loading={false}
        submitError="Submission failed. Please retry."
        flagged={new Set()}
        setFlagged={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Submission failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry submit' }));
    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });

  it('gives written sub-parts a spacious resizable answer area', () => {
    const setMultiPartAnswers = vi.fn();
    const multiPartQuestion: ExamQuestion = {
      id: 'multipart-q1',
      question: 'Complete each part and show your working.',
      question_type: 'multi_part',
      difficulty: 'developing',
      complexity: null,
      topic_ids: ['AC9M7N01'],
      sub_parts: [
        { label: 'a', question: 'Explain your method.', marks: 2 },
        { label: 'b', question: 'Calculate the result.', marks: 1 },
      ],
    };

    render(
      <ExamInProgress
        subject="math"
        questions={[multiPartQuestion]}
        responses={{}}
        setResponses={vi.fn()}
        currentIdx={0}
        setCurrentIdx={vi.fn()}
        timeLeft={600}
        answeredCount={0}
        multiPartAnswers={{}}
        setMultiPartAnswers={setMultiPartAnswers}
        handleSubmit={vi.fn()}
        loading={false}
        flagged={new Set()}
        setFlagged={vi.fn()}
      />,
    );

    const answer = screen.getByRole('textbox', { name: 'Answer for Part (a)' }) as HTMLTextAreaElement;
    expect(answer.tagName).toBe('TEXTAREA');
    expect(answer.rows).toBe(5);
    expect(answer.style.minHeight).toBe('140px');
    expect(answer.style.resize).toBe('vertical');

    fireEvent.change(answer, { target: { value: 'I would first identify the relevant relationship and explain each step.' } });
    expect(setMultiPartAnswers).toHaveBeenCalledTimes(1);
    const updater = setMultiPartAnswers.mock.calls[0][0] as (prev: Record<string, Record<string, string>>) => Record<string, Record<string, string>>;
    expect(updater({})).toEqual({
      'multipart-q1': {
        a: 'I would first identify the relevant relationship and explain each step.',
      },
    });
  });
});


describe('ExamInProgress subject-specific answer controls', () => {
  it('hides the math symbol keyboard for English exams', () => {
    render(
      <ExamInProgress
        subject="english"
        questions={[{ ...question, id: 'english-q1', question: 'Explain the writer’s viewpoint.', topic_ids: ['AC9E7LY01'] }]}
        responses={{}}
        setResponses={vi.fn()}
        currentIdx={0}
        setCurrentIdx={vi.fn()}
        timeLeft={600}
        answeredCount={0}
        multiPartAnswers={{}}
        setMultiPartAnswers={vi.fn()}
        handleSubmit={vi.fn()}
        loading={false}
        flagged={new Set()}
        setFlagged={vi.fn()}
      />,
    );

    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.queryByTestId('math-keyboard')).toBeNull();
  });
});
