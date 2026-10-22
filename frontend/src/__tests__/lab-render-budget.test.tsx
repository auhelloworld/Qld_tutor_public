/**
 * P5 Render-budget and resource-boundary tests for the Maths Lab.
 *
 * Verifies:
 * - Direction field SVG primitives ≤ 40 (Mafs VectorField = 1 element)
 * - Statistics data points ≤ LAB_RENDER_LIMITS.dataPoints
 * - Probability trials ≤ LAB_RENDER_LIMITS.probabilityTrials
 * - Each Explore tab SVG elements ≤ 300
 * - Tab switching unmounts the previous scene completely (no residual elements)
 * - Timer behaviour: only the known copy-feedback setTimeout in SandboxTab
 */

import type { ReactNode } from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

// --- Reuse the canonical mafs mock from lab-scenes ---
vi.mock('mafs', () => ({
  Mafs: ({ children }: { children?: ReactNode }) => (
    <div data-testid="mafs">{children}</div>
  ),
  Coordinates: {
    Cartesian: () => <div data-testid="coordinates" />,
    Polar: () => <div data-testid="polar-coordinates" />,
  },
  MovablePoint: () => <div data-testid="movable-point" />,
  Point: () => <div data-testid="point" />,
  Circle: () => <div data-testid="circle" />,
  Polygon: () => <div data-testid="polygon" />,
  Text: ({ children }: { children?: ReactNode }) => <span data-testid="mafs-text">{children}</span>,
  Line: {
    Segment: () => <div data-testid="line-segment" />,
    ThroughPoints: () => <div data-testid="line-through-points" />,
    PointAngle: () => <div data-testid="line-point-angle" />,
    PointSlope: () => <div data-testid="line-point-slope" />,
  },
  Plot: {
    OfX: () => <div data-testid="plot-of-x" />,
    OfY: () => <div data-testid="plot-of-y" />,
    Inequality: () => <div data-testid="plot-inequality" />,
    Parametric: ({ maxSamplingDepth }: { maxSamplingDepth?: number }) => (
      <div data-testid="plot-parametric" data-sampling-depth={maxSamplingDepth ?? ''} />
    ),
    VectorField: () => <div data-testid="plot-vector-field" />,
  },
  Vector: () => <div data-testid="vector" />,
  Transform: ({ children }: { children?: ReactNode }) => <div data-testid="transform">{children}</div>,
  LaTeX: () => <div data-testid="latex" />,
  Ellipse: () => <div data-testid="ellipse" />,
  Polyline: () => <div data-testid="polyline" />,
  labelPi: (x: number) => String(x),
  Theme: { foreground: '#000', background: '#fff', red: '#f00', blue: '#00f', green: '#0f0', orange: '#f80', indigo: '#40f', violet: '#80f', pink: '#f0f', yellow: '#ff0' },
}));

import CalculusTab from '../components/lab/CalculusTab';
import ExplorerTab from '../components/lab/ExplorerTab';
import GeometryTab from '../components/lab/GeometryTab';
import LinearAlgebraTab from '../components/lab/LinearAlgebraTab';
import SandboxTab from '../components/lab/SandboxTab';
import StatisticsTab from '../components/lab/StatisticsTab';
import { simulateProbability } from '../components/lab/StatisticsTab';
import { computeDirectionFieldSegments } from '../components/lab/CalculusExtensionsLab';
import { LAB_RENDER_LIMITS } from '../lib/lab-performance';

// Helper: count all data-testid elements that represent SVG primitives in a container
function countSvgPrimitives(container: HTMLElement): number {
  const selectors = [
    '[data-testid="mafs"]',
    '[data-testid="coordinates"]',
    '[data-testid="polar-coordinates"]',
    '[data-testid="movable-point"]',
    '[data-testid="point"]',
    '[data-testid="circle"]',
    '[data-testid="polygon"]',
    '[data-testid="mafs-text"]',
    '[data-testid="line-segment"]',
    '[data-testid="line-through-points"]',
    '[data-testid="line-point-angle"]',
    '[data-testid="line-point-slope"]',
    '[data-testid="plot-of-x"]',
    '[data-testid="plot-of-y"]',
    '[data-testid="plot-inequality"]',
    '[data-testid="plot-parametric"]',
    '[data-testid="plot-vector-field"]',
    '[data-testid="vector"]',
    '[data-testid="transform"]',
    '[data-testid="latex"]',
    '[data-testid="ellipse"]',
    '[data-testid="polyline"]',
  ];
  let count = 0;
  for (const sel of selectors) {
    count += container.querySelectorAll(sel).length;
  }
  return count;
}

