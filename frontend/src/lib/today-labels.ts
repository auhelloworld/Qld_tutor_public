import type { TodayStudyPlan, TodayStudyTask } from './api-types';
import { scopeDisplayName, subjectDisplayName } from './format';

/** Student-facing Today Study wording shared by the page, home card and session bar. */

export function todayScopeLabel(subject: string, scope: string): string {
  return `${scopeDisplayName(scope)} ${subjectDisplayName(subject)}`;
}

export function todayTaskTopicLine(task: TodayStudyTask): string {
  return (task.topic_names ?? []).filter(Boolean).join(' · ');
}

/** Steps that stop on evidence ask "up to" their question target. */
function stopsEarly(task: TodayStudyTask): boolean {
  return task.kind === 'focus' || task.kind === 'extra' || task.kind === 'revision';
}

/** "3 of up to 10 questions · about 8 min left", or the reflection wording for a step without questions. */
export function todayTaskMeta(task: TodayStudyTask): string {
  const target = task.question_target;
  if (task.kind === 'mixed') {
    // Mixed practice has no end: it shows the current round.
    const left = Math.max(0, target - task.question_completed);
    const done = task.question_completed > 0 ? `${task.question_completed} done today · ` : '';
    return `${done}${left} ${left === 1 ? 'question' : 'questions'} in this round · about ${task.remaining_minutes} min`;
  }
  if (target <= 0) return task.completed ? 'Reflection done' : `Short reflection · about ${task.estimated_minutes} min`;
  const amount = stopsEarly(task)
    ? `${task.question_completed} of up to ${target} questions`
    : `${task.question_completed}/${target} ${target === 1 ? 'question' : 'questions'}`;
  return task.completed ? amount : `${amount} · about ${task.remaining_minutes} min left`;
}

export interface TodayTaskStatus {
  label: string;
  /** True only for independent evidence or a finished non-question step. */
  positive: boolean;
}

/** Status line for a finished step. A reflection or diagnostic is never called independent evidence. */
export function todayTaskStatus(task: TodayStudyTask): TodayTaskStatus | null {
  if (!task.completed) return null;
  if (task.kind === 'diagnostic') return { label: 'Diagnostic completed', positive: true };
  if (task.question_target <= 0) return { label: 'Reflection recorded', positive: true };
  if (task.independent_secured) return { label: 'Done on your own', positive: true };
  if (task.supported_progress) return { label: 'Done with help · check again on your own later', positive: false };
  return { label: 'Done · more review planned', positive: false };
}

/** Share of the day that is done: finished steps plus part of the current step. */
export function todayProgressFraction(plan: TodayStudyPlan): number {
  if (plan.total_tasks <= 0) return 0;
  const done = plan.tasks.reduce((total, task) => {
    if (task.completed) return total + 1;
    if (task.question_target <= 0) return total;
    return total + Math.min(0.9, task.question_completed / task.question_target);
  }, 0);
  return Math.min(1, done / plan.total_tasks);
}

/** Today's goal: the new topic's "I can" statement, else a sentence about the final check topics. */
export function todayGoal(plan: TodayStudyPlan): string {
  if (plan.tasks.some(task => task.kind === 'diagnostic')) {
    return 'I will answer honestly, so the diagnostic finds the right starting point.';
  }
  if (plan.goal) return plan.goal;
  const finalCheck = plan.tasks.find(task => task.kind === 'exit');
  const names = (finalCheck?.topic_names ?? []).filter(Boolean);
  if (names.length >= 2) {
    return `I can get a question on ${names[0]} and a question on ${names[1]} right the first time, with no help.`;
  }
  if (names.length === 1) {
    return `I can get 2 questions on ${names[0]} right the first time, with no help.`;
  }
  return 'I can get the 2 final check questions right the first time, with no help.';
}

/** Readable colours for small status text on light panels (at least 4.5:1). */
export const STATUS_COLOURS = { positive: '#15803d', pending: '#b45309' } as const;
