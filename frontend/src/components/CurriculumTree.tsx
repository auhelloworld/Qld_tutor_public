'use client';
import { useEffect, useState } from 'react';
import { ChevronRight, GraduationCap } from 'lucide-react';
import {
  topicLabelParts,
  groupKey,
  isTopicEntry,
  type CurriculumTopic as TopicEntry,
  type Curriculum,
} from '../lib/curriculum_helpers';
import { getLearningGroup, getLearningGroupOrder, getLearningTags } from '../lib/learning_groups';
import { ENABLE_LEARNING_MAP } from '../lib/feature-flags';
import { getNavView, setNavView, type NavView } from '../lib/preferences';

export default function CurriculumTree({
  curriculum,
  activeTopic,
  onSelectTopic,
  loadError = false,
  masteredTopics = new Set<string>(),
  recommendedTopicId,
  onRetry,
}: {
  curriculum: Curriculum | null;
  activeTopic: string;
  onSelectTopic: (topic: string) => void;
  loadError?: boolean;
  masteredTopics?: Set<string>;
  recommendedTopicId?: string;
  onRetry?: () => void;
}) {
  // Default to Learning Map; hydrate the saved choice after mount to avoid
  // SSR/client hydration mismatch.
  const [view, setView] = useState<NavView>('learning');
  useEffect(() => {
    if (ENABLE_LEARNING_MAP) setView(getNavView());
  }, []);

  const changeView = (next: NavView) => {
    setView(next);
    setNavView(next);
  };

  if (loadError) {
    return (
      <div className="glass-panel" role="status" style={{ width: '100%', padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>We could not load the curriculum</div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Check the connection, then try again. Your saved progress has not been changed.
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="btn-primary"
            style={{ marginTop: '14px', padding: '9px 16px', fontSize: '13px', fontWeight: 700 }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!curriculum) {
    return <div className="glass-panel" style={{ width: '100%', padding: '20px' }}>Loading curriculum...</div>;
  }

  const learningMode = ENABLE_LEARNING_MAP && view === 'learning';

  return (
    <div className="glass-panel" style={{ width: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <GraduationCap size={20} color="var(--accent-color)" />
          {learningMode ? 'Learning Map' : 'QLD Curriculum'}
        </h2>
        {ENABLE_LEARNING_MAP && (
          <div role="group" aria-label="Curriculum view" style={{ display: 'flex', gap: '4px', marginTop: '10px' }}>
            <button
              onClick={() => changeView('learning')}
              aria-pressed={view === 'learning'}
              style={viewToggleStyle(view === 'learning')}
            >
              Learning map
            </button>
            <button
              onClick={() => changeView('strands')}
              aria-pressed={view === 'strands'}
              style={viewToggleStyle(view === 'strands')}
            >
              Curriculum strands
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {Object.entries(curriculum).map(([subject, years]: [string, any]) => (
          <div key={subject}>
            {Object.entries(years || {}).map(([yearKey, yearData]: [string, any]) => {
              // Guard: filtered/scoped props can briefly pass undefined year slices
              // (e.g. Error Book → Practice with subject/year query mismatch).
              if (!yearData || typeof yearData !== 'object') return null;

              // Canonical study order within a group (topic_id sequence array).
              const sequence: string[] = Array.isArray(yearData?.sequence) ? yearData.sequence : [];
              const seqIndex = (key: string) => {
                const i = sequence.indexOf(key);
                return i === -1 ? Number.MAX_SAFE_INTEGER : i;
              };

              const groups: Record<string, Array<{ key: string; topic: TopicEntry; order: number }>> = {};
              let insertion = 0;
              for (const [key, value] of Object.entries(yearData)) {
                if (!isTopicEntry(key, value)) continue;
                const topic = value as TopicEntry;
                const gk = learningMode
                  ? (getLearningGroup(topic, subject, yearKey) ?? groupKey(topic))
                  : groupKey(topic);
                if (!groups[gk]) groups[gk] = [];
                groups[gk].push({ key, topic, order: insertion++ });
              }

              const order = learningMode ? getLearningGroupOrder(subject, yearKey) : [];
              const groupNames = Object.keys(groups).sort((a, b) => {
                const ia = order.indexOf(a);
                const ib = order.indexOf(b);
                if (ia !== -1 && ib !== -1) return ia - ib;
                if (ia !== -1) return -1;
                if (ib !== -1) return 1;
                return a.localeCompare(b);
              });
              if (groupNames.length === 0) return null;

              // Order topics within each group by curriculum sequence, then stable insertion.
              for (const g of groupNames) {
                groups[g].sort((a, b) => {
                  const sa = seqIndex(a.key);
                  const sb = seqIndex(b.key);
                  if (sa !== sb) return sa - sb;
                  return a.order - b.order;
                });
              }

              return (
                <div key={yearKey}>
                  {groupNames.map((gName) => {
                    const hasActive = groups[gName].some(({ key }) => key === activeTopic);
                    const masteredCount = groups[gName].filter(({ key }) => masteredTopics.has(key)).length;
                    return (
                      <details key={gName} open={hasActive}>
                        <summary style={{
                          padding: '8px 12px',
                          fontSize: '14px',
                          color: 'var(--text-primary)',
                          fontWeight: '600',
                          cursor: 'pointer',
                          listStyle: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          borderRadius: '6px',
                          userSelect: 'none',
                        }}>
                          <span style={{ fontSize: '10px', transition: 'transform 0.2s' }}>▶</span>
                          {gName}
                          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {masteredCount > 0 && (
                              <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: '700' }}>
                                {masteredCount}✓
                              </span>
                            )}
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                              {groups[gName].length}
                            </span>
                          </span>
                        </summary>

                        {groups[gName].map(({ key, topic }) => {
                          const isActive = activeTopic === key;
                          const isMastered = masteredTopics.has(key);
                          const isRecommended = !!recommendedTopicId && key === recommendedTopicId && !isMastered;
                          const { primary, secondary, code } = topicLabelParts(topic, key);
                          const tags = learningMode ? getLearningTags(topic, subject) : [];
                          return (
                            <button
                              key={key}
                              onClick={() => onSelectTopic(key)}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                justifyContent: 'space-between',
                                gap: '8px',
                                padding: '8px 14px 8px 36px',
                                background: isActive ? 'rgba(59, 130, 246, 0.1)' : isMastered ? 'rgba(34,197,94,0.04)' : 'transparent',
                                border: isActive ? '1px solid var(--accent-color)' : '1px solid transparent',
                                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                                borderRadius: '6px',
                                textAlign: 'left',
                                width: '100%',
                                cursor: 'pointer',
                                fontSize: '13px',
                              }}
                            >
                              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                  <span style={{
                                    fontWeight: isActive ? '700' : '600',
                                    color: 'var(--text-primary)',
                                    overflowWrap: 'break-word',
                                    wordBreak: 'break-word',
                                  }}>
                                    {primary}
                                  </span>
                                  {isRecommended && (
                                    <span style={{
                                      fontSize: '9.5px', fontWeight: '700', color: 'var(--accent-color)',
                                      background: 'rgba(59,130,246,0.14)', borderRadius: '999px', padding: '1px 7px',
                                      whiteSpace: 'nowrap',
                                    }}>
                                      ★ Recommended next
                                    </span>
                                  )}
                                </span>
                                {secondary && (
                                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                    {secondary}
                                  </span>
                                )}
                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                  {code && (
                                    <span style={{
                                      fontSize: '9.5px', fontFamily: 'monospace', color: 'var(--text-secondary)', opacity: 0.7,
                                    }}>
                                      {code}
                                    </span>
                                  )}
                                  {tags.map((t) => (
                                    <span key={t} style={{
                                      fontSize: '9.5px', color: 'var(--text-secondary)',
                                      background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
                                      borderRadius: '4px', padding: '0 5px',
                                    }}>
                                      {t}
                                    </span>
                                  ))}
                                </span>
                              </span>
                              {isMastered ? (
                                <span title="Mastered" style={{ fontSize: '12px', color: '#16a34a', flexShrink: 0, marginTop: '2px' }}>✓</span>
                              ) : (
                                <ChevronRight size={12} color={isActive ? 'var(--accent-color)' : 'var(--text-secondary)'} style={{ flexShrink: 0, marginTop: '2px' }} />
                              )}
                            </button>
                          );
                        })}
                      </details>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function viewToggleStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '5px 8px',
    fontSize: '11.5px',
    fontWeight: 700,
    cursor: 'pointer',
    borderRadius: '6px',
    border: active ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
    background: active ? 'rgba(59,130,246,0.12)' : 'transparent',
    color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
  };
}
