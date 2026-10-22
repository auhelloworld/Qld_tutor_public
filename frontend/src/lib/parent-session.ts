'use client';

import { useEffect, useRef } from 'react';

/**
 * Browser side of the parent session. The parent token lives in this tab's
 * sessionStorage. On a shared family computer it must not stay usable after
 * the parent walks away, so every parent page checks the last activity time.
 */
export const PARENT_AUTH_SESSION_KEY = 'parent_auth';
export const PARENT_TOKEN_SESSION_KEY = 'parent_token';
export const PARENT_ACTIVE_AT_SESSION_KEY = 'parent_active_at';

/** Parent tools lock after this much time without input. */
export const PARENT_IDLE_LOCK_MS = 15 * 60 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const CHECK_INTERVAL_MS = 30 * 1000;

function readActiveAt(): number | null {
  try {
    const value = Number(sessionStorage.getItem(PARENT_ACTIVE_AT_SESSION_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function isIdle(now = Date.now()): boolean {
  const activeAt = readActiveAt();
  return activeAt === null || now - activeAt >= PARENT_IDLE_LOCK_MS;
}

/** Remove the parent session from this tab (Lock, Sign out, profile switch). */
export function clearParentSession(): void {
  try {
    sessionStorage.removeItem(PARENT_AUTH_SESSION_KEY);
    sessionStorage.removeItem(PARENT_TOKEN_SESSION_KEY);
    sessionStorage.removeItem(PARENT_ACTIVE_AT_SESSION_KEY);
  } catch {}
}

export function markParentActivity(): void {
  try {
    sessionStorage.setItem(PARENT_ACTIVE_AT_SESSION_KEY, String(Date.now()));
  } catch {}
}

/** True only for a saved parent session with recent activity. */
export function hasFreshParentSession(): boolean {
  try {
    return sessionStorage.getItem(PARENT_AUTH_SESSION_KEY) === '1'
      && Boolean(sessionStorage.getItem(PARENT_TOKEN_SESSION_KEY))
      && !isIdle();
  } catch {
    return false;
  }
}

/**
 * Call `onIdle` when an unlocked parent page gets no input for
 * PARENT_IDLE_LOCK_MS. The check uses the saved activity time, not one long
 * timer, so a laptop that wakes from sleep locks on its first input.
 */
export function useParentIdleLock(active: boolean, onIdle: () => void): void {
  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    onIdleRef.current = onIdle;
  });

  useEffect(() => {
    if (!active) return;
    let locked = false;
    const lockIfIdle = () => {
      if (locked || !isIdle()) return false;
      locked = true;
      onIdleRef.current();
      return true;
    };
    const handleActivity = () => {
      if (!lockIfIdle()) markParentActivity();
    };
    const handleVisible = () => {
      if (document.visibilityState === 'visible') lockIfIdle();
    };

    if (readActiveAt() === null) markParentActivity();
    const interval = window.setInterval(lockIfIdle, CHECK_INTERVAL_MS);
    ACTIVITY_EVENTS.forEach(name => window.addEventListener(name, handleActivity, { passive: true }));
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', lockIfIdle);
    return () => {
      window.clearInterval(interval);
      ACTIVITY_EVENTS.forEach(name => window.removeEventListener(name, handleActivity));
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', lockIfIdle);
    };
  }, [active]);
}
