import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { SCIENCE_ACTIVITIES } from '../lib/science-lab/activities';
import { SCIENCE_LAB_LIMITS } from '../lib/science-lab/performance';
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
import type { ScienceSceneData } from '../lib/science-lab/activity-types';

/**
 * Layout contract for Science Lab visuals.
 *
 * Browser measurement at a 768px viewport found the previous
 * `width: 100%` + `max-height: Npx` pattern stretched canvases horizontally by
 * up to 1.81x (canvas bitmap 380x180 rendered into a 686x180 CSS box) and left
 * SVG diagrams drawn at their intrinsic size inside a much wider box (386px of
 * dead width on the seasons views). Both are learning defects: a stretched
 * particle field implies anisotropic motion, and a stretched wave desynchronises
 * the on-screen wavelength from the measured readout.
 *
 * These tests lock the fix in source so it cannot silently regress.
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

const SCENE_DIR = path.resolve(__dirname, '..', 'components', 'science-lab', 'scenes');
const SCENE_FILES = [
  path.join(SCENE_DIR, 'svg', 'SeasonsScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'ForceMotionScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'FoodWebScene.tsx'),
  path.join(SCENE_DIR, 'canvas', 'ParticleModelScene.tsx'),
  path.join(SCENE_DIR, 'canvas', 'WaveMediumScene.tsx'),
  path.join(SCENE_DIR, 'canvas', 'SelectionScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'EnergyEfficiencyScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'SeparationProcessScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'ReactionBalanceScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'PlateBoundaryScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'HomeostasisScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'MeasurementErrorScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'GeneticsScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'ReactionRateScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'CarbonClimateScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'HalfLifeScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'MoonTidesScene.tsx'),
  path.join(SCENE_DIR, 'svg', 'CellSystemScene.tsx'),
];

describe('Science Lab visual sizing contract', () => {
  afterEach(() => cleanup());

  it('no scene caps a visual with maxHeight (the source of letterboxing and stretching)', () => {
    for (const file of SCENE_FILES) {
      const source = fs.readFileSync(file, 'utf-8');
      // Control panels may scroll; visuals may not be height-capped.
      const offenders = source
        .split('\n')
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter((entry) => /maxHeight/.test(entry.line));
      expect(
        offenders,
        `${path.basename(file)} still caps a visual height: ${JSON.stringify(offenders)}`,
      ).toEqual([]);
    }
  });

  it('every canvas is sized by the shared dpr-aware hook, never by width/height attributes', () => {
    for (const file of SCENE_FILES) {
      const source = fs.readFileSync(file, 'utf-8');
      if (!source.includes('<canvas')) continue;
      expect(
        source.includes('useSceneCanvas'),
        `${path.basename(file)} must size its canvas through useSceneCanvas`,
      ).toBe(true);
      expect(
        /<canvas[\s\S]{0,240}?\swidth=\{/.test(source),
        `${path.basename(file)} still sets a fixed canvas width attribute`,
      ).toBe(false);
    }
  });

  it('every rendered visual carries a viewBox or the aspect-preserving canvas style', () => {
    for (const activity of Object.values(SCIENCE_ACTIVITIES)) {
      cleanup();
      const Scene = SCENES[activity.sceneData.kind];
      const { container } = render(
        <Scene sceneData={activity.sceneData} mode="explore" isRevealed onReadoutChange={() => {}} />,
      );

      for (const svg of container.querySelectorAll('svg[role="img"]')) {
        expect(
          svg.getAttribute('viewBox'),
          `${activity.id} has an SVG visual without a viewBox`,
        ).toBeTruthy();
        expect(
          svg.getAttribute('class') || '',
          `${activity.id} SVG visual must use the science-scene-svg sizing contract`,
        ).toContain('science-scene-svg');
      }

      for (const canvas of container.querySelectorAll('canvas')) {
        const style = canvas.getAttribute('style') || '';
        expect(style, `${activity.id} canvas must declare an aspect-ratio`).toMatch(/aspect-ratio/i);
        expect(
          canvas.hasAttribute('width'),
          `${activity.id} canvas must not hardcode a bitmap width attribute in markup`,
        ).toBe(false);
      }
    }
  });

  it('renders bounded, non-empty visual content for every activity', () => {
    for (const activity of Object.values(SCIENCE_ACTIVITIES)) {
      cleanup();
      const Scene = SCENES[activity.sceneData.kind];
      const { container } = render(
        <Scene sceneData={activity.sceneData} mode="explore" isRevealed onReadoutChange={() => {}} />,
      );

      const svgPrimitives = container.querySelectorAll(
        'svg circle, svg rect, svg line, svg path, svg polygon, svg ellipse, svg text',
      ).length;
      const canvasCount = container.querySelectorAll('canvas').length;

      // Non-empty lower bound: a blank shell must not pass. Canvas-only scenes
      // draw imperatively (jsdom has no 2D context), so the canvas element plus
      // its aspect contract is the evidence there; SVG scenes must show real
      // drawing primitives.
      if (canvasCount === 0) {
        expect(
          svgPrimitives,
          `${activity.id} rendered no drawing primitives`,
        ).toBeGreaterThanOrEqual(4);
      } else {
        expect(canvasCount, `${activity.id} rendered no canvas`).toBeGreaterThanOrEqual(1);
      }

      // Upper budget bound from the plan's resource limits.
      expect(
        svgPrimitives,
        `${activity.id} exceeds the SVG primitive budget`,
      ).toBeLessThanOrEqual(SCIENCE_LAB_LIMITS.svgPrimitives);
    }
  });
});

describe('Science Lab page layout is shrinkable to 320px', () => {
  const pageSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'science-lab', 'page.tsx'),
    'utf-8',
  );
  const cssSource = fs.readFileSync(path.resolve(__dirname, '..', 'app', 'globals.css'), 'utf-8');

  it('does not use a grid track with a fixed minimum wider than 320px', () => {
    // `repeat(auto-fit, minmax(360px, 1fr))` forced a 360px track and produced a
    // measured 373px scrollWidth at a 320px viewport on all six activities.
    const offenders = [...pageSource.matchAll(/minmax\(\s*(\d+)px/g)].filter(
      (m) => Number(m[1]) > 320,
    );
    expect(offenders.map((m) => m[0]), 'page.tsx must not pin a track wider than 320px').toEqual([]);
  });

  it('declares the learn grid in CSS with shrinkable tracks and a mobile fallback', () => {
    expect(pageSource).toContain('science-lab-learn-grid');
    expect(cssSource).toContain('.science-lab-learn-grid');
    const block = cssSource.slice(cssSource.indexOf('.science-lab-learn-grid'));
    expect(block).toContain('minmax(0,');
    expect(block).toMatch(/@media \(min-width: 1024px\)/);
  });

  it('resolves scenes through the renderer registry rather than a per-kind branch', () => {
    expect(pageSource).toContain('SCIENCE_RENDERERS');
    // A hardcoded dispatch chain would let the registry drift out of production use.
    const kindBranches = [...pageSource.matchAll(/sceneData\.kind === '/g)].length;
    expect(kindBranches, 'page.tsx should not branch per scene kind').toBe(0);
  });

  it('keeps a legible floor for scene labels on narrow phones', () => {
    // Measured: without a floor, a 320px viewport drew scenes at ~260 logical px,
    // scaling 12px labels to ~7px. The floor plus in-figure horizontal scroll
    // raised the smallest measured label to 9.5px with no document overflow.
    const narrow = cssSource.slice(cssSource.indexOf('@media (max-width: 520px)'));
    expect(narrow, 'missing narrow-screen legibility rule').toContain('min-width: 380px');
    expect(narrow).toContain('overflow-x: auto');
    expect(
      narrow.includes('.science-scene-svg') && narrow.includes('.science-scene-canvas'),
      'the legibility floor must cover both SVG and canvas visuals',
    ).toBe(true);
  });

  it('keeps the activity card grid shrinkable below 340px', () => {
    const directorySource = fs.readFileSync(
      path.resolve(__dirname, '..', 'components', 'science-lab', 'ScienceLabDirectory.tsx'),
      'utf-8',
    );
    expect(directorySource).toContain('science-lab-card-grid');
    expect(
      /minmax\(\s*340px/.test(directorySource),
      'directory must not pin a 340px track inline (measured 369px scrollWidth at 320px)',
    ).toBe(false);
    expect(cssSource).toContain('.science-lab-card-grid');
  });
});
