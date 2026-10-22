import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import DiagramRenderer from '../components/DiagramRenderer';
import { compileFunction } from '../lib/function-plot';

/**
 * Every authored `function_graph` must actually show its curve.
 *
 * `science_9_i04_006` plots a cooling curve from 80 °C down to 50 °C but
 * declared no y range, so the old fixed -5..5 default drew the whole line
 * outside the plot area and the student saw only axes. A scan of the banks
 * found 3 diagrams rendering completely blank and 9 more with under 40% of
 * their curve visible.
 *
 * Two fixes are locked in here: the y window is fitted to the data when the
 * payload does not declare one, and the expression parser accepts the implicit
 * multiplication authored content uses (`5x`, `2(x+1)`).
 */

const repoRoot = path.resolve(__dirname, '..', '..', '..');

interface GraphCase {
  id: string;
  file: string;
  diagram: Record<string, any>;
}

function authoredFunctionGraphs(): GraphCase[] {
  const cases: GraphCase[] = [];
  const files = fs
    .readdirSync(path.join(repoRoot, 'data'))
    .filter((f) => /^exercise_.*\.json$/.test(f) && !f.includes('bak'));
  for (const file of files) {
    const items = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data', file), 'utf-8'));
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const diagram = item?.diagram_data;
      if (diagram && diagram.type === 'function_graph') {
        cases.push({ id: item.id, file, diagram });
      }
    }
  }
  return cases;
}

/** Fraction of sampled curve points that land inside the rendered y window. */
function visibleFraction(diagram: Record<string, any>): number | null {
  const xMin = diagram.x_min ?? -5;
  const xMax = diagram.x_max ?? 5;
  const specs: unknown[] = Array.isArray(diagram.functions) ? diagram.functions : [];
  const samples: number[] = [];
  for (const spec of specs) {
    if (spec && typeof spec === 'object' && Array.isArray((spec as { points?: unknown[] }).points)) {
      continue; // plotted directly as a polyline
    }
    const sampler = compileFunction(spec as string);
    if (!sampler) return null; // expression did not compile at all
    for (let i = 0; i <= 60; i++) {
      const x = xMin + ((xMax - xMin) * i) / 60;
      const y = sampler(x);
      if (y !== null && Number.isFinite(y)) samples.push(y);
    }
  }
  if (!samples.length) return null;

  // Mirror the renderer: an explicit range wins, otherwise the window is fitted.
  const explicit = diagram.y_min !== undefined || diagram.y_max !== undefined;
  let yMin: number;
  let yMax: number;
  if (explicit) {
    yMin = diagram.y_min ?? -5;
    yMax = diagram.y_max ?? 5;
  } else {
    let lo = Math.min(...samples);
    let hi = Math.max(...samples);
    if (lo === hi) {
      const pad = Math.max(1, Math.abs(lo) * 0.2);
      lo -= pad;
      hi += pad;
    } else {
      const pad = (hi - lo) * 0.1;
      lo -= pad;
      hi += pad;
    }
    if (lo > 0 && lo <= (hi - lo) * 0.35) lo = 0;
    if (hi < 0 && -hi <= (hi - lo) * 0.35) hi = 0;
    yMin = lo;
    yMax = hi;
  }
  const inside = samples.filter((y) => y >= yMin && y <= yMax).length;
  return inside / samples.length;
}

describe('authored function_graph diagrams show their data', () => {
  afterEach(() => cleanup());

  const cases = authoredFunctionGraphs();

  it('finds the authored function graphs', () => {
    expect(cases.length).toBeGreaterThan(150);
  });

  it('compiles every authored function expression', () => {
    const failures: string[] = [];
    for (const graphCase of cases) {
      const specs: unknown[] = Array.isArray(graphCase.diagram.functions)
        ? graphCase.diagram.functions
        : [];
      for (const spec of specs) {
        if (spec && typeof spec === 'object') continue; // object specs are handled separately
        if (!compileFunction(spec as string)) {
          failures.push(`${graphCase.file}:${graphCase.id}: ${JSON.stringify(spec)}`);
        }
      }
    }
    expect(failures, `these authored expressions do not compile: ${failures.join(' | ')}`).toEqual([]);
  });

  it('keeps an auto-fitted curve inside the plot window, and never renders a blank graph', () => {
    const emptyWindow: string[] = [];
    const clippedAutoFit: string[] = [];
    for (const graphCase of cases) {
      const fraction = visibleFraction(graphCase.diagram);
      if (fraction === null) continue;
      const explicit =
        graphCase.diagram.y_min !== undefined || graphCase.diagram.y_max !== undefined;

      if (fraction === 0) {
        // Nothing at all on screen is a bug regardless of who chose the window.
        emptyWindow.push(`${graphCase.file}:${graphCase.id}`);
      } else if (!explicit && fraction < 0.6) {
        // The fitted window is ours to get right.
        clippedAutoFit.push(`${graphCase.file}:${graphCase.id} (${Math.round(fraction * 100)}%)`);
      }
      // An explicit window may deliberately clip: a piecewise distance-time
      // graph declares each segment over the whole x range and relies on the
      // renderer to clip it to the segment that matters.
    }
    expect(emptyWindow, `these graphs render no curve at all: ${emptyWindow.join(' | ')}`).toEqual([]);
    expect(
      clippedAutoFit,
      `the fitted y window clips these curves: ${clippedAutoFit.join(' | ')}`,
    ).toEqual([]);
  });

  it('renders a visible curve for the cooling-graph item that was blank', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'function_graph',
          x_label: 'Time (s)',
          y_label: 'Temperature (°C)',
          functions: ['f(x) = 80 - 6*x for 0<=x<=5'],
        }}
      />,
    );

    // The fitted window must put the 50..80 range on screen, so a y tick label
    // in that band is present rather than the old -4..4 defaults.
    const tickLabels = Array.from(container.querySelectorAll('text')).map((t) => t.textContent || '');
    const hasDataRangeTick = tickLabels.some((label) => {
      const value = Number(label);
      return Number.isFinite(value) && value >= 40 && value <= 90;
    });
    expect(hasDataRangeTick, `no y tick inside the data range; ticks were ${JSON.stringify(tickLabels)}`).toBe(true);

    // And the curve itself is drawn.
    const curves = container.querySelectorAll('path[stroke], polyline');
    expect(curves.length).toBeGreaterThan(0);
  });

  it('parses the implicit multiplication authored content uses', () => {
    for (const [expression, x, expected] of [
      ['f_A(x) = 100 - 5x', 4, 80],
      ['y = 2(x+1)', 3, 8],
      ['(x+1)(x-1)', 3, 8],
    ] as [string, number, number][]) {
      const sampler = compileFunction(expression);
      expect(sampler, `failed to compile ${expression}`).toBeTruthy();
      expect(sampler?.(x)).toBeCloseTo(expected, 6);
    }

    // A known function before a bracket is still a call, not a product.
    const sin = compileFunction('sin(x)');
    expect(sin?.(0)).toBeCloseTo(0, 6);
    expect(sin?.(Math.PI / 2)).toBeCloseTo(1, 6);
  });
});
