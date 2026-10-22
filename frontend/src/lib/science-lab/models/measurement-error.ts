import { createSeededRandom } from '../seeded-random';

export interface MeasurementErrorSceneData {
  kind: 'measurement-error';
  trueValue: number;
  resolution: number;
  randomError: number;
  systematicBias: number;
  sampleSize: number;
  seed: number;
  calibrated: boolean;
}

export interface MeasurementSample {
  index: number;
  value: number;
  absoluteError: number;
  isOutlier: boolean;
}

export interface MeasurementStudy {
  trueValue: number;
  effectiveBias: number;
  calibrated: boolean;
  samples: MeasurementSample[];
  mean: number;
  range: number;
  absoluteError: number;
  outlierIndices: number[];
  lowerOutlierFence: number;
  upperOutlierFence: number;
  limitation: string;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, places = 6): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function quantise(value: number, resolution: number): number {
  return round(Math.round(value / resolution) * resolution);
}

function normalSample(rng: () => number): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function quantile(sorted: number[], proportion: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * proportion;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Generates repeatable instrument readings. Calibration removes the supplied
 * systematic bias but cannot remove resolution limits or random variation.
 */
export function generateMeasurementStudy(data: MeasurementErrorSceneData): MeasurementStudy {
  const trueValue = finiteOr(data.trueValue, 50);
  const resolution = clamp(Math.abs(finiteOr(data.resolution, 0.5)), 0.01, 10);
  const randomError = clamp(Math.abs(finiteOr(data.randomError, 1)), 0, 20);
  const systematicBias = clamp(finiteOr(data.systematicBias, 1), -20, 20);
  const sampleSize = Math.round(clamp(finiteOr(data.sampleSize, 12), 3, 50));
  const seed = finiteOr(data.seed, 42) | 0;
  const effectiveBias = data.calibrated ? 0 : systematicBias;
  const rng = createSeededRandom(seed);

  const values = Array.from({ length: sampleSize }, () => quantise(
    trueValue + effectiveBias + normalSample(rng) * randomError,
    resolution,
  ));
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const outlierIndices = values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value < lowerFence || value > upperFence)
    .map(({ index }) => index + 1);
  const mean = values.reduce((sum, value) => sum + value, 0) / sampleSize;

  return {
    trueValue: round(trueValue),
    effectiveBias: round(effectiveBias),
    calibrated: data.calibrated,
    samples: values.map((value, index) => ({
      index: index + 1,
      value,
      absoluteError: round(Math.abs(value - trueValue)),
      isOutlier: outlierIndices.includes(index + 1),
    })),
    mean: round(mean),
    range: round(sorted[sorted.length - 1] - sorted[0]),
    absoluteError: round(Math.abs(mean - trueValue)),
    outlierIndices,
    lowerOutlierFence: round(lowerFence),
    upperOutlierFence: round(upperFence),
    limitation: 'Synthetic readings illustrate uncertainty; their distribution does not validate a real instrument or replace repeated experimental measurements.',
  };
}
