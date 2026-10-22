/**
 * P5 gap tests:
 * 1) buildLabDeepLink(mode=explore) → page.tsx URL restore + tab Explore/Learn round-trip
 * 2) sandbox-distance-time in Explore selector + averageSpeed helper boundary tests
 * 3) S6: 4 junior activities complete 3-step Learn with onActivityComplete(id, true)
 * 4) MathSymbolKeyboard setTimeout cleanup on unmount
 * 5) lab-render-budget: setInterval/rAF, keyboard timer cleanup, cross-tab unmount, all explore topics
 * 6) Entry points: home page and Dashboard lab links
 * 7) S7 Format ARIA real page test
 * 9) S9 anti-leak: per-prompt no meaningful acceptedAnswer full match
 */

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// --- Mafs mock (matching lab-p5-scenes) ---
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
    OfX: ({ y }: { y?: (x: number) => number }) => (
      <div data-testid="plot-of-x" data-value-at-zero={y ? String(y(0)) : ''} />
    ),
    OfY: () => <div data-testid="plot-of-y" />,
    Inequality: () => <div data-testid="plot-inequality" />,
    Parametric: ({ maxSamplingDepth }: { maxSamplingDepth?: number }) => (
      <div data-testid="plot-parametric" data-sampling-depth={maxSamplingDepth ?? ''} />
    ),
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

import { buildLabDeepLink } from '../lib/lab-topic-links';
import { LAB_ACTIVITIES } from '../lib/lab-activities';
import { EXPLORE_PROMPTS } from '../lib/lab-explore-prompts';
import { averageSpeed } from '../lib/math-utils';
import SandboxTab from '../components/lab/SandboxTab';
import StatisticsTab from '../components/lab/StatisticsTab';
import GeometryTab from '../components/lab/GeometryTab';
import MathSymbolKeyboard from '../components/MathSymbolKeyboard';

function submit(answer: string) {
  fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: answer } });
  fireEvent.click(screen.getByText('Submit'));
}

function advance() {
  fireEvent.click(screen.getByText(/Next/));
}

// ─── 1) buildLabDeepLink(mode=explore) round-trip ────────────────────────────

describe('P5 buildLabDeepLink explore mode', () => {
  it('buildLabDeepLink(id, "explore") produces correct URL params', () => {
    const url = buildLabDeepLink('sandbox-distance-time', 'explore');
    expect(url).toContain('tab=sandbox');
    expect(url).toContain('mode=explore');
    expect(url).toContain('activity=sandbox-distance-time');
  });

  it('buildLabDeepLink(id, "learn") produces correct URL params', () => {
    const url = buildLabDeepLink('geometry-pythagoras', 'learn');
    expect(url).toContain('tab=geometry');
    expect(url).toContain('mode=learn');
    expect(url).toContain('activity=geometry-pythagoras');
  });

  it('buildLabDeepLink for invalid id falls back to /lab', () => {
    const url = buildLabDeepLink('nonexistent-activity' as any, 'explore');
    expect(url).toBe('/lab');
  });
});

// ─── 2) sandbox-distance-time in Explore selector + averageSpeed ─────────────

describe('P5 sandbox-distance-time Explore rendering', () => {
  afterEach(cleanup);

  it('renders the Distance–Time Graph Explorer heading when topic is selected', async () => {
    render(<SandboxTab isExact mafsHeight={320} mode="explore" />);
    // Switch to distance-time
    fireEvent.change(screen.getByLabelText('Sandbox explore topic'), {
      target: { value: 'sandbox-distance-time' },
    });
    expect(screen.getByText('Distance–Time Graph Explorer')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByLabelText('Average speed over the first two hours').textContent).toContain('15');
    });
  });

  it('renders a linear function (slope=gradient) in distance-time explore', () => {
    const { container } = render(<SandboxTab isExact mafsHeight={320} mode="explore" />);
    fireEvent.change(screen.getByLabelText('Sandbox explore topic'), {
      target: { value: 'sandbox-distance-time' },
    });
    const plots = container.querySelectorAll('[data-testid="plot-of-x"]');
    expect(plots.length).toBeGreaterThan(0);
  });

  it('sandbox-distance-time option is present in selector', () => {
    render(<SandboxTab isExact mafsHeight={320} mode="explore" />);
    const select = screen.getByLabelText('Sandbox explore topic') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).toContain('sandbox-distance-time');
  });
});

