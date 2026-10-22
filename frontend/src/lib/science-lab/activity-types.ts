/**
 * Science Lab Activity Types and Schema
 */

export type InteractionKind =
  | 'drag-handle'            // Direct object/vertex/angle/position manipulation
  | 'continuous-slider'      // Continuous parameter + real-time numeric readouts
  | 'linked-views'           // Top/side, micro/macro, graph/chart sync
  | 'time-control'           // Play, pause, step, reset, speed
  | 'counterfactual-toggle'  // Zero tilt, zero friction, vacuum (remove medium)
  | 'system-construction'    // Connect, arrange, remove components
  | 'measure-tool'           // Ruler, probe, timer for quantitative observation
  | 'trace-overlay'          // Motion trace/history overlay
  | 'side-by-side';          // Compare two parameter sets / conditions simultaneously

export type InteractionLevel = 'L2' | 'L3' | 'L4';

/** Implementation renderer kind. Admission is judged by interactionLevel & interactions. */
export type ScienceRendererKind = 'svg' | 'mafs' | 'canvas';

export type ScienceActivityId =
  | 'SCI-SEASONS-01'
  | 'SCI-PARTICLE-01'
  | 'SCI-FORCE-01'
  | 'SCI-FOODWEB-01'
  | 'SCI-WAVE-01'
  | 'SCI-SELECTION-01'
  | 'SCI-ENERGY-01'
  | 'SCI-SEPARATION-01'
  | 'SCI-REACTION-BALANCE-01'
  | 'SCI-PLATES-01'
  | 'SCI-HOMEOSTASIS-01'
  | 'SCI-MEASUREMENT-01'
  | 'SCI-GENETICS-01'
  | 'SCI-REACTION-RATE-01'
  | 'SCI-CARBON-CLIMATE-01'
  | 'SCI-HALF-LIFE-01'
  | 'SCI-MOON-TIDES-01'
  | 'SCI-CELL-SYSTEM-01';

/** Compatibility name used by the executable Science Lab plan. */
export type LabActivityId = ScienceActivityId;

export interface PredictionDefinition {
  question: string;
  options: string[];
  correctIndex: number;
  /** Approved misconception ID or 'proposed:<slug>' */
  distractorSource: string[];
  explanation?: string;
}

export interface ControlDefinition {
  id: string;
  label: string;
  type: 'slider' | 'toggle' | 'select' | 'button' | 'playback';
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number | boolean | string;
  options?: { label: string; value: string }[];
  ariaLabel: string;
  unit?: string;
}

export type ObservationReadoutValue = string | number;
export type ObservationReadouts = Record<string, ObservationReadoutValue>;

export interface ObservationField {
  id: string;
  label: string;
  /**
   * Unit owned by observation metadata. Bare numbers and numeric strings are
   * rendered with this suffix; already formatted/status strings are preserved.
   */
  unit?: string;
}

export interface ObservationDefinition {
  title: string;
  fields: ObservationField[];
  tableHeaders?: string[];
}

export interface ScienceLearnStep {
  id: string;
  title: string;
  prompt: string;
  hint?: string;
  targetConcept: string;
  checkType: 'observation' | 'prediction' | 'explanation' | 'manipulation';
  acceptedKeywords?: string[];
}

/** Senior-subject pathway copied from the mapped curriculum descriptor(s). */
export interface AtarPathwayDefinition {
  targetSeniorSubjects: string[];
  importanceLevel: string;
  connectionDescription: string;
}

// ─── Discriminated Union Scene Data Types ────────────────────────────────────

export interface SeasonsSceneData {
  kind: 'seasons';
  dayOfYear: number;
  axialTiltDeg: number;
  latitudeDeg: number;
  showOrbitView: boolean;
  showTiltView: boolean;
}

export interface ParticleModelSceneData {
  kind: 'particle-model';
  temperatureK: number;
  stateMode: 'states' | 'diffusion' | 'dissolving';
  particleCount: number;
  isPlaying: boolean;
}

export interface ForceMotionSceneData {
  kind: 'force-motion';
  massKg: number;
  appliedForceN: number;
  frictionEnabled: boolean;
  traceEnabled: boolean;
  isPlaying: boolean;
}

export interface FoodWebSceneData {
  kind: 'food-web';
  activeSpecies: Record<string, number>;
  activeLayer: 'all' | 'matter' | 'energy';
  generation: number;
  isPlaying: boolean;
}

export interface WaveMediumSceneData {
  kind: 'wave-medium';
  frequencyHz: number;
  amplitudePx: number;
  hasMedium: boolean;
  waveType: 'transverse' | 'longitudinal' | 'side-by-side';
  isPlaying: boolean;
}

