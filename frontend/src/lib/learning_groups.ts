/**
 * Learning Map grouping layer.
 *
 * Maps each curriculum topic to a discipline/skill-aware "learning group" for the
 * student-facing navigation, instead of the official ACARA/QCAA strand. This is a
 * pure, deterministic, frontend-only view-model — no backend or schema change.
 *
 * Design + verified findings: docs/learning-map-navigation-plan.md
 * - Science: derived from strand + sub_strand (B/C/E/P), Inquiry/SHE by strand.
 * - English: keyword classifier on the topic name + the AC9 LA/LE/LY code, so it
 *   is consistent across years despite inconsistent pathway_group values.
 * - Maths: strand (or pathway_group strand-prefix), with an Algebra→Functions
 *   refinement, collapsing the per-topic pathway_group buckets into ~5 groups.
 *
 * getLearningGroup returns null when no learning grouping applies (senior units,
 * unknown subjects); callers then fall back to the official groupKey().
 */
import type { CurriculumTopic } from './api-types';

// ---------------------------------------------------------------------------
// Canonical group order per subject (groups not listed are appended, sorted).
// ---------------------------------------------------------------------------

export const SCIENCE_GROUP_ORDER = [
  'Biology',
  'Chemistry',
  'Physics',
  'Earth and space science',
  'Science skills',
  'Science in society',
];

export const ENGLISH_GROUP_ORDER = [
  'Reading comprehension',
  'Text analysis',
  'Argument & persuasion',
  'Writing craft',
  'Grammar & sentence control',
  'Vocabulary & word knowledge',
  'Literature response',
  'Creative/imaginative writing',
  'Speaking & multimodal',
];

export const MATHS_GROUP_ORDER = [
  'Number, fractions & ratio',
  'Algebra & equations',
  'Functions & graphs',
  'Measurement & geometry',
  'Statistics & probability',
];

function normaliseSubject(subject: string | undefined | null): 'math' | 'english' | 'science' | null {
  const s = String(subject || '').toLowerCase();
  if (s.startsWith('senior')) return null; // senior units keep strand/unit grouping
  if (s === 'math' || s === 'maths' || s === 'mathematics') return 'math';
  if (s === 'english') return 'english';
  if (s === 'science') return 'science';
  return null;
}

const topicName = (topic: CurriculumTopic): string =>
  String(topic?.name || topic?.content_descriptor_text || '').toLowerCase();

// ---------------------------------------------------------------------------
// Science: strand + sub_strand
// ---------------------------------------------------------------------------

function getScienceGroup(topic: CurriculumTopic): string | null {
  const strand = String(topic?.strand || '').toLowerCase();
  const sub = String(topic?.sub_strand || '').toUpperCase();
  if (strand.includes('understanding')) {
    if (sub === 'B') return 'Biology';
    if (sub === 'C') return 'Chemistry';
    if (sub === 'P') return 'Physics';
    if (sub === 'E') return 'Earth and space science';
    return 'Science understanding';
  }
  if (strand.includes('inquiry')) return 'Science skills';
  if (strand.includes('human endeavour')) return 'Science in society';
  return null;
}

// ---------------------------------------------------------------------------
// English: AC9 LA/LE/LY code + keyword classifier on the (uniform) topic name
// ---------------------------------------------------------------------------

function englishCode(topic: CurriculumTopic): string {
  const m = /^AC9E\d+([A-Z]{2})/i.exec(String(topic?.topic_id || ''));
  return m ? m[1].toUpperCase() : '';
}

