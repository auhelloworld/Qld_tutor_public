import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/dynamic', () => ({
  default: () => function DynamicLab(props: Record<string, unknown>) {
    return (
      <div
        data-testid="dynamic-lab"
        data-tab={String(props.tab ?? 'geometry')}
        data-mode={String(props.mode ?? '')}
        data-activity={String(props.activityId ?? '')}
        data-preset={String(props.preset ?? '')}
        data-is-exact={String(props.isExact ?? '')}
      />
    );
  },
}));

vi.mock('../components/BackToPracticeLink', () => ({
  default: () => <span>Back to practice</span>,
}));

vi.mock('../components/lab/ExplorerTab', () => ({
  default: ({ mode, activityId, mafsHeight, isExact, onActivityComplete }: { mode?: string; activityId?: string; mafsHeight?: number; isExact?: boolean; onActivityComplete?: (activityId: string, success: boolean) => void }) => (
    <>
      <div data-testid="explorer-lab" data-mode={mode} data-activity={activityId ?? ''} data-height={mafsHeight} data-is-exact={String(isExact ?? true)} />
      {onActivityComplete && (
        <>
          <button type="button" onClick={() => onActivityComplete('explorer-number-line', false)}>Simulate failed completion</button>
          <button type="button" onClick={() => onActivityComplete('explorer-number-line', true)}>Simulate successful completion</button>
        </>
      )}
    </>
  ),
}));

vi.mock('../components/lab/LabDirectory', () => ({
  default: ({ onSelect }: { onSelect: (tab: 'explorer' | 'sandbox', mode: 'explore' | 'learn', activityId?: string) => void }) => (
    <div>
      <button onClick={() => onSelect('explorer', 'explore')}>Open coordinate explore</button>
      <button onClick={() => onSelect('sandbox', 'learn', 'sandbox-simultaneous-lines')}>Open systems activity</button>
    </div>
  ),
}));

import MathLabPage from '../app/lab/page';
import { LAB_TAB_LABELS } from '../lib/lab-activities';

