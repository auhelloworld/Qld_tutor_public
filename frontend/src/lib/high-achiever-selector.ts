import type { Exercise } from './api-types';

export interface HighAchieverMistake {
  question_id?: string;
  topic?: string;
  topic_id?: string;
  timestamp?: string;
}

export interface HighAchieverProgress {
  topic: string;
  bkt_mastery?: number;
  accuracy?: number;
  attempts_count?: number;
}

type ProgressLookup = Map<string, number> | Record<string, number>;

function lookupProgress(progressByTopic: ProgressLookup, topicId: string): number {
  if (progressByTopic instanceof Map) {
    return progressByTopic.get(topicId) ?? 0;
  }
  return progressByTopic[topicId] ?? 0;
}

function topicFromMistake(mistake: HighAchieverMistake): string | undefined {
  return mistake.topic_id || mistake.topic;
}

export function getHighAchieverTopicCandidates(args: {
  activeTopic: string;
  sequence?: string[];
  progress?: HighAchieverProgress[];
  mistakes?: HighAchieverMistake[];
  limit?: number;
}): string[] {
  const { activeTopic, sequence = [], progress = [], mistakes = [], limit = 6 } = args;
  const progressByTopic = new Map(progress.map((p) => [p.topic, p]));
  const mistakeCounts = new Map<string, number>();

  for (const mistake of mistakes) {
    const topic = topicFromMistake(mistake);
    if (topic) {
      mistakeCounts.set(topic, (mistakeCounts.get(topic) ?? 0) + 1);
    }
  }

  const allowedTopics = new Set<string>([activeTopic, ...sequence]);
  const topics = new Set<string>([
    activeTopic,
    ...sequence.filter(Boolean),
    ...progress.map((p) => p.topic).filter((t) => allowedTopics.has(t)),
    ...[...mistakeCounts.keys()].filter((t) => allowedTopics.has(t))
  ]);
  const scored = [...topics]
    .filter(Boolean)
    .map((topic) => {
      const p = progressByTopic.get(topic);
      const mastery = p?.bkt_mastery ?? 0;
      let score = topic === activeTopic ? 2 : 0;

      if (mastery >= 0.65 && mastery < 0.95) score += 10;
      else if (mastery >= 0.95) score -= 2;
      else if (mastery > 0) score -= 1;

      if ((p?.attempts_count ?? 0) >= 2 && (p?.accuracy ?? 0) >= 0.7) score += 3;
      score += Math.min(6, (mistakeCounts.get(topic) ?? 0) * 2);

      const sequenceIndex = sequence.indexOf(topic);
      if (sequenceIndex >= 0) score += Math.max(0, 3 - sequenceIndex * 0.01);

      return { topic, score };
    })
    .sort((a, b) => b.score - a.score || sequence.indexOf(a.topic) - sequence.indexOf(b.topic));

  return scored.slice(0, limit).map((item) => item.topic);
}

export function scoreHighAchieverExercise(args: {
  exercise: Exercise;
  topicId: string;
  progressByTopic: ProgressLookup;
  mistakes?: HighAchieverMistake[];
  priorQuestionId?: string | null;
  adapterScore: number;
  nowMs?: number;
}): number {
  const { exercise, topicId, progressByTopic, mistakes = [], priorQuestionId, adapterScore, nowMs = Date.now() } = args;
  let score = adapterScore;
  const mastery = lookupProgress(progressByTopic, topicId);

  if (mastery >= 0.65 && mastery < 0.95) score += 3;
  if (exercise.difficulty === 'AMC') score += 5;
  else if (exercise.difficulty === 'extending') score += 4;
  if (exercise.question_type === 'multi_part') score += 3;
  else if (exercise.question_type === 'reasoning') score += 2;
  if (priorQuestionId && exercise.id === priorQuestionId) score -= 100;

  const mistakeRecord = mistakes.find((m) => m.question_id === exercise.id);
  if (mistakeRecord?.timestamp) {
    const timeSinceMistake = nowMs - new Date(mistakeRecord.timestamp).getTime();
    const cooldownMs = 5 * 60 * 1000;
    score += timeSinceMistake < cooldownMs ? -50 : 4;
  }

  return score;
}

export function describeHighAchieverSelection(args: {
  exercise: Exercise;
  topicId: string;
  progressByTopic: ProgressLookup;
  mistakes?: HighAchieverMistake[];
}): string {
  const { exercise, topicId, progressByTopic, mistakes = [] } = args;
  const reasons: string[] = [];
  const mastery = lookupProgress(progressByTopic, topicId);

  if (mistakes.some((m) => m.question_id === exercise.id)) {
    reasons.push('recent mistake repair');
  } else if (mistakes.some((m) => topicFromMistake(m) === topicId)) {
    reasons.push('recent mistake topic');
  }

  if (exercise.difficulty === 'AMC') reasons.push('AMC-style challenge');
  else if (exercise.difficulty === 'extending') reasons.push('extension task');

  if (exercise.complexity === 'complex_unfamiliar') reasons.push('complex unfamiliar thinking');
  else if (exercise.complexity === 'complex_familiar') reasons.push('multi-step familiar thinking');

  if (exercise.question_type === 'reasoning') reasons.push('reasoning explanation');
  else if (exercise.question_type === 'multi_part') reasons.push('multi-part problem');

  if (exercise.math_metadata?.calculator_allowed === false) reasons.push('calculator-free fluency');
  if (exercise.math_metadata?.expected_working_steps?.length) reasons.push('visible working required');
  if (exercise.english_metadata?.facet === 'text_evidence') reasons.push('text evidence precision');
  if (exercise.english_metadata?.facet === 'writing_structure') reasons.push('writing structure practice');
  if (exercise.science_metadata?.claim_evidence_reasoning) reasons.push('claim-evidence-reasoning');
  if (exercise.science_metadata?.science_inquiry_skill) reasons.push('science inquiry skill');

  if (mastery >= 0.65 && mastery < 0.95) reasons.push('stretching a growing-strength topic');
  else if (mastery >= 0.95) reasons.push('keeping a strong topic sharp');

  const uniqueReasons = [...new Set(reasons)].slice(0, 3);
  if (!uniqueReasons.length) {
    return 'Extension challenge selected to stretch your thinking without adding extra tutoring steps.';
  }
  return `Extension challenge: ${uniqueReasons.join(', ')}.`;
}
