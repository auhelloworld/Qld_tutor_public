/**
 * Mastery presentation rules.
 *
 * The server decides mastery with one rule and sends it as
 * `TopicProgress.status`: at least 4 first answers on the student's own, 3 of
 * the last 4 right, and BKT at the threshold. `bkt_mastery >= 0.8` alone says
 * little: one right short answer already puts it at ~0.86. The status does not
 * fade with time; the revision schedule handles freshness.
 *
 * Every surface that shows a mastery tick, badge or label must go through here
 * so the learner is never told a topic is finished after a single question.
 */

/** Mastery threshold shared with the backend BKT/spaced-repetition modules. */
export const MASTERY_THRESHOLD = 0.8;

export interface MasteryEvidence {
  status?: 'not_started' | 'emerging' | 'developing' | 'promising' | 'mastered' | string;
  bkt_mastery?: number | null;
  confidence?: 'none' | 'low' | 'medium' | 'high' | string;
  evidence_count?: number;
}

/**
 * True only when the server status says mastered.
 *
 * Raw fields never claim mastery: the client cannot see the last four first
 * answers that the server rule needs.
 */
export function isMastered(topic: MasteryEvidence | null | undefined): boolean {
  return topic?.status === 'mastered';
}

/**
 * Learner-facing label for a mastery bar.
 *
 * "Almost there" is used for a high posterior that is not yet backed by enough
 * observations, which keeps the encouragement without the false finish line.
 */
export function masteryLabel(topic: MasteryEvidence | null | undefined): string {
  if (!topic) return '🌱 Just starting';
  const mastery = typeof topic.bkt_mastery === 'number' ? topic.bkt_mastery : 0;
  if (isMastered(topic)) return '✅ Mastered';
  if (mastery >= MASTERY_THRESHOLD) return '🔎 Almost there — a couple more to confirm';
  if (mastery >= 0.6) return '📈 Nearly there';
  if (mastery >= 0.3) return '🔧 Building';
  return '🌱 Just starting';
}

/** Colour for the mastery figure, aligned with {@link masteryLabel}. */
export function masteryColour(topic: MasteryEvidence | null | undefined): string {
  if (isMastered(topic)) return '#16a34a';
  const mastery = typeof topic?.bkt_mastery === 'number' ? topic.bkt_mastery : 0;
  if (mastery >= 0.5) return '#d97706';
  return '#dc2626';
}
