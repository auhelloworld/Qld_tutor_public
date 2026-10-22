import { describe, expect, it } from 'vitest';
import { getErrorCauseOptions } from '../lib/constants';

describe('shared student error-cause taxonomy', () => {
  it('selects subject-aware canonical options', () => {
    const math = getErrorCauseOptions('math').map(option => option.value);
    const english = getErrorCauseOptions('english').map(option => option.value);
    const science = getErrorCauseOptions('science').map(option => option.value);

    expect(math).toContain('calculation_slip');
    expect(math).toContain('problem_misreading');
    expect(math).not.toContain('vocabulary_gap');

    expect(english).toContain('vocabulary_gap');
    expect(english).toContain('grammar_confusion');
    expect(english).not.toContain('calculation_slip');

    expect(science).toContain('concept_gap');
    expect(science).toContain('expression_gap');
    expect(science).not.toContain('grammar_confusion');
  });

  it('uses the maths family for senior maths subjects and has unique codes', () => {
    const senior = getErrorCauseOptions('Mathematical Methods');
    expect(senior.map(option => option.value)).toContain('calculation_slip');

    for (const subject of ['math', 'english', 'science']) {
      const values = getErrorCauseOptions(subject).map(option => option.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});
