import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PSMTPage from '../app/psmt/page';
import { checkPSMT } from '../lib/api';

vi.mock('../lib/api', () => ({
  checkPSMT: vi.fn(),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('PSMT unavailable feedback', () => {
  it('shows a retryable unavailable state without a developing readiness signal', async () => {
    vi.mocked(checkPSMT).mockResolvedValue({
      feedback: '### Feedback temporarily unavailable\n\nPlease try again later.',
      llm_status: 'unavailable',
      history_item: null,
      structured_feedback: {
        mentor_feedback_markdown: '### Feedback temporarily unavailable\n\nPlease try again later.',
        criterion_scores: {
          formulate: null,
          solve: null,
          evaluate_verify: null,
          communicate: null,
        },
        readiness_level: 'developing',
        top_gaps: [],
        next_revision_actions: [],
        safety_flags: [],
      },
    });

    render(<PSMTPage />);
    fireEvent.change(screen.getByPlaceholderText(/Paste your Formulate draft here/i), {
      target: { value: 'A detailed draft section ready for formative feedback.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Run QCAA ISMG Evaluation/i }));

    expect(await screen.findByText(/AI mentor temporarily unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/^developing$/i)).toBeNull();
    expect(screen.getAllByText(/Please try again later/i).length).toBeGreaterThan(0);
  });
});

describe('PSMT request identity', () => {
  it('creates a new request ID when one image changes without changing image count', async () => {
    vi.mocked(checkPSMT).mockResolvedValue({
      feedback: '### Feedback temporarily unavailable\n\nPlease try again later.',
      llm_status: 'unavailable',
      history_item: null,
    });

    render(<PSMTPage />);
    fireEvent.change(screen.getByPlaceholderText(/Paste your Formulate draft here/i), {
      target: { value: 'A detailed draft section ready for formative feedback.' },
    });

    const imageInput = screen.getByLabelText(/Choose Images/i);
    fireEvent.change(imageInput, {
      target: { files: [new File(['first image'], 'first.png', { type: 'image/png' })] },
    });
    await screen.findByAltText('Uploaded PSMT evidence 1');

    fireEvent.click(screen.getByRole('button', { name: /Run QCAA ISMG Evaluation/i }));
    expect(checkPSMT).toHaveBeenCalledTimes(1);
    await screen.findByText(/AI mentor temporarily unavailable/i);
    const firstCall = vi.mocked(checkPSMT).mock.calls[0];

    fireEvent.click(screen.getByRole('button', { name: '✕' }));
    expect(screen.queryByAltText('Uploaded PSMT evidence 1')).toBeNull();
    fireEvent.change(imageInput, {
      target: { files: [new File(['different image'], 'second.png', { type: 'image/png' })] },
    });
    await screen.findByAltText('Uploaded PSMT evidence 1');

    fireEvent.click(screen.getByRole('button', { name: /Run QCAA ISMG Evaluation/i }));
    expect(checkPSMT).toHaveBeenCalledTimes(2);
    const secondCall = vi.mocked(checkPSMT).mock.calls[1];

    expect(firstCall[3]).toHaveLength(1);
    expect(secondCall[3]).toHaveLength(1);
    expect(secondCall[3]).not.toEqual(firstCall[3]);
    expect(secondCall[5]).not.toBe(firstCall[5]);
  });
});