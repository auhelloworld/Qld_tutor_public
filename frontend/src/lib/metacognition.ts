export const MIN_SELF_EXPLANATION_WORDS = 3;

export function selfExplanationWordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

export function hasMinimumSelfExplanation(value: string): boolean {
  return selfExplanationWordCount(value) >= MIN_SELF_EXPLANATION_WORDS;
}
