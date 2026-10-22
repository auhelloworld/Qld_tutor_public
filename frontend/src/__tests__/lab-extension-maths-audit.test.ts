/**
 * Independent mathematical audit of every generated extension challenge.
 *
 * Each check re-derives the expected answer from the numbers that appear in the
 * generated prompt, using a formula written here rather than reusing the
 * generator's own arithmetic. A generator bug therefore fails this file instead
 * of silently shipping a wrong answer to a student.
 */
import { describe, expect, it } from 'vitest';
import { ALL_ACTIVITY_IDS, type LearnStep } from '../lib/lab-activities';
import { makeVariant } from '../lib/lab-variants';

const SEEDS = 80;

function extensionsFor(activityId: string): LearnStep[] {
  const steps: LearnStep[] = [];
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const result = makeVariant(activityId, seed);
    if (!result.hasVariants) continue;
    const extension = result.steps.find((step) => step.tier === 'extension');
    if (extension) steps.push(extension);
  }
  expect(steps.length, `${activityId} produced no extension steps`).toBeGreaterThan(0);
  return steps;
}

/** All numbers in a string, in order, including negatives and decimals. */
function numbers(text: string): number[] {
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

function numericAnswer(step: LearnStep): number {
  let decimal = Number.NaN;
  for (const answer of step.acceptedAnswers) {
    // Degree-marked alternatives are a different unit, not the canonical value.
    if (answer.includes('°') || /degrees/.test(answer)) continue;
    const cleaned = answer.replace(/[()%]/g, '').replace(/\s*km\/h\s*/g, '').trim();
    // An exact fraction is preferred over its rounded decimal alternative.
    if (/^-?\d+(\.\d+)?\/\d+$/.test(cleaned)) {
      const [n, d] = cleaned.split('/').map(Number);
      return n / d;
    }
    const value = Number(cleaned);
    if (Number.isFinite(value) && Number.isNaN(decimal)) decimal = value;
  }
  return decimal;
}

/** Assert that a numeric answer matches an independently computed value. */
function expectAnswer(step: LearnStep, expected: number, tolerance = 1e-6) {
  expect(numericAnswer(step), `${step.prompt} → ${step.acceptedAnswers.join(' | ')}`).toBeCloseTo(
    expected,
    -Math.log10(tolerance),
  );
}

describe('generated extension challenges are mathematically correct', () => {
  it('explorer-quadrant-predict maps the sign conditions to the right quadrant', () => {
    for (const step of extensionsFor('explorer-quadrant-predict')) {
      const productNegative = /ab < 0/.test(step.prompt);
      const bLarger = /b > a/.test(step.prompt);
      const sumPositive = /a \+ b > 0/.test(step.prompt);
      const expected = productNegative ? (bLarger ? 'II' : 'IV') : sumPositive ? 'I' : 'III';
      expect(step.acceptedAnswers[0], step.prompt).toBe(expected);
    }
  });

  it('explorer-distance-from-origin counts lattice points and inverts the distance formula', () => {
    for (const step of extensionsFor('explorer-distance-from-origin')) {
      if (/how many points/.test(step.prompt)) {
        const r = numbers(step.prompt)[0];
        let count = 0;
        for (let x = -r; x <= r; x += 1) {
          const sq = r * r - x * x;
          const y = Math.round(Math.sqrt(sq));
          if (y * y === sq) count += y === 0 ? 1 : 2;
        }
        expectAnswer(step, count);
      } else {
        const [distance, xCoordinate] = numbers(step.prompt);
        expectAnswer(step, Math.sqrt(distance * distance - xCoordinate * xCoordinate), 1e-6);
      }
    }
  });

  it('explorer-two-point-measures keeps R collinear with the generated P and Q', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const result = makeVariant('explorer-two-point-measures', seed);
      if (!result.hasVariants) continue;
      const scene = result.steps[0].sceneData;
      const extension = result.steps[3];
      expect(scene?.kind).toBe('two-point-measures');
      if (!scene || scene.kind !== 'two-point-measures') continue;
      const gradient = (scene.q[1] - scene.p[1]) / (scene.q[0] - scene.p[0]);
      const yR = numbers(extension.prompt)[0];
      const kExpected = scene.q[0] + (yR - scene.q[1]) / gradient;
      expectAnswer(extension, kExpected);
    }
  });

  it('sandbox-gradient-effect recovers the gradient or intercept of the stated line', () => {
    for (const step of extensionsFor('sandbox-gradient-effect')) {
      const [x1, y1, x2, y2] = numbers(step.prompt);
      const m = (y2 - y1) / (x2 - x1);
      const c = y1 - m * x1;
      expectAnswer(step, /what is c/.test(step.prompt) ? c : m);
    }
  });

  it('sandbox-vertex-predict uses the discriminant and the vertex value correctly', () => {
    for (const step of extensionsFor('sandbox-vertex-predict')) {
      const quadratic = step.prompt.match(/y = x² ([+-]) (\d+)x(?: ([+-]) (\d+))?/);
      expect(quadratic, step.prompt).not.toBeNull();
      const b = (quadratic![1] === '-' ? -1 : 1) * Number(quadratic![2]);
      if (/touch the x-axis exactly once/.test(step.prompt)) {
        expectAnswer(step, (b * b) / 4);
      } else {
        const c = quadratic![4] ? (quadratic![3] === '-' ? -1 : 1) * Number(quadratic![4]) : 0;
        expectAnswer(step, c - (b * b) / 4);
      }
    }
  });

  it('sandbox-intercept-find finds the correct discriminant threshold', () => {
    for (const step of extensionsFor('sandbox-intercept-find')) {
      const body = step.prompt.slice(step.prompt.indexOf('x²'));
      const bMatch = body.match(/([+-]) (\d+)x/);
      const cMatch = body.match(/x ([+-]) (\d+)/);
      expect(bMatch, step.prompt).not.toBeNull();
      expect(cMatch, step.prompt).not.toBeNull();
      const b = (bMatch![1] === '-' ? -1 : 1) * Number(bMatch![2]);
      const c = (cMatch![1] === '-' ? -1 : 1) * Number(cMatch![2]);
      const discriminant = b * b - 4 * c;
      const expected = /exactly one x-intercept/.test(step.prompt)
        ? discriminant / 4
        : Math.floor(discriminant / 4) + 1;
      expectAnswer(step, expected);
    }
  });

  it('sandbox-simultaneous-lines answers stay consistent with the generated intersection', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const result = makeVariant('sandbox-simultaneous-lines', seed);
      if (!result.hasVariants) continue;
      const scene = result.steps[0].sceneData;
      expect(scene?.kind).toBe('line-system');
      if (!scene || scene.kind !== 'line-system') continue;
      const x = (scene.second.c - scene.first.c) / (scene.first.m - scene.second.m);
      const y = scene.first.m * x + scene.first.c;
      // The core steps must report that same intersection.
      expectAnswer(result.steps[0], x);
      expectAnswer(result.steps[1], y);

      const step = result.steps[3];
      if (/y = mx through the origin/.test(step.prompt)) {
        expectAnswer(step, y / x);
      } else if (/no solution at all/.test(step.prompt)) {
        expectAnswer(step, scene.first.m);
      } else {
        const expected = /the x-axis/.test(step.prompt)
          ? `${x}, ${-y}`
          : /the y-axis/.test(step.prompt)
            ? `${-x}, ${y}`
            : `${y}, ${x}`;
        expect(step.acceptedAnswers[0], step.prompt).toBe(expected);
      }
    }
  });

  it('sandbox-inequality-region answers match the generated boundaries', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const result = makeVariant('sandbox-inequality-region', seed);
      if (!result.hasVariants) continue;
      const scene = result.steps[0].sceneData;
      expect(scene?.kind).toBe('line-system');
      if (!scene || scene.kind !== 'line-system') continue;
      const lower = scene.first;
      const upper = scene.second;
      const xi = (upper.c - lower.c) / (lower.m - upper.m);
      const inside = (px: number, py: number) =>
        py >= lower.m * px + lower.c - 1e-9 && py <= upper.m * px + upper.c + 1e-9;

      // Core: boundary intersection, then two membership verdicts.
      expectAnswer(result.steps[0], xi);
      expect(result.steps[1].acceptedAnswers[0]).toBe(inside(0, 0) ? 'yes' : 'no');
      const transfer = result.steps[2].prompt.match(/\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/);
      expect(transfer, result.steps[2].prompt).not.toBeNull();
      expect(result.steps[2].acceptedAnswers[0]).toBe(
        inside(Number(transfer![1]), Number(transfer![2])) ? 'yes' : 'no',
      );

      const step = result.steps[3];
      if (/value of/.test(step.prompt) && /largest|smallest/.test(step.prompt) && /x ≥ 0/.test(step.prompt)) {
        const corners: [number, number][] = [[0, lower.c], [0, upper.c], [xi, lower.m * xi + lower.c]];
        const objective = step.prompt.slice(step.prompt.lastIndexOf('value of ') + 9).replace('?', '');
        const a = objective.match(/^(\d*)x/)![1];
        const b = objective.match(/\+ (\d*)y/)![1];
        const av = a === '' ? 1 : Number(a);
        const bv = b === '' ? 1 : Number(b);
        const values = corners.map(([x, y]) => av * x + bv * y);
        expectAnswer(step, /largest/.test(step.prompt) ? Math.max(...values) : Math.min(...values), 1e-4);
      } else {
        const xSlice = Number(step.prompt.match(/at x = (-?\d+(?:\.\d+)?)/)![1]);
        const expected = /largest/.test(step.prompt)
          ? upper.m * xSlice + upper.c
          : lower.m * xSlice + lower.c;
        expectAnswer(step, expected, 1e-4);
      }
    }
  });

  it('sandbox-polar-curves keeps its exact angles and spiral radii', () => {
    for (const step of extensionsFor('sandbox-polar-curves')) {
      if (/lemniscate/.test(step.prompt)) expectAnswer(step, Math.PI / 4, 1e-3);
      else if (/cardioid/.test(step.prompt)) expectAnswer(step, Math.PI / 2, 1e-3);
      else {
        const turns = Number(step.prompt.match(/after (\d+) complete turns/)![1]);
        expectAnswer(step, turns);
      }
    }
  });

  it('sandbox-parametric-curves differentiates the stated parametrisation', () => {
    for (const step of extensionsFor('sandbox-parametric-curves')) {
      const parametrisation = step.prompt.match(/x = t(?:\^(\d+))? and y = t(?:\^(\d+))?/);
      expect(parametrisation, step.prompt).not.toBeNull();
      const p = parametrisation![1] ? Number(parametrisation![1]) : 1;
      const q = parametrisation![2] ? Number(parametrisation![2]) : 1;
      // dy/dx = (q/p) t^(q-p); check numerically at t = 2.
      const t = 2;
      const expected = (q / p) * t ** (q - p);
      const answer = step.acceptedAnswers[0];
      const coefficientMatch = answer.match(/^(-?\d+(?:\/\d+)?)?/);
      const raw = coefficientMatch?.[1] ?? '1';
      const coefficient = raw.includes('/')
        ? Number(raw.split('/')[0]) / Number(raw.split('/')[1])
        : Number(raw || '1');
      const powerMatch = answer.match(/t\^(\d+)/);
      const power = powerMatch ? Number(powerMatch[1]) : answer.includes('t') ? 1 : 0;
      expect(coefficient * t ** power, `${step.prompt} → ${answer}`).toBeCloseTo(expected, 9);
    }
  });

  it('sandbox-distance-time uses the harmonic mean, not the arithmetic mean', () => {
    for (const step of extensionsFor('sandbox-distance-time')) {
      const [d1, v1, d2, v2] = numbers(step.prompt);
      const expected = (d1 + d2) / (d1 / v1 + d2 / v2);
      expectAnswer(step, expected, 1e-4);
      expect(expected).not.toBeCloseTo((v1 + v2) / 2, 6);
    }
  });

  it('calculus-tangent-slope-predict builds the correct tangent to x² − 3x', () => {
    for (const step of extensionsFor('calculus-tangent-slope-predict')) {
      if (/right-hand side of the tangent/.test(step.prompt)) {
        const x0 = numbers(step.prompt)[0];
        const m = 2 * x0 - 3;
        const c = x0 * x0 - 3 * x0 - m * x0;
        // Evaluate the authored answer at two points and compare with mx + c.
        const answer = step.acceptedAnswers[0];
        for (const x of [1.37, -2.6]) {
          const evaluated = evaluateLinear(answer, x);
          expect(evaluated, `${step.prompt} → ${answer}`).toBeCloseTo(m * x + c, 9);
        }
      } else {
        const k = numbers(step.prompt)[0];
        expectAnswer(step, (k + 3) / 2);
      }
    }
  });

  it('calculus-riemann-convergence finds the first n below the stated error', () => {
    for (const step of extensionsFor('calculus-riemann-convergence')) {
      if (!/smallest n/.test(step.prompt)) continue;
      const epsilon = numbers(step.prompt).at(-1) as number;
      const n = numericAnswer(step);
      expect((3 * n - 1) / (6 * n * n), step.prompt).toBeLessThan(epsilon);
      expect((3 * (n - 1) - 1) / (6 * (n - 1) ** 2), step.prompt).toBeGreaterThanOrEqual(epsilon);
    }
  });

  it('calculus-direction-field reports the logistic inflection and equilibria', () => {
    for (const step of extensionsFor('calculus-direction-field')) {
      if (/growing fastest/.test(step.prompt)) expectAnswer(step, 2);
      else if (/how many equilibrium/.test(step.prompt)) expectAnswer(step, 2);
      else expect(step.acceptedAnswers[0]).toBe('decrease');
    }
  });

  it('calculus-kinematics-links locates the turning points of the stated cubic', () => {
    for (const step of extensionsFor('calculus-kinematics-links')) {
      const rule = step.prompt.slice(step.prompt.indexOf('s(t)'));
      const b = Number(rule.match(/− (\d+)t²/)![1]);
      const c = Number(rule.match(/\+ (\d+)t/)![1]);
      // v(t) = 3t² − 2bt + c
      const disc = Math.sqrt(4 * b * b - 12 * c);
      const r1 = (2 * b - disc) / 6;
      const r2 = (2 * b + disc) / 6;
      if (/second time/.test(step.prompt)) expectAnswer(step, r2);
      else if (/acceleration/.test(step.prompt)) expectAnswer(step, b / 3);
      else expect(step.acceptedAnswers[0]).toBe('backwards');
      expect(r1).toBeLessThan(r2);
    }
  });

  it('calculus-numerical-methods iterates Newton twice exactly', () => {
    for (const step of extensionsFor('calculus-numerical-methods')) {
      if (!/x₂/.test(step.prompt)) continue;
      const scene = step.sceneData;
      expect(scene?.kind).toBe('numerical-newton');
      if (!scene || scene.kind !== 'numerical-newton') continue;
      const f = (x: number) => x * x - scene.k;
      const fp = (x: number) => 2 * x;
      const x1 = scene.x0 - f(scene.x0) / fp(scene.x0);
      const x2 = x1 - f(x1) / fp(x1);
      expectAnswer(step, x2, 1e-4);
    }
  });

  it('geometry-reflect-predict applies the correct diagonal mirror rule', () => {
    for (const step of extensionsFor('geometry-reflect-predict')) {
      const [x, y] = numbers(step.prompt.slice(step.prompt.indexOf('image of')));
      const inYEqualsX = /line y = x\b/.test(step.prompt);
      const expected = inYEqualsX ? `${y}, ${x}` : `${-y}, ${-x}`;
      expect(step.acceptedAnswers[0], step.prompt).toBe(expected);
    }
  });

  it('geometry-rotation-image inverts the stated rotation', () => {
    for (const step of extensionsFor('geometry-rotation-image')) {
      const angle = numbers(step.prompt)[0];
      const [ix, iy] = numbers(step.prompt.slice(step.prompt.indexOf('lands on')));
      const [ox, oy] = numbers(step.acceptedAnswers[0]);
      const forward: [number, number] =
        angle === 90 ? [-oy, ox] : angle === 180 ? [-ox, -oy] : [oy, -ox];
      expect(forward, step.prompt).toEqual([ix, iy]);
    }
  });

  it('geometry-enlarge-predict recovers the scale factor and area factor', () => {
    for (const step of extensionsFor('geometry-enlarge-predict')) {
      if (/scale factor\?$/.test(step.prompt)) {
        const [cx, cy, px, py, ix, iy] = numbers(step.prompt);
        expectAnswer(step, (ix - cx) / (px - cx));
        expect((iy - cy) / (py - cy)).toBeCloseTo((ix - cx) / (px - cx), 9);
      } else {
        const [area, k] = numbers(step.prompt);
        expectAnswer(step, area * k * k);
      }
    }
  });

  it('geometry-similarity-ratio squares and unsquares the ratio consistently', () => {
    for (const step of extensionsFor('geometry-similarity-ratio')) {
      const values = numbers(step.prompt);
      if (/areas/.test(step.prompt)) {
        const [a1, a2, b1] = values;
        expectAnswer(step, b1 * Math.sqrt(a2 / a1), 1e-6);
      } else {
        const [b1, b2, a1] = values;
        expectAnswer(step, a1 * (b2 / b1) ** 2, 1e-6);
      }
    }
  });

  it('geometry-circle-scaling inverts between area and circumference', () => {
    for (const step of extensionsFor('geometry-circle-scaling')) {
      const given = numbers(step.prompt)[0];
      const answerCoefficient = numbers(step.acceptedAnswers[0])[0];
      if (/area/.test(step.prompt.slice(0, step.prompt.indexOf('. What'))))
        expect(answerCoefficient, step.prompt).toBe(2 * Math.sqrt(given));
      else expect(answerCoefficient, step.prompt).toBe((given / 2) ** 2);
    }
  });

  it('geometry-pythagoras handles the isosceles height and rectangle diagonal', () => {
    for (const step of extensionsFor('geometry-pythagoras')) {
      const values = numbers(step.prompt);
      if (/isosceles/.test(step.prompt)) {
        const [equalSide, base] = values;
        expectAnswer(step, Math.sqrt(equalSide ** 2 - (base / 2) ** 2), 1e-6);
      } else {
        const [a, b] = values;
        expectAnswer(step, Math.hypot(a, b), 1e-6);
      }
    }
  });

  it('geometry-sohcahtoa rounds the inverse sine correctly', () => {
    for (const step of extensionsFor('geometry-sohcahtoa')) {
      const [ladder, height] = numbers(step.prompt);
      const expected = Math.round((Math.asin(height / ladder) * 180) / Math.PI);
      expectAnswer(step, expected, 1e-6);
    }
  });

  it('geometry-unit-circle counts two solutions per revolution', () => {
    for (const step of extensionsFor('geometry-unit-circle')) {
      const upperMatch = step.prompt.match(/≤ (\d*)π/);
      const upper = upperMatch![1] === '' ? 2 : Number(upperMatch![1]);
      expectAnswer(step, upper);
    }
  });

  it('statistics-distribution-shape balances the totals', () => {
    for (const step of extensionsFor('statistics-distribution-shape')) {
      const total = 20;
      const target = numbers(step.prompt).at(-1) as number;
      if (/sixth value/.test(step.prompt)) expectAnswer(step, target * 6 - total);
      else expectAnswer(step, total - target * 4);
    }
  });

  it('statistics-normal-zscore adds one-sided empirical areas and inverts z', () => {
    const oneSided = [0, 34, 47.5, 49.85];
    for (const step of extensionsFor('statistics-normal-zscore')) {
      const [mu, sigma, a, b] = numbers(step.prompt);
      if (/percentage of values/.test(step.prompt)) {
        const below = Math.round((mu - a) / sigma);
        const above = Math.round((b - mu) / sigma);
        expectAnswer(step, oneSided[below] + oneSided[above], 1e-6);
      } else {
        const z = numbers(step.prompt).at(-1) as number;
        expectAnswer(step, mu + z * sigma);
      }
    }
  });

  it('statistics-probability-simulation uses the complement of all-tails', () => {
    for (const step of extensionsFor('statistics-probability-simulation')) {
      const n = numbers(step.prompt)[0];
      const expected = /at least one head/.test(step.prompt) ? 1 - 2 ** -n : 2 ** -n;
      expectAnswer(step, expected, 1e-6);
    }
  });

  it('statistics-scatter-regression anchors on the mean point', () => {
    for (const step of extensionsFor('statistics-scatter-regression')) {
      const [m, xBar, yBar, xNew] = numbers(step.prompt);
      if (/y-intercept/.test(step.prompt)) expectAnswer(step, yBar - m * xBar, 1e-6);
      else expectAnswer(step, yBar + m * (xNew - xBar), 1e-6);
    }
  });

  it('statistics-box-plot measures the fence from the right quartile', () => {
    for (const step of extensionsFor('statistics-box-plot')) {
      const q1 = Number(step.prompt.match(/Q1 = (\d+)/)![1]);
      const q3 = Number(step.prompt.match(/Q3 = (\d+)/)![1]);
      const iqr = q3 - q1;
      expect(step.prompt).toContain('1.5 × IQR');
      expectAnswer(step, /above/.test(step.prompt) ? q3 + 1.5 * iqr : q1 - 1.5 * iqr, 1e-6);
    }
  });

  it('statistics-tree-two-way matches hypergeometric probabilities for 3R/2B', () => {
    for (const step of extensionsFor('statistics-tree-two-way')) {
      const expected = /at least one blue/.test(step.prompt)
        ? 1 - (3 / 5) * (2 / 4)
        : /exactly one red/.test(step.prompt)
          ? (3 / 5) * (2 / 4) + (2 / 5) * (3 / 4)
          : (2 / 5) * (1 / 4);
      expectAnswer(step, expected, 1e-6);
    }
  });

  it('linear-vector-resultant uses a zero dot product for perpendicularity', () => {
    for (const step of extensionsFor('linear-vector-resultant')) {
      const values = numbers(step.prompt);
      if (/perpendicular/.test(step.prompt)) {
        const [a, b, c] = values;
        expectAnswer(step, (-b * c) / a);
      } else {
        const [a, b, cx, cy] = values;
        expectAnswer(step, a * cx + b * cy);
      }
    }
  });

  it('linear-matrix-transform uses the full determinant', () => {
    for (const step of extensionsFor('linear-matrix-transform')) {
      const matrix = numbers(step.prompt.slice(step.prompt.indexOf('[[')));
      if (/single line/.test(step.prompt)) {
        const [a, b, c] = matrix;
        expectAnswer(step, (b * c) / a);
      } else {
        const [a, b, c, d] = matrix;
        expectAnswer(step, Math.abs(a * d - b * c));
      }
    }
  });

  it('linear-complex-plane multiplies moduli', () => {
    for (const step of extensionsFor('linear-complex-plane')) {
      const values = numbers(step.prompt);
      const first = Math.hypot(values[0], values[1]);
      const second = /\(1 \+ i\)/.test(step.prompt)
        ? Math.SQRT2
        : Math.hypot(values[2], values[3]);
      expectAnswer(step, first * second, 1e-3);
    }
  });

  it('covers every catalogued activity', () => {
    // Guard against an activity being added without an audit above.
    expect(ALL_ACTIVITY_IDS).toHaveLength(45);
  });
});

/** Evaluate a `mx + c` style string at x, without using eval. */
function evaluateLinear(expression: string, x: number): number {
  const match = expression.match(/^(-?\d*)x(?:\s*([+-])\s*(\d+))?$/);
  expect(match, `not a linear rhs: ${expression}`).not.toBeNull();
  const rawSlope = match![1];
  const slope = rawSlope === '' ? 1 : rawSlope === '-' ? -1 : Number(rawSlope);
  const constant = match![3] ? (match![2] === '-' ? -1 : 1) * Number(match![3]) : 0;
  return slope * x + constant;
}
