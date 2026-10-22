'use client';
import { useEffect, useState, useRef, useMemo } from 'react';
import CurriculumTree from '../components/CurriculumTree';
import TutorInterface from '../components/TutorInterface';
import FrameworkSubjectYearPicker from '../components/FrameworkSubjectYearPicker';
import { analyticsScopeFromYear, fetchContentAvailability, fetchCurriculum, fetchExercises, fetchRecommend, fetchProgress, diagnosticDismiss, fetchDailySummary, fetchHealth, syllabusSubjectFromPickerSubject } from '../lib/api';
import { getSubject, getYear } from '../lib/preferences';
import { isMastered } from '../lib/mastery';
import { getDisplayName, clearDisplayName, clearToken, TOKEN_STORAGE_KEY } from '../lib/student_id';
import { clearParentSession } from '../lib/parent-session';
import { showToast } from '../lib/toast';
import { Menu, X } from 'lucide-react';
import ThemeToggle from '../components/ThemeToggle';
import {
  humanise,
  findTopicInCurriculum,
} from '../lib/curriculum_helpers';
import { ENABLE_GUIDED_PRACTICE } from '../lib/feature-flags';
import MoreToolsPanel from '../components/MoreToolsPanel';
import TodayStudyCard from '../components/TodayStudyCard';
import ProgressiveDisclosure from '../components/ProgressiveDisclosure';
import { buildMistakesHref, buildTodayHref, scopedSubjectFromSearchParams, scopedYearFromSearchParams } from '../lib/scoped_navigation';
import { filterCurriculumByAvailability, hasAuthoredContentForScope } from '../lib/content-availability';
import { buildLabDeepLink, getLabActivitiesForTopic } from '../lib/lab-topic-links';
import { buildScienceLabDeepLink, getScienceActivitiesForTopic } from '../lib/science-lab/topic-links';
import { ENABLE_SCIENCE_LAB } from '../lib/feature-flags';
import type { Curriculum, Exercise, Recommendation, DailySummary, Subject, YearLevel, HealthCheck } from '../lib/api-types';

/** Scope curriculum for the sidebar without passing undefined year slices (crashes CurriculumTree). */
function filterCurriculumForPicker(
  curriculum: Curriculum | null,
  subject: Subject,
  year: YearLevel,
): Curriculum | null {
  if (!curriculum || typeof curriculum !== 'object') return null;
  const subjectSlice = curriculum[subject];
  if (!subjectSlice || typeof subjectSlice !== 'object') return null;
  const years = subjectSlice as Record<string, unknown>;
  let yearKey = String(year);
  let yearData = years[yearKey];
  if (!yearData || typeof yearData !== 'object') {
    const fallback = Object.keys(years).find(
      (k) => k !== 'sequence' && years[k] && typeof years[k] === 'object',
    );
    if (!fallback) return null;
    yearKey = fallback;
    yearData = years[fallback];
  }
  return {
    [subject]: {
      [yearKey]: yearData,
    },
  } as Curriculum;
}

