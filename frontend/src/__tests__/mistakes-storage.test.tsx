import { describe, expect, it } from 'vitest';
import { resolvedMistakesStorageKey } from '../app/mistakes/page';

describe('Mistakes resolved-state storage', () => {
  it('scopes local fallback state by student, subject, and year or unit', () => {
    expect(resolvedMistakesStorageKey('student-a', 'math', 'year7')).toBe(
      'qld_tutor_resolved_mistakes:student-a:math:year7'
    );
    expect(resolvedMistakesStorageKey('student-a', 'math', 'year8')).not.toBe(
      resolvedMistakesStorageKey('student-a', 'math', 'year7')
    );
    expect(resolvedMistakesStorageKey('student-b', 'math', 'year7')).not.toBe(
      resolvedMistakesStorageKey('student-a', 'math', 'year7')
    );
    expect(resolvedMistakesStorageKey('student-a', 'senior_english', 'unit3')).toBe(
      'qld_tutor_resolved_mistakes:student-a:senior_english:unit3'
    );
  });
});
