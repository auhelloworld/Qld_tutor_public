import { describe, expect, it, beforeEach } from 'vitest';
import {
  getLabCompletions,
  getCompletedActivityIds,
  markActivityCompleted,
  clearLabCompletions,
} from '../lib/lab-storage';

describe('Lab Storage (localStorage helpers)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty object on first visit', () => {
    const result = getLabCompletions();
    expect(result).toEqual({});
  });

  it('returns empty Set of completed IDs on first visit', () => {
    const ids = getCompletedActivityIds();
    expect(ids.size).toBe(0);
  });

  it('write + read roundtrip works', () => {
    markActivityCompleted('test-activity-1');
    const data = getLabCompletions();
    expect(data['test-activity-1']).toBeDefined();
    expect(data['test-activity-1'].attempts).toBe(1);
    expect(data['test-activity-1'].completedAt).toBeTruthy();
  });

  it('increments attempts on repeated completions', () => {
    markActivityCompleted('test-activity-1');
    markActivityCompleted('test-activity-1');
    markActivityCompleted('test-activity-1');
    const data = getLabCompletions();
    expect(data['test-activity-1'].attempts).toBe(3);
  });

  it('getCompletedActivityIds returns Set of completed IDs', () => {
    markActivityCompleted('a');
    markActivityCompleted('b');
    const ids = getCompletedActivityIds();
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('c')).toBe(false);
  });

  it('graceful on corrupt JSON in localStorage', () => {
    localStorage.setItem('qld-maths-lab-completed-v1', 'not valid json {{{');
    const result = getLabCompletions();
    expect(result).toEqual({});
  });

  it('graceful on non-object JSON (array)', () => {
    localStorage.setItem('qld-maths-lab-completed-v1', '[1, 2, 3]');
    const result = getLabCompletions();
    expect(result).toEqual({});
  });

  it('graceful on null value in localStorage', () => {
    localStorage.setItem('qld-maths-lab-completed-v1', 'null');
    const result = getLabCompletions();
    expect(result).toEqual({});
  });

  it('filters malformed records without breaking later writes', () => {
    localStorage.setItem(
      'qld-maths-lab-completed-v1',
      JSON.stringify({ broken: null, alsoBroken: { attempts: 'many' }, valid: { completedAt: '2026-01-01T00:00:00.000Z', attempts: 2 } })
    );
    expect(getLabCompletions()).toEqual({
      valid: { completedAt: '2026-01-01T00:00:00.000Z', attempts: 2 },
    });
    markActivityCompleted('broken');
    expect(getLabCompletions().broken.attempts).toBe(1);
  });

  it('clearLabCompletions removes all data', () => {
    markActivityCompleted('a');
    clearLabCompletions();
    const data = getLabCompletions();
    expect(data).toEqual({});
  });

  // --- S4: Variant completions use activityId as key ---
  it('variant completion records use activityId, not seed-specific key', () => {
    // Completing an activity with different variant seeds should still increment the same activityId
    markActivityCompleted('geometry-pythagoras');
    markActivityCompleted('geometry-pythagoras');
    const data = getLabCompletions();
    expect(data['geometry-pythagoras'].attempts).toBe(2);
    // No seed-specific key should exist
    expect(Object.keys(data)).toEqual(['geometry-pythagoras']);
  });
});
