import { describe, expect, it } from 'vitest';
import {
  buildMistakesHref,
  buildPracticeHref,
  scopedSubjectFromSearchParams,
  scopedYearFromSearchParams,
} from '../lib/scoped_navigation';

describe('scoped navigation helpers', () => {
  it('builds junior practice links with subject, year, topic, and question', () => {
    expect(buildPracticeHref({
      subject: 'english',
      year: 'year8',
      topic: 'AC9E8LY01',
      question: 'q-1',
    })).toBe('/?subject=english&year=year8&topic=AC9E8LY01&question=q-1');
  });

  it('builds senior links with unit and inferred syllabus subject', () => {
    expect(buildMistakesHref({
      subject: 'senior_math',
      year: 'unit3',
      topic: 'QCAA_METHODS_U3_T1',
    })).toBe('/mistakes?subject=senior_math&unit=3&syllabus_subject=math&topic=QCAA_METHODS_U3_T1');
  });

  it('lets explicit syllabus subject override inference', () => {
    expect(buildPracticeHref({
      subject: 'senior_math',
      year: 'unit4',
      syllabusSubject: 'methods',
    })).toBe('/?subject=senior_math&unit=4&syllabus_subject=methods');
  });

  it('restores picker scope from URL search params', () => {
    const params = new URLSearchParams('subject=science&year=8');
    expect(scopedSubjectFromSearchParams(params, 'math')).toBe('science');
    expect(scopedYearFromSearchParams(params, 'year7')).toBe('year8');

    const seniorParams = new URLSearchParams('subject=senior_english&unit=3');
    expect(scopedSubjectFromSearchParams(seniorParams, 'english')).toBe('senior_english');
    expect(scopedYearFromSearchParams(seniorParams, 'year10')).toBe('unit3');
  });
});


  it('carries Show Answer provenance into practice links', () => {
    expect(buildPracticeHref({
      subject: 'math',
      year: 'year7',
      topic: 'AC9M7N01',
      question: 'q-1',
      showAnswer: true,
    })).toBe('/?subject=math&year=year7&topic=AC9M7N01&question=q-1&show_answer=1');
  });
