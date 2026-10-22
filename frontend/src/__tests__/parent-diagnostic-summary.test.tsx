import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import DiagnosticSummary from '../components/parent/DiagnosticSummary';
import { diagnosticStatus } from '../lib/api';

vi.mock('../lib/api', () => ({
  diagnosticStatus: vi.fn(async () => ({
    completed: true,
    areas: {
      Number: {
        band: 'start_here', ability: -1.2, questions: 2, correct: 0, start_topic: 'AC9M8N01',
        confident_errors: ['AC9M8N01'], misconception_notes: ['Adds denominators.'],
        previous_band: 'building', prior_year_check: { year: 7, topic_id: 'AC9M7N02', correct: false },
      },
      Algebra: {
        band: 'secure', ability: 1.0, questions: 2, correct: 2, start_topic: null,
        confident_errors: [], misconception_notes: [],
      },
    },
  })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Parent diagnostic placement', () => {
  it('shows each area with its change, confident errors and prior-year check', async () => {
    render(<DiagnosticSummary subject="math" year="year8" />);

    expect(await screen.findByRole('region', { name: 'Diagnostic placement' })).toBeTruthy();
    expect(screen.getByText('Start here (was Building)')).toBeTruthy();
    expect(screen.getByText(/Sure but wrong: AC9M8N01/)).toBeTruthy();
    expect(screen.getByText(/Adds denominators\./)).toBeTruthy();
    expect(screen.getByText(/Year 7 check \(AC9M7N02\): not yet/)).toBeTruthy();
    expect(screen.getByText('Secure')).toBeTruthy();
    expect(diagnosticStatus).toHaveBeenCalledWith('math', 8, expect.anything());
  });

  it('stays hidden for senior units', () => {
    const { container } = render(<DiagnosticSummary subject="senior_math" year="unit1" />);
    expect(container.textContent).toBe('');
    expect(diagnosticStatus).not.toHaveBeenCalled();
  });
});
