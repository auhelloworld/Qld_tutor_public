/**
 * Pure wave helpers for a mechanical longitudinal sound channel and a separate
 * conceptual electromagnetic transverse channel.
 */

export interface WaveParameters {
  frequencyHz: number;
  amplitudePx: number;
  hasMedium: boolean;
  waveType: 'transverse' | 'longitudinal' | 'side-by-side';
  baseSpeedMps: number;
}

/** Metrics for the mechanical sound channel only. */
export interface WaveMetrics {
  frequencyHz: number;
  wavelengthM: number;
  waveSpeedMps: number;
  periodSec: number;
  isTransmissible: boolean;
}

/** Unitless display metrics for the conceptual electromagnetic channel. */
export interface ElectromagneticWaveMetrics {
  frequencyHz: number;
  periodSec: number;
  relativeWavelength: number;
  relativeWaveSpeed: 1;
  isTransmissibleInVacuum: true;
}

export interface WaveComparisonMetrics {
  mechanical: WaveMetrics;
  electromagnetic: ElectromagneticWaveMetrics;
}

export function calculateMechanicalWaveMetrics(
  frequencyHz: number,
  hasMedium: boolean,
  baseSpeedMps = 340,
): WaveMetrics {
  const frequency = Math.max(0.1, frequencyHz);
  const periodSec = Number((1 / frequency).toFixed(3));
  const waveSpeedMps = hasMedium ? baseSpeedMps : 0;
  const wavelengthM = hasMedium
    ? Number((baseSpeedMps / frequency).toFixed(2))
    : 0;

  return {
    frequencyHz: frequency,
    wavelengthM,
    waveSpeedMps,
    periodSec,
    isTransmissible: hasMedium,
  };
}

/**
 * Backwards-compatible alias. These values describe mechanical sound, not the
 * electromagnetic field representation drawn by the transverse channel.
 */
export function calculateWaveMetrics(
  frequencyHz: number,
  hasMedium: boolean,
  baseSpeedMps = 340,
): WaveMetrics {
  return calculateMechanicalWaveMetrics(frequencyHz, hasMedium, baseSpeedMps);
}

export function calculateElectromagneticWaveMetrics(
  frequencyHz: number,
  referenceFrequencyHz = 1.5,
): ElectromagneticWaveMetrics {
  const frequency = Math.max(0.1, frequencyHz);
  return {
    frequencyHz: frequency,
    periodSec: Number((1 / frequency).toFixed(3)),
    relativeWavelength: Number((referenceFrequencyHz / frequency).toFixed(2)),
    relativeWaveSpeed: 1,
    isTransmissibleInVacuum: true,
  };
}

export function calculateWaveComparisonMetrics(
  frequencyHz: number,
  hasMedium: boolean,
  mechanicalSpeedMps = 340,
): WaveComparisonMetrics {
  return {
    mechanical: calculateMechanicalWaveMetrics(
      frequencyHz,
      hasMedium,
      mechanicalSpeedMps,
    ),
    electromagnetic: calculateElectromagneticWaveMetrics(frequencyHz),
  };
}

export function getTransverseDisplacement(
  x: number,
  timeSec: number,
  frequencyHz: number,
  amplitudePx: number,
  wavelengthPx: number,
): number {
  const waveNumber = (2 * Math.PI) / wavelengthPx;
  const angularFrequency = 2 * Math.PI * frequencyHz;
  return amplitudePx * Math.sin(waveNumber * x - angularFrequency * timeSec);
}

export function getLongitudinalDisplacement(
  x: number,
  timeSec: number,
  frequencyHz: number,
  amplitudePx: number,
  wavelengthPx: number,
  hasMedium: boolean,
): number {
  if (!hasMedium) return 0;
  const waveNumber = (2 * Math.PI) / wavelengthPx;
  const angularFrequency = 2 * Math.PI * frequencyHz;
  return amplitudePx * Math.sin(waveNumber * x - angularFrequency * timeSec);
}
