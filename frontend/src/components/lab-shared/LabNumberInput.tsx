'use client';

import { useState, type ChangeEvent, type FocusEvent, type InputHTMLAttributes } from 'react';

type LabNumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & {
  value: number | string;
};

function finiteNumber(value: number | string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Number input for Lab controls that accepts unfinished values while typing.
 *
 * A browser reports "-", "-." or an empty field as an empty value. The old
 * inline inputs turned that into 0 at once, so typing "-3" gave "03". This
 * input keeps the typed text while the student edits, and passes a change to
 * `onChange` only when the text is a finite number inside `min` and `max`.
 * An out-of-range number is passed on when the field loses focus, so the
 * handler can clamp it. An empty or unfinished field shows the last good
 * value again on blur. A change from outside (a drag or a new step) replaces
 * an unfinished draft.
 */
export default function LabNumberInput({ value, onChange, onBlur, min, max, ...rest }: LabNumberInputProps) {
  const [draft, setDraft] = useState<{ text: string; base: number | undefined } | null>(null);
  const current = finiteNumber(value);
  const shown = draft && draft.base === current ? draft.text : String(value);
  const lower = finiteNumber(min);
  const upper = finiteNumber(max);
  const inRange = (candidate: number) =>
    (lower === undefined || candidate >= lower) && (upper === undefined || candidate <= upper);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    const parsed = text.trim() === '' ? Number.NaN : Number(text);
    if (Number.isFinite(parsed) && inRange(parsed)) {
      // The parent value becomes `parsed`, so the draft stays in step with it.
      setDraft({ text, base: parsed });
      onChange?.(event);
      return;
    }
    setDraft({ text, base: current });
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    const text = event.target.value;
    const parsed = text.trim() === '' ? Number.NaN : Number(text);
    if (Number.isFinite(parsed) && !inRange(parsed)) {
      // Typing is done: let the handler clamp the out-of-range number. Lab
      // handlers read only `event.target.value`, which a focus event also has.
      onChange?.(event as unknown as ChangeEvent<HTMLInputElement>);
    }
    setDraft(null);
    onBlur?.(event);
  };

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={shown}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
