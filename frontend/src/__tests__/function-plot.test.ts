import { describe, expect, it } from 'vitest';
import { compileFunction, parseDomain } from '../lib/function-plot';

const near = (a: number | null, b: number, eps = 1e-9) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThan(eps);
};

describe('function-plot: string expressions (fixes the latent render bug)', () => {
  it('evaluates a labelled linear string like "f(x) = 2*x"', () => {
    const f = compileFunction('f(x) = 2*x');
    expect(f).not.toBeNull();
    near(f!(3), 6);
    near(f!(-2), -4);
  });

  it('evaluates exponentials, logs, trig and constants', () => {
    near(compileFunction('e^x')!(0), 1);
    near(compileFunction('exp(x)')!(1), Math.E);
    near(compileFunction('ln(x)')!(Math.E), 1);
    near(compileFunction('log10(x)')!(1000), 3);
    near(compileFunction('sin(x)')!(Math.PI / 2), 1);
    near(compileFunction('cos(x)')!(0), 1);
    near(compileFunction('2*x^2 + 3*x - 1')!(2), 13);
    near(compileFunction('sqrt(x)')!(9), 3);
  });

  it('respects operator precedence and right-associative power', () => {
    near(compileFunction('1 + 2*3')!(0), 7);
    near(compileFunction('2^3^2')!(0), 512); // 2^(3^2) = 2^9
    near(compileFunction('-x^2')!(3), -9);   // unary minus binds below power
  });

  it('returns null outside the domain in "expr for a<=x<=b"', () => {
    const f = compileFunction('20*x for 0<=x<=2');
    near(f!(1), 20);
    expect(f!(3)).toBeNull();
    expect(f!(-1)).toBeNull();
  });

  it('returns null where a function is undefined (ln of non-positive)', () => {
    const f = compileFunction('ln(x)');
    expect(f!(-1)).toBeNull();
    expect(f!(0)).toBeNull();
  });

  it('rejects unknown identifiers and bad syntax safely (no throw)', () => {
    expect(compileFunction('foo(x)')).toBeNull();
    expect(compileFunction('2 + * 3')).toBeNull();
    expect(compileFunction('x +')).toBeNull();
  });
});

describe('function-plot: kind-based specs', () => {
  it('linear and quadratic match the legacy behaviour', () => {
    near(compileFunction({ kind: 'linear', m: 3, b: -1 })!(2), 5);
    near(compileFunction({ kind: 'quadratic', a: 1, b: 0, c: 0 })!(4), 16);
  });

  it('exponential, logarithmic, sine, reciprocal, normal_pdf', () => {
    near(compileFunction({ kind: 'exponential' })!(1), Math.E); // a=1, base=e, k=1
    near(compileFunction({ kind: 'logarithmic' })!(Math.E), 1);
    near(compileFunction({ kind: 'sine', a: 2, b: 1, c: 0, d: 0 })!(Math.PI / 2), 2);
    expect(compileFunction({ kind: 'reciprocal', a: 1, h: 0, k: 0 })!(0)).toBeNull(); // asymptote
    near(compileFunction({ kind: 'reciprocal', a: 1, h: 0, k: 0 })!(2), 0.5);
    // normal pdf peak at x = mu equals 1/(sigma*sqrt(2pi))
    near(compileFunction({ kind: 'normal_pdf', mu: 0, sigma: 1 })!(0), 1 / Math.sqrt(2 * Math.PI));
  });

  it('treats a points-only spec as a non-function (null)', () => {
    expect(compileFunction({ points: [{ x: 0, y: 0 }] })).toBeNull();
  });

  it('supports {expr, domain} objects', () => {
    const f = compileFunction({ expr: 'x^2', domain: '0<=x<=3' });
    near(f!(2), 4);
    expect(f!(5)).toBeNull();
  });

  it('supports the legacy lesson-content {expression} alias', () => {
    const f = compileFunction({ expression: 'x^2 - 2*x - 3' });
    near(f!(3), 0);
    near(f!(0), -3);
  });
});

describe('function-plot: parseDomain', () => {
  it('parses one- and two-sided inequalities', () => {
    expect(parseDomain('x<0')!(-1)).toBe(true);
    expect(parseDomain('x<0')!(1)).toBe(false);
    expect(parseDomain('x>=2')!(2)).toBe(true);
    const d = parseDomain('0<=x<=2')!;
    expect(d(0)).toBe(true);
    expect(d(2)).toBe(true);
    expect(d(2.1)).toBe(false);
    const open = parseDomain('0<x<2')!;
    expect(open(0)).toBe(false);
    expect(open(1)).toBe(true);
  });
  it('returns null for unparseable domains', () => {
    expect(parseDomain('y>3')).toBeNull();
    expect(parseDomain('nonsense')).toBeNull();
  });
});
