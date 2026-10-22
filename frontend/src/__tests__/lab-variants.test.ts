import { describe, expect, it } from 'vitest';
import { makeVariant, hasVariants, VARIANT_WHITELIST } from '../lib/lab-variants';

describe('lab-variants', () => {
  const WHITELIST = [...VARIANT_WHITELIST];

  describe('whitelist coverage', () => {
    it('has at least 10 whitelisted activities', () => {
      expect(WHITELIST.length).toBeGreaterThanOrEqual(10);
    });

    it('includes all required activities', () => {
      const required = [
        'geometry-pythagoras',
        'geometry-circle-scaling',
        'geometry-sohcahtoa',
        'statistics-normal-zscore',
        'linear-vector-resultant',
        'linear-matrix-transform',
        'linear-complex-plane',
        'calculus-numerical-methods',
        'explorer-distance-from-origin',
        'explorer-two-point-measures',
      ];
      for (const id of required) {
        expect(hasVariants(id)).toBe(true);
      }
    });
  });

  describe('determinism — same seed produces same output', () => {
    it.each(WHITELIST)('%s: same seed → identical steps', (activityId) => {
      const r1 = makeVariant(activityId, 42);
      const r2 = makeVariant(activityId, 42);
      expect(r1).toEqual(r2);
    });

    it.each(WHITELIST)('%s: different seeds produce at least one different prompt', (activityId) => {
      // Try a few seed pairs to find a difference
      let foundDifference = false;
      for (let s = 1; s <= 20; s++) {
        const r1 = makeVariant(activityId, s);
        const r2 = makeVariant(activityId, s + 100);
        if (!r1.hasVariants || !r2.hasVariants) break;
        const prompts1 = r1.steps.map((st) => st.prompt).join('|');
        const prompts2 = r2.steps.map((st) => st.prompt).join('|');
        if (prompts1 !== prompts2) {
          foundDifference = true;
          break;
        }
      }
      expect(foundDifference).toBe(true);
    });
  });

  describe('non-whitelisted activities', () => {
    it('returns hasVariants: false for unknown activity', () => {
      const r = makeVariant('nonexistent-activity', 1);
      expect(r.hasVariants).toBe(false);
    });

    it('returns hasVariants: false for an id that is not an activity', () => {
      const r = makeVariant('geometry-not-a-real-activity', 1);
      expect(r.hasVariants).toBe(false);
    });
  });

  describe('100-seed property tests', () => {
    it.each(WHITELIST)('%s: 100 seeds all produce valid steps', (activityId) => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant(activityId, seed);
        expect(result.hasVariants).toBe(true);
        if (!result.hasVariants) continue;
        const { steps } = result;

        // 3 core steps plus exactly one extension challenge.
        expect(steps).toHaveLength(4);
        expect(steps.filter((st) => st.tier === 'extension')).toHaveLength(1);
        expect(steps[3].tier).toBe('extension');

        for (const step of steps) {
          // Prompt is non-empty
          expect(step.prompt.length).toBeGreaterThan(0);
          // Has at least one accepted answer
          expect(step.acceptedAnswers.length).toBeGreaterThan(0);
          // Every accepted answer is non-empty
          for (const ans of step.acceptedAnswers) {
            expect(ans.trim().length).toBeGreaterThan(0);
          }
          // Feedback strings are non-empty
          expect(step.feedbackCorrect.length).toBeGreaterThan(0);
          expect(step.feedbackIncorrect.length).toBeGreaterThan(0);
          // Type is valid
          expect(['predict', 'answer', 'drag-to']).toContain(step.type);
        }
      }
    });

    it.each(WHITELIST)('%s: all numeric answers are finite', (activityId) => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant(activityId, seed);
        if (!result.hasVariants) continue;
        for (const step of result.steps) {
          if (step.tolerance !== undefined) {
            // At least one accepted answer should parse as a finite number
            const numericAnswers = step.acceptedAnswers
              .map((a) => Number(a.replace(/[()]/g, '').trim()))
              .filter(Number.isFinite);
            // tolerance defined implies numeric answer expected
            expect(numericAnswers.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it.each(WHITELIST)('%s: tolerance is positive when defined', (activityId) => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant(activityId, seed);
        if (!result.hasVariants) continue;
        for (const step of result.steps) {
          if (step.tolerance !== undefined) {
            expect(step.tolerance).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  describe('math consistency: geometry-pythagoras', () => {
    it('100 seeds: a² + b² = c² for step 1 (find hypotenuse)', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant('geometry-pythagoras', seed);
        if (!result.hasVariants) continue;
        const step = result.steps[0];
        // Extract numbers from prompt: "perpendicular sides X and Y"
        const match = step.prompt.match(/sides\s+(\d+)\s+and\s+(\d+)/);
        expect(match).not.toBeNull();
        const a = Number(match![1]);
        const b = Number(match![2]);
        const c = Number(step.acceptedAnswers[0]);
        expect(a * a + b * b).toBe(c * c);
      }
    });

    it('100 seeds: step 2 (find leg) is consistent', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant('geometry-pythagoras', seed);
        if (!result.hasVariants) continue;
        const step = result.steps[1];
        const hypMatch = step.prompt.match(/hypotenuse\s+(\d+)/);
        const sideMatch = step.prompt.match(/shorter side\s+(\d+)/);
        expect(hypMatch).not.toBeNull();
        expect(sideMatch).not.toBeNull();
        const c = Number(hypMatch![1]);
        const a = Number(sideMatch![1]);
        const b = Number(step.acceptedAnswers[0]);
        expect(a * a + b * b).toBe(c * c);
      }
    });
  });

  describe('math consistency: explorer-distance-from-origin', () => {
    it('100 seeds: distance = √(x²+y²) is correct', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant('explorer-distance-from-origin', seed);
        if (!result.hasVariants) continue;
        for (const step of result.steps.filter((st) => st.tier !== 'extension')) {
          const coordMatch = step.prompt.match(/\((\d+),\s*(\d+)\)/);
          expect(coordMatch).not.toBeNull();
          const x = Number(coordMatch![1]);
          const y = Number(coordMatch![2]);
          const expectedDist = Math.sqrt(x * x + y * y);
          const answer = Number(step.acceptedAnswers[0]);
          expect(Math.abs(answer - expectedDist)).toBeLessThan(0.01);
        }
      }
    });
  });

  describe('math consistency: linear-vector-resultant', () => {
    it('100 seeds: step 1 magnitude uses Pythagoras', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant('linear-vector-resultant', seed);
        if (!result.hasVariants) continue;
        const step = result.steps[0];
        const match = step.prompt.match(/\((-?\d+),\s*(-?\d+)\)/);
        expect(match).not.toBeNull();
        const vx = Number(match![1]);
        const vy = Number(match![2]);
        const mag = Number(step.acceptedAnswers[0]);
        expect(Math.abs(mag - Math.sqrt(vx * vx + vy * vy))).toBeLessThan(0.01);
      }
    });

    it('100 seeds: step 2 vector addition is correct', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant('linear-vector-resultant', seed);
        if (!result.hasVariants) continue;
        const step = result.steps[1];
        const vectors = [...step.prompt.matchAll(/\((-?\d+),\s*(-?\d+)\)/g)];
        expect(vectors.length).toBe(2);
        const ax = Number(vectors[0][1]);
        const ay = Number(vectors[0][2]);
        const bx = Number(vectors[1][1]);
        const by = Number(vectors[1][2]);
        const expectedStr = `${ax + bx}, ${ay + by}`;
        expect(step.acceptedAnswers).toContain(expectedStr);
      }
    });
  });

  describe('math consistency: linear-matrix-transform', () => {
    it('100 seeds: step 3 determinant is correct', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant('linear-matrix-transform', seed);
        if (!result.hasVariants) continue;
        const step = result.steps[2];
        const match = step.prompt.match(/\[\[(\d+),0\],\[0,(\d+)\]\]/);
        expect(match).not.toBeNull();
        const a = Number(match![1]);
        const d = Number(match![2]);
        const det = Number(step.acceptedAnswers[0]);
        expect(det).toBe(a * d);
      }
    });
  });

  describe('math consistency: statistics-normal-zscore', () => {
    it('100 seeds: z = (x - μ)/σ is correct', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant('statistics-normal-zscore', seed);
        if (!result.hasVariants) continue;
        const step = result.steps[0];
        const muMatch = step.prompt.match(/μ\s*=\s*(\d+)/);
        const sigmaMatch = step.prompt.match(/σ\s*=\s*(\d+)/);
        const xMatch = step.prompt.match(/x\s*=\s*(-?\d+)/);
        expect(muMatch).not.toBeNull();
        expect(sigmaMatch).not.toBeNull();
        expect(xMatch).not.toBeNull();
        const mu = Number(muMatch![1]);
        const sigma = Number(sigmaMatch![1]);
        const x = Number(xMatch![1]);
        const z = Number(step.acceptedAnswers[0]);
        expect(z).toBe((x - mu) / sigma);
      }
    });
  });

  describe('math consistency: calculus-numerical-methods', () => {
    it('100 seeds: Newton step x₁ = x₀ - f(x₀)/f′(x₀) is correct', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant('calculus-numerical-methods', seed);
        if (!result.hasVariants) continue;
        const step = result.steps[0];
        const kMatch = step.prompt.match(/x²−(\d+)/);
        const x0Match = step.prompt.match(/x₀=(\d+)/);
        expect(kMatch).not.toBeNull();
        expect(x0Match).not.toBeNull();
        const k = Number(kMatch![1]);
        const x0 = Number(x0Match![1]);
        // f(x0) = x0^2 - k, f'(x0) = 2*x0
        const x1Expected = x0 - (x0 * x0 - k) / (2 * x0);
        // Check at least one accepted answer matches
        const numericAnswers = step.acceptedAnswers.map(Number).filter(Number.isFinite);
        const fracAnswers = step.acceptedAnswers.filter((a) => a.includes('/'));
        let matches = numericAnswers.some((a) => Math.abs(a - x1Expected) < 0.01);
        if (!matches && fracAnswers.length > 0) {
          for (const frac of fracAnswers) {
            const [num, den] = frac.split('/').map(Number);
            if (Math.abs(num / den - x1Expected) < 0.001) {
              matches = true;
              break;
            }
          }
        }
        expect(matches).toBe(true);
      }
    });
  });

  describe('math consistency: geometry-circle-scaling', () => {
    it('100 seeds: circumference = 2πr', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant('geometry-circle-scaling', seed);
        if (!result.hasVariants) continue;
        const step = result.steps[0];
        const rMatch = step.prompt.match(/radius\s+(\d+)/);
        expect(rMatch).not.toBeNull();
        const r = Number(rMatch![1]);
        // Accepted answer should be "2r"π in the form "<number>π"
        const ansMatch = step.acceptedAnswers[0].match(/^(\d+)/);
        expect(ansMatch).not.toBeNull();
        const coeff = Number(ansMatch![1]);
        expect(coeff).toBe(2 * r);
      }
    });

    it('100 seeds: area scale factor = k²', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant('geometry-circle-scaling', seed);
        if (!result.hasVariants) continue;
        const step = result.steps[2];
        const kMatch = step.prompt.match(/multiplied by\s+(\d+)/);
        expect(kMatch).not.toBeNull();
        const k = Number(kMatch![1]);
        const factor = Number(step.acceptedAnswers[0]);
        expect(factor).toBe(k * k);
      }
    });
  });

  describe('math consistency: explorer-two-point-measures', () => {
    it('100 seeds: gradient, midpoint and distance are consistent', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant('explorer-two-point-measures', seed);
        if (!result.hasVariants) continue;
        // Step 1: gradient
        const gradStep = result.steps[0];
        const pointsMatch = [...gradStep.prompt.matchAll(/[PQ]\((-?\d+),\s*(-?\d+)\)/g)];
        expect(pointsMatch.length).toBe(2);
        const px = Number(pointsMatch[0][1]);
        const py = Number(pointsMatch[0][2]);
        const qx = Number(pointsMatch[1][1]);
        const qy = Number(pointsMatch[1][2]);
        const expectedGrad = (qy - py) / (qx - px);
        // One of the accepted answers should be close
        const gradAnswers = gradStep.acceptedAnswers.map((a) => {
          if (a.includes('/')) {
            const [n, d] = a.split('/').map(Number);
            return n / d;
          }
          return Number(a);
        });
        expect(gradAnswers.some((g) => Math.abs(g - expectedGrad) < 0.01)).toBe(true);

        // Step 3: distance
        const distStep = result.steps[2];
        const dx = qx - px;
        const dy = qy - py;
        const expectedDist = Math.sqrt(dx * dx + dy * dy);
        const dist = Number(distStep.acceptedAnswers[0]);
        expect(Math.abs(dist - expectedDist)).toBeLessThan(0.01);
      }
    });
  });

  describe('pretty values', () => {
    it.each(WHITELIST)('%s: numeric answers are integers or have at most 4 decimal places', (activityId) => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant(activityId, seed);
        if (!result.hasVariants) continue;
        for (const step of result.steps) {
          for (const ans of step.acceptedAnswers) {
            // Skip non-numeric answers (e.g. "yes", coordinate tuples, formula strings)
            const cleaned = ans.replace(/[() ]/g, '');
            if (cleaned.includes(',') || /[a-zA-Zπ°]/.test(cleaned)) continue;
            if (cleaned.includes('/')) {
              // Fraction — check numerator and denominator are integers
              const [num, den] = cleaned.split('/');
              expect(Number.isInteger(Number(num))).toBe(true);
              expect(Number.isInteger(Number(den))).toBe(true);
              continue;
            }
            const num = Number(cleaned);
            if (!Number.isFinite(num)) continue;
            // At most 4 decimal places
            const dp = cleaned.includes('.') ? cleaned.split('.')[1].length : 0;
            expect(dp).toBeLessThanOrEqual(4);
          }
        }
      }
    });
  });

  describe('view-box range', () => {
    it.each(WHITELIST)('%s: numeric values in prompts/answers are bounded', (activityId) => {
      for (let seed = 1; seed <= 100; seed++) {
        const result = makeVariant(activityId, seed);
        if (!result.hasVariants) continue;
        for (const step of result.steps) {
          // Extract all numbers from prompt
          const numbers = [...step.prompt.matchAll(/-?\d+\.?\d*/g)].map((m) => Number(m[0]));
          for (const n of numbers) {
            // Reasonable bound: no value exceeds ±500 (stats uses score-range values)
            expect(Math.abs(n)).toBeLessThanOrEqual(500);
          }
        }
      }
    });
  });
});
