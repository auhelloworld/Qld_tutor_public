import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  PARENT_IDLE_LOCK_MS,
  clearParentSession,
  hasFreshParentSession,
  markParentActivity,
  useParentIdleLock,
} from '../lib/parent-session';

function saveSession(activeAt: number | null) {
  sessionStorage.setItem('parent_auth', '1');
  sessionStorage.setItem('parent_token', 'parent-token');
  if (activeAt !== null) sessionStorage.setItem('parent_active_at', String(activeAt));
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.useRealTimers());

describe('parent session on a shared computer', () => {
  it('removes every parent key (used by Lock and by Sign out)', () => {
    saveSession(Date.now());
    clearParentSession();
    expect(sessionStorage.getItem('parent_auth')).toBeNull();
    expect(sessionStorage.getItem('parent_token')).toBeNull();
    expect(sessionStorage.getItem('parent_active_at')).toBeNull();
  });

  it('accepts a saved session only while it is recently active', () => {
    saveSession(Date.now());
    expect(hasFreshParentSession()).toBe(true);

    saveSession(Date.now() - PARENT_IDLE_LOCK_MS - 1);
    expect(hasFreshParentSession()).toBe(false);

    sessionStorage.clear();
    saveSession(null);
    // A session without an activity time predates this check; ask for the password again.
    expect(hasFreshParentSession()).toBe(false);
  });

  it('locks when the idle limit passes without input', () => {
    vi.useFakeTimers();
    saveSession(Date.now());
    const onIdle = vi.fn();
    renderHook(() => useParentIdleLock(true, onIdle));

    vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - 60_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2 * 60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('input keeps the session active, and input after the limit locks instead', () => {
    vi.useFakeTimers();
    saveSession(Date.now());
    const onIdle = vi.fn();
    renderHook(() => useParentIdleLock(true, onIdle));

    vi.advanceTimersByTime(10 * 60_000);
    window.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(10 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();

    // Simulate a sleeping laptop: no timer ran, but the clock moved on.
    sessionStorage.setItem('parent_active_at', String(Date.now() - PARENT_IDLE_LOCK_MS - 1));
    window.dispatchEvent(new Event('pointerdown'));
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('records activity when the session is marked active', () => {
    markParentActivity();
    expect(Number(sessionStorage.getItem('parent_active_at'))).toBeGreaterThan(0);
  });
});
