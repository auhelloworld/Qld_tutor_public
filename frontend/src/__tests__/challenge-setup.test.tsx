import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChallengePage from '../app/challenge/page';
import { challengeStart, tutorMark } from '../lib/api';

vi.mock('../lib/preferences', () => ({
  getSubject: () => 'math',
  getYear: () => 'year7',
}));

vi.mock('../lib/api', () => ({
  fetchCurriculum: vi.fn().mockResolvedValue({
    math: {
      year7: {
        sequence: ['AC9M7A01'],
        AC9M7A01: { name: 'Variables in formulas' },
      },
    },
  }),
  challengeStart: vi.fn(),
  tutorMark: vi.fn(),
}));

afterEach(() => cleanup());

describe('Speed Round setup', () => {
  it('excludes curriculum sequence metadata from the topic selector', async () => {
    render(<ChallengePage />);

    await waitFor(() => expect(screen.getByRole('option', { name: 'Variables in formulas (AC9M7A01)' })).toBeTruthy());
    expect(screen.queryByRole('option', { name: 'sequence (sequence)' })).toBeNull();
  });
});



describe('Speed Round grading recovery', () => {
  it('keeps the question, answer, request ID, and counts after retryable marking', async () => {
    vi.mocked(challengeStart).mockResolvedValueOnce({
      session_id: 'challenge-1',
      questions: [{
        id: 'challenge-q',
        question: 'What is 6 × 7?',
        question_type: 'short_answer',
        difficulty: 'foundational',
        complexity: null,
        topic_ids: ['AC9M7A01'],
      }],
      time_limit_seconds: 120,
    });
    vi.mocked(tutorMark).mockResolvedValue({
      is_correct: false,
      outcome: 'pending',
      retryable: true,
      feedback: 'Please retry marking.',
    });

    render(<ChallengePage />);
    await screen.findByRole('option', { name: 'Variables in formulas (AC9M7A01)' });
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'AC9M7A01' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Challenge/i }));

    const answer = await screen.findByPlaceholderText(/Type your answer/i);
    fireEvent.change(answer, { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit & Next/i }));

    await screen.findByRole('alert');
    expect(tutorMark).toHaveBeenCalledTimes(1);
    expect((screen.getByPlaceholderText(/Type your answer/i) as HTMLTextAreaElement).value).toBe('42');
    expect(screen.getByText(/Q1 \/ 1 · ✅ 0 · ❌ 0/)).toBeTruthy();
    const firstRequestId = (vi.mocked(tutorMark).mock.calls[0][3] as { requestId?: string }).requestId;

    fireEvent.click(screen.getByRole('button', { name: 'Retry Marking' }));
    expect(tutorMark).toHaveBeenCalledTimes(2);
    expect((vi.mocked(tutorMark).mock.calls[1][3] as { requestId?: string }).requestId).toBe(firstRequestId);
    expect((screen.getByPlaceholderText(/Type your answer/i) as HTMLTextAreaElement).value).toBe('42');
    expect(screen.getByText(/Q1 \/ 1 · ✅ 0 · ❌ 0/)).toBeTruthy();
  });
});