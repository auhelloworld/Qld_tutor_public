'use client';

import React from 'react';

export interface LabSceneLayoutProps {
  /** Left column contents: controls, LearnPanel, selectors */
  control: React.ReactNode;
  /** Right column contents: canvas (MafsStage), read-only info cards */
  visual: React.ReactNode;
  /** Optional align-items for the grid (default: 'start') */
  align?: 'start' | 'stretch';
}

/**
 * Unified two-column layout shell for all Lab scenes.
 * Replaces raw `className="lab-tab-grid"` usage.
 *
 * Contract:
 * - Left column is `.lab-control-column` (direct child of `.lab-tab-grid`)
 * - Right column is `.lab-visual-column` (direct child of `.lab-tab-grid`)
 * - Controls MUST be in the left column
 * - Only canvas and read-only cards in the right column
 * - Canvas-coupled inputs use MafsStage footer slot with `data-scene-footer`
 */
export default function LabSceneLayout({
  control,
  visual,
  align = 'start',
}: LabSceneLayoutProps) {
  return (
    <div className="lab-tab-grid" style={{ alignItems: align }}>
      <div className="lab-control-column">{control}</div>
      <div className="lab-visual-column">{visual}</div>
    </div>
  );
}
