import type { ContentAvailability, Curriculum, Subject, YearLevel } from './api-types';
import { storageSubjectFor } from './subject_registry';

/**
 * Return whether a picker scope has active authored exercises.
 * A missing availability response is treated as unknown so an outage does not
 * hide otherwise usable curriculum; a complete response with no scope count is
 * authoritative and returns false.
 */
export function hasAuthoredContentForScope(
  availability: ContentAvailability | null | undefined,
  subject: Subject | string,
  scope: YearLevel | string,
): boolean {
  if (!availability) return true;
  const counts = String(scope).startsWith('unit')
    ? availability.by_unit
    : availability.by_year;
  if (!counts || typeof counts !== 'object') return true;
  const subjectCounts = counts[storageSubjectFor(String(subject))];
  return (subjectCounts?.[String(scope)] ?? 0) > 0;
}

/** Keep only subject/scopes with active authored records for a picker. */
export function filterCurriculumByAvailability(
  curriculum: Curriculum,
  availability: ContentAvailability | null | undefined,
): Curriculum {
  if (!availability) return curriculum;
  const filtered: Curriculum = {};
  for (const [subject, scopes] of Object.entries(curriculum || {})) {
    const availableScopes = Object.fromEntries(
      Object.entries(scopes || {}).filter(([scope]) =>
        hasAuthoredContentForScope(availability, subject, scope),
      ),
    );
    if (Object.keys(availableScopes).length > 0) {
      filtered[subject] = availableScopes;
    }
  }
  return filtered;
}
