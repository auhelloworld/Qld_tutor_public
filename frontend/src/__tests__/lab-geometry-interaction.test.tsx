/**
 * Geometry P1 interaction/reset contract tests.
 *
 * Verifies:
 * 1. GeometryExtensionsLab converts mode→interaction and passes it to all 5 scenes
 * 2. Explore: Mafs receives pan=true, zoom={min:.5,max:4}, Reset view is present
 * 3. Learn: Mafs receives pan=false, zoom=false, no Reset view
 * 4. UnitCircle follows the same contract (was previously hardcoded static)
 * 5. MafsStage Reset proves subtree remount via data-mafs-mount-id change
 * 6. Observable drift-prevention: wrapper interaction must match child Mafs pan/zoom
 */

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// --- Mafs mock that passes pan/zoom as data attributes for contract assertion ---
interface MafsMockProps {
  children?: ReactNode;
  pan?: boolean;
  zoom?: boolean | { min: number; max: number };
}

vi.mock('mafs', () => ({
  Mafs: ({ children, pan, zoom }: MafsMockProps) => (
    <div
      data-testid="mafs"
      data-pan={String(Boolean(pan))}
      data-zoom={typeof zoom === 'object' ? `${zoom.min}-${zoom.max}` : String(Boolean(zoom))}
    >
      {children}
    </div>
  ),
  Coordinates: {
    Cartesian: () => <div data-testid="coordinates" />,
    Polar: () => <div data-testid="polar-coordinates" />,
  },
  MovablePoint: () => <div data-testid="movable-point" />,
  Point: () => <div data-testid="point" />,
  Circle: () => <div data-testid="circle" />,
  Polygon: () => <div data-testid="polygon" />,
  Text: ({ children }: { children?: ReactNode }) => <span data-testid="mafs-text">{children}</span>,
  Line: {
    Segment: () => <div data-testid="line-segment" />,
    ThroughPoints: () => <div data-testid="line-through-points" />,
    PointAngle: () => <div data-testid="line-point-angle" />,
    PointSlope: () => <div data-testid="line-point-slope" />,
  },
  Plot: {
    OfX: () => <div data-testid="plot-of-x" />,
    OfY: () => <div data-testid="plot-of-y" />,
    Inequality: () => <div data-testid="plot-inequality" />,
    Parametric: () => <div data-testid="plot-parametric" />,
    VectorField: () => <div data-testid="plot-vector-field" />,
  },
  Vector: () => <div data-testid="vector" />,
  Transform: ({ children }: { children?: ReactNode }) => <div data-testid="transform">{children}</div>,
  LaTeX: () => <div data-testid="latex" />,
  Ellipse: () => <div data-testid="ellipse" />,
  Polyline: () => <div data-testid="polyline" />,
  labelPi: (x: number) => String(x),
  Theme: { foreground: '#000', background: '#fff', red: '#f00', blue: '#00f', green: '#0f0', orange: '#f80', indigo: '#40f', violet: '#80f', pink: '#f0f', yellow: '#ff0' },
}));

import GeometryTab from '../components/lab/GeometryTab';
import MafsStage from '../components/lab/MafsStage';
import type { LabActivityId } from '../lib/lab-activities';

// ─── 5 Geometry topics ────────────────────────────────────────────────────────

const GEOMETRY_EXTENSION_TOPICS: LabActivityId[] = [
  'geometry-circle-scaling',
  'geometry-pythagoras',
  'geometry-sohcahtoa',
  'geometry-unit-circle',
  'geometry-similarity-ratio',
];

// ─── Helper ───────────────────────────────────────────────────────────────────

function renderExplore(activityId: LabActivityId) {
  return render(
    <GeometryTab isExact mafsHeight={320} mode="explore" activityId={activityId} />
  );
}

function renderLearn(activityId: LabActivityId) {
  return render(
    <GeometryTab
      isExact
      mafsHeight={320}
      mode="learn"
      activityId={activityId}
      onActivityComplete={vi.fn()}
      onExitLearn={vi.fn()}
    />
  );
}

// ─── Section 1: Explore mode — pan, zoom, and Reset view ─────────────────────

describe('Geometry Explore interaction contract (all 5 extension topics)', () => {
  GEOMETRY_EXTENSION_TOPICS.forEach((topicId) => {
    it(`${topicId} Explore: Mafs pan=true, zoom={min:0.5,max:4}`, () => {
      const { container } = renderExplore(topicId);
      const mafsEl = container.querySelector('[data-testid="mafs"]');
      expect(mafsEl).toBeTruthy();
      expect(mafsEl!.getAttribute('data-pan')).toBe('true');
      expect(mafsEl!.getAttribute('data-zoom')).toBe('0.5-4');
      cleanup();
    });

    it(`${topicId} Explore: shows Reset view button`, () => {
      renderExplore(topicId);
      expect(screen.getByRole('button', { name: 'Reset view' })).toBeTruthy();
      cleanup();
    });

    it(`${topicId} Explore: MafsStage wrapper has data-interaction="explore"`, () => {
      const { container } = renderExplore(topicId);
      const stage = container.querySelector('[data-interaction="explore"]');
      expect(stage).toBeTruthy();
      cleanup();
    });
  });
});

// ─── Section 2: Learn mode — static, no pan, no zoom, no Reset ───────────────

