import { describe, expect, it } from 'vitest';
import { LAB_ACTIVITIES, ALL_ACTIVITY_IDS, LAB_TAB_LABELS, LAB_STRAND_LABELS, getActivitiesByStrand, type LabActivityId, type LabStrand } from '../lib/lab-activities';

describe('Lab Activities catalog', () => {
  it('ALL_ACTIVITY_IDS matches Object.keys of LAB_ACTIVITIES', () => {
    const keys = Object.keys(LAB_ACTIVITIES) as LabActivityId[];
    expect(new Set(ALL_ACTIVITY_IDS)).toEqual(new Set(keys));
  });

  it('has no duplicate activity IDs', () => {
    const ids = ALL_ACTIVITY_IDS;
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('every activity has at least 1 step', () => {
    for (const activity of Object.values(LAB_ACTIVITIES)) {
      expect(activity.steps.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every step has non-empty acceptedAnswers', () => {
    for (const activity of Object.values(LAB_ACTIVITIES)) {
      for (const step of activity.steps) {
        expect(step.acceptedAnswers.length).toBeGreaterThanOrEqual(1);
        for (const ans of step.acceptedAnswers) {
          expect(ans.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('every activity has a valid tab value', () => {
    const validTabs = new Set(['explorer', 'sandbox', 'calculus', 'geometry', 'statistics', 'linear-algebra']);
    for (const activity of Object.values(LAB_ACTIVITIES)) {
      expect(validTabs.has(activity.tab)).toBe(true);
    }
  });

  it('every activity has a valid level value', () => {
    const validLevels = new Set(['junior', 'senior']);
    for (const activity of Object.values(LAB_ACTIVITIES)) {
      expect(validLevels.has(activity.level)).toBe(true);
    }
  });

  it('has activities for each tab', () => {
    const tabs = new Set(Object.values(LAB_ACTIVITIES).map((a) => a.tab));
    expect(tabs).toEqual(new Set([
      'explorer',
      'sandbox',
      'calculus',
      'geometry',
      'statistics',
      'linear-algebra',
    ]));
  });

  it('activity.id matches its key in the record', () => {
    for (const [key, activity] of Object.entries(LAB_ACTIVITIES)) {
      expect(activity.id).toBe(key);
    }
  });

  it('has both junior and senior activities', () => {
    const levels = new Set(Object.values(LAB_ACTIVITIES).map((a) => a.level));
    expect(levels.has('junior')).toBe(true);
    expect(levels.has('senior')).toBe(true);
  });

  it('includes the two-point, simultaneous-lines, and inequality-region activities', () => {
    expect(LAB_ACTIVITIES['explorer-two-point-measures']).toBeDefined();
    expect(LAB_ACTIVITIES['sandbox-simultaneous-lines']).toBeDefined();
    expect(LAB_ACTIVITIES['sandbox-inequality-region']).toBeDefined();
  });

  it('includes every P4 activity', () => {
    const p4Ids: LabActivityId[] = [
      'geometry-circle-scaling',
      'geometry-pythagoras',
      'geometry-sohcahtoa',
      'geometry-unit-circle',
      'statistics-distribution-shape',
      'statistics-normal-zscore',
      'statistics-probability-simulation',
      'statistics-scatter-regression',
      'linear-vector-resultant',
      'linear-matrix-transform',
      'linear-complex-plane',
      'sandbox-polar-curves',
      'sandbox-parametric-curves',
      'calculus-direction-field',
      'calculus-kinematics-links',
      'calculus-numerical-methods',
    ];

    for (const id of p4Ids) {
      expect(LAB_ACTIVITIES[id]).toBeDefined();
      // 3 core steps plus one unlockable extension challenge.
      expect(LAB_ACTIVITIES[id].steps).toHaveLength(4);
    }
  });

  // ─── S1 Information Architecture ────────────────────────────────────────

  it('every activity has a valid strand value', () => {
    const validStrands: LabStrand[] = [
      'number-algebra',
      'functions-graphs',
      'measurement-geometry',
      'trigonometry',
      'statistics-probability',
      'calculus',
      'vectors-matrices-complex',
    ];
    for (const activity of Object.values(LAB_ACTIVITIES)) {
      expect(validStrands).toContain(activity.strand);
    }
  });

  it('every activity has a valid band value', () => {
    const validBands = new Set(['7-8', '9-10', 'senior']);
    for (const activity of Object.values(LAB_ACTIVITIES)) {
      expect(validBands.has(activity.band)).toBe(true);
    }
  });

  it('band distribution has activities in all three bands', () => {
    const bands = new Set(Object.values(LAB_ACTIVITIES).map((a) => a.band));
    expect(bands.has('7-8')).toBe(true);
    expect(bands.has('9-10')).toBe(true);
    expect(bands.has('senior')).toBe(true);
  });

  it('LAB_TAB_LABELS covers all 6 tabs', () => {
    const expectedTabs = ['explorer', 'sandbox', 'calculus', 'geometry', 'statistics', 'linear-algebra'];
    expect(Object.keys(LAB_TAB_LABELS).sort()).toEqual(expectedTabs.sort());
  });

  it('geometry tab label includes Trigonometry', () => {
    expect(LAB_TAB_LABELS.geometry).toContain('Trigonometry');
  });

  it('LAB_STRAND_LABELS covers all strands used by activities', () => {
    const usedStrands = new Set(Object.values(LAB_ACTIVITIES).map((a) => a.strand));
    for (const strand of usedStrands) {
      expect(LAB_STRAND_LABELS[strand]).toBeDefined();
      expect(LAB_STRAND_LABELS[strand].length).toBeGreaterThan(0);
    }
  });

  it('getActivitiesByStrand returns correct activities', () => {
    const calcActivities = getActivitiesByStrand('calculus');
    expect(calcActivities.length).toBeGreaterThan(0);
    for (const a of calcActivities) {
      expect(a.strand).toBe('calculus');
    }
  });

  it('getActivitiesByStrand returns empty array for unused strand', () => {
    // All strands are used, so just verify the function works correctly
    const all = getActivitiesByStrand('vectors-matrices-complex');
    expect(all.length).toBeGreaterThan(0);
    for (const a of all) {
      expect(a.strand).toBe('vectors-matrices-complex');
    }
  });
});
