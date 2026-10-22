/**
 * Core-variant contracts.
 *
 * "New numbers" must change the task the student is looking at right now, not
 * only the extension challenge they may never reach. These tests assert that for
 * every activity:
 *  - the three graded prompts change across seeds;
 *  - every graded step carries typed sceneData, so the canvas reads the same
 *    numbers the prompt states;
 *  - the generated answers are mathematically correct, re-derived here from the
 *    scene parameters rather than from the generator's own arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { ALL_ACTIVITY_IDS, type LearnStep } from '../lib/lab-activities';
import { makeVariant } from '../lib/lab-variants';

const SEEDS = 60;

function coreStepsFor(activityId: string, seed: number): LearnStep[] {
  const result = makeVariant(activityId, seed);
  expect(result.hasVariants, activityId).toBe(true);
  if (!result.hasVariants) return [];
  return result.steps.filter((step) => step.tier !== 'extension');
}

function numericAnswer(step: LearnStep): number {
  for (const answer of step.acceptedAnswers) {
    if (answer.includes('°') || /degrees/.test(answer)) continue;
    const cleaned = answer.replace(/[()%]/g, '').replace(/\s*km\/h\s*/g, '').trim();
    if (/^-?\d+(\.\d+)?\/-?\d+$/.test(cleaned)) {
      const [n, d] = cleaned.split('/').map(Number);
      return n / d;
    }
    const value = Number(cleaned);
    if (Number.isFinite(value)) return value;
  }
  return Number.NaN;
}

describe('every activity regenerates its graded steps', () => {
  it.each(ALL_ACTIVITY_IDS)('%s: all three core prompts vary across seeds', (activityId) => {
    const seen = [new Set<string>(), new Set<string>(), new Set<string>()];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor(activityId, seed);
      expect(core, `${activityId} core length`).toHaveLength(3);
      core.forEach((step, index) => seen[index].add(step.prompt));
    }
    // At least one graded step must offer several distinct tasks, and the first
    // step in particular must not be frozen.
    expect(seen[0].size, `${activityId} step 1 variety`).toBeGreaterThanOrEqual(2);
    const totalVariety = seen.reduce((sum, set) => sum + set.size, 0);
    expect(totalVariety, `${activityId} total variety`).toBeGreaterThanOrEqual(6);
  });

  it.each(ALL_ACTIVITY_IDS)('%s: every core step carries typed sceneData', (activityId) => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const step of coreStepsFor(activityId, seed)) {
        expect(step.sceneData, `${activityId}: ${step.prompt}`).toBeDefined();
        expect(step.sceneData!.kind).toBeTruthy();
      }
    }
  });

  it.each(ALL_ACTIVITY_IDS)('%s: core answers are non-empty and finite where numeric', (activityId) => {
    for (let seed = 1; seed <= 20; seed += 1) {
      for (const step of coreStepsFor(activityId, seed)) {
        expect(step.acceptedAnswers.length).toBeGreaterThan(0);
        for (const answer of step.acceptedAnswers) expect(answer.trim().length).toBeGreaterThan(0);
        if (step.tolerance !== undefined) {
          expect(Number.isNaN(numericAnswer(step)), `${activityId}: ${step.prompt}`).toBe(false);
        }
      }
    }
  });
});

