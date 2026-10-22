import {
  LAB_ACTIVITIES,
  type LabActivityId,
  type LabActivityMeta,
} from './lab-activities';

export interface LabCourseContext {
  subject?: string;
  year?: string;
  topic?: string;
}

/** Return every Lab activity confidently mapped to a real curriculum topic. */
export function getLabActivitiesForTopic(topicId: string): LabActivityMeta[] {
  if (!topicId) return [];
  return Object.values(LAB_ACTIVITIES).filter((activity) => (activity.topicIds ?? []).includes(topicId));
}

/**
 * Return activities mapped to a curriculum scope.
 * AC9 scope values are year7…year10; senior values are unit1…unit4.
 * Subject matching is deliberately conservative: unknown scopes return no links.
 */
export function getLabActivitiesForScope(subject: string, yearOrUnit: string): LabActivityMeta[] {
  const normalizedSubject = subject.trim().toLowerCase();
  const normalizedScope = yearOrUnit.trim().toLowerCase();
  if (!normalizedScope) return [];

  return Object.values(LAB_ACTIVITIES).filter((activity) =>
    (activity.topicIds ?? []).some((topicId) => {
      const topic = topicId.toLowerCase();
      const isAc9Maths = normalizedSubject === 'math' || normalizedSubject === 'mathematics' || normalizedSubject === 'maths';
      const isMethods = normalizedSubject.includes('method');
      const isSpecialist = normalizedSubject.includes('special');
      const matchesSubject = isAc9Maths
        ? topic.startsWith('ac9m')
        : isMethods
          ? topic.startsWith('qcaa_methods_')
          : isSpecialist
            ? topic.startsWith('qcaa_specialist_')
            : false;
      if (!matchesSubject) return false;

      const yearMatch = normalizedScope.match(/^year\s*(7|8|9|10)$/);
      if (yearMatch) return topic.startsWith(`ac9m${yearMatch[1]}`);
      const unitMatch = normalizedScope.match(/^unit\s*(1|2|3|4)$/);
      if (unitMatch) return topic.includes(`_u${unitMatch[1]}_`);
      return false;
    }),
  );
}

/** Build a canonical deep link, optionally retaining the originating course topic. */
export function buildLabDeepLink(
  activityId: LabActivityId,
  mode: 'learn' | 'explore',
  courseContext: LabCourseContext = {},
): string {
  const activity = LAB_ACTIVITIES[activityId];
  if (!activity) return '/lab';
  const params = new URLSearchParams({
    tab: activity.tab,
    mode,
    activity: activityId,
  });
  if (courseContext.subject) params.set('subject', courseContext.subject);
  if (courseContext.year) params.set('year', courseContext.year);
  if (courseContext.topic) params.set('topic', courseContext.topic);
  return `/lab?${params.toString()}`;
}
