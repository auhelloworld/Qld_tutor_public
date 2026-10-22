import React from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { SCIENCE_ACTIVITIES } from '../lib/science-lab/activities';
import type {
  ControlDefinition,
  ScienceActivityMeta,
  ScienceSceneData,
} from '../lib/science-lab/activity-types';
import {
  SCIENCE_RENDERERS,
  type ScienceSceneProps,
} from '../lib/science-lab/renderer-registry';
import { SCIENCE_LAB_LIMITS } from '../lib/science-lab/performance';
import { initSelectionState } from '../lib/science-lab/models/selection';
import { calculateCarbonClimate } from '../lib/science-lab/models/carbon-climate';

const ACTIVITIES = Object.values(SCIENCE_ACTIVITIES);
const SVG_PRIMITIVES =
  'svg circle, svg ellipse, svg line, svg path, svg polygon, svg polyline, svg rect, svg text, svg use';

type ObservationValue = string | number;
type ReadoutCallback = (readouts: Record<string, ObservationValue>) => void;
type MaybeDisplayOnlyControl = ControlDefinition & {
  displayOnly?: boolean;
  displayOnlyReason?: string;
};

let animationFrameRequests = 0;
let workerConstructions = 0;
let requestedCanvasContexts: string[] = [];

class WorkerBudgetProbe {
  constructor() {
    workerConstructions += 1;
  }

  terminate() {}
  postMessage() {}
  addEventListener() {}
  removeEventListener() {}
}

