import { describe, it, expect } from 'vitest';
import { preprocessMarkdown, formatStudentAnswer, masteryBand } from '../lib/format';

describe('preprocessMarkdown auto-wrap heuristic', () => {
  it('should wrap pure mathematical expressions without spaces or words entirely in math delimiters', () => {
    expect(preprocessMarkdown('2^3=8')).toBe('$2^3=8$');
    expect(preprocessMarkdown('x_2+y_2=z_2')).toBe('$x_2+y_2=z_2$');
  });

  it('should NOT wrap the entire text if it contains English words, but wrap individual math tokens instead', () => {
    // Single math token
    expect(preprocessMarkdown('There are 4 terms of 2^5'))
      .toBe('There are 4 terms of $2^5$');

    // Multiple math tokens
    expect(preprocessMarkdown('The lawn has dimensions 20 m by 10 m, so its area is 20 * 10 = 200 m^2.'))
      .toBe('The lawn has dimensions 20 m by 10 m, so its area is 20 * 10 = 200 $m^2$.');

    // With brackets and variables
    expect(preprocessMarkdown('Evaluate the expression 2^(2+5) and solve for x_1.'))
      .toBe('Evaluate the expression $2^(2+5)$ and solve for $x_1$.');
  });

  it('should wrap equations with spaces but no English words entirely', () => {
    expect(preprocessMarkdown('2^3 = 8')).toBe('$2^3 = 8$');
    expect(preprocessMarkdown('x^2 + y^2 = z^2')).toBe('$x^2 + y^2 = z^2$');
  });

  it('should preserve existing dollar delimiters without wrapping', () => {
    expect(preprocessMarkdown('The formula is $E = mc^2$.')).toBe('The formula is $E = mc^2$.');
    expect(preprocessMarkdown('$$x^2 + y^2 = z^2$$')).toBe('$$x^2 + y^2 = z^2$$');
  });

  it('should correctly escape and preserve currency dollar signs in non-math text', () => {
    expect(preprocessMarkdown('A taxi charges a \\$4.50 flag fall.')).toBe('A taxi charges a \\$4.50 flag fall.');
    expect(preprocessMarkdown('The cost for 0 km is \\$4.50.')).toBe('The cost for 0 km is \\$4.50.');
    
    // Paired unescaped dollar signs representing currency
    expect(preprocessMarkdown('Manager: each hour $25 so first hour $50. Correct?'))
      .toBe('Manager: each hour \\$25 so first hour \\$50. Correct?');

    // Single unescaped dollar sign representing currency
    expect(preprocessMarkdown('Store A is better by $45.'))
      .toBe('Store A is better by \\$45.');

    // Math block containing the word 'at' (which is in restricted list but is a valid math token here)
    expect(preprocessMarkdown('Given $v = u + at$, find $a$.'))
      .toBe('Given $v = u + at$, find $a$.');
  });

  it('should correctly format multiple block math expressions separated by paragraphs with restricted words', () => {
    const text =
      'Efficiency is calculated using:\n' +
      '$$\\text{Efficiency (\\%)} = \\left( \\frac{\\text{Useful Energy Output}}{\\text{Total Energy Input}} \\right) \\times 100$$\n' +
      'For example, if an electric motor uses 200 J of electrical energy and outputs 150 J of kinetic energy, its efficiency is:\n' +
      '$$\\left( \\frac{150}{200} \\right) \\times 100 = 75\\%$$';

    const result = preprocessMarkdown(text);
    expect(result).not.toContain('\\char36');
    expect(result).not.toContain('&#36;');
    expect(result).toBe(text);
  });
});

describe('masteryBand confidence gates', () => {
  it('labels high BKT with thin evidence as a promising early signal', () => {
    const result = masteryBand({ status: 'promising', bktMastery: 0.95, evidenceCount: 1, confidence: 'low' });
    expect(result.band).toBe('Promising early signal');
    expect(result.showPercent).toBe(false);
  });

  it('only labels supported high mastery as secure or extension-ready', () => {
    const result = masteryBand({ status: 'mastered', bktMastery: 0.9, evidenceCount: 5, confidence: 'medium', accuracy: 0.9 });
    expect(['Secure', 'Extension-ready']).toContain(result.band);
  });
});

describe('formatStudentAnswer helper', () => {
  it('should format JSON objects for multi-part answers nicely', () => {
    expect(formatStudentAnswer('{"a":"High-angle","b":"bleaching scars"}')).toBe('a) High-angle; b) bleaching scars');
    expect(formatStudentAnswer('{"1":"12","2":"24"}')).toBe('1) 12; 2) 24');
  });

  it('should return the original string for non-JSON or other string answers', () => {
    expect(formatStudentAnswer('42')).toBe('42');
    expect(formatStudentAnswer('not a json object')).toBe('not a json object');
    expect(formatStudentAnswer('')).toBe('');
    expect(formatStudentAnswer(undefined)).toBe('');
    expect(formatStudentAnswer(null)).toBe('');
  });
});


import { subjectDisplayName } from '../lib/format';

describe('subjectDisplayName (QCAA-aligned subject labels)', () => {
  it('uses official QCAA names for senior mathematics subjects', () => {
    expect(subjectDisplayName('senior_methods')).toBe('Mathematical Methods');
    expect(subjectDisplayName('senior_specialist')).toBe('Specialist Mathematics');
    expect(subjectDisplayName('senior_general')).toBe('General Mathematics');
    expect(subjectDisplayName('senior_essential')).toBe('Essential Mathematics');
  });

  it('labels junior subjects cleanly', () => {
    expect(subjectDisplayName('math')).toBe('Mathematics');
    expect(subjectDisplayName('english')).toBe('English');
    expect(subjectDisplayName('science')).toBe('Science');
  });

  it('uses QCAA names for senior science and english courses', () => {
    expect(subjectDisplayName('senior_chemistry')).toBe('Chemistry');
    expect(subjectDisplayName('senior_physics')).toBe('Physics');
    expect(subjectDisplayName('senior_literature')).toBe('Literature');
  });

  it('falls back to Title Case for unknown keys', () => {
    expect(subjectDisplayName('senior_unknowncourse')).toBe('Senior Unknowncourse');
  });
});
