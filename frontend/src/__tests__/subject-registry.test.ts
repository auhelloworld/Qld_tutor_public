import { describe, expect, it } from 'vitest';
import { isMathSubject } from '../lib/subject_registry';

describe('isMathSubject', () => {
  it.each(['math', 'senior_math', 'senior_methods', 'methods', 'senior_specialist', 'specialist'])(
    'recognises mathematics subject %s',
    subject => {
      expect(isMathSubject(subject)).toBe(true);
    },
  );

  it.each(['english', 'senior_english', 'science', 'senior_physics', 'senior_literature', '', undefined])(
    'rejects non-mathematics subject %s',
    subject => {
      expect(isMathSubject(subject)).toBe(false);
    },
  );
});