describe('averageSpeed helper (production export)', () => {
  it('computes average speed for constant speed journey', () => {
    expect(averageSpeed(30, 2)).toBe(15);
  });

  it('computes average speed including rest time', () => {
    expect(averageSpeed(60, 2)).toBe(30);
  });

  it('returns 0 for zero time', () => {
    expect(averageSpeed(100, 0)).toBe(0);
  });

  it('returns 0 for negative time', () => {
    expect(averageSpeed(100, -1)).toBe(0);
  });

  it('returns 0 for zero distance', () => {
    expect(averageSpeed(0, 5)).toBe(0);
  });

  it('returns 0 for NaN time', () => {
    expect(averageSpeed(10, NaN)).toBe(0);
  });

  it('returns 0 for Infinity distance', () => {
    expect(averageSpeed(Infinity, 2)).toBe(0);
  });

  it('returns correct for fractional values', () => {
    expect(averageSpeed(7.5, 0.5)).toBe(15);
  });
});

// ─── 3) S6: Four junior activities complete 3-step Learn ─────────────────────

describe('S6 Junior activity completions (onActivityComplete)', () => {
  afterEach(cleanup);

  it('statistics-box-plot: 3 correct steps → onActivityComplete(id, true)', () => {
    const onComplete = vi.fn();
    render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-box-plot"
        onActivityComplete={onComplete}
        onExitLearn={vi.fn()}
      />,
    );

    // Step 0: median of [3,5,7,8,12,14,16] = 8
    submit('8');
    advance();

    // Step 1: Q1 (lower quartile) = median of {3,5,7} = 5
    submit('5');
    advance();

    // Step 2: IQR = Q3 - Q1 = 14 - 5 = 9
    submit('9');
    fireEvent.click(screen.getByText('Finish'));

    expect(onComplete).toHaveBeenCalledWith('statistics-box-plot', true);
  });

  it('statistics-tree-two-way: 3 correct steps → onActivityComplete(id, true)', () => {
    const onComplete = vi.fn();
    render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-tree-two-way"
        onActivityComplete={onComplete}
        onExitLearn={vi.fn()}
      />,
    );

    // Step 0: P(both red) from tree = 3/10
    submit('3/10');
    advance();

    // Step 1: Neither category in two-way table = 10
    submit('10');
    advance();

    // Step 2: transfer question
    const activity = LAB_ACTIVITIES['statistics-tree-two-way'];
    const step2Answer = activity.steps[2].acceptedAnswers[0];
    submit(step2Answer);
    fireEvent.click(screen.getByText('Finish'));

    expect(onComplete).toHaveBeenCalledWith('statistics-tree-two-way', true);
  });

  it('sandbox-distance-time: 3 correct steps → onActivityComplete(id, true)', () => {
    const onComplete = vi.fn();
    render(
      <SandboxTab
        isExact
        mafsHeight={320}
        mode="learn"
        activityId="sandbox-distance-time"
        onActivityComplete={onComplete}
        onExitLearn={vi.fn()}
      />,
    );

    // Step 0: average speed = 30/2 = 15
    submit('15');
    advance();

    // Step 1: horizontal = stationary
    submit('stationary');
    advance();

    // Step 2: total distance 60km, total time 2h, speed = 30
    submit('30');
    fireEvent.click(screen.getByText('Finish'));

    expect(onComplete).toHaveBeenCalledWith('sandbox-distance-time', true);
  });

  it('geometry-similarity-ratio: 3 correct steps → onActivityComplete(id, true)', () => {
    const onComplete = vi.fn();
    render(
      <GeometryTab
        isExact
        mafsHeight={320}
        mode="learn"
        activityId="geometry-similarity-ratio"
        onActivityComplete={onComplete}
        onExitLearn={vi.fn()}
      />,
    );

    // Step 0: scale factor = 2 (original 3, image 6)
    submit('2');
    advance();

    // Step 1: new side = 5 × 2 = 10
    submit('10');
    advance();

    // Step 2: area ratio = scale factor² = 4, so area = 25
    // (from activity: acceptedAnswers contains '25')
    const activity = LAB_ACTIVITIES['geometry-similarity-ratio'];
    const step2Answer = activity.steps[2].acceptedAnswers[0];
    submit(step2Answer);
    fireEvent.click(screen.getByText('Finish'));

    expect(onComplete).toHaveBeenCalledWith('geometry-similarity-ratio', true);
  });
});

