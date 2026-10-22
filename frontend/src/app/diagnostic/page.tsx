'use client';

import { useEffect, useState, useCallback, useRef, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import MathMarkdown from '../../components/MathMarkdown';
import QuestionDisplay from '../../components/tutor/QuestionDisplay';
import MCQInput from '../../components/tutor/MCQInput';
import MathSymbolKeyboard from '../../components/MathSymbolKeyboard';
import FrameworkSubjectYearPicker from '../../components/FrameworkSubjectYearPicker';
import TodaySessionBar from '../../components/TodaySessionBar';
import { getSubject, getYear } from '../../lib/preferences';
import { fetchCurriculum } from '../../lib/api';
import {
  diagnosticStatus,
  diagnosticStart,
  diagnosticRespond,
  diagnosticDismiss,
} from '../../lib/api';
import { buildPracticeHref, buildScopedQuery, buildTodayHref, isTodaySession, scopedSubjectFromSearchParams, scopedYearFromSearchParams } from '../../lib/scoped_navigation';
import { BackToPracticeButton } from '../../components/BackToPracticeLink';
import type { DiagnosticArea, DiagnosticBand, DiagnosticCoverage, DiagnosticQuestion, DiagnosticProgress, Subject, YearLevel } from '../../lib/api-types';
import { isMathSubject } from '../../lib/subject_registry';
import { findTopicInCurriculum, topicLabel, topicLabelParts, type Curriculum } from '../../lib/curriculum_helpers';

/**
 * Diagnostic Assessment Page (Phase 7, Task 8).
 *
 * Presents an adaptive diagnostic one question at a time with a progress bar.
 * No BKT/study-plan widgets are shown during the run (Req 8.2).
 * On finalisation, renders a result summary (Req 8.3).
 */

const DIAGNOSTIC_DRAFT_KEY = 'qld_tutor_diagnostic_draft_v1';

interface DiagnosticDraft {
  reportId: string;
  questionId: string;
  answer: string;
  partAnswers: Record<string, string>;
  savedAt: string;
}

function clearDiagnosticDraft(): void {
  try {
    localStorage.removeItem(DIAGNOSTIC_DRAFT_KEY);
  } catch {
    // Draft persistence is best effort and must not block the assessment.
  }
}

interface DiagnosticState {
  reportId: string | null;
  question: DiagnosticQuestion | null;
  progress: DiagnosticProgress;
  completed: boolean;
  areas: Record<string, DiagnosticArea>;
  startTopics: string[];
  warnings: string[];
  validCompletion: boolean | null;
  retakeAvailable: boolean;
  nextEligibleAt: string | null;
  coverage: DiagnosticCoverage | null;
  inProgress: boolean;
  loading: boolean;
  error: string | null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const BAND_LABEL: Record<DiagnosticBand, string> = {
  start_here: 'Start here',
  building: 'Building',
  secure: 'Secure',
};

const BAND_GROUPS: Array<[DiagnosticBand, string, string, string]> = [
  ['start_here', 'Start here', 'Begin with the foundations of these areas.', '#dc2626'],
  ['building', 'Building', 'You know part of this. Practise to make it secure.', '#d97706'],
  ['secure', 'Secure', 'You answered year-level questions well in these areas.', '#16a34a'],
];

function parseYearLevel(year: YearLevel): number {
  const match = /^year(\d+)$/.exec(String(year));
  return match ? Number(match[1]) : 7;
}

function formatDiagnosticDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export default function DiagnosticPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<'setup' | 'in_progress' | 'results' | 'loading'>('loading');
  const [pickerValue, setPickerValue] = useState<{ subject: Subject; year: YearLevel }>({ subject: 'math', year: 'year7' });
  const [todaySessionContext, setTodaySessionContext] = useState<{ active: boolean; taskId: string | null }>({ active: false, taskId: null });
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DIAGNOSTIC_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DiagnosticDraft>;
        if (
          typeof parsed.reportId === 'string'
          && typeof parsed.questionId === 'string'
          && typeof parsed.answer === 'string'
          && parsed.partAnswers
          && typeof parsed.partAnswers === 'object'
        ) {
          diagnosticDraftRef.current = {
            reportId: parsed.reportId,
            questionId: parsed.questionId,
            answer: parsed.answer,
            partAnswers: parsed.partAnswers as Record<string, string>,
            savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
          };
        }
      }
    } catch {
      diagnosticDraftRef.current = null;
    }
    const params = new URLSearchParams(window.location.search);
    setPickerValue({
      subject: scopedSubjectFromSearchParams(params, getSubject() as Subject),
      year: scopedYearFromSearchParams(params, getYear() as YearLevel),
    });
    setTodaySessionContext({
      active: isTodaySession(params),
      taskId: params.get('today_task'),
    });
    setIsHydrated(true);
  }, []);
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [state, setState] = useState<DiagnosticState>({
    reportId: null,
    question: null,
    progress: { current: 0, total: 15 },
    completed: false,
    areas: {},
    startTopics: [],
    warnings: [],
    validCompletion: null,
    retakeAvailable: false,
    nextEligibleAt: null,
    coverage: null,
    inProgress: false,
    loading: true,
    error: null,
  });
  const [answer, setAnswer] = useState('');
  const [partAnswers, setPartAnswers] = useState<Record<string, string>>({});
  const [confidence, setConfidence] = useState<'guess' | 'maybe' | 'sure' | null>(null);
  const [retestArea, setRetestArea] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusRetryKey, setStatusRetryKey] = useState(0);
  const diagnosticDraftRef = useRef<DiagnosticDraft | null>(null);
  const suppressDraftSaveRef = useRef(false);
  const diagnosticUnavailable = String(pickerValue.subject).startsWith('senior_') || String(pickerValue.year).startsWith('unit');
  const practiceHref = buildPracticeHref({ subject: pickerValue.subject, year: pickerValue.year });
  const todayHref = buildTodayHref({ subject: pickerValue.subject, year: pickerValue.year });
  const exitHref = todaySessionContext.active ? todayHref : practiceHref;
  const todaySessionBar = todaySessionContext.active ? (
    <TodaySessionBar
      subject={pickerValue.subject}
      year={pickerValue.year}
      activeTaskId={todaySessionContext.taskId}
      refreshTrigger={`${state.progress.current}:${state.completed}`}
    />
  ) : null;

  // Persist the current diagnostic answer locally so leaving the page does not
  // discard a long reasoning response. The backend remains the source of truth;
  // this draft is only restored for the same report and question.
  useEffect(() => {
    if (phase !== 'in_progress' || !state.reportId || !state.question) return;
    if (suppressDraftSaveRef.current) {
      suppressDraftSaveRef.current = false;
      return;
    }
    const draft: DiagnosticDraft = {
      reportId: state.reportId,
      questionId: state.question.id,
      answer,
      partAnswers,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(DIAGNOSTIC_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Ignore quota/private-mode errors; the answer remains in React state.
    }
  }, [answer, partAnswers, phase, state.question, state.reportId]);

  useEffect(() => {
    const abort = new AbortController();
    fetchCurriculum(abort.signal, {
      subject: pickerValue.subject,
      scope: pickerValue.year,
    }).then(setCurriculum).catch(() => {});
    return () => abort.abort();
  }, [pickerValue.subject, pickerValue.year]);

  // Check status when the selected subject/year changes
  useEffect(() => {
    if (!isHydrated) return;
    const abort = new AbortController();
    const yearLevel = parseYearLevel(pickerValue.year);
    if (diagnosticUnavailable) {
      setPhase('setup');
      setState(prev => ({
        ...prev,
        reportId: null,
        question: null,
        progress: { current: 0, total: 15 },
        completed: false,
        areas: {},
        startTopics: [],
        warnings: [],
        validCompletion: null,
        retakeAvailable: false,
        nextEligibleAt: null,
        coverage: null,
        inProgress: false,
        loading: false,
        error: null,
      }));
      return () => abort.abort();
    }
    setPhase('loading');
    setState(prev => ({
      ...prev,
      reportId: null,
      question: null,
      progress: { current: 0, total: 15 },
      completed: false,
      areas: {},
      startTopics: [],
      warnings: [],
      validCompletion: null,
      retakeAvailable: false,
      nextEligibleAt: null,
      coverage: null,
      inProgress: false,
      loading: true,
      error: null,
    }));
    diagnosticStatus(pickerValue.subject, yearLevel, abort.signal)
      .then(data => {
        if (abort.signal.aborted) return;
        if (data.completed) setPhase('results');
        else setPhase('setup');
        setState(prev => ({
          ...prev,
          reportId: data.report_id ?? null,
          progress: {
            current: data.current ?? 0,
            total: data.total ?? prev.progress.total,
          },
          completed: data.completed,
          areas: data.areas || {},
          startTopics: data.start_topics || [],
          warnings: data.grading_warnings || [],
          validCompletion: data.valid_completion ?? null,
          retakeAvailable: Boolean(data.retake_available),
          nextEligibleAt: data.next_eligible_at ?? null,
          coverage: data.coverage ?? null,
          inProgress: Boolean(data.in_progress),
          loading: false,
          error: null,
        }));
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setPhase('setup');
        setState(prev => ({
          ...prev,
          loading: false,
          error: errorMessage(error, 'Could not check your saved diagnostic. Please retry.'),
        }));
      });
    return () => abort.abort();
  }, [pickerValue.subject, pickerValue.year, diagnosticUnavailable, isHydrated, statusRetryKey]);

  const handleStartDiagnostic = async (area?: string) => {
    if (diagnosticUnavailable) return;
    setActionError(null);
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const yearLevel = parseYearLevel(pickerValue.year);
      const data = await diagnosticStart(pickerValue.subject, yearLevel, undefined, area);
      if (data.error) {
        setState(prev => ({ ...prev, loading: false, error: data.message || 'Failed to start diagnostic.' }));
        return;
      }
      setRetestArea(area ?? null);
      const savedDraft = diagnosticDraftRef.current;
      const canRestoreDraft = Boolean(
        savedDraft
        && savedDraft.reportId === data.report_id
        && savedDraft.questionId === data.question.id,
      );
      setState({
        reportId: data.report_id,
        question: data.question,
        progress: data.progress,
        completed: false,
        areas: {},
        startTopics: [],
        warnings: [],
        validCompletion: null,
        retakeAvailable: false,
        nextEligibleAt: null,
        coverage: data.coverage ?? null,
        inProgress: false,
        loading: false,
        error: null,
      });
      suppressDraftSaveRef.current = false;
      setAnswer(canRestoreDraft ? savedDraft!.answer : '');
      setPartAnswers(canRestoreDraft ? savedDraft!.partAnswers : {});
      diagnosticDraftRef.current = null;
      setPhase('in_progress');
    } catch (error: unknown) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage(error, 'Failed to start diagnostic.'),
      }));
    }
  };

  const submitAnswer = useCallback(async (notLearned = false) => {
    if (!state.reportId || !state.question || submitting) return;
    const submittedAnswer = notLearned
      ? ''
      : state.question.question_type === 'multi_part'
        ? JSON.stringify(partAnswers)
        : answer;
    setActionError(null);
    setSubmitting(true);
    try {
      const data = await diagnosticRespond(
        state.reportId,
        state.question.id,
        submittedAnswer,
        undefined,
        undefined,
        { notLearned, confidence: notLearned ? null : confidence },
      );
      if (data.error) {
        setActionError(data.message || 'Failed to submit answer. Please try again.');
        return;
      }
      clearDiagnosticDraft();
      suppressDraftSaveRef.current = true;
      diagnosticDraftRef.current = null;
      if (data.completed) {
        setState(prev => ({
          ...prev,
          completed: true,
          areas: data.areas || {},
          startTopics: data.start_topics || [],
          warnings: data.grading_warnings || [],
          validCompletion: data.valid_completion ?? null,
          retakeAvailable: Boolean(data.retake_available),
          nextEligibleAt: data.next_eligible_at ?? null,
          coverage: data.coverage ?? prev.coverage,
        }));
        setPhase('results');
      } else {
        setState(prev => ({
          ...prev,
          question: data.question || null,
          progress: data.progress || prev.progress,
        }));
      }
      setAnswer('');
      setPartAnswers({});
      setConfidence(null);
    } catch (error: unknown) {
      setActionError(errorMessage(error, 'Failed to submit answer. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }, [state.reportId, state.question, answer, partAnswers, submitting, confidence]);

  const handleDismiss = async () => {
    setActionError(null);
    try {
      const yearLevel = parseYearLevel(pickerValue.year);
      await diagnosticDismiss(pickerValue.subject, yearLevel);
      router.push(exitHref);
    } catch (error: unknown) {
      setActionError(errorMessage(error, 'Could not skip the diagnostic. Please retry.'));
    }
  };

  const handleSaveAndContinueLater = () => {
    if (state.reportId && state.question) {
      try {
        localStorage.setItem(DIAGNOSTIC_DRAFT_KEY, JSON.stringify({
          reportId: state.reportId,
          questionId: state.question.id,
          answer,
          partAnswers,
          savedAt: new Date().toISOString(),
        } satisfies DiagnosticDraft));
      } catch {
        // The answer is still held by the page if storage is unavailable.
      }
    }
    router.push(exitHref);
  };

  // Setup phase
  if ((phase === 'setup' || phase === 'loading') && !state.error) {
    return (
      <div className="diagnostic-container" aria-label="Diagnostic Assessment">
        {todaySessionBar}
        <div className="glass-panel" style={{ padding: '32px', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
          <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '16px' }}>Diagnostic Assessment</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '14px' }}>
            {phase === 'loading'
              ? 'Checking status...'
              : 'Sample your available curriculum skills to get personalised recommendations.'}
          </p>
          {phase !== 'loading' && !diagnosticUnavailable && (
            <div style={{ marginBottom: '20px', padding: '14px 16px', borderRadius: '9px', background: 'rgba(14,165,233,0.07)', border: '1px solid rgba(14,165,233,0.2)', textAlign: 'left', fontSize: '13px', lineHeight: 1.55, color: 'var(--text-secondary)' }}>
              <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: '5px' }}>This finds your starting point — it is not a grade.</strong>
              {state.coverage?.estimated_questions && state.coverage.area_count
                ? `It takes about ${state.coverage.estimated_questions} questions across ${state.coverage.area_count} areas and stops by 24. `
                : 'It takes about 12–18 questions and stops by 24. '}
              If you have not learned something yet, choose “I haven’t learned this yet” instead of guessing. That is not counted as a mistake.
              <span style={{ display: 'block', marginTop: '8px' }}>
                <strong style={{ color: 'var(--text-primary)' }}>How feedback works:</strong>{' '}
                each answer is recorded without showing right or wrong immediately. At the end, each area is shown as Start here, Building or Secure, with the topic to begin with.
              </span>
            </div>
          )}
          {curriculum && !todaySessionContext.active && (
            <div style={{ marginBottom: '20px', textAlign: 'left' }}>
              <FrameworkSubjectYearPicker
                curriculum={curriculum}
                value={pickerValue}
                onChange={setPickerValue}
              />
            </div>
          )}
          {state.inProgress && !diagnosticUnavailable && (
            <div style={{
              marginBottom: '16px', padding: '12px 14px', borderRadius: '8px',
              border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.08)',
              color: 'var(--text-primary)', fontSize: '13px', textAlign: 'left',
            }} role="status">
              You have a saved diagnostic with {state.progress.current} answer{state.progress.current === 1 ? '' : 's'} recorded.
              Resume to continue from the next question.
            </div>
          )}
          {state.coverage?.reduced && state.coverage.message && !diagnosticUnavailable && (
            <div style={{
              marginBottom: '16px', padding: '12px 14px', borderRadius: '8px',
              border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.1)',
              color: 'var(--text-primary)', fontSize: '13px', textAlign: 'left', lineHeight: 1.5,
            }} role="status">
              <strong>Reduced diagnostic coverage.</strong> {state.coverage.message}
            </div>
          )}
          {diagnosticUnavailable && (
            <div style={{
              marginBottom: '16px',
              padding: '12px 14px',
              borderRadius: '8px',
              border: '1px solid rgba(245,158,11,0.3)',
              background: 'rgba(245,158,11,0.1)',
              color: 'var(--text-primary)',
              fontSize: '13px',
              textAlign: 'left',
            }}>
              Senior/unit diagnostics are not available yet. Use practice, mock exams, or Writing Hub feedback for senior courses.
            </div>
          )}
          <button
            onClick={() => { void handleStartDiagnostic(); }}
            disabled={state.loading || diagnosticUnavailable}
            className="btn-primary"
            style={{ padding: '12px 32px', fontSize: '16px', fontWeight: '700', marginTop: '8px', opacity: state.loading || diagnosticUnavailable ? 0.6 : 1 }}
          >
            {state.loading ? 'Starting...' : state.inProgress ? 'Resume Diagnostic' : 'Start Diagnostic'}
          </button>
          <div style={{ marginTop: '16px' }}>
            <BackToPracticeButton onClick={() => router.push(exitHref)}>
              {todaySessionContext.active ? '← Back to Today’s Study' : '← Back to Practice'}
            </BackToPracticeButton>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (state.error) {
    return (
      <div className="diagnostic-container" aria-label="Diagnostic Assessment">
        {todaySessionBar}
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
          <p style={{ color: 'var(--error-color, #ef4444)' }}>{state.error}</p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px' }}>
            <button onClick={() => {
              setState(prev => ({ ...prev, error: null }));
              setStatusRetryKey(key => key + 1);
            }} className="btn-primary" style={{ padding: '10px 20px' }}>
              Retry
            </button>
            <BackToPracticeButton onClick={() => router.push(exitHref)}>
              {todaySessionContext.active ? '← Back to Today’s Study' : '← Back to Practice'}
            </BackToPracticeButton>
          </div>
        </div>
      </div>
    );
  }

  // Completed state — result summary (Req 8.3)
  if (state.completed || phase === 'results') {
    const practiceScope = { subject: pickerValue.subject, year: pickerValue.year };
    const areaEntries = Object.entries(state.areas);
    const topicName = (topicId: string) => topicLabel(findTopicInCurriculum(curriculum, topicId), topicId);
    const primaryTopic = state.startTopics[0] || null;
    const guidedQuery = buildScopedQuery({
      ...practiceScope,
      topic: primaryTopic || undefined,
      todaySession: todaySessionContext.active,
      returnTo: todaySessionContext.active ? todayHref : practiceHref,
    });
    const guidedPracticeHref = `/guided-practice${guidedQuery ? `?${guidedQuery}` : ''}`;
    const showStartingPoint = Boolean(primaryTopic && !todaySessionContext.active && areaEntries.length > 0);
    const linkStyle = { color: 'var(--accent-color)', fontWeight: 700, textDecoration: 'none', fontSize: '12px' } as const;
    // Text-style button: cancel the global button chrome (gradient, white text, shadow, lift).
    const linkButtonStyle = {
      ...linkStyle, background: 'none', border: 'none', boxShadow: 'none', transform: 'none',
      padding: '4px 0', minHeight: '24px', textDecoration: 'underline', cursor: 'pointer',
    } as const;
    const renderArea = ([name, area]: [string, DiagnosticArea]) => (
      <li key={name} style={{ marginBottom: '12px' }}>
        <div>
          <strong>{name}</strong>{' '}
          <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
            {area.correct} of {area.questions} correct
            {area.not_learned ? ` · ${area.not_learned} not learned yet` : ''}
            {area.previous_band && area.previous_band !== area.band ? ` · was ${BAND_LABEL[area.previous_band]}` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 16px', alignItems: 'baseline', marginTop: '4px' }}>
          {area.start_topic && (() => {
            const parts = topicLabelParts(findTopicInCurriculum(curriculum, area.start_topic), area.start_topic);
            return (
              <a href={buildPracticeHref({ ...practiceScope, topic: area.start_topic })} style={linkStyle}>
                Practise {parts.primary}
                {parts.code && (
                  <>
                    {' '}
                    <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)' }}>{parts.code}</span>
                  </>
                )}
              </a>
            );
          })()}
          {!todaySessionContext.active && (
            <button
              type="button"
              onClick={() => { void handleStartDiagnostic(name); }}
              style={linkButtonStyle}
            >
              Retest this area
            </button>
          )}
        </div>
        {area.prior_year_check && !area.prior_year_check.correct && (
          <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '3px' }}>
            Also check the Year {area.prior_year_check.year} foundation:{' '}
            <a
              href={buildPracticeHref({
                subject: pickerValue.subject,
                year: `year${area.prior_year_check.year}` as YearLevel,
                topic: area.prior_year_check.topic_id,
              })}
              style={linkStyle}
            >
              {area.prior_year_check.topic_id}
            </a>
          </div>
        )}
      </li>
    );
    const resetForRetake = () => {
      clearDiagnosticDraft();
      diagnosticDraftRef.current = null;
      setPhase('setup');
      setState(prev => ({
        ...prev,
        reportId: null,
        question: null,
        progress: { current: 0, total: 15 },
        completed: false,
        areas: {},
        startTopics: [],
        warnings: [],
        validCompletion: null,
        retakeAvailable: false,
        nextEligibleAt: null,
        coverage: null,
        inProgress: false,
        error: null,
      }));
    };

    return (
      <div className="diagnostic-container" aria-label="Diagnostic Results">
        {todaySessionBar}
        <div className="glass-panel diagnostic-results-panel" style={{ padding: '32px', margin: '0 auto' }}>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Diagnostic Complete</h1>

          {state.nextEligibleAt && !state.retakeAvailable && (
            <div style={{
              marginBottom: '18px', padding: '12px 14px', borderRadius: '8px',
              background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.24)',
              color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5,
            }} role="status">
              <strong style={{ color: 'var(--text-primary)' }}>45-day diagnostic cooldown.</strong>{' '}
              Keep practising. You can retest one area at any time. Your next full diagnostic is available on{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{formatDiagnosticDate(state.nextEligibleAt)}</strong>.
            </div>
          )}

          {state.warnings.length > 0 && (
            <div style={{
              marginBottom: '18px', padding: '12px 14px', borderRadius: '8px',
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
              color: 'var(--text-primary)', fontSize: '13px', lineHeight: 1.5,
            }} role="status">
              <strong>{state.validCompletion === false ? 'Not enough scored evidence' : 'Scoring notes'}</strong>
              <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                {state.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            </div>
          )}

          {areaEntries.length === 0 && (
            <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
              No result was produced because there were no confirmed scored responses.
              Unscored or pending answers are marked <strong>not scored</strong> and do not start a cooldown.
            </p>
          )}

          {areaEntries.length > 0 && (
            <>
              {showStartingPoint && primaryTopic && (
                <div style={{
                  marginBottom: '16px', padding: '14px', borderRadius: '10px',
                  background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.24)',
                }}>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px', lineHeight: 1.5 }}>
                    Your starting point: <strong style={{ color: 'var(--text-primary)' }}>{topicName(primaryTopic)}</strong>.
                  </div>
                  <a
                    href={guidedPracticeHref}
                    className="btn-primary"
                    style={{ display: 'inline-block', padding: '10px 16px', textDecoration: 'none', fontSize: '13px', fontWeight: 700 }}
                  >
                    Start Guided Practice
                  </a>
                </div>
              )}
              <div className="diagnostic-results-grid">
                {BAND_GROUPS.map(([band, title, hint, color]) => {
                  const rows = areaEntries.filter(([, area]) => area.band === band);
                  if (rows.length === 0) return null;
                  return (
                    <section key={band} className="diagnostic-result-card" aria-label={title}>
                      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '4px', color }}>{title}</h2>
                      <p style={{ marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>{hint}</p>
                      <ul style={{ paddingLeft: '20px', margin: 0 }}>{rows.map(renderArea)}</ul>
                    </section>
                  );
                })}
              </div>
              {areaEntries.some(([, area]) => (area.not_learned ?? 0) > 0) && (
                <p style={{ marginTop: '12px', color: 'var(--text-secondary)', fontSize: '12px', lineHeight: 1.5 }}>
                  “Not learned yet” is not a mistake. It shows a topic to learn first, and it does not go into your Error Book.
                </p>
              )}
            </>
          )}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '16px' }}>
            {(state.validCompletion === false || state.retakeAvailable) && (
              <button
                onClick={resetForRetake}
                className={state.validCompletion === false ? 'btn-primary' : 'btn-secondary'}
              >
                {state.validCompletion === false ? 'Retake Diagnostic' : 'Start a new diagnostic'}
              </button>
            )}
            {/* One primary action per screen: the starting-point button, else the retake, else this. */}
            <button
              onClick={() => router.push(exitHref)}
              className={showStartingPoint || state.validCompletion === false ? 'btn-secondary' : 'btn-primary'}
            >
              {todaySessionContext.active ? 'Continue Today’s Study' : 'Return to Practice'}
            </button>
          </div>
          <p style={{ margin: '10px 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
            Diagnostic answers only find your starting point. They are not added to the Error Book.
          </p>
        </div>
      </div>
    );
  }

  // Active diagnostic — question display
  const areaTotal = state.progress.area_total ?? 0;
  const areaCurrent = state.progress.area_current ?? 1;
  const progressPercent = areaTotal > 0
    ? ((areaCurrent - 0.5) / areaTotal) * 100
    : state.progress.total > 0 ? (state.progress.current / state.progress.total) * 100 : 0;
  const progressLabel = areaTotal > 0
    ? `Area ${areaCurrent} of ${areaTotal} · Question ${state.progress.current}`
    : `Question ${state.progress.current}`;
  const answerComplete = state.question?.question_type === 'multi_part'
    ? (state.question.sub_parts || []).every(part => partAnswers[String(part.label || '').toLowerCase()]?.trim())
    : Boolean(answer.trim());
  const showMathKeyboard = isMathSubject(pickerValue.subject);
  const handleAnswerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && answerComplete && !submitting) {
      event.preventDefault();
      void submitAnswer();
    }
  };

  return (
    <div className="diagnostic-container" aria-label="Diagnostic Assessment">
      {todaySessionBar}
      <div className="glass-panel" style={{ padding: '32px', maxWidth: '1050px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: '700' }}>
            {retestArea ? `Retest: ${retestArea}` : 'Diagnostic Assessment'}
          </h1>
          <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            {progressLabel}
          </span>
        </div>

        {/* Progress bar */}
        <div
          role="progressbar"
          aria-valuenow={areaTotal > 0 ? areaCurrent : state.progress.current}
          aria-valuemin={0}
          aria-valuemax={areaTotal > 0 ? areaTotal : state.progress.total}
          aria-label={progressLabel}
          style={{
            width: '100%',
            height: '8px',
            background: 'var(--bg-secondary, #e5e7eb)',
            borderRadius: '4px',
            marginBottom: '24px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.min(100, progressPercent)}%`,
              height: '100%',
              background: 'var(--accent-color, #3b82f6)',
              borderRadius: '4px',
              transition: 'width 0.3s ease',
            }}
          />
        </div>

        {/* Question */}
        {state.question && (
          <div style={{ marginBottom: '24px' }}>
            <QuestionDisplay
              exercise={state.question}
              showSubParts={state.question.question_type === 'multi_part'}
            />
          </div>
        )}

        {/* Answer input */}
        <div style={{ marginBottom: '16px' }}>
          <label htmlFor="diagnostic-answer" className="sr-only">
            Your answer
          </label>
          {state.question?.question_type === 'multi_part' && state.question.sub_parts ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {state.question.sub_parts.map((part) => {
                const label = String(part.label || '').toLowerCase();
                return (
                  <fieldset key={label} style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <legend id={`diagnostic-part-${label}-label`} style={{ display: 'block', fontWeight: 700, marginBottom: '8px', padding: '0 4px' }}>
                      Part {String(part.label || '').toUpperCase()} {part.marks ? `(${part.marks} mark${part.marks === 1 ? '' : 's'})` : ''}
                      <span className="sr-only">: {part.question}</span>
                    </legend>
                    {part.choices && part.choices.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {part.choices.map((choice, index) => (
                          <label key={index} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                              type="radio"
                              name={`diagnostic-part-${label}`}
                              value={choice}
                              checked={partAnswers[label] === choice}
                              disabled={submitting}
                              onChange={(event) => {
                                setPartAnswers(prev => ({ ...prev, [label]: event.target.value }));
                              }}
                            />
                            <MathMarkdown inline>{choice}</MathMarkdown>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        id={`diagnostic-part-${label}`}
                        aria-labelledby={`diagnostic-part-${label}-label`}
                        value={partAnswers[label] || ''}
                        onChange={(event) => {
                          setPartAnswers(prev => ({ ...prev, [label]: event.target.value }));
                        }}
                        disabled={submitting}
                        onKeyDown={handleAnswerKeyDown}
                        maxLength={1000}
                        rows={3}
                        style={{
                          width: '100%',
                          minHeight: '88px',
                          padding: '12px 14px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                          fontSize: '15px',
                          fontFamily: 'inherit',
                          resize: 'vertical',
                          lineHeight: 1.45,
                          outline: 'none',
                        }}
                      />
                    )}
                  </fieldset>
                );
              })}
            </div>
          ) : state.question?.choices && state.question.choices.length > 0 ? (
            <MCQInput
              choices={state.question.choices}
              selected={answer}
              onSelect={setAnswer}
              disabled={submitting}
            />
          ) : state.question?.question_type === 'reasoning' ? (
            <>
              {showMathKeyboard && (
                <MathSymbolKeyboard
                  textareaId="diagnostic-answer"
                  onInsert={setAnswer}
                  disabled={submitting}
                />
              )}
              <textarea
                id="diagnostic-answer"
                value={answer}
                onChange={(e) => { setAnswer(e.target.value); }}
                onKeyDown={handleAnswerKeyDown}
                maxLength={1000}
                placeholder="Explain your reasoning... (Cmd/Ctrl+Enter to submit)"
                disabled={submitting}
                rows={5}
                style={{
                  minHeight: '180px',
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '16px',
                  border: '1px solid var(--border-color, #d1d5db)',
                  borderRadius: '8px',
                  background: 'var(--bg-primary, #fff)',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  lineHeight: '1.5',
                  boxSizing: 'border-box',
                }}
                aria-label="Your answer"
              />
            </>
          ) : (
            <>
              {showMathKeyboard && (
                <MathSymbolKeyboard
                  textareaId="diagnostic-answer"
                  onInsert={setAnswer}
                  disabled={submitting}
                />
              )}
              <textarea
                id="diagnostic-answer"
                value={answer}
                onChange={(e) => { setAnswer(e.target.value); }}
                onKeyDown={handleAnswerKeyDown}
                maxLength={1000}
                placeholder="Type your answer... (Cmd/Ctrl+Enter to submit)"
                disabled={submitting}
                rows={3}
                style={{
                  width: '100%',
                  minHeight: '120px',
                  padding: '12px 16px',
                  fontSize: '16px',
                  border: '1px solid var(--border-color, #d1d5db)',
                  borderRadius: '8px',
                  background: 'var(--bg-primary, #fff)',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  lineHeight: '1.5',
                  boxSizing: 'border-box',
                }}
                aria-label="Your answer"
              />
            </>
          )}
        </div>

        {actionError && (
          <div
            role="alert"
            style={{
              marginBottom: '14px', padding: '10px 12px', borderRadius: '8px',
              border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)',
              color: 'var(--error-color, #dc2626)', fontSize: '13px', lineHeight: 1.5,
            }}
          >
            <div>{actionError}</div>
            <div style={{ marginTop: '3px', color: 'var(--text-secondary)' }}>
              Your answer is still here; submit again when ready.
            </div>
          </div>
        )}

        {/* Optional confidence: "sure but wrong" points to a misconception. */}
        <div role="group" aria-label="How sure are you?" style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>How sure? (optional)</span>
          {([['guess', 'Guessing'], ['maybe', 'Probably'], ['sure', 'Certain']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={confidence === value}
              disabled={submitting}
              onClick={() => setConfidence(prev => (prev === value ? null : value))}
              style={{
                padding: '4px 10px', fontSize: '12px', borderRadius: '999px', cursor: 'pointer',
                border: '1px solid var(--border-color)',
                background: confidence === value ? 'var(--accent-color)' : 'transparent',
                color: confidence === value ? '#fff' : 'var(--text-primary)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={() => { void submitAnswer(); }}
            disabled={submitting || !answerComplete}
            className="btn-primary"
            style={{ padding: '10px 20px', fontSize: '14px', fontWeight: '600' }}
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
          <button
            onClick={() => { void submitAnswer(true); }}
            disabled={submitting}
            className="btn-secondary"
          >
            I haven’t learned this yet
          </button>
          <button
            onClick={handleSaveAndContinueLater}
            className="btn-secondary"
          >
            {todaySessionContext.active ? 'Save and return to Today’s Study' : 'Save and continue later'}
          </button>
          <button
            onClick={handleDismiss}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              background: 'transparent',
              border: 'none',
              boxShadow: 'none',
              transform: 'none',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Stop and don’t remind me
          </button>
        </div>
      </div>
    </div>
  );
}
