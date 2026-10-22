import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// --- SM: Extended mafs mock ---
interface MafsMockProps {
  children?: ReactNode;
  pan?: boolean;
  zoom?: boolean | { min: number; max: number };
}

vi.mock('mafs', () => ({
  Mafs: ({ children, pan, zoom }: MafsMockProps) => (
    <div
      data-testid="mafs"
      data-pan={String(Boolean(pan))}
      data-zoom={typeof zoom === 'object' ? `${zoom.min}-${zoom.max}` : String(Boolean(zoom))}
    >
      {children}
    </div>
  ),
  Coordinates: {
    Cartesian: () => <div data-testid="coordinates" />,
    Polar: () => <div data-testid="polar-coordinates" />,
  },
  MovablePoint: () => <div data-testid="movable-point" />,
  Point: () => <div data-testid="point" />,
  Circle: () => <div data-testid="circle" />,
  Polygon: () => <div data-testid="polygon" />,
  Text: ({ children }: { children?: ReactNode }) => <svg><text>{children}</text></svg>,
  Line: {
    Segment: () => <div data-testid="line-segment" />,
    ThroughPoints: () => <div data-testid="line-through-points" />,
    PointAngle: ({ point, angle }: { point: [number, number]; angle: number }) => (
      <div data-testid="line-point-angle" data-point={point.join(',')} data-angle={String(angle)} />
    ),
    PointSlope: ({ point, slope }: { point: [number, number]; slope: number }) => (
      <div data-testid="line-point-slope" data-point={point.join(',')} data-slope={String(slope)} />
    ),
  },
  Plot: {
    OfX: ({ y }: { y: (x: number) => number }) => <div data-testid="plot-of-x" data-value-at-zero={String(y(0))} />,
    OfY: () => <div data-testid="plot-of-y" />,
    Inequality: () => <div data-testid="plot-inequality" />,
    Parametric: ({ maxSamplingDepth }: { maxSamplingDepth?: number }) => (
      <div data-testid="plot-parametric" data-sampling-depth={maxSamplingDepth ?? ''} />
    ),
    VectorField: ({ xy, step }: { xy: (p: [number, number]) => [number, number]; step: number }) => {
      const samples = [[0, 0], [1, 0], [0, 1]].map((p) => {
        const result = xy(p as [number, number]);
        return `${result[0].toFixed(3)},${result[1].toFixed(3)}`;
      });
      return (
        <div data-testid="plot-vector-field" data-step={String(step)} data-samples={samples.join(';')} />
      );
    },
  },
  Vector: ({ tail, tip }: { tail?: [number, number]; tip: [number, number] }) => (
    <div data-testid="vector" data-tail={tail ? tail.join(',') : '0,0'} data-tip={tip.join(',')} />
  ),
  Transform: ({ children, matrix, scale, translate }: { children?: ReactNode; matrix?: number[][]; scale?: number | [number, number]; translate?: [number, number] }) => (
    <div
      data-testid="transform"
      data-matrix={matrix ? JSON.stringify(matrix) : ''}
      data-scale={scale != null ? String(scale) : ''}
      data-translate={translate ? translate.join(',') : ''}
    >
      {children}
    </div>
  ),
  LaTeX: ({ tex, at }: { tex: string; at: [number, number] }) => (
    <div data-testid="latex" data-tex={tex} data-at={at.join(',')} />
  ),
  Ellipse: ({ center, radius }: { center: [number, number]; radius: [number, number] }) => (
    <div data-testid="ellipse" data-center={center.join(',')} data-radius={radius.join(',')} />
  ),
  Polyline: ({ points }: { points?: [number, number][] }) => (
    <div data-testid="polyline" data-points={points ? points.map((p) => p.join(',')).join(';') : ''} />
  ),
  labelPi: (x: number): string => {
    if (x === 0) return '0';
    const ratio = x / Math.PI;
    if (Math.abs(ratio - 1) < 1e-10) return 'π';
    return `${ratio.toFixed(2)}π`;
  },
  Theme: {
    foreground: '#000000',
    background: '#ffffff',
  },
}));

import StatisticsTab from '../components/lab/StatisticsTab';
import GeometryTab from '../components/lab/GeometryTab';
import SandboxTab from '../components/lab/SandboxTab';

function submit(answer: string) {
  fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: answer } });
  fireEvent.click(screen.getByText('Submit'));
}

// ─── J1: Box Plot activity scene tests ───────────────────────────────────────

describe('Statistics Box Plot Learn scene', () => {
  it('hides the box-and-whisker plot until submit', () => {
    render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-box-plot"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );

    // Before submit: data points visible as dots, but no five-number info div
    expect(screen.queryByText(/Five-number summary:/)).toBeNull();

    // Submit correct answer for step 1 (median of 3,5,7,8,12,14,16 = 8)
    submit('8');

    // After submit: five-number summary info div visible
    expect(screen.getByText(/Five-number summary:/)).toBeTruthy();
  });

  it('resets reveal state when stepping to the next question', () => {
    render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-box-plot"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );

    // Submit correct answer for step 1
    submit('8');
    expect(screen.getByText(/Median=8/)).toBeTruthy();

    // Move to next step
    fireEvent.click(screen.getByText(/Next/));

    // Reveal state should be reset
    expect(screen.queryByText(/IQR=/)).toBeNull();
  });
});

