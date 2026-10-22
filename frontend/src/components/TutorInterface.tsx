'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { tutorExplain, tutorMark, tutorSuggest, tutorDialogue, fetchMisconceptions, fetchTopicWorkedExample, tutorReflect, tutorShowAnswer, updateTutorAttemptMetadata } from '../lib/api';
import { showToast } from '../lib/toast';
import { getLocale } from '../lib/preferences';
import { buildMistakesHref, buildTodayHref } from '../lib/scoped_navigation';
import { createTodayTaskProgress, type TodayTaskProgress } from '../lib/today-task-progress';
import { getSubjectAdapter } from '../lib/guided-subject-adapters';
import { ERROR_TYPE_LABELS, getErrorCauseOptions } from '../lib/constants';
import { humanise } from '../lib/format';
import { hasMinimumSelfExplanation, MIN_SELF_EXPLANATION_WORDS, selfExplanationWordCount } from '../lib/metacognition';
import { isMathSubject } from '../lib/subject_registry';
import type { SubPart, SubPartResult, Subject, TutorLabLink, YearLevel } from '../lib/api-types';
import MathMarkdown from './MathMarkdown';
import DialoguePanel from './tutor/DialoguePanel';
import LessonContentPanel from './tutor/LessonContentPanel';
import WorkedExamplePanel from './tutor/WorkedExamplePanel';
import QuestionDisplay from './tutor/QuestionDisplay';
import AnswerInputArea from './tutor/AnswerInputArea';
import type { AnswerLockReason } from './tutor/MultiPartInput';
import TutorControls from './tutor/TutorControls';
import TutorHeader from './tutor/TutorHeader';
import { RefreshCcw } from 'lucide-react';

interface TutorInterfaceProps {
  topic: string;
  /** Curriculum name shown to the student instead of the topic code. */
  topicName?: string;
  subject: Subject;
  labLink?: TutorLabLink;
  exercises: any[];
  loadingExercises?: boolean;
  exerciseLoadError?: boolean;
  onRetryExercises?: () => void;
  onMarkSuccess?: (isCorrect: boolean) => void;
  initialQuestionId?: string | null;
  revisionTopic?: { topic_id?: string; name?: string; reason?: string; strand?: string } | null;
  onGoToTopic?: () => void;
  yearLevel?: number;
  unit?: number;
}

const ACTION_LABELS: Record<string, string> = {
  show_worked_example: "Show worked example",
  give_next_step: "Show next nudge",
  try_again: "Try again",
  explain_my_answer: "Explain my answer",
  mark_final_answer: "Submit my answer",
  change_topic: "Change topic",
};

const SUPPORTED_ACTIONS = new Set(Object.keys(ACTION_LABELS));

