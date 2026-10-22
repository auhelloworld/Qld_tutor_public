import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import DiagramRenderer, { describeDiagram } from '../components/DiagramRenderer';
import { authoredBankFiles, authoredBankGate } from './authored-bank-files';

/**
 * Authored payload shapes the renderer used to ignore silently.
 *
 * Each branch read one fixed field name, so a payload that nested its data or
 * used a synonym rendered an empty diagram with no error and no test failure.
 * A key-coverage audit over every authored payload found five such cases; the
 * assertions below pin the real items so the shapes cannot regress.
 */

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function authoredDiagram(bank: string, id: string, subPartLabel?: string): Record<string, unknown> {
  const items = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data', bank), 'utf-8'));
  const item = (items as { id: string; diagram_data?: unknown; sub_parts?: unknown[] }[]).find(
    (candidate) => candidate.id === id,
  );
  expect(item, `${id} not found in ${bank}`).toBeTruthy();
  if (!subPartLabel) return item!.diagram_data as Record<string, unknown>;
  const part = (item!.sub_parts as { label?: string; diagram_data?: unknown }[]).find(
    (candidate) => candidate.label === subPartLabel,
  );
  expect(part, `${id} sub-part ${subPartLabel} not found`).toBeTruthy();
  return part!.diagram_data as Record<string, unknown>;
}

function textOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('text, tspan')).map((node) => node.textContent || '');
}

describe('triangle angle labels authored in upper case', () => {
  afterEach(() => cleanup());

  const diagram = authoredDiagram('exercise_10_math.json', 'math_10_core_AC9M10SP01_016');

  it('is the payload shape that reported the bug', () => {
    expect(diagram.type).toBe('triangle');
    expect(Object.keys(diagram.labels as object)).toEqual(['A', 'B', 'C']);
  });

  it('renders every authored vertex label', () => {
    const { container } = render(<DiagramRenderer data={diagram as { type: string }} />);
    const texts = textOf(container);
    expect(texts).toContain('50°');
    expect(texts).toContain('60°');
    expect(texts).toContain('?');
  });

  it('still renders lower-case vertex labels', () => {
    const { container } = render(
      <DiagramRenderer data={{ type: 'triangle', labels: { a: '30°', b: '70°', c: '80°' } }} />,
    );
    const texts = textOf(container);
    expect(texts).toContain('30°');
    expect(texts).toContain('70°');
    expect(texts).toContain('80°');
  });

  it('names the diagram with its angles for assistive technology', () => {
    expect(describeDiagram(diagram as { type: string })).toBe('Triangle: A 50°, B 60°, C ?');
  });
});

describe('right triangle labelled for trigonometry', () => {
  afterEach(() => cleanup());

  const diagram = authoredDiagram(
    'exercise_9_math.json',
    'math_9_graph3_SP01_tangent_triangle_002',
  );

  it('renders the angle and both legs, not only the hypotenuse', () => {
    const { container } = render(<DiagramRenderer data={diagram as { type: string }} />);
    const joined = textOf(container).join(' ');
    expect(joined).toContain('42');
    expect(joined).toContain('6.7');
    expect(joined).toContain('7.5');
    expect(joined).toContain('10.1');
  });
});

describe('bar chart nested under its own type name', () => {
  afterEach(() => cleanup());

  for (const id of ['science_9_i04_004', 'science_9_i04_013', 'science_9_u05_004']) {
    it(`${id} draws its bars`, () => {
      const diagram = authoredDiagram('exercise_9_science.json', id);
      // The payload has no top-level `bars`; the data sits under a nested key.
      expect(diagram.bars).toBeUndefined();

      const { container } = render(<DiagramRenderer data={diagram as { type: string }} />);
      const nested = diagram.simple_bar_chart as { data: { label: string; value: number }[] };

      // One drawn bar per data point.
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(container.querySelectorAll('rect').length).toBeGreaterThanOrEqual(nested.data.length);

      // Values are shown; long category names are truncated to fit the slot, so
      // the full text has to survive in the accessible name instead.
      const joined = textOf(container).join(' ');
      const accessibleName = svg?.getAttribute('aria-label') || '';
      for (const bar of nested.data) {
        expect(joined, `missing bar value ${bar.value}`).toContain(String(bar.value));
        expect(accessibleName, `bar ${bar.label} missing from accessible name`).toContain(bar.label);
      }
    });
  }
});

