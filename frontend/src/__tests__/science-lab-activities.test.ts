import { describe, expect, it } from 'vitest';
import { SCIENCE_ACTIVITIES } from '../lib/science-lab/activities';
import type { InteractionKind } from '../lib/science-lab/activity-types';

const VALID_INTERACTION_KINDS: Set<InteractionKind> = new Set([
  'drag-handle',
  'continuous-slider',
  'linked-views',
  'time-control',
  'counterfactual-toggle',
  'system-construction',
  'measure-tool',
  'trace-overlay',
  'side-by-side',
]);

const EXPECTED_ACTIVITY_IDS = [
  'SCI-SEASONS-01',
  'SCI-PARTICLE-01',
  'SCI-FORCE-01',
  'SCI-FOODWEB-01',
  'SCI-WAVE-01',
  'SCI-SELECTION-01',
  'SCI-ENERGY-01',
  'SCI-SEPARATION-01',
  'SCI-REACTION-BALANCE-01',
  'SCI-PLATES-01',
  'SCI-HOMEOSTASIS-01',
  'SCI-MEASUREMENT-01',
  'SCI-GENETICS-01',
  'SCI-REACTION-RATE-01',
  'SCI-CARBON-CLIMATE-01',
  'SCI-HALF-LIFE-01',
  'SCI-MOON-TIDES-01',
  'SCI-CELL-SYSTEM-01',
] as const;

describe('Science Lab Activities Contract (Section 2 & 4.3)', () => {
  const activities = Object.values(SCIENCE_ACTIVITIES);

  it('contains exactly the expected 18 activities', () => {
    expect(activities.length).toBe(18);
    expect(Object.keys(SCIENCE_ACTIVITIES).sort()).toEqual([...EXPECTED_ACTIVITY_IDS].sort());
  });

  it('has unique IDs matching the map keys', () => {
    const ids = new Set<string>();
    for (const [key, act] of Object.entries(SCIENCE_ACTIVITIES)) {
      expect(act.id).toBe(key);
      expect(ids.has(act.id)).toBe(false);
      ids.add(act.id);
    }
  });

  it('enforces strict interaction level threshold (L3/L4 or L2 with counterfactual)', () => {
    for (const act of activities) {
      const meetsThreshold =
        act.interactionLevel === 'L4' ||
        act.interactionLevel === 'L3' ||
        (act.interactionLevel === 'L2' && act.interactions.includes('counterfactual-toggle'));

      expect(
        meetsThreshold,
        `Activity ${act.id} with level ${act.interactionLevel} must meet the interaction threshold`,
      ).toBe(true);
    }
  });

  it('only declares recognized interaction kinds from the taxonomy', () => {
    for (const act of activities) {
      expect(act.interactions.length).toBeGreaterThanOrEqual(2);
      for (const kind of act.interactions) {
        expect(
          VALID_INTERACTION_KINDS.has(kind),
          `Activity ${act.id} declared unknown interaction kind "${kind}"`,
        ).toBe(true);
      }
    }
  });

  it('requires a fully formed prediction definition with distractor source', () => {
    for (const act of activities) {
      const pred = act.prediction;
      expect(pred.question.length).toBeGreaterThan(10);
      expect(pred.options.length).toBeGreaterThanOrEqual(3);
      expect(pred.correctIndex).toBeGreaterThanOrEqual(0);
      expect(pred.correctIndex).toBeLessThan(pred.options.length);
      expect(pred.distractorSource.length).toBeGreaterThanOrEqual(1);

      // Must be an approved MC_* misconception or explicit 'proposed:<slug>'
      for (const src of pred.distractorSource) {
        const isValid = src.startsWith('MC_') || src.startsWith('proposed:');
        expect(
          isValid,
          `Activity ${act.id} distractor source "${src}" must start with MC_ or proposed:`,
        ).toBe(true);
      }
    }
  });

  it('defines structured observation fields and model limitations', () => {
    for (const act of activities) {
      expect(act.observation.fields.length).toBeGreaterThanOrEqual(3);
      expect(act.modelLimitations.length).toBeGreaterThanOrEqual(2);
      expect(act.transferTopicIds.length).toBeGreaterThanOrEqual(1);
    }
  });
});
