/**
 * Questions answered for one Today task during one page visit.
 *
 * A Today task can rotate topics, and each topic remounts the practice
 * component. The practice page owns this store, so the count survives the
 * remount and the task can finish at its target.
 */
export interface TodayTaskProgress {
  countedQuestionIds: Set<string>;
  correctQuestionIds: Set<string>;
}

export function createTodayTaskProgress(): TodayTaskProgress {
  return { countedQuestionIds: new Set(), correctQuestionIds: new Set() };
}
