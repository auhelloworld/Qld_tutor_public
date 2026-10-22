import { describe, it, expect } from 'vitest';
import { isMastered, masteryLabel } from '../lib/mastery';

describe('mastery presentation', () => {
  it('does not claim mastery from a single correct answer', () => {
    // One correct short answer puts BKT at ~0.86, above the 0.8 threshold.
    const oneAnswer = { bkt_mastery: 0.861, confidence: 'low' as const, evidence_count: 1 };
    expect(isMastered(oneAnswer)).toBe(false);
    expect(masteryLabel(oneAnswer)).toContain('Almost there');
  });

  it('prefers the server evidence-gated status when present', () => {
    expect(isMastered({ status: 'promising', bkt_mastery: 0.99 })).toBe(false);
    expect(isMastered({ status: 'mastered', bkt_mastery: 0.82 })).toBe(true);
    // Mastery does not fade with time; only the current estimate does.
    expect(isMastered({ status: 'mastered', bkt_mastery: 0.4 })).toBe(true);
    expect(isMastered({ status: 'developing', bkt_mastery: 0.7 })).toBe(false);
  });

  it('only the server status decides; raw fields never claim mastery', () => {
    // The server rule needs 3 of the last 4 first answers right, which raw fields do not show.
    const base = { bkt_mastery: 0.95, confidence: 'high' as const };
    expect(isMastered({ ...base, evidence_count: 3 })).toBe(false);
    expect(isMastered({ ...base, evidence_count: 20 })).toBe(false);
  });

  it('never claims mastery when confidence is low or absent', () => {
    expect(isMastered({ bkt_mastery: 0.99, confidence: 'low', evidence_count: 9 })).toBe(false);
    expect(isMastered({ bkt_mastery: 0.99, confidence: 'none', evidence_count: 9 })).toBe(false);
    // No evidence signal at all must not fall back to the bare threshold.
    expect(isMastered({ bkt_mastery: 0.99 })).toBe(false);
  });

  it('labels the lower bands for encouragement without overclaiming', () => {
    expect(masteryLabel({ bkt_mastery: 0.65 })).toContain('Nearly there');
    expect(masteryLabel({ bkt_mastery: 0.4 })).toContain('Building');
    expect(masteryLabel({ bkt_mastery: 0.1 })).toContain('Just starting');
    expect(masteryLabel(null)).toContain('Just starting');
  });

  it('shows mastered only once the server agrees', () => {
    expect(masteryLabel({ status: 'mastered', bkt_mastery: 0.9 })).toBe('✅ Mastered');
  });
});
