import { buildPracticeHref } from '../scoped_navigation';
import { SCIENCE_ACTIVITIES } from './activities';
import type { ScienceActivityId, ScienceActivityMeta } from './activity-types';

export interface ScienceLabCourseContext {
  subject?: string;
  year?: string;
  topic?: string;
}

export function getScienceCourseYear(year: string | undefined): number | undefined {
  const match = year?.trim().match(/(?:^|\D)(10|[7-9])(?:\D|$)/);
  return match ? Number(match[1]) : undefined;
}

export function getScienceTopicYear(topicId: string): number | undefined {
  const match = topicId.trim().toUpperCase().match(/^AC9S(10|[7-9])/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Apply a year selected inside the directory to the route context. A topic from
 * the launching course is retained only when it belongs to that same year.
 */
export function withScienceSelectionYear(
  courseContext: ScienceLabCourseContext,
  selectedYear: number | undefined,
): ScienceLabCourseContext {
  if (selectedYear === undefined) return { ...courseContext };

  const sourceTopic = courseContext.topic?.trim();
  return {
    ...courseContext,
    subject: 'science',
    year: `year${selectedYear}`,
    topic: sourceTopic && getScienceTopicYear(sourceTopic) === selectedYear
      ? sourceTopic
      : undefined,
  };
}

/**
 * Resolve the practice topic without losing a compatible course context that
 * launched the activity. An originating mapped topic wins, followed by a
 * transfer target for the selected/originating year, then the first target.
 */
export function resolveScienceTransferTopic(
  activity: ScienceActivityMeta,
  courseContext: ScienceLabCourseContext = {},
): string | undefined {
  const transferCandidates = activity.transferTopicIds.length > 0
    ? activity.transferTopicIds
    : activity.topicIds;
  const mappedCandidates = [...new Set([...transferCandidates, ...activity.topicIds])];
  const originatingTopic = courseContext.topic?.trim().toUpperCase();
  const originatingYear = getScienceCourseYear(courseContext.year);

  if (originatingTopic) {
    const directMatch = mappedCandidates.find(
      (topicId) => topicId.toUpperCase() === originatingTopic,
    );
    if (
      directMatch &&
      (originatingYear === undefined || getScienceTopicYear(directMatch) === originatingYear)
    ) {
      return directMatch;
    }
  }

  if (originatingYear !== undefined) {
    const yearMatch = transferCandidates.find(
      (topicId) => getScienceTopicYear(topicId) === originatingYear,
    );
    if (yearMatch) return yearMatch;
  }

  return transferCandidates[0];
}

/** Build the ordinary-practice boundary with the resolved Science scope. */
export function buildScienceTransferPracticeHref(topicId: string): string {
  const topic = topicId.trim();
  if (!topic) return '/';
  const year = getScienceTopicYear(topic);
  return buildPracticeHref({
    subject: 'science',
    year: year === undefined ? undefined : `year${year}`,
    topic,
  });
}

/** Return every Science Lab activity confidently mapped to a real AC9 curriculum topic. */
export function getScienceActivitiesForTopic(topicId: string): ScienceActivityMeta[] {
  if (!topicId) return [];
  const normalized = topicId.trim().toUpperCase();
  return Object.values(SCIENCE_ACTIVITIES).filter((activity) =>
    activity.topicIds.some((id) => id.toUpperCase() === normalized),
  );
}

/**
 * Return activities mapped to a curriculum scope.
 * AC9 Science scope values are year7…year10.
 */
export function getScienceActivitiesForScope(
  subject: string,
  yearOrUnit: string,
): ScienceActivityMeta[] {
  const normalizedSubject = subject.trim().toLowerCase();
  const normalizedScope = yearOrUnit.trim().toLowerCase();
  if (!normalizedScope) return [];

  const isScience =
    normalizedSubject === 'science' ||
    normalizedSubject.includes('bio') ||
    normalizedSubject.includes('chem') ||
    normalizedSubject.includes('phys');
  if (!isScience) return [];

  const yearMatch = normalizedScope.match(/^year\s*(7|8|9|10)$/);
  if (!yearMatch) return [];

  const yearNum = parseInt(yearMatch[1], 10);
  return Object.values(SCIENCE_ACTIVITIES).filter((activity) =>
    activity.yearLevels.includes(yearNum),
  );
}

/** Build a canonical deep link for Science Lab, optionally retaining originating course topic. */
export function buildScienceLabDeepLink(
  activityId: ScienceActivityId,
  mode: 'learn' | 'explore' = 'learn',
  courseContext: ScienceLabCourseContext = {},
): string {
  const activity = SCIENCE_ACTIVITIES[activityId];
  if (!activity) return '/science-lab';
  const params = new URLSearchParams({
    activity: activityId,
    mode,
  });
  if (courseContext.subject) params.set('subject', courseContext.subject);
  if (courseContext.year) params.set('year', courseContext.year);
  if (courseContext.topic) params.set('topic', courseContext.topic);
  return `/science-lab?${params.toString()}`;
}
