/**
 * Every authored image must survive rendering and resolve to a real file.
 *
 * `preprocessMarkdown` auto-wraps "math-like tokens" in `$...$` when a text has
 * no maths delimiters of its own.  An image filename such as
 * `ms_graph_45a521_option_a.svg` matches that pattern, so the URL itself used to
 * be rewritten as `/$image_assets/ms_graph_45a521_option_a$.svg` and the
 * image 404ed.  It affected 979 authored texts across 11 banks -- 102 of them in
 * production -- which is every multiple-choice option graph in those items.
 *
 * Static inspection cannot see this: the JSON holds a correct path and the
 * corruption happens in the renderer.  So this walks every authored text that
 * contains markdown image syntax, renders it, and checks the `src` that actually
 * reaches the browser.
 */
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import MathMarkdown from '../components/MathMarkdown';
import { authoredBankFiles, authoredBankGate } from './authored-bank-files';

const repoRoot = path.resolve(__dirname, '../../..');
const publicDir = path.join(repoRoot, 'frontend', 'public');

/** Every student-visible text on a record, including choices and sub-parts. */
function textsOf(item: Record<string, unknown>): { where: string; text: string }[] {
  const texts: { where: string; text: string }[] = [];
  const push = (where: string, value: unknown) => {
    if (typeof value === 'string' && value.includes('![')) texts.push({ where, text: value });
  };
  push('question', item.question);
  (item.choices as unknown[] | undefined)?.forEach((c, i) => push(`choices[${i}]`, c));
  (item.steps as unknown[] | undefined)?.forEach((s, i) => push(`steps[${i}]`, s));
  const parts = (item.sub_parts as Record<string, unknown>[] | undefined) ?? [];
  parts.forEach((part, index) => {
    if (!part || typeof part !== 'object') return;
    push(`sub_parts[${index}].question`, part.question);
    (part.choices as unknown[] | undefined)?.forEach((c, i) =>
      push(`sub_parts[${index}].choices[${i}]`, c),
    );
  });
  return texts;
}

describe('authored images survive rendering', () => {
  it('renders every authored image with a src that resolves to a file on disk', () => {
    const failures: string[] = [];
    let checked = 0;
    let banks = 0;

    for (const file of authoredBankFiles(repoRoot)) {
      let items: unknown;
      try {
        items = JSON.parse(fs.readFileSync(file, 'utf-8'));
      } catch {
        continue;
      }
      if (!Array.isArray(items)) continue;
      banks++;
      for (const item of items as Record<string, unknown>[]) {
        if (!item || typeof item !== 'object') continue;
        for (const { where, text } of textsOf(item)) {
          cleanup();
          const { container } = render(<MathMarkdown>{text}</MathMarkdown>);
          const imgs = Array.from(container.querySelectorAll('img'));
          const tag = `${path.basename(file)}:${item.id}/${where}`;
          if (!imgs.length) {
            failures.push(`${tag} — image markdown rendered no <img>`);
            continue;
          }
          for (const img of imgs) {
            checked++;
            const src = img.getAttribute('src') || '';
            if (src.includes('$')) {
              failures.push(`${tag} — src corrupted by math auto-wrap: ${src.slice(0, 70)}`);
            } else if (src.startsWith('/') && !fs.existsSync(path.join(publicDir, src))) {
              failures.push(`${tag} — src does not exist on disk: ${src.slice(0, 70)}`);
            }
          }
        }
      }
    }

    const minimumImages = authoredBankGate() === 'production' ? 0 : 500;
    expect(banks, 'expected to find authored banks for the selected gate').toBeGreaterThan(0);
    expect(checked, 'expected to render a meaningful number of images').toBeGreaterThanOrEqual(minimumImages);
    expect(
      failures,
      `${failures.length} authored image(s) do not reach the student:\n${failures.slice(0, 12).join('\n')}`,
    ).toEqual([]);
  }, 1800000);
});
