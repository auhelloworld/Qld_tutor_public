/**
 * Render contracts for the six visual-topic activities added for Years 7–12.
 *
 * Each new scene must actually draw, must keep its answer hidden until the
 * student submits, and must stay inside the shared Lab layout contract.
 */
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(cleanup);

vi.mock('mafs', () => ({
  Mafs: ({ children, viewBox, preserveAspectRatio }: { children?: ReactNode; viewBox?: unknown; preserveAspectRatio?: unknown }) => (
    <div
      data-testid="mafs"
      data-viewbox={JSON.stringify(viewBox)}
      data-preserve={String(preserveAspectRatio)}
    >
      {children}
    </div>
  ),
  Coordinates: {
    Cartesian: ({ yAxis }: { yAxis?: unknown }) => (
      <div data-testid="coordinates" data-y-axis={String(yAxis)} />
    ),
    Polar: () => <div data-testid="polar-coordinates" />,
  },
  MovablePoint: () => <div data-testid="movable-point" />,
  Point: ({ x, y }: { x?: number; y?: number }) => (
    <div data-testid="point" data-x={String(x)} data-y={String(y)} />
  ),
  Circle: ({ fillOpacity }: { fillOpacity?: number }) => (
    <div data-testid="circle" data-fill-opacity={String(fillOpacity)} />
  ),
  Polygon: ({ points }: { points?: unknown }) => (
    <div data-testid="polygon" data-points={JSON.stringify(points)} />
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Line: {
    Segment: ({ point1, point2 }: { point1?: unknown; point2?: unknown }) => (
      <div data-testid="line-segment" data-p1={JSON.stringify(point1)} data-p2={JSON.stringify(point2)} />
    ),
    ThroughPoints: () => <div />,
    PointAngle: () => <div />,
    PointSlope: () => <div />,
  },
  Plot: {
    OfX: () => <div data-testid="plot-of-x" />,
    OfY: () => <div />,
    Inequality: () => <div data-testid="plot-inequality" />,
    Parametric: ({ maxSamplingDepth }: { maxSamplingDepth?: number }) => (
      <div data-testid="plot-parametric" data-depth={String(maxSamplingDepth)} />
    ),
    VectorField: () => <div />,
  },
  Vector: () => <div />,
  Transform: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  LaTeX: ({ tex }: { tex?: string }) => <span data-testid="mafs-latex" data-tex={tex} />,
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
import GeometryTab from '../components/lab/GeometryTab';
import CalculusTab from '../components/lab/CalculusTab';
import SandboxTab from '../components/lab/SandboxTab';
import { LAB_ACTIVITIES, ALL_ACTIVITY_IDS } from '../lib/lab-activities';
import { makeVariant } from '../lib/lab-variants';

const NEW_ACTIVITIES = [
  'explorer-number-line',
  'sandbox-function-transformations',
  'sandbox-exponential-log',
  'geometry-angle-reasoning',
  'calculus-curve-sketching',
  'calculus-area-between',
] as const;

function submit(answer: string) {
  fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: answer } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
}

describe('numerical methods scenes are distinct per step', () => {
  // The four steps previously shared one picture: the scene was chosen by step
  // index, so steps 2-4 all drew the same trapezoid even though the extension
  // step asks about Newton's method.
  const EXPECTED_KINDS = [
    'numerical-newton',
    'numerical-trapezoid',
    'numerical-trapezoid',
    'numerical-newton',
  ] as const;

  it('every authored step declares the scene its prompt describes', () => {
    const steps = LAB_ACTIVITIES['calculus-numerical-methods'].steps;
    expect(steps).toHaveLength(4);
    steps.forEach((step, index) => {
      expect(step.sceneData, `step ${index + 1} needs a scene`).toBeDefined();
      expect(step.sceneData!.kind, `step ${index + 1}: ${step.prompt}`).toBe(EXPECTED_KINDS[index]);
    });
  });

  it('the two trapezoid steps draw different partitions', () => {
    const steps = LAB_ACTIVITIES['calculus-numerical-methods'].steps;
    const coarse = steps[1].sceneData;
    const fine = steps[2].sceneData;
    expect(coarse?.kind).toBe('numerical-trapezoid');
    expect(fine?.kind).toBe('numerical-trapezoid');
    if (coarse?.kind !== 'numerical-trapezoid' || fine?.kind !== 'numerical-trapezoid') return;
    expect(coarse.partitions).toBeDefined();
    expect(fine.partitions).toBeDefined();
    // The prompt for step 3 is about using *more* trapezoids.
    expect(fine.partitions!).toBeGreaterThan(coarse.partitions!);
    expect(fine.partitions!).toBeLessThanOrEqual(20);
  });

  it('generated variants keep the same per-step scene pattern', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const result = makeVariant('calculus-numerical-methods', seed);
      if (!result.hasVariants) continue;
      result.steps.slice(0, 3).forEach((step, index) => {
        expect(step.sceneData?.kind, `seed ${seed} step ${index + 1}`).toBe(EXPECTED_KINDS[index]);
      });
      // Both generated extension forms are about Newton's method.
      expect(result.steps[3].sceneData?.kind).toBe('numerical-newton');
      const coarse = result.steps[1].sceneData;
      const fine = result.steps[2].sceneData;
      if (coarse?.kind === 'numerical-trapezoid' && fine?.kind === 'numerical-trapezoid') {
        expect(fine.partitions!).toBeGreaterThan(coarse.partitions!);
      }
    }
  });
});

describe('new visual-topic activities are catalogued correctly', () => {
  it.each(NEW_ACTIVITIES)('%s exists with three core steps and one extension', (id) => {
    const activity = LAB_ACTIVITIES[id];
    expect(activity).toBeDefined();
    expect(activity.steps.filter((s) => s.tier !== 'extension')).toHaveLength(3);
    expect(activity.steps.filter((s) => s.tier === 'extension')).toHaveLength(1);
    expect(activity.topicIds?.length, `${id} needs a real curriculum mapping`).toBeGreaterThan(0);
  });

  it('maps to real AC9 and QCAA topic ids', () => {
    const pattern = /^(AC9M(7|8|9|10)[A-Z]+\d+|QCAA_(METHODS|SPECIALIST)_U\d_T\d)$/;
    for (const id of NEW_ACTIVITIES) {
      for (const topicId of LAB_ACTIVITIES[id].topicIds ?? []) {
        expect(pattern.test(topicId), `${id} → ${topicId}`).toBe(true);
      }
    }
  });

  it('keeps the catalogue at six tabs', () => {
    const tabs = new Set(ALL_ACTIVITY_IDS.map((id) => LAB_ACTIVITIES[id].tab));
    expect(tabs.size).toBe(6);
  });
});

describe('number line scene', () => {
  function renderNumberLine() {
    return render(
      <ExplorerTab
        mafsHeight={360}
        mode="learn"
        activityId="explorer-number-line"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />,
    );
  }

  it('draws a one-dimensional axis with no vertical axis', () => {
    const { container } = renderNumberLine();
    const coordinates = container.querySelector('[data-testid="coordinates"]');
    expect(coordinates?.getAttribute('data-y-axis')).toBe('false');
    const viewBox = JSON.parse(container.querySelector('[data-testid="mafs"]')!.getAttribute('data-viewbox')!);
    expect(viewBox.y).toEqual([-1, 1]);
    expect(container.querySelector('[data-testid="mafs"]')?.getAttribute('data-preserve')).toBe('false');
  });

  it('marks the two values named in the prompt', () => {
    const { container } = renderNumberLine();
    const marks = Array.from(container.querySelectorAll('[data-testid="point"]'))
      .map((el) => Number(el.getAttribute('data-x')));
    expect(marks).toContain(-3.5);
    expect(marks).toContain(-3);
  });

  it('hides the solution set until the inequality step is submitted', () => {
    const { container } = renderNumberLine();
    submit('-3.5');
    fireEvent.click(screen.getByText(/Next/));
    submit('-1.5');
    fireEvent.click(screen.getByText(/Next/));
    // Third step: the solution ray must stay hidden before submitting.
    expect(container.querySelectorAll('[data-testid="line-segment"]')).toHaveLength(0);
    submit('3');
    expect(container.querySelectorAll('[data-testid="line-segment"]').length).toBeGreaterThan(0);
    // An open endpoint is drawn as a hollow circle.
    const hollow = Array.from(container.querySelectorAll('[data-testid="circle"]'))
      .some((el) => el.getAttribute('data-fill-opacity') === '0');
    expect(hollow).toBe(true);
  });
});

describe('angle reasoning scene', () => {
  it('draws parallel lines with both angle arcs, revealing the partner value on submit', () => {
    const { container } = render(
      <GeometryTab
        isExact
        mafsHeight={360}
        mode="learn"
        activityId="geometry-angle-reasoning"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />,
    );
    // Two parallel lines plus a transversal.
    expect(container.querySelectorAll('[data-testid="line-segment"]').length).toBeGreaterThanOrEqual(3);
    // Both arcs are drawn from the start: the student needs to see which angle
    // is being asked about. Only its value is withheld.
    expect(container.querySelectorAll('[data-testid="plot-parametric"]')).toHaveLength(2);
    const texBefore = Array.from(container.querySelectorAll('[data-testid="mafs-latex"]'))
      .map((el) => el.getAttribute('data-tex'));
    expect(texBefore).toContain('?');
    expect(texBefore.join('|')).not.toContain('125');
    submit('125');
    const texAfter = Array.from(container.querySelectorAll('[data-testid="mafs-latex"]'))
      .map((el) => el.getAttribute('data-tex'));
    expect(texAfter).not.toContain('?');
    expect(texAfter.join('|')).toContain('125');
  });

  it('respects the shared curve sampling budget for its arcs', () => {
    const { container } = render(
      <GeometryTab
        isExact
        mafsHeight={360}
        mode="learn"
        activityId="geometry-angle-reasoning"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />,
    );
    for (const arc of container.querySelectorAll('[data-testid="plot-parametric"]')) {
      expect(Number(arc.getAttribute('data-depth'))).toBeLessThanOrEqual(8);
    }
  });

  it('draws the polygon with the number of sides the prompt states', () => {
    const { container } = render(
      <GeometryTab
        isExact
        mafsHeight={360}
        mode="learn"
        activityId="geometry-angle-reasoning"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />,
    );
    submit('125');
    fireEvent.click(screen.getByText(/Next/));
    submit('55');
    fireEvent.click(screen.getByText(/Next/));
    const polygon = container.querySelector('[data-testid="polygon"]');
    expect(polygon).not.toBeNull();
    expect(JSON.parse(polygon!.getAttribute('data-points')!)).toHaveLength(7);
  });
});

describe('calculus area-between scene', () => {
  it('shades the region only after the student submits', () => {
    const { container } = render(
      <CalculusTab
        isExact
        mafsHeight={360}
        mode="learn"
        activityId="calculus-area-between"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />,
    );
    // Parabola and line are both drawn from the start.
    expect(container.querySelectorAll('[data-testid="plot-of-x"]').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('[data-testid="plot-inequality"]')).toBeNull();
    submit('2');
    expect(container.querySelector('[data-testid="plot-inequality"]')).not.toBeNull();
  });
});

describe('calculus curve-sketching scene', () => {
  it('reveals the derivative curve and the concavity read-out on submit', () => {
    const { container } = render(
      <CalculusTab
        isExact
        mafsHeight={360}
        mode="learn"
        activityId="calculus-curve-sketching"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />,
    );
    const before = container.querySelectorAll('[data-testid="plot-of-x"]').length;
    submit('3x^2 - 12x + 9');
    expect(container.querySelectorAll('[data-testid="plot-of-x"]').length).toBeGreaterThan(before);
    expect(screen.getByText(/concave/i)).toBeTruthy();
  });

  it('accepts any algebraically equivalent derivative', () => {
    render(
      <CalculusTab
        isExact
        mafsHeight={360}
        mode="learn"
        activityId="calculus-curve-sketching"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />,
    );
    // Factorised form of 3x² − 12x + 9.
    submit('3(x-1)(x-3)');
    expect(screen.getByText(/Correct!/)).toBeTruthy();
  });
});

describe('sandbox exponential and transformation scenes', () => {
  it.each(['sandbox-exponential-log', 'sandbox-function-transformations'] as const)(
    '%s renders a curve in Learn mode',
    (activityId) => {
      const { container } = render(
        <SandboxTab
          isExact
          mafsHeight={360}
          mode="learn"
          activityId={activityId}
          onActivityComplete={vi.fn()}
          onExitLearn={vi.fn()}
        />,
      );
      expect(container.querySelectorAll('[data-testid="plot-of-x"]').length).toBeGreaterThanOrEqual(1);
      expect(container.querySelector('.lab-control-column')).not.toBeNull();
      expect(container.querySelector('.lab-visual-column')).not.toBeNull();
    },
  );
});
