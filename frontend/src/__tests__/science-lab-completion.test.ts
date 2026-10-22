import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  getScienceLabCompletions,
  getCompletedScienceActivityIds,
  markScienceActivityCompleted,
  clearScienceLabCompletions,
} from '../lib/science-lab/completion';
import {
  getLabCompletions as getMathCompletions,
  markActivityCompleted as markMathCompleted,
} from '../lib/lab-storage';
import { STORAGE_KEY as STUDENT_ID_STORAGE_KEY } from '../lib/student_id';

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const STUDENT_B = '22222222-2222-4222-8222-222222222222';
const LEGACY_COMPLETION_KEY = 'qld-science-lab-completed-v1';

describe('Science Lab Completion Storage Isolation & BKT Boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    localStorage.setItem(STUDENT_ID_STORAGE_KEY, STUDENT_A);
  });

  it('stores and retrieves profile-scoped completions and returns write success', () => {
    expect(getCompletedScienceActivityIds().size).toBe(0);

    expect(markScienceActivityCompleted('SCI-SEASONS-01')).toBe(true);
    const completed = getCompletedScienceActivityIds();
    expect(completed.has('SCI-SEASONS-01')).toBe(true);

    const allData = getScienceLabCompletions();
    expect(allData['SCI-SEASONS-01']).toBeDefined();
    expect(allData['SCI-SEASONS-01'].attempts).toBe(1);

    expect(markScienceActivityCompleted('SCI-SEASONS-01')).toBe(true);
    expect(getScienceLabCompletions()['SCI-SEASONS-01'].attempts).toBe(2);
    expect(localStorage.getItem(`${LEGACY_COMPLETION_KEY}:${STUDENT_A}`)).not.toBeNull();
  });

  it('isolates completion records when the active profile switches', () => {
    expect(markScienceActivityCompleted('SCI-PARTICLE-01')).toBe(true);

    localStorage.setItem(STUDENT_ID_STORAGE_KEY, STUDENT_B);
    expect(getCompletedScienceActivityIds().has('SCI-PARTICLE-01')).toBe(false);
    expect(markScienceActivityCompleted('SCI-WAVE-01')).toBe(true);

    localStorage.setItem(STUDENT_ID_STORAGE_KEY, STUDENT_A);
    expect(getCompletedScienceActivityIds().has('SCI-PARTICLE-01')).toBe(true);
    expect(getCompletedScienceActivityIds().has('SCI-WAVE-01')).toBe(false);
  });

  it('migrates the global legacy record once to the current profile', () => {
    localStorage.setItem(LEGACY_COMPLETION_KEY, JSON.stringify({
      'SCI-SEASONS-01': {
        completedAt: '2026-01-01T00:00:00.000Z',
        attempts: 2,
      },
    }));

    expect(getScienceLabCompletions()['SCI-SEASONS-01'].attempts).toBe(2);
    expect(localStorage.getItem(LEGACY_COMPLETION_KEY)).toBeNull();
    expect(localStorage.getItem(`${LEGACY_COMPLETION_KEY}:${STUDENT_A}`)).not.toBeNull();

    localStorage.setItem(STUDENT_ID_STORAGE_KEY, STUDENT_B);
    expect(getCompletedScienceActivityIds().has('SCI-SEASONS-01')).toBe(false);
  });

  it('merges and consumes legacy data when the current profile already has records', () => {
    expect(markScienceActivityCompleted('SCI-FORCE-01')).toBe(true);
    localStorage.setItem(LEGACY_COMPLETION_KEY, JSON.stringify({
      'SCI-FORCE-01': {
        completedAt: '2020-01-01T00:00:00.000Z',
        attempts: 9,
      },
      'SCI-SEASONS-01': {
        completedAt: '2026-01-01T00:00:00.000Z',
        attempts: 2,
      },
    }));

    const merged = getScienceLabCompletions();
    expect(merged['SCI-FORCE-01'].attempts).toBe(1);
    expect(merged['SCI-SEASONS-01'].attempts).toBe(2);
    expect(localStorage.getItem(LEGACY_COMPLETION_KEY)).toBeNull();

    localStorage.setItem(STUDENT_ID_STORAGE_KEY, STUDENT_B);
    expect(getCompletedScienceActivityIds().size).toBe(0);
  });

  it('reports failure and keeps legacy data when profile storage cannot be written', () => {
    localStorage.setItem(LEGACY_COMPLETION_KEY, JSON.stringify({
      'SCI-FORCE-01': {
        completedAt: '2026-01-01T00:00:00.000Z',
        attempts: 1,
      },
    }));
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
      if (key === `${LEGACY_COMPLETION_KEY}:${STUDENT_A}`) {
        throw new DOMException('Full', 'QuotaExceededError');
      }
      originalSetItem.call(this, key, value);
    });

    expect(getScienceLabCompletions()).toEqual({});
    expect(localStorage.getItem(LEGACY_COMPLETION_KEY)).not.toBeNull();
    expect(markScienceActivityCompleted('SCI-WAVE-01')).toBe(false);
  });

  it('maintains strict isolation from Math Lab completion storage', () => {
    markScienceActivityCompleted('SCI-PARTICLE-01');
    markMathCompleted('linear-vector-resultant');

    const scienceData = getScienceLabCompletions();
    const mathData = getMathCompletions();

    expect(scienceData['SCI-PARTICLE-01']).toBeDefined();
    expect(scienceData['linear-vector-resultant']).toBeUndefined();

    expect(mathData['linear-vector-resultant']).toBeDefined();
    expect(mathData['SCI-PARTICLE-01']).toBeUndefined();
  });

  it('clears only the active profile without wiping other localStorage keys', () => {
    markScienceActivityCompleted('SCI-FORCE-01');
    localStorage.setItem('other_key', 'value');
    localStorage.setItem(STUDENT_ID_STORAGE_KEY, STUDENT_B);
    markScienceActivityCompleted('SCI-WAVE-01');

    clearScienceLabCompletions();
    expect(getCompletedScienceActivityIds().size).toBe(0);
    expect(localStorage.getItem('other_key')).toBe('value');

    localStorage.setItem(STUDENT_ID_STORAGE_KEY, STUDENT_A);
    expect(getCompletedScienceActivityIds().has('SCI-FORCE-01')).toBe(true);
  });
});
