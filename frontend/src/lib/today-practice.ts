import type { Subject, TodayStudyPlan, TodayStudyTask, YearLevel } from './api-types';
import type { AnswerConfidence } from './api';
import { buildTodayHref, scopedYearFromSearchParams } from './scoped_navigation';

/**
 * Rules for the one Today practice page.
 *
 * - guided: a new topic. Help is open before the first answer.
 * - independent: review, practice on your own, a mistake retry and mixed
 *   practice. Help opens after the first answer.
 * - check: the final check. No help and no second try.
 */
export type TodayPracticeMode = 'guided' | 'independent' | 'check';

export function todayPracticeMode(task: TodayStudyTask): TodayPracticeMode {
  if (task.kind === 'exit') return 'check';
  if ((task.kind === 'focus' || task.kind === 'extra') && task.practice_mode === 'guided') return 'guided';
  return 'independent';
}

/** A step of today's plan, a more practice step, or a topic the student can choose instead. */
export function findTodayTask(plan: TodayStudyPlan, taskId: string): TodayStudyTask | null {
  for (const task of [...plan.tasks, ...(plan.more_practice ?? [])]) {
    if (task.id === taskId) return task;
    const option = task.topic_options?.find(item => item.id === taskId);
    if (option) return option;
  }
  return null;
}

export function todayHelpAvailable(mode: TodayPracticeMode, attempted: boolean): boolean {
  if (mode === 'check') return false;
  return mode === 'guided' || attempted;
}

/** A new topic stops offering help before the answer after this many right first tries in a row. */
export const TODAY_HELP_FADE_AFTER = 2;

/** One line under the step title that says the help rule. */
export function todayModeHint(mode: TodayPracticeMode, helpFaded = false): string {
  if (mode === 'check') return 'No help on these questions. Answer on your own.';
  if (helpFaded) return `You got ${TODAY_HELP_FADE_AFTER} right on your own. Try first. Help opens after you answer.`;
  if (mode === 'guided') return 'Try each question first. Help is here when you need it.';
  return 'Answer from memory first. Help opens after your first answer.';
}

/**
 * What a past-mistake step does: find the cause (no question), answer the same
 * question again, or answer a new question on the same idea (transfer and the
 * later check). A step without a stage is a retry.
 */
export type TodayMistakeStage = 'cause' | 'retry' | 'transfer';

export function todayMistakeStage(task: TodayStudyTask): TodayMistakeStage | null {
  if (task.kind !== 'mistake') return null;
  if (task.closure_stage === 'needs_understanding') return 'cause';
  if (task.closure_stage === 'needs_transfer' || task.closure_stage === 'needs_consolidation') return 'transfer';
  return 'retry';
}

/** "How sure?" feedback. Only a sure miss and a guessed right answer need a word. */
export function todayConfidenceNote(confidence: AnswerConfidence | null, correct: boolean): string | null {
  if (confidence === 'sure') {
    return correct
      ? 'You were sure, and you were right.'
      : 'You were sure, but it is not right. Look closely at what is different.';
  }
  if (confidence === 'guess' && correct) return 'Right, but you were guessing. Say to yourself why it works.';
  return null;
}

/** At most this many one-sentence explanations a day, so the reflection stays short. */
export const TODAY_EXPLANATIONS_PER_DAY = 2;

export function todayExplanationKey(studentId: string, day: string): string {
  return `qld_tutor_today_explanations:${studentId}:${day}`;
}

export function todayExplanationsUsed(key: string): number {
  try {
    const count = Number(localStorage.getItem(key) || 0);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

export function noteTodayExplanation(key: string): void {
  try {
    localStorage.setItem(key, String(todayExplanationsUsed(key) + 1));
  } catch {
    // debt: a browser without storage asks again; the cap is a convenience, not a rule.
  }
}

/** Topics the step can ask now, in plan order. Review asks only its open topics. */
function askableTopics(task: TodayStudyTask): string[] {
  if (task.kind === 'revision' && task.topic_progress?.length) {
    return task.topic_progress.filter(item => !item.done).map(item => item.topic_id);
  }
  const topics = (task.topic_ids ?? []).filter(Boolean);
  if (topics.length) return topics;
  return task.topic_id ? [task.topic_id] : [];
}

export function firstTodayTopic(task: TodayStudyTask): string | null {
  const topics = askableTopics(task);
  if (!topics.length) return null;
  // The final check and mixed practice ask their topics in turn, also after a reload.
  const offset = task.kind === 'exit' || task.kind === 'mixed' ? task.question_completed : 0;
  return topics[offset % topics.length];
}

/** The topic after `current`, in turn. Stays on `current` when it is the only topic. */
export function nextTodayTopic(task: TodayStudyTask, current: string): string | null {
  const topics = askableTopics(task);
  if (!topics.length) return null;
  const order = task.kind === 'revision' && task.topic_progress?.length
    ? task.topic_progress.map(item => item.topic_id)
    : topics;
  const start = order.indexOf(current);
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = order[(Math.max(start, 0) + step) % order.length];
    if (topics.includes(candidate) && (candidate !== current || topics.length === 1)) return candidate;
  }
  return topics[0];
}

/** A return link from the URL. Only a path on this site is accepted. */
export function safeReturnHref(returnTo: string | null | undefined, fallback: string): string {
  if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) return returnTo;
  return fallback;
}

export interface TodayPracticeScope {
  subject: Subject;
  year: YearLevel;
  taskId: string | null;
  returnHref: string;
}

/**
 * Read a Today practice link. Plan links name the storage subject (for example
 * `methods`) and the course in `syllabus_subject`; the plan API and the picker
 * use the course key (`senior_methods`).
 */
export function todayPracticeScope(
  params: URLSearchParams,
  fallback: { subject: Subject; year: YearLevel },
): TodayPracticeScope {
  const syllabus = params.get('syllabus_subject');
  const rawSubject = params.get('subject') || fallback.subject;
  const subject = (syllabus && !rawSubject.startsWith('senior_') ? `senior_${syllabus}` : rawSubject) as Subject;
  const year = scopedYearFromSearchParams(params, fallback.year);
  return {
    subject,
    year,
    taskId: params.get('today_task'),
    returnHref: safeReturnHref(params.get('return_to'), buildTodayHref({ subject, year })),
  };
}
