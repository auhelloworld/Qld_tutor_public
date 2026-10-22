/**
 * Deterministic core-step variant generators.
 *
 * These regenerate the three graded steps of an activity together with the typed
 * `sceneData` its canvas reads back, so "New numbers" changes the actual task
 * instead of only the unlockable extension challenge.
 *
 * Contracts every generator here must keep:
 * - Pure and deterministic: the same seed gives the same steps.
 * - Every step carries `sceneData`, and the prompt only states numbers that the
 *   same `sceneData` puts on the canvas, so the two can never disagree.
 * - Generated values stay inside the scene's authored view box.
 * - Answers are derived from the generated parameters, never hard-coded.
 */

import type { LearnStep } from './lab-activities';
import type { VariantRng } from './lab-variant-extensions';

// ─── Shared helpers ──────────────────────────────────────────────────────────

function round(v: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** Signed term such as `- 4` / `+ 9` for readable prompts. */
function signed(v: number): string {
  return v < 0 ? `- ${Math.abs(v)}` : `+ ${v}`;
}

/** `mx + c`, using the usual shortcuts for m = ±1 and c = 0. */
function linearRule(m: number, c: number, name = 'x'): string {
  const slope = m === 1 ? name : m === -1 ? `-${name}` : `${m}${name}`;
  if (c === 0) return `y = ${slope}`;
  return `y = ${slope} ${c < 0 ? '-' : '+'} ${Math.abs(c)}`;
}

/** `a x² + b x + k`, omitting zero terms and unit coefficients. */
function quadraticRule(a: number, b: number, k: number): string {
  const lead = a === 1 ? 'x²' : a === -1 ? '-x²' : `${a}x²`;
  const linear = b === 0 ? '' : ` ${b < 0 ? '-' : '+'} ${Math.abs(b) === 1 ? '' : Math.abs(b)}x`;
  const constant = k === 0 ? '' : ` ${k < 0 ? '-' : '+'} ${Math.abs(k)}`;
  return `y = ${lead}${linear}${constant}`;
}

function pointAnswers(x: number, y: number): string[] {
  return [`${x}, ${y}`, `(${x}, ${y})`, `${x},${y}`, `(${x},${y})`];
}

/** Draw `count` distinct members of `pool` without replacement. */
function sample<T>(rng: VariantRng, pool: readonly T[], count: number): T[] {
  const remaining = [...pool];
  const picked: T[] = [];
  for (let i = 0; i < count && remaining.length > 0; i += 1) {
    const index = rng.int(0, remaining.length - 1);
    picked.push(remaining.splice(index, 1)[0]);
  }
  return picked;
}

export type CoreGenerator = (rng: VariantRng) => LearnStep[];

// ─── Explorer ────────────────────────────────────────────────────────────────

const QUADRANTS = [
  { roman: 'I', digit: '1', sx: 1, sy: 1, rule: 'x > 0 and y > 0', where: 'top-right' },
  { roman: 'II', digit: '2', sx: -1, sy: 1, rule: 'x < 0 and y > 0', where: 'top-left' },
  { roman: 'III', digit: '3', sx: -1, sy: -1, rule: 'x < 0 and y < 0', where: 'bottom-left' },
  { roman: 'IV', digit: '4', sx: 1, sy: -1, rule: 'x > 0 and y < 0', where: 'bottom-right' },
] as const;

const coreQuadrantPredict: CoreGenerator = (rng) => {
  const chosen = sample(rng, QUADRANTS, 3);
  return chosen.map((q, index) => {
    const x = q.sx * rng.int(1, 7);
    const y = q.sy * rng.int(1, 7);
    return {
      prompt:
        index === 0
          ? `The point (${x}, ${y}) is in which quadrant? (Answer: I, II, III, or IV)`
          : `The point (${x}, ${y}) is in which quadrant?`,
      type: 'predict' as const,
      acceptedAnswers: [q.roman, q.digit, `Quadrant ${q.roman}`, `quadrant ${q.digit}`],
      feedbackCorrect: `Correct! ${q.rule} means Quadrant ${q.roman} (${q.where}).`,
      feedbackIncorrect: `Not quite. When ${q.rule}, the point is in Quadrant ${q.roman} (${q.where}).`,
      hint: 'Positive x is right and negative x is left; positive y is up and negative y is down.',
      sceneData: { kind: 'quadrant-point' as const, point: [x, y] as [number, number] },
    };
  });
};

// ─── Sandbox ─────────────────────────────────────────────────────────────────

const coreGradientEffect: CoreGenerator = (rng) => {
  const m1 = rng.pick([2, 3, -2, -3] as const);
  const c = rng.int(-3, 3);
  const traceX = rng.int(1, 3);
  const m2 = m1 > 0 ? rng.pick([-1, -2] as const) : rng.pick([1, 2] as const);
  const y1 = m1 * traceX + c;
  const downhill = m2 < 0;

  return [
    {
      prompt: `For ${linearRule(m1, c)}, what is the y-value when x = ${traceX}?`,
      type: 'answer',
      acceptedAnswers: [String(y1)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! y = ${m1}(${traceX}) ${signed(c)} = ${y1}.`,
      feedbackIncorrect: `Substitute x = ${traceX}: y = ${m1}(${traceX}) ${signed(c)} = ${y1}.`,
      hint: `Substitute x = ${traceX} into the rule.`,
      sceneData: { kind: 'function-plot', funType: 'linear', m: m1, c, traceX },
    },
    {
      prompt: `If we change the gradient from ${m1} to ${m2} (so ${linearRule(m2, c)}), does the line slope up or down from left to right?`,
      type: 'predict',
      acceptedAnswers: downhill
        ? ['down', 'downward', 'downwards', 'slopes down', 'decreasing']
        : ['up', 'upward', 'upwards', 'slopes up', 'increasing'],
      feedbackCorrect: `Correct! A ${downhill ? 'negative' : 'positive'} gradient means the line slopes ${downhill ? 'downward' : 'upward'} from left to right.`,
      feedbackIncorrect: `A gradient of ${m2} is ${downhill ? 'negative' : 'positive'}, so the line slopes ${downhill ? 'downward' : 'upward'} from left to right.`,
      hint: 'Ask whether the function increases or decreases as x increases.',
      sceneData: { kind: 'function-plot', funType: 'linear', m: m2, c, traceX: 0 },
    },
    {
      prompt: `For ${linearRule(m2, c)}, what is the y-intercept?`,
      type: 'answer',
      acceptedAnswers: [String(c)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! Setting x = 0 leaves y = ${c}.`,
      feedbackIncorrect: `The y-intercept is found by setting x = 0, which gives y = ${c}.`,
      hint: 'The y-intercept is the y-value where the line crosses the vertical axis.',
      sceneData: { kind: 'function-plot', funType: 'linear', m: m2, c, traceX: 0 },
    },
  ];
};

const coreVertexPredict: CoreGenerator = (rng) => {
  const a = rng.pick([1, -1] as const);
  const b = rng.pick([-6, -4, -2, 2, 4, 6] as const);
  const vertexX = -b / (2 * a);
  const vertexY = rng.int(-4, 5);
  const k = vertexY + (b * b) / (4 * a);
  const rule = quadraticRule(a, b, k);
  const opensUp = a > 0;

  return [
    {
      prompt: `For ${rule}, what is the x-coordinate of the vertex?`,
      type: 'answer',
      acceptedAnswers: [String(vertexX)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! x = -b/(2a) = -(${b})/(2×${a}) = ${vertexX}.`,
      feedbackIncorrect: `Use x = -b/(2a) with a = ${a} and b = ${b}, giving x = ${vertexX}.`,
      hint: `The vertex sits on the axis of symmetry, at x = -b/(2a). Here a = ${a} and b = ${b}.`,
      sceneData: { kind: 'function-plot', funType: 'quadratic', a, b, k, traceX: vertexX },
    },
    {
      prompt: 'What is the y-coordinate of the vertex?',
      type: 'answer',
      acceptedAnswers: [String(vertexY)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! Substituting x = ${vertexX} gives y = ${vertexY}, so the vertex is (${vertexX}, ${vertexY}).`,
      feedbackIncorrect: `Substitute x = ${vertexX} into the rule to get y = ${vertexY}.`,
      hint: 'Put the x-coordinate you just found back into the rule.',
      sceneData: { kind: 'function-plot', funType: 'quadratic', a, b, k, traceX: vertexX },
    },
    {
      prompt: 'Does this parabola open upward or downward?',
      type: 'predict',
      acceptedAnswers: opensUp
        ? ['up', 'upward', 'upwards', 'opens up', 'opens upward']
        : ['down', 'downward', 'downwards', 'opens down', 'opens downward'],
      feedbackCorrect: `Correct! Since a = ${a} ${opensUp ? '> 0' : '< 0'}, the parabola opens ${opensUp ? 'upward' : 'downward'}.`,
      feedbackIncorrect: `The sign of a decides it: a = ${a} ${opensUp ? '> 0' : '< 0'}, so it opens ${opensUp ? 'upward' : 'downward'}.`,
      hint: 'Only the coefficient of x² matters here.',
      sceneData: { kind: 'function-plot', funType: 'quadratic', a, b, k, traceX: vertexX },
    },
  ];
};

const coreInterceptFind: CoreGenerator = (rng) => {
  const roots = sample(rng, [-4, -3, -2, -1, 1, 2, 3, 4] as const, 2)
    .slice()
    .sort((p, q) => p - q) as [number, number];
  const [r1, r2] = roots;
  const b = -(r1 + r2);
  const k = r1 * r2;
  const rule = quadraticRule(1, b, k);

  return [
    {
      prompt: `For ${rule}, what is the y-intercept?`,
      type: 'answer',
      acceptedAnswers: [String(k)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! Setting x = 0 leaves y = ${k}, so the y-intercept is (0, ${k}).`,
      feedbackIncorrect: `Set x = 0: every term with x disappears, leaving y = ${k}.`,
      hint: 'The y-intercept is the y-value where the curve crosses the vertical axis, so set x = 0.',
      sceneData: { kind: 'function-plot', funType: 'quadratic', a: 1, b, k, traceX: 0 },
    },
    {
      prompt: `What are the x-intercepts of ${rule}? Give the smaller root.`,
      type: 'answer',
      acceptedAnswers: [String(r1)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! It factorises as (x ${signed(-r1)})(x ${signed(-r2)}) = 0, so x = ${r1} or x = ${r2}.`,
      feedbackIncorrect: `Factorise: (x ${signed(-r1)})(x ${signed(-r2)}) = 0 gives x = ${r1} and x = ${r2}.`,
      hint: `Factorise the quadratic: find two numbers that multiply to ${k} and add to ${b}.`,
      sceneData: { kind: 'function-plot', funType: 'quadratic', a: 1, b, k, traceX: r1 },
    },
    {
      prompt: 'What is the larger x-intercept?',
      type: 'answer',
      acceptedAnswers: [String(r2)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! The x-intercepts are x = ${r1} and x = ${r2}.`,
      feedbackIncorrect: `From the factorised form, the larger root is x = ${r2}.`,
      hint: 'You already have both factors; take the other one.',
      sceneData: { kind: 'function-plot', funType: 'quadratic', a: 1, b, k, traceX: r2 },
    },
  ];
};

const coreDistanceTime: CoreGenerator = (rng) => {
  const speed = rng.pick([10, 12, 15, 20] as const);
  const hours = rng.pick([2, 3, 4] as const);
  const distance = speed * hours;

  // Second journey: leg 1 over one hour, a 30-minute rest, then leg 2 in 30 minutes.
  const leg1 = rng.pick([30, 40, 50] as const);
  const leg2 = rng.pick([10, 20, 30] as const);
  const average = (leg1 + leg2) / 2; // total distance over a total time of 2 hours

  return [
    {
      prompt: `A cyclist travels ${distance} km in ${hours} hours at a constant speed. What is the average speed in km/h?`,
      type: 'answer',
      acceptedAnswers: [String(speed), `${speed} km/h`],
      tolerance: 0.01,
      feedbackCorrect: `Correct! Average speed = distance ÷ time = ${distance} ÷ ${hours} = ${speed} km/h.`,
      feedbackIncorrect: `Average speed = total distance ÷ total time = ${distance}/${hours} = ${speed} km/h.`,
      hint: 'Speed relates distance and time; decide which one to divide by.',
      sceneData: { kind: 'function-plot', funType: 'linear', m: speed, c: 0, traceX: hours },
    },
    {
      prompt: 'On a distance–time graph, a flat (horizontal) segment means the object is doing what?',
      type: 'predict',
      acceptedAnswers: ['stationary', 'at rest', 'not moving', 'stopped', 'rest'],
      feedbackCorrect: 'Correct! A horizontal segment means zero speed — the object is stationary.',
      feedbackIncorrect: 'A horizontal line means distance is not changing, so the object is stationary (at rest).',
      hint: 'Ask what the gradient of that segment is, and what gradient means here.',
      sceneData: { kind: 'function-plot', funType: 'linear', m: speed, c: 0, traceX: 1 },
    },
    {
      prompt: `A car travels ${leg1} km in the first hour, rests for 30 minutes, then travels ${leg2} km in the next 30 minutes. What is the average speed for the whole journey in km/h?`,
      type: 'answer',
      acceptedAnswers: [String(average), `${average} km/h`],
      tolerance: 0.01,
      feedbackCorrect: `Correct! Total distance = ${leg1 + leg2} km and total time = 2 hours, so the average speed is ${average} km/h.`,
      feedbackIncorrect: `Total distance = ${leg1} + ${leg2} = ${leg1 + leg2} km. Total time = 1 + 0.5 + 0.5 = 2 h. Speed = ${average} km/h.`,
      hint: 'Decide whether the rest period belongs in the total time.',
      sceneData: { kind: 'function-plot', funType: 'linear', m: average, c: 0, traceX: 1 },
    },
  ];
};

// ─── Linear systems (rendered by LinearSystemsLab) ───────────────────────────

interface GeneratedSystem {
  first: { m: number; c: number };
  second: { m: number; c: number };
  x: number;
  y: number;
}

/** A pair of lines meeting at whole-number coordinates inside the view box. */
function makeSystem(rng: VariantRng, excludeX?: number): GeneratedSystem {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const m1 = rng.pick([1, 2, 3] as const);
    const m2 = rng.pick([-1, -2, -3] as const);
    const x = rng.int(-1, 4);
    const y = rng.int(0, 8);
    if (excludeX !== undefined && x === excludeX) continue;
    return { first: { m: m1, c: y - m1 * x }, second: { m: m2, c: y - m2 * x }, x, y };
  }
  const fallbackX = excludeX === 3 ? 2 : 3;
  return {
    first: { m: 2, c: 5 - 2 * fallbackX },
    second: { m: -1, c: 5 + fallbackX },
    x: fallbackX,
    y: 5,
  };
}

const coreSimultaneousLines: CoreGenerator = (rng) => {
  const primary = makeSystem(rng);
  const transfer = makeSystem(rng, primary.x);
  const primaryScene = {
    kind: 'line-system' as const,
    first: primary.first,
    second: primary.second,
  };

  return [
    {
      prompt: `For ${linearRule(primary.first.m, primary.first.c)} and ${linearRule(primary.second.m, primary.second.c)}, what is the x-coordinate of their intersection?`,
      type: 'predict',
      acceptedAnswers: [String(primary.x)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Equating the rules gives x = ${primary.x}, and then y = ${primary.y}.`,
      feedbackIncorrect: `Set the two expressions for y equal to each other and solve: x = ${primary.x}.`,
      hint: 'At the intersection both rules give the same y-value.',
      sceneData: primaryScene,
    },
    {
      prompt: 'What is the y-coordinate of that intersection?',
      type: 'answer',
      acceptedAnswers: [String(primary.y)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Substituting into either rule gives y = ${primary.y}, so the solution is (${primary.x}, ${primary.y}).`,
      feedbackIncorrect: `Substitute x = ${primary.x} into either rule to get y = ${primary.y}.`,
      hint: 'Put the x-value you found back into whichever rule is easier.',
      sceneData: primaryScene,
    },
    {
      prompt: `Transfer: ${linearRule(transfer.first.m, transfer.first.c)} and ${linearRule(transfer.second.m, transfer.second.c)} meet at what x-coordinate?`,
      type: 'answer',
      acceptedAnswers: [String(transfer.x)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! This system gives x = ${transfer.x} and y = ${transfer.y}.`,
      feedbackIncorrect: `Equate the two expressions for y and solve: x = ${transfer.x}.`,
      hint: 'Same method, different numbers — the answer is not the same as the first system.',
      sceneData: { kind: 'line-system' as const, first: transfer.first, second: transfer.second },
    },
  ];
};

const coreInequalityRegion: CoreGenerator = (rng) => {
  const system = makeSystem(rng);
  // Lower boundary is the rising line, upper boundary the falling one.
  const lower = system.first;
  const upper = system.second;
  const satisfies = (px: number, py: number) =>
    py >= lower.m * px + lower.c - 1e-9 && py <= upper.m * px + upper.c + 1e-9;

  const originInside = satisfies(0, 0);
  // A transfer point on the far side of the origin's verdict.
  const candidates: [number, number][] = [
    [system.x, system.y],
    [system.x, system.y + 3],
    [0, Math.round(lower.c) + 2],
    [1, 0],
    [-1, 0],
  ];
  const transferPoint =
    candidates.find(([px, py]) => satisfies(px, py) !== originInside) ?? [system.x, system.y + 4];
  const transferInside = satisfies(transferPoint[0], transferPoint[1]);

  const lowerText = `y ≥ ${linearRule(lower.m, lower.c).slice(4)}`;
  const upperText = `y ≤ ${linearRule(upper.m, upper.c).slice(4)}`;
  const scene = {
    kind: 'line-system' as const,
    first: lower,
    second: upper,
  };

  return [
    {
      prompt: `The boundaries ${linearRule(lower.m, lower.c)} and ${linearRule(upper.m, upper.c)} meet at what x-coordinate?`,
      type: 'predict',
      acceptedAnswers: [String(system.x)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The boundaries meet at (${system.x}, ${system.y}).`,
      feedbackIncorrect: `Equate the two boundaries and solve: x = ${system.x}.`,
      hint: 'The boundary intersection is found exactly like a simultaneous-equations solution.',
      sceneData: { ...scene, testPoint: [0, 0] as [number, number] },
    },
    {
      prompt: `Does (0, 0) satisfy both ${lowerText} and ${upperText}? Answer yes or no.`,
      type: 'answer',
      acceptedAnswers: originInside ? ['yes', 'y'] : ['no', 'n'],
      feedbackCorrect: originInside
        ? `Correct! Both inequalities hold at the origin, so it lies in the overlap.`
        : `Correct! At least one inequality fails at the origin, so it is outside the overlap.`,
      feedbackIncorrect: `Substitute (0, 0) into each inequality in turn and check both.`,
      hint: 'A feasible point must satisfy every inequality, not just one.',
      sceneData: { ...scene, testPoint: [0, 0] as [number, number] },
    },
    {
      prompt: `Transfer: does (${transferPoint[0]}, ${transferPoint[1]}) satisfy both inequalities? Answer yes or no.`,
      type: 'answer',
      acceptedAnswers: transferInside ? ['yes', 'y'] : ['no', 'n'],
      feedbackCorrect: transferInside
        ? 'Correct! Both inequalities hold there, so the point is in the overlap.'
        : 'Correct! One of the inequalities fails there, so the point is outside the overlap.',
      feedbackIncorrect: `Substitute (${transferPoint[0]}, ${transferPoint[1]}) into both inequalities and compare.`,
      hint: 'Test the point in each inequality separately.',
      sceneData: { ...scene, testPoint: transferPoint as [number, number] },
    },
  ];
};

// ─── Geometry (transformations) ───────────────────────────────────────────────

/** Points that stay inside the Geometry view box of x ∈ [-10, 10], y ∈ [-8, 8]. */
function transformSource(rng: VariantRng): [number, number] {
  const x = rng.pick([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5] as const);
  const y = rng.pick([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5] as const);
  return [x, y];
}

const coreReflectPredict: CoreGenerator = (rng) => {
  const axes = [
    { axis: 'x-axis', transform: 'reflect_x' as const, rule: '(x, y) → (x, -y)', negate: 'y' },
    { axis: 'y-axis', transform: 'reflect_y' as const, rule: '(x, y) → (-x, y)', negate: 'x' },
  ];
  // Step 1 always uses one axis, steps 2 and 3 the other, matching the authored flow.
  const order = rng.random() < 0.5 ? [0, 1, 1] : [1, 0, 0];
  return order.map((axisIndex, index) => {
    const a = axes[axisIndex];
    const [x, y] = transformSource(rng);
    const image: [number, number] = a.transform === 'reflect_x' ? [x, -y] : [-x, y];
    return {
      prompt:
        index === 0
          ? `Reflecting (${x}, ${y}) across the ${a.axis} gives which point? (Format: x, y)`
          : `Reflecting (${x}, ${y}) across the ${a.axis} gives which point?`,
      type: 'predict' as const,
      acceptedAnswers: pointAnswers(image[0], image[1]),
      feedbackCorrect: `Correct! Reflecting across the ${a.axis} negates ${a.negate}: ${a.rule}.`,
      feedbackIncorrect: `Reflection across the ${a.axis} follows ${a.rule}. So (${x}, ${y}) → (${image[0]}, ${image[1]}).`,
      hint: `Points on the mirror line do not move; that tells you which coordinate changes sign.`,
      sceneData: {
        kind: 'transform-point' as const,
        source: [x, y] as [number, number],
        transform: a.transform,
      },
    };
  });
};

const coreRotationImage: CoreGenerator = (rng) => {
  const angles = sample(rng, [90, 180, 270] as const, 3);
  return angles.map((angle, index) => {
    const [x, y] = transformSource(rng);
    const image: [number, number] =
      angle === 90 ? [-y, x] : angle === 180 ? [-x, -y] : [y, -x];
    const rule =
      angle === 90 ? '(x, y) → (-y, x)' : angle === 180 ? '(x, y) → (-x, -y)' : '(x, y) → (y, -x)';
    const label = angle === 270 ? '270° anticlockwise (or 90° clockwise)' : `${angle}° anticlockwise`;
    return {
      prompt:
        index === 0
          ? `Rotating (${x}, ${y}) by ${label} about the origin gives? (Format: x, y)`
          : `Rotating (${x}, ${y}) by ${label} about the origin gives?`,
      type: 'predict' as const,
      acceptedAnswers: pointAnswers(image[0], image[1]),
      feedbackCorrect: `Correct! ${label}: ${rule}, so (${x}, ${y}) → (${image[0]}, ${image[1]}).`,
      feedbackIncorrect: `A ${label} rotation follows ${rule}. So (${x}, ${y}) → (${image[0]}, ${image[1]}).`,
      hint: 'Track where the point (1, 0) lands under this rotation to recover the rule.',
      sceneData: {
        kind: 'transform-point' as const,
        source: [x, y] as [number, number],
        transform: 'rotate' as const,
        angleDeg: angle,
      },
    };
  });
};

const coreEnlargePredict: CoreGenerator = (rng) => {
  const cases = [
    { factor: rng.pick([2, 3] as const), centre: [0, 0] as [number, number] },
    { factor: rng.pick([2, 3] as const), centre: [rng.int(1, 2), rng.int(1, 2)] as [number, number] },
    { factor: 0.5, centre: [0, 0] as [number, number] },
  ];
  return cases.map((c, index) => {
    // Keep the image inside the view box, and integral for factor 0.5.
    const step = c.factor === 0.5 ? 2 : 1;
    const dx = step * rng.int(1, c.factor === 3 ? 2 : 3);
    const dy = step * rng.int(0, c.factor === 3 ? 2 : 3);
    const px = c.centre[0] + dx;
    const py = c.centre[1] + dy;
    const ix = c.centre[0] + c.factor * dx;
    const iy = c.centre[1] + c.factor * dy;
    const centreText = c.centre[0] === 0 && c.centre[1] === 0 ? 'the origin (0, 0)' : `centre (${c.centre[0]}, ${c.centre[1]})`;
    return {
      prompt:
        index === 0
          ? `Enlarge the point (${px}, ${py}) by scale factor ${c.factor} from ${centreText}. What is the image? (Format: x, y)`
          : `Enlarge (${px}, ${py}) by scale factor ${c.factor} from ${centreText}. What is the image?`,
      type: 'predict' as const,
      acceptedAnswers: pointAnswers(round(ix, 4), round(iy, 4)),
      feedbackCorrect: `Correct! Image = Centre + k(Point − Centre) = (${c.centre[0]}, ${c.centre[1]}) + ${c.factor}×(${dx}, ${dy}) = (${round(ix, 4)}, ${round(iy, 4)}).`,
      feedbackIncorrect: `Use Image = C + k(P − C): (${c.centre[0]}, ${c.centre[1]}) + ${c.factor}×(${dx}, ${dy}) = (${round(ix, 4)}, ${round(iy, 4)}).`,
      hint: 'Measure the point from the centre first, scale that displacement, then add the centre back.',
      sceneData: {
        kind: 'transform-point' as const,
        source: [px, py] as [number, number],
        transform: 'enlarge' as const,
        scaleFactor: c.factor,
        centre: c.centre,
      },
    };
  });
};

// ─── Geometry (unit circle and similarity) ───────────────────────────────────

const coreUnitCircle: CoreGenerator = (rng) => {
  const quarterTurns = [
    { deg: 90, label: 'π/2', point: '0, 1', cos: 0, sin: 1 },
    { deg: 180, label: 'π', point: '-1, 0', cos: -1, sin: 0 },
    { deg: 270, label: '3π/2', point: '0, -1', cos: 0, sin: -1 },
  ] as const;
  const first = rng.pick(quarterTurns);
  const second = rng.pick(quarterTurns.filter((q) => q.deg !== first.deg));
  const askCos = rng.random() < 0.5;
  const quadrants = [
    { name: 'Quadrant I', sin: 'positive', cos: 'positive', deg: 45 },
    { name: 'Quadrant II', sin: 'positive', cos: 'negative', deg: 135 },
    { name: 'Quadrant III', sin: 'negative', cos: 'negative', deg: 225 },
    { name: 'Quadrant IV', sin: 'negative', cos: 'positive', deg: 315 },
  ] as const;
  const q = rng.pick(quadrants);
  const askSine = rng.random() < 0.5;
  const sign = askSine ? q.sin : q.cos;

  const [ax, ay] = first.point.split(', ').map(Number);
  return [
    {
      prompt: `At θ = ${first.label}, what is the unit-circle point? Enter x, y.`,
      type: 'predict',
      acceptedAnswers: pointAnswers(ax, ay),
      feedbackCorrect: `Correct! (cos ${first.label}, sin ${first.label}) = (${ax}, ${ay}).`,
      feedbackIncorrect: `Cosine is the x-coordinate and sine is the y-coordinate, giving (${ax}, ${ay}).`,
      hint: 'Rotate anticlockwise from (1, 0) and read off where you land.',
      sceneData: { kind: 'unit-circle', angleDeg: first.deg },
    },
    {
      prompt: `What is ${askCos ? 'cos' : 'sin'} ${second.label}?`,
      type: 'answer',
      acceptedAnswers: [String(askCos ? second.cos : second.sin)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! At ${second.label} the point is (${second.cos}, ${second.sin}), so ${askCos ? 'cosine' : 'sine'} is ${askCos ? second.cos : second.sin}.`,
      feedbackIncorrect: `At ${second.label} the unit-circle point is (${second.cos}, ${second.sin}); take the ${askCos ? 'x' : 'y'}-coordinate.`,
      hint: `${askCos ? 'Cosine' : 'Sine'} is the ${askCos ? 'horizontal' : 'vertical'} coordinate of the rotating point.`,
      sceneData: { kind: 'unit-circle', angleDeg: second.deg },
    },
    {
      prompt: `Is ${askSine ? 'sin' : 'cos'} θ positive or negative in ${q.name}?`,
      type: 'predict',
      acceptedAnswers: sign === 'positive' ? ['positive', 'above zero', '+'] : ['negative', 'below zero', '-'],
      feedbackCorrect: `Correct! The ${askSine ? 'y' : 'x'}-coordinate is ${sign} in ${q.name}.`,
      feedbackIncorrect: `${askSine ? 'Sine' : 'Cosine'} is the ${askSine ? 'y' : 'x'}-coordinate, which is ${sign} in ${q.name}.`,
      hint: 'Decide which coordinate the ratio reads, then check its sign in that quadrant.',
      sceneData: { kind: 'unit-circle', angleDeg: q.deg },
    },
  ];
};

const coreSimilarityRatio: CoreGenerator = (rng) => {
  const triples = [
    [3, 4, 5],
    [5, 12, 13],
    [6, 8, 10],
    [8, 15, 17],
  ] as const;
  const t = rng.pick(triples);
  const k = rng.pick([2, 3] as const);
  const congruent = rng.pick(triples.filter((c) => c[2] !== t[2]));

  return [
    {
      prompt: `Triangle ABC has sides ${t[0]}, ${t[1]}, ${t[2]}. Triangle DEF is similar with shortest side ${t[0] * k}. What is the scale factor from ABC to DEF?`,
      type: 'answer',
      acceptedAnswers: [String(k)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Scale factor = ${t[0] * k}/${t[0]} = ${k}.`,
      feedbackIncorrect: `The shortest sides correspond: ${t[0] * k} ÷ ${t[0]} = ${k}.`,
      hint: 'Compare a pair of corresponding sides, smallest with smallest.',
      sceneData: { kind: 'similarity', scaleFactor: k },
    },
    {
      prompt: `Using scale factor ${k}, what is the longest side of triangle DEF?`,
      type: 'answer',
      acceptedAnswers: [String(t[2] * k)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Longest side = ${t[2]} × ${k} = ${t[2] * k}.`,
      feedbackIncorrect: `Multiply the longest side of ABC (${t[2]}) by the scale factor (${k}): ${t[2] * k}.`,
      hint: 'Every side is multiplied by the same factor.',
      sceneData: { kind: 'similarity', scaleFactor: k },
    },
    {
      prompt: `Two triangles are congruent. One has sides ${congruent[0]}, ${congruent[1]}, ${congruent[2]}. What is the hypotenuse of the other?`,
      type: 'answer',
      acceptedAnswers: [String(congruent[2])],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Congruent triangles have identical side lengths, so the hypotenuse is ${congruent[2]}.`,
      feedbackIncorrect: `Congruent means same shape AND size (scale factor 1), so the hypotenuse is ${congruent[2]}.`,
      hint: 'What scale factor corresponds to congruence?',
      sceneData: { kind: 'similarity', scaleFactor: 1 },
    },
  ];
};

// ─── Statistics ──────────────────────────────────────────────────────────────

const coreDistributionShape: CoreGenerator = (rng) => {
  // Five whole numbers with a whole-number mean and one clear largest value.
  let values: number[] = [2, 3, 3, 4, 8];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const draft = [rng.int(1, 5), rng.int(1, 5), rng.int(2, 6), rng.int(3, 7), rng.int(7, 12)].sort(
      (a, b) => a - b,
    );
    const total = draft.reduce((sum, v) => sum + v, 0);
    if (total % 5 === 0 && draft[4] > draft[3]) {
      values = draft;
      break;
    }
  }
  const total = values.reduce((sum, v) => sum + v, 0);
  const mean = total / 5;
  const median = values[2];
  const largest = values[4];
  const inflated = largest + 12;
  const shifted = [...values.slice(0, 4), inflated];

  return [
    {
      prompt: `For the data ${values.join(', ')}, what is the mean?`,
      type: 'answer',
      acceptedAnswers: [String(mean)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The total is ${total} and ${total} ÷ 5 = ${mean}.`,
      feedbackIncorrect: `Add the values to get ${total}, then divide by 5.`,
      hint: 'The mean uses the total of all values.',
      sceneData: { kind: 'dataset', values },
    },
    {
      prompt: 'For the same data, what is the median?',
      type: 'answer',
      acceptedAnswers: [String(median)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The middle ordered value is ${median}.`,
      feedbackIncorrect: `The ordered list has five values, so the median is the third one: ${median}.`,
      hint: 'Order the values first, then find the middle position.',
      sceneData: { kind: 'dataset', values },
    },
    {
      prompt: `If the value ${largest} is replaced by ${inflated}, which changes more: mean or median?`,
      type: 'predict',
      acceptedAnswers: ['mean', 'the mean'],
      feedbackCorrect: `Correct! The outlier pulls the mean upward while the median stays ${median}.`,
      feedbackIncorrect: `The median still sits at ${median}, but the mean rises, so the mean changes more.`,
      hint: 'Ask which measure uses every value in its calculation.',
      sceneData: { kind: 'dataset', values: shifted },
    },
  ];
};

const coreProbabilitySimulation: CoreGenerator = (rng) => {
  const trials = rng.pick([50, 100, 200] as const);
  const rainChance = rng.pick([0.2, 0.3, 0.4, 0.6] as const);
  const tosses = rng.pick([2, 3] as const);
  const allHeads = round(0.5 ** tosses, 4);
  const noRain = round(1 - rainChance, 4);

  return [
    {
      prompt: `For ${trials} fair coin tosses, what is the expected number of heads?`,
      type: 'answer',
      acceptedAnswers: [String(trials / 2)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Expected count = np = ${trials} × 0.5 = ${trials / 2}.`,
      feedbackIncorrect: `Multiply the number of trials by the probability of heads: ${trials} × 0.5 = ${trials / 2}.`,
      hint: 'Expected count combines the number of trials with the probability of one success.',
      sceneData: { kind: 'probability', p: 0.5 },
    },
    {
      prompt: `If P(rain) = ${rainChance}, what is P(no rain)?`,
      type: 'answer',
      acceptedAnswers: [String(noRain), `${round(noRain * 100, 2)}%`],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Complementary probabilities sum to 1, so P(no rain) = ${noRain}.`,
      feedbackIncorrect: `P(no rain) = 1 − ${rainChance} = ${noRain}.`,
      hint: 'The two outcomes together must account for everything.',
      sceneData: { kind: 'probability', p: rainChance },
    },
    {
      prompt: `What is the probability of getting heads on all of ${tosses} independent fair tosses?`,
      type: 'answer',
      acceptedAnswers: [String(allHeads), `1/${2 ** tosses}`],
      tolerance: 0.001,
      feedbackCorrect: `Correct! (1/2)^${tosses} = 1/${2 ** tosses} = ${allHeads}.`,
      feedbackIncorrect: `Multiply the independent probabilities: (1/2)^${tosses} = ${allHeads}.`,
      hint: 'Independent events combine by multiplication.',
      sceneData: { kind: 'probability', p: allHeads },
    },
  ];
};

const coreScatterRegression: CoreGenerator = (rng) => {
  const positive = rng.random() < 0.5;
  const m = positive ? rng.pick([2, 3] as const) : rng.pick([-2, -3] as const);
  const c = rng.int(1, 6);
  const xNew = rng.int(4, 7);
  const prediction = m * xNew + c;
  const points: [number, number][] = [1, 2, 3, 4, 5].map((x, index) => [
    x,
    m * x + c + (index % 2 === 0 ? 0 : positive ? -1 : 1),
  ]);
  const fitted = `y = ${m}x ${c < 0 ? '-' : '+'} ${Math.abs(c)}`;

  return [
    {
      prompt: `If y generally ${positive ? 'increases' : 'decreases'} as x increases, is the association positive or negative?`,
      type: 'predict',
      acceptedAnswers: positive
        ? ['positive', 'positive association', 'positive correlation']
        : ['negative', 'negative association', 'negative correlation'],
      feedbackCorrect: `Correct! The variables move ${positive ? 'upward together' : 'in opposite directions'}.`,
      feedbackIncorrect: `A ${positive ? 'rising' : 'falling'} trend from left to right is a ${positive ? 'positive' : 'negative'} association.`,
      hint: 'Read the overall direction of the cloud of points from left to right.',
      sceneData: { kind: 'scatter', points },
    },
    {
      prompt: `A fitted line is ${fitted}. Predict y when x = ${xNew}.`,
      type: 'answer',
      acceptedAnswers: [String(prediction)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! y = ${m}(${xNew}) ${signed(c)} = ${prediction}.`,
      feedbackIncorrect: `Substitute x = ${xNew} into the fitted line: ${prediction}.`,
      hint: 'Use the fitted rule rather than reading the graph.',
      sceneData: { kind: 'scatter', points },
    },
    {
      prompt: 'Does a strong correlation by itself prove causation? Answer yes or no.',
      type: 'predict',
      acceptedAnswers: ['no', 'n'],
      feedbackCorrect: 'Correct! Association alone does not establish a causal mechanism.',
      feedbackIncorrect: 'Correlation can arise from confounding or coincidence; it does not prove causation.',
      hint: 'Ask whether another variable could explain both.',
      sceneData: { kind: 'scatter', points },
    },
  ];
};

const coreBoxPlot: CoreGenerator = (rng) => {
  // Seven distinct increasing values keep the five-number summary unambiguous.
  const values: number[] = [];
  let current = rng.int(1, 4);
  for (let i = 0; i < 7; i += 1) {
    values.push(current);
    current += rng.int(1, 3);
  }
  const q1 = values[1];
  const median = values[3];
  const q3 = values[5];
  const iqr = q3 - q1;

  return [
    {
      prompt: `For the data ${values.join(', ')}, what is the median?`,
      type: 'answer',
      acceptedAnswers: [String(median)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The middle (4th) value of 7 ordered data points is ${median}.`,
      feedbackIncorrect: `With 7 values the median is the 4th in order: ${median}.`,
      hint: 'Order the values and take the middle position.',
      sceneData: { kind: 'dataset', values },
    },
    {
      prompt: 'For the same data, what is Q1 (the lower quartile)?',
      type: 'answer',
      acceptedAnswers: [String(q1)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Q1 is the median of the lower half {${values.slice(0, 3).join(', ')}}, which is ${q1}.`,
      feedbackIncorrect: `The lower half is {${values.slice(0, 3).join(', ')}}, whose median is ${q1}.`,
      hint: 'Q1 is the median of the values below the overall median.',
      sceneData: { kind: 'dataset', values },
    },
    {
      prompt: 'What is the interquartile range (IQR = Q3 − Q1) for this data?',
      type: 'answer',
      acceptedAnswers: [String(iqr)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Q3 = ${q3} and Q1 = ${q1}, so IQR = ${iqr}.`,
      feedbackIncorrect: `Q3 is the median of {${values.slice(4).join(', ')}} = ${q3}. Then IQR = ${q3} − ${q1} = ${iqr}.`,
      hint: 'Find Q3 first, from the values above the median.',
      sceneData: { kind: 'dataset', values },
    },
  ];
};

/**
 * The tree diagram and two-way table render one fixed scenario, so this
 * generator varies the *questions* asked about it rather than the digits. That
 * keeps the canvas truthful while still producing a different task each time.
 */
const coreTreeTwoWay: CoreGenerator = (rng) => {
  const RED = 3;
  const BLUE = 2;
  const TOTAL = 40;
  const SPORT = 25;
  const MUSIC = 20;
  const BOTH = 15;
  const scene = {
    kind: 'two-way' as const,
    counts: [RED, BLUE] as [number, number],
    total: TOTAL,
    aTotal: SPORT,
    bTotal: MUSIC,
    both: BOTH,
  };

  const treeQuestions = [
    { text: 'P(both red)', event: 'both-red', num: 3, den: 10, working: '3/5 × 2/4 = 6/20' },
    { text: 'P(both blue)', event: 'both-blue', num: 1, den: 10, working: '2/5 × 1/4 = 2/20' },
    { text: 'P(exactly one red)', event: 'exactly-one-red', num: 3, den: 5, working: '3/5 × 2/4 + 2/5 × 3/4 = 12/20' },
  ] as const;
  const tree = rng.pick(treeQuestions);

  const tableQuestions = [
    { text: 'How many do neither?', answer: TOTAL - (SPORT + MUSIC - BOTH), working: `${TOTAL} − (${SPORT} + ${MUSIC} − ${BOTH})` },
    { text: 'How many play sport only?', answer: SPORT - BOTH, working: `${SPORT} − ${BOTH}` },
    { text: 'How many study music only?', answer: MUSIC - BOTH, working: `${MUSIC} − ${BOTH}` },
  ] as const;
  const table = rng.pick(tableQuestions);

  const conditionals = [
    { text: 'P(studies music | plays sport)', num: BOTH, den: SPORT },
    { text: 'P(plays sport | studies music)', num: BOTH, den: MUSIC },
  ] as const;
  const conditional = rng.pick(conditionals);
  const g = conditional.num && conditional.den ? gcdOf(conditional.num, conditional.den) : 1;

  return [
    {
      prompt: `A bag has ${RED} red and ${BLUE} blue marbles. One marble is drawn and not replaced, then another is drawn. What is ${tree.text}? Give as a fraction.`,
      type: 'answer',
      acceptedAnswers: [`${tree.num}/${tree.den}`, String(round(tree.num / tree.den, 4))],
      tolerance: 0.001,
      feedbackCorrect: `Correct! ${tree.working} = ${tree.num}/${tree.den}.`,
      feedbackIncorrect: `Multiply along each matching branch: ${tree.working} = ${tree.num}/${tree.den}.`,
      hint: 'Not replacing the first marble changes the second denominator.',
      // The scene reveals the working for the event this prompt asks about.
      sceneData: { ...scene, treeEvent: tree.event },
    },
    {
      prompt: `In a two-way table, ${TOTAL} students: ${BOTH} play sport AND study music, ${SPORT} play sport in total, ${MUSIC} study music in total. ${table.text}`,
      type: 'answer',
      acceptedAnswers: [String(table.answer)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! ${table.working} = ${table.answer}.`,
      feedbackIncorrect: `Work from the totals: ${table.working} = ${table.answer}.`,
      hint: 'Sketch the four cells and fill in the overlap first.',
      sceneData: scene,
    },
    {
      prompt: `From that table, what is ${conditional.text}? Give as a fraction.`,
      type: 'answer',
      acceptedAnswers: [
        `${conditional.num / g}/${conditional.den / g}`,
        `${conditional.num}/${conditional.den}`,
        String(round(conditional.num / conditional.den, 4)),
      ],
      tolerance: 0.001,
      feedbackCorrect: `Correct! ${conditional.num}/${conditional.den} = ${conditional.num / g}/${conditional.den / g}.`,
      feedbackIncorrect: `Conditional probability divides the joint count by the total for the condition: ${conditional.num}/${conditional.den}.`,
      hint: 'The condition tells you which row or column becomes the denominator.',
      sceneData: scene,
    },
  ];
};

function gcdOf(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a || 1;
}

// ─── Calculus ────────────────────────────────────────────────────────────────

const coreTangentSlope: CoreGenerator = (rng) => {
  // f(x) = x² + bx + c stays inside the authored view box x ∈ [-3, 5], y ∈ [-5, 8].
  const b = rng.pick([-4, -3, -2, -1, 1, 2] as const);
  const c = rng.int(-2, 2);
  const x0 = rng.pick([-1, 0, 1, 2] as const);
  const slopeAtX0 = 2 * x0 + b;
  const stationaryX = round(-b / 2, 4);
  const derivative = `2x ${signed(b)}`;

  return [
    {
      prompt: `For f(x) = ${quadraticRule(1, b, c).slice(4)}, what is f'(x)? Give your answer as a formula in x.`,
      type: 'answer',
      acceptedAnswers: [derivative],
      equivalence: { variables: ['x'] },
      feedbackCorrect: `Correct! f'(x) = ${derivative} by the power rule.`,
      feedbackIncorrect: `Differentiate term by term: d/dx(x²) = 2x and d/dx(${b}x) = ${b}, so f'(x) = ${derivative}.`,
      hint: 'Apply the power rule to each term; the constant term disappears.',
      sceneData: { kind: 'tangent-curve', a: 1, b, c, x0 },
    },
    {
      prompt: `What is f'(${x0})? (The slope of the tangent at x = ${x0})`,
      type: 'answer',
      acceptedAnswers: [String(slopeAtX0)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! f'(${x0}) = 2(${x0}) ${signed(b)} = ${slopeAtX0}.`,
      feedbackIncorrect: `Substitute x = ${x0} into f'(x) = ${derivative}, giving ${slopeAtX0}.`,
      hint: 'Use the derivative you just found.',
      sceneData: { kind: 'tangent-curve', a: 1, b, c, x0 },
    },
    {
      prompt: "At what x-value is the tangent horizontal? (f'(x) = 0)",
      type: 'answer',
      acceptedAnswers: [String(stationaryX), fractionText(-b, 2)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! ${derivative} = 0 gives x = ${stationaryX}, which is the turning point.`,
      feedbackIncorrect: `Set f'(x) = 0: ${derivative} = 0, so x = ${stationaryX}.`,
      hint: 'A horizontal tangent has zero gradient.',
      sceneData: { kind: 'tangent-curve', a: 1, b, c, x0: stationaryX },
    },
  ];
};

function fractionText(n: number, d: number): string {
  const g = gcdOf(n, d);
  const num = n / g;
  const den = d / g;
  return den === 1 ? String(num) : `${num}/${den}`;
}

/** Left Riemann sum of x² on [0, 1] with n strips. */
function leftSum(n: number): number {
  return ((n - 1) * (2 * n - 1)) / (6 * n * n);
}

const coreRiemann: CoreGenerator = (rng) => {
  const n = rng.pick([6, 8, 10, 12, 20] as const);
  const estimate = round(leftSum(n), 3);
  const error = round(1 / 3 - leftSum(n), 3);
  const nSmall = rng.pick([4, 5] as const);

  return [
    {
      prompt: `For f(x) = x² on [0, 1], the exact area is 1/3. With n = ${nSmall} left rectangles, is the estimate less than, equal to, or greater than 1/3?`,
      type: 'predict',
      acceptedAnswers: ['less', 'less than', 'under', 'underestimate'],
      feedbackCorrect: 'Correct! For an increasing function, left Riemann sums underestimate the true area.',
      feedbackIncorrect: 'Since x² is increasing on [0, 1], each left endpoint is the lower value, so the sum underestimates.',
      hint: 'Ask whether each rectangle sits below or above the curve.',
      sceneData: { kind: 'riemann', n: nSmall },
    },
    {
      prompt: `The left Riemann sum with n = ${n} for x² on [0, 1] gives approximately ${estimate}. How far is this from the true value 1/3 ≈ 0.333? (Round to 3 decimal places)`,
      type: 'answer',
      acceptedAnswers: [String(error)],
      tolerance: 0.0015,
      feedbackCorrect: `Correct! Error ≈ |0.333 − ${estimate}| ≈ ${error}. More rectangles reduce the error.`,
      feedbackIncorrect: `Error = |1/3 − ${estimate}| ≈ ${error}.`,
      hint: 'Subtract the estimate from the exact value.',
      sceneData: { kind: 'riemann', n },
    },
    {
      prompt: 'As n → ∞, what value does the left Riemann sum of x² on [0, 1] approach? (Express as a fraction)',
      type: 'answer',
      acceptedAnswers: ['1/3', '1 / 3'],
      feedbackCorrect: 'Correct! The Riemann sum converges to the definite integral ∫₀¹ x² dx = 1/3.',
      feedbackIncorrect: 'The limit of the Riemann sum is the definite integral: ∫₀¹ x² dx = 1/3.',
      hint: 'The limit of a Riemann sum has another name.',
      sceneData: { kind: 'riemann', n: 50 },
    },
  ];
};

const coreDirectionField: CoreGenerator = (rng) => {
  const slopeLine = rng.int(0, 3);
  const slopePoint = rng.int(1, 4);
  const capacity = rng.pick([4, 6, 8] as const);

  return [
    {
      prompt: `For dy/dx = y, what is the slope everywhere on the line y = ${slopeLine}?`,
      type: 'answer',
      acceptedAnswers: slopeLine === 0 ? ['0', 'zero'] : [String(slopeLine)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! Substituting y = ${slopeLine} gives slope ${slopeLine}${slopeLine === 0 ? ', so the field is flat along the x-axis' : ''}.`,
      feedbackIncorrect: `The slope equals y, so along y = ${slopeLine} every segment has slope ${slopeLine}.`,
      hint: 'Read the rule literally: the slope is whatever y is.',
      sceneData: { kind: 'direction-field', carryingCapacity: capacity },
    },
    {
      prompt: `For dy/dx = y, what is the slope at (0, ${slopePoint})?`,
      type: 'answer',
      acceptedAnswers: [String(slopePoint)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The rule depends only on y, giving slope ${slopePoint}.`,
      feedbackIncorrect: `Substitute y = ${slopePoint} into dy/dx = y.`,
      hint: 'The x-coordinate does not appear in the rule.',
      sceneData: { kind: 'direction-field', carryingCapacity: capacity },
    },
    {
      prompt: `For dP/dt = P(1 − P/${capacity}), which positive value of P is an equilibrium?`,
      type: 'answer',
      acceptedAnswers: [String(capacity)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! At P = ${capacity} the factor (1 − P/${capacity}) is zero.`,
      feedbackIncorrect: `Set P(1 − P/${capacity}) = 0; the positive equilibrium is ${capacity}.`,
      hint: 'Equilibrium means the whole right-hand side is zero.',
      sceneData: { kind: 'direction-field', carryingCapacity: capacity },
    },
  ];
};

/** Position/velocity/acceleration rules matching KINEMATICS_EXAMPLES. */
const KINEMATICS_RULES = [
  {
    index: 0,
    position: 's(t) = t²',
    velocityFormula: '2t',
    velocity: (t: number) => 2 * t,
    acceleration: 2,
    velocityAnswers: ['2t', '2*t', 'v=2t', 'v(t)=2t'],
  },
  {
    index: 1,
    position: 's(t) = 3t + 1',
    velocityFormula: '3',
    velocity: () => 3,
    acceleration: 0,
    velocityAnswers: ['3', 'v=3', 'v(t)=3'],
  },
] as const;

const coreKinematics: CoreGenerator = (rng) => {
  const rule = rng.pick(KINEMATICS_RULES);
  const t = rng.int(1, 4);
  const velocityAtT = rule.velocity(t);
  const scene = { kind: 'kinematics' as const, exampleIndex: rule.index, t };

  return [
    {
      prompt: `If position is ${rule.position}, what is velocity v(t)? Give your answer as a formula in t.`,
      type: 'answer',
      acceptedAnswers: [...rule.velocityAnswers],
      equivalence: { variables: ['t'], sampleDomain: [0.5, 4] },
      feedbackCorrect: `Correct! Velocity is ds/dt = ${rule.velocityFormula}.`,
      feedbackIncorrect: `Differentiate the position rule with respect to t: v(t) = ${rule.velocityFormula}.`,
      hint: 'Velocity is the derivative of position.',
      sceneData: scene,
    },
    {
      prompt: `For ${rule.position}, what is the velocity at t = ${t}?`,
      type: 'answer',
      acceptedAnswers: [String(velocityAtT)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! v(${t}) = ${velocityAtT}.`,
      feedbackIncorrect: `Use v(t) = ${rule.velocityFormula} and substitute t = ${t}, giving ${velocityAtT}.`,
      hint: 'Substitute the time into the velocity rule you just found.',
      sceneData: scene,
    },
    {
      prompt: `For ${rule.position}, what is the constant acceleration?`,
      type: 'answer',
      acceptedAnswers: [String(rule.acceleration)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! a(t) = dv/dt = ${rule.acceleration}.`,
      feedbackIncorrect: `Differentiate v(t) = ${rule.velocityFormula} once more to get ${rule.acceleration}.`,
      hint: 'Acceleration is the derivative of velocity.',
      sceneData: scene,
    },
  ];
};

// ─── Polar and parametric curves ─────────────────────────────────────────────

const corePolarCurves: CoreGenerator = (rng) => {
  const a = rng.int(2, 5);
  const turns = rng.int(1, 3);

  return [
    {
      prompt: `For the cardioid r = ${a}(1 + cos θ), what is r when θ = 0?`,
      type: 'answer',
      acceptedAnswers: [String(2 * a)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! cos 0 = 1, so r = ${a}(1 + 1) = ${2 * a}: the widest point of the cardioid.`,
      feedbackIncorrect: `Substitute θ = 0: r = ${a}(1 + cos 0) = ${a}(2) = ${2 * a}.`,
      hint: 'Substitute the angle and evaluate the cosine first.',
      sceneData: { kind: 'curve-preset', family: 'polar', preset: 'cardioid', a },
    },
    {
      prompt: `For the Archimedean spiral r = ${a}θ/(2π), what is r after ${turns} complete turn${turns === 1 ? '' : 's'}?`,
      type: 'answer',
      acceptedAnswers: [String(a * turns)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! θ = ${turns}(2π) gives r = ${a} × ${turns} = ${a * turns}, so the radius grows steadily.`,
      feedbackIncorrect: `Substitute θ = ${turns} × 2π into r = ${a}θ/(2π) to get ${a * turns}.`,
      hint: 'Convert "complete turns" into radians before substituting.',
      sceneData: { kind: 'curve-preset', family: 'polar', preset: 'spiral', a },
    },
    {
      prompt: `The lemniscate r² = ${a * a} cos(2θ) has two loops. Which axis joins the centres of the loops?`,
      type: 'predict',
      acceptedAnswers: ['x-axis', 'x axis', 'horizontal axis'],
      feedbackCorrect: 'Correct! The cos(2θ) symmetry places the two loops on the horizontal x-axis.',
      feedbackIncorrect: 'The loops lie to the left and right of the pole, so their centres lie on the x-axis.',
      hint: 'Ask at which angles cos(2θ) is largest.',
      sceneData: { kind: 'curve-preset', family: 'polar', preset: 'lemniscate', a },
    },
  ];
};

const coreParametricCurves: CoreGenerator = (rng) => {
  const a = rng.int(2, 5);
  const b = rng.int(1, 3);
  const ellipse = a !== b && rng.random() < 0.5;
  const dydx = fractionText(b, a);

  return [
    ellipse
      ? {
          prompt: `What shape is traced by x = ${a} cos t, y = ${b} sin t for 0 ≤ t ≤ 2π?`,
          type: 'predict' as const,
          acceptedAnswers: ['ellipse', 'an ellipse'],
          feedbackCorrect: `Correct! (x/${a})² + (y/${b})² = 1, an ellipse with semi-axes ${a} and ${b}.`,
          feedbackIncorrect: `Divide before squaring: (x/${a})² + (y/${b})² = cos²t + sin²t = 1, so it is an ellipse.`,
          hint: 'Try eliminating the parameter with a trigonometric identity.',
          sceneData: { kind: 'curve-preset' as const, family: 'parametric' as const, preset: 'ellipse', a, b },
        }
      : {
          prompt: 'What shape is traced by x = cos t, y = sin t for 0 ≤ t ≤ 2π?',
          type: 'predict' as const,
          acceptedAnswers: ['circle', 'unit circle', 'a circle'],
          feedbackCorrect: 'Correct! x² + y² = cos²t + sin²t = 1.',
          feedbackIncorrect: 'Eliminate t using cos²t + sin²t = 1.',
          hint: 'Try eliminating the parameter with a trigonometric identity.',
          sceneData: { kind: 'curve-preset' as const, family: 'parametric' as const, preset: 'circle', a: 1, b: 1 },
        },
    {
      prompt: `For x = ${a}t and y = ${b === 1 ? 't' : `${b}t`}, what is dy/dx?`,
      type: 'answer',
      acceptedAnswers: [dydx, String(round(b / a, 4))],
      tolerance: 0.001,
      feedbackCorrect: `Correct! (dy/dt)/(dx/dt) = ${b}/${a} = ${dydx}.`,
      feedbackIncorrect: `dy/dt = ${b} and dx/dt = ${a}, so dy/dx = ${dydx}.`,
      hint: 'Differentiate each component with respect to t, then divide.',
      sceneData: { kind: 'curve-preset', family: 'parametric', preset: 'line', a, b },
    },
    {
      prompt: 'For x = cos t, y = sin t, what point occurs at t = π/2?',
      type: 'answer',
      acceptedAnswers: pointAnswers(0, 1),
      feedbackCorrect: 'Correct! cos(π/2) = 0 and sin(π/2) = 1.',
      feedbackIncorrect: 'Substitute t = π/2 into both component rules.',
      hint: 'Evaluate each component rule separately.',
      sceneData: { kind: 'curve-preset', family: 'parametric', preset: 'circle', a: 1, b: 1 },
    },
  ];
};

// ─── Visual-topic activities (number line, transformations, angles, curves) ──

/** Render a half-integer as a fraction when it is not whole. */
function halfFraction(v: number): string[] {
  if (Number.isInteger(v)) return [String(v)];
  return [String(v), `${v * 2}/2`];
}

const coreNumberLine: CoreGenerator = (rng) => {
  // Step 1: order a whole number against a half-integer.
  const whole = rng.int(-4, 4);
  const half = whole + rng.pick([-0.5, 0.5] as const);
  const smaller = Math.min(whole, half);

  // Step 2: midpoint of two values with a tidy average.
  const left = rng.int(-5, 0);
  const right = rng.int(1, 5);
  const midpoint = round((left + right) / 2, 4);

  // Step 3: a linear inequality whose boundary is an integer (it can be negative).
  const m = rng.pick([2, 3, 4] as const);
  const boundary = rng.int(-2, 4);
  const c = rng.int(-5, 5);
  const d = m * boundary + c;
  const strictlyLess = rng.random() < 0.5;
  const answer = strictlyLess ? boundary - 1 : boundary + 1;
  const relation = strictlyLess ? '<' : '>';
  const extreme = strictlyLess ? 'largest' : 'smallest';

  return [
    {
      prompt: `Which of ${half} and ${whole} is further left on the number line? Give that number.`,
      type: 'predict',
      acceptedAnswers: halfFraction(smaller),
      tolerance: 0.001,
      feedbackCorrect: `Correct! Further left means smaller, and ${smaller} is the smaller value.`,
      feedbackIncorrect: `On a number line, further left means smaller. Since ${smaller} < ${Math.max(whole, half)}, the answer is ${smaller}.`,
      hint: 'With negative numbers, larger digits mean a smaller value.',
      sceneData: { kind: 'number-line', min: -6, max: 6, points: [half, whole] },
    },
    {
      prompt: `What number lies exactly halfway between ${left} and ${right}?`,
      type: 'answer',
      acceptedAnswers: halfFraction(midpoint),
      tolerance: 0.001,
      feedbackCorrect: `Correct! The midpoint is (${left} + ${right})/2 = ${midpoint}.`,
      feedbackIncorrect: `Average the endpoints: (${left} + ${right})/2 = ${midpoint}.`,
      hint: 'Halfway between two numbers is their average.',
      sceneData: { kind: 'number-line', min: -6, max: 6, points: [left, right] },
    },
    {
      prompt: `Solve ${m}x ${signed(c)} ${relation} ${d}. What is the ${extreme} integer that satisfies it?`,
      type: 'answer',
      acceptedAnswers: [String(answer)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! The inequality rearranges to x ${relation} ${boundary}, and because it is strict the ${extreme} integer is ${answer}.`,
      feedbackIncorrect: `Rearranging gives x ${relation} ${boundary}. The boundary itself is excluded, so the answer is ${answer}.`,
      hint: 'Solve for x first, then decide whether the boundary value itself qualifies.',
      sceneData: {
        kind: 'number-line',
        min: -6,
        max: 6,
        points: [],
        interval: strictlyLess
          ? { from: -6, to: boundary, closedFrom: false, closedTo: false }
          : { from: boundary, to: 6, closedFrom: false, closedTo: false },
      },
    },
  ];
};

const coreFunctionTransformations: CoreGenerator = (rng) => {
  const a = rng.pick([1, -1, 2, -2] as const);
  const h = rng.int(-3, 3);
  const k = rng.int(-4, 4);
  const rule = `y = ${a === 1 ? '' : a === -1 ? '-' : a}(x ${h < 0 ? '+' : '-'} ${Math.abs(h)})² ${k < 0 ? '-' : '+'} ${Math.abs(k)}`;
  // Expanded form is what the canvas plots: a x² - 2ah x + (a h² + k).
  const scene = {
    kind: 'function-plot' as const,
    funType: 'quadratic' as const,
    a,
    b: -2 * a * h,
    k: a * h * h + k,
  };
  const nextY = a + k;
  const yIntercept = a * h * h + k;

  return [
    {
      prompt: `For ${rule}, what are the vertex coordinates? Enter x, y.`,
      type: 'predict',
      acceptedAnswers: pointAnswers(h, k),
      feedbackCorrect: `Correct! In y = a(x − h)² + k the vertex is (h, k) = (${h}, ${k}).`,
      feedbackIncorrect: `Completed-square form gives the vertex directly: (${h}, ${k}). Watch the sign of h.`,
      hint: 'The bracket is zero at the vertex. Which x makes it zero?',
      sceneData: { ...scene, traceX: h },
    },
    {
      prompt: `For the same parabola, what is the y-value when x = ${h + 1}?`,
      type: 'answer',
      acceptedAnswers: [String(nextY)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! The bracket becomes 1, so y = ${a}(1) ${signed(k)} = ${nextY}.`,
      feedbackIncorrect: `Substitute x = ${h + 1}: the bracket is 1, so y = ${a} ${signed(k)} = ${nextY}.`,
      hint: 'Work inside the bracket first, then square, then apply a and k.',
      sceneData: { ...scene, traceX: h + 1 },
    },
    {
      prompt: `What is the y-intercept of ${rule}?`,
      type: 'answer',
      acceptedAnswers: [String(yIntercept)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! Setting x = 0 gives y = ${a}(${-h})² ${signed(k)} = ${yIntercept}.`,
      feedbackIncorrect: `The y-intercept needs x = 0: y = ${a}(${-h})² ${signed(k)} = ${yIntercept}.`,
      hint: 'The y-intercept is not k — substitute x = 0 into the whole rule.',
      sceneData: { ...scene, traceX: 0 },
    },
  ];
};

const coreExponentialLog: CoreGenerator = (rng) => {
  const a = rng.pick([1, 2, 3] as const);
  const base = rng.pick([2, 3] as const);
  const power = rng.int(2, 3);
  const value = a * base ** power;
  const logPower = rng.int(2, base === 2 ? 4 : 3);
  const logArgument = base ** logPower;
  const rule = `y = ${a === 1 ? '' : a}(${base}ˣ)`;

  return [
    {
      prompt: `For ${rule}, what is y when x = 0?`,
      type: 'answer',
      acceptedAnswers: [String(a)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! ${base}⁰ = 1, so y = ${a}.`,
      feedbackIncorrect: `Any non-zero base to the power 0 is 1, so y = ${a}.`,
      hint: 'What is any non-zero number raised to the power zero?',
      sceneData: { kind: 'exponential-plot', family: 'exponential', a, base, c: 0 },
    },
    {
      prompt: `For ${rule}, what is y when x = ${power}?`,
      type: 'answer',
      acceptedAnswers: [String(value)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! ${base}^${power} = ${base ** power}, so y = ${a} × ${base ** power} = ${value}.`,
      feedbackIncorrect: `Evaluate the power first: ${base}^${power} = ${base ** power}, then multiply by ${a} to get ${value}.`,
      hint: 'Apply the index before the coefficient.',
      sceneData: { kind: 'exponential-plot', family: 'exponential', a, base, c: 0 },
    },
    {
      prompt: `For y = log${base === 2 ? '₂' : '₃'}(x), what is y when x = ${logArgument}?`,
      type: 'answer',
      acceptedAnswers: [String(logPower)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! ${base}^${logPower} = ${logArgument}, so the logarithm is ${logPower}.`,
      feedbackIncorrect: `A logarithm asks for the exponent: ${base}^${logPower} = ${logArgument}, so y = ${logPower}.`,
      hint: `Rewrite it as ${base}^y = ${logArgument}.`,
      sceneData: { kind: 'exponential-plot', family: 'logarithmic', a: 1, base, c: 0 },
    },
  ];
};

const coreAngleReasoning: CoreGenerator = (rng) => {
  const given = rng.int(35, 75);
  const relations = [
    { name: 'corresponding' as const, answer: given, why: 'Corresponding angles on parallel lines are equal' },
    { name: 'alternate' as const, answer: given, why: 'Alternate angles on parallel lines are equal' },
    { name: 'co-interior' as const, answer: 180 - given, why: 'Co-interior angles on parallel lines are supplementary' },
  ];
  const relation = rng.pick(relations);

  const angleA = rng.int(30, 70);
  const angleB = rng.int(30, 70);
  const third = 180 - angleA - angleB;

  const sides = rng.int(5, 10);
  const interiorSum = 180 * (sides - 2);

  return [
    {
      prompt: `Two parallel lines are cut by a transversal. One angle is ${given}°. What is its ${relation.name} partner, in degrees?`,
      type: 'answer',
      acceptedAnswers: [String(relation.answer), `${relation.answer}°`],
      tolerance: 0.01,
      feedbackCorrect: `Correct! ${relation.why}, giving ${relation.answer}°.`,
      feedbackIncorrect: `${relation.why}, so the partner is ${relation.answer}°.`,
      hint: 'Decide first whether this relationship makes the angles equal or supplementary.',
      sceneData: { kind: 'angle-figure', figure: 'parallel-lines', angles: [given], relation: relation.name },
    },
    {
      prompt: `A triangle has angles of ${angleA}° and ${angleB}°. What is the third angle, in degrees?`,
      type: 'answer',
      acceptedAnswers: [String(third), `${third}°`],
      tolerance: 0.01,
      feedbackCorrect: `Correct! 180 − ${angleA} − ${angleB} = ${third}°.`,
      feedbackIncorrect: `The three angles total 180°, so the third is 180 − ${angleA} − ${angleB} = ${third}°.`,
      hint: 'Use the total for the interior angles of a triangle.',
      sceneData: { kind: 'angle-figure', figure: 'triangle', angles: [angleA, angleB] },
    },
    {
      prompt: `What is the sum of the interior angles of a ${sides}-sided polygon, in degrees?`,
      type: 'answer',
      acceptedAnswers: [String(interiorSum), `${interiorSum}°`],
      tolerance: 0.01,
      feedbackCorrect: `Correct! 180(n − 2) = 180(${sides - 2}) = ${interiorSum}°.`,
      feedbackIncorrect: `Split the polygon into ${sides - 2} triangles: 180(${sides} − 2) = ${interiorSum}°.`,
      hint: 'How many triangles can a polygon with n sides be split into?',
      sceneData: { kind: 'angle-figure', figure: 'polygon', angles: [], sides },
    },
  ];
};

const coreCurveSketching: CoreGenerator = (rng) => {
  // f'(x) = 3(x − r1)(x − r2) keeps every coefficient a whole number when
  // r1 + r2 is even, and puts the inflection at their midpoint.
  const pairs = [
    [1, 3],
    [0, 4],
    [2, 4],
    [1, 5],
    [0, 2],
  ] as const;
  const [r1, r2] = rng.pick(pairs);
  const b = (-3 * (r1 + r2)) / 2;
  const c = 3 * r1 * r2;
  const inflection = (r1 + r2) / 2;
  const rule = `f(x) = x³ ${b === 0 ? '' : `${b < 0 ? '-' : '+'} ${Math.abs(b)}x² `}${c === 0 ? '' : `${c < 0 ? '-' : '+'} ${Math.abs(c)}x`}`.trim();
  const derivative = `3x^2 ${2 * b < 0 ? '-' : '+'} ${Math.abs(2 * b)}x ${c < 0 ? '-' : '+'} ${Math.abs(c)}`;
  const testX = rng.random() < 0.5 ? inflection - 1 : inflection + 1;
  const secondDerivative = 6 * testX + 2 * b;
  const concaveUp = secondDerivative > 0;

  return [
    {
      prompt: `For ${rule}, what is f'(x)? Give your answer as a formula in x.`,
      type: 'answer',
      acceptedAnswers: [derivative],
      equivalence: { variables: ['x'] },
      feedbackCorrect: `Correct! f'(x) = ${derivative} = 3(x − ${r1})(x − ${r2}).`,
      feedbackIncorrect: `Differentiate term by term: f'(x) = ${derivative}.`,
      hint: 'Apply the power rule to each term.',
      sceneData: { kind: 'curve-analysis', a: 1, b, c, d: 0, x0: r1 },
    },
    {
      prompt: 'At what x-value does the curve have its point of inflection?',
      type: 'answer',
      acceptedAnswers: [String(inflection)],
      tolerance: 0.01,
      feedbackCorrect: `Correct! f''(x) = 6x ${2 * b < 0 ? '-' : '+'} ${Math.abs(2 * b)} is zero at x = ${inflection}, and it changes sign there.`,
      feedbackIncorrect: `Solve f''(x) = 0: 6x ${2 * b < 0 ? '-' : '+'} ${Math.abs(2 * b)} = 0 gives x = ${inflection}.`,
      hint: 'Inflection is about the second derivative, not the first.',
      sceneData: { kind: 'curve-analysis', a: 1, b, c, d: 0, x0: inflection },
    },
    {
      prompt: `Is the curve concave up or concave down at x = ${testX}?`,
      type: 'predict',
      acceptedAnswers: concaveUp
        ? ['up', 'concave up', 'upward']
        : ['down', 'concave down', 'downward'],
      feedbackCorrect: `Correct! f''(${testX}) = ${secondDerivative} ${concaveUp ? '> 0' : '< 0'}, so the curve is concave ${concaveUp ? 'up' : 'down'} there.`,
      feedbackIncorrect: `Evaluate the second derivative: f''(${testX}) = ${secondDerivative}, which is ${concaveUp ? 'positive' : 'negative'}, so concave ${concaveUp ? 'up' : 'down'}.`,
      hint: 'Substitute the x-value into the second derivative and read its sign.',
      sceneData: { kind: 'curve-analysis', a: 1, b, c, d: 0, x0: testX },
    },
  ];
};

const coreAreaBetween: CoreGenerator = (rng) => {
  const useHorizontal = rng.random() < 0.4;
  if (useHorizontal) {
    // y = x² against y = k, with k a perfect square so the crossings are whole.
    const root = rng.int(1, 3);
    const k = root * root;
    const area = round((4 / 3) * k * root, 4);
    const areaText = k === 1 ? '4/3' : k === 4 ? '32/3' : '36';
    return [
      {
        prompt: `Where do y = x² and y = ${k} meet? Give the larger x-value.`,
        type: 'answer',
        acceptedAnswers: [String(root)],
        tolerance: 0.001,
        feedbackCorrect: `Correct! x² = ${k} gives x = ±${root}.`,
        feedbackIncorrect: `Solve x² = ${k}: the two crossings are x = −${root} and x = ${root}.`,
        hint: 'A squared term gives two solutions, not one.',
        sceneData: { kind: 'area-between', lineSlope: 0, lineIntercept: k, from: -root, to: root },
      },
      {
        prompt: 'Between those two points, which graph is on top: the horizontal line or the parabola?',
        type: 'predict',
        acceptedAnswers: ['line', 'the line', 'horizontal line'],
        feedbackCorrect: `Correct! At x = 0 the line gives ${k} and the parabola gives 0, so the line is above.`,
        feedbackIncorrect: `Test x = 0: the line gives ${k} and the parabola gives 0, so the line is on top.`,
        hint: 'Test one x-value strictly between the two crossings.',
        sceneData: { kind: 'area-between', lineSlope: 0, lineIntercept: k, from: -root, to: root },
      },
      {
        prompt: `What is the exact area enclosed between y = x² and y = ${k}?`,
        type: 'answer',
        acceptedAnswers: [areaText, String(area)],
        tolerance: 0.001,
        equivalence: {},
        feedbackCorrect: `Correct! ∫₋${root}^${root}(${k} − x²) dx = ${areaText}.`,
        feedbackIncorrect: `Integrate top minus bottom across the whole interval: ∫₋${root}^${root}(${k} − x²) dx = ${areaText}.`,
        hint: 'Integrate the upper function minus the lower one, between the crossings.',
        sceneData: { kind: 'area-between', lineSlope: 0, lineIntercept: k, from: -root, to: root },
      },
    ];
  }

  // y = x² against y = mx, crossing at 0 and m, with area m³/6.
  const m = rng.int(1, 3);
  const areaText = fractionText(m ** 3, 6);
  return [
    {
      prompt: `Where do y = x² and y = ${m === 1 ? 'x' : `${m}x`} meet? Give the larger x-value.`,
      type: 'answer',
      acceptedAnswers: [String(m)],
      tolerance: 0.001,
      feedbackCorrect: `Correct! x² = ${m}x gives x(x − ${m}) = 0, so x = 0 or x = ${m}.`,
      feedbackIncorrect: `Set the rules equal: x² = ${m}x, so x(x − ${m}) = 0 and the larger solution is x = ${m}.`,
      hint: 'Do not divide by x — you would lose a solution.',
      sceneData: { kind: 'area-between', lineSlope: m, lineIntercept: 0, from: 0, to: m },
    },
    {
      prompt: 'Between those two points, which graph is on top: the line or the parabola?',
      type: 'predict',
      acceptedAnswers: ['line', 'the line'],
      feedbackCorrect: `Correct! Midway along, the line is the larger of the two.`,
      feedbackIncorrect: `Test an x strictly between 0 and ${m}: the line value exceeds the parabola value, so the line is on top.`,
      hint: 'Test one x-value strictly between the two crossings.',
      sceneData: { kind: 'area-between', lineSlope: m, lineIntercept: 0, from: 0, to: m },
    },
    {
      prompt: `What is the exact area enclosed between y = x² and y = ${m === 1 ? 'x' : `${m}x`}? Give it as a fraction.`,
      type: 'answer',
      acceptedAnswers: [areaText, String(round(m ** 3 / 6, 4))],
      tolerance: 0.001,
      equivalence: {},
      feedbackCorrect: `Correct! ∫₀^${m}(${m}x − x²) dx = ${areaText}.`,
      feedbackIncorrect: `Integrate top minus bottom: ∫₀^${m}(${m}x − x²) dx = ${areaText}.`,
      hint: 'Integrate the upper function minus the lower one, between the crossings.',
      sceneData: { kind: 'area-between', lineSlope: m, lineIntercept: 0, from: 0, to: m },
    },
  ];
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const CORE_GENERATORS: Record<string, CoreGenerator> = {
  'explorer-quadrant-predict': coreQuadrantPredict,
  'explorer-number-line': coreNumberLine,
  'sandbox-gradient-effect': coreGradientEffect,
  'sandbox-vertex-predict': coreVertexPredict,
  'sandbox-function-transformations': coreFunctionTransformations,
  'sandbox-exponential-log': coreExponentialLog,
  'sandbox-intercept-find': coreInterceptFind,
  'sandbox-distance-time': coreDistanceTime,
  'sandbox-simultaneous-lines': coreSimultaneousLines,
  'sandbox-inequality-region': coreInequalityRegion,
  'geometry-angle-reasoning': coreAngleReasoning,
  'geometry-reflect-predict': coreReflectPredict,
  'geometry-rotation-image': coreRotationImage,
  'geometry-enlarge-predict': coreEnlargePredict,
  'geometry-unit-circle': coreUnitCircle,
  'geometry-similarity-ratio': coreSimilarityRatio,
  'statistics-distribution-shape': coreDistributionShape,
  'statistics-probability-simulation': coreProbabilitySimulation,
  'statistics-scatter-regression': coreScatterRegression,
  'statistics-box-plot': coreBoxPlot,
  'statistics-tree-two-way': coreTreeTwoWay,
  'calculus-tangent-slope-predict': coreTangentSlope,
  'calculus-riemann-convergence': coreRiemann,
  'calculus-curve-sketching': coreCurveSketching,
  'calculus-area-between': coreAreaBetween,
  'calculus-direction-field': coreDirectionField,
  'calculus-kinematics-links': coreKinematics,
  'sandbox-polar-curves': corePolarCurves,
  'sandbox-parametric-curves': coreParametricCurves,
};

export { round as roundCoreValue };
