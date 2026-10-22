/**
 * Math answer normalisation for Lab Learn mode.
 *
 * Transforms common Unicode math variants into their ASCII equivalents so that
 * student input containing e.g. U+2212 MINUS SIGN is not incorrectly rejected.
 *
 * This function is applied to BOTH student input and accepted answers (bilateral
 * normalisation) to ensure equivalence checking remains symmetric.
 *
 * Design constraints:
 * - Must never cause a previously-correct answer to become incorrect.
 * - Does NOT perform algebraic simplification or symbolic evaluation.
 * - Strict trailing-character rejection is preserved (normalisation only
 *   canonicalises character representation, not semantic content).
 */

/**
 * Normalise a raw math answer string for comparison.
 *
 * Handles:
 * - Unicode minus/dash variants → ASCII hyphen-minus
 * - Unicode multiplication signs → *
 * - Unicode division sign → /
 * - Middle dot → *
 * - Fullwidth characters → halfwidth (digits, letters, brackets, comma, period)
 * - Superscript digits ² ³ → ^2, ^3
 * - Whitespace collapse and trimming
 * - Thousands separator spaces removed
 * - Trailing period/full stop removed
 * - Lowercased for case-insensitive comparison
 */
export function normaliseMathAnswer(raw: string): string {
  let s = raw;

  // Unicode minus sign (U+2212), en-dash (U+2013), em-dash (U+2014) → ASCII hyphen-minus
  s = s.replace(/[\u2212\u2013\u2014\uFF0D]/g, '-');

  // Multiplication signs: × (U+00D7), fullwidth × (U+FF38 is X, but ✕ U+2715, ✖ U+2716)
  // We normalise × (U+00D7) and ﹡ (U+FE61) and ＊ (U+FF0A) to *
  s = s.replace(/[\u00D7\uFE61\uFF0A]/g, '*');

  // Middle dot (U+00B7, U+2022 bullet, U+2027 hyphenation point, U+22C5 dot operator) → *
  s = s.replace(/[\u00B7\u2027\u22C5]/g, '*');

  // Division sign ÷ (U+00F7), fullwidth (U+FF0F) → /
  s = s.replace(/\u00F7/g, '/');

  // Fullwidth ASCII range (U+FF01–U+FF5E) → corresponding halfwidth (U+0021–U+007E)
  s = s.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));

  // Superscript digits: ² (U+00B2) → ^2, ³ (U+00B3) → ^3
  // Also handle ⁰¹⁴⁵⁶⁷⁸⁹ (U+2070, U+00B9, U+2074-U+2079)
  const superscriptMap: Record<string, string> = {
    '\u00B2': '2',
    '\u00B3': '3',
    '\u00B9': '1',
    '\u2070': '0',
    '\u2074': '4',
    '\u2075': '5',
    '\u2076': '6',
    '\u2077': '7',
    '\u2078': '8',
    '\u2079': '9',
  };

  // Collect consecutive superscript digits and replace as ^(digits)
  s = s.replace(/[\u00B2\u00B3\u00B9\u2070\u2074-\u2079]+/g, (match) => {
    const digits = [...match].map((ch) => superscriptMap[ch] || ch).join('');
    return `^${digits}`;
  });

  // Collapse whitespace (including thin/non-breaking spaces) to single space, then trim
  s = s.replace(/[\s\u00A0\u2009\u200A\u200B\u2007]+/g, ' ').trim();

  // Remove thousands separator spaces (digit-space-digit patterns)
  // e.g. "1 000" → "1000"
  s = s.replace(/(\d) (\d)/g, '$1$2');
  // May need multiple passes for "1 000 000"
  s = s.replace(/(\d) (\d)/g, '$1$2');

  // Remove trailing period/full stop (but not decimal point: only if preceded by non-digit or end)
  // We only remove a trailing '.' that isn't part of a decimal number
  s = s.replace(/\.$/g, '');

  // Lowercase for case-insensitive comparison
  s = s.toLowerCase();

  return s;
}
