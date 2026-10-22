'use client';

import React from 'react';

interface ErrorCauseChartProps {
  mistakes: any[];
  subject: string;
}

const MATH_REFLECTIONS: Record<string, { label: string; emoji: string; color: string; desc: string }> = {
  calculation_slip: { label: 'Calculation Slip', emoji: '✏️', color: '#3b82f6', desc: 'Careless calculation or input typo.' },
  concept_gap: { label: 'Concept/Formula Gap', emoji: '📐', color: '#ef4444', desc: 'Struggling with core formulas or concepts.' },
  problem_misreading: { label: 'Problem Misreading', emoji: '🔍', color: '#f59e0b', desc: 'Misreading question details or units.' },
  logical_stuck: { label: 'Logical Stuck', emoji: '🧱', color: '#8b5cf6', desc: 'Got stuck in the middle steps.' },
  random_guess: { label: 'Random Guess', emoji: '🎲', color: '#6b7280', desc: 'Chose randomly without knowing how to solve.' }
};

const ENGLISH_REFLECTIONS: Record<string, { label: string; emoji: string; color: string; desc: string }> = {
  vocabulary_gap: { label: 'Vocabulary/Spelling Gap', emoji: '📖', color: '#10b981', desc: 'Did not know the word meaning or spelling rule.' },
  text_misreading: { label: 'Text Misreading', emoji: '🔍', color: '#f59e0b', desc: 'Misinterpreted the passage or keywords.' },
  distractor_trap: { label: 'Distractor Trap', emoji: '🕳️', color: '#ef4444', desc: 'Fooled by a misleading option.' },
  grammar_confusion: { label: 'Rule Confusion', emoji: '❓', color: '#8b5cf6', desc: 'Grammar or punctuation rules confusion.' },
  random_guess: { label: 'Random Guess', emoji: '🎲', color: '#6b7280', desc: 'Chose randomly without knowing how to solve.' }
};

const MATH_RECS: Record<string, string> = {
  calculation_slip: "Your child understands the concepts well but gets tripped up by simple calculation errors. Encourage them to write down their working steps and double-check their math.",
  concept_gap: "Your child is struggling with the underlying mathematical concept or formula. Reviewing worked examples and core rules together would be highly beneficial.",
  problem_misreading: "Your child is misreading questions or ignoring units. Suggest reading the question twice and underlining keywords or constraints before writing answers.",
  logical_stuck: "Your child starts correctly but gets stuck in middle steps. Try solving step-by-step worked examples together to build logical continuity.",
  random_guess: "Your child is guessing answers. Encourage them to ask the AI Tutor for hints or worked examples instead of guessing."
};

const ENGLISH_RECS: Record<string, string> = {
  vocabulary_gap: "Your child is facing vocabulary gaps. Encourage reading widely and building a personal spelling journal or dictionary.",
  text_misreading: "Your child is misreading passages or keywords. Encourage them to locate and highlight specific textual evidence in the reading text before answering.",
  distractor_trap: "Your child is falling into distractor traps. Guide them to eliminate obviously incorrect options first and compare option statements strictly against the text.",
  grammar_confusion: "Your child is confused by punctuation or grammar rules. Reviewing punctuation templates (e.g. colons and brackets) will build accuracy.",
  random_guess: "Your child is guessing answers. Suggest clicking 'Explain My Answer' to get guided scaffolding from the AI Tutor."
};

export default function ErrorCauseChart({ mistakes, subject }: ErrorCauseChartProps) {
  // 1. Gather all mistakes that have a reflection tag
  const taggedMistakes = mistakes.filter(m => m.reflection_type);
  const totalTagged = taggedMistakes.length;

  const isEnglish = subject === 'english';
  const metaConfig = isEnglish ? ENGLISH_REFLECTIONS : MATH_REFLECTIONS;
  const recConfig = isEnglish ? ENGLISH_RECS : MATH_RECS;

  // 2. Count frequencies
  const counts: Record<string, number> = {};
  Object.keys(metaConfig).forEach(k => { counts[k] = 0; });
  
  taggedMistakes.forEach(m => {
    if (m.reflection_type in counts) {
      counts[m.reflection_type] += 1;
    } else {
      counts[m.reflection_type] = (counts[m.reflection_type] || 0) + 1;
    }
  });

  // 3. Find dominant error cause
  let dominantCause: string | null = null;
  let maxCount = 0;
  Object.entries(counts).forEach(([k, c]) => {
    if (c > maxCount) {
      maxCount = c;
      dominantCause = k;
    }
  });

  if (totalTagged === 0) {
    return (
      <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>📊 Metacognitive Error Analysis</h2>
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.6' }}>
          No metacognitive reflection data logged yet. Once the student completes the <strong>“reason for error”</strong> reflection checklist after wrong answers during practice, an analytical breakdown and advice will appear here.
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '4px' }}>📊 Metacognitive Error Analysis</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '16px' }}>
        Based on {totalTagged} tagged errors logged during practice.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
        {Object.entries(metaConfig).map(([key, config]) => {
          const count = counts[key] || 0;
          const percentage = totalTagged > 0 ? Math.round((count / totalTagged) * 100) : 0;
          return (
            <div key={key} style={{ fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
                  {config.emoji} {config.label}
                </span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: '600' }}>
                  {count} ({percentage}%)
                </span>
              </div>
              <div style={{ 
                height: '8px', 
                background: 'var(--border-color)', 
                borderRadius: '4px', 
                overflow: 'hidden'
              }}>
                <div style={{ 
                  height: '100%', 
                  background: config.color, 
                  width: `${percentage}%`,
                  borderRadius: '4px',
                  transition: 'width 0.5s ease-in-out'
                }} />
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                {config.desc}
              </span>
            </div>
          );
        })}
      </div>

      {dominantCause && recConfig[dominantCause] && (
        <div style={{ 
          padding: '12px 14px', 
          borderRadius: '8px', 
          background: 'rgba(59, 130, 246, 0.08)', 
          border: '1px solid rgba(59, 130, 246, 0.2)',
          fontSize: '13px',
          lineHeight: '1.5'
        }}>
          <strong style={{ color: '#3b82f6', display: 'block', marginBottom: '4px' }}>
            💡 Parent Diagnostic Advice:
          </strong>
          <span style={{ color: 'var(--text-secondary)' }}>
            {recConfig[dominantCause]}
          </span>
        </div>
      )}
    </div>
  );
}