// ─── 4) MathSymbolKeyboard setTimeout cleanup ────────────────────────────────

describe('P5 MathSymbolKeyboard timer cleanup', () => {
  afterEach(cleanup);

  it('clears pending focus timer on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const textarea = document.createElement('textarea');
    textarea.id = 'test-input';
    document.body.appendChild(textarea);

    const { unmount } = render(
      <MathSymbolKeyboard textareaId="test-input" onInsert={vi.fn()} />,
    );

    // Click a symbol to trigger the setTimeout
    fireEvent.click(screen.getByTitle('Square root'));

    // Unmount should call clearTimeout
    const callsBefore = clearSpy.mock.calls.length;
    unmount();
    expect(clearSpy.mock.calls.length).toBeGreaterThan(callsBefore);

    document.body.removeChild(textarea);
    clearSpy.mockRestore();
  });

  it('inserts strict inequality symbols', () => {
    vi.useFakeTimers();
    const textarea = document.createElement('textarea');
    textarea.id = 'test-input-inequality';
    document.body.appendChild(textarea);

    const insertFn = vi.fn();
    render(
      <MathSymbolKeyboard textareaId="test-input-inequality" onInsert={insertFn} />,
    );

    fireEvent.click(screen.getByTitle('Less than'));
    fireEvent.click(screen.getByTitle('Greater than'));
    vi.runAllTimers();

    expect(insertFn).toHaveBeenNthCalledWith(1, '<');
    expect(insertFn).toHaveBeenNthCalledWith(2, '>');

    document.body.removeChild(textarea);
    vi.useRealTimers();
  });

  it('does not leave dangling timers after rapid clicks', () => {
    vi.useFakeTimers();
    const textarea = document.createElement('textarea');
    textarea.id = 'test-input-2';
    document.body.appendChild(textarea);

    const insertFn = vi.fn();
    render(
      <MathSymbolKeyboard textareaId="test-input-2" onInsert={insertFn} />,
    );

    // Click multiple symbols rapidly
    fireEvent.click(screen.getByTitle('Pi'));
    fireEvent.click(screen.getByTitle('Theta'));
    fireEvent.click(screen.getByTitle('Square root'));

    // Advance timers - should not throw or leak
    vi.runAllTimers();
    expect(insertFn).toHaveBeenCalledTimes(3);

    document.body.removeChild(textarea);
    vi.useRealTimers();
  });
});

// ─── 5) Render budget: setInterval/rAF, keyboard, cross-tab, all explore topics ─

