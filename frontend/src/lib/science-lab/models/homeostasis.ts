import { createSeededRandom } from '../seeded-random';

export type HomeostasisDisturbance = 'meal' | 'exercise';
export type HomeostasisCondition = 'normal' | 'diabetes';

export interface HomeostasisSceneData {
  kind: 'homeostasis';
  disturbance: HomeostasisDisturbance;
  insulinSensitivity: number;
  controllerStrength: number;
  condition: HomeostasisCondition;
  seed: number;
}

export interface HomeostasisPoint {
  timeMin: number;
  glucoseMmolL: number;
  disturbanceRateMmolLMin: number;
  feedbackRateMmolLMin: number;
}

export interface HomeostasisResult {
  condition: HomeostasisCondition;
  targetGlucoseMmolL: number;
  baselineGlucoseMmolL: number;
  peakGlucoseMmolL: number;
  minimumGlucoseMmolL: number;
  finalGlucoseMmolL: number;
  returnTimeMin: number | null;
  points: HomeostasisPoint[];
  limitation: string;
}

const TARGET_GLUCOSE_MMOL_L = 5;
const DURATION_MIN = 180;
const STEP_MIN = 2;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, places = 3): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/**
 * A conceptual disturbance rate. It is deliberately not a patient-specific
 * glucose absorption or exercise prescription model.
 */
function disturbanceRate(
  timeMin: number,
  disturbance: HomeostasisDisturbance,
  scenarioScale: number,
): number {
  if (disturbance === 'meal') {
    if (timeMin < 10) return 0;
    const elapsed = timeMin - 10;
    const shape = (elapsed / 24) * Math.exp(1 - elapsed / 24);
    return 0.052 * scenarioScale * shape;
  }

  if (timeMin < 20 || timeMin > 95) return 0;
  const rampUp = clamp((timeMin - 20) / 12, 0, 1);
  const rampDown = clamp((95 - timeMin) / 18, 0, 1);
  return -0.026 * scenarioScale * Math.min(rampUp, rampDown);
}

/**
 * Simulates a bounded, classroom-scale negative-feedback model. The normal
 * and diabetes conditions start from the same baseline so the counterfactual
 * isolates feedback effectiveness; this is not a diagnostic or clinical model.
 */
export function simulateHomeostasis(
  data: HomeostasisSceneData,
  condition: HomeostasisCondition = data.condition,
): HomeostasisResult {
  const insulinSensitivity = clamp(finiteOr(data.insulinSensitivity, 1), 0.1, 1.5);
  const controllerStrength = clamp(finiteOr(data.controllerStrength, 1), 0, 1.5);
  const seed = finiteOr(data.seed, 42) | 0;
  const rng = createSeededRandom(seed);
  const baseline = TARGET_GLUCOSE_MMOL_L + (rng() - 0.5) * 0.18;
  const scenarioScale = 0.94 + rng() * 0.12;

  const conditionSensitivity = condition === 'diabetes'
    ? insulinSensitivity * 0.3
    : insulinSensitivity;
  const conditionController = condition === 'diabetes'
    ? controllerStrength * 0.55
    : controllerStrength;

  let glucose = baseline;
  const points: HomeostasisPoint[] = [];

  for (let timeMin = 0; timeMin <= DURATION_MIN; timeMin += STEP_MIN) {
    const disturbance = disturbanceRate(timeMin, data.disturbance, scenarioScale);
    const error = glucose - TARGET_GLUCOSE_MMOL_L;
    // Insulin sensitivity scales correction above the set point. Below it, a
    // generic counter-regulatory arm is shown, rather than calling it insulin.
    const sensitivity = error >= 0 ? conditionSensitivity : 0.78;
    const feedback = 0.03 * conditionController * sensitivity * error;

    points.push({
      timeMin,
      glucoseMmolL: round(glucose),
      disturbanceRateMmolLMin: round(disturbance, 4),
      feedbackRateMmolLMin: round(feedback, 4),
    });

    glucose = clamp(glucose + (disturbance - feedback) * STEP_MIN, 2.5, 15);
  }

  const values = points.map((point) => point.glucoseMmolL);
  const disturbanceEndMin = data.disturbance === 'meal' ? 82 : 95;
  const returnedPoint = points.find(
    (point) => point.timeMin >= disturbanceEndMin
      && Math.abs(point.glucoseMmolL - TARGET_GLUCOSE_MMOL_L) <= 0.25,
  );

  return {
    condition,
    targetGlucoseMmolL: TARGET_GLUCOSE_MMOL_L,
    baselineGlucoseMmolL: round(baseline),
    peakGlucoseMmolL: Math.max(...values),
    minimumGlucoseMmolL: Math.min(...values),
    finalGlucoseMmolL: values[values.length - 1],
    returnTimeMin: returnedPoint?.timeMin ?? null,
    points,
    limitation: 'Conceptual relative feedback model only; it does not predict an individual’s glucose response or diagnose diabetes.',
  };
}
