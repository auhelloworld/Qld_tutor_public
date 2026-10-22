import { describe, expect, it } from 'vitest';
import type { TodayStudyPlan, TodayStudyTask } from '../lib/api-types';
import {
  findTodayTask,
  firstTodayTopic,
  nextTodayTopic,
  safeReturnHref,
  todayHelpAvailable,
  todayMistakeStage,
  todayPracticeMode,
  todayPracticeScope,
} from '../lib/today-practice';

function task(overrides: Partial<TodayStudyTask> & Pick<TodayStudyTask, 'id' | 'kind'>): TodayStudyTask {
  return {
    title: 'Step',
    reason: 'Reason',
    estimated_minutes: 4,
    remaining_minutes: 4,
    question_target: 2,
    question_completed: 0,
    completed: false,
    href: '/today/practice',
    ...overrides,
  };
}

describe('Today practice mode', () => {
  it('runs every past-mistake stage on the practice page', () => {
    const mistake = (closure_stage?: TodayStudyTask['closure_stage']) => task({ id: 'm', kind: 'mistake', closure_stage });
    expect(todayMistakeStage(mistake('needs_understanding'))).toBe('cause');
    expect(todayMistakeStage(mistake('needs_retry'))).toBe('retry');
    expect(todayMistakeStage(mistake('needs_transfer'))).toBe('transfer');
    expect(todayMistakeStage(mistake('needs_consolidation'))).toBe('transfer');
    // An older plan without a stage keeps the retry behaviour.
    expect(todayMistakeStage(mistake())).toBe('retry');
    expect(todayMistakeStage(task({ id: 'r', kind: 'revision' }))).toBeNull();
  });

  it('gives each step the help rule that the plan promises', () => {
    expect(todayPracticeMode(task({ id: 'f', kind: 'focus', practice_mode: 'guided' }))).toBe('guided');
    expect(todayPracticeMode(task({ id: 'f', kind: 'focus', practice_mode: 'independent' }))).toBe('independent');
    expect(todayPracticeMode(task({ id: 'r', kind: 'revision' }))).toBe('independent');
    expect(todayPracticeMode(task({ id: 'm', kind: 'mistake' }))).toBe('independent');
    expect(todayPracticeMode(task({ id: 'e', kind: 'exit' }))).toBe('check');
    // One more topic works like the new topic; mixed practice opens help after the first answer.
    expect(todayPracticeMode(task({ id: 'x', kind: 'extra', practice_mode: 'guided' }))).toBe('guided');
    expect(todayPracticeMode(task({ id: 'x', kind: 'extra', practice_mode: 'independent' }))).toBe('independent');
    expect(todayPracticeMode(task({ id: 'm', kind: 'mixed' }))).toBe('independent');
  });

  it('opens help before the first answer only in guided mode, and never in the final check', () => {
    expect(todayHelpAvailable('guided', false)).toBe(true);
    expect(todayHelpAvailable('independent', false)).toBe(false);
    expect(todayHelpAvailable('independent', true)).toBe(true);
    expect(todayHelpAvailable('check', true)).toBe(false);
  });
});

