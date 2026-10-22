'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { analyticsScopeFromYear, examActive, examDiscard, examResume, examStart, examSave, examSaveOnExit, examSubmit, examHistory, examListPapers, fetchContentAvailability, fetchCurriculum, syllabusSubjectFromPickerSubject } from '../../lib/api';
import { changedExamResponses, serializeExamResponses } from '../../lib/exam-session';
import ExamSetup from '../../components/exam/ExamSetup';
import ExamInProgress from '../../components/exam/ExamInProgress';
import ExamResults from '../../components/exam/ExamResults';
import { showToast } from '../../lib/toast';
import { getSubject, getYear } from '../../lib/preferences';
import type { ContentAvailability, ExamActiveSession, ExamQuestion, ExamResult, ExamReviewMode, ExamHistoryItem, ExamStartResponse, ImportedPaper, Subject, YearLevel } from '../../lib/api-types';
import type { Curriculum } from '../../lib/curriculum_helpers';

type Phase = 'setup' | 'in_progress' | 'results';

type ExamSaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'retry_queued' | 'conflict';

type ExamSavePayload = {
  responses: Record<string, string>;
  current_index: number;
  flagged: string[];
  revision: number;
};

type ExamSaveSnapshot = {
  examId: string;
  subject: Subject;
  payload: ExamSavePayload;
};

const DEFAULT_PICKER_VALUE = { subject: 'math' as Subject, year: 'year7' as YearLevel };

// The exam in progress in this tab. A reload reopens it; submit or discard clears it.
const ACTIVE_EXAM_KEY = 'qld_exam_active_v1';
type ActiveExamRef = { examId: string; subject: Subject; year: YearLevel };

function rememberActiveExam(value: ActiveExamRef | null) {
  try {
    if (value) sessionStorage.setItem(ACTIVE_EXAM_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(ACTIVE_EXAM_KEY);
  } catch {
    // Storage can be blocked. The setup page still offers Resume.
  }
}

function readActiveExam(): ActiveExamRef | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(ACTIVE_EXAM_KEY) || 'null');
    return value && typeof value.examId === 'string' && value.examId ? value as ActiveExamRef : null;
  } catch {
    return null;
  }
}

const RESUMED_MESSAGE = 'Resumed your unfinished exam. The timer kept running from the first start.';

