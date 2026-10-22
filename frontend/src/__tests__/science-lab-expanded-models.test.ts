import { describe, expect, it } from 'vitest';
import { calculateEnergyEfficiency } from '../lib/science-lab/models/energy-efficiency';
import {
  SEPARATION_SCENARIOS,
  createSeparationState,
  executeSeparationStep,
} from '../lib/science-lab/models/separation-process';
import type {
  ComponentId,
  SeparationState,
} from '../lib/science-lab/models/separation-process';
import {
  REACTIONS,
  calculateReactionBalance,
} from '../lib/science-lab/models/reaction-balance';
import { calculatePlateBoundary } from '../lib/science-lab/models/plate-boundary';
import { simulateHomeostasis } from '../lib/science-lab/models/homeostasis';
import { generateMeasurementStudy } from '../lib/science-lab/models/measurement-error';
import { simulateGenetics } from '../lib/science-lab/models/genetics';
import { calculateReactionRate } from '../lib/science-lab/models/reaction-rate';
import { calculateCarbonClimate } from '../lib/science-lab/models/carbon-climate';
import {
  calculateHalfLife,
  createDecayNuclei,
} from '../lib/science-lab/models/half-life';
import { calculateMoonTides } from '../lib/science-lab/models/moon-tides';
import { calculateCellSystem } from '../lib/science-lab/models/cell-system';

function expectMaterialConserved(state: SeparationState): void {
  for (const component of Object.keys(state.initial) as ComponentId[]) {
    const accountedFor = (state.remaining[component] ?? 0)
      + (state.recovered[component] ?? 0)
      + (state.lost[component] ?? 0);

    // Each process amount is rounded to 0.1, so multi-step ledgers can differ
    // from the initial amount by a few tenths without creating material.
    expect(accountedFor).toBeCloseTo(state.initial[component] ?? 0, 0);
    expect(accountedFor).toBeLessThanOrEqual((state.initial[component] ?? 0) + 0.4);
  }
}

