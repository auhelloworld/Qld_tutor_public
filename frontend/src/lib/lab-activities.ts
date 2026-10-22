/**
 * Typed catalog of Maths Lab learning activities.
 * Each activity defines deterministic steps that can be validated without LLM.
 */

import type { AnswerEquivalence } from './lab-answer-equivalence';

/** Marking tier of a Learn step. Steps default to `core` when omitted. */
export type LearnStepTier = 'core' | 'extension';

export type LabTab =
  | 'explorer'
  | 'sandbox'
  | 'calculus'
  | 'geometry'
  | 'statistics'
  | 'linear-algebra';

export type LabStrand =
  | 'number-algebra'
  | 'functions-graphs'
  | 'measurement-geometry'
  | 'trigonometry'
  | 'statistics-probability'
  | 'calculus'
  | 'vectors-matrices-complex';

export type LabBand = '7-8' | '9-10' | 'senior';

/**
 * Single source of truth for tab display labels.
 * Used by both `LabDirectory` and `page.tsx` tablist.
 */
export const LAB_TAB_LABELS: Record<LabTab, string> = {
  explorer: 'Coordinate Explorer',
  sandbox: 'Graphing & Curves',
  calculus: 'Calculus Explorer',
  geometry: 'Geometry & Trigonometry',
  statistics: 'Statistics & Probability',
  'linear-algebra': 'Vectors, Matrices & Complex',
};

export type LabActivityId =
  // Explorer
  | 'explorer-number-line'
  | 'explorer-quadrant-predict'
  | 'explorer-distance-from-origin'
  | 'explorer-two-point-measures'
  // Sandbox
  | 'sandbox-gradient-effect'
  | 'sandbox-vertex-predict'
  | 'sandbox-intercept-find'
  | 'sandbox-simultaneous-lines'
  | 'sandbox-inequality-region'
  | 'sandbox-distance-time'
  | 'sandbox-function-transformations'
  | 'sandbox-exponential-log'
  | 'sandbox-polar-curves'
  | 'sandbox-parametric-curves'
  | 'sandbox-piecewise-absolute'
  // Calculus
  | 'calculus-tangent-slope-predict'
  | 'calculus-riemann-convergence'
  | 'calculus-direction-field'
  | 'calculus-kinematics-links'
  | 'calculus-numerical-methods'
  | 'calculus-curve-sketching'
  | 'calculus-area-between'
  | 'calculus-accumulation-link'
  | 'calculus-function-derivative-link'
  // Geometry and trigonometry
  | 'geometry-angle-reasoning'
  | 'geometry-reflect-predict'
  | 'geometry-rotation-image'
  | 'geometry-enlarge-predict'
  | 'geometry-similarity-ratio'
  | 'geometry-circle-scaling'
  | 'geometry-pythagoras'
  | 'geometry-sohcahtoa'
  | 'geometry-unit-circle'
  | 'geometry-trig-connections'
  // Statistics and probability
  | 'statistics-distribution-shape'
  | 'statistics-normal-zscore'
  | 'statistics-probability-simulation'
  | 'statistics-scatter-regression'
  | 'statistics-box-plot'
  | 'statistics-tree-two-way'
  | 'statistics-sampling-distribution'
  // Vectors, matrices and complex numbers
  | 'linear-vector-resultant'
  | 'linear-matrix-transform'
  | 'linear-complex-plane'
  | 'linear-complex-multiplication';

// ─── Typed scene-data discriminated union ─────────────────────────────────────
// Each variant generator attaches typed canvas parameters so consuming components
// never parse prompt strings. The `kind` field is the discriminant.

export interface PythagorasSceneData {
  kind: 'pythagoras';
  a: number;
  b: number;
  c: number;
}

export interface CircleScalingSceneData {
  kind: 'circle-scaling';
  radius: number;
  scaleFactor: number;
}

export interface SohcahtoaSceneData {
  kind: 'sohcahtoa';
  opp: number;
  adj: number;
  hyp: number;
  angleDeg: number;
  ratio: 'sine' | 'cosine' | 'tangent';
}

export interface NormalZscoreSceneData {
  kind: 'normal-zscore';
  mu: number;
  sigma: number;
  x: number;
  z: number;
}

export interface VectorResultantSceneData {
  kind: 'vector-resultant';
  vecA: [number, number];
  vecB: [number, number];
}

export interface MatrixTransformSceneData {
  kind: 'matrix-transform';
  matrix: [[number, number], [number, number]];
  point: [number, number];
}

export interface ComplexPlaneSceneData {
  kind: 'complex-plane';
  re: number;
  im: number;
  operation: 'modulus' | 'add' | 'multiply-i';
  other?: [number, number];
  result?: [number, number];
}

export interface NumericalNewtonSceneData {
  kind: 'numerical-newton';
  k: number;
  x0: number;
}

export interface NumericalTrapezoidSceneData {
  kind: 'numerical-trapezoid';
  intervalStart: number;
  intervalEnd: number;
  /** Number of strips to draw, so a coarse and a fine partition look different. */
  partitions?: number;
}

export interface DistanceFromOriginSceneData {
  kind: 'distance-from-origin';
  point: [number, number];
}

export interface TwoPointMeasuresSceneData {
  kind: 'two-point-measures';
  p: [number, number];
  q: [number, number];
}

/** A single plotted point, used by the quadrant activity. */
export interface QuadrantPointSceneData {
  kind: 'quadrant-point';
  point: [number, number];
}

/** Linear or quadratic function the Sandbox canvas should plot. */
export interface FunctionPlotSceneData {
  kind: 'function-plot';
  funType: 'linear' | 'quadratic';
  /** Linear: y = m x + c */
  m?: number;
  c?: number;
  /** Quadratic: y = a x² + b x + k */
  a?: number;
  b?: number;
  k?: number;
  /** Trace-point x position. */
  traceX: number;
}

/** Point plus the transformation the Geometry canvas should apply. */
export interface TransformPointSceneData {
  kind: 'transform-point';
  source: [number, number];
  transform: 'reflect_x' | 'reflect_y' | 'rotate' | 'enlarge';
  angleDeg?: number;
  scaleFactor?: number;
  centre?: [number, number];
}

/** Two boundary lines, and optionally a point being tested against them. */
export interface LineSystemSceneData {
  kind: 'line-system';
  first: { m: number; c: number };
  second: { m: number; c: number };
  testPoint?: [number, number];
}

/** Unit-circle rotation angle in degrees. */
export interface UnitCircleSceneData {
  kind: 'unit-circle';
  angleDeg: number;
}

/** Similar-triangle scale factor. */
export interface SimilaritySceneData {
  kind: 'similarity';
  scaleFactor: number;
}

/** One-variable dataset for dot plots and box plots. */
export interface DatasetSceneData {
  kind: 'dataset';
  values: number[];
}

/** Single-event probability for the bounded simulation scene. */
export interface ProbabilitySceneData {
  kind: 'probability';
  p: number;
}

/** Bivariate data for the scatter/regression scene. */
export interface ScatterSceneData {
  kind: 'scatter';
  points: [number, number][];
}

/** Event a tree-diagram step asks about; the scene reveals its working. */
export type TreeDiagramEvent = 'both-red' | 'both-blue' | 'exactly-one-red';

/** Counts behind the tree diagram and two-way table. */
export interface TwoWaySceneData {
  kind: 'two-way';
  /** Marble counts per colour for the tree diagram. */
  counts: [number, number];
  total: number;
  aTotal: number;
  bTotal: number;
  both: number;
  /** Tree step only: the event the prompt asks about. */
  treeEvent?: TreeDiagramEvent;
}

/** Quadratic curve plus the tangent point the Calculus canvas should draw. */
export interface TangentCurveSceneData {
  kind: 'tangent-curve';
  /** y = a x² + b x + c */
  a: number;
  b: number;
  c: number;
  x0: number;
}

/** Rectangle count for the Riemann-sum scene. */
export interface RiemannSceneData {
  kind: 'riemann';
  n: number;
}

/** Logistic carrying capacity for the direction-field scene. */
export interface DirectionFieldSceneData {
  kind: 'direction-field';
  carryingCapacity: number;
}

/** Which authored kinematics example to show, and at which time. */
export interface KinematicsSceneData {
  kind: 'kinematics';
  exampleIndex: number;
  t: number;
}

/** Polar or parametric preset plus its amplitude parameters. */
export interface CurvePresetSceneData {
  kind: 'curve-preset';
  family: 'polar' | 'parametric';
  preset: string;
  a: number;
  b?: number;
}

/** A one-dimensional number line with marked values and an optional solution set. */
export interface NumberLineSceneData {
  kind: 'number-line';
  min: number;
  max: number;
  /** Values marked with a dot. */
  points: number[];
  /** Solution set, revealed only after the student submits. */
  interval?: { from: number; to: number; closedFrom: boolean; closedTo: boolean };
}

/** Exponential or logarithmic curve the Sandbox canvas should plot. */
export interface ExponentialPlotSceneData {
  kind: 'exponential-plot';
  family: 'exponential' | 'logarithmic';
  /** Leading coefficient: `a` in a·bˣ, or the scale on log_b(x). */
  a: number;
  base: number;
  /** Vertical shift. */
  c: number;
}

/** Angle-reasoning figure: parallel lines, a triangle, or a regular polygon. */
export interface AngleFigureSceneData {
  kind: 'angle-figure';
  figure: 'parallel-lines' | 'triangle' | 'polygon';
  /** Known angles in degrees, in the order the figure labels them. */
  angles: number[];
  /** Side count for the polygon figure. */
  sides?: number;
  /**
   * Which parallel-line relationship the question asks about. The scene needs
   * this to mark the partner angle in the right position.
   */
  relation?: 'corresponding' | 'alternate' | 'co-interior';
}

/** Cubic curve for stationary-point and concavity analysis. */
export interface CurveAnalysisSceneData {
  kind: 'curve-analysis';
  /** y = a x³ + b x² + c x + d */
  a: number;
  b: number;
  c: number;
  d: number;
  /** Point of interest to mark (usually the inflection). */
  x0: number;
}

/** Region between y = x² and a straight line y = m x + q. */
export interface AreaBetweenSceneData {
  kind: 'area-between';
  lineSlope: number;
  lineIntercept: number;
  from: number;
  to: number;
}

/** Absolute-value graph together with its two linear branches and a trace point. */
export interface PiecewiseAbsoluteSceneData {
  kind: 'piecewise-absolute';
  a: number;
  h: number;
  k: number;
  x: number;
}

/** A rate function f and its accumulation A(x)=integral from 0 to x of f(t)dt. */
export interface AccumulationLinkSceneData {
  kind: 'accumulation-link';
  m: number;
  c: number;
  x: number;
}

/** Cubic function and its first derivative at a shared x-coordinate. */
export interface FunctionDerivativeLinkSceneData {
  kind: 'function-derivative-link';
  a: number;
  b: number;
  c: number;
  d: number;
  x: number;
}

/** Deterministic sampling distribution for a population proportion. */
export interface SamplingDistributionSceneData {
  kind: 'sampling-distribution';
  p: number;
  sampleSize: number;
  repetitions: number;
}

/** Unit-circle angle linked to a transformed sine graph. */
export interface TrigConnectionsSceneData {
  kind: 'trig-connections';
  angleDeg: number;
  amplitude: number;
  phaseDeg: number;
}

/** Multiplication of two complex numbers on an Argand diagram. */
export interface ComplexMultiplicationSceneData {
  kind: 'complex-multiplication';
  z: [number, number];
  w: [number, number];
}

export type LabSceneData =
  | PythagorasSceneData
  | CircleScalingSceneData
  | SohcahtoaSceneData
  | NormalZscoreSceneData
  | VectorResultantSceneData
  | MatrixTransformSceneData
  | ComplexPlaneSceneData
  | NumericalNewtonSceneData
  | NumericalTrapezoidSceneData
  | DistanceFromOriginSceneData
  | TwoPointMeasuresSceneData
  | QuadrantPointSceneData
  | FunctionPlotSceneData
  | TransformPointSceneData
  | LineSystemSceneData
  | UnitCircleSceneData
  | SimilaritySceneData
  | DatasetSceneData
  | ProbabilitySceneData
  | ScatterSceneData
  | TwoWaySceneData
  | TangentCurveSceneData
  | RiemannSceneData
  | DirectionFieldSceneData
  | KinematicsSceneData
  | CurvePresetSceneData
  | NumberLineSceneData
  | ExponentialPlotSceneData
  | AngleFigureSceneData
  | CurveAnalysisSceneData
  | AreaBetweenSceneData
  | PiecewiseAbsoluteSceneData
  | AccumulationLinkSceneData
  | FunctionDerivativeLinkSceneData
  | SamplingDistributionSceneData
  | TrigConnectionsSceneData
  | ComplexMultiplicationSceneData;

export interface LearnStep {
  prompt: string;
  type: 'predict' | 'answer' | 'drag-to';
  acceptedAnswers: string[];
  tolerance?: number;
  feedbackCorrect: string;
  feedbackIncorrect: string;
  hint?: string;
  /**
   * `core` steps form the graded activity. `extension` steps are unlocked only
   * after every core step is answered correctly, so a capable student gets extra
   * demand without changing the activity's completion contract.
   */
  tier?: LearnStepTier;
  /**
   * Opt in to numeric-sampling equivalence marking so the step can ask for an
   * expression (a derivative, a tangent rule) instead of a single value.
   */
  equivalence?: AnswerEquivalence;
  /** Typed canvas parameters for the visual scene. */
  sceneData?: LabSceneData;
}

export interface LabActivityMeta {
  id: LabActivityId;
  tab: LabTab;
  title: string;
  objective: string;
  level: 'junior' | 'senior';
  strand: LabStrand;
  band: LabBand;
  /** Real curriculum topic IDs; empty means no confident mapping. */
  topicIds?: string[];
  steps: LearnStep[];
}

