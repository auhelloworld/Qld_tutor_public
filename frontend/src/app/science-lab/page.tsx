'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import BackToPracticeLink from '../../components/BackToPracticeLink';
import ScienceLabDirectory from '../../components/science-lab/ScienceLabDirectory';
import ScienceLearnPanel from '../../components/science-lab/ScienceLearnPanel';
import ObservationPanel from '../../components/science-lab/controls/ObservationPanel';
import { SCIENCE_ACTIVITIES } from '../../lib/science-lab/activities';
import { SCIENCE_RENDERERS } from '../../lib/science-lab/renderer-registry';
import type { SceneComponent } from '../../lib/science-lab/renderer-registry';
import {
  buildScienceTransferPracticeHref,
  resolveScienceTransferTopic,
  withScienceSelectionYear,
  type ScienceLabCourseContext,
} from '../../lib/science-lab/topic-links';
import type {
  ObservationReadouts,
  ScienceActivityId,
  ScienceSceneData,
} from '../../lib/science-lab/activity-types';

const sceneLoading = () => (
  <div role="status" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
    Loading interactive science simulation…
  </div>
);

type SceneKind = ScienceSceneData['kind'];

/**
 * Scene components are derived from the renderer registry, so the registry is
 * the single source of truth for lazy loading. Building the map once at module
 * scope keeps each `dynamic()` component stable across renders (creating them
 * during render would remount the scene on every state change).
 */
const SCENE_COMPONENTS: Record<SceneKind, SceneComponent> = Object.fromEntries(
  (Object.keys(SCIENCE_RENDERERS) as SceneKind[]).map((kind) => [
    kind,
    dynamic(SCIENCE_RENDERERS[kind] as () => Promise<{ default: SceneComponent }>, {
      loading: sceneLoading,
      ssr: false,
    }),
  ]),
) as Record<SceneKind, SceneComponent>;

type ViewMode = 'directory' | 'explore' | 'learn';

