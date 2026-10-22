/**
 * Guards against two whole-catalogue presentation defects.
 *
 * 1. No blank read-out panel. The shared `.lab-visual-info` card is driven by a
 *    per-activity conditional, so a newly added activity used to render an empty
 *    panel — and a scene that also carried its own panel produced two, the lower
 *    one blank.
 * 2. Explore lists one button per graded example. The unlockable extension step
 *    is not an example; including it added a fourth button to a three-column grid
 *    that repeated an earlier picture.
 */
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(cleanup);

vi.mock('mafs', () => ({
  Mafs: ({ children }: { children?: ReactNode }) => <div data-testid="mafs">{children}</div>,
  Coordinates: { Cartesian: () => <div />, Polar: () => <div /> },
  MovablePoint: () => <div />,
  Point: () => <div />,
  Circle: () => <div />,
  Polygon: () => <div />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Line: { Segment: () => <div />, ThroughPoints: () => <div />, PointAngle: () => <div />, PointSlope: () => <div /> },
  Plot: {
    OfX: () => <div />,
    OfY: () => <div />,
    Inequality: () => <div />,
    Parametric: () => <div />,
    VectorField: () => <div />,
  },
  Vector: () => <div />,
  Transform: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  LaTeX: () => <span />,
  Ellipse: () => <div />,
  Polyline: () => <div />,
  labelPi: (x: number) => String(x),
  Theme: { foreground: '#000', background: '#fff', red: '#f00', orange: '#f80', green: '#0c0', blue: '#00f', indigo: '#40f', violet: '#80f', pink: '#f0f', yellow: '#ff0' },
}));

vi.mock('mathjs', () => ({
  parse: () => ({ compile: () => ({ evaluate: () => 0 }) }),
  compile: () => ({ evaluate: () => 0 }),
  evaluate: () => 0,
}));

import ExplorerTab from '../components/lab/ExplorerTab';
import SandboxTab from '../components/lab/SandboxTab';
import CalculusTab from '../components/lab/CalculusTab';
import GeometryTab from '../components/lab/GeometryTab';
import StatisticsTab from '../components/lab/StatisticsTab';
import LinearAlgebraTab from '../components/lab/LinearAlgebraTab';
import { ALL_ACTIVITY_IDS, LAB_ACTIVITIES, type LabActivityId } from '../lib/lab-activities';

const TABS = {
  explorer: ExplorerTab,
  sandbox: SandboxTab,
  calculus: CalculusTab,
  geometry: GeometryTab,
  statistics: StatisticsTab,
  'linear-algebra': LinearAlgebraTab,
} as const;

function renderActivity(activityId: LabActivityId, mode: 'learn' | 'explore') {
  const Tab = TABS[LAB_ACTIVITIES[activityId].tab];
  return render(
    <Tab
      isExact
      mafsHeight={320}
      mode={mode}
      activityId={activityId}
      onActivityComplete={vi.fn()}
      onExitLearn={vi.fn()}
    />,
  );
}

describe('no activity renders a blank read-out panel', () => {
  it.each(ALL_ACTIVITY_IDS)('%s (learn) has text in every visual-info panel', (activityId) => {
    const { container } = renderActivity(activityId, 'learn');
    const panels = Array.from(container.querySelectorAll('.lab-visual-info'));
    panels.forEach((panel, index) => {
      expect(
        (panel.textContent ?? '').trim().length,
        `${activityId} learn panel ${index + 1} is blank`,
      ).toBeGreaterThan(0);
    });
  });

  it.each(ALL_ACTIVITY_IDS)('%s (explore) has text in every visual-info panel', (activityId) => {
    const { container } = renderActivity(activityId, 'explore');
    const panels = Array.from(container.querySelectorAll('.lab-visual-info'));
    panels.forEach((panel, index) => {
      expect(
        (panel.textContent ?? '').trim().length,
        `${activityId} explore panel ${index + 1} is blank`,
      ).toBeGreaterThan(0);
    });
  });

  it('never stacks two read-out panels on the same scene', () => {
    for (const activityId of ALL_ACTIVITY_IDS) {
      for (const mode of ['learn', 'explore'] as const) {
        const { container, unmount } = renderActivity(activityId, mode);
        const panels = container.querySelectorAll('.lab-visual-info');
        expect(panels.length, `${activityId} (${mode}) renders ${panels.length} panels`).toBeLessThanOrEqual(1);
        unmount();
      }
    }
  });
});

