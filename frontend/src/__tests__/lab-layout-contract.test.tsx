/**
 * Lab Layout Contract Test (S11)
 *
 * Verifies that all 6 Tab × (Explore, Learn) = 12 combinations conform to
 * the unified LabSceneLayout contract:
 * 1. Grid first child is `.lab-control-column`, second is `.lab-visual-column`
 * 2. `.lab-visual-column` contains no writable controls (except data-scene-footer)
 * 3. All writable controls are in `.lab-control-column` subtree or data-scene-footer
 * 4. Width contract: MafsStage card has no mafsHeight+32 maxWidth restriction
 * 5. Footer whitelist: only explicitly marked data-scene-footer elements are exempt
 * 6. Keyboard order: left column → canvas → footer → right readout
 */
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

afterEach(cleanup);

// --- mafs mock ---
vi.mock('mafs', () => ({
  Mafs: ({ children }: { children?: ReactNode }) => <div data-testid="mafs">{children}</div>,
  Coordinates: { Cartesian: () => <div data-testid="coordinates" />, Polar: () => <div /> },
  MovablePoint: () => <div data-testid="movable-point" />,
  Point: () => <div data-testid="point" />,
  Circle: () => <div data-testid="circle" />,
  Polygon: () => <div data-testid="polygon" />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Line: { Segment: () => <div />, ThroughPoints: () => <div />, PointAngle: () => <div />, PointSlope: () => <div /> },
  Plot: {
    OfX: () => <div data-testid="plot-of-x" />,
    OfY: () => <div />,
    Inequality: () => <div />,
    Parametric: () => <div />,
    VectorField: () => <div />,
  },
  Vector: () => <div />,
  Transform: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  LaTeX: () => <div />,
  Ellipse: () => <div />,
  labelPi: (x: number) => `${x}π`,
  Theme: {
    foreground: '#000000',
    background: '#ffffff',
    red: '#ff0000',
    orange: '#ff8800',
    green: '#00cc00',
    blue: '#0000ff',
    indigo: '#4400ff',
    violet: '#8800ff',
    pink: '#ff00ff',
    yellow: '#ffff00',
  },
}));

vi.mock('mathjs', () => ({
  parse: () => ({ evaluate: () => 0, compile: () => ({ evaluate: () => 0 }) }),
  compile: () => ({ evaluate: () => 0 }),
  evaluate: () => 0,
}));

vi.mock('../../src/lib/use-lab-variant', () => {
  const getSceneData = () => undefined;
  const newVariant = () => undefined;
  const result = {
    learnPanelProps: {},
    variantSeed: null,
    variantSteps: [],
    hasVariants: false,
    newVariant,
    getSceneData,
  };
  return { useLabVariant: () => result };
});

import ExplorerTab from '../components/lab/ExplorerTab';
import SandboxTab from '../components/lab/SandboxTab';
import CalculusTab from '../components/lab/CalculusTab';
import GeometryTab from '../components/lab/GeometryTab';
import StatisticsTab from '../components/lab/StatisticsTab';
import LinearAlgebraTab from '../components/lab/LinearAlgebraTab';

const noop = () => undefined;
const defaultProps = {
  mafsHeight: 400,
  isExact: true,
  onActivityComplete: noop,
  onExitLearn: noop,
};

// First activity per tab for Learn mode testing
const LEARN_ACTIVITIES: Record<string, string> = {
  explorer: 'explorer-quadrant-predict',
  sandbox: 'sandbox-gradient-effect',
  calculus: 'calculus-tangent-slope-predict',
  geometry: 'geometry-reflect-predict',
  statistics: 'statistics-distribution-shape',
  'linear-algebra': 'linear-vector-resultant',
};

function renderTab(tab: string, mode: 'explore' | 'learn') {
  const activityId = mode === 'learn' ? LEARN_ACTIVITIES[tab] : undefined;
  const props = { ...defaultProps, mode, activityId } as any;

  switch (tab) {
    case 'explorer':
      return render(<ExplorerTab {...props} />);
    case 'sandbox':
      return render(<SandboxTab {...props} />);
    case 'calculus':
      return render(<CalculusTab {...props} />);
    case 'geometry':
      return render(<GeometryTab {...props} />);
    case 'statistics':
      return render(<StatisticsTab {...props} />);
    case 'linear-algebra':
      return render(<LinearAlgebraTab {...props} />);
    default:
      throw new Error(`Unknown tab: ${tab}`);
  }
}

const TABS = ['explorer', 'sandbox', 'calculus', 'geometry', 'statistics', 'linear-algebra'] as const;
const MODES = ['explore', 'learn'] as const;