describe('Expanded Science Lab model invariants', () => {
  describe('energy efficiency', () => {
    it('accounts for every input kilojoule as useful or waste energy', () => {
      const result = calculateEnergyEfficiency({
        inputEnergyKJ: 100,
        efficiencyPercent: 80,
        frictionPercent: 25,
        loadPercent: 50,
      });

      expect(result.usefulEnergyKJ).toBe(30);
      expect(result.wasteEnergyKJ).toBe(70);
      expect(result.usefulEnergyKJ + result.wasteEnergyKJ).toBe(result.inputEnergyKJ);
      expect(result.conservationDifferenceKJ).toBe(0);
    });

    it('changes useful energy in physically reasonable parameter directions', () => {
      const baseline = calculateEnergyEfficiency({
        inputEnergyKJ: 120,
        efficiencyPercent: 60,
        frictionPercent: 20,
        loadPercent: 60,
      });
      const efficient = calculateEnergyEfficiency({
        inputEnergyKJ: 120,
        efficiencyPercent: 90,
        frictionPercent: 20,
        loadPercent: 60,
      });
      const highFriction = calculateEnergyEfficiency({
        inputEnergyKJ: 120,
        efficiencyPercent: 60,
        frictionPercent: 50,
        loadPercent: 60,
      });
      const highLoad = calculateEnergyEfficiency({
        inputEnergyKJ: 120,
        efficiencyPercent: 60,
        frictionPercent: 20,
        loadPercent: 90,
      });

      expect(efficient.usefulEnergyKJ).toBeGreaterThan(baseline.usefulEnergyKJ);
      expect(highFriction.usefulEnergyKJ).toBeLessThan(baseline.usefulEnergyKJ);
      expect(highFriction.wasteEnergyKJ).toBeGreaterThan(baseline.wasteEnergyKJ);
      expect(highLoad.usefulEnergyKJ).toBeGreaterThan(baseline.usefulEnergyKJ);
    });
  });

  describe('separation processes', () => {
    it('accumulates the suggested method sequence without creating any component', () => {
      for (const scenario of Object.values(SEPARATION_SCENARIOS)) {
        let state = createSeparationState(scenario.id);

        for (const method of scenario.suggestedSequence) {
          const previousHistoryLength = state.history.length;
          state = executeSeparationStep(state, method);
          expect(state.history).toHaveLength(previousHistoryLength + 1);
          expect(state.history.at(-1)?.step).toBe(previousHistoryLength + 1);
          expectMaterialConserved(state);
        }

        expect(state.history.map((entry) => entry.method)).toEqual(scenario.suggestedSequence);
        for (const ledger of [state.remaining, state.recovered, state.lost]) {
          expect(Object.values(ledger).every((amount) => amount === undefined || amount >= 0)).toBe(true);
        }
      }
    });

    it('records an unsuitable method but neither recovers nor invents material', () => {
      const initial = createSeparationState('ink');
      const afterFiltration = executeSeparationStep(initial, 'filtration');

      expect(afterFiltration.history).toHaveLength(1);
      expect(afterFiltration.history[0].fit).toBe('poor');
      expect(afterFiltration.history[0].changedMixture).toBe(false);
      expect(afterFiltration.remaining).toEqual(initial.remaining);
      expect(afterFiltration.recovered).toEqual({});
      expect(afterFiltration.lost).toEqual({});
      expect(afterFiltration.products).toEqual([]);
      expectMaterialConserved(afterFiltration);
    });
  });

  describe('reaction balancing and system boundaries', () => {
    it('conserves every atom and relative mass for each balanced equation', () => {
      for (const reaction of Object.values(REACTIONS)) {
        const result = calculateReactionBalance(
          reaction.id,
          reaction.balancedCoefficients,
          'closed',
        );

        expect(result.balanced).toBe(true);
        for (const atom of result.atomSymbols) {
          expect(result.productCounts[atom]).toBe(result.reactantCounts[atom]);
        }
        expect(result.reactantMassUnits).toBe(result.productMassUnits);
        expect(result.closedAfterMassUnits).toBe(result.closedBeforeMassUnits);
      }
    });

    it('distinguishes apparent open-system changes from closed-system conservation', () => {
      for (const reactionId of ['water-formation', 'methane-combustion'] as const) {
        const result = calculateReactionBalance(
          reactionId,
          REACTIONS[reactionId].balancedCoefficients,
          'open',
        );
        expect(result.closedAfterMassUnits).toBe(result.closedBeforeMassUnits);
        expect(result.openAfterMassUnits).toBeLessThan(result.openBeforeMassUnits);
      }

      const rusting = calculateReactionBalance(
        'iron-oxidation',
        REACTIONS['iron-oxidation'].balancedCoefficients,
        'open',
      );
      expect(rusting.closedAfterMassUnits).toBe(rusting.closedBeforeMassUnits);
      expect(rusting.openAfterMassUnits).toBeGreaterThan(rusting.openBeforeMassUnits);
    });
  });

  describe('plate-boundary evidence', () => {
    it('keeps divergent, convergent and transform evidence distinct', () => {
      const divergent = calculatePlateBoundary({
        boundaryType: 'divergent',
        plateSpeedCmPerYear: 5,
        leftDensityGcm3: 2.9,
        rightDensityGcm3: 2.9,
      });
      const convergent = calculatePlateBoundary({
        boundaryType: 'convergent',
        plateSpeedCmPerYear: 5,
        leftDensityGcm3: 3.2,
        rightDensityGcm3: 2.8,
      });
      const transform = calculatePlateBoundary({
        boundaryType: 'transform',
        plateSpeedCmPerYear: 5,
        leftDensityGcm3: 3.2,
        rightDensityGcm3: 2.8,
      });

      expect(divergent.subductingPlate).toBe('neither');
      expect(divergent.crustAgeProfile[2].ageMa).toBe(0);
      expect(divergent.crustAgeProfile[0].ageMa).toBe(divergent.crustAgeProfile[4].ageMa);
      expect(divergent.crustAgeProfile[1].ageMa).toBe(divergent.crustAgeProfile[3].ageMa);

      expect(convergent.subductingPlate).toBe('left');
      expect(convergent.maximumEarthquakeDepthKm).toBeGreaterThan(
        transform.maximumEarthquakeDepthKm,
      );
      expect(convergent.crustAgeProfile[1].ageMa).toBeGreaterThan(
        convergent.crustAgeProfile[3].ageMa,
      );

      expect(transform.subductingPlate).toBe('neither');
      expect(transform.maximumEarthquakeDepthKm).toBe(30);
      expect(transform.crustAgeProfile[2].ageMa).not.toBe(0);
    });

    it('limits earthquake depth to 700 km at every reachable density endpoint', () => {
      const boundaryTypes = ['divergent', 'convergent', 'transform'] as const;
      const densityEndpoints = [2.6, 3.3] as const;

      for (const boundaryType of boundaryTypes) {
        for (const leftDensityGcm3 of densityEndpoints) {
          for (const rightDensityGcm3 of densityEndpoints) {
            const result = calculatePlateBoundary({
              boundaryType,
              plateSpeedCmPerYear: 12,
              leftDensityGcm3,
              rightDensityGcm3,
            });

            expect(result.leftDensityGcm3).toBe(leftDensityGcm3);
            expect(result.rightDensityGcm3).toBe(rightDensityGcm3);
            expect(result.maximumEarthquakeDepthKm).toBeLessThanOrEqual(700);
            expect(result.maximumEarthquakeDepthKm).toBeGreaterThanOrEqual(0);

            if (boundaryType === 'convergent') {
              const expectedDepth = leftDensityGcm3 === rightDensityGcm3 ? 150 : 700;
              expect(result.maximumEarthquakeDepthKm).toBe(expectedDepth);
            }
          }
        }
      }
    });
  });

  describe('homeostasis feedback', () => {
    const mealScenario = {
      kind: 'homeostasis' as const,
      disturbance: 'meal' as const,
      insulinSensitivity: 1.1,
      controllerStrength: 1.1,
      condition: 'normal' as const,
      seed: 77,
    };

    it('uses feedback with the sign needed to oppose displacement from the target', () => {
      const controlled = simulateHomeostasis(mealScenario);
      const uncontrolled = simulateHomeostasis({
        ...mealScenario,
        controllerStrength: 0,
      });

      for (const point of controlled.points) {
        const displacement = point.glucoseMmolL - controlled.targetGlucoseMmolL;
        expect(displacement * point.feedbackRateMmolLMin).toBeGreaterThanOrEqual(0);
      }
      expect(controlled.peakGlucoseMmolL).toBeLessThan(uncontrolled.peakGlucoseMmolL);
      expect(Math.abs(controlled.finalGlucoseMmolL - controlled.targetGlucoseMmolL)).toBeLessThan(
        Math.abs(uncontrolled.finalGlucoseMmolL - uncontrolled.targetGlucoseMmolL),
      );
    });

    it('isolates reduced sensitivity as a counterfactual with weaker regulation', () => {
      const normal = simulateHomeostasis(mealScenario, 'normal');
      const lowSensitivity = simulateHomeostasis(mealScenario, 'diabetes');

      expect(lowSensitivity.baselineGlucoseMmolL).toBe(normal.baselineGlucoseMmolL);
      expect(lowSensitivity.peakGlucoseMmolL).toBeGreaterThan(normal.peakGlucoseMmolL);
      expect(
        Math.abs(lowSensitivity.finalGlucoseMmolL - lowSensitivity.targetGlucoseMmolL),
      ).toBeGreaterThan(
        Math.abs(normal.finalGlucoseMmolL - normal.targetGlucoseMmolL),
      );
    });
  });

  describe('measurement error', () => {
    const studyData = {
      kind: 'measurement-error' as const,
      trueValue: 50,
      resolution: 0.2,
      randomError: 1.5,
      systematicBias: 2,
      sampleSize: 17,
      seed: 314,
      calibrated: false,
    };

    it('repeats readings and finite-sample statistics for the same seed', () => {
      const first = generateMeasurementStudy(studyData);
      const second = generateMeasurementStudy(studyData);

      expect(second).toEqual(first);
      expect(first.samples).toHaveLength(17);
      expect([
        first.mean,
        first.range,
        first.absoluteError,
        first.lowerOutlierFence,
        first.upperOutlierFence,
      ].every(Number.isFinite)).toBe(true);

      const values = first.samples.map((sample) => sample.value);
      const sampleMean = values.reduce((sum, value) => sum + value, 0) / values.length;
      expect(first.mean).toBeCloseTo(sampleMean, 5);
      expect(first.range).toBeCloseTo(Math.max(...values) - Math.min(...values), 5);
    });

    it('removes systematic bias through calibration without claiming zero uncertainty', () => {
      const biased = generateMeasurementStudy({
        ...studyData,
        trueValue: 25,
        resolution: 0.1,
        randomError: 0,
        systematicBias: 3,
        calibrated: false,
      });
      const calibrated = generateMeasurementStudy({
        ...studyData,
        trueValue: 25,
        resolution: 0.1,
        randomError: 0,
        systematicBias: 3,
        calibrated: true,
      });

      expect(biased.effectiveBias).toBe(3);
      expect(biased.mean).toBe(28);
      expect(calibrated.effectiveBias).toBe(0);
      expect(calibrated.mean).toBe(25);
      expect(calibrated.absoluteError).toBeLessThan(biased.absoluteError);
    });
  });

  describe('Mendelian genetics', () => {
    it('produces the exact 1:2:1 genotype and 3:1 dominant phenotype expectations', () => {
      const result = simulateGenetics({
        kind: 'genetics',
        parent1Genotype: 'Aa',
        parent2Genotype: 'Aa',
        dominanceMode: 'complete',
        offspringCount: 80,
        seed: 19,
      });
      const genotypeCounts = Object.fromEntries(
        result.expectedGenotypes.map(({ label, count }) => [label, count]),
      );
      const phenotypeCounts = Object.fromEntries(
        result.expectedPhenotypes.map(({ label, count }) => [label, count]),
      );

      expect(genotypeCounts).toEqual({ AA: 1, Aa: 2, aa: 1 });
      expect(phenotypeCounts).toEqual({
        'dominant phenotype': 3,
        'recessive phenotype': 1,
      });
      expect(result.expectedGenotypes.reduce((sum, part) => sum + part.probability, 0)).toBe(1);
    });

    it('keeps seeded allele frequencies independent of dominance labels', () => {
      const base = {
        kind: 'genetics' as const,
        parent1Genotype: 'Aa' as const,
        parent2Genotype: 'aa' as const,
        offspringCount: 120,
        seed: 90210,
      };
      const complete = simulateGenetics({ ...base, dominanceMode: 'complete' });
      const codominant = simulateGenetics({ ...base, dominanceMode: 'codominant' });

      expect(complete.offspring.map((offspring) => offspring.genotype)).toEqual(
        codominant.offspring.map((offspring) => offspring.genotype),
      );
      expect(complete.expectedPhenotypes.map((part) => part.probability)).toEqual([0.5, 0.5]);
      expect(complete.offspring.some((offspring, index) => (
        offspring.phenotype !== codominant.offspring[index].phenotype
      ))).toBe(true);
    });
  });

  describe('reaction-rate factors', () => {
    const baselineData = {
      kind: 'reaction-rate' as const,
      temperatureC: 25,
      concentrationRelative: 1,
      surfaceAreaFactor: 1,
      catalystEnabled: false,
      seed: 42,
    };

    it('changes only relative rate indices in the expected factor directions', () => {
      const baseline = calculateReactionRate(baselineData);
      const warmer = calculateReactionRate({ ...baselineData, temperatureC: 60 });
      const concentrated = calculateReactionRate({ ...baselineData, concentrationRelative: 2 });
      const greaterArea = calculateReactionRate({ ...baselineData, surfaceAreaFactor: 3 });
      const catalysed = calculateReactionRate({ ...baselineData, catalystEnabled: true });

      expect(warmer.relativeRateIndex).toBeGreaterThan(baseline.relativeRateIndex);
      expect(concentrated.relativeRateIndex).toBeGreaterThan(baseline.relativeRateIndex);
      expect(greaterArea.relativeRateIndex).toBeGreaterThan(baseline.relativeRateIndex);
      expect(catalysed.activationBarrierIndex).toBeLessThan(baseline.activationBarrierIndex);
      expect(catalysed.relativeRateIndex).toBeGreaterThan(baseline.relativeRateIndex);
      expect(baseline.limitation).toMatch(/relative model indices.*not an absolute laboratory rate/i);
    });

    it('holds the seeded microstate fixed when comparing a catalyst counterfactual', () => {
      const uncatalysed = calculateReactionRate(baselineData);
      const catalysed = calculateReactionRate({ ...baselineData, catalystEnabled: true });

      expect(catalysed.particles.map(({ id, x, y, directionDeg, speedRelative }) => ({
        id,
        x,
        y,
        directionDeg,
        speedRelative,
      }))).toEqual(uncatalysed.particles.map(({ id, x, y, directionDeg, speedRelative }) => ({
        id,
        x,
        y,
        directionDeg,
        speedRelative,
      })));
      for (let index = 1; index < catalysed.concentrationCurve.length; index += 1) {
        expect(catalysed.concentrationCurve[index].concentrationPercent).toBeLessThanOrEqual(
          catalysed.concentrationCurve[index - 1].concentrationPercent,
        );
      }
    });
  });

  describe('carbon reservoirs, fluxes and climate trend', () => {
    const climateData = {
      kind: 'carbon-climate' as const,
      combustion: 40,
      photosynthesis: 55,
      oceanUptake: 45,
      albedo: 0.3,
      greenhouseGasPpm: 420,
    };

    it('keeps every reported stock and trajectory consistent with actual endpoint fluxes', () => {
      const reservoirIds = ['atmosphere', 'biosphere', 'hydrosphere', 'geosphere'] as const;
      const initialStocks = {
        atmosphere: 870,
        biosphere: 550,
        hydrosphere: 38_000,
        geosphere: 4_000,
      } as const;
      const endpointPercentages = [0, 100] as const;
      const endpointAlbedos = [0.2, 0.45] as const;
      const endpointConcentrations = [280, 800] as const;
      let combinations = 0;

      for (const combustion of endpointPercentages) {
        for (const photosynthesis of endpointPercentages) {
          for (const oceanUptake of endpointPercentages) {
            for (const albedo of endpointAlbedos) {
              for (const greenhouseGasPpm of endpointConcentrations) {
                combinations += 1;
                const result = calculateCarbonClimate({
                  kind: 'carbon-climate',
                  combustion,
                  photosynthesis,
                  oceanUptake,
                  albedo,
                  greenhouseGasPpm,
                });
                const annualBalances = {
                  atmosphere: 0,
                  biosphere: 0,
                  hydrosphere: 0,
                  geosphere: 0,
                };

                for (const flux of result.fluxes) {
                  expect(flux.rateGtPerYear).toBeGreaterThanOrEqual(0);
                  annualBalances[flux.from] -= flux.rateGtPerYear;
                  annualBalances[flux.to] += flux.rateGtPerYear;
                }

                for (const reservoirId of reservoirIds) {
                  const expectedChange = annualBalances[reservoirId] * result.projectionYears;
                  const reservoir = result.reservoirs[reservoirId];
                  expect(reservoir.changeGt).toBeCloseTo(expectedChange, 8);
                  expect(reservoir.carbonGt).toBeCloseTo(
                    initialStocks[reservoirId] + expectedChange,
                    8,
                  );
                  expect(reservoir.carbonGt).toBeGreaterThanOrEqual(0);
                }

                const finalStock = reservoirIds.reduce(
                  (sum, reservoirId) => sum + result.reservoirs[reservoirId].carbonGt,
                  0,
                );
                expect(finalStock).toBeCloseTo(
                  reservoirIds.reduce((sum, reservoirId) => sum + initialStocks[reservoirId], 0),
                  8,
                );
                expect(result.atmosphericChangeGtPerYear).toBeCloseTo(
                  annualBalances.atmosphere,
                  8,
                );

                for (const point of result.trajectory) {
                  expect(point.atmosphereGt).toBeCloseTo(
                    initialStocks.atmosphere + annualBalances.atmosphere * point.year,
                    8,
                  );
                  expect(point.atmosphereGt).toBeGreaterThanOrEqual(0);
                }
                expect(result.trajectory.at(-1)?.atmosphereGt).toBe(
                  result.reservoirs.atmosphere.carbonGt,
                );
                expect(Number.isFinite(result.projectedCo2Ppm)).toBe(true);
                expect(Number.isFinite(result.temperatureProxyC)).toBe(true);
              }
            }
          }
        }
      }

      expect(combinations).toBe(32);
    });

    it('reduces the paired reported transfer when atmosphere or biosphere stock is insufficient', () => {
      const atmosphereLimited = calculateCarbonClimate({
        ...climateData,
        combustion: 0,
        photosynthesis: 100,
        oceanUptake: 100,
      });
      const biosphereLimited = calculateCarbonClimate({
        ...climateData,
        photosynthesis: 0,
      });
      const photosynthesisFlux = atmosphereLimited.fluxes.find(
        (flux) => flux.id === 'photosynthesis',
      );
      const oceanFlux = atmosphereLimited.fluxes.find((flux) => flux.id === 'ocean-uptake');
      const respirationFlux = biosphereLimited.fluxes.find((flux) => flux.id === 'respiration');

      expect(photosynthesisFlux?.rateGtPerYear).toBeLessThan(150);
      expect(oceanFlux?.rateGtPerYear).toBeLessThan(4);
      expect(respirationFlux?.rateGtPerYear).toBeLessThan(118);
      expect(atmosphereLimited.reservoirs.atmosphere.carbonGt).toBeGreaterThanOrEqual(0);
      expect(biosphereLimited.reservoirs.biosphere.carbonGt).toBeGreaterThanOrEqual(0);
    });

    it('projects a stronger atmospheric and warming trend as combustion rises', () => {
      const lowEmissions = calculateCarbonClimate({ ...climateData, combustion: 10 });
      const highEmissions = calculateCarbonClimate({ ...climateData, combustion: 90 });

      expect(highEmissions.atmosphericChangeGtPerYear).toBeGreaterThan(
        lowEmissions.atmosphericChangeGtPerYear,
      );
      expect(highEmissions.reservoirs.geosphere.carbonGt).toBeLessThan(
        lowEmissions.reservoirs.geosphere.carbonGt,
      );
      expect(highEmissions.projectedCo2Ppm).toBeGreaterThan(lowEmissions.projectedCo2Ppm);
      expect(highEmissions.temperatureProxyC).toBeGreaterThan(lowEmissions.temperatureProxyC);
    });
  });

  describe('radioactive half-life', () => {
    const halfLifeData = {
      kind: 'half-life' as const,
      initialNuclei: 128,
      halfLifeSeconds: 20,
      elapsedTimeSeconds: 20,
      timeStepSeconds: 5,
      seed: 1234,
    };

    it('repeats the same finite decay sample for the same seed', () => {
      expect(createDecayNuclei(128, 20, 1234)).toEqual(createDecayNuclei(128, 20, 1234));
      expect(calculateHalfLife(halfLifeData)).toEqual(calculateHalfLife(halfLifeData));
    });

    it('decays monotonically while retaining the theoretical half-life relationship', () => {
      const times = [0, 10, 20, 40, 80];
      const results = times.map((elapsedTimeSeconds) => calculateHalfLife({
        ...halfLifeData,
        elapsedTimeSeconds,
      }));

      for (const result of results) {
        expect(result.remainingCount + result.decayedCount).toBe(128);
      }
      for (let index = 1; index < results.length; index += 1) {
        expect(results[index].remainingCount).toBeLessThanOrEqual(results[index - 1].remainingCount);
      }
      expect(results[2].theoreticalRemaining).toBeCloseTo(64, 8);
      expect(results[3].theoreticalRemaining).toBeCloseTo(32, 8);
      expect(results[2].remainingCount).not.toBe(results[2].theoreticalRemaining);
    });
  });

  describe('Moon phases, tides and eclipse alignment', () => {
    it('links phase geometry to illumination and spring/neap tide ranges', () => {
      const newMoon = calculateMoonTides({
        kind: 'moon-tides',
        orbitalAngleDeg: 0,
        orbitalInclinationDeg: 5.1,
      });
      const firstQuarter = calculateMoonTides({
        kind: 'moon-tides',
        orbitalAngleDeg: 90,
        orbitalInclinationDeg: 5.1,
      });
      const fullMoon = calculateMoonTides({
        kind: 'moon-tides',
        orbitalAngleDeg: 180,
        orbitalInclinationDeg: 5.1,
      });

      expect(newMoon.phaseName).toBe('New Moon');
      expect(newMoon.illuminatedFraction).toBe(0);
      expect(firstQuarter.phaseName).toBe('First quarter');
      expect(firstQuarter.illuminatedFraction).toBe(0.5);
      expect(fullMoon.phaseName).toBe('Full Moon');
      expect(fullMoon.illuminatedFraction).toBe(1);
      expect(newMoon.tideType).toBe('spring');
      expect(firstQuarter.tideType).toBe('neap');
      expect(newMoon.tideRangeMetres).toBeGreaterThan(firstQuarter.tideRangeMetres);
    });

    it('requires node-plane proximity, so syzygy does not imply a monthly eclipse', () => {
      const inclinedNewMoon = calculateMoonTides({
        kind: 'moon-tides',
        orbitalAngleDeg: 0,
        orbitalInclinationDeg: 5.1,
      });
      const nodeAlignedNewMoon = calculateMoonTides({
        kind: 'moon-tides',
        orbitalAngleDeg: 0,
        orbitalInclinationDeg: 0,
      });
      const nodeAlignedFullMoon = calculateMoonTides({
        kind: 'moon-tides',
        orbitalAngleDeg: 180,
        orbitalInclinationDeg: 0,
      });

      expect(inclinedNewMoon.eclipseStatus).toBe('shadow misses');
      expect(nodeAlignedNewMoon.eclipseStatus).toBe('solar eclipse alignment');
      expect(nodeAlignedFullMoon.eclipseStatus).toBe('lunar eclipse alignment');
    });
  });

  describe('cell-to-tissue failure cascades', () => {
    it('propagates organelle failure through tissue and organ-system output', () => {
      const healthy = calculateCellSystem({
        kind: 'cell-system',
        cellType: 'animal',
        membraneFunction: 95,
        mitochondriaFunction: 95,
        chloroplastFunction: 0,
        tissueDemand: 60,
      });
      const membraneFailure = calculateCellSystem({
        kind: 'cell-system',
        cellType: 'animal',
        membraneFunction: 15,
        mitochondriaFunction: 95,
        chloroplastFunction: 100,
        tissueDemand: 60,
      });

      expect(membraneFailure.limitingFunction).toBe('membrane transport');
      expect(membraneFailure.tissueOutputPercent).toBeLessThan(healthy.tissueOutputPercent);
      expect(membraneFailure.organSystemOutputPercent).toBeLessThan(
        healthy.organSystemOutputPercent,
      );
      expect(membraneFailure.cascade.map((stage) => stage.status)).toEqual([
        'failing',
        'failing',
        'failing',
      ]);
      expect(membraneFailure.cascade[1].outputPercent).toBe(
        membraneFailure.tissueOutputPercent,
      );
      expect(membraneFailure.cascade[2].outputPercent).toBe(
        membraneFailure.organSystemOutputPercent,
      );
    });

    it('makes chloroplast failure consequential for plants but irrelevant to animals', () => {
      const animalBase = {
        kind: 'cell-system' as const,
        cellType: 'animal' as const,
        membraneFunction: 90,
        mitochondriaFunction: 90,
        tissueDemand: 60,
      };
      const animalWithoutChloroplasts = calculateCellSystem({
        ...animalBase,
        chloroplastFunction: 0,
      });
      const animalWithChloroplasts = calculateCellSystem({
        ...animalBase,
        chloroplastFunction: 100,
      });
      const plantWithoutChloroplastFunction = calculateCellSystem({
        ...animalBase,
        cellType: 'plant',
        chloroplastFunction: 0,
      });
      const healthyPlant = calculateCellSystem({
        ...animalBase,
        cellType: 'plant',
        chloroplastFunction: 100,
      });

      expect(animalWithoutChloroplasts).toEqual(animalWithChloroplasts);
      expect(animalWithoutChloroplasts.photosynthesisPercent).toBeNull();
      expect(plantWithoutChloroplastFunction.photosynthesisPercent).toBe(0);
      expect(plantWithoutChloroplastFunction.limitingFunction).toBe('photosynthesis');
      expect(plantWithoutChloroplastFunction.tissueOutputPercent).toBeLessThan(
        healthyPlant.tissueOutputPercent,
      );
      expect(plantWithoutChloroplastFunction.organSystemOutputPercent).toBeLessThan(
        healthyPlant.organSystemOutputPercent,
      );
    });
  });
});