describe('tree diagram authored as branches and children', () => {
  afterEach(() => cleanup());

  it('draws a node per outcome instead of an empty tree', () => {
    const diagram = authoredDiagram(
      'exercise_7_math.json',
      'gen_math_y7_20260719t233427z_006',
      'a',
    );
    expect(diagram.nodes).toBeUndefined();
    expect(Array.isArray(diagram.branches)).toBe(true);

    const { container } = render(<DiagramRenderer data={diagram as { type: string }} />);
    const joined = textOf(container).join(' ');
    // Two coin branches, each with six die outcomes.
    expect(joined).toContain('H');
    expect(joined).toContain('T');
    for (const face of ['1', '2', '3', '4', '5', '6']) {
      expect(joined, `missing outcome ${face}`).toContain(face);
    }
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(14);
  });
});

describe('coordinate plane with an authored window', () => {
  afterEach(() => cleanup());

  it('uses the declared range rather than auto-fitting to the points', () => {
    const diagram = authoredDiagram('exercise_10_math.json', 'math_10_core_AC9M10SP03_016');
    expect(diagram.x_min).toBe(-1);
    expect(diagram.x_max).toBe(5);

    const { container } = render(<DiagramRenderer data={diagram as { type: string }} />);
    const numericTicks = textOf(container)
      .map((label) => Number(label))
      .filter((value) => Number.isFinite(value));
    // The declared window stops at 5, so the old auto-fit minimum of 6 must be gone.
    expect(Math.max(...numericTicks)).toBeLessThanOrEqual(5);
    expect(Math.min(...numericTicks)).toBeGreaterThanOrEqual(-1);
  });
});

describe('no authored diagram payload is silently ignored', () => {
  /**
   * Guards the class of bug rather than the individual items: if a new payload
   * uses a field name no branch reads, this fails with the offending key.
   */
  it('has a reader for every authored top-level key and label', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'frontend', 'src', 'components', 'DiagramRenderer.tsx'),
      'utf-8',
    );
    const component = source.slice(0, source.indexOf('export function describeDiagram'));
    const switchBody = component.slice(component.indexOf('switch (diagram.type) {'));
    const blocks = new Map<string, string>();
    const parts = switchBody.split(/^ {4}case '([a-z_0-9]+)':/m);
    for (let i = 1; i < parts.length; i += 2) blocks.set(parts[i], parts[i + 1]);

    // Fields the renderer legitimately does not draw.
    const IGNORED: Record<string, Set<string>> = {
      // A human-readable duplicate of `functions`, kept for authoring review.
      function_graph: new Set(['rule']),
    };

    const offenders: string[] = [];
    const banks = authoredBankFiles(repoRoot);

    for (const file of banks) {
      const bank = path.relative(repoRoot, file);
      const items = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const payloads = [item?.diagram_data, ...(item?.sub_parts ?? []).map((p: { diagram_data?: unknown }) => p?.diagram_data)];
        for (const payload of payloads) {
          if (!payload || typeof payload !== 'object') continue;
          const type = (payload as { type?: string }).type;
          if (!type) continue;
          const block = blocks.get(type);
          if (!block) continue;

          const readTop = new Set(Array.from(block.matchAll(/diagram\.([a-zA-Z_][a-zA-Z0-9_]*)/g)).map((m) => m[1]));
          const readLabels = new Set(
            Array.from(block.matchAll(/labels\??\.([a-zA-Z_][a-zA-Z0-9_]*)/g)).map((m) => m[1]),
          );
          const dynamicLabels = /labels\s*\[|vertexLabel\(/.test(block);
          const allowed = IGNORED[type] ?? new Set<string>();

          for (const key of Object.keys(payload)) {
            if (key === 'type' || key === 'labels' || key === type) continue;
            if (allowed.has(key)) continue;
            // Legacy shapes are folded in before the switch runs.
            if (['bars', 'nodes', 'links', 'data', 'branches'].includes(key)) continue;
            if (!readTop.has(key)) offenders.push(`${bank}:${item.id}:${type}.${key}`);
          }

          const labels = (payload as { labels?: unknown }).labels;
          if (labels && typeof labels === 'object' && !dynamicLabels) {
            for (const key of Object.keys(labels)) {
              if (!readLabels.has(key)) offenders.push(`${bank}:${item.id}:${type}.labels.${key}`);
            }
          }
        }
      }
    }

    const unique = [...new Set(offenders)];
    expect(unique, `authored diagram fields nothing renders: ${unique.slice(0, 12).join(' | ')}`).toEqual([]);
  });
});


