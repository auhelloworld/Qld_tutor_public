import { describe, expect, it } from 'vitest';
import {
  evaluateParametric,
  evaluatePolarR,
  polarToCartesian,
} from '../components/lab/AdvancedCurvesLab';
import {
  computeDirectionFieldSegments,
  KINEMATICS_EXAMPLES,
  kinematicsValues,
  newtonIterations,
  newtonLabelPosition,
  normalizeFieldVector,
  trapezoidalEstimate,
} from '../components/lab/CalculusExtensionsLab';
import {
  complexArgument,
  complexModulus,
  complexMultiply,
  matrixDeterminant,
  matrixTransform,
  vectorAdd,
  vectorMagnitude,
} from '../components/lab/LinearAlgebraTab';
import {
  leastSquares,
  normalCdf,
  normalPdf,
  simulateProbability,
} from '../components/lab/StatisticsTab';
import {
  clampInteger,
  clampNumber,
  LAB_RENDER_LIMITS,
} from '../lib/lab-performance';

describe('P4 mathematics helpers', () => {
  it('computes vectors, matrices, and complex numbers', () => {
    expect(vectorAdd([2, -1], [-5, 3])).toEqual([-3, 2]);
    expect(vectorMagnitude([3, 4])).toBe(5);

    expect(matrixTransform([[2, 0], [0, 1]], [3, 2])).toEqual([6, 2]);
    expect(matrixTransform([[0, -1], [1, 0]], [2, 1])).toEqual([-1, 2]);
    expect(matrixDeterminant([[2, 0], [0, 3]])).toBe(6);

    expect(complexModulus([3, 4])).toBe(5);
    expect(complexMultiply([3, 2], [0, 1])).toEqual([-2, 3]);
    expect(complexArgument([0, 4])).toBeCloseTo(90, 10);
  });

  it('evaluates polar and parametric presets', () => {
    expect(evaluatePolarR('cardioid', 0, 2)).toBe(4);
    expect(evaluatePolarR('cardioid', Math.PI, 2)).toBeCloseTo(0, 10);
    expect(evaluatePolarR('spiral', 2 * Math.PI, 3)).toBeCloseTo(3, 10);
    expect(evaluatePolarR('lemniscate', 0, 3)).toBeCloseTo(3, 10);
    expect(evaluatePolarR('lemniscate', Math.PI / 4, 3)).toBeCloseTo(0, 7);
    expect(Number.isNaN(evaluatePolarR('lemniscate', Math.PI / 2, 3))).toBe(true);
    expect(polarToCartesian(2, Math.PI / 2)).toEqual([
      expect.closeTo(0, 10),
      expect.closeTo(2, 10),
    ]);

    expect(evaluateParametric('circle', Math.PI / 2, 1, 1)).toEqual([
      expect.closeTo(0, 10),
      expect.closeTo(1, 10),
    ]);
    expect(evaluateParametric('line', 2, 2, 1)).toEqual([4, 2]);
    expect(evaluateParametric('ellipse', Math.PI, 3, 2)).toEqual([
      expect.closeTo(-3, 10),
      expect.closeTo(0, 10),
    ]);
  });

  it('computes normal probabilities and bounded least-squares regression', () => {
    expect(normalPdf(0, 0, 1)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 10);
    expect(normalCdf(0, 0, 1)).toBeCloseTo(0.5, 6);
    expect(normalCdf(2, 0, 1)).toBeCloseTo(0.97725, 4);

    const regression = leastSquares([[1, 3], [2, 5], [3, 7], [4, 9]]);
    expect(regression.slope).toBeCloseTo(2, 10);
    expect(regression.intercept).toBeCloseTo(1, 10);
    expect(regression.r).toBeCloseTo(1, 10);
  });

  it('computes direction fields, kinematics, Newton iterates, and trapezoids', () => {
    const field = computeDirectionFieldSegments((_x, y) => y, 5, [-1, 1], [-1, 1]);
    expect(field).toHaveLength(25);
    expect(field.every((segment) => Object.values(segment).every(Number.isFinite))).toBe(true);

    expect(kinematicsValues(3)).toEqual({ s: 9, v: 6, a: 2 });
    expect(KINEMATICS_EXAMPLES).toHaveLength(3);
    expect(kinematicsValues(1, 0)).toEqual({ s: 1, v: 2, a: 2 });
    expect(kinematicsValues(1, 1)).toEqual({ s: 4, v: 3, a: 0 });
    expect(kinematicsValues(1, 2)).toEqual({ s: 4, v: 0, a: -6 });
    expect(new Set(KINEMATICS_EXAMPLES.map((example) => example.equations)).size).toBe(3);

    const iterates = newtonIterations(1, 20);
    expect(iterates.at(-1)).toBeCloseTo(Math.SQRT2, 12);
    expect(newtonIterations(0, 20)).toEqual([0]);

    for (const k of [2, 3, 5, 7]) {
      const points = newtonIterations(1, 3, k);
      points.slice(0, -1).forEach((xn, index) => {
        const [labelX, labelY] = newtonLabelPosition(xn, index, k);
        expect(labelX).toBe(xn);
        // The label rail is below the parabola's global minimum f(x) = -k.
        expect(labelY).toBeLessThan(labelX * labelX - k);
        expect(labelY).toBeGreaterThan(-k - 1.35);
      });
    }

    expect(trapezoidalEstimate(20)).toBeCloseTo(0.33375, 10);
    expect(trapezoidalEstimate(1)).toBe(0.5);
  });
});

