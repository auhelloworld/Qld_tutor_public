'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  ADVANCED_MATH_SYMBOLS,
  MATH_SYMBOLS,
  type MathSymbol,
} from '../lib/constants';

/**
 * Inline math-symbol keyboard used in answer textareas.
 *
 * Common symbols stay visible while senior and specialist symbols are grouped
 * behind an explicit disclosure so the toolbar remains compact on tablets.
 */

interface MathSymbolKeyboardProps {
  /** The id of the textarea this keyboard inserts symbols into. */
  textareaId: string;
  /** The setter for the answer state that the textarea controls. */
  onInsert: (value: string) => void;
  /** Disabled state — e.g. when dialogue cap is reached. */
  disabled?: boolean;
}

export default function MathSymbolKeyboard({
  textareaId,
  onInsert,
  disabled = false,
}: MathSymbolKeyboardProps) {
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advancedSymbolsId = useId();
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    return () => {
      if (focusTimerRef.current !== null) {
        clearTimeout(focusTimerRef.current);
      }
    };
  }, []);

  const handleClick = (sym: MathSymbol) => {
    const textarea = document.getElementById(textareaId) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);

    let newCursorPos = start + sym.value.length;
    if (sym.value.includes('{}')) {
      newCursorPos = start + sym.value.indexOf('{') + 1;
    } else if (sym.value.includes('()')) {
      newCursorPos = start + sym.value.indexOf('(') + 1;
    } else if (sym.value === '||') {
      newCursorPos = start + 1;
    }

    onInsert(before + sym.value + after);

    if (focusTimerRef.current !== null) {
      clearTimeout(focusTimerRef.current);
    }
    focusTimerRef.current = setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
      focusTimerRef.current = null;
    }, 0);
  };

  const renderSymbolButton = (sym: MathSymbol) => (
    <button
      key={sym.label}
      type="button"
      title={sym.description}
      aria-label={sym.description}
      disabled={disabled}
      onClick={() => handleClick(sym)}
      style={{
        padding: '6px 10px',
        fontSize: '14px',
        fontWeight: '600',
        lineHeight: 1,
        borderRadius: '6px',
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        color: 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        minWidth: '44px',
        minHeight: '44px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        touchAction: 'manipulation',
        transition: 'background 0.2s',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(event) => {
        if (!disabled) event.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
      }}
      onMouseLeave={(event) => {
        if (!disabled) event.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
      }}
    >
      {sym.label}
    </button>
  );

  return (
    <div
      role="toolbar"
      aria-label="Math symbols"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        margin: '8px 0',
      }}
    >
      <div
        role="group"
        aria-label="Common math symbols"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}
      >
        {MATH_SYMBOLS.map(renderSymbolButton)}
        <button
          type="button"
          aria-expanded={showAdvanced}
          aria-controls={advancedSymbolsId}
          disabled={disabled}
          onClick={() => setShowAdvanced((visible) => !visible)}
          style={{
            minHeight: '44px',
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px dashed var(--border-color)',
            background: showAdvanced ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
            color: 'var(--accent-color)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontWeight: '700',
            touchAction: 'manipulation',
          }}
        >
          {showAdvanced ? 'Fewer symbols ▴' : 'More symbols ▾'}
        </button>
      </div>

      {showAdvanced && (
        <div
          id={advancedSymbolsId}
          role="group"
          aria-label="Advanced math symbols"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            padding: '10px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            background: 'rgba(99, 102, 241, 0.04)',
          }}
        >
          <span
            style={{
              flexBasis: '100%',
              color: 'var(--text-secondary)',
              fontSize: '13px',
              fontWeight: '700',
            }}
          >
            Advanced symbols
          </span>
          {ADVANCED_MATH_SYMBOLS.map(renderSymbolButton)}
        </div>
      )}
    </div>
  );
}
