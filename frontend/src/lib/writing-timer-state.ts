import {
  readWritingDocument,
  updateWritingDocument,
  writeWritingDocument,
} from './writing-document-state';

type TimerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function positiveSeconds(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 0;
}

export function readWritingTimerEndsAt(storage: TimerStorage): number {
  return positiveSeconds(readWritingDocument(storage)?.timerEndsAt);
}

export function readPausedWritingSeconds(storage: TimerStorage): number {
  return positiveSeconds(readWritingDocument(storage)?.timerPausedRemaining);
}

export function setWritingTimerDeadline(storage: TimerStorage, endsAt: number): void {
  updateWritingDocument(storage, {
    timerEndsAt: endsAt > 0 && Number.isFinite(endsAt) ? endsAt : null,
    timerPausedRemaining: null,
  });
}

export function pauseWritingTimer(
  storage: TimerStorage,
  fallbackRemaining: number,
  now: number = Date.now(),
): number {
  const document = readWritingDocument(storage);
  const endsAt = Number(document?.timerEndsAt || 0);
  const remaining = Number.isFinite(endsAt) && endsAt > 0
    ? Math.max(0, Math.ceil((endsAt - now) / 1000))
    : Math.max(0, Math.ceil(fallbackRemaining));

  updateWritingDocument(storage, {
    timerEndsAt: null,
    timerPausedRemaining: remaining > 0 ? remaining : null,
  });
  return remaining;
}

export function resumeWritingTimer(
  storage: TimerStorage,
  limitSeconds: number,
  now: number = Date.now(),
): { endsAt: number; remaining: number } {
  const document = readWritingDocument(storage);
  const pausedRemaining = positiveSeconds(document?.timerPausedRemaining);
  if (pausedRemaining > 0) {
    const endsAt = now + pausedRemaining * 1000;
    updateWritingDocument(storage, {
      timerEndsAt: endsAt,
      timerPausedRemaining: null,
    });
    return { endsAt, remaining: pausedRemaining };
  }

  let endsAt = Number(document?.timerEndsAt || 0);
  if (!Number.isFinite(endsAt) || endsAt <= now) {
    const remaining = Math.max(0, Math.ceil(limitSeconds));
    endsAt = now + remaining * 1000;
    if (remaining > 0) {
      updateWritingDocument(storage, {
        timerEndsAt: endsAt,
        timerPausedRemaining: null,
      });
    }
    return { endsAt, remaining };
  }

  return {
    endsAt,
    remaining: Math.max(0, Math.ceil((endsAt - now) / 1000)),
  };
}

export function clearWritingTimer(storage: TimerStorage): void {
  const document = readWritingDocument(storage);
  if (!document) return;
  writeWritingDocument(storage, {
    ...document,
    timerEndsAt: null,
    timerPausedRemaining: null,
  });
}
