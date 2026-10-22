/** Moon phase, eclipse-alignment and tide teaching model. */

export interface MoonTidesSceneData {
  kind: 'moon-tides';
  orbitalAngleDeg: number;
  orbitalInclinationDeg: number;
}

export type MoonPhaseName =
  | 'New Moon'
  | 'Waxing crescent'
  | 'First quarter'
  | 'Waxing gibbous'
  | 'Full Moon'
  | 'Waning gibbous'
  | 'Third quarter'
  | 'Waning crescent';

export interface TidePoint {
  hour: number;
  heightMetres: number;
}

export interface MoonTidesResult {
  orbitalAngleDeg: number;
  orbitalInclinationDeg: number;
  nodeLongitudeDeg: number;
  moonHeightDeg: number;
  illuminatedFraction: number;
  phaseName: MoonPhaseName;
  eclipseStatus: 'solar eclipse alignment' | 'lunar eclipse alignment' | 'shadow misses' | 'not aligned';
  eclipseExplanation: string;
  tideType: 'spring' | 'neap' | 'intermediate';
  tideRangeMetres: number;
  tideCurve: TidePoint[];
}

export const MOON_TIDES_MODEL_LIMITATIONS = [
  'Distances, sizes, shadow widths and tide heights are rescaled so linked patterns can be seen; the drawing is not to scale.',
  'A fixed node line is used for one teaching month. In reality the node line precesses and eclipse seasons shift.',
  'The tide curve combines idealised solar and lunar components; coast shape, water depth, weather and local timing are omitted.',
] as const;

const NODE_LONGITUDE_DEG = 28;

function clamp(value: number, min: number, max: number, fallback: number): number {
  const finite = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, finite));
}

function normaliseDegrees(value: number): number {
  const finite = Number.isFinite(value) ? value : 0;
  return ((finite % 360) + 360) % 360;
}

function angularDistance(a: number, b: number): number {
  const difference = Math.abs(normaliseDegrees(a) - normaliseDegrees(b));
  return Math.min(difference, 360 - difference);
}

function phaseName(angle: number): MoonPhaseName {
  const names: MoonPhaseName[] = [
    'New Moon',
    'Waxing crescent',
    'First quarter',
    'Waxing gibbous',
    'Full Moon',
    'Waning gibbous',
    'Third quarter',
    'Waning crescent',
  ];
  return names[Math.round(normaliseDegrees(angle) / 45) % 8];
}

export function calculateMoonTides(sceneData: MoonTidesSceneData): MoonTidesResult {
  const orbitalAngleDeg = normaliseDegrees(sceneData.orbitalAngleDeg);
  const orbitalInclinationDeg = clamp(sceneData.orbitalInclinationDeg, 0, 10, 5.1);
  const angleRad = (orbitalAngleDeg * Math.PI) / 180;
  const nodeRelativeRad = ((orbitalAngleDeg - NODE_LONGITUDE_DEG) * Math.PI) / 180;
  const moonHeightDeg = Math.sin(nodeRelativeRad) * orbitalInclinationDeg;
  const newSeparation = angularDistance(orbitalAngleDeg, 0);
  const fullSeparation = angularDistance(orbitalAngleDeg, 180);
  const isSyzygy = Math.min(newSeparation, fullSeparation) <= 8;
  const intersectsShadowPlane = Math.abs(moonHeightDeg) <= 0.65;

  let eclipseStatus: MoonTidesResult['eclipseStatus'] = 'not aligned';
  let eclipseExplanation = 'No eclipse: the Moon is not close to the Sun–Earth line.';
  if (isSyzygy && !intersectsShadowPlane) {
    eclipseStatus = 'shadow misses';
    eclipseExplanation = 'No eclipse: phase alignment occurs, but the inclined orbit carries the Moon above or below the shadow.';
  } else if (isSyzygy && intersectsShadowPlane && newSeparation <= fullSeparation) {
    eclipseStatus = 'solar eclipse alignment';
    eclipseExplanation = 'Solar-eclipse geometry: New Moon alignment and node-plane proximity occur together.';
  } else if (isSyzygy && intersectsShadowPlane) {
    eclipseStatus = 'lunar eclipse alignment';
    eclipseExplanation = 'Lunar-eclipse geometry: Full Moon alignment and node-plane proximity occur together.';
  }

  const alignmentStrength = Math.abs(Math.cos(angleRad));
  const tideType = alignmentStrength >= 0.82
    ? 'spring'
    : alignmentStrength <= 0.25
      ? 'neap'
      : 'intermediate';

  // Two semi-diurnal components. At New/Full Moon their phases reinforce; at
  // quarter Moon they oppose. Heights are an idealised classroom proxy.
  const tideCurve = Array.from({ length: 49 }, (_, index) => {
    const hour = index * 0.5;
    const lunar = 0.85 * Math.cos((2 * Math.PI * hour) / 12.42 - 2 * angleRad);
    const solar = 0.35 * Math.cos((2 * Math.PI * hour) / 12);
    return { hour, heightMetres: 2 + lunar + solar };
  });
  const heights = tideCurve.map((point) => point.heightMetres);
  const tideRangeMetres = Math.max(...heights) - Math.min(...heights);

  return {
    orbitalAngleDeg,
    orbitalInclinationDeg,
    nodeLongitudeDeg: NODE_LONGITUDE_DEG,
    moonHeightDeg: Math.round(moonHeightDeg * 100) / 100,
    illuminatedFraction: Math.round(((1 - Math.cos(angleRad)) / 2) * 1000) / 1000,
    phaseName: phaseName(orbitalAngleDeg),
    eclipseStatus,
    eclipseExplanation,
    tideType,
    tideRangeMetres: Math.round(tideRangeMetres * 100) / 100,
    tideCurve,
  };
}
