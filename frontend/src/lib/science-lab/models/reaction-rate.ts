import { createSeededRandom } from '../seeded-random';

export interface ReactionRateSceneData {
  kind: 'reaction-rate';
  temperatureC: number;
  concentrationRelative: number;
  surfaceAreaFactor: number;
  catalystEnabled: boolean;
  seed: number;
}

export interface ConcentrationPoint {
  timeRelative: number;
  concentrationPercent: number;
}

export interface CollisionParticle {
  id: number;
  x: number;
  y: number;
  directionDeg: number;
  speedRelative: number;
  hasSufficientEnergy: boolean;
}

export interface ReactionRateResult {
  temperatureC: number;
  collisionFrequencyIndex: number;
  activationBarrierIndex: number;
  successfulCollisionIndex: number;
  relativeRateIndex: number;
  concentrationCurve: ConcentrationPoint[];
  particles: CollisionParticle[];
  limitation: string;
}

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
 * Relative collision-theory model normalised to 25 °C, concentration 1,
 * surface-area factor 1, and no catalyst. It intentionally produces indices,
 * not an experimental rate constant or a rate with physical units.
 */
export function calculateReactionRate(data: ReactionRateSceneData): ReactionRateResult {
  const temperatureC = clamp(finiteOr(data.temperatureC, 25), 5, 80);
  const concentration = clamp(finiteOr(data.concentrationRelative, 1), 0.25, 2.5);
  const surfaceArea = clamp(finiteOr(data.surfaceAreaFactor, 1), 0.5, 4);
  const temperatureK = temperatureC + 273.15;
  const referenceK = 298.15;

  // Temperature changes speed (and therefore collision frequency) only
  // modestly; its larger effect is on the fraction able to cross the barrier.
  const thermalCollisionFactor = Math.sqrt(temperatureK / referenceK);
  const collisionFrequency = concentration * surfaceArea * thermalCollisionFactor;
  const activationBarrier = data.catalystEnabled ? 0.65 : 1;
  const successfulCollision = Math.exp(-3 * activationBarrier * referenceK / temperatureK)
    / Math.exp(-3);
  const relativeRate = clamp(collisionFrequency * successfulCollision, 0, 25);

  const concentrationCurve: ConcentrationPoint[] = Array.from({ length: 21 }, (_, index) => {
    const timeRelative = index / 2;
    return {
      timeRelative,
      concentrationPercent: round(100 * Math.exp(-0.025 * relativeRate * timeRelative), 2),
    };
  });

  // The seed fixes one microstate. Toggling the catalyst keeps particle
  // positions and directions fixed so the counterfactual changes only the
  // activation pathway and successful-collision classification.
  const seed = finiteOr(data.seed, 42) | 0;
  const rng = createSeededRandom(seed);
  const particleCount = Math.round(clamp(8 + concentration * 6, 8, 24));
  const successProbability = clamp(0.08 * successfulCollision, 0.04, 0.55);
  const particles: CollisionParticle[] = Array.from({ length: particleCount }, (_, index) => ({
    id: index,
    x: round(0.06 + rng() * 0.88, 4),
    y: round(0.1 + rng() * 0.8, 4),
    directionDeg: round(rng() * 360, 1),
    speedRelative: round(thermalCollisionFactor * (0.7 + rng() * 0.6), 3),
    hasSufficientEnergy: rng() < successProbability,
  }));

  return {
    temperatureC: round(temperatureC, 1),
    collisionFrequencyIndex: round(collisionFrequency),
    activationBarrierIndex: activationBarrier,
    successfulCollisionIndex: round(successfulCollision),
    relativeRateIndex: round(relativeRate),
    concentrationCurve,
    particles,
    limitation: 'All outputs are relative model indices and relative time, not an absolute laboratory rate; actual rates require reaction-specific measurements and conditions.',
  };
}
