'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import GuidedQuestionCard from './guided/GuidedQuestionCard';
import GuidedFeedbackCard from './guided/GuidedFeedbackCard';
import GuidedHelpDrawer from './guided/GuidedHelpDrawer';
import TodaySessionBar from './TodaySessionBar';
import {
  TodayAnswerReveal,
  TodayCauseStep,
  TodayConfidencePicker,
  TodayLearnStep,
  TodaySelfExplanation,
  TodayStepNotice,
} from './TodayPracticeParts';
import {
  fetchExercises,
  fetchMistakes,
  fetchTodayPlan,
  fetchTopicWorkedExample,
  recordMistakeCause,
  syllabusSubjectFromPickerSubject,
  tutorDialogue,
  tutorExplain,
  tutorMark,
  tutorSuggest,
  updateTutorAttemptMetadata,
  type AnswerConfidence,
  type SupportLevel,
} from '../lib/api';
import type { ErrorCauseCode } from '../lib/constants';
import { getMultiPartSessionOutcome } from '../lib/guided-session';
import { getSubjectAdapter } from '../lib/guided-subject-adapters';
import { hasMinimumSelfExplanation } from '../lib/metacognition';
import { getStudentId } from '../lib/student_id';
import { isMathSubject } from '../lib/subject_registry';
import { showToast } from '../lib/toast';
import { TODAY_CLOSURE_NOTES, useTodayMistakeClosure } from '../lib/use-today-mistake-closure';
import {
  TODAY_EXPLANATIONS_PER_DAY,
  TODAY_HELP_FADE_AFTER,
  findTodayTask,
  firstTodayTopic,
  nextTodayTopic,
  noteTodayExplanation,
  todayConfidenceNote,
  todayExplanationKey,
  todayExplanationsUsed,
  todayHelpAvailable,
  todayMistakeStage,
  todayModeHint,
  todayPracticeMode,
  type TodayMistakeStage,
  type TodayPracticeMode,
} from '../lib/today-practice';
import type {
  ChatMessage,
  Exercise,
  Mistake,
  Subject,
  SubPartResult,
  TodayStudyTask,
  TutorExplainResponse,
  TutorMarkResponse,
  WorkedExample,
  YearLevel,
} from '../lib/api-types';

/**
 * The one practice page for every Today step: review, a new topic, practice on
 * your own, the past-mistake steps (find the cause, answer the same question
 * again, a new question on the same idea), the final check, and the more
 * practice steps. The step comes from the plan.
 * The step stops when the server says it is done.
 */

type Phase = 'loading' | 'learn' | 'cause' | 'answer' | 'feedback' | 'missing' | 'locked' | 'done' | 'error';

interface StepInfo {
  kind: TodayStudyTask['kind'];
  title: string;
  mode: TodayPracticeMode;
  goal: string | null;
  questionId: string | null;
  stage: TodayMistakeStage | null;
}

/** What happened to the Error Book item after a transfer answer: see use-today-mistake-closure. */

interface Explanation {
  questionId: string;
  attemptId?: string;
  status: 'due' | 'saving' | 'saved' | 'failed';
}

const DIALOGUE_PREFIXES = ['[PRE_ATTEMPT_CONCEPT] ', '[PRE_ATTEMPT_FIRST_STEP] ', '[EXPLAINING] '];
const HELP_ACTIONS = new Set(['show_worked_example', 'try_again', 'explain_my_answer', 'mark_final_answer']);
const WIDE_LAYOUT = '(min-width: 1100px)';

function stripPrefix(message: string) {
  const prefix = DIALOGUE_PREFIXES.find(value => message.startsWith(value));
  return prefix ? message.slice(prefix.length) : message;
}

