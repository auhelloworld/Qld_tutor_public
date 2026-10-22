import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ExamResults from '../components/exam/ExamResults';
import type { ExamResult } from '../lib/api-types';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock('../components/MathMarkdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

afterEach(() => cleanup());

describe('ExamResults scoring details', () => {
  it('renders mark totals and multi-part feedback', () => {
    const results: ExamResult = {
      exam_id: 'exam-1',
      total_questions: 1,
      correct: 0,
      percentage: 50,
      total_score: 1,
      total_max_score: 2,
      strand_breakdown: [],
      weak_topics: [],
      time_limit_minutes: 45,
      results_per_question: [
        {
          question_id: 'q1',
          question: 'A long multi-part question that should be preserved in review.',
          correct_answer: '',
          student_answer: '{"a":"4","b":"9"}',
          is_correct: false,
          difficulty: 'developing',
          score: 1,
          max_score: 2,
          part_results: [
            { label: 'a', is_correct: true, marks: 1, student_answer: '4' },
            { label: 'b', is_correct: false, marks: 1, student_answer: '9' },
          ],
        },
      ],
    };

    render(
      <ExamResults
        results={results}
        reviewMode="collapsed"
        setReviewMode={vi.fn()}
        onRestart={vi.fn()}
      />,
    );

    expect(screen.getByText(/1 \/ 2 marks/)).toBeTruthy();
    expect(screen.getByText('Score: 1/2')).toBeTruthy();
    expect(screen.getByText('Part A')).toBeTruthy();
    expect(screen.getByText('Part B')).toBeTruthy();
    expect(screen.getByText(/long multi-part question/i)).toBeTruthy();
  });
});
