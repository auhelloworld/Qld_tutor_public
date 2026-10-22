import { describe, expect, it } from 'vitest';
import {
  filterCurriculumByAvailability,
  hasAuthoredContentForScope,
} from '../lib/content-availability';

const curriculum = {
  senior_english: { unit1: { sequence: ['EN1'], EN1: { name: 'English' } } },
  senior_methods: { unit1: { sequence: ['M1'], M1: { name: 'Methods' } } },
  math: { year7: { sequence: ['N1'], N1: { name: 'Number' } } },
} as never;

const availability = {
  by_subject: { methods: 2, math: 3 },
  by_year: { math: { year7: 3 } },
  by_unit: { methods: { unit1: 2 } },
};

describe('content availability scope helpers', () => {
  it('maps picker senior subjects to storage subjects', () => {
    expect(hasAuthoredContentForScope(availability, 'senior_methods', 'unit1')).toBe(true);
    expect(hasAuthoredContentForScope(availability, 'senior_english', 'unit1')).toBe(false);
    expect(hasAuthoredContentForScope(availability, 'math', 'year7')).toBe(true);
  });

  it('filters empty authored scopes while preserving populated scopes', () => {
    const filtered = filterCurriculumByAvailability(curriculum, availability);

    expect(Object.keys(filtered)).toEqual(['senior_methods', 'math']);
    expect(filtered.senior_methods.unit1).toBeDefined();
    expect(filtered.math.year7).toBeDefined();
  });

  it('treats a missing availability response as unknown rather than empty', () => {
    expect(hasAuthoredContentForScope(null, 'senior_english', 'unit1')).toBe(true);
    expect(filterCurriculumByAvailability(curriculum, null)).toBe(curriculum);
  });
});