export interface SelectionSceneData {
  kind: 'selection';
  selectionPressure: number;
  initialFrequency: number;
  generation: number;
  isPlaying: boolean;
  seed: number;
}

export interface EnergyEfficiencySceneData {
  kind: 'energy-efficiency';
  inputEnergyKJ: number;
  efficiencyPercent: number;
  frictionPercent: number;
  loadPercent: number;
}

export interface SeparationProcessSceneData {
  kind: 'separation-process';
  scenarioId: 'sand-salt-water' | 'ink' | 'ethanol-water';
  methodSequence: ('filtration' | 'evaporation' | 'crystallisation' | 'chromatography' | 'distillation' | 'decantation')[];
}

export interface ReactionBalanceSceneData {
  kind: 'reaction-balance';
  reactionId: 'water-formation' | 'methane-combustion' | 'iron-oxidation';
  coefficients: number[];
  systemMode: 'closed' | 'open';
}

export interface PlateBoundarySceneData {
  kind: 'plate-boundary';
  boundaryType: 'divergent' | 'convergent' | 'transform';
  plateSpeedCmPerYear: number;
  leftDensityGcm3: number;
  rightDensityGcm3: number;
}

export interface HomeostasisSceneData {
  kind: 'homeostasis';
  disturbance: 'meal' | 'exercise';
  insulinSensitivity: number;
  controllerStrength: number;
  condition: 'normal' | 'diabetes';
  seed: number;
}

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

export interface GeneticsSceneData {
  kind: 'genetics';
  parent1Genotype: 'AA' | 'Aa' | 'aa';
  parent2Genotype: 'AA' | 'Aa' | 'aa';
  dominanceMode: 'complete' | 'incomplete' | 'codominant';
  offspringCount: number;
  seed: number;
}

export interface ReactionRateSceneData {
  kind: 'reaction-rate';
  temperatureC: number;
  concentrationRelative: number;
  surfaceAreaFactor: number;
  catalystEnabled: boolean;
  seed: number;
}

export interface CarbonClimateSceneData {
  kind: 'carbon-climate';
  combustion: number;
  photosynthesis: number;
  oceanUptake: number;
  albedo: number;
  greenhouseGasPpm: number;
}

export interface HalfLifeSceneData {
  kind: 'half-life';
  initialNuclei: number;
  halfLifeSeconds: number;
  elapsedTimeSeconds: number;
  timeStepSeconds: number;
  seed: number;
}

export interface MoonTidesSceneData {
  kind: 'moon-tides';
  orbitalAngleDeg: number;
  orbitalInclinationDeg: number;
}

export interface CellSystemSceneData {
  kind: 'cell-system';
  cellType: 'plant' | 'animal';
  membraneFunction: number;
  mitochondriaFunction: number;
  chloroplastFunction: number;
  tissueDemand: number;
}

export type ScienceSceneData =
  | SeasonsSceneData
  | ParticleModelSceneData
  | ForceMotionSceneData
  | FoodWebSceneData
  | WaveMediumSceneData
  | SelectionSceneData
  | EnergyEfficiencySceneData
  | SeparationProcessSceneData
  | ReactionBalanceSceneData
  | PlateBoundarySceneData
  | HomeostasisSceneData
  | MeasurementErrorSceneData
  | GeneticsSceneData
  | ReactionRateSceneData
  | CarbonClimateSceneData
  | HalfLifeSceneData
  | MoonTidesSceneData
  | CellSystemSceneData;

/** Compatibility names used by the executable Science Lab plan. */
export type SceneKind = ScienceSceneData['kind'];
export type SceneData = ScienceSceneData;

export interface ScienceActivityMeta<TScene extends ScienceSceneData = ScienceSceneData> {
  id: ScienceActivityId;
  title: string;
  subtitle: string;
  description: string;
  yearLevels: number[];
  topicIds: string[];          // Must exist in data/curriculum/ac9_science/
  strand: string;
  interactionLevel: InteractionLevel;
  interactions: InteractionKind[];
  renderer: ScienceRendererKind;
  sceneData: TScene;
  learnSteps: ScienceLearnStep[];
  prediction: PredictionDefinition;
  controls: ControlDefinition[];
  observation: ObservationDefinition;
  transferTopicIds: string[];  // Deep-linked to /?topic=
  modelLimitations: string[];
  /** Senior Science continuation for newly aligned catalogue entries. */
  atarPathway?: AtarPathwayDefinition;
  /** Explicit descriptor subcoverage statement; also mirrored in limitations for current UI. */
  partialCoverageNote?: string;
}
