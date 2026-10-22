/**
 * Deterministic variant generator for Maths Lab Learn activities.
 *
 * Pure functions only — no side effects, no external dependencies.
 * Uses a self-implemented mulberry32 PRNG seeded by an integer for reproducibility.
 *
 * Whitelisted activities get fresh numeric parameters on each seed while
 * preserving mathematical relationships, "pretty" answers, and view-box bounds.
 */

import type { LearnStep } from './lab-activities';
import { ALL_ACTIVITY_IDS, LAB_ACTIVITIES } from './lab-activities';
import { EXTENSION_GENERATORS } from './lab-variant-extensions';
import { CORE_GENERATORS } from './lab-variant-cores';

// ─── PRNG ───────────────────────────────────────────────────────────────────

/** Mulberry32: a fast 32-bit PRNG with full period. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a seeded random helper object. */
function makeRng(seed: number) {
  const next = mulberry32(seed);
  return {
    /** [0, 1) */
    random: next,
    /** Integer in [min, max] inclusive */
    int(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** Pick one element from array */
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(next() * arr.length)];
    },
  };
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VariantResult {
  steps: LearnStep[];
  /** Activity supports variants */
  hasVariants: true;
}

export interface NoVariantResult {
  hasVariants: false;
}

export type MakeVariantResult = VariantResult | NoVariantResult;

// ─── Whitelists ─────────────────────────────────────────────────────────────

/**
 * Activities whose *core* steps are regenerated with fresh numbers, and whose
 * canvas reads those numbers back from `sceneData`. Every step of these
 * activities therefore carries typed scene parameters.
 */
const LEGACY_SCENE_SYNCED = [
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
  'sandbox-piecewise-absolute',
  'calculus-accumulation-link',
  'calculus-function-derivative-link',
  'statistics-sampling-distribution',
  'geometry-trig-connections',
  'linear-complex-multiplication',
] as const;

export const SCENE_SYNCED_VARIANTS: ReadonlySet<string> = new Set<string>([
  ...LEGACY_SCENE_SYNCED,
  ...Object.keys(CORE_GENERATORS),
]);

/**
 * Every activity supports variants. For the scene-synced set above, all steps
 * are regenerated. For the rest the authored core steps are kept verbatim — the
 * canvas is driven by those exact numbers — while the extension challenge is
 * regenerated with a rotating question form, so a repeat is a new problem
 * rather than the same task with different digits.
 */
export const VARIANT_WHITELIST: ReadonlySet<string> = new Set(ALL_ACTIVITY_IDS);

// ─── Pythagorean triple pool (a, b, c) ─────────────────────────────────────

const PYTH_TRIPLES: [number, number, number][] = [
  [3, 4, 5],
  [5, 12, 13],
  [8, 15, 17],
  [7, 24, 25],
  [6, 8, 10],
  [9, 12, 15],
  [9, 40, 41],
  [12, 16, 20],
  [15, 20, 25],
  [20, 21, 29],
];

// ─── Helper: round to n decimal places ──────────────────────────────────────

function round(v: number, dp: number = 2): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}


// ─── Variant generators ─────────────────────────────────────────────────────

function variantPythagoras(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  // Step 1: find hypotenuse from two legs
  const t1 = rng.pick(PYTH_TRIPLES);
  // Step 2: find a leg given hypotenuse and one leg (use different triple)
  const t2 = rng.pick(PYTH_TRIPLES.filter((t) => t[2] !== t1[2]));
  // Step 3: verify a triple
  const t3 = rng.pick(PYTH_TRIPLES);

  return [
    {
      prompt: `A right triangle has perpendicular sides ${t1[0]} and ${t1[1]}. Find the hypotenuse.`,
      type: 'answer',
      acceptedAnswers: [String(t1[2])],
      tolerance: 0.001,
      feedbackCorrect: `Correct! √(${t1[0]}² + ${t1[1]}²) = √${t1[0] ** 2 + t1[1] ** 2} = ${t1[2]}.`,
      feedbackIncorrect: `The hypotenuse is √(${t1[0]}² + ${t1[1]}²) = ${t1[2]}.`,
      hint: 'The hypotenuse is opposite the right angle.',
      sceneData: { kind: 'pythagoras', a: t1[0], b: t1[1], c: t1[2] },
    },
    {
      prompt: `A right triangle has hypotenuse ${t2[2]} and one shorter side ${t2[0]}. Find the other side.`,
      type: 'answer',
      acceptedAnswers: [String(t2[1])],
      tolerance: 0.001,
      feedbackCorrect: `Correct! √(${t2[2]}² − ${t2[0]}²) = √${t2[2] ** 2 - t2[0] ** 2} = ${t2[1]}.`,
      feedbackIncorrect: `Rearrange: b² = ${t2[2]}² − ${t2[0]}² = ${t2[2] ** 2 - t2[0] ** 2}, so b = ${t2[1]}.`,
      sceneData: { kind: 'pythagoras', a: t2[0], b: t2[1], c: t2[2] },
    },
    {
      prompt: `Do side lengths ${t3[0]}, ${t3[1]} and ${t3[2]} form a right triangle? Answer yes or no.`,
      type: 'predict',
      acceptedAnswers: ['yes', 'y'],
      feedbackCorrect: `Correct! ${t3[0]}² + ${t3[1]}² = ${t3[0] ** 2} + ${t3[1] ** 2} = ${t3[2] ** 2} = ${t3[2]}².`,
      feedbackIncorrect: `Check the largest side: ${t3[0]}² + ${t3[1]}² equals ${t3[2]}², so it is right-angled.`,
      sceneData: { kind: 'pythagoras', a: t3[0], b: t3[1], c: t3[2] },
    },
  ];
}