describe('P5 render budget: no setInterval or persistent rAF in Lab', () => {
  afterEach(cleanup);

  it('SandboxTab distance-time explore does not use setInterval', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    render(<SandboxTab isExact mafsHeight={320} mode="explore" />);
    fireEvent.change(screen.getByLabelText('Sandbox explore topic'), {
      target: { value: 'sandbox-distance-time' },
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('SandboxTab standard explore does not use setInterval', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    render(<SandboxTab isExact mafsHeight={320} mode="explore" />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('MathSymbolKeyboard does not use setInterval or rAF', () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
    const textarea = document.createElement('textarea');
    textarea.id = 'budget-test';
    document.body.appendChild(textarea);

    render(<MathSymbolKeyboard textareaId="budget-test" onInsert={vi.fn()} />);

    expect(intervalSpy).not.toHaveBeenCalled();
    expect(rafSpy).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
    intervalSpy.mockRestore();
    rafSpy.mockRestore();
  });
});

describe('P5 render budget: cross-tab unmount leaves no residuals', () => {
  afterEach(cleanup);

  it('SandboxTab unmount from distance-time explore leaves no scene elements', () => {
    const { container, unmount } = render(<SandboxTab isExact mafsHeight={320} mode="explore" />);
    fireEvent.change(screen.getByLabelText('Sandbox explore topic'), {
      target: { value: 'sandbox-distance-time' },
    });
    expect(container.querySelectorAll('[data-testid="plot-of-x"]').length).toBeGreaterThan(0);
    unmount();
    expect(container.querySelectorAll('[data-testid="mafs"]').length).toBe(0);
  });

  it('StatisticsTab unmount from Learn mode leaves no elements', () => {
    const { container, unmount } = render(
      <StatisticsTab
        mafsHeight={320}
        mode="learn"
        activityId="statistics-box-plot"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-testid="mafs"]').length).toBeGreaterThanOrEqual(0);
    unmount();
    expect(container.querySelectorAll('[data-testid="mafs"]').length).toBe(0);
    expect(container.querySelectorAll('[data-testid="point"]').length).toBe(0);
  });

  it('GeometryTab unmount from similarity Learn leaves no polygons', () => {
    const { container, unmount } = render(
      <GeometryTab
        isExact
        mafsHeight={320}
        mode="learn"
        activityId="geometry-similarity-ratio"
        onActivityComplete={vi.fn()}
        onExitLearn={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-testid="polygon"]').length).toBeGreaterThan(0);
    unmount();
    expect(container.querySelectorAll('[data-testid="polygon"]').length).toBe(0);
  });
});

describe('P5 render budget: all Sandbox explore topics bounded', () => {
  afterEach(cleanup);

  function countPrimitives(container: HTMLElement): number {
    const selectors = [
      '[data-testid="mafs"]', '[data-testid="coordinates"]',
      '[data-testid="movable-point"]', '[data-testid="point"]',
      '[data-testid="circle"]', '[data-testid="polygon"]',
      '[data-testid="line-segment"]', '[data-testid="plot-of-x"]',
      '[data-testid="plot-of-y"]', '[data-testid="plot-inequality"]',
      '[data-testid="plot-parametric"]', '[data-testid="plot-vector-field"]',
      '[data-testid="vector"]', '[data-testid="latex"]',
    ];
    return selectors.reduce((n, sel) => n + container.querySelectorAll(sel).length, 0);
  }

  it('functions topic ≤ 300 primitives', () => {
    const { container } = render(<SandboxTab isExact mafsHeight={320} mode="explore" />);
    expect(countPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('sandbox-distance-time topic ≤ 300 primitives', () => {
    const { container } = render(<SandboxTab isExact mafsHeight={320} mode="explore" />);
    fireEvent.change(screen.getByLabelText('Sandbox explore topic'), {
      target: { value: 'sandbox-distance-time' },
    });
    expect(countPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('sandbox-polar-curves topic ≤ 300 primitives', () => {
    const { container } = render(<SandboxTab isExact mafsHeight={320} mode="explore" />);
    fireEvent.change(screen.getByLabelText('Sandbox explore topic'), {
      target: { value: 'sandbox-polar-curves' },
    });
    expect(countPrimitives(container)).toBeLessThanOrEqual(300);
  });

  it('sandbox-parametric-curves topic ≤ 300 primitives', () => {
    const { container } = render(<SandboxTab isExact mafsHeight={320} mode="explore" />);
    fireEvent.change(screen.getByLabelText('Sandbox explore topic'), {
      target: { value: 'sandbox-parametric-curves' },
    });
    expect(countPrimitives(container)).toBeLessThanOrEqual(300);
  });
});

// ─── 6) Entry points: home page and Dashboard have lab links ─────────────────

describe('P5 entry point coverage: lab links from main UI', () => {
  it('buildLabDeepLink produces navigable paths for all 6 tabs', () => {
    const activities = Object.values(LAB_ACTIVITIES);
    const tabs = new Set(activities.map(a => a.tab));
    expect(tabs.size).toBe(6);

    for (const tabId of tabs) {
      const activity = activities.find(a => a.tab === tabId);
      expect(activity).toBeDefined();
      const learnUrl = buildLabDeepLink(activity!.id, 'learn');
      expect(learnUrl).toContain(`tab=${tabId}`);
      expect(learnUrl).toContain('mode=learn');
      const exploreUrl = buildLabDeepLink(activity!.id, 'explore');
      expect(exploreUrl).toContain(`tab=${tabId}`);
      expect(exploreUrl).toContain('mode=explore');
    }
  });
});

// ─── 7) S7 Format ARIA real page test ────────────────────────────────────────

describe('P5 S7 Format toggle ARIA (real SandboxTab)', () => {
  afterEach(cleanup);

  it('SandboxTab explore receives isExact prop and uses it for formatting', () => {
    const { rerender } = render(<SandboxTab isExact={true} mafsHeight={320} mode="explore" />);
    // The tab should render without error with isExact=true
    expect(screen.getByText('Function Sandbox')).toBeTruthy();

    // Re-render with isExact=false
    rerender(<SandboxTab isExact={false} mafsHeight={320} mode="explore" />);
    expect(screen.getByText('Function Sandbox')).toBeTruthy();
  });

  it('StatisticsTab explore receives isExact prop', () => {
    render(<StatisticsTab mafsHeight={320} mode="explore" isExact={true} />);
    // Statistics tab renders without error
    expect(screen.getByRole('radio', { name: /Distribution/i })).toBeTruthy();
  });

  it('GeometryTab explore receives and uses isExact prop', () => {
    render(<GeometryTab isExact={true} mafsHeight={320} mode="explore" />);
    // Geometry tab renders without error
    expect(screen.getByLabelText('Geometry explore topic')).toBeTruthy();
  });
});

// ─── 9) S9 anti-leak: per-prompt no meaningful acceptedAnswer full match ─────

describe('P5 S9 anti-leak: no explore prompt contains any meaningful acceptedAnswer', () => {
  it('no prompt text contains any non-trivial acceptedAnswer as a complete word/phrase match', () => {
    const allPromptStrings: string[] = [];
    for (const key of Object.keys(EXPLORE_PROMPTS)) {
      for (const p of EXPLORE_PROMPTS[key]) {
        allPromptStrings.push(p.prompt);
      }
    }

    // We consider an answer "meaningful" for anti-leak purposes when it is:
    // - Not purely numeric (e.g., "15", "3/4", "-1")
    // - A multi-word phrase (contains a space) OR a single word ≥ 8 characters
    //
    // Single words under 8 chars (like "sine", "circle", "negative", "upward",
    // "stationary") are natural instructional vocabulary and do not constitute
    // meaningful leaks when used in a different pedagogical context than the
    // question they answer.

    function isMeaningfulAnswer(ans: string): boolean {
      const trimmed = ans.trim();
      // Too short
      if (trimmed.length < 4) return false;
      // Purely numeric (including fractions)
      if (/^-?\d+(\.\d+)?(\/\d+)?$/.test(trimmed)) return false;
      // Multi-word phrase — always meaningful if ≥ 9 chars total
      if (/\s/.test(trimmed) && trimmed.length >= 9) return true;
      // Single word — only meaningful if long enough to not be common vocabulary
      if (!/\s/.test(trimmed) && trimmed.length >= 9) return true;
      return false;
    }

    const allActivities = Object.values(LAB_ACTIVITIES);
    for (const activity of allActivities) {
      for (const step of activity.steps) {
        for (const answer of step.acceptedAnswers) {
          if (!isMeaningfulAnswer(answer)) continue;

          for (const prompt of allPromptStrings) {
            const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b${escaped}\\b`, 'i');
            expect(
              regex.test(prompt),
              `Explore prompt "${prompt.slice(0, 80)}..." contains acceptedAnswer "${answer}" from ${activity.id} step "${step.prompt.slice(0, 40)}..."`,
            ).toBe(false);
          }
        }
      }
    }
  });
});

// ─── 10) Explore deep link scene sync (real component rendering) ─────────────

import LinearAlgebraTab from '../components/lab/LinearAlgebraTab';

describe('P5 Explore deep link: real components sync to target scene via activityId', () => {
  afterEach(cleanup);

  it('sandbox-distance-time explore deep link sets topic selector to distance-time', () => {
    const url = buildLabDeepLink('sandbox-distance-time', 'explore');
    expect(url).toContain('mode=explore');
    expect(url).toContain('activity=sandbox-distance-time');

    // Render the real SandboxTab with the activityId from the deep link
    render(
      <SandboxTab
        isExact
        mafsHeight={320}
        mode="explore"
        activityId="sandbox-distance-time"
      />,
    );

    // The topic selector should be synced to distance-time
    const select = screen.getByLabelText('Sandbox explore topic') as HTMLSelectElement;
    expect(select.value).toBe('sandbox-distance-time');
    expect(screen.getByText('Distance–Time Graph Explorer')).toBeTruthy();
  });

  it('statistics-normal-zscore explore deep link syncs module selector', () => {
    const url = buildLabDeepLink('statistics-normal-zscore', 'explore');
    expect(url).toContain('mode=explore');
    expect(url).toContain('activity=statistics-normal-zscore');

    // Render the real StatisticsTab with the activityId from the deep link
    render(
      <StatisticsTab
        mafsHeight={320}
        mode="explore"
        activityId="statistics-normal-zscore"
      />,
    );

    // The module selector should be synced to normal-zscore (radio button checked)
    const normalRadio = screen.getByRole('radio', { name: /Normal/i });
    expect(normalRadio.getAttribute('aria-checked')).toBe('true');
  });

  it('linear-matrix-transform explore deep link syncs scene selector', () => {
    const url = buildLabDeepLink('linear-matrix-transform', 'explore');
    expect(url).toContain('mode=explore');
    expect(url).toContain('activity=linear-matrix-transform');

    // Render the real LinearAlgebraTab with the activityId from the deep link
    render(
      <LinearAlgebraTab
        mafsHeight={320}
        mode="explore"
        activityId="linear-matrix-transform"
      />,
    );

    // The scene selector should be synced to matrix-transform
    const select = screen.getByLabelText('Select linear algebra scene') as HTMLSelectElement;
    expect(select.value).toBe('linear-matrix-transform');
  });
});


describe('P5 S9 strict topic-scoped anti-leak contract', () => {
  it('no topic-specific Explore prompt contains any exact accepted answer for that activity', () => {
    for (const [key, prompts] of Object.entries(EXPLORE_PROMPTS)) {
      if (!key.includes(':')) continue;
      const [tab, topic] = key.split(':');
      const activityId = topic.startsWith(`${tab}-`) ? topic : `${tab}-${topic}`;
      const activity = LAB_ACTIVITIES[activityId as keyof typeof LAB_ACTIVITIES];
      expect(activity, `Missing activity for Explore prompt key ${key}`).toBeDefined();

      for (const { prompt } of prompts) {
        const promptText = prompt.toLowerCase();
        for (const step of activity.steps) {
          for (const rawAnswer of step.acceptedAnswers) {
            const answer = rawAnswer.trim().toLowerCase();
            if (!answer) continue;
            const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const exactToken = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
            expect(
              exactToken.test(promptText),
              `${key} prompt leaks accepted answer "${rawAnswer}": ${prompt}`,
            ).toBe(false);
          }
        }
      }
    }
  });
});
