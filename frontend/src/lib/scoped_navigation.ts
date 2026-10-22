import type { Subject, YearLevel } from './api-types';

export interface ScopedNavigationParams {
  subject?: Subject | string;
  year?: YearLevel | string;
  topic?: string;
  question?: string;
  mode?: string;
  syllabusSubject?: string;
  showAnswer?: boolean;
  focus?: string;
  todaySession?: boolean;
  todayTask?: string;
  todayKind?: string;
  todayTopics?: string[];
  todayTarget?: number;
  returnTo?: string;
}

function inferSyllabusSubject(subject?: Subject | string): string | undefined {
  const value = subject ? String(subject) : '';
  if (!value.startsWith('senior_')) return undefined;
  return value.replace(/^senior_/, '');
}

function appendIfPresent(params: URLSearchParams, key: string, value?: string) {
  if (value && value.trim()) params.set(key, value);
}

export function buildScopedQuery({
  subject,
  year,
  topic,
  question,
  mode,
  syllabusSubject,
  showAnswer,
  focus,
  todaySession,
  todayTask,
  todayKind,
  todayTopics,
  todayTarget,
  returnTo,
}: ScopedNavigationParams): string {
  const params = new URLSearchParams();
  appendIfPresent(params, 'subject', subject ? String(subject) : undefined);

  const yearValue = year ? String(year) : '';
  if (/^unit\d+$/i.test(yearValue)) {
    params.set('unit', yearValue.replace(/^unit/i, ''));
  } else {
    appendIfPresent(params, 'year', yearValue);
  }

  const seniorSubject = syllabusSubject || inferSyllabusSubject(subject);
  appendIfPresent(params, 'syllabus_subject', seniorSubject);
  appendIfPresent(params, 'topic', topic);
  appendIfPresent(params, 'question', question);
  appendIfPresent(params, 'mode', mode);
  appendIfPresent(params, 'focus', focus);
  appendIfPresent(params, 'today_task', todayTask);
  appendIfPresent(params, 'today_kind', todayKind);
  if (todayTopics?.length) params.set('today_topics', todayTopics.filter(Boolean).join(','));
  if (todayTarget && todayTarget > 0) params.set('today_target', String(Math.floor(todayTarget)));
  appendIfPresent(params, 'return_to', returnTo);
  if (showAnswer) params.set('show_answer', '1');
  if (todaySession) params.set('today_session', '1');

  return params.toString();
}

export function buildPracticeHref(params: ScopedNavigationParams = {}): string {
  const query = buildScopedQuery(params);
  return query ? `/?${query}` : '/';
}

export function buildMistakesHref(params: ScopedNavigationParams = {}): string {
  const query = buildScopedQuery(params);
  return query ? `/mistakes?${query}` : '/mistakes';
}

export function buildTodayHref(params: Pick<ScopedNavigationParams, 'subject' | 'year' | 'syllabusSubject'> = {}): string {
  const query = buildScopedQuery(params);
  return query ? `/today?${query}` : '/today';
}

/** Keep a Today task inside the persistent session while preserving its backend-authored deep link. */
export function withTodaySessionHref(
  href: string,
  scope: Pick<ScopedNavigationParams, 'subject' | 'year' | 'syllabusSubject'>,
): string {
  const url = new URL(href, 'https://qld-tutor.local');
  url.searchParams.set('today_session', '1');
  url.searchParams.set('return_to', buildTodayHref(scope));
  if (!url.searchParams.has('subject') && scope.subject) {
    url.searchParams.set('subject', String(scope.subject));
  }
  if (!url.searchParams.has('year') && !url.searchParams.has('unit') && scope.year) {
    const year = String(scope.year);
    if (/^unit\d+$/i.test(year)) url.searchParams.set('unit', year.replace(/^unit/i, ''));
    else url.searchParams.set('year', year);
  }
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
}

export function isTodaySession(params: URLSearchParams): boolean {
  return params.get('today_session') === '1';
}

export function scopedSubjectFromSearchParams(
  params: URLSearchParams,
  fallback: Subject,
): Subject {
  return (params.get('subject') || fallback) as Subject;
}

export function scopedYearFromSearchParams(
  params: URLSearchParams,
  fallback: YearLevel,
): YearLevel {
  const unit = params.get('unit');
  if (unit && /^\d+$/.test(unit)) return `unit${unit}` as YearLevel;

  const year = params.get('year');
  if (!year) return fallback;
  if (/^year\d+$/i.test(year)) return year.toLowerCase() as YearLevel;
  if (/^\d+$/.test(year)) return `year${year}` as YearLevel;
  return year as YearLevel;
}
