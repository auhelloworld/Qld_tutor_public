import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import MathMarkdown from '../components/MathMarkdown';
import { authoredBankFiles, authoredBankGate } from './authored-bank-files';

/**
 * Authored question text carries GFM pipe tables. CommonMark has no table
 * syntax, so before `remark-gfm` was added `react-markdown` emitted the raw
 * `|` and `| :---: |` rows as literal text. Measured: 297 active production
 * items and 1379 staged items contain such a table, and a rendered sample
 * produced zero `<table>` elements.
 */

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const SEPARATOR_ROW = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/m;

/**
 * Every student-visible text field on a record. Earlier versions only looked at
 * `question`, `sub_parts[].question` and `steps[]`, which missed 363 tables in
 * `sub_parts[].steps[]` plus those in `choices` and `rubric.key_points`.
 */
function textsOf(item: Record<string, unknown>): { where: string; text: string }[] {
  const texts: { where: string; text: string }[] = [];
  const push = (where: string, value: unknown) => {
    if (typeof value === 'string' && value) texts.push({ where, text: value });
  };
  const pushList = (where: string, values: unknown) => {
    if (Array.isArray(values)) values.forEach((v, i) => push(`${where}[${i}]`, v));
  };

  push('question', item.question);
  pushList('steps', item.steps);
  pushList('choices', item.choices);
  push('answer', item.answer);
  pushList('rubric.key_points', (item.rubric as { key_points?: unknown } | undefined)?.key_points);

  const parts = (item.sub_parts as Record<string, unknown>[] | undefined) ?? [];
  parts.forEach((part, index) => {
    if (!part || typeof part !== 'object') return;
    push(`sub_parts[${index}].question`, part.question);
    pushList(`sub_parts[${index}].steps`, part.steps);
    pushList(`sub_parts[${index}].choices`, part.choices);
    push(`sub_parts[${index}].answer`, part.answer);
    pushList(
      `sub_parts[${index}].rubric.key_points`,
      (part.rubric as { key_points?: unknown } | undefined)?.key_points,
    );
  });
  return texts;
}

/** Authored content selected by the explicit production/scratch release gate. */
function authoredBanks(): { bank: string; items: Record<string, unknown>[] }[] {
  const out: { bank: string; items: Record<string, unknown>[] }[] = [];
  for (const file of authoredBankFiles(repoRoot)) {
    const items = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (Array.isArray(items)) {
      out.push({ bank: path.relative(repoRoot, file), items });
    }
  }
  return out;
}

function authoredTextsWithTables(limit = 40): { id: string; text: string }[] {
  const found: { id: string; text: string }[] = [];
  for (const { bank, items } of authoredBanks()) {
    for (const item of items) {
      for (const { text } of textsOf(item)) {
        if (SEPARATOR_ROW.test(text)) {
          found.push({ id: `${bank}:${item.id}`, text });
          if (found.length >= limit) return found;
        }
      }
    }
  }
  return found;
}

