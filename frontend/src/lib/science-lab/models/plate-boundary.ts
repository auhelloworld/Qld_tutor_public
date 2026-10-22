export type PlateBoundaryType = 'divergent' | 'convergent' | 'transform';

export interface PlateBoundaryInputs {
  boundaryType: PlateBoundaryType;
  plateSpeedCmPerYear: number;
  leftDensityGcm3: number;
  rightDensityGcm3: number;
}

export interface CrustAgePoint {
  distanceKm: number;
  ageMa: number;
}

export interface PlateBoundaryResult extends PlateBoundaryInputs {
  movementDescription: string;
  earthquakePattern: string;
  maximumEarthquakeDepthKm: number;
  volcanoPattern: string;
  crustProcess: string;
  magneticStripePattern: string;
  subductingPlate: 'left' | 'right' | 'neither';
  edgeCrustAgeMa: number;
  crustAgeProfile: CrustAgePoint[];
  mantleStatement: string;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function nearest(value: number, interval: number): number {
  return Math.round(value / interval) * interval;
}

/**
 * Deterministic conceptual plate model. Distances and ages are classroom-scale
 * evidence, not a forecast for a named plate or event.
 */
export function calculatePlateBoundary(
  inputs: PlateBoundaryInputs,
): PlateBoundaryResult {
  const plateSpeedCmPerYear = clamp(inputs.plateSpeedCmPerYear, 1, 12);
  const leftDensityGcm3 = clamp(inputs.leftDensityGcm3, 2.6, 3.3);
  const rightDensityGcm3 = clamp(inputs.rightDensityGcm3, 2.6, 3.3);
  const densityDifference = leftDensityGcm3 - rightDensityGcm3;
  const mantleStatement = 'The mantle is hot, mostly solid rock that deforms and flows slowly; it is not a liquid ocean.';

  if (inputs.boundaryType === 'divergent') {
    const edgeCrustAgeMa = Math.max(2, Math.round(20 / plateSpeedCmPerYear));
    return {
      boundaryType: 'divergent',
      plateSpeedCmPerYear,
      leftDensityGcm3,
      rightDensityGcm3,
      movementDescription: 'Plates move apart and new crust forms at the ridge.',
      earthquakePattern: 'Frequent shallow earthquakes along the ridge.',
      maximumEarthquakeDepthKm: 20,
      volcanoPattern: 'Ridge volcanism where magma reaches the surface.',
      crustProcess: 'New crust forms at the centre and becomes older away from it.',
      magneticStripePattern: 'Matching, symmetrical magnetic stripes on both sides of the ridge.',
      subductingPlate: 'neither',
      edgeCrustAgeMa,
      crustAgeProfile: [
        { distanceKm: -200, ageMa: edgeCrustAgeMa },
        { distanceKm: -100, ageMa: Math.round(edgeCrustAgeMa / 2) },
        { distanceKm: 0, ageMa: 0 },
        { distanceKm: 100, ageMa: Math.round(edgeCrustAgeMa / 2) },
        { distanceKm: 200, ageMa: edgeCrustAgeMa },
      ],
      mantleStatement,
    };
  }

  if (inputs.boundaryType === 'convergent') {
    const hasClearDensityContrast = Math.abs(densityDifference) >= 0.05;
    const subductingPlate = !hasClearDensityContrast
      ? 'neither'
      : densityDifference > 0
        ? 'left'
        : 'right';
    const maximumEarthquakeDepthKm = hasClearDensityContrast
      ? clamp(nearest(450 + Math.abs(densityDifference) * 500, 50), 0, 700)
      : 150;
    const edgeCrustAgeMa = nearest(55 + Math.abs(densityDifference) * 80, 5);

    return {
      boundaryType: 'convergent',
      plateSpeedCmPerYear,
      leftDensityGcm3,
      rightDensityGcm3,
      movementDescription: hasClearDensityContrast
        ? `Plates move together; the denser ${subductingPlate} plate bends beneath the other.`
        : 'Plates move together; similar-density crust shortens and thickens.',
      earthquakePattern: hasClearDensityContrast
        ? 'Earthquakes trace the descending plate from shallow to deep.'
        : 'Mostly shallow-to-intermediate earthquakes across a collision zone.',
      maximumEarthquakeDepthKm,
      volcanoPattern: hasClearDensityContrast
        ? 'A volcanic arc can form above the descending plate.'
        : 'Little arc volcanism; uplift dominates in this simplified collision.',
      crustProcess: hasClearDensityContrast
        ? 'Older crust is recycled into the mantle at the trench.'
        : 'Crust is thickened rather than newly created.',
      magneticStripePattern: 'Ocean-floor stripes terminate or distort near the trench.',
      subductingPlate,
      edgeCrustAgeMa,
      crustAgeProfile: [
        { distanceKm: -200, ageMa: subductingPlate === 'left' ? edgeCrustAgeMa : 35 },
        { distanceKm: -100, ageMa: subductingPlate === 'left' ? edgeCrustAgeMa + 10 : 40 },
        { distanceKm: 0, ageMa: edgeCrustAgeMa },
        { distanceKm: 100, ageMa: subductingPlate === 'right' ? edgeCrustAgeMa + 10 : 40 },
        { distanceKm: 200, ageMa: subductingPlate === 'right' ? edgeCrustAgeMa : 35 },
      ],
      mantleStatement,
    };
  }

  return {
    boundaryType: 'transform',
    plateSpeedCmPerYear,
    leftDensityGcm3,
    rightDensityGcm3,
    movementDescription: 'Plates slide horizontally past one another.',
    earthquakePattern: 'Shallow earthquakes cluster along the locked and slipping fault.',
    maximumEarthquakeDepthKm: 30,
    volcanoPattern: 'No regular magma source, so a volcanic chain is not expected.',
    crustProcess: 'Crust is offset but neither created nor destroyed.',
    magneticStripePattern: 'Existing magnetic stripes are offset across the fault.',
    subductingPlate: 'neither',
    edgeCrustAgeMa: 40,
    crustAgeProfile: [
      { distanceKm: -200, ageMa: 35 },
      { distanceKm: -100, ageMa: 38 },
      { distanceKm: 0, ageMa: 40 },
      { distanceKm: 100, ageMa: 38 },
      { distanceKm: 200, ageMa: 35 },
    ],
    mantleStatement,
  };
}
