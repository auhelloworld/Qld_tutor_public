import type React from 'react';
import type { ScienceSceneData } from './activity-types';

export interface ScienceSceneProps<TData extends ScienceSceneData = ScienceSceneData> {
  sceneData: TData;
  onSceneDataChange?: (patch: Partial<TData>) => void;
  mode?: 'learn' | 'explore';
  activeStepIndex?: number;
  readouts?: Record<string, string | number>;
  onReadoutChange?: (readouts: Record<string, string | number>) => void;
  /**
   * False until the student submits their prediction. Scenes MUST keep the
   * quantitative result that answers the prediction hidden while this is false
   * (plan section 5: "预测提交前不揭示关键结果"). Controls and the qualitative
   * visualisation stay usable so the student can still explore.
   * Explore mode passes `true`.
   */
  isRevealed?: boolean;
}

export type SceneComponent<TData extends ScienceSceneData = ScienceSceneData> =
  React.ComponentType<ScienceSceneProps<TData>>;

export type ScienceRendererRegistry = {
  [K in ScienceSceneData['kind']]: () => Promise<{ default: SceneComponent<Extract<ScienceSceneData, { kind: K }>> }>;
};

export const SCIENCE_RENDERERS = {
  'seasons': () => import('../../components/science-lab/scenes/svg/SeasonsScene'),
  'particle-model': () => import('../../components/science-lab/scenes/canvas/ParticleModelScene'),
  'force-motion': () => import('../../components/science-lab/scenes/svg/ForceMotionScene'),
  'food-web': () => import('../../components/science-lab/scenes/svg/FoodWebScene'),
  'wave-medium': () => import('../../components/science-lab/scenes/canvas/WaveMediumScene'),
  'selection': () => import('../../components/science-lab/scenes/canvas/SelectionScene'),
  'energy-efficiency': () => import('../../components/science-lab/scenes/svg/EnergyEfficiencyScene'),
  'separation-process': () => import('../../components/science-lab/scenes/svg/SeparationProcessScene'),
  'reaction-balance': () => import('../../components/science-lab/scenes/svg/ReactionBalanceScene'),
  'plate-boundary': () => import('../../components/science-lab/scenes/svg/PlateBoundaryScene'),
  'homeostasis': () => import('../../components/science-lab/scenes/svg/HomeostasisScene'),
  'measurement-error': () => import('../../components/science-lab/scenes/svg/MeasurementErrorScene'),
  'genetics': () => import('../../components/science-lab/scenes/svg/GeneticsScene'),
  'reaction-rate': () => import('../../components/science-lab/scenes/svg/ReactionRateScene'),
  'carbon-climate': () => import('../../components/science-lab/scenes/svg/CarbonClimateScene'),
  'half-life': () => import('../../components/science-lab/scenes/svg/HalfLifeScene'),
  'moon-tides': () => import('../../components/science-lab/scenes/svg/MoonTidesScene'),
  'cell-system': () => import('../../components/science-lab/scenes/svg/CellSystemScene'),
} satisfies ScienceRendererRegistry;
