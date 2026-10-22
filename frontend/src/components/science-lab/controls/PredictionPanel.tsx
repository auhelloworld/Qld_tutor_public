'use client';

import React, { useId, useState } from 'react';
import type { PredictionDefinition } from '../../../lib/science-lab/activity-types';
import MathMarkdown from '../../MathMarkdown';

export interface PredictionPanelProps {
  prediction: PredictionDefinition;
  onPredict: (selectedIndex: number) => void;
  submittedIndex?: number;
  isSubmitted?: boolean;
}

export default function PredictionPanel({
  prediction,
  onPredict,
  submittedIndex: propSubmittedIndex,
  isSubmitted: propIsSubmitted,
}: PredictionPanelProps) {
  const groupId = useId();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    propSubmittedIndex ?? null,
  );
  const [submitted, setSubmitted] = useState(propIsSubmitted ?? false);

  const handleSubmit = () => {
    if (selectedIndex !== null) {
      setSubmitted(true);
      onPredict(selectedIndex);
    }
  };

  const isCorrect = selectedIndex === prediction.correctIndex;
  const selectedOption = selectedIndex === null ? undefined : prediction.options[selectedIndex];
  const scientificOption = prediction.options[prediction.correctIndex];

  return (
    <div
      className="glass-panel"
      style={{
        padding: '16px',
        borderRadius: '12px',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        marginBottom: '16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span aria-hidden="true" style={{ fontSize: '18px' }}>🎯</span>
        <h4 id={`${groupId}-title`} style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
          Scientific Prediction
        </h4>
      </div>
      <div
        id={`${groupId}-question`}
        style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: 1.4 }}
      >
        <MathMarkdown inline>{prediction.question}</MathMarkdown>
      </div>

      <div
        role="radiogroup"
        aria-labelledby={`${groupId}-title ${groupId}-question`}
        style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
      >
        {prediction.options.map((opt, idx) => {
          const isSelected = selectedIndex === idx;
          const isScientificResult = idx === prediction.correctIndex;
          let borderColor = isSelected ? 'var(--accent-color, #10b981)' : 'var(--border-color)';
          let bg = isSelected ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-primary)';

          if (submitted && isScientificResult) {
            borderColor = '#10b981';
            bg = 'rgba(16, 185, 129, 0.15)';
          } else if (submitted && isSelected) {
            borderColor = '#f59e0b';
            bg = 'rgba(245, 158, 11, 0.12)';
          }

          return (
            <label
              key={idx}
              htmlFor={`${groupId}-option-${idx}`}
              style={{
                textAlign: 'left',
                padding: '10px 14px',
                borderRadius: '8px',
                border: `1px solid ${borderColor}`,
                background: bg,
                fontSize: '13px',
                lineHeight: 1.4,
                color: 'var(--text-primary)',
                cursor: submitted ? 'default' : 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                gap: '8px',
                alignItems: 'flex-start',
              }}
            >
              <input
                id={`${groupId}-option-${idx}`}
                type="radio"
                name={`${groupId}-prediction`}
                value={idx}
                checked={isSelected}
                disabled={submitted}
                onChange={() => setSelectedIndex(idx)}
                style={{ margin: '2px 0 0', accentColor: 'var(--accent-color, #10b981)' }}
              />
              <span>
                <strong>{String.fromCharCode(65 + idx)}.</strong>{' '}
                <MathMarkdown inline>{opt}</MathMarkdown>
                {submitted && isSelected && (
                  <strong style={{ color: '#b45309' }}> — Your prediction</strong>
                )}
                {submitted && isScientificResult && (
                  <strong style={{ color: '#047857' }}> — Scientific result</strong>
                )}
              </span>
            </label>
          );
        })}
      </div>

      {!submitted ? (
        <button
          type="button"
          disabled={selectedIndex === null}
          onClick={handleSubmit}
          style={{
            marginTop: '12px',
            width: '100%',
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            background: selectedIndex !== null ? 'var(--accent-color, #10b981)' : 'var(--border-color)',
            color: '#fff',
            fontWeight: 700,
            fontSize: '13px',
            cursor: selectedIndex !== null ? 'pointer' : 'not-allowed',
          }}
        >
          Submit Prediction to Unlock Observation
        </button>
      ) : (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{
            marginTop: '12px',
            padding: '10px',
            borderRadius: '8px',
            background: isCorrect ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
            border: `1px solid ${isCorrect ? '#10b981' : '#f59e0b'}`,
            fontSize: '12px',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 700, color: isCorrect ? '#047857' : '#b45309', marginBottom: '6px' }}>
            <span aria-hidden="true">{isCorrect ? '✓' : '💡'}</span>{' '}
            {isCorrect
              ? 'Scientific prediction confirmed: your prediction matches the scientific result.'
              : 'The scientific result differs from your prediction — that comparison is useful evidence.'}
          </div>
          {selectedOption && (
            <div>
              <strong>Your prediction:</strong>{' '}
              <MathMarkdown inline>{selectedOption}</MathMarkdown>
            </div>
          )}
          {scientificOption && (
            <div>
              <strong>Scientific result:</strong>{' '}
              <MathMarkdown inline>{scientificOption}</MathMarkdown>
            </div>
          )}
          {prediction.explanation && (
            <div style={{ marginTop: '6px' }}>
              <strong>Why:</strong>{' '}
              <MathMarkdown inline>{prediction.explanation}</MathMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