export default function ScienceLabPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('directory');
  const [activeActivityId, setActiveActivityId] = useState<ScienceActivityId | null>(null);
  const [courseContext, setCourseContext] = useState<ScienceLabCourseContext>({});
  const [readouts, setReadouts] = useState<ObservationReadouts>({});
  const [isRevealed, setIsRevealed] = useState(false);

  // Sync with URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const activityParam = params.get('activity') as ScienceActivityId | null;
    const modeParam = params.get('mode') as ViewMode | null;

    setCourseContext({
      subject: params.get('subject') || undefined,
      year: params.get('year') || undefined,
      topic: params.get('topic') || undefined,
    });

    if (activityParam && SCIENCE_ACTIVITIES[activityParam]) {
      setActiveActivityId(activityParam);
      setViewMode(modeParam === 'explore' ? 'explore' : 'learn');
    } else {
      setViewMode('directory');
      setActiveActivityId(null);
    }
  }, []);

  const updateUrl = useCallback(
    (
      mode: ViewMode,
      activityId: ScienceActivityId | null | undefined,
      context: ScienceLabCourseContext,
    ) => {
      const params = new URLSearchParams();
      if (mode !== 'directory' && activityId) {
        params.set('activity', activityId);
        params.set('mode', mode);
      }
      if (context.subject) params.set('subject', context.subject);
      if (context.year) params.set('year', context.year);
      if (context.topic) params.set('topic', context.topic);

      const search = params.toString();
      const url = search ? `${window.location.pathname}?${search}` : window.location.pathname;
      window.history.replaceState(null, '', url);
    },
    [],
  );

  const handleSelectActivity = useCallback(
    (id: ScienceActivityId, mode: 'learn' | 'explore', selectedYear?: number) => {
      // Resolve and write the context from this callback invocation rather than
      // waiting for React state, so transfer never observes a stale year/topic.
      const nextCourseContext = withScienceSelectionYear(courseContext, selectedYear);
      setCourseContext(nextCourseContext);
      updateUrl(mode, id, nextCourseContext);
      setActiveActivityId(id);
      setViewMode(mode);
      setIsRevealed(false);
      setReadouts({});
    },
    [courseContext, updateUrl],
  );

  const handleExitToDirectory = useCallback(() => {
    setViewMode('directory');
    setActiveActivityId(null);
    setIsRevealed(false);
    updateUrl('directory', null, courseContext);
  }, [courseContext, updateUrl]);

  const activeActivity = activeActivityId ? SCIENCE_ACTIVITIES[activeActivityId] : null;
  const transferTopic = useMemo(
    () => activeActivity
      ? resolveScienceTransferTopic(activeActivity, courseContext)
      : undefined,
    [activeActivity, courseContext],
  );
  const transferActivity = useMemo(() => {
    if (!activeActivity || !transferTopic || activeActivity.transferTopicIds[0] === transferTopic) {
      return activeActivity;
    }

    return {
      ...activeActivity,
      transferTopicIds: [
        transferTopic,
        ...activeActivity.transferTopicIds.filter(
          (topicId) => topicId.toUpperCase() !== transferTopic.toUpperCase(),
        ),
      ],
    };
  }, [activeActivity, transferTopic]);

  const handleTransfer = useCallback(() => {
    if (!transferTopic) return;
    window.location.href = buildScienceTransferPracticeHref(transferTopic);
  }, [transferTopic]);

  /**
   * Exactly one scene component is mounted at a time, resolved through the
   * renderer registry rather than a hand-maintained branch per scene kind.
   */
  const ActiveScene: SceneComponent | null = useMemo(() => {
    if (!activeActivity) return null;
    return SCENE_COMPONENTS[activeActivity.sceneData.kind] ?? null;
  }, [activeActivity]);

  return (
    <div
      aria-label="Interactive science laboratory"
      style={{
        minHeight: '100vh',
        color: 'var(--text-primary)',
        padding: 'clamp(20px, 5vw, 40px) clamp(12px, 4vw, 24px)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ maxWidth: '1400px', margin: '0 auto', minWidth: 0 }}>
        {viewMode === 'directory' || !activeActivity || !ActiveScene ? (
          <ScienceLabDirectory onSelectActivity={handleSelectActivity} courseContext={courseContext} />
        ) : (
          <div style={{ minWidth: 0 }}>
            {/* Top Navigation Bar */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '24px',
                flexWrap: 'wrap',
                gap: '16px',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      background: 'rgba(16,185,129,0.15)',
                      color: '#10b981',
                      padding: '4px 10px',
                      borderRadius: '16px',
                      fontSize: '11px',
                      fontWeight: '700',
                      textTransform: 'uppercase',
                    }}
                  >
                    {activeActivity.strand}
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Years {activeActivity.yearLevels.join(', ')}
                  </span>
                </div>
                <h1 style={{ fontSize: 'clamp(19px, 4vw, 26px)', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  {activeActivity.title}
                </h1>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div
                  role="group"
                  aria-label="Lab mode switcher"
                  style={{
                    display: 'inline-flex',
                    padding: '3px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    background: 'var(--bg-secondary)',
                  }}
                >
                  <button
                    type="button"
                    aria-pressed={viewMode === 'learn'}
                    onClick={() => {
                      setViewMode('learn');
                      updateUrl('learn', activeActivityId, courseContext);
                    }}
                    style={{
                      padding: '6px 12px',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '12px',
                      background: viewMode === 'learn' ? 'var(--accent-color, #10b981)' : 'transparent',
                      color: viewMode === 'learn' ? '#fff' : 'var(--text-secondary)',
                    }}
                  >
                    📖 Learn (Inquiry)
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewMode === 'explore'}
                    onClick={() => {
                      setViewMode('explore');
                      updateUrl('explore', activeActivityId, courseContext);
                    }}
                    style={{
                      padding: '6px 12px',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '12px',
                      background: viewMode === 'explore' ? 'var(--accent-color, #10b981)' : 'transparent',
                      color: viewMode === 'explore' ? '#fff' : 'var(--text-secondary)',
                    }}
                  >
                    🧪 Explore Sandbox
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleExitToDirectory}
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
                  ← All Labs
                </button>

                <BackToPracticeLink {...courseContext}>
                  {courseContext.topic ? '← Back to this topic' : '← Back to Practice'}
                </BackToPracticeLink>
              </div>
            </div>

            {/* Active Scene & Inquiry Workflow. Exactly one renderer is mounted. */}
            {viewMode === 'learn' ? (
              <div className="science-lab-learn-grid">
                <div>
                  <ScienceLearnPanel
                    activity={transferActivity ?? activeActivity}
                    readouts={readouts}
                    onTransfer={handleTransfer}
                    onRevealChange={setIsRevealed}
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <ActiveScene
                    sceneData={activeActivity.sceneData}
                    onReadoutChange={setReadouts}
                    mode="learn"
                    isRevealed={isRevealed}
                  />
                </div>
              </div>
            ) : (
              /* Explore Sandbox: free manipulation, all readouts visible. */
              <div style={{ minWidth: 0 }}>
                <ActiveScene
                  sceneData={activeActivity.sceneData}
                  onReadoutChange={setReadouts}
                  mode="explore"
                  isRevealed
                />
                <ObservationPanel
                  observation={activeActivity.observation}
                  readouts={readouts}
                  isUnlocked
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
