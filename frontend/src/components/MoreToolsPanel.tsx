'use client';

import React from 'react';
import ProgressiveDisclosure from './ProgressiveDisclosure';
import type { YearLevel } from '../lib/api-types';
import { buildLabDeepLink, getLabActivitiesForTopic } from '../lib/lab-topic-links';
import type { LabActivityId } from '../lib/lab-activities';
import { buildScienceLabDeepLink, getScienceActivitiesForTopic } from '../lib/science-lab/topic-links';
import type { ScienceActivityId } from '../lib/science-lab/activity-types';
import { ENABLE_SCIENCE_LAB } from '../lib/feature-flags';

interface MoreToolsPanelProps {
  year?: YearLevel;
  subject?: string;
  topicId?: string;
  compact?: boolean;
}

export default function MoreToolsPanel({ year, subject, topicId, compact }: MoreToolsPanelProps) {
  const yearNumber = Number(String(year || '').replace('year', ''));
  const isSenior = String(year || '').startsWith('unit') || yearNumber >= 11;
  const normalizedSubject = String(subject || '').toLowerCase();
  const isScience = normalizedSubject === 'science' || (topicId ? topicId.startsWith('AC9S') : false);

  const mappedMathActivity = topicId ? getLabActivitiesForTopic(topicId)[0] : undefined;
  const mappedScienceActivity = topicId ? getScienceActivitiesForTopic(topicId)[0] : undefined;

  const mathLabHref = mappedMathActivity
    ? buildLabDeepLink(mappedMathActivity.id as LabActivityId, 'learn', {
        subject,
        year: year ? String(year) : undefined,
        topic: topicId,
      })
    : '/lab';

  const scienceLabHref = mappedScienceActivity
    ? buildScienceLabDeepLink(mappedScienceActivity.id as ScienceActivityId, 'learn', {
        subject,
        year: year ? String(year) : undefined,
        topic: topicId,
      })
    : '/science-lab';

  const linkStyle: React.CSSProperties = {
    color: 'var(--text-primary)',
    textDecoration: 'none',
    fontWeight: '700',
    fontSize: compact ? '13px' : '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    padding: '10px 4px',
    borderBottom: '1px solid var(--border-color)',
  };
  const descStyle: React.CSSProperties = {
    color: 'var(--text-secondary)',
    fontSize: compact ? '11px' : '12px',
    fontWeight: '500',
    lineHeight: 1.35,
  };
  const groupStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: '800',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    margin: '8px 0 4px',
  };

  return (
    <ProgressiveDisclosure label="More Tools" icon="🛠️">
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={groupStyle}>Advanced exploration</div>

        {/* Both labs stay reachable from every context — Math Lab is a
         * general-purpose tool (graphs, geometry, statistics) that a student
         * may want regardless of the current subject. Context only decides the
         * ORDER, never whether an entry point exists. */}
        {isScience && ENABLE_SCIENCE_LAB && (
          <a href={scienceLabHref} style={{ ...linkStyle, color: '#10b981' }}>
            <span>🔬 Science Lab{mappedScienceActivity ? ` · ${mappedScienceActivity.title}` : ''}</span>
            <span style={descStyle}>
              {mappedScienceActivity
                ? mappedScienceActivity.description
                : 'Investigate scientific phenomena with variables, simulations, and counterfactuals.'}
            </span>
          </a>
        )}

        <a href={mathLabHref} style={{ ...linkStyle, color: isScience ? '#06b6d4' : '#10b981' }}>
          <span>🧪 Math Lab{mappedMathActivity ? ` · ${mappedMathActivity.title}` : ''}</span>
          <span style={descStyle}>
            {mappedMathActivity
              ? mappedMathActivity.objective
              : 'Explore graphs, geometry, and visual models when you want to investigate beyond a question.'}
          </span>
        </a>

        {!isScience && ENABLE_SCIENCE_LAB && (
          <a href={scienceLabHref} style={{ ...linkStyle, color: '#06b6d4' }}>
            <span>🔬 Science Lab</span>
            <span style={descStyle}>
              Interactive simulations for physical, chemical, biological, and earth sciences.
            </span>
          </a>
        )}

        <a href="/psmt" style={{ ...linkStyle, color: '#ec4899', borderBottom: 'none' }}>
          <span>{isSenior ? '📐 PSMT Assistant' : '📐 PSMT Assistant (senior extension)'}</span>
          <span style={descStyle}>
            {isSenior
              ? 'Support for senior mathematical modelling and investigation tasks.'
              : 'Still available for high-level exploration, but mainly designed for Years 11–12.'}
          </span>
        </a>
      </div>
    </ProgressiveDisclosure>
  );
}
