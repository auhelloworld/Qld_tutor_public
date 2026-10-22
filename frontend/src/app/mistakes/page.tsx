'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyticsScopeFromYear,
  fetchCurriculum,
  fetchErrorTaxonomy,
  fetchMistakes,
  fetchTrapNotebook,
  resolveMistakeReview,
  recordMistakeCause,
  tutorMark,
  tutorSuggest,
  updateTutorAttemptMetadata,
  syllabusSubjectFromPickerSubject,
  type MistakeQueryOptions,
  type MistakeResolveOptions,
} from '../../lib/api';
import { getSubject, getYear } from '../../lib/preferences';
import { getStudentId } from '../../lib/student_id';
import Link from 'next/link';
import MathMarkdown from '../../components/MathMarkdown';
import QuestionContext from '../../components/QuestionContext';
import FrameworkSubjectYearPicker from '../../components/FrameworkSubjectYearPicker';
import BackToPracticeLink from '../../components/BackToPracticeLink';
import MathSymbolKeyboard from '../../components/MathSymbolKeyboard';
import { formatTimeAgo, humanise, formatStudentAnswer } from '../../lib/format';
import { buildPracticeHref, scopedSubjectFromSearchParams, scopedYearFromSearchParams } from '../../lib/scoped_navigation';
import { ERROR_TYPE_LABELS, getErrorCauseOptions, type ErrorCauseCode } from '../../lib/constants';
import type { Mistake, MistakeSummary, Curriculum, TrapNotebookEntry, TutorMarkResponse, ErrorTaxonomyEntry } from '../../lib/api-types';
import { isMathSubject } from '../../lib/subject_registry';
import { getTopicDisplayName } from '../../lib/curriculum_helpers';
import { hasMinimumSelfExplanation } from '../../lib/metacognition';
import { showToast } from '../../lib/toast';

