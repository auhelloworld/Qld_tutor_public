import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import DiagramRenderer, {
  describeDiagram,
  readableWidthFloor,
} from '../components/DiagramRenderer';

/**
 * Locks in the four DiagramRenderer fixes:
 *
 * 1. Every diagram type exposes an accessible name. 14 of 24 types previously
 *    had no `role="img"`, `<title>` or `aria-label`, covering 264 of the 981
 *    authored diagram instances — a screen reader announced nothing.
 * 2. `data_table` (458 instances) renders a real HTML table with header scope,
 *    rather than SVG text that carried one flat label.
 * 3. Wide diagrams keep a readable width floor instead of scaling their labels
 *    below legibility (measured 5.2px on `process_flow`, 5.9px on
 *    `number_line` at a ~290px column).
 * 4. A malformed payload is contained by a local boundary instead of
 *    propagating to the application-level ErrorBoundary.
 */

const repoRoot = path.resolve(__dirname, '..', '..', '..');

/** One real payload per diagram type actually present in the banks. */
function bankSamples(): Map<string, Record<string, unknown>> {
  const samples = new Map<string, Record<string, unknown>>();
  const banks = fs
    .readdirSync(path.join(repoRoot, 'data'))
    .filter((f) => /^exercise_.*\.json$/.test(f) && !f.includes('bak'));
  for (const bank of banks) {
    const items = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data', bank), 'utf-8'));
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const diagram = item?.diagram_data;
      if (diagram && typeof diagram === 'object' && typeof diagram.type === 'string') {
        const previous = samples.get(diagram.type);
        if (!previous || JSON.stringify(diagram).length > JSON.stringify(previous).length) {
          samples.set(diagram.type, diagram);
        }
      }
    }
  }
  return samples;
}

describe('every authored diagram exposes an accessible name', () => {
  afterEach(() => cleanup());

  const samples = bankSamples();

  it('covers at least the diagram types the banks actually use', () => {
    expect(samples.size).toBeGreaterThanOrEqual(18);
  });

  for (const [type, diagram] of [...bankSamples().entries()].sort()) {
    it(`${type} has a non-empty accessible name`, () => {
      const { container } = render(<DiagramRenderer data={diagram as { type: string }} />);

      const svg = container.querySelector('svg');
      if (svg) {
        expect(svg.getAttribute('role'), `${type} svg missing role="img"`).toBe('img');
        const ariaLabel = svg.getAttribute('aria-label') || '';
        const titleText = svg.querySelector('title')?.textContent || '';
        expect(ariaLabel.trim().length, `${type} svg has an empty aria-label`).toBeGreaterThan(0);
        expect(titleText.trim().length, `${type} svg has no <title>`).toBeGreaterThan(0);
        return;
      }

      // data_table renders an HTML table; its caption is the accessible name.
      const table = container.querySelector('table');
      expect(table, `${type} rendered neither an svg nor a table`).toBeTruthy();
      const caption = table?.querySelector('caption')?.textContent || '';
      const headers = table?.querySelectorAll('th[scope="col"]').length ?? 0;
      expect(
        caption.trim().length > 0 || headers > 0,
        `${type} table has neither a caption nor scoped column headers`,
      ).toBe(true);
    });
  }

  it('describes a diagram with its own measurements, not just its type', () => {
    expect(
      describeDiagram({ type: 'right_triangle', labels: { base: '8 cm', height: '6 cm' } }),
    ).toBe('Right-angled triangle: base 8 cm, height 6 cm');

    expect(describeDiagram({ type: 'number_line', min: -5, max: 5, marks: [{ label: 'A', value: -2 }] })).toBe(
      'Number line from -5 to 5, marked at A at -2',
    );

    expect(
      describeDiagram({
        type: 'coordinate_plane',
        points: [{ label: 'P', x: 1, y: 2 }],
      }),
    ).toContain('P (1, 2)');

    // Unknown types still produce something readable rather than an empty name.
    expect(describeDiagram({ type: 'some_new_kind' })).toBe('some new kind');
  });
});

