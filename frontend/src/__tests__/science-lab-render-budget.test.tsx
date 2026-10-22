import { describe, expect, it } from 'vitest';
import {
  SCIENCE_LAB_LIMITS,
  assertScienceRenderBudget,
} from '../lib/science-lab/performance';
import { initParticleSystem } from '../lib/science-lab/models/particles';
import { initSelectionState } from '../lib/science-lab/models/selection';

describe('Science Lab Render Budget & Bounded Performance Limits', () => {
  it('defines realistic bounded limits matching hardware capacity', () => {
    expect(SCIENCE_LAB_LIMITS.particles).toBeLessThanOrEqual(250);
    expect(SCIENCE_LAB_LIMITS.populationIndividuals).toBeLessThanOrEqual(200);
    expect(SCIENCE_LAB_LIMITS.generations).toBeLessThanOrEqual(60);
    expect(SCIENCE_LAB_LIMITS.activeAnimationLoops).toBe(1);
    expect(SCIENCE_LAB_LIMITS.activeWorkers).toBe(0);
    expect(SCIENCE_LAB_LIMITS.activeWebGlContexts).toBe(0);
  });

  it('particle system respects both non-empty lower bound and budget upper bound', () => {
    const system = initParticleSystem('states', 300, 440, 320);
    expect(system.particles.length).toBeGreaterThanOrEqual(60); // Non-empty lower bound
    expect(system.particles.length).toBeLessThanOrEqual(SCIENCE_LAB_LIMITS.particles); // Upper budget bound
    expect(() => assertScienceRenderBudget('particles', system.particles.length)).not.toThrow();
  });

  it('selection population respects budget bounds', () => {
    const state = initSelectionState(0.2, 0.8, 0.7, 100, 42);
    expect(state.population.length).toBeGreaterThanOrEqual(50);
    expect(state.population.length).toBeLessThanOrEqual(SCIENCE_LAB_LIMITS.populationIndividuals);
    expect(() => assertScienceRenderBudget('populationIndividuals', state.population.length)).not.toThrow();
  });

  it('assertScienceRenderBudget throws on excessive count', () => {
    expect(() => assertScienceRenderBudget('particles', 300)).toThrow(/exceeds limit/);
  });
});
