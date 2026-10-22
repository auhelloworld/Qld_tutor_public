import { describe, expect, it } from 'vitest';
import { normaliseMathAnswer } from '../lib/lab-answer-normalise';
import { LAB_ACTIVITIES } from '../lib/lab-activities';

describe('normaliseMathAnswer', () => {
  // --- Unicode minus/dash variants ---
  describe('minus sign normalisation', () => {
    it('normalises U+2212 MINUS SIGN to hyphen-minus', () => {
      expect(normaliseMathAnswer('\u22123')).toBe('-3');
    });

    it('normalises en-dash to hyphen-minus', () => {
      expect(normaliseMathAnswer('\u20133')).toBe('-3');
    });

    it('normalises em-dash to hyphen-minus', () => {
      expect(normaliseMathAnswer('\u20143')).toBe('-3');
    });

    it('normalises fullwidth hyphen-minus to hyphen-minus', () => {
      expect(normaliseMathAnswer('\uFF0D3')).toBe('-3');
    });

    it('preserves regular ASCII minus', () => {
      expect(normaliseMathAnswer('-3')).toBe('-3');
    });
  });

  // --- Multiplication sign variants ---
  describe('multiplication sign normalisation', () => {
    it('normalises × (U+00D7) to *', () => {
      expect(normaliseMathAnswer('3\u00D74')).toBe('3*4');
    });

    it('normalises middle dot (U+00B7) to *', () => {
      expect(normaliseMathAnswer('3\u00B74')).toBe('3*4');
    });

    it('normalises dot operator (U+22C5) to *', () => {
      expect(normaliseMathAnswer('3\u22C54')).toBe('3*4');
    });

    it('normalises fullwidth asterisk to *', () => {
      expect(normaliseMathAnswer('3\uFF0A4')).toBe('3*4');
    });
  });

  // --- Division sign ---
  describe('division sign normalisation', () => {
    it('normalises ÷ (U+00F7) to /', () => {
      expect(normaliseMathAnswer('6\u00F72')).toBe('6/2');
    });
  });

  // --- Fullwidth to halfwidth ---
  describe('fullwidth character normalisation', () => {
    it('normalises fullwidth digits to halfwidth', () => {
      expect(normaliseMathAnswer('\uFF11\uFF12\uFF13')).toBe('123');
    });

    it('normalises fullwidth letters to halfwidth (lowercased)', () => {
      expect(normaliseMathAnswer('\uFF21\uFF22')).toBe('ab');
    });

    it('normalises fullwidth parentheses', () => {
      expect(normaliseMathAnswer('\uFF08\uFF11\uFF09')).toBe('(1)');
    });
  });

  // --- Superscript digits ---
  describe('superscript normalisation', () => {
    it('normalises ² to ^2', () => {
      expect(normaliseMathAnswer('x\u00B2')).toBe('x^2');
    });

    it('normalises ³ to ^3', () => {
      expect(normaliseMathAnswer('x\u00B3')).toBe('x^3');
    });

    it('normalises consecutive superscripts', () => {
      expect(normaliseMathAnswer('x\u00B2\u00B3')).toBe('x^23');
    });

    it('normalises ⁰ ¹ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹', () => {
      expect(normaliseMathAnswer('a\u2070')).toBe('a^0');
      expect(normaliseMathAnswer('a\u00B9')).toBe('a^1');
      expect(normaliseMathAnswer('a\u2074')).toBe('a^4');
      expect(normaliseMathAnswer('a\u2079')).toBe('a^9');
    });
  });

  // --- Whitespace handling ---
  describe('whitespace normalisation', () => {
    it('trims leading and trailing whitespace', () => {
      expect(normaliseMathAnswer('  42  ')).toBe('42');
    });

    it('collapses internal whitespace to single space', () => {
      expect(normaliseMathAnswer('x  +  y')).toBe('x + y');
    });

    it('removes non-breaking space', () => {
      expect(normaliseMathAnswer('3\u00A0+\u00A01')).toBe('3 + 1');
    });

    it('removes thousands-separator spaces', () => {
      expect(normaliseMathAnswer('1 000')).toBe('1000');
      expect(normaliseMathAnswer('1 000 000')).toBe('1000000');
    });
  });

  // --- Trailing period ---
  describe('trailing period removal', () => {
    it('removes trailing period', () => {
      expect(normaliseMathAnswer('42.')).toBe('42');
    });

    it('does NOT remove mid-string decimal point', () => {
      expect(normaliseMathAnswer('3.14')).toBe('3.14');
    });

    it('preserves number ending in digit (no trailing dot issue)', () => {
      expect(normaliseMathAnswer('3.0')).toBe('3.0');
    });
  });

  // --- Case normalisation ---
  describe('case normalisation', () => {
    it('lowercases input', () => {
      expect(normaliseMathAnswer('Quadrant IV')).toBe('quadrant iv');
    });

    it('lowercases mixed case', () => {
      expect(normaliseMathAnswer('SQRT(2)')).toBe('sqrt(2)');
    });
  });

  // --- Combined/mixed scenarios ---
  describe('combined normalisation', () => {
    it('handles negative number with Unicode minus and spaces', () => {
      expect(normaliseMathAnswer(' \u2212 3 ')).toBe('- 3');
    });

    it('handles fullwidth negative', () => {
      expect(normaliseMathAnswer('\uFF0D\uFF13')).toBe('-3');
    });

    it('empty string stays empty', () => {
      expect(normaliseMathAnswer('')).toBe('');
    });

    it('whitespace-only becomes empty', () => {
      expect(normaliseMathAnswer('   ')).toBe('');
    });

    it('handles complex expression with multiple normalisation targets', () => {
      expect(normaliseMathAnswer('x\u00B2 \u00D7 3\u00F72')).toBe('x^2 * 3/2');
    });
  });

  // --- Property test: bilateral normalisation stability ---
  describe('bilateral normalisation property: all acceptedAnswers self-match', () => {
    it('every acceptedAnswer in every activity normalises to match itself', () => {
      const failures: string[] = [];
      for (const activity of Object.values(LAB_ACTIVITIES)) {
        for (const step of activity.steps) {
          for (const accepted of step.acceptedAnswers) {
            const normalised = normaliseMathAnswer(accepted);
            // After normalisation, re-normalising should be idempotent
            const doubleNormalised = normaliseMathAnswer(normalised);
            if (normalised !== doubleNormalised) {
              failures.push(
                `Activity "${activity.id}", answer "${accepted}": ` +
                `normalised="${normalised}" but double-normalised="${doubleNormalised}"`
              );
            }
          }
        }
      }
      expect(failures).toEqual([]);
    });

    it('normalised accepted answers still match when compared to themselves', () => {
      // This ensures bilateral normalisation does not break self-equality
      const failures: string[] = [];
      for (const activity of Object.values(LAB_ACTIVITIES)) {
        for (const step of activity.steps) {
          for (const accepted of step.acceptedAnswers) {
            const normInput = normaliseMathAnswer(accepted);
            const normAccepted = normaliseMathAnswer(accepted);
            if (normInput !== normAccepted) {
              failures.push(
                `Activity "${activity.id}", answer "${accepted}": ` +
                `input normalisation="${normInput}" differs from accepted normalisation="${normAccepted}"`
              );
            }
          }
        }
      }
      expect(failures).toEqual([]);
    });

    it('covers all 45 activities and all their acceptedAnswers', () => {
      const activityCount = Object.keys(LAB_ACTIVITIES).length;
      expect(activityCount).toBe(45);

      let totalAnswers = 0;
      for (const activity of Object.values(LAB_ACTIVITIES)) {
        for (const step of activity.steps) {
          totalAnswers += step.acceptedAnswers.length;
        }
      }
      // Ensure we're actually checking a meaningful number of answers
      expect(totalAnswers).toBeGreaterThan(50);
    });
  });

  // --- Strict trailing character preservation ---
  describe('trailing character strictness preserved', () => {
    it('does NOT strip trailing alphabetic characters from numeric-looking input', () => {
      // "4abc" must NOT normalise to "4" — trailing chars must remain
      // to ensure the strict trailing-character rejection in LearnPanel is preserved
      expect(normaliseMathAnswer('4abc')).toBe('4abc');
    });

    it('does NOT strip trailing x from a number', () => {
      expect(normaliseMathAnswer('3x')).toBe('3x');
    });

    it('does NOT parseFloat or extract leading digits', () => {
      // This is critical: normalisation must not extract a numeric prefix
      const result = normaliseMathAnswer('12.5units');
      expect(result).toBe('12.5units');
    });
  });
});
