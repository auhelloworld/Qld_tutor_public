'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import BackToPracticeLink from '../../components/BackToPracticeLink';

import ExplorerTab from '../../components/lab/ExplorerTab';
import LabDirectory from '../../components/lab/LabDirectory';
import { LAB_ACTIVITIES, getActivitiesForTab, LAB_TAB_LABELS, type LabTab, type LabActivityId } from '../../lib/lab-activities';
import { getCompletedActivityIds, markActivityCompleted } from '../../lib/lab-storage';

const labTabLoading = () => (
  <div role="status" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
    Loading interactive tools…
  </div>
);
const AdvancedMathTab = dynamic(() => import('../../components/lab/AdvancedMathTab'), { loading: labTabLoading });
const GeometryTab = dynamic(() => import('../../components/lab/GeometryTab'), { loading: labTabLoading });
const StatisticsTab = dynamic(() => import('../../components/lab/StatisticsTab'), { loading: labTabLoading });
const LinearAlgebraTab = dynamic(() => import('../../components/lab/LinearAlgebraTab'), { loading: labTabLoading });

type TabType = LabTab;
type ViewMode = 'directory' | 'explore' | 'learn';
type CourseContext = {
  subject?: string;
  year?: string;
  topic?: string;
};

export default function MathLabPage() {
  const [activeTab, setActiveTab] = useState<TabType>('explorer');
  const [viewMode, setViewMode] = useState<ViewMode>('directory');
  const [labPreset, setLabPreset] = useState<string>('');
  const [isExact, setIsExact] = useState<boolean>(true);
  const [mafsHeight, setMafsHeight] = useState(600);
  const [activeActivity, setActiveActivity] = useState<LabActivityId | null>(null);
  const [completedActivities, setCompletedActivities] = useState<Set<string>>(new Set());
  const [courseContext, setCourseContext] = useState<CourseContext>({});

  // Load completion state and URL params on mount
  useEffect(() => {
    setCompletedActivities(getCompletedActivityIds());

    const params = new URLSearchParams(window.location.search);
    const preset = params.get('preset') || '';
    const tab = params.get('tab') as TabType | null;
    const mode = params.get('mode') as ViewMode | null;
    const activity = params.get('activity') as LabActivityId | null;
    const unit = params.get('unit');
    setCourseContext({
      subject: params.get('subject') || undefined,
      year: params.get('year') || (unit ? `unit${unit}` : undefined),
      topic: params.get('topic') || undefined,
    });

    // Legacy preset routing
    if (preset) {
      setLabPreset(preset);
      setViewMode('explore');
      if (preset === 'quadratic_vertex') setActiveTab('sandbox');
      if (preset === 'derivative_tangent' || preset === 'riemann_area') setActiveTab('calculus');
      return;
    }

    // URL param routing
    if (mode === 'learn' && activity && LAB_ACTIVITIES[activity]) {
      setActiveTab(LAB_ACTIVITIES[activity].tab);
      setViewMode('learn');
      setActiveActivity(activity);
    } else if (mode === 'explore' && activity && LAB_ACTIVITIES[activity]) {
      // Deep link with mode=explore + activity restores the tab's explore view
      // with the activity preserved so each tab component can sync to the target scene
      setActiveTab(LAB_ACTIVITIES[activity].tab);
      setViewMode('explore');
      setActiveActivity(activity);
    } else if (tab && ['explorer', 'sandbox', 'calculus', 'geometry', 'statistics', 'linear-algebra'].includes(tab)) {
      setActiveTab(tab);
      if (mode === 'explore') {
        setViewMode('explore');
      }
    }
  }, []);

  // Responsive canvas sizing
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w < 768) setMafsHeight(Math.max(236, Math.min(320, w - 64)));
      else if (w < 1200) setMafsHeight(552);
      else setMafsHeight(720);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Update URL when view changes (without page reload), retaining the course
  // context so students can return to the exact topic they came from.
  const updateUrl = useCallback((tab: TabType, mode: ViewMode, activityId?: LabActivityId) => {
    const params = new URLSearchParams();
    if (mode !== 'directory') {
      params.set('tab', tab);
      params.set('mode', mode);
      if (activityId) {
        params.set('activity', activityId);
      }
    }
    if (courseContext.subject) params.set('subject', courseContext.subject);
    if (courseContext.year) params.set('year', courseContext.year);
    if (courseContext.topic) params.set('topic', courseContext.topic);
    const search = params.toString();
    const url = search ? `${window.location.pathname}?${search}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [courseContext]);

  const handleDirectorySelect = useCallback(
    (tab: TabType, mode: 'explore' | 'learn', activityId?: LabActivityId) => {
      setActiveTab(tab);
      setViewMode(mode);
      setActiveActivity(activityId || null);
      setLabPreset('');
      updateUrl(tab, mode, activityId);
    },
    [updateUrl]
  );

  const handleTabChange = useCallback(
    (tab: TabType) => {
      setActiveTab(tab);
      if (viewMode === 'learn') {
        const nextActivity = getActivitiesForTab(tab)[0];
        if (nextActivity) {
          setActiveActivity(nextActivity.id);
          updateUrl(tab, 'learn', nextActivity.id);
          return;
        }
      }
      setActiveActivity(null);
      setViewMode('explore');
      updateUrl(tab, 'explore');
    },
    [viewMode, updateUrl]
  );

  const handleModeChange = useCallback(
    (mode: 'explore' | 'learn') => {
      if (mode === 'explore') {
        setViewMode('explore');
        setActiveActivity(null);
        updateUrl(activeTab, 'explore');
        return;
      }
      const nextActivity = getActivitiesForTab(activeTab)[0];
      if (nextActivity) {
        setViewMode('learn');
        setActiveActivity(nextActivity.id);
        updateUrl(activeTab, 'learn', nextActivity.id);
      }
    },
    [activeTab, updateUrl]
  );

  const handleActivityComplete = useCallback(
    (activityId: string, success: boolean) => {
      // A failed run is complete for feedback purposes, but must not appear as
      // a completed activity in the directory. Only an all-core-correct run
      // earns the persistent completion marker.
      if (!success) return;
      markActivityCompleted(activityId);
      setCompletedActivities(getCompletedActivityIds());
    },
    []
  );

  const handleExitLearn = useCallback(() => {
    setViewMode('directory');
    setActiveActivity(null);
    updateUrl(activeTab, 'directory');
  }, [activeTab, updateUrl]);

  const wrapperRef = useRef<HTMLDivElement>(null);

  // Show directory view
  if (viewMode === 'directory') {
    return (
      <div
        aria-label="Interactive mathematics laboratory"
        style={{
          minHeight: '100vh',
          color: 'var(--text-primary)',
          padding: 'clamp(20px, 5vw, 40px) clamp(12px, 4vw, 24px)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div className="lab-page-content" style={{ maxWidth: '1400px', margin: '0 auto' }}>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '32px',
              flexWrap: 'wrap',
              gap: '16px',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                <span
                  style={{
                    background: 'rgba(99,102,241,0.15)',
                    color: 'var(--accent-color)',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: '700',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                  }}
                >
                  Interactive Lab
                </span>
              </div>
              <h1
                style={{
                  fontSize: '32px',
                  fontWeight: '850',
                  background: 'linear-gradient(to right, var(--text-primary), var(--text-muted))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  margin: 0,
                }}
              >
                Mathematics Lab
              </h1>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                Choose a guided learning activity or explore freely.
              </p>
            </div>
            <BackToPracticeLink {...courseContext}>
              {courseContext.topic ? '← Back to this topic' : '← Back to Practice'}
            </BackToPracticeLink>
          </div>

          <LabDirectory
            onSelect={handleDirectorySelect}
            completedActivities={completedActivities}
          />
        </div>
      </div>
    );
  }

  // Explore or Learn view
  return (
    <div
      aria-label="Interactive mathematics laboratory"
      style={{
        minHeight: '100vh',
        color: 'var(--text-primary)',
        padding: 'clamp(20px, 5vw, 40px) clamp(12px, 4vw, 24px)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div className="lab-page-content" style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '32px',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <span
                style={{
                  background: 'rgba(99,102,241,0.15)',
                  color: 'var(--accent-color)',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: '700',
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                }}
              >
                Interactive Lab
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
              <h1
                style={{
                  fontSize: '32px',
                  fontWeight: '850',
                  background: 'linear-gradient(to right, var(--text-primary), var(--text-muted))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  margin: 0,
                }}
              >
                Mathematics Lab
              </h1>
            </div>
            {viewMode === 'learn' && activeActivity && (
              <p style={{ margin: '8px 0 0', fontSize: '14px', fontWeight: 700, color: 'var(--accent-color)' }}>
                Learning activity: {LAB_ACTIVITIES[activeActivity].title}
              </p>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--bg-secondary)',
                padding: '6px 12px',
                borderRadius: '8px',
                width: 'fit-content',
                border: '1px solid var(--border-color)',
                marginTop: '12px',
              }}
            >
              <span id="format-label" style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>Format:</span>
              <div role="group" aria-labelledby="format-label" style={{ display: 'inline-flex', gap: '2px' }}>
                <button
                onClick={() => setIsExact(true)}
                aria-pressed={isExact}
                aria-describedby="format-label"
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: '700',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer',
                  background: isExact ? 'var(--accent-color)' : 'transparent',
                  color: isExact ? 'white' : 'var(--text-secondary)',
                }}
              >
                Exact
              </button>
              <button
                onClick={() => setIsExact(false)}
                aria-pressed={!isExact}
                aria-describedby="format-label"
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: '700',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer',
                  background: !isExact ? 'var(--accent-color)' : 'transparent',
                  color: !isExact ? 'white' : 'var(--text-secondary)',
                }}
              >
                Decimal
              </button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div
              role="group"
              aria-label="Lab mode"
              style={{ display: 'inline-flex', padding: '3px', border: '1px solid var(--border-color)', borderRadius: '9px', background: 'var(--bg-secondary)' }}
            >
              <button
                type="button"
                aria-pressed={viewMode === 'explore'}
                onClick={() => handleModeChange('explore')}
                style={{ padding: '6px 10px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, background: viewMode === 'explore' ? 'var(--accent-color)' : 'transparent', color: viewMode === 'explore' ? 'white' : 'var(--text-secondary)' }}
              >
                Explore
              </button>
              <button
                type="button"
                aria-pressed={viewMode === 'learn'}
                onClick={() => handleModeChange('learn')}
                style={{ padding: '6px 10px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, background: viewMode === 'learn' ? 'var(--accent-color)' : 'transparent', color: viewMode === 'learn' ? 'white' : 'var(--text-secondary)' }}
              >
                Learn
              </button>
            </div>
            <button
              onClick={handleExitLearn}
              style={{
                padding: '8px 14px',
                fontSize: '13px',
                fontWeight: '600',
                borderRadius: '8px',
                cursor: 'pointer',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
              }}
            >
              ← Activities
            </button>
            <BackToPracticeLink {...courseContext}>
              {courseContext.topic ? '← Back to this topic' : '← Back to Practice'}
            </BackToPracticeLink>
          </div>
        </div>

        {/* Tab Controls with ARIA tablist */}
        <div
          className="lab-tablist"
          role="tablist"
          aria-label="Mathematics lab tools"
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '32px',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '12px',
            flexWrap: 'nowrap',
            overflowX: 'auto',
            scrollbarWidth: 'thin',
          }}
        >
          {([
            { id: 'explorer' as const, icon: '📍' },
            { id: 'sandbox' as const, icon: '📈' },
            { id: 'calculus' as const, icon: '∫' },
            { id: 'geometry' as const, icon: '📐' },
            { id: 'statistics' as const, icon: '📊' },
            { id: 'linear-algebra' as const, icon: '🧮' },
          ] as const).map((tab, index, tabs) => (
            <button
              key={tab.id}
              role="tab"
              tabIndex={activeTab === tab.id ? 0 : -1}
              aria-selected={activeTab === tab.id}
              aria-controls={`lab-tabpanel-${tab.id}`}
              id={`lab-tab-${tab.id}`}
              onClick={() => handleTabChange(tab.id)}
              onKeyDown={(event) => {
                let nextIndex: number | null = null;
                if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
                if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = tabs.length - 1;
                if (nextIndex === null) return;
                event.preventDefault();
                const nextTab = tabs[nextIndex];
                handleTabChange(nextTab.id);
                window.requestAnimationFrame(() => document.getElementById(`lab-tab-${nextTab.id}`)?.focus());
              }}
              style={{
                flex: '0 0 auto',
                padding: '10px 18px',
                fontSize: '14px',
                fontWeight: '700',
                borderRadius: '8px',
                cursor: 'pointer',
                border: 'none',
                background: activeTab === tab.id ? 'var(--accent-color)' : 'transparent',
                color: activeTab === tab.id ? 'white' : 'var(--text-secondary)',
                transition: 'all 0.2s',
              }}
            >
              {tab.icon} {LAB_TAB_LABELS[tab.id]}
            </button>
          ))}
        </div>

        {/* Tab Content Panel Container */}
        <div
          ref={wrapperRef}
          role="tabpanel"
          id={`lab-tabpanel-${activeTab}`}
          aria-labelledby={`lab-tab-${activeTab}`}
        >
          {activeTab === 'explorer' && (
            <ExplorerTab
              isExact={isExact}
              mafsHeight={mafsHeight}
              mode={viewMode === 'learn' ? 'learn' : 'explore'}
              activityId={activeActivity || undefined}
              onActivityComplete={handleActivityComplete}
              onExitLearn={handleExitLearn}
            />
          )}
          {(activeTab === 'sandbox' || activeTab === 'calculus') && (
            <AdvancedMathTab
              tab={activeTab}
              isExact={isExact}
              mafsHeight={mafsHeight}
              preset={labPreset}
              mode={viewMode === 'learn' ? 'learn' : 'explore'}
              activityId={activeActivity || undefined}
              onActivityComplete={handleActivityComplete}
              onExitLearn={handleExitLearn}
            />
          )}
          {activeTab === 'geometry' && (
            <GeometryTab
              isExact={isExact}
              mafsHeight={mafsHeight}
              mode={viewMode === 'learn' ? 'learn' : 'explore'}
              activityId={activeActivity || undefined}
              onActivityComplete={handleActivityComplete}
              onExitLearn={handleExitLearn}
            />
          )}
          {activeTab === 'statistics' && (
            <StatisticsTab
              isExact={isExact}
              mafsHeight={mafsHeight}
              mode={viewMode === 'learn' ? 'learn' : 'explore'}
              activityId={activeActivity || undefined}
              onActivityComplete={handleActivityComplete}
              onExitLearn={handleExitLearn}
            />
          )}
          {activeTab === 'linear-algebra' && (
            <LinearAlgebraTab
              isExact={isExact}
              mafsHeight={mafsHeight}
              mode={viewMode === 'learn' ? 'learn' : 'explore'}
              activityId={activeActivity || undefined}
              onActivityComplete={handleActivityComplete}
              onExitLearn={handleExitLearn}
            />
          )}
        </div>
      </div>
    </div>
  );
}
