'use client';

import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { ParentSummaryConfig } from '../../lib/guided-subject-adapters';
import styles from './ParentNextStepsCard.module.css';

interface ParentNextStepsCardProps {
  score: number;
  total: number;
  hintClicks: number;
  hintsBeforeAttempt?: number;
  hintsAfterAttempt?: number;
  dialogueTurns?: number;
  workedExamplesOpened: number;
  topicName: string;
  config: ParentSummaryConfig;
  subjectColor: string;
  onContinue?: () => void;
  backendData?: any;
}

export default function ParentNextStepsCard({
  score,
  total,
  hintClicks,
  hintsBeforeAttempt = 0,
  hintsAfterAttempt = 0,
  dialogueTurns = 0,
  workedExamplesOpened,
  topicName,
  config,
  subjectColor,
  onContinue,
  backendData
}: ParentNextStepsCardProps) {
  const percent = total > 0 ? (score / total) * 100 : 0;

  // Dynamically compile strengths based on session stats
  const getStrengths = (): string[] => {
    if (backendData && backendData.what_went_well && backendData.what_went_well.length > 0) {
      return backendData.what_went_well;
    }
    const strengths = [...config.defaultStrengths];
    if (score >= 4) {
      strengths.unshift(`Mastered ${score}/${total} questions successfully.`);
    }
    if (hintsAfterAttempt > 0 && hintsBeforeAttempt === 0) {
      strengths.push('Used tutor support strategically after trying first.');
    } else if (hintClicks > 0 && hintClicks <= 3) {
      strengths.push('Used tutor support productively to self-correct.');
    }
    if (dialogueTurns > 0 && hintsBeforeAttempt === 0) {
      strengths.push('Asked AI Tutor questions after attempting independently.');
    }
    if (workedExamplesOpened > 0) {
      strengths.unshift(
        `Reviewed ${workedExamplesOpened} worked ${workedExamplesOpened === 1 ? 'example' : 'examples'} to compare methods.`
      );
    }
    return strengths.slice(0, 3);
  };

  // Dynamically compile next actions
  const getNextActions = (): string[] => {
    if (backendData && backendData.next_practice_action) {
      return [backendData.next_practice_action];
    }
    const actions = [...config.defaultActions];
    if (percent < 50) {
      actions.unshift('Review the worked example together step-by-step.');
    } else if (hintsBeforeAttempt > 0) {
      actions.unshift('Next goal: attempt one step before opening Concept or asking the AI Tutor.');
    } else if (hintClicks + dialogueTurns > 4) {
      actions.unshift('Try one similar question independently before opening Concept or Chat.');
    }
    return actions.slice(0, 2);
  };

  const strengths = getStrengths();
  const nextActions = getNextActions();

  const headline = backendData?.headline || 'Parent Guide & Next Steps';
  const focusArea = backendData && backendData.main_difficulty ? backendData.main_difficulty : config.defaultFocus;
  const focusWhy = backendData && backendData.why_it_matters ? backendData.why_it_matters : config.whyItMatters;
  const focusTopic = backendData?.focus_area?.name || topicName;
  const duration = backendData?.suggested_duration_minutes;
  const weeklyPlan = backendData?.weekly_coaching_plan;

  return (
    <div className="glass-panel" style={{
      padding: '24px',
      borderRadius: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
      animation: 'fadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '22px' }}>👨‍👩‍👧</span>
        <h3 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
          {headline}
        </h3>
      </div>

      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
        This summary helps you guide your child’s home learning without needing to be a subject specialist.
      </p>

      {/* Main Grid: Strengths & Next steps */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '20px',
        textAlign: 'left'
      }} className={styles.grid}>
        {/* Left Side: What went well */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h4 style={{ fontSize: '13.5px', fontWeight: '700', color: '#16a34a' }}>✓ What went well</h4>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            {strengths.map((s, idx) => (
              <li key={idx} style={{ marginBottom: '6px' }}>{s}</li>
            ))}
          </ul>
        </div>

        {/* Right Side: What caused difficulty */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h4 style={{ fontSize: '13.5px', fontWeight: '700', color: '#b45309' }}>⚠ Focus area</h4>
          <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            <div style={{ marginBottom: '6px' }}>
              <strong>Topic:</strong> {focusTopic}
            </div>
            <strong>Skill Gap:</strong> {focusArea}
            <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
              <strong>Why it matters:</strong> {focusWhy}
            </div>
          </div>
        </div>
      </div>

      {/* Concrete Actions */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        padding: '16px',
        borderRadius: '12px',
        border: '1px dashed var(--border-color)',
        textAlign: 'left'
      }}>
        <h4 style={{ fontSize: '13.5px', fontWeight: '700', color: subjectColor, marginBottom: '8px' }}>
          👉 Suggested Actions for You:
        </h4>
        <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: 'var(--text-primary)', lineHeight: '1.6' }}>
          {nextActions.map((action, idx) => (
            <li key={idx} style={{ marginBottom: '6px' }}>{action}</li>
          ))}
        </ol>
      </div>

      {weeklyPlan && (
        <div style={{
          background: 'rgba(99,102,241,0.07)',
          padding: '16px',
          borderRadius: '12px',
          border: '1px solid rgba(99,102,241,0.18)',
          textAlign: 'left'
        }}>
          <h4 style={{ fontSize: '13.5px', fontWeight: '800', color: subjectColor, margin: '0 0 8px 0' }}>📅 This week’s coaching plan</h4>
          {weeklyPlan.focus && <p style={{ margin: '0 0 10px 0', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}><strong>Focus:</strong> {weeklyPlan.focus}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            {weeklyPlan.student_actions?.length > 0 && (
              <div><strong style={{ fontSize: '12px' }}>Student actions</strong><ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{weeklyPlan.student_actions.map((item: string, idx: number) => <li key={idx}>{item}</li>)}</ul></div>
            )}
            {weeklyPlan.parent_questions?.length > 0 && (
              <div><strong style={{ fontSize: '12px' }}>Parent questions</strong><ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{weeklyPlan.parent_questions.map((item: string, idx: number) => <li key={idx}>{item}</li>)}</ul></div>
            )}
          </div>
        </div>
      )}

      {/* Practice duration guidelines */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11.5px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
        <span>
          ⏱ <strong>Recommended practice:</strong>{' '}
          {duration ? `${duration} minutes today.` : 'Capped at 15–20 minutes daily.'}
          {' '}Stop early if fatigue or frustration rises.
        </span>
      </div>

      {/* Optional action bar for standalone parent-summary use. */}
      {onContinue && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
          <button
            onClick={onContinue}
            style={{
              background: subjectColor,
              color: 'white',
              padding: '12px 24px',
              borderRadius: '10px',
              fontWeight: '700',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            Close Session <ArrowRight size={16} />
          </button>
        </div>
      )}

    </div>
  );
}
