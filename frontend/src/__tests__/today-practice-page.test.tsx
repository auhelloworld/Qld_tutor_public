import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exercise, TodayStudyPlan, TodayStudyTask, TutorMarkResponse } from '../lib/api-types';

const api = vi.hoisted(() => ({
  fetchTodayPlan: vi.fn(),
  fetchExercises: vi.fn(),
  fetchMistakes: vi.fn(),
  recordMistakeCause: vi.fn(),
  resolveMistakeReview: vi.fn(),
  updateTutorAttemptMetadata: vi.fn(),
  tutorSuggest: vi.fn(),
  tutorMark: vi.fn(),
  tutorExplain: vi.fn(),
  tutorDialogue: vi.fn(),
  fetchTopicWorkedExample: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());

vi.mock('../lib/api', () => ({ ...api, syllabusSubjectFromPickerSubject: () => undefined }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('../lib/toast', () => ({ showToast: vi.fn() }));
vi.mock('../components/TodaySessionBar', () => ({ default: () => <div data-testid="today-session-bar" /> }));

import TodayPractice from '../components/TodayPractice';
import { getStudentId } from '../lib/student_id';
import type { Mistake } from '../lib/api-types';

const RETURN = '/today?subject=math&year=year7';

// Student question payloads have no answer key; the server sends the answer after a final miss.
function question(id: string, topic: string): Exercise {
  return { id, topic, topic_ids: [topic], question: `Question ${id}`, question_type: 'short_answer' };
}

/** Like the backend: a miss sent as the last try ("I don't know" or revealAnswer) returns the answer and its steps. */
function wrongWithReveal(overrides: Partial<TutorMarkResponse> = {}) {
  return async (id: string, _answer: string, _signal: unknown, opts?: { gaveUp?: boolean; revealAnswer?: boolean }) => mark({
    ...overrides,
    ...(opts?.gaveUp || opts?.revealAnswer ? { correct_answer: `Answer for ${id}`, solution_steps: [`First step for ${id}`] } : {}),
  });
}

function mistakeRow(overrides: Partial<Mistake> & Pick<Mistake, 'question_id'>): Mistake {
  return {
    topic_id: 'T5', question: `Question ${overrides.question_id}`, question_type: 'short_answer',
    correct_answer: '6', student_answer: '12', error_type: 'concept_gap', misconception_id: null,
    timestamp: '2026-10-19T01:00:00+00:00', closure_stage: 'needs_understanding',
    ...overrides,
  };
}

function task(overrides: Partial<TodayStudyTask> & Pick<TodayStudyTask, 'id' | 'kind'>): TodayStudyTask {
  return {
    title: 'Step',
    reason: 'Reason',
    estimated_minutes: 6,
    remaining_minutes: 6,
    question_target: 4,
    question_completed: 0,
    completed: false,
    href: '/today/practice',
    ...overrides,
  };
}

function plan(tasks: TodayStudyTask[]): TodayStudyPlan {
  return {
    session_id: 's', date: '2026-10-20', subject: 'math', scope: 'year7',
    estimated_minutes: 20, remaining_minutes: 20, question_completed: 0,
    completed_tasks: 0, total_tasks: tasks.length, complete: false, independent_secured: false,
    next_task_id: tasks[0]?.id ?? null, next_href: null, tasks,
  };
}

const mark = (overrides: Partial<TutorMarkResponse>): TutorMarkResponse => ({
  is_correct: false, outcome: 'incorrect', feedback: 'Check the second step.', question_type: 'short_answer', ...overrides,
});

const REVIEW = task({
  id: 'today|2026-10-20|math|year7|revision|T1,T2',
  kind: 'revision',
  title: 'Review topics that are due',
  topic_ids: ['T1', 'T2'],
  topic_names: ['Fractions', 'Primes'],
  topic_progress: [
    { topic_id: 'T1', answered: 1, done: true },
    { topic_id: 'T2', answered: 0, done: false },
  ],
});

function renderPractice(taskId: string) {
  return render(<TodayPractice subject="math" year="year7" taskId={taskId} returnHref={RETURN} />);
}

async function answer(value: string) {
  fireEvent.change(await screen.findByLabelText('Your Answer:'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
}

beforeEach(() => {
  api.tutorExplain.mockResolvedValue({ has_lesson_content: false });
  api.fetchTopicWorkedExample.mockResolvedValue({
    has_worked_example: true,
    worked_example: { question: 'Example: 2 + 2', steps: [{ step: 1, instruction: 'Add', result: '4' }], answer: '4' },
  });
});

afterEach(() => {
  cleanup();
  // Reset, not clear: a failed test must not leave queued mock answers for the next one.
  vi.resetAllMocks();
});

describe('Today practice: review step', () => {
  it('asks an open topic from memory and opens help only after the first answer', async () => {
    api.fetchTodayPlan.mockResolvedValue(plan([REVIEW]));
    api.tutorSuggest.mockResolvedValue({ question: question('r1', 'T2') });
    api.tutorMark.mockImplementation(wrongWithReveal());

    renderPractice(REVIEW.id);

    expect(await screen.findByText('Question r1')).toBeTruthy();
    expect(api.tutorSuggest.mock.calls[0][0]).toBe('T2');
    expect(screen.getByText('Primes')).toBeTruthy();
    expect(screen.getByText('Answer from memory first. Help opens after your first answer.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Need help/ })).toBeNull();

    await answer('5');

    expect(await screen.findByText('Not quite right')).toBeTruthy();
    expect(api.tutorMark).toHaveBeenCalledWith('r1', '5', undefined, expect.objectContaining({
      todayTaskId: REVIEW.id,
      isRevision: true,
      supportLevel: 0,
      firstAttempt: true,
      guidedPhase: 'independent',
    }));
    expect(api.tutorMark.mock.calls[0][3]).not.toHaveProperty('reviewSource');
    // A second try is left, so the answer stays hidden.
    expect(api.tutorMark.mock.calls[0][3]).not.toHaveProperty('revealAnswer');
    expect(screen.getByRole('button', { name: /Try Again/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Need help/ })).toBeTruthy();
  });

  it('shows the answer and a worked example after two misses, then moves on', async () => {
    api.fetchTodayPlan.mockResolvedValue(plan([REVIEW]));
    api.tutorSuggest
      .mockResolvedValueOnce({ question: question('r1', 'T2') })
      .mockResolvedValueOnce({ question: question('r2', 'T2') });
    api.tutorMark.mockImplementation(wrongWithReveal());

    renderPractice(REVIEW.id);
    await answer('5');
    fireEvent.click(await screen.findByRole('button', { name: /Try Again/ }));
    await answer('6');

    const reveal = await screen.findByRole('region', { name: 'How to answer it' });
    expect(within(reveal).getByText('Answer for r1')).toBeTruthy();
    // The steps of this question come first; the topic example is one more model.
    expect(within(reveal).getByText('First step for r1')).toBeTruthy();
    expect(within(reveal).getByText('Example: 2 + 2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Try Again/ })).toBeNull();
    expect(api.tutorMark.mock.calls[1][3]).toEqual(expect.objectContaining({
      firstAttempt: false, correctionCompleted: true, revealAnswer: true,
    }));

    fireEvent.click(screen.getByRole('button', { name: /Next question/ }));
    expect(await screen.findByText('Question r2')).toBeTruthy();
    expect(api.tutorSuggest).toHaveBeenLastCalledWith('T2', 'retrieve', 'r1', undefined, 'math', 7, undefined);
  });
});

describe('Today practice: “I don’t know”', () => {
  it('records a miss without an answer and shows how to do it', async () => {
    const focus = task({ id: 'today|2026-10-20|math|year7|focus|T3', kind: 'focus', practice_mode: 'independent', topic_id: 'T3', topic_ids: ['T3'], question_target: 10 });
    api.fetchTodayPlan.mockResolvedValue(plan([focus]));
    api.tutorSuggest
      .mockResolvedValueOnce({ question: question('f1', 'T3') })
      .mockResolvedValueOnce({ question: question('f2', 'T3') });
    api.tutorMark.mockImplementation(wrongWithReveal({ error_type: 'dont_know', feedback: 'That is OK.' }));

    renderPractice(focus.id);
    fireEvent.click(await screen.findByRole('button', { name: 'I don’t know' }));

    const reveal = await screen.findByRole('region', { name: 'How to answer it' });
    expect(within(reveal).getByText('Answer for f1')).toBeTruthy();
    expect(api.tutorMark).toHaveBeenCalledWith('f1', '', undefined, expect.objectContaining({ gaveUp: true, todayTaskId: focus.id }));
    expect(screen.queryByRole('button', { name: /Try Again/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Next question/ }));
    expect(await screen.findByText('Question f2')).toBeTruthy();
  });
});

describe('Today practice: final check', () => {
  const FINAL = task({
    id: 'today|2026-10-20|math|year7|exit|NEW,OLD',
    kind: 'exit',
    title: 'Final check: 2 questions on your own',
    question_target: 2,
    topic_ids: ['NEW', 'OLD'],
  });

  it('gives no help and no second try, shows the right answer, then asks the other topic', async () => {
    api.fetchTodayPlan.mockResolvedValue(plan([FINAL]));
    api.tutorSuggest
      .mockResolvedValueOnce({ question: question('e1', 'NEW') })
      .mockResolvedValueOnce({ question: question('e2', 'OLD') });
    api.tutorMark.mockImplementation(wrongWithReveal());

    renderPractice(FINAL.id);
    expect(await screen.findByText('Question e1')).toBeTruthy();
    expect(screen.getByText('No help on these questions. Answer on your own.')).toBeTruthy();
    expect(api.fetchTopicWorkedExample).not.toHaveBeenCalled();
    await answer('11');

    expect(await screen.findByText('Not quite right')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Try Again/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Need help|Explain my answer/ })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'How to answer it' })).getByText('Answer for e1')).toBeTruthy();
    // The final check has no second try, so its first answer asks for the answer.
    expect(api.tutorMark.mock.calls[0][3]).toEqual(expect.objectContaining({ revealAnswer: true }));

    fireEvent.click(screen.getByRole('button', { name: /Next question/ }));
    expect(await screen.findByText('Question e2')).toBeTruthy();
    expect(api.tutorSuggest.mock.calls[1][0]).toBe('OLD');
  });

  it('returns to Today when the server says the step is done', async () => {
    api.fetchTodayPlan
      .mockResolvedValueOnce(plan([FINAL]))
      .mockResolvedValue(plan([{ ...FINAL, completed: true, question_completed: 2 }]));
    api.tutorSuggest.mockResolvedValue({ question: question('e1', 'NEW') });
    api.tutorMark.mockResolvedValue(mark({ is_correct: true, outcome: 'correct', feedback: 'Correct.' }));

    renderPractice(FINAL.id);
    await answer('4');
    const done = await screen.findByRole('button', { name: /Back to Today’s Study/ });
    fireEvent.click(done);

    await waitFor(() => expect(push).toHaveBeenCalledWith(RETURN));
    expect(api.tutorSuggest).toHaveBeenCalledTimes(1);
  });
});

describe('Today practice: other steps', () => {
  it('retries a wrong part once, then moves to the next part', async () => {
    const focus = task({ id: 'today|2026-10-20|math|year7|focus|T4', kind: 'focus', practice_mode: 'independent', topic_id: 'T4', topic_ids: ['T4'], question_target: 10 });
    const multi: Exercise = {
      id: 'mp1', topic: 'T4', topic_ids: ['T4'], question: 'Answer both parts', answer: 'See parts', question_type: 'multi_part',
      sub_parts: [
        { label: 'a', question: '2 + 2', answer: '4', marks: 1 },
        { label: 'b', question: '3 + 3', answer: '6', marks: 1 },
      ],
    };
    const result = (a: [boolean, string], b: [boolean, string]): TutorMarkResponse => mark({
      question_type: 'multi_part',
      is_correct: a[0] && b[0],
      outcome: a[0] && b[0] ? 'correct' : 'incorrect',
      part_results: [
        { label: 'a', is_correct: a[0], outcome: a[1] ? (a[0] ? 'correct' : 'incorrect') : 'unanswered', student_answer: a[1] },
        { label: 'b', is_correct: b[0], outcome: b[1] ? (b[0] ? 'correct' : 'incorrect') : 'unanswered', student_answer: b[1] },
      ],
    });
    api.fetchTodayPlan.mockResolvedValue(plan([focus]));
    api.tutorSuggest.mockResolvedValue({ question: multi });
    api.tutorMark
      .mockResolvedValueOnce(result([false, '5'], [false, '']))
      .mockResolvedValueOnce(result([true, '4'], [false, '']))
      .mockResolvedValueOnce(result([true, '4'], [true, '6']));

    renderPractice(focus.id);
    const typePart = async (value: string) => {
      fireEvent.change(await screen.findByPlaceholderText(/Type your answer for part/), { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
    };

    await typePart('5');
    fireEvent.click(await screen.findByRole('button', { name: /Try Again/ }));
    expect(await screen.findByPlaceholderText('Type your answer for part (a) here...')).toBeTruthy();
    await typePart('4');
    fireEvent.click(await screen.findByRole('button', { name: /Continue to next part/ }));
    expect(await screen.findByPlaceholderText('Type your answer for part (b) here...')).toBeTruthy();
    await typePart('6');
    expect(await screen.findByRole('button', { name: /Next question/ })).toBeTruthy();

    const calls = api.tutorMark.mock.calls;
    expect(calls.map(call => call[1])).toEqual(['{"a":"5"}', '{"a":"4"}', '{"b":"6"}']);
    expect(calls[0][3]).toEqual(expect.objectContaining({ firstAttempt: true, rootFirstAttempt: true }));
    expect(calls[1][3]).toEqual(expect.objectContaining({ firstAttempt: false, rootFirstAttempt: false }));
    expect(calls[2][3]).toEqual(expect.objectContaining({ firstAttempt: false, rootFirstAttempt: false }));
  });

  it('retries the exact mistake question', async () => {
    const retry = task({ id: 'today|2026-10-20|math|year7|mistake|m-7', kind: 'mistake', question_target: 1, topic_id: 'T5', topic_ids: ['T5'], question_id: 'm-7' });
    api.fetchTodayPlan.mockResolvedValue(plan([retry]));
    api.fetchExercises.mockResolvedValue([question('m-1', 'T5'), question('m-7', 'T5')]);

    renderPractice(retry.id);

    expect(await screen.findByText('Question m-7')).toBeTruthy();
    expect(api.fetchExercises).toHaveBeenCalledWith('T5', undefined, 'math', 7, undefined, undefined);
    expect(api.tutorSuggest).not.toHaveBeenCalled();
  });

  it('starts a new topic with the goal, a lesson and an example; the lesson is not an answer', async () => {
    const learn = task({
      id: 'today|2026-10-20|math|year7|focus|T9', kind: 'focus', practice_mode: 'guided', learn_step: true,
      title: 'Learn something new', topic_id: 'T9', topic_ids: ['T9'], question_target: 10,
      success_criterion: 'I can find square roots.',
    });
    api.fetchTodayPlan.mockResolvedValue(plan([learn]));
    api.tutorSuggest.mockResolvedValue({ question: question('g1', 'T9') });

    renderPractice(learn.id);

    const lesson = await screen.findByRole('region', { name: 'Learn first' });
    expect(within(lesson).getByText('I can find square roots.')).toBeTruthy();
    expect(await within(lesson).findByText('Example: 2 + 2')).toBeTruthy();
    expect(api.tutorSuggest).not.toHaveBeenCalled();

    fireEvent.click(within(lesson).getByRole('button', { name: /Start practising/ }));
    expect(await screen.findByText('Question g1')).toBeTruthy();
    expect(api.tutorMark).not.toHaveBeenCalled();
    // A new topic offers help before the first answer.
    expect(screen.getByRole('button', { name: /Need help/ })).toBeTruthy();
  });

  it('explains when the step is not in today’s plan', async () => {
    api.fetchTodayPlan.mockResolvedValue(plan([REVIEW]));

    renderPractice('today|2026-10-19|math|year7|revision|OLD');

    expect(await screen.findByText('This step is not in today’s plan.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Back to Today’s Study/ }));
    expect(push).toHaveBeenCalledWith(RETURN);
  });
});

describe('Today practice: chosen topics and more practice', () => {
  it('runs a topic the student chose instead of the suggested new topic', async () => {
    const chosen = task({
      id: 'today|2026-10-20|math|year7|focus|T9', kind: 'focus', title: 'Learn something new',
      practice_mode: 'independent', topic_id: 'T9', topic_ids: ['T9'], topic_names: ['Ratios'], question_target: 10,
    });
    const suggested = task({
      id: 'today|2026-10-20|math|year7|focus|T3', kind: 'focus', practice_mode: 'independent',
      topic_id: 'T3', topic_ids: ['T3'], question_target: 10, topic_options: [chosen],
    });
    api.fetchTodayPlan.mockResolvedValue(plan([suggested]));
    api.tutorSuggest.mockResolvedValue({ question: question('c1', 'T9') });

    renderPractice(chosen.id);

    expect(await screen.findByText('Question c1')).toBeTruthy();
    expect(api.tutorSuggest.mock.calls[0][0]).toBe('T9');
    expect(screen.getByText('Ratios')).toBeTruthy();
  });

  it('keeps the final check closed until the other steps are done', async () => {
    const final = task({ id: 'today|2026-10-20|math|year7|exit|T3', kind: 'exit', question_target: 2, topic_ids: ['T3'], locked: true });
    api.fetchTodayPlan.mockResolvedValue(plan([final]));

    renderPractice(final.id);

    expect(await screen.findByText('The final check opens after the other steps.')).toBeTruthy();
    expect(api.tutorSuggest).not.toHaveBeenCalled();
  });

  it('finishes a round of mixed practice, then goes back to Today', async () => {
    const mixed = task({
      id: 'today|2026-10-20|math|year7|mixed|T1,T2', kind: 'mixed', title: 'Mixed practice',
      topic_ids: ['T1', 'T2'], question_target: 4, question_completed: 3,
    });
    api.fetchTodayPlan.mockResolvedValue({ ...plan([]), complete: true, more_practice: [mixed] });
    api.tutorSuggest.mockResolvedValue({ question: question('m4', 'T2') });
    api.tutorMark.mockResolvedValue(mark({ is_correct: true, outcome: 'correct', feedback: 'Correct!' }));

    renderPractice(mixed.id);

    expect(await screen.findByText('Question m4')).toBeTruthy();
    // The fourth question of the round goes on to the next topic in turn.
    expect(api.tutorSuggest.mock.calls[0][0]).toBe('T2');
    await answer('7');
    expect(api.tutorMark).toHaveBeenCalledWith('m4', '7', undefined, expect.objectContaining({
      todayTaskId: mixed.id, isRevision: false, guidedPhase: 'independent',
    }));
    fireEvent.click(await screen.findByRole('button', { name: /Back to Today/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(RETURN));
  });
});

describe('Today practice: help button', () => {
  it('puts Need help next to I don’t know while the student answers', async () => {
    const focus = task({
      id: 'today|2026-10-20|math|year7|focus|T3', kind: 'focus', practice_mode: 'guided',
      topic_id: 'T3', topic_ids: ['T3'], question_target: 10,
    });
    api.fetchTodayPlan.mockResolvedValue(plan([focus]));
    api.tutorSuggest.mockResolvedValue({ question: question('h1', 'T3') });

    renderPractice(focus.id);

    const dontKnow = await screen.findByRole('button', { name: 'I don’t know' });
    const help = screen.getAllByRole('button', { name: /Need help/ });
    expect(help).toHaveLength(1);
    expect(help[0].parentElement).toBe(dontKnow.parentElement);
  });
});

describe('Today practice: past mistakes on the same page', () => {
  const CAUSE = task({
    id: 'today|2026-10-20|math|year7|mistake|m-3', kind: 'mistake', title: 'Find out why an answer was wrong',
    closure_stage: 'needs_understanding', question_target: 0, topic_id: 'T5', topic_ids: ['T5'], topic_names: ['HCF'],
    question_id: 'm-3',
  });
  const TRANSFER = task({
    id: 'today|2026-10-20|math|year7|mistake|src-1', kind: 'mistake', title: 'Show you can fix it on a new question',
    closure_stage: 'needs_transfer', question_target: 1, topic_id: 'T5', topic_ids: ['T5'], question_id: 'src-1',
  });
  const mistakes = (rows: Mistake[]) => ({ mistakes: rows, total: rows.length, returned: rows.length, offset: 0, has_more: false, summary: {} });

  it('asks for the cause here, with the student answer and the right steps, then goes back to Today', async () => {
    api.fetchTodayPlan.mockResolvedValue(plan([CAUSE]));
    api.fetchMistakes.mockResolvedValue(mistakes([
      mistakeRow({ question_id: 'm-3', solution_steps: ['List the factors of both numbers.'] }),
    ]));
    api.recordMistakeCause.mockResolvedValue({ closure_stage: 'needs_retry', error_cause: 'concept_gap', cause_recorded_at: 'now' });

    renderPractice(CAUSE.id);

    const step = await screen.findByRole('region', { name: 'Find the cause' });
    expect(within(step).getByText('Question m-3')).toBeTruthy();
    expect(within(step).getByText('12')).toBeTruthy();
    expect(within(step).getByText('List the factors of both numbers.')).toBeTruthy();
    expect(api.fetchMistakes).toHaveBeenCalledWith(expect.objectContaining({ subject: 'math', topic_id: 'T5', yearLevel: 7, status: 'active' }));
    expect(api.tutorSuggest).not.toHaveBeenCalled();
    const save = within(step).getByRole('button', { name: /Save and go back/ });
    expect(save.hasAttribute('disabled')).toBe(true);

    fireEvent.click(within(step).getByRole('radio', { name: /Concept unclear/ }));
    fireEvent.change(within(step).getByLabelText(/Plan for next time/), { target: { value: 'If I see HCF, then I list factors.' } });
    fireEvent.click(save);

    await waitFor(() => expect(api.recordMistakeCause).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'math', question_id: 'm-3', topic_id: 'T5', error_cause: 'concept_gap',
      ifThenStrategy: 'If I see HCF, then I list factors.', yearLevel: 7,
    })));
    await waitFor(() => expect(push).toHaveBeenCalledWith(RETURN));
  });

  it('asks a new question on the same idea and moves the mistake on after a first-try right answer', async () => {
    api.fetchTodayPlan.mockResolvedValue(plan([TRANSFER]));
    api.fetchMistakes.mockResolvedValue(mistakes([mistakeRow({ question_id: 'src-1', closure_stage: 'needs_transfer' })]));
    api.tutorSuggest.mockResolvedValue({ question: question('v-1', 'T5'), variation_match: { eligible: true } });
    api.tutorMark.mockResolvedValue(mark({
      is_correct: true, outcome: 'correct', feedback: 'Correct!', attempt_id: 'att-9', review_resolution_eligible: true,
    }));
    api.resolveMistakeReview.mockResolvedValue({ status: 'active', resolved: false, review_count: 1, closure_stage: 'needs_consolidation' });

    renderPractice(TRANSFER.id);

    expect(await screen.findByText('Question v-1')).toBeTruthy();
    expect(api.tutorSuggest).toHaveBeenCalledWith('T5', 'error_book', 'src-1', undefined, 'math', 7, undefined);
    await answer('6');

    expect(api.tutorMark).toHaveBeenCalledWith('v-1', '6', undefined, expect.objectContaining({
      todayTaskId: TRANSFER.id, reviewSource: 'error_book', reviewQuestionId: 'src-1',
      isRevision: true, firstAttempt: true, supportLevel: 0,
    }));
    // The step is saved right after the answer, with one request ID per answer.
    await waitFor(() => expect(api.resolveMistakeReview).toHaveBeenCalledWith(expect.objectContaining({
      question_id: 'src-1', topic_id: 'T5', resolved: true, resolutionSource: 'demonstrated_correction',
      requestId: 'today-resolve-att-9', yearLevel: 7,
    })));
    expect(await screen.findByText(/A short check comes in 3 days/)).toBeTruthy();
    expect(screen.queryByText(/Quit|Question 1 of 1|Challenge/)).toBeNull();
  });

  it('counts a right second try as practice, so the mistake stays', async () => {
    api.fetchTodayPlan.mockResolvedValue(plan([TRANSFER]));
    api.fetchMistakes.mockResolvedValue(mistakes([mistakeRow({ question_id: 'src-1', closure_stage: 'needs_transfer' })]));
    api.tutorSuggest.mockResolvedValue({ question: question('v-1', 'T5'), variation_match: { eligible: true } });
    api.tutorMark
      .mockResolvedValueOnce(mark({ attempt_id: 'att-1' }))
      .mockResolvedValueOnce(mark({ is_correct: true, outcome: 'correct', feedback: 'Correct!', attempt_id: 'att-2', review_resolution_eligible: true }));

    renderPractice(TRANSFER.id);
    await answer('5');
    fireEvent.click(await screen.findByRole('button', { name: /Try Again/ }));
    await answer('6');

    expect(await screen.findByText(/counts as practice/)).toBeTruthy();
    expect(api.resolveMistakeReview).not.toHaveBeenCalled();
  });

  it('counts a guessed right answer as practice, so the mistake stays', async () => {
    api.fetchTodayPlan.mockResolvedValue(plan([TRANSFER]));
    api.fetchMistakes.mockResolvedValue(mistakes([mistakeRow({ question_id: 'src-1', closure_stage: 'needs_transfer' })]));
    api.tutorSuggest.mockResolvedValue({ question: question('v-1', 'T5'), variation_match: { eligible: true } });
    api.tutorMark.mockResolvedValue(mark({
      is_correct: true, outcome: 'correct', feedback: 'Correct!', attempt_id: 'att-9', review_resolution_eligible: true,
    }));

    renderPractice(TRANSFER.id);
    fireEvent.change(await screen.findByLabelText('Your Answer:'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guessing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));

    expect(await screen.findByText(/counts as practice/)).toBeTruthy();
    expect(api.tutorMark.mock.calls[0][3]).toEqual(expect.objectContaining({ confidence: 'guess' }));
    expect(api.resolveMistakeReview).not.toHaveBeenCalled();
  });
});

describe('Today practice: thinking about the answer', () => {
  const FOCUS = task({
    id: 'today|2026-10-20|math|year7|focus|T3', kind: 'focus', practice_mode: 'independent',
    topic_id: 'T3', topic_ids: ['T3'], question_target: 10,
  });
  const explanationKey = () => `qld_tutor_today_explanations:${getStudentId()}:2026-10-20`;

  beforeEach(() => localStorage.removeItem(explanationKey()));

  it('sends an optional “How sure?” and says when a sure answer was wrong', async () => {
    api.fetchTodayPlan.mockResolvedValue(plan([FOCUS]));
    api.tutorSuggest.mockResolvedValue({ question: question('c1', 'T3') });
    api.tutorMark.mockResolvedValue(mark({}));

    renderPractice(FOCUS.id);
    fireEvent.change(await screen.findByLabelText('Your Answer:'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));

    expect(await screen.findByText(/You were sure, but it is not right/)).toBeTruthy();
    expect(api.tutorMark.mock.calls[0][3]).toEqual(expect.objectContaining({ confidence: 'sure' }));
  });

  it('asks for one sentence after a corrected right answer before the next question', async () => {
    api.fetchTodayPlan.mockResolvedValue(plan([FOCUS]));
    api.tutorSuggest.mockResolvedValue({ question: question('c1', 'T3') });
    api.tutorMark
      .mockResolvedValueOnce(mark({ attempt_id: 'att-1' }))
      .mockResolvedValueOnce(mark({ is_correct: true, outcome: 'correct', feedback: 'Correct!', attempt_id: 'att-2' }));
    api.updateTutorAttemptMetadata.mockResolvedValue({ success: true });

    renderPractice(FOCUS.id);
    await answer('5');
    fireEvent.click(await screen.findByRole('button', { name: /Try Again/ }));
    await answer('4');

    const box = await screen.findByLabelText(/What made it work/);
    expect(screen.getByRole('button', { name: /Next question/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(box, { target: { value: 'I squared before I added.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateTutorAttemptMetadata).toHaveBeenCalledWith('c1', 'att-2', 'I squared before I added.'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Next question/ }).hasAttribute('disabled')).toBe(false));
    expect(localStorage.getItem(explanationKey())).toBe('1');
  });

  it('asks for a sentence at most twice a day', async () => {
    localStorage.setItem(explanationKey(), '2');
    api.fetchTodayPlan.mockResolvedValue(plan([FOCUS]));
    api.tutorSuggest.mockResolvedValue({ question: question('c1', 'T3') });
    api.tutorMark
      .mockResolvedValueOnce(mark({ attempt_id: 'att-1' }))
      .mockResolvedValueOnce(mark({ is_correct: true, outcome: 'correct', feedback: 'Correct!', attempt_id: 'att-2' }));

    renderPractice(FOCUS.id);
    await answer('5');
    fireEvent.click(await screen.findByRole('button', { name: /Try Again/ }));
    await answer('4');

    expect(await screen.findByRole('button', { name: /Next question/ })).toBeTruthy();
    expect(screen.queryByLabelText(/What made it work/)).toBeNull();
    expect(screen.getByRole('button', { name: /Next question/ }).hasAttribute('disabled')).toBe(false);
  });

  it('stops offering help before the answer after two right first tries on a new topic', async () => {
    const guided = { ...FOCUS, practice_mode: 'guided' as const };
    api.fetchTodayPlan.mockResolvedValue(plan([guided]));
    api.tutorSuggest
      .mockResolvedValueOnce({ question: question('g1', 'T3') })
      .mockResolvedValueOnce({ question: question('g2', 'T3') })
      .mockResolvedValueOnce({ question: question('g3', 'T3') });
    api.tutorMark.mockResolvedValue(mark({ is_correct: true, outcome: 'correct', feedback: 'Correct!' }));

    renderPractice(guided.id);
    expect(await screen.findByText('Question g1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Need help/ })).toBeTruthy();
    await answer('1');
    fireEvent.click(await screen.findByRole('button', { name: /Next question/ }));
    expect(await screen.findByText('Question g2')).toBeTruthy();
    await answer('2');
    fireEvent.click(await screen.findByRole('button', { name: /Next question/ }));

    expect(await screen.findByText('Question g3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Need help/ })).toBeNull();
    expect(screen.getByText(/You got 2 right on your own/)).toBeTruthy();
    expect(api.tutorMark.mock.calls[0][3]).toEqual(expect.objectContaining({ guidedPhase: 'guided' }));
  });

  it('does not count a guessed right answer toward stopping help', async () => {
    localStorage.setItem(explanationKey(), '2');
    const guided = { ...FOCUS, practice_mode: 'guided' as const };
    api.fetchTodayPlan.mockResolvedValue(plan([guided]));
    api.tutorSuggest
      .mockResolvedValueOnce({ question: question('g1', 'T3') })
      .mockResolvedValueOnce({ question: question('g2', 'T3') })
      .mockResolvedValueOnce({ question: question('g3', 'T3') });
    api.tutorMark.mockResolvedValue(mark({ is_correct: true, outcome: 'correct', feedback: 'Correct!' }));

    renderPractice(guided.id);
    expect(await screen.findByText('Question g1')).toBeTruthy();
    await answer('1');
    fireEvent.click(await screen.findByRole('button', { name: /Next question/ }));
    expect(await screen.findByText('Question g2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your Answer:'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guessing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
    fireEvent.click(await screen.findByRole('button', { name: /Next question/ }));

    expect(await screen.findByText('Question g3')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Need help/ })).toBeTruthy();
    expect(screen.queryByText(/You got 2 right on your own/)).toBeNull();
  });
});
