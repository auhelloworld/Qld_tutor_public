'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import GuidedPracticeShell from '../../components/guided/GuidedPracticeShell';
import GuidedQuestionCard from '../../components/guided/GuidedQuestionCard';
import GuidedFeedbackCard from '../../components/guided/GuidedFeedbackCard';
import GuidedHelpDrawer from '../../components/guided/GuidedHelpDrawer';
import GuidedSessionSummary from '../../components/guided/GuidedSessionSummary';
import ParentNextStepsCard from '../../components/guided/ParentNextStepsCard';
import {
  fetchCurriculum,
  fetchContentAvailability,
  fetchExercises,
  fetchRecommend,
  tutorSuggest,
  tutorMark,
  tutorExplain,
  tutorDialogue,
  fetchDailySummary,
  fetchTopicWorkedExample,
  fetchAdvancedLesson,
  fetchProgress,
  fetchParentNextSteps,
  fetchMistakes,
  updateTutorAttemptMetadata,
  analyticsScopeFromYear,
  syllabusSubjectFromPickerSubject,
  type SupportLevel,
  type AnswerConfidence,
} from '../../lib/api';
import { getSubject, getYear } from '../../lib/preferences';
import { isMastered } from '../../lib/mastery';
import { getSubjectAdapter } from '../../lib/guided-subject-adapters';
import { describeHighAchieverSelection, getHighAchieverTopicCandidates, scoreHighAchieverExercise } from '../../lib/high-achiever-selector';
import { filterCurriculumByAvailability, hasAuthoredContentForScope } from '../../lib/content-availability';
import { getTopicDisplayName } from '../../lib/curriculum_helpers';
import type { Curriculum, Exercise, Recommendation, DailySummary, ChatMessage, TutorMarkResponse, WorkedExample, TutorExplainResponse, SubPart, SubPartResult } from '../../lib/api-types';
import { showToast } from '../../lib/toast';
import AdvancedLessonExtension from '../../components/guided/AdvancedLessonExtension';
import { buildLabDeepLink, getLabActivitiesForTopic } from '../../lib/lab-topic-links';
import { buildScienceLabDeepLink, getScienceActivitiesForTopic } from '../../lib/science-lab/topic-links';
import { ENABLE_SCIENCE_LAB } from '../../lib/feature-flags';
import styles from './page.module.css';
import TodaySessionBar from '../../components/TodaySessionBar';
import MathMarkdown from '../../components/MathMarkdown';
import {
  buildPracticeHref,
  buildTodayHref,
  isTodaySession,
  scopedSubjectFromSearchParams,
  scopedYearFromSearchParams,
} from '../../lib/scoped_navigation';
import { getMultiPartSessionOutcome } from '../../lib/guided-session';
import { hasMinimumSelfExplanation, MIN_SELF_EXPLANATION_WORDS, selfExplanationWordCount } from '../../lib/metacognition';
import { isMathSubject } from '../../lib/subject_registry';

const SESSION_LIMIT = 5;
const DIALOGUE_PREFIXES = [
  '[PRE_ATTEMPT_CONCEPT] ',
  '[PRE_ATTEMPT_FIRST_STEP] ',
  '[EXPLAINING] ',
];

function stripDialogueModePrefix(message: string) {
  const prefix = DIALOGUE_PREFIXES.find(p => message.startsWith(p));
  return prefix ? message.slice(prefix.length) : message;
}