describe('data_table renders as a real table', () => {
  afterEach(() => cleanup());

  it('exposes header scope, a caption and selectable cell text', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'data_table',
          title: 'Trial results',
          headers: ['Trial', 'Mass (g)'],
          rows: [
            ['1', '12.4'],
            ['2', '13.1'],
          ],
        }}
      />,
    );

    // No SVG text stand-in for tabular data.
    expect(container.querySelector('svg')).toBeNull();

    const table = container.querySelector('table');
    expect(table).toBeTruthy();
    expect(table?.querySelector('caption')?.textContent).toBe('Trial results');
    expect([...(table?.querySelectorAll('thead th[scope="col"]') ?? [])].map((th) => th.textContent)).toEqual([
      'Trial',
      'Mass (g)',
    ]);
    expect(table?.querySelectorAll('tbody tr').length).toBe(2);
    expect(table?.querySelectorAll('tbody td').length).toBe(4);
    // Real text nodes, so the value is selectable and copyable.
    expect(screen.getByText('13.1').tagName.toLowerCase()).toBe('td');
  });

  it('scrolls inside its own frame rather than widening the page', () => {
    const { container } = render(
      <DiagramRenderer
        data={{ type: 'data_table', headers: ['a', 'b', 'c', 'd', 'e', 'f'], rows: [['1', '2', '3', '4', '5', '6']] }}
      />,
    );
    const figure = container.querySelector('figure');
    expect(figure?.getAttribute('style')).toContain('overflow-x: auto');
    expect(figure?.getAttribute('style')).toContain('max-width: 100%');
  });
});

describe('wide diagrams keep a readable width floor', () => {
  afterEach(() => cleanup());

  it('computes a floor that keeps the smallest label at 9px or above', () => {
    // 13px is the smallest label size the SVG branches use.
    for (const intrinsic of [300, 360, 380, 640, 720]) {
      const floor = readableWidthFloor(intrinsic);
      const effectiveFont = 13 * (floor / intrinsic);
      expect(effectiveFont, `floor for a ${intrinsic}px diagram is too small`).toBeGreaterThanOrEqual(8.9);
    }
    // The floor is capped so it never demands unbounded scrolling.
    expect(readableWidthFloor(4000)).toBeLessThanOrEqual(560);
    expect(readableWidthFloor(0)).toBe(0);
  });

  it('applies the floor and a scroll frame to the widest bank diagrams', () => {
    const samples = bankSamples();
    for (const type of ['process_flow', 'number_line']) {
      const diagram = samples.get(type);
      if (!diagram) continue;
      cleanup();
      const { container } = render(<DiagramRenderer data={diagram as { type: string }} />);
      const frame = container.querySelector('.diagram-scroll-frame');
      expect(frame, `${type} has no scroll frame`).toBeTruthy();
      expect(frame?.getAttribute('style')).toContain('overflow-x: auto');

      const svg = container.querySelector('svg');
      const style = svg?.getAttribute('style') || '';
      const floor = Number((style.match(/min-width:\s*(\d+)px/) || [])[1]);
      const intrinsic = Number(svg?.getAttribute('width'));
      expect(floor, `${type} has no min-width floor`).toBeGreaterThan(0);
      expect(13 * (floor / intrinsic), `${type} still scales labels below 9px`).toBeGreaterThanOrEqual(8.9);
    }
  });
});

describe('a malformed diagram does not take down the page', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('contains a render error in a local fallback', () => {
    // React logs the caught error; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // `bars` of the wrong shape threw `bars.map is not a function`, which
    // previously reached the application-level ErrorBoundary.
    const { container } = render(
      <DiagramRenderer data={{ type: 'simple_bar_chart', bars: 'not-an-array' } as { type: string }} />,
    );

    expect(container.textContent).toContain('could not be displayed');
    expect(container.textContent).toContain('question text still applies');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('still renders normally when a payload is merely incomplete', () => {
    const { container } = render(<DiagramRenderer data={{ type: 'simple_bar_chart' }} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.textContent).not.toContain('could not be displayed');
  });
});
