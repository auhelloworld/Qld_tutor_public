export interface ReasoningOutcome {
  label: string;
  tone: 'excellent' | 'strong' | 'developing' | 'needs_work';
}

export function getReasoningOutcome(score: number, maxScore: number): ReasoningOutcome {
  const pct = maxScore > 0 ? score / maxScore : 0;
  if (pct >= 1) return { label: 'Full marks', tone: 'excellent' };
  if (pct >= 0.8) return { label: 'Strong answer — refine for full marks', tone: 'strong' };
  if (pct >= 0.5) return { label: 'Partly correct — revise the missing reasoning', tone: 'developing' };
  return { label: 'Needs another attempt', tone: 'needs_work' };
}
