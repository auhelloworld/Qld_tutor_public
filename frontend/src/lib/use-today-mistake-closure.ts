'use client';

import { useCallback, useRef, useState } from 'react';
import { resolveMistakeReview, type MistakeResolveOptions } from './api';
import type { Subject, TodayStudyTask, TutorMarkResponse } from './api-types';

/** What happened to the Error Book item after a transfer answer on the Today page. */
export type TodayClosure = 'idle' | 'saving' | 'moved' | 'closed' | 'practice' | 'error';

export const TODAY_CLOSURE_NOTES: Record<Exclude<TodayClosure, 'idle'>, string> = {
  saving: 'Saving this step in your Error Book…',
  moved: '✓ This mistake moves on. A short check comes in 3 days.',
  closed: '✓ This mistake is closed. You fixed it on your own.',
  practice: 'This counts as practice. A mistake moves on only after a right first try on a new question, with no help and no guess.',
  error: 'Could not save this in your Error Book yet. It tries again when you go on.',
};

interface ClosureScope {
  subject: Subject;
  yearLevel?: number;
  unit?: number;
  syllabusSubject?: string;
}

function fallbackId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Error Book closure from a Today transfer answer (the transfer step and the
 * later spaced check). A right first try with no help on a fair new question
 * moves the mistake on at once, so leaving the page cannot lose it. Each answer
 * has its own request ID: the later check must not replay the transfer request.
 */
export function useTodayMistakeClosure(scope: ClosureScope) {
  const [closure, setClosure] = useState<TodayClosure>('idle');
  const pendingRef = useRef<MistakeResolveOptions | null>(null);

  const save = useCallback(async (options: MistakeResolveOptions) => {
    setClosure('saving');
    try {
      const result = await resolveMistakeReview(options);
      pendingRef.current = null;
      setClosure(result.closure_stage === 'closed' ? 'closed' : 'moved');
    } catch {
      pendingRef.current = options;
      setClosure('error');
    }
  }, []);

  /** `fair` is true for a first try, with no help and no guess, on a new question that tests the same idea. */
  const advance = useCallback((task: TodayStudyTask, topic: string, res: TutorMarkResponse, fair: boolean) => {
    if (!task.question_id || !(res.is_correct && res.outcome === 'correct')) return;
    if (!fair || !res.review_resolution_eligible) {
      setClosure('practice');
      return;
    }
    void save({
      subject: scope.subject,
      question_id: task.question_id,
      topic_id: task.topic_id || topic,
      resolved: true,
      resolutionSource: 'demonstrated_correction',
      yearLevel: scope.yearLevel,
      unit: scope.unit,
      syllabusSubject: scope.syllabusSubject,
      requestId: `today-resolve-${res.attempt_id || fallbackId()}`,
    });
  }, [save, scope]);

  /** One more try for a step that could not be saved, before the page moves on. */
  const retryPending = useCallback(async (): Promise<boolean> => {
    const options = pendingRef.current;
    if (!options) return true;
    pendingRef.current = null;
    try {
      await resolveMistakeReview(options);
      return true;
    } catch {
      return false;
    }
  }, []);

  const reset = useCallback(() => {
    pendingRef.current = null;
    setClosure('idle');
  }, []);

  return { closure, advance, retryPending, reset };
}