function variantCircleScaling(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  const r1 = rng.int(2, 9);
  const r2 = rng.int(2, 9);
  const k = rng.pick([2, 3, 4, 5]);

  return [
    {
      prompt: `A circle has radius ${r1}. What is its circumference in terms of π?`,
      type: 'answer',
      acceptedAnswers: [`${2 * r1}π`, `${2 * r1}pi`, `${2 * r1}*pi`, `${2 * r1} pi`],
      feedbackCorrect: `Correct! C = 2πr = 2π(${r1}) = ${2 * r1}π.`,
      feedbackIncorrect: `Use C = 2πr. With r = ${r1}, the circumference is ${2 * r1}π.`,
      hint: 'Circumference changes directly with radius.',
      sceneData: { kind: 'circle-scaling', radius: r1, scaleFactor: 1 },
    },
    {
      prompt: `A circle has radius ${r2}. What is its area in terms of π?`,
      type: 'answer',
      acceptedAnswers: [`${r2 ** 2}π`, `${r2 ** 2}pi`, `${r2 ** 2}*pi`, `${r2 ** 2} pi`],
      feedbackCorrect: `Correct! A = πr² = π(${r2}²) = ${r2 ** 2}π.`,
      feedbackIncorrect: `Square the radius: A = π(${r2}²) = ${r2 ** 2}π.`,
      sceneData: { kind: 'circle-scaling', radius: r2, scaleFactor: 1 },
    },
    {
      prompt: `If a circle radius is multiplied by ${k}, by what factor does its area change?`,
      type: 'predict',
      acceptedAnswers: [String(k ** 2), `factor ${k ** 2}`, `${k ** 2} times`, `times ${k ** 2}`],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Area depends on r², so the factor is ${k}² = ${k ** 2}.`,
      feedbackIncorrect: `Area scales with the square of the radius factor: ${k}² = ${k ** 2}.`,
      sceneData: { kind: 'circle-scaling', radius: r2, scaleFactor: k },
    },
  ];
}


function variantSohcahtoa(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  // Step 1: which ratio? (fixed conceptual question, randomise the sides used)
  const ratioQ = rng.pick(['sine', 'cosine', 'tangent'] as const);
  const ratioMap = { sine: ['opposite', 'hypotenuse', 'SOH'], cosine: ['adjacent', 'hypotenuse', 'CAH'], tangent: ['opposite', 'adjacent', 'TOA'] };
  const [side1, side2, mnemonic] = ratioMap[ratioQ];

  // Step 2: compute a trig ratio (use integer sides that give nice decimal)
  const opp2 = rng.pick([3, 4, 5, 6, 8]);
  const hyp2 = rng.pick([10, 20, 25].filter((h) => h > opp2));
  const sinVal = round(opp2 / hyp2, 2);
  const sinFrac = `${opp2}/${hyp2}`;
  // Compute adjacent for scene display
  const adj2 = round(Math.sqrt(hyp2 * hyp2 - opp2 * opp2), 2);
  const angle2 = round(Math.atan2(opp2, adj2) * 180 / Math.PI, 1);

  // Step 3: find angle from tan = 1 (always 45) or given simple ratio
  const opp3 = rng.pick([3, 4, 5, 6, 7, 8]);
  const adj3 = opp3; // tan = 1 → 45°

  return [
    {
      prompt: `Which ratio uses ${side1} and ${side2}: sine, cosine or tangent?`,
      type: 'predict',
      acceptedAnswers: [ratioQ, ratioQ.slice(0, 3), mnemonic.toLowerCase()],
      feedbackCorrect: `Correct! ${mnemonic} means ${ratioQ} θ = ${side1}/${side2}.`,
      feedbackIncorrect: `${mnemonic}: ${ratioQ} uses ${side1} divided by ${side2}.`,
      hint: 'Recall SOH–CAH–TOA.',
      sceneData: { kind: 'sohcahtoa', opp: 3, adj: 4, hyp: 5, angleDeg: 37, ratio: ratioQ },
    },
    {
      prompt: `For a right triangle, opposite = ${opp2} and hypotenuse = ${hyp2}. Find sin θ.`,
      type: 'answer',
      acceptedAnswers: [String(sinVal), sinFrac],
      tolerance: 0.001,
      feedbackCorrect: `Correct! sin θ = ${opp2}/${hyp2} = ${sinVal}.`,
      feedbackIncorrect: `Use opposite/hypotenuse: ${opp2}/${hyp2} = ${sinVal}.`,
      sceneData: { kind: 'sohcahtoa', opp: opp2, adj: adj2, hyp: hyp2, angleDeg: angle2, ratio: 'sine' },
    },
    {
      prompt: `A right triangle has opposite = ${opp3} and adjacent = ${adj3}. What is θ in degrees?`,
      type: 'answer',
      acceptedAnswers: ['45', '45°', '45 degrees'],
      tolerance: 0.01,
      feedbackCorrect: `Correct! tan θ = ${opp3}/${adj3} = 1, so θ = 45°.`,
      feedbackIncorrect: `Use tangent: θ = tan⁻¹(1) = 45°.`,
      sceneData: { kind: 'sohcahtoa', opp: opp3, adj: adj3, hyp: round(Math.sqrt(opp3 * opp3 + adj3 * adj3), 2), angleDeg: 45, ratio: 'tangent' },
    },
  ];
}

function variantNormalZscore(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  const mu = rng.pick([50, 60, 70, 80, 100, 120, 150]);
  const sigma = rng.pick([4, 5, 8, 10, 12, 15, 20]);
  // z must be an integer for pretty value
  const z = rng.pick([1, 2, 3, -1, -2]);
  const x = mu + z * sigma;

  return [
    {
      prompt: `For a normal model with μ = ${mu} and σ = ${sigma}, what is the z-score of x = ${x}?`,
      type: 'answer',
      acceptedAnswers: [String(z), `${z}.0`],
      tolerance: 0.001,
      feedbackCorrect: `Correct! z = (${x} − ${mu})/${sigma} = ${z}.`,
      feedbackIncorrect: `Use z = (x − μ)/σ = ${x - mu}/${sigma} = ${z}.`,
      sceneData: { kind: 'normal-zscore', mu, sigma, x, z },
    },
    {
      prompt: 'Approximately what percentage of a normal distribution lies within one standard deviation of the mean?',
      type: 'answer',
      acceptedAnswers: ['68', '68%', 'about 68%', 'approximately 68%'],
      tolerance: 0.5,
      feedbackCorrect: 'Correct! The empirical rule gives about 68%.',
      feedbackIncorrect: 'The 68–95–99.7 rule gives about 68% within μ ± σ.',
      sceneData: { kind: 'normal-zscore', mu, sigma, x: mu + sigma, z: 1 },
    },
    {
      prompt: 'If x is below the mean, is its z-score positive, zero or negative?',
      type: 'predict',
      acceptedAnswers: ['negative', 'less than zero', '<0'],
      feedbackCorrect: 'Correct! x − μ is negative when x is below the mean.',
      feedbackIncorrect: 'Below the mean means x − μ < 0, so z is negative.',
      sceneData: { kind: 'normal-zscore', mu, sigma, x: mu - sigma, z: -1 },
    },
  ];
}


function variantVectorResultant(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  // Step 1: magnitude — use Pythagorean triple components
  const t = rng.pick(PYTH_TRIPLES);
  const vx = t[0];
  const vy = t[1];
  const mag = t[2];

  // Step 2: vector addition with small integer components
  const ax = rng.int(-5, 5);
  const ay = rng.int(-5, 5);
  const bx = rng.int(-5, 5);
  const by = rng.int(-5, 5);
  const sx = ax + bx;
  const sy = ay + by;

  // Step 3: direction angle — use axis-aligned vector for clean answer
  const dirChoice = rng.pick(['up', 'down', 'left', 'right'] as const);
  const dirMap = {
    up: { vec: [0, rng.int(1, 8)], angle: '90', desc: 'straight up at 90°' },
    down: { vec: [0, -rng.int(1, 8)], angle: '270', desc: 'straight down at 270°' },
    left: { vec: [-rng.int(1, 8), 0], angle: '180', desc: 'to the left at 180°' },
    right: { vec: [rng.int(1, 8), 0], angle: '0', desc: 'along positive x at 0°' },
  };
  const dir = dirMap[dirChoice];

  return [
    {
      prompt: `What is the magnitude of the vector (${vx}, ${vy})?`,
      type: 'answer',
      acceptedAnswers: [String(mag)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! |v| = √(${vx}² + ${vy}²) = ${mag}.`,
      feedbackIncorrect: 'Use Pythagoras on the components.',
      sceneData: { kind: 'vector-resultant', vecA: [vx, vy], vecB: [0, 0] },
    },
    {
      prompt: `Add (${ax}, ${ay}) and (${bx}, ${by}). Enter x, y.`,
      type: 'answer',
      acceptedAnswers: [`${sx}, ${sy}`, `(${sx}, ${sy})`, `${sx},${sy}`, `(${sx},${sy})`],
      feedbackCorrect: `Correct! Add matching components to get (${sx}, ${sy}).`,
      feedbackIncorrect: `(${ax} + ${bx}, ${ay} + ${by}) = (${sx}, ${sy}).`,
      sceneData: { kind: 'vector-resultant', vecA: [ax, ay], vecB: [bx, by] },
    },
    {
      prompt: `What is the direction angle of the vector (${dir.vec[0]}, ${dir.vec[1]}), measured anticlockwise from positive x?`,
      type: 'answer',
      acceptedAnswers: [dir.angle, `${dir.angle}°`, `${dir.angle} degrees`],
      tolerance: 0.01,
      feedbackCorrect: `Correct! The vector points ${dir.desc}.`,
      feedbackIncorrect: `The vector points ${dir.desc}.`,
      sceneData: { kind: 'vector-resultant', vecA: [dir.vec[0], dir.vec[1]], vecB: [0, 0] },
    },
  ];
}

