'use client';

import React from 'react';

export interface LabControlCardProps {
  /** Optional block title */
  title?: string;
  /** Optional description text below title */
  description?: string;
  children: React.ReactNode;
  /** Compact vs normal padding (default: normal = 20px) */
  compact?: boolean;
}

/**
 * Unified control card for Lab scene left columns.
 * Provides consistent padding, border-radius, gap, and typography.
 * Visual tokens live in globals.css under `.lab-control-card`.
 */
export default function LabControlCard({
  title,
  description,
  children,
  compact = false,
}: LabControlCardProps) {
  return (
    <div
      className={`lab-control-card glass-panel${compact ? ' lab-control-card--compact' : ''}`}
    >
      {title && <h3 className="lab-control-card__title">{title}</h3>}
      {description && <p className="lab-control-card__desc">{description}</p>}
      {children}
    </div>
  );
}