function newMutationRequestId(prefix: string): string {
  const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomUuid}`;
}

const PAGE_SIZE = 50;
const EMPTY_MISTAKE_SUMMARY: MistakeSummary = {
  total: 0,
  active: 0,
  resolved: 0,
  closed: 0,
  dismissed: 0,
  reviews: 0,
  topic_counts: {},
  error_type_counts: {},
  topic_progress: {},
};

function summariseLoadedMistakes(items: Mistake[]): MistakeSummary {
  const topicProgress: MistakeSummary['topic_progress'] = {};
  const errorTypeCounts: Record<string, number> = {};
  let resolved = 0;
  let closed = 0;
  let dismissed = 0;
  let reviews = 0;
  for (const item of items) {
    const isClosed = item.closure_stage === 'closed'
      || (Boolean(item.resolved) && item.resolution_source === 'demonstrated_correction');
    const isDismissed = item.closure_stage === 'dismissed'
      || item.status === 'dismissed'
      || (Boolean(item.resolved) && item.resolution_source === 'manual_dismissal');
    const isResolved = isClosed || isDismissed || Boolean(item.resolved)
      || ['resolved', 'corrected'].includes(item.status || '');
    resolved += Number(isResolved);
    closed += Number(isClosed);
    dismissed += Number(isDismissed);
    reviews += item.review_count ?? 0;
    const topic = topicProgress[item.topic_id] ?? { total: 0, overcome: 0, reviews: 0 };
    topic.total += 1;
    topic.overcome += Number(isClosed);
    topic.reviews += item.review_count ?? 0;
    topicProgress[item.topic_id] = topic;
    const errorCode = item.error_type || 'unknown';
    errorTypeCounts[errorCode] = (errorTypeCounts[errorCode] || 0) + 1;
  }
  return {
    total: items.length,
    active: items.length - resolved,
    resolved,
    closed,
    dismissed,
    reviews,
    topic_counts: Object.fromEntries(Object.entries(topicProgress).map(([topic, value]) => [topic, value.total])),
    error_type_counts: errorTypeCounts,
    topic_progress: topicProgress,
  };
}
/** One active mistake is enough to start a focused transfer review. */
const MIN_QUIZ_SIZE = 1;
/** Cap quiz length so sessions stay short for a single student. */
const MAX_QUIZ_SIZE = 5;

const CLOSURE_STAGE_LABELS: Record<string, string> = {
  needs_understanding: '1 · Understand the error',
  needs_retry: '2 · Redo independently',
  needs_transfer: '3 · Prove it on a new question',
  needs_consolidation: '4 · Spaced consolidation',
  closed: '5 · Closed with evidence',
  dismissed: 'Dismissed without mastery evidence',
};

/** True when a correct answer on a fresh question can advance this mistake. */
function isQuizStageReady(mistake: Mistake, now = Date.now()): boolean {
  if (mistake.closure_stage === 'needs_transfer') return true;
  if (mistake.closure_stage !== 'needs_consolidation') return false;
  const dueAt = mistake.consolidation_due_at ? Date.parse(mistake.consolidation_due_at) : NaN;
  return !Number.isFinite(dueAt) || dueAt <= now;
}

/** Why a correct quiz answer counted as practice only. */
function quizPracticeOnlyReason(stage: Mistake['closure_stage']): string {
  if (stage === 'needs_understanding') {
    return 'First identify why the original answer was wrong; this practice answer does not advance the Error Book stage.';
  }
  if (stage === 'needs_retry') {
    return 'First redo the original question independently; this transfer attempt does not advance the Error Book stage.';
  }
  if (stage === 'needs_consolidation') {
    return 'The spaced consolidation check is not due yet; this answer counts as practice but does not close the mistake.';
  }
  return 'This was not an eligible fresh transfer question, so the correct answer counts as practice but does not advance the Error Book stage.';
}

export type MistakeQuizResult = {
  question_id: string;
  is_correct: boolean;
  outcome: NonNullable<TutorMarkResponse['outcome']>;
  resolution_eligible: boolean;
  /** Set when a correct answer did not advance the stage. */
  practice_reason?: string;
  student_answer: string;
  correct_answer: string;
  question: string;
};

export function isMistakeQuizAnswerComplete(
  question: Mistake | undefined,
  answer: string,
  multiPartAnswers: Record<string, string>,
): boolean {
  if (!question) return false;
  if (question.question_type !== 'multi_part') return Boolean(answer.trim());
  const parts = question.sub_parts || [];
  return parts.length > 0 && parts.every((part, index) => {
    const label = String(part.label || String.fromCharCode(97 + index)).trim().toLowerCase();
    return Boolean(multiPartAnswers[label]?.trim());
  });
}

function mistakeQuizPartLabel(label: string | undefined, index: number): string {
  return String(label || String.fromCharCode(97 + index)).trim().toLowerCase();
}

function mistakeQuizPartChoiceValue(
  part: NonNullable<Mistake['sub_parts']>[number],
  choice: string,
  choiceIndex: number,
): string {
  const authoredKey = String(part.correct_choice || part.answer || '').trim().toUpperCase();
  return /^[A-Z]$/.test(authoredKey) ? String.fromCharCode(65 + choiceIndex) : choice;
}

export function mistakeQuizSummary(results: MistakeQuizResult[]) {
  return {
    correct: results.filter(result => result.outcome === 'correct' && result.is_correct).length,
    resolved: results.filter(result => result.outcome === 'correct' && result.is_correct && result.resolution_eligible).length,
    pending: results.filter(result => result.outcome === 'pending').length,
  };
}

// Error-type labels are the shared fallback (lib/constants.ts, synced with
// data/error_taxonomy*.json); the subject-specific taxonomy fetched at runtime
// overrides them. Single source of truth — no local duplicate (Audit EB4).
const ERROR_TYPE_OPTIONS = Object.keys(ERROR_TYPE_LABELS);

export function resolvedMistakesStorageKey(studentId: string, subject: string, yearOrUnit: string): string {
  return `qld_tutor_resolved_mistakes:${studentId}:${subject}:${yearOrUnit}`;
}

function readLocalResolvedIds(storageKey: string): Set<string> {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  } catch {
    return new Set();
  }
}

function persistLocalResolvedIds(storageKey: string, ids: Set<string>) {
  localStorage.setItem(storageKey, JSON.stringify(Array.from(ids)));
}

export default function MistakesPage() {
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [pickerValue, setPickerValue] = useState({ subject: 'math', year: 'year7' });
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [notebookEntries, setNotebookEntries] = useState<TrapNotebookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [mistakesError, setMistakesError] = useState<string | null>(null);
  const [scopeReady, setScopeReady] = useState(false);
  const [notebookLoading, setNotebookLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'topic' | 'recent' | 'error_type'>('topic');
  const [sortBy, setSortBy] = useState<'recent' | 'mastery'>('recent');
  const [topicFilter, setTopicFilter] = useState('');
  const [errorFilter, setErrorFilter] = useState('');
  const [mistakesTotal, setMistakesTotal] = useState(0);
  const [mistakeSummary, setMistakeSummary] = useState<MistakeSummary>(EMPTY_MISTAKE_SUMMARY);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [showResolvedMode, setShowResolvedMode] = useState<boolean>(false);
  const [errorTaxonomy, setErrorTaxonomy] = useState<ErrorTaxonomyEntry[]>([]);

  // Quiz Mode state
  // A quiz item is a mistake, optionally displayed/marked as a *variation* of the
  // original question (_markId points at the variation). Resolution stays keyed to
  // the original mistake (question_id/topic_id) so redo tests transfer, not recall.
  type QuizItem = Mistake & {
    _markId?: string;
    _isVariation?: boolean;
    _resolutionEligible?: boolean;
  };
  const [quizQuestions, setQuizQuestions] = useState<QuizItem[]>([]);
  const [currentQuizIndex, setCurrentQuizIndex] = useState(0);
  const [quizAnswer, setQuizAnswer] = useState('');
  const [quizMultiPartAnswers, setQuizMultiPartAnswers] = useState<Record<string, string>>({});
  const [quizResults, setQuizResults] = useState<MistakeQuizResult[]>([]);
  const [quizStep, setQuizStep] = useState<'idle' | 'question' | 'feedback' | 'summary'>('idle');
  const [isSubmittingQuizQuestion, setIsSubmittingQuizQuestion] = useState(false);
  const [isFinishingQuiz, setIsFinishingQuiz] = useState(false);
  const finishQuizInFlightRef = useRef(false);
  const quizMarkRequestRef = useRef<{ key: string; requestId: string } | null>(null);
  // Error Book steps that could not be saved right after the answer, by source question.
  const quizPendingClosuresRef = useRef(new Map<string, MistakeResolveOptions>());
  const [quizMarkResult, setQuizMarkResult] = useState<TutorMarkResponse | null>(null);
  const [quizFeedback, setQuizFeedback] = useState('');
  const [quizSelfExplanation, setQuizSelfExplanation] = useState('');
  const [quizSelfExplanationSaving, setQuizSelfExplanationSaving] = useState(false);
  const [quizSelfExplanationSaved, setQuizSelfExplanationSaved] = useState(false);
  const [quizSelfExplanationError, setQuizSelfExplanationError] = useState('');
  // Changes each time the shown quiz question changes, so a late explanation
  // save cannot mark the next question as saved.
  const quizQuestionTokenRef = useRef(0);
  const practiceHref = buildPracticeHref({ subject: pickerValue.subject, year: pickerValue.year });
  const practiceHrefForTopic = (topic: string, question?: string) => buildPracticeHref({
    subject: pickerValue.subject,
    year: pickerValue.year,
    topic,
    question,
  });
  const mistakeScope = useCallback((mistake: Mistake) => {
    const subject = (mistake.subject || pickerValue.subject) as typeof pickerValue.subject;
    const year = mistake.unit
      ? `unit${mistake.unit}`
      : mistake.year_level
        ? `year${mistake.year_level}`
        : pickerValue.year;
    return {
      subject,
      year,
      analyticsScope: mistake.unit
        ? { unit: mistake.unit, syllabusSubject: mistake.syllabus_subject || syllabusSubjectFromPickerSubject(subject) }
        : { yearLevel: mistake.year_level || analyticsScopeFromYear(year).yearLevel, syllabusSubject: syllabusSubjectFromPickerSubject(subject) },
    };
  }, [pickerValue]);
  const practiceHrefForMistake = (mistake: Mistake, question?: string, showAnswer = false) => {
    const scope = mistakeScope(mistake);
    return buildPracticeHref({
      subject: scope.subject,
      year: scope.year,
      topic: mistake.topic_id,
      question,
      showAnswer,
    });
  };

  const [quizLoading, setQuizLoading] = useState(false);

  const activeMistakes = useMemo(
    () => mistakes.filter(mistake => !resolvedIds.has(mistake.question_id)),
    [mistakes, resolvedIds],
  );
  const resolvedMistakes = useMemo(
    () => mistakes.filter(mistake => resolvedIds.has(mistake.question_id)),
    [mistakes, resolvedIds],
  );
  const quizCandidateMistakes = activeMistakes;

  const startQuiz = useCallback(async (override?: Mistake[]) => {
    const active = override ?? quizCandidateMistakes;
    if (active.length < MIN_QUIZ_SIZE || quizLoading) return;
    quizPendingClosuresRef.current.clear();
    // Items that can advance go first, so a short quiz is not all practice.
    const now = Date.now();
    const shuffle = (items: Mistake[]) => [...items].sort(() => 0.5 - Math.random());
    const ordered = [
      ...shuffle(active.filter(m => isQuizStageReady(m, now))),
      ...shuffle(active.filter(m => !isQuizStageReady(m, now))),
    ];
    const quizSize = Math.min(MAX_QUIZ_SIZE, active.length);
    const selected = ordered.slice(0, quizSize);
    setQuizLoading(true);
    try {
      // Fetch a fresh variation per mistake so the redo demonstrates transfer
      // rather than recall of the identical item. Falls back to the original
      // question whenever no different item is available for the topic.
      const items: QuizItem[] = await Promise.all(
        selected.map(async (m): Promise<QuizItem> => {
          try {
            const scope = mistakeScope(m);
            const yearLevel = scope.analyticsScope.yearLevel;
            const unit = scope.analyticsScope.unit;
            const res = await tutorSuggest(
              m.topic_id,
              'error_book',
              m.question_id,
              undefined,
              scope.subject,
              yearLevel,
              unit,
            );
            const v = res?.question;
            if (v && v.id && v.id !== m.question_id) {
              const stageEligible = isQuizStageReady(m);
              return {
                ...m,
                question: v.question,
                passage: v.passage ?? null,
                resolved_passage: v.resolved_passage ?? null,
                diagram_data: v.diagram_data ?? null,
                image: v.image ?? null,
                question_type: (v.question_type as Mistake['question_type']) ?? m.question_type,
                choices: v.choices ?? null,
                sub_parts: v.sub_parts ?? null,
                correct_answer: v.correct_answer ?? v.answer ?? '',
                _markId: v.id,
                _isVariation: true,
                _resolutionEligible: stageEligible && Boolean(res.variation_match?.eligible),
              };
            }
          } catch {
            // Fall back to the original mistake below.
          }
          return { ...m, _resolutionEligible: false };
        }),
      );
      setQuizQuestions(items);
      setCurrentQuizIndex(0);
      quizQuestionTokenRef.current += 1;
      setQuizAnswer('');
      setQuizMultiPartAnswers({});
      setQuizResults([]);
      quizMarkRequestRef.current = null;
      setQuizMarkResult(null);
      setQuizFeedback('');
      setQuizSelfExplanation('');
      setQuizSelfExplanationSaving(false);
      setQuizSelfExplanationSaved(false);
      setQuizSelfExplanationError('');
      setQuizStep('question');
    } finally {
      setQuizLoading(false);
    }
  }, [mistakeScope, quizCandidateMistakes, quizLoading]);

  const submitQuizQuestion = async () => {
    const currentQ = quizQuestions[currentQuizIndex];
    if (!currentQ || isSubmittingQuizQuestion) return;

    if (!isMistakeQuizAnswerComplete(currentQ, quizAnswer, quizMultiPartAnswers)) return;
    const submitAnswer = currentQ.question_type === 'multi_part'
      ? JSON.stringify(quizMultiPartAnswers)
      : quizAnswer.trim();
    const markId = currentQ._markId ?? currentQ.question_id;
    const requestKey = `${markId}|${submitAnswer}`;
    const markRequest = quizMarkRequestRef.current?.key === requestKey
      ? quizMarkRequestRef.current
      : { key: requestKey, requestId: newMutationRequestId('error-book-mark') };
    quizMarkRequestRef.current = markRequest;

    setQuizFeedback('');
    setIsSubmittingQuizQuestion(true);
    try {
      // Reuse the ID after a transport failure so a retry cannot duplicate the
      // revision attempt on the server.
      const res = await tutorMark(
        markId,
        submitAnswer,
        undefined,
        {
          requestId: markRequest.requestId,
          isRevision: true,
          reviewSource: 'error_book',
          reviewQuestionId: currentQ.question_id,
        },
      );
      if (res.retryable === true) {
        setQuizMarkResult(null);
        setQuizFeedback(
          res.feedback || 'Marking is temporarily unavailable. Your answer has not been counted as incorrect. Please retry.',
        );
        return;
      }

      const pending = res.outcome === 'pending'
        || res.error_type === 'parent_review_pending'
        || res.error_type === 'grading_deferred'
        || res.error_type === 'llm_unavailable';
      const displayResult = pending
        ? { ...res, is_correct: false, outcome: 'pending' as const }
        : res;
      setQuizMarkResult(displayResult);

      const outcome: NonNullable<TutorMarkResponse['outcome']> = pending
        ? 'pending'
        : res.outcome || (res.is_correct ? 'correct' : 'incorrect');
      const isCorrect = outcome === 'correct' && res.is_correct;
      const resolutionEligible = Boolean(
        res.review_resolution_eligible && currentQ._resolutionEligible,
      );
      let feedback = pending
        ? (res.feedback || 'This answer is awaiting review and has not been marked incorrect.')
        : (res.feedback || '');
      const practiceReason = isCorrect && !resolutionEligible
        ? quizPracticeOnlyReason(currentQ.closure_stage)
        : undefined;
      if (practiceReason) {
        feedback = [feedback, practiceReason].filter(Boolean).join('\n\n');
      }
      setQuizFeedback(feedback);
      setQuizResults(prev => [
        ...prev,
        {
          question_id: currentQ.question_id,
          is_correct: isCorrect,
          outcome,
          resolution_eligible: resolutionEligible,
          practice_reason: practiceReason,
          student_answer: submitAnswer,
          correct_answer: currentQ.correct_answer,
          question: currentQ.question,
        }
      ]);
      if (isCorrect && resolutionEligible) {
        void saveQuizClosure(currentQ, res.attempt_id || markRequest.requestId);
      }
      if (!pending) quizMarkRequestRef.current = null;
      setQuizStep('feedback');
    } catch {
      // Keep the request ID and the answer in place so Submit Answer retries
      // the same durable mutation instead of creating a second attempt.
      setQuizMarkResult(null);
      setQuizFeedback('Marking is temporarily unavailable. Your answer has not been counted as incorrect. Please retry.');
    } finally {
      setIsSubmittingQuizQuestion(false);
    }
  };

  const saveQuizSelfExplanation = async () => {
    const currentQ = quizQuestions[currentQuizIndex];
    if (!currentQ || !quizMarkResult || !hasMinimumSelfExplanation(quizSelfExplanation)) return;
    const token = quizQuestionTokenRef.current;
    const isCurrent = () => token === quizQuestionTokenRef.current;
    setQuizSelfExplanationSaving(true);
    setQuizSelfExplanationError('');
    try {
      await updateTutorAttemptMetadata(
        currentQ.attempt_id ? currentQ.question_id : (currentQ._markId ?? currentQ.question_id),
        currentQ.attempt_id ?? quizMarkResult.attempt_id,
        quizSelfExplanation,
      );
      if (isCurrent()) setQuizSelfExplanationSaved(true);
    } catch {
      if (isCurrent()) {
        setQuizSelfExplanationError('Could not save your explanation. Please try again.');
      } else {
        showToast('Could not save your explanation for the previous question.', 'error');
      }
    } finally {
      if (isCurrent()) setQuizSelfExplanationSaving(false);
    }
  };

  const nextQuizQuestion = () => {
    quizQuestionTokenRef.current += 1;
    setQuizSelfExplanationSaving(false);
    if (currentQuizIndex < quizQuestions.length - 1) {
      setCurrentQuizIndex(currentQuizIndex + 1);
      quizMarkRequestRef.current = null;
      setQuizAnswer('');
      setQuizMultiPartAnswers({});
      setQuizMarkResult(null);
      setQuizFeedback('');
      setQuizSelfExplanation('');
      setQuizSelfExplanationSaved(false);
      setQuizSelfExplanationError('');
      setQuizStep('question');
    } else {
      setQuizStep('summary');
    }
  };

  /**
   * A qualifying answer moves its mistake on at once, so leaving the quiz
   * cannot lose the step. Each answer has its own request ID: a later spaced
   * check must not replay the transfer request of the same mistake.
   */
  const saveQuizClosure = async (mistake: Mistake, attemptKey: string) => {
    const scope = mistakeScope(mistake);
    const options: MistakeResolveOptions = {
      subject: scope.subject,
      question_id: mistake.question_id,
      topic_id: mistake.topic_id,
      resolved: true,
      resolutionSource: 'demonstrated_correction',
      ...scope.analyticsScope,
      requestId: `error-book-resolve-${attemptKey}`,
    };
    try {
      const closure = await resolveMistakeReview(options);
      quizPendingClosuresRef.current.delete(mistake.question_id);
      updateResolvedState(mistake.question_id, closure.resolved);
    } catch {
      quizPendingClosuresRef.current.set(mistake.question_id, options);
    }
  };

  const finishQuiz = async () => {
    if (finishQuizInFlightRef.current) return;
    finishQuizInFlightRef.current = true;
    setIsFinishingQuiz(true);
    try {
      // Steps that could not be saved after the answer get one more try.
      for (const [questionId, options] of Array.from(quizPendingClosuresRef.current)) {
        const closure = await resolveMistakeReview(options);
        quizPendingClosuresRef.current.delete(questionId);
        updateResolvedState(questionId, closure.resolved);
      }
    } catch (error) {
      console.error('Failed to sync resolved status to server', error);
      showToast('Could not save your quiz progress to the Error Book. Some mistakes may still show their old stage.', 'error');
    } finally {
      setQuizStep('idle');
      finishQuizInFlightRef.current = false;
      setIsFinishingQuiz(false);
      loadMistakes();
    }
  };

  const cancelQuiz = () => {
    if (confirm('Leave the quiz? Answers you already sent are saved.')) {
      setQuizStep('idle');
    }
  };
  const localResolvedStorageKey = useMemo(
    () => resolvedMistakesStorageKey(getStudentId(), pickerValue.subject, pickerValue.year),
    [pickerValue.subject, pickerValue.year]
  );

  // Load local fallback state for the active student + analytics scope.
  useEffect(() => {
    setResolvedIds(readLocalResolvedIds(localResolvedStorageKey));
  }, [localResolvedStorageKey]);

  // Read query params and preferences on mount to filter mistakes from dashboard links
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const prefSubject = getSubject();
      const prefYear = getYear();
      setPickerValue(() => {
        const subject = scopedSubjectFromSearchParams(params, prefSubject);
        const year = scopedYearFromSearchParams(params, prefYear);
        return { subject, year };
      });
      const topicParam = params.get('topic');
      if (topicParam) {
        setTopicFilter(topicParam);
      }
      const errorParam = params.get('error_type');
      if (errorParam) {
        setErrorFilter(errorParam);
      }
    }
    setScopeReady(true);
  }, []);

  const updateResolvedState = (qid: string, resolved: boolean) => {
    setResolvedIds(prev => {
      const next = new Set(prev);
      if (resolved) next.add(qid);
      else next.delete(qid);
      persistLocalResolvedIds(localResolvedStorageKey, next);
      return next;
    });
  };

  const toggleResolved = (mistake: Mistake) => {
    const nextResolved = !resolvedIds.has(mistake.question_id);
    const scope = mistakeScope(mistake);
    updateResolvedState(mistake.question_id, nextResolved);
    resolveMistakeReview({
      subject: scope.subject,
      question_id: mistake.question_id,
      topic_id: mistake.topic_id,
      resolved: nextResolved,
      resolutionSource: 'manual_dismissal',
      ...scope.analyticsScope,
    }).then(result => {
      updateResolvedState(mistake.question_id, result.resolved);
      loadMistakes();
    }).catch(() => {
      updateResolvedState(mistake.question_id, !nextResolved);
    });
  };

  const saveMistakeCause = async (
    mistake: Mistake,
    errorCause: ErrorCauseCode,
    ifThenStrategy?: string,
  ) => {
    const scope = mistakeScope(mistake);
    await recordMistakeCause({
      subject: scope.subject,
      question_id: mistake.question_id,
      topic_id: mistake.topic_id,
      error_cause: errorCause,
      ifThenStrategy,
      ...scope.analyticsScope,
    });
    loadMistakes();
  };

  // Fetch the active curriculum scope.
  useEffect(() => {
    const abort = new AbortController();
    fetchCurriculum(abort.signal, {
      subject: pickerValue.subject,
      scope: pickerValue.year,
    }).then(setCurriculum).catch(() => {});
    return () => abort.abort();
  }, [pickerValue.subject, pickerValue.year]);

  useEffect(() => {
    const abort = new AbortController();
    fetchErrorTaxonomy(pickerValue.subject, abort.signal)
      .then(data => setErrorTaxonomy(data.error_types || []))
      .catch(() => setErrorTaxonomy([]));
    return () => abort.abort();
  }, [pickerValue.subject]);

  // Check if a topic belongs to the selected year
  const topicBelongsToYear = useMemo(() => {
    return (topicId: string): boolean => {
      if (!curriculum) return true;
      const sb = curriculum[pickerValue.subject];
      if (!sb || typeof sb !== 'object') return false;
      const yb = (sb as Record<string, unknown>)[pickerValue.year];
      if (!yb || typeof yb !== 'object') return false;
      return (yb as Record<string, unknown>)[topicId] !== undefined;
    };
  }, [curriculum, pickerValue.subject, pickerValue.year]);
  void topicBelongsToYear;

  const loadMistakes = useCallback((opts?: MistakeQueryOptions, append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setMistakesError(null);
      setNotebookLoading(true);
    }
    const abort = new AbortController();
    const analyticsScope = {
      ...analyticsScopeFromYear(pickerValue.year),
      syllabusSubject: syllabusSubjectFromPickerSubject(pickerValue.subject),
    };
    fetchMistakes({
      subject: pickerValue.subject,
      topic_id: topicFilter || undefined,
      error_type: errorFilter || undefined,
      sort: sortBy,
      ...analyticsScope,
      ...opts,
      status: showResolvedMode ? 'resolved' : 'active',
      limit: PAGE_SIZE,
      offset: opts?.offset ?? 0,
    }, abort.signal)
      .then((data) => {
        const nextMistakes = data.mistakes || [];
        setMistakes(prev => {
          if (!append) return nextMistakes;
          const seen = new Set(prev.map(item => item.question_id));
          return [...prev, ...nextMistakes.filter(item => !seen.has(item.question_id))];
        });
        setMistakesTotal(data.total ?? nextMistakes.length);
        setHasMore(Boolean(data.has_more));
        setMistakeSummary(data.summary ?? summariseLoadedMistakes(nextMistakes));
        const serverResolved = new Set(
          nextMistakes
            .filter(m =>
              m.resolved
              || m.status === 'resolved'
              || m.status === 'corrected'
              || m.status === 'dismissed'
            )
            .map(m => m.question_id)
        );
        setResolvedIds(prev => {
          const next = append ? new Set(prev) : new Set<string>();
          serverResolved.forEach(questionId => next.add(questionId));
          persistLocalResolvedIds(localResolvedStorageKey, next);
          return next;
        });
        setLoading(false);
        setLoadingMore(false);
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          setMistakesError(
            error instanceof Error && error.message
              ? error.message
              : 'Could not load your mistake history. Please try again.',
          );
          setLoading(false);
          setLoadingMore(false);
        }
      });
    if (!append) {
      fetchTrapNotebook({
        subject: pickerValue.subject,
        topic_id: topicFilter || undefined,
        ...analyticsScope,
      }, abort.signal)
        .then((data) => {
          setNotebookEntries(data.entries || []);
          setNotebookLoading(false);
        })
        .catch(() => {
          if (!abort.signal.aborted) setNotebookLoading(false);
        });
    }
    return abort;
  }, [errorFilter, localResolvedStorageKey, pickerValue.subject, pickerValue.year, showResolvedMode, sortBy, topicFilter]);

  useEffect(() => {
    if (!scopeReady) return;
    const abort = loadMistakes();
    return () => abort.abort();
  }, [loadMistakes, scopeReady]);

  // Backend trap notebook queries are already scoped by subject/year/unit.
  const yearFilteredNotebook = notebookEntries;

  const errorTypeLabels = useMemo(() => ({
    ...ERROR_TYPE_LABELS,
    ...Object.fromEntries(errorTaxonomy.map(entry => [entry.code, entry.label])),
  }), [errorTaxonomy]);

  const errorTypeOptions = useMemo(
    () => errorTaxonomy.length > 0 ? errorTaxonomy.map(entry => entry.code) : ERROR_TYPE_OPTIONS,
    [errorTaxonomy]
  );

  const displayedMistakes = showResolvedMode ? resolvedMistakes : quizCandidateMistakes;
  const quizReadyCount = useMemo(
    () => quizCandidateMistakes.filter(mistake => isQuizStageReady(mistake)).length,
    [quizCandidateMistakes],
  );
  const startQuizFor = (mistake: Mistake) => {
    void startQuiz([mistake]);
  };

  const topicOptions = useMemo(
    () => Object.keys(mistakeSummary.topic_counts).sort(),
    [mistakeSummary.topic_counts],
  );

  const mistakeStats = useMemo(() => {
    const topType = Object.entries(mistakeSummary.error_type_counts).sort((a, b) => b[1] - a[1])[0];
    const mostFrequentTopic = Object.entries(mistakeSummary.topic_counts).sort((a, b) => b[1] - a[1])[0];
    return { topType, mostFrequentTopic };
  }, [mistakeSummary.error_type_counts, mistakeSummary.topic_counts]);

  // Cross-topic error pattern detection (Elaborative Interrogation)
  const crossTopicPattern = useMemo(() => {
    const typeToTopics: Record<string, Set<string>> = {};
    for (const item of displayedMistakes) {
      // Every exam miss shares the generic `exam_error` code, so it says nothing about a habit.
      if (!item.error_type || item.resolved || item.error_type === 'exam_error') continue;
      if (!typeToTopics[item.error_type]) typeToTopics[item.error_type] = new Set();
      typeToTopics[item.error_type].add(item.topic_id);
    }
    const patterns = Object.entries(typeToTopics)
      .filter(([, topics]) => topics.size >= 3)
      .sort((a, b) => b[1].size - a[1].size);
    if (patterns.length === 0) return null;
    const [errorType, topics] = patterns[0];
    return { errorType, topicCount: topics.size, label: errorTypeLabels[errorType] || humanise(errorType) };
  }, [displayedMistakes, errorTypeLabels]);

  const improvementStats = {
    closed: mistakeSummary.closed ?? Math.max(0, mistakeSummary.resolved - (mistakeSummary.dismissed ?? 0)),
    dismissed: mistakeSummary.dismissed ?? 0,
    total: mistakeSummary.total,
    reviews: mistakeSummary.reviews,
  };
  const topicImprovement = mistakeSummary.topic_progress;
  const visibleMistakes = displayedMistakes;

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading your mistake history...</div>;
  }

  if (mistakesError) {
    return (
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '40px', textAlign: 'center' }} role="alert">
        <h1 style={{ fontSize: '22px', marginBottom: '12px' }}>Could not load the Error Book</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>{mistakesError}</p>
        <button className="btn-primary" onClick={() => loadMistakes()} style={{ padding: '10px 20px' }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
      {/* The header wraps on a phone, so the back link never runs off the screen. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '4px' }}>📝 Error Book</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>
            Review your mistakes to identify patterns and strengthen weak areas.
          </p>
        </div>
        <BackToPracticeLink href={practiceHref}>
          ← Back to Practice
        </BackToPracticeLink>
      </div>

      {/* Subject/Year picker */}
      {curriculum && quizStep === 'idle' && (
        <div className="glass-panel" style={{ padding: '16px', marginBottom: '20px' }}>
          <FrameworkSubjectYearPicker
            curriculum={curriculum}
            value={pickerValue}
            onChange={val => setPickerValue(val)}
            initialiseFromPreferences={false}
          />
        </div>
      )}

      {quizStep !== 'idle' ? (
        <MistakeQuizView
          step={quizStep}
          subject={pickerValue.subject}
          questions={quizQuestions}
          currentIndex={currentQuizIndex}
          answer={quizAnswer}
          setAnswer={setQuizAnswer}
          multiPartAnswers={quizMultiPartAnswers}
          setMultiPartAnswers={setQuizMultiPartAnswers}
          results={quizResults}
          submitting={isSubmittingQuizQuestion}
          markResult={quizMarkResult}
          feedback={quizFeedback}
          selfExplanation={quizSelfExplanation}
          setSelfExplanation={value => {
            setQuizSelfExplanation(value);
            setQuizSelfExplanationSaved(false);
            setQuizSelfExplanationError('');
          }}
          selfExplanationSaving={quizSelfExplanationSaving}
          selfExplanationSaved={quizSelfExplanationSaved}
          selfExplanationError={quizSelfExplanationError}
          onSaveSelfExplanation={saveQuizSelfExplanation}
          onSubmit={submitQuizQuestion}
          onNext={nextQuizQuestion}
          onFinish={finishQuiz}
          finishing={isFinishingQuiz}
          finishLabel="Return to Error Book"
          onCancel={cancelQuiz}
        />
      ) : (
        <>
          {(yearFilteredNotebook.length > 0 || notebookLoading) && (
            <TrapNotebookPanel entries={yearFilteredNotebook} loading={notebookLoading} />
          )}

          {mistakeSummary.total === 0 ? (
            <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
              <div style={{ fontSize: '16px', fontWeight: '600' }}>No mistakes yet!</div>
              <div style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
                Start practising and your errors will appear here for review.
              </div>
              <Link
                href={practiceHref}
                className="btn-primary"
                style={{ display: 'inline-block', marginTop: '16px', padding: '9px 16px', textDecoration: 'none', fontSize: '13px', fontWeight: 700 }}
              >
                Start practising →
              </Link>
            </div>
          ) : (
            <>
              {/* Statistics cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                <div className="glass-panel" style={{ padding: '14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '28px', fontWeight: '800', color: '#dc2626' }}>{mistakeSummary.active}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Active Mistakes ({pickerValue.year.replace('year', 'Year ')})</div>
                </div>
                {improvementStats.total > 0 && (
                  <div className="glass-panel" style={{ padding: '14px', textAlign: 'center' }} title="Mistakes closed with independent correction evidence">
                    <div style={{ fontSize: '28px', fontWeight: '800', color: '#16a34a' }}>
                      {improvementStats.closed}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Closed with evidence{improvementStats.reviews > 0 ? ` · ${improvementStats.reviews} review${improvementStats.reviews === 1 ? '' : 's'}` : ''}
                    </div>
                  </div>
                )}
                {improvementStats.dismissed > 0 && (
                  <div className="glass-panel" style={{ padding: '14px', textAlign: 'center' }} title="Hidden without claiming mastery">
                    <div style={{ fontSize: '28px', fontWeight: '800', color: '#7c3aed' }}>
                      {improvementStats.dismissed}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Dismissed</div>
                  </div>
                )}
                {mistakeSummary.active >= MIN_QUIZ_SIZE && mistakeStats.topType && (
                  <div className="glass-panel" style={{ padding: '14px', textAlign: 'center' }}>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#d97706' }}>{mistakeStats.topType[1]}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }} title={errorTypeLabels[mistakeStats.topType[0]] || mistakeStats.topType[0]}>
                      Most Common: {errorTypeLabels[mistakeStats.topType[0]] || humanise(mistakeStats.topType[0])}
                    </div>
                  </div>
                )}
                {mistakeSummary.active >= MIN_QUIZ_SIZE && mistakeStats.mostFrequentTopic && (
                  <div className="glass-panel" style={{ padding: '14px', textAlign: 'center' }}>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#c084fc' }}>{mistakeStats.mostFrequentTopic[1]}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Most Frequent Historical Mistake Topic: {getTopicDisplayName(curriculum, mistakeStats.mostFrequentTopic[0], humanise(mistakeStats.mostFrequentTopic[0]))}
                    </div>
                  </div>
                )}
              </div>

              {/* Cross-topic error pattern alert (Elaborative Interrogation) */}
              {crossTopicPattern && !showResolvedMode && (
                <div className="glass-panel" style={{
                  padding: '14px 18px', marginBottom: '20px',
                  background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '16px' }}>🔍</span>
                    <strong style={{ fontSize: '14px', color: '#d97706' }}>Pattern Alert</strong>
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{crossTopicPattern.label}</strong> appears across{' '}
                    <strong>{crossTopicPattern.topicCount} different topics</strong> — this may be a recurring habit worth focused practice.
                  </p>
                </div>
              )}

              {/* Mistake Quiz Challenge start box */}
              {!showResolvedMode && (
              <div className="glass-panel" style={{
                padding: '16px 20px', marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '16px',
                justifyContent: 'space-between', alignItems: 'center', background: 'rgba(99,102,241,0.05)',
                border: '1px solid rgba(99,102,241,0.2)', borderRadius: '12px'
              }}>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: '750', margin: '0 0 4px', color: 'var(--text-primary)' }}>⚡ Mistake Quiz Challenge</h3>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: 0 }}>
                    {quizCandidateMistakes.length < MIN_QUIZ_SIZE
                      ? `Add ${MIN_QUIZ_SIZE - quizCandidateMistakes.length} more active mistake${MIN_QUIZ_SIZE - quizCandidateMistakes.length === 1 ? '' : 's'} to unlock a short review quiz.`
                      : `Test yourself on up to ${Math.min(MAX_QUIZ_SIZE, quizCandidateMistakes.length)} active mistakes. Mistakes that are ready to advance come first.`}
                  </p>
                  {quizCandidateMistakes.length >= MIN_QUIZ_SIZE && (
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{quizReadyCount}</strong> ready to advance
                      {' · '}
                      <strong style={{ color: 'var(--text-primary)' }}>{quizCandidateMistakes.length - quizReadyCount}</strong> practice only
                      {quizCandidateMistakes.length - quizReadyCount > 0 && ' (record the cause, redo the question, or wait for the spaced check first)'}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => void startQuiz()}
                  disabled={quizCandidateMistakes.length < MIN_QUIZ_SIZE || quizLoading}
                  style={{
                    padding: '8px 18px', fontSize: '13px', borderRadius: '8px', fontWeight: '700',
                    background: quizCandidateMistakes.length < MIN_QUIZ_SIZE ? 'var(--border-color, rgba(255,255,255,0.1))' : 'var(--accent-color)',
                    color: quizCandidateMistakes.length < MIN_QUIZ_SIZE ? 'var(--text-secondary, #888)' : '#fff',
                    border: 'none', cursor: (quizCandidateMistakes.length < MIN_QUIZ_SIZE || quizLoading) ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {quizLoading
                    ? 'Preparing review…'
                    : `Start Quiz (${Math.min(MAX_QUIZ_SIZE, quizCandidateMistakes.length)} of ${quizCandidateMistakes.length})`}
                </button>
              </div>
              )}

          {/* Controls bar */}
          <details open={mistakeSummary.total >= 5 ? true : undefined} style={{ marginBottom: '20px' }}>
            <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '10px' }}>
              Filters and sorting
            </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Row 1: Status, View, Sort */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Status:</span>
              <button onClick={() => setShowResolvedMode(false)} style={chipStyle(!showResolvedMode)}>Active ({mistakeSummary.active})</button>
              <button onClick={() => setShowResolvedMode(true)} style={chipStyle(showResolvedMode)}>Closed / dismissed ({mistakeSummary.resolved})</button>

              <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: '8px' }}>View:</span>
              <button onClick={() => setViewMode('topic')} style={chipStyle(viewMode === 'topic')}>By Topic</button>
              <button onClick={() => setViewMode('recent')} style={chipStyle(viewMode === 'recent')}>Recent</button>
              <button onClick={() => setViewMode('error_type')} style={chipStyle(viewMode === 'error_type')}>By Error Type</button>

              <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: '8px' }}>Sort:</span>
              <button onClick={() => setSortBy('recent')} style={chipStyle(sortBy === 'recent')}>Newest</button>
              <button onClick={() => setSortBy('mastery')} style={chipStyle(sortBy === 'mastery')}>Weakest First</button>

              <span style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text-secondary)' }}>
                {mistakesTotal} mistake{mistakesTotal !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Row 2: Topic and Error filters */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Topic:</span>
              <select value={topicFilter} onChange={e => setTopicFilter(e.target.value)}
                aria-label="Filter by topic"
                style={{ padding: '5px 8px', fontSize: '13px', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', maxWidth: '200px' }}>
                <option value="">All topics</option>
                {topicOptions.map(t => <option key={t} value={t}>{getTopicDisplayName(curriculum, t, humanise(t))}</option>) }
              </select>

              <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: '8px' }}>Error:</span>
              <select value={errorFilter} onChange={e => setErrorFilter(e.target.value)}
                aria-label="Filter by error type"
                style={{ padding: '5px 8px', fontSize: '13px', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                <option value="">All types</option>
                {errorTypeOptions.map(et => <option key={et} value={et}>{errorTypeLabels[et] || humanise(et)}</option>)}
              </select>
            </div>
          </div>
          </details>

          {/* Topic-grouped view */}
          {viewMode === 'topic' ? (
            Object.entries(
              visibleMistakes.reduce<Record<string, Mistake[]>>((acc, m) => {
                if (!acc[m.topic_id]) acc[m.topic_id] = [];
                acc[m.topic_id].push(m);
                return acc;
              }, {})
            ).sort(([, a], [, b]) => b.length - a.length).map(([topicId, topicMistakes]) => (
              <div key={topicId} className="glass-panel" style={{ marginBottom: '16px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: '600', color: 'var(--accent-color)' }}>
                    {getTopicDisplayName(curriculum, topicId, humanise(topicId))}
                  </span>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', background: 'rgba(239,68,68,0.1)', padding: '2px 8px', borderRadius: '10px', color: '#dc2626' }}>
                      {topicMistakes.length} error{topicMistakes.length !== 1 ? 's' : ''}
                    </span>
                    <Link href={practiceHrefForTopic(topicId)}
                      style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '6px', background: 'rgba(99,102,241,0.15)', color: 'var(--accent-color)', textDecoration: 'none', fontWeight: '600', border: '1px solid rgba(99,102,241,0.3)', whiteSpace: 'nowrap' }}>
                      ↩ Practise Topic
                    </Link>
                  </div>
                </div>
                {topicImprovement[topicId] && topicImprovement[topicId].total > 0 && (
                  <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '-6px', marginBottom: '10px' }}>
                    📈 Progress: {topicImprovement[topicId].overcome} of {topicImprovement[topicId].total} overcome
                    {topicImprovement[topicId].reviews > 0 ? ` · reviewed ${topicImprovement[topicId].reviews}×` : ''}
                  </div>
                )}
                {topicMistakes.map((m, i) => (
                  <MistakeCard
                    key={`${m.question_id}-${i}`}
                    mistake={m}
                    isResolved={resolvedIds.has(m.question_id)}
                    onToggleResolved={() => toggleResolved(m)}
                    practiceHrefForTopic={practiceHrefForTopic}
                    practiceHrefForMistake={practiceHrefForMistake}
                    errorTypeLabels={errorTypeLabels}
                    onRecordCause={saveMistakeCause}
                    onStartQuiz={startQuizFor}
                    quizBusy={quizLoading}
                  />
                ))}
              </div>
            ))
          ) : viewMode === 'error_type' ? (
            Object.entries(
              visibleMistakes.reduce<Record<string, Mistake[]>>((acc, m) => {
                const key = m.error_type || 'unknown';
                if (!acc[key]) acc[key] = [];
                acc[key].push(m);
                return acc;
              }, {})
            ).sort(([, a], [, b]) => b.length - a.length).map(([errType, errMistakes]) => {
              const severity = errMistakes[0]?.error_severity;
              const tip = errMistakes[0]?.error_tip;
              const sevColor = severity === 'high' ? '#dc2626' : severity === 'low' ? '#16a34a' : '#d97706';
              return (
                <div key={errType} className="glass-panel" style={{ marginBottom: '16px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#d97706' }}>
                        {errorTypeLabels[errType] || humanise(errType)}
                      </span>
                      {severity && (
                        <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: `${sevColor}18`, color: sevColor, fontWeight: '600' }}>
                          {severity}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '12px', background: 'rgba(239,68,68,0.1)', padding: '2px 8px', borderRadius: '10px', color: '#dc2626' }}>
                      {errMistakes.length} error{errMistakes.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {tip && (
                    <div style={{
                      padding: '8px 12px', borderRadius: '6px', marginBottom: '12px',
                      background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                      fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.5',
                    }}>
                      💡 <strong style={{ color: 'var(--text-primary)' }}>Tip:</strong> {tip}
                    </div>
                  )}
                  {errMistakes.map((m, i) => (
                    <MistakeCard
                      key={`${m.question_id}-${i}`}
                      mistake={m}
                      showTopic
                      isResolved={resolvedIds.has(m.question_id)}
                      onToggleResolved={() => toggleResolved(m)}
                      practiceHrefForTopic={practiceHrefForTopic}
                      practiceHrefForMistake={practiceHrefForMistake}
                      errorTypeLabels={errorTypeLabels}
                    onRecordCause={saveMistakeCause}
                    onStartQuiz={startQuizFor}
                    quizBusy={quizLoading}
                    />
                  ))}
                </div>
              );
            })
          ) : (
            visibleMistakes.map((m, i) => (
              <div key={`${m.question_id}-${i}`} className="glass-panel" style={{ marginBottom: '12px', padding: '16px' }}>
                <MistakeCard
                  mistake={m}
                  showTopic
                  isResolved={resolvedIds.has(m.question_id)}
                  onToggleResolved={() => toggleResolved(m)}
                  practiceHrefForTopic={practiceHrefForTopic}
                  practiceHrefForMistake={practiceHrefForMistake}
                  errorTypeLabels={errorTypeLabels}
                  onRecordCause={saveMistakeCause}
                  onStartQuiz={startQuizFor}
                  quizBusy={quizLoading}
                />
              </div>
            ))
          )}

          {/* Load more button */}
          {hasMore && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <button
                onClick={() => loadMistakes({ offset: mistakes.length }, true)}
                disabled={loadingMore}
                style={{
                  padding: '10px 24px', fontSize: '14px', borderRadius: '8px',
                  background: 'rgba(99,102,241,0.12)', color: 'var(--accent-color)',
                  border: '1px solid rgba(99,102,241,0.3)', cursor: 'pointer', fontWeight: '600',
                }}
              >
                {loadingMore
                  ? 'Loading…'
                  : `Load More (${Math.max(0, mistakesTotal - mistakes.length)} remaining)`}
              </button>
            </div>
          )}
        </>
      )}
    </>
  )}
</div>
  );
}

function TrapNotebookPanel({ entries, loading }: { entries: TrapNotebookEntry[]; loading: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? entries : entries.slice(0, 4);
  const repeated = entries.filter(entry => entry.source === 'repeated_mistake').length;
  const scheduled = entries.filter(entry => entry.source === 'spaced_revision').length;

  return (
    <div className="glass-panel" style={{ padding: '16px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 750, margin: '0 0 4px' }}>Formula & Trap Notebook</h2>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {loading ? 'Loading...' : `${repeated} repeated trap${repeated !== 1 ? 's' : ''} · ${scheduled} spaced review${scheduled !== 1 ? 's' : ''}`}
          </div>
        </div>
        <span style={{ fontSize: '12px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(34,197,94,0.1)', color: '#16a34a', fontWeight: 700 }}>
          {entries.length} card{entries.length !== 1 ? 's' : ''}
        </span>
      </div>
      {loading && entries.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
          Loading your trap notebook...
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            {visible.map(entry => (
              <TrapNotebookCard key={entry.id} entry={entry} />
            ))}
          </div>
          {entries.length > 4 && (
            <div style={{ textAlign: 'center', marginTop: '12px' }}>
              <button
                onClick={() => setShowAll(prev => !prev)}
                style={{
                  fontSize: '12px', padding: '6px 14px', borderRadius: '6px',
                  background: 'rgba(99,102,241,0.12)', color: 'var(--accent-color)',
                  border: '1px solid rgba(99,102,241,0.3)', cursor: 'pointer', fontWeight: '600',
                }}
              >
                {showAll ? `Show Less` : `Show All (${entries.length} cards)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TrapNotebookCard({ entry }: { entry: TrapNotebookEntry }) {
  const [showExample, setShowExample] = useState(false);
  const sourceColor = entry.source === 'repeated_mistake' ? '#d97706' : '#16a34a';
  const sourceLabel = entry.source === 'repeated_mistake' ? `${entry.attempt_count} attempts` : 'spaced review';

  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px', background: 'rgba(255,255,255,0.03)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--accent-color)' }}>{entry.topic_id}</span>
        <span style={{ fontSize: '11px', color: sourceColor, fontWeight: 700 }}>{sourceLabel}</span>
      </div>
      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.45, marginBottom: '8px' }}>
        <MathMarkdown>{entry.key_rule}</MathMarkdown>
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.45, marginBottom: '8px' }}>
        <strong style={{ color: 'var(--text-primary)' }}>Trap:</strong> {entry.personal_trap}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
        Next review: {formatNotebookDate(entry.next_review_at)}
      </div>
      {entry.worked_example && (
        <>
          <button
            onClick={() => setShowExample(prev => !prev)}
            style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', background: 'rgba(99,102,241,0.12)', color: 'var(--accent-color)', border: '1px solid rgba(99,102,241,0.25)', cursor: 'pointer', fontWeight: 650 }}
          >
            {showExample ? 'Hide Example' : 'Show Example'}
          </button>
          {showExample && (
            <div style={{ marginTop: '8px', padding: '8px', borderRadius: '6px', background: 'rgba(99,102,241,0.06)', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              {entry.worked_example.question && <MathMarkdown>{entry.worked_example.question}</MathMarkdown>}
              {entry.worked_example.steps.length > 0 && (
                <ol style={{ margin: '6px 0 6px 18px', padding: 0 }}>
                  {entry.worked_example.steps.map((step, idx) => (
                    <li key={idx}><MathMarkdown inline>{step}</MathMarkdown></li>
                  ))}
                </ol>
              )}
              {entry.worked_example.answer && (
                <div><strong style={{ color: 'var(--text-primary)' }}>Answer:</strong> <MathMarkdown inline>{entry.worked_example.answer}</MathMarkdown></div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatNotebookDate(value: string): string {
  if (!value) return 'not scheduled';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '5px 10px', fontSize: '13px', borderRadius: '6px', cursor: 'pointer',
    background: active ? 'var(--accent-color)' : 'transparent',
    color: active ? '#fff' : 'var(--text-primary)',
    border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}`,
    fontWeight: '600',
  };
}

function MistakeCard({
  mistake,
  showTopic = false,
  isResolved,
  onToggleResolved,
  practiceHrefForMistake,
  errorTypeLabels,
  onRecordCause,
  onStartQuiz,
  quizBusy = false,
}: {
  mistake: Mistake;
  showTopic?: boolean;
  isResolved: boolean;
  onToggleResolved: () => void;
  practiceHrefForTopic: (topic: string, question?: string) => string;
  practiceHrefForMistake: (mistake: Mistake, question?: string, showAnswer?: boolean) => string;
  errorTypeLabels: Record<string, string>;
  onRecordCause: (mistake: Mistake, cause: ErrorCauseCode, ifThenStrategy?: string) => Promise<void>;
  /** Starts a one-item quiz: the only route that counts as closure evidence. */
  onStartQuiz?: (mistake: Mistake) => void;
  quizBusy?: boolean;
}) {
  const timeAgo = formatTimeAgo(mistake.timestamp);
  const [showExplanation, setShowExplanation] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showWhyWrong, setShowWhyWrong] = useState(false);
  const [causeSaving, setCauseSaving] = useState(false);
  const [ifThenStrategy, setIfThenStrategy] = useState(mistake.if_then_strategy || '');
  const sourceLabel = mistake.source === 'diagnostic' ? 'Diagnostic' : 'Practice';
  const sourceColor = mistake.source === 'diagnostic' ? '#6366f1' : '#16a34a';
  const causeOptions = getErrorCauseOptions(mistake.subject);
  const quizActionLabel = !isResolved && onStartQuiz && isQuizStageReady(mistake)
    ? (mistake.closure_stage === 'needs_transfer' ? '🎯 Do a transfer question' : '🔁 Do the spaced check')
    : null;

  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.06))' }}>
      <div style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '8px', lineHeight: '1.5' }}>
        <QuestionContext question={mistake} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '12px', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{
          fontSize: '12px', padding: '3px 8px', borderRadius: '999px', fontWeight: 750,
          color: isResolved && mistake.closure_stage === 'closed' ? '#16a34a' : '#7c3aed',
          background: isResolved && mistake.closure_stage === 'closed' ? 'rgba(34,197,94,0.12)' : 'rgba(124,58,237,0.12)',
        }}>
          {CLOSURE_STAGE_LABELS[mistake.closure_stage || (isResolved ? 'dismissed' : 'needs_understanding')]}
        </span>
        {!isResolved && (
          <button
            type="button"
            onClick={onToggleResolved}
            title="Hide this item without claiming it has been mastered"
            style={{ background: 'transparent', border: 0, color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Dismiss
          </button>
        )}
        {isResolved && (
          <button
            type="button"
            onClick={onToggleResolved}
            style={{ background: 'transparent', border: 0, color: 'var(--accent-color)', fontSize: '11px', cursor: 'pointer' }}
          >
            Reopen
          </button>
        )}

        {mistake.student_answer && (
          <span style={{ color: '#dc2626' }}>✗ <MathMarkdown inline>{formatStudentAnswer(mistake.student_answer)}</MathMarkdown></span>
        )}
        {showAnswer ? (
          <span style={{ color: '#16a34a' }}>
            ✓ <MathMarkdown inline>{mistake.correct_answer}</MathMarkdown>
          </span>
        ) : (
          <button onClick={() => setShowAnswer(true)}
            style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(34,197,94,0.12)', color: '#16a34a', border: 'none', cursor: 'pointer', fontWeight: '600' }}>
            Show Answer
          </button>
        )}
        {mistake.error_type && (() => {
          const sevColor = mistake.error_severity === 'high' ? '#dc2626' : mistake.error_severity === 'low' ? '#16a34a' : '#d97706';
          return (
            <span
              title={`${errorTypeLabels[mistake.error_type] || mistake.error_type} (${mistake.error_severity || 'medium'} severity)`}
              style={{ color: sevColor, background: `${sevColor}18`, padding: '1px 6px', borderRadius: '4px', cursor: 'help', borderBottom: `1px dashed ${sevColor}50` }}>
              {errorTypeLabels[mistake.error_type] || humanise(mistake.error_type)}
              {mistake.error_severity && <span style={{ marginLeft: '4px', fontSize: '10px', opacity: 0.8 }}>· {mistake.error_severity}</span>}
            </span>
          );
        })()}
        <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: `${sourceColor}16`, color: sourceColor, fontWeight: '650' }}>
          {sourceLabel}
        </span>
        {(mistake.attempt_count ?? 0) > 1 && (
          <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(99,102,241,0.1)', color: 'var(--accent-color)', fontWeight: '600' }}>
            {mistake.attempt_count} attempts
          </span>
        )}
        {showTopic && (
          <Link href={practiceHrefForMistake(mistake, undefined, showAnswer || showWhyWrong)}
            style={{ color: 'var(--accent-color)', fontFamily: 'monospace', fontSize: '11px', textDecoration: 'none' }}>
            {mistake.topic_id} ↗
          </Link>
        )}
        <span style={{ color: 'var(--text-secondary)', marginLeft: 'auto' }}>{timeAgo}</span>
      </div>

      {!isResolved && (mistake.closure_stage || 'needs_understanding') === 'needs_understanding' && (
        <div style={{ padding: '10px 12px', marginBottom: '8px', borderRadius: '8px', background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.2)' }}>
          <div style={{ fontSize: '12px', fontWeight: 750, marginBottom: '7px' }}>First, what caused this error?</div>
          <label htmlFor={`if-then-${mistake.question_id}`} style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '5px' }}>
            Make a plan for next time (optional): If I notice… then I will…
          </label>
          <textarea
            id={`if-then-${mistake.question_id}`}
            value={ifThenStrategy}
            maxLength={300}
            rows={2}
            disabled={causeSaving}
            onChange={event => setIfThenStrategy(event.target.value)}
            placeholder="If I notice…, then I will…"
            style={{ boxSizing: 'border-box', width: '100%', marginBottom: '8px', padding: '7px 9px', borderRadius: '6px', border: '1px solid rgba(124,58,237,0.25)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', font: 'inherit', fontSize: '12px', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {causeOptions.map(option => (
              <button
                key={option.value}
                type="button"
                disabled={causeSaving}
                onClick={async () => {
                  setCauseSaving(true);
                  try { await onRecordCause(mistake, option.value, ifThenStrategy.trim() || undefined); } finally { setCauseSaving(false); }
                }}
                style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid rgba(124,58,237,0.25)', background: 'rgba(124,58,237,0.1)', color: 'var(--text-primary)', fontSize: '11px', cursor: causeSaving ? 'wait' : 'pointer' }}
              >
                {option.emoji} {option.shortLabel}
              </button>
            ))}
          </div>
        </div>
      )}

      {mistake.error_cause && (
        <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
          Recorded cause: <strong>{causeOptions.find(option => option.value === mistake.error_cause)?.shortLabel || humanise(mistake.error_cause)}</strong>
        </div>
      )}

      {mistake.if_then_strategy && (
        <div style={{ padding: '8px 12px', marginBottom: '8px', borderRadius: '6px', background: 'rgba(124,58,237,0.07)', color: 'var(--text-secondary)', fontSize: '12px' }}>
          <strong style={{ color: 'var(--text-primary)' }}>My if–then plan:</strong> {mistake.if_then_strategy}
        </div>
      )}

      {mistake.recommended_review_action && !isResolved && (
        <div style={{ padding: '8px 12px', marginBottom: '8px', borderRadius: '6px', background: 'rgba(14,165,233,0.07)', color: 'var(--text-secondary)', fontSize: '12px' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Next action:</strong> {mistake.recommended_review_action}
        </div>
      )}

      {mistake.closure_stage === 'needs_consolidation' && mistake.consolidation_due_at && (
        <div style={{ padding: '8px 12px', marginBottom: '8px', borderRadius: '6px', background: 'rgba(14,165,233,0.08)', color: 'var(--text-secondary)', fontSize: '12px' }}>
          ⏳ Transfer succeeded. Final consolidation is due {new Date(mistake.consolidation_due_at).toLocaleDateString()}.
        </div>
      )}

      {/* Actionable error tip */}
      {mistake.error_tip && (
        <div style={{
          padding: '8px 12px', borderRadius: '6px', marginBottom: '8px',
          background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)',
          fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5',
        }}>
          💡 <strong style={{ color: 'var(--text-primary)' }}>Tip:</strong> {mistake.error_tip}
        </div>
      )}

      {/* Misconception detail */}
      {mistake.misconception_name && (
        <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: '600', color: '#c084fc' }}>
              🧠 {mistake.misconception_name}
            </span>
            {mistake.misconception_explanation && (
              <button onClick={() => setShowExplanation(!showExplanation)}
                style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(168,85,247,0.15)', color: '#c084fc', border: 'none', cursor: 'pointer' }}>
                {showExplanation ? 'Hide' : 'Explain'}
              </button>
            )}
          </div>
          {showExplanation && mistake.misconception_explanation && (
            <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
              {mistake.misconception_explanation}
            </div>
          )}
          {mistake.worked_example_name && (
            <div style={{ marginTop: '6px' }}>
              <Link href={practiceHrefForMistake(mistake, undefined, showAnswer || showWhyWrong)}
                style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '6px', background: 'rgba(34,197,94,0.12)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.3)', cursor: 'pointer', fontWeight: '600', textDecoration: 'none', display: 'inline-block' }}>
                📖 View Worked Example: {mistake.worked_example_name}
              </Link>
            </div>
          )}
        </div>
      )}

      {showWhyWrong && (
        <div style={{
          marginTop: '10px',
          padding: '10px 12px',
          borderRadius: '8px',
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.2)',
          fontSize: '12.5px',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}>
          <strong style={{ color: 'var(--text-primary)' }}>Why review this answer?</strong>{' '}
          Compare your old answer{mistake.student_answer ? <> (<MathMarkdown inline>{formatStudentAnswer(mistake.student_answer)}</MathMarkdown>)</> : ''} with the correct answer (<MathMarkdown inline>{mistake.correct_answer}</MathMarkdown>).
          {mistake.error_tip ? mistake.error_tip : 'Look for the first step where your working stopped matching the question.'}
        </div>
      )}

      {/* Primary review actions */}
      <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {quizActionLabel && onStartQuiz && (
          <button
            type="button"
            onClick={() => onStartQuiz(mistake)}
            disabled={quizBusy}
            className="btn-primary"
            style={{ fontSize: '12px', padding: '6px 14px', borderRadius: '6px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', cursor: quizBusy ? 'wait' : 'pointer', opacity: quizBusy ? 0.65 : 1 }}
          >
            {quizBusy ? 'Preparing review…' : quizActionLabel}
          </button>
        )}
        <Link href={practiceHrefForMistake(mistake, mistake.question_id, showAnswer || showWhyWrong)}
          style={{ fontSize: '12px', padding: '6px 14px', borderRadius: '6px', background: 'rgba(99,102,241,0.15)', color: 'var(--accent-color)', border: '1px solid rgba(99,102,241,0.3)', cursor: 'pointer', fontWeight: '700', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
          📝 Redo question
        </Link>
        <button onClick={() => setShowWhyWrong(prev => !prev)}
          aria-expanded={showWhyWrong}
          style={{ fontSize: '12px', padding: '6px 14px', borderRadius: '6px', background: 'rgba(168,85,247,0.12)', color: '#9333ea', border: '1px solid rgba(168,85,247,0.3)', cursor: 'pointer', fontWeight: '600', display: 'inline-flex', alignItems: 'center' }}>
          {showWhyWrong ? 'Hide explanation' : 'Why was this wrong?'}
        </button>
      </div>
      {quizActionLabel && (
        <div style={{ marginTop: '6px', fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          Only this check counts as evidence for the next stage. “Redo question” is practice only.
        </div>
      )}
    </div>
  );
}

interface MistakeQuizViewProps {
  step: 'question' | 'feedback' | 'summary';
  subject: string;
  questions: Mistake[];
  currentIndex: number;
  answer: string;
  setAnswer: (val: string) => void;
  multiPartAnswers: Record<string, string>;
  setMultiPartAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  results: MistakeQuizResult[];
  submitting: boolean;
  markResult: TutorMarkResponse | null;
  feedback: string;
  selfExplanation?: string;
  setSelfExplanation?: (value: string) => void;
  selfExplanationSaving?: boolean;
  selfExplanationSaved?: boolean;
  selfExplanationError?: string;
  onSaveSelfExplanation?: () => void;
  onSubmit: () => void;
  onNext: () => void;
  onFinish: () => void;
  finishing: boolean;
  finishLabel?: string;
  onCancel: () => void;
}

export function MistakeQuizView({
  step,
  subject,
  questions,
  currentIndex,
  answer,
  setAnswer,
  multiPartAnswers,
  setMultiPartAnswers,
  results,
  submitting,
  markResult,
  feedback,
  selfExplanation = '',
  setSelfExplanation,
  selfExplanationSaving = false,
  selfExplanationSaved = false,
  selfExplanationError = '',
  onSaveSelfExplanation,
  onSubmit,
  onNext,
  onFinish,
  finishing,
  finishLabel = 'Return to Error Book',
  onCancel,
}: MistakeQuizViewProps) {
  const currentQ = questions[currentIndex];
  const showMathKeyboard = isMathSubject(currentQ?.subject || subject);

  if (step === 'summary') {
    const summary = mistakeQuizSummary(results);
    return (
      <div className="glass-panel" style={{ padding: '30px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏆</div>
        <h2 style={{ fontSize: '20px', fontWeight: '750', marginBottom: '8px' }}>Challenge Completed!</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
          You answered <strong>{summary.correct}</strong> of <strong>{questions.length}</strong> correctly.
          {' '}<strong>{summary.resolved}</strong> mistake{summary.resolved === 1 ? '' : 's'} moved to the next Error Book stage.
          {summary.pending > 0 && <> {' '}<strong>{summary.pending}</strong> answer{summary.pending === 1 ? ' is' : 's are'} awaiting review and not counted as incorrect.</>}
        </p>

        <div style={{ textAlign: 'left', maxWidth: '600px', margin: '0 auto 24px', border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden' }}>
          {results.map((res, idx) => (
            <div key={idx} style={{ padding: '12px 16px', borderBottom: idx < results.length - 1 ? '1px solid var(--border-color)' : 'none', display: 'flex', alignItems: 'flex-start', gap: '12px', background: 'rgba(255,255,255,0.01)' }}>
              <span style={{ fontSize: '16px', flexShrink: 0 }}>
                {res.outcome === 'pending' ? '⏳' : res.is_correct ? '✅' : '❌'}
              </span>
              <div style={{ flex: 1, fontSize: '13px' }}>
                <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>
                  <MathMarkdown>{res.question}</MathMarkdown>
                </div>
                <div style={{ color: 'var(--text-secondary)', display: 'flex', gap: '16px' }}>
                  <span>Your Answer: <strong style={{ color: res.outcome === 'pending' ? '#d97706' : res.is_correct ? '#16a34a' : '#dc2626' }}><MathMarkdown inline>{formatStudentAnswer(res.student_answer)}</MathMarkdown></strong></span>
                  {res.outcome === 'pending'
                    ? <span style={{ color: '#d97706' }}>Awaiting review — not marked incorrect.</span>
                    : !res.is_correct && <span style={{ color: 'var(--text-secondary)' }}>Review the concept and try again later.</span>}
                </div>
                {res.is_correct && !res.resolution_eligible && res.practice_reason && (
                  <div style={{ marginTop: '4px', color: 'var(--text-secondary)', fontSize: '12px', lineHeight: 1.45 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Practice only:</strong> {res.practice_reason}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onFinish}
          disabled={finishing}
          style={{
            padding: '12px 28px', fontSize: '14px', borderRadius: '8px', fontWeight: '700',
            background: 'var(--accent-color)', color: '#fff', border: 'none', cursor: finishing ? 'wait' : 'pointer',
            opacity: finishing ? 0.65 : 1,
          }}
        >
          {finishing ? 'Saving corrections...' : finishLabel}
        </button>
      </div>
    );
  }

  if (!currentQ) return null;

  return (
    <div className="glass-panel" style={{ padding: '24px' }}>
      {/* Progress header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginBottom: '20px' }}>
        <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--accent-color)' }}>
          Question {currentIndex + 1} of {questions.length}
        </span>
        <button
          onClick={onCancel}
          style={{ fontSize: '12px', color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: '600' }}
        >
          Quit Quiz
        </button>
      </div>

      {/* Question rendering */}
      <div style={{ fontSize: '16px', color: 'var(--text-primary)', lineHeight: '1.6', marginBottom: '20px' }}>
        <QuestionContext question={currentQ} />
      </div>

      {/* Inputs block */}
      {step === 'question' ? (
        <div style={{ marginBottom: '24px' }}>
          {currentQ.question_type === 'multiple_choice' && currentQ.choices?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {currentQ.choices.map((choice, idx) => {
                const label = String.fromCharCode(65 + idx); // A, B, C, D...
                const isSelected = answer === label;
                return (
                  <button
                    key={idx}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setAnswer(label)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
                      borderRadius: '8px', border: `1px solid ${isSelected ? 'var(--accent-color)' : 'var(--border-color)'}`,
                      background: isSelected ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.01)',
                      color: 'var(--text-primary)', fontSize: '14px', cursor: 'pointer', textAlign: 'left',
                      fontWeight: isSelected ? '600' : 'normal', transition: 'all 0.2s'
                    }}
                  >
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: '24px', height: '24px', borderRadius: '50%',
                      background: isSelected ? 'var(--accent-color)' : 'var(--border-color)',
                      color: isSelected ? '#fff' : 'var(--text-secondary)', fontWeight: '700', fontSize: '12px'
                    }}>
                      {label}
                    </span>
                    <span style={{ flex: 1 }}><MathMarkdown inline>{choice}</MathMarkdown></span>
                  </button>
                );
              })}
            </div>
          ) : currentQ.question_type === 'multiple_choice' ? (
            <div role="alert" style={{ padding: '14px', borderRadius: '8px', color: '#dc2626', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              This multiple-choice question has no answer choices. Please quit and try another question.
            </div>
          ) : currentQ.question_type === 'multi_part' && currentQ.sub_parts?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {currentQ.sub_parts.map((part, idx) => {
                const partLabel = mistakeQuizPartLabel(part.label, idx);
                const inputId = `mistake-quiz-part-${idx}`;
                const choices = part.choices || [];
                return (
                  <div key={idx} style={{ padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.01)' }}>
                    <label htmlFor={choices.length ? undefined : inputId} style={{ display: 'block', fontSize: '13.5px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)' }}>
                      Part {partLabel.toUpperCase()}: <MathMarkdown inline>{part.question}</MathMarkdown>
                    </label>
                    {(part.diagram_data || part.image) && (
                      <div aria-label={`Part ${partLabel.toUpperCase()} visual`} style={{ marginBottom: '10px' }}>
                        <QuestionContext question={{ diagram_data: part.diagram_data, image: part.image }} />
                      </div>
                    )}
                    {choices.length ? (
                      <div role="radiogroup" aria-label={`Answer for Part ${partLabel.toUpperCase()}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {choices.map((choice, choiceIndex) => {
                          const choiceLabel = String.fromCharCode(65 + choiceIndex);
                          const submittedValue = mistakeQuizPartChoiceValue(part, choice, choiceIndex);
                          const isSelected = multiPartAnswers[partLabel] === submittedValue;
                          return (
                            <label key={choiceIndex} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${isSelected ? 'var(--accent-color)' : 'var(--border-color)'}`, background: isSelected ? 'rgba(99,102,241,0.08)' : 'var(--bg-secondary)', cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`mistake-quiz-part-choice-${idx}`}
                                value={submittedValue}
                                checked={isSelected}
                                disabled={submitting}
                                onChange={() => setMultiPartAnswers(prev => ({ ...prev, [partLabel]: submittedValue }))}
                                style={{ accentColor: 'var(--accent-color)' }}
                              />
                              <strong aria-hidden="true" style={{ fontSize: '12px', color: 'var(--accent-color)' }}>{choiceLabel}</strong>
                              <span style={{ fontSize: '14px' }}><MathMarkdown inline>{choice}</MathMarkdown></span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <>
                        {showMathKeyboard && (
                          <MathSymbolKeyboard
                            textareaId={inputId}
                            onInsert={value => setMultiPartAnswers(prev => ({ ...prev, [partLabel]: value }))}
                            disabled={submitting}
                          />
                        )}
                        <textarea
                          id={inputId}
                          placeholder={`Type your answer for Part ${partLabel.toUpperCase()} here...`}
                          value={multiPartAnswers[partLabel] || ''}
                          disabled={submitting}
                          rows={(part.marks || 1) > 1 ? 5 : 3}
                          onChange={e => setMultiPartAnswers(prev => ({ ...prev, [partLabel]: e.target.value }))}
                          onKeyDown={e => {
                            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSubmit();
                          }}
                          style={{
                            boxSizing: 'border-box', width: '100%', minHeight: (part.marks || 1) > 1 ? '132px' : '96px', padding: '10px', borderRadius: '6px',
                            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', resize: 'vertical', lineHeight: 1.5,
                            color: 'var(--text-primary)', fontSize: '13.5px', fontFamily: 'inherit'
                          }}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : currentQ.question_type === 'multi_part' ? (
            <div role="alert" style={{ padding: '14px', borderRadius: '8px', color: '#dc2626', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              This multi-part question is missing its parts. Please quit and try another question.
            </div>
          ) : (
            <div>
              <label htmlFor="mistake-quiz-answer" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                {currentQ.question_type === 'reasoning' ? 'Your Reasoning:' : 'Your Answer:'}
              </label>
              {showMathKeyboard && (
                <MathSymbolKeyboard
                  textareaId="mistake-quiz-answer"
                  onInsert={setAnswer}
                  disabled={submitting}
                />
              )}
              <textarea
                id="mistake-quiz-answer"
                placeholder={currentQ.question_type === 'reasoning' ? 'Explain your reasoning clearly. Show your working and justify each step...' : 'Type your answer here...'}
                value={answer}
                disabled={submitting}
                rows={currentQ.question_type === 'reasoning' ? 8 : 3}
                onChange={e => setAnswer(e.target.value)}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && answer.trim()) onSubmit();
                }}
                style={{
                  boxSizing: 'border-box', width: '100%', minHeight: currentQ.question_type === 'reasoning' ? '220px' : '96px', padding: '12px', borderRadius: '8px',
                  background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)', fontSize: '14px', fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical'
                }}
              />
            </div>
          )}

          {feedback && !markResult && (
            <div role="alert" style={{ marginTop: '16px', padding: '10px 12px', borderRadius: '8px', color: '#dc2626', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              {feedback}
            </div>
          )}

          <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              onClick={onSubmit}
              disabled={submitting || !isMistakeQuizAnswerComplete(currentQ, answer, multiPartAnswers)}
              style={{
                padding: '10px 24px', fontSize: '13.5px', borderRadius: '8px', fontWeight: '750',
                background: 'var(--accent-color)', color: '#fff', border: 'none', cursor: 'pointer',
                opacity: submitting || !isMistakeQuizAnswerComplete(currentQ, answer, multiPartAnswers) ? 0.6 : 1
              }}
            >
              {submitting ? 'Grading...' : 'Submit Answer'}
            </button>
          </div>
        </div>
      ) : (
        /* Feedback Step */
        <div style={{ marginBottom: '24px' }}>
          {markResult && (() => {
            const pending = markResult.outcome === 'pending';
            const correct = markResult.outcome === 'correct' && markResult.is_correct;
            const accent = pending ? '#d97706' : correct ? '#16a34a' : '#ef4444';
            return (
            <div style={{
              padding: '16px', borderRadius: '8px', marginBottom: '20px',
              background: pending ? 'rgba(245,158,11,0.08)' : correct ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${pending ? 'rgba(245,158,11,0.25)' : correct ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: '750', color: accent, marginBottom: '8px' }}>
                <span>{pending ? '⏳ Awaiting review — not marked incorrect' : correct ? '✅ Correct Answer!' : '❌ Incorrect Answer'}</span>
              </div>
              <div style={{ fontSize: '13.5px', color: 'var(--text-primary)', lineHeight: '1.5', marginBottom: '12px' }}>
                <MathMarkdown>{feedback}</MathMarkdown>
              </div>
              {!pending && !correct && (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
                  Review the concept and try again, or revisit the worked example to strengthen your understanding.
                </div>
              )}
            </div>
            );
          })()}

          {currentQ.closure_stage === 'needs_consolidation' && (currentQ.if_then_strategy || currentQ.self_explanation || currentQ.recommended_review_action) && (
            <div style={{ padding: '12px 14px', borderRadius: '8px', marginBottom: '18px', background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.2)', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 750, color: 'var(--text-primary)', marginBottom: '5px' }}>Compare with your earlier plan after the check</div>
              {currentQ.if_then_strategy && <div><strong>If–then plan:</strong> {currentQ.if_then_strategy}</div>}
              {currentQ.self_explanation && <div><strong>Earlier explanation:</strong> {currentQ.self_explanation}</div>}
              {currentQ.recommended_review_action && <div><strong>Next action:</strong> {currentQ.recommended_review_action}</div>}
            </div>
          )}

          {markResult && setSelfExplanation && onSaveSelfExplanation && (
            <div style={{ padding: '14px', borderRadius: '8px', marginBottom: '18px', background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.18)' }}>
              <label htmlFor="mistake-quiz-self-explanation" style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
                Refine your explanation for next time
              </label>
              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                In at least 3 words, explain the cue or idea that made the answer work.
              </div>
              <textarea
                id="mistake-quiz-self-explanation"
                value={selfExplanation}
                maxLength={300}
                rows={3}
                disabled={selfExplanationSaving}
                onChange={event => setSelfExplanation(event.target.value)}
                placeholder="I knew to… because…"
                style={{ boxSizing: 'border-box', width: '100%', padding: '9px 10px', borderRadius: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', font: 'inherit', fontSize: '12.5px', resize: 'vertical' }}
              />
              {selfExplanationError && <div role="alert" style={{ color: '#dc2626', fontSize: '11.5px', marginTop: '6px' }}>{selfExplanationError}</div>}
              <button
                type="button"
                onClick={onSaveSelfExplanation}
                disabled={selfExplanationSaving || selfExplanationSaved || !hasMinimumSelfExplanation(selfExplanation)}
                style={{ marginTop: '8px', padding: '7px 12px', borderRadius: '6px', border: '1px solid rgba(14,165,233,0.3)', background: 'rgba(14,165,233,0.12)', color: 'var(--text-primary)', fontWeight: 700, cursor: selfExplanationSaving ? 'wait' : 'pointer', opacity: selfExplanationSaving || selfExplanationSaved || !hasMinimumSelfExplanation(selfExplanation) ? 0.6 : 1 }}
              >
                {selfExplanationSaving ? 'Saving…' : selfExplanationSaved ? 'Explanation saved' : 'Save explanation'}
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              onClick={onNext}
              style={{
                padding: '10px 24px', fontSize: '13.5px', borderRadius: '8px', fontWeight: '750',
                background: 'var(--accent-color)', color: '#fff', border: 'none', cursor: 'pointer'
              }}
            >
              {currentIndex < questions.length - 1 ? 'Next Question →' : 'Finish Challenge'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
