'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { safeFetch, fetchDailySummary, fetchWeeklyLearningSummary, fetchProgressSummary, fetchMistakes, examHistory, setDailyGoal, fetchPendingReviews, submitParentReview, getPuMode, setPuMode, fetchParentNextSteps, fetchLearningFacets, fetchParentEnglishSummary, fetchParentWritingHistory, fetchPSMTHistory, fetchCurriculum, analyticsScopeFromYear, syllabusSubjectFromPickerSubject, parentLogin, PARENT_AUTH_INVALID_EVENT } from '../../lib/api';
import { showToast } from '../../lib/toast';
import { getStudentId, getDisplayName, setDisplayName as persistDisplayName, clearDisplayName, resetStudentId, getStudentToken, clearToken, STORAGE_KEY } from '../../lib/student_id';
import { getSubject, getYear } from '../../lib/preferences';
import { getSubjectAdapter } from '../../lib/guided-subject-adapters';
import { ENABLE_GUIDED_PRACTICE } from '../../lib/feature-flags';
import { PARENT_AUTH_SESSION_KEY, PARENT_TOKEN_SESSION_KEY, clearParentSession, hasFreshParentSession, markParentActivity, useParentIdleLock } from '../../lib/parent-session';
import type { Curriculum, DailySummary, ExamHistoryItem, ParentWritingHistoryResponse, PSMTHistoryItem, Subject, TopicProgress, WeeklyLearningSummary as WeeklyLearningSummaryData, YearLevel } from '../../lib/api-types';

import ParentAuth from '../../components/parent/ParentAuth';
import BackToPracticeLink from '../../components/BackToPracticeLink';
import FrameworkSubjectYearPicker from '../../components/FrameworkSubjectYearPicker';
import DailySummaryCards from '../../components/parent/DailySummaryCards';
import AssessmentReadiness from '../../components/parent/AssessmentReadiness';
import ActivityCalendar from '../../components/parent/ActivityCalendar';
import StrandProgress from '../../components/parent/StrandProgress';
import CoverageConfidence from '../../components/parent/CoverageConfidence';
import DiagnosticSummary from '../../components/parent/DiagnosticSummary';
import RecentMistakes from '../../components/parent/RecentMistakes';
import ErrorCauseChart from '../../components/parent/ErrorCauseChart';
import PendingReviews from '../../components/parent/PendingReviews';
import ExamHistory from '../../components/parent/ExamHistory';
import EnglishWeeklySummary from '../../components/parent/EnglishWeeklySummary';
import ParentWritingHistory from '../../components/parent/ParentWritingHistory';
import StudentManagement from '../../components/parent/StudentManagement';
import RestoreModal from '../../components/parent/RestoreModal';
import ParentQuestsPanel from '../../components/parent/ParentQuestsPanel';
import WeeklyLearningSummary from '../../components/WeeklyLearningSummary';

const API_BASE = '/api';

const WRITING_SUBJECTS = new Set([
  'english',
  'senior_english',
  'senior_literature',
  'senior_essential_english',
  'senior_eal',
  'senior_literature_extension',
]);

function isoTimestampDaysBefore(isoDate: unknown, days: number): string | null {
  if (typeof isoDate !== 'string') return null;
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString();
}


