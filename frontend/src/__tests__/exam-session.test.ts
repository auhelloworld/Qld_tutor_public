import { describe, expect, it } from 'vitest';
import { changedExamResponses, serializeExamResponses } from '../lib/exam-session';

describe('exam session persistence helpers', () => {
  it('serializes filled multi-part answers and preserves ordinary responses', () => {
    expect(serializeExamResponses(
      { q1: '42' },
      { q2: { a: '4', b: '  ' } },
    )).toEqual({ q1: '42', q2: JSON.stringify({ a: '4' }) });
  });

  it('serializes a cleared touched multi-part answer as an empty object', () => {
    expect(serializeExamResponses({}, { q2: { a: '', b: ' ' } })).toEqual({
      q2: '{}',
    });
  });

  it('returns only changed responses and explicit removals for an exit save', () => {
    expect(changedExamResponses(
      { unchanged: 'same', edited: 'new', added: 'answer' },
      { unchanged: 'same', edited: 'old', removed: 'old answer' },
    )).toEqual({ edited: 'new', added: 'answer', removed: '' });
  });
});
