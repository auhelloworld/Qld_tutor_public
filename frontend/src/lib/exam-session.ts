export type ExamResponses = Record<string, string>;
export type ExamMultiPartAnswers = Record<string, Record<string, string>>;

export function serializeExamResponses(
  responses: ExamResponses,
  multiPartAnswers: ExamMultiPartAnswers,
): ExamResponses {
  const serialized = { ...responses };
  for (const [questionId, parts] of Object.entries(multiPartAnswers)) {
    const filled = Object.fromEntries(
      Object.entries(parts).filter(([, value]) => value?.trim()),
    );
    // Keep an explicit empty object for a touched multi-part question. The
    // backend merges autosaves, so omitting the key would retain an older
    // answer after the student clears every part.
    serialized[questionId] = JSON.stringify(filled);
  }
  return serialized;
}

export function changedExamResponses(
  current: ExamResponses,
  persisted: ExamResponses,
): ExamResponses {
  const changed: ExamResponses = {};
  for (const [questionId, answer] of Object.entries(current)) {
    if (persisted[questionId] !== answer) {
      changed[questionId] = answer;
    }
  }
  // Explicitly clear any persisted response no longer represented locally.
  for (const questionId of Object.keys(persisted)) {
    if (!(questionId in current)) {
      changed[questionId] = '';
    }
  }
  return changed;
}
