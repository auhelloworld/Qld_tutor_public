/**
 * Shared formatting utilities used across the frontend.
 *
 * Previously duplicated across ExamPage, ChallengePage, MistakesPage, etc.
 * Consolidated here per frontend review fix #2.
 */

import { SUBJECT_REGISTRY } from './subject_registry';

/**
 * Format seconds to mm:ss display.
 */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format an ISO timestamp into a human-readable "time ago" string.
 */
export function formatTimeAgo(isoString: string): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return '';
  }
}

/**
 * Convert a snake_case or underscore_separated string to Title Case.
 */
export function humanise(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l: string) => l.toUpperCase());
}

/**
 * Human-friendly subject label, preferring the QCAA-aligned name from the
 * central subject registry and falling back to a Title-cased version of the
 * raw key. See ``frontend/src/lib/subject_registry.ts``.
 */
export function subjectDisplayName(value: string): string {
  return SUBJECT_REGISTRY[value]?.display ?? humanise(value);
}

/** Human-friendly year or unit label, e.g. `year7` → `Year 7`, `unit3` → `Unit 3`. */
export function scopeDisplayName(value: string): string {
  const match = /^(year|unit)(\d+)$/i.exec(String(value).trim());
  if (!match) return humanise(String(value));
  return `${match[1].toLowerCase() === 'unit' ? 'Unit' : 'Year'} ${match[2]}`;
}

/**
 * Format a number to a percentage string with 0 decimal places.
 */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Truncate a string to maxLen chars, appending "…" if truncated.
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '…';
}

const RESTRICTED_WORDS = new Set([
  'first', 'hour', 'each', 'and', 'the', 'with', 'plus', 'minus', 'less', 'more', 'than', 
  'costs', 'price', 'discount', 'sale', 'off', 'tax', 'rent', 'earn', 'profit', 'bill', 'pay', 
  'paid', 'total', 'about', 'would', 'should', 'could', 'must', 'between', 'among', 'through', 
  'during', 'before', 'after', 'against', 'some', 'every', 'other', 'another', 'estimate', 
  'nearest', 'expenses', 'muffins', 'muffin', 'cookies', 'cookie', 'child', 'tickets', 'ticket', 
  'booking', 'fee', 'flagfall', 'payout', 'payouts', 'pizza', 'sausage', 'rolls', 'water', 
  'store', 'rent', 'requires', 'quarterly', 'property', 'value', 'increases', 'family', 
  'diameter', 'profits', 'shared', 'proportion', 'take-home', 'take', 'home', 'shares', 
  'grant', 'divided', 'teams', 'membership', 'largest', 'claim', 'claims', 'net', 'result', 
  'fell', 'dollars', 'dollar', 'cent', 'cents', 'amount', 'charge', 'charges', 'charged', 
  'cost', 'spending', 'spent', 'is', 'are', 'was', 'were', 'modelled', 'modeled', 'worth'
]);

function isFakeMathBlock(content: string): boolean {
  if (!content.includes(' ')) return false;
  if (content.includes('\\')) return false;
  if (/^\s*\d[\d,]*(?:\.\d+)?\s+[a-zA-Z]/.test(content)) return true;
  const words = content.toLowerCase().match(/[a-z]+/g);
  if (!words) return false;
  for (const w of words) {
    if (RESTRICTED_WORDS.has(w)) {
      return true;
    }
  }
  return false;
}

/**
 * Preprocesses markdown/LaTeX text to:
 * 1. Convert LaTeX block delimiters \[ \] to $$ $$
 * 2. Convert LaTeX inline delimiters \( \) to $ $
 * 3. Escape fake math blocks (accidental currency pairings) to prevent them being treated as delimiters
 * 4. Protect math blocks ($...$ and $$...$$) from backslash-escaping
 *    — KaTeX needs single backslashes for commands like \circ, \frac, etc.
 * 5. Escape any remaining unescaped single $ signs in non-math text
 * 6. Process non-math text only — double backslashes so markdown renders them as literal backslashes
 * 7. Restore protected math blocks
 * 8. Convert &#36; outside math blocks back to escaped \$
 */