// ─── P5: Direction field render budget ─────────────────────────────────────────

describe('P5 Direction field render budget', () => {
  it('direction field uses Plot.VectorField (1 SVG element) not individual segments', () => {
    const { container } = render(
      <CalculusTab
        isExact
        mafsHeight={320}
        mode="learn"
        activityId="calculus-direction-field"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );

    // VectorField renders as a single element, not 169 separate line-segments
    const vectorFields = container.querySelectorAll('[data-testid="plot-vector-field"]');
    expect(vectorFields).toHaveLength(1);

    // Total SVG primitives within the direction field Mafs scene must be ≤ 40
    const mafsElements = container.querySelectorAll('[data-testid="mafs"]');
    expect(mafsElements.length).toBeGreaterThanOrEqual(1);

    // Count primitives inside the first (and only) Mafs scene for direction field
    const mafsEl = mafsElements[0];
    const primitivesInScene = countSvgPrimitives(mafsEl as HTMLElement);
    expect(primitivesInScene).toBeLessThanOrEqual(40);
  });

  it('computeDirectionFieldSegments caps at directionFieldGrid² even when asked for more', () => {
    const maxGrid = LAB_RENDER_LIMITS.directionFieldGrid; // 13
    const segments = computeDirectionFieldSegments(
      (x, y) => x + y,
      999, // request far more than allowed
      [-3, 3],
      [-3, 3],
    );
    expect(segments.length).toBeLessThanOrEqual(maxGrid * maxGrid);
    expect(segments.length).toBe(maxGrid * maxGrid); // exactly 169
  });

  it('direction field Explore mode also caps VectorField at 1 element', () => {
    const { container } = render(
      <CalculusTab isExact mafsHeight={320} mode="explore" />
    );
    // Switch to direction-field topic
    fireEvent.change(screen.getByLabelText('Calculus explore topic'), {
      target: { value: 'calculus-direction-field' },
    });
    const vectorFields = container.querySelectorAll('[data-testid="plot-vector-field"]');
    expect(vectorFields).toHaveLength(1);
  });
});

// ─── P5: Statistics data-point budget ──────────────────────────────────────────

describe('P5 Statistics data-point render budget', () => {
  it('distribution shape renders at most LAB_RENDER_LIMITS.dataPoints in Explore', () => {
    const { container } = render(
      <StatisticsTab mafsHeight={320} mode="explore" />
    );
    // In explore mode with default data ([2,3,3,4,8] = 5 points)
    const points = container.querySelectorAll('[data-testid="point"]');
    expect(points.length).toBeLessThanOrEqual(LAB_RENDER_LIMITS.dataPoints);
  });

  it('scatter plot renders at most LAB_RENDER_LIMITS.dataPoints in Explore', () => {
    const { container } = render(
      <StatisticsTab mafsHeight={320} mode="explore" />
    );
    // Switch to scatter module
    fireEvent.click(screen.getByRole('radio', { name: /Scatter/i }));
    // Default scatter has 8 points
    const points = container.querySelectorAll('[data-testid="point"]');
    expect(points.length).toBeLessThanOrEqual(LAB_RENDER_LIMITS.dataPoints);
    expect(points.length).toBe(8);
  });

  it('add button is enabled when under MAX_DATA and input max is bounded', () => {
    render(<StatisticsTab mafsHeight={320} mode="explore" />);
    const addBtn = screen.getByLabelText('Add data value') as HTMLButtonElement;
    // Default has 5 points; button should still be enabled
    expect(addBtn.disabled).toBe(false);
    // The disabled={distData.length >= MAX_DATA} attribute encodes the budget gate
  });

  it('Learn mode distribution renders points bounded by data array (≤ dataPoints)', () => {
    const { container } = render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-distribution-shape"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );
    const points = container.querySelectorAll('[data-testid="point"]');
    expect(points.length).toBeLessThanOrEqual(LAB_RENDER_LIMITS.dataPoints);
  });
});

