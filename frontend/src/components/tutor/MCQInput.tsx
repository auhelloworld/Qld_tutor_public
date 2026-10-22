'use client';

import MathMarkdown from '../MathMarkdown';

interface MCQInputProps {
  choices: string[];
  selected: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
}

export default function MCQInput({ choices, selected, onSelect, disabled = false }: MCQInputProps) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-secondary)', marginBottom: '8px' }}>Select your answer</legend>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {choices.map((choice, idx) => (
          <label
            key={idx}
            className={`choice-label ${selected === choice ? 'choice-label-selected' : ''}`}
          >
            <input
              type="radio"
              name="mcq-choice"
              value={choice}
              checked={selected === choice}
              disabled={disabled}
              onChange={e => onSelect(e.target.value)}
              style={{ width: '18px', height: '18px', accentColor: 'var(--accent-color)', flexShrink: 0 }}
            />
            <span style={{ lineHeight: '1.4' }}>
              <MathMarkdown inline>
                {choice}
              </MathMarkdown>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
