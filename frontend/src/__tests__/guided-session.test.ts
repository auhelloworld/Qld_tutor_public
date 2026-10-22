import { describe, expect, it } from 'vitest';
import { getMultiPartSessionOutcome } from '../lib/guided-session';
import type { SubPartResult } from '../lib/api-types';

const correctPart: SubPartResult = {
  label: 'a', is_correct: true, outcome: 'correct', student_answer: '4', score: 1, max_score: 1,
};
const unansweredPart: SubPartResult = {
  label: 'b', is_correct: false, outcome: 'unanswered', student_answer: '', score: 0, max_score: 1,
};

describe('Guided multi-part session aggregation', () => {
  it('does not count a whole question after only the first part', () => {
    expect(getMultiPartSessionOutcome([correctPart, unansweredPart])).toEqual({
      ready: false,
      isCorrect: false,
      outcome: 'unanswered',
      errorType: null,
    });
  });

  it('records the actual part error after every part has been attempted', () => {
    const incorrectPart: SubPartResult = {
      ...unansweredPart,
      outcome: 'incorrect',
      student_answer: '5',
      error_type: 'incorrect_value',
    };
    expect(getMultiPartSessionOutcome([correctPart, incorrectPart])).toEqual({
      ready: true,
      isCorrect: false,
      outcome: 'incorrect',
      errorType: 'incorrect_value',
    });
  });

  it('records an explicitly abandoned incomplete question as unanswered', () => {
    expect(getMultiPartSessionOutcome([correctPart, unansweredPart], true)).toEqual({
      ready: true,
      isCorrect: false,
      outcome: 'unanswered',
      errorType: 'unanswered',
    });
  });

  it('keeps parent review neutral when a completed part is pending', () => {
    const pendingPart: SubPartResult = {
      ...unansweredPart,
      outcome: 'pending',
      student_answer: 'An open response',
      error_type: 'parent_review_pending',
    };
    expect(getMultiPartSessionOutcome([correctPart, pendingPart])).toEqual({
      ready: true,
      isCorrect: false,
      outcome: 'pending',
      errorType: 'parent_review_pending',
    });
  });

  it('records the completed whole question as correct', () => {
    const secondCorrect: SubPartResult = {
      ...correctPart,
      label: 'b',
      student_answer: '6',
    };
    expect(getMultiPartSessionOutcome([correctPart, secondCorrect])).toEqual({
      ready: true,
      isCorrect: true,
      outcome: 'correct',
      errorType: null,
    });
  });
});