describe('markdown tables in question text', () => {
  afterEach(() => cleanup());

  it('renders a basic pipe table as a real table with header scope', () => {
    const { container } = render(
      <MathMarkdown>{`| Entry | Tiles |\n| :---: | :---: |\n| 1 | 1 |\n| 2 | 4 |`}</MathMarkdown>,
    );
    const table = container.querySelector('table');
    expect(table, 'pipe table did not become a <table>').toBeTruthy();
    expect(Array.from(table!.querySelectorAll('th')).map((th) => th.textContent)).toEqual([
      'Entry',
      'Tiles',
    ]);
    expect(table!.querySelectorAll('tbody tr').length).toBe(2);
    expect(table!.querySelectorAll('tbody td').length).toBe(4);
    // No literal markdown syntax left in the output.
    expect(container.textContent).not.toContain(':---:');
    expect(container.textContent).not.toContain('| Entry');
  });

  it('keeps maths inside table cells rendered by KaTeX', () => {
    const { container } = render(
      <MathMarkdown>{`| $x$ | $x^2$ |\n| :---: | :---: |\n| $2$ | $4$ |`}</MathMarkdown>,
    );
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
    expect(table!.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(4);
  });

  it('wraps a table so a wide one scrolls without widening the page', () => {
    const { container } = render(
      <MathMarkdown>{`| a | b |\n| :---: | :---: |\n| 1 | 2 |`}</MathMarkdown>,
    );
    const wrapper = container.querySelector('.markdown-table-wrapper');
    expect(wrapper, 'table is not inside a scroll wrapper').toBeTruthy();
    expect(wrapper!.querySelector('table')).toBeTruthy();
  });

  it('renders the sequence-table question that reported the problem', () => {
    const scratchPath = path.join(repoRoot, 'scratch', 'qldtutor_y7_math.json');
    if (!fs.existsSync(scratchPath)) return;
    const items = JSON.parse(fs.readFileSync(scratchPath, 'utf-8'));
    const item = items.find((x: { id: string }) => x.id === 'math_7_ms_AC9M7A06_52e724');
    if (!item) return;

    const { container } = render(<MathMarkdown>{item.question}</MathMarkdown>);
    const table = container.querySelector('table');
    expect(table, 'the sequence table still renders as literal pipes').toBeTruthy();

    // The row labels and both data rows survive as real cells.
    const cells = Array.from(table!.querySelectorAll('td, th')).map((c) => c.textContent || '');
    expect(cells.some((c) => c.includes('Entry number (E)'))).toBe(true);
    expect(cells.some((c) => c.includes('No. tiles used (T)'))).toBe(true);
    expect(container.textContent).not.toContain(':---:');
  });

  it('renders sampled authored questions that contain a pipe table', () => {
    const samples = authoredTextsWithTables();
    if (authoredBankGate() === 'scratch') {
      expect(samples.length, 'expected scratch items with pipe tables').toBeGreaterThan(10);
    }

    const failures: string[] = [];
    for (const sample of samples) {
      cleanup();
      const { container } = render(<MathMarkdown>{sample.text}</MathMarkdown>);
      if (!container.querySelector('table')) {
        failures.push(`${sample.id} (no <table>)`);
        continue;
      }
      if ((container.textContent || '').includes(':---:')) {
        failures.push(`${sample.id} (literal separator row leaked)`);
      }
    }
    expect(failures, `these authored tables do not render: ${failures.join(' | ')}`).toEqual([]);
  }, 30000);
});


describe('scraper artefact shapes the repair script normalises', () => {
  afterEach(() => cleanup());

  /**
   * Each case is a shape found in authored content that stopped a table
   * rendering. `scripts/fix_authored_markdown_artifacts.py` normalises them; the
   * assertions below pin the rendered outcome so a regression is visible.
   */
  it('renders stacked tables separately rather than leaking separator rows', () => {
    const { container } = render(
      <MathMarkdown>{`| $x$ | 1 | 2 |\n| :---: | :---: | :---: |\n| $y$ | 3 | 4 |\n\n| $x$ | 5 | 6 |\n| :---: | :---: | :---: |\n| $y$ | 7 | 8 |`}</MathMarkdown>,
    );
    expect(container.querySelectorAll('table').length).toBe(2);
    expect(container.textContent).not.toContain(':---');
  });

  it('renders a table that follows a paragraph', () => {
    const { container } = render(
      <MathMarkdown>{`Some lead-in text.\n\n| a | b |\n| :---: | :---: |\n| 1 | 2 |`}</MathMarkdown>,
    );
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.textContent).not.toContain(':---');
  });

  it('renders a table whose header row carries the row label', () => {
    // The scraper's empty header row is promoted away, so the label row becomes
    // the header. This is the shape reported for math_7_ms_AC9M7A06_52e724.
    const { container } = render(
      <MathMarkdown>{`| Entry number (E) | 1 | 2 | 3 | 4 |\n| :---: | :---: | :---: | :---: | :---: |\n| No. tiles used (T) | 1 | 4 | 9 | 16 |`}</MathMarkdown>,
    );
    const table = container.querySelector('table');
    expect(Array.from(table!.querySelectorAll('th')).map((th) => th.textContent)).toEqual([
      'Entry number (E)',
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(Array.from(table!.querySelectorAll('td')).map((td) => td.textContent)).toEqual([
      'No. tiles used (T)',
      '1',
      '4',
      '9',
      '16',
    ]);
  });

  it('renders a padded header when authored labels are missing', () => {
    const { container } = render(
      <MathMarkdown>{`| | 150 passengers | Total | | | |\n| :---: | :---: | :---: | :---: | :---: | :---: |\n| Malfunction | 337 | 14 | 19 | 3 | 373 |`}</MathMarkdown>,
    );
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
    expect(table!.querySelectorAll('th').length).toBe(6);
    expect(Array.from(table!.querySelectorAll('td')).map((td) => td.textContent)).toEqual([
      'Malfunction',
      '337',
      '14',
      '19',
      '3',
      '373',
    ]);
  });

  it('renders every authored table and never puts prose in a cell', () => {
    /**
     * One render-based gate for both failure modes seen in this codebase:
     *
     * 1. the table does not render at all (raw `|` and `| :---: |` on screen);
     * 2. the table renders but swallows the surrounding prose, because a GFM
     *    table body runs until a blank line — that put the actual question of
     *    `math_7_ms_AC9M7A06_c018ad` part (a) inside a `<td>`.
     *
     * Both are judged from the rendered DOM, not from the source, and the
     * swallow check is exact rather than heuristic: a cell is only an error when
     * its text matches a source line that is not itself a table row. Cells that
     * legitimately contain a sentence (a quoted claim, a "For example:" note)
     * therefore pass.
     */
    const normalise = (value: string) =>
      value.replace(/\s+/g, ' ').replace(/\$/g, '').trim().toLowerCase();

    const failures: string[] = [];
    let checked = 0;

    for (const { bank, items } of authoredBanks()) {
      for (const item of items) {
        for (const { where, text } of textsOf(item)) {
          if (!SEPARATOR_ROW.test(text)) continue;
          checked++;

          const nonTableLines = new Set(
            text
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line !== '' && !line.startsWith('|'))
              .map(normalise)
              .filter((line) => line.length > 12),
          );

          cleanup();
          const { container } = render(<MathMarkdown>{text}</MathMarkdown>);
          const tag = `${bank}:${item.id}/${where}`;

          if (!container.querySelector('table')) {
            failures.push(`${tag} — no <table> rendered`);
            continue;
          }
          if ((container.textContent || '').includes(':---')) {
            failures.push(`${tag} — separator row leaked as text`);
            continue;
          }
          const swallowed = Array.from(container.querySelectorAll('td, th')).find((cell) =>
            nonTableLines.has(normalise(cell.textContent || '')),
          );
          if (swallowed) {
            failures.push(`${tag} — prose rendered inside a cell: "${(swallowed.textContent || '').slice(0, 60)}"`);
          }
        }
      }
    }

    const minimumTables = authoredBankGate() === 'production' ? 0 : 1000;
    expect(checked, 'expected to render authored tables for the selected gate').toBeGreaterThanOrEqual(minimumTables);
    expect(
      failures,
      `${failures.length} authored table(s) render incorrectly:\n${failures.slice(0, 10).join('\n')}`,
    ).toEqual([]);
  }, 1800000);
});