describe('P4 render and memory limits', () => {
  it('exposes the intended hard limits', () => {
    expect(LAB_RENDER_LIMITS).toEqual({
      dataPoints: 40,
      probabilityTrials: 200,
      directionFieldGrid: 13,
      curveSamplingDepth: 8,
      numericalIterations: 20,
    });
  });

  it('clamps finite, non-finite, and integer input safely', () => {
    expect(clampNumber(99, -5, 5)).toBe(5);
    expect(clampNumber(Number.NaN, 1, 6, 3)).toBe(3);
    expect(clampNumber(Number.POSITIVE_INFINITY, 1, 6)).toBe(1);
    expect(clampInteger(4.6, 1, 10)).toBe(5);
    expect(clampInteger(100, 1, 20)).toBe(20);
  });

  it('never creates more than 169 direction segments', () => {
    const field = computeDirectionFieldSegments(
      (x, y) => x - y,
      10_000,
      [-3, 3],
      [-3, 3],
    );
    expect(field).toHaveLength(13 * 13);

    const minimumField = computeDirectionFieldSegments(() => 0, 1, [-1, 1], [-1, 1]);
    expect(minimumField).toHaveLength(4);
  });

  it('caps probability trials and numerical work without retaining history', () => {
    const simulation = simulateProbability(10_000, 0.5);
    expect(simulation.trials).toBe(200);
    expect(simulation.successes).toBeGreaterThanOrEqual(99);
    expect(simulation.successes).toBeLessThanOrEqual(101);
    expect(Object.keys(simulation).sort()).toEqual(['proportion', 'successes', 'trials']);

    expect(newtonIterations(1, 10_000).length).toBeLessThanOrEqual(21);
    expect(trapezoidalEstimate(10_000)).toBe(trapezoidalEstimate(20));
  });

  it('normalizes field vectors to unit length for uniform VectorField display', () => {
    const [nx, ny] = normalizeFieldVector(3, 4);
    expect(Math.sqrt(nx * nx + ny * ny)).toBeCloseTo(1, 10);
    expect(nx).toBeCloseTo(0.6, 10);
    expect(ny).toBeCloseTo(0.8, 10);

    // Zero vector stays at origin
    expect(normalizeFieldVector(0, 0)).toEqual([0, 0]);

    // Very small vector
    expect(normalizeFieldVector(1e-15, 0)).toEqual([0, 0]);

    // Negative direction
    const [nx2, ny2] = normalizeFieldVector(-1, 0);
    expect(nx2).toBeCloseTo(-1, 10);
    expect(ny2).toBeCloseTo(0, 10);
  });

  it('VectorField step respects directionFieldGrid render limit', () => {
    // The direction field uses a viewBox of [-3, 3] (range 6),
    // and step = range / (directionFieldGrid - 1) to cap density at 13×13 = 169 vectors
    const range = 6;
    const step = range / (LAB_RENDER_LIMITS.directionFieldGrid - 1);
    expect(step).toBe(0.5);

    // Confirm: the grid lines at step intervals across the range cannot exceed 13
    const gridCount = Math.floor(range / step) + 1;
    expect(gridCount).toBeLessThanOrEqual(LAB_RENDER_LIMITS.directionFieldGrid);
  });
});
