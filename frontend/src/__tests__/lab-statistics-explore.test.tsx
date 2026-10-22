/**
 * Behavioral tests for Statistics Box Plot and Tree/Two-Way Explore scenes.
 *
 * Tests:
 * - Box Plot: editable data (add, remove, reset), max 40 cap, five-number summary, Mafs visual
 * - Tree/Two-Way: tree/table scene switching, editable parameters, deterministic results
 * - Deep-link entry renders visuals immediately
 * - No timers used
 * - Learn mode does not leak Explore reveal logic
 */

import type { ReactNode } from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

vi.mock('mafs', () => ({
  Mafs: ({ children }: { children?: ReactNode }) => <div data-testid="mafs">{children}</div>,
  Coordinates: {
    Cartesian: () => <div data-testid="coordinates" />,
    Polar: () => <div data-testid="polar-coordinates" />,
  },
  MovablePoint: () => <div data-testid="movable-point" />,
  Point: () => <div data-testid="point" />,
  Circle: () => <div data-testid="circle" />,
  Polygon: () => <div data-testid="polygon" />,
  Text: ({ children }: { children?: ReactNode }) => <span data-testid="mafs-text">{children}</span>,
  Line: {
    Segment: () => <div data-testid="line-segment" />,
    ThroughPoints: () => <div data-testid="line-through-points" />,
    PointAngle: () => <div data-testid="line-point-angle" />,
    PointSlope: () => <div data-testid="line-point-slope" />,
  },
  Plot: {
    OfX: () => <div data-testid="plot-of-x" />,
    OfY: () => <div data-testid="plot-of-y" />,
    Inequality: () => <div data-testid="plot-inequality" />,
    Parametric: () => <div data-testid="plot-parametric" />,
    VectorField: () => <div data-testid="plot-vector-field" />,
  },
  Vector: () => <div data-testid="vector" />,
  Transform: ({ children }: { children?: ReactNode }) => <div data-testid="transform">{children}</div>,
  LaTeX: () => <div data-testid="latex" />,
  Ellipse: () => <div data-testid="ellipse" />,
  Polyline: () => <div data-testid="polyline" />,
  labelPi: (x: number) => String(x),
  Theme: { foreground: '#000', background: '#fff', red: '#f00', blue: '#00f', green: '#0f0', orange: '#f80', indigo: '#40f', violet: '#80f', pink: '#f0f', yellow: '#ff0' },
}));

import StatisticsTab from '../components/lab/StatisticsTab';
import { fiveNumberSummary, treeProbWithoutReplacement, twoWayNeither } from '../components/lab/StatisticsTab';
import { LAB_RENDER_LIMITS } from '../lib/lab-performance';

