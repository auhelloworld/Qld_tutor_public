import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import CurriculumTree from '../components/CurriculumTree';
import type { Curriculum } from '../lib/api-types';

// One science year with SU (B/C/E/P), Inquiry and SHE topics + a sequence.
const curriculum: Curriculum = {
  science: {
    year9: {
      sequence: ['AC9S9U01', 'AC9S9U02', 'AC9S9H01', 'AC9S9I01'],
      AC9S9U02: { topic_id: 'AC9S9U02', name: 'Atomic structure', content_descriptor_text: 'Describe atoms and the periodic table', strand: 'Science Understanding', sub_strand: 'C' },
      AC9S9U01: { topic_id: 'AC9S9U01', name: 'Body systems', content_descriptor_text: 'Explain how body systems coordinate responses', strand: 'Science Understanding', sub_strand: 'B' },
      AC9S9I01: { topic_id: 'AC9S9I01', name: 'Designing investigations', content_descriptor_text: 'Plan valid and reproducible investigations', strand: 'Science Inquiry' },
      AC9S9H01: { topic_id: 'AC9S9H01', name: 'Science and society', content_descriptor_text: 'Evaluate the role of science in decisions', strand: 'Science as a Human Endeavour' },
    },
  },
} as unknown as Curriculum;

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(() => cleanup());

describe('CurriculumTree Learning Map', () => {
  it('defaults to learning groups (disciplines), not raw strands', () => {
    render(<CurriculumTree curriculum={curriculum} activeTopic="" onSelectTopic={() => {}} />);
    expect(screen.getByText('Biology')).toBeTruthy();
    expect(screen.getByText('Chemistry')).toBeTruthy();
    expect(screen.getByText('Science skills')).toBeTruthy();
    expect(screen.getByText('Science in society')).toBeTruthy();
    // In learning mode the official strand is not used as a GROUP HEADER.
    // (It still appears as a small metadata tag on rows, which is intended.)
  });

  it('toggles to official strands view', () => {
    render(<CurriculumTree curriculum={curriculum} activeTopic="" onSelectTopic={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Curriculum strands' }));
    // Strand headers appear; disciplines no longer used as group headers.
    expect(screen.getByText('Science Understanding')).toBeTruthy();
    expect(screen.getByText('Science Inquiry')).toBeTruthy();
    expect(screen.getByText('Science as a Human Endeavour')).toBeTruthy();
    expect(screen.queryByText('Biology')).toBeNull();
  });

  it('marks the recommended next topic', () => {
    render(
      <CurriculumTree
        curriculum={curriculum}
        activeTopic=""
        onSelectTopic={() => {}}
        recommendedTopicId="AC9S9U01"
      />,
    );
    expect(screen.getByText(/Recommended next/i)).toBeTruthy();
  });

  it('selecting a topic calls onSelectTopic with the topic key', () => {
    let picked = '';
    render(<CurriculumTree curriculum={curriculum} activeTopic="" onSelectTopic={(t) => { picked = t; }} />);
    fireEvent.click(screen.getByText('Body systems'));
    expect(picked).toBe('AC9S9U01');
  });
});
