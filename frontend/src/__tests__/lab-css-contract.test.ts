/**
 * Lab CSS Contract Test (S10)
 *
 * Ensures every `lab-*` className used in JSX within components/lab and app/lab
 * has at least one corresponding CSS rule in globals.css.
 * This prevents future introduction of classNames with no styling.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/** Recursively collect all .tsx/.ts files under a directory. */
function collectFiles(dir: string, ext: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, ext));
    } else if (ext.some((e) => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

/** Known import-path modules that match lab-* but are not CSS classes. */
const IMPORT_MODULE_NAMES = new Set([
  'lab-activities',
  'lab-performance',
  'lab-storage',
  'lab-answer-normalise',
  'lab-topic-links',
  'lab-variants',
  'lab-explore-prompts',
  'lab-angle-geometry',
  'lab-answer-equivalence',
  'lab-variant-cores',
  'lab-variant-extensions',
]);

/** Extract unique lab-* classNames from JSX source files. */
function extractLabClassNames(files: string[]): Set<string> {
  const classNames = new Set<string>();
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      // Skip import/require lines entirely
      if (/^\s*(import |require\()/.test(line)) continue;
      // Match lab-<word> patterns in className attributes
      const pattern = /\blab-[a-z][a-z0-9-]*/g;
      const matches = line.match(pattern);
      if (matches) {
        for (const m of matches) {
          // Exclude id-only patterns (lab-tab-*, lab-tabpanel-* used as element IDs)
          if (m.startsWith('lab-tab-') && m !== 'lab-tab-grid' && m !== 'lab-tablist') continue;
          if (m.startsWith('lab-tabpanel-')) continue;
          // Exclude known module names
          if (IMPORT_MODULE_NAMES.has(m)) continue;
          classNames.add(m);
        }
      }
    }
  }
  return classNames;
}

/** Extract all lab-* class selectors defined in the CSS file. */
function extractCssLabSelectors(cssPath: string): Set<string> {
  const selectors = new Set<string>();
  const content = fs.readFileSync(cssPath, 'utf-8');
  // Match .lab-<word> in CSS selectors (may appear with pseudo-classes, combinators, etc.)
  const pattern = /\.lab-[a-z][a-z0-9-]*/g;
  const matches = content.match(pattern);
  if (matches) {
    for (const m of matches) {
      selectors.add(m.slice(1)); // Remove leading dot
    }
  }
  return selectors;
}

describe('Lab CSS Contract', () => {
  const rootDir = path.resolve(__dirname, '..');
  const componentsLabDir = path.join(rootDir, 'components', 'lab');
  const componentsLabSharedDir = path.join(rootDir, 'components', 'lab-shared');
  const appLabDir = path.join(rootDir, 'app', 'lab');
  const globalsCssPath = path.join(rootDir, 'app', 'globals.css');

  const labFiles = [
    ...collectFiles(componentsLabDir, ['.tsx', '.ts']),
    ...collectFiles(componentsLabSharedDir, ['.tsx', '.ts']),
    ...collectFiles(appLabDir, ['.tsx', '.ts']),
  ];

  const jsxClassNames = extractLabClassNames(labFiles);
  const cssSelectors = extractCssLabSelectors(globalsCssPath);

  it('scans at least 10 lab source files', () => {
    expect(labFiles.length).toBeGreaterThanOrEqual(10);
  });

  it('finds at least 8 unique lab-* classNames in JSX', () => {
    expect(jsxClassNames.size).toBeGreaterThanOrEqual(8);
  });

  it('every lab-* className used in JSX has a CSS rule in globals.css', () => {
    const missing: string[] = [];
    for (const cls of jsxClassNames) {
      if (!cssSelectors.has(cls)) {
        missing.push(cls);
      }
    }
    expect(missing, `Missing CSS rules for: ${missing.join(', ')}`).toEqual([]);
  });

  // Explicitly test each known class individually for clarity in failure output
  const expectedClasses = [
    'lab-tab-grid',
    'lab-control-column',
    'lab-visual-column',
    'lab-visual-info',
    'lab-page-content',
    'lab-directory-grid',
    'lab-directory-card',
    'lab-scene-control',
    'lab-compact-control-row',
    'lab-angle-control-row',
    'lab-topic-selector',
    'lab-tablist',
    'lab-control-card',
    'lab-control-row',
    'lab-slider-input',
  ];

  for (const cls of expectedClasses) {
    it(`CSS rule exists for .${cls}`, () => {
      expect(cssSelectors.has(cls), `.${cls} should have a CSS rule in globals.css`).toBe(true);
    });
  }
});
