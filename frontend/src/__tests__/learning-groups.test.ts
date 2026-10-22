import { describe, it, expect } from 'vitest';
import {
  getLearningGroup,
  getLearningGroupOrder,
  getLearningTags,
  SCIENCE_GROUP_ORDER,
  ENGLISH_GROUP_ORDER,
  MATHS_GROUP_ORDER,
} from '../lib/learning_groups';
import { topicLabelParts } from '../lib/curriculum_helpers';
import type { CurriculumTopic } from '../lib/api-types';

const t = (p: Partial<CurriculumTopic>): CurriculumTopic => ({ topic_id: 'X', ...p } as CurriculumTopic);

describe('Science learning groups (strand + sub_strand)', () => {
  it('maps Science Understanding sub_strands to disciplines', () => {
    expect(getLearningGroup(t({ topic_id: 'AC9S9U01', strand: 'Science Understanding', sub_strand: 'B' }), 'science', 'year9')).toBe('Biology');
    expect(getLearningGroup(t({ strand: 'Science Understanding', sub_strand: 'C' }), 'science', 'year9')).toBe('Chemistry');
    expect(getLearningGroup(t({ strand: 'Science Understanding', sub_strand: 'P' }), 'science', 'year9')).toBe('Physics');
    expect(getLearningGroup(t({ strand: 'Science Understanding', sub_strand: 'E' }), 'science', 'year9')).toBe('Earth and space science');
  });

  it('maps Inquiry and Human Endeavour by strand', () => {
    expect(getLearningGroup(t({ strand: 'Science Inquiry' }), 'science', 'year9')).toBe('Science skills');
    expect(getLearningGroup(t({ strand: 'Science as a Human Endeavour' }), 'science', 'year9')).toBe('Science in society');
  });

  it('keeps the official strand as a metadata tag', () => {
    const tags = getLearningTags(t({ strand: 'Science Understanding', sub_strand: 'B' }), 'science');
    expect(tags).toContain('Science Understanding');
  });
});

describe('English learning groups (code + keyword, consistent across years)', () => {
  it('never returns raw snake_case or year-prefixed pathway_group', () => {
    const samples: CurriculumTopic[] = [
      t({ topic_id: 'AC9E9LA02', strand: 'Language', name: 'Direct and indirect evaluation' }),
      t({ topic_id: 'AC9E9LA05', strand: 'Language', name: 'Creative sentence variation' }),
      t({ topic_id: 'AC9E10LE01', strand: 'Literature', name: 'Literary representations and context' }),
      t({ topic_id: 'AC9E8LY08', strand: 'Literacy', name: 'Spelling and word learning' }),
    ];
    for (const s of samples) {
      const g = getLearningGroup(s, 'english', 'year9');
      expect(g).toBeTruthy();
      expect(g).not.toMatch(/_/); // no snake_case
      expect(g).not.toMatch(/Year \d+ English/); // no year-prefixed strand
      expect(ENGLISH_GROUP_ORDER).toContain(g);
    }
  });

  it('classifies representative topics sensibly', () => {
    expect(getLearningGroup(t({ topic_id: 'AC9E7LY05', name: 'Comprehension strategies and inference' }), 'english', 'year7')).toBe('Reading comprehension');
    expect(getLearningGroup(t({ topic_id: 'AC9E7LA05', name: 'Complex sentences for elaborating ideas' }), 'english', 'year7')).toBe('Grammar & sentence control');
    expect(getLearningGroup(t({ topic_id: 'AC9E7LE07', name: 'Creative writing with literary devices' }), 'english', 'year7')).toBe('Creative/imaginative writing');
    expect(getLearningGroup(t({ topic_id: 'AC9E7LE02', name: 'Justified opinions about texts' }), 'english', 'year7')).toBe('Literature response');
    expect(getLearningGroup(t({ topic_id: 'AC9E7LY07', name: 'Spoken and multimodal presentations' }), 'english', 'year7')).toBe('Speaking & multimodal');
    expect(getLearningGroup(t({ topic_id: 'AC9E7LA08', name: 'Specialist vocabulary and technical meanings' }), 'english', 'year7')).toBe('Vocabulary & word knowledge');
    expect(getLearningGroup(t({ topic_id: 'AC9E7LA02', name: 'Evaluative language and evidence' }), 'english', 'year7')).toBe('Argument & persuasion');
  });
});