function newRequestId(prefix: string): string {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

const norm = (label: unknown) => String(label || '').toLowerCase().trim();

function topicName(task: TodayStudyTask | null, topic: string): string {
  const index = task?.topic_ids?.indexOf(topic) ?? -1;
  return (index >= 0 ? task?.topic_names?.[index] : undefined) || topic;
}

export default function TodayPractice({
  subject,
  year,
  taskId,
  returnHref,
}: {
  subject: Subject;
  year: YearLevel;
  taskId: string;
  returnHref: string;
}) {
  const router = useRouter();
  const scope = useMemo(() => {
    const unitMatch = /^unit(\d+)$/.exec(String(year));
    const yearMatch = /^year(\d+)$/.exec(String(year));
    return {
      yearLevel: yearMatch ? Number(yearMatch[1]) : undefined,
      unit: unitMatch ? Number(unitMatch[1]) : undefined,
      syllabusSubject: syllabusSubjectFromPickerSubject(subject),
    };
  }, [subject, year]);
  const adapter = useMemo(() => getSubjectAdapter(subject), [subject]);
  const subjectColor = adapter.subject === 'english' ? '#0891b2' : 'var(--accent-color)';

  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [step, setStep] = useState<StepInfo | null>(null);
  const [task, setTask] = useState<TodayStudyTask | null>(null);
  const [topic, setTopic] = useState('');
  const [questionRequest, setQuestionRequest] = useState<{ topic: string; exclude: string | null; serial: number } | null>(null);
  const [question, setQuestion] = useState<Exercise | null>(null);
  const [answer, setAnswer] = useState('');
  const [markResponse, setMarkResponse] = useState<TutorMarkResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingPlan, setCheckingPlan] = useState(false);
  const [misses, setMisses] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [revealedAnswer, setRevealedAnswer] = useState<string | null>(null);
  const [revealedSteps, setRevealedSteps] = useState<string[] | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [multiPartResults, setMultiPartResults] = useState<SubPartResult[]>([]);
  const [activePart, setActivePart] = useState<string | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [cap, setCap] = useState(1);
  const [announcement, setAnnouncement] = useState('');
  const [stepComplete, setStepComplete] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpFaded, setHelpFaded] = useState(false);
  const [lesson, setLesson] = useState<TutorExplainResponse | null>(null);
  const [workedExample, setWorkedExample] = useState<WorkedExample | null>(null);
  const [helpLoading, setHelpLoading] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
  const [dialogueLoading, setDialogueLoading] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [exampleToken, setExampleToken] = useState(0);
  const [mistake, setMistake] = useState<Mistake | null>(null);
  const [causeSaving, setCauseSaving] = useState(false);
  const [causeError, setCauseError] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<AnswerConfidence | null>(null);
  const [submittedConfidence, setSubmittedConfidence] = useState<AnswerConfidence | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explanationText, setExplanationText] = useState('');

  const taskRef = useRef<TodayStudyTask | null>(null);
  const supportRef = useRef<SupportLevel>(0);
  const answeredIds = useRef(new Set<string>());
  const countedIds = useRef(new Set<string>());
  const planCheckRef = useRef<Promise<TodayStudyTask | null> | null>(null);
  const markRequestRef = useRef<{ key: string; requestId: string } | null>(null);
  const dialogueRequestRef = useRef<{ key: string; requestId: string } | null>(null);
  const generationRef = useRef(0);
  const partAttemptsRef = useRef(new Map<string, number>());
  const partMissRef = useRef(false);
  const starsRef = useRef<{ total: number; stars?: number; level?: number }>({ total: 0 });
  const planDateRef = useRef('');
  const firstTryStreakRef = useRef(0);
  // The new question for a transfer step is a fair test of the same idea.
  const transferEligibleRef = useRef(false);
  const helpRef = useRef<HTMLElement | null>(null);
  const closureScope = useMemo(() => ({ subject, ...scope }), [scope, subject]);
  const { closure, advance: advanceClosure, retryPending, reset: resetClosure } = useTodayMistakeClosure(closureScope);

  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  const mode: TodayPracticeMode = step?.mode ?? 'independent';
  // A new topic stops offering help before the answer after two right first tries.
  const faded = mode === 'guided' && helpFaded;
  const helpMode: TodayPracticeMode = faded ? 'independent' : mode;
  const goBack = useCallback(() => router.push(returnHref), [returnHref, router]);
  const explanationKey = () => (planDateRef.current ? todayExplanationKey(getStudentId(), planDateRef.current) : null);

  // 1. Find the step in today's plan.
  useEffect(() => {
    const abort = new AbortController();
    fetchTodayPlan(subject, year, abort.signal)
      .then(plan => {
        planDateRef.current = plan.date;
        const found = findTodayTask(plan, taskId);
        if (!found) {
          setPhase('missing');
          return;
        }
        setTask(found);
        const stage = todayMistakeStage(found);
        setStep({
          kind: found.kind,
          title: found.title,
          mode: todayPracticeMode(found),
          goal: found.success_criterion ?? null,
          questionId: found.question_id ?? null,
          stage,
        });
        // The student does the steps in any order; the final check is last.
        if (found.locked) {
          setPhase('locked');
          return;
        }
        const first = firstTodayTopic(found);
        if (found.completed || !first) {
          setPhase('done');
          return;
        }
        setCap(Math.max(1, found.question_target - found.question_completed));
        setTopic(first);
        if (stage === 'cause') {
          // The cause step has no question. Its mistake loads below.
          setPhase('cause');
        } else if ((found.kind === 'focus' || found.kind === 'extra') && found.learn_step) {
          setPhase('learn');
        } else {
          setQuestionRequest({ topic: first, exclude: null, serial: 0 });
        }
      })
      .catch(error => {
        if (error instanceof Error && error.name === 'AbortError') return;
        setMessage('Check the connection and try again. Your saved work has not changed.');
        setPhase('error');
      });
    return () => abort.abort();
  }, [subject, taskId, year]);

  // 1b. A past-mistake step shows the student's answer and earlier plan from the Error Book.
  const mistakeQuestionId = step?.stage && step.stage !== 'retry' ? step.questionId : null;
  const mistakeTopicId = task?.topic_id ?? topic;
  useEffect(() => {
    if (!mistakeQuestionId) return;
    let active = true;
    const causeStep = step?.stage === 'cause';
    fetchMistakes({
      subject,
      topic_id: mistakeTopicId || undefined,
      status: 'active',
      limit: 100,
      yearLevel: scope.yearLevel,
      unit: scope.unit,
      syllabusSubject: scope.syllabusSubject,
    })
      .then(data => {
        if (!active) return;
        const row = data?.mistakes?.find(item => item.question_id === mistakeQuestionId) ?? null;
        setMistake(row);
        if (!row && causeStep) {
          setMessage('This mistake is not open any more. Go back to Today’s Study for the next step.');
          setPhase('error');
        }
      })
      .catch(() => {
        if (!active || !causeStep) return;
        setMessage('Could not load this mistake. Check the connection and try again.');
        setPhase('error');
      });
    return () => { active = false; };
  }, [mistakeQuestionId, mistakeTopicId, scope, step?.stage, subject]);

  // 2. Help for the topic: a lesson and a worked example. The final check and the cause step have no help.
  useEffect(() => {
    if (!topic || !step || step.mode === 'check' || step.stage === 'cause') return;
    let active = true;
    setHelpLoading(true);
    setLesson(null);
    setWorkedExample(null);
    Promise.allSettled([tutorExplain(topic), fetchTopicWorkedExample(topic)]).then(([lessonResult, exampleResult]) => {
      if (!active) return;
      setLesson(lessonResult.status === 'fulfilled' ? lessonResult.value : null);
      setWorkedExample(exampleResult.status === 'fulfilled' ? exampleResult.value : null);
      setHelpLoading(false);
    });
    return () => { active = false; };
  }, [step, topic]);

  // 3. Load one question. A retry asks the same question again; a transfer step asks a new one on the same idea.
  useEffect(() => {
    const current = taskRef.current;
    if (!questionRequest || !current) return;
    let active = true;
    const generation = ++generationRef.current;
    setPhase('loading');
    setQuestion(null);
    setAnswer('');
    setMarkResponse(null);
    setMisses(0);
    setRevealed(false);
    setRevealedAnswer(null);
    setRevealedSteps(null);
    setAttempted(false);
    setMultiPartResults([]);
    setActivePart(null);
    setHelpOpen(false);
    setChat([]);
    setSuggestedActions([]);
    setIsExplaining(false);
    setConfidence(null);
    setSubmittedConfidence(null);
    setExplanation(null);
    setExplanationText('');
    resetClosure();
    supportRef.current = 0;
    partAttemptsRef.current.clear();
    partMissRef.current = false;
    markRequestRef.current = null;
    dialogueRequestRef.current = null;

    const stage = todayMistakeStage(current);
    const original = async () => {
      const pool = await fetchExercises(questionRequest.topic, undefined, subject, scope.yearLevel, scope.unit, scope.syllabusSubject);
      const found = pool.find(item => item.id === current.question_id) ?? null;
      if (!found) throw new Error('This question is no longer in the question bank.');
      return found;
    };
    const load = async (): Promise<{ next: Exercise; eligible: boolean }> => {
      if (stage === 'retry' && current.question_id) {
        return { next: await original(), eligible: false };
      }
      if (stage === 'transfer' && current.question_id) {
        const res = await tutorSuggest(questionRequest.topic, 'error_book', current.question_id, undefined, subject, scope.yearLevel, scope.unit);
        const candidate = res?.question ?? null;
        if (candidate && candidate.id !== current.question_id) {
          return { next: candidate, eligible: Boolean(res?.variation_match?.eligible) };
        }
        // No other question on this idea: the same question is practice only.
        return { next: await original(), eligible: false };
      }
      let next: Exercise | null = null;
      let exclude = questionRequest.exclude ?? undefined;
      for (let tries = 0; tries < 6 && !next; tries += 1) {
        const res = await tutorSuggest(questionRequest.topic, 'retrieve', exclude, undefined, subject, scope.yearLevel, scope.unit);
        if (!res?.question) break;
        if (answeredIds.current.has(res.question.id)) exclude = res.question.id;
        else next = res.question;
      }
      if (!next) throw new Error('No new question is left for this topic today.');
      return { next, eligible: false };
    };

    load()
      .then(({ next, eligible }) => {
        if (!active || generation !== generationRef.current) return;
        transferEligibleRef.current = eligible;
        setQuestion(next);
        setAnnouncement('A new question is ready.');
        setPhase('answer');
      })
      .catch(error => {
        if (!active || generation !== generationRef.current) return;
        setMessage(error instanceof Error && error.message ? error.message : 'Could not load the next question.');
        setPhase('error');
      });
    return () => { active = false; };
  }, [questionRequest, resetClosure, scope, subject]);

  // Help opens next to the question on a wide screen; on a narrow screen it scrolls into view.
  useEffect(() => {
    if (!helpOpen) return;
    const panel = helpRef.current;
    if (!panel) return;
    if (window.matchMedia?.(WIDE_LAYOUT)?.matches) panel.querySelector('textarea')?.focus({ preventScroll: true });
    else panel.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [helpOpen]);

  const checkPlan = useCallback(async (): Promise<TodayStudyTask | null> => {
    try {
      const plan = await fetchTodayPlan(subject, year);
      const fresh = findTodayTask(plan, taskId);
      if (fresh) {
        setTask(fresh);
        setStepComplete(fresh.completed);
      }
      return fresh;
    } catch {
      return null;
    }
  }, [subject, taskId, year]);

  const recordSupport = (level: SupportLevel) => {
    supportRef.current = Math.max(supportRef.current, level) as SupportLevel;
  };

  const flushStars = () => {
    const pending = starsRef.current;
    if (pending.total > 0) showToast(`+${pending.total}⭐  (balance ${pending.stars ?? '—'} · Lv.${pending.level ?? '?'})`, 'success');
    starsRef.current = { total: 0 };
  };

  const addStars = (res: TutorMarkResponse, multiPart: boolean) => {
    const award = res.quest_award;
    if (!award || !(award.awarded > 0)) return;
    if (!multiPart) {
      showToast(`+${award.awarded}⭐  (balance ${award.stars ?? '—'} · Lv.${award.level ?? '?'})`, 'success');
      return;
    }
    starsRef.current = { total: starsRef.current.total + award.awarded, stars: award.stars, level: award.level };
  };

  const countQuestion = (questionId: string) => {
    if (countedIds.current.has(questionId)) return;
    countedIds.current.add(questionId);
    answeredIds.current.add(questionId);
    setAnsweredCount(value => value + 1);
    planCheckRef.current = checkPlan();
  };

  const submit = async (gaveUp = false) => {
    const current = question;
    const currentTask = taskRef.current;
    if (!current || !currentTask || submitting || !step) return;
    const multiPart = current.question_type === 'multi_part';
    const anyPartAnswered = multiPartResults.some(part => Boolean(part.student_answer?.trim()));
    let submitAnswer = gaveUp ? '' : answer;
    let partLabel = '';
    if (!gaveUp && multiPart) {
      const parts = current.sub_parts ?? [];
      const chosen = activePart ? parts.find(part => norm(part.label) === activePart) : undefined;
      const chosenDone = chosen && multiPartResults.find(result => norm(result.label) === activePart)?.is_correct;
      const target = (chosen && !chosenDone ? chosen : undefined)
        ?? parts.find(part => !multiPartResults.find(result => norm(result.label) === norm(part.label))?.student_answer)
        ?? parts.find(part => multiPartResults.find(result => norm(result.label) === norm(part.label))?.is_correct === false);
      if (!target || !answer.trim()) return;
      partLabel = norm(target.label);
      submitAnswer = JSON.stringify({ [partLabel]: answer.trim() });
    } else if (!gaveUp && !answer.trim()) {
      return;
    }

    const partTries = partLabel ? (partAttemptsRef.current.get(partLabel) ?? 0) : 0;
    const firstTry = multiPart
      ? (gaveUp ? !anyPartAnswered : !partMissRef.current && partTries === 0)
      : !attempted;
    // A miss on the last try shows the right answer, so ask the server for it.
    // A multi-part final check asks only on its last open part.
    const openParts = (current.sub_parts ?? []).filter(part => !multiPartResults.find(result => norm(result.label) === norm(part.label))?.student_answer).length;
    const lastTry = step.mode === 'check'
      ? !multiPart || openParts <= 1
      : misses >= 1;
    const transfer = step.stage === 'transfer' && Boolean(currentTask.question_id);
    const sentConfidence = gaveUp ? null : confidence;
    const key = `${current.id}|${gaveUp ? '[dont-know]' : submitAnswer}`;
    const request = markRequestRef.current?.key === key ? markRequestRef.current : { key, requestId: newRequestId('today-mark') };
    markRequestRef.current = request;
    const generation = generationRef.current;
    setSubmitting(true);
    try {
      const res = await tutorMark(current.id, submitAnswer, undefined, {
        requestId: request.requestId,
        todayTaskId: currentTask.id,
        isRevision: currentTask.kind === 'revision' || transfer,
        ...(transfer ? { reviewSource: 'error_book', reviewQuestionId: currentTask.question_id ?? undefined } : {}),
        supportLevel: supportRef.current,
        guidedPhase: step.mode === 'guided' ? (helpFaded ? 'fading' : 'guided') : 'independent',
        firstAttempt: multiPart && !gaveUp ? !anyPartAnswered : firstTry,
        rootFirstAttempt: multiPart && !gaveUp ? firstTry : undefined,
        correctionCompleted: misses > 0,
        ...(sentConfidence ? { confidence: sentConfidence } : {}),
        ...(gaveUp ? { gaveUp: true } : {}),
        ...(!gaveUp && lastTry ? { revealAnswer: true } : {}),
      });
      if (generation !== generationRef.current) return;
      handleResult(current, res, gaveUp, partLabel, firstTry, sentConfidence);
      if (transfer && !gaveUp && res.retryable !== true) {
        const cleanFirstTry = multiPart ? !partMissRef.current : firstTry;
        // A guessed right answer is practice, not evidence.
        const fair = cleanFirstTry && supportRef.current === 0 && transferEligibleRef.current && sentConfidence !== 'guess';
        advanceClosure(currentTask, topic, res, fair);
      }
    } catch {
      if (generation === generationRef.current) {
        showToast('Could not check your answer. Check the connection and try again.', 'error');
      }
    } finally {
      if (generation === generationRef.current) setSubmitting(false);
    }
  };

  const handleResult = (
    current: Exercise,
    res: TutorMarkResponse,
    gaveUp: boolean,
    partLabel: string,
    firstTry: boolean,
    sentConfidence: AnswerConfidence | null,
  ) => {
    const multiPart = current.question_type === 'multi_part';
    if (res.retryable !== true) markRequestRef.current = null;
    if (res.retryable === true) {
      // No verdict: keep the answer so the student can send it again.
      setAnnouncement('Your answer could not be checked. Send it again.');
      setMarkResponse(res);
      setPhase('feedback');
      return;
    }
    addStars(res, multiPart && !gaveUp);
    setAttempted(true);
    setSubmittedConfidence(sentConfidence);
    const parts = res.part_results ?? multiPartResults;
    if (res.part_results) setMultiPartResults(res.part_results);
    const pending = res.outcome === 'pending' || res.error_type === 'parent_review_pending';

    let view = res;
    let miss: boolean;
    let questionDone: boolean;
    let questionCorrect: boolean;
    if (gaveUp) {
      // "I don't know" is not an error pattern and has no answer to review.
      view = { ...res, error_type: null, misconception_id: null, misconception_explanation: null, next_step: null, deterministic: false };
      miss = true;
      questionDone = true;
      questionCorrect = false;
    } else if (multiPart) {
      partAttemptsRef.current.set(partLabel, (partAttemptsRef.current.get(partLabel) ?? 0) + 1);
      const part = parts.find(item => norm(item.label) === partLabel);
      const partPending = part?.outcome === 'pending' || part?.error_type === 'parent_review_pending';
      view = {
        ...res,
        is_correct: Boolean(part?.is_correct),
        outcome: part?.outcome ?? (part?.is_correct ? 'correct' : partPending ? 'pending' : 'incorrect'),
        error_type: part?.error_type ?? null,
        feedback: part?.feedback?.trim()
          || (part?.is_correct ? `Part (${partLabel.toUpperCase()}) is correct.` : `Part (${partLabel.toUpperCase()}) is not right yet.`),
      };
      miss = Boolean(part && !part.is_correct && !partPending && part.outcome !== 'unanswered');
      const outcome = getMultiPartSessionOutcome(parts);
      questionDone = outcome.ready;
      questionCorrect = outcome.isCorrect;
      const resultFor = (label: unknown) => parts.find(result => norm(result.label) === norm(label));
      const subParts = current.sub_parts ?? [];
      // The final check moves on to the next unanswered part. Other modes retry a
      // wrong part once, else go to the first part that is not right yet.
      const nextPart = step?.mode === 'check'
        ? subParts.find(item => !resultFor(item.label)?.student_answer)
        : miss
          ? subParts.find(item => norm(item.label) === partLabel)
          : subParts.find(item => resultFor(item.label)?.is_correct !== true);
      if (nextPart) setActivePart(norm(nextPart.label));
    } else {
      miss = !pending && !res.is_correct;
      questionDone = true;
      questionCorrect = !pending && res.is_correct;
    }

    const missCount = miss ? misses + 1 : misses;
    if (miss) {
      setMisses(missCount);
      if (multiPart) partMissRef.current = true;
      // One wrong answer is not a pattern. Show the feedback text only.
      if (!pending) view = { ...view, error_type: null };
    }
    const reveal = step?.mode === 'check'
      ? questionDone && !questionCorrect && !pending
      : gaveUp || missCount >= 2;
    if (reveal) {
      setRevealed(true);
      setRevealedAnswer(res.correct_answer ?? null);
      setRevealedSteps(res.solution_steps ?? null);
    }
    if (questionDone || reveal) {
      if (multiPart) flushStars();
      countQuestion(current.id);
      if (mode === 'guided') {
        const clean = questionCorrect && !reveal && supportRef.current === 0 && sentConfidence !== 'guess'
          && (multiPart ? !partMissRef.current : firstTry);
        firstTryStreakRef.current = clean ? firstTryStreakRef.current + 1 : 0;
        if (firstTryStreakRef.current >= TODAY_HELP_FADE_AFTER) setHelpFaded(true);
      }
      // One sentence after a corrected or guessed right answer, a few times a day.
      const explanationStore = explanationKey();
      if (
        questionDone && questionCorrect && !reveal && mode !== 'check'
        && (missCount > 0 || sentConfidence === 'guess')
        && explanationStore && todayExplanationsUsed(explanationStore) < TODAY_EXPLANATIONS_PER_DAY
      ) {
        setExplanation({ questionId: current.id, attemptId: res.attempt_id, status: 'due' });
        setExplanationText('');
      }
    }
    setAnnouncement(
      pending ? 'Your answer is saved for review.'
        : view.is_correct ? 'Correct.'
          : reveal ? 'Not right. The right answer is shown.'
            : step?.mode === 'check' ? 'Not right.' : 'Not right yet. Try again.',
    );
    setMarkResponse(view);
    setPhase('feedback');
  };

  const saveExplanation = async () => {
    if (!explanation || !hasMinimumSelfExplanation(explanationText)) return;
    setExplanation({ ...explanation, status: 'saving' });
    try {
      await updateTutorAttemptMetadata(explanation.questionId, explanation.attemptId, explanationText);
      const store = explanationKey();
      if (store) noteTodayExplanation(store);
      setExplanation({ ...explanation, status: 'saved' });
      setAnnouncement('Your sentence is saved.');
    } catch {
      // Saving must not block the next question.
      setExplanation({ ...explanation, status: 'failed' });
    }
  };

  const saveCause = async (cause: ErrorCauseCode, plan: string) => {
    const currentTask = taskRef.current;
    if (!currentTask?.question_id || causeSaving) return;
    setCauseSaving(true);
    setCauseError(null);
    try {
      await recordMistakeCause({
        subject,
        question_id: currentTask.question_id,
        topic_id: currentTask.topic_id || topic,
        error_cause: cause,
        ifThenStrategy: plan.trim() || undefined,
        yearLevel: scope.yearLevel,
        unit: scope.unit,
        syllabusSubject: scope.syllabusSubject,
      });
      goBack();
    } catch {
      setCauseError('Could not save. Check the connection and try again.');
    } finally {
      setCauseSaving(false);
    }
  };

  const tryAgain = () => {
    if (markResponse?.retryable === true) {
      setMarkResponse(null);
      setPhase('answer');
      return;
    }
    if (revealed || mode === 'check') return;
    setAnswer('');
    setConfidence(null);
    setMarkResponse(null);
    setIsExplaining(false);
    setSuggestedActions([]);
    setAnnouncement('Try the question again.');
    setPhase('answer');
  };

  const continuePart = () => {
    setAnswer('');
    setMarkResponse(null);
    setIsExplaining(false);
    setSuggestedActions([]);
    setAnnouncement('Answer the next part.');
    setPhase('answer');
  };

  const next = async () => {
    const current = question;
    if (!current || checkingPlan) return;
    flushStars();
    setCheckingPlan(true);
    if (!(await retryPending())) {
      showToast('Could not save the Error Book step. The mistake stays open.', 'error');
    }
    const fresh = await (planCheckRef.current ?? checkPlan());
    planCheckRef.current = null;
    setCheckingPlan(false);
    if (fresh?.completed || answeredCount >= cap) {
      goBack();
      return;
    }
    const latest = fresh ?? taskRef.current;
    const nextTopic = latest ? nextTodayTopic(latest, topic) : null;
    if (!nextTopic) {
      goBack();
      return;
    }
    setTopic(nextTopic);
    setQuestionRequest({ topic: nextTopic, exclude: current.id, serial: Date.now() });
  };

  const openHelp = () => {
    if (!todayHelpAvailable(helpMode, attempted)) return;
    setHelpOpen(true);
  };

  const explainMyAnswer = () => {
    if (!todayHelpAvailable(helpMode, true)) return;
    recordSupport(2);
    setHelpOpen(true);
    if (isExplaining) return;
    setIsExplaining(true);
    setChat(prev => [...prev, { role: 'system', content: 'Write your working step by step in the chat. The tutor helps you find the mistake.' }]);
  };

  const showWorkedExample = () => {
    if (!todayHelpAvailable(helpMode, true)) return;
    recordSupport(3);
    setHelpOpen(true);
    setExampleToken(value => value + 1);
  };

  const sendMessage = async (text: string) => {
    const current = question;
    if (!current || dialogueLoading || !todayHelpAvailable(helpMode, attempted)) return;
    recordSupport(2);
    const generation = generationRef.current;
    const toSend = isExplaining ? `[EXPLAINING] ${text}` : text;
    if (isExplaining) setIsExplaining(false);
    setChat(prev => [...prev, { role: 'student', content: stripPrefix(toSend) }]);
    setDialogueLoading(true);
    const key = `${current.id}|${toSend}`;
    const request = dialogueRequestRef.current?.key === key ? dialogueRequestRef.current : { key, requestId: newRequestId('today-dialogue') };
    dialogueRequestRef.current = request;
    try {
      const res = await tutorDialogue(current.id, toSend, undefined, request.requestId);
      if (generation !== generationRef.current) return;
      dialogueRequestRef.current = null;
      setChat(prev => [...prev, { role: 'tutor', content: res.tutor_message || 'Let us look at this together.' }]);
      setSuggestedActions((res.suggested_actions || []).filter(action => HELP_ACTIONS.has(action)));
    } catch {
      if (generation === generationRef.current) showToast('The tutor chat is not available now. Try again soon.', 'error');
    } finally {
      if (generation === generationRef.current) setDialogueLoading(false);
    }
  };

  const handleSuggestedAction = (action: string) => {
    setSuggestedActions([]);
    if (action === 'show_worked_example') showWorkedExample();
    else if (action === 'try_again' && phase === 'feedback') tryAgain();
    else if (action === 'explain_my_answer') explainMyAnswer();
    else if (action === 'mark_final_answer' && phase === 'answer') void submit();
  };

  const startPractising = () => {
    if (!topic) return;
    setQuestionRequest({ topic, exclude: null, serial: Date.now() });
  };

  // A typed answer is not saved yet. Warn before the page closes.
  const hasDraft = phase === 'answer' && Boolean(answer.trim());
  useEffect(() => {
    if (!hasDraft) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDraft]);

  const currentTopicName = topicName(task, topic);
  const helpAllowed = todayHelpAvailable(helpMode, attempted) && phase !== 'learn' && Boolean(question);
  const showHelp = helpAllowed && helpOpen && (phase === 'answer' || phase === 'feedback');
  const multiPartRemaining = question?.question_type === 'multi_part' && !revealed
    ? (question.sub_parts ?? []).some(part => multiPartResults.find(result => norm(result.label) === norm(part.label))?.is_correct !== true)
    : false;
  const lastVerdictMiss = Boolean(markResponse && markResponse.retryable !== true && !markResponse.is_correct
    && markResponse.outcome !== 'pending' && markResponse.error_type !== 'parent_review_pending');
  const needsRetry = phase === 'feedback' && lastVerdictMiss && !revealed && mode !== 'check'
    && !(question?.question_type === 'multi_part' && !multiPartRemaining);
  const nextLabel = stepComplete || answeredCount >= cap ? 'Back to Today’s Study' : 'Next question';
  const explanationBlocksNext = explanation?.status === 'due' || explanation?.status === 'saving';
  const confidenceText = markResponse && markResponse.retryable !== true && markResponse.outcome !== 'pending'
    ? todayConfidenceNote(submittedConfidence, Boolean(markResponse.is_correct))
    : null;

  const body = (() => {
    if (phase === 'missing') {
      return <TodayStepNotice title="This step is not in today’s plan." message="Go back to Today’s Study to see what is next." onBack={goBack} />;
    }
    if (phase === 'locked') {
      return <TodayStepNotice title="The final check opens after the other steps." message="Do the other steps first, in any order. Then come back for the final check." onBack={goBack} />;
    }
    if (phase === 'done') {
      return <TodayStepNotice title="This step is done." message="Go back to Today’s Study for the next step." onBack={goBack} />;
    }
    if (phase === 'error') {
      return (
        <TodayStepNotice
          title={step?.stage === 'cause' ? 'This step could not load.' : 'This question could not load.'}
          message={message}
          onBack={goBack}
          onRetry={step && topic && step.stage !== 'cause' ? () => setQuestionRequest({ topic, exclude: question?.id ?? null, serial: Date.now() }) : undefined}
        />
      );
    }
    if (phase === 'cause') {
      return mistake
        ? <TodayCauseStep mistake={mistake} subject={subject} saving={causeSaving} error={causeError} onSave={(cause, plan) => void saveCause(cause, plan)} />
        : <div className="glass-panel" role="status" style={{ padding: '28px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading the mistake…</div>;
    }
    if (phase === 'loading' || !step) {
      return <div className="glass-panel" role="status" style={{ padding: '28px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading the question…</div>;
    }
    if (phase === 'learn') {
      return (
        <TodayLearnStep
          goal={step.goal}
          topicName={currentTopicName}
          lesson={lesson}
          workedExample={workedExample}
          loading={helpLoading}
          onStart={startPractising}
        />
      );
    }
    if (!question) return null;
    return (
      <>
        {phase === 'answer' && (
          <GuidedQuestionCard
            exercise={question}
            answer={answer}
            onSetAnswer={setAnswer}
            onSubmit={() => void submit()}
            onDontKnow={() => void submit(true)}
            onNeedHelp={helpAllowed && !helpOpen ? openHelp : undefined}
            submitting={submitting}
            multiPartResults={multiPartResults}
            activeMultipartLabel={activePart}
            onSetActivePart={setActivePart}
            subjectColor={subjectColor}
            showMathToolbar={isMathSubject(subject)}
            roomyAnswer
            beforeActions={<TodayConfidencePicker value={confidence} onChange={setConfidence} disabled={submitting} />}
          />
        )}
        {phase === 'feedback' && markResponse && (
          <GuidedFeedbackCard
            markResponse={markResponse}
            exercise={question}
            studentAnswer={answer}
            onNext={() => void next()}
            onExplainMyAnswer={explainMyAnswer}
            onTryAgain={tryAgain}
            onShowWorkedExample={mode === 'check' ? undefined : showWorkedExample}
            isLastQuestion={false}
            subjectColor={subjectColor}
            partialSuccessLabel={markResponse.is_correct
              ? { label: 'Correct!', tone: 'excellent' }
              : { label: '', tone: 'needs_work' }}
            isMultiPart={question.question_type === 'multi_part'}
            multiPartHasRemaining={multiPartRemaining}
            onContinuePart={continuePart}
            requiresCorrection={needsRetry}
            // Today has one way to get help ("Need help?"), so the card shows no help actions.
            independentPhase
            allowRetry={!revealed && mode !== 'check'}
            nextLabel={checkingPlan ? 'Checking…' : nextLabel}
            nextDisabled={explanationBlocksNext}
            correctionNote="Try once more. You can use help now."
          >
            {confidenceText && <p className="today-practice__note">{confidenceText}</p>}
            {step.stage === 'transfer' && closure !== 'idle' && (
              <p role="status" className={`today-practice__note${closure === 'moved' || closure === 'closed' ? ' today-practice__note--good' : ''}`}>
                {TODAY_CLOSURE_NOTES[closure]}
              </p>
            )}
            {revealed && (
              <TodayAnswerReveal answer={revealedAnswer} steps={revealedSteps} workedExample={mode === 'check' ? null : workedExample} />
            )}
            {explanation && explanation.status !== 'saved' && (
              <TodaySelfExplanation
                value={explanationText}
                onChange={setExplanationText}
                onSave={() => void saveExplanation()}
                saving={explanation.status === 'saving'}
                error={explanation.status === 'failed' ? 'Could not save your sentence. You can go on.' : null}
              />
            )}
            {explanation?.status === 'saved' && <p className="today-practice__note today-practice__note--good">✓ Your sentence is saved.</p>}
            {/* While the student answers, this button is next to "I don't know" in the question card. */}
            {helpAllowed && !helpOpen && (
              <button type="button" className="btn-secondary" onClick={openHelp} style={{ alignSelf: 'flex-start', minHeight: '44px' }}>
                Need help?
              </button>
            )}
          </GuidedFeedbackCard>
        )}
      </>
    );
  })();

  return (
    <div className={`today-practice${showHelp ? ' today-practice--help' : ''}`}>
      <TodaySessionBar subject={subject} year={year} activeTaskId={taskId} refreshTrigger={answeredCount} />
      {/* The session bar names the step. The page names the topic and the help rule. */}
      <header className="today-practice__heading">
        <h1>{currentTopicName || step?.title || 'Today’s Study'}</h1>
        {step && <p>{step.stage === 'cause' ? 'Find the cause, then make a plan for next time.' : todayModeHint(mode, faded)}</p>}
      </header>
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
      <div className="today-practice__body">
        <div className="today-practice__main">{body}</div>
        {showHelp && (
          <aside ref={helpRef} aria-label="Help" className="today-practice__help">
            <GuidedHelpDrawer
              lessonContent={lesson}
              workedExample={workedExample}
              chatHistory={chat}
              onSendMessage={text => void sendMessage(text)}
              suggestedActions={suggestedActions}
              onSuggestedAction={handleSuggestedAction}
              dialogueLoading={dialogueLoading}
              helpChips={adapter.helpChips}
              subjectColor={subjectColor}
              hasAttempted={attempted}
              isExplaining={isExplaining}
              exampleOpenToken={exampleToken}
              onSupportUsed={recordSupport}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
