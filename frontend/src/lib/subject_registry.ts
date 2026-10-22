/**
 * Single source of truth for subject metadata on the frontend (mirror of
 * backend/subject_registry.py).
 *
 * Keyed by the **picker / curriculum subject key** (what the curriculum view
 * and FrameworkSubjectYearPicker use). For senior courses this is
 * ``senior_<course>``; ``storage`` is the exercise-bank/log subject the
 * backend expects (e.g. ``methods``, ``chemistry``).
 *
 * Adding a new senior course = one entry here + the matching backend registry
 * entry + content. See docs/adding-senior-courses.md.
 */

export interface SubjectMeta {
  /** Exercise-bank / log subject sent to the backend. */
  storage: string;
  /** QCAA-aligned label shown to the student. */
  display: string;
}

export const SUBJECT_REGISTRY: Record<string, SubjectMeta> = {
  // Junior (AC9)
  math: { storage: 'math', display: 'Mathematics' },
  english: { storage: 'english', display: 'English' },
  science: { storage: 'science', display: 'Science' },
  // Senior QCAA — Mathematics suite
  senior_methods: { storage: 'methods', display: 'Mathematical Methods' },
  senior_general: { storage: 'general', display: 'General Mathematics' },
  senior_specialist: { storage: 'specialist', display: 'Specialist Mathematics' },
  senior_essential: { storage: 'essential', display: 'Essential Mathematics' },
  // Senior QCAA — Sciences
  senior_biology: { storage: 'biology', display: 'Biology' },
  senior_chemistry: { storage: 'chemistry', display: 'Chemistry' },
  senior_physics: { storage: 'physics', display: 'Physics' },
  senior_psychology: { storage: 'psychology', display: 'Psychology' },
  senior_earth_environmental_science: { storage: 'earth_environmental_science', display: 'Earth & Environmental Science' },
  // Senior QCAA — English suite
  senior_english: { storage: 'english', display: 'English (Senior)' },
  senior_literature: { storage: 'literature', display: 'Literature' },
  senior_essential_english: { storage: 'essential_english', display: 'Essential English' },
  senior_eal: { storage: 'eal', display: 'English as an Additional Language' },
  senior_literature_extension: { storage: 'literature_extension', display: 'Literature Extension' },
};

// Legacy family fallbacks for any senior_* key not explicitly registered.
const MATH_FAMILY = new Set(['math', 'methods', 'general', 'specialist', 'essential']);
const ENGLISH_FAMILY = new Set(['english', 'literature', 'english_extension', 'essential_english', 'eal', 'literature_extension']);
const SCIENCE_FAMILY = new Set(['science', 'biology', 'chemistry', 'physics', 'psychology', 'earth_environmental_science']);

/** Resolve a picker subject key to the backend storage subject. */
export function storageSubjectFor(pickerSubject: string | undefined): string {
  const value = String(pickerSubject || 'math');
  const meta = SUBJECT_REGISTRY[value];
  if (meta) return meta.storage;
  if (!value.startsWith('senior_')) return value;
  const suffix = value.replace(/^senior_/, '');
  if (ENGLISH_FAMILY.has(suffix)) return 'english';
  if (SCIENCE_FAMILY.has(suffix)) return 'science';
  return 'math';
}

/** Return whether a picker or backend storage subject belongs to Mathematics. */
export function isMathSubject(subject: string | null | undefined): boolean {
  const value = String(subject || '').trim().toLowerCase();
  if (!value) return false;

  const storageSubject = SUBJECT_REGISTRY[value]?.storage
    ?? value.replace(/^senior_/, '');
  return MATH_FAMILY.has(storageSubject);
}
