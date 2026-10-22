import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservationDefinition } from '../lib/science-lab/activity-types';
import {
  createEmptyInquiryNotebook,
  createInquiryObservationSnapshot,
  getInquiryNotebookCompletion,
  isInquiryNotebookEvidenceComplete,
  loadInquiryNotebook,
  saveInquiryNotebook,
  type InquiryNotebookDraft,
  type InquiryObservationSnapshot,
} from '../lib/science-lab/inquiry-notebook';
import { markScienceActivityCompleted } from '../lib/science-lab/completion';
import { STORAGE_KEY as STUDENT_ID_STORAGE_KEY } from '../lib/student_id';

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const STUDENT_B = '22222222-2222-4222-8222-222222222222';
const LEGACY_NOTEBOOK_PREFIX = 'qld-science-lab-inquiry-notebook-v1:';

const OBSERVATION: ObservationDefinition = {
  title: 'Test measurements',
  fields: [
    { id: 'temperature', label: 'Temperature', unit: '°C' },
    { id: 'status', label: 'Status', unit: 'relative units' },
  ],
};

function snapshot(id: string, temperature: number): InquiryObservationSnapshot {
  const result = createInquiryObservationSnapshot(
    OBSERVATION,
    { temperature, status: '12 kg' },
    { id, capturedAt: `2026-01-01T00:00:0${id}.000Z` },
  );
  if (!result) throw new Error('Expected a valid snapshot');
  return result;
}

function completeDraft(observations: InquiryObservationSnapshot[]): InquiryNotebookDraft {
  return {
    ...createEmptyInquiryNotebook('SCI-TEST-01'),
    predictionIndex: 1,
    predictionReasoning: 'I expect temperature to change because energy is transferred.',
    variables: {
      independent: 'Input energy',
      dependent: 'Temperature',
      controlled: 'Material and starting amount',
    },
    observations,
    cer: {
      claim: 'The input changes the measured outcome.',
      evidence: 'The recorded snapshots show different temperatures.',
      reasoning: 'A change in the independent variable explains the measured response.',
    },
    modelLimitation: 'The model omits environmental heat loss.',
  };
}

