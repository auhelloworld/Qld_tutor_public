'use client';

import React, { useState, useEffect } from 'react';
import { SCIENCE_ACTIVITIES } from '../../lib/science-lab/activities';
import { SCIENCE_STRANDS, SCIENCE_YEAR_LEVELS } from '../../lib/science-lab/curriculum-map';
import { getCompletedScienceActivityIds } from '../../lib/science-lab/completion';
import type { ScienceActivityId } from '../../lib/science-lab/activity-types';
import BackToPracticeLink from '../BackToPracticeLink';

export type ScienceLabCourseContext = {
  subject?: string;
  year?: string;
  topic?: string;
};

export type ScienceLabActivitySelectionHandler = (
  activityId: ScienceActivityId,
  mode: 'learn' | 'explore',
  selectedYear?: number,
) => void;

export interface ScienceLabDirectoryProps {
  onSelectActivity: ScienceLabActivitySelectionHandler;
  initialYear?: number;
  initialStrand?: string;
  courseContext?: ScienceLabCourseContext;
}

function hasPartialCoverageNote(modelLimitations: string[]): boolean {
  return modelLimitations.some((note) => (
    /partial curriculum coverage|curriculum coverage|coverage is limited|coverage is restricted/i.test(note)
  ));
}

export default function ScienceLabDirectory({
  onSelectActivity,
  initialYear,
  initialStrand,
  courseContext,
}: ScienceLabDirectoryProps) {
  const [selectedYear, setSelectedYear] = useState<number | 'all'>(initialYear ?? 'all');
  const [selectedStrand, setSelectedStrand] = useState<string>(initialStrand ?? 'all');
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCompletedIds(getCompletedScienceActivityIds());
  }, []);

  const allActivities = Object.values(SCIENCE_ACTIVITIES);

  const filteredActivities = allActivities.filter((act) => {
    if (selectedYear !== 'all' && !act.yearLevels.includes(selectedYear)) {
      return false;
    }
    if (selectedStrand !== 'all' && act.strand !== selectedStrand) {
      return false;
    }
    return true;
  });

  const totalCompleted = allActivities.filter((act) => completedIds.has(act.id)).length;
  const filtersAreActive = selectedYear !== 'all' || selectedStrand !== 'all';
  const clearFilters = () => {
    setSelectedYear('all');
    setSelectedStrand('all');
  };

  return (
    <div className="science-lab-directory" style={{ maxWidth: '1200px', margin: '0 auto', padding: '16px' }}>
      {/* Header Banner */}
      <div
        className="glass-panel"
        style={{
          padding: '24px',
          borderRadius: '16px',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          marginBottom: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span aria-hidden="true" style={{ fontSize: '24px' }}>🔬</span>
            <h1 style={{ fontSize: '24px', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
              Interactive Science Lab
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>
            Investigate scientific phenomena through real-time variables, counterfactual tests, and quantitative inquiry models.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div
            style={{
              padding: '10px 18px',
              borderRadius: '12px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Completed Labs
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--accent-color, #10b981)' }}>
                {totalCompleted} / {allActivities.length}
              </div>
            </div>
            <span aria-hidden="true" style={{ fontSize: '24px' }}>🏆</span>
          </div>

          <BackToPracticeLink {...courseContext}>
            {courseContext?.topic ? '← Back to this topic' : '← Back to Practice'}
          </BackToPracticeLink>
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div
          role="group"
          aria-labelledby="science-year-filter-label"
          style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
        >
          <span
            id="science-year-filter-label"
            style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', minWidth: '60px' }}
          >
            Year:
          </span>
          <button
            type="button"
            aria-pressed={selectedYear === 'all'}
            onClick={() => setSelectedYear('all')}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: selectedYear === 'all' ? 'var(--accent-color, #10b981)' : 'var(--bg-secondary)',
              color: selectedYear === 'all' ? '#fff' : 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            All Years (7–10)
          </button>
          {SCIENCE_YEAR_LEVELS.map((yr) => (
            <button
              key={yr}
              type="button"
              aria-pressed={selectedYear === yr}
              onClick={() => setSelectedYear(yr)}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: selectedYear === yr ? 'var(--accent-color, #10b981)' : 'var(--bg-secondary)',
                color: selectedYear === yr ? '#fff' : 'var(--text-primary)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Year {yr}
            </button>
          ))}
        </div>

        <div
          role="group"
          aria-labelledby="science-strand-filter-label"
          style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
        >
          <span
            id="science-strand-filter-label"
            style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', minWidth: '60px' }}
          >
            Strand:
          </span>
          <button
            type="button"
            aria-pressed={selectedStrand === 'all'}
            onClick={() => setSelectedStrand('all')}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: selectedStrand === 'all' ? 'var(--text-primary)' : 'var(--bg-secondary)',
              color: selectedStrand === 'all' ? 'var(--bg-primary)' : 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            All Strands
          </button>
          {SCIENCE_STRANDS.map((strand) => (
            <button
              key={strand}
              type="button"
              aria-pressed={selectedStrand === strand}
              onClick={() => setSelectedStrand(strand)}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: selectedStrand === strand ? 'var(--text-primary)' : 'var(--bg-secondary)',
                color: selectedStrand === strand ? 'var(--bg-primary)' : 'var(--text-primary)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {strand}
            </button>
          ))}
        </div>
      </div>

      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}
      >
        {filteredActivities.length} {filteredActivities.length === 1 ? 'lab matches' : 'labs match'} the selected filters.
      </p>

      {/* Activity Grid */}
      <div className="science-lab-card-grid">
        {filteredActivities.length === 0 ? (
          <section
            aria-labelledby="science-lab-empty-heading"
            className="glass-panel"
            style={{
              padding: '28px',
              borderRadius: '16px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              textAlign: 'center',
              gridColumn: '1 / -1',
            }}
          >
            <h2 id="science-lab-empty-heading" style={{ margin: '0 0 8px', fontSize: '18px', color: 'var(--text-primary)' }}>
              No labs match these filters
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Try another year or strand, or clear both filters to see every lab.
            </p>
            {filtersAreActive && (
              <button
                type="button"
                onClick={clearFilters}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'var(--accent-color, #10b981)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Clear filters
              </button>
            )}
          </section>
        ) : filteredActivities.map((act) => {
          const isDone = completedIds.has(act.id);
          const titleId = `science-activity-${act.id}-title`;
          return (
            <article
              key={act.id}
              aria-labelledby={titleId}
              className="glass-panel"
              style={{
                padding: '20px',
                borderRadius: '16px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(16, 185, 129, 0.12)',
                        color: '#047857',
                      }}
                    >
                      {act.strand}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(59, 130, 246, 0.12)',
                        color: '#2563eb',
                      }}
                    >
                      Year {act.yearLevels.join(', ')}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(168, 85, 247, 0.12)',
                        color: '#7e22ce',
                      }}
                    >
                      {act.interactionLevel}
                    </span>
                    {hasPartialCoverageNote(act.modelLimitations) && (
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: 'rgba(245, 158, 11, 0.12)',
                          color: '#b45309',
                        }}
                      >
                        Partial curriculum coverage
                      </span>
                    )}
                  </div>
                  {isDone && (
                    <span
                      title="Completed"
                      style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#047857',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                      }}
                    >
                      <span aria-hidden="true">✓</span> Done
                    </span>
                  )}
                </div>

                <h3 id={titleId} style={{ fontSize: '16px', fontWeight: 800, margin: '6px 0 2px 0', color: 'var(--text-primary)' }}>
                  {act.title}
                </h3>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>
                  {act.subtitle}
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: '0 0 12px 0' }}>
                  {act.description}
                </p>

                {/* Topics & Interactions tags */}
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {act.topicIds.map((tid) => (
                    <span
                      key={tid}
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {tid}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                <button
                  type="button"
                  aria-label={`Start Lab: ${act.title}`}
                  onClick={() => onSelectActivity(
                    act.id,
                    'learn',
                    selectedYear === 'all' ? undefined : selectedYear,
                  )}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'var(--accent-color, #10b981)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span aria-hidden="true">🚀</span><span>Start Lab</span>
                </button>
                <button
                  type="button"
                  aria-label={`Sandbox: ${act.title}`}
                  onClick={() => onSelectActivity(
                    act.id,
                    'explore',
                    selectedYear === 'all' ? undefined : selectedYear,
                  )}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Sandbox
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
