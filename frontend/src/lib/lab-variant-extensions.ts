/**
 * Deterministic variant generators for the `extension` step of every Lab activity.
 *
 * Why this file exists
 * --------------------
 * The original variant support covered ten activities and only re-rolled numbers,
 * so pressing "New numbers" produced the same cognitive task with different digits.
 * These generators additionally rotate the *question form* — forward, reverse,
 * true/false and counter-example style — so a repeat is a genuinely new problem.
 *
 * Contracts every generator here must keep:
 * - Pure and deterministic: the same seed gives the same step.
 * - The prompt only mentions quantities the scene already shows, or quantities the
 *   scene does not render at all, so canvas and prompt can never disagree.
 * - Every answer is computed from the same parameters that appear in the prompt.
 * - `tier: 'extension'` is always set.
 */

import type { LearnStep, LabSceneData } from './lab-activities';

// ─── Small helpers ───────────────────────────────────────────────────────────

export interface VariantRng {
  random: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(arr: readonly T[]) => T;
}

function round(v: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a || 1;
}

/** Render `n/d` in lowest terms, as a whole number when the division is exact. */
function fraction(n: number, d: number): string {
  const g = gcd(n, d);
  let num = n / g;
  let den = d / g;
  if (den < 0) {
    num = -num;
    den = -den;
  }
  return den === 1 ? String(num) : `${num}/${den}`;
}

/** Coordinate-pair answer variants accepted by the exact-match layer. */
function pointAnswers(x: number, y: number): string[] {
  return [`${x}, ${y}`, `(${x}, ${y})`, `${x},${y}`, `(${x},${y})`];
}

/** Signed term such as `- 4` / `+ 9`, for readable prompts. */
function signed(v: number): string {
  return v < 0 ? `- ${Math.abs(v)}` : `+ ${v}`;
}

/** Build the right-hand side `mx + c` as a compact expression string. */
function linearRhs(m: number, c: number, name = 'x'): string {
  const slope = m === 1 ? name : m === -1 ? `-${name}` : `${m}${name}`;
  if (c === 0) return slope;
  return `${slope} ${c < 0 ? '-' : '+'} ${Math.abs(c)}`;
}

/** Monomial `k t^p` with the conventional shortcuts for k = 1 and p = 1. */
function monomial(coefficientNumerator: number, coefficientDenominator: number, power: number, name = 't'): string {
  const coefficient = fraction(coefficientNumerator, coefficientDenominator);
  const varPart = power === 0 ? '' : power === 1 ? name : `${name}^${power}`;
  if (!varPart) return coefficient;
  if (coefficient === '1') return varPart;
  if (coefficient === '-1') return `-${varPart}`;
  return `${coefficient}${varPart}`;
}

const PYTH_TRIPLES: readonly [number, number, number][] = [
  [3, 4, 5],
  [5, 12, 13],
  [8, 15, 17],
  [7, 24, 25],
  [6, 8, 10],
  [9, 12, 15],
  [20, 21, 29],
];

/** One-sided empirical-rule areas, in per cent, for z = 0, 1, 2, 3. */
const EMPIRICAL_ONE_SIDED = [0, 34, 47.5, 49.85] as const;

function extensionStep(step: Omit<LearnStep, 'tier'>): LearnStep {
  return { ...step, tier: 'extension' };
}

/**
 * Generator signature. `core` is the already-generated list of core steps, so an
 * extension can build on the same numbers the student has just worked with.
 */
export type ExtensionGenerator = (rng: VariantRng, core: LearnStep[]) => LearnStep;

function sceneOf(core: LearnStep[], index: number): LabSceneData | undefined {
  return core[index]?.sceneData;
}

// ─── Explorer ────────────────────────────────────────────────────────────────

const explorerQuadrant: ExtensionGenerator = (rng) => {
  const cases = [
    { product: '<', second: 'b > a', quadrant: 'II', roman: 'II', digit: '2', why: 'ab < 0 needs opposite signs (Quadrant II or IV); only Quadrant II has the larger y-coordinate.' },
    { product: '<', second: 'a > b', quadrant: 'IV', roman: 'IV', digit: '4', why: 'ab < 0 needs opposite signs (Quadrant II or IV); only Quadrant IV has the larger x-coordinate.' },
    { product: '>', second: 'a + b > 0', quadrant: 'I', roman: 'I', digit: '1', why: 'ab > 0 means both coordinates share a sign, and a positive sum makes them both positive.' },
    { product: '>', second: 'a + b < 0', quadrant: 'III', roman: 'III', digit: '3', why: 'ab > 0 means both coordinates share a sign, and a negative sum makes them both negative.' },
  ] as const;
  const c = rng.pick(cases);
  return extensionStep({
    prompt: `Extension: a point (a, b) satisfies ab ${c.product} 0 and ${c.second}. Which quadrant must it be in?`,
    type: 'predict',
    acceptedAnswers: [c.roman, c.digit, `Quadrant ${c.roman}`, `quadrant ${c.digit}`],
    feedbackCorrect: `Correct! ${c.why}`,
    feedbackIncorrect: `${c.why} So the answer is Quadrant ${c.roman}.`,
    hint: 'Use the sign of the product to narrow it to two quadrants, then apply the second condition.',
  });
};

/** Count lattice points on the circle x² + y² = r². */
function latticePointCount(r: number): number {
  let count = 0;
  for (let x = -r; x <= r; x += 1) {
    const ySquared = r * r - x * x;
    const y = Math.round(Math.sqrt(ySquared));
    if (y * y === ySquared) count += y === 0 ? 1 : 2;
  }
  return count;
}