// ─── J2: Tree Diagram / Two-Way Table scene tests ────────────────────────────

describe('Statistics Tree/Two-Way Learn scene', () => {
  it('hides probability result until submit on step 0 (tree diagram)', () => {
    render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-tree-two-way"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );

    // Tree diagram should be visible (DOM-based)
    expect(screen.getByTestId('tree-diagram')).toBeTruthy();
    // Probability result hidden
    expect(screen.queryByText(/P\(both red\) = 3\/5/)).toBeNull();

    // Submit correct answer
    submit('3/10');

    // Now probability is revealed
    expect(screen.getByText(/P\(both red\) = 3\/5/)).toBeTruthy();
  });

  it('shows two-way table on step 1 and hides cells until reveal', () => {
    render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-tree-two-way"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );

    // Advance to step 1 (submit step 0 first)
    submit('3/10');
    fireEvent.click(screen.getByText(/Next/));

    // Two-way table should be visible
    expect(screen.getByTestId('two-way-table')).toBeTruthy();
    // "Neither" calculation hidden (the visual info div is absent)
    expect(screen.queryByText(/Neither = 40 −/)).toBeNull();

    // Submit correct answer for step 1 (neither = 10)
    submit('10');

    // Now the visual explanation div is visible (use aria-live region)
    const infoElements = screen.getAllByText(/Neither = 40/);
    expect(infoElements.length).toBeGreaterThanOrEqual(1);
  });

  it('resets reveal when advancing steps', () => {
    render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-tree-two-way"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );

    submit('3/10');
    // The revealed info div should be visible after submit
    const revealed = screen.getAllByText(/P\(both red\)/);
    expect(revealed.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByText(/Next/));
    // Tree diagram result info div should disappear after stepping
    // (the question prompt for step 2 is different, no tree visible)
    expect(screen.queryByTestId('tree-diagram')).toBeNull();
  });
});

// ─── J3: Distance-Time Graph scene tests ─────────────────────────────────────

describe('Sandbox Distance-Time Learn scene', () => {
  it('renders the distance-time function graph with slope 15', () => {
    render(
      <SandboxTab
        isExact
        mafsHeight={320}
        mode="learn"
        activityId="sandbox-distance-time"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );

    // The graph should show a linear function (y=15x at x=0 is 0)
    const plots = screen.getAllByTestId('plot-of-x');
    expect(plots.length).toBeGreaterThan(0);
    // At x=0, y=15*0+0=0
    expect(plots[0].getAttribute('data-value-at-zero')).toBe('0');
  });

  it('shows the trace point control and hides markers until submit', () => {
    render(
      <SandboxTab
        isExact
        mafsHeight={320}
        mode="learn"
        activityId="sandbox-distance-time"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );

    // Trace point x-coordinate input should be visible
    expect(screen.getByLabelText('Learning trace-point x-coordinate')).toBeTruthy();
    // No point markers before submit
    expect(screen.queryByTestId('point')).toBeNull();

    // Submit answer
    submit('15');

    // Point markers should appear after reveal
    expect(screen.getAllByTestId('point').length).toBeGreaterThan(0);
  });
});

// ─── J4: Similarity and Congruence scene tests ───────────────────────────────

describe('Geometry Similarity Learn scene', () => {
  it('hides the scaled triangle until submit', () => {
    render(
      <GeometryTab
        isExact
        mafsHeight={320}
        mode="learn"
        activityId="geometry-similarity-ratio"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );

    // Original triangle shown (1 polygon), scaled triangle hidden
    const polygons = screen.getAllByTestId('polygon');
    expect(polygons.length).toBe(1);

    // Submit correct answer (scale factor = 2)
    submit('2');

    // Now 2 polygons visible (original + scaled)
    expect(screen.getAllByTestId('polygon').length).toBeGreaterThanOrEqual(2);
  });

  it('resets reveal state on step change', () => {
    render(
      <GeometryTab
        isExact
        mafsHeight={320}
        mode="learn"
        activityId="geometry-similarity-ratio"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );

    submit('2');
    expect(screen.getAllByTestId('polygon').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByText(/Next/));
    // After step change, should reset to 1 polygon
    expect(screen.getAllByTestId('polygon').length).toBe(1);
  });

  it('shows congruence message on step 2', () => {
    render(
      <GeometryTab
        isExact
        mafsHeight={320}
        mode="learn"
        activityId="geometry-similarity-ratio"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );

    // Advance through steps
    submit('2');
    fireEvent.click(screen.getByText(/Next/));
    submit('10');
    fireEvent.click(screen.getByText(/Next/));
    submit('25');

    // Step 2 is about congruent triangles - the info div mentions scale factor = 1
    const congruenceInfos = screen.getAllByText(/congruent/i);
    expect(congruenceInfos.length).toBeGreaterThanOrEqual(2);
  });
});
