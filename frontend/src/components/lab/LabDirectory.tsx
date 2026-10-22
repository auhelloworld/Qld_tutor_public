'use client';

import React, { useState } from 'react';
import { CheckCircle, Play, Compass } from 'lucide-react';
import {
  getActivitiesByLevel,
  LAB_TAB_LABELS,
  LAB_STRAND_LABELS,
  ALL_ACTIVITY_IDS,
  type LabTab,
  type LabActivityId,
  type LabStrand,
  type LabActivityMeta,
} from '../../lib/lab-activities';

interface LabDirectoryProps {
  onSelect: (tab: LabTab, mode: 'explore' | 'learn', activityId?: LabActivityId) => void;
  completedActivities: Set<string>;
}

const TAB_ICONS: Record<LabTab, string> = {
  explorer: '📍',
  sandbox: '📈',
  calculus: '∫',
  geometry: '📐',
  statistics: '📊',
  'linear-algebra': '🧮',
};

const BAND_LABELS: Record<string, string> = {
  '7-8': 'Yrs 7–8',
  '9-10': 'Yrs 9–10',
  senior: 'Senior',
};

/** Group activities by strand, preserving order of first appearance */
function groupByStrand(activities: LabActivityMeta[]): Map<LabStrand, LabActivityMeta[]> {
  const map = new Map<LabStrand, LabActivityMeta[]>();
  for (const a of activities) {
    const list = map.get(a.strand);
    if (list) list.push(a);
    else map.set(a.strand, [a]);
  }
  return map;
}

/**
 * Activity directory showing Junior/Senior sections with completion state,
 * strand grouping, strand filter chips, and band badges.
 * Provides entry points for both Learn (guided) and Explore (free) modes.
 */