export function preprocessMarkdown(text: string): string {
  if (!text) return '';

  // Strip script tags to prevent hydration failures from LLM output
  // containing raw <script> elements.
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<\/?script[^>]*>/gi, '');

  // Auto-wrap: if the text has no math delimiters at all but contains
  // math-like patterns (superscripts, subscripts), wrap in $...$
  // so KaTeX renders them properly instead of as literal text.
  let input = text;

  // Markdown link and image targets must be held out of that heuristic.  A
  // filename such as `ms_graph_45a521_option_a.svg` matches the "math-like
  // token" pattern below (word characters, an underscore, more word
  // characters), so the heuristic used to rewrite the URL itself as
  // `/$image_assets/ms_graph_45a521_option_a$.svg`. Every affected image
  // then 404ed: 979 authored texts across 11 banks, 102 of them in production,
  // which is every multiple-choice option graph in those items.
  const linkTargets: string[] = [];
  input = input.replace(
    /(!?\[[^\]]*\]\()([^)\s]+)(\))/g,
    (_match, open: string, target: string, close: string) => {
      linkTargets.push(target);
      return `${open}\x00LT${linkTargets.length - 1}\x00${close}`;
    },
  );

  if (!input.includes('$') && /[\^_][a-zA-Z0-9{]/.test(input) &&
      (/\d/.test(input) || /\\[a-zA-Z]/.test(input))) {
    // Only wrap the entire string if it doesn't contain regular text/words.
    // If it contains English words (letters >= 3 characters long that aren't LaTeX commands),
    // wrapping the whole string would turn words into italic math variables with broken spacing.
    const plainText = input.replace(/\\[a-zA-Z]+/g, '');
    const hasEnglishWords = /[a-zA-Z]{3,}/.test(plainText);

    if (!hasEnglishWords) {
      input = `$${input}$`;
    } else {
      // It contains English words, so we wrap ONLY the specific math-like tokens (e.g., 2^5, x_2, etc.) in $...$
      input = input.replace(/([a-zA-Z0-9_]+[\^_]\{?[a-zA-Z0-9_+\-*\/()={}]+\}?)/g, '$$$1$$');
    }
  }

  // Put the untouched link and image targets back.
  input = input.replace(/\x00LT(\d+)\x00/g, (_match, index: string) => linkTargets[Number(index)]);

  // Step 1: Convert escaped dollar signs (like \\$ or \$) to HTML entity &#36; FIRST
  // to avoid them being treated as math delimiters.
  let processed = input.replace(/\\+\$/g, '&#36;');

  // Step 2: Convert LaTeX delimiters to $/$$ form using replacement functions
  // to avoid JS $$ substitution quirks.
  processed = processed
    .replace(/\\\[/g, () => '$$')
    .replace(/\\\]/g, () => '$$')
    .replace(/\\\(/g, () => '$')
    .replace(/\\\)/g, () => '$');

  const mathBlocks: string[] = [];

  // Step 3: Protect $$...$$ block math FIRST (longest match)
  // This prevents double dollars ($$) from being broken apart into single $ signs
  // and erroneously paired across non-math paragraphs in fake math block detection.
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_match, math: string) => {
    mathBlocks.push(math);
    return `\x00MB${mathBlocks.length - 1}\x00`;
  });

  // Step 4: Escape fake math blocks (accidental currency pairings) in remaining single-dollar content
  processed = processed.replace(/\$([^\$]+?)\$/g, (match, content) => {
    if (isFakeMathBlock(content)) {
      return `&#36;${content}&#36;`;
    }
    return match;
  });

  // Step 5: Protect legitimate inline $...$ math blocks
  processed = processed.replace(/\$([\s\S]*?)\$/g, (_match, math: string) => {
    mathBlocks.push(math);
    return `\x00MI${mathBlocks.length - 1}\x00`;
  });

  // Step 6: Escape any remaining unescaped single $ signs in non-math text
  processed = processed.replace(/\$/g, '&#36;');

  // Step 7: Process non-math text only — double backslashes so markdown
  // renders them as literal backslashes.
  processed = processed
    .replace(/(?<!\\)\\(?!\\)([a-zA-Z]+)/g, '\\\\$1');

  // Step 8: Restore math blocks, converting &#36; back to \char36 inside them
  // so KaTeX can render dollar signs.
  processed = processed.replace(/\x00MB(\d+)\x00/g, (_match, idx: string) => {
    const math = mathBlocks[parseInt(idx)];
    return '$$' + math.replace(/&#36;/g, '\\char36 ') + '$$';
  });
  processed = processed.replace(/\x00MI(\d+)\x00/g, (_match, idx: string) => {
    const math = mathBlocks[parseInt(idx)];
    return '$' + math.replace(/&#36;/g, '\\char36 ') + '$';
  });

  // Step 9: Convert any remaining &#36; in non-math text back to escaped \$
  // so they render correctly as literal dollar signs in markdown instead of showing raw "&#36;".
  processed = processed.replace(/&#36;/g, () => '\\$');

  return processed;
}

/**
 * Mastery band model — maps the backend's status/confidence/evidence fields to a
 * single transparent, evidence-aware label for the student. Avoids showing a
 * precise % when confidence is low (which overclaims precision).
 */
export type MasteryBand =
  | 'Insufficient evidence'
  | 'Emerging'
  | 'Developing'
  | 'Promising early signal'
  | 'Secure'
  | 'Extension-ready';

export interface MasteryDescriptor {
  band: MasteryBand;
  /** Whether a precise mastery % is trustworthy enough to display. */
  showPercent: boolean;
  color: string;
  nextAction: string;
}

export function masteryBand(opts: {
  status?: string | null;
  bktMastery?: number | null;
  confidence?: string | null;
  evidenceCount?: number | null;
  accuracy?: number | null;
}): MasteryDescriptor {
  const { status, bktMastery, confidence, evidenceCount, accuracy } = opts;
  const ev = evidenceCount ?? 0;

  if (!status || status === 'not_started' || ev === 0 || bktMastery === null || bktMastery === undefined) {
    return {
      band: 'Insufficient evidence',
      showPercent: false,
      color: '#94a3b8',
      nextAction: 'Answer a few questions so the tutor can gauge this topic.',
    };
  }

  const conf = confidence ?? 'low';
  const showPercent = conf === 'medium' || conf === 'high';

  if (status === 'promising' || (bktMastery >= 0.8 && (conf === 'low' || ev < 3))) {
    return {
      band: 'Promising early signal',
      showPercent: false,
      color: '#d97706',
      nextAction: 'Answer more independent questions before treating this topic as secure.',
    };
  }

  if (status === 'mastered') {
    const extensionReady =
      conf === 'high' && (accuracy === null || accuracy === undefined || accuracy >= 0.85);
    return extensionReady
      ? {
          band: 'Extension-ready',
          showPercent,
          color: '#7c3aed',
          nextAction: 'Try harder or extension questions to stretch further.',
        }
      : {
          band: 'Secure',
          showPercent,
          color: '#16a34a',
          nextAction: 'Maintain with occasional spaced review.',
        };
  }

  if (status === 'developing') {
    return {
      band: 'Developing',
      showPercent,
      color: '#d97706',
      nextAction: 'Keep practising this topic to reach Secure.',
    };
  }

  // emerging (or any other status with evidence)
  return {
    band: 'Emerging',
    showPercent,
    color: '#dc2626',
    nextAction: 'Start with guided practice and worked examples here.',
  };
}

/**
 * Format student answers (especially JSON objects for multi-part questions) into a readable string.
 */
export function formatStudentAnswer(answer: string | undefined | null): string {
  if (!answer) return '';
  const trimmed = answer.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        return Object.entries(parsed)
          .map(([key, val]) => `${key}) ${val}`)
          .join('; ');
      }
    } catch {
      // Fallback to raw string
    }
  }
  return answer;
}