function reducedMotionMatchMedia(query: string): MediaQueryList {
  return {
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList;
}

beforeEach(() => {
  animationFrameRequests = 0;
  workerConstructions = 0;
  requestedCanvasContexts = [];

  vi.stubGlobal('matchMedia', reducedMotionMatchMedia);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => {
    animationFrameRequests += 1;
    return animationFrameRequests;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('Worker', WorkerBudgetProbe);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    ((contextId: string) => {
      requestedCanvasContexts.push(contextId);
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function loadScene(activity: ScienceActivityMeta) {
  const loadedModule = await SCIENCE_RENDERERS[activity.sceneData.kind]();
  return loadedModule.default as React.ComponentType<ScienceSceneProps>;
}

async function renderScene(
  activity: ScienceActivityMeta,
  options: {
    isRevealed?: boolean;
    onReadoutChange?: ReadoutCallback;
    sceneData?: ScienceSceneData;
  } = {},
) {
  const Scene = await loadScene(activity);
  const onReadoutChange = options.onReadoutChange ?? vi.fn<ReadoutCallback>();
  const view = render(
    <Scene
      sceneData={options.sceneData ?? activity.sceneData}
      mode="learn"
      isRevealed={options.isRevealed ?? false}
      onReadoutChange={onReadoutChange}
    />,
  );
  return { ...view, onReadoutChange };
}

function normalise(value: string): string {
  return value
    .toLocaleLowerCase('en-AU')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function labelledByText(element: HTMLElement): string[] {
  const ids = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  return ids
    .map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
    .filter(Boolean);
}

function controlNames(element: HTMLElement): string[] {
  const names = [element.getAttribute('aria-label') ?? '', ...labelledByText(element)];

  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
    names.push(...Array.from(element.labels ?? []).map((label) => label.textContent?.trim() ?? ''));
  }
  if (element instanceof HTMLButtonElement) {
    names.push(element.textContent?.trim() ?? '');
  }

  return [...new Set(names.map(normalise).filter(Boolean))];
}

function hasMetadataControl(
  root: HTMLElement,
  metadata: ControlDefinition,
): boolean {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('button, input, select, [role="group"]'),
  );
  const expectedNames = [metadata.label, metadata.ariaLabel].map(normalise);
  const metadataId = normalise(metadata.id);

  const directMatch = candidates.some((candidate) => {
    const candidateId = normalise(candidate.id);
    const idMatches = Boolean(candidateId)
      && (candidateId === metadataId || candidateId.startsWith(`${metadataId} `));
    const nameMatches = controlNames(candidate).some((name) =>
      expectedNames.some((expected) => name === expected || name.startsWith(`${expected} `)),
    );
    return idMatches || nameMatches;
  });
  if (directMatch) return true;

  // Select metadata is commonly implemented as a segmented button group. Match
  // the declared option set rather than depending on presentation wording.
  if (metadata.type === 'select' && metadata.options?.length) {
    const expectedOptions = metadata.options.map((option) => normalise(option.label));
    return candidates
      .filter((candidate) => candidate.getAttribute('role') === 'group')
      .some((group) => {
        const buttonNames = Array.from(group.querySelectorAll<HTMLButtonElement>('button'))
          .flatMap(controlNames);
        return expectedOptions.every((option) => buttonNames.includes(option));
      });
  }

  return false;
}

function svgAccessibleName(svg: SVGSVGElement): string {
  const ariaLabel = svg.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;

  const labelledBy = (svg.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => svg.ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  if (labelledBy) return labelledBy;

  return Array.from(svg.children)
    .find((child) => child.tagName.toLocaleLowerCase('en-AU') === 'title')
    ?.textContent?.trim() ?? '';
}

describe('Science Lab expanded renderer contracts', () => {
  it('has one registry loader for each of the 18 activity scene kinds', () => {
    const activityKinds = [...new Set(ACTIVITIES.map((activity) => activity.sceneData.kind))].sort();
    const registryKinds = Object.keys(SCIENCE_RENDERERS).sort();

    expect(ACTIVITIES).toHaveLength(18);
    expect(activityKinds).toHaveLength(18);
    expect(registryKinds).toEqual(activityKinds);
  });

  for (const activity of ACTIVITIES) {
    it(`${activity.id} resolves its registry loader and renders a non-empty scene`, async () => {
      const Scene = await loadScene(activity);
      expect(Scene, `${activity.id} loader did not resolve a default component`).toBeTypeOf('function');

      const { container } = await renderScene(activity);
      const canvases = container.querySelectorAll('canvas');
      const svgs = container.querySelectorAll('svg');
      const primitives = container.querySelectorAll(SVG_PRIMITIVES);

      expect(
        canvases.length + svgs.length,
        `${activity.id} rendered no SVG or Canvas visual`,
      ).toBeGreaterThan(0);
      if (canvases.length === 0) {
        expect(
          primitives.length,
          `${activity.id} rendered only an empty SVG shell`,
        ).toBeGreaterThanOrEqual(4);
      }
    });
  }
});

describe('Science Lab prediction gate contracts', () => {
  for (const activity of ACTIVITIES) {
    it(`${activity.id} publishes no Observation values while unrevealed`, async () => {
      const onReadoutChange = vi.fn<ReadoutCallback>();
      await renderScene(activity, { isRevealed: false, onReadoutChange });

      await waitFor(() => expect(onReadoutChange).toHaveBeenCalled());
      const leakedPayloads = onReadoutChange.mock.calls
        .map(([payload]) => payload)
        .filter((payload) => Object.keys(payload).length > 0);
      expect(
        leakedPayloads,
        `${activity.id} sent quantitative Observation data before prediction submission`,
      ).toEqual([]);
    });
  }

  it('does not expose Carbon Climate result-derived axis answers before reveal', async () => {
    const activity = SCIENCE_ACTIVITIES['SCI-CARBON-CLIMATE-01'];
    if (activity.sceneData.kind !== 'carbon-climate') {
      throw new Error('SCI-CARBON-CLIMATE-01 must use carbon-climate scene data');
    }
    const sceneData = {
      ...activity.sceneData,
      albedo: 0.2,
      greenhouseGasPpm: 800,
    };
    const result = calculateCarbonClimate(sceneData);
    const resultDerivedMaximum = Math.max(
      1,
      ...result.trajectory.map((point) => point.temperatureProxyC),
    ).toFixed(1);
    expect(Number(resultDerivedMaximum)).toBeGreaterThan(1);

    const { container } = await renderScene(activity, {
      isRevealed: false,
      sceneData,
    });
    const svgTextTokens = Array.from(container.querySelectorAll('svg text'))
      .map((node) => node.textContent?.trim() ?? '')
      .filter(Boolean);

    expect(
      svgTextTokens,
      `SCI-CARBON-CLIMATE-01 leaked the result-derived ${resultDerivedMaximum} °C axis maximum`,
    ).not.toContain(resultDerivedMaximum);
  });
});

describe('Science Lab control metadata contracts', () => {
  it('keeps Energy prediction, prompt, axis and accessible units in kJ', async () => {
    const activity = SCIENCE_ACTIVITIES['SCI-ENERGY-01'];
    const inputControl = activity.controls.find((control) => control.id === 'inputEnergyKJ');
    const manipulateStep = activity.learnSteps.find((step) => step.id === 'step-3-manipulate');

    expect(activity.prediction.question).toContain('100 kJ');
    expect(activity.prediction.question).toContain('65 kJ');
    expect(manipulateStep?.prompt).toContain('100 kJ');
    expect(inputControl?.unit).toBe('kJ');
    expect(inputControl?.ariaLabel).toBe('Input energy in kJ');

    const hidden = await renderScene(activity);
    const revealed = await renderScene(activity, { isRevealed: true });
    const input = hidden.container.querySelector<HTMLInputElement>('input[aria-label="Input energy in kJ"]');
    const hiddenSvg = hidden.container.querySelector<SVGSVGElement>('svg[role="img"]');
    const revealedSvg = revealed.container.querySelector<SVGSVGElement>('svg[role="img"]');

    expect(input).not.toBeNull();
    expect(hiddenSvg?.getAttribute('aria-label')).toContain('kJ');
    expect(revealedSvg?.getAttribute('aria-label')).toContain('kJ');
    expect(hiddenSvg?.getAttribute('aria-label')).not.toMatch(/kilojoules?/i);
    expect(revealedSvg?.getAttribute('aria-label')).not.toMatch(/kilojoules?/i);
    expect(hidden.container.textContent).toContain('Energy (kJ)');
    expect(revealed.container.textContent).toContain('100 kJ =');
  });

  it('declares the full Half-life model domain while the scene keeps its dynamic time range', async () => {
    const activity = SCIENCE_ACTIVITIES['SCI-HALF-LIFE-01'];
    if (activity.sceneData.kind !== 'half-life') {
      throw new Error('SCI-HALF-LIFE-01 must use the half-life scene model');
    }
    const elapsedControl = activity.controls.find(
      (control) => control.id === 'elapsedTimeSeconds',
    );

    expect(elapsedControl?.min).toBe(0);
    expect(elapsedControl?.max).toBe(600);

    const defaultScene = await renderScene(activity);
    const defaultElapsed = defaultScene.container.querySelector<HTMLInputElement>(
      'input[aria-label="Elapsed decay time in seconds"]',
    );
    expect(defaultElapsed?.min).toBe('0');
    expect(defaultElapsed?.max).toBe('100');

    const longestScene = await renderScene(activity, {
      sceneData: {
        ...activity.sceneData,
        halfLifeSeconds: 120,
      },
    });
    const longestElapsed = longestScene.container.querySelector<HTMLInputElement>(
      'input[aria-label="Elapsed decay time in seconds"]',
    );
    expect(longestElapsed?.min).toBe('0');
    expect(longestElapsed?.max).toBe('600');
  });

  for (const activity of ACTIVITIES) {
    it(`${activity.id} maps every declared control to accessible scene UI`, async () => {
      const { container } = await renderScene(activity);
      const drift: string[] = [];

      for (const definition of activity.controls as MaybeDisplayOnlyControl[]) {
        if (definition.displayOnly) {
          if (!definition.displayOnlyReason?.trim()) {
            drift.push(`${definition.id}: display-only metadata has no reason`);
          }
          continue;
        }
        if (!hasMetadataControl(container, definition)) {
          drift.push(`${definition.id}: “${definition.label}” / “${definition.ariaLabel}”`);
        }
      }

      expect(
        drift,
        `${activity.id} control declarations drifted from DOM ids, labels, accessible names, or declared option groups`,
      ).toEqual([]);
    });
  }

  for (const activity of ACTIVITIES) {
    it(`${activity.id} gives every segmented-control button aria-pressed`, async () => {
      const { container } = await renderScene(activity);
      const segmentedGroups = Array.from(container.querySelectorAll<HTMLElement>('[role="group"]'))
        .filter((group) => group.querySelectorAll(':scope > button').length > 1);

      const offenders = segmentedGroups.flatMap((group) =>
        Array.from(group.querySelectorAll<HTMLButtonElement>(':scope > button'))
          .filter((button) => !/^(true|false)$/.test(button.getAttribute('aria-pressed') ?? ''))
          .map((button) => ({
            group: group.getAttribute('aria-label') ?? '(unnamed group)',
            button: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '(unnamed button)',
          })),
      );

      expect(
        offenders,
        `${activity.id} has segmented buttons without a boolean aria-pressed state`,
      ).toEqual([]);
    });
  }
});

describe('Science Lab SVG accessibility contracts', () => {
  for (const activity of ACTIVITIES) {
    it(`${activity.id} gives every SVG image semantics, a viewBox, and a name`, async () => {
      const { container } = await renderScene(activity, { isRevealed: true });
      const svgs = Array.from(container.querySelectorAll<SVGSVGElement>('svg'));

      for (const [index, svg] of svgs.entries()) {
        expect(svg.getAttribute('role'), `${activity.id} SVG ${index + 1} has no image role`).toBe('img');
        expect(svg.getAttribute('viewBox')?.trim(), `${activity.id} SVG ${index + 1} has no viewBox`).toBeTruthy();
        expect(svgAccessibleName(svg), `${activity.id} SVG ${index + 1} has no accessible name`).toBeTruthy();
      }
    });
  }
});

describe('Science Lab expanded scene resource contracts', () => {
  for (const activity of ACTIVITIES) {
    it(`${activity.id} stays within observable SCIENCE_LAB_LIMITS`, async () => {
      const { container } = await renderScene(activity, { isRevealed: true });
      const primitiveCount = container.querySelectorAll(SVG_PRIMITIVES).length;

      expect(
        primitiveCount,
        `${activity.id} exceeds the SVG primitive budget`,
      ).toBeLessThanOrEqual(SCIENCE_LAB_LIMITS.svgPrimitives);

      for (const pointsElement of container.querySelectorAll<SVGElement>('polyline[points], polygon[points]')) {
        const pointCount = (pointsElement.getAttribute('points') ?? '')
          .trim()
          .split(/\s+/)
          .filter(Boolean).length;
        expect(
          pointCount,
          `${activity.id} has an SVG point series over the graph-point budget`,
        ).toBeLessThanOrEqual(SCIENCE_LAB_LIMITS.graphPoints);
      }

      for (const pathElement of container.querySelectorAll<SVGPathElement>('path[d]')) {
        const commandCount = (pathElement.getAttribute('d')?.match(/[a-z]/gi) ?? []).length;
        expect(
          commandCount,
          `${activity.id} has an SVG path series over the graph-point budget`,
        ).toBeLessThanOrEqual(SCIENCE_LAB_LIMITS.graphPoints);
      }

      if (activity.sceneData.kind === 'particle-model') {
        expect(activity.sceneData.particleCount).toBeLessThanOrEqual(SCIENCE_LAB_LIMITS.particles);
        expect(activity.sceneData.particleCount).toBeLessThanOrEqual(SCIENCE_LAB_LIMITS.canvasObjects);
      }
      if (activity.sceneData.kind === 'selection') {
        const selection = initSelectionState(
          activity.sceneData.initialFrequency,
          0.8,
          activity.sceneData.selectionPressure,
          100,
          activity.sceneData.seed,
        );
        expect(selection.population.length).toBeLessThanOrEqual(
          SCIENCE_LAB_LIMITS.populationIndividuals,
        );
        expect(selection.population.length).toBeLessThanOrEqual(SCIENCE_LAB_LIMITS.canvasObjects);
      }

      expect(animationFrameRequests).toBeLessThanOrEqual(SCIENCE_LAB_LIMITS.activeAnimationLoops);
      expect(workerConstructions).toBeLessThanOrEqual(SCIENCE_LAB_LIMITS.activeWorkers);
      expect(
        requestedCanvasContexts.filter((context) => /^webgl2?$/i.test(context)),
      ).toHaveLength(SCIENCE_LAB_LIMITS.activeWebGlContexts);
    });
  }
});
