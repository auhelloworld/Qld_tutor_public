export type WritingTimeMode = 'unlimited' | 'naplan' | 'qcaa' | 'custom';

export const WRITING_TIME_PRESETS: Record<Exclude<WritingTimeMode, 'custom'>, { label: string; minutes: number }> = {
  unlimited: { label: 'No time limit', minutes: 0 },
  naplan: { label: 'NAPLAN (40 min)', minutes: 40 },
  qcaa: { label: 'Extended practice (120 min)', minutes: 120 },
};

export function getWritingTimeLimit(mode: WritingTimeMode, customMinutes: number): number {
  if (mode === 'custom') return customMinutes;
  return WRITING_TIME_PRESETS[mode]?.minutes ?? 0;
}