describe('Today practice topics', () => {
  const review = task({
    id: 'r',
    kind: 'revision',
    topic_ids: ['T1', 'T2', 'T3'],
    topic_progress: [
      { topic_id: 'T1', answered: 1, done: true },
      { topic_id: 'T2', answered: 1, done: false },
      { topic_id: 'T3', answered: 0, done: false },
    ],
  });

  it('asks only the open review topics, in turn', () => {
    expect(firstTodayTopic(review)).toBe('T2');
    expect(nextTodayTopic(review, 'T2')).toBe('T3');
    expect(nextTodayTopic(review, 'T3')).toBe('T2');
    // A finished topic is skipped.
    expect(nextTodayTopic(review, 'T1')).toBe('T2');
  });

  it('stays on the last open review topic', () => {
    const lastOpen = { ...review, topic_progress: review.topic_progress!.map(item => ({ ...item, done: item.topic_id !== 'T3' })) };
    expect(nextTodayTopic(lastOpen, 'T3')).toBe('T3');
  });

  it('returns no topic when every review topic is done', () => {
    const done = { ...review, topic_progress: review.topic_progress!.map(item => ({ ...item, done: true })) };
    expect(firstTodayTopic(done)).toBeNull();
    expect(nextTodayTopic(done, 'T2')).toBeNull();
  });

  it('asks the final check topics one after the other', () => {
    const finalCheck = task({ id: 'e', kind: 'exit', topic_ids: ['NEW', 'OLD'] });
    expect(firstTodayTopic(finalCheck)).toBe('NEW');
    expect(nextTodayTopic(finalCheck, 'NEW')).toBe('OLD');
    expect(firstTodayTopic({ ...finalCheck, question_completed: 1 })).toBe('OLD');
  });

  it('keeps the new topic and the mistake topic', () => {
    expect(firstTodayTopic(task({ id: 'f', kind: 'focus', topic_id: 'NEW', topic_ids: ['NEW'] }))).toBe('NEW');
    const retry = task({ id: 'm', kind: 'mistake', topic_id: 'OLD', topic_ids: ['OLD'], question_id: 'q-7' });
    expect(firstTodayTopic(retry)).toBe('OLD');
    expect(nextTodayTopic(retry, 'OLD')).toBe('OLD');
  });

  it('mixes the topics in turn, also across rounds', () => {
    const mixed = task({ id: 'x', kind: 'mixed', topic_ids: ['T1', 'T2'], question_completed: 3, question_target: 4 });
    expect(firstTodayTopic(mixed)).toBe('T2');
    expect(nextTodayTopic(mixed, 'T2')).toBe('T1');
  });
});

describe('Finding a Today step', () => {
  const chosen = task({ id: 'focus-T2', kind: 'focus', topic_ids: ['T2'] });
  const otherExtra = task({ id: 'extra-T5', kind: 'extra', topic_ids: ['T5'] });
  const plan: TodayStudyPlan = {
    session_id: 's', date: '2026-10-20', subject: 'math', scope: 'year7',
    estimated_minutes: 20, remaining_minutes: 0, question_completed: 8,
    completed_tasks: 1, total_tasks: 1, complete: true, independent_secured: true,
    tasks: [task({ id: 'focus-T1', kind: 'focus', topic_options: [chosen] })],
    more_practice: [
      task({ id: 'extra-T4', kind: 'extra', topic_options: [otherExtra] }),
      task({ id: 'mixed', kind: 'mixed' }),
    ],
  };

  it('finds plan steps, more practice steps and the topics a student can choose', () => {
    expect(findTodayTask(plan, 'focus-T1')?.id).toBe('focus-T1');
    expect(findTodayTask(plan, 'focus-T2')).toBe(chosen);
    expect(findTodayTask(plan, 'mixed')?.kind).toBe('mixed');
    expect(findTodayTask(plan, 'extra-T5')).toBe(otherExtra);
    expect(findTodayTask(plan, 'missing')).toBeNull();
  });
});

describe('Today return link', () => {
  it('accepts only a path on this site', () => {
    expect(safeReturnHref('/today?subject=math&year=year7', '/today')).toBe('/today?subject=math&year=year7');
    expect(safeReturnHref('//evil.example', '/today')).toBe('/today');
    expect(safeReturnHref('https://evil.example', '/today')).toBe('/today');
    expect(safeReturnHref(null, '/today')).toBe('/today');
  });
});

describe('Today practice scope', () => {
  const fallback = { subject: 'math', year: 'year7' } as const;

  it('reads the step, the scope and the return link from the URL', () => {
    const scope = todayPracticeScope(
      new URLSearchParams('subject=english&year=year8&today_task=t1&return_to=%2Ftoday%3Fsubject%3Denglish%26year%3Dyear8'),
      fallback,
    );
    expect(scope).toEqual({
      subject: 'english',
      year: 'year8',
      taskId: 't1',
      returnHref: '/today?subject=english&year=year8',
    });
  });

  it('turns a senior storage subject back into the course the plan uses', () => {
    const scope = todayPracticeScope(
      new URLSearchParams('subject=methods&unit=1&syllabus_subject=methods&today_task=t2&return_to=https%3A%2F%2Fevil.example'),
      fallback,
    );
    expect(scope.subject).toBe('senior_methods');
    expect(scope.year).toBe('unit1');
    expect(scope.returnHref).toBe('/today?subject=senior_methods&unit=1&syllabus_subject=methods');
  });
});