describe('Box Plot Explore scene', () => {
  afterEach(cleanup);

  it('renders box-plot visual with default 7 data points on module select', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));

    // Visual element
    expect(container.querySelector('[data-testid="box-plot-explore-vis"]')).toBeTruthy();
    // 7 default data points
    expect(container.querySelectorAll('[data-testid="point"]')).toHaveLength(7);
    // Box polygon
    expect(container.querySelectorAll('[data-testid="polygon"]').length).toBeGreaterThanOrEqual(1);
    // Whisker + median line segments
    expect(container.querySelectorAll('[data-testid="line-segment"]').length).toBeGreaterThanOrEqual(4);
  });

  it('shows correct five-number summary for default data', () => {
    render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));

    const summary = screen.getByTestId('box-plot-summary');
    expect(summary.textContent).toMatch(/n = 7/);
    expect(summary.textContent).toMatch(/Min = 3/);
    expect(summary.textContent).toMatch(/Q1 = 5/);
    expect(summary.textContent).toMatch(/Median = 8/);
    expect(summary.textContent).toMatch(/Q3 = 14/);
    expect(summary.textContent).toMatch(/Max = 16/);
    expect(summary.textContent).toMatch(/IQR = 9/);
  });

  it('can add a data value and summary updates', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));

    const input = screen.getByLabelText('New box plot value');
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.click(screen.getByLabelText('Add box plot value'));

    // Now 8 points
    expect(container.querySelectorAll('[data-testid="point"]')).toHaveLength(8);
    const summary = screen.getByTestId('box-plot-summary');
    expect(summary.textContent).toMatch(/n = 8/);
    expect(summary.textContent).toMatch(/Max = 20/);
  });

  it('can add via Enter key', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));

    const input = screen.getByLabelText('New box plot value');
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(container.querySelectorAll('[data-testid="point"]')).toHaveLength(8);
  });

  it('can remove last data value', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));

    fireEvent.click(screen.getByLabelText('Remove last box plot value'));
    expect(container.querySelectorAll('[data-testid="point"]')).toHaveLength(6);
  });

  it('remove button is disabled when only 1 value remains', () => {
    render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));

    // Remove 6 times to get to 1 value
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByLabelText('Remove last box plot value'));
    }
    const removeBtn = screen.getByLabelText('Remove last box plot value') as HTMLButtonElement;
    expect(removeBtn.disabled).toBe(true);
  });

  it('can reset data to defaults', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));

    // Add a value first
    const input = screen.getByLabelText('New box plot value');
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.click(screen.getByLabelText('Add box plot value'));
    expect(container.querySelectorAll('[data-testid="point"]')).toHaveLength(8);

    // Reset
    fireEvent.click(screen.getByLabelText('Reset box plot data'));
    expect(container.querySelectorAll('[data-testid="point"]')).toHaveLength(7);
  });

  it('add button is disabled at MAX_DATA (40)', () => {
    render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));

    // Add values up to 40
    const input = screen.getByLabelText('New box plot value');
    for (let i = 0; i < 33; i++) {
      fireEvent.change(input, { target: { value: String(i + 20) } });
      fireEvent.click(screen.getByLabelText('Add box plot value'));
    }
    // Now at 40 (7 default + 33 added)
    const addBtn = screen.getByLabelText('Add box plot value') as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it('data points never exceed 40 even with rapid adding', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));

    const input = screen.getByLabelText('New box plot value');
    // Try adding more than 40
    for (let i = 0; i < 50; i++) {
      fireEvent.change(input, { target: { value: String(i) } });
      fireEvent.click(screen.getByLabelText('Add box plot value'));
    }
    const points = container.querySelectorAll('[data-testid="point"]');
    expect(points.length).toBeLessThanOrEqual(LAB_RENDER_LIMITS.dataPoints);
  });

  it('clamps input values to [-100, 100]', () => {
    render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));

    const input = screen.getByLabelText('New box plot value');
    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.click(screen.getByLabelText('Add box plot value'));

    const summary = screen.getByTestId('box-plot-summary');
    expect(summary.textContent).toMatch(/Max = 100/);
  });

  it('rejects non-numeric input', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));

    const input = screen.getByLabelText('New box plot value');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(screen.getByLabelText('Add box plot value'));

    // Still 7 points
    expect(container.querySelectorAll('[data-testid="point"]')).toHaveLength(7);
  });

  it('deep-link with activityId shows box-plot immediately in Explore', () => {
    const { container } = render(
      <StatisticsTab mafsHeight={320} mode="explore" activityId="statistics-box-plot" />
    );
    expect(container.querySelector('[data-testid="box-plot-explore-vis"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="point"]').length).toBeGreaterThanOrEqual(7);
  });
});

