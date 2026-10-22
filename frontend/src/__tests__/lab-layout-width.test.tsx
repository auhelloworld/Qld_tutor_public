/**
 * Lab layout width and control-placement contracts.
 *
 * 1. The visual column is capped at the canvas card width, so a square canvas
 *    does not sit in a wider column with dead space on both sides, and the
 *    control rail receives every remaining pixel.
 * 2. Every tab keeps its scene controls in `.lab-control-column`. The
 *    Vectors/Matrices/Complex tab used to render them below the canvas via
 *    `data-scene-footer`; that inconsistency must not come back.
 */
import type { ReactNode } from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(cleanup);

vi.mock('mafs', () => ({
  Mafs: ({ children }: { children?: ReactNode }) => <div data-testid="mafs">{children}</div>,
  Coordinates: { Cartesian: () => <div />, Polar: () => <div /> },
  MovablePoint: () => <div />,
  Point: () => <div />,
  Circle: () => <div />,
  Polygon: () => <div />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Line: { Segment: () => <div />, ThroughPoints: () => <div />, PointAngle: () => <div />, PointSlope: () => <div /> },
  Plot: { OfX: () => <div />, OfY: () => <div />, Inequality: () => <div />, Parametric: () => <div />, VectorField: () => <div /> },
  Vector: () => <div />,
  Transform: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  LaTeX: () => <div />,
  Ellipse: () => <div />,
  labelPi: (x: number) => `${x}π`,
  Theme: { foreground: '#000000', background: '#ffffff', red: '#ff0000', orange: '#ff8800', green: '#00cc00', blue: '#0000ff', indigo: '#4400ff', violet: '#8800ff', pink: '#ff00ff', yellow: '#ffff00' },
}));

import LinearAlgebraTab from '../components/lab/LinearAlgebraTab';

const CSS_PATH = path.resolve(__dirname, '../app/globals.css');
const PAGE_PATH = path.resolve(__dirname, '../app/lab/page.tsx');

describe('Lab column width contract', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf-8');

  /** Two-column declarations only; narrow viewports collapse to a single track. */
  function twoTrackDeclarations(): string[] {
    return [...css.matchAll(/\.lab-tab-grid\s*\{[^}]*?grid-template-columns:\s*([^;]+);/gs)]
      .map((m) => m[1].trim())
      .filter((declaration) => (declaration.match(/minmax\(/g) ?? []).length === 2);
  }

  it('caps the visual track instead of letting it stretch past the canvas', () => {
    const declarations = twoTrackDeclarations();
    expect(declarations.length).toBeGreaterThanOrEqual(2);
    for (const declaration of declarations) {
      // Control rail is the flexible track; visual track is capped.
      expect(declaration, declaration).toMatch(/minmax\(0,\s*1fr\)/);
      expect(declaration, declaration).toContain('--lab-visual-max');
      // The old fixed 380-460px rail would re-introduce the side whitespace.
      expect(declaration, declaration).not.toContain('460px');
    }
  });

  it('sizes --lab-visual-max to the canvas plus the card padding at each breakpoint', () => {
    const page = fs.readFileSync(PAGE_PATH, 'utf-8');
    // MafsStage pads the card by 16px on each side.
    const CARD_PADDING = 32;
    const wideCanvas = Number(page.match(/else setMafsHeight\((\d+)\)/)![1]);
    const midCanvas = Number(page.match(/w < 1200\) setMafsHeight\((\d+)\)/)![1]);

    const base = Number(css.match(/\.lab-tab-grid\s*\{[^}]*?--lab-visual-max:\s*(\d+)px/s)![1]);
    expect(base).toBe(wideCanvas + CARD_PADDING);

    const midRule = css.match(/@media \(min-width: 768px\) and \(max-width: 1199px\)\s*\{[^}]*?--lab-visual-max:\s*(\d+)px/s);
    expect(midRule, 'a 768-1199px override must match the 460px canvas').not.toBeNull();
    expect(Number(midRule![1])).toBe(midCanvas + CARD_PADDING);
  });

  it('keeps both tracks shrinkable so the grid cannot overflow', () => {
    const declarations = twoTrackDeclarations();
    expect(declarations.length).toBeGreaterThanOrEqual(2);
    for (const declaration of declarations) {
      const tracks = declaration.replace(/\s*!important\s*$/, '').split(/\)\s+(?=minmax)/);
      expect(tracks.length, declaration).toBe(2);
      for (const track of tracks) {
        expect(track, `track must have a 0 minimum: ${track}`).toMatch(/minmax\(0,/);
      }
    }
  });
});

describe('Vectors, Matrices & Complex控制栏 placement', () => {
  const SCENES = [
    { value: 'linear-vector-resultant', control: 'Vector A x-component' },
    { value: 'linear-matrix-transform', control: 'Matrix entry a (row 1, column 1)' },
    { value: 'linear-complex-plane', control: 'Real part of z' },
  ] as const;

  function renderExplore() {
    return render(
      <LinearAlgebraTab
        mafsHeight={400}
        mode="explore"
        onActivityComplete={() => undefined}
        onExitLearn={() => undefined}
      />,
    );
  }

  it.each(SCENES)('$value keeps its controls in the left column', ({ value, control }) => {
    const { container } = renderExplore();
    fireEvent.change(screen.getByLabelText('Select linear algebra scene'), { target: { value } });

    const controlColumn = container.querySelector('.lab-control-column');
    const visualColumn = container.querySelector('.lab-visual-column');
    expect(controlColumn).not.toBeNull();

    const input = screen.getByLabelText(control);
    expect(controlColumn!.contains(input), `${control} must live in the control column`).toBe(true);
    expect(visualColumn!.contains(input)).toBe(false);
  });

  it.each(SCENES)('$value renders no data-scene-footer below the canvas', ({ value }) => {
    const { container } = renderExplore();
    fireEvent.change(screen.getByLabelText('Select linear algebra scene'), { target: { value } });
    expect(container.querySelectorAll('[data-scene-footer]')).toHaveLength(0);
  });

  it('puts every writable control of the tab in the left column', () => {
    const { container } = renderExplore();
    for (const { value } of SCENES) {
      fireEvent.change(screen.getByLabelText('Select linear algebra scene'), { target: { value } });
      const visualColumn = container.querySelector('.lab-visual-column')!;
      const strays = Array.from(visualColumn.querySelectorAll('input, select, textarea'))
        .map((el) => el.getAttribute('aria-label') ?? el.tagName);
      expect(strays, `${value} leaves controls in the visual column`).toEqual([]);
    }
  });

  it('no longer references data-scene-footer in the source', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../components/lab/LinearAlgebraTab.tsx'),
      'utf-8',
    );
    expect(source).not.toContain('data-scene-footer');
  });
});
