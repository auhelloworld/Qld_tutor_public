/** Seeded radioactive-decay teaching model. */

import { createSeededRandom } from '../seeded-random';

export interface HalfLifeSceneData {
  kind: 'half-life';
  initialNuclei: number;
  halfLifeSeconds: number;
  elapsedTimeSeconds: number;
  timeStepSeconds: number;
  seed: number;
}

export interface RadioactiveNucleus {
  id: number;
  row: number;
  column: number;
  decayTimeSeconds: number;
}

export interface DecayCurvePoint {
  timeSeconds: number;
  expectedRemaining: number;
}

export interface HalfLifeResult {
  nuclei: RadioactiveNucleus[];
  elapsedTimeSeconds: number;
  remainingCount: number;
  decayedCount: number;
  remainingFraction: number;
  theoreticalRemaining: number;
  activityPerSecond: number;
  completedHalfLives: number;
  curve: DecayCurvePoint[];
}

export const RADIATION_CONCEPT_COMPARISON = {
  irradiation: 'Exposure to radiation from a source. Removing the source ends the exposure; the object does not automatically become radioactive.',
  contamination: 'Radioactive material is on or inside an object. The material keeps emitting until it is removed or decays.',
} as const;

export const HALF_LIFE_MODEL_LIMITATIONS = [
  'Each nucleus has a seeded random decay time; individual decay cannot be predicted even though a large sample follows an exponential trend.',
  'The model uses one isotope and one decay step, with no daughter products, background radiation or detector efficiency.',
  'Changing the seed represents a different possible sample, not a change in the isotope half-life.',
] as const;

function clamp(value: number, min: number, max: number, fallback: number): number {
  const finite = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, finite));
}

function sanitise(sceneData: HalfLifeSceneData) {
  return {
    initialNuclei: Math.round(clamp(sceneData.initialNuclei, 16, 160, 96)),
    halfLifeSeconds: clamp(sceneData.halfLifeSeconds, 1, 120, 20),
    elapsedTimeSeconds: clamp(sceneData.elapsedTimeSeconds, 0, 600, 0),
    timeStepSeconds: clamp(sceneData.timeStepSeconds, 0.5, 60, 5),
    seed: Math.round(clamp(sceneData.seed, 0, 999_999, 42)),
  };
}

export function createDecayNuclei(
  initialNuclei: number,
  halfLifeSeconds: number,
  seed: number,
): RadioactiveNucleus[] {
  const count = Math.round(clamp(initialNuclei, 16, 160, 96));
  const halfLife = clamp(halfLifeSeconds, 1, 120, 20);
  const safeSeed = Math.round(clamp(seed, 0, 999_999, 42));
  const random = createSeededRandom(safeSeed);
  const columns = Math.ceil(Math.sqrt(count * 1.45));
  const decayConstant = Math.LN2 / halfLife;

  return Array.from({ length: count }, (_, id) => {
    // Inverse-transform sampling of exponential lifetimes. Keep u away from 1
    // so every generated lifetime remains finite and reproducible.
    const u = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, random()));
    return {
      id,
      row: Math.floor(id / columns),
      column: id % columns,
      decayTimeSeconds: -Math.log(1 - u) / decayConstant,
    };
  });
}

export function calculateHalfLife(sceneData: HalfLifeSceneData): HalfLifeResult {
  const clean = sanitise(sceneData);
  const nuclei = createDecayNuclei(clean.initialNuclei, clean.halfLifeSeconds, clean.seed);
  const remainingCount = nuclei.reduce(
    (count, nucleus) => count + (nucleus.decayTimeSeconds > clean.elapsedTimeSeconds ? 1 : 0),
    0,
  );
  const decayedCount = clean.initialNuclei - remainingCount;
  const remainingFraction = remainingCount / clean.initialNuclei;
  const theoreticalRemaining =
    clean.initialNuclei * 2 ** (-clean.elapsedTimeSeconds / clean.halfLifeSeconds);
  const activityPerSecond = (Math.LN2 / clean.halfLifeSeconds) * remainingCount;
  const curveEnd = Math.max(clean.halfLifeSeconds * 5, clean.elapsedTimeSeconds, clean.timeStepSeconds);
  const curve = Array.from({ length: 51 }, (_, index) => {
    const timeSeconds = (curveEnd * index) / 50;
    return {
      timeSeconds,
      expectedRemaining: clean.initialNuclei * 2 ** (-timeSeconds / clean.halfLifeSeconds),
    };
  });

  return {
    nuclei,
    elapsedTimeSeconds: clean.elapsedTimeSeconds,
    remainingCount,
    decayedCount,
    remainingFraction,
    theoreticalRemaining,
    activityPerSecond,
    completedHalfLives: clean.elapsedTimeSeconds / clean.halfLifeSeconds,
    curve,
  };
}
