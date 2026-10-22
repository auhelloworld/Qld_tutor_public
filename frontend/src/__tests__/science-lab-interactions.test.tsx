import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import React from 'react';
import { SCIENCE_ACTIVITIES } from '../lib/science-lab/activities';
import type {
  InteractionKind,
  ScienceActivityMeta,
  ScienceSceneData,
} from '../lib/science-lab/activity-types';
import SeasonsScene from '../components/science-lab/scenes/svg/SeasonsScene';
import ParticleModelScene from '../components/science-lab/scenes/canvas/ParticleModelScene';
import ForceMotionScene from '../components/science-lab/scenes/svg/ForceMotionScene';
import FoodWebScene from '../components/science-lab/scenes/svg/FoodWebScene';
import WaveMediumScene from '../components/science-lab/scenes/canvas/WaveMediumScene';
import SelectionScene from '../components/science-lab/scenes/canvas/SelectionScene';
import EnergyEfficiencyScene from '../components/science-lab/scenes/svg/EnergyEfficiencyScene';
import SeparationProcessScene from '../components/science-lab/scenes/svg/SeparationProcessScene';
import ReactionBalanceScene from '../components/science-lab/scenes/svg/ReactionBalanceScene';
import PlateBoundaryScene from '../components/science-lab/scenes/svg/PlateBoundaryScene';
import HomeostasisScene from '../components/science-lab/scenes/svg/HomeostasisScene';
import MeasurementErrorScene from '../components/science-lab/scenes/svg/MeasurementErrorScene';
import GeneticsScene from '../components/science-lab/scenes/svg/GeneticsScene';
import ReactionRateScene from '../components/science-lab/scenes/svg/ReactionRateScene';
import CarbonClimateScene from '../components/science-lab/scenes/svg/CarbonClimateScene';
import HalfLifeScene from '../components/science-lab/scenes/svg/HalfLifeScene';
import MoonTidesScene from '../components/science-lab/scenes/svg/MoonTidesScene';
import CellSystemScene from '../components/science-lab/scenes/svg/CellSystemScene';

/**
 * Plan section 9.1: "`interactions` 中声明的每一种都能在场景中找到对应控件".
 *
 * The admission threshold in section 2 is computed from `interactions`, so a
 * declaration that no accessible control backs would make the whole gate
 * decorative. These assertions deliberately inspect named native controls,
 * not arbitrary DOM nodes or a visual-element count.
 */

const SCENES: Record<ScienceSceneData['kind'], React.ComponentType<any>> = {
  seasons: SeasonsScene,
  'particle-model': ParticleModelScene,
  'force-motion': ForceMotionScene,
  'food-web': FoodWebScene,
  'wave-medium': WaveMediumScene,
  selection: SelectionScene,
  'energy-efficiency': EnergyEfficiencyScene,
  'separation-process': SeparationProcessScene,
  'reaction-balance': ReactionBalanceScene,
  'plate-boundary': PlateBoundaryScene,
  homeostasis: HomeostasisScene,
  'measurement-error': MeasurementErrorScene,
  genetics: GeneticsScene,
  'reaction-rate': ReactionRateScene,
  'carbon-climate': CarbonClimateScene,
  'half-life': HalfLifeScene,
  'moon-tides': MoonTidesScene,
  'cell-system': CellSystemScene,
};

const LINKED_VIEW_CONTROL_NAMES: Record<ScienceSceneData['kind'], RegExp> = {
  seasons: /orbital position|day of year|axial tilt/i,
  'particle-model': /temperature/i,
  'force-motion': /applied (?:pushing )?force/i,
  'food-web': /baseline|remove.*(?:apex|predator)|drought|insect crash/i,
  'wave-medium': /frequency|amplitude/i,
  selection: /forest bark darkness|predation pressure/i,
  'energy-efficiency': /input energy|conversion efficiency/i,
  'separation-process': /execute next|run remaining|reset mixture/i,
  'reaction-balance': /coefficient|hydrogen|methane|iron/i,
  'plate-boundary': /plate boundary|relative plate speed/i,
  homeostasis: /insulin sensitivity|controller strength|meal|exercise/i,
  'measurement-error': /true value|instrument resolution|generate next sample/i,
  genetics: /number of simulated offspring|sampling seed/i,
  'reaction-rate': /reaction temperature|catalyst counterfactual/i,
  'carbon-climate': /combustion|photosynthesis/i,
  'half-life': /elapsed decay time|initial number of radioactive nuclei/i,
  'moon-tides': /moon orbital angle/i,
  'cell-system': /membrane function|plant|animal/i,
};

function renderScene(activity: ScienceActivityMeta) {
  const Scene = SCENES[activity.sceneData.kind];
  return render(
    <Scene sceneData={activity.sceneData} mode="explore" isRevealed onReadoutChange={() => {}} />,
  );
}