export default function LabDirectory({ onSelect, completedActivities }: LabDirectoryProps) {
  const [activeStrand, setActiveStrand] = useState<LabStrand | null>(null);

  const juniorActivities = getActivitiesByLevel('junior');
  const seniorActivities = getActivitiesByLevel('senior');

  const totalActivities = ALL_ACTIVITY_IDS.length;
  const completedCount = ALL_ACTIVITY_IDS.filter((id) => completedActivities.has(id)).length;

  // Collect all strands present across all activities
  const allStrands = Array.from(
    new Set([...juniorActivities, ...seniorActivities].map((a) => a.strand))
  );

  const filteredJunior = activeStrand
    ? juniorActivities.filter((a) => a.strand === activeStrand)
    : juniorActivities;
  const filteredSenior = activeStrand
    ? seniorActivities.filter((a) => a.strand === activeStrand)
    : seniorActivities;

  const juniorByStrand = groupByStrand(filteredJunior);
  const seniorByStrand = groupByStrand(filteredSenior);

  const tabs: LabTab[] = [
    'explorer',
    'sandbox',
    'calculus',
    'geometry',
    'statistics',
    'linear-algebra',
  ];

  function renderActivityCard(activity: LabActivityMeta, accentColor: string) {
    const isCompleted = completedActivities.has(activity.id);
    // The unlockable extension is a bonus, not a fourth core step: the activity
    // counter shows core steps only, so the card must count the same way.
    const coreStepCount = activity.steps.filter(step => step.tier !== 'extension').length;
    const hasBonus = activity.steps.some(step => step.tier === 'extension');
    return (
      <button
        key={activity.id}
        onClick={() => onSelect(activity.tab, 'learn', activity.id)}
        className="lab-directory-card"
        data-activity-id={activity.id}
        data-completed={isCompleted}
        aria-label={`${isCompleted ? 'Review completed' : 'Start'} ${activity.title} guided activity, ${coreStepCount} steps${hasBonus ? ' and a bonus challenge' : ''}`}
        style={{
          padding: '16px',
          borderRadius: '12px',
          border: `1px solid ${isCompleted ? 'rgba(34,197,94,0.3)' : 'var(--border-color)'}`,
          background: isCompleted ? 'rgba(34,197,94,0.03)' : 'var(--bg-secondary)',
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          position: 'relative',
          transition: 'border-color 0.2s, box-shadow 0.2s',
        }}
      >
        {isCompleted && (
          <CheckCircle
            size={16}
            color="var(--success)"
            style={{ position: 'absolute', top: '10px', right: '10px' }}
            aria-label="Completed"
          />
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '16px' }}>{TAB_ICONS[activity.tab]}</span>
          <span
            data-testid={`band-badge-${activity.id}`}
            style={{
              fontSize: '10px',
              fontWeight: '700',
              padding: '2px 6px',
              borderRadius: '4px',
              background: activity.band === 'senior' ? 'rgba(139,92,246,0.12)' : 'rgba(99,102,241,0.1)',
              color: activity.band === 'senior' ? 'var(--accent-purple)' : 'var(--accent-color)',
            }}
          >
            {BAND_LABELS[activity.band]}
          </span>
        </span>
        <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>
          {activity.title}
        </span>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
          {activity.objective.length > 80
            ? activity.objective.slice(0, 77) + '…'
            : activity.objective}
        </span>
        <span
          style={{
            fontSize: '11px',
            fontWeight: '600',
            color: accentColor,
            marginTop: '4px',
          }}
        >
          {coreStepCount} steps{hasBonus ? ' + bonus' : ''} • {LAB_TAB_LABELS[activity.tab]}
        </span>
      </button>
    );
  }

  function renderStrandSection(strandMap: Map<LabStrand, LabActivityMeta[]>, accentColor: string) {
    return Array.from(strandMap.entries()).map(([strand, activities]) => (
      <div key={strand} style={{ marginBottom: '16px' }}>
        <h3
          data-testid={`strand-heading-${strand}`}
          style={{
            fontSize: '13px',
            fontWeight: '700',
            color: 'var(--text-secondary)',
            marginBottom: '10px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          {LAB_STRAND_LABELS[strand]}
        </h3>
        <div
          className="lab-directory-grid"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}
        >
          {activities.map((activity) => renderActivityCard(activity, accentColor))}
        </div>
      </div>
    ));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Completion counter */}
      <div
        data-testid="completion-counter"
        style={{
          fontSize: '13px',
          fontWeight: '600',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <CheckCircle size={14} color="var(--success)" />
        Completed {completedCount} / {totalActivities}
      </div>

      {/* Strand filter chips */}
      <div
        role="group"
        aria-label="Filter activities by strand"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}
      >
        <button
          type="button"
          aria-pressed={activeStrand === null}
          onClick={() => setActiveStrand(null)}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: '600',
            borderRadius: '16px',
            border: '1px solid var(--border-color)',
            cursor: 'pointer',
            background: activeStrand === null ? 'var(--accent-color)' : 'var(--bg-secondary)',
            color: activeStrand === null ? 'white' : 'var(--text-secondary)',
            transition: 'all 0.15s',
          }}
        >
          All
        </button>
        {allStrands.map((strand) => (
          <button
            key={strand}
            type="button"
            aria-pressed={activeStrand === strand}
            onClick={() => setActiveStrand(activeStrand === strand ? null : strand)}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: '600',
              borderRadius: '16px',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              background: activeStrand === strand ? 'var(--accent-color)' : 'var(--bg-secondary)',
              color: activeStrand === strand ? 'white' : 'var(--text-secondary)',
              transition: 'all 0.15s',
            }}
          >
            {LAB_STRAND_LABELS[strand]}
          </button>
        ))}
      </div>

      {/* Free Explore cards */}
      <section>
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Compass size={20} color="var(--accent-color)" /> Free Explore
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
          Try the tools at your own pace. Explore is for experimenting; choose a guided activity below when you want questions, hints and feedback.
        </p>
        <div className="lab-directory-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
          {tabs.map((tab) => (
            <button
              key={`explore-${tab}`}
              onClick={() => onSelect(tab, 'explore')}
              className="lab-directory-card"
              data-tab={tab}
              data-mode="explore"
              aria-label={`Explore ${LAB_TAB_LABELS[tab]} freely`}
              style={{
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
            >
              <span style={{ fontSize: '24px' }}>{TAB_ICONS[tab]}</span>
              <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>
                {LAB_TAB_LABELS[tab]}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Open sandbox — explore freely
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Junior Activities */}
      {filteredJunior.length > 0 && (
        <section>
          <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Play size={20} color="var(--success)" /> Junior Activities
            <span style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-secondary)' }}>(Years 7–10)</span>
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
            Start here for step-by-step challenges with short answers, hints and a retry.
          </p>
          {renderStrandSection(juniorByStrand, 'var(--accent-color)')}
        </section>
      )}

      {/* Senior Activities */}
      {filteredSenior.length > 0 && (
        <section>
          <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Play size={20} color="var(--accent-purple)" /> Senior Activities
            <span style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-secondary)' }}>(Units 1–4)</span>
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
            These challenges use senior-school ideas. Pick one when you are ready for more algebra, calculus or modelling.
          </p>
          {renderStrandSection(seniorByStrand, 'var(--accent-purple)')}
        </section>
      )}
    </div>
  );
}
