import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/dynamic', () => ({
  default: () => function MockScienceScene() {
    return React.createElement('div', { 'data-testid': 'science-scene' });
  },
}));

vi.mock('../components/BackToPracticeLink', () => ({
  default: () => null,
}));

vi.mock('../components/science-lab/ScienceLabDirectory', () => ({
  default: ({
    onSelectActivity,
    courseContext,
  }: {
    onSelectActivity: (id: 'SCI-FORCE-01', mode: 'learn', selectedYear: number) => void;
    courseContext?: { year?: string; topic?: string };
  }) => React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'output',
      { 'data-testid': 'directory-context' },
      `${courseContext?.year ?? ''}|${courseContext?.topic ?? ''}`,
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        onClick: () => onSelectActivity('SCI-FORCE-01', 'learn', 10),
      },
      'Select Year 10 force lab',
    ),
  ),
}));

vi.mock('../components/science-lab/ScienceLearnPanel', () => ({
  default: ({ activity }: { activity: { transferTopicIds: string[] } }) => React.createElement(
    'output',
    { 'data-testid': 'resolved-transfer-topic' },
    activity.transferTopicIds[0],
  ),
}));

import ScienceLabPage from '../app/science-lab/page';

describe('ScienceLabPage directory transfer wiring', () => {
  beforeEach(() => {
    window.history.replaceState(
      null,
      '',
      '/science-lab?subject=science&year=year7&topic=AC9S7U04',
    );
  });

  it('writes the selected year and removes a stale source topic before resolving transfer', async () => {
    render(<ScienceLabPage />);

    await waitFor(() => {
      expect(screen.getByTestId('directory-context').textContent).toBe('year7|AC9S7U04');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Select Year 10 force lab' }));

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get('activity')).toBe('SCI-FORCE-01');
      expect(params.get('mode')).toBe('learn');
      expect(params.get('subject')).toBe('science');
      expect(params.get('year')).toBe('year10');
      expect(params.has('topic')).toBe(false);
      expect(screen.getByTestId('resolved-transfer-topic').textContent).toBe('AC9S10U05');
    });
  });
});