function newMutationRequestId(prefix: string): string {
  const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomUuid}`;
}

/**
 * Progressive disclosure state for help panels (UX Improvement 4).
 * Controls which help actions are visible based on attempt history:
 *   pre_attempt          → Hint, Concept reminder
 *   after_first_error    → Explain my answer, Targeted feedback, Reflection chips
 *   after_repeated_errors→ Worked example panel, Review concept panel
 *   after_correct        → Next question, Try a harder one, Review solution
 */
type HelpVisibility = 'pre_attempt' | 'after_first_error' | 'after_repeated_errors' | 'after_correct';

export default function TutorInterface({ topic, topicName, subject, labLink, exercises, loadingExercises = false, exerciseLoadError = false, onRetryExercises, onMarkSuccess, initialQuestionId, revisionTopic, onGoToTopic, yearLevel, unit }: TutorInterfaceProps) {
  const topicLabel = topicName || topic.replace(/_/g, ' ');
  const yLevel = yearLevel;
  const uVal = unit;
  const showMathToolbar = isMathSubject(subject);
  const [currentEx, setCurrentEx] = useState<any>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [chat, setChat] = useState<{role: 'tutor'|'system'|'student', content: string, type?: 'success'|'error'|'dialogue'}[]>([]);
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const consumedInitialQuestionId = useRef<string | null>(null);
  const prevInitialQuestionId = useRef<string | null>(null);
  const [multiPartResults, setMultiPartResults] = useState<SubPartResult[]>([]);
  const [activeMultipartLabel, setActiveMultipartLabel] = useState<string | null>(null);

  // Dialogue state
  const [dialogueLoading, setDialogueLoading] = useState(false);
  const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
  const [dialogueDisabled, setDialogueDisabled] = useState(false);
  const [, setDialogueSessionId] = useState<string | null>(null);

  // Worked example state
  const [showWorkedExample, setShowWorkedExample] = useState(false);
  const [workedExample, setWorkedExample] = useState<any>(null);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);

  // Metacognitive reflection state
  const [selectedReflection, setSelectedReflection] = useState<string | null>(null);

  // Self-explanation prompt after correct answer (Generation Effect)
  // Triggers only on the session's first correct answer for this topic —
  // i.e. the moment the student demonstrates they "get it" for the first time.
  const [showSelfExplanation, setShowSelfExplanation] = useState(false);
  const [selfExplanation, setSelfExplanation] = useState('');
  const [savingSelfExplanation, setSavingSelfExplanation] = useState(false);
  const selfExplanationAttemptIdRef = useRef<string | undefined>(undefined);

  // Confidence judgment before submission (Calibration Effect) — opt-in
  const [confidence, setConfidence] = useState<'guess' | 'maybe' | 'sure' | null>(null);
  const [submittedConfidence, setSubmittedConfidence] = useState<'guess' | 'maybe' | 'sure' | null>(null);
  const [confidenceEnabled, setConfidenceEnabled] = useState(false);

  // Session mastery momentum (Visible Learning).
  const ownProgressRef = useRef<TodayTaskProgress>(createTodayTaskProgress());
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);

  // Feedback column resize
  const [feedbackWidth, setFeedbackWidth] = useState(420);
  const feedbackWidthRef = useRef(feedbackWidth);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const recognitionRef = useRef<any>(null);
  const feedbackDragCleanupRef = useRef<() => void>(() => {});

  // Hydrate from localStorage after mount (avoids SSR/client mismatch)
  useEffect(() => {
    const saved = localStorage.getItem('qld_feedback_width');
    if (saved) {
      const w = Number(saved);
      if (w >= 300 && w <= 560) setFeedbackWidth(w);
    }
    setConfidenceEnabled(localStorage.getItem('qld_confidence_enabled') === '1');
  }, []);

  useEffect(() => { feedbackWidthRef.current = feedbackWidth; }, [feedbackWidth]);
  useEffect(() => { localStorage.setItem('qld_feedback_width', String(feedbackWidth)); }, [feedbackWidth]);

  const handleFeedbackMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    feedbackDragCleanupRef.current();
    startX.current = e.clientX;
    startWidth.current = feedbackWidthRef.current;
    const onMove = (ev: MouseEvent) => {
      setFeedbackWidth(Math.max(300, Math.min(560, startWidth.current - (ev.clientX - startX.current))));
    };
    const cleanupDrag = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', cleanupDrag);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      feedbackDragCleanupRef.current = () => {};
    };
    feedbackDragCleanupRef.current = cleanupDrag;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', cleanupDrag);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleFeedbackResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? 20 : -20;
    setFeedbackWidth(width => Math.max(300, Math.min(560, width + delta)));
  }, []);

  // Lesson content state (shown above question, not in chat)
  const [lessonContent, setLessonContent] = useState<any>(null);
  const [showLessonContent, setShowLessonContent] = useState(false);
  
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState(false);
  const [lastAnswerIncorrect, setLastAnswerIncorrect] = useState(false);
  const [lastAnswerPendingReview, setLastAnswerPendingReview] = useState(false);
  const [nextStep, setNextStep] = useState<string | null>(null);
  const [howToFixHints, setHowToFixHints] = useState<{text: string; hint: string}[]>([]);
  const [showHowToFix, setShowHowToFix] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  // From the server: question payloads carry no answer key.
  const [revealedAnswer, setRevealedAnswer] = useState<string | null>(null);
  const usedShowAnswerRef = useRef(false);
  const supportLevelRef = useRef<0 | 1 | 2 | 3 | 4>(0);
  const [isExplaining, setIsExplaining] = useState(false);
  const [remediationRequired, setRemediationRequired] = useState(false);
  const submittingRef = useRef(false);
  const markRequestRef = useRef<{ key: string; requestId: string } | null>(null);
  const dialogueRequestRef = useRef<{ key: string; requestId: string } | null>(null);

  // Multi-part marks are awarded incrementally by the backend, but belong to
  // one root question from the learner's point of view. Keep the per-part
  // accounting intact while deferring the visible reward until the root is
  // complete (or the learner leaves it).
  const multiPartStarAwardRef = useRef({
    total: 0,
    shown: false,
    balance: null as number | null,
    level: null as number | null,
  });
  const resetMultiPartStarAward = useCallback(() => {
    multiPartStarAwardRef.current = { total: 0, shown: false, balance: null, level: null };
  }, []);
  const flushMultiPartStarAward = useCallback(() => {
    const award = multiPartStarAwardRef.current;
    if (award.shown || award.total <= 0) return;
    award.shown = true;
    showToast(`+${award.total}⭐  (balance ${award.balance ?? '—'} · Lv.${award.level ?? '?'})`, 'success');
  }, []);

  // Derived progressive disclosure state (UX Improvement 4)
  const helpVisibility: HelpVisibility = lastAnswerCorrect
    ? 'after_correct'
    : consecutiveErrors >= 2
      ? 'after_repeated_errors'
      : lastAnswerIncorrect
        ? 'after_first_error'
        : 'pre_attempt';

  // The answer input is read-only whenever Submit cannot send it (same rules as TutorControls).
  const answerLockReason: AnswerLockReason | null = remediationRequired
    ? 'remediation'
    : lastAnswerIncorrect
      ? 'incorrect'
      : lastAnswerPendingReview
        ? 'pending'
        : lastAnswerCorrect
          ? 'correct'
          : null;

  const errorBookHref = buildMistakesHref({
    subject,
    year: yearLevel
      ? (`year${yearLevel}` as YearLevel)
      : unit
        ? (`unit${unit}` as YearLevel)
        : undefined,
  });

  const toggleDictation = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Voice input is not supported in this browser. Please use Chrome or Edge.", 'error');
      return;
    }
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = getLocale();
    recognition.interimResults = false;
    
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setAnswer(prev => prev + (prev ? ' ' : '') + transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    
    recognitionRef.current = recognition;
    recognition.start();
  };

  useEffect(() => () => {
    feedbackDragCleanupRef.current();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        if (typeof recognition.abort === 'function') recognition.abort();
        else if (typeof recognition.stop === 'function') recognition.stop();
      } catch {
        // The browser may already have ended the recognition session.
      }
    }
  }, []);

  // The question-loading effect below reads the label without re-running when
  // the curriculum name arrives after the topic.
  const topicLabelRef = useRef(topicLabel);
  useEffect(() => { topicLabelRef.current = topicLabel; }, [topicLabel]);

  useEffect(() => {
    let active = true;

    // Detect URL cleanup after consuming a redo question: initialQuestionId went
    // from a real value to null because we deleted ?question= from the URL.
    // The question is already displayed — don't reset currentEx.
    const justCleanedUp =
      prevInitialQuestionId.current !== null &&
      initialQuestionId === null &&
      consumedInitialQuestionId.current === prevInitialQuestionId.current;
    prevInitialQuestionId.current = initialQuestionId;

    if (justCleanedUp) {
      setSuggestLoading(false);
      return () => { active = false; };
    }

    // Read show_answer flag from URL (set by Error Book Redo question when the
    // student already viewed the correct answer there). Persists in ref so the
    // flag survives URL cleanup and is available when the answer is submitted.
    usedShowAnswerRef.current = false;
    supportLevelRef.current = 0;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('show_answer') === '1') {
        usedShowAnswerRef.current = true;
        supportLevelRef.current = 4;
      }
    }

    flushMultiPartStarAward();
    resetMultiPartStarAward();
    markRequestRef.current = null;
    dialogueRequestRef.current = null;
    setCurrentEx(null);
    setAnswer("");
    setMultiPartResults([]);
    setActiveMultipartLabel(null);
    setSuggestedActions([]);
    setDialogueDisabled(false);
    setDialogueSessionId(null);
    setConsecutiveErrors(0);
    setLastAnswerCorrect(false);
    setLastAnswerIncorrect(false);
    setLastAnswerPendingReview(false);
    setSelectedReflection(null);
    setShowSelfExplanation(false);
    setSelfExplanation('');
    selfExplanationAttemptIdRef.current = undefined;
    setConfidence(null);
    setSubmittedConfidence(null);
    setLessonContent(null);
    setShowLessonContent(false);
    setWorkedExample(null);
    setShowWorkedExample(false);
    if (loadingExercises) {
      setSuggestLoading(true);
      setChat([]);
    } else if (exerciseLoadError && topic) {
      setSuggestLoading(false);
      setChat([{ role: 'system', content: 'The practice question could not load. Check the connection and try again.', type: 'error' }]);
    } else if (exercises && exercises.length > 0) {
      setSuggestLoading(true);
      if (initialQuestionId && initialQuestionId !== consumedInitialQuestionId.current) {
        consumedInitialQuestionId.current = initialQuestionId;
        const target = exercises.find((ex: any) => ex.id === initialQuestionId) || exercises[0];
        setCurrentEx(target);
        setSuggestLoading(false);
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          let changed = false;
          if (url.searchParams.has('question')) {
            url.searchParams.delete('question');
            changed = true;
          }
          if (url.searchParams.has('show_answer')) {
            url.searchParams.delete('show_answer');
            changed = true;
          }
          if (changed) {
            window.history.replaceState(null, '', url.pathname + url.search);
          }
        }
      } else if (consumedInitialQuestionId.current === null) {
        // No redo question ever consumed → normal tutorSuggest flow
        tutorSuggest(topic, "retrieve", undefined, undefined, subject, yLevel, uVal)
          .then((res) => {
            if (active) {
              if (res.question) {
                setCurrentEx(res.question);
              } else {
                setCurrentEx(exercises[0]);
              }
            }
          })
          .catch(() => {
            if (active) {
              setCurrentEx(exercises[0]);
            }
          })
          .finally(() => {
            if (active) {
              setSuggestLoading(false);
            }
          });
      } else {
        // Already consumed a redo question, initialQuestionId is gone (URL cleaned)
        // Nothing to load, ensure suggestLoading is false
        setSuggestLoading(false);
      }
      setChat([{ role: 'system', content: `Started topic: ${topicLabelRef.current}. Try solving the question above!` }]);
          setMultiPartResults([]);
      setActiveMultipartLabel(null);
      setSuggestedActions([]);
      setDialogueDisabled(false);
      setDialogueSessionId(null);
      setConsecutiveErrors(0);
      setNextStep(null);
      setShowHowToFix(false);
      setShowAnswer(false);
      setLastAnswerCorrect(false);
      setLastAnswerIncorrect(false);
      setLastAnswerPendingReview(false);
      setSelectedReflection(null);
      setShowSelfExplanation(false);
    setSelfExplanation('');
    selfExplanationAttemptIdRef.current = undefined;
      setConfidence(null);
      setSubmittedConfidence(null);
      setLessonContent(null);
      setShowLessonContent(false);
      // Pre-fetch worked example so the button works, but do NOT auto-show.
      // The panel only appears when the student clicks "Show Worked Example"
      // or after 2 consecutive incorrect answers.
      setShowWorkedExample(false);
      fetchTopicWorkedExample(topic)
        .then((data) => {
          if (active) {
            if (data.has_worked_example) {
              setWorkedExample(data);
            } else {
              setWorkedExample(null);
            }
          }
        })
        .catch(() => {
          if (active) setWorkedExample(null);
        });
    } else {
      setCurrentEx(null);
      setSuggestLoading(false);
      // With no topic selected, the empty-state card already guides the student.
      setChat(topic
        ? [{ role: 'system', content: `No exercises available for ${topicLabelRef.current} yet. Try another topic from the curriculum tree.` }]
        : []);
          setMultiPartResults([]);
      setActiveMultipartLabel(null);
      setSuggestedActions([]);
      setDialogueDisabled(false);
      setDialogueSessionId(null);
      setConsecutiveErrors(0);
      setSelectedReflection(null);
      setShowSelfExplanation(false);
    setSelfExplanation('');
    selfExplanationAttemptIdRef.current = undefined;
      setConfidence(null);
      setSubmittedConfidence(null);
      setWorkedExample(null);
      setShowWorkedExample(false);
    }

    return () => {
      active = false;
    };
  }, [topic, exercises, loadingExercises, exerciseLoadError, initialQuestionId, subject, yLevel, uVal, flushMultiPartStarAward, resetMultiPartStarAward]);

  const addChat = (role: 'tutor'|'system'|'student', content: string, type?: 'success'|'error'|'dialogue') => {
    setChat(prev => [...prev, { role, content, type }]);
  };

  const recordSupport = (level: 1 | 2 | 3 | 4) => {
    supportLevelRef.current = Math.max(supportLevelRef.current, level) as 0 | 1 | 2 | 3 | 4;
  };

  // `loading` also locks Next and Try Again, so the answer cannot land on a different question.
  const handleShowAnswer = async () => {
    if (!currentEx || loading) return;
    if (!window.confirm('Are you sure? The tutor will show you the correct answer.')) return;
    setLoading(true);
    try {
      const res = await tutorShowAnswer(currentEx.id);
      const text = String(res.correct_answer ?? '').trim();
      if (!text) {
        showToast('This question has no saved answer.', 'error');
        return;
      }
      usedShowAnswerRef.current = true;
      recordSupport(4);
      setRevealedAnswer(text);
      setShowAnswer(true);
    } catch {
      showToast('Could not load the answer. Try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleExplain = async () => {
    recordSupport(1);
    setLoading(true);
    try {
      const res = await tutorExplain(topic);
      if (res.has_lesson_content) {
        setLessonContent(res);
        setShowLessonContent(true);
        setRemediationRequired(false);
        addChat('system', '📖 Lesson content loaded. Read above, then try again.');
      } else {
        addChat('tutor', res.explanation || '');
        setRemediationRequired(false);
      }
    } catch {
      addChat('system', 'Failed to connect to Tutor Engine.', 'error');
    }
    setLoading(false);
  };

  const recordRootMomentum = (isCorrect: boolean) => {
    const progressStore = ownProgressRef.current;
    if (!currentEx || progressStore.countedQuestionIds.has(currentEx.id)) return;
    progressStore.countedQuestionIds.add(currentEx.id);
    setSessionTotal(progressStore.countedQuestionIds.size);
    if (isCorrect) {
      progressStore.correctQuestionIds.add(currentEx.id);
      setSessionCorrect(progressStore.correctQuestionIds.size);
    }
  };

  const handleSubmit = async () => {
    if (!currentEx || !answer.trim() || submittingRef.current || lastAnswerCorrect || lastAnswerIncorrect || lastAnswerPendingReview) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      let submitAnswer = answer;
      let submittedPartLabel = "";
      if (currentEx.question_type === 'multi_part') {
        const nextUnanswered = currentEx.sub_parts?.find((p: SubPart) => {
          const partLabel = String(p.label || "").toLowerCase().trim();
          const r = multiPartResults.find((res: SubPartResult) => String(res.label || "").toLowerCase().trim() === partLabel);
          return !r || !r.student_answer; // Not yet attempted
        }) || currentEx.sub_parts?.find((p: SubPart) => {
          const partLabel = String(p.label || "").toLowerCase().trim();
          const r = multiPartResults.find((res: SubPartResult) => String(res.label || "").toLowerCase().trim() === partLabel);
          return r?.is_correct === false && !!r.student_answer; // Incorrect — allow retry
        });

        let activePart = nextUnanswered;
        if (activeMultipartLabel) {
          const selected = currentEx.sub_parts?.find((p: SubPart) => String(p.label || "").toLowerCase().trim() === activeMultipartLabel);
          if (selected) {
            const r = multiPartResults.find((res: SubPartResult) => String(res.label || "").toLowerCase().trim() === activeMultipartLabel);
            if (!r?.is_correct) {
              activePart = selected;
            }
          }
        }

        if (activePart) {
          submittedPartLabel = String(activePart.label).toLowerCase().trim();
          submitAnswer = JSON.stringify({ [submittedPartLabel]: answer.trim() });
        } else if (currentEx.question_type === 'multi_part') {
          return; // All parts answered, nothing to submit
        }
      }
      const confidenceSnapshot = confidence;
      setSubmittedConfidence(confidenceSnapshot);
      const markRequestKey = `${currentEx.id}|${submitAnswer}`;
      const markRequest = markRequestRef.current?.key === markRequestKey
        ? markRequestRef.current
        : { key: markRequestKey, requestId: newMutationRequestId('tutor-mark') };
      markRequestRef.current = markRequest;
      const isFirstAttempt = consecutiveErrors === 0 && multiPartResults.length === 0;
      const res = await tutorMark(currentEx.id, submitAnswer, undefined, {
        requestId: markRequest.requestId,
        usedShowAnswer: usedShowAnswerRef.current,
        supportLevel: supportLevelRef.current,
        confidence: confidenceSnapshot,
        guidedPhase: 'guided',
        firstAttempt: isFirstAttempt,
        correctionCompleted: consecutiveErrors > 0,
        isRevision: revisionTopic?.topic_id === topic,
      });
      if (res.retryable !== true) {
        markRequestRef.current = null;
      }
      if (res.attempt_id) {
        selfExplanationAttemptIdRef.current = res.attempt_id;
      }
      if (res.part_results) {
        setMultiPartResults(res.part_results);
      }
      // A retryable reply is not a mark: keep the text so the same answer can be sent again.
      if (currentEx.question_type === 'multi_part' && res.retryable !== true) {
        setAnswer("");
      }

      const isMultiPartQuestion = currentEx.question_type === 'multi_part';
      const responsePartResults = res.part_results ?? multiPartResults;
      const award = (res as { quest_award?: { awarded?: number; stars?: number; level?: number } }).quest_award;
      if (award && typeof award.awarded === 'number' && award.awarded > 0) {
        if (isMultiPartQuestion) {
          multiPartStarAwardRef.current.total += award.awarded;
          if (typeof award.stars === 'number') multiPartStarAwardRef.current.balance = award.stars;
          if (typeof award.level === 'number') multiPartStarAwardRef.current.level = award.level;
        } else {
          showToast(`+${award.awarded}⭐  (balance ${award.stars ?? '—'} · Lv.${award.level ?? '?'})`, 'success');
        }
      }

      let isPartSubmissionCorrect = false;
      if (isMultiPartQuestion && submittedPartLabel && res.part_results) {
        const matchingPart = res.part_results.find((r: SubPartResult) => String(r.label || "").toLowerCase().trim() === submittedPartLabel);
        if (matchingPart?.is_correct) {
          isPartSubmissionCorrect = true;
        }
      }

      const isSuccess = res.retryable !== true && (res.is_correct || (isMultiPartQuestion && isPartSubmissionCorrect));
      const allPartsComplete = isMultiPartQuestion
        ? Boolean(currentEx.sub_parts?.length && currentEx.sub_parts.every((p: SubPart) => {
            const pl = String(p.label || "").toLowerCase().trim();
            return responsePartResults.find((pr: SubPartResult) => String(pr.label || "").toLowerCase().trim() === pl)?.is_correct === true;
          }))
        : true;
      if (isMultiPartQuestion && allPartsComplete) {
        flushMultiPartStarAward();
      }

      if (isSuccess) {
        if (currentEx.question_type === 'multi_part') {
          setActiveMultipartLabel(null);
        }
        let successMsg = `✅ **Correct!** 🎉\n${(res.feedback || 'Great job!').replace(/^\s*Correct\b[!.]?\s*/i, '') || 'Well done.'}\n\n💪 Ready for the next challenge? Click **Next →**`;
        if (currentEx.question_type === 'multi_part') {
          const nextUnanswered = currentEx.sub_parts?.find((p: SubPart) => {
            const partLabel = String(p.label || "").toLowerCase().trim();
            const r = res.part_results?.find((pr: SubPartResult) => String(pr.label || "").toLowerCase().trim() === partLabel);
            return !r || !r.student_answer; // Not yet attempted
          }) || currentEx.sub_parts?.find((p: SubPart) => {
            const partLabel = String(p.label || "").toLowerCase().trim();
            const r = res.part_results?.find((pr: SubPartResult) => String(pr.label || "").toLowerCase().trim() === partLabel);
            return r?.is_correct === false && !!r.student_answer; // Incorrect — allow retry
          });
          if (nextUnanswered) {
            successMsg = `✅ **Part (${submittedPartLabel.toUpperCase()}) is correct!** Now try Part (${nextUnanswered.label.toUpperCase()}).\n\n${res.feedback}`;
          } else {
            successMsg = `🎉 **All parts correct! Excellent job!**\n\n${res.feedback}`;
          }
        }
        // Show score for reasoning questions
        if (res.question_type === 'reasoning' && res.score !== undefined) {
          const adapter = getSubjectAdapter(currentEx?.subject || subject);
          const outcome = adapter.partialSuccessLabel(res.score, res.max_score || 1);
          successMsg = `✅ **${outcome.label}**\nScore: ${res.score}/${res.max_score}\n\n${res.feedback}`;
          if (res.key_points_met?.length) {
            successMsg += `\n\n**Key points demonstrated:** ${res.key_points_met.length}`;
          }
          if (res.key_points?.length) {
            const missedDetails = res.key_points.filter((kp: any) => !kp.met && kp.how_to_fix);
            if (missedDetails.length > 0) {
              successMsg += `\n\n**How to reach full marks:**\n${missedDetails.map((kp: any) => `- ${kp.how_to_fix}`).join('\n')}`;
            }
          }
        }
        // `allPartsComplete` is computed from the full multi-part response above,
        // so momentum and self-explanation stay at root-question granularity.
        addChat('tutor', successMsg, 'success');
        onMarkSuccess?.(allPartsComplete);

        // Prompt only when generation is pedagogically useful: after a
        // correction, scaffolded success, or a low-confidence correct answer.
        if (
          allPartsComplete
          && sessionCorrect < 2
          && (consecutiveErrors > 0 || supportLevelRef.current > 0 || confidenceSnapshot === 'guess')
        ) {
          setShowSelfExplanation(true);
        }

        if (allPartsComplete) recordRootMomentum(true);
        setConsecutiveErrors(0);
        setNextStep(null);
        setShowWorkedExample(false);
        setShowAnswer(false);
        setLastAnswerCorrect(allPartsComplete);
        setLastAnswerIncorrect(false);
        // Keep the submitted confidence snapshot visible until Next/new question.
        setDialogueDisabled(false);
        setSuggestedActions([]);
      } else {
        const matchingPart = res.part_results?.find((r: SubPartResult) => String(r.label || "").toLowerCase().trim() === submittedPartLabel);
        const isPendingReview = res.outcome === 'pending'
          || res.error_type === 'parent_review_pending'
          || res.retryable === true
          || (currentEx.question_type === 'multi_part' && matchingPart?.error_type === 'parent_review_pending');

        let feedback = '';
        if (isPendingReview) {
          const neutralMessage = res.retryable
            ? 'Your answer could not be confirmed yet. It has not been marked incorrect; you can retry the submission or continue.'
            : (res.feedback || 'Your answer has been saved for parent review. You can continue to the next question.');
          if (currentEx.question_type === 'multi_part') {
            feedback = res.retryable
              ? `⏳ **Part (${submittedPartLabel.toUpperCase()}) could not be confirmed yet**\n\n${neutralMessage}`
              : `👁️ **Part (${submittedPartLabel.toUpperCase()}) saved for review — not yet marked**\n\n${neutralMessage}`;
          } else {
            feedback = res.retryable
              ? `⏳ **Not marked yet**\n\n${neutralMessage}`
              : `👁️ **Saved for review — not yet marked**\n\n${neutralMessage}`;
          }
        } else if (res.question_type === 'reasoning' && res.score !== undefined) {
          const adapter = getSubjectAdapter(currentEx?.subject || subject);
          const outcome = adapter.partialSuccessLabel(res.score, res.max_score || 1);
          const hasRubricCredit = res.score > 0;
          const verdictIcon = hasRubricCredit ? '📊' : '❌';
          feedback = `${verdictIcon} **${outcome.label}**\nScore: ${res.score}/${res.max_score}\n\n${res.feedback}`;
          if (res.key_points_met?.length) {
            feedback += `\n\n✅ **Key points demonstrated:** ${res.key_points_met.length}`;
          }
          if (res.key_points_missed?.length) {
            feedback += `\n\n❌ **Still needed:** ${res.key_points_missed.length} rubric point${res.key_points_missed.length === 1 ? '' : 's'} need more work. Try revising your reasoning before requesting help.`;
          }
          // Store how_to_fix hints for later reveal; show why_missed as diagnosis
          if (res.key_points?.length) {
            const missed = res.key_points.filter((kp: any) => !kp.met);
            if (missed.length > 0) {
              feedback += '\n\n🔍 **What you missed:**';
              const hints: {text: string; hint: string}[] = [];
              for (const [idx, kp] of missed.entries()) {
                const safeLabel = `Point ${idx + 1}`;
                feedback += `\n\n🔸 **${safeLabel}**`;
                if (kp.why_missed) feedback += `\n   📝 ${kp.why_missed}`;
                if (kp.how_to_fix) {
                  hints.push({ text: safeLabel, hint: kp.how_to_fix });
                }
              }
              if (hints.length > 0) {
                setHowToFixHints(hints);
                setShowHowToFix(false);
              }
            }
          }
        } else if (currentEx.question_type === 'multi_part') {
          feedback = `❌ **Part (${submittedPartLabel.toUpperCase()}) is incorrect.**\n${res.feedback}`;
        } else {
          // Short-answer or MCQ feedback
          feedback = `❌ **Incorrect.**\n${res.feedback}`;
          if (res.error_type && res.error_type !== 'incorrect_choice' && res.error_type !== 'parent_review_pending') {
            const errorLabel = ERROR_TYPE_LABELS[res.error_type] ?? humanise(res.error_type);
            feedback += `\n\n*Error type: ${errorLabel}*`;
          }
          feedback += `\n\n✏️ Click **Explain my answer** below — write your reasoning step by step and I'll help you find where you went wrong.`;
        }

        if (!isPendingReview) {
          if (res.error_pattern) {
            feedback += `\n\n🔍 **Pattern detected:** ${res.error_pattern}`;
          }
          // Phase 8: Misconception-aware feedback (Req 7.1)
          if (res.misconception_id) {
            try {
              let mcName = res.misconception_name ?? undefined;
              let mcExplanation = res.misconception_explanation ?? undefined;
              // Fall back to a lookup only if the mark response didn't carry the
              // name/explanation (older cache); avoids an extra round-trip (LX2).
              if (!mcName || !mcExplanation) {
                const topicId = currentEx.topic_ids?.[0] || currentEx.topic;
                const misconceptions = await fetchMisconceptions({ topic_id: topicId });
                const matched = misconceptions.find((m: { misconception_id?: string; name?: string; student_facing_explanation?: string }) => m.misconception_id === res.misconception_id);
                if (matched) {
                  mcName = matched.name;
                  mcExplanation = matched.student_facing_explanation;
                }
              }
              if (mcName && mcExplanation) {
                feedback += `\n\n💡 **Common misconception:** ${mcName}\n\n${mcExplanation}`;
              }
              if (workedExample?.worked_example) {
                feedback += `\n\n📖 A worked example is available below if you need it after another try.`;
              } else {
                feedback += `\n\n📖 Try the next nudge or explain your working before looking for a full example.`;
              }
            } catch {
              // Non-critical: misconception fetch failed, show basic feedback
            }
          }
          // Store next_step for explicit reveal instead of auto-showing it.
          if (res.new_misconception?.name) {
            feedback += `\n\n🧠 **Common mistake:** ${res.new_misconception.name}\n${res.new_misconception.student_facing_explanation || ''}`;
          }
        }

        addChat('tutor', feedback, isPendingReview ? 'dialogue' : 'error');
        if (!isPendingReview) onMarkSuccess?.(false);
        if (!isPendingReview && currentEx.question_type !== 'multi_part') recordRootMomentum(false);
        setLastAnswerCorrect(false);
        // Stay on the part that was just marked, so its result and Try Again refer to it.
        if (currentEx.question_type === 'multi_part' && submittedPartLabel) {
          setActiveMultipartLabel(submittedPartLabel);
        }
        if (res.retryable === true) {
          // Not marked yet: leave the answer open so the student can send it again.
          setLastAnswerIncorrect(false);
          setLastAnswerPendingReview(false);
          setNextStep(null);
        } else if (isPendingReview) {
          setLastAnswerIncorrect(false);
          setLastAnswerPendingReview(true);
          setNextStep(null);
        } else {
          setLastAnswerIncorrect(true);
          setLastAnswerPendingReview(false);
          setNextStep(res.next_step || null);
          // Calibration feedback: high-confidence error is a metacognitive signal
          if (confidenceEnabled && confidenceSnapshot === 'sure') {
            addChat('system', '🎯 You were confident but incorrect — this signals a concept gap worth investigating carefully.', 'error');
          }
          // Keep submitted confidence for calibration feedback until retry/Next.
          // Track consecutive errors. After 3, require remediation before next attempt.
          const newErrors = consecutiveErrors + 1;
          setConsecutiveErrors(newErrors);
          if (newErrors === 2 && workedExample?.worked_example && !showWorkedExample) {
            addChat('system', '💡 You seem stuck. Try one more nudge or explain your working first; the worked example button is available if you still need it.', 'error');
          }
          if (newErrors >= 3) {
            setRemediationRequired(true);
            addChat('system', '📚 Let\'s review the concept first. Please read the lesson above or explain your working before trying again.', 'error');
          }
        }
      }
    } catch (e) {
      const errorMsg = (e as any)?.message || '';
      if (errorMsg.includes('student_answer_too_long')) {
        addChat('system', 'Your answer is too long. Please keep it under 1000 characters.', 'error');
      } else {
        addChat('system', 'Could not confirm this answer. It was not marked incorrect; check the connection and submit the same answer again.', 'error');
      }
    }
    setLoading(false);
    submittingRef.current = false;
  };

  const handleSaveSelfExplanation = async () => {
    if (!currentEx || !hasMinimumSelfExplanation(selfExplanation) || savingSelfExplanation) return;
    setSavingSelfExplanation(true);
    try {
      await updateTutorAttemptMetadata(
        currentEx.id,
        selfExplanationAttemptIdRef.current,
        selfExplanation.trim(),
      );
      setShowSelfExplanation(false);
      setSelfExplanation('');
    } catch (error) {
      console.error('Failed to save self-explanation:', error);
      showToast('Please try saving your explanation again.', 'error');
    } finally {
      setSavingSelfExplanation(false);
    }
  };

  const handleNext = async () => {
    if (showSelfExplanation) return;
    if (
      currentEx?.question_type === 'multi_part'
      && !lastAnswerPendingReview
      && multiPartResults.some(part => Boolean(part.student_answer?.trim()))
    ) {
      recordRootMomentum(false);
    }
    flushMultiPartStarAward();
    setLoading(true);
    markRequestRef.current = null;
    dialogueRequestRef.current = null;
    try {
      // Always use backend smart selection for personalised question ordering
      const res = await tutorSuggest(topic, "retrieve", currentEx?.id, undefined, subject, yLevel, uVal);
      if (res.question) {
        resetMultiPartStarAward();
        setCurrentEx(res.question);
        setAnswer("");
        setChat([]);
        setMultiPartResults([]);
                setSuggestedActions([]);
        setDialogueDisabled(false);
        setDialogueSessionId(null);
        setLastAnswerCorrect(false);
        setLastAnswerIncorrect(false);
        setLastAnswerPendingReview(false);
        setSelectedReflection(null);
        setShowSelfExplanation(false);
    setSelfExplanation('');
    selfExplanationAttemptIdRef.current = undefined;
        setConfidence(null);
        setSubmittedConfidence(null);
        usedShowAnswerRef.current = false;
        supportLevelRef.current = 0;
        setNextStep(null);
        setConsecutiveErrors(0);
        setHowToFixHints([]);
        setShowHowToFix(false);
        setLessonContent(null);
        setShowLessonContent(false);
        setRemediationRequired(false);
        setShowWorkedExample(false);
        setShowAnswer(false);

        if (res.all_seen) {
          addChat('system', `You have tried all questions for this topic. Review incorrect ones via the Error Book, or choose a new topic.`);
        }
      } else {
        addChat('system', 'No more questions available for this topic. Try selecting a different topic.', 'error');
      }
    } catch (e) {
      console.error('handleNext error:', e);
      addChat('system', 'Failed to load the next question.', 'error');
    }
    setLoading(false);
  };

  const handleDialogueSend = async (msg: string) => {
    if (!currentEx || !msg || dialogueDisabled) return;

    // Handle "explain my answer" locally — no backend call
    if (msg === "explain_my_answer") {
      recordSupport(2);
      setIsExplaining(true);
      setSuggestedActions([]);
      addChat('system', 'Write your step-by-step solution below. I\'ll analyse each step and help you find the error.');
      return;
    }
    if (msg === "show_worked_example") {
      recordSupport(3);
      setShowWorkedExample(true);
      setSuggestedActions([]);
      addChat('system', workedExample ? 'Worked example opened above.' : 'No worked example is available for this topic yet.');
      return;
    }
    if (msg === "give_next_step") {
      recordSupport(2);
      setSuggestedActions([]);
      if (nextStep) {
        addChat('tutor', `💡 **Next nudge:** ${nextStep}`, 'dialogue');
        setNextStep(null);
      } else {
        addChat('system', 'No next nudge is available yet. Try explaining your working.');
      }
      return;
    }
    if (msg === "try_again") {
      setAnswer("");
      setLastAnswerIncorrect(false);
      setConfidence(null);
      setSubmittedConfidence(null);
      setNextStep(null);
      setShowHowToFix(false);
      setSuggestedActions([]);
      addChat('system', 'Try the question again with your revised thinking.');
      return;
    }
    if (msg === "mark_final_answer") {
      setSuggestedActions([]);
      if (!answer.trim()) {
        addChat('system', 'Type an answer first, then submit it for marking.');
        return;
      }
      void handleSubmit();
      return;
    }
    if (msg === "change_topic") {
      setSuggestedActions([]);
      if (onGoToTopic) {
        onGoToTopic();
      } else {
        addChat('system', 'Choose a topic from the curriculum tree on the left to change topic.');
      }
      return;
    }

    // Any free-form tutor turn is step/chat help. Action branches above record
    // their more specific support level before returning.
    recordSupport(2);

    // Prepend [EXPLAINING] when student is sharing their reasoning steps.
    // Before any attempt, prepend a PRE_ATTEMPT prefix so the backend dialogue
    // handler withholds the final answer / first solution step and nudges the
    // student to try first — matching Guided Practice (Audit LX1).
    let messageToSend = msg;
    if (isExplaining) {
      messageToSend = "[EXPLAINING] " + msg;
      setIsExplaining(false);
    } else if (helpVisibility === 'pre_attempt' && !SUPPORTED_ACTIONS.has(msg)) {
      const wantsFirstStep = /first step|where (do|should) i start|how (do|should) i start|get me started|begin/i.test(msg);
      messageToSend = (wantsFirstStep ? "[PRE_ATTEMPT_FIRST_STEP] " : "[PRE_ATTEMPT_CONCEPT] ") + msg;
    }

    // Show student message in chat (unless it's an action enum)
    const isAction = SUPPORTED_ACTIONS.has(msg);
    if (!isAction) {
      addChat('student', msg, 'dialogue');
    } else {
      addChat('student', ACTION_LABELS[msg] || msg, 'dialogue');
    }

    setDialogueLoading(true);
    setSuggestedActions([]);

    try {
      const dialogueRequestKey = `${currentEx.id}|${messageToSend}`;
      const dialogueRequest = dialogueRequestRef.current?.key === dialogueRequestKey
        ? dialogueRequestRef.current
        : { key: dialogueRequestKey, requestId: newMutationRequestId('tutor-dialogue') };
      dialogueRequestRef.current = dialogueRequest;
      const res = await tutorDialogue(currentEx.id, messageToSend, undefined, dialogueRequest.requestId);
      dialogueRequestRef.current = null;

      setSuggestedActions((res.suggested_actions || []).filter(action => SUPPORTED_ACTIONS.has(action)));
      setDialogueSessionId(res.dialogue_session_id ?? null);
    } catch (e) {
      const errorMsg = (e as any)?.message || '';
      if (errorMsg.includes('429') && errorMsg.includes('dialogue_session_cap_reached')) {
        showToast("Dialogue cap reached for this question. Submit your answer or try a different question.", 'error');
        setDialogueDisabled(true);
        setSuggestedActions([]);
      } else if (errorMsg.includes('student_message_too_long')) {
        addChat('system', 'Your message is too long. Please keep it under 1000 characters.', 'error');
      } else {
        addChat('system', 'Failed to send message to tutor.', 'error');
      }
    }
    setDialogueLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const isInput = e.currentTarget.tagName.toLowerCase() === 'input';
    const shouldSubmit = isInput
      ? e.key === 'Enter'
      : (e.metaKey || e.ctrlKey) && e.key === 'Enter';
    if (shouldSubmit && answer.trim() && !lastAnswerCorrect && !lastAnswerIncorrect && !lastAnswerPendingReview && !loading) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleReflectionSelect = async (val: string) => {
    if (!currentEx) return;
    setSelectedReflection(val);
    try {
      await tutorReflect(currentEx.id, val);
    } catch (e) {
      console.error('Failed to save reflection:', e);
    }
  };

  return (
    <div id="practice-area" className="glass-panel" style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <TutorHeader
        currentEx={currentEx}
        onExplain={handleExplain}
        feedbackWidth={feedbackWidth}
        topic={topic}
        topicName={topicName}
        subject={subject}
        yearLevel={yearLevel}
        unit={unit}
        sessionCorrect={sessionCorrect}
        sessionTotal={sessionTotal}
      />

      {/* Main Content Area */}
      <div className="tutor-main-layout">
        
        {/* Left: Question Area */}
        <div className="tutor-question-column">
          {/* Lesson Content Panel — shown after clicking Explain Concept */}
          {showLessonContent && lessonContent && (
            <LessonContentPanel
              lessonContent={lessonContent}
              topic={topicLabel}
              labLink={labLink}
              onDismiss={() => setShowLessonContent(false)}
            />
          )}

          {/* Worked Example Panel — shown on first visit or after consecutive errors */}
          {showWorkedExample && workedExample && (
            <WorkedExamplePanel
              workedExample={workedExample}
              onDismiss={() => setShowWorkedExample(false)}
            />
          )}

          {currentEx ? (
            <>
              <QuestionDisplay exercise={currentEx} />

              <AnswerInputArea
                exercise={currentEx}
                answer={answer}
                multiPartResults={multiPartResults}
                activeMultipartLabel={activeMultipartLabel}
                remediationRequired={remediationRequired}
                lockReason={answerLockReason}
                showMathToolbar={showMathToolbar}
                onSetAnswer={setAnswer}
                onSetActivePart={(label) => {
                  // Choosing another part ends the shown result of the last part.
                  setActiveMultipartLabel(label);
                  setLastAnswerIncorrect(false);
                  setLastAnswerPendingReview(false);
                  setConfidence(null); setSubmittedConfidence(null); setNextStep(null); setShowHowToFix(false); setShowAnswer(false);
                }}
                onKeyDown={handleKeyDown}
                onShowWorkedExample={helpVisibility !== 'pre_attempt' ? () => { recordSupport(3); setShowWorkedExample(true); } : undefined}
                onExplainConcept={handleExplain}
                onUnlock={() => {
        setRemediationRequired(false);
        setShowAnswer(false);
                  setConsecutiveErrors(0);
                  setLastAnswerIncorrect(false);
                  setNextStep(null);
                }}
              />

              {lastAnswerIncorrect && !lastAnswerCorrect && currentEx && (
                <div
                  className="animate-fade-in"
                  style={{
                    padding: '14px 16px',
                    marginBottom: '14px',
                    border: '1.5px solid rgba(245, 158, 11, 0.4)',
                    background: 'var(--bg-secondary)',
                    borderRadius: '10px',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px' }}>💡</span>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Why did this happen?
                      </h4>
                      <span style={{ fontSize: '13px', padding: '2px 8px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.15)', color: '#d97706', fontWeight: 600 }}>
                        Self Reflection
                      </span>
                    </div>
                  </div>
                  <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    Identify the root cause to help AI tailor your personalized review and advance your Error Book closure.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {getErrorCauseOptions(currentEx.subject || subject).map((opt) => {
                      const isSelected = selectedReflection === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => handleReflectionSelect(opt.value)}
                          style={{
                            textAlign: 'left',
                            padding: '9px 12px',
                            fontSize: '13px',
                            borderRadius: '8px',
                            border: isSelected ? '1.5px solid var(--accent-color)' : '1px solid var(--border-color)',
                            background: isSelected ? 'rgba(59, 130, 246, 0.12)' : 'var(--bg-primary)',
                            color: isSelected ? 'var(--accent-color)' : 'var(--text-primary)',
                            fontWeight: isSelected ? 600 : 400,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                          }}
                        >
                          <span>{opt.emoji}</span>
                          <span>{opt.label}</span>
                          {isSelected && <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: 'bold', background: 'var(--accent-color)', color: '#fff', padding: '2px 6px', borderRadius: '4px' }}>✓ Tagged</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Self-Explanation prompt after a supported/corrected success */}
              {lastAnswerCorrect && showSelfExplanation && (
                <div
                  className="animate-fade-in"
                  style={{
                    padding: '14px 16px', marginBottom: '14px',
                    border: '1.5px solid rgba(34,197,94,0.35)',
                    background: 'rgba(34,197,94,0.05)',
                    borderRadius: '10px',
                    display: 'flex', flexDirection: 'column', gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '16px' }}>🧠</span>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Explain why this works before you continue
                    </h4>
                    <span style={{ fontSize: '13px', padding: '2px 8px', borderRadius: '12px', background: 'rgba(34,197,94,0.15)', color: '#16a34a', fontWeight: 600 }}>
                      Deepens memory
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    In your own words, name the rule or reasoning that made this answer work. Use at least {MIN_SELF_EXPLANATION_WORDS} words.
                  </p>
                  <textarea
                    aria-label="Self explanation"
                    className="auto-growing-textarea"
                    value={selfExplanation}
                    onChange={event => setSelfExplanation(event.target.value)}
                    maxLength={300}
                    rows={2}
                    placeholder="The answer works because…"
                    style={{ maxHeight: 'min(35dvh, 240px)', padding: '9px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical' }}
                  />
                  <div style={{ fontSize: '13px', color: hasMinimumSelfExplanation(selfExplanation) ? '#15803d' : 'var(--text-muted)' }}>
                    {selfExplanationWordCount(selfExplanation)}/{MIN_SELF_EXPLANATION_WORDS} words minimum
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveSelfExplanation}
                    disabled={!hasMinimumSelfExplanation(selfExplanation) || savingSelfExplanation}
                    style={{ alignSelf: 'flex-start', marginTop: '2px', fontSize: '13px', padding: '7px 12px', borderRadius: '7px', background: 'var(--accent-color)', color: '#fff', border: 'none', cursor: hasMinimumSelfExplanation(selfExplanation) && !savingSelfExplanation ? 'pointer' : 'not-allowed', opacity: hasMinimumSelfExplanation(selfExplanation) && !savingSelfExplanation ? 1 : 0.55, fontWeight: 700 }}
                  >
                    {savingSelfExplanation ? 'Saving…' : 'Save explanation'}
                  </button>
                </div>
              )}

              {/* Confidence judgment before submission (Calibration) — opt-in via settings */}
              {confidenceEnabled && !lastAnswerCorrect && !lastAnswerIncorrect && !lastAnswerPendingReview && answer.trim() && (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>How sure?</span>
                  {([['guess', '🎲 Guessing'], ['maybe', '🤔 Probably'], ['sure', '💪 Certain']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setConfidence(val)}
                      style={{
                        padding: '4px 10px', fontSize: '13px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
                        border: confidence === val ? '1.5px solid var(--accent-color)' : '1px solid var(--border-color)',
                        background: confidence === val ? 'rgba(99,102,241,0.12)' : 'transparent',
                        color: confidence === val ? 'var(--accent-color)' : 'var(--text-secondary)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Calibration positive feedback after correct + confident */}
              {confidenceEnabled && lastAnswerCorrect && submittedConfidence === 'sure' && (
                <div style={{ fontSize: '13px', color: '#16a34a', marginBottom: '8px', fontWeight: 600 }}>
                  🎯 Confident and correct — well calibrated!
                </div>
              )}
              {confidenceEnabled && lastAnswerCorrect && submittedConfidence === 'guess' && (
                <div style={{ fontSize: '13px', color: '#d97706', marginBottom: '8px', fontWeight: 600 }}>
                  🍀 Lucky guess! Review why this works to strengthen the memory.
                </div>
              )}

              {/* Confidence mode toggle — unobtrusive opt-in/out */}
              {!lastAnswerCorrect && !lastAnswerIncorrect && !lastAnswerPendingReview && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !confidenceEnabled;
                    setConfidenceEnabled(next);
                    localStorage.setItem('qld_confidence_enabled', next ? '1' : '0');
                    if (!next) setConfidence(null);
                  }}
                  style={{
                    background: 'transparent', border: 'none',
                    padding: '9px 12px', fontSize: '14px', fontWeight: 700,
                    color: 'var(--text-muted)', cursor: 'pointer', minHeight: '40px',
                  }}
                >
                  {confidenceEnabled ? '🎯 Confidence tracker on · disable' : '🎯 Enable confidence tracker'}
                </button>
              )}

              <TutorControls
                loading={loading}
                answer={answer}
                lastAnswerCorrect={lastAnswerCorrect}
                lastAnswerIncorrect={lastAnswerIncorrect}
                lastAnswerPendingReview={lastAnswerPendingReview}
                isListening={isListening}
                remediationRequired={remediationRequired}
                nextStep={nextStep}
                howToFixHints={howToFixHints}
                showHowToFix={showHowToFix}
                workedExample={workedExample}
                topic={topic}
                errorBookHref={errorBookHref}
                onSubmit={handleSubmit}
                onNext={handleNext}
                onToggleDictation={toggleDictation}
                onRetry={() => {
                  setAnswer(""); setLastAnswerIncorrect(false); setConfidence(null); setSubmittedConfidence(null); setNextStep(null); setShowHowToFix(false); setShowAnswer(false);
                  // The Concept Study Break says "Try Again" unlocks; both Try Again buttons do the same.
                  if (remediationRequired) { setRemediationRequired(false); setConsecutiveErrors(0); }
                }}
                onShowNextStepHint={() => { recordSupport(2); addChat('tutor', `💡 **Next nudge:** ${nextStep}`, 'error'); setNextStep(null); }}
                onShowWorkedExample={() => { recordSupport(3); setShowWorkedExample(true); }}
                onShowHowToFix={() => { recordSupport(2); setShowHowToFix(true); }}
                onExplainConcept={handleExplain}
                nextBlockedReason={showSelfExplanation ? 'Save your explanation to continue.' : undefined}
              />

              {/* Show Answer — last resort after repeated incorrect attempts + user confirms */}
              {lastAnswerIncorrect && !lastAnswerCorrect && !showAnswer && consecutiveErrors >= 2 && (
                <button
                  onClick={handleShowAnswer}
                  disabled={loading}
                  aria-busy={loading}
                  style={{
                    marginTop: '8px', padding: '6px 14px', fontSize: '13px', fontWeight: '600',
                    borderRadius: '6px', border: '1px solid var(--border-color)',
                    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                    width: 'fit-content',
                  }}
                >
                  👁 Show Answer (last resort)
                </button>
              )}
              {showAnswer && revealedAnswer && (
                <div style={{
                  marginTop: '8px', padding: '8px 14px', borderRadius: '8px',
                  background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)',
                  fontSize: '13px', color: '#16a34a',
                }}>
                  <span style={{ whiteSpace: 'pre-line' }}>
                    <MathMarkdown inline>{`✅ Answer: ${revealedAnswer}`}</MathMarkdown>
                  </span>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: '60px', padding: '0 20px' }}>
              {exerciseLoadError && topic ? (
                <>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px' }}>
                    We could not load this practice question
                  </div>
                  <p style={{ fontSize: '14px', lineHeight: '1.6', maxWidth: '400px', margin: '0 auto' }}>
                    Check the connection and try again. Your saved progress has not changed.
                  </p>
                  {onRetryExercises && (
                    <button type="button" className="btn-primary" onClick={onRetryExercises} style={{ marginTop: '16px' }}>
                      Retry question
                    </button>
                  )}
                </>
              ) : (loadingExercises || suggestLoading) && topic ? (
                <>
                  <div className="animate-pulse" style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px' }}>
                    Loading question...
                  </div>
                  <p style={{ fontSize: '14px', lineHeight: '1.6', maxWidth: '400px', margin: '0 auto' }}>
                    Fetching the best practice question for you.
                  </p>
                </>
              ) : topic ? (
                <>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px' }}>
                    No practice questions are available for this topic yet
                  </div>
                  <p style={{ fontSize: '14px', lineHeight: '1.6', maxWidth: '400px', margin: '0 auto' }}>
                    Open Study navigation and choose another topic.
                  </p>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>📚</div>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px' }}>
                    Choose what to practise
                  </div>
                  <p style={{ fontSize: '14px', lineHeight: '1.6', maxWidth: '400px', margin: '0 auto' }}>
                    Start Today’s Study, or open Study navigation to choose a subject, year and topic.
                  </p>
                  {/* Phones and tablets keep the Today card in the closed drawer, so the
                      main area needs its own way in. Hidden on desktop by CSS. */}
                  <a
                    href={buildTodayHref({
                      subject,
                      year: unit ? `unit${unit}` : yearLevel ? `year${yearLevel}` : undefined,
                    })}
                    className="btn-primary today-empty-cta"
                    style={{ marginTop: '18px', textDecoration: 'none' }}
                  >
                    Start Today’s Study →
                  </a>
                </>
              )}
            </div>
          )}
          {revisionTopic && revisionTopic.topic_id && (
            <div
              className="revision-card"
              style={{
                margin: '0 28px 28px',
                padding: '14px 18px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(34,197,94,0.1), rgba(16,185,129,0.06))',
                border: '1px solid rgba(34,197,94,0.25)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                cursor: onGoToTopic ? 'pointer' : 'default',
                alignSelf: 'stretch',
              }}
              onClick={onGoToTopic}
              role={onGoToTopic ? 'button' : undefined}
              tabIndex={onGoToTopic ? 0 : undefined}
              onKeyDown={onGoToTopic ? (event) => {
                if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                onGoToTopic();
              } : undefined}
            >
              <RefreshCcw size={18} color="#16a34a" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Revision Due
                  </span>
                  {revisionTopic.strand && (
                    <span style={{ fontSize: '10px', background: 'rgba(34,197,94,0.15)', color: '#16a34a', padding: '1px 6px', borderRadius: '4px' }}>
                      {revisionTopic.strand}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: '500' }}>
                  {revisionTopic.name || revisionTopic.topic_id}
                </div>
                {revisionTopic.reason && (
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {revisionTopic.reason}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div
          className="feedback-resize-handle"
          role="separator"
          aria-label="Resize tutor feedback"
          aria-orientation="vertical"
          aria-valuemin={300}
          aria-valuemax={560}
          aria-valuenow={feedbackWidth}
          tabIndex={0}
          onMouseDown={handleFeedbackMouseDown}
          onKeyDown={handleFeedbackResizeKeyDown}
        />
        <DialoguePanel
          chat={chat}
          loading={loading}
          dialogueLoading={dialogueLoading}
          suggestedActions={suggestedActions}
          dialogueDisabled={dialogueDisabled}
          currentEx={currentEx}
          lastAnswerCorrect={lastAnswerCorrect}
          lastAnswerIncorrect={lastAnswerIncorrect}
          lastAnswerPendingReview={lastAnswerPendingReview}
          isExplaining={isExplaining}
          feedbackStyle={{ width: feedbackWidth }}
          showMathToolbar={showMathToolbar}
          onSendMessage={handleDialogueSend}
          onStartExplain={() => {
            recordSupport(2);
            setIsExplaining(true);
            addChat('system', 'Write your step-by-step solution below. I\'ll analyse each step and help you find the error.');
          }}
        />

      </div>
    </div>
  );
}
