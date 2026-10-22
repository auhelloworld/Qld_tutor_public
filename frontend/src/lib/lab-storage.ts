/**
 * localStorage helpers for lab activity completion records.
 * Data shape: { [activityId]: { completedAt: ISO string, attempts: number } }
 */

const STORAGE_KEY = 'qld-maths-lab-completed-v1';

export interface LabCompletionRecord {
  completedAt: string;
  attempts: number;
}

export type LabCompletionData = Record<string, LabCompletionRecord>;

/** Read all completion records. Graceful on corrupt/missing data. */
export function getLabCompletions(): LabCompletionData {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const valid: LabCompletionData = {};
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
    return {};
  }
}

/** Get completed activity IDs as a Set */
export function getCompletedActivityIds(): Set<string> {
  return new Set(Object.keys(getLabCompletions()));
}

/** Mark an activity as completed. Increments attempts if already recorded. */
export function markActivityCompleted(activityId: string): void {
  if (typeof window === 'undefined') return;
  const data = getLabCompletions();
  const existing = data[activityId];
  data[activityId] = {
    completedAt: new Date().toISOString(),
    attempts: existing ? existing.attempts + 1 : 1,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked — silently fail
  }
}

/** Clear all completion data (for testing/reset) */
export function clearLabCompletions(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
