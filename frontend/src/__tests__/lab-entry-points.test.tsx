import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import MoreToolsPanel from '../components/MoreToolsPanel';
import AdvancedLessonExtension from '../components/guided/AdvancedLessonExtension';
import { buildLabDeepLink } from '../lib/lab-topic-links';

vi.mock('../components/MathMarkdown', () => ({ default: ({ children }: { children: ReactNode }) => <span>{children}</span> }));

describe('Maths Lab entry points', () => {
  it('keeps a visible /lab entry in More Tools when no topic context exists', () => {
    render(<MoreToolsPanel year="year9" subject="math" />);
    fireEvent.click(screen.getByRole('button', { name: 'More Tools' }));
    expect(screen.getByRole('link', { name: /Math Lab/ }).getAttribute('href')).toBe('/lab');
  });

  it('uses a generated topic deep link in the guided extension', () => {
    const href = buildLabDeepLink('geometry-pythagoras', 'learn');
    render(
      <AdvancedLessonExtension
        data={null}
        subjectColor="var(--accent-color)"
        labLink={{ href, label: 'Explore Pythagoras in Maths Lab' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Stretch Thinking/ }));
    expect(screen.getByRole('link', { name: /Explore Pythagoras/ }).getAttribute('href')).toBe(href);
  });
});


describe('More Tools keeps both lab entry points in every subject context', () => {
  /**
   * Regression: the Science Lab work made the Math Lab link conditional on
   * `!isScience || mappedMathActivity`, so in a Science context with no mapped
   * maths activity the Math Lab entry disappeared entirely. Math Lab is a
   * general-purpose tool; context may reorder the links but must never remove
   * one. The original test only covered `subject="math"`, so this slipped past.
   */
  const cases: { name: string; props: Record<string, string> }[] = [
    { name: 'maths context', props: { year: 'year9', subject: 'math' } },
    { name: 'science context by subject', props: { year: 'year7', subject: 'science' } },
    {
      name: 'science context by AC9 science topic',
      props: { year: 'year7', subject: 'science', topicId: 'AC9S7U03' },
    },
    { name: 'english context', props: { year: 'year8', subject: 'english' } },
    { name: 'senior context', props: { year: 'unit1', subject: 'senior_methods' } },
  ];

  for (const testCase of cases) {
    it(`shows Math Lab and Science Lab in ${testCase.name}`, () => {
      render(<MoreToolsPanel {...testCase.props} />);
      fireEvent.click(screen.getByRole('button', { name: 'More Tools' }));

      const mathLink = screen.getByRole('link', { name: /Math Lab/ });
      expect(mathLink.getAttribute('href')).toBeTruthy();
      expect(mathLink.getAttribute('href')).toMatch(/^\/lab/);

      const scienceLink = screen.getByRole('link', { name: /Science Lab/ });
      expect(scienceLink.getAttribute('href')).toMatch(/^\/science-lab/);
    });
  }

  it('puts Science Lab before Math Lab in a science context, and after it otherwise', () => {
    const order = (props: Record<string, string>) => {
      const { unmount } = render(<MoreToolsPanel {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'More Tools' }));
      const names = screen
        .getAllByRole('link')
        .map((a) => a.textContent || '')
        .filter((t) => /Math Lab|Science Lab/.test(t))
        .map((t) => (t.includes('Science Lab') ? 'science' : 'math'));
      unmount();
      return names;
    };

    expect(order({ year: 'year7', subject: 'science' })).toEqual(['science', 'math']);
    expect(order({ year: 'year9', subject: 'math' })).toEqual(['math', 'science']);
  });
});


describe('Learning tools navigation entries are not silently dropped', () => {
  /**
   * Regression: the "✍️ Writing Lab" entry under "Primary learning" was deleted
   * during the Science Lab work, leaving `/writing` reachable only from an
   * empty-state banner shown for senior English. Source-level assertion because
   * the page component needs the full app context to render.
   */
  const pageSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'page.tsx'),
    'utf-8',
  );

  it('keeps the Writing Lab entry in the Primary learning group', () => {
    const primary = pageSource.slice(
      pageSource.indexOf('label="Primary learning"'),
      pageSource.indexOf('label="Assessment practice"'),
    );
    expect(primary.length, 'could not locate the Primary learning group').toBeGreaterThan(0);
    expect(primary, 'Writing Lab entry missing from Primary learning').toContain('href="/writing"');
    expect(primary).toContain('Writing Lab');
  });

  it('passes the active topic to MoreToolsPanel so lab deep links resolve', () => {
    const call = pageSource.slice(
      pageSource.indexOf('<MoreToolsPanel'),
      pageSource.indexOf('<MoreToolsPanel') + 260,
    );
    expect(call).toContain('subject=');
    expect(call, 'without topicId the mapped-activity deep links never activate').toContain(
      'topicId=',
    );
  });
});
