'use client';

import React from 'react';
import LabNumberInput from './LabNumberInput';

export interface LabSliderInputProps {
  /** Visible label text (doubles as accessible name if ariaLabel is not provided). */
  label: string;
  /** Explicit aria-label for the range+number pair. */
  ariaLabel: string;
  /** Unique id prefix for the input pair (generates `${id}-slider` and `${id}-number`). */
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Optional display suffix after value in the label (e.g. " rad"). */
  valueSuffix?: string;
  /** Number of decimal places to display in the label. Default 1. */
  decimals?: number;
}

/**
 * Unified slider + number input pair for Lab scenes.
 * Provides a visible label showing current value, a range slider (flex: 1 1 160px),
 * and a companion number input (fixed 76px). Both clamp to [min, max] on change.
 * Visual tokens live in globals.css under `.lab-slider-input`.
 */
export default function LabSliderInput({
  label,
  ariaLabel,
  id,
  value,
  min,
  max,
  step,
  onChange,
  valueSuffix = '',
  decimals = 1,
}: LabSliderInputProps) {
  const clamp = (v: number) => {
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
  };

  return (
    <div className="lab-slider-input">
      <label htmlFor={`${id}-slider`} className="lab-slider-input__label">
        {label} = {value.toFixed(decimals)}{valueSuffix}
      </label>
      <div className="lab-slider-input__row">
        <input
          id={`${id}-slider`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          aria-label={ariaLabel}
          className="lab-slider-input__range"
        />
        <LabNumberInput
          id={`${id}-number`}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          aria-label={`${ariaLabel} numeric input`}
          className="lab-slider-input__number"
        />
      </div>
    </div>
  );
}
