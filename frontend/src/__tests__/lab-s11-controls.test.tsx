/**
 * S11 — LabControlCard & LabSliderInput production migration tests.
 *
 * Verifies:
 * 1. Production scene components actually import and render the two shared components.
 * 2. label and ariaLabel are required and every LabSliderInput has a specific accessible name.
 * 3. LabSliderInput clamp/NaN boundary behaviour.
 * 4. LabControlCard layout does not regress to inline styles.
 * 5. CSS class token coverage.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';

import LabControlCard from '../components/lab/LabControlCard';
import LabSliderInput from '../components/lab/LabSliderInput';

// ─── 1. Production components import the shared components ─────────────────

describe('S11: LabControlCard production usage', () => {
  const labDir = path.resolve(__dirname, '../components/lab');

  const EXPECTED_CONTROL_CARD_USERS = [
    'AdvancedCurvesLab.tsx',
    'CalculusExtensionsLab.tsx',
    'CalculusTab.tsx',
    'ExplorerTab.tsx',
    'GeometryExtensionsLab.tsx',
    'GeometryTab.tsx',
    'SandboxTab.tsx',
    'StatisticsTab.tsx',
  ];

  const EXPECTED_SLIDER_INPUT_USERS = [
    'AdvancedCurvesLab.tsx',
    'CalculusExtensionsLab.tsx',
    'CalculusTab.tsx',
    'GeometryExtensionsLab.tsx',
    'GeometryTab.tsx',
    'SandboxTab.tsx',
  ];

  it.each(EXPECTED_CONTROL_CARD_USERS)(
    '%s imports LabControlCard',
    (filename) => {
      const content = fs.readFileSync(path.join(labDir, filename), 'utf-8');
      expect(content).toContain("from './LabControlCard'");
    },
  );

  it.each(EXPECTED_CONTROL_CARD_USERS)(
    '%s renders <LabControlCard',
    (filename) => {
      const content = fs.readFileSync(path.join(labDir, filename), 'utf-8');
      expect(content).toMatch(/<LabControlCard/);
    },
  );

  it.each(EXPECTED_SLIDER_INPUT_USERS)(
    '%s imports LabSliderInput',
    (filename) => {
      const content = fs.readFileSync(path.join(labDir, filename), 'utf-8');
      expect(content).toContain("from './LabSliderInput'");
    },
  );

  it.each(EXPECTED_SLIDER_INPUT_USERS)(
    '%s renders <LabSliderInput',
    (filename) => {
      const content = fs.readFileSync(path.join(labDir, filename), 'utf-8');
      expect(content).toMatch(/<LabSliderInput/);
    },
  );
});

// ─── 2. label and ariaLabel accessibility ──────────────────────────────────

describe('S11: LabSliderInput accessible names', () => {
  it('renders visible label text with current value', () => {
    render(
      <LabSliderInput
        id="test"
        label="Amplitude"
        ariaLabel="Wave amplitude"
        value={3}
        min={0}
        max={10}
        step={1}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText(/Amplitude = 3\.0/)).toBeTruthy();
  });

  it('applies ariaLabel to the range input', () => {
    render(
      <LabSliderInput
        id="test"
        label="Frequency"
        ariaLabel="Oscillation frequency"
        value={2}
        min={1}
        max={10}
        step={0.5}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('slider', { name: 'Oscillation frequency' })).toBeTruthy();
  });

  it('applies ariaLabel + " numeric input" to the number input', () => {
    render(
      <LabSliderInput
        id="test"
        label="Phase"
        ariaLabel="Phase offset"
        value={0}
        min={-3}
        max={3}
        step={0.1}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('spinbutton', { name: 'Phase offset numeric input' })).toBeTruthy();
  });

  it('every production LabSliderInput has a specific ariaLabel (not generic)', () => {
    const labDir = path.resolve(__dirname, '../components/lab');
    const files = fs.readdirSync(labDir).filter((f) => f.endsWith('.tsx'));
    const genericLabels = ['slider', 'input', 'control', 'value'];

    for (const file of files) {
      const content = fs.readFileSync(path.join(labDir, file), 'utf-8');
      const ariaLabelMatches = content.matchAll(/ariaLabel="([^"]+)"/g);
      for (const match of ariaLabelMatches) {
        const label = match[1].toLowerCase();
        // Each label should be a meaningful descriptor, not just "slider" or "input"
        const isGeneric = genericLabels.some(
          (g) => label === g || label === `${g} value`,
        );
        expect(isGeneric).toBe(false);
      }
    }
  });
});

// ─── 3. LabSliderInput clamp/NaN boundary behaviour ────────────────────────

describe('S11: LabSliderInput clamp and NaN boundaries', () => {
  it('clamps range input above max to max', () => {
    let received: number | undefined;
    render(
      <LabSliderInput
        id="test"
        label="Test"
        ariaLabel="Test slider"
        value={5}
        min={0}
        max={10}
        step={1}
        onChange={(v) => { received = v; }}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Test slider' });
    fireEvent.change(slider, { target: { value: '15' } });
    expect(received).toBe(10);
  });

  it('clamps number input below min to min when the field loses focus', () => {
    let received: number | undefined;
    render(
      <LabSliderInput
        id="test"
        label="Test"
        ariaLabel="Test slider"
        value={5}
        min={0}
        max={10}
        step={1}
        onChange={(v) => { received = v; }}
      />,
    );
    const numInput = screen.getByRole('spinbutton', { name: 'Test slider numeric input' });
    fireEvent.change(numInput, { target: { value: '-5' } });
    // Typing is still in progress: an out-of-range value is not applied yet.
    expect(received).toBeUndefined();
    fireEvent.blur(numInput);
    expect(received).toBe(0);
  });

  it('keeps the last value when the number input holds no number', () => {
    let received: number | undefined;
    render(
      <LabSliderInput
        id="test"
        label="Test"
        ariaLabel="Test slider"
        value={5}
        min={2}
        max={10}
        step={1}
        onChange={(v) => { received = v; }}
      />,
    );
    const numInput = screen.getByRole('spinbutton', { name: 'Test slider numeric input' }) as HTMLInputElement;
    // A browser reports text such as "abc" or an unfinished "-" as an empty value.
    fireEvent.change(numInput, { target: { value: 'abc' } });
    fireEvent.blur(numInput);
    expect(received).toBeUndefined();
    expect(numInput.value).toBe('5');
  });

  it('keeps the last value when the number input holds Infinity', () => {
    let received: number | undefined;
    render(
      <LabSliderInput
        id="test"
        label="Test"
        ariaLabel="Test slider"
        value={5}
        min={0}
        max={10}
        step={1}
        onChange={(v) => { received = v; }}
      />,
    );
    const numInput = screen.getByRole('spinbutton', { name: 'Test slider numeric input' }) as HTMLInputElement;
    fireEvent.change(numInput, { target: { value: 'Infinity' } });
    fireEvent.blur(numInput);
    expect(received).toBeUndefined();
    expect(numInput.value).toBe('5');
  });
});

// ─── 4. LabControlCard layout not regressed ────────────────────────────────

describe('S11: LabControlCard layout contract', () => {
  it('renders with lab-control-card and glass-panel classes', () => {
    const { container } = render(
      <LabControlCard title="Controls">
        <span>child</span>
      </LabControlCard>,
    );
    const el = container.firstElementChild!;
    expect(el.className).toContain('lab-control-card');
    expect(el.className).toContain('glass-panel');
  });

  it('renders compact variant class', () => {
    const { container } = render(
      <LabControlCard compact>
        <span>child</span>
      </LabControlCard>,
    );
    const el = container.firstElementChild!;
    expect(el.className).toContain('lab-control-card--compact');
  });

  it('does not use inline padding or gap styles', () => {
    const { container } = render(
      <LabControlCard title="T" description="D">
        <span>child</span>
      </LabControlCard>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.padding).toBe('');
    expect(el.style.gap).toBe('');
    expect(el.style.display).toBe('');
  });

  it('renders title in an h3 with correct class', () => {
    render(
      <LabControlCard title="Parameters">
        <span>child</span>
      </LabControlCard>,
    );
    const heading = screen.getByRole('heading', { name: 'Parameters' });
    expect(heading.tagName).toBe('H3');
    expect(heading.className).toContain('lab-control-card__title');
  });

  it('renders description with correct class', () => {
    const { container } = render(
      <LabControlCard description="Drag sliders to explore.">
        <span>child</span>
      </LabControlCard>,
    );
    const desc = container.querySelector('.lab-control-card__desc')!;
    expect(desc).not.toBeNull();
    expect(desc.textContent).toBe('Drag sliders to explore.');
  });
});

// ─── 5. CSS class token coverage ───────────────────────────────────────────

describe('S11: CSS class tokens in globals.css', () => {
  const cssPath = path.resolve(__dirname, '../app/globals.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  const REQUIRED_CLASSES = [
    '.lab-control-card',
    '.lab-control-card--compact',
    '.lab-control-card__title',
    '.lab-control-card__desc',
    '.lab-slider-input',
    '.lab-slider-input__label',
    '.lab-slider-input__row',
    '.lab-slider-input__range',
    '.lab-slider-input__number',
  ];

  it.each(REQUIRED_CLASSES)('contains CSS class %s', (cls) => {
    // Check it exists as a selector (starts a rule)
    expect(css).toContain(cls);
  });

  it('LabSliderInput component does not use inline styles', () => {
    const { container } = render(
      <LabSliderInput
        id="css-check"
        label="Check"
        ariaLabel="CSS check"
        value={1}
        min={0}
        max={5}
        step={1}
        onChange={() => undefined}
      />,
    );
    // The top-level div should not have inline style
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute('style')).toBeNull();
  });

  it('LabControlCard component does not use inline styles', () => {
    const { container } = render(
      <LabControlCard title="T" description="D" compact>
        <span>child</span>
      </LabControlCard>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute('style')).toBeNull();
  });
});

// ─── 6. Production files: bare range sliders only for Calculus mutual bounds ──

describe('S11: bare range sliders prohibited except Calculus mutual bounds', () => {
  const labDir = path.resolve(__dirname, '../components/lab');

  /**
   * Files that may contain bare type="range" inputs with a justification comment.
   * Only CalculusTab integral-bound sliders are exempt.
   */
  const CALCULUS_MUTUAL_BOUND_ALLOWLIST = ['CalculusTab.tsx'];

  it('CalculusTab integral bounds sliders have a justification comment', () => {
    const content = fs.readFileSync(path.join(labDir, 'CalculusTab.tsx'), 'utf-8');
    expect(content).toMatch(/Integral bound sliders.*no single numeric-input semantics.*kept as bare range/s);
  });

  it('no production Lab component (except Calculus mutual bounds) uses bare type="range"', () => {
    const files = fs.readdirSync(labDir).filter((f) => f.endsWith('.tsx'));
    const violations: string[] = [];
    for (const file of files) {
      if (CALCULUS_MUTUAL_BOUND_ALLOWLIST.includes(file)) continue;
      const content = fs.readFileSync(path.join(labDir, file), 'utf-8');
      // Match bare range inputs that are NOT inside a LabSliderInput (i.e. raw type="range")
      const rangeMatches = content.match(/type="range"/g);
      if (rangeMatches && rangeMatches.length > 0) {
        // If it imports LabSliderInput, then type="range" must only appear inside that component itself
        if (file === 'LabSliderInput.tsx') continue;
        violations.push(`${file} has ${rangeMatches.length} bare type="range" input(s)`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('GeometryExtensionsLab imports and renders LabSliderInput', () => {
    const content = fs.readFileSync(path.join(labDir, 'GeometryExtensionsLab.tsx'), 'utf-8');
    expect(content).toContain("from './LabSliderInput'");
    expect(content).toMatch(/<LabSliderInput/);
  });

  it('GeometryExtensionsLab imports and renders LabControlCard', () => {
    const content = fs.readFileSync(path.join(labDir, 'GeometryExtensionsLab.tsx'), 'utf-8');
    expect(content).toContain("from './LabControlCard'");
    expect(content).toMatch(/<LabControlCard/);
  });
});
