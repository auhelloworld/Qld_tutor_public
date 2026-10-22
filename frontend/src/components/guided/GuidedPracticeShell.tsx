'use client';

import React, { useState } from 'react';
import { ArrowLeft, Compass } from 'lucide-react';
import type { DailySummary } from '../../lib/api-types';
import styles from './GuidedPracticeShell.module.css';

import { getSubjectAdapter } from '../../lib/guided-subject-adapters';


interface GuidedPracticeShellProps {
  topicDisplayName: string;
  subject: string;
  yearLevel: string;
  questionIndex: number;
  totalQuestions: number;
  completedQuestions?: number;
  replacedQuestions?: number;
  isHighAchiever: boolean;
  highAchieverAppliesNext?: boolean;
  allowHighAchiever?: boolean;
  onToggleHighAchiever: () => void;
  onExit: () => void;
  dailySummary: DailySummary | null;
  children: React.ReactNode;
  activeTopic?: string;
  curriculum?: Record<string, Record<string, Record<string, unknown>>>;
  onChangeTopic?: (topic: string) => void;
  hasSessionProgress?: boolean;
  onFinishSession?: () => void;
  selectionReason?: string;
}

export default function GuidedPracticeShell({
  topicDisplayName,
  subject,
  yearLevel,
  questionIndex,
  totalQuestions,
  completedQuestions = questionIndex,
  replacedQuestions = 0,
  isHighAchiever,
  highAchieverAppliesNext = false,
  allowHighAchiever = true,
  onToggleHighAchiever,
  onExit,
  dailySummary,
  children,
  activeTopic,
  curriculum,
  onChangeTopic,
  hasSessionProgress = false,
  onFinishSession,
  selectionReason
}: GuidedPracticeShellProps) {
  const [pendingTopic, setPendingTopic] = useState<string | null>(null);


  // Determine subject colour theme
  const getSubjectColor = () => {
    const s = subject.toLowerCase();
    if (s === 'math' || s === 'mathematics') return 'var(--accent-color)';
    if (s === 'english') return '#0891b2';
    if (s === 'science') return '#10b981';
    return 'var(--accent-color)';
  };

  const subjectColor = getSubjectColor();
  const answeredQuestions = Math.max(0, Math.min(totalQuestions, completedQuestions));
  const progressPercent = totalQuestions > 0 ? (answeredQuestions / totalQuestions) * 100 : 0;

  const activeTopicData = curriculum?.[subject]?.[yearLevel]?.[activeTopic ?? ''];
  const activeTopicName = typeof activeTopicData === 'object' && activeTopicData !== null && 'name' in activeTopicData
    ? String((activeTopicData as { name?: unknown }).name || '')
    : '';
  const fullTopicName = activeTopicName || topicDisplayName;

  const requestTopicChange = (topic: string) => {
    if (!onChangeTopic || topic === activeTopic) return;
    if (hasSessionProgress) {
      setPendingTopic(topic);
      return;
    }
    onChangeTopic(topic);
  };

  const confirmTopicChange = () => {
    if (!pendingTopic || !onChangeTopic) return;
    onChangeTopic(pendingTopic);
    setPendingTopic(null);
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-family, Inter, sans-serif)',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      padding: '12px 16px',
      boxSizing: 'border-box'
    }}>
      {/* Header bar */}
      <header className="glass-panel" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 20px',
        borderRadius: '14px',
        background: 'var(--bg-glass)',
        flexWrap: 'wrap',
        gap: '8px',
        width: '100%',
        marginBottom: '16px',
        boxSizing: 'border-box'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={onExit}
            style={{
              background: 'transparent',
              boxShadow: 'none',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              padding: '6px 12px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            <ArrowLeft size={16} /> Exit
          </button>
          <div style={{ width: '1px', height: '20px', background: 'var(--border-color)' }} />
          <div>
            <h1 style={{ fontSize: '16px', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              🎯 Guided Practice
            </h1>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
              {subject} • {yearLevel}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingRight: '60px' }}>
          {/* High Achiever can cross topic boundaries, so Today tasks hide it. */}
          {allowHighAchiever && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.05)', padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '13px', fontWeight: '600', color: isHighAchiever ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              🚀 High Achiever
            </span>
            <button
              type="button"
              onClick={onToggleHighAchiever}
              role="switch"
              aria-checked={isHighAchiever}
              aria-label="Use high achiever questions"
              style={{
                width: '34px',
                height: '20px',
                background: isHighAchiever ? subjectColor : '#cbd5e1',
                borderRadius: '10px',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: isHighAchiever ? 'flex-end' : 'flex-start',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: 'none',
                color: 'transparent',
                border: 'none'
              }}
            >
              <div style={{ width: '16px', height: '16px', background: '#fff', borderRadius: '50%' }} />
            </button>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: '170px', lineHeight: 1.3 }}>
              {highAchieverAppliesNext
                ? 'Mode change saved; it will apply to the next question.'
                : 'Uses harder and less familiar questions when available.'}
            </span>
          </div>
          )}

          {onFinishSession && (
            <button
              onClick={onFinishSession}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                padding: '7px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: 'none'
              }}
            >
              Finish session now
            </button>
          )}

          {dailySummary && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: '600' }}>
              <span style={{ fontSize: '16px' }}>🔥</span>
              <span style={{ fontSize: '14px', color: (dailySummary.streak_days ?? 0) > 0 ? '#f97316' : 'var(--text-secondary)' }}>
                {dailySummary.streak_days ?? 0}d
              </span>
            </div>
          )}

        </div>
      </header>

      {/* Main Grid: compact sidebar + content */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '360px minmax(0, 1fr)',
        gap: '16px',
        flex: 1,
        width: '100%',
        boxSizing: 'border-box'
      }} className={styles.mainGrid}>
        {/* Left Sidebar — Compact */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Progress Card */}
          <div className="glass-panel" style={{ padding: '16px', borderRadius: '14px' }}>
            {/* Session label + progress fraction */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <Compass size={14} style={{ color: subjectColor }} /> Progress
              </h2>
              <span style={{ fontSize: '14px', fontWeight: '700', color: subjectColor }}>
                {answeredQuestions}/{totalQuestions} answered
                {replacedQuestions > 0 ? ` · ${replacedQuestions} replaced` : ''}
              </span>
            </div>

            {/* Progress bar — prominent */}
            <div
              role="progressbar"
              aria-label="Guided questions answered"
              aria-valuemin={0}
              aria-valuemax={totalQuestions}
              aria-valuenow={answeredQuestions}
              style={{ height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden', marginBottom: '14px' }}
            >
              <div style={{
                width: `${progressPercent}%`,
                height: '100%',
                background: `linear-gradient(90deg, ${subjectColor}, ${subjectColor}cc)`,
                borderRadius: '4px',
                transition: 'width 0.4s ease'
              }} />
            </div>

            {/* Question dots represent required answered slots; replacements do not consume one. */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {Array.from({ length: totalQuestions }).map((_, idx) => {
                const isCompleted = idx < answeredQuestions;
                const isActive = idx === questionIndex && !isCompleted;
                return (
                  <div
                    key={idx}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: '700',
                      fontSize: '13px',
                      transition: 'all 0.25s ease',
                      border: isActive
                        ? `2px solid ${subjectColor}`
                        : isCompleted
                          ? `1.5px solid ${subjectColor}`
                          : '1px solid var(--border-color)',
                      background: isActive
                        ? subjectColor
                        : isCompleted
                          ? `${subjectColor}15`
                          : 'transparent',
                      color: isActive
                        ? 'white'
                        : isCompleted
                          ? subjectColor
                          : 'var(--text-muted)',
                      boxShadow: isActive ? `0 0 8px ${subjectColor}40` : 'none'
                    }}
                  >
                    {isCompleted ? '✓' : idx + 1}
                  </div>
                );
              })}
            </div>

            {/* Topic display — static, fully visible */}
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '10px',
              borderLeft: `3px solid ${subjectColor}`,
              padding: '10px 12px',
              marginTop: '12px'
            }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '3px' }}>Focusing On</div>
              <div style={{
                fontSize: '14px',
                fontWeight: '600',
                color: 'var(--text-primary)',
                lineHeight: '1.4',
                wordBreak: 'break-word'
              }}>
                {fullTopicName}
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px', fontWeight: '400' }}>{activeTopic}</span>
              </div>
            </div>

            {selectionReason && (
              <div style={{
                marginTop: '10px',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '8px 10px',
                lineHeight: 1.4
              }}>
                <strong style={{ color: 'var(--text-primary)' }}>Why this question?</strong> {selectionReason}
              </div>
            )}
          </div>

          {/* Switch Topic Card — Separated */}
          {curriculum && curriculum[subject] && curriculum[subject][yearLevel] && onChangeTopic && (
            <div className="glass-panel" style={{ padding: '12px 16px', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label htmlFor="topic-selector" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', fontWeight: '700' }}>
                Switch Topic Manually
              </label>
              <select
                id="topic-selector"
                value={activeTopic}
                onChange={(e) => requestTopicChange(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  fontWeight: '600',
                  padding: '8px 10px',
                  cursor: 'pointer',
                  outline: 'none',
                  lineHeight: '1.4',
                  boxShadow: 'none',
                  appearance: 'auto'
                }}
              >
                {Object.entries(curriculum[subject][yearLevel])
                  .filter(([k]) => k !== 'sequence')
                  .map(([k, topicData]) => {
                    const topicName = typeof topicData === 'object' && topicData !== null
                      ? String((topicData as { display_name?: unknown; name?: unknown }).display_name
                        || (topicData as { name?: unknown }).name
                        || k)
                      : k;
                    return (
                    <option key={k} value={k}>
                      {topicName} ({k})
                    </option>
                    );
                  })}
              </select>
              {pendingTopic && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '10px',
                  borderRadius: '10px',
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.25)'
                }}>
                  <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 700 }}>
                    Start a new guided set on this topic?
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={confirmTopicChange}
                      style={{ flex: 1, background: subjectColor, color: 'white', border: 'none', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Start new set
                    </button>
                    <button
                      onClick={() => setPendingTopic(null)}
                      style={{ flex: 1, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Study Coach Tip */}
          <div className="glass-panel" style={{
            padding: '12px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.04), rgba(168, 85, 247, 0.04))',
            border: '1px dashed var(--border-color)'
          }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '16px', flexShrink: 0 }}>💡</span>
              <div>
                <h4 style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Coach Tip</h4>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
                  {getSubjectAdapter(subject).studyCoachTip}
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* Center / Main Content Panel */}
        <section aria-label="Guided practice task" style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
          {children}
        </section>
      </div>

    </div>
  );
}
