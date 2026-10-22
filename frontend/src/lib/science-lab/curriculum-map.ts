import { SCIENCE_ACTIVITIES } from './activities';
import type { ScienceActivityId, ScienceActivityMeta } from './activity-types';

export const SCIENCE_STRANDS = [
  'Biological Sciences',
  'Chemical Sciences',
  'Earth and Space Sciences',
  'Physical Sciences',
  'Science Inquiry',
] as const;

export type ScienceStrand = (typeof SCIENCE_STRANDS)[number];

export const SCIENCE_YEAR_LEVELS = [7, 8, 9, 10] as const;

/**
 * Find all Science Lab activities mapped to a given curriculum topic.
 */
export function getScienceActivitiesForTopic(topicId: string): ScienceActivityMeta[] {
  if (!topicId) return [];
  const normalized = topicId.trim().toUpperCase();
  return Object.values(SCIENCE_ACTIVITIES).filter((activity) =>
    activity.topicIds.some((id) => id.toUpperCase() === normalized),
  );
}

/**
 * Filter activities by Year level.
 */
export function getScienceActivitiesForYear(year: number): ScienceActivityMeta[] {
  return Object.values(SCIENCE_ACTIVITIES).filter((activity) =>
    activity.yearLevels.includes(year),
  );
}

/**
 * Filter activities by Science Strand.
 */
export function getScienceActivitiesForStrand(strand: string): ScienceActivityMeta[] {
  const normalized = strand.trim().toLowerCase();
  return Object.values(SCIENCE_ACTIVITIES).filter(
    (activity) => activity.strand.toLowerCase() === normalized,
  );
}

/**
 * Get all mapped topic IDs across all activities.
 */
export function getAllMappedScienceTopicIds(): string[] {
  const set = new Set<string>();
  for (const activity of Object.values(SCIENCE_ACTIVITIES)) {
    for (const tid of activity.topicIds) {
      set.add(tid);
    }
  }
  return Array.from(set);
}

/**
 * Get all transfer topic IDs across all activities.
 */
export function getAllTransferScienceTopicIds(): string[] {
  const set = new Set<string>();
  for (const activity of Object.values(SCIENCE_ACTIVITIES)) {
    for (const tid of activity.transferTopicIds) {
      set.add(tid);
    }
  }
  return Array.from(set);
}

/**
 * Lookup an activity by ID.
 */
export function getScienceActivityById(
  id: string,
): ScienceActivityMeta | undefined {
  return SCIENCE_ACTIVITIES[id as ScienceActivityId];
}