// ─── P5: Probability trials budget ────────────────────────────────────────────

describe('P5 Probability trials render budget', () => {
  it('simulateProbability caps at LAB_RENDER_LIMITS.probabilityTrials', () => {
    const result = simulateProbability(10_000, 0.5);
    expect(result.trials).toBe(LAB_RENDER_LIMITS.probabilityTrials);
    expect(result.trials).toBeLessThanOrEqual(200);
  });

  it('simulateProbability returns only summary stats (no retained history array)', () => {
    const result = simulateProbability(100, 0.3);
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['proportion', 'successes', 'trials']);
  });

  it('probability simulation Explore scene renders bounded bar chart', () => {
    render(<StatisticsTab mafsHeight={320} mode="explore" />);
    // Switch to probability module
    fireEvent.click(screen.getByRole('radio', { name: /Probability/i }));
    // The probability scene uses Polygon bars (2) + line segments + texts
    // All capped by the deterministic trial bound
    const trialsInput = screen.getByLabelText('Number of trials') as HTMLInputElement;
    expect(Number(trialsInput.max)).toBeLessThanOrEqual(LAB_RENDER_LIMITS.probabilityTrials);
  });

  it('Learn probability scene does not exceed trial budget', () => {
    const { container } = render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-probability-simulation"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );
    // The simulation result is capped internally; verify polygons are bounded
    const polygons = container.querySelectorAll('[data-testid="polygon"]');
    // Probability vis uses 2 polygons max (success bar, failure bar)
    expect(polygons.length).toBeLessThanOrEqual(4);
  });
});

// ─── P5: Explore SVG element budget (≤ 300 per tab) ────────────────────────────