function variantMatrixTransform(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  // Step 1: diagonal stretch matrix
  const sx = rng.pick([2, 3, 4]);
  const sy = rng.pick([1, 2, 3]);
  const px = rng.int(1, 4);
  const py = rng.int(1, 4);
  const ix = sx * px;
  const iy = sy * py;

  // Step 2: 90° rotation matrix [[0,-1],[1,0]]
  const rx = rng.int(1, 5);
  const ry = rng.int(1, 5);
  const rotX = -ry;
  const rotY = rx;

  // Step 3: area scale factor (determinant of diagonal matrix)
  const a = rng.pick([2, 3, 4, 5]);
  const d = rng.pick([2, 3, 4, 5]);
  const det = a * d;

  return [
    {
      prompt: `Apply [[${sx},0],[0,${sy}]] to the point (${px},${py}). What is the image?`,
      type: 'answer',
      acceptedAnswers: [`${ix}, ${iy}`, `(${ix}, ${iy})`, `${ix},${iy}`, `(${ix},${iy})`],
      feedbackCorrect: `Correct! x is scaled by ${sx} and y by ${sy}.`,
      feedbackIncorrect: `(${sx}×${px} + 0×${py}, 0×${px} + ${sy}×${py}) = (${ix},${iy}).`,
      sceneData: { kind: 'matrix-transform', matrix: [[sx, 0], [0, sy]], point: [px, py] },
    },
    {
      prompt: `Apply [[0,-1],[1,0]] to (${rx},${ry}). What is the image?`,
      type: 'answer',
      acceptedAnswers: [`${rotX}, ${rotY}`, `(${rotX}, ${rotY})`, `${rotX},${rotY}`, `(${rotX},${rotY})`],
      feedbackCorrect: 'Correct! This matrix rotates 90° anticlockwise.',
      feedbackIncorrect: `(0×${rx} − 1×${ry}, 1×${rx} + 0×${ry}) = (${rotX},${rotY}).`,
      sceneData: { kind: 'matrix-transform', matrix: [[0, -1], [1, 0]], point: [rx, ry] },
    },
    {
      prompt: `What area scale factor is produced by [[${a},0],[0,${d}]]?`,
      type: 'answer',
      acceptedAnswers: [String(det)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The determinant is ${a}×${d} = ${det}.`,
      feedbackIncorrect: `Area scale is |det A| = |${a}×${d} − 0| = ${det}.`,
      sceneData: { kind: 'matrix-transform', matrix: [[a, 0], [0, d]], point: [1, 1] },
    },
  ];
}


function variantComplexPlane(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  // Step 1: modulus — use Pythagorean components
  const t = rng.pick(PYTH_TRIPLES);
  const re = t[0];
  const im = t[1];
  const mod = t[2];

  // Step 2: complex addition
  const a1 = rng.int(1, 6);
  const b1 = rng.int(1, 6);
  const a2 = rng.int(1, 6);
  const b2 = rng.int(-5, 5);
  const sumRe = a1 + a2;
  const sumIm = b1 + b2;
  const sumStr = sumIm >= 0 ? `${sumRe} + ${sumIm}i` : `${sumRe} - ${Math.abs(sumIm)}i`;
  const sumAlt = sumIm >= 0 ? `${sumRe}+${sumIm}i` : `${sumRe}-${Math.abs(sumIm)}i`;

  return [
    {
      prompt: `What is the modulus of z = ${re} + ${im}i?`,
      type: 'answer',
      acceptedAnswers: [String(mod)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! |z| = √(${re}² + ${im}²) = ${mod}.`,
      feedbackIncorrect: 'The modulus is the distance from the origin.',
      sceneData: { kind: 'complex-plane', re, im, operation: 'modulus' },
    },
    {
      prompt: `Simplify (${a1} + ${b1}i) + (${a2} ${b2 >= 0 ? '+' : '−'} ${Math.abs(b2)}i).`,
      type: 'answer',
      acceptedAnswers: [sumStr, sumAlt],
      feedbackCorrect: `Correct! Add real and imaginary parts separately to get ${sumStr}.`,
      feedbackIncorrect: `Real parts give ${sumRe} and imaginary parts give ${sumIm}i.`,
      sceneData: { kind: 'complex-plane', re: a1, im: b1, operation: 'add', other: [a2, b2], result: [sumRe, sumIm] },
    },
    {
      prompt: 'Multiplying a non-zero complex number by i rotates it by how many degrees anticlockwise?',
      type: 'answer',
      acceptedAnswers: ['90', '90°', '90 degrees'],
      tolerance: 0.01,
      feedbackCorrect: 'Correct! i has argument 90°, so arguments increase by 90°.',
      feedbackIncorrect: 'Multiplication adds arguments; arg(i) = 90°.',
      sceneData: { kind: 'complex-plane', re: 1, im: 0, operation: 'multiply-i', result: [0, 1] },
    },
  ];
}

function variantNumericalMethods(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  // Step 1: Newton's method for x²−k starting at x₀
  // Choose k so √k is irrational but x₁ is nice
  // x₁ = x₀ - (x₀²-k)/(2x₀) = (x₀² + k) / (2x₀)
  const x0 = rng.pick([1, 2, 3]);
  const k = rng.pick([2, 3, 5, 7]);
  const x1Num = x0 * x0 + k;
  const x1Den = 2 * x0;
  const gcd = gcdFn(x1Num, x1Den);
  const x1FracNum = x1Num / gcd;
  const x1FracDen = x1Den / gcd;
  const x1Decimal = round(x1Num / x1Den, 4);
  const x1Answers: string[] = [String(x1Decimal)];
  if (x1FracDen === 1) {
    x1Answers.push(String(x1FracNum));
  } else {
    x1Answers.push(`${x1FracNum}/${x1FracDen}`);
  }

  // Step 2: single trapezoid for y=x² on [0, b]
  const b = rng.pick([1, 2, 3, 4]);
  const trapEst = round((b * (0 + b * b)) / 2, 2);

  return [
    {
      prompt: `For f(x)=x²−${k}, Newton's method starts at x₀=${x0}. What is x₁?`,
      type: 'answer',
      acceptedAnswers: x1Answers,
      tolerance: 0.001,
      feedbackCorrect: `Correct! x₁ = ${x0} − (${x0 * x0 - k})/${2 * x0} = ${x1FracDen === 1 ? x1FracNum : x1FracNum + '/' + x1FracDen}.`,
      feedbackIncorrect: "Use x₁ = x₀ − f(x₀)/f'(x₀).",
      sceneData: { kind: 'numerical-newton', k, x0 },
    },
    {
      prompt: `Using one trapezoid for y=x² on [0,${b}], what is the estimate?`,
      type: 'answer',
      acceptedAnswers: [String(trapEst), ...(Number.isInteger(trapEst) ? [] : [String(round(trapEst, 1))])],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Width ${b} times average height (0+${b * b})/2 gives ${trapEst}.`,
      feedbackIncorrect: 'Trapezoidal estimate = (b−a)(f(a)+f(b))/2.',
      sceneData: { kind: 'numerical-trapezoid', intervalStart: 0, intervalEnd: b, partitions: 1 },
    },
    {
      prompt: 'For a smooth curve, does increasing the number of trapezoids generally reduce or increase approximation error?',
      type: 'predict',
      acceptedAnswers: ['reduce', 'reduces', 'decrease', 'decreases', 'less', 'smaller'],
      feedbackCorrect: 'Correct! More trapezoids improve approximation for smooth curves.',
      feedbackIncorrect: 'More subdivisions reduce the gap between linear approximation and the curve.',
      sceneData: { kind: 'numerical-trapezoid', intervalStart: 0, intervalEnd: b, partitions: 12 },
    },
  ];
}

/** Greatest common divisor (Euclidean algorithm) */
function gcdFn(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}


function variantDistanceFromOrigin(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  // All three steps use Pythagorean triples for clean integer distances
  const triples = [...PYTH_TRIPLES];
  const t1 = rng.pick(triples);
  const t2idx = rng.int(0, triples.length - 1);
  const t2 = triples[t2idx];
  const t3 = rng.pick(triples.filter((t) => t[2] !== t1[2] && t[2] !== t2[2]));

  return [
    {
      prompt: `What is the distance from (${t1[0]}, ${t1[1]}) to the origin? (Give the exact value)`,
      type: 'answer',
      acceptedAnswers: [String(t1[2])],
      tolerance: 0.01,
      feedbackCorrect: `Correct! √(${t1[0]}² + ${t1[1]}²) = √${t1[0] ** 2 + t1[1] ** 2} = ${t1[2]}.`,
      feedbackIncorrect: `Use the distance formula: d = √(x² + y²). So d = √(${t1[0] ** 2} + ${t1[1] ** 2}) = ${t1[2]}.`,
      hint: 'd = √(x² + y²)',
      sceneData: { kind: 'distance-from-origin', point: [t1[0], t1[1]] },
    },
    {
      prompt: `What is the distance from (${t2[0]}, ${t2[1]}) to the origin?`,
      type: 'answer',
      acceptedAnswers: [String(t2[2])],
      tolerance: 0.01,
      feedbackCorrect: `Correct! √(${t2[0]}² + ${t2[1]}²) = √${t2[0] ** 2 + t2[1] ** 2} = ${t2[2]}.`,
      feedbackIncorrect: `d = √(${t2[0]}² + ${t2[1]}²) = √${t2[0] ** 2 + t2[1] ** 2} = ${t2[2]}.`,
      hint: 'd = √(x² + y²)',
      sceneData: { kind: 'distance-from-origin', point: [t2[0], t2[1]] },
    },
    {
      prompt: `What is the distance from (${t3[0]}, ${t3[1]}) to the origin?`,
      type: 'answer',
      acceptedAnswers: [String(t3[2])],
      tolerance: 0.01,
      feedbackCorrect: `Correct! √(${t3[0]}² + ${t3[1]}²) = √${t3[0] ** 2 + t3[1] ** 2} = ${t3[2]}. This is a ${t3[0]}-${t3[1]}-${t3[2]} Pythagorean triple!`,
      feedbackIncorrect: `d = √(${t3[0]}² + ${t3[1]}²) = √${t3[0] ** 2 + t3[1] ** 2} = ${t3[2]}.`,
      sceneData: { kind: 'distance-from-origin', point: [t3[0], t3[1]] },
    },
  ];
}

function variantTwoPointMeasures(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  // Choose two points that give integer gradient numerator and denominator,
  // nice midpoint, and Pythagorean distance
  // Use: P(px, py), Q(px + dx, py + dy) where (dx, dy, dist) form a triple
  const t = rng.pick(PYTH_TRIPLES.filter((tr) => tr[2] <= 15));
  const px = rng.int(-3, 3);
  const py = rng.int(-3, 3);
  const dx = t[0];
  const dy = t[1];
  const qx = px + dx;
  const qy = py + dy;
  const dist = t[2];

  // Gradient = dy/dx — ensure dx != 0 (guaranteed since triple a >= 3)
  const gradNum = dy;
  const gradDen = dx;
  const g = gcdFn(Math.abs(gradNum), Math.abs(gradDen));
  const gradSimNum = gradNum / g;
  const gradSimDen = gradDen / g;
  const gradDecimal = round(dy / dx, 4);
  const gradAnswers: string[] = [];
  if (gradSimDen === 1) {
    gradAnswers.push(String(gradSimNum));
  } else {
    gradAnswers.push(`${gradSimNum}/${gradSimDen}`);
  }
  gradAnswers.push(String(gradDecimal));

  // Midpoint
  const mx = round((px + qx) / 2, 2);
  const my = round((py + qy) / 2, 2);
  const midAnswers = [
    `${mx}, ${my}`,
    `(${mx}, ${my})`,
    `${mx},${my}`,
    `(${mx},${my})`,
  ];

  return [
    {
      prompt: `For P(${px}, ${py}) and Q(${qx}, ${qy}), what is the gradient of PQ?`,
      type: 'answer',
      acceptedAnswers: gradAnswers,
      tolerance: 0.001,
      feedbackCorrect: `Correct! Gradient = rise/run = (${qy} - ${py})/(${qx} - ${px}) = ${gradAnswers[0]}.`,
      feedbackIncorrect: `Use m = (y₂-y₁)/(x₂-x₁) = (${qy}-${py})/(${qx}-${px}) = ${gradAnswers[0]}.`,
      hint: 'Subtract the y-coordinates, then divide by the difference in x-coordinates.',
      sceneData: { kind: 'two-point-measures', p: [px, py], q: [qx, qy] },
    },
    {
      prompt: `For the same points, what is the midpoint? Enter x, y.`,
      type: 'answer',
      acceptedAnswers: midAnswers,
      feedbackCorrect: `Correct! Average the coordinates: ((${px}+${qx})/2, (${py}+${qy})/2) = (${mx}, ${my}).`,
      feedbackIncorrect: `Average each coordinate separately: ((${px}+${qx})/2, (${py}+${qy})/2) = (${mx}, ${my}).`,
      hint: 'The midpoint coordinates are the averages of the endpoint coordinates.',
      sceneData: { kind: 'two-point-measures', p: [px, py], q: [qx, qy] },
    },
    {
      prompt: `For P(${px}, ${py}) and Q(${qx}, ${qy}), what is the distance PQ?`,
      type: 'answer',
      acceptedAnswers: [String(dist)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! √((${qx}-${px})² + (${qy}-${py})²) = √(${dx ** 2}+${dy ** 2}) = ${dist}.`,
      feedbackIncorrect: `Use d = √((x₂-x₁)²+(y₂-y₁)²) = √(${dx}²+${dy}²) = ${dist}.`,
      hint: `The horizontal and vertical changes form a ${dx}-${dy}-${dist} right triangle.`,
      sceneData: { kind: 'two-point-measures', p: [px, py], q: [qx, qy] },
    },
  ];
}

function variantPiecewiseAbsolute(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  const a = rng.pick([1, 2, 3, -1, -2]);
  const h = rng.int(-2, 2);
  const k = rng.int(-3, 2);
  const x = h + 2;
  const y = 2 * a + k;
  return [
    {
      prompt: `For f(x) = ${a}|x − (${h})| + (${k}), give the vertex as an ordered pair.`,
      type: 'answer',
      acceptedAnswers: [`(${h},${k})`, `(${h}, ${k})`, `${h},${k}`, `${h}, ${k}`],
      feedbackCorrect: `Correct! The vertex is (${h}, ${k}).`,
      feedbackIncorrect: 'In a|x−h|+k, the vertex is (h,k).',
      sceneData: { kind: 'piecewise-absolute', a, h, k, x: h },
    },
    {
      prompt: `For the same function, what is f(${x})?`,
      type: 'answer',
      acceptedAnswers: [String(y)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! f(${x})=${y}.`,
      feedbackIncorrect: `Substitute x=${x} and evaluate the absolute value first.`,
      sceneData: { kind: 'piecewise-absolute', a, h, k, x },
    },
    {
      prompt: `What is the gradient of the left branch of f(x) = ${a}|x − (${h})| + (${k})?`,
      type: 'answer',
      acceptedAnswers: [String(-a)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The left branch gradient is ${-a}.`,
      feedbackIncorrect: 'For x<h, the branch gradient is −a.',
      sceneData: { kind: 'piecewise-absolute', a, h, k, x: h - 1 },
    },
  ];
}

function variantAccumulationLink(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  const m = rng.pick([1, 2, 3]);
  const c = rng.int(-1, 3);
  const x = rng.pick([1, 2, 3]);
  const area = round(0.5 * m * x * x + c * x, 3);
  const rate = m * x + c;
  return [
    {
      prompt: `Let f(t)=${m}t+(${c}) and A(x)=∫₀ˣf(t)dt. What is A(${x})?`,
      type: 'answer',
      acceptedAnswers: [String(area)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The signed area is ${area}.`,
      feedbackIncorrect: `Integrate ${m}t+(${c}) from 0 to ${x}.`,
      sceneData: { kind: 'accumulation-link', m, c, x },
    },
    {
      prompt: `For the same accumulation function, what is A′(${x})?`,
      type: 'answer',
      acceptedAnswers: [String(rate)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! A′(${x})=f(${x})=${rate}.`,
      feedbackIncorrect: 'Use A′(x)=f(x).',
      sceneData: { kind: 'accumulation-link', m, c, x },
    },
    {
      prompt: 'If f is negative on an interval, is its accumulation A increasing or decreasing there?',
      type: 'predict',
      acceptedAnswers: ['decreasing', 'decreases', 'decrease'],
      feedbackCorrect: 'Correct! A′=f<0, so A decreases.',
      feedbackIncorrect: 'The sign of f is the sign of A′.',
      sceneData: { kind: 'accumulation-link', m: 1, c: -3, x: 1 },
    },
  ];
}

function variantFunctionDerivativeLink(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  const a = rng.pick([1, 2, -1]);
  const c = -3 * a;
  const x = rng.pick([0, 2, -2]);
  const slope = 3 * a * x * x + c;
  return [
    {
      prompt: `For f(x)=${a}x³+(${c})x, what is f′(${x})?`,
      type: 'answer',
      acceptedAnswers: [String(slope)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! f′(${x})=${slope}.`,
      feedbackIncorrect: `Differentiate to get ${3 * a}x²+(${c}), then substitute.`,
      sceneData: { kind: 'function-derivative-link', a, b: 0, c, d: 0, x },
    },
    {
      prompt: `At x=${x}, is this function increasing, decreasing or stationary?`,
      type: 'predict',
      acceptedAnswers: slope > 0 ? ['increasing', 'increases'] : slope < 0 ? ['decreasing', 'decreases'] : ['stationary'],
      feedbackCorrect: 'Correct! The sign of f′ gives the local behaviour of f.',
      feedbackIncorrect: `Use the sign of f′(${x})=${slope}.`,
      sceneData: { kind: 'function-derivative-link', a, b: 0, c, d: 0, x },
    },
    {
      prompt: `Give the stationary x-values of f(x)=${a}x³+(${c})x, separated by a comma.`,
      type: 'answer',
      acceptedAnswers: ['-1,1', '-1, 1', '1,-1', '1, -1'],
      feedbackCorrect: 'Correct! f′=0 at x=−1 and x=1.',
      feedbackIncorrect: `Solve ${3 * a}x²+(${c})=0.`,
      sceneData: { kind: 'function-derivative-link', a, b: 0, c, d: 0, x: 1 },
    },
  ];
}

function variantSamplingDistribution(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  const n = rng.pick([16, 25, 100]);
  const se = round(0.5 / Math.sqrt(n), 4);
  const largerN = n * 4;
  const smallerSe = round(0.5 / Math.sqrt(largerN), 4);
  return [
    {
      prompt: `For p=0.5 and n=${n}, what is the standard error of p-hat?`,
      type: 'answer',
      acceptedAnswers: [String(se)],
      tolerance: 0.0001,
      feedbackCorrect: `Correct! √(0.25/${n})=${se}.`,
      feedbackIncorrect: 'Use √(p(1−p)/n).',
      sceneData: { kind: 'sampling-distribution', p: 0.5, sampleSize: n, repetitions: 80 },
    },
    {
      prompt: `If sample size increases to ${largerN}, what is the new standard error?`,
      type: 'answer',
      acceptedAnswers: [String(smallerSe)],
      tolerance: 0.0001,
      feedbackCorrect: `Correct! The standard error halves to ${smallerSe}.`,
      feedbackIncorrect: `Calculate √(0.25/${largerN}).`,
      sceneData: { kind: 'sampling-distribution', p: 0.5, sampleSize: largerN, repetitions: 80 },
    },
    {
      prompt: 'As sample size increases, does the sampling distribution become wider or narrower?',
      type: 'predict',
      acceptedAnswers: ['narrower', 'more narrow', 'smaller'],
      feedbackCorrect: 'Correct! Larger n reduces standard error.',
      feedbackIncorrect: 'Standard error is proportional to 1/√n.',
      sceneData: { kind: 'sampling-distribution', p: 0.5, sampleSize: largerN, repetitions: 80 },
    },
  ];
}

function variantTrigConnections(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  const angle = rng.pick([30, 45, 60]);
  const sine = angle === 30 ? 0.5 : angle === 45 ? round(Math.SQRT1_2, 4) : round(Math.sqrt(3) / 2, 4);
  const amplitude = rng.pick([2, 3, 4]);
  const phase = rng.pick([45, 90, 180]);
  return [
    {
      prompt: `What is sin ${angle}°? Give a decimal to 4 places if needed.`,
      type: 'answer',
      acceptedAnswers: [String(sine), ...(angle === 30 ? ['1/2'] : [])],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The unit-circle y-coordinate is ${sine}.`,
      feedbackIncorrect: 'Read the y-coordinate of the unit-circle point.',
      sceneData: { kind: 'trig-connections', angleDeg: angle, amplitude: 1, phaseDeg: 0 },
    },
    {
      prompt: `For y=sin(x−${phase}°), is the graph shifted left or right?`,
      type: 'predict',
      acceptedAnswers: ['right', 'to the right'],
      feedbackCorrect: `Correct! It shifts ${phase}° right.`,
      feedbackIncorrect: 'Subtracting h inside sin(x−h) shifts right.',
      sceneData: { kind: 'trig-connections', angleDeg: angle, amplitude: 1, phaseDeg: phase },
    },
    {
      prompt: `What is the range of y=${amplitude}sin x?`,
      type: 'answer',
      acceptedAnswers: [`[-${amplitude},${amplitude}]`, `[-${amplitude}, ${amplitude}]`, `-${amplitude} to ${amplitude}`],
      feedbackCorrect: `Correct! The range is [−${amplitude},${amplitude}].`,
      feedbackIncorrect: 'Multiply the base range [−1,1] by the amplitude.',
      sceneData: { kind: 'trig-connections', angleDeg: 90, amplitude, phaseDeg: 0 },
    },
  ];
}

function variantComplexMultiplication(seed: number): LearnStep[] {
  const rng = makeRng(seed);
  const z: [number, number] = [rng.int(1, 3), rng.int(-2, 3)];
  const w = rng.pick<readonly [number, number]>([[0, 1], [1, 1], [2, 0]]) as [number, number];
  const product: [number, number] = [z[0] * w[0] - z[1] * w[1], z[0] * w[1] + z[1] * w[0]];
  const productText = product[1] >= 0 ? `${product[0]}+${product[1]}i` : `${product[0]}-${Math.abs(product[1])}i`;
  const modulus = round(Math.hypot(w[0], w[1]), 4);
  const angle = round(Math.atan2(w[1], w[0]) * 180 / Math.PI, 1);
  return [
    {
      prompt: `Calculate (${z[0]}${z[1] >= 0 ? '+' : '−'}${Math.abs(z[1])}i)(${w[0]}+${w[1]}i).`,
      type: 'answer',
      acceptedAnswers: [productText, productText.replace('+', ' + ').replace('-', ' - ')],
      feedbackCorrect: `Correct! The product is ${productText}.`,
      feedbackIncorrect: 'Expand and use i²=−1.',
      sceneData: { kind: 'complex-multiplication', z, w },
    },
    {
      prompt: `Multiplication by ${w[0]}+${w[1]}i scales modulus by what factor?`,
      type: 'answer',
      acceptedAnswers: [String(modulus), ...(modulus === 1.4142 ? ['sqrt(2)', '√2'] : [])],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The scale factor is |w|=${modulus}.`,
      feedbackIncorrect: 'Find √(Re(w)²+Im(w)²).',
      sceneData: { kind: 'complex-multiplication', z, w },
    },
    {
      prompt: `By how many degrees does multiplication by ${w[0]}+${w[1]}i rotate anticlockwise?`,
      type: 'answer',
      acceptedAnswers: [String(angle), `${angle}°`],
      tolerance: 0.1,
      feedbackCorrect: `Correct! arg(w)=${angle}°.`,
      feedbackIncorrect: 'The rotation is the argument of the multiplier.',
      sceneData: { kind: 'complex-multiplication', z, w },
    },
  ];
}

// ─── Main export ────────────────────────────────────────────────────────────

const GENERATORS: Record<string, (seed: number) => LearnStep[]> = {
  'geometry-pythagoras': variantPythagoras,
  'geometry-circle-scaling': variantCircleScaling,
  'geometry-sohcahtoa': variantSohcahtoa,
  'statistics-normal-zscore': variantNormalZscore,
  'linear-vector-resultant': variantVectorResultant,
  'linear-matrix-transform': variantMatrixTransform,
  'linear-complex-plane': variantComplexPlane,
  'calculus-numerical-methods': variantNumericalMethods,
  'explorer-distance-from-origin': variantDistanceFromOrigin,
  'explorer-two-point-measures': variantTwoPointMeasures,
  'sandbox-piecewise-absolute': variantPiecewiseAbsolute,
  'calculus-accumulation-link': variantAccumulationLink,
  'calculus-function-derivative-link': variantFunctionDerivativeLink,
  'statistics-sampling-distribution': variantSamplingDistribution,
  'geometry-trig-connections': variantTrigConnections,
  'linear-complex-multiplication': variantComplexMultiplication,
};

/**
 * Generate a variant set of LearnSteps for an activity.
 * Returns `{ hasVariants: false }` for unknown activity ids.
 *
 * The function is pure and deterministic: same (activityId, seed) → same output.
 * Core steps come from a number-regenerating generator when one exists, and
 * otherwise from the authored catalogue so the canvas stays in sync. The
 * extension step is always regenerated with a rotating question form.
 */
export function makeVariant(activityId: string, seed: number): MakeVariantResult {
  const activity = LAB_ACTIVITIES[activityId as keyof typeof LAB_ACTIVITIES];
  if (!activity) return { hasVariants: false };

  const legacyGenerator = GENERATORS[activityId];
  const coreGenerator = CORE_GENERATORS[activityId];
  const core = legacyGenerator
    ? legacyGenerator(seed).filter((step) => step.tier !== 'extension')
    : coreGenerator
      ? coreGenerator(makeRng((seed ^ 0x2545_f491) | 0)).filter((step) => step.tier !== 'extension')
      : activity.steps.filter((step) => step.tier !== 'extension');

  const extensionGenerator = EXTENSION_GENERATORS[activityId];
  const extension = extensionGenerator
    ? [extensionGenerator(makeRng((seed ^ 0x5f37_59df) | 0), core)]
    : activity.steps.filter((step) => step.tier === 'extension');

  return { hasVariants: true, steps: [...core, ...extension] };
}

/**
 * Check whether an activity supports variant generation.
 */
export function hasVariants(activityId: string): boolean {
  return VARIANT_WHITELIST.has(activityId);
}

/**
 * Check whether an activity regenerates the numbers its canvas reads, rather
 * than only its extension challenge.
 */
export function hasSceneSyncedVariants(activityId: string): boolean {
  return SCENE_SYNCED_VARIANTS.has(activityId);
}