describe('MathLabPage routing and modes', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    window.history.replaceState(null, '', '/lab');
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/lab');
  });

  it('starts in the activity directory and opens a selected Learn activity', async () => {
    render(<MathLabPage />);
    expect(screen.getByText('Choose a guided learning activity or explore freely.')).toBeTruthy();
    fireEvent.click(screen.getByText('Open systems activity'));

    await waitFor(() => expect(screen.getByText('Learning activity: Where Two Lines Meet')).toBeTruthy());
    const lab = screen.getByTestId('dynamic-lab');
    expect(lab.getAttribute('data-tab')).toBe('sandbox');
    expect(lab.getAttribute('data-mode')).toBe('learn');
    expect(lab.getAttribute('data-activity')).toBe('sandbox-simultaneous-lines');
    expect(window.location.search).toBe('?tab=sandbox&mode=learn&activity=sandbox-simultaneous-lines');
  });

  it('restores the activity tab from the activity itself rather than a mismatched tab query', async () => {
    window.history.replaceState(null, '', '/lab?tab=geometry&mode=learn&activity=sandbox-simultaneous-lines');
    render(<MathLabPage />);

    await waitFor(() => expect(screen.getByText('Learning activity: Where Two Lines Meet')).toBeTruthy());
    const sandboxTab = screen.getByRole('tab', { name: /Graphing & Curves/ });
    expect(sandboxTab.getAttribute('aria-selected')).toBe('true');
    expect(sandboxTab.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: /Coordinate Explorer/ }).getAttribute('tabindex')).toBe('-1');
    expect(screen.getByTestId('dynamic-lab').getAttribute('data-tab')).toBe('sandbox');

    fireEvent.keyDown(sandboxTab, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('tab', { name: /Calculus Explorer/ }).getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByTestId('dynamic-lab').getAttribute('data-activity')).toBe('calculus-tangent-slope-predict');
  });

  it('switches explicitly between Explore and Learn and keeps the URL recoverable', async () => {
    window.history.replaceState(null, '', '/lab?tab=sandbox&mode=learn&activity=sandbox-simultaneous-lines');
    render(<MathLabPage />);
    await screen.findByText('Learning activity: Where Two Lines Meet');

    fireEvent.click(screen.getByRole('button', { name: 'Explore' }));
    await waitFor(() => expect(screen.getByTestId('dynamic-lab').getAttribute('data-mode')).toBe('explore'));
    expect(screen.getByTestId('dynamic-lab').getAttribute('data-activity')).toBe('');
    expect(window.location.search).toBe('?tab=sandbox&mode=explore');

    fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
    await waitFor(() => expect(screen.getByTestId('dynamic-lab').getAttribute('data-activity')).toBe('sandbox-gradient-effect'));
    expect(window.location.search).toBe('?tab=sandbox&mode=learn&activity=sandbox-gradient-effect');
  });

  it('keeps the page and Mafs canvas within a 320px mobile viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    render(<MathLabPage />);
    const root = screen.getByLabelText('Interactive mathematics laboratory');
    expect(root.style.minHeight).toBe('100vh');

    fireEvent.click(screen.getByText('Open coordinate explore'));
    await waitFor(() => expect(screen.getByTestId('explorer-lab').getAttribute('data-height')).toBe('256'));
  });

  it('retains legacy calculus preset routing', async () => {
    window.history.replaceState(null, '', '/lab?preset=derivative_tangent');
    render(<MathLabPage />);

    await waitFor(() => expect(screen.getByTestId('dynamic-lab').getAttribute('data-tab')).toBe('calculus'));
    expect(screen.getByTestId('dynamic-lab').getAttribute('data-mode')).toBe('explore');
    expect(screen.getByTestId('dynamic-lab').getAttribute('data-preset')).toBe('derivative_tangent');
    expect(screen.getByRole('tab', { name: /Calculus Explorer/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('restores a Statistics Learn deep link', async () => {
    window.history.replaceState(
      null,
      '',
      '/lab?tab=statistics&mode=learn&activity=statistics-normal-zscore',
    );
    render(<MathLabPage />);

    await screen.findByText('Learning activity: Normal Distribution and z-Scores');
    expect(screen.getByRole('tab', { name: /Statistics & Probability/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('dynamic-lab').getAttribute('data-mode')).toBe('learn');
    expect(screen.getByTestId('dynamic-lab').getAttribute('data-activity')).toBe('statistics-normal-zscore');
  });

  it('restores an Explore deep link with activity preserved', async () => {
    window.history.replaceState(
      null,
      '',
      '/lab?tab=sandbox&mode=explore&activity=sandbox-distance-time',
    );
    render(<MathLabPage />);

    await waitFor(() => expect(screen.getByTestId('dynamic-lab').getAttribute('data-mode')).toBe('explore'));
    expect(screen.getByTestId('dynamic-lab').getAttribute('data-activity')).toBe('sandbox-distance-time');
    expect(screen.getByRole('tab', { name: /Graphing & Curves/ }).getAttribute('aria-selected')).toBe('true');
    expect(window.location.search).toBe('?tab=sandbox&mode=explore&activity=sandbox-distance-time');
  });

  it('restores a Linear Algebra Learn deep link', async () => {
    window.history.replaceState(
      null,
      '',
      '/lab?tab=linear-algebra&mode=learn&activity=linear-matrix-transform',
    );
    render(<MathLabPage />);

    await screen.findByText('Learning activity: Matrix Transformations');
    expect(screen.getByRole('tab', { name: /Vectors, Matrices & Complex/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('dynamic-lab').getAttribute('data-mode')).toBe('learn');
    expect(screen.getByTestId('dynamic-lab').getAttribute('data-activity')).toBe('linear-matrix-transform');
  });

  it('tablist has 6 tabs whose visible text matches LAB_TAB_LABELS', async () => {
    window.history.replaceState(null, '', '/lab?tab=explorer&mode=explore');
    render(<MathLabPage />);

    const allTabs = screen.getAllByRole('tab');
    expect(allTabs).toHaveLength(6);

    const labels = Object.values(LAB_TAB_LABELS);
    for (const label of labels) {
      const tab = screen.getByRole('tab', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
      expect(tab).toBeTruthy();
    }
  });
});

describe('S7 Format scope — isExact passed to all Tabs', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    window.history.replaceState(null, '', '/lab');
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/lab');
  });

  it('passes isExact=true by default to the ExplorerTab', async () => {
    window.history.replaceState(null, '', '/lab?tab=explorer&mode=explore');
    render(<MathLabPage />);
    await waitFor(() => expect(screen.getByTestId('explorer-lab')).toBeTruthy());
    expect(screen.getByTestId('explorer-lab').getAttribute('data-is-exact')).toBe('true');
  });

  it('passes isExact=false to dynamically loaded tabs after toggle', async () => {
    window.history.replaceState(null, '', '/lab?tab=statistics&mode=explore');
    render(<MathLabPage />);
    await waitFor(() => expect(screen.getByTestId('dynamic-lab')).toBeTruthy());
    expect(screen.getByTestId('dynamic-lab').getAttribute('data-is-exact')).toBe('true');

    // Toggle to decimal
    fireEvent.click(screen.getByRole('button', { name: 'Decimal' }));
    await waitFor(() => expect(screen.getByTestId('dynamic-lab').getAttribute('data-is-exact')).toBe('false'));
  });

  it('passes isExact to linear-algebra tab', async () => {
    window.history.replaceState(null, '', '/lab?tab=linear-algebra&mode=explore');
    render(<MathLabPage />);
    await waitFor(() => expect(screen.getByTestId('dynamic-lab')).toBeTruthy());
    expect(screen.getByTestId('dynamic-lab').getAttribute('data-is-exact')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Decimal' }));
    await waitFor(() => expect(screen.getByTestId('dynamic-lab').getAttribute('data-is-exact')).toBe('false'));
  });
});


describe('S7 Format toggle ARIA behaviour', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    window.history.replaceState(null, '', '/lab?tab=explorer&mode=explore');
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/lab');
  });

  it('exposes a named group and updates aria-pressed when format changes', async () => {
    render(<MathLabPage />);
    await screen.findByTestId('explorer-lab');

    const group = screen.getByRole('group', { name: /Format/i });
    const exact = screen.getByRole('button', { name: 'Exact' });
    const decimal = screen.getByRole('button', { name: 'Decimal' });
    expect(group.contains(exact)).toBe(true);
    expect(exact.getAttribute('aria-pressed')).toBe('true');
    expect(decimal.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(decimal);
    await waitFor(() => expect(decimal.getAttribute('aria-pressed')).toBe('true'));
    expect(exact.getAttribute('aria-pressed')).toBe('false');
  });
});


describe('MathLabPage completion persistence', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    window.history.replaceState(null, '', '/lab?tab=explorer&mode=explore');
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/lab');
  });

  it('persists only successful activity completion callbacks', async () => {
    render(<MathLabPage />);
    await screen.findByTestId('explorer-lab');

    fireEvent.click(screen.getByRole('button', { name: 'Simulate failed completion' }));
    expect(localStorage.getItem('qld-maths-lab-completed-v1')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Simulate successful completion' }));
    const stored = JSON.parse(localStorage.getItem('qld-maths-lab-completed-v1') ?? '{}');
    expect(stored['explorer-number-line']).toBeDefined();
  });
});
