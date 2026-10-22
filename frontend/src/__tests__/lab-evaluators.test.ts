import { describe, expect, it } from 'vitest';
import { createCalculusEvaluator, computeRiemannSum } from '../components/lab/CalculusTab';
import { findRootBisection, findRootsNumerical, getExactLaTeX } from '../lib/math-utils';

describe('CalculusTab evaluator (P0 NaN fix)', () => {
  it('returns NaN for 1/x at x = 0 (division by zero)', () => {
    const { evaluator } = createCalculusEvaluator('1/x');
    const result = evaluator(0);
    expect(result).toBeNaN();
  });

  it('returns finite values for valid inputs', () => {
    const { evaluator } = createCalculusEvaluator('x^2');
    expect(evaluator(3)).toBe(9);
    expect(evaluator(-2)).toBe(4);
    expect(evaluator(0)).toBe(0);
  });

  it('returns NaN for log(x) at x = 0 and x < 0', () => {
    const { evaluator } = createCalculusEvaluator('log(x)');
    expect(evaluator(0)).toBeNaN();
    expect(evaluator(-1)).toBeNaN();
  });

  it('returns correct derivative of x^2 at x=3 (should be 6)', () => {
    const { derivativeEvaluator } = createCalculusEvaluator('x^2');
    expect(derivativeEvaluator(3)).toBeCloseTo(6, 5);
  });

  it('returns correct derivative of x^2 - 3*x at x=2 (should be 1)', () => {
    const { derivativeEvaluator } = createCalculusEvaluator('x^2 - 3*x');
    expect(derivativeEvaluator(2)).toBeCloseTo(1, 5);
  });

  it('returns NaN for derivative at undefined points', () => {
    const { derivativeEvaluator } = createCalculusEvaluator('sqrt(x)');
    // derivative of sqrt(x) is 1/(2*sqrt(x)), undefined at x=0
    expect(derivativeEvaluator(0)).toBeNaN();
  });

  it('returns empty evaluators and error for invalid expression', () => {
    const { evaluator, error } = createCalculusEvaluator('invalid+++');
    expect(error).not.toBe('');
    expect(evaluator(1)).toBeNaN();
  });

  it('returns empty evaluators for whitespace-only expression', () => {
    const { evaluator } = createCalculusEvaluator('   ');
    expect(evaluator(1)).toBeNaN();
  });
});

describe('Riemann sum computation', () => {
  it('approximates integral of x^2 on [0,1] with n=1000 within 0.001 of 1/3', () => {
    const evaluator = (x: number) => x * x;
    const result = computeRiemannSum(evaluator, 0, 1, 1000);
    expect(Math.abs(result - 1 / 3)).toBeLessThan(0.001);
  });

  it('returns signed area (negative when f(x) < 0)', () => {
    const evaluator = () => -1; // constant -1
    const result = computeRiemannSum(evaluator, 0, 2, 10);
    expect(result).toBeCloseTo(-2, 5);
  });

  it('returns NaN when any sampled rectangle hits an undefined value', () => {
    const evaluator = (x: number) => (x === 0 ? NaN : x * x);
    expect(computeRiemannSum(evaluator, 0, 1, 100)).toBeNaN();
  });

  it('returns 0 for zero-width interval', () => {
    const evaluator = (x: number) => x * x;
    const result = computeRiemannSum(evaluator, 2, 2, 10);
    expect(result).toBeCloseTo(0, 10);
  });
});


describe('Maths Lab numerical credibility', () => {
  it('accepts a valid expression even when its domain excludes x = 1', () => {
    const { evaluator, error } = createCalculusEvaluator('sqrt(x - 2)');
    expect(error).toBe('');
    expect(evaluator(1)).toBeNaN();
    expect(evaluator(3)).toBeCloseTo(1, 8);
  });

  it('rejects invalid Riemann partition counts', () => {
    expect(computeRiemannSum((x) => x, 0, 1, 0)).toBeNaN();
    expect(computeRiemannSum((x) => x, 0, 1, 2.5)).toBeNaN();
  });

  it('does not report a discontinuity sign change as a root', () => {
    expect(findRootsNumerical((x) => 1 / x, -1, 1, 20)).toEqual([]);
    expect(findRootBisection((x) => (x === 0 ? NaN : 1 / x), -1, 1)).toBeNaN();
  });

  it('only recognises special constants at a strict tolerance', () => {
    expect(getExactLaTeX(Math.PI)).toBe('\\pi');
    expect(getExactLaTeX(Math.PI + 0.005)).not.toBe('\\pi');
  });
});