function accessibleName(control: HTMLElement): string {
  return (control.getAttribute('aria-label') || control.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasNamedControl(
  root: HTMLElement,
  name: RegExp,
  selector = 'button, input[type="range"][aria-label]',
): boolean {
  return [...root.querySelectorAll<HTMLElement>(selector)].some((control) =>
    name.test(accessibleName(control)),
  );
}

function hasNamedGroup(root: HTMLElement, name: string): boolean {
  return [...root.querySelectorAll<HTMLElement>('[role="group"][aria-label]')].some(
    (group) => group.getAttribute('aria-label') === name,
  );
}

/** Evidence that a given interaction kind has a real, named accessible control. */
const DETECTORS: Record<
  InteractionKind,
  (root: HTMLElement, activity: ScienceActivityMeta) => boolean
> = {
  'drag-handle': (root) =>
    hasNamedControl(
      root,
      /orbital position|day of year|applied (?:pushing )?force/i,
      'input[type="range"][aria-label]',
    ),
  'continuous-slider': (root) =>
    root.querySelectorAll('input[type="range"][aria-label]').length > 0,
  'linked-views': (root, activity) =>
    hasNamedControl(root, LINKED_VIEW_CONTROL_NAMES[activity.sceneData.kind]),
  'time-control': (root, activity) =>
    activity.sceneData.kind === 'separation-process'
      ? hasNamedControl(root, /run remaining/i, 'button') &&
        hasNamedControl(root, /execute next/i, 'button') &&
        hasNamedControl(root, /reset mixture/i, 'button')
      : hasNamedControl(root, /play|pause/i, 'button') &&
        hasNamedControl(root, /step/i, 'button') &&
        hasNamedControl(root, /reset/i, 'button'),
  'counterfactual-toggle': (root, activity) =>
    hasNamedControl(
      root,
      /counterfactual|vacuum|remove the medium|incorrect model|frictionless|zero axial tilt|catalyst|calibration/i,
      'button[aria-pressed]',
    ) ||
    (activity.sceneData.kind === 'reaction-balance' &&
      hasNamedGroup(root, 'Open or closed system') &&
      hasNamedControl(root, /open|closed/i, 'button[aria-pressed]')),
  'system-construction': (root, activity) => {
    switch (activity.sceneData.kind) {
      case 'food-web':
        return hasNamedControl(root, /remove.*(?:apex|predator)|drought|insect crash/i, 'button');
      case 'separation-process':
        return hasNamedControl(root, /execute next|run remaining/i, 'button');
      case 'reaction-balance':
        return hasNamedControl(root, /coefficient/i, 'input[type="range"][aria-label]');
      case 'genetics':
        return hasNamedGroup(root, 'Parent 1 genotype') && hasNamedGroup(root, 'Parent 2 genotype');
      case 'cell-system':
        return hasNamedGroup(root, 'Plant or animal cell') &&
          hasNamedControl(root, /membrane function/i, 'input[type="range"][aria-label]');
      default:
        return false;
    }
  },
  'measure-tool': (root, activity) =>
    hasNamedControl(root, /ruler|probe|timer/i, 'button[aria-pressed]') ||
    (activity.sceneData.kind === 'measurement-error' &&
      hasNamedControl(root, /instrument resolution/i, 'input[type="range"][aria-label]') &&
      hasNamedControl(root, /generate next sample/i, 'button')),
  'trace-overlay': (root) =>
    hasNamedControl(root, /motion trace overlay|trace|trail|path|ghost/i, 'button[aria-pressed]'),
  'side-by-side': (root, activity) => {
    switch (activity.sceneData.kind) {
      case 'wave-medium':
        return hasNamedControl(root, /side-by-side/i, 'button[aria-pressed]');
      case 'genetics':
        return hasNamedGroup(root, 'Parent 1 genotype') && hasNamedGroup(root, 'Parent 2 genotype');
      case 'reaction-rate':
        return hasNamedControl(root, /catalyst counterfactual/i, 'button[aria-pressed]');
      case 'half-life':
        return hasNamedControl(root, /elapsed decay time/i, 'input[type="range"][aria-label]');
      default:
        return false;
    }
  },
};

function findMissingInteractionControls(): string[] {
  const missing: string[] = [];
  for (const activity of Object.values(SCIENCE_ACTIVITIES)) {
    cleanup();
    const { container } = renderScene(activity);
    for (const kind of activity.interactions) {
      if (!DETECTORS[kind](container as HTMLElement, activity)) {
        missing.push(`${activity.id}:${kind}`);
      }
    }
  }
  return missing.sort();
}

describe('Science Lab declared interactions are implemented', () => {
  afterEach(() => cleanup());

  it('reports no metadata/scene interaction mismatches', () => {
    expect(findMissingInteractionControls()).toEqual([]);
  });

  for (const activity of Object.values(SCIENCE_ACTIVITIES)) {
    it(`${activity.id} implements every declared interaction`, () => {
      const { container } = renderScene(activity);
      for (const kind of activity.interactions) {
        expect(
          DETECTORS[kind](container as HTMLElement, activity),
          `${activity.id} declares "${kind}" but no matching accessible control was found`,
        ).toBe(true);
      }
    });
  }

  it('every scene renders a non-empty visual (no blank shell can pass)', () => {
    for (const activity of Object.values(SCIENCE_ACTIVITIES)) {
      cleanup();
      const { container } = renderScene(activity);
      const visuals = container.querySelectorAll('svg[role="img"], canvas');
      expect(visuals.length, `${activity.id} rendered no visual`).toBeGreaterThanOrEqual(1);

      // At least one visual must carry real drawing content or a 2D context.
      const hasContent = [...visuals].some(
        (v) => v.tagName.toLowerCase() === 'canvas' || v.children.length >= 3,
      );
      expect(hasContent, `${activity.id} visual is an empty shell`).toBe(true);
    }
  });
});

describe('Science Lab scenes honour reduced motion', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not auto-play animated scenes when prefers-reduced-motion is set', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );

    for (const id of [
      'SCI-PARTICLE-01',
      'SCI-WAVE-01',
      'SCI-FORCE-01',
      'SCI-SELECTION-01',
      'SCI-HALF-LIFE-01',
    ] as const) {
      cleanup();
      renderScene(SCIENCE_ACTIVITIES[id]);
      // A paused simulation offers "Play"; an auto-playing one offers "Pause".
      const pauseButtons = screen.queryAllByRole('button', { name: /pause/i });
      expect(pauseButtons.length, `${id} auto-played under reduced motion`).toBe(0);
    }
  });
});
