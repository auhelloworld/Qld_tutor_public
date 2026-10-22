'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import WritingPromptSelector from './WritingPromptSelector';
import WritingTopicSelector from './WritingTopicSelector';
import WritingEditor from './WritingEditor';
import WritingResults from './WritingResults';
import WritingHistory from './WritingHistory';
import WritingPortfolio from './WritingPortfolio';
import WritingByoPanel from './WritingByoPanel';
import { fetchGrammarRemediation, fetchWritingAssess, fetchWritingCompare, fetchWritingTopics, fetchWritingExportPrompt, fetchWritingImportResult } from '../../lib/api';
import { showToast } from '../../lib/toast';
import { buildPracticeHref } from '../../lib/scoped_navigation';
import BackToPracticeLink from '../BackToPracticeLink';
import type { GrammarRemediationResponse, WritingAssessmentResponse, WritingHistoryEntry, WritingRevisionCompareResponse, WritingTopicContextPayload } from '../../lib/api-types';
import type { WritingTopic } from '../../lib/writing-topics';
import { getWritingTimeLimit, type WritingTimeMode } from '../../lib/writing_timer';
import {
  clearWritingDocument,
  clearLegacyWritingState,
  createWritingDocument,
  readWritingDocument,
  updateWritingDocument,
  writeWritingDocument,
  type PendingWritingAssessment,
} from '../../lib/writing-document-state';
import {
  clearWritingTimer,
  pauseWritingTimer,
  readPausedWritingSeconds,
  readWritingTimerEndsAt,
  resumeWritingTimer,
  setWritingTimerDeadline,
} from '../../lib/writing-timer-state';

type Phase = 'select' | 'topic_select' | 'edit' | 'results' | 'portfolio';
type AssessmentStage = 'idle' | 'preparing' | 'assessing' | 'saving';
type PromptType = 'persuasive' | 'narrative' | 'analytical' | 'expository';
type TimeMode = WritingTimeMode;

const MAX_ITERATIONS = 3;
const REMINDER_DAYS = 7;

function newAssessmentRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `writing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readPendingAssessment(): PendingWritingAssessment | null {
  try {
    return readWritingDocument(localStorage)?.pendingAssessment ?? null;
  } catch {
    return null;
  }
}

function storePendingAssessment(value: PendingWritingAssessment | null): boolean {
  try {
    updateWritingDocument(localStorage, { pendingAssessment: value });
    return true;
  } catch {
    return false;
  }
}

const BYO_PENDING_ASSESSMENT_KEY = 'qld_tutor_writing_byo_pending_v1';

function readPendingByoAssessment(): PendingWritingAssessment | null {
  try {
    const raw = localStorage.getItem(BYO_PENDING_ASSESSMENT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingWritingAssessment>;
    return typeof value.requestId === 'string' && typeof value.submissionSignature === 'string'
      ? { requestId: value.requestId, submissionSignature: value.submissionSignature }
      : null;
  } catch {
    return null;
  }
}

function storePendingByoAssessment(value: PendingWritingAssessment | null): void {
  try {
    if (value) localStorage.setItem(BYO_PENDING_ASSESSMENT_KEY, JSON.stringify(value));
    else localStorage.removeItem(BYO_PENDING_ASSESSMENT_KEY);
  } catch {
    // BYO replay persistence is best effort; the in-memory request remains usable.
  }
}

function getLastPracticeDays(): number | null {
  try {
    const stored = localStorage.getItem('qld_tutor_last_writing_practice');
    if (!stored) return null;
    const last = new Date(stored).getTime();
    const now = Date.now();
    return Math.floor((now - last) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

function savePracticeTimestamp() {
  try {
    localStorage.setItem('qld_tutor_last_writing_practice', new Date().toISOString());
  } catch { /* ignore */ }
}

function clearStoredWritingDraft() {
  try {
    clearWritingDocument(localStorage);
  } catch { /* ignore */ }
}

function buildTopicContext(topic: WritingTopic | null): WritingTopicContextPayload | undefined {
  if (!topic) return undefined;
  const context: WritingTopicContextPayload = {
    topic_title: topic.title,
    context: topic.context,
    target_audience: topic.targetAudience,
    mode: topic.mode,
    prescribed_text: topic.prescribedText,
    task_conditions: topic.taskConditions,
    official_source: topic.officialSource,
    writing_tips: topic.writingTips,
    stimulus_text: topic.stimulusText,
    word_limit: topic.wordLimit,
  };
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined && value !== null),
  ) as WritingTopicContextPayload;
}

export default function WritingAssessment() {
  const [phase, setPhase] = useState<Phase>('select');
  const [promptType, setPromptType] = useState<PromptType | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<WritingTopic | null>(null);
  const [availableTopics, setAvailableTopics] = useState<WritingTopic[]>([]);
  const [yearLevel, setYearLevel] = useState(7);
  const [draftText, setDraftText] = useState('');
  const [customTopicPrompt, setCustomTopicPrompt] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [writerStatement, setWriterStatement] = useState('');
  const [taskSheetText, setTaskSheetText] = useState('');
  const [schoolIsmgText, setSchoolIsmgText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assessmentStage, setAssessmentStage] = useState<AssessmentStage>('idle');
  const [results, setResults] = useState<WritingAssessmentResponse[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [topicsReloadKey, setTopicsReloadKey] = useState(0);
  const [revisionAnchorTimestamp, setRevisionAnchorTimestamp] = useState<string | null>(null);
  const [revisionCompare, setRevisionCompare] = useState<WritingRevisionCompareResponse | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [grammarRemediation, setGrammarRemediation] = useState<GrammarRemediationResponse | null>(null);
  const [grammarRemediationLoading, setGrammarRemediationLoading] = useState(false);
  const [showByoPanel, setShowByoPanel] = useState(false);

  // Timer state
  const [timeMode, setTimeMode] = useState<TimeMode>('unlimited');
  const [customMinutes, setCustomMinutes] = useState(60);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSubmittingRef = useRef(isSubmitting);
  const lastSubmittedDraftRef = useRef<string>('');
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durablePortfolioSavedRef = useRef(false);
  const pendingAssessmentRef = useRef<PendingWritingAssessment | null>(null);
  const pendingByoAssessmentRef = useRef<PendingWritingAssessment | null>(null);
  const latestRef = useRef({
    promptType,
    selectedTopic,
    yearLevel,
    draftText,
    customTopicPrompt,
    sourceText,
    writerStatement,
    taskSheetText,
    schoolIsmgText,
    timeMode,
    customMinutes,
    timeRemaining,
    isSenior: false,
    revisionAnchorTimestamp: null as string | null,
  });

  const isSenior = yearLevel >= 11;
  const practiceHrefForWriting = (topic?: string) => {
    const seniorUnitMatch = topic?.match(/^QCAA_ENGLISH_U([1-4])_/i);
    const year = isSenior ? `unit${seniorUnitMatch?.[1] || (yearLevel >= 12 ? '3' : '1')}` : `year${yearLevel}`;
    return buildPracticeHref({
      subject: isSenior ? 'senior_english' : 'english',
      year,
      topic,
    });
  };
  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  useEffect(() => {
    latestRef.current = {
      promptType,
      selectedTopic,
      yearLevel,
      draftText,
      customTopicPrompt,
      sourceText,
      writerStatement,
      taskSheetText,
      schoolIsmgText,
      timeMode,
      customMinutes,
      timeRemaining,
      isSenior,
      revisionAnchorTimestamp,
    };
  }, [
    customMinutes,
    customTopicPrompt,
    draftText,
    isSenior,
    promptType,
    revisionAnchorTimestamp,
    schoolIsmgText,
    selectedTopic,
    sourceText,
    taskSheetText,
    timeMode,
    timeRemaining,
    writerStatement,
    yearLevel,
  ]);

  // Load topics when yearLevel changes
  useEffect(() => {
    let active = true;
    setTopicsLoading(true);
    setTopicsError(null);
    fetchWritingTopics(yearLevel).then(topics => {
      if (active) {
        setAvailableTopics(topics);
        setTopicsLoading(false);
      }
    }).catch(err => {
      console.error('Failed to fetch topics:', err);
      if (active) {
        setTopicsError('Failed to load writing topics.');
        setTopicsLoading(false);
        showToast('Failed to load writing topics. You can still use your own topic.', 'error');
      }
    });
    return () => { active = false; };
  }, [yearLevel, topicsReloadKey]);

  // Restore only the versioned document. Legacy split keys are intentionally discarded, not migrated.
  useEffect(() => {
    try {
      clearLegacyWritingState(localStorage);
      const saved = readWritingDocument(localStorage);
      if (!saved) return;

      setYearLevel(saved.yearLevel);
      setPromptType(saved.promptType);
      setSelectedTopic(saved.selectedTopic);
      setDraftText(saved.draftText);
      setCustomTopicPrompt(saved.customTopicPrompt);
      setSourceText(saved.sourceText);
      setWriterStatement(saved.writerStatement);
      setTaskSheetText(saved.taskSheetText);
      setSchoolIsmgText(saved.schoolIsmgText);
      setTimeMode(saved.timeMode);
      setCustomMinutes(saved.customMinutes);
      setRevisionAnchorTimestamp(saved.revisionAnchorTimestamp);
      pendingAssessmentRef.current = saved.pendingAssessment;

      const pausedRemaining = saved.timerPausedRemaining || 0;
      const activeRemaining = saved.timerEndsAt
        ? Math.max(0, Math.ceil((saved.timerEndsAt - Date.now()) / 1000))
        : 0;
      setTimeRemaining(pausedRemaining || activeRemaining);
      setIsTimerRunning(activeRemaining > 0 && pausedRemaining === 0);

      if (saved.draftText.trim()) {
        setPhase('edit');
      } else if (saved.phase !== 'results') {
        setPhase(saved.phase);
      }
    } catch (e) {
      console.error('Failed to restore saved writing document:', e);
    }
  }, []);

  // Save one complete JSON document in one localStorage write (debounced + pagehide flush).
  const flushDraftToStorage = useCallback((): boolean => {
    if (durablePortfolioSavedRef.current) return false;
    const latestResult = results[results.length - 1];
    // A durable result intentionally clears this draft; never recreate it on pagehide.
    if (phase === 'results' && latestResult?.portfolio_saved === true) return false;

    const p = latestRef.current;
    try {
      const stored = readWritingDocument(localStorage);
      writeWritingDocument(localStorage, createWritingDocument({
        phase: phase === 'results' ? 'edit' : phase,
        promptType: p.promptType,
        selectedTopic: p.selectedTopic,
        yearLevel: p.yearLevel,
        draftText: p.draftText,
        customTopicPrompt: p.customTopicPrompt,
        sourceText: p.sourceText,
        writerStatement: p.writerStatement,
        taskSheetText: p.taskSheetText,
        schoolIsmgText: p.schoolIsmgText,
        timeMode: p.timeMode,
        customMinutes: p.customMinutes,
        timerEndsAt: stored?.timerEndsAt ?? null,
        timerPausedRemaining: stored?.timerPausedRemaining ?? null,
        pendingAssessment: pendingAssessmentRef.current,
        revisionAnchorTimestamp: p.revisionAnchorTimestamp,
      }));
      return true;
    } catch {
      return false;
    }
  }, [phase, results]);

  useEffect(() => {
    // When entering results phase, only clear draft if portfolio was saved
    if (phase === 'results') {
      return;
    }

    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => flushDraftToStorage(), 400);

    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [phase, promptType, yearLevel, draftText, customTopicPrompt, sourceText, writerStatement, taskSheetText, schoolIsmgText, selectedTopic, timeMode, customMinutes, revisionAnchorTimestamp, flushDraftToStorage]);

  // pagehide: synchronously flush latest state
  useEffect(() => {
    const handlePageHide = () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
      flushDraftToStorage();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [flushDraftToStorage]);

  // When results arrive, conditionally clear draft based on portfolio_saved
  useEffect(() => {
    if (phase !== 'results') return;
    const latest = results[results.length - 1];
    if (!latest) return;
    if (latest.portfolio_saved === true) {
      durablePortfolioSavedRef.current = true;
      clearStoredWritingDraft();
    }
    // If portfolio_saved is false or undefined, keep the draft for recovery
  }, [phase, results]);

  const getTimeLimit = useCallback(() => {
    return getWritingTimeLimit(timeMode, customMinutes);
  }, [timeMode, customMinutes]);

  const startTimer = useCallback(() => {
    const limit = getTimeLimit();
    if (limit <= 0) return;

    try {
      const resumed = resumeWritingTimer(localStorage, limit * 60);
      setTimeRemaining(resumed.remaining);
      setIsTimerRunning(resumed.remaining > 0);
    } catch {
      setTimeRemaining(limit * 60);
      setIsTimerRunning(true);
    }
  }, [getTimeLimit]);

  const pauseTimer = useCallback(() => {
    try {
      setTimeRemaining(pauseWritingTimer(localStorage, latestRef.current.timeRemaining));
    } catch {}
    setIsTimerRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const stopTimer = useCallback(() => {
    setIsTimerRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleSelectPrompt = (type: PromptType) => {
    setPromptType(type);
    setPhase('topic_select');
  };

  const handleSelectTopic = (topic: WritingTopic | null) => {
    durablePortfolioSavedRef.current = false;
    pendingAssessmentRef.current = null;
    storePendingAssessment(null);
    storePendingByoAssessment(null);
    setSelectedTopic(topic);
    setDraftText('');
    setCustomTopicPrompt('');
    setSourceText(topic?.stimulusText || '');
    setWriterStatement('');
    setTaskSheetText('');
    setSchoolIsmgText('');
    setResults([]);
    setRevisionAnchorTimestamp(null);
    setRevisionCompare(null);
    setGrammarRemediation(null);
    setGrammarRemediationLoading(false);
    setPhase('edit');
    setTimeRemaining(0);
    setIsTimerRunning(false);
    try {
      clearWritingTimer(localStorage);
    } catch {}
  };

  useEffect(() => {
    if (phase === 'edit') {
      // If a paused remaining key exists, stay paused (user explicitly paused before)
      let pausedRemaining = 0;
      try {
        pausedRemaining = readPausedWritingSeconds(localStorage);
      } catch {}
      if (pausedRemaining > 0) {
        setTimeRemaining(pausedRemaining);
        setIsTimerRunning(false);
        return;
      }
      const id = setTimeout(() => startTimer(), 100);
      return () => clearTimeout(id);
    } else {
      stopTimer();
    }
  }, [phase, startTimer, stopTimer]);

  const handleSubmit = useCallback(async () => {
    const current = latestRef.current;
    if (!current.promptType || isSubmittingRef.current) return;
    setAssessmentStage('preparing');
    // Persist the latest keystrokes immediately and freeze the timer while the request is pending.
    flushDraftToStorage();
    pauseTimer();
    const timeLimit = getWritingTimeLimit(current.timeMode, current.customMinutes);
    const timeTaken = timeLimit > 0 ? timeLimit * 60 - current.timeRemaining : 0;
    const revisionOf = current.revisionAnchorTimestamp || undefined;
    const topicContext = buildTopicContext(current.selectedTopic);
    const submissionSignature = JSON.stringify({
      subject: 'english',
      yearLevel: current.yearLevel,
      promptType: current.promptType,
      draftText: current.draftText,
      sourceText: current.sourceText,
      writerStatement: current.writerStatement,
      taskSheetText: current.isSenior ? current.taskSheetText : '',
      schoolIsmgText: current.isSenior ? current.schoolIsmgText : '',
      topicId: current.selectedTopic?.id || '',
      topicPrompt: current.selectedTopic?.prompt || current.customTopicPrompt || '',
      topicContext,
      timeLimitMinutes: timeLimit || 0,
      revisionOf: revisionOf || '',
    });
    let pending = pendingAssessmentRef.current || readPendingAssessment();
    if (!pending || pending.submissionSignature !== submissionSignature) {
      pending = { requestId: newAssessmentRequestId(), submissionSignature };
    }
    pendingAssessmentRef.current = pending;
    storePendingAssessment(pending);

    setIsSubmitting(true);
    isSubmittingRef.current = true;
    setGrammarRemediation(null);
    setGrammarRemediationLoading(false);
    setShowByoPanel(false);
    savePracticeTimestamp();
    setAssessmentStage('assessing');
    try {
      const res = await fetchWritingAssess(
        'english', current.yearLevel, current.promptType, current.draftText,
        {
          sourceText: current.sourceText || undefined,
          writerStatement: current.writerStatement || undefined,
          taskSheetText: current.isSenior ? current.taskSheetText || undefined : undefined,
          schoolIsmgText: current.isSenior ? current.schoolIsmgText || undefined : undefined,
          topicId: current.selectedTopic?.id || undefined,
          topicPrompt: current.selectedTopic?.prompt || current.customTopicPrompt || undefined,
          topicContext,
          timeLimitMinutes: timeLimit || undefined,
          timeTakenSeconds: Math.max(1, timeTaken),
          revisionOf,
          assessmentRequestId: pending.requestId,
        },
      );
      setAssessmentStage('saving');
      pendingAssessmentRef.current = null;
      storePendingAssessment(null);
      durablePortfolioSavedRef.current = res.portfolio_saved === true;
      if (durablePortfolioSavedRef.current) {
        if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
        clearStoredWritingDraft();
      }
      setResults(prev => [...prev, res]);
      if (!revisionOf && res.timestamp && !res.insufficient_evidence) {
        setRevisionAnchorTimestamp(res.timestamp);
      }
      lastSubmittedDraftRef.current = current.draftText;
      try {
        clearWritingTimer(localStorage);
      } catch {}
      setPhase('results');
      if (res.insufficient_evidence) {
        showToast('Not scored: the draft is shorter than this task needs. See the short-draft feedback.', 'info');
      } else if (res.portfolio_saved === false) {
        showToast('Assessment complete, but the portfolio copy was not saved. Your draft is still stored locally.', 'error');
      } else {
        showToast(res.llm_status === 'mock' ? 'Local draft pre-check complete.' : 'Assessment complete!', 'success');
      }
    } catch (err: any) {
      // Submit failure keeps paused remaining so the student can resume without losing time.
      setShowByoPanel(true);
      showToast(
        err?.message || 'Unable to assess writing right now. Your draft is still saved in the editor — wait a moment, then try again.',
        'error'
      );
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
      setAssessmentStage('idle');
    }
  }, [flushDraftToStorage, pauseTimer]);

  // Timer tick from absolute end timestamp (survives remount/tab backgrounding).
  useEffect(() => {
    if (!isTimerRunning) return;
    const tick = () => {
      let endsAt = 0;
      try {
        endsAt = readWritingTimerEndsAt(localStorage);
      } catch {
        endsAt = 0;
      }
      if (!endsAt) {
        setIsTimerRunning(false);
        setTimeRemaining(0);
        return;
      }
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        setIsTimerRunning(false);
        try {
          clearWritingTimer(localStorage);
        } catch {}
        const latest = latestRef.current;
        if (latest.draftText.trim() && latest.promptType) {
          handleSubmit();
        }
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimerRunning, handleSubmit]);

  const handleTimeModeChange = useCallback((mode: TimeMode) => {
    setTimeMode(mode);
    const limit = getWritingTimeLimit(mode, customMinutes);
    if (limit > 0) {
      const endsAt = Date.now() + limit * 60 * 1000;
      try {
        setWritingTimerDeadline(localStorage, endsAt);
      } catch {}
      setTimeRemaining(limit * 60);
      setIsTimerRunning(phase === 'edit');
    } else {
      try {
        clearWritingTimer(localStorage);
      } catch {}
      setTimeRemaining(0);
      setIsTimerRunning(false);
    }
  }, [customMinutes, phase]);

  const handleCustomMinutesChange = useCallback((minutes: number) => {
    setCustomMinutes(minutes);
    if (timeMode === 'custom') {
      const endsAt = Date.now() + minutes * 60 * 1000;
      try {
        setWritingTimerDeadline(localStorage, endsAt);
      } catch {}
      setTimeRemaining(minutes * 60);
      setIsTimerRunning(phase === 'edit');
    }
  }, [phase, timeMode]);

  const handleEdit = () => {
    durablePortfolioSavedRef.current = false;
    const latest = results[results.length - 1];
    const latestScored = [...results].reverse().find(item => !item.insufficient_evidence);
    setRevisionAnchorTimestamp(prev => prev || latestScored?.revision_of || latestScored?.timestamp || latest?.revision_of || null);
    try {
      clearWritingTimer(localStorage);
    } catch {}
    setTimeRemaining(0);
    setIsTimerRunning(false);
    setPhase('edit');
    setShowByoPanel(false);
  };

  const handleTryAgain = () => {
    durablePortfolioSavedRef.current = false;
    const latest = results[results.length - 1];
    const latestScored = [...results].reverse().find(item => !item.insufficient_evidence);
    setRevisionAnchorTimestamp(prev => prev || latestScored?.revision_of || latestScored?.timestamp || latest?.revision_of || null);
    try {
      clearWritingTimer(localStorage);
    } catch {}
    setTimeRemaining(0);
    setIsTimerRunning(false);
    setPhase('edit');
    setShowByoPanel(false);
  };

  const handlePracticeTopics = (topicIds: string[]) => {
    window.open(practiceHrefForWriting(topicIds[0]), '_self');
  };

  // Bring-your-own-LLM (Audit F-BYO): export the prompt for an external LLM and
  // import the pasted reply through the same pipeline as a live assessment.
  const handleExportPrompt = useCallback(async () => {
    const c = latestRef.current;
    if (!c.promptType) throw new Error('no_prompt_type');
    return fetchWritingExportPrompt('english', c.yearLevel, c.promptType, c.draftText, {
      sourceText: c.sourceText || undefined,
      writerStatement: c.writerStatement || undefined,
      taskSheetText: c.isSenior ? c.taskSheetText || undefined : undefined,
      schoolIsmgText: c.isSenior ? c.schoolIsmgText || undefined : undefined,
      topicId: c.selectedTopic?.id || undefined,
      topicPrompt: c.selectedTopic?.prompt || c.customTopicPrompt || undefined,
      topicContext: buildTopicContext(c.selectedTopic),
      revisionOf: c.revisionAnchorTimestamp || undefined,
    });
  }, []);

  const handleImportResult = useCallback(async (externalText: string) => {
    const c = latestRef.current;
    if (!c.promptType) throw new Error('no_prompt_type');
    flushDraftToStorage();
    const submissionSignature = JSON.stringify({
      kind: 'byo-import',
      subject: 'english',
      yearLevel: c.yearLevel,
      promptType: c.promptType,
      draftText: c.draftText,
      externalText,
      sourceText: c.sourceText,
      writerStatement: c.writerStatement,
      taskSheetText: c.isSenior ? c.taskSheetText : '',
      schoolIsmgText: c.isSenior ? c.schoolIsmgText : '',
      topicId: c.selectedTopic?.id || '',
      topicPrompt: c.selectedTopic?.prompt || c.customTopicPrompt || '',
      topicContext: buildTopicContext(c.selectedTopic),
      revisionOf: c.revisionAnchorTimestamp || '',
    });
    const storedPending = pendingByoAssessmentRef.current || readPendingByoAssessment();
    const pending = storedPending?.submissionSignature === submissionSignature
      ? storedPending
      : { requestId: newAssessmentRequestId(), submissionSignature };
    pendingByoAssessmentRef.current = pending;
    storePendingByoAssessment(pending);
    try {
      const res = await fetchWritingImportResult('english', c.yearLevel, c.promptType, c.draftText, externalText, {
        sourceText: c.sourceText || undefined,
        writerStatement: c.writerStatement || undefined,
        taskSheetText: c.isSenior ? c.taskSheetText || undefined : undefined,
        schoolIsmgText: c.isSenior ? c.schoolIsmgText || undefined : undefined,
        topicId: c.selectedTopic?.id || undefined,
        topicPrompt: c.selectedTopic?.prompt || c.customTopicPrompt || undefined,
        topicContext: buildTopicContext(c.selectedTopic),
        revisionOf: c.revisionAnchorTimestamp || undefined,
        assessmentRequestId: pending.requestId,
      });
      pendingByoAssessmentRef.current = null;
      storePendingByoAssessment(null);
      durablePortfolioSavedRef.current = res.portfolio_saved === true;
      if (durablePortfolioSavedRef.current) {
        if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
        clearStoredWritingDraft();
      }
      setResults(prev => [...prev, res]);
      if (!c.revisionAnchorTimestamp && res.timestamp && !res.insufficient_evidence) {
        setRevisionAnchorTimestamp(res.timestamp);
      }
      lastSubmittedDraftRef.current = c.draftText;
      setPhase('results');
      if (res.portfolio_saved === false) {
        showToast('Assessment imported, but the portfolio copy was not saved. Your draft is still stored locally.', 'error');
      }
    } catch (error) {
      // Keep the same request ID so clicking import again replays the original
      // mutation instead of creating a duplicate portfolio assessment.
      pendingByoAssessmentRef.current = pending;
      storePendingByoAssessment(pending);
      throw error;
    }
  }, [flushDraftToStorage]);

  const handleBackToPractice = () => {
    try {
      clearWritingTimer(localStorage);
    } catch {}
    setPromptType(null);
    setSelectedTopic(null);
    setPhase('select');
  };

  const buildPortfolioTopic = (entry: WritingHistoryEntry): WritingTopic | null => {
    if (!entry.topic_prompt) return null;
    return {
      id: entry.topic_id || `portfolio-${entry.timestamp}`,
      type: entry.prompt_type as PromptType,
      yearLevels: [entry.year_level],
      category: 'Portfolio',
      title: entry.topic_title || 'Previous writing task',
      description: entry.topic_description || 'A previous writing task from your portfolio.',
      prompt: entry.topic_prompt,
      stimulusText: entry.topic_source_text || undefined,
      wordLimit: entry.topic_word_limit || undefined,
      guidingQuestions: entry.topic_guiding_questions || undefined,
      thinkAbout: entry.topic_think_about || undefined,
      writingTips: entry.topic_writing_tips || undefined,
      targetAudience: entry.topic_target_audience || undefined,
      context: entry.topic_context || undefined,
      prescribedText: entry.topic_prescribed_text || undefined,
      mode: entry.topic_mode || undefined,
      taskConditions: entry.topic_task_conditions || undefined,
      officialSource: entry.topic_official_source || undefined,
      rubricProfile: entry.topic_rubric_profile || undefined,
    };
  };

  const handlePortfolioSelectTopic = async (entry: WritingHistoryEntry) => {
    durablePortfolioSavedRef.current = false;
    setYearLevel(entry.year_level);
    setPromptType(entry.prompt_type);
    setSelectedTopic(null);
    setDraftText('');
    setCustomTopicPrompt('');
    setSourceText('');
    setWriterStatement('');
    setTaskSheetText('');
    setSchoolIsmgText('');
    setResults([]);
    setRevisionAnchorTimestamp(null);
    setRevisionCompare(null);
    setGrammarRemediation(null);
    setGrammarRemediationLoading(false);
    try {
      clearWritingTimer(localStorage);
    } catch {}
    setTimeRemaining(0);
    setIsTimerRunning(false);

    const restoredTopic = buildPortfolioTopic(entry);
    if (restoredTopic) {
      setSelectedTopic(restoredTopic);
      setSourceText(restoredTopic.stimulusText || '');
      setPhase('edit');
      return;
    }

    try {
      const topics = await fetchWritingTopics(entry.year_level);
      setAvailableTopics(topics);
      const matchingTopic = entry.topic_id ? topics.find(topic => topic.id === entry.topic_id) : null;
      if (matchingTopic) {
        setSelectedTopic(matchingTopic);
        setSourceText(matchingTopic.stimulusText || '');
        setPhase('edit');
        return;
      }
    } catch (err) {
      console.error('Failed to restore portfolio topic:', err);
    }

    showToast('Original task unavailable. Choose a new topic to continue.', 'info');
    setPhase('topic_select');
  };

  const [daysSinceLastPractice, setDaysSinceLastPractice] = useState<number | null>(null);
  useEffect(() => {
    setDaysSinceLastPractice(getLastPracticeDays());
  }, []);
  const latestResult = results.length > 0 ? results[results.length - 1] : null;
  const scoredResults = results.filter(result => !result.insufficient_evidence);

  const handleLoadGrammarRemediation = useCallback(async () => {
    if (!latestResult || !promptType || grammarRemediationLoading || grammarRemediation) return;
    setGrammarRemediationLoading(true);
    try {
      const remediation = await fetchGrammarRemediation({
        criterionScores: latestResult.criterion_scores || [],
        draftText,
        yearLevel,
        promptType,
      });
      setGrammarRemediation(remediation);
    } catch (err) {
      console.error('Failed to load grammar remediation:', err);
      setGrammarRemediation(null);
    } finally {
      setGrammarRemediationLoading(false);
    }
  }, [latestResult, promptType, grammarRemediationLoading, grammarRemediation, draftText, yearLevel]);

  // Debounced revision compare — explicit wait so every keystroke does not hit the API.
  // Skip compare if draft equals the just-submitted text (avoids redundant compare on success).
  useEffect(() => {
    const originalTs =
      revisionAnchorTimestamp
      || (latestResult?.revision_of as string | null | undefined)
      || null;
    if (!originalTs || !draftText.trim()) {
      setRevisionCompare(null);
      setCompareLoading(false);
      return;
    }

    // Do not compare if draft is exactly what was just submitted
    if (draftText === lastSubmittedDraftRef.current) {
      setCompareLoading(false);
      return; // keep the existing final revision comparison, if one was already calculated
    }

    const controller = new AbortController();
    setCompareLoading(true);
    const timer = setTimeout(() => {
      fetchWritingCompare(originalTs, draftText, controller.signal)
        .then(setRevisionCompare)
        .catch(err => {
          if (err?.name !== 'AbortError') {
            console.error('Failed to compare writing revision:', err);
            setRevisionCompare(null);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setCompareLoading(false);
        });
    }, 700);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [latestResult, draftText, revisionAnchorTimestamp]);

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto', padding: '24px', minHeight: '100vh' }}>
      {/* Header */}
      <div className="glass-panel" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px', marginBottom: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
            <button
              onClick={() => {
                setPhase('select');
                setPromptType(null);
                setSelectedTopic(null);
                try { clearWritingTimer(localStorage); } catch {}
              }}
              style={{
                padding: '6px 12px', fontSize: '13px', border: 'none', cursor: 'pointer',
                background: phase !== 'portfolio' && phase !== 'edit' ? 'var(--accent-color)' : 'var(--bg-secondary)',
                color: phase !== 'portfolio' && phase !== 'edit' ? '#fff' : 'var(--text-primary)',
                fontWeight: 600,
              }}
            >
              Practice
            </button>
            <button
              onClick={() => setPhase('portfolio')}
              style={{
                padding: '6px 12px', fontSize: '13px', border: 'none', cursor: 'pointer',
                background: phase === 'portfolio' ? 'var(--accent-color)' : 'var(--bg-secondary)',
                color: phase === 'portfolio' ? '#fff' : 'var(--text-primary)',
                fontWeight: 600,
              }}
            >
              Portfolio
            </button>
          </div>
          {promptType && phase !== 'portfolio' && (
            <span style={{
              fontSize: '12px', padding: '2px 10px', borderRadius: '12px',
              background: 'rgba(8,145,178,0.12)', color: '#0891b2',
              fontWeight: '600',
            }}>
              {isSenior
                ? ({ analytical: 'Analytical (EA-style)', narrative: 'Imaginative (IA3-style)', persuasive: 'Public Audience Written Response', expository: 'Informative / Expository' } as Record<string, string>)[promptType]
                : promptType.charAt(0).toUpperCase() + promptType.slice(1)}
            </span>
          )}
          {(phase === 'select' || phase === 'topic_select') && (
            <select
              value={yearLevel}
              onChange={e => {
                const y = Number(e.target.value);
                setYearLevel(y);
              }}
              aria-label="Year level"
              style={{
                padding: '6px 10px', fontSize: '13px', borderRadius: '6px',
                border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
              }}
            >
              {[7,8,9,10,11,12].map(y => (
                <option key={y} value={y}>Year {y}</option>
              ))}
            </select>
          )}
          {phase === 'edit' && timeMode !== 'unlimited' && (
            <span style={{
              fontSize: '14px', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              padding: '4px 12px', borderRadius: '6px',
              background: timeRemaining <= 60 ? 'rgba(239,68,68,0.15)' : timeRemaining <= 300 ? 'rgba(234,179,8,0.15)' : 'rgba(99,102,241,0.1)',
              color: timeRemaining <= 60 ? '#ef4444' : timeRemaining <= 300 ? '#eab308' : 'var(--text-primary)',
              border: `1px solid ${timeRemaining <= 60 ? '#ef4444' : timeRemaining <= 300 ? '#eab308' : 'transparent'}`,
              transition: 'all 0.3s',
            }}>
              {isTimerRunning ? `⏱ ${formatTime(timeRemaining)}` : '⏱ Paused'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => {
              if (window.confirm('Leave writing?')) {
                handleBackToPractice();
              }
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', borderRadius: '8px',
              background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              fontWeight: '600', fontSize: '13px',
              transition: 'all 0.2s', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-color)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          >
            ← Exit
          </button>
          <BackToPracticeLink href={practiceHrefForWriting()} />
        </div>
      </div>

      {/* Content */}
      {phase === 'select' && (
        <>
          {daysSinceLastPractice !== null && daysSinceLastPractice >= REMINDER_DAYS && (
            <div style={{
              maxWidth: 800, margin: '16px auto 0', padding: '12px 16px',
              background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)',
              borderRadius: '8px', color: 'var(--text-primary)', fontSize: '14px',
              display: 'flex', gap: '8px', alignItems: 'center',
            }}>
              <span style={{ fontSize: '18px' }}>⏰</span>
              <span>It&apos;s been <strong>{daysSinceLastPractice} days</strong> since last practice.</span>
            </div>
          )}
          <WritingPromptSelector onSelect={handleSelectPrompt} yearLevel={yearLevel} />
        </>
      )}

      {phase === 'topic_select' && promptType && (
        <WritingTopicSelector
          promptType={promptType}
          yearLevel={yearLevel}
          topics={availableTopics}
          loading={topicsLoading}
          error={topicsError}
          onRetry={() => setTopicsReloadKey(key => key + 1)}
          onSelect={handleSelectTopic}
          onBack={() => setPhase('select')}
        />
      )}

      {phase === 'edit' && promptType && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <WritingEditor
            promptType={promptType}
            selectedTopic={selectedTopic}
            topicWordLimit={selectedTopic?.wordLimit}
            isSenior={isSenior}
            yearLevel={yearLevel}
            draftText={draftText}
            onChange={setDraftText}
            customTopicPrompt={customTopicPrompt}
            onCustomTopicPromptChange={setCustomTopicPrompt}
            sourceText={sourceText}
            onSourceTextChange={setSourceText}
            writerStatement={writerStatement}
            onWriterStatementChange={setWriterStatement}
            taskSheetText={taskSheetText}
            onTaskSheetTextChange={setTaskSheetText}
            schoolIsmgText={schoolIsmgText}
            onSchoolIsmgTextChange={setSchoolIsmgText}
            timeMode={timeMode}
            timeRemaining={timeRemaining}
            formattedTime={formatTime(timeRemaining)}
            isTimerRunning={isTimerRunning}
            onTimerToggle={() => {
              if (isTimerRunning) pauseTimer();
              else startTimer();
            }}
            onTimeModeChange={handleTimeModeChange}
            customMinutes={customMinutes}
            onCustomMinutesChange={handleCustomMinutesChange}
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
            assessmentStage={assessmentStage}
          />
          {showByoPanel && (
            <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
              <div style={{
                padding: '0.85rem 1.25rem', marginBottom: '1.25rem', borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)',
                color: 'var(--text-primary)', fontSize: '0.85rem', lineHeight: 1.5
              }}>
                ⚠️ <strong>Live assessment failed or timed out.</strong> You can wait and retry, or use the manual fallback below to assess your draft with your own AI (Gemini / Claude).
              </div>
              <WritingByoPanel
                prominent={true}
                onExport={handleExportPrompt}
                onImport={handleImportResult}
              />
            </div>
          )}
        </div>
      )}

      {phase === 'results' && latestResult && (
        <>
          {latestResult.portfolio_saved === false && latestResult.llm_status !== 'mock' && (
            <div role="alert" style={{
              maxWidth: 900, margin: '0 auto 1rem', padding: '0.85rem 1.1rem',
              borderRadius: '10px', background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.35)',
              color: 'var(--text-primary)', fontSize: '0.88rem', lineHeight: 1.55,
            }}>
              ⚠️ Assessment complete but portfolio save failed. Your draft is preserved locally — you can retry or continue editing.
            </div>
          )}
          <WritingResults
            isSenior={latestResult.is_senior}
            yearLevel={yearLevel}
            promptType={promptType}
            totalScore={latestResult.total_score}
            maxTotalScore={latestResult.max_total_score}
            criterionScores={latestResult.criterion_scores || []}
            highlights={latestResult.highlights || []}
            draftText={draftText}
            remediationLinks={latestResult.remediation_links || []}
            overallFeedback={latestResult.overall_feedback || ''}
            strengths={latestResult.strengths}
            nextLearningSteps={latestResult.next_learning_steps}
            revisionPlan={latestResult.revision_plan || []}
            paragraphFeedback={latestResult.paragraph_feedback || null}
            sourceUseFeedback={latestResult.source_use_feedback || null}
            writingSkillDrills={latestResult.writing_skill_drills || []}
            grammarRemediation={grammarRemediation}
            grammarRemediationLoading={grammarRemediationLoading}
            onLoadGrammarRemediation={handleLoadGrammarRemediation}
            revisionCompare={revisionCompare}
            compareLoading={compareLoading}
            taskAlignmentWarnings={latestResult.task_alignment_warnings || []}
            writerStatementFeedback={latestResult.writer_statement_feedback}
            cognitiveVerbScores={latestResult.cognitive_verb_scores}
            llmStatus={latestResult.llm_status}
            insufficientEvidence={latestResult.insufficient_evidence === true}
            onExportPrompt={handleExportPrompt}
            onImportResult={handleImportResult}
            onEdit={handleEdit}
            onPracticeTopics={handlePracticeTopics}
            canRetry={scoredResults.length < MAX_ITERATIONS}
            iterationCount={scoredResults.length}
          />
          <WritingHistory
            iterations={results}
            onTryAgain={handleTryAgain}
            maxIterations={MAX_ITERATIONS}
          />
        </>
      )}

      {phase === 'portfolio' && (
        <WritingPortfolio
          onBackToPractice={handleBackToPractice}
          onSelectTopic={handlePortfolioSelectTopic}
        />
      )}
    </div>
  );
}
