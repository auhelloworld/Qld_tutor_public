/**
 * Explore-mode micro-task prompts for each Lab tab/topic.
 *
 * Rules:
 * - Each prompt is a pure string — no answers, no scoring, no localStorage.
 * - Prompts must NOT contain the exact `acceptedAnswers` strings from
 *   the corresponding Learn activity steps.
 * - They guide the student toward something to try in the Explore sandbox
 *   without revealing solutions.
 */

import type { LabTab } from './lab-activities';

export interface ExplorePrompt {
  /** Short task/question for the student to try. */
  prompt: string;
}

/**
 * Map from tab (or tab + explore-topic key) to an array of prompts.
 * The key format is `<tab>` for the default explore topic,
 * or `<tab>:<exploreTopic>` for sub-topics.
 */
export const EXPLORE_PROMPTS: Record<string, ExplorePrompt[]> = {
  // ─── Explorer tab ──────────────────────────────────────────────────────
  explorer: [
    { prompt: 'Drag P into a different quadrant. Can you predict which quadrant before looking at the signs?' },
    { prompt: 'Place P on an axis — what happens to the quadrant label?' },
    { prompt: 'Enable two-point mode and position P and Q so the gradient slopes downward.' },
  ],

  'explorer:explorer-number-line': [
    { prompt: 'Mark two values whose average is an integer. Where does that average sit relative to them?' },
    { prompt: 'Compare a negative fraction with the integer next to it. Which one sits closer to zero?' },
  ],

  // ─── Sandbox / Graphing & Curves ───────────────────────────────────────
  sandbox: [
    { prompt: 'Change the gradient slider — what happens to the steepness of the line?' },
    { prompt: 'Try entering a quadratic. Can you make the vertex sit exactly on the x-axis?' },
    { prompt: 'Switch to Custom mode and enter an expression with a restricted domain, like √(x − 2).' },
  ],
  'sandbox:sandbox-function-transformations': [
    { prompt: 'Change h alone and watch the turning point. Does the shape of the curve alter at all?' },
    { prompt: 'Make a negative and describe what happens to the direction the curve opens.' },
  ],
  'sandbox:sandbox-exponential-log': [
    { prompt: 'Raise the base and watch how quickly the curve climbs. Does it ever reach the x-axis?' },
    { prompt: 'Add a vertical shift and look for the line the curve flattens towards on the left.' },
  ],
  'sandbox:sandbox-polar-curves': [
    { prompt: 'Select the cardioid and vary a. At what angle does the curve reach the pole?' },
    { prompt: 'Select the Archimedean spiral. Does its radius grow linearly as θ increases through one turn?' },
    { prompt: 'Select the lemniscate. Which symmetry explains the two loops on opposite sides of the pole?' },
  ],
  'sandbox:sandbox-parametric-curves': [
    { prompt: 'Set x(t) = cos(t) and y(t) = sin(t). What shape do you get?' },
    { prompt: 'Change the frequency ratio between x and y. Can you create a Lissajous figure?' },
  ],
  'sandbox:sandbox-distance-time': [
    { prompt: 'Plot a line with gradient 0. What does this represent on a distance–time graph?' },
    { prompt: 'Make the gradient steeper. What does that mean for the speed of the object?' },
  ],

  // ─── Calculus ──────────────────────────────────────────────────────────
  calculus: [
    { prompt: 'Move x₀ along the curve — where does the tangent slope become zero?' },
    { prompt: 'Increase the number of Riemann rectangles. How does the estimate compare to the exact area?' },
    { prompt: 'Try a function where the left sum overestimates — what shape of curve causes that?' },
  ],
  'calculus:calculus-curve-sketching': [
    { prompt: 'Slide the point of interest through the turning points. Where does the tangent flatten out?' },
    { prompt: 'Find where the bend of the curve reverses. What is the second derivative doing there?' },
  ],
  'calculus:calculus-area-between': [
    { prompt: 'Slide the straight edge until it only just grazes the parabola. What happens to the enclosed region?' },
    { prompt: 'Increase the gradient and watch the shaded region grow. Does it grow in proportion to that gradient?' },
  ],
  'calculus:calculus-direction-field': [
    { prompt: 'Look at the direction arrows. Can you trace a solution curve by following the flow?' },
    { prompt: 'Where do the arrows become horizontal? What does that tell you about equilibrium?' },
  ],
  'calculus:calculus-kinematics-links': [
    { prompt: 'When velocity crosses zero, what happens to the position graph?' },
    { prompt: 'Find the time where acceleration is zero — is velocity at a maximum or minimum there?' },
  ],
  'calculus:calculus-numerical-methods': [
    { prompt: 'Run Newton\'s method from a starting point near a root. How many iterations until convergence?' },
    { prompt: 'Try a starting point far from the root — does the method always converge?' },
  ],

  // ─── Geometry ──────────────────────────────────────────────────────────
  geometry: [
    { prompt: 'Drag a vertex of the triangle, then apply a reflection. Does the image stay congruent?' },
    { prompt: 'Try a rotation of 180° — how do the coordinates of each vertex change?' },
    { prompt: 'Apply an enlargement with scale factor between 0 and 1. Is the image larger or smaller?' },
  ],
  'geometry:geometry-angle-reasoning': [
    { prompt: 'Change the marked angle and watch its partner across the parallel lines. Which pairs stay equal?' },
    { prompt: 'Add sides to the polygon. How does the total of its interior angles respond each time?' },
  ],
  'geometry:geometry-circle-scaling': [
    { prompt: 'Double the radius — by what factor does the circumference change? And the area?' },
    { prompt: 'Try to find a radius that makes the area exactly equal to the circumference numerically.' },
  ],
  'geometry:geometry-pythagoras': [
    { prompt: 'Set two integer side lengths and check whether the Pythagorean relationship holds.' },
    { prompt: 'Can you find a right triangle where both shorter sides are equal?' },
  ],
  'geometry:geometry-sohcahtoa': [
    { prompt: 'Adjust the angle slider. At what angle do the two non-hypotenuse side ratios become equal?' },
    { prompt: 'Choose an acute angle and observe each displayed side ratio. Then compare the ratios at a complementary angle.' },
  ],
  'geometry:geometry-unit-circle': [
    { prompt: 'Rotate through a full turn. In which quadrants does the horizontal coordinate lie to the left of the vertical axis?' },
    { prompt: 'Find the angles where sine equals exactly 0.5 — there should be two in [0°, 360°].' },
  ],
  'geometry:geometry-similarity-ratio': [
    { prompt: 'Set the scale factor to 3. What happens to each side length? What about the angles?' },
    { prompt: 'Set the scale factor to 1. Are the triangles congruent or just similar?' },
  ],

  // ─── Statistics ────────────────────────────────────────────────────────
  statistics: [
    { prompt: 'Add an outlier value to the dataset. Which measure of centre moves more: mean or median?' },
    { prompt: 'Adjust μ and σ on the normal curve. What happens to the z-score of a fixed x value?' },
    { prompt: 'Run the probability simulation with different trial counts. Does the proportion settle?' },
  ],
  'statistics:box-plot': [
    { prompt: 'Move one value beyond the upper fence and describe how its marker differs from values within the whiskers.' },
    { prompt: 'Try a symmetric dataset — where do the centre measures sit relative to the box?' },
  ],
  'statistics:tree-two-way': [
    { prompt: 'Check: does P(A) × P(B) equal P(A and B)? If not, the events are not independent.' },
    { prompt: 'In the two-way table, verify that all row/column totals match the cells.' },
  ],

  // ─── Linear Algebra (Vectors, Matrices, Complex) ───────────────────────
  'linear-algebra': [
    { prompt: 'Set two vectors at right angles. What is the magnitude of their resultant?' },
    { prompt: 'Apply a matrix with determinant 0. What happens to the transformed shape?' },
    { prompt: 'Multiply two complex numbers — how do their moduli and arguments combine?' },
  ],
};

/**
 * Get explore prompts for a given tab and optional sub-topic.
 * Falls back to the tab-level prompts if the sub-topic key is not found.
 */
export function getExplorePrompts(tab: LabTab, subTopic?: string): ExplorePrompt[] {
  if (subTopic) {
    const key = `${tab}:${subTopic}`;
    if (EXPLORE_PROMPTS[key]) return EXPLORE_PROMPTS[key];
  }
  return EXPLORE_PROMPTS[tab] ?? [];
}
