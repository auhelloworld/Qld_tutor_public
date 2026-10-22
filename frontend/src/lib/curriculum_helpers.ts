/**
 * Shared curriculum helpers used across CurriculumTree, Dashboard, and main page.
 *
 * Previously these were duplicated in 3+ files — consolidated here per review fix #9.
 */

import { humanise } from './format';
export { humanise };
import type { CurriculumTopic, Curriculum } from './api-types';
export type { CurriculumTopic, Curriculum };

// ---------------------------------------------------------------------------
// Topic ID detection
// ---------------------------------------------------------------------------

/**
 * Topic_Id shapes accepted by the curriculum-framework-foundation registry:
 *   AC9 frameworks (maths/english/science): e.g. AC9M7N04, AC9E10LA02, AC9S8B07
 *   QCAA Senior frameworks: e.g. QCAA_GENERAL_MATHS_U2_T3
 */
export const TOPIC_ID_RE =
  /^(?:AC9[A-Z]+\d+[A-Z]+\d+|QCAA_[A-Z_]+_U[1-4]_T\d+)$/i;

export function looksLikeTopicId(value: unknown): value is string {
  return typeof value === "string" && TOPIC_ID_RE.test(value);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

// debt: covers the few LaTeX symbols in curriculum descriptors. Labels go into
// <option>, aria-label and plain text, so they cannot use MathMarkdown. Add a
// symbol here when a new descriptor needs it.
const PLAIN_MATH_SYMBOLS: Record<string, string> = {
  pi: 'π', times: '×', div: '÷', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', theta: 'θ',
};

/** Turn inline `$...$` math in a curriculum label into plain text, e.g. `$\pi$` → `π`. */
export function plainMathText(text: string): string {
  return text.replace(/\$([^$]*)\$/g, (_match, body: string) =>
    body.replace(/\\([a-zA-Z]+)/g, (command, name: string) => PLAIN_MATH_SYMBOLS[name] ?? command).trim(),
  );
}

export function topicLabel(topic: CurriculumTopic | null | undefined, fallbackKey?: string): string {
  if (topic && looksLikeTopicId(topic?.topic_id)) {
    const displayName =
      topic.name || topic.content_descriptor_text || fallbackKey || "";
    return `${topic.topic_id} \u2014 ${plainMathText(displayName)}`;
  }
  const fallback =
    topic?.name ??
    topic?.content_descriptor_text ??
    topic?.topic_id ??
    fallbackKey ??
    "";
  return humanise(plainMathText(String(fallback)));
}

/**
 * Split a topic into display parts for the Learning Map rows:
 *   primary   — the human-readable name (leads), falls back to a short descriptor
 *   secondary — supporting detail (content descriptor or strand), muted
 *   code      — the official topic_id, shown small/de-emphasised
 * Keeps topicLabel() intact for existing callers.
 */
export function topicLabelParts(
  topic: CurriculumTopic | null | undefined,
  fallbackKey?: string,
): { primary: string; secondary: string; code: string } {
  const code = looksLikeTopicId(topic?.topic_id) ? String(topic!.topic_id) : "";
  const descriptor = topic?.content_descriptor_text ? plainMathText(String(topic.content_descriptor_text)) : "";
  const name = topic?.name ? plainMathText(String(topic.name)) : "";
  const trim = (s: string, n = 90) => (s.length > n ? s.slice(0, n).trim() + "\u2026" : s);

  let primary: string;
  let secondary: string;
  if (name) {
    primary = name;
    secondary = descriptor ? trim(descriptor) : String(topic?.strand || "");
  } else if (descriptor) {
    primary = trim(descriptor, 70);
    secondary = String(topic?.strand || "");
  } else {
    primary = humanise(String(topic?.topic_id || fallbackKey || ""));
    secondary = "";
  }
  return { primary, secondary, code };
}

// ---------------------------------------------------------------------------
// Grouping helpers (strand / unit bucketing)
// ---------------------------------------------------------------------------

export function groupKey(topic: CurriculumTopic): string {
  if (typeof topic?.strand === "string" && topic.strand.length > 0) {
    return topic.strand;
  }
  if (typeof topic?.pathway_group === "string" && topic.pathway_group.length > 0) {
    const pg = topic.pathway_group;
    return pg.includes(":") ? pg.split(":")[0].trim() : pg;
  }
  if (
    topic?.unit !== undefined &&
    topic?.unit !== null &&
    topic?.unit !== ""
  ) {
    return `Unit ${topic.unit}`;
  }
  return "Other";
}

// ---------------------------------------------------------------------------
// Topic entry guard (defensive: filter out "sequence" arrays, etc.)
// ---------------------------------------------------------------------------

export type TopicEntry = {
  topic_id?: string;
  name?: string;
  strand?: string;
  unit?: string | number;
  content_descriptor_text?: string;
};

export function isTopicEntry(
  key: string,
  value: unknown,
): value is CurriculumTopic {
  if (key === "sequence") return false;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const v = value as CurriculumTopic;
  return typeof v.topic_id === "string" || typeof v.name === "string";
}

// ---------------------------------------------------------------------------
// Curriculum lookup
// ---------------------------------------------------------------------------

export function findTopicInCurriculum(
  curriculum: Curriculum | null,
  topicId: string,
): CurriculumTopic | null {
  if (!curriculum || typeof curriculum !== "object") return null;
  for (const subjectKey of Object.keys(curriculum)) {
    const subjectBlock = curriculum[subjectKey];
    if (!subjectBlock || typeof subjectBlock !== "object") continue;
    for (const yearOrUnitKey of Object.keys(subjectBlock)) {
      const yearBlock = subjectBlock[yearOrUnitKey];
      if (!yearBlock || typeof yearBlock !== "object") continue;
      for (const entryKey of Object.keys(yearBlock)) {
        if (entryKey === "sequence") continue;
        const candidate = yearBlock[entryKey];
        if (
          !candidate ||
          typeof candidate !== "object" ||
          Array.isArray(candidate)
        )
          continue;
        if (candidate.topic_id === topicId || entryKey === topicId) {
          return candidate;
        }
      }
    }
  }
  return null;
}

export function getTopicDisplayName(
  curriculum: Curriculum | null,
  topicId: string,
  fallbackName: string,
): string {
  const topic = findTopicInCurriculum(curriculum, topicId);
  if (topic) {
    return plainMathText(topic.name || topic.content_descriptor_text || fallbackName);
  }
  return fallbackName;
}

export function getTopicShortDisplayName(
  curriculum: Curriculum | null,
  topicId: string,
  fallbackName: string,
): string {
  const topic = findTopicInCurriculum(curriculum, topicId);
  const rawName = topic ? (topic.content_descriptor_text || topic.name || fallbackName) : fallbackName;
  const maxLen = 50;
  const truncated = rawName.length > maxLen ? rawName.substring(0, maxLen).trim() + "..." : rawName;
  return `${topicId} \u2014 ${truncated}`;
}

export function topicBelongsToYear(topicId: string, subject: string, year: string, curriculum: Curriculum | null): boolean {
  if (!curriculum) return true;
  const sb = curriculum[subject];
  if (!sb || typeof sb !== 'object') return false;
  const yb = (sb as Record<string, unknown>)[year];
  if (!yb || typeof yb !== 'object') return false;
  return (yb as Record<string, unknown>)[topicId] !== undefined;
}

