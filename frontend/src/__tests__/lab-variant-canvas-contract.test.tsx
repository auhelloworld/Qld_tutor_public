import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { makeVariant } from '../lib/lab-variants';
import type { LearnStep, LabSceneData } from '../lib/lab-activities';

vi.mock('mafs', async () => {
  const ReactModule = await import('react');
  return {
    Mafs: ({ children, pan, zoom, viewBox }: any) => ReactModule.createElement('div', {
      'data-testid': 'mafs-root',
      'data-pan': String(Boolean(pan)),
      'data-zoom': typeof zoom === 'object' ? JSON.stringify(zoom) : String(Boolean(zoom)),
      'data-viewbox': JSON.stringify(viewBox),
    }, children),
    Coordinates: {
      Cartesian: ({ xAxis, yAxis }: any) => ReactModule.createElement('div', {
        'data-testid': 'coordinates-cartesian',
        'data-x-lines': String(xAxis?.lines ?? ''),
        'data-y-lines': String(yAxis?.lines ?? ''),
      }),
      Polar: () => null,
    },
    Plot: {
      OfX: ({ y }: any) => ReactModule.createElement('div', {
        'data-testid': 'plot-ofx',
        'data-y-at-zero': String(y?.(0)),
      }),
      Parametric: () => null,
      VectorField: () => null,
      Inequality: () => null,
    },
    Line: {
      Segment: ({ point1, point2 }: any) => ReactModule.createElement('div', {
        'data-testid': 'line-segment',
        'data-point1': JSON.stringify(point1),
        'data-point2': JSON.stringify(point2),
      }),
      ThroughPoints: () => null,
    },
    Point: ({ x, y }: any) => ReactModule.createElement('div', {
      'data-testid': `point-${x}-${y}`,
      'data-x': String(x),
      'data-y': String(y),
    }),
    Circle: ({ radius }: any) => ReactModule.createElement('div', {
      'data-testid': 'circle',
      'data-radius': String(radius),
    }),
    Ellipse: () => null,
    Vector: ({ tip, tail }: any) => ReactModule.createElement('div', {
      'data-testid': 'vector',
      'data-tip': JSON.stringify(tip),
      'data-tail': JSON.stringify(tail),
    }),
    Transform: ({ children, matrix }: any) => ReactModule.createElement('div', {
      'data-testid': 'transform',
      'data-matrix': JSON.stringify(matrix),
    }, children),
    Polygon: ({ points }: any) => ReactModule.createElement('div', {
      'data-testid': 'polygon',
      'data-points': JSON.stringify(points),
    }),
    Text: ({ children }: any) => ReactModule.createElement('span', null, children),
    LaTeX: ({ tex }: any) => ReactModule.createElement('span', {
      'data-testid': 'mafs-latex',
      'data-tex': tex,
    }),
    Theme: { indigo: '#5B67CA', orange: '#F97316', green: '#22C55E', red: '#EF4444' },
    MovablePoint: ({ point }: any) => ReactModule.createElement('div', {
      'data-testid': 'movable-point',
      'data-x': String(point?.[0]),
      'data-y': String(point?.[1]),
    }),
    labelPi: () => '',
  };
});

vi.mock('lucide-react', () => ({
  MapPin: () => null,
  HelpCircle: () => null,
  CheckCircle: () => null,
  XCircle: () => null,
  Lightbulb: () => null,
  ArrowRight: () => null,
  Trophy: () => null,
  X: () => null,
  RefreshCw: () => null,
  BarChart3: () => null,
  ArrowDownRight: () => null,
  Sigma: () => null,
}));

import ExplorerTab from '../components/lab/ExplorerTab';
import GeometryExtensionsLab from '../components/lab/GeometryExtensionsLab';
import LinearAlgebraTab from '../components/lab/LinearAlgebraTab';
import StatisticsTab from '../components/lab/StatisticsTab';
import CalculusExtensionsLab from '../components/lab/CalculusExtensionsLab';
import { LAB_ACTIVITIES } from '../lib/lab-activities';

const FIXED_NOW = 1_234_567;
const FIXED_RANDOM = 0.375;
const FIXED_SEED = FIXED_NOW ^ Math.floor(FIXED_RANDOM * 0x7fffffff);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function activateVariant(activityId: string): { steps: Array<LearnStep & { sceneData?: LabSceneData }> } {
  vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  vi.spyOn(Math, 'random').mockReturnValue(FIXED_RANDOM);
  fireEvent.click(screen.getByRole('button', { name: 'New numbers' }));
  vi.restoreAllMocks();

  const generated = makeVariant(activityId, FIXED_SEED);
  if (!generated.hasVariants) throw new Error(`${activityId} must support variants`);
  expect(screen.getByText(generated.steps[0].prompt)).toBeTruthy();
  return generated;
}