describe('Explore deep links reach the requested calculus scene', () => {
  // CalculusTab used to ignore activityId in Explore mode, so a deep link to a
  // calculus extension scene silently showed the default core-calculus explorer
  // and the "examples" on screen belonged to a different activity.
  const SCENES: [LabActivityId, RegExp][] = [
    ['calculus-numerical-methods', /Newton|Trapezoidal/i],
    ['calculus-direction-field', /direction field|slope/i],
    ['calculus-kinematics-links', /Position graph|velocity/i],
  ];

  it.each(SCENES)('%s renders its own scene, not the core explorer', (activityId, marker) => {
    const { container } = renderActivity(activityId, 'explore');
    // The scene selector must be on the requested topic.
    const selector = screen.getByLabelText(/calculus explore topic/i) as HTMLSelectElement;
    expect(selector.value).toBe(activityId);
    // And the canvas must be the one that belongs to it.
    const labels = Array.from(container.querySelectorAll('[role="group"]'))
      .map((el) => el.getAttribute('aria-label') ?? '')
      .join(' | ');
    expect(labels, `${activityId} scene label: ${labels}`).toMatch(marker);
  });

  it('numerical methods shows the Newton scene on example 1 and a trapezoid later', () => {
    const { container } = renderActivity('calculus-numerical-methods', 'explore');
    const sceneLabel = () =>
      Array.from(container.querySelectorAll('[role="group"]'))
        .map((el) => el.getAttribute('aria-label') ?? '')
        .join(' | ');
    expect(sceneLabel()).toMatch(/Newton/i);
    fireEvent.click(screen.getByRole('button', { name: 'Example 2' }));
    expect(sceneLabel()).toMatch(/Trapezoidal/i);
    fireEvent.click(screen.getByRole('button', { name: 'Example 3' }));
    expect(sceneLabel()).toMatch(/Trapezoidal/i);
    fireEvent.click(screen.getByRole('button', { name: 'Example 1' }));
    expect(sceneLabel()).toMatch(/Newton/i);
  });

  it('explains what the Newton Example 1 lines and curve represent', () => {
    renderActivity('calculus-numerical-methods', 'explore');
    const explanationText = screen.getByTestId('newton-method-explanation').textContent ?? '';
    expect(explanationText).toContain('f(x) = x²');
    expect(explanationText).toContain('blue curve');
    expect(explanationText).toContain('tangent');
    expect(explanationText).toContain('xₙ₊₁');
  });

  it('explains what the trapezoid examples and error values represent', () => {
    renderActivity('calculus-numerical-methods', 'explore');
    fireEvent.click(screen.getByRole('button', { name: 'Example 2' }));
    const explanationText = screen.getByTestId('trapezoid-method-explanation').textContent ?? '';
    expect(explanationText).toContain('y = x²');
    expect(explanationText).toContain('blue curve');
    expect(explanationText).toContain('trapezoid');
    expect(explanationText).toContain('error');
    fireEvent.click(screen.getByRole('button', { name: 'Example 3' }));
    expect(screen.getByTestId('trapezoid-method-explanation')).toBeTruthy();
  });
});
describe('Explore example selectors list only the graded examples', () => {
  // These activities are rendered by the three components that offer an
  // "Example" selector in Explore mode.
  const WITH_SELECTOR: LabActivityId[] = [
    'calculus-direction-field',
    'calculus-kinematics-links',
    'calculus-numerical-methods',
    'sandbox-polar-curves',
    'sandbox-parametric-curves',
    'geometry-angle-reasoning',
    'geometry-circle-scaling',
    'geometry-pythagoras',
    'geometry-sohcahtoa',
    'geometry-unit-circle',
    'geometry-similarity-ratio',
  ];

  /**
   * Buttons in the example chooser. Its legend reads "Example" in most scenes and
   * "Curve preset" in the polar/parametric ones, which name their presets rather
   * than numbering them.
   */
  const CHOOSER_LEGENDS = ['Example', 'Curve preset'];

  function exampleButtons(container: HTMLElement): HTMLButtonElement[] {
    const fieldset = Array.from(container.querySelectorAll('fieldset')).find((node) =>
      CHOOSER_LEGENDS.includes(node.querySelector('legend')?.textContent?.trim() ?? ''),
    );
    return fieldset ? Array.from(fieldset.querySelectorAll('button')) : [];
  }

  it.each(WITH_SELECTOR)('%s offers exactly three example buttons', (activityId) => {
    const { container } = renderActivity(activityId, 'explore');
    const buttons = exampleButtons(container);
    expect(buttons).toHaveLength(3);
    // Every button must have a usable accessible name, never a trailing colon
    // left behind by a missing title.
    for (const button of buttons) {
      const name = (button.getAttribute('aria-label') ?? button.textContent ?? '').trim();
      expect(name.length, `${activityId}: empty example button name`).toBeGreaterThan(0);
      expect(name.endsWith(':'), `${activityId}: "${name}"`).toBe(false);
    }
  });

  it('the graded example count matches the core steps of each activity', () => {
    for (const activityId of WITH_SELECTOR) {
      const core = LAB_ACTIVITIES[activityId].steps.filter((step) => step.tier !== 'extension');
      expect(core, activityId).toHaveLength(3);
    }
  });
});