function getEnglishGroup(topic: CurriculumTopic): string | null {
  const name = topicName(topic);
  const code = englishCode(topic);
  const has = (...kw: string[]) => kw.some((k) => name.includes(k));

  if (code === 'LE') {
    if (has('creat', 'imaginative', 'hybrid literary', 'literary effect', 'sustained literary', 'literary voice')) {
      return 'Creative/imaginative writing';
    }
    return 'Literature response';
  }

  if (code === 'LA') {
    if (has('spelling', 'vocabular', 'word origin', 'word learning', 'word knowledge')) return 'Vocabulary & word knowledge';
    if (has('sentence', 'clause', 'tense', 'punctuation', 'colon', 'bracket', 'semicolon', 'dash', 'cohesion', 'nominalisation', 'syntax', 'paragraph')) {
      return 'Grammar & sentence control';
    }
    if (has('persuas', 'evaluative', 'argument', 'rhetoric')) return 'Argument & persuasion';
    if (has('visual', 'multimodal', 'image')) return 'Speaking & multimodal';
    return 'Writing craft';
  }

  if (code === 'LY') {
    if (has('spoken', 'multimodal', 'presentation', 'listening', 'discussion', 'speaking')) return 'Speaking & multimodal';
    if (has('spelling', 'vocabular', 'word knowledge', 'word origin', 'word learning')) return 'Vocabulary & word knowledge';
    if (has('comprehension', 'comprehend', 'inference', 'reading', 'structure of ideas')) return 'Reading comprehension';
    if (has('persuas', 'argument', 'rhetoric')) return 'Argument & persuasion';
    if (has('analy', 'interpret', 'perspective', 'represent', 'compar', 'evaluat', 'audience', 'purpose', 'source', 'quotation', 'values')) {
      return 'Text analysis';
    }
    if (has('creat', 'planning', 'publish', 'organisation of ideas')) return 'Writing craft';
    return 'Reading comprehension';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Maths: strand (or pathway_group strand-prefix) + Algebra→Functions refinement
// ---------------------------------------------------------------------------

function mathsStrand(topic: CurriculumTopic): string {
  const strand = String(topic?.strand || '').toLowerCase();
  if (strand) return strand;
  const pg = String(topic?.pathway_group || '');
  return pg.includes(':') ? pg.split(':')[0].toLowerCase() : pg.toLowerCase();
}

function getMathsGroup(topic: CurriculumTopic): string | null {
  const strand = mathsStrand(topic);
  const name = topicName(topic);
  const has = (...kw: string[]) => kw.some((k) => name.includes(k));

  if (strand.includes('number')) return 'Number, fractions & ratio';
  if (strand.includes('algebra')) {
    if (has('graph', 'function', 'coordinate', 'gradient', 'parabola', 'linear relation')) return 'Functions & graphs';
    return 'Algebra & equations';
  }
  if (strand.includes('measurement') || strand.includes('space')) return 'Measurement & geometry';
  if (strand.includes('statistic') || strand.includes('probability')) return 'Statistics & probability';
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns the learning-map group for a topic, or null to fall back to groupKey(). */
export function getLearningGroup(
  topic: CurriculumTopic,
  subject: string | undefined,
  year?: string,
): string | null {
  if (year && String(year).startsWith('unit')) return null;
  const fam = normaliseSubject(subject);
  if (fam === 'science') return getScienceGroup(topic);
  if (fam === 'english') return getEnglishGroup(topic);
  if (fam === 'math') return getMathsGroup(topic);
  return null;
}

/** Canonical group ordering for a subject (empty when no learning grouping applies). */
export function getLearningGroupOrder(subject: string | undefined, year?: string): string[] {
  if (year && String(year).startsWith('unit')) return [];
  const fam = normaliseSubject(subject);
  if (fam === 'science') return SCIENCE_GROUP_ORDER;
  if (fam === 'english') return ENGLISH_GROUP_ORDER;
  if (fam === 'math') return MATHS_GROUP_ORDER;
  return [];
}

/** Small metadata chips for a topic row — keeps the official ACARA/QCAA strand
 *  visible as metadata. The discipline is already conveyed by the learning group,
 *  so it is intentionally not duplicated here. */
export function getLearningTags(topic: CurriculumTopic, subject?: string): string[] {
  void subject;
  const tags: string[] = [];
  if (topic?.strand) tags.push(String(topic.strand));
  return tags;
}
