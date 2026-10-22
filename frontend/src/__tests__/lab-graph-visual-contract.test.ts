import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const LAB_DIR = path.resolve(__dirname, '..', 'components', 'lab');
const GLOBALS_CSS = path.resolve(__dirname, '..', 'app', 'globals.css');

const GRAPH_FILES = [
  'ExplorerTab.tsx',
  'GeometryTab.tsx',
  'SandboxTab.tsx',
  'CalculusTab.tsx',
  'CalculusExtensionsLab.tsx',
  'AdvancedCurvesLab.tsx',
  'LinearSystemsLab.tsx',
  'LinearAlgebraTab.tsx',
  'StatisticsTab.tsx',
  'GeometryExtensionsLab.tsx',
] as const;

const POINT_COLOR_PATTERN = /\bcolor="var\(--(?:accent-color|text-secondary|success)\)"/;

describe('Lab graph visual restraint contract', () => {
  const graphSources = GRAPH_FILES.map((file) => ({
    file,
    source: fs.readFileSync(path.join(LAB_DIR, file), 'utf8'),
  }));

  it('checks every production graph file that renders coordinate points or point labels', () => {
    expect(graphSources).toHaveLength(10);
    expect(graphSources.every(({ source }) => source.includes('<Mafs'))).toBe(true);
  });

  it('limits Point and MovablePoint markers to primary, secondary neutral, or result colours', () => {
    const pointTags = graphSources.flatMap(({ file, source }) =>
      Array.from(source.matchAll(/<(?:Point|MovablePoint)\b[\s\S]*?\/>/g), (match) => ({
        file,
        tag: match[0],
      })),
    );

    expect(pointTags.length).toBeGreaterThanOrEqual(25);
    const violations = pointTags.filter(({ tag }) => !POINT_COLOR_PATTERN.test(tag));
    expect(
      violations,
      `Point colours outside the restrained palette:\n${violations
        .map(({ file, tag }) => `${file}: ${tag.replace(/\s+/g, ' ')}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('does not reintroduce purple or Mafs rainbow Theme colours in graph scenes', () => {
    for (const { file, source } of graphSources) {
      expect(source, `${file} should use the restrained Lab graph palette`).not.toContain(
        'color="var(--accent-purple)"',
      );
      expect(source, `${file} should not use Theme rainbow colours`).not.toMatch(/Theme\./);
    }
  });

  it('passes valid KaTeX commands through direct JSX tex attributes', () => {
    const violations = graphSources.flatMap(({ file, source }) =>
      Array.from(source.matchAll(/\btex="([^"]*)"/g), (match) => ({ file, tex: match[1] }))
        .filter(({ tex }) => /\\\\[A-Za-z,;]/.test(tex) || tex.includes('°')),
    );

    expect(
      violations,
      `Direct JSX tex attributes must use one backslash and KaTeX degree syntax:\n${violations
        .map(({ file, tex }) => `${file}: ${tex}`)
        .join('\n')}`,
    ).toEqual([]);

    const geometryExtensions = graphSources.find(
      ({ file }) => file === 'GeometryExtensionsLab.tsx',
    )?.source ?? '';
    expect(geometryExtensions).not.toContain('labelPi');
  });

  it('renders Polar Curves as a polar-only grid with angular labels and meaningful models', () => {
    const advanced = graphSources.find(({ file }) => file === 'AdvancedCurvesLab.tsx')?.source ?? '';

    expect(advanced).toContain(
      '<Coordinates.Polar xAxis={false} yAxis={false} lines={1} subdivisions={4} />',
    );
    for (const angle of [
      'tex="0"',
      'tex="\\frac{\\pi}{4}"',
      'tex="\\frac{\\pi}{2}"',
      'tex="\\pi"',
      'tex="\\frac{3\\pi}{2}"',
    ]) {
      expect(advanced).toContain(angle);
    }
    for (const model of ['Cardioid', 'Archimedean spiral', 'Lemniscate']) {
      expect(advanced).toContain(model);
    }
    expect(advanced).toContain('return a * (1 + Math.cos(theta));');
    expect(advanced).toContain('return a * theta / (2 * Math.PI);');
    expect(advanced).toContain('r² = a² cos(2θ)');
    expect(advanced).toContain('[-Math.PI / 4, Math.PI / 4]');
    expect(advanced).toContain('[3 * Math.PI / 4, 5 * Math.PI / 4]');
    expect(advanced).toContain('Polar coordinate grid with angle labels');
  });

  it('keeps dense Explorer and Geometry canvas labels short and offset from point rings', () => {
    const explorer = graphSources.find(({ file }) => file === 'ExplorerTab.tsx')?.source ?? '';
    const geometry = graphSources.find(({ file }) => file === 'GeometryTab.tsx')?.source ?? '';

    for (const label of ['P', 'Q', 'M']) {
      expect(explorer).toContain(`tex="${label}"`);
    }
    for (const label of ['A', 'B', 'C', "A'", "B'", "C'"]) {
      expect(geometry).toContain(`tex="${label}"`);
    }
    expect(explorer.match(/mafs-point-label--(?:nw|ne|sw|se)/g)).toHaveLength(4);
    expect(geometry.match(/mafs-point-label--(?:nw|ne|sw|se)/g)).toHaveLength(6);
  });

  it('uses shared roles for key object labels and axis-clear readouts', () => {
    const linear = graphSources.find(({ file }) => file === 'LinearAlgebraTab.tsx')?.source ?? '';
    const statistics = graphSources.find(({ file }) => file === 'StatisticsTab.tsx')?.source ?? '';
    const css = fs.readFileSync(GLOBALS_CSS, 'utf8');

    expect(linear.match(/mafs-label--key/g)).toHaveLength(6);
    expect(statistics.match(/mafs-label--axis-readout/g)).toHaveLength(4);
    expect(css).toMatch(/\.mafs-label--key foreignObject > div\s*\{[\s\S]*?font-size:\s*17px\s*!important/);
    expect(css).toMatch(/\.MafsView \.mafs-label--axis-readout\s*\{[\s\S]*?translate\(0, -30px\)/);
    expect(css).toMatch(/\.MafsView \.mafs-label--axis-readout\.mafs-label--offset-right\s*\{[\s\S]*?translate\(22px, -30px\)/);
  });

  it('keeps Probability bar charts categorical and horizontally readable in Explore and Learn', () => {
    const statistics = graphSources.find(({ file }) => file === 'StatisticsTab.tsx')?.source ?? '';
    const probability = statistics.slice(
      statistics.indexOf('function ExploreProbabilityVis'),
      statistics.indexOf('function ExploreScatterVis'),
    );

    expect(probability.match(/xAxis=\{\{ lines: false, labels: false \}\}/g)).toHaveLength(2);
    expect(probability.match(/preserveAspectRatio=\{false\}/g)).toHaveLength(2);
  });

  it('keeps canvas labels small, shadow-free, and clear of subdued drag rings', () => {
    const css = fs.readFileSync(GLOBALS_CSS, 'utf8');
    const latexRule = css.match(
      /\.mafs-stage \.MafsView foreignObject > div\s*\{([\s\S]*?)\}/,
    )?.[1];
    const svgTextRule = css.match(/\.mafs-container svg text\s*\{([\s\S]*?)\}/)?.[1];
    const katexRule = css.match(
      /\.mafs-stage \.MafsView foreignObject > div \.katex\s*\{([\s\S]*?)\}/,
    )?.[1];
    const ringRule = css.match(
      /\.mafs-stage \.mafs-movable-point-ring\s*\{([\s\S]*?)\}/,
    )?.[1];

    expect(latexRule).toBeDefined();
    expect(latexRule).toMatch(/color:\s*var\(--text-primary\)\s*!important/);
    expect(latexRule).toMatch(/font-size:\s*14px\s*!important/);
    expect(latexRule).toMatch(/white-space:\s*nowrap/);
    expect(latexRule).toMatch(/text-shadow:\s*none\s*!important/);
    expect(latexRule).toMatch(/filter:\s*none\s*!important/);
    expect(katexRule).toMatch(/font-size:\s*1em/);
    expect(katexRule).toMatch(/text-shadow:\s*none\s*!important/);
    expect(svgTextRule).toBeDefined();
    expect(svgTextRule).toMatch(/fill:\s*var\(--text-primary\)\s*!important/);
    expect(svgTextRule).toMatch(/font-size:\s*13px\s*!important/);
    expect(svgTextRule).toMatch(/paint-order:\s*normal\s*!important/);
    expect(svgTextRule).toMatch(/stroke:\s*none\s*!important/);
    expect(svgTextRule).toMatch(/text-shadow:\s*none\s*!important/);
    expect(ringRule).toMatch(/fill-opacity:\s*0\s*;/);
    for (const [direction, offset] of [
      ['nw', '-24px, -24px'],
      ['ne', '24px, -24px'],
      ['sw', '-24px, 24px'],
      ['se', '24px, 24px'],
    ]) {
      expect(css).toContain(`.mafs-stage .mafs-point-label--${direction} foreignObject > div`);
      expect(css).toContain(`transform: translate(${offset});`);
    }
  });

  it('keeps narrow graph axes and high-density labels readable', () => {
    const css = fs.readFileSync(GLOBALS_CSS, 'utf8');
    const calculus = graphSources.find(({ file }) => file === 'CalculusExtensionsLab.tsx')?.source ?? '';
    const geometry = graphSources.find(({ file }) => file === 'GeometryTab.tsx')?.source ?? '';
    const linear = graphSources.find(({ file }) => file === 'LinearAlgebraTab.tsx')?.source ?? '';
    const sandbox = graphSources.find(({ file }) => file === 'SandboxTab.tsx')?.source ?? '';
    const statistics = graphSources.find(({ file }) => file === 'StatisticsTab.tsx')?.source ?? '';

    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*?\.mafs-stage \.MafsView \.mafs-axis > g > text:nth-child\(even\)/);
    expect(css).toMatch(/\.mafs-stage \.MafsView \.mafs-axis > g \+ g > text:first-child/);
    expect(calculus).toContain('newtonLabelPosition');
    expect(calculus).toContain('y: [-newtonK - 1.35');
    expect(geometry).toContain('mafs-point-label--ne');
    expect(geometry).toContain('enlargeCentre[0] - 2.8');
    expect(geometry).toContain('ptB_prime[0] - 0.7');
    expect(linear).toContain('vectorBIsZero');
    expect(sandbox).toContain('at={[x + 0.6, y + 1.2]}');
    expect(sandbox).toContain('y - 3.5');
    expect(statistics).toContain('summary.q1, 2.8');
    expect(statistics).toContain('maxFreq + 3.5');
    expect(statistics).toContain('maxFreq + 2.7');
    expect(statistics).toContain('yMax * 0.15');
    expect(statistics).toContain('mu - 2.4 * sigma');
  });
});
