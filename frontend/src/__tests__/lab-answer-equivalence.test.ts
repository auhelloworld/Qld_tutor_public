import { describe, expect, it } from 'vitest';
import {
  answersEquivalent,
  expressionsEquivalent,
  parseExpressionText,
} from '../lib/lab-answer-equivalence';

describe('lab-answer-equivalence parser', () => {
  it('parses numbers, constants and basic arithmetic', () => {
    expect(parseExpressionText('3 + 4*2')?.evaluate({})).toBe(11);
    expect(parseExpressionText('(1+2)/4')?.evaluate({})).toBe(0.75);
    expect(parseExpressionText('2^3^2')?.evaluate({})).toBe(512);
    expect(parseExpressionText('pi')?.evaluate({})).toBeCloseTo(Math.PI, 12);
  });

  it('supports implicit multiplication and bare square roots', () => {
    expect(parseExpressionText('2x', ['x'])?.evaluate({ x: 5 })).toBe(10);
    expect(parseExpressionText('3(x+1)', ['x'])?.evaluate({ x: 2 })).toBe(9);
    expect(parseExpressionText('√2')?.evaluate({})).toBeCloseTo(Math.SQRT2, 12);
    expect(parseExpressionText('2π')?.evaluate({})).toBeCloseTo(2 * Math.PI, 12);
  });

  it('rejects unknown identifiers instead of inventing variables', () => {
    expect(parseExpressionText('4abc')).toBeNull();
    expect(parseExpressionText('4xyz', ['x'])).toBeNull();
    expect(parseExpressionText('2x', [])).toBeNull();
  });

  it('rejects malformed input and unsupported characters', () => {
    expect(parseExpressionText('')).toBeNull();
    expect(parseExpressionText('2 +')).toBeNull();
    expect(parseExpressionText('(1+2')).toBeNull();
    expect(parseExpressionText('1)')).toBeNull();
    expect(parseExpressionText('x = 3', ['x'])).toBeNull();
    expect(parseExpressionText('sin')).toBeNull();
  });

  it('never evaluates arbitrary code', () => {
    expect(parseExpressionText('process')).toBeNull();
    expect(parseExpressionText('globalThis')).toBeNull();
    expect(parseExpressionText('constructor')).toBeNull();
    expect(parseExpressionText('__proto__')).toBeNull();
  });

  it('bounds pathological input', () => {
    expect(parseExpressionText('1+'.repeat(400) + '1')).toBeNull();
    expect(parseExpressionText('('.repeat(60) + '1' + ')'.repeat(60))).toBeNull();
  });
});

describe('expressionsEquivalent', () => {
  it('accepts algebraically equal linear expressions', () => {
    expect(expressionsEquivalent('2x-3', '-3+2x', { variables: ['x'] })).toBe(true);
    expect(expressionsEquivalent('2*x - 3', '2x-3', { variables: ['x'] })).toBe(true);
    expect(expressionsEquivalent('x/2', '0.5x', { variables: ['x'] })).toBe(true);
  });

  it('accepts expanded and factorised forms of the same polynomial', () => {
    expect(
      expressionsEquivalent('3x^2-12x+9', '3(x-1)(x-3)', { variables: ['x'] }),
    ).toBe(true);
    expect(
      expressionsEquivalent('(x+2)^2', 'x^2+4x+4', { variables: ['x'] }),
    ).toBe(true);
  });

  it('rejects expressions that only agree at some points', () => {
    expect(expressionsEquivalent('2x', 'x^2', { variables: ['x'] })).toBe(false);
    expect(expressionsEquivalent('2x-3', '2x+3', { variables: ['x'] })).toBe(false);
  });

  it('compares constant answers exactly enough to reject rounded decimals', () => {
    expect(expressionsEquivalent('8pi', '8π')).toBe(true);
    expect(expressionsEquivalent('25.13', '8π')).toBe(false);
    expect(expressionsEquivalent('1/3', '0.3333333333333333')).toBe(true);
    expect(expressionsEquivalent('0.33', '1/3')).toBe(false);
  });

  it('handles trigonometric and logarithmic rewrites', () => {
    expect(
      expressionsEquivalent('sin(x)^2+cos(x)^2', '1', { variables: ['x'] }),
    ).toBe(true);
    expect(expressionsEquivalent('ln(e)', '1')).toBe(true);
    expect(expressionsEquivalent('log(100)', '2')).toBe(true);
  });

  it('returns false rather than throwing for unparseable answers', () => {
    expect(expressionsEquivalent('yes', '1')).toBe(false);
    expect(expressionsEquivalent('1', 'quadrant iv')).toBe(false);
    expect(expressionsEquivalent('', '1')).toBe(false);
  });

  it('requires enough jointly defined sample points', () => {
    // ln(x) is undefined across the negative half of the default domain, but
    // the shared samples that do exist must still agree.
    expect(expressionsEquivalent('ln(x)', 'ln(x)', { variables: ['x'], sampleDomain: [0.5, 4] })).toBe(true);
    expect(expressionsEquivalent('1/(x-x)', '0', { variables: ['x'] })).toBe(false);
  });
});

describe('answersEquivalent tuple handling', () => {
  it('compares coordinate pairs component by component', () => {
    expect(answersEquivalent('(0.5, 3)', '1/2, 3')).toBe(true);
    expect(answersEquivalent('3, 3.5', '(3, 7/2)')).toBe(true);
    expect(answersEquivalent('3, 4', '4, 3')).toBe(false);
  });

  it('rejects mismatched arity', () => {
    expect(answersEquivalent('1, 2', '1')).toBe(false);
    expect(answersEquivalent('1', '1, 2')).toBe(false);
  });

  it('falls back to single-expression comparison', () => {
    expect(answersEquivalent('6/2', '3')).toBe(true);
  });
});
