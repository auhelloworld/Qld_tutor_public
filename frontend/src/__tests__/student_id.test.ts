/**
 * Tests for frontend/src/lib/student_id.ts
 *
 * Validates: Requirements 9.5
 * - Bootstrap: first call generates UUID, persists to localStorage
 * - Persistence: subsequent calls return same UUID
 * - Malformed overwrite: tampering with localStorage triggers regeneration
 * - Reset: resetStudentId() clears the key
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getStudentId, resetStudentId, STORAGE_KEY } from '../lib/student_id';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('student_id', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('bootstrap', () => {
    it('generates a valid UUID v4 on first call', () => {
      const id = getStudentId();
      expect(id).toMatch(UUID_V4_RE);
    });

    it('persists the generated UUID to localStorage', () => {
      const id = getStudentId();
      expect(localStorage.getItem(STORAGE_KEY)).toBe(id);
    });
  });

  describe('persistence', () => {
    it('returns the same UUID on subsequent calls', () => {
      const first = getStudentId();
      const second = getStudentId();
      expect(second).toBe(first);
    });

    it('returns a pre-existing valid UUID from localStorage', () => {
      const existing = '12345678-1234-4abc-8def-123456789abc';
      localStorage.setItem(STORAGE_KEY, existing);
      expect(getStudentId()).toBe(existing);
    });
  });

  describe('malformed overwrite', () => {
    it('regenerates UUID when localStorage contains invalid value', () => {
      localStorage.setItem(STORAGE_KEY, 'not-a-uuid');
      const id = getStudentId();
      expect(id).toMatch(UUID_V4_RE);
      expect(id).not.toBe('not-a-uuid');
    });

    it('regenerates UUID when localStorage contains empty string', () => {
      localStorage.setItem(STORAGE_KEY, '');
      const id = getStudentId();
      expect(id).toMatch(UUID_V4_RE);
    });

    it('regenerates UUID when localStorage contains UUID v1 format', () => {
      // UUID v1 has version nibble = 1, not 4
      localStorage.setItem(STORAGE_KEY, '12345678-1234-1abc-8def-123456789abc');
      const id = getStudentId();
      expect(id).toMatch(UUID_V4_RE);
      expect(id).not.toBe('12345678-1234-1abc-8def-123456789abc');
    });
  });

  describe('reset', () => {
    it('clears the stored student id from localStorage', () => {
      getStudentId(); // ensure one is stored
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
      resetStudentId();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('allows a new UUID to be generated after reset', () => {
      const first = getStudentId();
      resetStudentId();
      const second = getStudentId();
      expect(second).toMatch(UUID_V4_RE);
      // New UUID should be different (extremely high probability)
      expect(second).not.toBe(first);
    });
  });
});