describe('Tree/Two-Way Explore scene', () => {
  afterEach(cleanup);

  it('renders tree diagram by default on module select', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Tree & Two-Way/i }));

    expect(container.querySelector('[data-testid="tree-explore-vis"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="tree-diagram-explore"]')).toBeTruthy();
  });

  it('can switch to two-way table scene', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Tree & Two-Way/i }));
    fireEvent.click(screen.getByRole('radio', { name: /Two-Way Table/i }));

    expect(container.querySelector('[data-testid="table-explore-vis"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="two-way-table-explore"]')).toBeTruthy();
    // Tree should be gone
    expect(container.querySelector('[data-testid="tree-explore-vis"]')).toBeNull();
  });

  it('can switch back to tree from table', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Tree & Two-Way/i }));
    fireEvent.click(screen.getByRole('radio', { name: /Two-Way Table/i }));
    fireEvent.click(screen.getByRole('radio', { name: /Tree Diagram/i }));

    expect(container.querySelector('[data-testid="tree-explore-vis"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="table-explore-vis"]')).toBeNull();
  });

  it('tree diagram shows editable red/blue marble counts', () => {
    render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Tree & Two-Way/i }));

    const redInput = screen.getByLabelText('Red marble count') as HTMLInputElement;
    const blueInput = screen.getByLabelText('Blue marble count') as HTMLInputElement;
    expect(redInput.value).toBe('3');
    expect(blueInput.value).toBe('2');
  });

  it('changing red count updates tree probability deterministically', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Tree & Two-Way/i }));

    // Change to 4 red, 2 blue
    fireEvent.change(screen.getByLabelText('Red marble count'), { target: { value: '4' } });

    // P(both red) = 4/6 × 3/5 = 12/30 = 0.4
    const result = container.querySelector('[data-testid="tree-explore-result"]');
    expect(result).toBeTruthy();
    expect(result!.textContent).toMatch(/0\.4000/);
  });

  it('changing blue count updates tree probability deterministically', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Tree & Two-Way/i }));

    // Change to 3 red, 3 blue → P(RR) = 3/6 × 2/5 = 6/30 = 0.2
    fireEvent.change(screen.getByLabelText('Blue marble count'), { target: { value: '3' } });

    const result = container.querySelector('[data-testid="tree-explore-result"]');
    expect(result!.textContent).toMatch(/0\.2000/);
  });

  it('two-way table has editable parameters and computes neither', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Tree & Two-Way/i }));
    fireEvent.click(screen.getByRole('radio', { name: /Two-Way Table/i }));

    // Default: sport∩music=15, sportTotal=25, musicTotal=20, grand=40 → neither=10
    const result = container.querySelector('[data-testid="table-explore-result"]');
    expect(result!.textContent).toMatch(/Neither.*= 10/);
  });

  it('changing intersection updates neither deterministically', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Tree & Two-Way/i }));
    fireEvent.click(screen.getByRole('radio', { name: /Two-Way Table/i }));

    // Change intersection to 10 → Union = 25+20-10 = 35, Neither = 40-35 = 5
    fireEvent.change(screen.getByLabelText('Sport and Music intersection'), { target: { value: '10' } });

    const result = container.querySelector('[data-testid="table-explore-result"]');
    expect(result!.textContent).toMatch(/Neither.*= 5/);
  });

  it('deep-link with activityId shows tree/two-way immediately in Explore', () => {
    const { container } = render(
      <StatisticsTab mafsHeight={320} mode="explore" activityId="statistics-tree-two-way" />
    );
    expect(container.querySelector('[data-testid="tree-explore-vis"]')).toBeTruthy();
  });

  it('two-way table renders conditional probability', () => {
    const { container } = render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Tree & Two-Way/i }));
    fireEvent.click(screen.getByRole('radio', { name: /Two-Way Table/i }));

    // P(Music|Sport) = 15/25 = 0.6 — rendered in the visual panel
    const vis = container.querySelector('[data-testid="table-explore-vis"]');
    expect(vis).toBeTruthy();
    expect(vis!.textContent).toMatch(/P\(Music \| Sport\).*= 0\.6000/);
  });
});