describe('Maths learning groups (de-granularise Y8-10)', () => {
  it('maps strands to cumulative groups', () => {
    expect(getLearningGroup(t({ strand: 'Number', name: 'Real numbers' }), 'math', 'year8')).toBe('Number, fractions & ratio');
    expect(getLearningGroup(t({ strand: 'Algebra', name: 'Expressions' }), 'math', 'year8')).toBe('Algebra & equations');
    expect(getLearningGroup(t({ strand: 'Algebra', name: 'Quadratic functions' }), 'math', 'year9')).toBe('Functions & graphs');
    expect(getLearningGroup(t({ strand: 'Measurement', name: 'Area and perimeter' }), 'math', 'year8')).toBe('Measurement & geometry');
    expect(getLearningGroup(t({ strand: 'Space', name: 'Quadrilaterals' }), 'math', 'year8')).toBe('Measurement & geometry');
    expect(getLearningGroup(t({ strand: 'Statistics', name: 'Distributions' }), 'math', 'year8')).toBe('Statistics & probability');
    expect(getLearningGroup(t({ strand: 'Probability', name: 'Two events' }), 'math', 'year8')).toBe('Statistics & probability');
  });

  it('derives strand from pathway_group prefix when strand missing', () => {
    expect(getLearningGroup(t({ strand: '', pathway_group: 'Statistics: Investigations', name: 'Investigations' }), 'math', 'year8')).toBe('Statistics & probability');
  });

  it('collapses a full Y8 maths year to <= 8 groups', () => {
    const y8 = [
      ['Number', 'Real numbers'], ['Number', 'Indices'], ['Measurement', 'Circles'],
      ['Algebra', 'Expressions'], ['Algebra', 'Equations and graphs'], ['Space', '3D position'],
      ['Statistics', 'Data collection'], ['Probability', 'Two events'],
    ].map(([strand, name], i) => t({ topic_id: `AC9M8X${i}`, strand, name }));
    const groups = new Set(y8.map((x) => getLearningGroup(x, 'math', 'year8')));
    expect(groups.size).toBeLessThanOrEqual(8);
    expect([...groups].every((g) => MATHS_GROUP_ORDER.includes(g as string))).toBe(true);
  });
});

describe('fallbacks and ordering', () => {
  it('returns null for senior units and unknown subjects (caller falls back to groupKey)', () => {
    expect(getLearningGroup(t({ strand: 'Algebra' }), 'senior_math', 'unit3')).toBeNull();
    expect(getLearningGroup(t({ strand: 'Algebra' }), 'math', 'unit1')).toBeNull();
    expect(getLearningGroup(t({ strand: 'Whatever' }), 'history', 'year7')).toBeNull();
  });

  it('group order is non-empty for known subjects, empty otherwise', () => {
    expect(getLearningGroupOrder('science', 'year9')).toEqual(SCIENCE_GROUP_ORDER);
    expect(getLearningGroupOrder('math', 'year7').length).toBeGreaterThan(0);
    expect(getLearningGroupOrder('senior_math', 'unit2')).toEqual([]);
  });

  it('is deterministic', () => {
    const x = t({ topic_id: 'AC9E9LA02', name: 'Direct and indirect evaluation' });
    expect(getLearningGroup(x, 'english', 'year9')).toBe(getLearningGroup(x, 'english', 'year9'));
  });
});

describe('topicLabelParts', () => {
  it('leads with name, keeps code, supports descriptor as secondary', () => {
    const parts = topicLabelParts(t({ topic_id: 'AC9M7N04', name: 'Adding fractions', content_descriptor_text: 'Solve problems involving addition of fractions...' }));
    expect(parts.primary).toBe('Adding fractions');
    expect(parts.code).toBe('AC9M7N04');
    expect(parts.secondary.length).toBeGreaterThan(0);
  });

  it('falls back to descriptor when name missing', () => {
    const parts = topicLabelParts(t({ topic_id: 'AC9M7N04', content_descriptor_text: 'Solve problems involving fractions' }));
    expect(parts.primary.length).toBeGreaterThan(0);
    expect(parts.code).toBe('AC9M7N04');
  });
});
