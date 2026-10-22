'use client';

import React, { useState, useCallback } from 'react';

export interface MafsStageProps {
  mafsHeight: number;
  /** aria-label for the canvas wrapper */
  ariaLabel?: string;
  /**
   * Interaction mode for the Mafs canvas.
   * - 'explore': enables pan and bounded zoom (min 0.5, max 4)
   * - 'static': disables pan and zoom (default)
   */
  interaction?: 'explore' | 'static';
  /**
   * Optional footer content rendered inside the card, below the canvas.
   * Used for canvas-coupled inputs (e.g. coordinate inputs for drag alternatives).
   * Must include `data-scene-footer` attribute for contract test identification.
   */
  footer?: React.ReactNode;
  /**
   * Optional maximum width for the canvas container. Used only for special cases
   * like the kinematics triple-graph where a smaller canvas is needed.
   * By default the card fills the column width (Plan A contract).
   */
  maxCanvasWidth?: number;
  children: React.ReactNode;
}

/**
 * Shared responsive wrapper for Mafs visualizations.
 * Fixes mobile overflow by using max-width instead of fixed width.
 * Provides consistent glass-panel styling, overflow handling, and accessibility attributes.
 *
 * Plan A width contract: the card is width: 100% (fills column), the canvas
 * remains square and centered within the card. This aligns the card with
 * sibling read-out cards in the visual column.
 *
 * When interaction='explore', pan and bounded zoom are enabled.
 * A keyboard-accessible "Reset view" button is rendered to restore the initial viewBox
 * via key-based remount (Mafs has no imperative viewBox reset API).
 */
export default function MafsStage({ mafsHeight, ariaLabel, interaction = 'static', footer, maxCanvasWidth, children }: MafsStageProps) {
  // Key-based remount to reset Mafs viewBox (Mafs has no controlled reset API)
  const [resetKey, setResetKey] = useState(0);

  const handleReset = useCallback(() => {
    setResetKey((k) => k + 1);
  }, []);

  return (
    <div
      className="glass-panel mafs-stage"
      role="group"
      aria-label={ariaLabel || 'Interactive mathematics visualization'}
      data-interaction={interaction}
      style={{
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'var(--bg-secondary)',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.02)',
        borderRadius: '16px',
        overflow: 'hidden',
        width: '100%',
        boxSizing: 'border-box',
        margin: '0',
      }}
    >
      <div
        className="mafs-container"
        key={resetKey}
        data-mafs-mount-id={resetKey}
        style={{
          width: '100%',
          maxWidth: maxCanvasWidth ?? mafsHeight,
          height: mafsHeight,
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.03)',
        }}
      >
        {children}
      </div>
      {interaction === 'explore' && (
        <button
          type="button"
          aria-label="Reset view"
          onClick={handleReset}
          style={{
            marginTop: '8px',
            padding: '4px 12px',
            fontSize: '12px',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          Reset view
        </button>
      )}
      {footer && (
        <div data-scene-footer="" style={{ width: '100%', marginTop: '12px' }}>
          {footer}
        </div>
      )}
    </div>
  );
}