describe('Box Plot and Tree/Two-Way: no timer usage', () => {
  afterEach(cleanup);

  it('Box Plot Explore does not use setTimeout', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Box Plot/i }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('Tree/Two-Way Explore does not use setTimeout', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    render(<StatisticsTab mafsHeight={320} mode="explore" />);
    fireEvent.click(screen.getByRole('radio', { name: /Tree & Two-Way/i }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Learn mode does not leak Explore reveal logic', () => {
  afterEach(cleanup);

  it('Box Plot Learn does NOT show box-plot-explore-vis testid (uses separate LearnBoxPlotVis)', () => {
    const { container } = render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-box-plot"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );
    // Learn mode uses LearnBoxPlotVis, not ExploreBoxPlotVis
    expect(container.querySelector('[data-testid="box-plot-explore-vis"]')).toBeNull();
    // Learn mode still renders points (data dots) in the learn vis
    expect(container.querySelectorAll('[data-testid="point"]').length).toBeGreaterThanOrEqual(7);
  });

  it('Tree/Two-Way Learn does NOT show tree-explore-vis or table-explore-vis testids', () => {
    const { container } = render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-tree-two-way"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );
    // Learn mode uses LearnTreeTwoWayVis, not ExploreTreeTwoWayVis
    expect(container.querySelector('[data-testid="tree-explore-vis"]')).toBeNull();
    expect(container.querySelector('[data-testid="table-explore-vis"]')).toBeNull();
    // But it does render the learn tree diagram
    expect(container.querySelector('[data-testid="tree-diagram"]')).toBeTruthy();
  });

  it('Box Plot Learn hides whiskers and labels before reveal (gating is intact)', () => {
    const { container } = render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-box-plot"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />
    );
    // Before reveal, box and whiskers should be hidden (controlled by revealed prop)
    // Only data dots are shown
    expect(container.querySelectorAll('[data-testid="point"]').length).toBeGreaterThanOrEqual(7);
    // Box polygon is hidden until reveal
    expect(container.querySelectorAll('[data-testid="polygon"]')).toHaveLength(0);
  });
});

describe('Deterministic helpers: fiveNumberSummary', () => {
  it('computes correct summary for odd-length data', () => {
    const result = fiveNumberSummary([3, 5, 7, 8, 12, 14, 16]);
    expect(result).toEqual({ min: 3, q1: 5, median: 8, q3: 14, max: 16 });
  });

  it('computes correct summary for even-length data', () => {
    const result = fiveNumberSummary([1, 2, 3, 4, 5, 6]);
    expect(result.min).toBe(1);
    expect(result.max).toBe(6);
    expect(result.median).toBe(3.5);
    expect(result.q1).toBe(2);
    expect(result.q3).toBe(5);
  });

  it('handles single-element data', () => {
    const result = fiveNumberSummary([5]);
    expect(result).toEqual({ min: 5, q1: 5, median: 5, q3: 5, max: 5 });
  });

  it('handles empty data', () => {
    const result = fiveNumberSummary([]);
    expect(result).toEqual({ min: 0, q1: 0, median: 0, q3: 0, max: 0 });
  });

  it('sorts unsorted input', () => {
    const result = fiveNumberSummary([16, 3, 7, 14, 5, 12, 8]);
    expect(result).toEqual({ min: 3, q1: 5, median: 8, q3: 14, max: 16 });
  });
});

describe('Deterministic helpers: treeProbWithoutReplacement', () => {
  it('computes P(both red) from [3,2] draws [0,0]', () => {
    const p = treeProbWithoutReplacement([3, 2], [0, 0]);
    expect(p).toBeCloseTo(3 / 5 * 2 / 4, 10);
  });

  it('computes P(red then blue) from [3,2] draws [0,1]', () => {
    const p = treeProbWithoutReplacement([3, 2], [0, 1]);
    expect(p).toBeCloseTo(3 / 5 * 2 / 4, 10);
  });

  it('returns 0 for impossible draws', () => {
    expect(treeProbWithoutReplacement([1, 2], [0, 0])).toBe(0);
  });

  it('returns 0 for empty inputs', () => {
    expect(treeProbWithoutReplacement([], [0])).toBe(0);
    expect(treeProbWithoutReplacement([3, 2], [])).toBe(0);
  });
});

describe('Deterministic helpers: twoWayNeither', () => {
  it('computes neither for default values', () => {
    expect(twoWayNeither(40, 25, 20, 15)).toBe(10);
  });

  it('returns 0 when union covers all', () => {
    expect(twoWayNeither(40, 25, 20, 5)).toBe(0);
  });

  it('handles zero total gracefully', () => {
    expect(twoWayNeither(0, 5, 5, 5)).toBe(0);
  });

  it('clamps to 0 when union exceeds total', () => {
    expect(twoWayNeither(10, 8, 8, 2)).toBe(0);
  });
});
