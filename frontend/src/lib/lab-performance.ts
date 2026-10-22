export const LAB_RENDER_LIMITS = Object.freeze({
  /** Maximum data values retained/rendered by a statistics scene. */
  dataPoints: 40,
  /** Maximum deterministic trials rendered by a probability scene. */
  probabilityTrials: 200,
  /** Maximum rows/columns in a direction field (13 × 13 = 169 segments). */
  directionFieldGrid: 13,
  /** Mafs recursive curve sampling cap for polar/parametric scenes. */
  curveSamplingDepth: 8,
  /** Maximum Newton or numerical-integration iterations shown at once. */
  numericalIterations: 20,
});

export function clampNumber(
  value: number,
  minimum: number,
  maximum: number,
  fallback = minimum,
): number {
  const safeFallback = Number.isFinite(fallback) ? fallback : minimum;
  const candidate = Number.isFinite(value) ? value : safeFallback;
  return Math.min(maximum, Math.max(minimum, candidate));
}

export function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.round(clampNumber(value, minimum, maximum));
}