export default function ExamPage() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [examId, setExamId] = useState('');
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timeLimitMin, setTimeLimitMin] = useState(45);
  const [numQuestions, setNumQuestions] = useState(20);
  const [results, setResults] = useState<ExamResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<ExamSaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [timerRestartKey, setTimerRestartKey] = useState(0);
  const [history, setHistory] = useState<ExamHistoryItem[]>([]);
  const [importedPapers, setImportedPapers] = useState<ImportedPaper[]>([]);
  const [selectedPaper, setSelectedPaper] = useState<string>('');
  const [multiPartAnswers, setMultiPartAnswers] = useState<Record<string, Record<string, string>>>({});
  const [reviewMode, setReviewMode] = useState<ExamReviewMode>('collapsed');
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [contentAvailability, setContentAvailability] = useState<ContentAvailability | null>(null);
  const [pickerValue, setPickerValue] = useState(DEFAULT_PICKER_VALUE);
  const [activeExam, setActiveExam] = useState<ExamActiveSession | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const submittedRef = useRef(false);
  // Store absolute end time to avoid timer drift in background tabs
  const examEndTimeRef = useRef<number>(0);
  // Ref to hold handleSubmit callback (avoids "used before declaration" issue)
  const handleSubmitRef = useRef<() => Promise<void>>(async () => {});
  const pendingSaveRef = useRef<ExamSaveSnapshot | null>(null);
  const persistedResponsesRef = useRef<Record<string, string>>({});
  const saveRevisionRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const savePumpRef = useRef<() => void>(() => {});
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Custom configuration states
  const [sfRatio, setSfRatio] = useState(60);
  const [cfRatio, setCfRatio] = useState(30);
  const [cuRatio, setCuRatio] = useState(10);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [examType, setExamType] = useState<string>('mixed');

  const pumpPendingSave = useCallback(() => {
    if (saveInFlightRef.current) return;
    const snapshot = pendingSaveRef.current;
    if (!snapshot) return;

    saveInFlightRef.current = true;
    setSaveStatus('saving');
    setSaveError(null);
    examSave(snapshot.examId, snapshot.payload, snapshot.subject)
      .then(result => {
        retryAttemptRef.current = 0;
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        if (result.stale) {
          // Another window saved newer answers, so this snapshot was not stored.
          if (pendingSaveRef.current === snapshot) pendingSaveRef.current = null;
          setSaveStatus('conflict');
          setSaveError('Newer answers were saved from another window. Reload this page to continue with them.');
          return;
        }
        persistedResponsesRef.current = { ...snapshot.payload.responses };
        if (pendingSaveRef.current === snapshot) {
          pendingSaveRef.current = null;
          setSaveStatus('saved');
          setSaveError(null);
        } else {
          setSaveStatus('retry_queued');
        }
      })
      .catch((error: unknown) => {
        // Retain this snapshot. Offline/failed saves are retried when the
        // browser comes back online, via exponential backoff, or when the learner edits again.
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        setSaveStatus(offline ? 'offline' : 'retry_queued');
        setSaveError(error instanceof Error && error.message ? error.message : 'Autosave could not be completed yet.');
        if (!offline) {
          retryAttemptRef.current += 1;
          const delayMs = Math.min(10000, 1000 * Math.pow(2, retryAttemptRef.current - 1));
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            if (pendingSaveRef.current) {
              savePumpRef.current();
            }
          }, delayMs);
        }
      })
      .finally(() => {
        saveInFlightRef.current = false;
        if (pendingSaveRef.current && pendingSaveRef.current !== snapshot) {
          setSaveStatus('retry_queued');
          queueMicrotask(() => savePumpRef.current());
        }
      });
  }, []);
  useEffect(() => {
    savePumpRef.current = pumpPendingSave;
  }, [pumpPendingSave]);

  const handleRetryAutosave = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (pendingSaveRef.current) {
      setSaveStatus('retry_queued');
      setSaveError(null);
      savePumpRef.current();
    }
  }, []);

  useEffect(() => {
    if (phase !== 'in_progress') return;
    const handleOnline = () => {
      if (!pendingSaveRef.current) return;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      setSaveStatus('retry_queued');
      setSaveError(null);
      savePumpRef.current();
    };
    const handleOffline = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (pendingSaveRef.current || saveInFlightRef.current) {
        setSaveStatus('offline');
        setSaveError('You are offline. Your latest answer will retry when the connection returns.');
      }
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [phase]);

  useEffect(() => {
    setPickerValue({ subject: getSubject() as Subject, year: getYear() as YearLevel });
  }, []);

  // Load curriculum, history, and imported papers on mount
  useEffect(() => {
    const abort = new AbortController();
    fetchCurriculum(abort.signal, {
      subject: pickerValue.subject,
      scope: pickerValue.year,
    }).then(setCurriculum).catch(() => {});
    fetchContentAvailability(abort.signal).then(setContentAvailability).catch(() => {});
    const historyScope = {
      ...analyticsScopeFromYear(pickerValue.year),
      syllabusSubject: syllabusSubjectFromPickerSubject(pickerValue.subject),
    };
    examHistory(pickerValue.subject, abort.signal, historyScope).then(setHistory).catch(() => {});
    examActive(pickerValue.subject, abort.signal, historyScope)
      .then(result => setActiveExam(result?.active ?? null))
      .catch(() => setActiveExam(null));
    examListPapers(abort.signal).then(setImportedPapers).catch(() => {});
    return () => abort.abort();
  }, [pickerValue.subject, pickerValue.year]);

  // Warn before leaving during an active exam
  useEffect(() => {
    if (phase !== 'in_progress') return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'in_progress') return;
    const tick = () => {
      const remaining = Math.max(0, Math.round((examEndTimeRef.current - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0 && !submittedRef.current) {
        handleSubmitRef.current?.();
      }
    };
    tick(); // Immediate first tick
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [phase, timerRestartKey]);

  const resetSaveState = () => {
    setSubmitError(null);
    setSaveStatus('idle');
    setSaveError(null);
    pendingSaveRef.current = null;
    persistedResponsesRef.current = {};
    saveRevisionRef.current = 0;
  };

  // Show a new or resumed paper. Time always comes from the server deadline.
  const enterExam = (data: ExamStartResponse) => {
    setExamId(data.exam_id);
    saveRevisionRef.current = typeof data.save_revision === 'number' ? data.save_revision : 0;
    setQuestions(data.questions);
    // Prefer immutable server deadline; never grant extra time after expiry.
    let remainingSeconds = data.time_limit_minutes * 60;
    if (data.deadline_at) {
      remainingSeconds = Math.max(0, (new Date(data.deadline_at).getTime() - Date.now()) / 1000);
    } else if (data.resumed && data.started_at) {
      const elapsedSeconds = (Date.now() - new Date(data.started_at).getTime()) / 1000;
      remainingSeconds = Math.max(0, data.time_limit_minutes * 60 - elapsedSeconds);
    }
    setTimeLeft(Math.round(remainingSeconds));
    examEndTimeRef.current = data.deadline_at
      ? new Date(data.deadline_at).getTime()
      : Date.now() + remainingSeconds * 1000;
    setTimeLimitMin(data.time_limit_minutes);
    // Restore responses on resume and treat the server snapshot as persisted.
    persistedResponsesRef.current = { ...(data.responses || {}) };
    if (data.responses) {
      const resumed: Record<string, string> = {};
      const resumedMulti: Record<string, Record<string, string>> = {};
      for (const [qid, ans] of Object.entries(data.responses)) {
        try {
          const parsed = JSON.parse(ans as string);
          if (typeof parsed === 'object' && parsed !== null) {
            resumedMulti[qid] = parsed;
          } else {
            resumed[qid] = ans as string;
          }
        } catch {
          resumed[qid] = ans as string;
        }
      }
      setResponses(resumed);
      setMultiPartAnswers(resumedMulti);
    } else {
      setResponses({});
      setMultiPartAnswers({});
    }
    setCurrentIdx(typeof data.current_index === 'number' ? data.current_index : 0);
    setFlagged(new Set(Array.isArray(data.flagged) ? data.flagged : []));
    if (remainingSeconds <= 0) {
      // Expired session: enter progress only long enough for auto-submit of saved answers.
      setPhase('in_progress');
      setTimeout(() => handleSubmitRef.current?.(), 0);
    } else {
      setPhase('in_progress');
    }
    if (data.requested_questions && data.total_questions < data.requested_questions) {
      showToast(`Only ${data.total_questions} questions available (requested ${data.requested_questions}).`, 'info');
    }
  };

  const handleStart = async () => {
    setLoading(true);
    resetSaveState();
    try {
      const examScope = analyticsScopeFromYear(pickerValue.year);
      const data = await examStart({
        subject: pickerValue.subject,
        year_level: examScope.yearLevel,
        unit: examScope.unit,
        syllabus_subject: syllabusSubjectFromPickerSubject(pickerValue.subject),
        num_questions: numQuestions,
        time_limit_minutes: timeLimitMin,
        exam_file: selectedPaper || undefined,
        sf_ratio: selectedPaper ? undefined : sfRatio / 100.0,
        cf_ratio: selectedPaper ? undefined : cfRatio / 100.0,
        cu_ratio: selectedPaper ? undefined : cuRatio / 100.0,
        exam_type: selectedPaper ? undefined : examType,
      });
      if (data.error) {
        showToast(data.message || 'Failed to start exam', 'error');
        setLoading(false);
        return;
      }
      if (data.warning?.message) {
        showToast(data.warning.message, 'info');
      }
      if (data.resumed) {
        showToast(RESUMED_MESSAGE, 'info');
      }
      enterExam(data);
      rememberActiveExam({ examId: data.exam_id, subject: pickerValue.subject, year: pickerValue.year });
      setActiveExam(null);
    } catch {
      showToast('Failed to start exam', 'error');
    }
    setLoading(false);
  };

  const handleResume = async (target: ActiveExamRef) => {
    setLoading(true);
    resetSaveState();
    try {
      const data = await examResume(target.examId, target.subject);
      setPickerValue({ subject: target.subject, year: target.year });
      showToast(RESUMED_MESSAGE, 'info');
      enterExam(data);
      rememberActiveExam(target);
      setActiveExam(null);
    } catch (error: unknown) {
      // The exam is gone, submitted, or the network failed. The setup page
      // asks the server again and still offers Resume if the exam is there.
      rememberActiveExam(null);
      showToast(
        error instanceof Error && error.message ? `Could not reopen the exam: ${error.message}` : 'Could not reopen the exam.',
        'error',
      );
    }
    setLoading(false);
  };
  const resumeRef = useRef(handleResume);
  useEffect(() => {
    resumeRef.current = handleResume;
  });
  // A reload in this tab reopens the exam that was in progress.
  const autoResumeStartedRef = useRef(false);
  useEffect(() => {
    if (autoResumeStartedRef.current) return;
    autoResumeStartedRef.current = true;
    const stored = readActiveExam();
    if (stored) void resumeRef.current(stored);
  }, []);

  const handleDiscard = async (target: ExamActiveSession) => {
    setLoading(true);
    try {
      await examDiscard(target.exam_id, pickerValue.subject);
      if (readActiveExam()?.examId === target.exam_id) rememberActiveExam(null);
      setActiveExam(null);
      showToast('Unfinished exam discarded.', 'info');
    } catch (error: unknown) {
      showToast(
        error instanceof Error && error.message ? `Could not discard the exam: ${error.message}` : 'Could not discard the exam.',
        'error',
      );
    }
    setLoading(false);
  };

  const handleSubmit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setSubmitError(null);
    setLoading(true);
    const finalResponses = serializeExamResponses(responses, multiPartAnswers);
    const recoverFromFailure = (message: string) => {
      setSubmitError(message);
      showToast(message, 'error');
      // Phase remains in_progress, so explicitly re-run the timer effect. Its
      // immediate tick derives the display from the immutable server deadline.
      setTimerRestartKey(key => key + 1);
    };
    try {
      const data = await examSubmit(examId, finalResponses, pickerValue.subject);
      if (data.error) {
        recoverFromFailure(data.message || 'Failed to submit exam');
      } else {
        pendingSaveRef.current = null;
        rememberActiveExam(null);
        setActiveExam(null);
        setResults(data);
        setPhase('results');
        const historyScope = {
          ...analyticsScopeFromYear(pickerValue.year),
          syllabusSubject: syllabusSubjectFromPickerSubject(pickerValue.subject),
        };
        examHistory(pickerValue.subject, undefined, historyScope).then(setHistory).catch(() => {});
      }
    } catch (error: unknown) {
      recoverFromFailure(
        error instanceof Error && error.message
          ? `Failed to submit exam: ${error.message}`
          : 'Failed to submit exam. Your saved answers are still available; please retry.',
      );
    } finally {
      setLoading(false);
      submittedRef.current = false;
    }
  }, [examId, multiPartAnswers, pickerValue.subject, pickerValue.year, responses]);

  // Keep handleSubmitRef in sync so the timer effect can call it
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  // Debounced autosave of answers, multiparts, index and flags. Normal saves
  // are single-flight: while one request is in progress we retain only the
  // latest snapshot. Revisions also protect against page-hide or stale-browser
  // requests arriving out of order at the backend.
  useEffect(() => {
    if (phase !== 'in_progress' || !examId) return;
    const revision = saveRevisionRef.current + 1;
    saveRevisionRef.current = revision;
    const payload: ExamSavePayload = {
      responses: serializeExamResponses(responses, multiPartAnswers),
      current_index: currentIdx,
      flagged: Array.from(flagged),
      revision,
    };
    const snapshot: ExamSaveSnapshot = { examId, subject: pickerValue.subject, payload };
    pendingSaveRef.current = snapshot;
    setSaveStatus('saving');
    setSaveError(null);
    const timer = setTimeout(() => savePumpRef.current(), 700);
    return () => { clearTimeout(timer); };
  }, [phase, examId, responses, multiPartAnswers, currentIdx, flagged, pickerValue.subject]);

  // Flush any un-debounced edits when hidden/unmounted.  Use a synchronous
  // keepalive request with only the response delta; full long-answer papers can
  // exceed the browser's ~64 KiB keepalive budget.
  useEffect(() => {
    const flush = () => {
      const pending = pendingSaveRef.current;
      if (!pending) return;
      const exitPayload = {
        ...pending.payload,
        responses: changedExamResponses(
          pending.payload.responses,
          persistedResponsesRef.current,
        ),
      };
      if (examSaveOnExit(pending.examId, exitPayload, pending.subject)) {
        // Keep the snapshot in memory if the page remains alive: keepalive only
        // confirms that the browser queued the request, not that it persisted.
        return;
      }
      // visibilitychange normally gives a little more time than pagehide. For
      // an oversized answer, make a best-effort normal request rather than
      // enqueueing a keepalive body the browser will reject.
      examSave(pending.examId, exitPayload, pending.subject)
        .then(result => {
          if (!result.stale) {
            persistedResponsesRef.current = { ...pending.payload.responses };
          }
          if (pendingSaveRef.current === pending) {
            pendingSaveRef.current = null;
          }
        })
        .catch(() => {});
    };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  const answeredCount = Object.keys(responses).filter(k => responses[k]?.trim()).length
    + Object.values(multiPartAnswers).filter(parts => Object.values(parts).some(v => v?.trim())).length;

  if (phase === 'setup') {
    return (
      <ExamSetup
        loading={loading}
        history={history}
        importedPapers={importedPapers}
        selectedPaper={selectedPaper}
        setSelectedPaper={setSelectedPaper}
        curriculum={curriculum}
        contentAvailability={contentAvailability}
        pickerValue={pickerValue}
        setPickerValue={setPickerValue}
        numQuestions={numQuestions}
        setNumQuestions={setNumQuestions}
        timeLimitMin={timeLimitMin}
        setTimeLimitMin={setTimeLimitMin}
        sfRatio={sfRatio}
        setSfRatio={setSfRatio}
        cfRatio={cfRatio}
        setCfRatio={setCfRatio}
        cuRatio={cuRatio}
        setCuRatio={setCuRatio}
        handleStart={handleStart}
        examType={examType}
        setExamType={setExamType}
        activeExam={activeExam}
        onResumeActive={exam => handleResume({ examId: exam.exam_id, subject: pickerValue.subject, year: pickerValue.year })}
        onDiscardActive={handleDiscard}
      />
    );
  }

  if (phase === 'in_progress') {
    // While the submission is being marked (extended-response items are graded
    // against the rubric and can take a few seconds), show a clear assessing
    // state instead of leaving the student on an editable paper (Audit EX1).
    if (loading) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', padding: '24px' }}>
          <div className="glass-panel" style={{ padding: '32px 40px', borderRadius: '16px', maxWidth: '480px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }} role="img" aria-label="assessing">📝</div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 8px', color: 'var(--text-primary)' }}>
              Assessing your answers…
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              Marking your responses now. Extended-response questions are graded against the rubric, which can take a few moments — please don&apos;t close this tab.
            </p>
          </div>
        </div>
      );
    }
    return (
      <ExamInProgress
        subject={pickerValue.subject}
        questions={questions}
        responses={responses}
        setResponses={setResponses}
        currentIdx={currentIdx}
        setCurrentIdx={setCurrentIdx}
        timeLeft={timeLeft}
        answeredCount={answeredCount}
        multiPartAnswers={multiPartAnswers}
        setMultiPartAnswers={setMultiPartAnswers}
        handleSubmit={handleSubmit}
        loading={loading}
        submitError={submitError}
        saveStatus={saveStatus}
        saveError={saveError}
        onRetryAutosave={handleRetryAutosave}
        flagged={flagged}
        setFlagged={setFlagged}
      />
    );
  }

  if (phase === 'results' && results) {
    return (
      <ExamResults
        results={results}
        reviewMode={reviewMode}
        setReviewMode={setReviewMode}
        subject={pickerValue.subject}
        year={pickerValue.year}
        onRestart={() => {
          setPhase('setup');
          setResults(null);
        }}
      />
    );
  }

  return null;
}