function pendingReviewKey(review: { review_key?: string; question_id?: string; part_label?: string | null; student_answer?: string }): string {
  return review.review_key || `${review.question_id || ''}:${review.part_label || 'whole'}:${review.student_answer || ''}`;
}
export default function ParentDashboard() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [daily, setDaily] = useState<DailySummary | null>(null);
  const [weeklySummary, setWeeklySummary] = useState<WeeklyLearningSummaryData | null>(null);
  const [progress, setProgress] = useState<TopicProgress[]>([]);
  const [mistakes, setMistakes] = useState<any[]>([]);
  const [exams, setExams] = useState<ExamHistoryItem[]>([]);
  const [parentNextSteps, setParentNextSteps] = useState<any>(null);
  const [learningFacets, setLearningFacets] = useState<any>(null);
  const [englishSummary, setEnglishSummary] = useState<any>(null);
  const [writingHistory, setWritingHistory] = useState<ParentWritingHistoryResponse | null>(null);
  const [latestPsmt, setLatestPsmt] = useState<PSMTHistoryItem | null>(null);
  const [goalInput, setGoalInput] = useState(20);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [parentPicker, setParentPicker] = useState<{ subject: Subject; year: YearLevel }>({
    subject: 'math',
    year: 'year7',
  });
  useEffect(() => {
    setIsHydrated(true);
    setParentPicker({
      subject: getSubject() as Subject,
      year: getYear() as YearLevel,
    });
  }, []);
  const parentSubject = parentPicker.subject;
  const parentYear = parentPicker.year;
  const isPsmtRelevant = parentSubject === 'senior_math' || parentYear.startsWith('unit');
  const isWritingSubject = WRITING_SUBJECTS.has(parentSubject);

  // Display name for the active browser student
  const [displayName, setDisplayNameState] = useState('');

  // Multi-student household management (parent-only)
  const [students, setStudents] = useState<any[]>([]);
  const [listError, setListError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const deleteConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<{ uuid: string; name: string | null } | null>(null);

  useEffect(() => () => {
    if (deleteConfirmTimeoutRef.current) clearTimeout(deleteConfirmTimeoutRef.current);
  }, []);

  // Parent review state
  const [pendingReviews, setPendingReviews] = useState<any[]>([]);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [puModeEnabled, setPuModeEnabled] = useState(false);

  const lockDashboard = useCallback(() => {
    clearParentSession();
    // The lock screen must not keep the typed password: on a shared computer
    // anyone could unlock again with one click.
    setPasswordInput('');
    setPasswordError('');
    setAuthenticated(false);
    setLoading(false);
    setUpdating(false);
    setDashboardError('');
    setDaily(null);
    setWeeklySummary(null);
    setProgress([]);
    setMistakes([]);
    setExams([]);
    setParentNextSteps(null);
    setLearningFacets(null);
    setEnglishSummary(null);
    setWritingHistory(null);
    setLatestPsmt(null);
    setPendingReviews([]);
    setStudents([]);
  }, []);

  useParentIdleLock(authenticated, lockDashboard);

  // Restore a saved parent session only after the server validates its token.
  useEffect(() => {
    const handleInvalidParentSession = () => lockDashboard();
    window.addEventListener(PARENT_AUTH_INVALID_EVENT, handleInvalidParentSession);

    const hasSavedSession = hasFreshParentSession();
    if (!hasSavedSession) {
      // A stale session (idle too long) needs the password again.
      clearParentSession();
      setAuthChecked(true);
      return () => window.removeEventListener(PARENT_AUTH_INVALID_EVENT, handleInvalidParentSession);
    }

    let active = true;
    getPuMode()
      .then(result => {
        if (!active) return;
        setPuModeEnabled(result.pu_mode);
        setLoading(true);
        setAuthenticated(true);
      })
      .catch(() => {
        if (active) lockDashboard();
      })
      .finally(() => {
        if (active) setAuthChecked(true);
      });

    return () => {
      active = false;
      window.removeEventListener(PARENT_AUTH_INVALID_EVENT, handleInvalidParentSession);
    };
  }, [lockDashboard]);

  const handleReview = async (review: any, correct: boolean) => {
    const uuid = getStudentId();
    if (!uuid) return;
    setReviewing(pendingReviewKey(review));
    try {
      const result = await submitParentReview({
        student_id: uuid,
        subject: parentSubject,
        topic: review.topic,
        question_id: review.question_id,
        student_answer: review.student_answer,
        correct,
        attempt_id: review.attempt_id,
        exam_id: review.exam_id,
        part_label: review.part_label,
      });
      if (!result?.ok) {
        throw new Error(result?.message || 'Review was not saved.');
      }
      setPendingReviews(prev => prev.filter(item => pendingReviewKey(item) !== pendingReviewKey(review)));
      showToast(correct ? 'Approved ✓' : 'Rejected ✗', 'success');
    } catch {
      showToast('Review failed. Try again.', 'error');
    }
    setReviewing(null);
  };

  // Load display name from localStorage on mount + listen for changes
  useEffect(() => {
    const name = getDisplayName();
    if (name) setDisplayNameState(name);
    const handler = (e: CustomEvent) => setDisplayNameState(e.detail);
    window.addEventListener('display-name-changed', handler as EventListener);
    return () => window.removeEventListener('display-name-changed', handler as EventListener);
  }, []);

  const fetchStudentList = useCallback((signal?: AbortSignal) => {
    if (!authenticated) return;
    setListError('');
    safeFetch<{ students: any[] }>(`${API_BASE}/student/list`, { signal })
      .then(data => {
        if (!signal?.aborted && data?.students) setStudents(data.students);
      })
      .catch(e => {
        if (signal?.aborted) return;
        console.error('fetchStudentList failed:', e);
        setListError(e.message || 'Failed to load student list');
      });
  }, [authenticated]);

  // Sync display name for the active browser student.
  useEffect(() => {
    if (!authenticated || !displayName) return;
    const saveProfile = async () => {
      try {
        const token = await getStudentToken();
        const authValue = token.startsWith('eyJ') ? `Bearer ${token}` : token;
        await fetch(`${API_BASE}/student/profile`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authValue,
            'X-Student-Id': authValue,
          },
          body: JSON.stringify({ display_name: displayName }),
        });
      } catch (err) {
        console.error('Failed to sync student display name securely:', err);
      } finally {
        fetchStudentList();
      }
    };
    saveProfile();
  }, [authenticated, displayName, fetchStudentList]);

  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    const controller = new AbortController();
    const { signal } = controller;
    const failures: string[] = [];
    const capture = async <T,>(label: string, promise: Promise<T>, fallback: T): Promise<T> => {
      try {
        return await promise;
      } catch {
        if (!signal.aborted) failures.push(label);
        return fallback;
      }
    };

    setUpdating(true);
    setDashboardError('');
    setDaily(null);
    setWeeklySummary(null);
    setProgress([]);
    setMistakes([]);
    setExams([]);
    setParentNextSteps(null);
    setLearningFacets(null);
    setEnglishSummary(null);
    setWritingHistory(null);
    setLatestPsmt(null);
    setPendingReviews([]);
    fetchStudentList(signal);

    const scopedParentScope = {
      ...analyticsScopeFromYear(parentYear),
      syllabusSubject: syllabusSubjectFromPickerSubject(parentSubject),
      includeUnattempted: true,
    };

    void (async () => {
      const [d, weekly, progressSummary, m, e, ns, lf, es, writingHistoryData, psmt, curriculumData, puMode, reviews] = await Promise.all([
        capture('daily summary', fetchDailySummary(parentSubject, signal, scopedParentScope), null),
        capture('weekly learning summary', fetchWeeklyLearningSummary(7, signal), null),
        capture('progress', fetchProgressSummary(parentSubject, signal, scopedParentScope), { topics: [], total_direct_attempts: 0 }),
        capture('mistakes', fetchMistakes({ subject: parentSubject, ...scopedParentScope }, signal), {
          mistakes: [],
          total: 0,
          returned: 0,
          offset: 0,
          has_more: false,
          summary: {
            total: 0,
            active: 0,
            resolved: 0,
            reviews: 0,
            topic_counts: {},
            error_type_counts: {},
            topic_progress: {},
          },
        }),
        capture('exam history', examHistory(parentSubject, signal, scopedParentScope), []),
        capture('next practice', fetchParentNextSteps(parentSubject, parentYear, signal, scopedParentScope), null),
        capture('learning facets', fetchLearningFacets(parentSubject, signal, scopedParentScope), null),
        parentSubject === 'english'
          ? capture('English summary', fetchParentEnglishSummary(getStudentId(), signal, scopedParentScope), null)
          : Promise.resolve(null),
        isWritingSubject
          ? capture('Writing history', fetchParentWritingHistory(getStudentId(), signal, scopedParentScope), null)
          : Promise.resolve(null),
        isPsmtRelevant
          ? capture('PSMT history', fetchPSMTHistory(1, signal), null)
          : Promise.resolve(null),
        capture('curriculum', fetchCurriculum(signal, {
          subject: parentSubject,
          scope: parentYear,
        }), null),
        capture('Parent Review Mode', getPuMode(signal), { pu_mode: false }),
        capture('pending reviews', fetchPendingReviews(getStudentId(), parentSubject, signal, scopedParentScope), { pending: [] }),
      ]);
      if (!active || signal.aborted) return;
      setDaily(d);
      setWeeklySummary(weekly);
      setProgress(progressSummary.topics || []);
      setMistakes(m?.mistakes || []);
      setExams(e || []);
      setParentNextSteps(ns);
      setLearningFacets(lf);
      setEnglishSummary(es);
      setWritingHistory(writingHistoryData);
      setLatestPsmt(psmt?.latest || null);
      setCurriculum(curriculumData);
      setPuModeEnabled(puMode.pu_mode);
      setPendingReviews(reviews?.pending || []);
      if (d?.daily_goal) setGoalInput(d.daily_goal);
      setDashboardError(
        failures.length > 0
          ? `Some dashboard information is unavailable: ${failures.join(', ')}. Saved learning data has not been deleted.`
          : '',
      );
      setLoading(false);
      setUpdating(false);
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [authenticated, fetchStudentList, parentSubject, parentYear, isPsmtRelevant, isWritingSubject, refreshKey]);

  /** Switch browser identity to another local student profile. */
  const applyRestore = (target: { uuid: string; name: string | null }) => {
    setConfirmRestore(null);
    clearToken();
    localStorage.setItem(STORAGE_KEY, target.uuid);
    if (target.name) {
      persistDisplayName(target.name);
    } else {
      clearDisplayName();
    }
    // Parent token is bound to the previous student — force re-unlock.
    clearParentSession();
    showToast('Switched student. Unlock parent dashboard again for this profile.', 'success');
    setTimeout(() => { window.location.reload(); }, 800);
  };

  const handleSwitchToStudent = (student: { student_id: string; display_name?: string }) => {
    const target = { uuid: student.student_id, name: student.display_name || null };
    if (target.uuid === getStudentId()) {
      applyRestore(target);
      return;
    }
    setConfirmRestore(target);
  };

  const handleDeleteStudent = async (s: any) => {
    if (deleteBusy) return;
    if (deleting !== s.student_id) {
      setDeleting(s.student_id);
      if (deleteConfirmTimeoutRef.current) clearTimeout(deleteConfirmTimeoutRef.current);
      deleteConfirmTimeoutRef.current = setTimeout(() => setDeleting(null), 5000);
      return;
    }

    if (deleteConfirmTimeoutRef.current) clearTimeout(deleteConfirmTimeoutRef.current);
    setDeleteBusy(true);
    try {
      await safeFetch(`${API_BASE}/student/${encodeURIComponent(s.student_id)}`, { method: 'DELETE' });
      setStudents(prev => prev.filter(x => x.student_id !== s.student_id));
      if (s.student_id === getStudentId()) {
        clearDisplayName();
        clearToken();
        resetStudentId();
        clearParentSession();
        showToast('Deleted the current student profile and login — redirecting...', 'success');
        setTimeout(() => { window.location.href = '/'; }, 1200);
        return;
      }
      showToast(`Deleted ${s.display_name || s.student_id.slice(0, 8)}'s profile and login.`, 'success');
    } catch {
      showToast('Failed to delete the student profile. No successful deletion was confirmed.', 'error');
    } finally {
      setDeleteBusy(false);
      setDeleting(null);
    }
  };

  if (!isHydrated || !authChecked) {
    return <div role="status" aria-live="polite" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Checking parent session...</div>;
  }

  const parentCurriculum = curriculum;

  // Compute strand summary from progress
  const strandStats: Record<string, { mastered: number; total: number }> = {};
  for (const topic of progress) {
    const strand = topic.strand || 'Other';
    if (!strandStats[strand]) strandStats[strand] = { mastered: 0, total: 0 };
    strandStats[strand].total += 1;
    if (topic.status === 'mastered') strandStats[strand].mastered += 1;
  }

  // Recent mistakes (last 7 days), anchored to the server-provided summary date.
  const weekAgo = isoTimestampDaysBefore(daily?.date, 7);
  const recentMistakes = mistakes.filter(m => !weekAgo || m.timestamp > weekAgo);

  const handleSetGoal = async () => {
    try {
      await setDailyGoal(goalInput, parentSubject);
      const parentScope = {
        ...analyticsScopeFromYear(parentYear),
        syllabusSubject: syllabusSubjectFromPickerSubject(parentSubject),
      };
      const d = await fetchDailySummary(parentSubject, undefined, parentScope);
      setDaily(d);
      showToast('All-subject daily goal saved.', 'success');
    } catch {
      showToast('Failed to save the daily goal. Try again.', 'error');
    }
  };

  const parentFocusTopic = parentNextSteps?.focus_area?.topic_id;
  const guidedPracticeHref = parentNextSteps?.deep_link || (parentFocusTopic
    ? `/guided-practice?topic=${encodeURIComponent(parentFocusTopic)}&mode=parent-focus`
    : '/guided-practice');
  const reasonLabels: Record<string, string> = {
    repeated_recent_errors: 'Repeated recent errors',
    recent_error: 'Recent error',
    low_mastery: 'Low mastery',
    latest_exam_gap: 'Exam gap',
    high_help_reliance: 'High help use',
    practice_momentum: 'Practice momentum',
    no_recent_evidence: 'No recent evidence',
    low_evidence: 'Early signal only',
  };

  if (!authenticated) {
    return (
      <ParentAuth
        passwordInput={passwordInput}
        passwordError={passwordError}
        onPasswordChange={setPasswordInput}
        onSubmit={async e => {
          e.preventDefault();
          if (!passwordInput) {
            setPasswordError('Enter the parent password.');
            return;
          }
          try {
            const { token } = await parentLogin(passwordInput);
            sessionStorage.setItem(PARENT_TOKEN_SESSION_KEY, token);
            sessionStorage.setItem(PARENT_AUTH_SESSION_KEY, '1');
            markParentActivity();
            // Do not keep the password in page state once it has been used.
            setPasswordInput('');
            setLoading(true);
            setAuthenticated(true);
            setAuthChecked(true);
            setPasswordError('');
          } catch (error) {
            setPasswordError(error instanceof Error ? error.message : 'Unable to unlock dashboard');
          }
        }}
      />
    );
  }

  if (loading) {
    return <div role="status" aria-live="polite" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading dashboard...</div>;
  }

  return (
    <div style={{ maxWidth: '1350px', margin: '0 auto', padding: '24px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '8px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>
            👨‍👩‍👧 Parent Dashboard
            {displayName && <span style={{ fontSize: '16px', fontWeight: '500', color: 'var(--text-secondary)', marginLeft: '8px' }}>— {displayName}</span>}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <BackToPracticeLink />
          <button
            onClick={lockDashboard}
            style={{
              padding: '8px 14px', fontSize: '13px', fontWeight: '600',
              borderRadius: '8px', border: '1px solid var(--border-color)',
              background: 'transparent', color: 'var(--text-secondary)',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            🔒 Lock Dashboard
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 360px' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0 0 10px 0' }}>
            Overview of your child&apos;s learning progress and habits.
          </p>
          <FrameworkSubjectYearPicker
            curriculum={parentCurriculum}
            value={parentPicker}
            onChange={setParentPicker}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={puModeEnabled}
            onChange={async e => {
              const enabled = e.target.checked;
              const previous = puModeEnabled;
              setPuModeEnabled(enabled);
              try {
                const result = await setPuMode(enabled);
                setPuModeEnabled(result.pu_mode);
              } catch {
                setPuModeEnabled(previous);
                showToast('Failed to update Parent Review Mode.', 'error');
              }
            }}
          />
          <span style={{ color: puModeEnabled ? '#c084fc' : 'var(--text-secondary)' }}>
            Parent Review Mode
          </span>
        </label>
      </div>

      {updating && (
        <div role="status" aria-live="polite" style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
          Updating {parentSubject} {parentYear} analytics…
        </div>
      )}
      {dashboardError && (
        <div role="alert" style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: '8px', color: '#b91c1c', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <div>{dashboardError}</div>
          <button type="button" onClick={() => setRefreshKey(key => key + 1)} style={{ marginTop: '8px' }}>
            Retry unavailable sections
          </button>
        </div>
      )}

      <Link
        id="bank-review"
        href="/bank-review"
        className="glass-panel"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 20,
          padding: '14px 16px',
          borderRadius: 12,
          textDecoration: 'none',
          color: 'inherit',
          border: '1px solid var(--border-color)',
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            📚 Exercise bank review
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>
            Import candidate banks, step through every item (diagrams + marking), then append to production files.
          </div>
        </div>
        <span style={{
          flexShrink: 0,
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--accent-color)',
          whiteSpace: 'nowrap',
        }}>
          Open →
        </span>
      </Link>

      <DailySummaryCards daily={daily} examsCount={exams.length} />

      <div style={{ marginBottom: '24px' }}>
        <WeeklyLearningSummary summary={weeklySummary} audience="parent" />
      </div>

      <AssessmentReadiness exams={exams} latestPsmt={latestPsmt} showPsmt={isPsmtRelevant} />

      {/* Parent Next Steps Summary (Feature C) */}
      {parentNextSteps && (
        <div className="glass-panel animate-fade-in" style={{
          padding: '24px',
          borderRadius: '16px',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.06), rgba(168, 85, 247, 0.04))',
          border: '1px solid rgba(99, 102, 241, 0.25)',
          marginBottom: '24px',
          textAlign: 'left'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '20px' }}>🎯</span>
            <h3 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>Recommended Next Practice</h3>
          </div>
          <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--accent-color)', margin: '0 0 12px 0' }}>
            {parentNextSteps.headline}
          </h4>
          {parentNextSteps.reason_codes?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              {parentNextSteps.reason_codes.map((code: string) => (
                <span
                  key={code}
                  style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    color: 'var(--accent-color)',
                    background: 'rgba(99,102,241,0.09)',
                    border: '1px solid rgba(99,102,241,0.22)',
                    borderRadius: '999px',
                    padding: '4px 8px',
                  }}
                >
                  {reasonLabels[code] || code.replaceAll('_', ' ')}
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ margin: 0, lineHeight: '1.6' }}>
                <strong>What to do:</strong> {parentNextSteps.next_practice_action}
              </p>
              <p style={{ margin: 0, lineHeight: '1.6' }}>
                <strong>Why it matters:</strong> {parentNextSteps.why_it_matters}
              </p>
              <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
                {ENABLE_GUIDED_PRACTICE && (
                  <a
                    href={guidedPracticeHref}
                    style={{
                      background: 'var(--accent-gradient)',
                      color: '#fff',
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: '700',
                      textDecoration: 'none',
                      display: 'inline-block'
                    }}
                  >
                    🚀 Start Guided Session
                  </a>
                )}
                <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  ⏱ Recommended session: {parentNextSteps.suggested_duration_minutes} mins
                </span>
              </div>
              {parentNextSteps.evidence && (
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  <span>Recent attempts: {parentNextSteps.evidence.recent_attempts ?? 0}</span>
                  {parentNextSteps.evidence.recent_accuracy !== null && parentNextSteps.evidence.recent_accuracy !== undefined && (
                    <span>Recent accuracy: {Math.round(parentNextSteps.evidence.recent_accuracy * 100)}%</span>
                  )}
                  <span>Confidence: {parentNextSteps.evidence.confidence || 'low'}</span>
                  {(parentNextSteps.evidence.hint_count > 0 || parentNextSteps.evidence.dialogue_turns > 0) && (
                    <span>Help used: {(parentNextSteps.evidence.hint_count || 0) + (parentNextSteps.evidence.dialogue_turns || 0)}</span>
                  )}
                </div>
              )}
              {(parentNextSteps.most_practised_area || parentNextSteps.strongest_area) && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginTop: '4px' }}>
                  {parentNextSteps.most_practised_area && (
                    <div style={{ padding: '9px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)' }}>
                      <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 700 }}>Most practised</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 700, marginTop: '3px' }}>
                        {parentNextSteps.most_practised_area.name}
                      </div>
                    </div>
                  )}
                  {parentNextSteps.strongest_area && (
                    <div style={{ padding: '9px 10px', borderRadius: '8px', border: '1px solid rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.05)' }}>
                      <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 700 }}>Strongest supported area</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 700, marginTop: '3px' }}>
                        {parentNextSteps.strongest_area.name} · {Math.round((parentNextSteps.strongest_area.accuracy || 0) * 100)}%
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {parentNextSteps.weekly_coaching_plan && (
              <div style={{ background: 'rgba(99,102,241,0.07)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <strong style={{ display: 'block', fontSize: '12px', color: 'var(--accent-color)' }}>Weekly Coaching Plan</strong>
                <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  <strong>Focus:</strong> {parentNextSteps.weekly_coaching_plan.focus}
                </div>
                {parentNextSteps.weekly_coaching_plan.student_actions?.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    {parentNextSteps.weekly_coaching_plan.student_actions.slice(0, 3).map((item: string, idx: number) => <li key={idx}>{item}</li>)}
                  </ul>
                )}
                {parentNextSteps.weekly_coaching_plan.parent_questions?.length > 0 && (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    <strong>Ask:</strong> {parentNextSteps.weekly_coaching_plan.parent_questions[0]}
                  </div>
                )}
              </div>
            )}
            {parentNextSteps.focus_area && (
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <strong style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)' }}>Focus Topic</strong>
                <div style={{ fontWeight: '700', color: 'var(--text-primary)', fontSize: '13px', lineHeight: '1.4' }}>
                  {parentNextSteps.focus_area.name}
                </div>
                {parentNextSteps.focus_area.accuracy !== undefined && (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 'auto' }}>
                    Recent Accuracy: <strong style={{ color: parentNextSteps.focus_area.accuracy >= 0.8 ? '#10b981' : parentNextSteps.focus_area.accuracy >= 0.5 ? '#d97706' : '#ef4444' }}>{Math.round(parentNextSteps.focus_area.accuracy * 100)}%</strong>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Derived Mastery Facets (Feature D) */}
      {learningFacets && (
        <div className="glass-panel animate-fade-in" style={{ padding: '24px', borderRadius: '16px', marginBottom: '24px', textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <span style={{ fontSize: '20px' }}>📊</span>
            <h3 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>Student Diagnostic Facets</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
            {Object.entries(learningFacets).map(([key, value]: [string, any]) => {
              const statusColors = {
                secure: { bg: 'rgba(16, 185, 129, 0.08)', border: 'rgba(16, 185, 129, 0.25)', text: '#10b981' },
                developing: { bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.25)', text: '#d97706' },
                stretch: { bg: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239, 68, 68, 0.25)', text: '#ef4444' }
              };
              const colors = statusColors[value.status as keyof typeof statusColors] || statusColors.developing;
              const subjAdapter = getSubjectAdapter(parentSubject);
              return (
                <div key={key} style={{
                  padding: '16px',
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.01)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  transition: 'all 0.2s ease',
                }}
                className="hover-card-grow"
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: '700', fontSize: '13.5px', color: 'var(--text-primary)' }}>
                      {subjAdapter.facetDisplayName(key)}
                    </span>
                    <span style={{
                      fontSize: '10px',
                      fontWeight: '700',
                      textTransform: 'uppercase',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: colors.bg,
                      border: `1px solid ${colors.border}`,
                      color: colors.text
                    }}>
                      {value.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {(value.evidence_count ?? 0) > 0 ? (
                      <>
                        <div
                          role="progressbar"
                          aria-label={`${subjAdapter.facetDisplayName(key)} score`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(value.score * 100)}
                          aria-valuetext={`${Math.round(value.score * 100)} percent, ${value.status}`}
                          style={{ flex: 1, height: '6px', background: 'var(--bg-secondary)', borderRadius: '3px', overflow: 'hidden' }}
                        >
                          <div style={{ width: `${value.score * 100}%`, height: '100%', background: colors.text, borderRadius: '3px' }} />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                          {Math.round(value.score * 100)}%
                        </span>
                      </>
                    ) : (
                      <span style={{ fontSize: '11.5px', fontStyle: 'italic', color: 'var(--text-muted)' }}>
                        Not enough evidence yet
                      </span>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    {value.evidence}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {parentSubject === 'english' && <EnglishWeeklySummary data={englishSummary} loading={loading} />}
      {isWritingSubject && <ParentWritingHistory data={writingHistory} />}

      {/* Set Daily Goal */}
      <div className="glass-panel" style={{ padding: '16px 20px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <label htmlFor="parent-daily-goal" style={{ fontSize: '14px', fontWeight: '600' }}>Daily Goal (across all subjects):</label>
        <select id="parent-daily-goal" value={goalInput} onChange={e => setGoalInput(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px' }}>
          <option value={5}>5 questions</option>
          <option value={10}>10 questions</option>
          <option value={15}>15 questions</option>
          <option value={20}>20 questions</option>
          <option value={30}>30 questions</option>
        </select>
        <button onClick={handleSetGoal} style={{ padding: '6px 14px', borderRadius: '6px', background: 'var(--accent-color)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
          Save
        </button>
      </div>

      {daily?.activity_dates && daily.activity_dates.length > 0 && (
        <ActivityCalendar activityDates={daily.activity_dates} />
      )}

      <CoverageConfidence progress={progress} />

      <DiagnosticSummary subject={parentSubject} year={parentYear} />

      <StrandProgress strandStats={strandStats} />

      <ErrorCauseChart mistakes={mistakes} subject={parentSubject} />

      <RecentMistakes mistakes={recentMistakes} />

      <PendingReviews
        reviews={pendingReviews}
        reviewing={reviewing}
        parentSubject={parentSubject}
        onReview={handleReview}
      />

      <ParentQuestsPanel />

      <ExamHistory exams={exams} />

      <StudentManagement
        students={students}
        listError={listError}
        deleting={deleting}
        deleteBusy={deleteBusy}
        onSwitchToStudent={handleSwitchToStudent}
        onDeleteStudent={handleDeleteStudent}
      />

      {confirmRestore && (
        <RestoreModal
          target={confirmRestore}
          onCancel={() => setConfirmRestore(null)}
          onConfirm={() => applyRestore(confirmRestore)}
        />
      )}

    </div>
  );
}