describe('whole-bank sweep: every authored diagram renders real content', () => {
  afterEach(() => cleanup());

  /**
   * Renders all 981 authored diagram payloads (root and sub-part) and fails on
   * the three defect classes found by audit: nothing drawn, no accessible name,
   * and raw LaTeX leaking into the rendered text.
   */
  // Rendering all 981 payloads needs more than the default 5s budget.
  it('draws content, names itself, and leaks no LaTeX', () => {
    const banks = authoredBankFiles(repoRoot);

    const empty: string[] = [];
    const unnamed: string[] = [];
    const latexLeaks: string[] = [];
    let total = 0;

    for (const file of banks) {
      const items = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const payloads: [string, unknown][] = [[item.id, item?.diagram_data]];
        for (const part of item?.sub_parts ?? []) {
          payloads.push([`${item.id}:${part.label}`, part?.diagram_data]);
        }
        for (const [label, payload] of payloads) {
          if (!payload || typeof payload !== 'object') continue;
          total++;
          cleanup();
          const { container } = render(<DiagramRenderer data={payload as { type: string }} />);
          const svg = container.querySelector('svg');
          const table = container.querySelector('table');

          if (svg) {
            const drawn = svg.querySelectorAll(
              'rect,circle,line,path,polygon,polyline,ellipse,text',
            ).length;
            if (drawn === 0) empty.push(`${label} [${(payload as { type: string }).type}]`);
            if (!(svg.getAttribute('aria-label') || '').trim()) unnamed.push(label);
          } else if (table) {
            if (!table.querySelectorAll('td, th').length) empty.push(`${label} (empty table)`);
          } else {
            empty.push(`${label} (rendered no svg or table)`);
          }

          const text = container.textContent || '';
          const leak = text.match(/\\[a-zA-Z]{2,}|\$[^$]{1,40}\$/);
          if (leak) latexLeaks.push(`${label}: ${leak[0]}`);
        }
      }
    }

    if (authoredBankGate() === 'scratch') {
      // The scratch inventory was manually reviewed: four Year 9, one Year 10,
      // two Year 11 Methods, and one Year 12 Methods top-level diagram.
      expect(total).toBe(8);
    } else {
      expect(total).toBeGreaterThan(100);
    }
    expect(empty, `these diagrams render nothing: ${empty.slice(0, 10).join(' | ')}`).toEqual([]);
    expect(unnamed, `these diagrams have no accessible name: ${unnamed.slice(0, 10).join(' | ')}`).toEqual([]);
    expect(
      [...new Set(latexLeaks)],
      `raw LaTeX reached the rendered diagram text: ${[...new Set(latexLeaks)].slice(0, 10).join(' | ')}`,
    ).toEqual([]);
  }, 60000);
});
