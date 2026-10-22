import type { SubPartResult } from './api-types';

export interface MultiPartSessionOutcome {
  ready: boolean;
  isCorrect: boolean;
  outcome: 'correct' | 'incorrect' | 'pending' | 'unanswered';
  errorType: string | null;
}

function hasSubmittedAnswer(part: SubPartResult): boolean {
  return typeof part.student_answer === 'string' && part.student_answer.trim().length > 0;
}

/**
 * Convert incremental per-part marking into one question-level session result.
 * An incomplete question is not counted until every part has a submitted answer,
 * unless the student explicitly leaves the question (`force=true`).
 */
export function getMultiPartSessionOutcome(
  partResults: SubPartResult[],
  force = false,
): MultiPartSessionOutcome {
  const allCorrect = partResults.length > 0 && partResults.every(part => part.is_correct === true);
  if (allCorrect) {
    return { ready: true, isCorrect: true, outcome: 'correct', errorType: null };
  }

  const allSubmitted = partResults.length > 0 && partResults.every(hasSubmittedAnswer);
  if (!allSubmitted && !force) {
    return { ready: false, isCorrect: false, outcome: 'unanswered', errorType: null };
  }

  const pending = partResults.some(
    part => part.outcome === 'pending' || part.error_type === 'parent_review_pending',
  );
  if (pending) {
    return {
      ready: true,
      isCorrect: false,
      outcome: 'pending',
      errorType: 'parent_review_pending',
    };
  }

  if (!allSubmitted) {
    return { ready: true, isCorrect: false, outcome: 'unanswered', errorType: 'unanswered' };
  }

  const firstError = partResults.find(part => part.is_correct !== true && hasSubmittedAnswer(part));
  return {
    ready: true,
    isCorrect: false,
    outcome: 'incorrect',
    errorType: firstError?.error_type || 'partial_incorrect',
  };
}