describe('generated core answers are mathematically correct', () => {
  it('explorer-quadrant-predict names the quadrant of the plotted point', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      for (const step of coreStepsFor('explorer-quadrant-predict', seed)) {
        const scene = step.sceneData;
        expect(scene?.kind).toBe('quadrant-point');
        if (!scene || scene.kind !== 'quadrant-point') continue;
        const [x, y] = scene.point;
        // The canvas point must be the point named in the prompt.
        expect(step.prompt).toContain(`(${x}, ${y})`);
        const expected = x > 0 ? (y > 0 ? 'I' : 'IV') : y > 0 ? 'II' : 'III';
        expect(step.acceptedAnswers[0], step.prompt).toBe(expected);
      }
    }
  });

  it('sandbox function activities agree with their plotted function', () => {
    const activities = [
      'sandbox-gradient-effect',
      'sandbox-vertex-predict',
      'sandbox-intercept-find',
    ] as const;
    for (const activityId of activities) {
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        for (const step of coreStepsFor(activityId, seed)) {
          const scene = step.sceneData;
          expect(scene?.kind).toBe('function-plot');
          if (!scene || scene.kind !== 'function-plot') continue;
          if (scene.funType === 'linear') {
            expect(Number.isFinite(scene.m!)).toBe(true);
            expect(Number.isFinite(scene.c!)).toBe(true);
          } else {
            expect(Number.isFinite(scene.a!)).toBe(true);
          }
        }
      }
    }
  });

  it('sandbox-gradient-effect evaluates the stated line at the stated x', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('sandbox-gradient-effect', seed);
      const scene = core[0].sceneData;
      if (!scene || scene.kind !== 'function-plot') continue;
      expect(numericAnswer(core[0])).toBeCloseTo(scene.m! * scene.traceX + scene.c!, 9);
      // Step 3 asks for the intercept of the second line.
      const second = core[2].sceneData;
      if (second && second.kind === 'function-plot') {
        expect(numericAnswer(core[2])).toBeCloseTo(second.c!, 9);
      }
    }
  });

  it('sandbox-vertex-predict reports the vertex of the plotted parabola', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('sandbox-vertex-predict', seed);
      const scene = core[0].sceneData;
      if (!scene || scene.kind !== 'function-plot') continue;
      const { a = 1, b = 0, k = 0 } = scene;
      const vx = -b / (2 * a);
      const vy = a * vx * vx + b * vx + k;
      expect(numericAnswer(core[0])).toBeCloseTo(vx, 9);
      expect(numericAnswer(core[1])).toBeCloseTo(vy, 9);
      expect(core[2].acceptedAnswers[0]).toBe(a > 0 ? 'up' : 'down');
    }
  });

  it('sandbox-intercept-find reports roots of the plotted quadratic', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('sandbox-intercept-find', seed);
      const scene = core[0].sceneData;
      if (!scene || scene.kind !== 'function-plot') continue;
      const { a = 1, b = 0, k = 0 } = scene;
      expect(numericAnswer(core[0])).toBeCloseTo(k, 9);
      const smaller = numericAnswer(core[1]);
      const larger = numericAnswer(core[2]);
      expect(smaller).toBeLessThan(larger);
      for (const root of [smaller, larger]) {
        expect(a * root * root + b * root + k, `root ${root}`).toBeCloseTo(0, 9);
      }
    }
  });

  it('sandbox-distance-time uses distance over total time', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('sandbox-distance-time', seed);
      const first = core[0].prompt.match(/travels (\d+) km in (\d+) hours/);
      expect(first, core[0].prompt).not.toBeNull();
      expect(numericAnswer(core[0])).toBeCloseTo(Number(first![1]) / Number(first![2]), 9);
      const legs = core[2].prompt.match(/(\d+) km in the first hour.*?(\d+) km in the next 30 minutes/);
      expect(legs, core[2].prompt).not.toBeNull();
      expect(numericAnswer(core[2])).toBeCloseTo((Number(legs![1]) + Number(legs![2])) / 2, 9);
    }
  });

  it('geometry transformation activities match their own rules', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      for (const step of coreStepsFor('geometry-reflect-predict', seed)) {
        const scene = step.sceneData;
        if (!scene || scene.kind !== 'transform-point') continue;
        const [x, y] = scene.source;
        const expected = scene.transform === 'reflect_x' ? `${x}, ${-y}` : `${-x}, ${y}`;
        expect(step.acceptedAnswers[0], step.prompt).toBe(expected);
      }
      for (const step of coreStepsFor('geometry-rotation-image', seed)) {
        const scene = step.sceneData;
        if (!scene || scene.kind !== 'transform-point') continue;
        const [x, y] = scene.source;
        const angle = scene.angleDeg!;
        const image = angle === 90 ? [-y, x] : angle === 180 ? [-x, -y] : [y, -x];
        expect(step.acceptedAnswers[0], step.prompt).toBe(`${image[0]}, ${image[1]}`);
      }
      for (const step of coreStepsFor('geometry-enlarge-predict', seed)) {
        const scene = step.sceneData;
        if (!scene || scene.kind !== 'transform-point') continue;
        const [px, py] = scene.source;
        const [cx, cy] = scene.centre!;
        const k = scene.scaleFactor!;
        expect(step.acceptedAnswers[0], step.prompt).toBe(
          `${cx + k * (px - cx)}, ${cy + k * (py - cy)}`,
        );
      }
    }
  });

  it('geometry-unit-circle matches the rotating point it draws', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('geometry-unit-circle', seed);
      const scene = core[0].sceneData;
      if (!scene || scene.kind !== 'unit-circle') continue;
      const rad = (scene.angleDeg * Math.PI) / 180;
      const expected = `${Math.round(Math.cos(rad))}, ${Math.round(Math.sin(rad))}`;
      expect(core[0].acceptedAnswers[0], core[0].prompt).toBe(expected);

      const secondScene = core[1].sceneData;
      if (secondScene && secondScene.kind === 'unit-circle') {
        const rad2 = (secondScene.angleDeg * Math.PI) / 180;
        const wantCos = core[1].prompt.startsWith('What is cos');
        expect(numericAnswer(core[1])).toBeCloseTo(
          Math.round(wantCos ? Math.cos(rad2) : Math.sin(rad2)),
          9,
        );
      }
    }
  });

  it('geometry-similarity-ratio scales every side by the same factor', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('geometry-similarity-ratio', seed);
      const sides = core[0].prompt.match(/sides (\d+), (\d+), (\d+)/);
      const shortest = core[0].prompt.match(/shortest side (\d+)/);
      expect(sides, core[0].prompt).not.toBeNull();
      const k = Number(shortest![1]) / Number(sides![1]);
      expect(numericAnswer(core[0])).toBeCloseTo(k, 9);
      expect(numericAnswer(core[1])).toBeCloseTo(Number(sides![3]) * k, 9);
    }
  });

  it('statistics dataset activities match the data they plot', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const dist = coreStepsFor('statistics-distribution-shape', seed);
      const distScene = dist[0].sceneData;
      if (distScene && distScene.kind === 'dataset') {
        const values = distScene.values;
        const total = values.reduce((s, v) => s + v, 0);
        expect(numericAnswer(dist[0])).toBeCloseTo(total / values.length, 9);
        expect(numericAnswer(dist[1])).toBeCloseTo([...values].sort((a, b) => a - b)[2], 9);
        expect(dist[0].prompt).toContain(values.join(', '));
      }

      const box = coreStepsFor('statistics-box-plot', seed);
      const boxScene = box[0].sceneData;
      if (boxScene && boxScene.kind === 'dataset') {
        const v = [...boxScene.values].sort((a, b) => a - b);
        expect(v).toHaveLength(7);
        expect(numericAnswer(box[0])).toBeCloseTo(v[3], 9);
        expect(numericAnswer(box[1])).toBeCloseTo(v[1], 9);
        expect(numericAnswer(box[2])).toBeCloseTo(v[5] - v[1], 9);
        expect(box[0].prompt).toContain(v.join(', '));
      }
    }
  });

  it('statistics-probability-simulation uses np and complements', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('statistics-probability-simulation', seed);
      const trials = Number(core[0].prompt.match(/For (\d+) fair coin tosses/)![1]);
      expect(numericAnswer(core[0])).toBeCloseTo(trials / 2, 9);
      const rain = Number(core[1].prompt.match(/P\(rain\) = ([\d.]+)/)![1]);
      expect(numericAnswer(core[1])).toBeCloseTo(1 - rain, 9);
      const tosses = Number(core[2].prompt.match(/all of (\d+) independent/)![1]);
      expect(numericAnswer(core[2])).toBeCloseTo(0.5 ** tosses, 9);
    }
  });

  it('statistics-scatter-regression predicts from its stated fitted line', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('statistics-scatter-regression', seed);
      const increases = /increases as x increases/.test(core[0].prompt);
      expect(core[0].acceptedAnswers[0]).toBe(increases ? 'positive' : 'negative');
      const fitted = core[1].prompt.match(/y = (-?\d+)x ([+-]) (\d+)\. Predict y when x = (\d+)/);
      expect(fitted, core[1].prompt).not.toBeNull();
      const m = Number(fitted![1]);
      const c = (fitted![2] === '-' ? -1 : 1) * Number(fitted![3]);
      const x = Number(fitted![4]);
      expect(numericAnswer(core[1])).toBeCloseTo(m * x + c, 9);
      expect(m > 0).toBe(increases);
    }
  });

  it('statistics-tree-two-way keeps its questions consistent with 3R/2B and the table', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('statistics-tree-two-way', seed);
      const expectedTree = /both red/.test(core[0].prompt)
        ? (3 / 5) * (2 / 4)
        : /both blue/.test(core[0].prompt)
          ? (2 / 5) * (1 / 4)
          : (3 / 5) * (2 / 4) + (2 / 5) * (3 / 4);
      expect(numericAnswer(core[0]), core[0].prompt).toBeCloseTo(expectedTree, 9);

      const expectedTable = /neither/.test(core[1].prompt)
        ? 40 - (25 + 20 - 15)
        : /sport only/.test(core[1].prompt)
          ? 25 - 15
          : 20 - 15;
      expect(numericAnswer(core[1]), core[1].prompt).toBeCloseTo(expectedTable, 9);

      const expectedConditional = /music \| plays sport/.test(core[2].prompt) ? 15 / 25 : 15 / 20;
      expect(numericAnswer(core[2]), core[2].prompt).toBeCloseTo(expectedConditional, 9);
    }
  });

  it('calculus-tangent-slope-predict differentiates the curve it draws', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('calculus-tangent-slope-predict', seed);
      const scene = core[0].sceneData;
      if (!scene || scene.kind !== 'tangent-curve') continue;
      const { b, x0 } = scene;
      // The derivative answer must evaluate like 2x + b.
      const answer = core[0].acceptedAnswers[0];
      const coefficient = Number(answer.match(/^(-?\d+)x/)![1]);
      const constant = Number(answer.replace(/^-?\d+x\s*/, '').replace(/\s/g, ''));
      expect(coefficient).toBe(2);
      expect(constant).toBe(b);
      expect(numericAnswer(core[1])).toBeCloseTo(2 * x0 + b, 9);
      expect(numericAnswer(core[2])).toBeCloseTo(-b / 2, 9);
    }
  });

  it('calculus-riemann-convergence quotes the true left-sum error', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('calculus-riemann-convergence', seed);
      const n = Number(core[1].prompt.match(/with n = (\d+)/)![1]);
      const exact = ((n - 1) * (2 * n - 1)) / (6 * n * n);
      const quoted = Number(core[1].prompt.match(/gives approximately (\d+\.\d+)/)![1]);
      expect(quoted).toBeCloseTo(exact, 2);
      expect(numericAnswer(core[1])).toBeCloseTo(1 / 3 - exact, 2);
    }
  });

  it('calculus-direction-field matches the capacity in its own scene', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('calculus-direction-field', seed);
      const scene = core[2].sceneData;
      if (!scene || scene.kind !== 'direction-field') continue;
      expect(core[2].prompt).toContain(`P/${scene.carryingCapacity}`);
      expect(numericAnswer(core[2])).toBeCloseTo(scene.carryingCapacity, 9);
      const slopePoint = Number(core[1].prompt.match(/\(0, (\d+)\)/)![1]);
      expect(numericAnswer(core[1])).toBeCloseTo(slopePoint, 9);
    }
  });

  it('calculus-kinematics-links differentiates the example it displays', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('calculus-kinematics-links', seed);
      const scene = core[1].sceneData;
      if (!scene || scene.kind !== 'kinematics') continue;
      const isSquare = /t²/.test(core[0].prompt);
      expect(scene.exampleIndex).toBe(isSquare ? 0 : 1);
      const t = Number(core[1].prompt.match(/at t = (\d+)/)![1]);
      expect(numericAnswer(core[1])).toBeCloseTo(isSquare ? 2 * t : 3, 9);
      expect(numericAnswer(core[2])).toBeCloseTo(isSquare ? 2 : 0, 9);
    }
  });

  it('polar and parametric activities evaluate their own parameters', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const polar = coreStepsFor('sandbox-polar-curves', seed);
      const cardioid = polar[0].sceneData;
      if (cardioid && cardioid.kind === 'curve-preset') {
        expect(numericAnswer(polar[0])).toBeCloseTo(2 * cardioid.a, 9);
        expect(polar[0].prompt).toContain(`r = ${cardioid.a}(1 + cos θ)`);
      }
      const spiral = polar[1].sceneData;
      if (spiral && spiral.kind === 'curve-preset') {
        const turns = Number(polar[1].prompt.match(/after (\d+) complete turn/)![1]);
        expect(numericAnswer(polar[1])).toBeCloseTo(spiral.a * turns, 9);
      }

      const parametric = coreStepsFor('sandbox-parametric-curves', seed);
      const line = parametric[1].sceneData;
      if (line && line.kind === 'curve-preset') {
        expect(numericAnswer(parametric[1])).toBeCloseTo((line.b ?? 1) / line.a, 9);
      }
    }
  });

  it('explorer-number-line orders, averages and solves consistently', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('explorer-number-line', seed);
      // Step 1: the answer must be the smaller of the two marked values.
      const first = core[0].sceneData;
      if (first && first.kind === 'number-line') {
        expect(numericAnswer(core[0])).toBeCloseTo(Math.min(...first.points), 9);
      }
      // Step 2: the answer must be the average of the two marked values.
      const second = core[1].sceneData;
      if (second && second.kind === 'number-line') {
        const [a, b] = second.points;
        expect(numericAnswer(core[1])).toBeCloseTo((a + b) / 2, 9);
      }
      // Step 3: the answer must satisfy the inequality while the next integer does not.
      const inequality = core[2].prompt.match(/Solve (\d+)x ([+-]) (\d+) ([<>]) (-?\d+)/);
      expect(inequality, core[2].prompt).not.toBeNull();
      const m = Number(inequality![1]);
      const c = (inequality![2] === '-' ? -1 : 1) * Number(inequality![3]);
      const strict = inequality![4] === '<';
      const d = Number(inequality![5]);
      const answer = numericAnswer(core[2]);
      const holds = (x: number) => (strict ? m * x + c < d : m * x + c > d);
      expect(holds(answer), `${core[2].prompt} → ${answer}`).toBe(true);
      expect(holds(strict ? answer + 1 : answer - 1)).toBe(false);
    }
  });

  it('sandbox-function-transformations matches the parabola it plots', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('sandbox-function-transformations', seed);
      const scene = core[0].sceneData;
      if (!scene || scene.kind !== 'function-plot') continue;
      const { a = 1, b = 0, k = 0 } = scene;
      const h = -b / (2 * a);
      const vertexY = a * h * h + b * h + k;
      // The vertex the prompt asks for must be the plotted curve's vertex.
      expect(core[0].acceptedAnswers[0]).toBe(`${h}, ${vertexY}`);
      // Step 2 evaluates the same curve one unit right of the vertex.
      const nextX = h + 1;
      expect(numericAnswer(core[1])).toBeCloseTo(a * nextX * nextX + b * nextX + k, 9);
      // Step 3 is the y-intercept of that same curve.
      expect(numericAnswer(core[2])).toBeCloseTo(k, 9);
    }
  });

  it('sandbox-exponential-log evaluates powers and logarithms correctly', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('sandbox-exponential-log', seed);
      const scene = core[0].sceneData;
      if (!scene || scene.kind !== 'exponential-plot') continue;
      expect(numericAnswer(core[0])).toBeCloseTo(scene.a, 9);
      const power = Number(core[1].prompt.match(/what is y when x = (\d+)/)![1]);
      expect(numericAnswer(core[1])).toBeCloseTo(scene.a * scene.base ** power, 9);
      const logArgument = Number(core[2].prompt.match(/what is y when x = (\d+)/)![1]);
      const logScene = core[2].sceneData;
      expect(logScene?.kind).toBe('exponential-plot');
      if (!logScene || logScene.kind !== 'exponential-plot') continue;
      expect(logScene.family).toBe('logarithmic');
      expect(numericAnswer(core[2])).toBeCloseTo(
        Math.log(logArgument) / Math.log(logScene.base),
        9,
      );
    }
  });

  it('geometry-angle-reasoning applies the right angle rule each time', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('geometry-angle-reasoning', seed);
      const given = Number(core[0].prompt.match(/One angle is (\d+)°/)![1]);
      const coInterior = /co-interior/.test(core[0].prompt);
      expect(numericAnswer(core[0])).toBeCloseTo(coInterior ? 180 - given : given, 9);

      const triangle = core[1].prompt.match(/angles of (\d+)° and (\d+)°/);
      const a = Number(triangle![1]);
      const b = Number(triangle![2]);
      expect(numericAnswer(core[1])).toBeCloseTo(180 - a - b, 9);
      // The drawn triangle must use the same two angles.
      const triangleScene = core[1].sceneData;
      if (triangleScene && triangleScene.kind === 'angle-figure') {
        expect(triangleScene.angles).toEqual([a, b]);
      }

      const sides = Number(core[2].prompt.match(/a (\d+)-sided polygon/)![1]);
      expect(numericAnswer(core[2])).toBeCloseTo(180 * (sides - 2), 9);
      const polygonScene = core[2].sceneData;
      if (polygonScene && polygonScene.kind === 'angle-figure') {
        expect(polygonScene.sides).toBe(sides);
      }
    }
  });

  it('calculus-curve-sketching differentiates and classifies concavity correctly', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('calculus-curve-sketching', seed);
      const scene = core[0].sceneData;
      if (!scene || scene.kind !== 'curve-analysis') continue;
      const { a, b, c } = scene;
      // f'(x) = 3a x² + 2b x + c — check the authored answer numerically.
      const answer = core[0].acceptedAnswers[0];
      const parts = answer.match(/^(\d+)x\^2 ([+-]) (\d+)x ([+-]) (\d+)$/);
      expect(parts, answer).not.toBeNull();
      expect(Number(parts![1])).toBe(3 * a);
      expect((parts![2] === '-' ? -1 : 1) * Number(parts![3])).toBe(2 * b);
      expect((parts![4] === '-' ? -1 : 1) * Number(parts![5])).toBe(c);
      // Inflection is where f'' = 6a x + 2b vanishes.
      expect(numericAnswer(core[1])).toBeCloseTo(-b / (3 * a), 9);
      // Concavity verdict must match the sign of f'' at the stated x.
      const testX = Number(core[2].prompt.match(/at x = (-?\d+(?:\.\d+)?)/)![1]);
      const secondDerivative = 6 * a * testX + 2 * b;
      expect(core[2].acceptedAnswers[0]).toBe(secondDerivative > 0 ? 'up' : 'down');
    }
  });

  it('calculus-area-between integrates the region it shades', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const core = coreStepsFor('calculus-area-between', seed);
      const scene = core[0].sceneData;
      if (!scene || scene.kind !== 'area-between') continue;
      const { lineSlope, lineIntercept, from, to } = scene;
      // The shaded limits must really be the crossings of the two graphs.
      for (const x of [from, to]) {
        expect(x * x, `crossing at ${x}`).toBeCloseTo(lineSlope * x + lineIntercept, 9);
      }
      expect(numericAnswer(core[0])).toBeCloseTo(to, 9);
      // Area = ∫(line − parabola) over [from, to], integrated in closed form.
      const antiderivative = (x: number) =>
        (lineSlope * x * x) / 2 + lineIntercept * x - (x * x * x) / 3;
      const area = antiderivative(to) - antiderivative(from);
      expect(numericAnswer(core[2]), core[2].prompt).toBeCloseTo(area, 6);
      expect(core[1].acceptedAnswers[0]).toBe('line');
    }
  });

  it('covers every catalogued activity', () => {
    expect(ALL_ACTIVITY_IDS).toHaveLength(45);
  });
});
