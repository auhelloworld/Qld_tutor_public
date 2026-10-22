'use client';

import MathMarkdown from '../MathMarkdown';
import type { WorkedExample, WorkedExampleStep } from '../../lib/api-types';

/**
 * Displays a worked example with step-by-step breakdown.
 * Shown on first topic visit or after consecutive errors.
 */
interface WorkedExamplePanelProps {
  workedExample: WorkedExample;
  onDismiss: () => void;
}

export default function WorkedExamplePanel({ workedExample, onDismiss }: WorkedExamplePanelProps) {
  const we = workedExample.worked_example;
  if (!we) return null;

  return (
    <div
      role="region"
      aria-label="Worked example"
      style={{
        background: 'linear-gradient(135deg, rgba(34,197,94,0.08), rgba(16,185,129,0.05))',
        border: '1px solid rgba(34,197,94,0.3)',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '16px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>📖</span>
          <span style={{ fontSize: '14px', fontWeight: '700', color: '#16a34a' }}>
            Worked Example
          </span>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss worked example"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-secondary)', fontSize: '13px', padding: '4px 8px',
          }}
        >
          ✕ Dismiss
        </button>
      </div>

      {workedExample.core_rule && (
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', fontStyle: 'italic' }}>
          <MathMarkdown>
            {`💡 ${workedExample.core_rule}`}
          </MathMarkdown>
        </div>
      )}

      <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)' }}>
        <MathMarkdown>
          {`Q: ${we.question}`}
        </MathMarkdown>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {we.steps.map((step: WorkedExampleStep) => (
          <div key={step.step} style={{ display: 'flex', gap: '10px', fontSize: '13px' }}>
            <span style={{ color: '#16a34a', fontWeight: '700', minWidth: '28px' }}>
              Step {step.step}
            </span>
            <div>
              <div style={{ color: 'var(--text-primary)' }}>
                <MathMarkdown>
                  {step.instruction}
                </MathMarkdown>
              </div>
              <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                →{' '}
                <MathMarkdown>
                  {step.result}
                </MathMarkdown>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '12px', fontSize: '13px', color: '#16a34a', fontWeight: '600' }}>
        <MathMarkdown>
          {`Answer: ${we.answer}`}
        </MathMarkdown>
      </div>

      {we.explanation && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <MathMarkdown>
            {we.explanation}
          </MathMarkdown>
        </div>
      )}

      <button
        onClick={onDismiss}
        style={{
          marginTop: '16px', padding: '8px 16px', fontSize: '13px', fontWeight: '600',
          background: 'rgba(34,197,94,0.2)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: '6px', cursor: 'pointer',
        }}
      >
        Got it — start practising →
      </button>
    </div>
  );
}
