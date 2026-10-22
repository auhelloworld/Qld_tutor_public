/**
 * S2 – LaTeX / Theme migration verification tests.
 *
 * Contracts:
 * 1. Production lab scenes use MafsLaTeX (imported as `LaTeX` from 'mafs') for all canvas math expressions.
 * 2. No hardcoded color literals (red/green/blue/#hex) in Mafs element color props.
 * 3. Files that use semantic Mafs colors import Theme from 'mafs'.
 * 4. The mafs mock transparently passes color, tex, and at props for testability.
 * 5. Plain language labels (Mean, Median, Success, Failure, Expected, QI–QIV, etc.) may remain as Text with documented reason.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const LAB_DIR = path.resolve(__dirname, '../components/lab');

/** Read a production file's source */
function src(filename: string): string {
  return fs.readFileSync(path.join(LAB_DIR, filename), 'utf-8');
}

// All scene files that render Mafs canvas elements
const SCENE_FILES = [
  'StatisticsTab.tsx',
  'LinearAlgebraTab.tsx',
  'CalculusExtensionsLab.tsx',
  'CalculusTab.tsx',
  'GeometryExtensionsLab.tsx',
  'ExplorerTab.tsx',
  'GeometryTab.tsx',
  'SandboxTab.tsx',
  'LinearSystemsLab.tsx',
  'AdvancedCurvesLab.tsx',
];

describe('S2: No hardcoded scene colors in Mafs elements', () => {
  // color="red", color="green", color="#hex" are not allowed; Theme.* or var(--*) required.
  const HARDCODED_COLOR_RE = /color=["'](red|green|blue|orange|#[0-9a-fA-F]{3,8})["']/;

  for (const file of SCENE_FILES) {
    it(`${file} has no hardcoded Mafs color props`, () => {
      const content = src(file);
      const matches = content.match(new RegExp(HARDCODED_COLOR_RE.source, 'g'));
      expect(matches).toBeNull();
    });
  }
});

describe('S2: Theme imports match actual Theme constant usage', () => {
  for (const file of SCENE_FILES) {
    it(`${file} imports Theme if and only if it uses Theme constants`, () => {
      const content = src(file);
      const usesTheme = /\bTheme\./.test(content);
      const importsTheme = /import\s*{[^}]*\bTheme\b[^}]*}\s*from\s*['"]mafs['"]/.test(content);
      expect(importsTheme).toBe(usesTheme);
    });
  }
});

describe('S2: Canvas math expressions use LaTeX, not Text', () => {
  // Any <Text ...>content containing =, digits with variables, coordinates, or Greek
  // must be LaTeX instead. We check that remaining <Text> only contains plain-language words.
  const FORMULA_IN_TEXT_RE = /<Text[^>]*>[^<]*[=πμσθ²³√∫∑∏≈≤≥±×÷]/;

  for (const file of SCENE_FILES) {
    it(`${file} does not render formulas inside Mafs Text`, () => {
      const content = src(file);
      const lines = content.split('\n');
      const violations: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (FORMULA_IN_TEXT_RE.test(lines[i])) {
          violations.push(`line ${i + 1}: ${lines[i].trim()}`);
        }
      }
      expect(violations).toEqual([]);
    });
  }
});

describe('S2: LaTeX component imported from mafs in files with math canvas labels', () => {
  const FILES_USING_LATEX = [
    'StatisticsTab.tsx',
    'LinearAlgebraTab.tsx',
    'CalculusExtensionsLab.tsx',
    'CalculusTab.tsx',
    'GeometryExtensionsLab.tsx',
    'ExplorerTab.tsx',
    'GeometryTab.tsx',
    'SandboxTab.tsx',
    'LinearSystemsLab.tsx',
    'AdvancedCurvesLab.tsx',
  ];

  for (const file of FILES_USING_LATEX) {
    it(`${file} imports LaTeX (or alias MafsLaTeX) from mafs`, () => {
      const content = src(file);
      expect(content).toMatch(/import\s*{[^}]*LaTeX[^}]*}\s*from\s*['"]mafs['"]/);
    });
  }
});

describe('S2: Mafs mock passes color prop for LaTeX', () => {
  it('LaTeX mock renders data-color attribute', () => {
    // Verify the mock definition includes color passthrough
    const testFile = fs.readFileSync(path.resolve(__dirname, 'lab-scenes.test.tsx'), 'utf-8');
    expect(testFile).toMatch(/data-color/);
    expect(testFile).toMatch(/LaTeX:/);
  });
});

describe('S2: Remaining Text usages have documented justification', () => {
  // Files that still import Text must have comments justifying each Text usage
  const FILES_WITH_TEXT = ['StatisticsTab.tsx', 'ExplorerTab.tsx', 'GeometryExtensionsLab.tsx'];

  for (const file of FILES_WITH_TEXT) {
    it(`${file} documents Text usage reason in comments`, () => {
      const content = src(file);
      if (content.includes('<Text ')) {
        // Must have at least one comment near Text about why it's kept
        expect(
          content.includes('plain language label') ||
            content.includes('keep Text') ||
            content.includes('language label') ||
            content.includes('instructional') ||
            content.includes('Roman-numeral') ||
            content.includes('vertex identification')
        ).toBe(true);
      }
    });
  }
});

describe('S2: LearnPanel has no hardcoded hex colors', () => {
  it('LearnPanel.tsx uses no #hex color values in props or inline styles', () => {
    const content = src('LearnPanel.tsx');
    // Allow hex in comments but not in active code
    const lines = content.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const hexMatches = lines.filter((l) => /#[0-9a-fA-F]{6}/.test(l));
    expect(hexMatches).toEqual([]);
  });
});