describe('Science inquiry notebook storage and evidence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    localStorage.setItem(STUDENT_ID_STORAGE_KEY, STUDENT_A);
  });

  it('persists drafts per student and activity without using completion as a draft', () => {
    const seasons = {
      ...createEmptyInquiryNotebook('SCI-SEASONS-01'),
      predictionReasoning: 'Student A seasons draft',
    };
    expect(saveInquiryNotebook(seasons)).toBe(true);

    expect(loadInquiryNotebook('SCI-SEASONS-01').predictionReasoning).toBe(
      'Student A seasons draft',
    );
    expect(loadInquiryNotebook('SCI-WAVE-01').predictionReasoning).toBe('');

    localStorage.setItem(STUDENT_ID_STORAGE_KEY, STUDENT_B);
    expect(loadInquiryNotebook('SCI-SEASONS-01').predictionReasoning).toBe('');
    expect(saveInquiryNotebook({
      ...seasons,
      predictionReasoning: 'Student B seasons draft',
    })).toBe(true);
    expect(loadInquiryNotebook('SCI-SEASONS-01').predictionReasoning).toBe(
      'Student B seasons draft',
    );

    localStorage.setItem(STUDENT_ID_STORAGE_KEY, STUDENT_A);
    expect(loadInquiryNotebook('SCI-SEASONS-01').predictionReasoning).toBe(
      'Student A seasons draft',
    );

    markScienceActivityCompleted('SCI-WAVE-01');
    expect(loadInquiryNotebook('SCI-WAVE-01')).toEqual(
      createEmptyInquiryNotebook('SCI-WAVE-01'),
    );
  });

  it('migrates an activity-only legacy draft once to the current profile', () => {
    const activityId = 'SCI-SEASONS-01';
    const legacyKey = `${LEGACY_NOTEBOOK_PREFIX}${activityId}`;
    const legacyDraft = {
      ...createEmptyInquiryNotebook(activityId),
      predictionReasoning: 'Legacy reasoning claimed by Student A',
    };
    localStorage.setItem(legacyKey, JSON.stringify(legacyDraft));

    expect(loadInquiryNotebook(activityId).predictionReasoning).toBe(
      'Legacy reasoning claimed by Student A',
    );
    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect(localStorage.getItem(`${LEGACY_NOTEBOOK_PREFIX}${STUDENT_A}:${activityId}`)).not.toBeNull();

    localStorage.setItem(STUDENT_ID_STORAGE_KEY, STUDENT_B);
    expect(loadInquiryNotebook(activityId)).toEqual(createEmptyInquiryNotebook(activityId));
  });

  it('consumes legacy data when the current profile already has a scoped draft', () => {
    const activityId = 'SCI-SEASONS-01';
    const legacyKey = `${LEGACY_NOTEBOOK_PREFIX}${activityId}`;
    expect(saveInquiryNotebook({
      ...createEmptyInquiryNotebook(activityId),
      predictionReasoning: 'Current scoped reasoning',
    })).toBe(true);
    localStorage.setItem(legacyKey, JSON.stringify({
      ...createEmptyInquiryNotebook(activityId),
      predictionReasoning: 'Stale legacy reasoning',
    }));

    expect(loadInquiryNotebook(activityId).predictionReasoning).toBe('Current scoped reasoning');
    expect(localStorage.getItem(legacyKey)).toBeNull();

    localStorage.setItem(STUDENT_ID_STORAGE_KEY, STUDENT_B);
    expect(loadInquiryNotebook(activityId)).toEqual(createEmptyInquiryNotebook(activityId));
  });

  it('does not delete a legacy draft when the profile migration write fails', () => {
    const activityId = 'SCI-FORCE-01';
    const legacyKey = `${LEGACY_NOTEBOOK_PREFIX}${activityId}`;
    const legacyDraft = {
      ...createEmptyInquiryNotebook(activityId),
      predictionReasoning: 'Keep me until migration succeeds',
    };
    localStorage.setItem(legacyKey, JSON.stringify(legacyDraft));
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
      if (key.includes(LEGACY_NOTEBOOK_PREFIX) && key.includes(STUDENT_A)) {
        throw new DOMException('Full', 'QuotaExceededError');
      }
      originalSetItem.call(this, key, value);
    });

    expect(loadInquiryNotebook(activityId)).toEqual(createEmptyInquiryNotebook(activityId));
    expect(localStorage.getItem(legacyKey)).not.toBeNull();
  });

  it('gracefully falls back for corrupt or unavailable browser storage', () => {
    const draft = createEmptyInquiryNotebook('SCI-FORCE-01');
    expect(saveInquiryNotebook(draft)).toBe(true);
    const notebookKey = Object.keys(localStorage).find((key) => key.includes('inquiry-notebook'));
    expect(notebookKey).toBeDefined();
    localStorage.setItem(notebookKey!, '{not valid json');
    expect(loadInquiryNotebook('SCI-FORCE-01')).toEqual(draft);

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(loadInquiryNotebook('SCI-PARTICLE-01')).toEqual(
      createEmptyInquiryNotebook('SCI-PARTICLE-01'),
    );

    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(saveInquiryNotebook(createEmptyInquiryNotebook('SCI-PARTICLE-01'))).toBe(false);
  });

  it('creates readable snapshots from observation metadata and preserves formatted scene strings', () => {
    const result = createInquiryObservationSnapshot(
      OBSERVATION,
      { temperature: 22.5, status: '12 kg' },
      { id: 'one', capturedAt: '2026-01-01T00:00:00.000Z' },
    );

    expect(result?.measurements).toEqual([
      { fieldId: 'temperature', label: 'Temperature', value: '22.5 °C' },
      { fieldId: 'status', label: 'Status', value: '12 kg' },
    ]);
    expect(createInquiryObservationSnapshot(OBSERVATION, {})).toBeNull();
  });

  it('requires three snapshots and at least two different snapshots for evidence completion', () => {
    const first = snapshot('1', 20);
    const sameValues = snapshot('2', 20);
    const thirdSameValues = snapshot('3', 20);
    const different = snapshot('4', 25);

    const twoDifferent = completeDraft([first, different]);
    expect(getInquiryNotebookCompletion(twoDifferent).observationCount).toBe(false);
    expect(isInquiryNotebookEvidenceComplete(twoDifferent)).toBe(false);

    const threeIdentical = completeDraft([first, sameValues, thirdSameValues]);
    expect(getInquiryNotebookCompletion(threeIdentical).distinctObservations).toBe(false);
    expect(isInquiryNotebookEvidenceComplete(threeIdentical)).toBe(false);

    expect(isInquiryNotebookEvidenceComplete(
      completeDraft([first, sameValues, different]),
    )).toBe(true);
  });
});
