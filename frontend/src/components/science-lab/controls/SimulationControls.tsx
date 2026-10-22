'use client';

import React from 'react';

export interface SimulationControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStepForward?: () => void;
  onReset?: () => void;
  speed?: number;
  onSpeedChange?: (speed: number) => void;
}

export default function SimulationControls({
  isPlaying,
  onTogglePlay,
  onStepForward,
  onReset,
}: SimulationControlsProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderRadius: '8px',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-color)',
      }}
    >
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={isPlaying ? 'Pause simulation' : 'Play simulation'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 14px',
          borderRadius: '6px',
          border: '1px solid var(--border-color)',
          background: isPlaying ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
          color: isPlaying ? '#ef4444' : '#10b981',
          fontWeight: 700,
          fontSize: '13px',
          cursor: 'pointer',
        }}
      >
        <span>{isPlaying ? '⏸ Pause' : '▶ Play'}</span>
      </button>

      {onStepForward && (
        <button
          type="button"
          onClick={onStepForward}
          aria-label="Step simulation forward one frame"
          disabled={isPlaying}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: isPlaying ? 'not-allowed' : 'pointer',
            opacity: isPlaying ? 0.5 : 1,
          }}
        >
          ⏭ Step
        </button>
      )}

      {onReset && (
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset simulation to initial state"
          style={{
            marginLeft: 'auto',
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          ↺ Reset
        </button>
      )}
    </div>
  );
}