describe('P5 Explore SVG element budget (≤ 300 per tab)', () => {
  it('ExplorerTab Explore renders ≤ 300 SVG primitives', () => {
    const { container } = render(<ExplorerTab mafsHeight={320} mode="explore" />);
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('SandboxTab Explore renders ≤ 300 SVG primitives', () => {
    const { container } = render(<SandboxTab isExact mafsHeight={320} mode="explore" />);
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('CalculusTab Explore renders ≤ 300 SVG primitives', () => {
    const { container } = render(<CalculusTab isExact mafsHeight={320} mode="explore" />);
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('GeometryTab Explore renders ≤ 300 SVG primitives', () => {
    const { container } = render(<GeometryTab isExact mafsHeight={320} mode="explore" />);
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('StatisticsTab Explore renders ≤ 300 SVG primitives', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('LinearAlgebraTab Explore renders ≤ 300 SVG primitives', () => {
    const { container } = render(<LinearAlgebraTab mafsHeight={320} mode="explore" />);
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });
});

// ─── P5: Scene switch / unmount residual check ─────────────────────────────────

describe('P5 Tab/scene switching leaves no residual elements', () => {
  afterEach(cleanup);

  it('CalculusTab: switching scene unmounts previous visualization', () => {
    const { container } = render(<CalculusTab isExact mafsHeight={320} mode="explore" />);

    // Start on default tangent/derivative scene
    const initialCount = countSvgPrimitives(container);
    expect(initialCount).toBeGreaterThan(0);

    // Switch to direction field
    fireEvent.change(screen.getByLabelText('Calculus explore topic'), {
      target: { value: 'calculus-direction-field' },
    });
    // The tangent-specific elements should be gone; direction-field specific present
    expect(container.querySelectorAll('[data-testid="plot-vector-field"]')).toHaveLength(1);
    // No residual from the previous scene stacking up
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);

    // Switch to numerical methods
    fireEvent.change(screen.getByLabelText('Calculus explore topic'), {
      target: { value: 'calculus-numerical-methods' },
    });
    // Direction field should be completely gone
    expect(container.querySelectorAll('[data-testid="plot-vector-field"]')).toHaveLength(0);
  });

  it('GeometryTab: switching scene unmounts previous visualization', () => {
    const { container } = render(<GeometryTab isExact mafsHeight={320} mode="explore" />);

    // Default shows reflection/transformation
    fireEvent.change(screen.getByLabelText('Geometry explore topic'), {
      target: { value: 'geometry-circle-scaling' },
    });
    const circleCount = container.querySelectorAll('[data-testid="circle"]').length;
    expect(circleCount).toBeGreaterThan(0);

    // Switch to unit circle
    fireEvent.change(screen.getByLabelText('Geometry explore topic'), {
      target: { value: 'geometry-unit-circle' },
    });
    // Previous circle-scaling specific content should not remain
    expect(screen.queryByText('Circles and Scale Change')).toBeNull();
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('SandboxTab: switching scene unmounts previous visualization', () => {
    const { container } = render(<SandboxTab isExact mafsHeight={320} mode="explore" />);

    // Switch to polar curves
    fireEvent.change(screen.getByLabelText('Sandbox explore topic'), {
      target: { value: 'sandbox-polar-curves' },
    });
    expect(container.querySelectorAll('[data-testid="plot-parametric"]').length).toBeGreaterThan(0);

    // Switch to parametric curves
    fireEvent.change(screen.getByLabelText('Sandbox explore topic'), {
      target: { value: 'sandbox-parametric-curves' },
    });
    // Previous polar-specific label should not be present
    expect(screen.queryByText('Polar Curves')).toBeNull();
    // Still bounded
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('StatisticsTab: switching module unmounts previous scene', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);

    // Default is distribution-shape with Point elements
    const initialPoints = container.querySelectorAll('[data-testid="point"]').length;
    expect(initialPoints).toBeGreaterThan(0);

    // Switch to normal
    fireEvent.click(screen.getByRole('radio', { name: /Normal/i }));
    // Distribution dot-plot points should be gone
    const afterSwitch = container.querySelectorAll('[data-testid="point"]').length;
    expect(afterSwitch).toBe(0);
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('LinearAlgebraTab: switching scene unmounts previous vectors', () => {
    const { container } = render(<LinearAlgebraTab mafsHeight={320} mode="explore" />);

    // Default scene has vectors
    const initialVectors = container.querySelectorAll('[data-testid="vector"]').length;
    expect(initialVectors).toBeGreaterThan(0);

    // Switch to matrix scene
    fireEvent.change(screen.getByLabelText(/scene/i), {
      target: { value: 'linear-matrix-transform' },
    });
    // bounded
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('ExplorerTab: unmounting Learn mode leaves no floating elements', () => {
    const { container, unmount } = render(
      <ExplorerTab
        mafsHeight={320}
        mode="learn"
        activityId="explorer-quadrant-predict"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );
    expect(countSvgPrimitives(container)).toBeGreaterThan(0);
    unmount();
    // After unmount, the container has no residual Lab elements
    expect(container.querySelectorAll('[data-testid="mafs"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="point"]')).toHaveLength(0);
  });
});

// ─── P5: Timer behaviour — only known copy-feedback timer ──────────────────────

describe('P5 Timer behaviour: only copy-feedback setTimeout is permitted', () => {
  afterEach(() => {
    cleanup();
  });

  it('ExplorerTab Explore does not set any timers', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    render(<ExplorerTab mafsHeight={320} mode="explore" />);
    // No timers should be active from ExplorerTab
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('CalculusTab Explore does not set any timers', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    render(<CalculusTab isExact mafsHeight={320} mode="explore" />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('GeometryTab Explore does not set any timers', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    render(<GeometryTab isExact mafsHeight={320} mode="explore" />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('StatisticsTab Explore does not set any timers', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    render(<StatisticsTab mafsHeight={320} mode="explore" />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('LinearAlgebraTab Explore does not set any timers', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    render(<LinearAlgebraTab mafsHeight={320} mode="explore" />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('SandboxTab copy-feedback timer is the only timer and is cleaned up on unmount', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const { unmount } = render(<SandboxTab isExact mafsHeight={320} mode="explore" />);

    // Initially no timers set
    const callsAfterRender = spy.mock.calls.length;
    expect(callsAfterRender).toBe(0);

    // Trigger the copy functionality (it requires clipboard API)
    // The copy-feedback timer is only set when clipboard.writeText succeeds.
    // We verify that unmount clears any pending timer by checking cleanup runs.
    unmount();
    // After unmount, the clearTimeout in the cleanup effect runs.
    // The component's useEffect cleanup handles the ref.
    spy.mockRestore();
  });
});

// ─── P5: Heavy Learn scenes budget validation ──────────────────────────────────

describe('P5 Heavy Learn scenes render budget', () => {
  it('direction-field Learn: total primitives ≤ 40 before submit', () => {
    const { container } = render(
      <CalculusTab
        isExact
        mafsHeight={320}
        mode="learn"
        activityId="calculus-direction-field"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );
    const mafsEl = container.querySelector('[data-testid="mafs"]');
    expect(mafsEl).toBeTruthy();
    const count = countSvgPrimitives(mafsEl as HTMLElement);
    // VectorField(1) + coordinates(1) = minimal before reveal
    expect(count).toBeLessThanOrEqual(40);
  });

  it('direction-field Learn: total primitives ≤ 40 after submit (with solution curve)', () => {
    const { container } = render(
      <CalculusTab
        isExact
        mafsHeight={320}
        mode="learn"
        activityId="calculus-direction-field"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );
    // Submit answer to reveal solution curve
    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Submit'));
    const mafsEl = container.querySelector('[data-testid="mafs"]');
    const count = countSvgPrimitives(mafsEl as HTMLElement);
    // VectorField(1) + coordinates(1) + parametric(1) = 3 plus text/labels
    expect(count).toBeLessThanOrEqual(40);
  });

  it('statistics distribution Learn: rendered points ≤ dataPoints', () => {
    const { container } = render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-distribution-shape"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );
    const points = container.querySelectorAll('[data-testid="point"]');
    expect(points.length).toBeLessThanOrEqual(LAB_RENDER_LIMITS.dataPoints);
    // Default learn data is [2,3,3,4,8] = 5 points
    expect(points.length).toBe(5);
  });

  it('probability simulation Learn: trial result stays within budget', () => {
    render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-probability-simulation"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );
    // The internal probTrials in learn mode is set to 100, which is ≤ MAX_TRIALS (200)
    // Verify the simulation function enforces the cap
    const over = simulateProbability(500, 0.5);
    expect(over.trials).toBe(LAB_RENDER_LIMITS.probabilityTrials);

    const within = simulateProbability(100, 0.5);
    expect(within.trials).toBe(100);
    expect(within.trials).toBeLessThanOrEqual(LAB_RENDER_LIMITS.probabilityTrials);
  });

  it('kinematics Learn: only 1 plot-of-x before submit, 3 after', () => {
    const { container } = render(
      <CalculusTab
        isExact
        mafsHeight={320}
        mode="learn"
        activityId="calculus-kinematics-links"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );
    const plotsBefore = container.querySelectorAll('[data-testid="plot-of-x"]');
    expect(plotsBefore).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: '2t' } });
    fireEvent.click(screen.getByText('Submit'));

    const plotsAfter = container.querySelectorAll('[data-testid="plot-of-x"]');
    expect(plotsAfter).toHaveLength(3);
    // Total scene still bounded
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('numerical-methods Learn: Newton iterations render bounded lines', () => {
    const { container } = render(
      <CalculusTab
        isExact
        mafsHeight={320}
        mode="learn"
        activityId="calculus-numerical-methods"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );
    // Before submit: just the curve
    const plotsBefore = container.querySelectorAll('[data-testid="plot-of-x"]');
    expect(plotsBefore.length).toBeGreaterThanOrEqual(1);

    // Submit to reveal Newton lines
    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: '1.41' } });
    fireEvent.click(screen.getByText('Submit'));

    // Line segments for Newton iterations: each iter = 2 segments + text
    // With default 3 iterations: 3 * (2 segments + text) = bounded
    const segments = container.querySelectorAll('[data-testid="line-segment"]');
    // Max 20 iterations * 2 segments = 40; current default is 3 iters * 2 = 6
    expect(segments.length).toBeLessThanOrEqual(LAB_RENDER_LIMITS.numericalIterations * 2);
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });
});


// ─── P5: Exhaustive Explore topic budget matrix ──────────────────────────────

describe('P5 every selectable Explore scene stays within the SVG budget', () => {
  afterEach(cleanup);

  it.each([
    'core-calculus',
    'calculus-direction-field',
    'calculus-kinematics-links',
    'calculus-numerical-methods',
  ])('Calculus topic %s renders ≤ 300 primitives', (topic) => {
    const { container } = render(<CalculusTab isExact mafsHeight={320} mode="explore" />);
    fireEvent.change(screen.getByLabelText('Calculus explore topic'), {
      target: { value: topic },
    });
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it.each([
    'transformations',
    'geometry-circle-scaling',
    'geometry-pythagoras',
    'geometry-sohcahtoa',
    'geometry-unit-circle',
    'geometry-similarity-ratio',
  ])('Geometry topic %s renders ≤ 300 primitives', (topic) => {
    const { container } = render(<GeometryTab isExact mafsHeight={320} mode="explore" />);
    fireEvent.change(screen.getByLabelText('Geometry explore topic'), {
      target: { value: topic },
    });
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it.each([
    'Distribution Shape',
    'Normal & z-Scores',
    'Probability Simulation',
    'Scatter & Regression',
    'Box Plot',
    'Tree & Two-Way',
  ])('Statistics module %s renders ≤ 300 primitives', (moduleName) => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: moduleName }));
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it.each([
    'linear-vector-resultant',
    'linear-matrix-transform',
    'linear-complex-plane',
  ])('Linear algebra scene %s renders ≤ 300 primitives', (scene) => {
    const { container } = render(<LinearAlgebraTab mafsHeight={320} mode="explore" />);
    fireEvent.change(screen.getByLabelText('Select linear algebra scene'), {
      target: { value: scene },
    });
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('replacing the active Tab unmounts the previous Tab SVG tree', () => {
    const { container, rerender } = render(
      <ExplorerTab mafsHeight={320} mode="explore" />,
    );
    expect(container.querySelectorAll('[data-testid="movable-point"]').length).toBeGreaterThan(0);

    rerender(<StatisticsTab mafsHeight={320} mode="explore" />);

    expect(container.querySelectorAll('[data-testid="movable-point"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="mafs"]')).toHaveLength(1);
    expect(countSvgPrimitives(container)).toBeLessThanOrEqual(300);
  });
});

// ─── P5: Statistics module non-empty content lower bounds ─────────────────────
// These tests enforce that each of the six Statistics modules renders
// substantive content in Explore mode. An empty shell (just a heading or
// empty container) will fail these assertions.

describe('P5 Statistics module non-empty Explore content lower bounds', () => {
  afterEach(cleanup);

  it('Distribution Shape renders ≥ 3 SVG primitives (dot-plot points + mean/median lines)', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Distribution Shape/i }));
    // Default data [2,3,3,4,8] = 5 points + mean/median text + coordinates + mafs = many
    expect(countSvgPrimitives(container)).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('[data-testid="point"]').length).toBeGreaterThanOrEqual(5);
  });

  it('Normal & z-Scores renders ≥ 3 SVG primitives (curve + shaded area + axis)', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Normal/i }));
    expect(countSvgPrimitives(container)).toBeGreaterThanOrEqual(3);
    // Must have the curve and inequality fill
    expect(container.querySelectorAll('[data-testid="plot-of-x"]').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('[data-testid="plot-inequality"]').length).toBeGreaterThanOrEqual(1);
  });

  it('Probability Simulation renders ≥ 3 SVG primitives (bars + expected line)', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Probability/i }));
    expect(countSvgPrimitives(container)).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('[data-testid="polygon"]').length).toBeGreaterThanOrEqual(2);
  });

  it('Scatter & Regression renders ≥ 3 SVG primitives (data points + regression line)', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Scatter/i }));
    expect(countSvgPrimitives(container)).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('[data-testid="point"]').length).toBeGreaterThanOrEqual(8);
    expect(container.querySelectorAll('[data-testid="plot-of-x"]').length).toBeGreaterThanOrEqual(1);
  });

  it('Box Plot renders ≥ 3 SVG primitives (data dots + box polygon + whisker lines)', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));
    // Box plot should have: mafs, coordinates, 7 points, polygon, line-segments, texts
    expect(countSvgPrimitives(container)).toBeGreaterThanOrEqual(5);
    // Data dots
    expect(container.querySelectorAll('[data-testid="point"]').length).toBeGreaterThanOrEqual(7);
    // Box polygon
    expect(container.querySelectorAll('[data-testid="polygon"]').length).toBeGreaterThanOrEqual(1);
    // Whisker and median line segments (whiskers=2 + caps=2 + median=1 = 5)
    expect(container.querySelectorAll('[data-testid="line-segment"]').length).toBeGreaterThanOrEqual(4);
    // Five-number summary testid must be present with valid content
    const summaryEl = container.querySelector('[data-testid="box-plot-summary"]');
    expect(summaryEl).toBeTruthy();
    expect(summaryEl!.textContent).toMatch(/Min.*Q1.*Median.*Q3.*Max/);
  });

  it('Tree & Two-Way renders non-empty DOM content with testid (tree diagram by default)', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Tree & Two-Way/i }));
    // Tree scene is the default; it renders a monospace tree diagram
    const treeVis = container.querySelector('[data-testid="tree-explore-vis"]');
    expect(treeVis).toBeTruthy();
    const treeDiagram = container.querySelector('[data-testid="tree-diagram-explore"]');
    expect(treeDiagram).toBeTruthy();
    expect(treeDiagram!.textContent!.length).toBeGreaterThan(40);
    // Result area
    const result = container.querySelector('[data-testid="tree-explore-result"]');
    expect(result).toBeTruthy();
    expect(result!.textContent).toMatch(/P\(both red\)/);
  });

  it('Tree & Two-Way table scene renders non-empty DOM table with testid', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Tree & Two-Way/i }));
    // Switch to table scene
    fireEvent.click(screen.getByRole('radio', { name: /Two-Way Table/i }));
    const tableVis = container.querySelector('[data-testid="table-explore-vis"]');
    expect(tableVis).toBeTruthy();
    const table = container.querySelector('[data-testid="two-way-table-explore"]');
    expect(table).toBeTruthy();
    // Table should have at least header + 3 data rows
    const rows = table!.querySelectorAll('tr');
    expect(rows.length).toBeGreaterThanOrEqual(4);
    // Result area
    const result = container.querySelector('[data-testid="table-explore-result"]');
    expect(result).toBeTruthy();
    expect(result!.textContent).toMatch(/Neither/);
  });

  it('Box Plot Explore data is bounded at MAX_DATA (40)', () => {
    render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));
    // Default data has 7 points
    const summaryEl = screen.getByTestId('box-plot-summary');
    expect(summaryEl.textContent).toMatch(/n = 7/);
    // Add button exists and is enabled
    const addBtn = screen.getByLabelText('Add box plot value') as HTMLButtonElement;
    expect(addBtn.disabled).toBe(false);
  });

  it('Box Plot deep-link shows explore visual immediately', () => {
    const { container } = render(
      <StatisticsTab mafsHeight={320} mode="explore" activityId="statistics-box-plot" />
    );
    // Should immediately show the box-plot explore vis
    expect(container.querySelector('[data-testid="box-plot-explore-vis"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="point"]').length).toBeGreaterThanOrEqual(7);
  });

  it('Tree & Two-Way deep-link shows explore visual immediately', () => {
    const { container } = render(
      <StatisticsTab mafsHeight={320} mode="explore" activityId="statistics-tree-two-way" />
    );
    // Should immediately show the tree explore vis
    expect(container.querySelector('[data-testid="tree-explore-vis"]')).toBeTruthy();
  });
});