const explorerDistance: ExtensionGenerator = (rng) => {
  if (rng.random() < 0.5) {
    const r = rng.pick([5, 13, 25] as const);
    const count = latticePointCount(r);
    return extensionStep({
      prompt: `Extension: how many points with integer coordinates lie exactly ${r} units from the origin?`,
      type: 'answer',
      acceptedAnswers: [String(count)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! x² + y² = ${r * r} has ${count} integer solutions once every sign and order change is counted.`,
      feedbackIncorrect: `Solve x² + y² = ${r * r} over the integers, then count sign and order variations: there are ${count}.`,
      hint: 'Find the non-negative solutions first, then count the sign and order variations of each.',
      sceneData: { kind: 'distance-from-origin', point: [r, 0] },
    });
  }
  const t = rng.pick(PYTH_TRIPLES);
  return extensionStep({
    prompt: `Extension: a point with positive whole-number coordinates is ${t[2]} units from the origin and its x-coordinate is ${t[0]}. What is its y-coordinate?`,
    type: 'answer',
    acceptedAnswers: [String(t[1])],
    tolerance: 0.01,
    feedbackCorrect: `Correct! ${t[0]}² + y² = ${t[2]}² gives y² = ${t[2] ** 2 - t[0] ** 2}, so y = ${t[1]}.`,
    feedbackIncorrect: `Rearrange the distance formula: y² = ${t[2]}² − ${t[0]}² = ${t[2] ** 2 - t[0] ** 2}, so y = ${t[1]}.`,
    hint: 'Use the distance formula in reverse and solve for the unknown coordinate.',
    sceneData: { kind: 'distance-from-origin', point: [t[0], t[1]] },
  });
};

const explorerTwoPoint: ExtensionGenerator = (rng, core) => {
  const scene = sceneOf(core, 0);
  const p = scene && scene.kind === 'two-point-measures' ? scene.p : ([-2, -3] as [number, number]);
  const q = scene && scene.kind === 'two-point-measures' ? scene.q : ([3, 9] as [number, number]);
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const n = rng.int(1, 3);
  const rx = q[0] + n * dx;
  const ry = q[1] + n * dy;
  return extensionStep({
    prompt: `Extension: R(k, ${ry}) lies on the same straight line as P and Q. Find k.`,
    type: 'answer',
    acceptedAnswers: [String(rx)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! The gradient of PQ is ${fraction(dy, dx)}, and (${ry} − ${q[1]})/(k − ${q[0]}) matches it only when k = ${rx}.`,
    feedbackIncorrect: `Collinear points share one gradient: (${ry} − ${q[1]})/(k − ${q[0]}) = ${fraction(dy, dx)} gives k = ${rx}.`,
    hint: 'Set the gradient from Q to R equal to the gradient of PQ.',
    sceneData: { kind: 'two-point-measures', p, q },
  });
};

// ─── Sandbox ─────────────────────────────────────────────────────────────────

const sandboxGradient: ExtensionGenerator = (rng) => {
  const m = rng.pick([2, 3, 4, -2, -3] as const);
  const c = rng.int(-6, 6);
  const x1 = rng.int(1, 4);
  const x2 = x1 + rng.int(2, 4);
  const y1 = m * x1 + c;
  const y2 = m * x2 + c;
  if (rng.random() < 0.5) {
    return extensionStep({
      prompt: `Extension: a line passes through (${x1}, ${y1}) and (${x2}, ${y2}). Writing it as y = mx + c, what is c?`,
      type: 'answer',
      acceptedAnswers: [String(c)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! m = (${y2} − ${y1})/(${x2} − ${x1}) = ${m}, then ${y1} = ${m}(${x1}) + c gives c = ${c}.`,
      feedbackIncorrect: `Find the gradient first: m = ${m}. Substituting one point gives ${y1} = ${m}(${x1}) + c, so c = ${c}.`,
      hint: 'You need the gradient before you can find the intercept.',
    });
  }
  return extensionStep({
    prompt: `Extension: a line passes through (${x1}, ${y1}) and (${x2}, ${y2}). What is its gradient?`,
    type: 'answer',
    acceptedAnswers: [String(m)],
    tolerance: 0.01,
    feedbackCorrect: `Correct! m = (${y2} − ${y1})/(${x2} − ${x1}) = ${m}.`,
    feedbackIncorrect: `Use m = (y₂ − y₁)/(x₂ − x₁) = (${y2} − ${y1})/(${x2} − ${x1}) = ${m}.`,
    hint: 'Divide the change in y by the change in x, keeping the order of the points consistent.',
  });
};

const sandboxVertex: ExtensionGenerator = (rng) => {
  const b = rng.pick([-6, -4, -2, 2, 4, 6] as const);
  const touchingC = (b * b) / 4;
  if (rng.random() < 0.5) {
    return extensionStep({
      prompt: `Extension: for which value of c does y = x² ${signed(b)}x + c touch the x-axis exactly once?`,
      type: 'answer',
      acceptedAnswers: [String(touchingC)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! One solution needs b² − 4ac = 0, so ${b * b} − 4c = 0 and c = ${touchingC}.`,
      feedbackIncorrect: `A single x-intercept means the discriminant is zero: ${b * b} − 4c = 0, so c = ${touchingC}.`,
      hint: 'One x-intercept means the vertex sits on the x-axis.',
    });
  }
  const c = rng.int(-4, 6);
  const minimum = c - (b * b) / 4;
  return extensionStep({
    prompt: `Extension: what is the smallest value that y = x² ${signed(b)}x ${signed(c)} can take?`,
    type: 'answer',
    acceptedAnswers: [String(round(minimum, 4))],
    tolerance: 0.01,
    feedbackCorrect: `Correct! The vertex is at x = ${-b / 2}, where y = ${minimum}.`,
    feedbackIncorrect: `The minimum is the y-value of the vertex: x = ${-b / 2} gives y = ${minimum}.`,
    hint: 'The smallest value of an upward parabola is its vertex y-value, not its y-intercept.',
  });
};

const sandboxIntercept: ExtensionGenerator = (rng) => {
  // Even b values make the discriminant a multiple of 4, so the
  // "exactly one x-intercept" form below has an integer answer.
  const b = rng.pick([-7, -6, -5, -4, -3, 3, 4, 5, 6, 7] as const);
  const c = rng.int(1, 8);
  const discriminant = b * b - 4 * c;
  if (discriminant % 4 === 0 && rng.random() < 0.5) {
    const k = discriminant / 4;
    return extensionStep({
      prompt: `Extension: for which value of k does y = x² ${signed(b)}x ${signed(c)} + k have exactly one x-intercept?`,
      type: 'answer',
      acceptedAnswers: [String(k)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! The discriminant is ${b * b} − 4(${c} + k) = 0 when k = ${k}.`,
      feedbackIncorrect: `Set the discriminant to zero: ${b * b} − 4(${c} + k) = 0, so k = ${k}.`,
      hint: 'Adding k lifts the whole parabola. When does the discriminant reach zero?',
    });
  }
  const smallestK = Math.floor(discriminant / 4) + 1;
  return extensionStep({
    prompt: `Extension: what is the smallest integer k for which y = x² ${signed(b)}x ${signed(c)} + k has no x-intercepts?`,
    type: 'answer',
    acceptedAnswers: [String(smallestK)],
    tolerance: 0.01,
    feedbackCorrect: `Correct! ${b * b} − 4(${c} + k) < 0 requires k > ${round(discriminant / 4, 4)}, so the smallest integer is ${smallestK}.`,
    feedbackIncorrect: `No x-intercepts means ${b * b} − 4(${c} + k) < 0, that is k > ${round(discriminant / 4, 4)}. The smallest integer is ${smallestK}.`,
    hint: 'Adding k lifts the whole parabola. Ask when the discriminant becomes negative.',
  });
};

const sandboxSimultaneous: ExtensionGenerator = (rng, core) => {
  // Read the lines the student has just worked with so the extension cannot
  // contradict a regenerated core.
  const scene = sceneOf(core, 0);
  const lines =
    scene && scene.kind === 'line-system'
      ? scene
      : { first: { m: 2, c: 1 }, second: { m: -1, c: 7 } };
  const first = `y = ${lines.first.m === 1 ? 'x' : lines.first.m === -1 ? '-x' : `${lines.first.m}x`}${lines.first.c === 0 ? '' : ` ${lines.first.c < 0 ? '-' : '+'} ${Math.abs(lines.first.c)}`}`;
  const second = `y = ${lines.second.m === 1 ? 'x' : lines.second.m === -1 ? '-x' : `${lines.second.m}x`}${lines.second.c === 0 ? '' : ` ${lines.second.c < 0 ? '-' : '+'} ${Math.abs(lines.second.c)}`}`;
  const x = (lines.second.c - lines.first.c) / (lines.first.m - lines.second.m);
  const y = lines.first.m * x + lines.first.c;

  // Asking for the gradient through the origin needs a non-zero x-coordinate and
  // a tidy fraction, otherwise a reasonable decimal answer would be rejected.
  const gradientDenominator = x === 0 ? 0 : Math.abs(x) / gcd(Math.abs(y), Math.abs(x));
  const tidyGradient = x !== 0 && gradientDenominator <= 4;
  const form = tidyGradient ? rng.int(0, 2) : rng.int(1, 2);
  if (form === 0) {
    const m = round(y / x, 4);
    return extensionStep({
      prompt: `Extension: a line y = mx through the origin also passes through the intersection of ${first} and ${second}. Find m.`,
      type: 'answer',
      acceptedAnswers: [String(m), fraction(y, x)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The intersection is (${x}, ${y}), so ${y} = ${x}m and m = ${fraction(y, x)}.`,
      feedbackIncorrect: `The two lines meet at (${x}, ${y}). Substituting into y = mx gives m = ${fraction(y, x)}.`,
      hint: 'You already know where the first two lines meet; that point must satisfy y = mx.',
    });
  }
  if (form === 1) {
    const c = rng.int(-6, 6);
    return extensionStep({
      prompt: `Extension: for which value of k do ${first} and y = kx ${signed(c)} have no solution at all?`,
      type: 'answer',
      acceptedAnswers: [String(lines.first.m)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! No solution means the lines are parallel but distinct, so k must equal the gradient ${lines.first.m}.`,
      feedbackIncorrect: `Two lines have no common point when they are parallel and distinct, so k = ${lines.first.m}.`,
      hint: 'Think about what has to happen graphically for two straight lines never to meet.',
    });
  }
  const reflections = [
    { name: 'the x-axis', x, y: -y, rule: 'reflection in the x-axis negates y' },
    { name: 'the y-axis', x: -x, y, rule: 'reflection in the y-axis negates x' },
    { name: 'the line y = x', x: y, y: x, rule: 'reflection in y = x swaps the coordinates' },
  ] as const;
  const r = rng.pick(reflections);
  return extensionStep({
    prompt: `Extension: the intersection of ${first} and ${second} is reflected in ${r.name}. What is the image? Enter x, y.`,
    type: 'answer',
    acceptedAnswers: pointAnswers(r.x, r.y),
    feedbackCorrect: `Correct! The intersection is (${x}, ${y}) and ${r.rule}, giving (${r.x}, ${r.y}).`,
    feedbackIncorrect: `First solve the system to get (${x}, ${y}); then ${r.rule}, giving (${r.x}, ${r.y}).`,
    hint: 'Solve the system first, then apply the transformation to that single point.',
  });
};

const sandboxInequality: ExtensionGenerator = (rng, core) => {
  const scene = sceneOf(core, 0);
  const bounds =
    scene && scene.kind === 'line-system'
      ? scene
      : { first: { m: 1, c: 1 }, second: { m: -1, c: 5 } };
  const lower = bounds.first;
  const upper = bounds.second;
  const lowerText = `y ≥ ${lower.m === 1 ? 'x' : lower.m === -1 ? '-x' : `${lower.m}x`}${lower.c === 0 ? '' : ` ${lower.c < 0 ? '-' : '+'} ${Math.abs(lower.c)}`}`;
  const upperText = `y ≤ ${upper.m === 1 ? 'x' : upper.m === -1 ? '-x' : `${upper.m}x`}${upper.c === 0 ? '' : ` ${upper.c < 0 ? '-' : '+'} ${Math.abs(upper.c)}`}`;
  const xi = (upper.c - lower.c) / (lower.m - upper.m);
  const yi = lower.m * xi + lower.c;

  // The x >= 0 region is a triangle only when the boundaries cross at x >= 0 and
  // the lower boundary starts below the upper one.
  const bounded = xi > 0 && lower.c < upper.c;
  if (bounded && rng.random() < 0.5) {
    const corners: [number, number][] = [[0, lower.c], [0, upper.c], [xi, yi]];
    const a = rng.int(1, 4);
    const b = rng.int(1, 3);
    const objective = `${a === 1 ? 'x' : `${a}x`} + ${b === 1 ? 'y' : `${b}y`}`;
    const values = corners.map(([x, y]) => round(a * x + b * y, 4));
    const wantMax = rng.random() < 0.5;
    const target = wantMax ? Math.max(...values) : Math.min(...values);
    const cornerText = corners.map(([x, y]) => `(${round(x, 4)}, ${round(y, 4)})`).join(', ');
    return extensionStep({
      prompt: `Extension: over the region ${lowerText}, ${upperText} and x ≥ 0, what is the ${wantMax ? 'largest' : 'smallest'} value of ${objective}?`,
      type: 'answer',
      acceptedAnswers: [String(target)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The corners are ${cornerText}, giving ${values.join(', ')}. The ${wantMax ? 'maximum' : 'minimum'} is ${target}.`,
      feedbackIncorrect: `Test the corners ${cornerText}: the values are ${values.join(', ')}, so the ${wantMax ? 'maximum' : 'minimum'} is ${target}.`,
      hint: 'For a linear expression the extreme value always occurs at a corner of the region.',
    });
  }

  // Always-valid alternative: the tallest feasible point on a vertical slice.
  const xSlice = bounded ? Math.max(0, Math.floor(xi)) : 0;
  const highest = round(upper.m * xSlice + upper.c, 4);
  const lowest = round(lower.m * xSlice + lower.c, 4);
  const askHighest = rng.random() < 0.5;
  return extensionStep({
    prompt: `Extension: at x = ${xSlice}, what is the ${askHighest ? 'largest' : 'smallest'} y-value that satisfies both ${lowerText} and ${upperText}?`,
    type: 'answer',
    acceptedAnswers: [String(askHighest ? highest : lowest)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! At x = ${xSlice} the feasible y-values run from ${lowest} up to ${highest}.`,
    feedbackIncorrect: `Substitute x = ${xSlice} into both boundaries: y runs from ${lowest} to ${highest}, so the answer is ${askHighest ? highest : lowest}.`,
    hint: 'Each inequality gives one end of the feasible interval on that vertical line.',
  });
};

const sandboxPolar: ExtensionGenerator = (rng) => {
  const form = rng.int(0, 2);
  if (form === 0) {
    return extensionStep({
      prompt: 'Extension: for the lemniscate r² = a² cos(2θ), what is the largest θ in [0, π/2] at which the curve exists?',
      type: 'answer',
      acceptedAnswers: ['π/4', 'pi/4', '45°', '0.7854'],
      tolerance: 0.001,
      equivalence: {},
      feedbackCorrect: 'Correct! r² cannot be negative, so cos(2θ) ≥ 0 requires 2θ ≤ π/2, giving θ ≤ π/4.',
      feedbackIncorrect: 'r² ≥ 0 forces cos(2θ) ≥ 0, so 2θ ≤ π/2 and the curve stops at θ = π/4.',
      hint: 'Ask which values of θ make the right-hand side impossible for a squared quantity.',
    });
  }
  if (form === 1) {
    return extensionStep({
      prompt: 'Extension: for the cardioid r = a(1 + cos θ), at which θ in [0, π] does r equal exactly a?',
      type: 'answer',
      acceptedAnswers: ['π/2', 'pi/2', '90°', '1.5708'],
      tolerance: 0.001,
      equivalence: {},
      feedbackCorrect: 'Correct! r = a needs 1 + cos θ = 1, so cos θ = 0 and θ = π/2.',
      feedbackIncorrect: 'Set a(1 + cos θ) = a. Then cos θ = 0, so θ = π/2.',
      hint: 'Divide through by a and solve the resulting trigonometric equation.',
    });
  }
  const turns = rng.int(2, 4);
  return extensionStep({
    prompt: `Extension: for the Archimedean spiral r = aθ/(2π), what is r/a after ${turns} complete turns?`,
    type: 'answer',
    acceptedAnswers: [String(turns)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! ${turns} turns means θ = ${turns}(2π), so r/a = ${turns}(2π)/(2π) = ${turns}.`,
    feedbackIncorrect: `Substitute θ = ${turns} × 2π into r/a = θ/(2π) to get ${turns}.`,
    hint: 'Convert "complete turns" into a value of θ in radians first.',
  });
};

const sandboxParametric: ExtensionGenerator = (rng) => {
  const pairs = [
    { p: 2, q: 3 },
    { p: 1, q: 2 },
    { p: 1, q: 3 },
    { p: 2, q: 5 },
  ] as const;
  const { p, q } = rng.pick(pairs);
  const answer = monomial(q, p, q - p);
  return extensionStep({
    prompt: `Extension: for x = ${monomial(1, 1, p)} and y = ${monomial(1, 1, q)}, give dy/dx in terms of t.`,
    type: 'answer',
    acceptedAnswers: [answer],
    equivalence: { variables: ['t'], sampleDomain: [0.5, 3] },
    feedbackCorrect: `Correct! dy/dt = ${monomial(q, 1, q - 1)} and dx/dt = ${monomial(p, 1, p - 1)}, so dy/dx = ${answer}.`,
    feedbackIncorrect: `Divide the component derivatives: dy/dx = (${monomial(q, 1, q - 1)})/(${monomial(p, 1, p - 1)}) = ${answer}.`,
    hint: 'Differentiate each component with respect to t, then divide.',
  });
};

const sandboxDistanceTime: ExtensionGenerator = (rng) => {
  const pairs = [
    [24, 8],
    [30, 20],
    [60, 20],
    [12, 4],
    [40, 10],
    [36, 12],
  ] as const;
  const [v1, v2] = rng.pick(pairs);
  const distance = rng.pick([12, 24, 60] as const);
  const average = (2 * v1 * v2) / (v1 + v2);
  const naive = (v1 + v2) / 2;
  const t1 = round(distance / v1, 4);
  const t2 = round(distance / v2, 4);
  return extensionStep({
    prompt: `Extension: a cyclist rides ${distance} km at ${v1} km/h and then another ${distance} km at ${v2} km/h. What is the average speed for the whole ride in km/h?`,
    type: 'answer',
    acceptedAnswers: [String(round(average, 4))],
    tolerance: 0.01,
    feedbackCorrect: `Correct! The legs take ${t1} h and ${t2} h, so ${2 * distance} km ÷ ${round(t1 + t2, 4)} h = ${round(average, 4)} km/h — not the average of ${v1} and ${v2}.`,
    feedbackIncorrect: `Average speed uses totals: ${2 * distance} km over ${round(t1 + t2, 4)} h gives ${round(average, 4)} km/h. Averaging the two speeds would give ${naive}, which is wrong.`,
    hint: 'Equal distances do not take equal times. Find each time first.',
  });
};

// ─── Calculus ────────────────────────────────────────────────────────────────

const calculusTangent: ExtensionGenerator = (rng) => {
  // The scene draws f(x) = x² - 3x, so only the question form and x₀ vary.
  if (rng.random() < 0.5) {
    const x0 = rng.pick([-1, 0, 1, 2, 3, 4] as const);
    const m = 2 * x0 - 3;
    const c = -(x0 * x0);
    const rhs = linearRhs(m, c);
    return extensionStep({
      prompt: `Extension: give the right-hand side of the tangent to f at x = ${x0}, written as y = mx + c.`,
      type: 'answer',
      acceptedAnswers: [rhs],
      equivalence: { variables: ['x'] },
      feedbackCorrect: `Correct! f(${x0}) = ${x0 * x0 - 3 * x0} and f′(${x0}) = ${m}, so the tangent is y = ${rhs}.`,
      feedbackIncorrect: `Use the point (${x0}, ${x0 * x0 - 3 * x0}) with gradient f′(${x0}) = ${m}: y = ${rhs}.`,
      hint: 'A tangent needs both a gradient and a point on the curve.',
    });
  }
  const k = rng.pick([-5, -1, 1, 3, 5, 7] as const);
  const x = (k + 3) / 2;
  return extensionStep({
    prompt: `Extension: at which x is the tangent to f parallel to the line y = ${k}x + 2?`,
    type: 'answer',
    acceptedAnswers: [String(x)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! Parallel means equal gradients: 2x − 3 = ${k}, so x = ${x}.`,
    feedbackIncorrect: `Set f′(x) equal to the given gradient: 2x − 3 = ${k}, so x = ${x}.`,
    hint: 'Parallel lines share a gradient, so set the derivative equal to it.',
  });
};

const calculusRiemann: ExtensionGenerator = (rng) => {
  if (rng.random() < 0.5) {
    const epsilon = rng.pick([0.02, 0.01, 0.005, 0.002] as const);
    let n = 1;
    while (n < 5000 && (3 * n - 1) / (6 * n * n) >= epsilon) n += 1;
    return extensionStep({
      prompt: `Extension: the left-sum error for x² on [0, 1] is exactly (3n − 1)/(6n²). What is the smallest n whose error is below ${epsilon}?`,
      type: 'answer',
      acceptedAnswers: [String(n)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! n = ${n - 1} still gives ${round((3 * (n - 1) - 1) / (6 * (n - 1) ** 2), 6)}, while n = ${n} gives ${round((3 * n - 1) / (6 * n * n), 6)}.`,
      feedbackIncorrect: `Solve (3n − 1)/(6n²) < ${epsilon} as a quadratic inequality in n and round up: n = ${n}.`,
      hint: 'Turn the inequality into a quadratic in n and solve it, then round up to a whole number.',
    });
  }
  const increasing = rng.random() < 0.5;
  const fn = increasing ? 'x³' : '1/x on [1, 2]';
  const side = rng.random() < 0.5 ? 'left' : 'right';
  const under = increasing ? side === 'left' : side === 'right';
  return extensionStep({
    prompt: `Extension: for ${fn}, does the ${side} Riemann sum under-estimate or over-estimate the exact area?`,
    type: 'predict',
    acceptedAnswers: under
      ? ['under', 'under-estimate', 'underestimate', 'less']
      : ['over', 'over-estimate', 'overestimate', 'more'],
    feedbackCorrect: `Correct! ${increasing ? 'The function increases' : 'The function decreases'} there, so the ${side} endpoint of each strip is the ${under ? 'lower' : 'higher'} value.`,
    feedbackIncorrect: `${increasing ? 'This function increases' : 'This function decreases'} on the interval, so its ${side} endpoints are the ${under ? 'lower' : 'higher'} values and the sum is an ${under ? 'under' : 'over'}-estimate.`,
    hint: 'Decide whether the function rises or falls first, then ask which endpoint each rectangle uses.',
  });
};

const calculusDirectionField: ExtensionGenerator = (rng) => {
  // dP/dt = P(1 - P/4) is what the scene renders, so only the question form varies.
  const form = rng.int(0, 2);
  if (form === 0) {
    return extensionStep({
      prompt: 'Extension: for dP/dt = P(1 − P/4), at which positive P is the population growing fastest?',
      type: 'answer',
      acceptedAnswers: ['2'],
      tolerance: 0.001,
      feedbackCorrect: 'Correct! dP/dt = P − P²/4 is a downward parabola in P peaking at P = 2 — the point of inflection of the solution curve.',
      feedbackIncorrect: 'Maximise the growth rate itself: P − P²/4 peaks halfway to the carrying capacity, at P = 2.',
      hint: 'Treat the growth rate as a function of P and find where that function is largest.',
    });
  }
  if (form === 1) {
    const p0 = rng.pick([5, 6, 8, 10] as const);
    return extensionStep({
      prompt: `Extension: for dP/dt = P(1 − P/4) with P(0) = ${p0}, does P increase or decrease?`,
      type: 'predict',
      acceptedAnswers: ['decrease', 'decreases', 'decreasing', 'down', 'falls'],
      feedbackCorrect: `Correct! At P = ${p0} the factor (1 − P/4) is negative, so dP/dt < 0 and P falls towards 4.`,
      feedbackIncorrect: `Substitute P = ${p0}: (1 − ${p0}/4) is negative, so dP/dt < 0 and P decreases towards the equilibrium at 4.`,
      hint: 'Check the sign of each factor at the starting value rather than solving the equation.',
    });
  }
  return extensionStep({
    prompt: 'Extension: how many equilibrium solutions does dP/dt = P(1 − P/4) have?',
    type: 'answer',
    acceptedAnswers: ['2'],
    tolerance: 0.001,
    feedbackCorrect: 'Correct! P(1 − P/4) = 0 at P = 0 and P = 4, giving two constant solutions.',
    feedbackIncorrect: 'Set the whole right-hand side to zero: P = 0 and P = 4 both work, so there are 2 equilibria.',
    hint: 'Equilibrium means the rate is zero. Do not discard the factor P itself.',
  });
};

const calculusKinematics: ExtensionGenerator = (rng) => {
  const rootPairs = [
    [1, 3],
    [2, 4],
    [1, 5],
    [3, 5],
    [2, 6],
  ] as const;
  const [r1, r2] = rng.pick(rootPairs);
  const b = (3 * (r1 + r2)) / 2;
  const c = 3 * r1 * r2;
  const rule = `s(t) = t³ − ${b}t² + ${c}t`;
  const form = rng.int(0, 2);
  if (form === 0) {
    return extensionStep({
      prompt: `Extension: for ${rule}, at what time does the particle change direction for the second time?`,
      type: 'answer',
      acceptedAnswers: [String(r2)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! v(t) = 3(t − ${r1})(t − ${r2}), so velocity changes sign at t = ${r1} and again at t = ${r2}.`,
      feedbackIncorrect: `Direction changes where velocity changes sign: 3(t − ${r1})(t − ${r2}) = 0 gives t = ${r1} then t = ${r2}.`,
      hint: 'Changing direction means the velocity changes sign, not just that acceleration is zero.',
    });
  }
  if (form === 1) {
    return extensionStep({
      prompt: `Extension: for ${rule}, at what time is the acceleration zero?`,
      type: 'answer',
      acceptedAnswers: [String(round((r1 + r2) / 2, 4))],
      tolerance: 0.001,
      feedbackCorrect: `Correct! a(t) = 6t − ${2 * b}, which is zero at t = ${round((r1 + r2) / 2, 4)} — midway between the two turning points.`,
      feedbackIncorrect: `Differentiate twice: a(t) = 6t − ${2 * b} = 0 gives t = ${round((r1 + r2) / 2, 4)}.`,
      hint: 'Differentiate the position rule twice, then solve for zero.',
    });
  }
  return extensionStep({
    prompt: `Extension: for ${rule}, is the particle moving forwards or backwards at t = ${round((r1 + r2) / 2, 4)}?`,
    type: 'predict',
    acceptedAnswers: ['backwards', 'backward', 'back', 'negative', 'reverse'],
    feedbackCorrect: `Correct! Between t = ${r1} and t = ${r2} the factors of v(t) = 3(t − ${r1})(t − ${r2}) have opposite signs, so the velocity is negative.`,
    feedbackIncorrect: `Between the two roots of v(t) = 3(t − ${r1})(t − ${r2}) the product is negative, so the particle is moving backwards.`,
    hint: 'Test the sign of each factor of the velocity at that time.',
  });
};

const calculusNumerical: ExtensionGenerator = (rng) => {
  const x0 = rng.pick([1, 2, 3] as const);
  const k = rng.pick([2, 3, 5, 7] as const);
  if (rng.random() < 0.5) {
    // x1 = (x0² + k) / (2 x0); x2 = (x1² + k) / (2 x1) as an exact fraction.
    const n1 = x0 * x0 + k;
    const d1 = 2 * x0;
    const n2 = n1 * n1 + k * d1 * d1;
    const d2 = 2 * n1 * d1;
    const g = gcd(n2, d2);
    return extensionStep({
      prompt: `Extension: Newton’s method on f(x) = x² − ${k} starts at x₀ = ${x0}. What is x₂ as an exact fraction?`,
      type: 'answer',
      acceptedAnswers: [fraction(n2, d2), String(round(n2 / d2, 4))],
      tolerance: 0.001,
      equivalence: {},
      feedbackCorrect: `Correct! x₁ = ${fraction(n1, d1)} and then x₂ = ${fraction(n2, d2)} ≈ ${round(n2 / d2, 4)}.`,
      feedbackIncorrect: `Apply x_{n+1} = x_n − f(x_n)/f′(x_n) twice: x₁ = ${fraction(n1, d1)}, then x₂ = ${n2 / g}/${d2 / g}.`,
      hint: 'Keep everything as fractions and apply the iteration a second time.',
      sceneData: { kind: 'numerical-newton', k, x0 },
    });
  }
  return extensionStep({
    prompt: `Extension: for f(x) = x² − ${k} with any x₀ > 0, is x₁ always larger than √${k}, always smaller, or does it depend on x₀?`,
    type: 'predict',
    acceptedAnswers: ['larger', 'always larger', 'greater', 'bigger', 'above'],
    feedbackCorrect: `Correct! x₁ = (x₀ + ${k}/x₀)/2 is the average of x₀ and ${k}/x₀, which is never below their geometric mean √${k}.`,
    feedbackIncorrect: `Rewrite the iteration as x₁ = (x₀ + ${k}/x₀)/2. That arithmetic mean is always at least the geometric mean √${k}, so x₁ is never smaller.`,
    hint: 'Rewrite x₁ as the average of two positive numbers whose product is fixed.',
    sceneData: { kind: 'numerical-newton', k, x0 },
  });
};

// ─── Geometry ────────────────────────────────────────────────────────────────

const geometryReflect: ExtensionGenerator = (rng) => {
  const x = rng.int(-6, 6) || 2;
  const y = rng.int(-6, 6) || -7;
  const inYEqualsX = rng.random() < 0.5;
  const image: [number, number] = inYEqualsX ? [y, x] : [-y, -x];
  return extensionStep({
    prompt: `Extension: reflecting in the line ${inYEqualsX ? 'y = x' : 'y = -x'} is not one of the axis rules. What is the image of (${x}, ${y})?`,
    type: 'answer',
    acceptedAnswers: pointAnswers(image[0], image[1]),
    feedbackCorrect: `Correct! Reflection in ${inYEqualsX ? 'y = x maps (x, y) → (y, x)' : 'y = -x maps (x, y) → (-y, -x)'}, so (${x}, ${y}) → (${image[0]}, ${image[1]}).`,
    feedbackIncorrect: `Reflection in ${inYEqualsX ? 'y = x maps (x, y) → (y, x)' : 'y = -x maps (x, y) → (-y, -x)'}. So the image is (${image[0]}, ${image[1]}).`,
    hint: 'Every point on the mirror line must stay fixed. Test a point on the line to work out the rule.',
  });
};

const geometryRotation: ExtensionGenerator = (rng) => {
  const angle = rng.pick([90, 180, 270] as const);
  const ox = rng.int(-6, 6) || 3;
  const oy = rng.int(-6, 6) || -5;
  // Forward rules: 90° acw (x,y)→(-y,x); 180° (x,y)→(-x,-y); 270° acw (x,y)→(y,-x)
  const image: [number, number] =
    angle === 90 ? [-oy, ox] : angle === 180 ? [-ox, -oy] : [oy, -ox];
  return extensionStep({
    prompt: `Extension: a point is rotated ${angle}° anticlockwise about the origin and lands on (${image[0]}, ${image[1]}). What was the original point?`,
    type: 'answer',
    acceptedAnswers: pointAnswers(ox, oy),
    feedbackCorrect: `Correct! Undoing a ${angle}° anticlockwise rotation gives (${ox}, ${oy}).`,
    feedbackIncorrect: `Reverse the ${angle}° rule instead of applying it: the original point was (${ox}, ${oy}).`,
    hint: 'Work backwards: apply the rotation that undoes it.',
  });
};

const geometryEnlarge: ExtensionGenerator = (rng) => {
  const k = rng.pick([2, 3, 4] as const);
  const cx = rng.int(-2, 3);
  const cy = rng.int(-2, 3);
  const dx = rng.int(1, 4);
  const dy = rng.int(1, 4);
  const px = cx + dx;
  const py = cy + dy;
  const ix = cx + k * dx;
  const iy = cy + k * dy;
  if (rng.random() < 0.5) {
    return extensionStep({
      prompt: `Extension: an enlargement from centre (${cx}, ${cy}) maps (${px}, ${py}) to (${ix}, ${iy}). What is the scale factor?`,
      type: 'answer',
      acceptedAnswers: [String(k)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The displacement (${dx}, ${dy}) becomes (${k * dx}, ${k * dy}), so k = ${k}.`,
      feedbackIncorrect: `Compare displacements from the centre: (${dx}, ${dy}) and (${k * dx}, ${k * dy}), so k = ${k}.`,
      hint: 'Measure both points from the centre before comparing them.',
    });
  }
  const area = rng.int(2, 9);
  return extensionStep({
    prompt: `Extension: a shape of area ${area} cm² is enlarged by scale factor ${k}. What is the area of the image in cm²?`,
    type: 'answer',
    acceptedAnswers: [String(area * k * k)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! Area scales by k², so ${area} × ${k}² = ${area * k * k} cm².`,
    feedbackIncorrect: `Lengths scale by ${k} but areas scale by ${k}² = ${k * k}, giving ${area * k * k} cm².`,
    hint: 'An enlargement changes lengths and areas by different factors.',
  });
};

const geometrySimilarity: ExtensionGenerator = (rng) => {
  const table = [
    { a1: 18, a2: 50, b1: 6, b2: 10, k: '5/3' },
    { a1: 8, a2: 18, b1: 4, b2: 6, k: '3/2' },
    { a1: 32, a2: 200, b1: 4, b2: 10, k: '5/2' },
    { a1: 12, a2: 48, b1: 5, b2: 10, k: '2' },
    { a1: 9, a2: 25, b1: 3, b2: 5, k: '5/3' },
    { a1: 16, a2: 36, b1: 8, b2: 12, k: '3/2' },
  ] as const;
  const t = rng.pick(table);
  if (rng.random() < 0.5) {
    return extensionStep({
      prompt: `Extension: two similar triangles have areas ${t.a1} cm² and ${t.a2} cm². The smaller one has a ${t.b1} cm base. How long is the corresponding base of the larger?`,
      type: 'answer',
      acceptedAnswers: [String(t.b2)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The area ratio ${t.a2}/${t.a1} gives a length ratio of ${t.k}, and ${t.b1} × ${t.k} = ${t.b2} cm.`,
      feedbackIncorrect: `Areas scale by k², so k = √(${t.a2}/${t.a1}) = ${t.k}. The base becomes ${t.b1} × ${t.k} = ${t.b2} cm.`,
      hint: 'Lengths scale by k but areas scale by k², so take a square root first.',
    });
  }
  return extensionStep({
    prompt: `Extension: two similar triangles have corresponding bases ${t.b1} cm and ${t.b2} cm. If the smaller has area ${t.a1} cm², what is the area of the larger in cm²?`,
    type: 'answer',
    acceptedAnswers: [String(t.a2)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! k = ${t.b2}/${t.b1} = ${t.k}, so the area is ${t.a1} × (${t.k})² = ${t.a2} cm².`,
    feedbackIncorrect: `The length ratio is ${t.k}, so the area ratio is its square: ${t.a1} × (${t.k})² = ${t.a2} cm².`,
    hint: 'Find the length ratio first, then remember what happens to areas.',
  });
};

const geometryCircle: ExtensionGenerator = (rng) => {
  const r = rng.int(2, 12);
  if (rng.random() < 0.5) {
    return extensionStep({
      prompt: `Extension: a circle has area ${r * r}π. What is its circumference in terms of π?`,
      type: 'answer',
      acceptedAnswers: [`${2 * r}π`, `${2 * r}pi`, `${2 * r}*pi`, `${2 * r} pi`],
      feedbackCorrect: `Correct! πr² = ${r * r}π gives r = ${r}, so C = 2π(${r}) = ${2 * r}π.`,
      feedbackIncorrect: `Work backwards from the area: r² = ${r * r} so r = ${r}, then C = 2πr = ${2 * r}π.`,
      hint: 'Recover the radius from the area before using the circumference rule.',
      sceneData: { kind: 'circle-scaling', radius: r, scaleFactor: 1 },
    });
  }
  return extensionStep({
    prompt: `Extension: a circle has circumference ${2 * r}π. What is its area in terms of π?`,
    type: 'answer',
    acceptedAnswers: [`${r * r}π`, `${r * r}pi`, `${r * r}*pi`, `${r * r} pi`],
    feedbackCorrect: `Correct! 2πr = ${2 * r}π gives r = ${r}, so A = π(${r}²) = ${r * r}π.`,
    feedbackIncorrect: `Recover the radius first: r = ${r}. Then A = πr² = ${r * r}π.`,
    hint: 'Find the radius from the circumference before using the area rule.',
    sceneData: { kind: 'circle-scaling', radius: r, scaleFactor: 1 },
  });
};

const geometryPythagoras: ExtensionGenerator = (rng) => {
  const t = rng.pick(PYTH_TRIPLES);
  if (rng.random() < 0.5) {
    return extensionStep({
      prompt: `Extension: an isosceles triangle has two equal sides of ${t[2]} and a base of ${2 * t[0]}. What is its perpendicular height?`,
      type: 'answer',
      acceptedAnswers: [String(t[1])],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The height bisects the base into two ${t[0]}s, so h = √(${t[2]}² − ${t[0]}²) = ${t[1]}.`,
      feedbackIncorrect: `The perpendicular height bisects the base, leaving a right triangle with hypotenuse ${t[2]} and one side ${t[0]}, so h = ${t[1]}.`,
      hint: 'There is no right angle yet — draw the height first and see what it does to the base.',
      sceneData: { kind: 'pythagoras', a: t[0], b: t[1], c: t[2] },
    });
  }
  return extensionStep({
    prompt: `Extension: a rectangle measures ${t[0]} by ${t[1]}. How long is its diagonal?`,
    type: 'answer',
    acceptedAnswers: [String(t[2])],
    tolerance: 0.001,
    feedbackCorrect: `Correct! The diagonal splits the rectangle into right triangles: √(${t[0]}² + ${t[1]}²) = ${t[2]}.`,
    feedbackIncorrect: `The diagonal is the hypotenuse of a right triangle with sides ${t[0]} and ${t[1]}, so it is ${t[2]}.`,
    hint: 'Draw one diagonal and identify the right triangle it creates.',
    sceneData: { kind: 'pythagoras', a: t[0], b: t[1], c: t[2] },
  });
};

const geometrySohcahtoa: ExtensionGenerator = (rng) => {
  const ladders = [
    { length: 6.5, height: 6 },
    { length: 5, height: 4 },
    { length: 10, height: 8 },
    { length: 13, height: 5 },
    { length: 8.5, height: 8 },
  ] as const;
  const l = rng.pick(ladders);
  const angle = Math.round((Math.asin(l.height / l.length) * 180) / Math.PI);
  const adjacent = round(Math.sqrt(l.length * l.length - l.height * l.height), 2);
  return extensionStep({
    prompt: `Extension: a ${l.length} m ladder rests against a wall and reaches ${l.height} m up it. What angle does the ladder make with the ground, to the nearest degree?`,
    type: 'answer',
    acceptedAnswers: [String(angle), `${angle}°`, `${angle} degrees`],
    tolerance: 0.5,
    feedbackCorrect: `Correct! sin θ = ${l.height}/${l.length}, so θ = sin⁻¹(${round(l.height / l.length, 3)}) ≈ ${angle}°.`,
    feedbackIncorrect: `The wall height is opposite the angle and the ladder is the hypotenuse: θ = sin⁻¹(${l.height}/${l.length}) ≈ ${angle}°.`,
    hint: 'Decide which two sides you were given before choosing the ratio, then use the inverse function.',
    sceneData: {
      kind: 'sohcahtoa',
      opp: l.height,
      adj: adjacent,
      hyp: l.length,
      angleDeg: angle,
      ratio: 'sine',
    },
  });
};

const geometryUnitCircle: ExtensionGenerator = (rng) => {
  const turns = rng.int(1, 3);
  const useSine = rng.random() < 0.5;
  const value = rng.pick([0.25, 0.5, 0.8] as const);
  const count = 2 * turns;
  const upper = turns === 1 ? '2π' : `${2 * turns}π`;
  return extensionStep({
    prompt: `Extension: how many solutions does ${useSine ? 'sin' : 'cos'} θ = ${value} have for 0 ≤ θ ≤ ${upper}?`,
    type: 'answer',
    acceptedAnswers: [String(count)],
    tolerance: 0.01,
    feedbackCorrect: `Correct! Each full turn crosses that ${useSine ? 'height' : 'horizontal position'} twice, and ${upper} is ${turns} turn${turns === 1 ? '' : 's'}, giving ${count} solutions.`,
    feedbackIncorrect: `In one revolution the value ${value} is reached twice. Over ${turns} revolution${turns === 1 ? '' : 's'} that is ${count} solutions.`,
    hint: 'Count how many times the rotating point reaches that value in a single turn, then scale up.',
  });
};

// ─── Statistics ──────────────────────────────────────────────────────────────

const statisticsDistribution: ExtensionGenerator = (rng) => {
  // The scene shows the authored dataset 2, 3, 3, 4, 8 (total 20).
  const total = 20;
  const size = 5;
  if (rng.random() < 0.5) {
    const target = rng.pick([5, 6, 7] as const);
    const needed = target * (size + 1) - total;
    return extensionStep({
      prompt: `Extension: what sixth value must be added to 2, 3, 3, 4, 8 to make the mean exactly ${target}?`,
      type: 'answer',
      acceptedAnswers: [String(needed)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Six values with mean ${target} must total ${target * 6}, and the current total is ${total}, so the new value is ${needed}.`,
      feedbackIncorrect: `A mean of ${target} across six values needs a total of ${target * 6}. The existing five sum to ${total}, so add ${needed}.`,
      hint: 'Work with the total rather than the mean.',
    });
  }
  const target = rng.pick([3, 4] as const);
  const removed = total - target * (size - 1);
  return extensionStep({
    prompt: `Extension: which single value must be removed from 2, 3, 3, 4, 8 so that the remaining four have mean ${target}?`,
    type: 'answer',
    acceptedAnswers: [String(removed)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! Four values with mean ${target} total ${target * 4}, so the removed value is ${total} − ${target * 4} = ${removed}.`,
    feedbackIncorrect: `The remaining four must total ${target * 4}, so the value removed is ${total} − ${target * 4} = ${removed}.`,
    hint: 'Work out the total the four remaining values need, then compare with the current total.',
  });
};

const statisticsNormal: ExtensionGenerator = (rng, core) => {
  const scene = sceneOf(core, 0);
  const mu = scene && scene.kind === 'normal-zscore' ? scene.mu : 60;
  const sigma = scene && scene.kind === 'normal-zscore' ? scene.sigma : 5;
  if (rng.random() < 0.5) {
    const below = rng.int(0, 2);
    const above = rng.int(1, 3);
    const percent = round(EMPIRICAL_ONE_SIDED[below] + EMPIRICAL_ONE_SIDED[above], 2);
    const lower = mu - below * sigma;
    const upper = mu + above * sigma;
    return extensionStep({
      prompt: `Extension: for μ = ${mu} and σ = ${sigma}, roughly what percentage of values lie between ${lower} and ${upper}?`,
      type: 'answer',
      acceptedAnswers: [String(percent), `${percent}%`],
      tolerance: 0.5,
      feedbackCorrect: `Correct! ${lower} is ${below} standard deviation${below === 1 ? '' : 's'} below and ${upper} is ${above} above, giving ${EMPIRICAL_ONE_SIDED[below]}% + ${EMPIRICAL_ONE_SIDED[above]}% = ${percent}%.`,
      feedbackIncorrect: `The interval is not symmetric: halve each empirical-rule band separately, giving ${EMPIRICAL_ONE_SIDED[below]}% + ${EMPIRICAL_ONE_SIDED[above]}% = ${percent}%.`,
      hint: 'Convert both endpoints to z-scores, then add the one-sided areas rather than a whole band.',
      sceneData: { kind: 'normal-zscore', mu, sigma, x: upper, z: above },
    });
  }
  const z = rng.pick([-2, -1, 1, 2, 3] as const);
  const x = mu + z * sigma;
  return extensionStep({
    prompt: `Extension: for μ = ${mu} and σ = ${sigma}, which value of x has a z-score of ${z}?`,
    type: 'answer',
    acceptedAnswers: [String(x)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! x = μ + zσ = ${mu} + (${z})(${sigma}) = ${x}.`,
    feedbackIncorrect: `Rearrange z = (x − μ)/σ into x = μ + zσ = ${x}.`,
    hint: 'Rearrange the z-score formula to make x the subject.',
    sceneData: { kind: 'normal-zscore', mu, sigma, x, z },
  });
};

const statisticsProbability: ExtensionGenerator = (rng) => {
  const n = rng.int(3, 5);
  const outcomes = 2 ** n;
  if (rng.random() < 0.5) {
    return extensionStep({
      prompt: `Extension: a fair coin is tossed ${n} times. What is the probability of getting at least one head? Give it as a fraction.`,
      type: 'answer',
      acceptedAnswers: [`${outcomes - 1}/${outcomes}`, String(round((outcomes - 1) / outcomes, 4))],
      tolerance: 0.001,
      equivalence: {},
      feedbackCorrect: `Correct! P(no heads) = (1/2)^${n} = 1/${outcomes}, so P(at least one head) = ${outcomes - 1}/${outcomes}.`,
      feedbackIncorrect: `Use the complement: the only excluded outcome is ${n} tails, with probability 1/${outcomes}, so the answer is ${outcomes - 1}/${outcomes}.`,
      hint: 'Listing every outcome is slow. Which single outcome are you excluding?',
    });
  }
  return extensionStep({
    prompt: `Extension: a fair coin is tossed ${n} times. What is the probability of getting no heads at all? Give it as a fraction.`,
    type: 'answer',
    acceptedAnswers: [`1/${outcomes}`, String(round(1 / outcomes, 4))],
    tolerance: 0.001,
    equivalence: {},
    feedbackCorrect: `Correct! Each toss must be a tail: (1/2)^${n} = 1/${outcomes}.`,
    feedbackIncorrect: `Multiply the independent probabilities: (1/2)^${n} = 1/${outcomes}.`,
    hint: 'All the tosses are independent, so multiply their probabilities.',
  });
};

const statisticsScatter: ExtensionGenerator = (rng) => {
  const m = rng.pick([2, 3, -2, 0.5, 1.5] as const);
  const xBar = rng.int(2, 8);
  const yBar = rng.int(4, 20);
  const c = round(yBar - m * xBar, 4);
  if (rng.random() < 0.5) {
    return extensionStep({
      prompt: `Extension: a least-squares line has gradient ${m} and the data have means x̄ = ${xBar} and ȳ = ${yBar}. What is its y-intercept?`,
      type: 'answer',
      acceptedAnswers: [String(c)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The least-squares line always passes through (x̄, ȳ), so ${yBar} = ${m}(${xBar}) + c gives c = ${c}.`,
      feedbackIncorrect: `The least-squares line passes through (${xBar}, ${yBar}). Substituting gives c = ${c}.`,
      hint: 'There is one point every least-squares line is guaranteed to pass through.',
    });
  }
  const xNew = xBar + rng.int(2, 5);
  const prediction = round(yBar + m * (xNew - xBar), 4);
  return extensionStep({
    prompt: `Extension: a least-squares line has gradient ${m} and the data have means x̄ = ${xBar} and ȳ = ${yBar}. What does it predict when x = ${xNew}?`,
    type: 'answer',
    acceptedAnswers: [String(prediction)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! Starting from (${xBar}, ${yBar}) and moving ${xNew - xBar} across gives ${yBar} + ${m}(${xNew - xBar}) = ${prediction}.`,
    feedbackIncorrect: `Use the mean point as an anchor: ${yBar} + ${m}(${xNew} − ${xBar}) = ${prediction}.`,
    hint: 'You do not need the intercept if you start from the mean point.',
  });
};

const statisticsBoxPlot: ExtensionGenerator = (rng) => {
  // Scene dataset is fixed: 3, 5, 7, 8, 12, 14, 16 with Q1 = 5 and Q3 = 14.
  const q1 = 5;
  const q3 = 14;
  const iqr = q3 - q1;
  const upper = rng.random() < 0.5;
  const fence = upper ? q3 + 1.5 * iqr : q1 - 1.5 * iqr;
  return extensionStep({
    prompt: `Extension: using Q1 = ${q1} and Q3 = ${q3}, ${upper ? 'above' : 'below'} what value would a data point be flagged as an outlier by the 1.5 × IQR rule?`,
    type: 'answer',
    acceptedAnswers: [String(round(fence, 4))],
    tolerance: 0.001,
    feedbackCorrect: `Correct! The ${upper ? 'upper' : 'lower'} fence is ${upper ? `Q3 + 1.5 × IQR = ${q3} + ${1.5 * iqr}` : `Q1 − 1.5 × IQR = ${q1} − ${1.5 * iqr}`} = ${round(fence, 4)}.`,
    feedbackIncorrect: `The ${upper ? 'upper' : 'lower'} fence is measured from ${upper ? 'Q3' : 'Q1'}: ${round(fence, 4)}.`,
    hint: 'The fence is measured from the quartile, not from the median or the extreme value.',
  });
};

const statisticsTree: ExtensionGenerator = (rng) => {
  // Scene bag is fixed: 3 red and 2 blue, drawn without replacement.
  const forms = [
    { question: 'at least one blue', numerator: 7, denominator: 10, working: '1 − P(both red) = 1 − 3/10' },
    { question: 'exactly one red', numerator: 3, denominator: 5, working: '3/5 × 2/4 + 2/5 × 3/4 = 6/20 + 6/20' },
    { question: 'both blue', numerator: 1, denominator: 10, working: '2/5 × 1/4' },
  ] as const;
  const f = rng.pick(forms);
  return extensionStep({
    prompt: `Extension: from the same bag of 3 red and 2 blue marbles, two are drawn without replacement. What is P(${f.question})? Give it as a fraction.`,
    type: 'answer',
    acceptedAnswers: [`${f.numerator}/${f.denominator}`, String(round(f.numerator / f.denominator, 4))],
    tolerance: 0.001,
    equivalence: {},
    feedbackCorrect: `Correct! ${f.working} = ${f.numerator}/${f.denominator}.`,
    feedbackIncorrect: `Work along the branches: ${f.working} = ${f.numerator}/${f.denominator}.`,
    hint: 'Decide whether it is quicker to add the matching branches or to subtract the complement.',
  });
};

// ─── Vectors, matrices and complex numbers ───────────────────────────────────

const linearVector: ExtensionGenerator = (rng) => {
  const t = rng.pick(PYTH_TRIPLES);
  const a = t[0];
  const b = t[1];
  if (rng.random() < 0.5) {
    const n = rng.int(1, 3);
    const c = a * n;
    const k = -b * n;
    return extensionStep({
      prompt: `Extension: find k so that a = (${a}, ${b}) and b = (k, ${c}) are perpendicular.`,
      type: 'answer',
      acceptedAnswers: [String(k)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Perpendicular vectors have a zero dot product: ${a}k + ${b * c} = 0, so k = ${k}.`,
      feedbackIncorrect: `Set the dot product to zero: ${a}k + ${b}(${c}) = 0, giving k = ${k}.`,
      hint: 'What is true of the dot product of two perpendicular vectors?',
      sceneData: { kind: 'vector-resultant', vecA: [a, b], vecB: [k, c] },
    });
  }
  const cx = rng.int(-4, 4);
  const cy = rng.int(-4, 4);
  const dot = a * cx + b * cy;
  return extensionStep({
    prompt: `Extension: what is the dot product of (${a}, ${b}) and (${cx}, ${cy})?`,
    type: 'answer',
    acceptedAnswers: [String(dot)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! ${a}(${cx}) + ${b}(${cy}) = ${dot}${dot === 0 ? ', so these vectors are perpendicular' : ''}.`,
    feedbackIncorrect: `Multiply matching components and add: ${a}(${cx}) + ${b}(${cy}) = ${dot}.`,
    hint: 'Multiply the matching components, then add — the result is a single number, not a vector.',
    sceneData: { kind: 'vector-resultant', vecA: [a, b], vecB: [cx, cy] },
  });
};

const linearMatrix: ExtensionGenerator = (rng) => {
  const a = rng.pick([2, 3, 4] as const);
  const bMultiplier = rng.int(1, 3);
  const b = a * bMultiplier;
  const c = rng.int(1, 5);
  const k = b === 0 ? 0 : (b * c) / a;
  if (Number.isInteger(k) && rng.random() < 0.5) {
    return extensionStep({
      prompt: `Extension: for which value of k does the matrix [[${a},${b}],[${c},k]] squash the whole plane onto a single line?`,
      type: 'answer',
      acceptedAnswers: [String(k)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Collapsing to a line means zero area scale: ${a}k − ${b * c} = 0, so k = ${k}.`,
      feedbackIncorrect: `A transformation collapses the plane when its determinant is zero: ${a}k − ${b * c} = 0, so k = ${k}.`,
      hint: 'Relate "no area left" to the quantity that measures area change.',
      sceneData: { kind: 'matrix-transform', matrix: [[a, b], [c, k]], point: [1, 1] },
    });
  }
  const d = rng.int(2, 6);
  const det = a * d - b * c;
  return extensionStep({
    prompt: `Extension: what is the area scale factor of the transformation [[${a},${b}],[${c},${d}]]?`,
    type: 'answer',
    acceptedAnswers: [String(Math.abs(det))],
    tolerance: 0.001,
    feedbackCorrect: `Correct! |det| = |${a}×${d} − ${b}×${c}| = ${Math.abs(det)}.`,
    feedbackIncorrect: `Use |det A| = |ad − bc| = |${a * d} − ${b * c}| = ${Math.abs(det)}.`,
    hint: 'Off-diagonal entries matter here — the determinant is not just the product of the diagonal.',
    sceneData: { kind: 'matrix-transform', matrix: [[a, b], [c, d]], point: [1, 1] },
  });
};

const linearComplex: ExtensionGenerator = (rng) => {
  const t = rng.pick(PYTH_TRIPLES);
  if (rng.random() < 0.5) {
    return extensionStep({
      prompt: `Extension: give the exact modulus of (${t[0]} + ${t[1]}i)(1 + i).`,
      type: 'answer',
      acceptedAnswers: [`${t[2]}√2`, `${t[2]}*sqrt(2)`, `sqrt(${2 * t[2] * t[2]})`, String(round(t[2] * Math.SQRT2, 4))],
      tolerance: 0.01,
      equivalence: {},
      feedbackCorrect: `Correct! Moduli multiply: ${t[2]} × √2 = ${t[2]}√2 ≈ ${round(t[2] * Math.SQRT2, 3)}.`,
      feedbackIncorrect: `You do not need to expand the brackets — moduli multiply, so the answer is ${t[2]} × √2 = ${t[2]}√2.`,
      hint: 'There is a shortcut that avoids expanding the product.',
      sceneData: { kind: 'complex-plane', re: t[0], im: t[1], operation: 'modulus' },
    });
  }
  const u = rng.pick(PYTH_TRIPLES.filter((tr) => tr[2] !== t[2]));
  return extensionStep({
    prompt: `Extension: what is |(${t[0]} + ${t[1]}i)(${u[0]} + ${u[1]}i)|?`,
    type: 'answer',
    acceptedAnswers: [String(t[2] * u[2])],
    tolerance: 0.001,
    feedbackCorrect: `Correct! Moduli multiply: ${t[2]} × ${u[2]} = ${t[2] * u[2]}.`,
    feedbackIncorrect: `Instead of expanding, multiply the moduli: ${t[2]} × ${u[2]} = ${t[2] * u[2]}.`,
    hint: 'Find each modulus separately before combining them.',
    sceneData: { kind: 'complex-plane', re: t[0], im: t[1], operation: 'modulus' },
  });
};

// ─── Extensions for the visual-topic activities ──────────────────────────────

const explorerNumberLine: ExtensionGenerator = (rng) => {
  if (rng.random() < 0.5) {
    const from = rng.int(-4, 0);
    const to = from + rng.int(3, 6);
    const count = to - from; // closed left, open right
    return extensionStep({
      prompt: `Extension: how many integers satisfy ${from} ≤ x < ${to}?`,
      type: 'answer',
      acceptedAnswers: [String(count)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The values run from ${from} up to ${to - 1}, which is ${count} numbers; ${to} is excluded because that end is open.`,
      feedbackIncorrect: `List them from ${from} to ${to - 1}: that is ${count} numbers. The open end excludes ${to}.`,
      hint: 'One end is closed and the other is open, so counting is safer than subtracting.',
      sceneData: {
        kind: 'number-line',
        min: -6,
        max: 6,
        points: [],
        interval: { from, to, closedFrom: true, closedTo: false },
      },
    });
  }
  const picked = rng.pick([1, 2, 3, 4] as const);
  const denominator = rng.pick([3, 6, 8] as const);
  // 3/3 is itself a whole number, so it does not lie between two of them.
  const numerator = picked === denominator ? 4 : picked;
  const value = numerator / denominator;
  const lower = Math.floor(value);
  return extensionStep({
    prompt: `Extension: between which two consecutive whole numbers does ${numerator}/${denominator} lie? Give the smaller one.`,
    type: 'answer',
    acceptedAnswers: [String(lower)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! ${numerator}/${denominator} ≈ ${round(value, 3)}, which sits between ${lower} and ${lower + 1}.`,
    feedbackIncorrect: `${numerator}/${denominator} ≈ ${round(value, 3)}, so it lies between ${lower} and ${lower + 1}.`,
    hint: 'Compare the numerator with the denominator to see how many whole parts fit.',
    sceneData: { kind: 'number-line', min: -6, max: 6, points: [round(value, 3)] },
  });
};

const sandboxTransformations: ExtensionGenerator = (rng, core) => {
  const scene = sceneOf(core, 0);
  const a = scene && scene.kind === 'function-plot' ? (scene.a ?? 1) : 1;
  const b = scene && scene.kind === 'function-plot' ? (scene.b ?? 0) : 0;
  const constant = scene && scene.kind === 'function-plot' ? (scene.k ?? 0) : 0;
  const h = a === 0 ? 0 : -b / (2 * a);
  const k = constant - a * h * h;

  if (rng.random() < 0.5) {
    const offset = rng.pick([2, 3] as const);
    const pointX = h + offset;
    const pointY = a * offset * offset + k;
    return extensionStep({
      prompt: `Extension: a parabola has vertex (${h}, ${k}) and passes through (${pointX}, ${pointY}). Find a.`,
      type: 'answer',
      acceptedAnswers: [String(round(a, 4))],
      tolerance: 0.001,
      feedbackCorrect: `Correct! ${pointY} = a(${offset})² ${signed(k)} gives ${offset * offset}a = ${pointY - k}, so a = ${round(a, 4)}.`,
      feedbackIncorrect: `Substitute the point into y = a(x − ${h})² ${signed(k)}: ${offset * offset}a = ${pointY - k}, so a = ${round(a, 4)}.`,
      hint: 'Put the known point into the completed-square form and solve for the single unknown.',
    });
  }
  const shift = rng.int(1, 4);
  const newVertexY = k + shift;
  return extensionStep({
    prompt: `Extension: the whole parabola is translated ${shift} unit${shift === 1 ? '' : 's'} up. What is the new vertex? Enter x, y.`,
    type: 'answer',
    acceptedAnswers: pointAnswers(h, newVertexY),
    feedbackCorrect: `Correct! A vertical translation changes only k: (${h}, ${newVertexY}).`,
    feedbackIncorrect: `Translating up adds to the y-coordinate only, giving (${h}, ${newVertexY}).`,
    hint: 'Which of h and k does a vertical translation change?',
  });
};

const sandboxExponentialLog: ExtensionGenerator = (rng) => {
  if (rng.random() < 0.5) {
    const power = rng.int(2, 4);
    return extensionStep({
      prompt: `Extension: a sample decays as y = A(1/2)ˣ. After how many steps is y equal to A/${2 ** power}?`,
      type: 'answer',
      acceptedAnswers: [String(power)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! (1/2)^${power} = 1/${2 ** power}, so ${power} halvings are needed.`,
      feedbackIncorrect: `Write 1/${2 ** power} as a power of 1/2: it is (1/2)^${power}, so x = ${power}.`,
      hint: 'Express the target fraction as a power of one half.',
      sceneData: { kind: 'exponential-plot', family: 'exponential', a: 1, base: 0.5, c: 0 },
    });
  }
  const base = rng.pick([2, 3] as const);
  const shift = rng.int(1, 4);
  return extensionStep({
    prompt: `Extension: for y = ${base}ˣ + ${shift}, what value does y approach as x becomes very negative?`,
    type: 'answer',
    acceptedAnswers: [String(shift)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! ${base}ˣ tends to 0, so y tends to ${shift}: that is the horizontal asymptote.`,
    feedbackIncorrect: `As x → −∞ the term ${base}ˣ tends to 0, leaving y → ${shift}.`,
    hint: 'What happens to the power term itself, and what is left behind?',
    sceneData: { kind: 'exponential-plot', family: 'exponential', a: 1, base, c: shift },
  });
};

const geometryAngleReasoning: ExtensionGenerator = (rng) => {
  const regular = [
    { sides: 3, interior: 60 },
    { sides: 4, interior: 90 },
    { sides: 5, interior: 108 },
    { sides: 6, interior: 120 },
    { sides: 8, interior: 135 },
    { sides: 9, interior: 140 },
    { sides: 10, interior: 144 },
    { sides: 12, interior: 150 },
  ] as const;
  const shape = rng.pick(regular);
  if (rng.random() < 0.5) {
    return extensionStep({
      prompt: `Extension: in a regular ${shape.sides}-sided polygon, what is the size of each interior angle, in degrees?`,
      type: 'answer',
      acceptedAnswers: [String(shape.interior), `${shape.interior}°`],
      tolerance: 0.01,
      feedbackCorrect: `Correct! The total is 180(${shape.sides - 2}) = ${180 * (shape.sides - 2)}°, and dividing by ${shape.sides} gives ${shape.interior}°.`,
      feedbackIncorrect: `Total the interior angles first: 180(${shape.sides} − 2) = ${180 * (shape.sides - 2)}°. Regular means all ${shape.sides} are equal, so each is ${shape.interior}°.`,
      hint: 'Find the total first, then use the fact that a regular polygon has equal angles.',
      sceneData: { kind: 'angle-figure', figure: 'polygon', angles: [], sides: shape.sides },
    });
  }
  const exterior = round(360 / shape.sides, 4);
  return extensionStep({
    prompt: `Extension: what is the size of each exterior angle of a regular ${shape.sides}-sided polygon, in degrees?`,
    type: 'answer',
    acceptedAnswers: [String(exterior), `${exterior}°`],
    tolerance: 0.01,
    feedbackCorrect: `Correct! The exterior angles always total 360°, so each is 360 ÷ ${shape.sides} = ${exterior}°.`,
    feedbackIncorrect: `The exterior angles of any polygon total 360°, so each is 360 ÷ ${shape.sides} = ${exterior}°.`,
    hint: 'The exterior angles of every polygon share the same total, whatever the number of sides.',
    sceneData: { kind: 'angle-figure', figure: 'polygon', angles: [], sides: shape.sides },
  });
};

const calculusCurveSketching: ExtensionGenerator = (rng, core) => {
  const scene = sceneOf(core, 0);
  const b = scene && scene.kind === 'curve-analysis' ? scene.b : -6;
  const c = scene && scene.kind === 'curve-analysis' ? scene.c : 9;
  // f'(x) = 3x² + 2bx + c = 3(x − r1)(x − r2)
  const discriminant = Math.sqrt(4 * b * b - 12 * c);
  const r1 = round((-2 * b - discriminant) / 6, 4);
  const r2 = round((-2 * b + discriminant) / 6, 4);

  if (rng.random() < 0.5) {
    return extensionStep({
      prompt: `Extension: the stationary points are at x = ${r1} and x = ${r2}. Which one is the local maximum? Give its x-value.`,
      type: 'answer',
      acceptedAnswers: [String(r1)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! f''(${r1}) is negative, so x = ${r1} is the local maximum and x = ${r2} is the local minimum.`,
      feedbackIncorrect: `Use the second-derivative test: it is negative at x = ${r1} (maximum) and positive at x = ${r2} (minimum).`,
      hint: 'The second derivative classifies a stationary point without any sketching.',
    });
  }
  const inflection = round(-b / 3, 4);
  return extensionStep({
    prompt: `Extension: for which x-values is this curve concave up? Give the smallest x for which that holds.`,
    type: 'answer',
    acceptedAnswers: [String(inflection)],
    tolerance: 0.01,
    feedbackCorrect: `Correct! f''(x) > 0 for x > ${inflection}, so concavity turns upward from the inflection at x = ${inflection}.`,
    feedbackIncorrect: `Solve f''(x) > 0. The boundary is the inflection at x = ${inflection}, and the curve is concave up beyond it.`,
    hint: 'Concave up is an inequality on the second derivative, so start from where it is zero.',
  });
};

const calculusAreaBetween: ExtensionGenerator = (rng, core) => {
  const scene = sceneOf(core, 0);
  const isHorizontal = scene && scene.kind === 'area-between' ? scene.lineSlope === 0 : false;

  if (!isHorizontal && rng.random() < 0.5) {
    const m = rng.int(2, 4);
    const areaText = fraction(m ** 3, 6);
    return extensionStep({
      prompt: `Extension: for y = x² and y = mx with m > 0, the enclosed area is m³/6. Which m gives an area of exactly ${areaText}?`,
      type: 'answer',
      acceptedAnswers: [String(m)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! m³/6 = ${areaText} gives m³ = ${m ** 3}, so m = ${m}.`,
      feedbackIncorrect: `Solve m³/6 = ${areaText}: m³ = ${m ** 3}, so m = ${m}.`,
      hint: 'Rearrange for m³ first, then take the cube root.',
    });
  }
  const width = rng.int(1, 3);
  const height = rng.int(2, 5);
  const area = round((2 / 3) * width * height * 2, 4);
  return extensionStep({
    prompt: `Extension: the region between a parabola and a chord is two-thirds of the surrounding rectangle. For a rectangle ${2 * width} wide and ${height} tall, what is that area?`,
    type: 'answer',
    acceptedAnswers: [String(area)],
    tolerance: 0.01,
    feedbackCorrect: `Correct! Archimedes' result gives (2/3) × ${2 * width} × ${height} = ${area}.`,
    feedbackIncorrect: `Apply the two-thirds rule to the rectangle: (2/3) × ${2 * width} × ${height} = ${area}.`,
    hint: 'You do not need to integrate — scale the rectangle by the given fraction.',
  });
};

// ─── P2 concept-connection extensions ───────────────────────────────────────

const sandboxPiecewiseAbsolute: ExtensionGenerator = (rng, core) => {
  const scene = sceneOf(core, 0);
  const a = scene?.kind === 'piecewise-absolute' ? scene.a : 2;
  const h = scene?.kind === 'piecewise-absolute' ? scene.h : 1;
  const k = scene?.kind === 'piecewise-absolute' ? scene.k : -1;
  const rightBranch = rng.random() < 0.5;
  const gradient = rightBranch ? a : -a;
  const intercept = rightBranch ? k - a * h : k + a * h;
  const branch = rightBranch ? 'right-hand' : 'left-hand';
  const domain = rightBranch ? `x ≥ ${h}` : `x ≤ ${h}`;
  const expression = linearRhs(gradient, intercept);

  return extensionStep({
    prompt: `Extension: write the ${branch} branch of f(x)=${a}|x−(${h})|${signed(k)} in the form mx+c (${domain}).`,
    type: 'answer',
    acceptedAnswers: [expression, expression.replaceAll(' ', '')],
    equivalence: { variables: ['x'] },
    feedbackCorrect: `Correct! On this branch the absolute value opens to give f(x)=${expression}.`,
    feedbackIncorrect: `Apply the branch rule first, then expand and simplify to f(x)=${expression}.`,
    hint: rightBranch
      ? 'To the right of the vertex, x−h is non-negative.'
      : 'To the left of the vertex, x−h is negative, so reverse its sign.',
    sceneData: { kind: 'piecewise-absolute', a, h, k, x: rightBranch ? h + 1 : h - 1 },
  });
};

const calculusAccumulationLink: ExtensionGenerator = (_rng, core) => {
  const scene = sceneOf(core, 0);
  const m = scene?.kind === 'accumulation-link' ? scene.m : 2;
  const c = scene?.kind === 'accumulation-link' ? scene.c : 1;
  const quadratic = monomial(m, 2, 2, 'x');
  const linear = c === 0
    ? ''
    : ` ${c < 0 ? '-' : '+'} ${Math.abs(c) === 1 ? 'x' : `${Math.abs(c)}x`}`;
  const expression = `${quadratic}${linear}`;

  return extensionStep({
    prompt: `Extension: for f(t)=${m}t${signed(c)}, give A(x)=∫₀ˣf(t)dt as a formula.`,
    type: 'answer',
    acceptedAnswers: [expression, expression.replaceAll(' ', '')],
    equivalence: { variables: ['x'] },
    feedbackCorrect: `Correct! Integrating term by term and using A(0)=0 gives A(x)=${expression}.`,
    feedbackIncorrect: `The antiderivative is ${expression}; the lower limit contributes zero.`,
    hint: 'Integrate each term, then evaluate the antiderivative at 0 and x.',
    sceneData: { kind: 'accumulation-link', m, c, x: 3 },
  });
};

const calculusFunctionDerivativeLink: ExtensionGenerator = (rng, core) => {
  const scene = sceneOf(core, 0);
  const a = scene?.kind === 'function-derivative-link' ? scene.a : 1;
  const b = scene?.kind === 'function-derivative-link' ? scene.b : 0;
  const c = scene?.kind === 'function-derivative-link' ? scene.c : -3;
  const d = scene?.kind === 'function-derivative-link' ? scene.d : 0;
  const x = rng.pick([-2, -1, 1, 2] as const);
  const secondDerivative = 6 * a * x + 2 * b;

  return extensionStep({
    prompt: `Extension: for f(x)=${a}x³${signed(b)}x²${signed(c)}x${signed(d)}, what is f″(${x})?`,
    type: 'answer',
    acceptedAnswers: [String(secondDerivative)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! f″(x)=${6 * a}x${signed(2 * b)}, so f″(${x})=${secondDerivative}.`,
    feedbackIncorrect: `Differentiate twice: f″(x)=${6 * a}x${signed(2 * b)}, then substitute x=${x}.`,
    hint: 'The second derivative is the gradient of the derivative graph.',
    sceneData: { kind: 'function-derivative-link', a, b, c, d, x },
  });
};

const statisticsSamplingDistribution: ExtensionGenerator = (rng) => {
  const precisionFactor = rng.pick([2, 3, 4] as const);
  const sampleFactor = precisionFactor ** 2;
  return extensionStep({
    prompt: `Extension: by what factor must sample size n increase to divide the standard error by ${precisionFactor}?`,
    type: 'answer',
    acceptedAnswers: [String(sampleFactor)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! SE is proportional to 1/√n, so n must increase by ${precisionFactor}²=${sampleFactor}.`,
    feedbackIncorrect: `Solve 1/√k=1/${precisionFactor}; this gives k=${sampleFactor}.`,
    hint: 'Square the desired improvement in precision.',
    sceneData: { kind: 'sampling-distribution', p: 0.5, sampleSize: 25 * sampleFactor, repetitions: 80 },
  });
};

const geometryTrigConnections: ExtensionGenerator = (_rng, core) => {
  const scene = sceneOf(core, 1);
  const phase = scene?.kind === 'trig-connections' ? scene.phaseDeg : 90;
  const firstMaximum = phase + 90;
  return extensionStep({
    prompt: `Extension: at which x-value does y=sin(x−${phase}°) first reach its maximum for x≥0?`,
    type: 'answer',
    acceptedAnswers: [String(firstMaximum), `${firstMaximum}°`, `${firstMaximum} degrees`],
    tolerance: 0.001,
    feedbackCorrect: `Correct! The base maximum at 90° shifts right by ${phase}° to ${firstMaximum}°.` ,
    feedbackIncorrect: `Shift the base sine maximum x=90° right by ${phase}°, giving ${firstMaximum}°.` ,
    hint: 'A horizontal phase shift moves every key x-coordinate by the same amount.',
    sceneData: { kind: 'trig-connections', angleDeg: 90, amplitude: 1, phaseDeg: phase },
  });
};

const linearComplexMultiplication: ExtensionGenerator = (rng) => {
  const firstModulus = rng.int(2, 5);
  const secondModulus = rng.int(2, 5);
  const productModulus = firstModulus * secondModulus;
  return extensionStep({
    prompt: `Extension: if |z|=${firstModulus} and |w|=${secondModulus}, what is |zw|?`,
    type: 'answer',
    acceptedAnswers: [String(productModulus)],
    tolerance: 0.001,
    feedbackCorrect: `Correct! Moduli multiply, so |zw|=${firstModulus}×${secondModulus}=${productModulus}.`,
    feedbackIncorrect: `Use |zw|=|z||w|=${firstModulus}×${secondModulus}=${productModulus}.`,
    hint: 'Complex multiplication scales lengths multiplicatively.',
    sceneData: { kind: 'complex-multiplication', z: [firstModulus, 0], w: [0, secondModulus] },
  });
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const EXTENSION_GENERATORS: Record<string, ExtensionGenerator> = {
  'explorer-quadrant-predict': explorerQuadrant,
  'explorer-number-line': explorerNumberLine,
  'explorer-distance-from-origin': explorerDistance,
  'explorer-two-point-measures': explorerTwoPoint,
  'sandbox-gradient-effect': sandboxGradient,
  'sandbox-vertex-predict': sandboxVertex,
  'sandbox-function-transformations': sandboxTransformations,
  'sandbox-exponential-log': sandboxExponentialLog,
  'sandbox-intercept-find': sandboxIntercept,
  'sandbox-simultaneous-lines': sandboxSimultaneous,
  'sandbox-inequality-region': sandboxInequality,
  'sandbox-polar-curves': sandboxPolar,
  'sandbox-parametric-curves': sandboxParametric,
  'sandbox-distance-time': sandboxDistanceTime,
  'sandbox-piecewise-absolute': sandboxPiecewiseAbsolute,
  'calculus-tangent-slope-predict': calculusTangent,
  'calculus-riemann-convergence': calculusRiemann,
  'calculus-curve-sketching': calculusCurveSketching,
  'calculus-area-between': calculusAreaBetween,
  'calculus-direction-field': calculusDirectionField,
  'calculus-kinematics-links': calculusKinematics,
  'calculus-numerical-methods': calculusNumerical,
  'calculus-accumulation-link': calculusAccumulationLink,
  'calculus-function-derivative-link': calculusFunctionDerivativeLink,
  'geometry-angle-reasoning': geometryAngleReasoning,
  'geometry-reflect-predict': geometryReflect,
  'geometry-rotation-image': geometryRotation,
  'geometry-enlarge-predict': geometryEnlarge,
  'geometry-similarity-ratio': geometrySimilarity,
  'geometry-circle-scaling': geometryCircle,
  'geometry-pythagoras': geometryPythagoras,
  'geometry-sohcahtoa': geometrySohcahtoa,
  'geometry-unit-circle': geometryUnitCircle,
  'geometry-trig-connections': geometryTrigConnections,
  'statistics-distribution-shape': statisticsDistribution,
  'statistics-normal-zscore': statisticsNormal,
  'statistics-probability-simulation': statisticsProbability,
  'statistics-scatter-regression': statisticsScatter,
  'statistics-box-plot': statisticsBoxPlot,
  'statistics-tree-two-way': statisticsTree,
  'statistics-sampling-distribution': statisticsSamplingDistribution,
  'linear-vector-resultant': linearVector,
  'linear-matrix-transform': linearMatrix,
  'linear-complex-plane': linearComplex,
  'linear-complex-multiplication': linearComplexMultiplication,
};
