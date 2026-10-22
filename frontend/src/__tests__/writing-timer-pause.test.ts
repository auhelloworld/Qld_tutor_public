import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WRITING_DOCUMENT_KEY,
  createWritingDocument,
  readWritingDocument,
  writeWritingDocument,
} from '../lib/writing-document-state';
import {
  clearWritingTimer,
  pauseWritingTimer,
  readPausedWritingSeconds,
  readWritingTimerEndsAt,
  resumeWritingTimer,
} from '../lib/writing-timer-state';

describe('Writing timer pause state', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('freezes remaining time inside the atomic writing document', () => {
    const now = 1_000_000;
    writeWritingDocument(localStorage, createWritingDocument({
      draftText: 'Keep this draft intact.',
      timerEndsAt: now + 300_000,
    }));

    const remaining = pauseWritingTimer(localStorage, 0, now);
    const document = readWritingDocument(localStorage);

    expect(remaining).toBe(300);
    expect(readPausedWritingSeconds(localStorage)).toBe(300);
    expect(readWritingTimerEndsAt(localStorage)).toBe(0);
    expect(document?.draftText).toBe('Keep this draft intact.');
  });

  it('rebases the deadline on resume so paused wall-clock time is not consumed', () => {
    const pausedAt = 1_000_000;
    writeWritingDocument(localStorage, createWritingDocument({ timerEndsAt: pausedAt + 600_000 }));
    pauseWritingTimer(localStorage, 0, pausedAt);

    const resumedFiveMinutesLater = resumeWritingTimer(localStorage, 2400, pausedAt + 300_000);

    expect(resumedFiveMinutesLater.remaining).toBe(600);
    expect(resumedFiveMinutesLater.endsAt).toBe(pausedAt + 900_000);
    expect(readPausedWritingSeconds(localStorage)).toBe(0);
  });

  it('uses the current state as a fallback when the document has no deadline', () => {
    expect(pauseWritingTimer(localStorage, 125, 1_000_000)).toBe(125);
    expect(readPausedWritingSeconds(localStorage)).toBe(125);
  });

  it('reuses a live deadline rather than resetting the timer', () => {
    const now = 1_000_000;
    writeWritingDocument(localStorage, createWritingDocument({ timerEndsAt: now + 90_000 }));

    const resumed = resumeWritingTimer(localStorage, 2400, now);

    expect(resumed.remaining).toBe(90);
    expect(resumed.endsAt).toBe(now + 90_000);
  });

  it('starts a fresh deadline only when no live or paused timer exists', () => {
    const now = 1_000_000;

    const started = resumeWritingTimer(localStorage, 2400, now);

    expect(started.remaining).toBe(2400);
    expect(started.endsAt).toBe(now + 2_400_000);
    expect(readWritingTimerEndsAt(localStorage)).toBe(now + 2_400_000);
  });

  it('clears both active and paused timer fields without deleting the draft', () => {
    writeWritingDocument(localStorage, createWritingDocument({
      draftText: 'Still saved',
      timerEndsAt: 123,
      timerPausedRemaining: 45,
    }));

    clearWritingTimer(localStorage);

    const document = readWritingDocument(localStorage);
    expect(document?.timerEndsAt).toBeNull();
    expect(document?.timerPausedRemaining).toBeNull();
    expect(document?.draftText).toBe('Still saved');
  });

  it('normalises malformed paused values to zero', () => {
    localStorage.setItem(WRITING_DOCUMENT_KEY, JSON.stringify({
      ...createWritingDocument(),
      timerPausedRemaining: 'not-a-number',
    }));
    expect(readPausedWritingSeconds(localStorage)).toBe(0);

    localStorage.setItem(WRITING_DOCUMENT_KEY, JSON.stringify({
      ...createWritingDocument(),
      timerPausedRemaining: -20,
    }));
    expect(readPausedWritingSeconds(localStorage)).toBe(0);
  });

  it('supports deterministic Date.now defaults', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000_000);
    writeWritingDocument(localStorage, createWritingDocument({ timerPausedRemaining: 30 }));

    expect(resumeWritingTimer(localStorage, 2400)).toEqual({
      endsAt: 5_030_000,
      remaining: 30,
    });

    vi.restoreAllMocks();
  });

  it('serialises a complete document with one localStorage write', () => {
    const setItem = vi.fn();
    const storage = {
      getItem: vi.fn(() => null),
      setItem,
      removeItem: vi.fn(),
    };

    writeWritingDocument(storage, createWritingDocument({ draftText: 'Atomic draft' }));

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith(WRITING_DOCUMENT_KEY, expect.any(String));
    expect(JSON.parse(setItem.mock.calls[0][1]).draftText).toBe('Atomic draft');
  });
});