describe('Lab Layout Contract (S11)', () => {
  describe.each(TABS)('%s tab', (tab) => {
    describe.each(MODES)('%s mode', (mode) => {
      it('grid first child has .lab-control-column, second has .lab-visual-column', () => {
        const { container } = renderTab(tab, mode);
        const grid = container.querySelector('.lab-tab-grid');
        expect(grid, `${tab}/${mode} must have .lab-tab-grid`).not.toBeNull();
        const children = Array.from(grid!.children);
        expect(children.length).toBeGreaterThanOrEqual(2);
        expect(children[0].classList.contains('lab-control-column')).toBe(true);
        expect(children[1].classList.contains('lab-visual-column')).toBe(true);
      });

      it('left column is a direct child of the grid (no extra wrapper)', () => {
        const { container } = renderTab(tab, mode);
        const grid = container.querySelector('.lab-tab-grid');
        const controlCol = grid!.querySelector(':scope > .lab-control-column');
        expect(controlCol, 'control column must be direct child of grid').not.toBeNull();
      });

      it('visual column has no writable controls (except data-scene-footer)', () => {
        const { container } = renderTab(tab, mode);
        const visualCol = container.querySelector('.lab-visual-column');
        if (!visualCol) return; // Skip if not rendered (shouldn't happen)

        // Find all interactive inputs in visual column
        const inputs = visualCol.querySelectorAll('input, select, textarea, button[type="submit"]');
        const violators: string[] = [];
        inputs.forEach((el) => {
          // Check if inside a data-scene-footer (exempt)
          if (el.closest('[data-scene-footer]')) return;
          // Reset view button is not a writable control
          if (el.getAttribute('aria-label') === 'Reset view') return;
          violators.push(
            `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') || el.getAttribute('id') || el.getAttribute('type') || ''}]`
          );
        });
        expect(violators, `Visual column should not contain writable controls: ${violators.join(', ')}`).toEqual([]);
      });

      it('all writable controls are in .lab-control-column or data-scene-footer', () => {
        const { container } = renderTab(tab, mode);
        const controlCol = container.querySelector('.lab-control-column');
        const allInputs = container.querySelectorAll('input, select, textarea');
        const misplaced: string[] = [];
        allInputs.forEach((el) => {
          if (controlCol?.contains(el)) return;
          if (el.closest('[data-scene-footer]')) return;
          // Learn panel submit button inside control column is fine
          misplaced.push(
            `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') || el.getAttribute('id') || ''}]`
          );
        });
        expect(misplaced, `Controls outside left column or footer: ${misplaced.join(', ')}`).toEqual([]);
      });
    });
  });

  describe('Width contract (Plan A)', () => {
    it.each(TABS)('%s tab Explore mode: MafsStage card has no mafsHeight+32 maxWidth', (tab) => {
      const { container } = renderTab(tab, 'explore');
      const mafsStages = container.querySelectorAll('.mafs-stage');
      mafsStages.forEach((stage) => {
        const el = stage as HTMLElement;
        // Plan A: no maxWidth restriction on the card (empty or 'none')
        const maxW = el.style.maxWidth;
        expect(
          maxW === '' || maxW === 'none',
          `MafsStage card should not have restrictive maxWidth, got: "${maxW}"`
        ).toBe(true);
      });
    });
  });

  describe('Footer whitelist', () => {
    // The footer in ExplorerTab and GeometryTab Learn only appears after reveal.
    // Since these are canvas-coupled inputs (drag alternatives), they are
    // allowed in the visual column only via data-scene-footer.
    // LinearSystemsLab (accessed via sandbox) also uses footer for test-point.

    it.each(['sandbox', 'calculus', 'statistics'] as const)(
      '%s Learn mode has no data-scene-footer in initial state',
      (tab) => {
        const { container } = renderTab(tab, 'learn');
        const footer = container.querySelector('[data-scene-footer]');
        expect(footer, `${tab} Learn should NOT have a data-scene-footer in initial state`).toBeNull();
      }
    );
  });

  describe('Keyboard order', () => {
    it.each(TABS)('%s Explore: control column DOM-precedes visual column', (tab) => {
      const { container } = renderTab(tab, 'explore');
      const grid = container.querySelector('.lab-tab-grid');
      const children = Array.from(grid!.children);
      const controlIdx = children.findIndex((el) => el.classList.contains('lab-control-column'));
      const visualIdx = children.findIndex((el) => el.classList.contains('lab-visual-column'));
      expect(controlIdx).toBeLessThan(visualIdx);
    });

    it.each(TABS)('%s Learn: control column DOM-precedes visual column', (tab) => {
      const { container } = renderTab(tab, 'learn');
      const grid = container.querySelector('.lab-tab-grid');
      const children = Array.from(grid!.children);
      const controlIdx = children.findIndex((el) => el.classList.contains('lab-control-column'));
      const visualIdx = children.findIndex((el) => el.classList.contains('lab-visual-column'));
      expect(controlIdx).toBeLessThan(visualIdx);
    });
  });

  describe('No raw lab-tab-grid usage outside LabSceneLayout', () => {
    it('grep check: only LabSceneLayout.tsx uses className="lab-tab-grid"', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const labDir = path.resolve(__dirname, '..', 'components', 'lab');
      const files = fs.readdirSync(labDir).filter((f: string) => f.endsWith('.tsx'));
      const violators: string[] = [];
      for (const file of files) {
        if (file === 'LabSceneLayout.tsx') continue;
        const content = fs.readFileSync(path.join(labDir, file), 'utf-8');
        if (content.includes('className="lab-tab-grid"') || content.includes("className='lab-tab-grid'")) {
          violators.push(file);
        }
      }
      expect(violators, `Files using lab-tab-grid directly: ${violators.join(', ')}`).toEqual([]);
    });
  });
});
