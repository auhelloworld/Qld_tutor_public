/**
 * Science Lab Performance Limits and Render Budget Assertions
 */

export const SCIENCE_LAB_LIMITS = Object.freeze({
  svgPrimitives: 300,
  graphPoints: 120,
  canvasObjects: 300,
  particles: 250,             // SCI-PARTICLE-01 limit; native Canvas is sufficient
  populationIndividuals: 200, // SCI-SELECTION-01 limit
  generations: 60,
  stochasticTrials: 200,      // Aligned with probabilityTrials
  activeAnimationLoops: 1,
  activeWorkers: 0,           // v0 does not use web workers
  activeWebGlContexts: 0,     // v0 does not use WebGL
  maximumSimulationStepsPerFrame: 4,
});

export type ScienceLabLimitKey = keyof typeof SCIENCE_LAB_LIMITS;

/**
 * Validates that a runtime count does not exceed the budgeted threshold.
 */
export function assertScienceRenderBudget(key: ScienceLabLimitKey, actualCount: number): void {
  const limit = SCIENCE_LAB_LIMITS[key];
  if (actualCount > limit) {
    throw new Error(
      `[ScienceLabBudgetViolation] ${String(key)}: actual ${actualCount} exceeds limit ${limit}`,
    );
  }
}
