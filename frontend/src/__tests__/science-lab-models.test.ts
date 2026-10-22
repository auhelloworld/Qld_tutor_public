import { describe, expect, it } from 'vitest';
import { calculateSolarGeometry } from '../lib/science-lab/models/seasons';
import { initParticleSystem, stepParticleSystem } from '../lib/science-lab/models/particles';
import { initForceMotionState, stepForceMotion } from '../lib/science-lab/models/force-motion';
import { INITIAL_SPECIES, propagateFoodWebChange } from '../lib/science-lab/models/food-web';
import { calculateWaveMetrics, getLongitudinalDisplacement } from '../lib/science-lab/models/waves';
import { initSelectionState, stepGeneration } from '../lib/science-lab/models/selection';

describe('Pure Science Physical & Biological Models', () => {
  describe('Solar Geometry & Seasons Model', () => {
    it('calculates December solstice maximum insolation in Southern Hemisphere', () => {
      const brisbaneLat = -27.5;
      const decSolstice = calculateSolarGeometry(355, brisbaneLat, 23.5);
      const junSolstice = calculateSolarGeometry(172, brisbaneLat, 23.5);

      // Dec in Brisbane: Sun is high (>80°), long daylight (>13.5h)
      expect(decSolstice.noonSolarAltitudeDeg).toBeGreaterThan(80);
      expect(decSolstice.daylightHours).toBeGreaterThan(13.5);
      expect(decSolstice.southernSeason).toBe('Summer');

      // Jun in Brisbane: Sun is lower (~39°), shorter daylight (<10.5h)
      expect(junSolstice.noonSolarAltitudeDeg).toBeLessThan(45);
      expect(junSolstice.daylightHours).toBeLessThan(11.0);
      expect(junSolstice.southernSeason).toBe('Winter');
    });

    it('enforces counterfactual invariance with 0° axial tilt', () => {
      // With tilt = 0, every day of the year at any latitude has exactly 12h daylight
      for (const day of [1, 80, 172, 264, 355]) {
        for (const lat of [-60, -27.5, 0, 45, 80]) {
          const res = calculateSolarGeometry(day, lat, 0);
          expect(res.daylightHours).toBe(12.0);
          expect(res.solarDeclinationDeg).toBe(0);
        }
      }
    });

    it('handles polar extremes (Equator vs Polar circles)', () => {
      const equatorEquinox = calculateSolarGeometry(80, 0, 23.5);
      expect(equatorEquinox.noonSolarAltitudeDeg).toBe(90.0);
      expect(equatorEquinox.daylightHours).toBe(12.0);

      // North Pole during June solstice has 24h midnight sun
      const northPoleJune = calculateSolarGeometry(172, 90, 23.5);
      expect(northPoleJune.daylightHours).toBe(24.0);
    });
  });

  describe('Kinetic Particle Model', () => {
    it('produces deterministic particle initialization with seed', () => {
      const s1 = initParticleSystem('states', 300, 400, 300, 42);
      const s2 = initParticleSystem('states', 300, 400, 300, 42);
      expect(s1.particles.length).toBe(s2.particles.length);
      expect(s1.particles[0].x).toBeCloseTo(s2.particles[0].x, 5);
      expect(s1.particles[0].vx).toBeCloseTo(s2.particles[0].vx, 5);
    });

    it('conserves particle count across simulation steps', () => {
      let state = initParticleSystem('states', 300, 400, 300, 42);
      const initialCount = state.particles.length;

      for (let i = 0; i < 20; i++) {
        const { state: nextState } = stepParticleSystem(state, 0.02, 300);
        state = nextState;
      }
      expect(state.particles.length).toBe(initialCount);
    });

    it('scales particle speed with temperature', () => {
      const stateLow = initParticleSystem('states', 150, 400, 300, 42);
      const stateHigh = initParticleSystem('states', 500, 400, 300, 42);

      const { metrics: mLow } = stepParticleSystem(stateLow, 0.05, 150);
      const { metrics: mHigh } = stepParticleSystem(stateHigh, 0.05, 500);

      expect(mHigh.avgSpeed).toBeGreaterThan(mLow.avgSpeed);
      expect(mLow.stateLabel).toBe('Solid');
      expect(mHigh.stateLabel).toBe('Gas');
    });
  });

  describe('Force and Newton’s Laws Model', () => {
    it('obeys Newton’s Second Law F = ma on frictionless surface', () => {
      let state = initForceMotionState(5, 20, false); // m=5kg, F=20N -> a=4 m/s²
      state = stepForceMotion(state, 0.05, 20, false, 5);

      expect(state.accelerationMs2).toBe(4.0);
      expect(state.netForceN).toBe(20.0);
      expect(state.frictionForceN).toBe(0.0);
    });

    it('demonstrates inertia when force is removed on frictionless surface', () => {
      let state = initForceMotionState(5, 30, false);
      // Accelerate for 0.5s
      for (let i = 0; i < 10; i++) {
        state = stepForceMotion(state, 0.05, 30, false, 5);
      }
      const cruisingVelocity = state.velocityMs;
      expect(cruisingVelocity).toBeGreaterThan(0);

      // Now remove applied force (0 N)
      for (let i = 0; i < 10; i++) {
        state = stepForceMotion(state, 0.05, 0, false, 5);
      }

      // Velocity remains constant with zero deceleration!
      expect(state.velocityMs).toBeCloseTo(cruisingVelocity, 1);
      expect(state.netForceN).toBe(0);
      expect(state.accelerationMs2).toBe(0);
    });

    it('friction opposes motion and brings object to a complete stop', () => {
      let state = initForceMotionState(5, 40, true);
      // Accelerate briefly
      for (let i = 0; i < 5; i++) {
        state = stepForceMotion(state, 0.05, 40, true, 5);
      }
      expect(state.velocityMs).toBeGreaterThan(0);

      // Remove applied force with friction ON
      for (let i = 0; i < 40; i++) {
        state = stepForceMotion(state, 0.05, 0, true, 5);
      }
      expect(state.velocityMs).toBe(0);
      expect(state.accelerationMs2).toBe(0);
    });
  });

  describe('Food Web Ecosystem Dynamics Model', () => {
    it('simulates trophic cascade when apex predator is removed', () => {
      const initial = INITIAL_SPECIES;
      const cascade = propagateFoodWebChange(initial, 'remove_predator', 5);

      // Predators gone or crashed
      expect(cascade.eagle.currentBiomassKg).toBe(0);
      // Herbivores boom
      expect(cascade.wallaby.currentBiomassKg).toBeGreaterThan(initial.wallaby.baseBiomassKg);
      // Producers reduced due to overgrazing
      expect(cascade.grasses.currentBiomassKg).toBeLessThan(initial.grasses.baseBiomassKg);
    });
  });

  describe('Wave Mechanics Model', () => {
    it('validates wave equation v = fλ', () => {
      const m1 = calculateWaveMetrics(1.0, true, 340);
      expect(m1.wavelengthM).toBe(340);
      expect(m1.periodSec).toBe(1.0);

      const m2 = calculateWaveMetrics(2.0, true, 340);
      expect(m2.wavelengthM).toBe(170); // Frequency doubled -> wavelength halved!
    });

    it('cuts off mechanical sound wave propagation in vacuum', () => {
      const inAir = calculateWaveMetrics(2.0, true, 340);
      const inVacuum = calculateWaveMetrics(2.0, false, 340);

      expect(inAir.isTransmissible).toBe(true);
      expect(inAir.waveSpeedMps).toBe(340);

      expect(inVacuum.isTransmissible).toBe(false);
      expect(inVacuum.waveSpeedMps).toBe(0);
      expect(inVacuum.wavelengthM).toBe(0);

      const disp = getLongitudinalDisplacement(100, 1.0, 2.0, 30, 100, false);
      expect(disp).toBe(0); // Exact 0 displacement in vacuum
    });
  });

  describe('Population Genetics Selection Model', () => {
    it('shifts allele frequency toward dark allele under dark background selection', () => {
      let state = initSelectionState(0.2, 0.9, 0.8, 100, 42); // 20% initial dark allele, dark forest, high predation
      expect(state.pFrequency).toBeCloseTo(0.2, 1);

      // Run 20 generations
      for (let g = 0; g < 20; g++) {
        state = stepGeneration(state);
      }

      // Frequency of dark allele (p) must have increased significantly
      expect(state.pFrequency).toBeGreaterThan(0.5);
      const latest = state.history[state.history.length - 1];
      expect(latest.darkPhenotypePercent).toBeGreaterThan(60);
    });
  });
});
