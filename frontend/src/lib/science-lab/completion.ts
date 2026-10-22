/**
 * localStorage helpers for Science Lab activity completion records.
 * Isolated from Math Lab storage and namespaced to the active student profile.
 * Completing a Science Lab activity stores client-side progress only
 * and does NOT update BKT mastery.
 */

import { getStudentId } from '../student_id';

const LEGACY_SCIENCE_STORAGE_KEY = 'qld-science-lab-completed-v1';

export interface ScienceLabCompletionRecord {
  completedAt: string;
  attempts: number;
}

export type ScienceLabCompletionData = Record<string, ScienceLabCompletionRecord>;

interface CompletionLoadResult {
  data: ScienceLabCompletionData;
  storageAvailable: boolean;
}

function studentStorageKey(): string | null {
  if (typeof window === 'undefined') return null;
  const studentId = getStudentId();
  return studentId === 'ssr-placeholder'
    ? null
    : `${LEGACY_SCIENCE_STORAGE_KEY}:${encodeURIComponent(studentId)}`;
}

function parseCompletionData(raw: string): ScienceLabCompletionData | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

    const valid: ScienceLabCompletionData = {};
    for (const [activityId, value] of Object.entries(parsed)) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'completedAt' in value &&
        typeof value.completedAt === 'string' &&
        'attempts' in value &&
        typeof value.attempts === 'number' &&
        Number.isInteger(value.attempts) &&
        value.attempts > 0
      ) {
        valid[activityId] = { completedAt: value.completedAt, attempts: value.attempts };
      }
    }
    return valid;
  } catch {
    return null;
  }
}

/**
 * Read the active student's records and claim the legacy global key once. The
 * legacy key is removed only after the profile-scoped write succeeds.
 */
function loadCompletionState(): CompletionLoadResult {
  if (typeof window === 'undefined') return { data: {}, storageAvailable: false };

  try {
    const scopedKey = studentStorageKey();
    if (!scopedKey) return { data: {}, storageAvailable: false };

    const scopedRaw = window.localStorage.getItem(scopedKey);
    const scopedData = scopedRaw === null
      ? null
      : parseCompletionData(scopedRaw);
    const legacyRaw = window.localStorage.getItem(LEGACY_SCIENCE_STORAGE_KEY);

    if (legacyRaw === null) {
      return { data: scopedData ?? {}, storageAvailable: true };
    }

    const legacyData = parseCompletionData(legacyRaw);
    if (legacyData === null) {
      return { data: scopedData ?? {}, storageAvailable: true };
    }

    // Preserve profile-scoped conflicts while importing any legacy-only
    // activity records, then remove legacy even when scoped data already exists.
    const mergedData = { ...legacyData, ...(scopedData ?? {}) };
    try {
      window.localStorage.setItem(scopedKey, JSON.stringify(mergedData));
    } catch {
      return { data: scopedData ?? {}, storageAvailable: false };
    }

    try {
      window.localStorage.removeItem(LEGACY_SCIENCE_STORAGE_KEY);
    } catch {
      return { data: mergedData, storageAvailable: false };
    }
    return { data: mergedData, storageAvailable: true };
  } catch {
    return { data: {}, storageAvailable: false };
  }
}

/** Read all completion records for the active student. */
export function getScienceLabCompletions(): ScienceLabCompletionData {
  return loadCompletionState().data;
}

/** Get completed Science Lab activity IDs as a Set. */
export function getCompletedScienceActivityIds(): Set<string> {
  return new Set(Object.keys(getScienceLabCompletions()));
}

/** Mark an activity complete only when the profile-scoped write succeeds. */
export function markScienceActivityCompleted(activityId: string): boolean {
  const loaded = loadCompletionState();
  if (!loaded.storageAvailable) return false;

  try {
    const scopedKey = studentStorageKey();
    if (!scopedKey) return false;
    const existing = loaded.data[activityId];
    const nextData: ScienceLabCompletionData = {
      ...loaded.data,
      [activityId]: {
        completedAt: new Date().toISOString(),
        attempts: existing ? existing.attempts + 1 : 1,
      },
    };
    window.localStorage.setItem(scopedKey, JSON.stringify(nextData));
    return true;
  } catch {
    return false;
  }
}

/** Clear Science Lab completion data for the active student. */
export function clearScienceLabCompletions(): void {
  if (typeof window === 'undefined') return;
  try {
    const scopedKey = studentStorageKey();
    if (scopedKey) window.localStorage.removeItem(scopedKey);
    window.localStorage.removeItem(LEGACY_SCIENCE_STORAGE_KEY);
  } catch {
    // Browser storage or identity may be blocked.
  }
}