function newMutationRequestId(prefix: string): string {
  const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomUuid}`;
}

function topicExistsInScope(curriculum: Curriculum | null, subject: string, year: string, topicId: string): boolean {
  const yearBlock = curriculum?.[subject]?.[year];
  if (!yearBlock || !topicId) return false;
  const sequence = Array.isArray(yearBlock.sequence) ? yearBlock.sequence : [];
  return sequence.includes(topicId) || Boolean(yearBlock[topicId]);
}

const GUIDED_SUPPORTED_ACTIONS = new Set([
  'show_worked_example',
  // 'give_next_step', // Disabled hint
  'try_again',
  'explain_my_answer',
  'mark_final_answer',
  'change_topic',
]);

function filterGuidedActions(actions?: string[]) {
  return (actions || []).filter(action => GUIDED_SUPPORTED_ACTIONS.has(action));
}

export default function GuidedPracticePage() {
  const router = useRouter();
  const [, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dialogueLoading, setDialogueLoading] = useState(false);
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);

  // Guided flow state
  const [activeTopic, setActiveTopic] = useState<string>('');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [currentEx, setCurrentEx] = useState<Exercise | null>(null);
  const [answer, setAnswer] = useState('');
  const [markResponse, setMarkResponse] = useState<TutorMarkResponse | null>(null);
  const [currentQuestionAttempted, setCurrentQuestionAttempted] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'feedback' | 'summary' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selectionReason, setSelectionReason] = useState('');
  const [attemptNumber, setAttemptNumber] = useState(0);
  const [correctionRequired, setCorrectionRequired] = useState(false);
  const [confidence, setConfidence] = useState<AnswerConfidence | null>(null);
  const [submittedConfidence, setSubmittedConfidence] = useState<AnswerConfidence | null>(null);
  const [selfExplanationRequired, setSelfExplanationRequired] = useState(false);
  const [selfExplanation, setSelfExplanation] = useState('');
  const [savingSelfExplanation, setSavingSelfExplanation] = useState(false);
  const [lastAttemptId, setLastAttemptId] = useState<string | undefined>();
  const supportLevelRef = useRef<SupportLevel>(0);
  const multiPartAttemptsRef = useRef<Map<string, number>>(new Map());
  const multiPartHadIncorrectRef = useRef(false);
  const selfExplanationCountRef = useRef(0);
  const [independentEvidence, setIndependentEvidence] = useState<Record<number, boolean>>({});
  const [replacedQuestions, setReplacedQuestions] = useState(0);
  const questionGenerationRef = useRef(0);
  const currentQuestionIdRef = useRef<string | null>(null);

  // Help & Scaffolding pre-fetch state
  const [lessonContent, setLessonContent] = useState<TutorExplainResponse | null>(null);
  const [successCriterionAcknowledged, setSuccessCriterionAcknowledged] = useState(false);
  const [workedExample, setWorkedExample] = useState<WorkedExample | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
  const [workedExampleOpenToken, setWorkedExampleOpenToken] = useState(0);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isHighAchiever, setIsHighAchiever] = useState(false);
  const [questionUsesHighAchiever, setQuestionUsesHighAchiever] = useState(false);
  const [advancedLesson, setAdvancedLesson] = useState<any>(null);
  const [showDiagnosticPrompt, setShowDiagnosticPrompt] = useState(false);
  const [parentNextStepsData, setParentNextStepsData] = useState<any>(null);
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map());
  const [mistakes, setMistakes] = useState<any[]>([]);
  const priorQuestionId = useRef<string | null>(null);
  const priorQuestionRef = useRef<Exercise | null>(null);
  const forcedTopicRef = useRef<string | null>(null);
  const forcedTopicReasonRef = useRef('');
  const topicQueueRef = useRef<string[]>([]);
  // Cache exercise pools per topic for the session (high-achiever mode refetched
  // these every question). Pool contents are static per topic/subject/year.
  const poolCacheRef = useRef<Map<string, Exercise[]>>(new Map());
  const stagedQuestionRef = useRef<{
    question: Exercise;
    topic: string;
    selectionReason: string;
  } | null>(null);
  const markRequestRef = useRef<{ key: string; requestId: string } | null>(null);
  const dialogueRequestRef = useRef<{ key: string; requestId: string } | null>(null);

  // Multi-part question state
  const [multiPartResults, setMultiPartResults] = useState<SubPartResult[]>([]);
  const [activeMultipartLabel, setActiveMultipartLabel] = useState<string | null>(null);

  // Session Statistics
  const [stats, setStats] = useState({
    attempted: 0,
    scored: 0,
    pendingReview: 0,
    correct: 0,
    hintClicks: 0,
    hintsBeforeAttempt: 0,
    hintsAfterAttempt: 0,
    dialogueTurns: 0,
    preAttemptHelpTurns: 0,
    workedExamplesOpened: 0,
    confidenceJudgements: 0,
    highConfidenceCorrect: 0,
    highConfidenceErrors: 0,
    lowConfidenceCorrect: 0,
    reasoningScores: [] as Array<{ score: number; max_score: number }>,
    errorTypes: {} as Record<string, number>,
    topicsTouched: [] as string[],
  });

  const [pickerValue, setPickerValue] = useState({ subject: 'math', year: 'year7' });

  useEffect(() => {
    setSuccessCriterionAcknowledged(false);
  }, [activeTopic]);

  const mathLabActivityForTopic = activeTopic ? getLabActivitiesForTopic(activeTopic)[0] : undefined;
  const scienceLabActivityForTopic = activeTopic && ENABLE_SCIENCE_LAB ? getScienceActivitiesForTopic(activeTopic)[0] : undefined;
  const labLinkForTopic = scienceLabActivityForTopic
    ? {
        href: buildScienceLabDeepLink(scienceLabActivityForTopic.id, 'learn', {
          subject: pickerValue.subject,
          year: pickerValue.year,
          topic: activeTopic,
        }),
        label: `Investigate in Science Lab: ${scienceLabActivityForTopic.title}`,
      }
    : mathLabActivityForTopic
      ? {
          href: buildLabDeepLink(mathLabActivityForTopic.id, 'learn', {
            subject: pickerValue.subject,
            year: pickerValue.year,
            topic: activeTopic,
          }),
          label: `Explore ${mathLabActivityForTopic.title} in Maths Lab`,
        }
      : undefined;
  const [scopeReady, setScopeReady] = useState(false);
  const [topicQueueActive, setTopicQueueActive] = useState(false);
  const [todayContext, setTodayContext] = useState({
    active: false,
    topics: [] as string[],
    returnTo: null as string | null,
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queuedTopics = Array.from(new Set(
      (params.get('today_topics') || '')
        .split(',')
        .map(topic => topic.trim())
        .filter(Boolean),
    ));
    setPickerValue({
      subject: scopedSubjectFromSearchParams(params, getSubject()),
      year: scopedYearFromSearchParams(params, getYear()),
    });
    setTodayContext({
      active: isTodaySession(params),
      topics: queuedTopics,
      returnTo: params.get('return_to'),
    });
    setScopeReady(true);
  }, []);
  // Today steps run on /today/practice. A Today visit here (for example from the
  // diagnostic results) is a normal guided set.
  const sessionLimit = SESSION_LIMIT;
  // Fade only when at least two guided questions precede the final two
  // independent checks.
  const isIndependentPhase = sessionLimit >= 4 && questionIndex >= sessionLimit - 2;
  const guidedPhase = isIndependentPhase ? 'fading' as const : 'guided' as const;
  const analyticsScope = useMemo(() => ({
    ...analyticsScopeFromYear(pickerValue.year),
    syllabusSubject: syllabusSubjectFromPickerSubject(pickerValue.subject),
  }), [pickerValue.subject, pickerValue.year]);
  const adapter = useMemo(() => getSubjectAdapter(pickerValue.subject), [pickerValue.subject]);
  const hasHighMastery = (progressMap.get(activeTopic) ?? 0) >= 0.85;

  // Mirror refs for values read inside the question-loading effect but that
  // should NOT themselves trigger a reload mid-answer (G4). Keeping these out
  // of the effect dependency array means reloads happen only on intentional
  // triggers (activeTopic, questionIndex, isHighAchiever, reloadNonce).
  const curriculumRef = useRef(curriculum);
  const recommendationRef = useRef(recommendation);
  const progressMapRef = useRef(progressMap);
  const mistakesRef = useRef(mistakes);
  const adapterRef = useRef(adapter);
  const pickerValueRef = useRef(pickerValue);
  useEffect(() => {
    curriculumRef.current = curriculum;
    recommendationRef.current = recommendation;
    progressMapRef.current = progressMap;
    mistakesRef.current = mistakes;
    adapterRef.current = adapter;
    pickerValueRef.current = pickerValue;
  }, [curriculum, recommendation, progressMap, mistakes, adapter, pickerValue]);

  // Keep track of visited question IDs to prevent repetition during this session
  const answeredQuestionIds = useRef<Set<string>>(new Set());
  const attemptedQuestionIds = useRef<Set<string>>(new Set());
  const correctQuestionIds = useRef<Set<string>>(new Set());

  // Load baseline recommendations & curriculum
  useEffect(() => {
    if (!scopeReady) return;
    let active = true;
    const loadData = async () => {
      try {
        const [curr, rec, ds, prog, mst, availability] = await Promise.all([
          fetchCurriculum(undefined, {
            subject: pickerValue.subject,
            scope: pickerValue.year,
          }),
          fetchRecommend(pickerValue.subject, pickerValue.year),
          fetchDailySummary(pickerValue.subject, undefined, analyticsScope),
          fetchProgress(pickerValue.subject, undefined, analyticsScope),
          fetchMistakes({ subject: pickerValue.subject, ...analyticsScope }),
          fetchContentAvailability().catch(() => null),
        ]);

        if (!active) return;
        const availableCurriculum = filterCurriculumByAvailability(curr, availability);
        const hasContent = hasAuthoredContentForScope(
          availability,
          pickerValue.subject,
          pickerValue.year,
        );
        setCurriculum(availableCurriculum);
        setRecommendation(rec);
        setDailySummary(ds);
        setMistakes(mst?.mistakes || []);
        const pMap = new Map((prog || []).map((p: any) => [p.topic, p.bkt_mastery]));
        setProgressMap(pMap);

        if (!hasContent) {
          setActiveTopic('');
          setCurrentEx(null);
          setAnswer('');
          setMarkResponse(null);
          setSuggestedActions([]);
          setLoadError('No authored exercises are available for the selected course scope yet. Choose another subject or year/unit.');
          setStatus('error');
          setLoading(false);
          return;
        }

        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          if (params.get('mode') === 'high-achiever' && !todayContext.active) {
            setIsHighAchiever(true);
            setQuestionUsesHighAchiever(true);
          }
          const forcedTopic = params.get('topic');
          if (forcedTopic && topicExistsInScope(availableCurriculum, pickerValue.subject, pickerValue.year, forcedTopic)) {
            forcedTopicRef.current = forcedTopic;
            // Many routes link here with a topic; name the real source.
            forcedTopicReasonRef.current = params.get('mode') === 'parent-focus'
              ? 'Targeted practice from the parent dashboard.'
              : 'Practice for the topic you opened.';
          }
        }

        if (rec && rec.recommendation_type === 'diagnostic_prompt') {
          setShowDiagnosticPrompt(true);
        }

        // Select the initial topic. A URL-authored queue takes precedence and is
        // filtered against the loaded curriculum before any question is served.
        const queuedTopics = todayContext.topics.filter(topic =>
          topicExistsInScope(
            availableCurriculum,
            pickerValue.subject,
            pickerValue.year,
            topic,
          ),
        );
        topicQueueRef.current = queuedTopics;
        setTopicQueueActive(queuedTopics.length > 0);
        let selectedTopic = '';
        if (queuedTopics.length > 0) {
          selectedTopic = queuedTopics[0];
        } else if (forcedTopicRef.current) {
          selectedTopic = forcedTopicRef.current;
        } else if (
          rec?.topic_id
          && topicExistsInScope(availableCurriculum, pickerValue.subject, pickerValue.year, rec.topic_id)
        ) {
          selectedTopic = rec.topic_id;
        } else if (availableCurriculum?.[pickerValue.subject]?.[pickerValue.year]) {
          const yearBlock = availableCurriculum[pickerValue.subject][pickerValue.year];
          const seq = (yearBlock.sequence as any) || [];
          const progMap = new Map((prog || []).map((p: any) => [p.topic, p]));
          
          for (const topicId of seq) {
            if (!isMastered(progMap.get(topicId))) {
              selectedTopic = topicId;
              break;
            }
          }
          
          if (!selectedTopic) {
            const keys = Object.keys(yearBlock).filter(k => k !== 'sequence');
            if (keys.length > 0) {
              selectedTopic = keys[0];
            }
          }
        }

        if (selectedTopic) {
          setActiveTopic(selectedTopic);
        } else {
          setCurrentEx(null);
          setAnswer('');
          setMarkResponse(null);
                setSuggestedActions([]);
          setLoadError('No guided practice topics are available for the selected subject and year yet.');
          setStatus('error');
          showToast('No topics found. Exit and choose a curriculum first.', 'error');
          setLoading(false);
        }
      } catch (err) {
        if (!active) return;
        console.error('Failed to load guided practice dependencies:', err);
        showToast('Connection error. Returning to main practice.', 'error');
        router.push('/');
      }
    };

    loadData();
    return () => { active = false; };
  }, [analyticsScope, pickerValue.subject, pickerValue.year, router, scopeReady, todayContext.active, todayContext.topics]);

  // Load next exercise when activeTopic changes or questionIndex increments
  useEffect(() => {
    if (!activeTopic) return;
    let active = true;
    const generation = ++questionGenerationRef.current;
    currentQuestionIdRef.current = null;
    markRequestRef.current = null;
    dialogueRequestRef.current = null;
    setSubmitting(false);
    setDialogueLoading(false);
    setStatus('loading');
    setLoadError('');
    setCurrentEx(null);
    setAnswer('');
    setMarkResponse(null);
    setMultiPartResults([]);
    setActiveMultipartLabel(null);
    setSuggestedActions([]);
    setIsExplaining(false);
    setAttemptNumber(0);
    setCorrectionRequired(false);
    setConfidence(null);
    setSubmittedConfidence(null);
    setSelfExplanationRequired(false);
    setSelfExplanation('');
    setLastAttemptId(undefined);
    supportLevelRef.current = 0;
    multiPartAttemptsRef.current.clear();
    multiPartHadIncorrectRef.current = false;
    // Clear optional help assets so stale content never flashes on the new question.
    setLessonContent(null);
    setWorkedExample(null);
    setAdvancedLesson(null);

    const getNextQuestion = async () => {
      // Snapshot the loaded context from refs so a re-creation of these values
      // does not re-trigger this effect mid-answer (G4). The effect only reloads
      // on intentional triggers (activeTopic, questionIndex, isHighAchiever, reloadNonce).
      const curriculum = curriculumRef.current;
      const recommendation = recommendationRef.current;
      const progressMap = progressMapRef.current;
      const mistakes = mistakesRef.current;
      const adapter = adapterRef.current;
      const pickerValue = pickerValueRef.current;
      try {
        let question: Exercise | null = null;
        let questionTopic = activeTopic;
        let nextSelectionReason = topicQueueRef.current.includes(activeTopic)
          ? 'Confirming a topic estimate from your diagnostic results.'
          : forcedTopicRef.current === activeTopic
          ? forcedTopicReasonRef.current
          : recommendation?.topic_id === activeTopic
          ? 'Recommended next topic based on your progress.'
          : 'Reviewing a recent mistake.';

        const staged = stagedQuestionRef.current;
        if (staged?.topic === activeTopic) {
          question = staged.question;
          questionTopic = staged.topic;
          nextSelectionReason = staged.selectionReason;
          stagedQuestionRef.current = null;
        }

        const isSenior = pickerValue.year.startsWith('unit');
        const yearLevel = isSenior ? undefined : parseInt(pickerValue.year.replace('year', '')) || undefined;
        const unit = isSenior ? parseInt(pickerValue.year.replace('unit', '')) || undefined : undefined;

        if (!question && questionUsesHighAchiever && !isIndependentPhase && !todayContext.active) {
          const yearBlock = curriculum?.[pickerValue.subject]?.[pickerValue.year];
          const topicCandidates = getHighAchieverTopicCandidates({
            activeTopic,
            sequence: (yearBlock?.sequence as any) || [],
            progress: [...progressMap.entries()].map(([topic, bkt_mastery]) => ({ topic, bkt_mastery })),
            mistakes,
          });

          const pools = await Promise.all(
            topicCandidates.map(async (topic) => {
              const cached = poolCacheRef.current.get(topic);
              if (cached) return { topic, exercises: cached };
              const fetched = await fetchExercises(topic, undefined, pickerValue.subject, yearLevel, unit).catch(() => []);
              poolCacheRef.current.set(topic, fetched);
              return { topic, exercises: fetched };
            })
          );

          const scored = pools.flatMap(({ topic, exercises }) =>
            (exercises || [])
              .filter(ex => !answeredQuestionIds.current.has(ex.id))
              .map(ex => ({
                ex,
                topic,
                score: scoreHighAchieverExercise({
                  exercise: ex,
                  topicId: topic,
                  progressByTopic: progressMap,
                  mistakes,
                  priorQuestionId: priorQuestionId.current,
                  adapterScore: adapter.advancedScore(ex),
                })
              }))
          );

          if (scored.length > 0) {
            scored.sort((a, b) => b.score - a.score);
            question = scored[0].ex;
            questionTopic = scored[0].topic;
            nextSelectionReason = describeHighAchieverSelection({
              exercise: scored[0].ex,
              topicId: scored[0].topic,
              progressByTopic: progressMap,
              mistakes,
            });
          }
        }

        // The final two questions fade support while staying in the active topic.
        // Prefer unseen near-transfer items that differ from the immediately prior
        // question in representation, difficulty or complexity.
        if (!question && isIndependentPhase) {
          let activePool = poolCacheRef.current.get(activeTopic);
          if (!activePool) {
            activePool = await fetchExercises(activeTopic, undefined, pickerValue.subject, yearLevel, unit).catch(() => []);
            poolCacheRef.current.set(activeTopic, activePool);
          }
          const previous = priorQuestionRef.current;
          const candidates = (activePool || []).filter(ex => !answeredQuestionIds.current.has(ex.id) && ex.id !== priorQuestionId.current);
          candidates.sort((left, right) => {
            const diversity = (exercise: Exercise) => (
              Number(exercise.question_type !== previous?.question_type)
              + Number(exercise.difficulty !== previous?.difficulty)
              + Number(exercise.complexity !== previous?.complexity)
            );
            return diversity(right) - diversity(left);
          });
          if (candidates.length > 0) {
            question = candidates[0];
            nextSelectionReason = 'Fading support with an unseen near-transfer question from the same topic.';
          }
        }

        // Standard smart suggest fallback. Never accept an already answered
        // question: final-two fading evidence must come from two distinct items.
        if (!question) {
          let excludeId = priorQuestionId.current || undefined;
          const maxSuggestAttempts = isIndependentPhase
            ? 10
            : Math.min(10, Math.max(3, answeredQuestionIds.current.size + 1));
          for (let suggestAttempt = 0; suggestAttempt < maxSuggestAttempts; suggestAttempt += 1) {
            const res = await tutorSuggest(
              activeTopic,
              'retrieve',
              excludeId,
              undefined,
              pickerValue.subject,
              yearLevel,
              unit,
            );
            if (!res?.question) break;
            if (!answeredQuestionIds.current.has(res.question.id)) {
              question = res.question;
              nextSelectionReason = forcedTopicRef.current === activeTopic
                ? forcedTopicReasonRef.current
                : recommendation?.topic_id === activeTopic
                ? 'Recommended next topic based on your progress.'
                : 'Reviewing a recent mistake.';
              break;
            }
            excludeId = res.question.id;
          }
        }

        // Some curriculum descriptors do not yet have authored exercises. Stay in the
        // selected subject and advance to the next topic with available content.
        if (!question && !isIndependentPhase && !todayContext.active) {
          const yearBlock = curriculum?.[pickerValue.subject]?.[pickerValue.year];
          const sequence = Array.isArray(yearBlock?.sequence) ? yearBlock.sequence.filter(Boolean) : [];
          for (const topic of sequence) {
            if (topic === activeTopic) continue;
            // Reuse the session pool cache; this probe runs again every time the
            // active topic has no question. Failed fetches are not cached.
            const available = poolCacheRef.current.get(topic) ?? await fetchExercises(topic, undefined, pickerValue.subject, yearLevel, unit)
              .then((pool) => {
                poolCacheRef.current.set(topic, pool);
                return pool;
              })
              .catch(() => []);
            if (available.length === 0) continue;
            const res = await tutorSuggest(topic, 'retrieve', priorQuestionId.current || undefined, undefined, pickerValue.subject, yearLevel, unit);
            if (res?.question) {
              question = res.question;
              questionTopic = topic;
              nextSelectionReason = 'Moved to a nearby topic with available practice.';
              break;
            }
          }
        }

        if (!active || generation !== questionGenerationRef.current) return;

        if (question) {
          if (questionTopic !== activeTopic) {
            stagedQuestionRef.current = {
              question,
              topic: questionTopic,
              selectionReason: nextSelectionReason,
            };
            setActiveTopic(questionTopic);
            return;
          }
          priorQuestionId.current = question.id;
          priorQuestionRef.current = question;
          currentQuestionIdRef.current = question.id;
          setCurrentQuestionAttempted(false);
          setCurrentEx(question);
          setAnswer('');
          setMarkResponse(null);
          setMultiPartResults([]);
          setActiveMultipartLabel(null);
                setSuggestedActions([]);
          setIsExplaining(false);
          setChatHistory([{ role: 'system', content: 'Try the question first. Open the tutor if you become stuck or want feedback on your working.' }]);
          setSelectionReason(nextSelectionReason);
          // Question is ready immediately — help assets load independently so a
          // slow/failed concept or example request cannot block the session.
          setStatus('ready');

          if (!isIndependentPhase) {
            void tutorExplain(questionTopic)
              .then((exp) => { if (active && generation === questionGenerationRef.current) setLessonContent(exp); })
              .catch((err) => {
                console.error('Failed to fetch concept lesson:', err);
                if (active && generation === questionGenerationRef.current) setLessonContent(null);
              });

            void fetchTopicWorkedExample(questionTopic)
              .then((we) => { if (active && generation === questionGenerationRef.current) setWorkedExample(we); })
              .catch((err) => {
                console.error('Failed to fetch worked example:', err);
                if (active && generation === questionGenerationRef.current) setWorkedExample(null);
              });

            void fetchAdvancedLesson(questionTopic, pickerValue.subject, pickerValue.year)
              .then((advLesson) => { if (active && generation === questionGenerationRef.current) setAdvancedLesson(advLesson); })
              .catch((err) => {
                console.error('Failed to fetch advanced lesson:', err);
                if (active && generation === questionGenerationRef.current) setAdvancedLesson(null);
              });
          }
        } else {
          setCurrentEx(null);
          setAnswer('');
          setMarkResponse(null);
          setMultiPartResults([]);
          setActiveMultipartLabel(null);
                setSuggestedActions([]);
          setLoadError('Could not load the next question. This topic may not have available questions yet.');
          setStatus('error');
        }
      } catch (err) {
        if (!active || generation !== questionGenerationRef.current) return;
        console.error('Failed to suggest next question:', err);
        setCurrentEx(null);
        setAnswer('');
        setMarkResponse(null);
        setMultiPartResults([]);
        setActiveMultipartLabel(null);
            setSuggestedActions([]);
        setLoadError('Could not load the next question. This topic may not have available questions yet.');
        setStatus('error');
      }
    };

    getNextQuestion();
    return () => {
      active = false;
      if (questionGenerationRef.current === generation) {
        questionGenerationRef.current += 1;
        currentQuestionIdRef.current = null;
      }
    };
  }, [activeTopic, questionIndex, questionUsesHighAchiever, reloadNonce, isIndependentPhase, todayContext.active]);

  // Fetch backend parent next steps when session finishes
  useEffect(() => {
    if (status !== 'summary') return;
    let active = true;
    const loadNextSteps = async () => {
      try {
        const ns = await fetchParentNextSteps(pickerValue.subject, pickerValue.year, undefined, analyticsScope);
        if (active) {
          setParentNextStepsData(ns);
        }
      } catch (err) {
        console.error('Failed to fetch parent next steps from backend:', err);
      }
    };
    loadNextSteps();
    return () => { active = false; };
  }, [analyticsScope, status, pickerValue.subject, pickerValue.year]);

  // Actions
  const recordQuestionAttempt = (
    res: TutorMarkResponse,
    isOverallCorrect: boolean,
    confidenceValue: AnswerConfidence | null,
  ) => {
    if (!currentEx) return;
    const shouldCountAttempt = !attemptedQuestionIds.current.has(currentEx.id);
    const isPendingReview = res.outcome === 'pending'
      || res.error_type === 'parent_review_pending'
      || res.retryable === true;
    const shouldCountCorrect = !isPendingReview && isOverallCorrect && !correctQuestionIds.current.has(currentEx.id);
    if (!shouldCountAttempt && !shouldCountCorrect) return;

    if (shouldCountAttempt) {
      attemptedQuestionIds.current.add(currentEx.id);
      setCurrentQuestionAttempted(true);
    }
    if (shouldCountCorrect) correctQuestionIds.current.add(currentEx.id);

    setStats(prev => {
      const errorKey = res.error_type || res.error_pattern || null;
      const topicSet = new Set(prev.topicsTouched);
      if (activeTopic) topicSet.add(activeTopic);
      return {
        ...prev,
        attempted: prev.attempted + (shouldCountAttempt ? 1 : 0),
        scored: prev.scored + (shouldCountAttempt && !isPendingReview ? 1 : 0),
        pendingReview: prev.pendingReview + (shouldCountAttempt && isPendingReview ? 1 : 0),
        correct: prev.correct + (shouldCountCorrect ? 1 : 0),
        confidenceJudgements: prev.confidenceJudgements + (shouldCountAttempt && !isPendingReview && confidenceValue ? 1 : 0),
        highConfidenceCorrect: prev.highConfidenceCorrect + (shouldCountAttempt && !isPendingReview && confidenceValue === 'sure' && isOverallCorrect ? 1 : 0),
        highConfidenceErrors: prev.highConfidenceErrors + (shouldCountAttempt && !isPendingReview && confidenceValue === 'sure' && !isOverallCorrect ? 1 : 0),
        lowConfidenceCorrect: prev.lowConfidenceCorrect + (shouldCountAttempt && !isPendingReview && confidenceValue === 'guess' && isOverallCorrect ? 1 : 0),
        reasoningScores:
          shouldCountAttempt && !isPendingReview && res.question_type === 'reasoning' && res.score !== undefined && res.max_score !== undefined
            ? [...prev.reasoningScores, { score: res.score, max_score: res.max_score }]
            : prev.reasoningScores,
        errorTypes: shouldCountAttempt && !isPendingReview && errorKey
          ? { ...prev.errorTypes, [errorKey]: (prev.errorTypes[errorKey] ?? 0) + 1 }
          : prev.errorTypes,
        topicsTouched: [...topicSet],
      };
    });
  };

  const handleSubmitAnswer = async () => {
    if (!currentEx || submitting) return;
    const requestGeneration = questionGenerationRef.current;
    const requestQuestionId = currentEx.id;
    setSubmitting(true);
    try {
      let submitAnswer = answer;
      let submittedPartLabel = '';

      if (currentEx.question_type === 'multi_part') {
        const normaliseLabel = (label: unknown) => String(label || '').toLowerCase().trim();
        const nextUnanswered = currentEx.sub_parts?.find((p: SubPart) => {
          const partLabel = normaliseLabel(p.label);
          const r = multiPartResults.find((res: SubPartResult) => normaliseLabel(res.label) === partLabel);
          return !r || !r.student_answer;
        }) || currentEx.sub_parts?.find((p: SubPart) => {
          const partLabel = normaliseLabel(p.label);
          const r = multiPartResults.find((res: SubPartResult) => normaliseLabel(res.label) === partLabel);
          return r?.is_correct === false && !!r.student_answer;
        });

        let activePart = nextUnanswered;
        if (activeMultipartLabel) {
          const selected = currentEx.sub_parts?.find((p: SubPart) => normaliseLabel(p.label) === activeMultipartLabel);
          if (selected) {
            const r = multiPartResults.find((res: SubPartResult) => normaliseLabel(res.label) === activeMultipartLabel);
            if (!r?.is_correct) {
              activePart = selected;
            }
          }
        }

        if (activePart) {
          submittedPartLabel = normaliseLabel(activePart.label);
          submitAnswer = JSON.stringify({ [submittedPartLabel]: answer.trim() });
        } else {
          setSubmitting(false);
          return;
        }
      }

      const isMultiPartSubmission = currentEx.question_type === 'multi_part';
      const submittedPartAttemptCount = isMultiPartSubmission
        ? (multiPartAttemptsRef.current.get(submittedPartLabel) ?? 0)
        : attemptNumber;
      const isFirstPartAttempt = submittedPartAttemptCount === 0;
      const startsNewMultiPartRound = isMultiPartSubmission
        && !multiPartResults.some(part => Boolean(part.student_answer?.trim()));
      const isFirstAttempt = isMultiPartSubmission
        ? !multiPartHadIncorrectRef.current && isFirstPartAttempt
        : attemptNumber === 0;
      const supportLevel = supportLevelRef.current;
      const confidenceSnapshot = confidence;
      setSubmittedConfidence(confidenceSnapshot);
      const markRequestKey = `${requestQuestionId}|${submitAnswer}`;
      const markRequest = markRequestRef.current?.key === markRequestKey
        ? markRequestRef.current
        : { key: markRequestKey, requestId: newMutationRequestId('guided-mark') };
      markRequestRef.current = markRequest;

      const res = await tutorMark(currentEx.id, submitAnswer, undefined, {
        requestId: markRequest.requestId,
        supportLevel,
        confidence: confidenceSnapshot,
        guidedPhase,
        // firstAttempt keeps the existing multipart round/continuation signal;
        // rootFirstAttempt independently records whether any submitted part has
        // already needed a retry in this encounter.
        firstAttempt: isMultiPartSubmission ? startsNewMultiPartRound : isFirstAttempt,
        rootFirstAttempt: isMultiPartSubmission ? isFirstAttempt : undefined,
        correctionCompleted: correctionRequired,
      });
      if (
        requestGeneration !== questionGenerationRef.current
        || currentQuestionIdRef.current !== requestQuestionId
      ) return;
      if (res.retryable !== true && markRequestRef.current === markRequest) {
        markRequestRef.current = null;
      }
      setAttemptNumber(prev => prev + 1);
      if (isMultiPartSubmission && submittedPartLabel) {
        multiPartAttemptsRef.current.set(submittedPartLabel, submittedPartAttemptCount + 1);
      }
      setLastAttemptId(res.attempt_id);

      if (res.part_results) {
        setMultiPartResults(res.part_results);
      }

      const latestPartResults = res.part_results ?? multiPartResults;
      const isOverallCorrect = currentEx.question_type === 'multi_part'
        ? currentEx.sub_parts?.every((p: SubPart) => {
            const pl = String(p.label || '').toLowerCase().trim();
            const r = latestPartResults.find((pr: SubPartResult) => String(pr.label || '').toLowerCase().trim() === pl);
            return r?.is_correct === true;
          }) === true
        : res.is_correct;

      const multiPartSessionOutcome = isMultiPartSubmission
        ? getMultiPartSessionOutcome(latestPartResults)
        : null;
      const submittedPartResult = isMultiPartSubmission
        ? latestPartResults.find(part => String(part.label || '').toLowerCase().trim() === submittedPartLabel)
        : undefined;
      const submittedPartPending = Boolean(
        submittedPartResult
        && (submittedPartResult.outcome === 'pending' || submittedPartResult.error_type === 'parent_review_pending'),
      );
      const feedbackResponse: TutorMarkResponse = isMultiPartSubmission && submittedPartResult
        ? {
            ...res,
            is_correct: submittedPartResult.is_correct,
            outcome: submittedPartResult.outcome
              ?? (submittedPartResult.is_correct ? 'correct' : submittedPartPending ? 'pending' : 'incorrect'),
            error_type: submittedPartResult.error_type ?? null,
            feedback: submittedPartResult.feedback?.trim()
              || (submittedPartPending
                ? `Part (${submittedPartLabel.toUpperCase()}) was saved for review.`
                : submittedPartResult.is_correct
                  ? `Part (${submittedPartLabel.toUpperCase()}) is correct. Continue to the next part.`
                  : `Part (${submittedPartLabel.toUpperCase()}) needs another try.`),
            score: submittedPartResult.score,
            max_score: submittedPartResult.max_score,
          }
        : res;
      const isPendingReview = feedbackResponse.outcome === 'pending'
        || feedbackResponse.error_type === 'parent_review_pending'
        || feedbackResponse.retryable === true;
      setMarkResponse(feedbackResponse);
      if (feedbackResponse.retryable === true) {
        // The backend intentionally returned no verdict. Keep the answer out of
        // correction/scored statistics and let the neutral card offer a retry.
        setCorrectionRequired(false);
        setStatus('feedback');
        setSubmitting(false);
        return;
      }
      const submittedPartIncorrect = Boolean(
        submittedPartResult
        && submittedPartResult.is_correct === false
        && submittedPartResult.outcome !== 'pending'
        && submittedPartResult.outcome !== 'unanswered'
        && submittedPartResult.error_type !== 'parent_review_pending',
      );

      if (!isMultiPartSubmission) {
        if (!isPendingReview && !isOverallCorrect) {
          setCorrectionRequired(isFirstAttempt);
        } else {
          const correctedAfterError = isOverallCorrect && (correctionRequired || !isFirstAttempt);
          setCorrectionRequired(false);
          if (
            isOverallCorrect
            && selfExplanationCountRef.current < 2
            && (correctedAfterError || supportLevel > 0 || confidenceSnapshot === 'guess')
          ) {
            setSelfExplanationRequired(true);
          }
        }
      } else {
        setCurrentQuestionAttempted(true);
        if (submittedPartIncorrect) {
          multiPartHadIncorrectRef.current = true;
          setCorrectionRequired(isFirstPartAttempt);
        } else {
          setCorrectionRequired(false);
        }
        if (
          isOverallCorrect
          && selfExplanationCountRef.current < 2
          && (multiPartHadIncorrectRef.current || supportLevel > 0 || confidenceSnapshot === 'guess')
        ) {
          setSelfExplanationRequired(true);
        }
      }
      if (
        isIndependentPhase
        && !isPendingReview
        && (!isMultiPartSubmission || multiPartSessionOutcome?.ready)
      ) {
        setIndependentEvidence(prev => ({
          ...prev,
          // A guessed right answer is not evidence.
          [questionIndex]: Boolean(isOverallCorrect && isFirstAttempt && supportLevel === 0 && confidenceSnapshot !== 'guess'),
        }));
      }
      if (isMultiPartSubmission) {
        if (multiPartSessionOutcome?.ready) {
          recordQuestionAttempt(
            {
              ...res,
              outcome: multiPartSessionOutcome.outcome,
              error_type: multiPartSessionOutcome.errorType,
            },
            multiPartSessionOutcome.isCorrect,
            confidenceSnapshot,
          );
        }
      } else {
        recordQuestionAttempt(res, isOverallCorrect, confidenceSnapshot);
      }

      // For multi_part, stay on the same whole question until every sub-part is correct.
      if (currentEx.question_type === 'multi_part' && !isOverallCorrect) {
        const nextPart = currentEx.sub_parts?.find((p: SubPart) => {
          const pl = String(p.label || '').toLowerCase().trim();
          const r = latestPartResults.find((pr: SubPartResult) => String(pr.label || '').toLowerCase().trim() === pl);
          return r?.is_correct !== true;
        });
        if (nextPart) {
          setActiveMultipartLabel(String(nextPart.label).toLowerCase().trim());
        }
        setAnswer('');
        setStatus('feedback');
        setSubmitting(false);
        return;
      }

      answeredQuestionIds.current.add(currentEx.id);
      if (currentEx.question_type === 'multi_part') {
        setAnswer('');
      }

      setStatus('feedback');
    } catch (err) {
      if (
        requestGeneration === questionGenerationRef.current
        && currentQuestionIdRef.current === requestQuestionId
      ) {
        console.error('Error submitting answer:', err);
        showToast(
          err instanceof Error && err.message
            ? `Submit failed: ${err.message}`
            : 'Submit failed. Please try again.',
          'error',
        );
      }
    } finally {
      if (
        requestGeneration === questionGenerationRef.current
        && currentQuestionIdRef.current === requestQuestionId
      ) {
        setSubmitting(false);
      }
    }
  };

  const recordSupport = (level: SupportLevel) => {
    supportLevelRef.current = Math.max(supportLevelRef.current, level) as SupportLevel;
  };

  const recordHelp = (level: SupportLevel) => {
    recordSupport(level);
    const hasAttempted = Boolean(
      currentEx && attemptedQuestionIds.current.has(currentEx.id),
    );
    setStats(prev => ({
      ...prev,
      hintClicks: prev.hintClicks + 1,
      hintsBeforeAttempt: prev.hintsBeforeAttempt + (hasAttempted ? 0 : 1),
      hintsAfterAttempt: prev.hintsAfterAttempt + (hasAttempted ? 1 : 0),
    }));
  };

  const handleSendMessage = async (msg: string) => {
    if (!currentEx || dialogueLoading || isIndependentPhase) return;
    const requestGeneration = questionGenerationRef.current;
    const requestQuestionId = currentEx.id;
    recordHelp(2);
    setDialogueLoading(true);

    const messageToSend = isExplaining ? `[EXPLAINING] ${msg}` : msg;
    if (isExplaining) {
      setIsExplaining(false);
    }

    // Append student turn locally
    const studentTurn: ChatMessage = { role: 'student', content: stripDialogueModePrefix(messageToSend) };
    setChatHistory(prev => [...prev, studentTurn]);

    // Local tracking: dialogue turn (NOT counted as hint click)
    const hasAttemptedCurrentQuestion = attemptedQuestionIds.current.has(currentEx.id);
    setStats(prev => ({
      ...prev,
      dialogueTurns: prev.dialogueTurns + 1,
      preAttemptHelpTurns: prev.preAttemptHelpTurns + (hasAttemptedCurrentQuestion ? 0 : 1),
    }));

    try {
      const dialogueRequestKey = `${requestQuestionId}|${messageToSend}`;
      const dialogueRequest = dialogueRequestRef.current?.key === dialogueRequestKey
        ? dialogueRequestRef.current
        : { key: dialogueRequestKey, requestId: newMutationRequestId('guided-dialogue') };
      dialogueRequestRef.current = dialogueRequest;
      const res = await tutorDialogue(currentEx.id, messageToSend, undefined, dialogueRequest.requestId);
      if (
        requestGeneration !== questionGenerationRef.current
        || currentQuestionIdRef.current !== requestQuestionId
      ) return;
      if (dialogueRequestRef.current === dialogueRequest) {
        dialogueRequestRef.current = null;
      }
      // Append tutor response turn
      const tutorTurn: ChatMessage = { role: 'tutor', content: res.tutor_message || 'I am looking into that!' };
      setChatHistory(prev => [...prev, tutorTurn]);
      setSuggestedActions(filterGuidedActions(res.suggested_actions));
    } catch (err) {
      if (
        requestGeneration === questionGenerationRef.current
        && currentQuestionIdRef.current === requestQuestionId
      ) {
        console.error('Dialogue request failed:', err);
        showToast('Tutor conversation offline.', 'error');
      }
    } finally {
      if (
        requestGeneration === questionGenerationRef.current
        && currentQuestionIdRef.current === requestQuestionId
      ) {
        setDialogueLoading(false);
      }
    }
  };

  const handleExplainMyAnswer = async () => {
    if (!currentEx || isIndependentPhase) return;
    recordHelp(2);
    if (isExplaining) return;
    setIsExplaining(true);
    setChatHistory(prev => [
      ...prev,
      {
        role: 'system',
        content: 'Write your solution step by step in the AI chat box. I will analyse your working and help you find where the mistake happened.',
      },
    ]);
  };

  const handleShowWorkedExample = () => {
    if (isIndependentPhase) return;
    recordHelp(3);
    setStats(prev => ({ ...prev, workedExamplesOpened: prev.workedExamplesOpened + 1 }));
    setWorkedExampleOpenToken(prev => prev + 1);
    // Surface the pre-loaded worked example via the help drawer chat
    if (workedExample) {
      setChatHistory(prev => [
        ...prev,
        { role: 'system', content: '📖 Worked example opened. Study the step-by-step solution below, then try explaining your corrected working.' },
      ]);
    } else {
      setChatHistory(prev => [
        ...prev,
        { role: 'system', content: 'No worked example is available for this topic yet. Try asking the tutor to walk you through a similar problem.' },
      ]);
    }
  };

  const handleTryAgain = () => {
    setAnswer('');
    setMarkResponse(null);
    setConfidence(null);
    setSubmittedConfidence(null);
    setIsExplaining(false);
    setSuggestedActions([]);
    setStatus('ready');
  };

  const handleSuggestedAction = (action: string) => {
    setSuggestedActions([]);
    if (action === 'show_worked_example') {
      handleShowWorkedExample();
    } else if (action === 'try_again') {
      handleTryAgain();
    } else if (action === 'explain_my_answer') {
      handleExplainMyAnswer();
    } else if (action === 'mark_final_answer') {
      handleSubmitAnswer();
    } else if (action === 'change_topic') {
      setChatHistory(prev => [
        ...prev,
        { role: 'system', content: 'Use Switch Topic Manually in the sidebar to start a different guided set.' },
      ]);
    }
  };

  const finaliseCurrentMultiPartForSession = () => {
    if (!currentEx || currentEx.question_type !== 'multi_part') return;
    if (attemptedQuestionIds.current.has(currentEx.id)) return;
    const sessionOutcome = getMultiPartSessionOutcome(multiPartResults, true);
    if (!sessionOutcome.ready) return;
    if (isIndependentPhase) {
      setIndependentEvidence(prev => ({ ...prev, [questionIndex]: false }));
    }
    recordQuestionAttempt(
      {
        ...(markResponse ?? {
          is_correct: false,
          feedback: 'The unfinished question was recorded for this session.',
          question_type: 'multi_part',
        }),
        outcome: sessionOutcome.outcome,
        error_type: sessionOutcome.errorType,
      },
      sessionOutcome.isCorrect,
      submittedConfidence,
    );
  };

  const handleSaveSelfExplanation = async () => {
    if (!currentEx || !hasMinimumSelfExplanation(selfExplanation) || savingSelfExplanation) return;
    setSavingSelfExplanation(true);
    try {
      await updateTutorAttemptMetadata(currentEx.id, lastAttemptId, selfExplanation.trim());
      selfExplanationCountRef.current += 1;
      setSelfExplanationRequired(false);
    } catch (err) {
      console.error('Failed to save self-explanation:', err);
      showToast('Please try saving your explanation again.', 'error');
    } finally {
      setSavingSelfExplanation(false);
    }
  };

  const advanceToNextQuestion = () => {
    const nextIdx = questionIndex + 1;
    if (nextIdx >= sessionLimit) {
      setStatus('summary');
    } else {
      const topicQueue = topicQueueRef.current;
      const nextTopic = topicQueue.length > 0
        ? topicQueue[nextIdx % topicQueue.length]
        : null;
      setQuestionUsesHighAchiever(isHighAchiever);
      if (nextTopic && nextTopic !== activeTopic) {
        setActiveTopic(nextTopic);
      }
      setQuestionIndex(nextIdx);
    }
  };

  const handleNext = () => {
    if (correctionRequired || selfExplanationRequired) return;
    finaliseCurrentMultiPartForSession();
    if (currentEx) {
      answeredQuestionIds.current.add(currentEx.id);
    }
    advanceToNextQuestion();
  };

  const handleSkipQuestion = () => {
    if (!currentEx || submitting || correctionRequired || selfExplanationRequired) return;
    const countedAsAttempt = attemptedQuestionIds.current.has(currentEx.id);
    answeredQuestionIds.current.add(currentEx.id);
    if (countedAsAttempt) {
      if (isIndependentPhase) {
        setIndependentEvidence(prev => ({ ...prev, [questionIndex]: false }));
      }
      advanceToNextQuestion();
      showToast('Moving on. Your existing attempt remains counted.', 'info');
      return;
    }
    setReplacedQuestions(count => count + 1);
    setQuestionUsesHighAchiever(isHighAchiever && !todayContext.active);
    setReloadNonce(value => value + 1);
    showToast('Question replaced. It was not counted as completed.', 'info');
  };

  const handleSkipFeedbackQuestion = () => {
    if (!currentEx || submitting) return;
    const countedAsAttempt = attemptedQuestionIds.current.has(currentEx.id);
    setCorrectionRequired(false);
    answeredQuestionIds.current.add(currentEx.id);
    if (countedAsAttempt) {
      if (isIndependentPhase) {
        setIndependentEvidence(prev => ({ ...prev, [questionIndex]: false }));
      }
      advanceToNextQuestion();
      return;
    }
    setReplacedQuestions(count => count + 1);
    setQuestionUsesHighAchiever(isHighAchiever && !todayContext.active);
    setReloadNonce(value => value + 1);
    showToast('Question replaced. Incomplete parts were not counted as a completed question.', 'info');
  };

  // Multi-part "mark for review & continue": advance to the next sub-part that
  // is not yet correct without requiring the current part to be solved. If no
  // sub-parts remain, fall through to the next whole question. This guarantees
  // the student is never trapped on a stubborn sub-part.
  const handleAdvanceMultipart = () => {
    if (!currentEx || currentEx.question_type !== 'multi_part') {
      handleNext();
      return;
    }
    const norm = (label: unknown) => String(label || '').toLowerCase().trim();
    const parts = currentEx.sub_parts || [];
    const currentIdx = parts.findIndex((p: SubPart) => norm(p.label) === (activeMultipartLabel ?? ''));
    const activeResult = multiPartResults.find(
      (res: SubPartResult) => norm(res.label) === (activeMultipartLabel ?? ''),
    );
    const selectedUnansweredPart = currentIdx >= 0 && !activeResult?.student_answer
      ? parts[currentIdx]
      : undefined;
    const nextPart = selectedUnansweredPart || parts
      .slice(currentIdx + 1)
      .find((p: SubPart) => {
        const r = multiPartResults.find((res: SubPartResult) => norm(res.label) === norm(p.label));
        return r?.is_correct !== true;
      });

    if (nextPart) {
      setActiveMultipartLabel(norm(nextPart.label));
      setAnswer('');
      setMarkResponse(null);
      setIsExplaining(false);
      setSuggestedActions([]);
      setStatus('ready');
    } else {
      handleNext();
    }
  };

  const handleToggleHighAchiever = () => {
    if (todayContext.active) return;
    const nextMode = !isHighAchiever;
    const hasCurrentWork = Boolean(
      answer.trim()
      || currentQuestionAttempted
      || markResponse
      || multiPartResults.some(part => part.student_answer?.trim()),
    );
    setIsHighAchiever(nextMode);
    if (!hasCurrentWork) {
      setQuestionUsesHighAchiever(nextMode);
    }
  };

  const handleTopicChange = (topic: string) => {
    finaliseCurrentMultiPartForSession();
    setQuestionUsesHighAchiever(isHighAchiever);
    setActiveTopic(topic);
    setQuestionIndex(0);
    setIsExplaining(false);
    setSuggestedActions([]);
    setChatHistory([{ role: 'system', content: 'Try the question first. Open the tutor if you become stuck or want feedback on your working.' }]);
    setStats({ attempted: 0, scored: 0, pendingReview: 0, correct: 0, hintClicks: 0, hintsBeforeAttempt: 0, hintsAfterAttempt: 0, dialogueTurns: 0, preAttemptHelpTurns: 0, workedExamplesOpened: 0, confidenceJudgements: 0, highConfidenceCorrect: 0, highConfidenceErrors: 0, lowConfidenceCorrect: 0, reasoningScores: [], errorTypes: {}, topicsTouched: [] });
    setReplacedQuestions(0);
    answeredQuestionIds.current.clear();
    attemptedQuestionIds.current.clear();
    setCurrentQuestionAttempted(false);
    correctQuestionIds.current.clear();
    priorQuestionId.current = null;
    priorQuestionRef.current = null;
    supportLevelRef.current = 0;
    multiPartAttemptsRef.current.clear();
    multiPartHadIncorrectRef.current = false;
    selfExplanationCountRef.current = 0;
    setIndependentEvidence({});
    forcedTopicRef.current = null;
    topicQueueRef.current = [];
    setTopicQueueActive(false);
  };

  const handleFinishSession = () => {
    if (correctionRequired || selfExplanationRequired) return;
    finaliseCurrentMultiPartForSession();
    setStatus('summary');
  };

  const handleRetryLoad = () => {
    setLoadError('');
    setReloadNonce(prev => prev + 1);
  };

  const hasUnsavedDraft = Boolean(
    (status === 'ready' && answer.trim())
    || (selfExplanationRequired && selfExplanation.trim()),
  );

  useEffect(() => {
    if (!hasUnsavedDraft) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedDraft]);

  // Exit handlers
  const handleExit = () => {
    if (hasUnsavedDraft && !window.confirm('Discard your unsaved answer and leave Guided Practice?')) {
      return;
    }
    if (todayContext.returnTo) {
      router.push(todayContext.returnTo);
      return;
    }
    router.push(todayContext.active
      ? buildTodayHref({ subject: pickerValue.subject, year: pickerValue.year })
      : buildPracticeHref({ subject: pickerValue.subject, year: pickerValue.year }));
  };

  const topicName = curriculum ? getTopicDisplayName(curriculum, activeTopic, activeTopic) : activeTopic;
  const successCriterion = lessonContent?.lesson_content?.success_criteria?.[0]
    ?? lessonContent?.lesson_content?.learning_objectives?.[0]
    ?? null;
  const subjectColor = isHighAchiever ? '#9333ea' : adapter.subject === 'english' ? '#0891b2' : 'var(--accent-color)';
  const showMathToolbar = isMathSubject(pickerValue.subject);

  const hasRubricScore = markResponse?.score !== undefined && markResponse?.max_score !== undefined;
  const partialSuccess = markResponse && hasRubricScore
    ? adapter.partialSuccessLabel(markResponse.score, markResponse.max_score!)
    : markResponse?.is_correct
      ? { label: 'Correct! Well Done.', tone: 'excellent' as const }
      : { label: '', tone: 'needs_work' as const };

  const independentTotal = sessionLimit >= 4 ? 2 : 0;
  const independentCorrect = independentTotal > 0
    ? [sessionLimit - 2, sessionLimit - 1].filter(index => independentEvidence[index] === true).length
    : 0;
  const readyToFade = independentTotal > 0 && independentCorrect === independentTotal;

  // Multi-part: does any sub-part remain not-yet-correct? Drives the
  // "mark for review & continue" control in the feedback card.
  const multiPartHasRemaining = currentEx?.question_type === 'multi_part'
    ? (currentEx.sub_parts || []).some((p: SubPart) => {
        const pl = String(p.label || '').toLowerCase().trim();
        const r = multiPartResults.find((res: SubPartResult) => String(res.label || '').toLowerCase().trim() === pl);
        return r?.is_correct !== true;
      })
    : false;

  return (
    <GuidedPracticeShell
      topicDisplayName={topicName}
      subject={pickerValue.subject}
      yearLevel={pickerValue.year}
      questionIndex={questionIndex}
      totalQuestions={sessionLimit}
      completedQuestions={stats.attempted}
      replacedQuestions={replacedQuestions}
      isHighAchiever={isHighAchiever}
      highAchieverAppliesNext={questionUsesHighAchiever !== isHighAchiever}
      allowHighAchiever={!todayContext.active}
      onToggleHighAchiever={handleToggleHighAchiever}
      onExit={handleExit}
      dailySummary={dailySummary}
      activeTopic={activeTopic}
      curriculum={curriculum}
      onChangeTopic={todayContext.active || topicQueueActive ? undefined : handleTopicChange}
      hasSessionProgress={stats.attempted > 0 || questionIndex > 0 || hasUnsavedDraft || multiPartResults.some(part => Boolean(part.student_answer?.trim()))}
      onFinishSession={stats.attempted > 0 && !correctionRequired && !selfExplanationRequired ? handleFinishSession : undefined}
      selectionReason={selectionReason}
    >
      {todayContext.active && (
        <TodaySessionBar
          subject={pickerValue.subject}
          year={pickerValue.year}
          refreshTrigger={`${stats.attempted}:${stats.correct}`}
        />
      )}
      {showDiagnosticPrompt ? (
        <div className="glass-panel" style={{
          padding: '28px',
          borderRadius: '20px',
          maxWidth: '600px',
          margin: '40px auto',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}>
          <span style={{ fontSize: '48px' }}>🔍</span>
          <h2 style={{ fontSize: '20px', fontWeight: '800', margin: 0, color: 'var(--text-primary)' }}>
            Calibrate Your Learning Path
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.6', margin: 0 }}>
            Taking a diagnostic first is highly recommended. It takes about 10–15 minutes and allows the Socratic tutor to select exercises perfectly matched to your current strengths and goals.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '8px' }}>
            <button
              onClick={() => router.push('/diagnostic')}
              style={{
                background: subjectColor,
                color: 'white',
                padding: '12px 24px',
                borderRadius: '10px',
                fontWeight: '700',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Take Diagnostic First
            </button>
            <button
              onClick={() => setShowDiagnosticPrompt(false)}
              style={{
                background: 'transparent',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                padding: '12px 24px',
                borderRadius: '10px',
                fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              Practise Anyway
            </button>
          </div>
        </div>
      ) : (
        <>
          {status === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '12px' }}>
              <div className={styles.spinner} style={{ width: '40px', height: '40px', border: `3px solid ${subjectColor}40`, borderTopColor: subjectColor }} />
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Loading next conceptual exercise...</div>
            </div>
          )}

          {status === 'error' && (
            <div className="glass-panel" style={{
              padding: '28px',
              borderRadius: '18px',
              maxWidth: '620px',
              margin: '40px auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              background: 'rgba(245, 158, 11, 0.08)'
            }}>
              <div style={{ fontSize: '34px' }}>🧭</div>
              <h2 style={{ margin: 0, fontSize: '20px', color: 'var(--text-primary)' }}>We could not load that guided question</h2>
              <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {loadError || 'Could not load the next question.'}{' '}
                {todayContext.active
                  ? 'You can try again or return to Today Study. Your saved progress is unchanged.'
                  : 'You can try again, switch topic from the sidebar, or return to full practice.'}
              </p>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button onClick={handleRetryLoad} style={{ background: subjectColor, color: 'white', border: 'none', borderRadius: '10px', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}>
                  Try again
                </button>
                <button onClick={handleExit} style={{ background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}>
                  {todayContext.active ? 'Return to Today Study' : 'Return to full practice'}
                </button>
              </div>
              {!todayContext.active && (
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>Tip: use Switch Topic Manually if this topic has no available questions yet.</p>
              )}
            </div>
          )}

          {status === 'ready' && currentEx && (
            <div
              style={{
                display: 'grid',
                // The question keeps at least 480px; the help panel shares the rest.
                gridTemplateColumns: isIndependentPhase ? '1fr' : 'minmax(480px, 3fr) minmax(320px, 2fr)',
                gap: '16px',
                alignItems: 'start',
              }}
              className={styles.panelsGrid}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
                {questionIndex === 0 && !currentQuestionAttempted && successCriterion && (
                  <aside
                    aria-label="Session success criterion"
                    style={{
                      padding: '13px 14px', borderRadius: '11px',
                      background: 'rgba(16,185,129,0.09)', border: '1px solid rgba(16,185,129,0.28)',
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 850, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Today’s “I can” goal
                    </div>
                    <div style={{ marginTop: '4px', fontSize: '14px', lineHeight: 1.5, color: 'var(--text-primary)' }}>
                      <MathMarkdown>{successCriterion}</MathMarkdown>
                    </div>
                    {!successCriterionAcknowledged ? (
                      <button
                        type="button"
                        onClick={() => setSuccessCriterionAcknowledged(true)}
                        style={{ marginTop: '8px', padding: '7px 11px', borderRadius: '8px', border: 'none', background: '#15803d', color: 'white', fontWeight: 750, cursor: 'pointer' }}
                      >
                        I’m ready to prove it
                      </button>
                    ) : (
                      <div role="status" style={{ marginTop: '7px', fontSize: '12px', color: '#15803d', fontWeight: 700 }}>
                        Goal noted — the final independent check will return to it.
                      </div>
                    )}
                  </aside>
                )}
                {isIndependentPhase && (
                  <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.24)', color: '#15803d', fontSize: '13px', fontWeight: 700 }}>
                    Independent check: concept, examples and AI help are hidden for this question.
                  </div>
                )}
                <GuidedQuestionCard
                  exercise={currentEx}
                  answer={answer}
                  onSetAnswer={setAnswer}
                  onSubmit={handleSubmitAnswer}
                  onSkip={!correctionRequired && !selfExplanationRequired ? handleSkipQuestion : undefined}
                  submitting={submitting}
                  multiPartResults={multiPartResults}
                  activeMultipartLabel={activeMultipartLabel}
                  onSetActivePart={setActiveMultipartLabel}
                  subjectColor={subjectColor}
                  showMathToolbar={showMathToolbar}
                />
                {answer.trim() && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <strong>How sure?</strong>
                    {([['guess', 'Guessing'], ['maybe', 'Probably'], ['sure', 'Certain']] as const).map(([value, label]) => (
                      <button key={value} type="button" onClick={() => setConfidence(value)} style={{ padding: '6px 10px', borderRadius: '8px', border: confidence === value ? `2px solid ${subjectColor}` : '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {!isIndependentPhase && (isHighAchiever || hasHighMastery || Boolean(labLinkForTopic)) && (
                  <AdvancedLessonExtension data={advancedLesson} subjectColor={subjectColor} labLink={labLinkForTopic} />
                )}
              </div>
              {/* Stable viewport height — independent of variable question card height */}
              {!isIndependentPhase && (
                <div
                  className={styles.helpColumn}
                  style={{
                    minWidth: 0,
                    height: 'calc(100vh - 168px)',
                    maxHeight: 'calc(100vh - 168px)',
                    position: 'sticky',
                    top: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <GuidedHelpDrawer
                    lessonContent={lessonContent}
                    workedExample={workedExample}
                    chatHistory={chatHistory}
                    onSendMessage={handleSendMessage}
                    suggestedActions={suggestedActions}
                    onSuggestedAction={handleSuggestedAction}
                    dialogueLoading={dialogueLoading}
                    helpChips={adapter.helpChips}
                    subjectColor={subjectColor}
                    hasAttempted={currentQuestionAttempted}
                    isExplaining={isExplaining}
                    exampleOpenToken={workedExampleOpenToken}
                    onSupportUsed={recordHelp}
                  />
                </div>
              )}
            </div>
          )}

          {status === 'feedback' && currentEx && markResponse && (
            <div
              style={{
                display: 'grid',
                // The question keeps at least 480px; the help panel shares the rest.
                gridTemplateColumns: isIndependentPhase ? '1fr' : 'minmax(480px, 3fr) minmax(320px, 2fr)',
                gap: '16px',
                alignItems: 'start',
              }}
              className={styles.panelsGrid}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
                {selfExplanationRequired && (
                  <div className="glass-panel" style={{ padding: '16px', borderRadius: '14px', border: '1px solid rgba(16,185,129,0.3)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <strong>One-sentence explanation before you continue</strong>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      What rule or idea made your corrected answer work? Use at least {MIN_SELF_EXPLANATION_WORDS} words.
                    </span>
                    <textarea aria-label="Self explanation" value={selfExplanation} onChange={event => setSelfExplanation(event.target.value)} maxLength={300} rows={2} placeholder="The answer works because…" style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />
                    <div style={{ fontSize: '11px', color: hasMinimumSelfExplanation(selfExplanation) ? '#15803d' : 'var(--text-muted)' }}>
                      {selfExplanationWordCount(selfExplanation)}/{MIN_SELF_EXPLANATION_WORDS} words minimum
                    </div>
                    <button type="button" onClick={handleSaveSelfExplanation} disabled={!hasMinimumSelfExplanation(selfExplanation) || savingSelfExplanation} style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: '8px', background: subjectColor, color: 'white', fontWeight: 700, opacity: hasMinimumSelfExplanation(selfExplanation) && !savingSelfExplanation ? 1 : 0.55 }}>
                      {savingSelfExplanation ? 'Saving…' : 'Save explanation'}
                    </button>
                  </div>
                )}
                {markResponse.is_correct && submittedConfidence && (
                  <div style={{ fontSize: '13px', fontWeight: 700, color: submittedConfidence === 'sure' ? '#15803d' : '#b45309' }}>
                    {submittedConfidence === 'sure'
                      ? 'Confident and correct — well calibrated.'
                      : submittedConfidence === 'guess'
                        ? 'Correct with low confidence — explain the rule to make it stick.'
                        : 'Correct — your confidence is building.'}
                  </div>
                )}
                <GuidedFeedbackCard
                  markResponse={markResponse}
                  exercise={currentEx}
                  studentAnswer={answer}
                  onNext={handleNext}
                  onExplainMyAnswer={handleExplainMyAnswer}
                  onTryAgain={handleTryAgain}
                  onSkipQuestion={handleSkipFeedbackQuestion}
                  onShowWorkedExample={handleShowWorkedExample}
                  isLastQuestion={questionIndex === sessionLimit - 1}
                  subjectColor={subjectColor}
                  partialSuccessLabel={partialSuccess}
                  isMultiPart={currentEx.question_type === 'multi_part'}
                  multiPartHasRemaining={multiPartHasRemaining}
                  onContinuePart={handleAdvanceMultipart}
                  requiresCorrection={correctionRequired}
                  independentPhase={isIndependentPhase}
                />
                {!isIndependentPhase && (isHighAchiever || hasHighMastery || Boolean(labLinkForTopic)) && (
                  <AdvancedLessonExtension data={advancedLesson} subjectColor={subjectColor} labLink={labLinkForTopic} />
                )}
              </div>
              {!isIndependentPhase && (
                <div
                  className={styles.helpColumn}
                  style={{
                    minWidth: 0,
                    height: 'calc(100vh - 168px)',
                    maxHeight: 'calc(100vh - 168px)',
                    position: 'sticky',
                    top: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <GuidedHelpDrawer
                    lessonContent={lessonContent}
                    workedExample={workedExample}
                    chatHistory={chatHistory}
                    onSendMessage={handleSendMessage}
                    suggestedActions={suggestedActions}
                    onSuggestedAction={handleSuggestedAction}
                    dialogueLoading={dialogueLoading}
                    helpChips={adapter.helpChips}
                    subjectColor={subjectColor}
                    hasAttempted={true}
                    isExplaining={isExplaining}
                    exampleOpenToken={workedExampleOpenToken}
                    onSupportUsed={recordHelp}
                  />
                </div>
              )}
            </div>
          )}

          {status === 'summary' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '680px', margin: '0 auto', width: '100%' }}>
              <GuidedSessionSummary
                total={sessionLimit}
                attempted={stats.attempted}
                pendingReview={stats.pendingReview}
                hintClicks={stats.hintClicks}
                dialogueTurns={stats.dialogueTurns}
                workedExamplesOpened={stats.workedExamplesOpened}
                readyToFade={readyToFade}
                todaySession={todayContext.active}
                replacedQuestions={replacedQuestions}
                independentCorrect={independentCorrect}
                independentTotal={independentTotal}
                successCriterion={successCriterion}
              />
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button
                  onClick={handleExit}
                  style={{
                    background: subjectColor,
                    color: 'white',
                    padding: '12px 24px',
                    borderRadius: '10px',
                    border: 'none',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {todayContext.active ? 'Continue Today’s Study' : 'Return to practice'}
                </button>
              </div>
              <details className="glass-panel" style={{ padding: '16px 18px', borderRadius: '14px' }}>
                <summary style={{ cursor: 'pointer', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Show parent summary
                </summary>
                <div style={{ marginTop: '14px' }}>
                  <ParentNextStepsCard
                    score={independentTotal > 0 ? independentCorrect : stats.correct}
                    total={independentTotal > 0 ? independentTotal : stats.scored}
                    hintClicks={stats.hintClicks}
                    hintsBeforeAttempt={stats.hintsBeforeAttempt}
                    hintsAfterAttempt={stats.hintsAfterAttempt}
                    dialogueTurns={stats.dialogueTurns}
                    workedExamplesOpened={stats.workedExamplesOpened}
                    topicName={topicName}
                    config={adapter.parentSummaryConfig}
                    subjectColor={subjectColor}
                    backendData={parentNextStepsData}
                  />
                </div>
              </details>
            </div>
          )}
        </>
      )}

    </GuidedPracticeShell>
  );
}