export default function App() {
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [noAuthoredContent, setNoAuthoredContent] = useState(false);
  const [curriculumReloadNonce, setCurriculumReloadNonce] = useState(0);
  const [activeTopic, setActiveTopic] = useState<string>("");
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loadingExercises, setLoadingExercises] = useState(false);
  const [exerciseLoadError, setExerciseLoadError] = useState(false);
  const [exerciseReloadNonce, setExerciseReloadNonce] = useState(0);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [pickerValue, setPickerValue] = useState<{ subject: Subject; year: YearLevel }>({ subject: 'math', year: 'year7' });
  const [isHydrated, setIsHydrated] = useState(false);
  const [navigationSearch, setNavigationSearch] = useState('');
  const [markCount, setMarkCount] = useState(0);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [masteredTopics, setMasteredTopics] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [diagnosticDismissing, setDiagnosticDismissing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarDragCleanupRef = useRef<() => void>(() => {});

  // Hydrate from localStorage after mount (avoids SSR/client mismatch)
  useEffect(() => {
    const saved = localStorage.getItem('qld_sidebar_width');
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= 260 && w <= 500) setSidebarWidth(w);
    }
  }, []);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);

  // At 1200px and below the study navigation is a drawer. A closed drawer is off
  // screen, so keyboard and screen reader users must not reach its controls.
  const [drawerLayout, setDrawerLayout] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 1200px)');
    const update = () => setDrawerLayout(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    fetchHealth(abort.signal)
      .then(setHealth)
      .catch(() => setHealth(null));
    return () => abort.abort();
  }, []);

  useEffect(() => {
    localStorage.setItem('qld_sidebar_width', String(sidebarWidth));
  }, [sidebarWidth]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    sidebarDragCleanupRef.current();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = sidebarWidthRef.current;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      setSidebarWidth(Math.max(260, Math.min(500, startWidth.current + ev.clientX - startX.current)));
    };
    const cleanupDrag = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', cleanupDrag);
      sidebarDragCleanupRef.current = () => {};
    };
    sidebarDragCleanupRef.current = cleanupDrag;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', cleanupDrag);
  };

  useEffect(() => () => sidebarDragCleanupRef.current(), []);

  const handleSidebarResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 20 : -20;
    setSidebarWidth(width => Math.max(260, Math.min(500, width + delta)));
  };

  const [showWelcome, setShowWelcome] = useState(false);

  // Load progress for mastered topics (refreshes after marks too)
  useEffect(() => {
    if (!isHydrated) return;
    const abort = new AbortController();
    fetchProgress(pickerValue.subject, abort.signal, { ...analyticsScopeFromYear(pickerValue.year), syllabusSubject: syllabusSubjectFromPickerSubject(pickerValue.subject) })
      .then((data) => {
        const mastered = new Set<string>(data.filter((t) => isMastered(t)).map((t) => t.topic));
        setMasteredTopics(mastered);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [markCount, pickerValue.subject, pickerValue.year, isHydrated]);

  // Handle ?topic= and ?question= URL params — allows deep-linking from Error Book / Exam results
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setNavigationSearch(window.location.search);
    
    // Load preferences as the baseline fallback rather than static defaults
    const prefSubject = getSubject();
    const prefYear = getYear();
    
    setPickerValue(() => {
      const subject = scopedSubjectFromSearchParams(params, prefSubject);
      const year = scopedYearFromSearchParams(params, prefYear);
      return { subject, year };
    });
    
    const topicParam = params.get('topic');
    if (topicParam) {
      setActiveTopic(topicParam);
    }
    // Keep question param in URL for TutorInterface to pick up
    setIsHydrated(true);
  }, []);

  // Browser back/forward changes the URL without remounting this page. Reapply
  // the scoped query so the visible picker/topic matches the history entry.
  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined') return;
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      setNavigationSearch(window.location.search);
      const subject = scopedSubjectFromSearchParams(params, getSubject());
      const year = scopedYearFromSearchParams(params, getYear());
      setPickerValue({ subject, year });
      const topic = params.get('topic');
      setActiveTopic(topic || '');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isHydrated]);

  // Document title
  useEffect(() => {
    if (!isHydrated) return;
    if (activeTopic) {
      document.title = `${humanise(activeTopic)} — QLD AI Tutor`;
    } else {
      document.title = 'QLD AI Tutor — Practice';
    }
    return () => { document.title = 'QLD AI Tutor'; };
  }, [activeTopic, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    // Fetch the active curriculum scope on mount, scope change, or retry. Use a cancelled flag so cleanup aborts do
    // not leave the UI stuck on "Loading curriculum..." (common when returning
    // from Error Book via client navigation + React remount).
    let cancelled = false;
    let currentAbort: AbortController | null = null;
    let currentTimer: ReturnType<typeof setTimeout> | null = null;
    // True only for intentional 15s timeout aborts (not unmount cleanup).
    let timedOut = false;

    async function loadData() {
      if (currentAbort) currentAbort.abort();
      if (currentTimer) clearTimeout(currentTimer);
      timedOut = false;

      const abort = new AbortController();
      currentAbort = abort;
      currentTimer = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, 15_000);

      if (!cancelled) setLoadError(false);
      try {
        const [curData, availability] = await Promise.all([
          fetchCurriculum(abort.signal, {
            subject: pickerValue.subject,
            scope: pickerValue.year,
          }),
          fetchContentAvailability(abort.signal).catch(() => null),
        ]);
        if (currentTimer) clearTimeout(currentTimer);
        if (cancelled) return;
        if (!curData || typeof curData !== 'object') {
          setLoadError(true);
          return;
        }
        const availableCurriculum = filterCurriculumByAvailability(curData, availability);
        const hasContent = hasAuthoredContentForScope(
          availability,
          pickerValue.subject,
          pickerValue.year,
        );
        setLoadError(false);
        setNoAuthoredContent(!hasContent);
        setCurriculum(availableCurriculum);
        // Preserve an explicit/deep-linked topic only when its selected scope
        // has authored content; never start a content-shell topic.
        const subject = pickerValue.subject;
        const year = pickerValue.year;
        const yearSlice = availableCurriculum[subject]?.[year];
        if (hasContent && yearSlice && typeof yearSlice === 'object') {
          setActiveTopic(prev => (
            prev && Object.prototype.hasOwnProperty.call(yearSlice, prev) ? prev : ''
          ));
        } else {
          setActiveTopic('');
        }
        // Load recommendation (non-blocking)
        try {
          const rec = await fetchRecommend(subject, year);
          if (!cancelled) setRecommendation(rec);
        } catch {
          // Recommendation failure is non-critical
        }
      } catch (e) {
        if (currentTimer) clearTimeout(currentTimer);
        if (cancelled) return;
        const isAbort =
          (e instanceof DOMException && e.name === 'AbortError')
          || (e instanceof Error && e.name === 'AbortError');
        if (isAbort && !timedOut) {
          // Cleanup abort during remount — a new effect will load; do not stick on Loading forever.
          return;
        }
        console.error('Failed to load data', e);
        setLoadError(true);
      }
    }
    loadData();

    // Re-fetch on bfcache restore (browser back/forward) and when tab becomes
    // visible again with no curriculum (e.g. soft-nav left a failed state).
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) loadData();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        // If we still have nothing useful, try again without user Retry click.
        setCurriculum((cur) => {
          if (!cur) {
            queueMicrotask(() => {
              if (!cancelled) loadData();
            });
          }
          return cur;
        });
      }
    };
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (currentTimer) clearTimeout(currentTimer);
      if (currentAbort) currentAbort.abort();
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [curriculumReloadNonce, isHydrated, pickerValue.subject, pickerValue.year]);



  // Sync activeTopic back to URL query parameters
  useEffect(() => {
    if (!isHydrated) return;
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const originalSearch = url.search;
    if (activeTopic) {
      if (url.searchParams.get('topic') !== activeTopic) {
        url.searchParams.set('topic', activeTopic);
      }
    } else {
      url.searchParams.delete('topic');
      url.searchParams.delete('question');
      url.searchParams.delete('show_answer');
    }
    url.searchParams.set('subject', pickerValue.subject);
    if (pickerValue.year.startsWith('unit')) {
      url.searchParams.delete('year');
      url.searchParams.set('unit', pickerValue.year.replace('unit', ''));
    } else {
      url.searchParams.delete('unit');
      url.searchParams.set('year', pickerValue.year);
    }
    if (pickerValue.subject.startsWith('senior_')) {
      url.searchParams.set('syllabus_subject', pickerValue.subject.replace(/^senior_/, ''));
    } else {
      url.searchParams.delete('syllabus_subject');
    }
    if (url.search !== originalSearch) {
      const nextUrl = url.pathname + url.search;
      if (activeTopic) window.history.pushState(null, '', nextUrl);
      else window.history.replaceState(null, '', nextUrl);
      setNavigationSearch(url.search);
    }
  }, [activeTopic, pickerValue.subject, pickerValue.year, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    const abort = new AbortController();
    if (activeTopic && !noAuthoredContent) {
      setExerciseLoadError(false);
      setLoadingExercises(true);
      const isSenior = pickerValue.year.startsWith('unit');
      const yearLevel = isSenior ? undefined : parseInt(pickerValue.year.replace('year', '')) || undefined;
      const unit = isSenior ? parseInt(pickerValue.year.replace('unit', '')) || undefined : undefined;
      const syllabusSubject = syllabusSubjectFromPickerSubject(pickerValue.subject);
      fetchExercises(activeTopic, abort.signal, pickerValue.subject, yearLevel, unit, syllabusSubject)
        .then(data => {
          setExercises(data);
          setExerciseLoadError(false);
          setLoadingExercises(false);
        })
        .catch(e => {
          if (e.name === 'AbortError') return;
          console.error('Failed to load exercises for', activeTopic, e);
          setExercises([]);
          setExerciseLoadError(true);
          setLoadingExercises(false);
        });
      // Recommendation is fetched at subject/year level (pickerValue effect)
      // and refreshed after marks (markCount effect). No need to re-fetch
      // on every topic change — avoids duplicate API calls.
    } else {
      setExercises([]);
      setExerciseLoadError(false);
      setLoadingExercises(false);
    }
    return () => abort.abort();
  }, [activeTopic, noAuthoredContent, pickerValue.subject, pickerValue.year, isHydrated, exerciseReloadNonce]);

  const [hasToken, setHasToken] = useState(false);

  const handleSignOut = () => {
    clearDisplayName();
    clearToken();
    // Signing out also ends parent access in this tab.
    clearParentSession();
    window.location.reload();
  };

  // Load display name on mount
  useEffect(() => {
    if (!isHydrated) return;
    const name = getDisplayName();
    if (name) setDisplayName(name);
  }, [pickerValue.subject, isHydrated]);

  // Check token on client only (avoid hydration mismatch)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setHasToken(!!localStorage.getItem(TOKEN_STORAGE_KEY));
    }
  }, []);

  // Fetch daily summary on mount and after marks
  useEffect(() => {
    if (!isHydrated) return;
    const abort = new AbortController();
    fetchDailySummary(pickerValue.subject, abort.signal, { ...analyticsScopeFromYear(pickerValue.year), syllabusSubject: syllabusSubjectFromPickerSubject(pickerValue.subject) })
      .then(data => setDailySummary(data))
      .catch(() => {});
    return () => abort.abort();
  }, [pickerValue.subject, pickerValue.year, isHydrated]);

  // Show welcome guide for new users (no attempts yet)
  useEffect(() => {
    if (!dailySummary) return;
    const isNewUser = dailySummary.today_attempts === 0 && dailySummary.streak_days === 0;
    const noActiveRec = !recommendation || !recommendation.recommendation_type;
    setShowWelcome(isNewUser && noActiveRec);
  }, [dailySummary, recommendation]);

  // Refetch recommendation and daily summary after a successful mark
  useEffect(() => {
    if (!isHydrated) return;
    if (markCount === 0) return;
    const timer = setTimeout(() => {
      fetchRecommend(pickerValue.subject, pickerValue.year)
        .then(rec => setRecommendation(rec))
        .catch(() => showToast('Failed to refresh recommendation', 'error'));
      fetchDailySummary(pickerValue.subject, undefined, { ...analyticsScopeFromYear(pickerValue.year), syllabusSubject: syllabusSubjectFromPickerSubject(pickerValue.subject) })
        .then(data => setDailySummary(data))
        .catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [markCount, pickerValue.subject, pickerValue.year, isHydrated]);

  const handlePickerChange = (next: { subject: Subject; year: YearLevel }) => {
    setNoAuthoredContent(false);
    setActiveTopic('');
    setExercises([]);
    setExerciseLoadError(false);
    setRecommendation(null);
    setPickerValue(next);
  };

  const handleSelectTopic = (topic: string) => {
    setActiveTopic(topic);
    setSidebarOpen(false);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      window.setTimeout(() => {
        document.getElementById('practice-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 320);
    }
  };

  const handleMarkSuccess = () => {
    setMarkCount(prev => prev + 1);
  };

  const handleGoToRecommended = () => {
    const target = recommendation?.topic_id ?? recommendation?.topic;
    if (target) {
      setActiveTopic(target);
    }
  };

  // Filter curriculum to selected subject/year for the tree (skip missing years).
  const filteredCurriculum = useMemo(
    () => filterCurriculumForPicker(curriculum, pickerValue.subject, pickerValue.year),
    [curriculum, pickerValue.subject, pickerValue.year],
  );

  const speedRoundHref = activeTopic ? `/challenge?topic=${encodeURIComponent(activeTopic)}` : '/challenge';
  const mathLabActivityForTopic = activeTopic ? getLabActivitiesForTopic(activeTopic)[0] : undefined;
  const scienceLabActivityForTopic = activeTopic && ENABLE_SCIENCE_LAB ? getScienceActivitiesForTopic(activeTopic)[0] : undefined;
  const topicLabLink = scienceLabActivityForTopic
    ? {
        href: buildScienceLabDeepLink(scienceLabActivityForTopic.id, 'learn', {
          subject: pickerValue.subject,
          year: pickerValue.year,
          topic: activeTopic,
        }),
        title: scienceLabActivityForTopic.title,
        objective: scienceLabActivityForTopic.description,
      }
    : mathLabActivityForTopic
      ? {
          href: buildLabDeepLink(mathLabActivityForTopic.id, 'learn', {
            subject: pickerValue.subject,
            year: pickerValue.year,
            topic: activeTopic,
          }),
          title: mathLabActivityForTopic.title,
          objective: mathLabActivityForTopic.objective,
        }
      : undefined;
  const currentSearchParams = new URLSearchParams(isHydrated ? navigationSearch : '');
  const activeTopicName = activeTopic ? findTopicInCurriculum(curriculum, activeTopic)?.name : undefined;
  const scopedMistakesHref = buildMistakesHref({
    subject: pickerValue.subject,
    year: pickerValue.year,
    topic: activeTopic || undefined,
  });

  const navLinkStyle = (color: string, hasBorder = true): React.CSSProperties => ({
    color,
    textDecoration: 'none',
    fontWeight: '500',
    fontSize: '13px',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    padding: '10px 4px',
    borderBottom: hasBorder ? '1px solid var(--border-color)' : 'none',
  });

  const navDescriptionStyle: React.CSSProperties = {
    color: 'var(--text-secondary)',
    fontSize: '12px',
    fontWeight: '400',
    lineHeight: 1.35,
  };

  return (
    <>
      <h1 className="sr-only">
        QLD AI Tutor — Practice
      </h1>
      <div className="app-container">
        {/* Tablet sidebar toggle */}
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(prev => !prev)}
          aria-label={sidebarOpen ? 'Close study navigation' : 'Open study navigation'}
          aria-expanded={sidebarOpen}
          aria-controls="study-navigation"
        >
          {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        {/* Overlay behind sidebar on tablet */}
        <button
          type="button"
          className={`sidebar-overlay${sidebarOpen ? ' visible' : ''}`}
          aria-label="Close study navigation"
          tabIndex={sidebarOpen ? 0 : -1}
          onClick={() => setSidebarOpen(false)}
        />
        <aside
          id="study-navigation"
          aria-label="Study navigation"
          inert={drawerLayout && !sidebarOpen}
          className={`sidebar-column${sidebarOpen ? ' sidebar-open' : ''}`}
          style={{ width: sidebarWidth }}
        >
          
          {/* Welcome panel */}
          <div className="glass-panel" style={{ padding: '16px 20px' }}>
              {displayName ? (
                <>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: '500' }}>
                    Welcome back
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', marginTop: '2px', gap: '8px' }}>
                    <span style={{ fontSize: '20px', fontWeight: '700', fontFamily: "'Outfit', sans-serif", flex: 1 }}>
                      {displayName}
                    </span>
                    <ThemeToggle inline />
                    {hasToken && (
                      <button
                        onClick={handleSignOut}
                        style={{
                          padding: '4px 14px', fontSize: '12px', fontWeight: '600',
                          borderRadius: '8px', border: 'none', cursor: 'pointer',
                          background: 'var(--accent-color)', color: '#fff', lineHeight: '22px',
                        }}
                      >
                        Sign out
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '15px', fontWeight: '700', fontFamily: "'Outfit', sans-serif" }}>
                    QLD AI Tutor
                  </span>
                  <ThemeToggle inline />
                </div>
              )}
          </div>

          {/* Subject/Year Picker */}
          {curriculum && (
            <div className="glass-panel" style={{ padding: '16px' }}>
              <FrameworkSubjectYearPicker
                curriculum={curriculum}
                value={pickerValue}
                onChange={handlePickerChange}
                initialiseFromPreferences={false}
              />
            </div>
          )}

          {isHydrated && (
            <TodayStudyCard
              subject={pickerValue.subject}
              year={pickerValue.year}
              refreshTrigger={markCount}
            />
          )}

          {health?.llm_status === 'mock' && (
            <div
              className="glass-panel"
              role="status"
              style={{
                padding: '12px 16px',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                background: 'rgba(245, 158, 11, 0.10)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                lineHeight: 1.5,
              }}
            >
              ⚠️ <strong>Limited feedback mode:</strong> closed-answer questions are still marked normally, but some open responses may need parent review and personalised hints may be unavailable.
            </div>
          )}

          {/* Welcome guide for new users */}
          {showWelcome && (
            <div className="glass-panel" style={{
              padding: '20px', marginBottom: '12px',
              background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.06))',
              border: '1px solid rgba(99,102,241,0.25)',
            }}>
              <div style={{ fontSize: '22px', marginBottom: '8px' }}>👋</div>
              <div style={{ fontSize: '15px', fontWeight: '700', marginBottom: '6px', color: 'var(--text-primary)' }}>
                Welcome{displayName ? `, ${displayName}` : ''}!
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '12px' }}>
                Here’s how to get started:
              </div>
              <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '2' }}>
                <li><strong style={{ color: 'var(--text-primary)' }}>Pick a subject & year</strong> using the selector above</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Choose a topic</strong> from the curriculum tree below</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Answer questions</strong> and get instant feedback</li>
              </ol>
              <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--accent-color)' }}>
                💡 Tip: Today&apos;s study will include a diagnostic first when the tutor needs to calibrate your level.
              </div>
            </div>
          )}

          {/* Daily progress + streak + Quest Board (single card — no stacked panels) */}
          {dailySummary && (
            <div className="glass-panel" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: 8 }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                  Across all subjects: {dailySummary.today_attempts}/{dailySummary.daily_goal} optional activity goal
                </span>
                {dailySummary.today_attempts >= dailySummary.daily_goal && (
                  <span style={{ fontSize: '11px', color: '#16a34a', flexShrink: 0 }}>✓ Habit goal met</span>
                )}
              </div>
              <div style={{ height: '6px', background: 'var(--bg-secondary)', borderRadius: '3px', overflow: 'hidden', marginBottom: '10px' }}>
                <div style={{
                  width: `${Math.min(100, (dailySummary.today_attempts / Math.max(1, dailySummary.daily_goal)) * 100)}%`,
                  height: '100%',
                  background: dailySummary.today_attempts >= dailySummary.daily_goal ? '#16a34a' : 'var(--accent-color)',
                  borderRadius: '3px',
                  transition: 'width 0.3s ease',
                }} />
              </div>
              {/* Daily Streak */}
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                marginTop: '10px',
                padding: '8px 10px',
                borderRadius: '8px',
                background: 'rgba(59, 130, 246, 0.12)',
                border: '1px solid rgba(59, 130, 246, 0.28)',
                fontSize: '12px',
                minWidth: 0,
              }}>
                <span role="img" aria-label="streak" style={{ fontSize: '15px', flexShrink: 0 }}>🔥</span>
                <span style={{
                  fontWeight: '600',
                  color: (dailySummary.streak_days ?? 0) > 0 ? '#2563eb' : 'var(--text-secondary)',
                  flexShrink: 0,
                }}>
                  {dailySummary.streak_days ?? 0} Day Streak
                </span>
                <span style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  marginLeft: 'auto',
                  textAlign: 'right',
                  minWidth: 0,
                  lineHeight: 1.35,
                }}>
                  {dailySummary.streak_message}
                </span>
              </div>

              {/* Quest Board — same card, under streak (not a second glass-panel) */}
              {dailySummary.quest_enabled !== false && (
                <a
                  href="/quests"
                  style={{
                    display: 'block',
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: '1px solid rgba(245,158,11,0.35)',
                    textDecoration: 'none',
                    color: 'inherit',
                    minWidth: 0,
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 6,
                    minWidth: 0,
                  }}>
                    <span style={{ fontSize: 15, flexShrink: 0 }} aria-hidden>⚔️</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
                      Quest Board
                    </span>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--accent-color)',
                      marginLeft: 'auto',
                      flexShrink: 0,
                    }}>
                      Open →
                    </span>
                  </div>
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px 12px',
                    alignItems: 'center',
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}>
                    <span style={{ fontWeight: 700, color: '#f59e0b' }}>
                      ⭐ {dailySummary.quest_stars ?? 0} Stars
                    </span>
                    <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Lv.{dailySummary.quest_level ?? 1}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      today +{dailySummary.quest_daily_stars ?? 0}/{dailySummary.quest_daily_cap ?? 80}
                    </span>
                    {(dailySummary.freeze_tokens ?? 0) > 0 && (
                      <span style={{ color: 'var(--text-secondary)' }}>
                        🛡️ {dailySummary.freeze_tokens}
                      </span>
                    )}
                  </div>
                </a>
              )}
            </div>
          )}

          {/* Diagnostic prompt banner (Phase 7, Task 9.1) */}
          {recommendation?.recommendation_type === 'diagnostic_prompt' && (
            <div
              className="glass-panel animate-fade-in"
              role="alert"
              aria-label="Diagnostic assessment available"
              style={{
                padding: '16px 20px',
                background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(234,88,12,0.1))',
                border: '1px solid rgba(245,158,11,0.3)',
                textAlign: 'left',
                width: '100%',
              }}
            >
              <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>
                Take a diagnostic assessment
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                {recommendation.reason}
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <a
                  href={buildTodayHref({ subject: pickerValue.subject, year: pickerValue.year })}
                  style={{
                    padding: '8px 16px',
                    fontSize: '13px',
                    fontWeight: '600',
                    background: 'var(--accent-color, #3b82f6)',
                    color: '#fff',
                    borderRadius: '6px',
                    textDecoration: 'none',
                  }}
                >
                  Open today&apos;s diagnostic plan
                </a>
                <button
                  disabled={diagnosticDismissing}
                  onClick={async () => {
                    setDiagnosticDismissing(true);
                    try {
                      await diagnosticDismiss(pickerValue.subject, parseInt(pickerValue.year.replace('year', '')));
                      setRecommendation(null);
                      const rec = await fetchRecommend(pickerValue.subject, pickerValue.year);
                      setRecommendation(rec);
                    } catch {
                      showToast('Could not dismiss the diagnostic suggestion. Please try again.', 'error');
                    } finally {
                      setDiagnosticDismissing(false);
                    }
                  }}
                  style={{
                    padding: '8px 16px',
                    fontSize: '13px',
                    background: 'transparent',
                    border: '1px solid var(--border-color, #d1d5db)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  {diagnosticDismissing ? 'Saving…' : 'Skip for now'}
                </button>
              </div>
            </div>
          )}

          {noAuthoredContent && (
            <div
              role="status"
              className="glass-panel"
              style={{
                padding: '14px 18px',
                marginBottom: '12px',
                border: '1px solid rgba(245,158,11,0.35)',
                background: 'rgba(245,158,11,0.08)',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: 'var(--text-primary)' }}>No authored practice is available for this course scope yet.</strong>{' '}
              Choose another subject or year/unit. Your saved progress is unchanged.
              {pickerValue.subject === 'senior_english' && (
                <> <a href="/writing" style={{ color: 'var(--accent-color)', fontWeight: 700 }}>Open Writing Hub</a>.</>
              )}
            </div>
          )}

          <div className="curriculum-tree-desktop">
            <CurriculumTree 
              curriculum={filteredCurriculum} 
              activeTopic={activeTopic} 
              onSelectTopic={handleSelectTopic}
              loadError={loadError}
              onRetry={() => setCurriculumReloadNonce(value => value + 1)}
              masteredTopics={masteredTopics}
              recommendedTopicId={recommendation?.topic_id ?? recommendation?.topic}
            />
          </div>
          <div className="curriculum-tree-mobile">
            <ProgressiveDisclosure label="Choose topic manually" icon="📚">
              <CurriculumTree 
                curriculum={filteredCurriculum} 
                activeTopic={activeTopic} 
                onSelectTopic={handleSelectTopic}
                loadError={loadError}
                onRetry={() => setCurriculumReloadNonce(value => value + 1)}
                masteredTopics={masteredTopics}
                recommendedTopicId={recommendation?.topic_id ?? recommendation?.topic}
              />
            </ProgressiveDisclosure>
          </div>

          <div className="glass-panel" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '0' }} aria-label="Learning tools">
            <ProgressiveDisclosure label="Primary learning">
              {ENABLE_GUIDED_PRACTICE && (
                <a href="/guided-practice" style={navLinkStyle('#6366f1')}>
                  <span>🎯 Guided Practice Session</span>
                  <span style={navDescriptionStyle}>
                    Short coached sessions with hints and structured practice.
                  </span>
                </a>
              )}
              <a href="/writing" style={navLinkStyle('#0891b2')}>
                <span>✍️ Writing Lab</span>
                <span style={navDescriptionStyle}>Plan, draft, and get feedback on QLD-aligned writing tasks.</span>
              </a>
              <a href={scopedMistakesHref} style={navLinkStyle('#dc2626')}>
                <span>📋 Error Book</span>
                <span style={navDescriptionStyle}>Understand mistakes, retry independently, and complete follow-up review to close them.</span>
              </a>
            </ProgressiveDisclosure>

            <ProgressiveDisclosure label="Assessment practice">
              <a href="/diagnostic" style={navLinkStyle('#f59e0b')}>
                <span>🔍 Diagnostic</span>
                <span style={navDescriptionStyle}>Calibrate recommendations before choosing what to practise next.</span>
              </a>
              <a href="/exam" style={navLinkStyle('#d97706')}>
                <span>📝 Exam / Practice Set</span>
                <span style={navDescriptionStyle}>Generate a timed mixed paper for the selected subject and year.</span>
              </a>
              <a href={speedRoundHref} style={navLinkStyle('#ea580c')}>
                <span>⚡ Speed Round</span>
                <span style={navDescriptionStyle}>The separate Challenge tool: timed fluency practice for a topic.</span>
              </a>
            </ProgressiveDisclosure>

            <ProgressiveDisclosure label="Progress">
              <a href="/weekly-report" style={navLinkStyle('#4f46e5')}>
                <span>📖 My Weekly Review</span>
                <span style={navDescriptionStyle}>See this week’s bright spot, one focus, and your next learning step.</span>
              </a>
              <a href="/dashboard" style={navLinkStyle('var(--accent-color)')}>
                <span>📊 Learning Analytics</span>
                <span style={navDescriptionStyle}>See mastery, topic progress, and patterns over time.</span>
              </a>
            </ProgressiveDisclosure>

            <MoreToolsPanel
              year={pickerValue.year}
              subject={pickerValue.subject}
              topicId={activeTopic}
            />

            <ProgressiveDisclosure label="For parents">
              <a href="/parent" style={navLinkStyle('#a78bfa', false)}>
                <span>👨‍👩‍👧 Parent Dashboard</span>
                <span style={navDescriptionStyle}>Daily goals, next steps, student management, and review tools.</span>
              </a>
            </ProgressiveDisclosure>
          </div>
        </aside>
        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-label="Resize study navigation"
          aria-orientation="vertical"
          aria-valuemin={260}
          aria-valuemax={500}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onMouseDown={handleMouseDown}
          onKeyDown={handleSidebarResizeKeyDown}
        />
        <TutorInterface 
          key={`${pickerValue.subject}:${pickerValue.year}:${activeTopic}`}
          topic={activeTopic} 
          topicName={activeTopicName}
          subject={pickerValue.subject}
          labLink={topicLabLink}
          exercises={exercises}
          loadingExercises={loadingExercises}
          exerciseLoadError={exerciseLoadError}
          onRetryExercises={() => setExerciseReloadNonce(value => value + 1)}
          onMarkSuccess={handleMarkSuccess}
          initialQuestionId={currentSearchParams.get('question')}
          revisionTopic={recommendation?.recommendation_type === 'revision' ? {
            topic_id: recommendation.topic_id,
            name: recommendation.name,
            reason: recommendation.reason,
            strand: findTopicInCurriculum(curriculum, recommendation.topic_id)?.strand,
          } : null}
          onGoToTopic={handleGoToRecommended}
          yearLevel={pickerValue.year.startsWith('unit') ? undefined : parseInt(pickerValue.year.replace('year', '')) || undefined}
          unit={pickerValue.year.startsWith('unit') ? parseInt(pickerValue.year.replace('unit', '')) || undefined : undefined}
        />
      </div>
    </>
  );
}