describe('Geometry Learn interaction contract (all 5 extension topics)', () => {
  GEOMETRY_EXTENSION_TOPICS.forEach((topicId) => {
    it(`${topicId} Learn: Mafs pan=false, zoom=false`, () => {
      const { container } = renderLearn(topicId);
      const mafsEl = container.querySelector('[data-testid="mafs"]');
      expect(mafsEl).toBeTruthy();
      expect(mafsEl!.getAttribute('data-pan')).toBe('false');
      expect(mafsEl!.getAttribute('data-zoom')).toBe('false');
      cleanup();
    });

    it(`${topicId} Learn: no Reset view button`, () => {
      renderLearn(topicId);
      expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
      cleanup();
    });

    it(`${topicId} Learn: MafsStage wrapper has data-interaction="static"`, () => {
      const { container } = renderLearn(topicId);
      const stage = container.querySelector('[data-interaction="static"]');
      expect(stage).toBeTruthy();
      cleanup();
    });
  });
});

// ─── Section 3: MafsStage reset proves subtree remount via mount-id change ───

describe('MafsStage Reset view remount proof', () => {
  it('clicking Reset view increments data-mafs-mount-id (proving key-based remount)', () => {
    const { container } = render(
      <MafsStage mafsHeight={300} interaction="explore">
        <div data-testid="inner">content</div>
      </MafsStage>
    );

    const getMountId = () =>
      container.querySelector('.mafs-container')!.getAttribute('data-mafs-mount-id');

    const mountBefore = container.querySelector('.mafs-container')!;
    const idBefore = getMountId();
    expect(idBefore).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));

    const mountAfter = container.querySelector('.mafs-container')!;
    const idAfter = getMountId();
    expect(idAfter).toBe('1');
    expect(idAfter).not.toBe(idBefore);
    expect(mountAfter).not.toBe(mountBefore);
  });

  it('multiple resets increment mount-id monotonically', () => {
    const { container } = render(
      <MafsStage mafsHeight={300} interaction="explore">
        <div>content</div>
      </MafsStage>
    );

    const getMountId = () =>
      Number(container.querySelector('.mafs-container')!.getAttribute('data-mafs-mount-id'));

    expect(getMountId()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(getMountId()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(getMountId()).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(getMountId()).toBe(3);
  });

  it('static mode has no reset button and mount-id stays at 0', () => {
    const { container } = render(
      <MafsStage mafsHeight={300} interaction="static">
        <div>content</div>
      </MafsStage>
    );

    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
    expect(container.querySelector('.mafs-container')!.getAttribute('data-mafs-mount-id')).toBe('0');
  });

  it('reset in Geometry Explore actually remounts the Mafs subtree', () => {
    renderExplore('geometry-circle-scaling');
    const container = document.querySelector('[data-mafs-mount-id]')!;
    expect(container.getAttribute('data-mafs-mount-id')).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    const containerAfter = document.querySelector('[data-mafs-mount-id]')!;
    expect(containerAfter.getAttribute('data-mafs-mount-id')).toBe('1');
    expect(containerAfter).not.toBe(container);
  });
});

// ─── Section 4: UnitCircle specifically follows the contract ─────────────────

describe('UnitCircle interaction contract (was previously hardcoded static)', () => {
  it('UnitCircle Explore: pan=true, zoom bounded, Reset present', () => {
    const { container } = renderExplore('geometry-unit-circle');
    const mafsEl = container.querySelector('[data-testid="mafs"]');
    expect(mafsEl!.getAttribute('data-pan')).toBe('true');
    expect(mafsEl!.getAttribute('data-zoom')).toBe('0.5-4');
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeTruthy();
  });

  it('UnitCircle Learn: pan=false, zoom=false, no Reset', () => {
    const { container } = renderLearn('geometry-unit-circle');
    const mafsEl = container.querySelector('[data-testid="mafs"]');
    expect(mafsEl!.getAttribute('data-pan')).toBe('false');
    expect(mafsEl!.getAttribute('data-zoom')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
  });
});

// ─── Section 5: Drift-prevention observable contract ─────────────────────────
//
// Contract: When MafsStage.data-interaction="explore", the contained Mafs MUST
// have data-pan="true" and data-zoom="0.5-4". When data-interaction="static",
// Mafs MUST have data-pan="false" and data-zoom="false".
//
// This verifies the wrapper-to-child consistency that prevents silent drift.

describe('Geometry interaction drift-prevention contract', () => {
  GEOMETRY_EXTENSION_TOPICS.forEach((topicId) => {
    it(`${topicId}: Explore wrapper interaction=explore implies Mafs pan=true & zoom=0.5-4`, () => {
      const { container } = renderExplore(topicId);
      const stage = container.querySelector('[data-interaction="explore"]');
      expect(stage).toBeTruthy();
      const mafsInStage = stage!.querySelector('[data-testid="mafs"]');
      expect(mafsInStage).toBeTruthy();
      expect(mafsInStage!.getAttribute('data-pan')).toBe('true');
      expect(mafsInStage!.getAttribute('data-zoom')).toBe('0.5-4');
      cleanup();
    });

    it(`${topicId}: Learn wrapper interaction=static implies Mafs pan=false & zoom=false`, () => {
      const { container } = renderLearn(topicId);
      const stage = container.querySelector('[data-interaction="static"]');
      expect(stage).toBeTruthy();
      const mafsInStage = stage!.querySelector('[data-testid="mafs"]');
      expect(mafsInStage).toBeTruthy();
      expect(mafsInStage!.getAttribute('data-pan')).toBe('false');
      expect(mafsInStage!.getAttribute('data-zoom')).toBe('false');
      cleanup();
    });
  });
});