export const LAB_ACTIVITIES: Record<LabActivityId, LabActivityMeta> = {
  // ─── Explorer Activities ───────────────────────────────────────────────
  'explorer-number-line': {
    id: 'explorer-number-line',
    topicIds: ["AC9M7N04", "AC9M8A02"],
    tab: 'explorer',
    title: 'Number Line: Order and Solution Sets',
    objective: 'Place rational numbers on a number line, find a value between two others, and read the solution set of an inequality.',
    level: 'junior',
    strand: 'number-algebra',
    band: '7-8',
    steps: [
      {
        prompt: 'Which of -3.5 and -3 is further left on the number line? Give that number.',
        type: 'predict',
        acceptedAnswers: ['-3.5', '-7/2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Moving left means getting smaller, and -3.5 < -3.',
        feedbackIncorrect: 'On a number line, further left means smaller. Since -3.5 < -3, the answer is -3.5.',
        hint: 'With negative numbers the one with the larger digits is the smaller number.',
        sceneData: { kind: 'number-line', min: -6, max: 6, points: [-3.5, -3] },
      },
      {
        prompt: 'What number lies exactly halfway between -5 and 2?',
        type: 'answer',
        acceptedAnswers: ['-1.5', '-3/2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The midpoint is (-5 + 2)/2 = -1.5.',
        feedbackIncorrect: 'Average the two endpoints: (-5 + 2)/2 = -1.5.',
        hint: 'Halfway between two numbers is their average.',
        sceneData: { kind: 'number-line', min: -6, max: 6, points: [-5, 2] },
      },
      {
        prompt: 'Solve 2x - 3 < 5. What is the largest integer that satisfies it?',
        type: 'answer',
        acceptedAnswers: ['3'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! 2x < 8 gives x < 4, so the largest integer is 3.',
        feedbackIncorrect: 'Rearranging gives x < 4. Because the inequality is strict, 4 itself does not qualify, so the answer is 3.',
        hint: 'Solve for x first, then think carefully about whether the boundary value is included.',
        sceneData: { kind: 'number-line', min: -6, max: 6, points: [], interval: { from: -6, to: 4, closedFrom: false, closedTo: false } },
      },
      {
        prompt: 'Extension: how many integers satisfy -2 ≤ x < 3?',
        type: 'answer',
        acceptedAnswers: ['5'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! -2, -1, 0, 1 and 2 all qualify, and 3 does not because the right end is open.',
        feedbackIncorrect: 'List them: -2, -1, 0, 1, 2. The value 3 is excluded because that end is open, so there are 5.',
        hint: 'One end is closed and the other is open — count carefully rather than subtracting.',
        tier: 'extension',
        sceneData: { kind: 'number-line', min: -6, max: 6, points: [], interval: { from: -2, to: 3, closedFrom: true, closedTo: false } },
      },
    ],
  },
  'explorer-quadrant-predict': {
    id: 'explorer-quadrant-predict',
    topicIds: ["AC9M7SP03"],
    tab: 'explorer',
    title: 'Predict the Quadrant',
    objective: 'Given coordinates, predict which quadrant a point lies in before seeing it on the grid.',
    level: 'junior',
    strand: 'number-algebra',
    band: '7-8',
    steps: [
      {
        prompt: 'The point (3, -2) is in which quadrant? (Answer: I, II, III, or IV)',
        type: 'predict',
        acceptedAnswers: ['IV', '4', 'Quadrant IV', 'quadrant 4'],
        feedbackCorrect: 'Correct! x > 0 and y < 0 means Quadrant IV (bottom-right).',
        feedbackIncorrect: 'Not quite. When x > 0 and y < 0, the point is in Quadrant IV (bottom-right).',
        hint: 'Think: positive x is right, negative y is down.',
      },
      {
        prompt: 'The point (-5, 7) is in which quadrant?',
        type: 'predict',
        acceptedAnswers: ['II', '2', 'Quadrant II', 'quadrant 2'],
        feedbackCorrect: 'Correct! x < 0 and y > 0 means Quadrant II (top-left).',
        feedbackIncorrect: 'Not quite. When x < 0 and y > 0, the point is in Quadrant II (top-left).',
        hint: 'Negative x is left, positive y is up.',
      },
      {
        prompt: 'The point (-4, -3) is in which quadrant?',
        type: 'predict',
        acceptedAnswers: ['III', '3', 'Quadrant III', 'quadrant 3'],
        feedbackCorrect: 'Correct! Both coordinates negative means Quadrant III (bottom-left).',
        feedbackIncorrect: 'Not quite. When both x < 0 and y < 0, the point is in Quadrant III (bottom-left).',
      },
      {
        prompt: 'Extension: a point (a, b) satisfies ab < 0 and b > a. Which quadrant must it be in?',
        type: 'predict',
        acceptedAnswers: ['II', '2', 'Quadrant II', 'quadrant 2'],
        feedbackCorrect: 'Correct! ab < 0 needs opposite signs, so Quadrant II or IV. Only in Quadrant II is the y-coordinate the larger one.',
        feedbackIncorrect: 'ab < 0 leaves Quadrant II (x < 0, y > 0) or Quadrant IV (x > 0, y < 0). In Quadrant IV the y-coordinate is the smaller one, so b > a forces Quadrant II.',
        hint: 'Work out which quadrants give opposite signs first, then test b > a in each.',
        tier: 'extension',
      },
    ],
  },

  'explorer-distance-from-origin': {
    id: 'explorer-distance-from-origin',
    topicIds: ["AC9M7N01"],
    tab: 'explorer',
    title: 'Distance from Origin',
    objective: 'Calculate the distance from a point to the origin using the distance formula.',
    level: 'junior',
    strand: 'measurement-geometry',
    band: '7-8',
    steps: [
      {
        prompt: 'What is the distance from (3, 4) to the origin? (Give the exact value)',
        type: 'answer',
        acceptedAnswers: ['5'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! √(3² + 4²) = √(9 + 16) = √25 = 5.',
        feedbackIncorrect: 'Use the distance formula: d = √(x² + y²). So d = √(9 + 16) = √25 = 5.',
        hint: 'd = √(x² + y²)',
      },
      {
        prompt: 'What is the distance from (1, 1) to the origin? (Round to 2 decimal places)',
        type: 'answer',
        acceptedAnswers: ['1.41'],
        tolerance: 0.005,
        feedbackCorrect: 'Correct! √(1² + 1²) = √2 ≈ 1.41.',
        feedbackIncorrect: 'd = √(1² + 1²) = √2 ≈ 1.41.',
        hint: 'd = √(x² + y²)',
      },
      {
        prompt: 'What is the distance from (5, 12) to the origin?',
        type: 'answer',
        acceptedAnswers: ['13'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! √(25 + 144) = √169 = 13. This is a 5-12-13 Pythagorean triple!',
        feedbackIncorrect: 'd = √(5² + 12²) = √(25 + 144) = √169 = 13.',
      },
      {
        prompt: 'Extension: how many points with integer coordinates lie exactly 5 units from the origin?',
        type: 'answer',
        acceptedAnswers: ['12'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! x² + y² = 25 gives (±5, 0), (0, ±5), (±3, ±4) and (±4, ±3): 4 + 4 + 4 = 12 points.',
        feedbackIncorrect: 'Solve x² + y² = 25 over the integers: (5, 0), (3, 4) and (4, 3) plus every sign change gives 12 points.',
        hint: 'List the non-negative solutions of x² + y² = 25 first, then count the sign and order variations.',
        tier: 'extension',
      },
    ],
  },

  'explorer-two-point-measures': {
    id: 'explorer-two-point-measures',
    topicIds: ["AC9M9A03"],
    tab: 'explorer',
    title: 'Gradient, Midpoint and Distance',
    objective: 'Use two points to calculate gradient, midpoint and distance, then verify each result on the graph.',
    level: 'junior',
    strand: 'number-algebra',
    band: '9-10',
    steps: [
      {
        prompt: 'For P(-2, -3) and Q(3, 9), what is the gradient of PQ?',
        type: 'answer',
        acceptedAnswers: ['12/5', '2.4'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Gradient = rise/run = (9 - (-3))/(3 - (-2)) = 12/5 = 2.4.',
        feedbackIncorrect: 'Use m = (y₂-y₁)/(x₂-x₁) = (9-(-3))/(3-(-2)) = 12/5.',
        hint: 'Subtract the y-coordinates, then divide by the difference in x-coordinates. Watch the double negatives.',
      },
      {
        prompt: 'For the same points, what is the midpoint? Enter x, y.',
        type: 'answer',
        acceptedAnswers: ['0.5, 3', '(0.5, 3)', '0.5,3', '(0.5,3)'],
        feedbackCorrect: 'Correct! Average the coordinates: ((-2+3)/2, (-3+9)/2) = (0.5, 3).',
        feedbackIncorrect: 'Average each coordinate separately: ((-2+3)/2, (-3+9)/2) = (0.5, 3).',
        hint: 'The midpoint coordinates are the averages of the endpoint coordinates.',
      },
      {
        prompt: 'For P(-2, -3) and Q(3, 9), what is the distance PQ?',
        type: 'answer',
        acceptedAnswers: ['13'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! √((3-(-2))² + (9-(-3))²) = √(25+144) = 13.',
        feedbackIncorrect: 'Use d = √((x₂-x₁)²+(y₂-y₁)²) = √(5²+12²) = 13.',
        hint: 'The horizontal and vertical changes form a 5-12-13 right triangle.',
      },
      {
        prompt: 'Extension: R(k, 21) lies on the same straight line as P and Q. Find k.',
        type: 'answer',
        acceptedAnswers: ['8'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! From Q(3, 9) the rise to y = 21 is 12, and 12 ÷ (12/5) = 5, so k = 3 + 5 = 8.',
        feedbackIncorrect: 'Collinear points share one gradient: (21 − 9)/(k − 3) = 12/5 gives k = 8.',
        hint: 'Set the gradient from Q to R equal to the gradient of PQ.',
        tier: 'extension',
      },
    ],
  },

  // ─── Sandbox Activities ────────────────────────────────────────────────
  'sandbox-gradient-effect': {
    id: 'sandbox-gradient-effect',
    topicIds: ["AC9M7A05", "AC9M8A03"],
    tab: 'sandbox',
    title: 'Effect of Gradient',
    objective: 'Predict how changing the gradient (m) affects a linear function y = mx + c.',
    level: 'junior',
    strand: 'functions-graphs',
    band: '7-8',
    steps: [
      {
        prompt: 'For y = 2x + 1, what is the y-value when x = 3?',
        type: 'answer',
        acceptedAnswers: ['7'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! y = 2(3) + 1 = 7.',
        feedbackIncorrect: 'Substitute x = 3: y = 2(3) + 1 = 6 + 1 = 7.',
        hint: 'Substitute x = 3 into y = 2x + 1.',
      },
      {
        prompt: 'If we change the gradient from 2 to -1 (so y = -x + 1), does the line slope up or down from left to right?',
        type: 'predict',
        acceptedAnswers: ['down', 'downward', 'slopes down', 'decreasing'],
        feedbackCorrect: 'Correct! A negative gradient means the line slopes downward from left to right.',
        feedbackIncorrect: 'A negative gradient (m < 0) means the line slopes downward from left to right.',
        hint: 'Negative m means the function decreases as x increases.',
      },
      {
        prompt: 'For y = -x + 1, what is the y-intercept?',
        type: 'answer',
        acceptedAnswers: ['1'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! The y-intercept is the value of c in y = mx + c, which is 1.',
        feedbackIncorrect: 'The y-intercept is found by setting x = 0: y = -(0) + 1 = 1.',
      },
      {
        prompt: 'Extension: a line passes through (2, 1) and (5, 10). Writing it as y = mx + c, what is c?',
        type: 'answer',
        acceptedAnswers: ['-5'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! m = (10 − 1)/(5 − 2) = 3, then 1 = 3(2) + c gives c = −5.',
        feedbackIncorrect: 'First find the gradient m = 9/3 = 3, then substitute one point: 1 = 3(2) + c, so c = −5.',
        hint: 'You need the gradient before you can find the intercept.',
        tier: 'extension',
      },
    ],
  },

  'sandbox-function-transformations': {
    id: 'sandbox-function-transformations',
    topicIds: ["AC9M9A06"],
    tab: 'sandbox',
    title: 'Transforming a Parabola',
    objective: 'Read the vertex, y-intercept and shape of y = a(x - h)² + k directly from its parameters.',
    level: 'junior',
    strand: 'functions-graphs',
    band: '9-10',
    steps: [
      {
        prompt: 'For y = 2(x - 3)² - 1, what are the vertex coordinates? Enter x, y.',
        type: 'predict',
        acceptedAnswers: ['3, -1', '(3, -1)', '3,-1', '(3,-1)'],
        feedbackCorrect: 'Correct! In y = a(x - h)² + k the vertex sits at (h, k) = (3, -1).',
        feedbackIncorrect: 'Completed-square form gives the vertex directly: (h, k) = (3, -1). Note the sign of h.',
        hint: 'The bracket is zero at the vertex. Which x makes (x - 3) zero?',
        sceneData: { kind: 'function-plot', funType: 'quadratic', a: 2, b: -12, k: 17, traceX: 3 },
      },
      {
        prompt: 'For the same parabola, what is the y-value when x = 4?',
        type: 'answer',
        acceptedAnswers: ['1'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! y = 2(4 - 3)² - 1 = 2(1) - 1 = 1.',
        feedbackIncorrect: 'Substitute x = 4: y = 2(1)² - 1 = 1.',
        hint: 'Work inside the bracket first, then square, then apply a and k.',
        sceneData: { kind: 'function-plot', funType: 'quadratic', a: 2, b: -12, k: 17, traceX: 4 },
      },
      {
        prompt: 'What is the y-intercept of y = 2(x - 3)² - 1?',
        type: 'answer',
        acceptedAnswers: ['17'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! Setting x = 0 gives y = 2(-3)² - 1 = 18 - 1 = 17.',
        feedbackIncorrect: 'The y-intercept needs x = 0: y = 2(0 - 3)² - 1 = 17.',
        hint: 'The y-intercept is not k — substitute x = 0 into the whole rule.',
        sceneData: { kind: 'function-plot', funType: 'quadratic', a: 2, b: -12, k: 17, traceX: 0 },
      },
      {
        prompt: 'Extension: a parabola has vertex (3, -1) and passes through (5, 7). Find a.',
        type: 'answer',
        acceptedAnswers: ['2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! 7 = a(5 - 3)² - 1 gives 4a = 8, so a = 2.',
        feedbackIncorrect: 'Substitute the point into y = a(x - 3)² - 1: 7 = 4a - 1, so a = 2.',
        hint: 'Put the known point into the completed-square form and solve for the one unknown.',
        tier: 'extension',
        sceneData: { kind: 'function-plot', funType: 'quadratic', a: 2, b: -12, k: 17, traceX: 5 },
      },
    ],
  },
  'sandbox-exponential-log': {
    id: 'sandbox-exponential-log',
    topicIds: ["AC9M10A03", "AC9M10A04", "QCAA_METHODS_U2_T1", "QCAA_METHODS_U2_T2"],
    tab: 'sandbox',
    title: 'Exponential Growth and Logarithms',
    objective: 'See how the starting value and growth factor shape an exponential graph, then use logarithms to work backwards.',
    level: 'junior',
    strand: 'functions-graphs',
    band: '9-10',
    steps: [
      {
        prompt: 'For y = 3(2ˣ), what is y when x = 0?',
        type: 'answer',
        acceptedAnswers: ['3'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! Any non-zero base to the power 0 is 1, so y = 3(1) = 3.',
        feedbackIncorrect: 'Since 2⁰ = 1, the starting value is y = 3.',
        hint: 'What is any non-zero number raised to the power zero?',
        sceneData: { kind: 'exponential-plot', family: 'exponential', a: 3, base: 2, c: 0 },
      },
      {
        prompt: 'For y = 3(2ˣ), what is y when x = 3?',
        type: 'answer',
        acceptedAnswers: ['24'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! y = 3(2³) = 3(8) = 24.',
        feedbackIncorrect: 'Evaluate the power first: 2³ = 8, then y = 3(8) = 24.',
        hint: 'Apply the index before the coefficient.',
        sceneData: { kind: 'exponential-plot', family: 'exponential', a: 3, base: 2, c: 0 },
      },
      {
        prompt: 'For y = log₂(x), what is y when x = 8?',
        type: 'answer',
        acceptedAnswers: ['3'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! log₂(8) asks what power of 2 gives 8, and 2³ = 8.',
        feedbackIncorrect: 'A logarithm asks for the exponent: 2³ = 8, so log₂(8) = 3.',
        hint: 'Rewrite it as 2^y = 8.',
        sceneData: { kind: 'exponential-plot', family: 'logarithmic', a: 1, base: 2, c: 0 },
      },
      {
        prompt: 'Extension: a sample decays as y = A(1/2)ˣ. After how many steps is y equal to A/8?',
        type: 'answer',
        acceptedAnswers: ['3'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! (1/2)³ = 1/8, so three halvings reduce A to A/8.',
        feedbackIncorrect: 'Solve (1/2)ˣ = 1/8. Since 1/8 = (1/2)³, the answer is x = 3.',
        hint: 'Write 1/8 as a power of 1/2.',
        tier: 'extension',
        sceneData: { kind: 'exponential-plot', family: 'exponential', a: 1, base: 0.5, c: 0 },
      },
    ],
  },
  'sandbox-vertex-predict': {
    id: 'sandbox-vertex-predict',
    topicIds: ["AC9M9A04"],
    tab: 'sandbox',
    title: 'Predict the Vertex',
    objective: 'Find the vertex of a quadratic function using the formula x = -b/(2a).',
    level: 'junior',
    strand: 'functions-graphs',
    band: '9-10',
    steps: [
      {
        prompt: 'For y = x² - 4x + 3, what is the x-coordinate of the vertex?',
        type: 'answer',
        acceptedAnswers: ['2'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! x = -(-4)/(2×1) = 4/2 = 2.',
        feedbackIncorrect: 'x = -b/(2a) = -(-4)/(2×1) = 4/2 = 2.',
        hint: 'The vertex sits on the axis of symmetry, at x = -b/(2a). Here a = 1 and b = -4.',
      },
      {
        prompt: 'What is the y-coordinate of the vertex?',
        type: 'answer',
        acceptedAnswers: ['-1'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! y = (2)² - 4(2) + 3 = 4 - 8 + 3 = -1. Vertex is (2, -1).',
        feedbackIncorrect: 'y = (2)² - 4(2) + 3 = 4 - 8 + 3 = -1.',
        hint: 'Substitute x = 2: y = 4 - 8 + 3.',
      },
      {
        prompt: 'Does this parabola open upward or downward?',
        type: 'predict',
        acceptedAnswers: ['up', 'upward', 'upwards', 'opens up', 'opens upward'],
        feedbackCorrect: 'Correct! Since a = 1 > 0, the parabola opens upward.',
        feedbackIncorrect: 'Since a = 1 > 0, the parabola opens upward. If a < 0 it opens downward.',
      },
      {
        prompt: 'Extension: for which value of c does y = x² − 4x + c touch the x-axis exactly once?',
        type: 'answer',
        acceptedAnswers: ['4'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! One solution needs b² − 4ac = 0, so 16 − 4c = 0 and c = 4.',
        feedbackIncorrect: 'A single x-intercept means the discriminant is zero: 16 − 4c = 0, so c = 4.',
        hint: 'One x-intercept means the vertex sits on the x-axis.',
        tier: 'extension',
      },
    ],
  },

  'sandbox-intercept-find': {
    id: 'sandbox-intercept-find',
    topicIds: ["AC9M9A04"],
    tab: 'sandbox',
    title: 'Finding Intercepts',
    objective: 'Find the x-intercepts and y-intercept of a quadratic function.',
    level: 'junior',
    strand: 'functions-graphs',
    band: '9-10',
    steps: [
      {
        prompt: 'For y = x² - 5x + 6, what is the y-intercept?',
        type: 'answer',
        acceptedAnswers: ['6'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! y = 0² - 5(0) + 6 = 6. The y-intercept is (0, 6).',
        feedbackIncorrect: 'Set x = 0: y = 0 - 0 + 6 = 6.',
        hint: 'The y-intercept is the y-value where the curve crosses the vertical axis, so set x = 0.',
      },
      {
        prompt: 'What are the x-intercepts of y = x² - 5x + 6? Give the smaller root.',
        type: 'answer',
        acceptedAnswers: ['2'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! x² - 5x + 6 = (x - 2)(x - 3) = 0, so x = 2 or x = 3.',
        feedbackIncorrect: 'Factorise: x² - 5x + 6 = (x - 2)(x - 3) = 0. The roots are x = 2 and x = 3.',
        hint: 'Factorise the quadratic: find two numbers that multiply to 6 and add to -5.',
      },
      {
        prompt: 'What is the larger x-intercept?',
        type: 'answer',
        acceptedAnswers: ['3'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! The x-intercepts are x = 2 and x = 3.',
        feedbackIncorrect: 'From (x - 2)(x - 3) = 0, the larger root is x = 3.',
      },
      {
        prompt: 'Extension: what is the smallest integer k for which y = x² − 5x + 6 + k has no x-intercepts?',
        type: 'answer',
        acceptedAnswers: ['1'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! The discriminant is 25 − 4(6 + k) = 1 − 4k, which is negative once k > 0.25, so k = 1.',
        feedbackIncorrect: 'No x-intercepts means 25 − 4(6 + k) < 0, that is 1 − 4k < 0, so the smallest integer is k = 1.',
        hint: 'Adding k lifts the whole parabola. Ask when the discriminant becomes negative.',
        tier: 'extension',
      },
    ],
  },

  'sandbox-simultaneous-lines': {
    id: 'sandbox-simultaneous-lines',
    topicIds: ["AC9M10A02"],
    tab: 'sandbox',
    title: 'Where Two Lines Meet',
    objective: 'Connect the graphical intersection of two lines with the ordered pair that satisfies both equations.',
    level: 'junior',
    strand: 'functions-graphs',
    band: '9-10',
    steps: [
      {
        prompt: 'For y = 2x + 1 and y = -x + 7, what is the x-coordinate of their intersection?',
        type: 'predict',
        acceptedAnswers: ['2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Equating the rules gives 2x + 1 = -x + 7, so 3x = 6 and x = 2.',
        feedbackIncorrect: 'Set the equations equal: 2x + 1 = -x + 7. Then 3x = 6, so x = 2.',
        hint: 'At the intersection, both equations have the same y-value.',
      },
      {
        prompt: 'What is the y-coordinate of that intersection?',
        type: 'answer',
        acceptedAnswers: ['5'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Substituting x = 2 into either rule gives y = 5, so the solution is (2, 5).',
        feedbackIncorrect: 'Substitute x = 2: y = 2(2) + 1 = 5.',
      },
      {
        prompt: 'Transfer: y = x - 1 and y = -3x + 11 meet at what x-coordinate?',
        type: 'answer',
        acceptedAnswers: ['3'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! x - 1 = -3x + 11 gives 4x = 12, so x = 3 and y = 2.',
        feedbackIncorrect: 'Set x - 1 = -3x + 11. Then 4x = 12, so x = 3.',
        hint: 'Equate the two expressions for y. The answer is not the same as the first system.',
      },
      {
        prompt: 'Extension: a line y = mx through the origin also passes through the intersection of y = 2x + 1 and y = -x + 7. Find m.',
        type: 'answer',
        acceptedAnswers: ['2.5', '5/2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The intersection is (2, 5), so 5 = 2m and m = 5/2 = 2.5.',
        feedbackIncorrect: 'The two lines meet at (2, 5). Substituting into y = mx gives 5 = 2m, so m = 2.5.',
        hint: 'You already know where the first two lines meet; that point must satisfy y = mx.',
        tier: 'extension',
      },
    ],
  },

  'sandbox-inequality-region': {
    id: 'sandbox-inequality-region',
    topicIds: ["AC9M8A02"],
    tab: 'sandbox',
    title: 'Test an Inequality Region',
    objective: 'Identify the overlap of two linear inequalities and test whether points belong to the feasible region.',
    level: 'junior',
    strand: 'functions-graphs',
    band: '9-10',
    steps: [
      {
        prompt: 'The boundaries y = x + 1 and y = -x + 5 meet at what x-coordinate?',
        type: 'predict',
        acceptedAnswers: ['2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! x + 1 = -x + 5 gives 2x = 4, so the boundaries meet at (2, 3).',
        feedbackIncorrect: 'Equate the boundaries: x + 1 = -x + 5, so x = 2.',
        hint: 'The boundary intersection is found like a simultaneous-equations solution.',
      },
      {
        prompt: 'Does (0, 0) satisfy both y ≥ x + 1 and y ≤ -x + 5? Answer yes or no.',
        type: 'answer',
        acceptedAnswers: ['no', 'n'],
        feedbackCorrect: 'Correct! 0 ≥ 1 is false, so (0, 0) is outside the overlap.',
        feedbackIncorrect: 'Substitute (0,0): the first inequality becomes 0 ≥ 1, which is false.',
        hint: 'A feasible point must satisfy every inequality.',
      },
      {
        prompt: 'Transfer: does (1, 3) satisfy both inequalities? Answer yes or no.',
        type: 'answer',
        acceptedAnswers: ['yes', 'y'],
        feedbackCorrect: 'Correct! 3 ≥ 2 and 3 ≤ 4, so (1, 3) lies in the overlap.',
        feedbackIncorrect: 'Substitute (1,3): 3 ≥ 2 and 3 ≤ 4 are both true.',
      },
      {
        prompt: 'Extension: over the region y ≥ x + 1, y ≤ -x + 5 and x ≥ 0, what is the largest value of 2x + y?',
        type: 'answer',
        acceptedAnswers: ['7'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The corners are (0, 1), (0, 5) and (2, 3), giving 2x + y = 1, 5 and 7. The maximum is 7.',
        feedbackIncorrect: 'Test the corners of the region: (0, 1) → 1, (0, 5) → 5, (2, 3) → 7. The maximum is 7.',
        hint: 'For a linear expression the extreme value always occurs at a corner of the region.',
        tier: 'extension',
      },
    ],
  },

  // ─── Calculus Activities ───────────────────────────────────────────────
  'calculus-tangent-slope-predict': {
    id: 'calculus-tangent-slope-predict',
    topicIds: ["QCAA_METHODS_U2_T3"],
    tab: 'calculus',
    title: 'Predict the Tangent Slope',
    objective: "Given f(x) = x² - 3x, predict f'(x₀) before seeing the tangent line.",
    level: 'senior',
    strand: 'calculus',
    band: 'senior',
    steps: [
      {
        prompt: "For f(x) = x² - 3x, what is f'(x)? Give your answer as a formula in x.",
        type: 'answer',
        acceptedAnswers: ['2x - 3', '2x-3', '2*x - 3', '2*x-3'],
        equivalence: { variables: ['x'] },
        feedbackCorrect: "Correct! f'(x) = 2x - 3 by the power rule.",
        feedbackIncorrect: "Use the power rule: d/dx(x²) = 2x and d/dx(-3x) = -3. So f'(x) = 2x - 3.",
        hint: 'Apply the power rule to each term.',
      },
      {
        prompt: "What is f'(2)? (The slope of the tangent at x = 2)",
        type: 'answer',
        acceptedAnswers: ['1'],
        tolerance: 0.01,
        feedbackCorrect: "Correct! f'(2) = 2(2) - 3 = 1. The tangent has slope 1 at x = 2.",
        feedbackIncorrect: "f'(2) = 2(2) - 3 = 4 - 3 = 1.",
        hint: "Substitute x = 2 into f'(x) = 2x - 3.",
      },
      {
        prompt: "At what x-value is the tangent horizontal? (f'(x) = 0)",
        type: 'answer',
        acceptedAnswers: ['1.5', '3/2'],
        tolerance: 0.01,
        feedbackCorrect: "Correct! 2x - 3 = 0 gives x = 3/2 = 1.5. This is the turning point.",
        feedbackIncorrect: "Set f'(x) = 0: 2x - 3 = 0, so x = 3/2 = 1.5.",
      },
      {
        prompt: "Extension: give the right-hand side of the tangent to f at x = 2, written as y = mx + c.",
        type: 'answer',
        acceptedAnswers: ['x - 4'],
        equivalence: { variables: ['x'] },
        feedbackCorrect: 'Correct! f(2) = −2 and f′(2) = 1, so y + 2 = 1(x − 2) gives y = x − 4.',
        feedbackIncorrect: 'Use the point (2, f(2)) = (2, −2) with gradient f′(2) = 1: y = x − 4.',
        hint: 'A tangent needs both a gradient and a point on the curve.',
        tier: 'extension',
      },
    ],
  },

  'calculus-curve-sketching': {
    id: 'calculus-curve-sketching',
    topicIds: ["QCAA_METHODS_U2_T4", "QCAA_METHODS_U3_T3"],
    tab: 'calculus',
    title: 'Stationary Points and Concavity',
    objective: 'Use the first and second derivatives to locate stationary points, the inflection point and intervals of concavity.',
    level: 'senior',
    strand: 'calculus',
    band: 'senior',
    steps: [
      {
        prompt: "For f(x) = x³ - 6x² + 9x, what is f'(x)? Give your answer as a formula in x.",
        type: 'answer',
        acceptedAnswers: ['3x^2 - 12x + 9'],
        equivalence: { variables: ['x'] },
        feedbackCorrect: "Correct! f'(x) = 3x² - 12x + 9 = 3(x - 1)(x - 3).",
        feedbackIncorrect: "Differentiate term by term: f'(x) = 3x² - 12x + 9.",
        hint: 'Apply the power rule to each term.',
        sceneData: { kind: 'curve-analysis', a: 1, b: -6, c: 9, d: 0, x0: 1 },
      },
      {
        prompt: 'At what x-value does the curve have its point of inflection?',
        type: 'answer',
        acceptedAnswers: ['2'],
        tolerance: 0.01,
        feedbackCorrect: "Correct! f''(x) = 6x - 12 is zero at x = 2, and it changes sign there.",
        feedbackIncorrect: "Solve f''(x) = 0: 6x - 12 = 0 gives x = 2.",
        hint: 'Inflection is about the second derivative, not the first.',
        sceneData: { kind: 'curve-analysis', a: 1, b: -6, c: 9, d: 0, x0: 2 },
      },
      {
        prompt: 'Is the curve concave up or concave down at x = 0?',
        type: 'predict',
        acceptedAnswers: ['down', 'concave down', 'downward'],
        feedbackCorrect: "Correct! f''(0) = -12 < 0, so the curve is concave down there.",
        feedbackIncorrect: "Evaluate f''(0) = 6(0) - 12 = -12. A negative second derivative means concave down.",
        hint: 'Substitute the x-value into the second derivative and read its sign.',
        sceneData: { kind: 'curve-analysis', a: 1, b: -6, c: 9, d: 0, x0: 0 },
      },
      {
        prompt: 'Extension: the stationary points are at x = 1 and x = 3. Which one is the local maximum? Give its x-value.',
        type: 'answer',
        acceptedAnswers: ['1'],
        tolerance: 0.01,
        feedbackCorrect: "Correct! f''(1) = -6 < 0, so x = 1 is the local maximum; x = 3 is the local minimum.",
        feedbackIncorrect: "Test the second derivative: f''(1) = -6 (maximum) and f''(3) = 6 (minimum), so x = 1.",
        hint: 'The second derivative test classifies a stationary point without sketching.',
        tier: 'extension',
        sceneData: { kind: 'curve-analysis', a: 1, b: -6, c: 9, d: 0, x0: 1 },
      },
    ],
  },
  'calculus-area-between': {
    id: 'calculus-area-between',
    topicIds: ["QCAA_METHODS_U3_T4", "QCAA_SPECIALIST_U4_T2"],
    tab: 'calculus',
    title: 'Area Between Two Curves',
    objective: 'Find where two graphs cross, decide which is on top, and integrate the difference to get the enclosed area.',
    level: 'senior',
    strand: 'calculus',
    band: 'senior',
    steps: [
      {
        prompt: 'Where do y = x² and y = 2x meet? Give the larger x-value.',
        type: 'answer',
        acceptedAnswers: ['2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! x² = 2x gives x(x - 2) = 0, so x = 0 or x = 2.',
        feedbackIncorrect: 'Set the rules equal: x² = 2x, so x(x - 2) = 0 and the larger solution is x = 2.',
        hint: 'Do not divide by x — you would lose a solution.',
        sceneData: { kind: 'area-between', lineSlope: 2, lineIntercept: 0, from: 0, to: 2 },
      },
      {
        prompt: 'Between those two points, which graph is on top: the line or the parabola?',
        type: 'predict',
        acceptedAnswers: ['line', 'the line', 'y = 2x'],
        feedbackCorrect: 'Correct! At x = 1 the line gives 2 and the parabola gives 1, so the line is above.',
        feedbackIncorrect: 'Test a value between the crossings: at x = 1 the line gives 2 and the parabola gives 1, so the line is on top.',
        hint: 'Test one x-value strictly between the two crossings.',
        sceneData: { kind: 'area-between', lineSlope: 2, lineIntercept: 0, from: 0, to: 2 },
      },
      {
        prompt: 'What is the exact area enclosed between y = x² and y = 2x? Give it as a fraction.',
        type: 'answer',
        acceptedAnswers: ['4/3'],
        tolerance: 0.001,
        equivalence: {},
        feedbackCorrect: 'Correct! ∫₀²(2x - x²) dx = [x² - x³/3]₀² = 4 - 8/3 = 4/3.',
        feedbackIncorrect: 'Integrate top minus bottom: ∫₀²(2x - x²) dx = 4 - 8/3 = 4/3.',
        hint: 'Integrate the upper function minus the lower one, between the crossings.',
        sceneData: { kind: 'area-between', lineSlope: 2, lineIntercept: 0, from: 0, to: 2 },
      },
      {
        prompt: 'Extension: for y = x² and y = mx with m > 0, the enclosed area is m³/6. Which m gives an area of exactly 9/2?',
        type: 'answer',
        acceptedAnswers: ['3'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! m³/6 = 9/2 gives m³ = 27, so m = 3.',
        feedbackIncorrect: 'Solve m³/6 = 9/2: m³ = 27, so m = 3.',
        hint: 'Rearrange for m³ first, then take the cube root.',
        tier: 'extension',
        sceneData: { kind: 'area-between', lineSlope: 3, lineIntercept: 0, from: 0, to: 3 },
      },
    ],
  },
  'calculus-riemann-convergence': {
    id: 'calculus-riemann-convergence',
    topicIds: ["QCAA_METHODS_U3_T4"],
    tab: 'calculus',
    title: 'Rectangle Approximations and Riemann Sums',
    objective: 'Add more rectangles and watch the estimated area move closer to the exact area under the curve.',
    level: 'senior',
    strand: 'calculus',
    band: 'senior',
    steps: [
      {
        prompt: 'For f(x) = x² on [0, 1], the exact area is 1/3. With n = 4 left rectangles, is the estimate less than, equal to, or greater than 1/3?',
        type: 'predict',
        acceptedAnswers: ['less', 'less than', 'under', 'underestimate'],
        feedbackCorrect: 'Correct! For an increasing function, left Riemann sums underestimate the true area.',
        feedbackIncorrect: 'Since x² is increasing on [0,1], the left Riemann sum uses the lower value at each left endpoint, giving an underestimate.',
        hint: 'Think about whether left endpoints are lower or higher than the function across each subinterval.',
      },
      {
        prompt: 'The left Riemann sum with n = 10 for x² on [0,1] gives approximately 0.285. How far is this from the true value 1/3 ≈ 0.333? (Round to 2 decimal places)',
        type: 'answer',
        acceptedAnswers: ['0.05'],
        tolerance: 0.005,
        feedbackCorrect: 'Correct! Error ≈ |0.333 - 0.285| ≈ 0.05. More rectangles reduce the error.',
        feedbackIncorrect: 'Error = |1/3 - 0.285| ≈ |0.333 - 0.285| ≈ 0.048 ≈ 0.05.',
      },
      {
        prompt: 'As n → ∞, what value does the left Riemann sum of x² on [0,1] approach? (Express as a fraction)',
        type: 'answer',
        acceptedAnswers: ['1/3', '1 / 3'],
        feedbackCorrect: 'Correct! The Riemann sum converges to the definite integral ∫₀¹ x² dx = 1/3.',
        feedbackIncorrect: 'The limit of the Riemann sum is the definite integral: ∫₀¹ x² dx = [x³/3]₀¹ = 1/3.',
      },
      {
        prompt: 'Extension: the left-sum error for x² on [0, 1] is exactly (3n − 1)/(6n²). What is the smallest n whose error is below 0.01?',
        type: 'answer',
        acceptedAnswers: ['50'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! At n = 49 the error is 0.01013, and at n = 50 it is 0.00993, the first value below 0.01.',
        feedbackIncorrect: 'Solve (3n − 1)/(6n²) < 0.01, i.e. 0.06n² − 3n + 1 > 0, giving n > 49.7, so n = 50.',
        hint: 'Turn the inequality into a quadratic in n and solve it, then round up to a whole number.',
        tier: 'extension',
      },
    ],
  },

  // ─── Geometry Activities ───────────────────────────────────────────────
  'geometry-angle-reasoning': {
    id: 'geometry-angle-reasoning',
    topicIds: ["AC9M7M04", "AC9M7M05"],
    tab: 'geometry',
    title: 'Angle Reasoning',
    objective: 'Use parallel-line angle relationships and angle sums in triangles and polygons.',
    level: 'junior',
    strand: 'measurement-geometry',
    band: '7-8',
    steps: [
      {
        prompt: 'Two parallel lines are cut by a transversal. One angle is 55°. What is its co-interior partner, in degrees?',
        type: 'answer',
        acceptedAnswers: ['125', '125°'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! Co-interior angles on parallel lines are supplementary: 180 - 55 = 125°.',
        feedbackIncorrect: 'Co-interior (allied) angles between parallel lines add to 180°, so the partner is 125°.',
        hint: 'Decide first whether this relationship makes the angles equal or supplementary.',
        sceneData: { kind: 'angle-figure', figure: 'parallel-lines', angles: [55], relation: 'co-interior' },
      },
      {
        prompt: 'A triangle has angles of 55° and 70°. What is the third angle, in degrees?',
        type: 'answer',
        acceptedAnswers: ['55', '55°'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! 180 - 55 - 70 = 55°.',
        feedbackIncorrect: 'The three angles of a triangle total 180°, so the third is 180 - 55 - 70 = 55°.',
        hint: 'Use the total for the interior angles of a triangle.',
        sceneData: { kind: 'angle-figure', figure: 'triangle', angles: [55, 70] },
      },
      {
        prompt: 'What is the sum of the interior angles of a 7-sided polygon, in degrees?',
        type: 'answer',
        acceptedAnswers: ['900', '900°'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! 180(n - 2) = 180(5) = 900°.',
        feedbackIncorrect: 'Split the polygon into n - 2 triangles: 180(7 - 2) = 900°.',
        hint: 'How many triangles can a polygon with n sides be split into?',
        sceneData: { kind: 'angle-figure', figure: 'polygon', angles: [], sides: 7 },
      },
      {
        prompt: 'Extension: in a regular 9-sided polygon, what is the size of each interior angle, in degrees?',
        type: 'answer',
        acceptedAnswers: ['140', '140°'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! The total is 180(7) = 1260°, and 1260 ÷ 9 = 140°.',
        feedbackIncorrect: 'Find the total first: 180(9 - 2) = 1260°. Regular means all nine are equal, so each is 140°.',
        hint: 'Total the interior angles first, then use the fact that a regular polygon has equal angles.',
        tier: 'extension',
        sceneData: { kind: 'angle-figure', figure: 'polygon', angles: [], sides: 9 },
      },
    ],
  },
  'geometry-reflect-predict': {
    id: 'geometry-reflect-predict',
    topicIds: ["AC9M7SP03"],
    tab: 'geometry',
    title: 'Predict the Reflection',
    objective: 'Predict the image coordinates when reflecting a point across an axis.',
    level: 'junior',
    strand: 'measurement-geometry',
    band: '7-8',
    steps: [
      {
        prompt: 'Reflecting (3, 5) across the x-axis gives which point? (Format: x, y)',
        type: 'predict',
        acceptedAnswers: ['3, -5', '(3, -5)', '3,-5', '(3,-5)'],
        feedbackCorrect: 'Correct! Reflecting across the x-axis negates y: (x, y) → (x, -y).',
        feedbackIncorrect: 'Reflection across x-axis: (x, y) → (x, -y). So (3, 5) → (3, -5).',
        hint: 'The x-axis reflection rule is (x, y) → (x, -y).',
      },
      {
        prompt: 'Reflecting (-2, 4) across the y-axis gives which point?',
        type: 'predict',
        acceptedAnswers: ['2, 4', '(2, 4)', '2,4', '(2,4)'],
        feedbackCorrect: 'Correct! Reflecting across the y-axis negates x: (x, y) → (-x, y).',
        feedbackIncorrect: 'Reflection across y-axis: (x, y) → (-x, y). So (-2, 4) → (2, 4).',
        hint: 'The y-axis reflection rule is (x, y) → (-x, y).',
      },
      {
        prompt: 'Reflecting (1, -3) across the y-axis gives which point?',
        type: 'predict',
        acceptedAnswers: ['-1, -3', '(-1, -3)', '-1,-3', '(-1,-3)'],
        feedbackCorrect: 'Correct! (x, y) → (-x, y), so (1, -3) → (-1, -3).',
        feedbackIncorrect: '(x, y) → (-x, y). So (1, -3) → (-1, -3).',
      },
      {
        prompt: 'Extension: reflecting in the line y = x swaps the coordinates. What is the image of (2, -7)?',
        type: 'answer',
        acceptedAnswers: ['-7, 2', '(-7, 2)', '-7,2', '(-7,2)'],
        feedbackCorrect: 'Correct! Reflection in y = x maps (x, y) → (y, x), so (2, −7) → (−7, 2).',
        feedbackIncorrect: 'Reflection in y = x maps (x, y) → (y, x). So (2, −7) becomes (−7, 2).',
        hint: 'Every point on the mirror line y = x stays fixed; that forces the coordinates to swap.',
        tier: 'extension',
      },
    ],
  },

  'geometry-rotation-image': {
    id: 'geometry-rotation-image',
    topicIds: ["AC9M7SP03"],
    tab: 'geometry',
    title: 'Rotation Image',
    objective: 'Predict image coordinates after rotation about the origin.',
    level: 'junior',
    strand: 'measurement-geometry',
    band: '7-8',
    steps: [
      {
        prompt: 'Rotating (1, 0) by 90° anticlockwise about the origin gives? (Format: x, y)',
        type: 'predict',
        acceptedAnswers: ['0, 1', '(0, 1)', '0,1', '(0,1)'],
        feedbackCorrect: 'Correct! 90° anticlockwise: (x, y) → (-y, x). So (1, 0) → (0, 1).',
        feedbackIncorrect: '90° anticlockwise rotation: (x, y) → (-y, x). So (1, 0) → (0, 1).',
        hint: 'The rule for 90° anticlockwise rotation is (x, y) → (-y, x).',
      },
      {
        prompt: 'Rotating (2, 3) by 180° about the origin gives?',
        type: 'predict',
        acceptedAnswers: ['-2, -3', '(-2, -3)', '-2,-3', '(-2,-3)'],
        feedbackCorrect: 'Correct! 180° rotation: (x, y) → (-x, -y). So (2, 3) → (-2, -3).',
        feedbackIncorrect: '180° rotation: (x, y) → (-x, -y). So (2, 3) → (-2, -3).',
        hint: '180° rotation negates both coordinates.',
      },
      {
        prompt: 'Rotating (0, 4) by 270° anticlockwise (or 90° clockwise) about the origin gives?',
        type: 'predict',
        acceptedAnswers: ['4, 0', '(4, 0)', '4,0', '(4,0)'],
        feedbackCorrect: 'Correct! 270° anticlockwise: (x, y) → (y, -x). So (0, 4) → (4, 0).',
        feedbackIncorrect: '270° anticlockwise: (x, y) → (y, -x). So (0, 4) → (4, 0).',
      },
      {
        prompt: 'Extension: a point is rotated 90° anticlockwise about the origin and lands on (3, -5). What was the original point?',
        type: 'answer',
        acceptedAnswers: ['-5, -3', '(-5, -3)', '-5,-3', '(-5,-3)'],
        feedbackCorrect: 'Correct! Undo the rotation with (x, y) → (y, -x): (3, −5) came from (−5, −3).',
        feedbackIncorrect: 'Reverse the rule (x, y) → (−y, x). Solving −y = 3 and x = −5 gives the original point (−5, −3).',
        hint: 'Work backwards: apply the inverse rotation, or rotate 90° clockwise instead.',
        tier: 'extension',
      },
    ],
  },

  'geometry-enlarge-predict': {
    id: 'geometry-enlarge-predict',
    topicIds: ["AC9M9SP02"],
    tab: 'geometry',
    title: 'Enlargement / Scale Factor',
    objective: "Predict the image of a point under enlargement from a centre with a given scale factor.",
    level: 'junior',
    strand: 'measurement-geometry',
    band: '9-10',
    steps: [
      {
        prompt: "Enlarge the point (2, 1) by scale factor 2 from the origin (0, 0). What is the image? (Format: x, y)",
        type: 'predict',
        acceptedAnswers: ['4, 2', '(4, 2)', '4,2', '(4,2)'],
        feedbackCorrect: "Correct! Image = Centre + k(Point - Centre) = (0,0) + 2×(2,1) = (4, 2).",
        feedbackIncorrect: "Image = Centre + k × (Point - Centre). With centre (0,0) and k=2: (0+2×2, 0+2×1) = (4, 2).",
        hint: "Multiply each coordinate by the scale factor when the centre is the origin.",
      },
      {
        prompt: "Enlarge (3, 2) by scale factor 3 from centre (1, 1). What is the image?",
        type: 'predict',
        acceptedAnswers: ['7, 4', '(7, 4)', '7,4', '(7,4)'],
        feedbackCorrect: "Correct! Image = (1,1) + 3×((3,2)-(1,1)) = (1,1) + 3×(2,1) = (1+6, 1+3) = (7, 4).",
        feedbackIncorrect: "Image = C + k(P - C) = (1,1) + 3×(2,1) = (7, 4).",
        hint: "First subtract the centre, then multiply by k, then add the centre back.",
      },
      {
        prompt: "Enlarge (4, 0) by scale factor 0.5 from the origin. What is the image?",
        type: 'predict',
        acceptedAnswers: ['2, 0', '(2, 0)', '2,0', '(2,0)'],
        feedbackCorrect: "Correct! Scale factor < 1 makes the image closer to the centre: 0.5×(4,0) = (2, 0).",
        feedbackIncorrect: "Image = 0.5 × (4, 0) = (2, 0). Scale factor < 1 is a reduction.",
      },
      {
        prompt: 'Extension: an enlargement from centre (2, 3) maps (6, 5) to (14, 9). What is the scale factor?',
        type: 'answer',
        acceptedAnswers: ['3'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The distance vector (4, 2) becomes (12, 6), so k = 3.',
        feedbackIncorrect: 'Compare displacements from the centre: (6, 5) − (2, 3) = (4, 2) and (14, 9) − (2, 3) = (12, 6), so k = 3.',
        hint: 'Measure both points from the centre before comparing them.',
        tier: 'extension',
      },
    ],
  },

  // ─── P5 S6-J Geometry (similarity and congruence) ─────────────────────
  'geometry-similarity-ratio': {
    id: 'geometry-similarity-ratio',
    topicIds: ["AC9M8SP01", "AC9M9SP02"],
    tab: 'geometry',
    title: 'Similar Triangles and Corresponding Side Ratios',
    objective: 'Identify corresponding sides in similar triangles and use scale factors to find missing lengths.',
    level: 'junior',
    strand: 'measurement-geometry',
    band: '9-10',
    steps: [
      {
        prompt: 'Triangle ABC has sides 3, 4, 5. Triangle DEF is similar with shortest side 6. What is the scale factor from ABC to DEF?',
        type: 'answer',
        acceptedAnswers: ['2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Scale factor = 6/3 = 2.',
        feedbackIncorrect: 'The shortest side of ABC is 3, and of DEF is 6. Scale factor = 6 ÷ 3 = 2.',
        hint: 'Divide the corresponding side of the larger triangle by that of the smaller.',
      },
      {
        prompt: 'Using scale factor 2, what is the longest side of triangle DEF?',
        type: 'answer',
        acceptedAnswers: ['10'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Longest side = 5 × 2 = 10.',
        feedbackIncorrect: 'Multiply the longest side of ABC (5) by the scale factor (2): 5 × 2 = 10.',
        hint: 'Multiply each side of ABC by the scale factor.',
      },
      {
        prompt: 'Two triangles are congruent. One has sides 7, 24, 25. What is the hypotenuse of the other?',
        type: 'answer',
        acceptedAnswers: ['25'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Congruent triangles have identical side lengths. The hypotenuse is 25.',
        feedbackIncorrect: 'Congruent means same shape AND size (scale factor = 1). The hypotenuse is 25.',
        hint: 'Congruent triangles are identical — all corresponding sides are equal.',
      },
      {
        prompt: 'Extension: two similar triangles have areas 18 cm² and 50 cm². The smaller one has a 6 cm base. How long is the corresponding base of the larger?',
        type: 'answer',
        acceptedAnswers: ['10'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The area ratio 50/18 = 25/9 gives a length ratio of 5/3, and 6 × 5/3 = 10 cm.',
        feedbackIncorrect: 'Areas scale by k², so k = √(50/18) = 5/3. The base becomes 6 × 5/3 = 10 cm.',
        hint: 'Lengths scale by k but areas scale by k², so take a square root first.',
        tier: 'extension',
      },
    ],
  },

  // ─── P4 Geometry and Trigonometry ─────────────────────────────────────
  'geometry-circle-scaling': {
    id: 'geometry-circle-scaling',
    topicIds: ["AC9M8M03"],
    tab: 'geometry',
    title: 'Circles: What Changes When Radius Changes?',
    objective: 'Change the radius and see circumference grow directly with it, while area grows with the radius squared.',
    level: 'junior',
    strand: 'measurement-geometry',
    band: '9-10',
    steps: [
      {
        prompt: 'A circle has radius 4. What is its circumference in terms of π?',
        type: 'answer',
        acceptedAnswers: ['8π', '8pi', '8*pi', '8 pi'],
        feedbackCorrect: 'Correct! C = 2πr = 2π(4) = 8π.',
        feedbackIncorrect: 'Use C = 2πr. With r = 4, the circumference is 8π.',
        hint: 'Circumference changes directly with radius.',
      },
      {
        prompt: 'A circle has radius 3. What is its area in terms of π?',
        type: 'answer',
        acceptedAnswers: ['9π', '9pi', '9*pi', '9 pi'],
        feedbackCorrect: 'Correct! A = πr² = π(3²) = 9π.',
        feedbackIncorrect: 'Square the radius: A = π(3²) = 9π.',
      },
      {
        prompt: 'If a circle radius is multiplied by 3, by what factor does its area change?',
        type: 'predict',
        acceptedAnswers: ['9', 'factor 9', '9 times', 'times 9'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Area depends on r², so the factor is 3² = 9.',
        feedbackIncorrect: 'Area scales with the square of the radius factor: 3² = 9.',
      },
      {
        prompt: 'Extension: a circle has area 36π. What is its circumference in terms of π?',
        type: 'answer',
        acceptedAnswers: ['12π', '12pi', '12*pi', '12 pi'],
        feedbackCorrect: 'Correct! πr² = 36π gives r = 6, so C = 2π(6) = 12π.',
        feedbackIncorrect: 'Work backwards from the area: r² = 36 so r = 6, then C = 2πr = 12π.',
        hint: 'Recover the radius from the area before using the circumference rule.',
        tier: 'extension',
      },
    ],
  },

  'geometry-pythagoras': {
    id: 'geometry-pythagoras',
    topicIds: ["AC9M8M06"],
    tab: 'geometry',
    title: 'Pythagoras in Right Triangles',
    objective: 'Choose the hypotenuse and use a² + b² = c² to find missing lengths.',
    level: 'junior',
    strand: 'measurement-geometry',
    band: '9-10',
    steps: [
      {
        prompt: 'A right triangle has perpendicular sides 6 and 8. Find the hypotenuse.',
        type: 'answer',
        acceptedAnswers: ['10'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! √(6² + 8²) = √100 = 10.',
        feedbackIncorrect: 'The hypotenuse is √(36 + 64) = 10.',
        hint: 'The hypotenuse is opposite the right angle.',
      },
      {
        prompt: 'A right triangle has hypotenuse 13 and one shorter side 5. Find the other side.',
        type: 'answer',
        acceptedAnswers: ['12'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! √(13² − 5²) = √144 = 12.',
        feedbackIncorrect: 'Rearrange: b² = 13² − 5² = 144, so b = 12.',
      },
      {
        prompt: 'Do side lengths 7, 24 and 25 form a right triangle? Answer yes or no.',
        type: 'predict',
        acceptedAnswers: ['yes', 'y'],
        feedbackCorrect: 'Correct! 7² + 24² = 49 + 576 = 625 = 25².',
        feedbackIncorrect: 'Check the largest side: 7² + 24² equals 25², so it is right-angled.',
      },
      {
        prompt: 'Extension: an isosceles triangle has two equal sides of 13 and a base of 10. What is its perpendicular height?',
        type: 'answer',
        acceptedAnswers: ['12'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The height splits the base into two 5s, so h = √(13² − 5²) = 12.',
        feedbackIncorrect: 'The perpendicular height bisects the base, giving a right triangle with hypotenuse 13 and one side 5, so h = 12.',
        hint: 'There is no right angle yet — draw the height first and see what it does to the base.',
        tier: 'extension',
      },
    ],
  },

  'geometry-sohcahtoa': {
    id: 'geometry-sohcahtoa',
    topicIds: ["AC9M9M03"],
    tab: 'geometry',
    title: 'Choose SOHCAHTOA',
    objective: 'Identify opposite, adjacent and hypotenuse, then select and apply the correct trigonometric ratio.',
    level: 'junior',
    strand: 'trigonometry',
    band: '9-10',
    steps: [
      {
        prompt: 'Which ratio uses opposite and hypotenuse: sine, cosine or tangent?',
        type: 'predict',
        acceptedAnswers: ['sine', 'sin', 'soh'],
        feedbackCorrect: 'Correct! SOH means sin θ = opposite/hypotenuse.',
        feedbackIncorrect: 'SOH: sine uses opposite divided by hypotenuse.',
        hint: 'Recall SOH–CAH–TOA.',
      },
      {
        prompt: 'For a right triangle, opposite = 6 and hypotenuse = 10. Find sin θ.',
        type: 'answer',
        acceptedAnswers: ['0.6', '3/5'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! sin θ = 6/10 = 3/5 = 0.6.',
        feedbackIncorrect: 'Use opposite/hypotenuse: 6/10 = 0.6.',
      },
      {
        prompt: 'A right triangle has opposite = 5 and adjacent = 5. What is θ in degrees?',
        type: 'answer',
        acceptedAnswers: ['45', '45°', '45 degrees'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! tan θ = 5/5 = 1, so θ = 45°.',
        feedbackIncorrect: 'Use tangent: θ = tan⁻¹(1) = 45°.',
      },
      {
        prompt: 'Extension: a 6.5 m ladder rests against a wall and reaches 6 m up it. What angle does the ladder make with the ground, to the nearest degree?',
        type: 'answer',
        acceptedAnswers: ['67', '67°', '67 degrees'],
        tolerance: 0.5,
        feedbackCorrect: 'Correct! sin θ = 6/6.5, so θ = sin⁻¹(0.923) ≈ 67°.',
        feedbackIncorrect: 'The wall height is opposite the angle and the ladder is the hypotenuse: θ = sin⁻¹(6/6.5) ≈ 67°.',
        hint: 'Decide which two sides you were given before choosing the ratio, then use the inverse function.',
        tier: 'extension',
      },
    ],
  },

  'geometry-unit-circle': {
    id: 'geometry-unit-circle',
    topicIds: ["QCAA_METHODS_U1_T4", "QCAA_METHODS_U4_T2", "QCAA_SPECIALIST_U2_T4"],
    tab: 'geometry',
    title: 'Unit Circle to Trig Graphs',
    objective: 'Link a rotating unit-circle point to cosine, sine and their graph coordinates.',
    level: 'senior',
    strand: 'trigonometry',
    band: 'senior',
    steps: [
      {
        prompt: 'At θ = π/2, what is the unit-circle point? Enter x, y.',
        type: 'predict',
        acceptedAnswers: ['0, 1', '(0, 1)', '0,1', '(0,1)'],
        feedbackCorrect: 'Correct! (cos(π/2), sin(π/2)) = (0, 1).',
        feedbackIncorrect: 'Cosine is the x-coordinate and sine is the y-coordinate, giving (0,1).',
      },
      {
        prompt: 'What is cos π?',
        type: 'answer',
        acceptedAnswers: ['-1'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! At π radians the point is (-1,0), so cosine is -1.',
        feedbackIncorrect: 'At the left side of the unit circle, x = cos π = -1.',
      },
      {
        prompt: 'Is sin θ positive or negative in Quadrant III?',
        type: 'predict',
        acceptedAnswers: ['negative', 'negative sign', '-'],
        feedbackCorrect: 'Correct! The y-coordinate is negative in Quadrant III.',
        feedbackIncorrect: 'Sine is the y-coordinate, which is below zero in Quadrant III.',
      },
      {
        prompt: 'Extension: how many solutions does sin θ = 0.5 have for 0 ≤ θ ≤ 4π?',
        type: 'answer',
        acceptedAnswers: ['4'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! Each turn of the circle crosses the height 0.5 twice, and 4π is two full turns, so there are 4 solutions.',
        feedbackIncorrect: 'In one revolution sine takes the value 0.5 twice (in Quadrants I and II). Two revolutions therefore give 4 solutions.',
        hint: 'Count how many times the rotating point reaches that height in a single turn, then scale up.',
        tier: 'extension',
      },
    ],
  },

  // ─── P4 Statistics and Probability ────────────────────────────────────
  'statistics-distribution-shape': {
    id: 'statistics-distribution-shape',
    topicIds: ["AC9M7ST01", "AC9M7ST02", "AC9M8ST02", "AC9M9ST03"],
    tab: 'statistics',
    title: 'Shape, Centre and Outliers',
    objective: 'Compare mean, median and distribution shape while moving or adding data values.',
    level: 'junior',
    strand: 'statistics-probability',
    band: '7-8',
    steps: [
      {
        prompt: 'For the data 2, 3, 3, 4, 8, what is the mean?',
        type: 'answer',
        acceptedAnswers: ['4'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The total is 20 and 20 ÷ 5 = 4.',
        feedbackIncorrect: 'Add the values to get 20, then divide by 5.',
      },
      {
        prompt: 'For the same data, what is the median?',
        type: 'answer',
        acceptedAnswers: ['3'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The middle ordered value is 3.',
        feedbackIncorrect: 'The ordered list has five values, so use the third value.',
      },
      {
        prompt: 'If the value 8 is replaced by 20, which changes more: mean or median?',
        type: 'predict',
        acceptedAnswers: ['mean', 'the mean'],
        feedbackCorrect: 'Correct! The outlier pulls the mean upward while the median stays 3.',
        feedbackIncorrect: 'Extreme values affect the mean much more than the median.',
      },
      {
        prompt: 'Extension: what sixth value must be added to 2, 3, 3, 4, 8 to make the mean exactly 5?',
        type: 'answer',
        acceptedAnswers: ['10'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Six values with mean 5 must total 30, and the current total is 20, so the new value is 10.',
        feedbackIncorrect: 'A mean of 5 across six values needs a total of 30. The existing five sum to 20, so add 10.',
        hint: 'Work with the total rather than the mean.',
        tier: 'extension',
      },
    ],
  },

  'statistics-normal-zscore': {
    id: 'statistics-normal-zscore',
    topicIds: ["QCAA_METHODS_U4_T3"],
    tab: 'statistics',
    title: 'Normal Distribution and z-Scores',
    objective: 'Interpret mean, standard deviation, z-scores and shaded probability regions.',
    level: 'senior',
    strand: 'statistics-probability',
    band: 'senior',
    steps: [
      {
        prompt: 'For a normal model with μ = 60 and σ = 5, what is the z-score of x = 70?',
        type: 'answer',
        acceptedAnswers: ['2', '2.0'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! z = (70 − 60)/5 = 2.',
        feedbackIncorrect: 'Use z = (x − μ)/σ = 10/5 = 2.',
      },
      {
        prompt: 'Approximately what percentage of a normal distribution lies within one standard deviation of the mean?',
        type: 'answer',
        acceptedAnswers: ['68', '68%', 'about 68%', 'approximately 68%'],
        tolerance: 0.5,
        feedbackCorrect: 'Correct! The empirical rule gives about 68%.',
        feedbackIncorrect: 'The 68–95–99.7 rule gives about 68% within μ ± σ.',
      },
      {
        prompt: 'If x is below the mean, is its z-score positive, zero or negative?',
        type: 'predict',
        acceptedAnswers: ['negative', 'less than zero', '<0'],
        feedbackCorrect: 'Correct! x − μ is negative when x is below the mean.',
        feedbackIncorrect: 'Below the mean means x − μ < 0, so z is negative.',
      },
      {
        prompt: 'Extension: for μ = 60 and σ = 5, roughly what percentage of values lie between 55 and 70?',
        type: 'answer',
        acceptedAnswers: ['81.5', '81.5%', 'about 81.5%'],
        tolerance: 0.5,
        feedbackCorrect: 'Correct! 55 is μ − σ and 70 is μ + 2σ, so the area is 68/2 + 95/2 = 34 + 47.5 = 81.5%.',
        feedbackIncorrect: 'The interval is unbalanced: one standard deviation below (34%) plus two above (47.5%) gives about 81.5%.',
        hint: 'Convert both endpoints to z-scores; they are not symmetric, so halve each empirical-rule band separately.',
        tier: 'extension',
      },
    ],
  },

  'statistics-probability-simulation': {
    id: 'statistics-probability-simulation',
    topicIds: ["AC9M7P02", "AC9M8P03", "AC9M9P03"],
    tab: 'statistics',
    title: 'Probability: Exact Results and Simulations',
    objective: 'Run repeated trials and compare the experimental results with exact probabilities.',
    level: 'junior',
    strand: 'statistics-probability',
    band: '7-8',
    steps: [
      {
        prompt: 'For 100 fair coin tosses, what is the expected number of heads?',
        type: 'answer',
        acceptedAnswers: ['50'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Expected count = np = 100 × 0.5 = 50.',
        feedbackIncorrect: 'Multiply the number of trials by the probability of heads.',
      },
      {
        prompt: 'If P(rain) = 0.3, what is P(no rain)?',
        type: 'answer',
        acceptedAnswers: ['0.7', '70%', '7/10'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Complementary probabilities sum to 1.',
        feedbackIncorrect: 'P(no rain) = 1 − 0.3 = 0.7.',
      },
      {
        prompt: 'What is the probability of two heads in two independent fair tosses?',
        type: 'answer',
        acceptedAnswers: ['0.25', '1/4', '25%'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! 1/2 × 1/2 = 1/4.',
        feedbackIncorrect: 'Multiply the independent probabilities: 0.5 × 0.5 = 0.25.',
      },
      {
        prompt: 'Extension: a fair coin is tossed 4 times. What is the probability of getting at least one head? Give it as a fraction.',
        type: 'answer',
        acceptedAnswers: ['15/16', '0.9375'],
        tolerance: 0.001,
        equivalence: {},
        feedbackCorrect: 'Correct! P(no heads) = (1/2)⁴ = 1/16, so P(at least one head) = 1 − 1/16 = 15/16.',
        feedbackIncorrect: 'Use the complement: the only excluded outcome is four tails, with probability 1/16, so the answer is 15/16.',
        hint: 'Listing all 16 outcomes is slow. Which single outcome are you excluding?',
        tier: 'extension',
      },
    ],
  },

  'statistics-scatter-regression': {
    id: 'statistics-scatter-regression',
    topicIds: ["AC9M10ST03"],
    tab: 'statistics',
    title: 'Scatterplots and Regression',
    objective: 'Describe association, fit a trend line and distinguish prediction from causation.',
    level: 'junior',
    strand: 'statistics-probability',
    band: '9-10',
    steps: [
      {
        prompt: 'If y generally increases as x increases, is the association positive or negative?',
        type: 'predict',
        acceptedAnswers: ['positive', 'positive association', 'positive correlation'],
        feedbackCorrect: 'Correct! The variables move upward together.',
        feedbackIncorrect: 'An upward trend from left to right is a positive association.',
      },
      {
        prompt: 'A fitted line is y = 2x + 1. Predict y when x = 4.',
        type: 'answer',
        acceptedAnswers: ['9'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! y = 2(4) + 1 = 9.',
        feedbackIncorrect: 'Substitute x = 4 into the fitted line.',
      },
      {
        prompt: 'Does a strong correlation by itself prove causation? Answer yes or no.',
        type: 'predict',
        acceptedAnswers: ['no', 'n'],
        feedbackCorrect: 'Correct! Association alone does not establish a causal mechanism.',
        feedbackIncorrect: 'Correlation can arise from confounding or coincidence; it does not prove causation.',
      },
      {
        prompt: 'Extension: a least-squares line has gradient 2 and the data have means x̄ = 4 and ȳ = 9. What is its y-intercept?',
        type: 'answer',
        acceptedAnswers: ['1'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The least-squares line always passes through (x̄, ȳ), so 9 = 2(4) + c gives c = 1.',
        feedbackIncorrect: 'The least-squares line passes through the mean point (4, 9). Substituting gives 9 = 8 + c, so c = 1.',
        hint: 'There is one point every least-squares line is guaranteed to pass through.',
        tier: 'extension',
      },
    ],
  },

  // ─── P5 S6-J Statistics (box-plot, tree/two-way) ──────────────────────
  'statistics-box-plot': {
    id: 'statistics-box-plot',
    topicIds: ["AC9M9ST03"],
    tab: 'statistics',
    title: 'Box Plot and Five-Number Summary',
    objective: 'Identify the five-number summary (min, Q1, median, Q3, max) and read a box-and-whisker plot.',
    level: 'junior',
    strand: 'statistics-probability',
    band: '9-10',
    steps: [
      {
        prompt: 'For the data 3, 5, 7, 8, 12, 14, 16, what is the median?',
        type: 'answer',
        acceptedAnswers: ['8'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The middle (4th) value in 7 ordered data points is 8.',
        feedbackIncorrect: 'With 7 values, the median is the 4th value in order: 8.',
        hint: 'Arrange in order and pick the middle value.',
      },
      {
        prompt: 'For the same data, what is Q1 (the lower quartile)?',
        type: 'answer',
        acceptedAnswers: ['5'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Q1 is the median of the lower half {3, 5, 7}, which is 5.',
        feedbackIncorrect: 'The lower half is {3, 5, 7}. The median of that subset is 5.',
        hint: 'Q1 is the median of the values below the overall median.',
      },
      {
        prompt: 'What is the interquartile range (IQR = Q3 − Q1) for this data?',
        type: 'answer',
        acceptedAnswers: ['9'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Q3 = 14, Q1 = 5, so IQR = 14 − 5 = 9.',
        feedbackIncorrect: 'Q3 is the median of {12, 14, 16} = 14. IQR = 14 − 5 = 9.',
        hint: 'Find Q3 first (median of the upper half), then subtract Q1.',
      },
      {
        prompt: 'Extension: using Q1 = 5 and Q3 = 14, above what value would a data point be flagged as an outlier by the 1.5 × IQR rule?',
        type: 'answer',
        acceptedAnswers: ['27.5'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The upper fence is Q3 + 1.5 × IQR = 14 + 1.5(9) = 27.5.',
        feedbackIncorrect: 'The upper fence is Q3 + 1.5 × IQR. With IQR = 9 that is 14 + 13.5 = 27.5.',
        hint: 'The fence is measured from the quartile, not from the median or the maximum.',
        tier: 'extension',
      },
    ],
  },

  'statistics-tree-two-way': {
    id: 'statistics-tree-two-way',
    topicIds: ["AC9M8P02", "AC9M9P01", "AC9M10ST04"],
    tab: 'statistics',
    title: 'Tree Diagrams and Two-Way Tables',
    objective: 'Use tree diagrams and two-way frequency tables to calculate compound probabilities.',
    level: 'junior',
    strand: 'statistics-probability',
    band: '9-10',
    steps: [
      {
        prompt: 'A bag has 3 red and 2 blue marbles. One marble is drawn and not replaced, then another is drawn. What is P(both red)? Give as a fraction.',
        type: 'answer',
        acceptedAnswers: ['3/10', '6/20', '0.3'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! P(RR) = 3/5 × 2/4 = 6/20 = 3/10.',
        feedbackIncorrect: 'First draw: P(R) = 3/5. Second draw (without replacement): P(R) = 2/4. Multiply: 3/5 × 2/4 = 3/10.',
        hint: 'Multiply the probabilities along the branch: P(first) × P(second|first).',
      },
      {
        prompt: 'In a two-way table, 40 students: 15 play sport AND study music, 25 play sport total, 20 study music total. How many do neither?',
        type: 'answer',
        acceptedAnswers: ['10'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Sport only = 10, Music only = 5, Both = 15, Neither = 40 − 30 = 10.',
        feedbackIncorrect: 'Use inclusion-exclusion: Sport∪Music = 25 + 20 − 15 = 30. Neither = 40 − 30 = 10.',
        hint: 'Total in at least one = A + B − Both. Subtract from the grand total.',
      },
      {
        prompt: 'From that table, what is P(studies music | plays sport)? Give as a fraction.',
        type: 'answer',
        acceptedAnswers: ['3/5', '15/25', '0.6'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! P(Music|Sport) = 15/25 = 3/5.',
        feedbackIncorrect: 'Conditional probability: P(M|S) = P(M∩S)/P(S) = 15/25 = 3/5.',
        hint: 'Divide the joint count by the row/column total for the condition.',
      },
      {
        prompt: 'Extension: from the same bag of 3 red and 2 blue marbles, two are drawn without replacement. What is P(at least one blue)? Give it as a fraction.',
        type: 'answer',
        acceptedAnswers: ['7/10', '0.7'],
        tolerance: 0.001,
        equivalence: {},
        feedbackCorrect: 'Correct! P(no blue) = P(both red) = 3/10, so P(at least one blue) = 1 − 3/10 = 7/10.',
        feedbackIncorrect: 'Use the complement of the branch you already calculated: 1 − P(both red) = 1 − 3/10 = 7/10.',
        hint: 'You already know P(both red). What is the complement of "at least one blue"?',
        tier: 'extension',
      },
    ],
  },

  // ─── P4 Vectors, Matrices and Complex Plane ───────────────────────────
  'linear-vector-resultant': {
    id: 'linear-vector-resultant',
    topicIds: ["QCAA_SPECIALIST_U1_T3", "QCAA_SPECIALIST_U1_T4"],
    tab: 'linear-algebra',
    title: '2D Vectors and Resultants',
    objective: 'Add vectors component by component, then read the resultant vector’s length and direction.',
    level: 'senior',
    strand: 'vectors-matrices-complex',
    band: 'senior',
    steps: [
      {
        prompt: 'What is the magnitude of the vector (3, 4)?',
        type: 'answer',
        acceptedAnswers: ['5'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! |v| = √(3² + 4²) = 5.',
        feedbackIncorrect: 'Use Pythagoras on the components.',
      },
      {
        prompt: 'Add (2, -1) and (-5, 3). Enter x, y.',
        type: 'answer',
        acceptedAnswers: ['-3, 2', '(-3, 2)', '-3,2', '(-3,2)'],
        feedbackCorrect: 'Correct! Add matching components to get (-3, 2).',
        feedbackIncorrect: '(2 + -5, -1 + 3) = (-3, 2).',
      },
      {
        prompt: 'What is the direction angle of the vector (0, 4), measured anticlockwise from positive x?',
        type: 'answer',
        acceptedAnswers: ['90', '90°', '90 degrees', 'π/2'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! The vector points straight up at 90°.',
        feedbackIncorrect: 'The positive y-axis is 90° anticlockwise from positive x.',
      },
      {
        prompt: 'Extension: find k so that a = (3, 4) and b = (k, 6) are perpendicular.',
        type: 'answer',
        acceptedAnswers: ['-8'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Perpendicular vectors have a zero dot product: 3k + 24 = 0, so k = −8.',
        feedbackIncorrect: 'Set the dot product to zero: 3k + 4(6) = 0, giving k = −8.',
        hint: 'What is true of the dot product of two perpendicular vectors?',
        tier: 'extension',
      },
    ],
  },

  'linear-matrix-transform': {
    id: 'linear-matrix-transform',
    topicIds: ["QCAA_SPECIALIST_U1_T5", "QCAA_SPECIALIST_U2_T5"],
    tab: 'linear-algebra',
    title: 'Matrix Transformations',
    objective: 'Apply 2×2 matrices to points and interpret rotation, stretching and area scale.',
    level: 'senior',
    strand: 'vectors-matrices-complex',
    band: 'senior',
    steps: [
      {
        prompt: 'Apply [[2,0],[0,1]] to the point (3,2). What is the image?',
        type: 'answer',
        acceptedAnswers: ['6, 2', '(6, 2)', '6,2', '(6,2)'],
        feedbackCorrect: 'Correct! x is doubled while y is unchanged.',
        feedbackIncorrect: '(2×3 + 0×2, 0×3 + 1×2) = (6,2).',
      },
      {
        prompt: 'Apply [[0,-1],[1,0]] to (2,1). What is the image?',
        type: 'answer',
        acceptedAnswers: ['-1, 2', '(-1, 2)', '-1,2', '(-1,2)'],
        feedbackCorrect: 'Correct! This matrix rotates 90° anticlockwise.',
        feedbackIncorrect: '(0×2 − 1×1, 1×2 + 0×1) = (-1,2).',
      },
      {
        prompt: 'What area scale factor is produced by [[2,0],[0,3]]?',
        type: 'answer',
        acceptedAnswers: ['6'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The determinant is 2×3 = 6.',
        feedbackIncorrect: 'Area scale is |det A| = |2×3 − 0| = 6.',
      },
      {
        prompt: 'Extension: for which value of k does the matrix [[2,3],[4,k]] squash the whole plane onto a single line?',
        type: 'answer',
        acceptedAnswers: ['6'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Collapsing to a line means zero area scale: det = 2k − 12 = 0, so k = 6.',
        feedbackIncorrect: 'A transformation collapses the plane when its determinant is zero: 2k − 12 = 0, so k = 6.',
        hint: 'Relate "no area left" to the quantity that measures area change.',
        tier: 'extension',
      },
    ],
  },

  'linear-complex-plane': {
    id: 'linear-complex-plane',
    topicIds: ["QCAA_SPECIALIST_U2_T1"],
    tab: 'linear-algebra',
    title: 'Complex Numbers as Points and Vectors',
    objective: 'Plot a complex number as a point: its modulus is the distance from the origin and its argument is the direction angle.',
    level: 'senior',
    strand: 'vectors-matrices-complex',
    band: 'senior',
    steps: [
      {
        prompt: 'What is the modulus of z = 3 + 4i?',
        type: 'answer',
        acceptedAnswers: ['5'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! |z| = √(3² + 4²) = 5.',
        feedbackIncorrect: 'The modulus is the distance from the origin.',
      },
      {
        prompt: 'Simplify (1 + 2i) + (3 − i).',
        type: 'answer',
        acceptedAnswers: ['4+i', '4 + i', '4+1i', '4 + 1i'],
        feedbackCorrect: 'Correct! Add real and imaginary parts separately to get 4 + i.',
        feedbackIncorrect: 'Real parts give 4 and imaginary parts give i.',
      },
      {
        prompt: 'Multiplying a non-zero complex number by i rotates it by how many degrees anticlockwise?',
        type: 'answer',
        acceptedAnswers: ['90', '90°', '90 degrees'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! i has argument 90°, so arguments increase by 90°.',
        feedbackIncorrect: 'Multiplication adds arguments; arg(i) = 90°.',
      },
      {
        prompt: 'Extension: give the exact modulus of (3 + 4i)(1 + i).',
        type: 'answer',
        acceptedAnswers: ['5√2', '5*sqrt(2)', 'sqrt(50)', '7.0711'],
        tolerance: 0.01,
        equivalence: {},
        feedbackCorrect: 'Correct! Moduli multiply: |3 + 4i| × |1 + i| = 5 × √2 = 5√2 ≈ 7.07.',
        feedbackIncorrect: 'You do not need to expand the product — moduli multiply, so the answer is 5 × √2 = 5√2.',
        hint: 'There is a shortcut that avoids expanding the brackets.',
        tier: 'extension',
      },
    ],
  },

  // ─── P5 S6-J Sandbox (distance-time) ──────────────────────────────────
  'sandbox-distance-time': {
    id: 'sandbox-distance-time',
    topicIds: ["AC9M7A04", "AC9M8M05", "AC9M9A03"],
    tab: 'sandbox',
    title: 'Distance–Time Graphs and Average Speed',
    objective: 'Read a distance–time graph segment, calculate average speed, and identify rest intervals.',
    level: 'junior',
    strand: 'functions-graphs',
    band: '9-10',
    steps: [
      {
        prompt: 'A cyclist travels 30 km in 2 hours (constant speed). What is the average speed in km/h?',
        type: 'answer',
        acceptedAnswers: ['15', '15 km/h'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! Average speed = distance ÷ time = 30 ÷ 2 = 15 km/h.',
        feedbackIncorrect: 'Average speed = total distance ÷ total time = 30/2 = 15 km/h.',
        hint: 'Speed = distance ÷ time.',
      },
      {
        prompt: 'On a distance–time graph, a flat (horizontal) segment means the object is doing what?',
        type: 'predict',
        acceptedAnswers: ['stationary', 'at rest', 'not moving', 'stopped', 'rest'],
        feedbackCorrect: 'Correct! A horizontal segment means zero speed — the object is stationary.',
        feedbackIncorrect: 'A horizontal line means distance is not changing, so the object is stationary (at rest).',
        hint: 'If distance does not change over time, there is no movement.',
      },
      {
        prompt: 'A car travels 40 km in the first hour, rests for 30 minutes, then travels 20 km in 30 minutes. What is the average speed for the whole journey in km/h?',
        type: 'answer',
        acceptedAnswers: ['30'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! Total distance = 60 km, total time = 2 hours. Average speed = 60/2 = 30 km/h.',
        feedbackIncorrect: 'Total distance = 40 + 20 = 60 km. Total time = 1 + 0.5 + 0.5 = 2 h. Speed = 60/2 = 30 km/h.',
        hint: 'Include rest time in the total time for average speed.',
      },
      {
        prompt: 'Extension: a cyclist rides 12 km at 24 km/h and then another 12 km at 8 km/h. What is the average speed for the whole ride in km/h?',
        type: 'answer',
        acceptedAnswers: ['12'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! The legs take 0.5 h and 1.5 h, so 24 km ÷ 2 h = 12 km/h — not the average of 24 and 8.',
        feedbackIncorrect: 'Average speed uses totals: 24 km over (0.5 + 1.5) = 2 h gives 12 km/h. Averaging the two speeds would give 16 km/h, which is wrong.',
        hint: 'Equal distances do not take equal times. Find each time first.',
        tier: 'extension',
      },
    ],
  },

  // ─── P4 Polar and Parametric Curves ───────────────────────────────────
  'sandbox-polar-curves': {
    id: 'sandbox-polar-curves',
    topicIds: ["QCAA_METHODS_U1_T3"],
    tab: 'sandbox',
    title: 'Polar Curves',
    objective: 'Change the angle and watch the radius trace a heart-shaped cardioid, a spiral and a figure-eight lemniscate.',
    level: 'senior',
    strand: 'functions-graphs',
    band: 'senior',
    steps: [
      {
        prompt: 'For the cardioid r = a(1 + cos θ), what is r when θ = π?',
        type: 'answer',
        acceptedAnswers: ['0', 'zero'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! cos π = −1, so r = a(1 − 1) = 0: the cardioid reaches its cusp at the pole.',
        feedbackIncorrect: 'Substitute θ = π: r = a(1 + cos π) = a(1 − 1) = 0.',
      },
      {
        prompt: 'For the Archimedean spiral r = aθ/(2π), what is r/a when θ = 2π?',
        type: 'answer',
        acceptedAnswers: ['1', '1.0'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! At θ = 2π, r/a = 2π/(2π) = 1, so one turn reaches radius a.',
        feedbackIncorrect: 'Substitute θ = 2π: r/a = (2π)/(2π) = 1.',
      },
      {
        prompt: 'The lemniscate r² = a² cos(2θ) has two loops. Which axis joins the centres of the loops?',
        type: 'predict',
        acceptedAnswers: ['x-axis', 'x axis', 'horizontal axis'],
        feedbackCorrect: 'Correct! The cos(2θ) symmetry places the two loops on the horizontal x-axis.',
        feedbackIncorrect: 'The loops lie to the left and right of the pole, so their centres lie on the x-axis.',
      },
      {
        prompt: 'Extension: for the lemniscate r² = a² cos(2θ), what is the largest θ in [0, π/2] at which the curve exists?',
        type: 'answer',
        acceptedAnswers: ['π/4', 'pi/4', '45°', '0.7854'],
        tolerance: 0.001,
        equivalence: {},
        feedbackCorrect: 'Correct! r² cannot be negative, so cos(2θ) ≥ 0 requires 2θ ≤ π/2, giving θ ≤ π/4.',
        feedbackIncorrect: 'r² ≥ 0 forces cos(2θ) ≥ 0, so 2θ ≤ π/2 and the curve stops at θ = π/4.',
        hint: 'Ask which values of θ make the right-hand side impossible for a squared quantity.',
        tier: 'extension',
      },
    ],
  },

  'sandbox-parametric-curves': {
    id: 'sandbox-parametric-curves',
    topicIds: ["QCAA_METHODS_U1_T3"],
    tab: 'sandbox',
    title: 'Parametric Curves',
    objective: 'Change the parameter t and watch x(t) and y(t) move one point along a path, then connect that motion to gradient.',
    level: 'senior',
    strand: 'functions-graphs',
    band: 'senior',
    steps: [
      {
        prompt: 'What shape is traced by x = cos t, y = sin t for 0 ≤ t ≤ 2π?',
        type: 'predict',
        acceptedAnswers: ['circle', 'unit circle', 'a circle'],
        feedbackCorrect: 'Correct! x² + y² = cos²t + sin²t = 1.',
        feedbackIncorrect: 'Eliminate t using cos²t + sin²t = 1.',
      },
      {
        prompt: 'For x = 2t and y = t, what is dy/dx?',
        type: 'answer',
        acceptedAnswers: ['1/2', '0.5'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! (dy/dt)/(dx/dt) = 1/2.',
        feedbackIncorrect: 'dy/dt = 1 and dx/dt = 2, so dy/dx = 1/2.',
      },
      {
        prompt: 'For x = cos t, y = sin t, what point occurs at t = π/2?',
        type: 'answer',
        acceptedAnswers: ['0, 1', '(0, 1)', '0,1', '(0,1)'],
        feedbackCorrect: 'Correct! cos(π/2)=0 and sin(π/2)=1.',
        feedbackIncorrect: 'Substitute t = π/2 into both component rules.',
      },
      {
        prompt: 'Extension: for x = t² and y = t³, give dy/dx in terms of t.',
        type: 'answer',
        acceptedAnswers: ['3t/2'],
        equivalence: { variables: ['t'] },
        feedbackCorrect: 'Correct! dy/dt = 3t² and dx/dt = 2t, so dy/dx = 3t²/(2t) = 3t/2.',
        feedbackIncorrect: 'Divide the component derivatives: dy/dx = (3t²)/(2t) = 3t/2.',
        hint: 'Differentiate each component with respect to t, then combine them.',
        tier: 'extension',
      },
    ],
  },

  // ─── P4 Calculus Extensions ───────────────────────────────────────────
  'calculus-direction-field': {
    id: 'calculus-direction-field',
    topicIds: ["QCAA_SPECIALIST_U4_T3"],
    tab: 'calculus',
    title: 'Direction Fields: Following the Slopes',
    objective: 'Use the small line segments to see local slopes, equilibrium levels and the paths that solutions are likely to follow.',
    level: 'senior',
    strand: 'calculus',
    band: 'senior',
    steps: [
      {
        prompt: 'For dy/dx = y, what is the slope on the line y = 0?',
        type: 'answer',
        acceptedAnswers: ['0', 'zero'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Substituting y = 0 gives slope 0.',
        feedbackIncorrect: 'The slope equals y, so it is zero along the x-axis.',
      },
      {
        prompt: 'For dy/dx = y, what is the slope at (0, 2)?',
        type: 'answer',
        acceptedAnswers: ['2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The rule depends only on y, giving slope 2.',
        feedbackIncorrect: 'Substitute y = 2 into dy/dx = y.',
      },
      {
        prompt: 'For dP/dt = P(1 − P/4), which positive value of P is an equilibrium?',
        type: 'answer',
        acceptedAnswers: ['4'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! At P = 4 the factor (1 − P/4) is zero.',
        feedbackIncorrect: 'Set P(1 − P/4) = 0; the positive equilibrium is 4.',
      },
      {
        prompt: 'Extension: for dP/dt = P(1 − P/4), at which positive P is the population growing fastest?',
        type: 'answer',
        acceptedAnswers: ['2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! dP/dt = P − P²/4 is a downward parabola in P with maximum at P = 2 — the point of inflection of the solution curve.',
        feedbackIncorrect: 'Maximise the growth rate itself: dP/dt = P − P²/4 peaks halfway to the carrying capacity, at P = 2.',
        hint: 'Treat the growth rate as a function of P and find where that function is largest.',
        tier: 'extension',
      },
    ],
  },

  'calculus-kinematics-links': {
    id: 'calculus-kinematics-links',
    topicIds: ["QCAA_SPECIALIST_U4_T4"],
    tab: 'calculus',
    title: 'Position, Velocity and Acceleration',
    objective: 'Link position, velocity and acceleration graphs through differentiation.',
    level: 'senior',
    strand: 'calculus',
    band: 'senior',
    steps: [
      {
        prompt: 'If position is s(t) = t², what is velocity v(t)? Give your answer as a formula in t.',
        type: 'answer',
        acceptedAnswers: ['2t', '2*t', 'v=2t', 'v(t)=2t'],
        equivalence: { variables: ['t'] },
        feedbackCorrect: 'Correct! Velocity is ds/dt = 2t.',
        feedbackIncorrect: 'Differentiate t² using the power rule.',
      },
      {
        prompt: 'For s(t) = t², what is the velocity at t = 3?',
        type: 'answer',
        acceptedAnswers: ['6'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! v(3) = 2(3) = 6.',
        feedbackIncorrect: 'Use v(t)=2t and substitute t=3.',
      },
      {
        prompt: 'For s(t) = t², what is the constant acceleration?',
        type: 'answer',
        acceptedAnswers: ['2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! a(t) = dv/dt = 2.',
        feedbackIncorrect: 'Differentiate v(t)=2t once more.',
      },
      {
        prompt: 'Extension: for s(t) = t³ − 6t² + 9t, at what time does the particle change direction for the second time?',
        type: 'answer',
        acceptedAnswers: ['3'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! v(t) = 3t² − 12t + 9 = 3(t − 1)(t − 3), so velocity changes sign at t = 1 and again at t = 3.',
        feedbackIncorrect: 'Direction changes where velocity changes sign: 3(t − 1)(t − 3) = 0 gives t = 1 then t = 3.',
        hint: 'Changing direction means the velocity changes sign, not just that acceleration is zero.',
        tier: 'extension',
      },
    ],
  },

  'calculus-numerical-methods': {
    id: 'calculus-numerical-methods',
    topicIds: ["QCAA_METHODS_U2_T3"],
    tab: 'calculus',
    title: 'Numerical Methods: Estimating Roots and Areas',
    objective: 'Follow Newton’s method towards a root and add trapezoids to estimate area, while watching the error shrink.',
    level: 'senior',
    strand: 'calculus',
    band: 'senior',
    steps: [
      {
        prompt: 'For f(x)=x²−2, Newton’s method starts at x₀=1. What is x₁?',
        type: 'answer',
        acceptedAnswers: ['1.5', '3/2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! x₁ = 1 − (−1)/2 = 1.5.',
        feedbackIncorrect: 'Use x₁ = x₀ − f(x₀)/f′(x₀).',
        sceneData: { kind: 'numerical-newton', k: 2, x0: 1 },
      },
      {
        prompt: 'Using one trapezoid for y=x² on [0,1], what is the estimate?',
        type: 'answer',
        acceptedAnswers: ['0.5', '1/2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Width 1 times average height (0+1)/2 gives 0.5.',
        feedbackIncorrect: 'Trapezoidal estimate = (b−a)(f(a)+f(b))/2.',
        sceneData: { kind: 'numerical-trapezoid', intervalStart: 0, intervalEnd: 1, partitions: 1 },
      },
      {
        prompt: 'For a smooth curve, does increasing the number of trapezoids generally reduce or increase approximation error?',
        type: 'predict',
        acceptedAnswers: ['reduce', 'decrease', 'reduces', 'decreases', 'smaller'],
        feedbackCorrect: 'Correct! Finer subintervals generally follow the curve more closely.',
        feedbackIncorrect: 'More, narrower trapezoids generally reduce discretisation error for a smooth curve.',
        sceneData: { kind: 'numerical-trapezoid', intervalStart: 0, intervalEnd: 1, partitions: 12 },
      },
      {
        prompt: 'Extension: continuing Newton’s method on f(x) = x² − 2 from x₁ = 3/2, what is x₂ as an exact fraction?',
        type: 'answer',
        acceptedAnswers: ['17/12', '1.4167'],
        tolerance: 0.001,
        equivalence: {},
        feedbackCorrect: 'Correct! x₂ = 3/2 − (9/4 − 2)/3 = 3/2 − 1/12 = 17/12 ≈ 1.4167.',
        feedbackIncorrect: 'x₂ = x₁ − f(x₁)/f′(x₁) = 3/2 − (1/4)/3 = 17/12.',
        hint: 'Keep everything as fractions: f(3/2) = 1/4 and f′(3/2) = 3.',
        sceneData: { kind: 'numerical-newton', k: 2, x0: 1 },
        tier: 'extension',
      },
    ],
  },

  // ─── P2 Concept Connections ───────────────────────────────────────────
  'sandbox-piecewise-absolute': {
    id: 'sandbox-piecewise-absolute',
    topicIds: ["AC9M9A06", "AC9M10A05", "QCAA_METHODS_U1_T3"],
    tab: 'sandbox',
    title: 'Absolute Value: One Rule, Two Lines and a Graph',
    objective: 'Change the rule and watch the vertex, two straight-line sides, value table and graph change together.',
    level: 'junior',
    strand: 'functions-graphs',
    band: '9-10',
    steps: [
      {
        prompt: 'For f(x) = 2|x − 1| − 1, give the vertex as an ordered pair.',
        type: 'answer',
        acceptedAnswers: ['(1,-1)', '(1, -1)', '1,-1', '1, -1'],
        feedbackCorrect: 'Correct! In a|x−h|+k, the vertex is (h,k).',
        feedbackIncorrect: 'Read h and k directly from a|x−h|+k.',
        sceneData: { kind: 'piecewise-absolute', a: 2, h: 1, k: -1, x: 1 },
      },
      {
        prompt: 'For the same function, what is f(3)?',
        type: 'answer',
        acceptedAnswers: ['3'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! 2|3−1|−1 = 3.',
        feedbackIncorrect: 'Substitute x=3 before applying the absolute value.',
        sceneData: { kind: 'piecewise-absolute', a: 2, h: 1, k: -1, x: 3 },
      },
      {
        prompt: 'On the left of the vertex, what is the gradient of f(x) = 2|x − 1| − 1?',
        type: 'answer',
        acceptedAnswers: ['-2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The two branch gradients are −a and a.',
        feedbackIncorrect: 'For x<h, |x−h|=−(x−h), so the gradient is −a.',
        sceneData: { kind: 'piecewise-absolute', a: 2, h: 1, k: -1, x: 0 },
      },
      {
        prompt: 'Extension: write the right-hand linear branch of f(x)=2|x−1|−1 in the form mx+c.',
        type: 'answer',
        acceptedAnswers: ['2x-3', '2*x-3'],
        equivalence: { variables: ['x'] },
        feedbackCorrect: 'Correct! For x≥1, |x−1|=x−1, so f(x)=2x−3.',
        feedbackIncorrect: 'Replace |x−1| with x−1 on the right of the vertex.',
        hint: 'On the right branch, the expression inside the absolute value is non-negative.',
        sceneData: { kind: 'piecewise-absolute', a: 2, h: 1, k: -1, x: 2 },
        tier: 'extension',
      },
    ],
  },

  'calculus-accumulation-link': {
    id: 'calculus-accumulation-link',
    topicIds: ["QCAA_METHODS_U3_T4", "QCAA_METHODS_U4_T1", "QCAA_SPECIALIST_U4_T2"],
    tab: 'calculus',
    title: 'Area, Running Total and Rate',
    objective: 'See how area under a rate graph builds a running total, and how the total graph’s slope matches the current rate.',
    level: 'senior',
    strand: 'calculus',
    band: 'senior',
    steps: [
      {
        prompt: 'Let f(t)=2t+1 and A(x)=∫₀ˣ f(t)dt. What is A(2)?',
        type: 'answer',
        acceptedAnswers: ['6'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! A(2)=[t²+t]₀²=6.',
        feedbackIncorrect: 'Integrate 2t+1 from 0 to 2.',
        sceneData: { kind: 'accumulation-link', m: 2, c: 1, x: 2 },
      },
      {
        prompt: 'For the same functions, what is A′(2)?',
        type: 'answer',
        acceptedAnswers: ['5'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The fundamental theorem gives A′(2)=f(2)=5.',
        feedbackIncorrect: 'The derivative of an accumulation function equals the original rate.',
        sceneData: { kind: 'accumulation-link', m: 2, c: 1, x: 2 },
      },
      {
        prompt: 'If f(x) is negative on an interval, is A increasing or decreasing there?',
        type: 'predict',
        acceptedAnswers: ['decreasing', 'decreases', 'decrease'],
        feedbackCorrect: 'Correct! A′=f, so a negative rate makes A decrease.',
        feedbackIncorrect: 'Use the sign of A′(x)=f(x).',
        sceneData: { kind: 'accumulation-link', m: 1, c: -2, x: 1 },
      },
      {
        prompt: 'Extension: for f(t)=2t+1, give A(x)=∫₀ˣf(t)dt as a formula.',
        type: 'answer',
        acceptedAnswers: ['x^2+x', 'x*x+x'],
        equivalence: { variables: ['x'] },
        feedbackCorrect: 'Correct! Integrating gives A(x)=x²+x.',
        feedbackIncorrect: 'Integrate term by term and use A(0)=0.',
        hint: 'The antiderivative of 2t is t².',
        sceneData: { kind: 'accumulation-link', m: 2, c: 1, x: 3 },
        tier: 'extension',
      },
    ],
  },

  'calculus-function-derivative-link': {
    id: 'calculus-function-derivative-link',
    topicIds: ["QCAA_METHODS_U2_T4", "QCAA_METHODS_U2_T5", "QCAA_METHODS_U3_T1", "QCAA_METHODS_U3_T2", "QCAA_METHODS_U3_T3"],
    tab: 'calculus',
    title: 'How a Graph’s Slope Creates Its Derivative',
    objective: 'Move along a function and use the derivative graph to see where it rises, falls or becomes flat.',
    level: 'senior',
    strand: 'calculus',
    band: 'senior',
    steps: [
      {
        prompt: 'For f(x)=x³−3x, what is f′(0)?',
        type: 'answer',
        acceptedAnswers: ['-3'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! f′(x)=3x²−3, so f′(0)=−3.',
        feedbackIncorrect: 'Differentiate first, then substitute x=0.',
        sceneData: { kind: 'function-derivative-link', a: 1, b: 0, c: -3, d: 0, x: 0 },
      },
      {
        prompt: 'At x=0, is f(x)=x³−3x increasing or decreasing?',
        type: 'predict',
        acceptedAnswers: ['decreasing', 'decreases'],
        feedbackCorrect: 'Correct! f′(0)<0, so f is decreasing.',
        feedbackIncorrect: 'A negative derivative means the original function is decreasing.',
        sceneData: { kind: 'function-derivative-link', a: 1, b: 0, c: -3, d: 0, x: 0 },
      },
      {
        prompt: 'Give the two stationary x-values of f(x)=x³−3x, separated by a comma.',
        type: 'answer',
        acceptedAnswers: ['-1,1', '-1, 1', '1,-1', '1, -1'],
        feedbackCorrect: 'Correct! 3x²−3=0 gives x=−1 and x=1.',
        feedbackIncorrect: 'Set f′(x)=3x²−3 equal to zero.',
        sceneData: { kind: 'function-derivative-link', a: 1, b: 0, c: -3, d: 0, x: 1 },
      },
      {
        prompt: 'Extension: for f(x)=x³−3x, what is f″(2)?',
        type: 'answer',
        acceptedAnswers: ['12'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! f″(x)=6x, so f″(2)=12.',
        feedbackIncorrect: 'Differentiate f′(x)=3x²−3 once more.',
        hint: 'The second derivative is the gradient of the derivative graph.',
        sceneData: { kind: 'function-derivative-link', a: 1, b: 0, c: -3, d: 0, x: 2 },
        tier: 'extension',
      },
    ],
  },

  'statistics-sampling-distribution': {
    id: 'statistics-sampling-distribution',
    topicIds: ["AC9M8ST03", "AC9M9ST01", "QCAA_METHODS_U4_T4", "QCAA_METHODS_U4_T5"],
    tab: 'statistics',
    title: 'Why Larger Samples Vary Less',
    objective: 'Repeat samples and see larger samples cluster more tightly around the true population proportion, giving a narrower confidence interval.',
    level: 'senior',
    strand: 'statistics-probability',
    band: 'senior',
    steps: [
      {
        prompt: 'For population proportion p=0.5 and sample size n=25, what is the standard error of p-hat?',
        type: 'answer',
        acceptedAnswers: ['0.1', '1/10'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! √(0.5×0.5/25)=0.1.',
        feedbackIncorrect: 'Use √(p(1−p)/n).',
        sceneData: { kind: 'sampling-distribution', p: 0.5, sampleSize: 25, repetitions: 80 },
      },
      {
        prompt: 'If n increases from 25 to 100 while p stays 0.5, what is the new standard error?',
        type: 'answer',
        acceptedAnswers: ['0.05', '1/20'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Quadrupling n halves the standard error.',
        feedbackIncorrect: 'Calculate √(0.25/100).',
        sceneData: { kind: 'sampling-distribution', p: 0.5, sampleSize: 100, repetitions: 80 },
      },
      {
        prompt: 'When sample size increases, does a 95% confidence interval generally become wider or narrower?',
        type: 'predict',
        acceptedAnswers: ['narrower', 'more narrow', 'smaller'],
        feedbackCorrect: 'Correct! A smaller standard error produces a narrower interval.',
        feedbackIncorrect: 'Confidence width is proportional to 1/√n.',
        sceneData: { kind: 'sampling-distribution', p: 0.6, sampleSize: 100, repetitions: 80 },
      },
      {
        prompt: 'Extension: by what factor must n increase to halve the standard error?',
        type: 'answer',
        acceptedAnswers: ['4', 'four'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Because SE is proportional to 1/√n, n must be multiplied by 4.',
        feedbackIncorrect: 'Solve 1/√k = 1/2 for the sample-size factor k.',
        hint: 'Square the desired precision factor.',
        sceneData: { kind: 'sampling-distribution', p: 0.5, sampleSize: 100, repetitions: 80 },
        tier: 'extension',
      },
    ],
  },

  'geometry-trig-connections': {
    id: 'geometry-trig-connections',
    topicIds: ["QCAA_METHODS_U1_T4", "QCAA_METHODS_U4_T2", "QCAA_SPECIALIST_U2_T4"],
    tab: 'geometry',
    title: 'From the Unit Circle to a Sine Wave',
    objective: 'Rotate a point on the unit circle and watch its height become a sine wave, then stretch or shift the wave.',
    level: 'senior',
    strand: 'trigonometry',
    band: 'senior',
    steps: [
      {
        prompt: 'What is sin 30°?',
        type: 'answer',
        acceptedAnswers: ['0.5', '1/2'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The unit-circle y-coordinate at 30° is 1/2.',
        feedbackIncorrect: 'Read the y-coordinate of the unit-circle point.',
        sceneData: { kind: 'trig-connections', angleDeg: 30, amplitude: 1, phaseDeg: 0 },
      },
      {
        prompt: 'For y=sin(x−90°), is the sine graph shifted left or right?',
        type: 'predict',
        acceptedAnswers: ['right', 'to the right'],
        feedbackCorrect: 'Correct! Subtracting 90° inside shifts the graph 90° right.',
        feedbackIncorrect: 'Compare y=sin(x−h) with the base sine graph.',
        sceneData: { kind: 'trig-connections', angleDeg: 45, amplitude: 1, phaseDeg: 90 },
      },
      {
        prompt: 'What is the range of y=3sin x?',
        type: 'answer',
        acceptedAnswers: ['[-3,3]', '[-3, 3]', '-3 to 3'],
        feedbackCorrect: 'Correct! Amplitude 3 stretches the range to [−3,3].',
        feedbackIncorrect: 'The sine range [−1,1] is multiplied by the amplitude.',
        sceneData: { kind: 'trig-connections', angleDeg: 90, amplitude: 3, phaseDeg: 0 },
      },
      {
        prompt: 'Extension: at which x-value does y=sin(x−90°) first reach its maximum for x≥0?',
        type: 'answer',
        acceptedAnswers: ['180', '180°', '180 degrees', 'pi', 'π'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! The base maximum at 90° shifts right to 180°.',
        feedbackIncorrect: 'Shift the base sine maximum x=90° right by another 90°.',
        hint: 'A horizontal phase shift moves every key x-coordinate.',
        sceneData: { kind: 'trig-connections', angleDeg: 90, amplitude: 1, phaseDeg: 90 },
        tier: 'extension',
      },
    ],
  },

  'linear-complex-multiplication': {
    id: 'linear-complex-multiplication',
    topicIds: ["QCAA_SPECIALIST_U2_T1", "QCAA_SPECIALIST_U2_T2", "QCAA_SPECIALIST_U3_T1"],
    tab: 'linear-algebra',
    title: 'Complex Multiplication: Turn and Stretch',
    objective: 'Watch multiplication by w turn z through an angle and stretch its distance from the origin.',
    level: 'senior',
    strand: 'vectors-matrices-complex',
    band: 'senior',
    steps: [
      {
        prompt: 'Calculate (1+i)(1+i). Give the result in a+bi form.',
        type: 'answer',
        acceptedAnswers: ['2i', '0+2i', '0 + 2i'],
        feedbackCorrect: 'Correct! (1+i)²=1+2i+i²=2i.',
        feedbackIncorrect: 'Expand and use i²=−1.',
        sceneData: { kind: 'complex-multiplication', z: [1, 1], w: [1, 1] },
      },
      {
        prompt: 'Multiplying by 1+i scales modulus by what factor?',
        type: 'answer',
        acceptedAnswers: ['sqrt(2)', '√2', '1.414'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! |1+i|=√2.',
        feedbackIncorrect: 'The scale factor is the modulus of the multiplier.',
        sceneData: { kind: 'complex-multiplication', z: [2, 0], w: [1, 1] },
      },
      {
        prompt: 'Multiplying by i rotates a complex number through how many degrees anticlockwise?',
        type: 'answer',
        acceptedAnswers: ['90', '90°', '90 degrees'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! arg(i)=90°, so arguments increase by 90°.',
        feedbackIncorrect: 'The multiplier i lies at argument 90°.',
        sceneData: { kind: 'complex-multiplication', z: [2, 1], w: [0, 1] },
      },
      {
        prompt: 'Extension: if |z|=3 and |w|=2, what is |zw|?',
        type: 'answer',
        acceptedAnswers: ['6'],
        tolerance: 0.001,
        feedbackCorrect: 'Correct! Moduli multiply, so |zw|=3×2=6.',
        feedbackIncorrect: 'Use |zw|=|z||w|.',
        hint: 'Complex multiplication scales lengths multiplicatively.',
        sceneData: { kind: 'complex-multiplication', z: [3, 0], w: [0, 2] },
        tier: 'extension',
      },
    ],
  },
};

/** Get all activities for a specific tab */
export function getActivitiesForTab(tab: LabTab): LabActivityMeta[] {
  return Object.values(LAB_ACTIVITIES).filter((a) => a.tab === tab);
}

/** Get all activities for a level */
export function getActivitiesByLevel(level: 'junior' | 'senior'): LabActivityMeta[] {
  return Object.values(LAB_ACTIVITIES).filter((a) => a.level === level);
}

/** Get all activities for a strand */
export function getActivitiesByStrand(strand: LabStrand): LabActivityMeta[] {
  return Object.values(LAB_ACTIVITIES).filter((a) => a.strand === strand);
}

/** Human-readable labels for strand filter chips */
export const LAB_STRAND_LABELS: Record<LabStrand, string> = {
  'number-algebra': 'Number & Algebra',
  'functions-graphs': 'Functions & Graphs',
  'measurement-geometry': 'Measurement & Geometry',
  trigonometry: 'Trigonometry',
  'statistics-probability': 'Statistics & Probability',
  calculus: 'Calculus',
  'vectors-matrices-complex': 'Vectors, Matrices & Complex',
};

/** All activity IDs */
export const ALL_ACTIVITY_IDS: LabActivityId[] = Object.keys(LAB_ACTIVITIES) as LabActivityId[];
