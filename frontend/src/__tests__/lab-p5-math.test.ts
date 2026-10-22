import { describe, expect, it } from 'vitest';
import {
  fiveNumberSummary,
  treeProbWithoutReplacement,
  twoWayNeither,
} from '../components/lab/StatisticsTab';
import {
  similarityScaleFactor,
  scaleSides,
} from '../components/lab/GeometryExtensionsLab';

// ─── J1: Box Plot / Five-Number Summary ──────────────────────────────────────

describe('fiveNumberSummary', () => {
  it('computes the five-number summary for an odd-length dataset', () => {
    const result = fiveNumberSummary([3, 5, 7, 8, 12, 14, 16]);
    expect(result.min).toBe(3);
    expect(result.q1).toBe(5);
    expect(result.median).toBe(8);
    expect(result.q3).toBe(14);
    expect(result.max).toBe(16);
  });

  it('computes the five-number summary for an even-length dataset', () => {
    const result = fiveNumberSummary([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.min).toBe(1);
    expect(result.median).toBe(4.5);
    // Lower half: 1,2,3,4 → median = 2.5
    expect(result.q1).toBe(2.5);
    // Upper half: 5,6,7,8 → median = 6.5
    expect(result.q3).toBe(6.5);
    expect(result.max).toBe(8);
  });

  it('handles an empty array gracefully', () => {
    const result = fiveNumberSummary([]);
    expect(result.min).toBe(0);
    expect(result.q1).toBe(0);
    expect(result.median).toBe(0);
    expect(result.q3).toBe(0);
    expect(result.max).toBe(0);
  });

  it('handles a single-element array', () => {
    const result = fiveNumberSummary([42]);
    expect(result.min).toBe(42);
    expect(result.q1).toBe(42);
    expect(result.median).toBe(42);
    expect(result.q3).toBe(42);
    expect(result.max).toBe(42);
  });

  it('handles unsorted input by sorting internally', () => {
    const result = fiveNumberSummary([16, 3, 14, 5, 7, 12, 8]);
    expect(result.min).toBe(3);
    expect(result.max).toBe(16);
    expect(result.median).toBe(8);
  });

  it('IQR equals Q3 minus Q1', () => {
    const result = fiveNumberSummary([3, 5, 7, 8, 12, 14, 16]);
    expect(result.q3 - result.q1).toBe(9);
  });
});

// ─── J2: Tree Diagram / Two-Way Table Probability ────────────────────────────

describe('treeProbWithoutReplacement', () => {
  it('computes P(both red) for 3R, 2B without replacement', () => {
    // P(RR) = 3/5 * 2/4 = 6/20 = 3/10
    const result = treeProbWithoutReplacement([3, 2], [0, 0]);
    expect(result).toBeCloseTo(3 / 10, 10);
  });

  it('computes P(red then blue) for 3R, 2B without replacement', () => {
    // P(RB) = 3/5 * 2/4 = 6/20 = 3/10
    const result = treeProbWithoutReplacement([3, 2], [0, 1]);
    expect(result).toBeCloseTo(6 / 20, 10);
  });

  it('computes P(blue then blue) for 3R, 2B without replacement', () => {
    // P(BB) = 2/5 * 1/4 = 2/20 = 1/10
    const result = treeProbWithoutReplacement([3, 2], [1, 1]);
    expect(result).toBeCloseTo(1 / 10, 10);
  });

  it('returns 0 for empty counts', () => {
    expect(treeProbWithoutReplacement([], [0])).toBe(0);
  });

  it('returns 0 for empty draws', () => {
    expect(treeProbWithoutReplacement([3, 2], [])).toBe(0);
  });

  it('returns 0 for invalid index (out of bounds)', () => {
    expect(treeProbWithoutReplacement([3, 2], [5])).toBe(0);
  });

  it('returns 0 when drawing more than available', () => {
    // Try to draw 3 blue from only 2 blue
    expect(treeProbWithoutReplacement([3, 2], [1, 1, 1])).toBe(0);
  });

  it('handles three categories', () => {
    // 2R, 3G, 5B. P(R then G) = 2/10 * 3/9 = 6/90 = 1/15
    const result = treeProbWithoutReplacement([2, 3, 5], [0, 1]);
    expect(result).toBeCloseTo(1 / 15, 10);
  });
});

describe('twoWayNeither', () => {
  it('computes "neither" correctly for the sport/music example', () => {
    // Total=40, Sport=25, Music=20, Both=15 → Neither=10
    expect(twoWayNeither(40, 25, 20, 15)).toBe(10);
  });

  it('returns 0 when union covers the total', () => {
    expect(twoWayNeither(10, 7, 8, 5)).toBe(0);
  });

  it('returns 0 for invalid total (zero or negative)', () => {
    expect(twoWayNeither(0, 5, 3, 2)).toBe(0);
    expect(twoWayNeither(-1, 5, 3, 2)).toBe(0);
  });

  it('handles the case where no one does both', () => {
    // Total=20, A=8, B=7, Both=0 → Union=15, Neither=5
    expect(twoWayNeither(20, 8, 7, 0)).toBe(5);
  });

  it('clamps to 0 if union exceeds total (invalid input)', () => {
    // Union > Total would give negative neither; clamped to 0
    expect(twoWayNeither(5, 10, 10, 0)).toBe(0);
  });
});

// ─── J3: Distance–Time Graph and Average Speed ───────────────────────────────

describe('distance-time average speed (inline)', () => {
  // averageSpeed is a trivial formula (distance/time), but we test the logic
  // that the activity exercises, confirming the expected answers are correct.
  function averageSpeed(distance: number, time: number): number {
    if (time <= 0) return 0;
    return distance / time;
  }

  it('computes average speed for constant speed journey', () => {
    expect(averageSpeed(30, 2)).toBe(15);
  });

  it('computes average speed including rest time', () => {
    // 40km + 20km in total 2 hours
    expect(averageSpeed(60, 2)).toBe(30);
  });

  it('returns 0 for zero or negative time', () => {
    expect(averageSpeed(100, 0)).toBe(0);
    expect(averageSpeed(100, -1)).toBe(0);
  });

  it('handles zero distance', () => {
    expect(averageSpeed(0, 5)).toBe(0);
  });
});

// ─── J4: Similarity and Congruence ───────────────────────────────────────────

describe('similarityScaleFactor', () => {
  it('computes scale factor from original to image', () => {
    expect(similarityScaleFactor(3, 6)).toBe(2);
  });

  it('returns 1 for congruent triangles', () => {
    expect(similarityScaleFactor(25, 25)).toBe(1);
  });

  it('returns 0 for zero original side (invalid)', () => {
    expect(similarityScaleFactor(0, 10)).toBe(0);
  });

  it('handles scale factor < 1 (reduction)', () => {
    expect(similarityScaleFactor(10, 5)).toBe(0.5);
  });

  it('returns 0 for negative original side', () => {
    expect(similarityScaleFactor(-3, 6)).toBe(0);
  });
});

describe('scaleSides', () => {
  it('scales a 3-4-5 triangle by factor 2', () => {
    expect(scaleSides([3, 4, 5], 2)).toEqual([6, 8, 10]);
  });

  it('scales by factor 1 (congruent, no change)', () => {
    expect(scaleSides([7, 24, 25], 1)).toEqual([7, 24, 25]);
  });

  it('scales by fractional factor', () => {
    const result = scaleSides([10, 20, 30], 0.5);
    expect(result).toEqual([5, 10, 15]);
  });

  it('scales by factor 0 yields all zeros', () => {
    expect(scaleSides([3, 4, 5], 0)).toEqual([0, 0, 0]);
  });
});
