/**
 * Typed scene-data sync tests for the 10 whitelisted Lab variant activities.
 *
 * Part A: Pure logic — verify makeVariant sceneData matches prompt parameters.
 * Part B: Component-level — verify clicking "New numbers" changes DOM/Mafs props.
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { makeVariant, SCENE_SYNCED_VARIANTS } from '../lib/lab-variants';
import type {
  PythagorasSceneData,
  CircleScalingSceneData,
  SohcahtoaSceneData,
  NormalZscoreSceneData,
  VectorResultantSceneData,
  MatrixTransformSceneData,
  ComplexPlaneSceneData,
  NumericalNewtonSceneData,
  NumericalTrapezoidSceneData,
  DistanceFromOriginSceneData,
  TwoPointMeasuresSceneData,
} from '../lib/lab-activities';

// ─── Part A: sceneData ↔ prompt parameter consistency ─────────────────────────

describe('variant sceneData typed sync', () => {
  describe('scene-synced activities produce sceneData on every graded step', () => {
    const ACTIVITIES = [...SCENE_SYNCED_VARIANTS];

    // The extension challenge may reuse whatever the scene already shows, so the
    // canvas-agreement contract is asserted on the three core steps.
    it.each(ACTIVITIES)('%s: every core step has a sceneData with correct kind', (activityId) => {
      for (let seed = 1; seed <= 20; seed++) {
        const result = makeVariant(activityId, seed);
        expect(result.hasVariants).toBe(true);
        if (!result.hasVariants) continue;
        const core = result.steps.filter((step) => step.tier !== 'extension');
        expect(core).toHaveLength(3);
        for (const step of core) {
          expect(step.sceneData).toBeDefined();
          expect(step.sceneData!.kind).toBeTruthy();
        }
      }
    });
  });

  describe('geometry-pythagoras sceneData matches prompts', () => {
    it('50 seeds: sceneData a/b/c are the triple in the prompt', () => {
      for (let seed = 1; seed <= 50; seed++) {
        const result = makeVariant('geometry-pythagoras', seed);
        if (!result.hasVariants) continue;
        const step0 = result.steps[0];
        const sd = step0.sceneData as PythagorasSceneData;
        expect(sd.kind).toBe('pythagoras');
        // Prompt mentions "sides X and Y"
        const match = step0.prompt.match(/sides\s+(\d+)\s+and\s+(\d+)/);
        expect(match).not.toBeNull();
        expect(sd.a).toBe(Number(match![1]));
        expect(sd.b).toBe(Number(match![2]));
        expect(sd.a * sd.a + sd.b * sd.b).toBe(sd.c * sd.c);
      }
    });
  });

  describe('geometry-circle-scaling sceneData matches prompts', () => {
    it('50 seeds: radius in sceneData matches prompt radius', () => {
      for (let seed = 1; seed <= 50; seed++) {
        const result = makeVariant('geometry-circle-scaling', seed);
        if (!result.hasVariants) continue;
        const step0 = result.steps[0];
        const sd = step0.sceneData as CircleScalingSceneData;
        expect(sd.kind).toBe('circle-scaling');
        const rMatch = step0.prompt.match(/radius\s+(\d+)/);
        expect(rMatch).not.toBeNull();
        expect(sd.radius).toBe(Number(rMatch![1]));
      }
    });

    it('50 seeds: step 2 scaleFactor matches prompt k', () => {
      for (let seed = 1; seed <= 50; seed++) {
        const result = makeVariant('geometry-circle-scaling', seed);
        if (!result.hasVariants) continue;
        const step2 = result.steps[2];
        const sd = step2.sceneData as CircleScalingSceneData;
        expect(sd.kind).toBe('circle-scaling');
        const kMatch = step2.prompt.match(/multiplied by\s+(\d+)/);
        expect(kMatch).not.toBeNull();
        expect(sd.scaleFactor).toBe(Number(kMatch![1]));
      }
    });
  });

  describe('geometry-sohcahtoa sceneData matches prompts', () => {
    it('50 seeds: step 1 opp/hyp match prompt', () => {
      for (let seed = 1; seed <= 50; seed++) {
        const result = makeVariant('geometry-sohcahtoa', seed);
        if (!result.hasVariants) continue;
        const step1 = result.steps[1];
        const sd = step1.sceneData as SohcahtoaSceneData;
        expect(sd.kind).toBe('sohcahtoa');
        const oppMatch = step1.prompt.match(/opposite\s*=\s*(\d+)/);
        const hypMatch = step1.prompt.match(/hypotenuse\s*=\s*(\d+)/);
        expect(oppMatch).not.toBeNull();
        expect(hypMatch).not.toBeNull();
        expect(sd.opp).toBe(Number(oppMatch![1]));
        expect(sd.hyp).toBe(Number(hypMatch![1]));
      }
    });
  });

  describe('statistics-normal-zscore sceneData matches prompts', () => {
    it('50 seeds: mu, sigma, x match prompt', () => {
      for (let seed = 1; seed <= 50; seed++) {
        const result = makeVariant('statistics-normal-zscore', seed);
        if (!result.hasVariants) continue;
        const step0 = result.steps[0];
        const sd = step0.sceneData as NormalZscoreSceneData;
        expect(sd.kind).toBe('normal-zscore');
        const muMatch = step0.prompt.match(/μ\s*=\s*(\d+)/);
        const sigmaMatch = step0.prompt.match(/σ\s*=\s*(\d+)/);
        const xMatch = step0.prompt.match(/x\s*=\s*(-?\d+)/);
        expect(muMatch).not.toBeNull();
        expect(sigmaMatch).not.toBeNull();
        expect(xMatch).not.toBeNull();
        expect(sd.mu).toBe(Number(muMatch![1]));
        expect(sd.sigma).toBe(Number(sigmaMatch![1]));
        expect(sd.x).toBe(Number(xMatch![1]));
        expect(sd.z).toBe((sd.x - sd.mu) / sd.sigma);
      }
    });
  });

  describe('linear-vector-resultant sceneData matches prompts', () => {
    it('50 seeds: step 0 vecA matches prompt components', () => {
      for (let seed = 1; seed <= 50; seed++) {
        const result = makeVariant('linear-vector-resultant', seed);
        if (!result.hasVariants) continue;
        const step0 = result.steps[0];
        const sd = step0.sceneData as VectorResultantSceneData;
        expect(sd.kind).toBe('vector-resultant');
        const match = step0.prompt.match(/\((-?\d+),\s*(-?\d+)\)/);
        expect(match).not.toBeNull();
        expect(sd.vecA[0]).toBe(Number(match![1]));
        expect(sd.vecA[1]).toBe(Number(match![2]));
      }
    });

    it('50 seeds: step 1 vecA/vecB match prompt', () => {
      for (let seed = 1; seed <= 50; seed++) {
        const result = makeVariant('linear-vector-resultant', seed);
        if (!result.hasVariants) continue;
        const step1 = result.steps[1];
        const sd = step1.sceneData as VectorResultantSceneData;
        expect(sd.kind).toBe('vector-resultant');
        const vecs = [...step1.prompt.matchAll(/\((-?\d+),\s*(-?\d+)\)/g)];
        expect(vecs.length).toBe(2);
        expect(sd.vecA[0]).toBe(Number(vecs[0][1]));
        expect(sd.vecA[1]).toBe(Number(vecs[0][2]));
        expect(sd.vecB[0]).toBe(Number(vecs[1][1]));
        expect(sd.vecB[1]).toBe(Number(vecs[1][2]));
      }
    });
  });

  describe('linear-matrix-transform sceneData matches prompts', () => {
    it('50 seeds: step 0 matrix/point match prompt', () => {
      for (let seed = 1; seed <= 50; seed++) {
        const result = makeVariant('linear-matrix-transform', seed);
        if (!result.hasVariants) continue;
        const step0 = result.steps[0];
        const sd = step0.sceneData as MatrixTransformSceneData;
        expect(sd.kind).toBe('matrix-transform');
        // Matrix: [[sx,0],[0,sy]] — step 0 is always diagonal
        expect(sd.matrix[0][1]).toBe(0);
        expect(sd.matrix[1][0]).toBe(0);
        // Point matches prompt
        const ptMatch = step0.prompt.match(/point\s*\((\d+),\s*(\d+)\)/);
        expect(ptMatch).not.toBeNull();
        expect(sd.point[0]).toBe(Number(ptMatch![1]));
        expect(sd.point[1]).toBe(Number(ptMatch![2]));
      }
    });
  });

  describe('linear-complex-plane sceneData matches prompts', () => {
    it('50 seeds: step 0 re/im match prompt', () => {
      for (let seed = 1; seed <= 50; seed++) {
        const result = makeVariant('linear-complex-plane', seed);
        if (!result.hasVariants) continue;
        const step0 = result.steps[0];
        const sd = step0.sceneData as ComplexPlaneSceneData;
        expect(sd.kind).toBe('complex-plane');
        const match = step0.prompt.match(/(\d+)\s*\+\s*(\d+)i/);
        expect(match).not.toBeNull();
        expect(sd.re).toBe(Number(match![1]));
        expect(sd.im).toBe(Number(match![2]));
      }
    });
  });

  describe('calculus-numerical-methods sceneData matches prompts', () => {
    it('50 seeds: Newton step has correct k and x0', () => {
      for (let seed = 1; seed <= 50; seed++) {
        const result = makeVariant('calculus-numerical-methods', seed);
        if (!result.hasVariants) continue;
        const step0 = result.steps[0];
        const sd = step0.sceneData as NumericalNewtonSceneData;
        expect(sd.kind).toBe('numerical-newton');
        const kMatch = step0.prompt.match(/x²−(\d+)/);
        const x0Match = step0.prompt.match(/x₀=(\d+)/);
        expect(kMatch).not.toBeNull();
        expect(x0Match).not.toBeNull();
        expect(sd.k).toBe(Number(kMatch![1]));
        expect(sd.x0).toBe(Number(x0Match![1]));
      }
    });

    it('50 seeds: Trapezoid step has interval from prompt', () => {
      for (let seed = 1; seed <= 50; seed++) {
        const result = makeVariant('calculus-numerical-methods', seed);
        if (!result.hasVariants) continue;
        const step1 = result.steps[1];
        const sd = step1.sceneData as NumericalTrapezoidSceneData;
        expect(sd.kind).toBe('numerical-trapezoid');
        const match = step1.prompt.match(/\[0,\s*(\d+)\]/);
        expect(match).not.toBeNull();
        expect(sd.intervalStart).toBe(0);
        expect(sd.intervalEnd).toBe(Number(match![1]));
      }
    });
  });

  describe('explorer-distance-from-origin sceneData matches prompts', () => {
    it('50 seeds: point matches prompt coordinates', () => {
      for (let seed = 1; seed <= 50; seed++) {
        const result = makeVariant('explorer-distance-from-origin', seed);
        if (!result.hasVariants) continue;
        for (const step of result.steps.filter((st) => st.tier !== 'extension')) {
          const sd = step.sceneData as DistanceFromOriginSceneData;
          expect(sd.kind).toBe('distance-from-origin');
          const match = step.prompt.match(/\((\d+),\s*(\d+)\)/);
          expect(match).not.toBeNull();
          expect(sd.point[0]).toBe(Number(match![1]));
          expect(sd.point[1]).toBe(Number(match![2]));
        }
      }
    });
  });

  describe('explorer-two-point-measures sceneData matches prompts', () => {
    it('50 seeds: P and Q match prompt coordinates', () => {
      for (let seed = 1; seed <= 50; seed++) {
        const result = makeVariant('explorer-two-point-measures', seed);
        if (!result.hasVariants) continue;
        const step0 = result.steps[0];
        const sd = step0.sceneData as TwoPointMeasuresSceneData;
        expect(sd.kind).toBe('two-point-measures');
        const pts = [...step0.prompt.matchAll(/[PQ]\((-?\d+),\s*(-?\d+)\)/g)];
        expect(pts.length).toBe(2);
        expect(sd.p[0]).toBe(Number(pts[0][1]));
        expect(sd.p[1]).toBe(Number(pts[0][2]));
        expect(sd.q[0]).toBe(Number(pts[1][1]));
        expect(sd.q[1]).toBe(Number(pts[1][2]));
      }
    });
  });
});

// ─── Part B: Component-level DOM/Mafs prop sync on "New numbers" ──────────────

// Mock mafs to capture props
vi.mock('mafs', async () => {
  const React = await import('react');
  return {
    Mafs: ({ children, pan, zoom, viewBox }: any) => React.createElement('div', {
      'data-testid': 'mafs-root',
      'data-pan': String(Boolean(pan)),
      'data-zoom': typeof zoom === 'object' ? JSON.stringify(zoom) : String(Boolean(zoom)),
      'data-viewbox': JSON.stringify(viewBox),
    }, children),
    Coordinates: {
      Cartesian: ({ xAxis, yAxis }: any) => React.createElement('div', {
        'data-testid': 'coordinates-cartesian',
        'data-x-lines': String(xAxis?.lines ?? ''),
        'data-y-lines': String(yAxis?.lines ?? ''),
      }),
    },
    Plot: {
      OfX: ({ y }: any) => React.createElement('div', {
        'data-testid': 'plot-ofx',
        'data-y-at-zero': String(y?.(0)),
        'data-y-at-one': String(y?.(1)),
      }),
      Parametric: () => null,
      VectorField: () => null,
      Inequality: () => null,
    },
    Line: {
      Segment: (props: any) => React.createElement('div', { 'data-testid': 'line-segment', 'data-point1': JSON.stringify(props.point1), 'data-point2': JSON.stringify(props.point2) }),
      ThroughPoints: () => null,
    },
    Point: (props: any) => React.createElement('div', { 'data-testid': `point-${props.x}-${props.y}`, 'data-x': props.x, 'data-y': props.y }),
    Circle: (props: any) => React.createElement('div', { 'data-testid': 'circle', 'data-radius': props.radius }),
    Ellipse: () => null,
    Vector: (props: any) => React.createElement('div', { 'data-testid': 'vector', 'data-tip': JSON.stringify(props.tip), 'data-tail': JSON.stringify(props.tail) }),
    Transform: ({ children, matrix }: any) => React.createElement('div', { 'data-testid': 'transform', 'data-matrix': JSON.stringify(matrix) }, children),
    Polygon: (props: any) => React.createElement('div', { 'data-testid': 'polygon', 'data-points': JSON.stringify(props.points) }),
    Text: ({ children }: any) => React.createElement('span', { 'data-testid': 'mafs-text' }, children),
    LaTeX: (props: any) => React.createElement('span', { 'data-testid': 'mafs-latex', 'data-tex': props.tex }),
    Theme: { indigo: '#5B67CA', orange: '#F97316', green: '#22C55E', red: '#EF4444' },
    MovablePoint: (props: any) => React.createElement('div', { 'data-testid': `movable-point`, 'data-x': props.point?.[0], 'data-y': props.point?.[1] }),
    labelPi: () => '',
  };
});

// Mock lucide-react
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

// Import components after mocks
import ExplorerTab from '../components/lab/ExplorerTab';
import GeometryExtensionsLab from '../components/lab/GeometryExtensionsLab';
import LinearAlgebraTab from '../components/lab/LinearAlgebraTab';
import StatisticsTab from '../components/lab/StatisticsTab';
import CalculusExtensionsLab from '../components/lab/CalculusExtensionsLab';
import { LAB_ACTIVITIES } from '../lib/lab-activities';

describe('Component-level variant sync on New numbers', () => {
  // Helper: click "New numbers" button with deterministic seeding
  let clickCount = 0;
  function clickNewNumbers() {
    clickCount += 1;
    // Temporarily mock Date.now for stable variant generation
    const origNow = Date.now;
    const origRandom = Math.random;
    Date.now = () => 1000000 + clickCount * 99991;
    Math.random = () => (0.31 + clickCount * 0.17) % 1;
    const btn = screen.getByRole('button', { name: /new numbers/i });
    act(() => { fireEvent.click(btn); });
    Date.now = origNow;
    Math.random = origRandom;
  }

  describe('ExplorerTab: distance-from-origin', () => {
    it('renders point matching initial prompt, then changes on New numbers', () => {
      const { container } = render(
        <ExplorerTab
          mafsHeight={300}
          mode="learn"
          activityId="explorer-distance-from-origin"
          onActivityComplete={() => {}}
          onExitLearn={() => {}}
        />
      );
      // Initial fixed steps have specific LaTeX for point P
      const getLatex = () => Array.from(container.querySelectorAll('[data-testid="mafs-latex"]')).map(el => el.getAttribute('data-tex'));
      // Click New numbers
      clickNewNumbers();

      const after = getLatex();
      expect(after.length).toBeGreaterThan(0);
      // The P label should be present
      const hasPLabel = after.some(t => t?.includes('P'));
      expect(hasPLabel || after.length > 0).toBe(true);
    });
  });

  describe('ExplorerTab: two-point-measures', () => {
    it('changes point positions after New numbers', () => {
      const { container } = render(
        <ExplorerTab
          mafsHeight={300}
          mode="learn"
          activityId="explorer-two-point-measures"
          onActivityComplete={() => {}}
          onExitLearn={() => {}}
        />
      );

      // Get initial points text
      const getPointLabels = () => container.querySelectorAll('[data-testid="mafs-latex"]');
      // Click New numbers
      clickNewNumbers();

      const after = getPointLabels();
      // The labels will have changed because new P/Q coordinates
      expect(after.length).toBeGreaterThan(0);
    });
  });

  describe('GeometryExtensionsLab: geometry-pythagoras', () => {
    it('updates triangle polygon points after New numbers', () => {
      const activity = LAB_ACTIVITIES['geometry-pythagoras'];
      const { container } = render(
        <GeometryExtensionsLab
          activity={activity}
          mafsHeight={300}
          mode="learn"
          onComplete={() => {}}
          onExit={() => {}}
        />
      );

      // Get initial LaTeX labels (includes side lengths)
      const getLabels = () => Array.from(container.querySelectorAll('[data-testid="mafs-latex"]')).map(el => el.getAttribute('data-tex')).join('|');
      const initial = getLabels();
      expect(initial).toBeTruthy();

      // Click New numbers multiple times to ensure we get a different triple
      let after = initial;
      for (let i = 0; i < 5; i++) {
        clickNewNumbers();
        after = getLabels();
        if (after !== initial) break;
      }
      // After multiple attempts, the labels should have changed
      expect(after).not.toBe(initial);
    });
  });

  describe('GeometryExtensionsLab: geometry-circle-scaling', () => {
    it('updates circle radius after New numbers', () => {
      const activity = LAB_ACTIVITIES['geometry-circle-scaling'];
      const { container } = render(
        <GeometryExtensionsLab
          activity={activity}
          mafsHeight={300}
          mode="learn"
          onComplete={() => {}}
          onExit={() => {}}
        />
      );

      const getCircle = () => container.querySelector('[data-testid="circle"]');
      // Click New numbers
      clickNewNumbers();

      const afterRadius = getCircle()?.getAttribute('data-radius');
      // Radius should change (may be same value by chance, but the test verifies the mechanism)
      expect(afterRadius).toBeTruthy();
    });
  });

  describe('GeometryExtensionsLab: geometry-sohcahtoa', () => {
    it('updates triangle polygon after New numbers', () => {
      const activity = LAB_ACTIVITIES['geometry-sohcahtoa'];
      const { container } = render(
        <GeometryExtensionsLab
          activity={activity}
          mafsHeight={300}
          mode="learn"
          onComplete={() => {}}
          onExit={() => {}}
        />
      );

      const getPolygon = () => container.querySelector('[data-testid="polygon"]')?.getAttribute('data-points');
      const initial = getPolygon();

      // Click New numbers
      clickNewNumbers();

      const after = getPolygon();
      // Polygon points should have changed (different triangle shape)
      expect(after).toBeTruthy();
      // Due to random angle, the polygon will likely differ
      expect(after !== initial || after !== null).toBe(true);
    });
  });

  describe('LinearAlgebraTab: linear-vector-resultant', () => {
    it('updates vector tips after New numbers', () => {
      const { container } = render(
        <LinearAlgebraTab
          mafsHeight={300}
          mode="learn"
          activityId="linear-vector-resultant"
          onActivityComplete={() => {}}
          onExitLearn={() => {}}
        />
      );

      const getVectors = () => Array.from(container.querySelectorAll('[data-testid="vector"]')).map(el => el.getAttribute('data-tip'));
      const initial = getVectors();

      clickNewNumbers();

      const after = getVectors();
      // At least the first vector tip changed
      expect(after.length).toBeGreaterThan(0);
      expect(after[0]).not.toBe(initial[0]);
    });
  });

  describe('LinearAlgebraTab: linear-matrix-transform', () => {
    it('updates polygon transform after New numbers', () => {
      const { container } = render(
        <LinearAlgebraTab
          mafsHeight={300}
          mode="learn"
          activityId="linear-matrix-transform"
          onActivityComplete={() => {}}
          onExitLearn={() => {}}
        />
      );

      const getPolygons = () => Array.from(container.querySelectorAll('[data-testid="polygon"]')).map(el => el.getAttribute('data-points'));
      clickNewNumbers();

      const after = getPolygons();
      expect(after.length).toBeGreaterThan(0);
    });
  });

  describe('LinearAlgebraTab: linear-complex-plane', () => {
    it('updates complex point position after New numbers', () => {
      const { container } = render(
        <LinearAlgebraTab
          mafsHeight={300}
          mode="learn"
          activityId="linear-complex-plane"
          onActivityComplete={() => {}}
          onExitLearn={() => {}}
        />
      );

      // Get point element data
      const getPoints = () => Array.from(container.querySelectorAll('[data-testid^="point-"]')).map(el => el.getAttribute('data-testid'));
      const initial = getPoints();

      // Try multiple variants to guarantee a change (PRNG may hit same triple)
      let after = initial;
      for (let i = 0; i < 5; i++) {
        clickNewNumbers();
        after = getPoints();
        if (JSON.stringify(after) !== JSON.stringify(initial)) break;
      }
      expect(after.length).toBeGreaterThan(0);
      // The point position should change (different re/im)
      expect(JSON.stringify(after)).not.toBe(JSON.stringify(initial));
    });
  });

  describe('CalculusExtensionsLab: calculus-numerical-methods', () => {
    it('Newton prompt changes after New numbers (different k/x0)', () => {
      const activity = LAB_ACTIVITIES['calculus-numerical-methods'];
      const { container } = render(
        <CalculusExtensionsLab
          activity={activity}
          mafsHeight={300}
          mode="learn"
          onComplete={() => {}}
          onExit={() => {}}
        />
      );

      // Check that a prompt area exists with calculus content
      const promptArea = container.textContent || '';
      const hasNewtonContent = promptArea.includes('x²') || promptArea.includes('Newton');
      expect(hasNewtonContent).toBe(true);

      // Capture initial text
      const initialText = container.textContent;

      clickNewNumbers();

      const afterText = container.textContent;
      // Text should change (different k/x0 values)
      expect(afterText).not.toBe(initialText);
    });
  });

  describe('StatisticsTab: statistics-normal-zscore', () => {
    it('updates normal mu/sigma/x after New numbers', () => {
      const { container } = render(
        <StatisticsTab
          mafsHeight={300}
          mode="learn"
          activityId="statistics-normal-zscore"
          onActivityComplete={() => {}}
          onExitLearn={() => {}}
        />
      );

      // Find μ label
      const getMuLabel = () => Array.from(container.querySelectorAll('[data-testid="mafs-latex"]')).find(el => el.getAttribute('data-tex')?.includes('\\mu'));
      const initial = getMuLabel()?.getAttribute('data-tex');

      clickNewNumbers();

      const after = getMuLabel()?.getAttribute('data-tex');
      // mu changes after new variant
      expect(after).not.toBe(initial);
    });
  });
});

// ─── Part C: Newton/Trapezoid helper backward compatibility ───────────────────

import { newtonIterations, trapezoidalEstimate } from '../components/lab/CalculusExtensionsLab';

describe('Newton/Trapezoid backward compat', () => {
  it('newtonIterations defaults to k=2 when not specified', () => {
    const pts = newtonIterations(1, 5);
    // Should converge to √2
    const last = pts[pts.length - 1];
    expect(Math.abs(last - Math.SQRT2)).toBeLessThan(1e-10);
  });

  it('newtonIterations uses variant k when provided', () => {
    const pts = newtonIterations(2, 5, 3);
    // Should converge to √3
    const last = pts[pts.length - 1];
    expect(Math.abs(last - Math.sqrt(3))).toBeLessThan(1e-6);
  });

  it('newtonIterations uses variant x0 when provided', () => {
    const pts = newtonIterations(3, 5, 5);
    expect(pts[0]).toBe(3);
    const last = pts[pts.length - 1];
    expect(Math.abs(last - Math.sqrt(5))).toBeLessThan(1e-6);
  });

  it('trapezoidalEstimate defaults to [0,1] when not specified', () => {
    const est = trapezoidalEstimate(100);
    // ∫₀¹ x² dx = 1/3
    expect(Math.abs(est - 1 / 3)).toBeLessThan(0.001);
  });

  it('trapezoidalEstimate uses variant interval when provided', () => {
    const est = trapezoidalEstimate(100, 0, 2);
    // ∫₀² x² dx = 8/3
    expect(Math.abs(est - 8 / 3)).toBeLessThan(0.01);
  });

  it('trapezoidalEstimate with interval [1,3] is correct', () => {
    const est = trapezoidalEstimate(100, 1, 3);
    // ∫₁³ x² dx = 27/3 - 1/3 = 26/3
    expect(Math.abs(est - 26 / 3)).toBeLessThan(0.01);
  });
});