function submit(step: LearnStep) {
  fireEvent.change(screen.getByLabelText('Your answer:'), {
    target: { value: step.acceptedAnswers[0] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
}

function advance(step: LearnStep) {
  submit(step);
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
}

function latexValues(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid="mafs-latex"]'))
    .map((node) => node.getAttribute('data-tex') ?? '');
}

describe('10 variant activities keep prompt and canvas parameters identical', () => {
  it('explorer-distance-from-origin uses the generated point', () => {
    const { container } = render(<ExplorerTab mafsHeight={300} mode="learn" activityId="explorer-distance-from-origin" onActivityComplete={() => {}} onExitLearn={() => {}} />);
    const generated = activateVariant('explorer-distance-from-origin');
    const scene = generated.steps[0].sceneData;
    expect(scene?.kind).toBe('distance-from-origin');
    if (!scene || scene.kind !== 'distance-from-origin') return;
    expect(container.querySelector(`[data-testid="point-${scene.point[0]}-${scene.point[1]}"]`)).toBeTruthy();
  });

  it('explorer-two-point-measures uses both generated endpoints', () => {
    const { container } = render(<ExplorerTab mafsHeight={300} mode="learn" activityId="explorer-two-point-measures" onActivityComplete={() => {}} onExitLearn={() => {}} />);
    const generated = activateVariant('explorer-two-point-measures');
    const scene = generated.steps[0].sceneData;
    expect(scene?.kind).toBe('two-point-measures');
    if (!scene || scene.kind !== 'two-point-measures') return;
    expect(container.querySelector(`[data-testid="point-${scene.p[0]}-${scene.p[1]}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-testid="point-${scene.q[0]}-${scene.q[1]}"]`)).toBeTruthy();
  });

  it('geometry-pythagoras labels the generated sides', () => {
    const { container } = render(<GeometryExtensionsLab activity={LAB_ACTIVITIES['geometry-pythagoras']} mafsHeight={300} mode="learn" onComplete={() => {}} onExit={() => {}} />);
    const generated = activateVariant('geometry-pythagoras');
    const scene = generated.steps[0].sceneData;
    expect(scene?.kind).toBe('pythagoras');
    if (!scene || scene.kind !== 'pythagoras') return;
    expect(latexValues(container)).toContain(`a = ${scene.a}`);
    expect(latexValues(container)).toContain(`b = ${scene.b}`);
  });

  it('geometry-circle-scaling uses generated radius and scale factor', () => {
    const { container } = render(<GeometryExtensionsLab activity={LAB_ACTIVITIES['geometry-circle-scaling']} mafsHeight={300} mode="learn" onComplete={() => {}} onExit={() => {}} />);
    const generated = activateVariant('geometry-circle-scaling');
    const firstScene = generated.steps[0].sceneData;
    expect(firstScene?.kind).toBe('circle-scaling');
    if (!firstScene || firstScene.kind !== 'circle-scaling') return;
    expect(container.querySelector('[data-testid="circle"]')?.getAttribute('data-radius')).toBe(String(firstScene.radius));

    advance(generated.steps[0]);
    advance(generated.steps[1]);
    expect(screen.getByText(generated.steps[2].prompt)).toBeTruthy();
    const scaleScene = generated.steps[2].sceneData;
    expect(scaleScene?.kind).toBe('circle-scaling');
    if (!scaleScene || scaleScene.kind !== 'circle-scaling') return;
    submit(generated.steps[2]);
    const radii = Array.from(container.querySelectorAll('[data-testid="circle"]')).map((node) => Number(node.getAttribute('data-radius')));
    expect(radii).toContain(scaleScene.radius);
    expect(radii).toContain(scaleScene.radius * scaleScene.scaleFactor);
    expect(latexValues(container)).toContain(`\\text{Area factor} = ${scaleScene.scaleFactor}^2 = ${scaleScene.scaleFactor ** 2}`);
  });

  it('geometry-sohcahtoa uses generated sides and ratio', () => {
    const { container } = render(<GeometryExtensionsLab activity={LAB_ACTIVITIES['geometry-sohcahtoa']} mafsHeight={300} mode="learn" onComplete={() => {}} onExit={() => {}} />);
    const generated = activateVariant('geometry-sohcahtoa');
    const scene = generated.steps[0].sceneData;
    expect(scene?.kind).toBe('sohcahtoa');
    if (!scene || scene.kind !== 'sohcahtoa') return;
    expect(latexValues(container)).toContain(`\\text{adj} = ${scene.adj}`);
    expect(latexValues(container)).toContain(`\\text{opp} = ${scene.opp}`);
    submit(generated.steps[0]);
    const expectedFormula = scene.ratio === 'sine'
      ? '\\sin\\theta = \\frac{\\text{opp}}{\\text{hyp}}'
      : scene.ratio === 'cosine'
        ? '\\cos\\theta = \\frac{\\text{adj}}{\\text{hyp}}'
        : '\\tan\\theta = \\frac{\\text{opp}}{\\text{adj}}';
    expect(latexValues(container)).toContain(expectedFormula);
  });

  it('linear-vector-resultant uses both generated vectors', () => {
    const { container } = render(<LinearAlgebraTab mafsHeight={300} mode="learn" activityId="linear-vector-resultant" onActivityComplete={() => {}} onExitLearn={() => {}} />);
    const generated = activateVariant('linear-vector-resultant');
    const scene = generated.steps[0].sceneData;
    expect(scene?.kind).toBe('vector-resultant');
    if (!scene || scene.kind !== 'vector-resultant') return;
    const tips = Array.from(container.querySelectorAll('[data-testid="vector"]')).map((node) => node.getAttribute('data-tip'));
    expect(tips).toContain(JSON.stringify(scene.vecA));
    expect(tips).toContain(JSON.stringify(scene.vecB));
  });

  it('linear-matrix-transform uses generated matrix and target point', () => {
    const { container } = render(<LinearAlgebraTab mafsHeight={300} mode="learn" activityId="linear-matrix-transform" onActivityComplete={() => {}} onExitLearn={() => {}} />);
    const generated = activateVariant('linear-matrix-transform');
    const scene = generated.steps[0].sceneData;
    expect(scene?.kind).toBe('matrix-transform');
    if (!scene || scene.kind !== 'matrix-transform') return;
    expect((screen.getByLabelText('Matrix entry a (row 1, column 1)') as HTMLInputElement).value).toBe(String(scene.matrix[0][0]));
    expect((screen.getByLabelText('Matrix entry d (row 2, column 2)') as HTMLInputElement).value).toBe(String(scene.matrix[1][1]));
    expect(container.querySelector(`[data-testid="point-${scene.point[0]}-${scene.point[1]}"]`)).toBeTruthy();
  });

  it('linear-complex-plane uses generated addends and result', () => {
    const { container } = render(<LinearAlgebraTab mafsHeight={300} mode="learn" activityId="linear-complex-plane" onActivityComplete={() => {}} onExitLearn={() => {}} />);
    const generated = activateVariant('linear-complex-plane');
    advance(generated.steps[0]);
    expect(screen.getByText(generated.steps[1].prompt)).toBeTruthy();
    const scene = generated.steps[1].sceneData;
    expect(scene?.kind).toBe('complex-plane');
    if (!scene || scene.kind !== 'complex-plane' || !scene.other || !scene.result) return;
    expect(container.querySelector(`[data-testid="point-${scene.re}-${scene.im}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-testid="point-${scene.other[0]}-${scene.other[1]}"]`)).toBeTruthy();
    submit(generated.steps[1]);
    expect(container.querySelector(`[data-testid="point-${scene.result[0]}-${scene.result[1]}"]`)).toBeTruthy();
  });

  it('calculus-numerical-methods uses generated k, x0 and trapezoid interval', () => {
    const { container } = render(<CalculusExtensionsLab activity={LAB_ACTIVITIES['calculus-numerical-methods']} mafsHeight={300} mode="learn" onComplete={() => {}} onExit={() => {}} />);
    const generated = activateVariant('calculus-numerical-methods');
    const newtonScene = generated.steps[0].sceneData;
    expect(newtonScene?.kind).toBe('numerical-newton');
    if (!newtonScene || newtonScene.kind !== 'numerical-newton') return;
    expect(container.querySelector('[data-testid="plot-ofx"]')?.getAttribute('data-y-at-zero')).toBe(String(-newtonScene.k));
    submit(generated.steps[0]);
    expect(Array.from(container.querySelectorAll('[data-testid="line-segment"]')).some((node) => node.getAttribute('data-point1') === JSON.stringify([newtonScene.x0, 0]))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    const trapScene = generated.steps[1].sceneData;
    expect(trapScene?.kind).toBe('numerical-trapezoid');
    if (!trapScene || trapScene.kind !== 'numerical-trapezoid') return;
    expect(screen.getByText(generated.steps[1].prompt)).toBeTruthy();
    const viewBox = JSON.parse(container.querySelector('[data-testid="mafs-root"]')?.getAttribute('data-viewbox') ?? '{}');
    expect(viewBox.x[0]).toBeLessThanOrEqual(trapScene.intervalStart);
    expect(viewBox.x[1]).toBeGreaterThanOrEqual(trapScene.intervalEnd);
    submit(generated.steps[1]);
    expect(Array.from(container.querySelectorAll('[data-testid="line-segment"]')).some((node) => node.getAttribute('data-point2') === JSON.stringify([trapScene.intervalEnd, trapScene.intervalEnd ** 2]))).toBe(true);
  });

  it('statistics-normal-zscore uses generated mu, sigma and x', () => {
    const { container } = render(<StatisticsTab mafsHeight={300} mode="learn" activityId="statistics-normal-zscore" onActivityComplete={() => {}} onExitLearn={() => {}} />);
    const generated = activateVariant('statistics-normal-zscore');
    const scene = generated.steps[0].sceneData;
    expect(scene?.kind).toBe('normal-zscore');
    if (!scene || scene.kind !== 'normal-zscore') return;
    expect(latexValues(container)).toContain(`\\mu=${scene.mu}`);
    expect(latexValues(container)).toContain(`x=${scene.x}`);
    expect(container.querySelector('[data-testid="coordinates-cartesian"]')?.getAttribute('data-x-lines')).toBe(String(scene.sigma));
  });
});
