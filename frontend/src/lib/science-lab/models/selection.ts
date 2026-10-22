/**
 * Natural Selection & Allele Frequency Pure Model
 */

import { createSeededRandom } from '../seeded-random';

export interface Organism {
  id: number;
  genotype: 'DD' | 'Dd' | 'dd';
  phenotype: 'dark' | 'light';
  survived: boolean;
  x: number;
  y: number;
}

export interface GenerationRecord {
  generation: number;
  pDarkAllele: number;
  qLightAllele: number;
  darkPhenotypePercent: number;
  lightPhenotypePercent: number;
  populationSize: number;
}

export interface SelectionState {
  generation: number;
  population: Organism[];
  history: GenerationRecord[];
  environmentDarkness: number; // 0 (light) to 1 (dark)
  selectionPressure: number;   // 0 (no predation) to 1 (maximum)
  pFrequency: number;
  seed: number;
}

const HABITAT_WIDTH = 380;
const HABITAT_HEIGHT = 180;
/** Keeps the complete moth shape, including its wings, inside the habitat. */
const ORGANISM_MARGIN = 12;

function randomHabitatPosition(rng: () => number): Pick<Organism, 'x' | 'y'> {
  return {
    x: ORGANISM_MARGIN + rng() * (HABITAT_WIDTH - ORGANISM_MARGIN * 2),
    y: ORGANISM_MARGIN + rng() * (HABITAT_HEIGHT - ORGANISM_MARGIN * 2),
  };
}

export function initSelectionState(
  initialP = 0.2,
  environmentDarkness = 0.8,
  selectionPressure = 0.7,
  populationSize = 100,
  seed = 42,
): SelectionState {
  const rng = createSeededRandom(seed);
  const p = Math.max(0.05, Math.min(0.95, initialP));
  const q = 1 - p;

  const population: Organism[] = [];
  let darkCount = 0;

  for (let i = 0; i < populationSize; i++) {
    const r1 = rng();
    const r2 = rng();
    const a1 = r1 < p ? 'D' : 'd';
    const a2 = r2 < p ? 'D' : 'd';
    const genotype = (a1 === 'D' && a2 === 'D') ? 'DD' : (a1 === 'd' && a2 === 'd') ? 'dd' : 'Dd';
    const phenotype = genotype === 'dd' ? 'light' : 'dark';
    if (phenotype === 'dark') darkCount++;

    population.push({
      id: i,
      genotype,
      phenotype,
      survived: true,
      ...randomHabitatPosition(rng),
    });
  }

  const darkPercent = Math.round((darkCount / populationSize) * 100);
  const initialRecord: GenerationRecord = {
    generation: 0,
    pDarkAllele: Number(p.toFixed(3)),
    qLightAllele: Number(q.toFixed(3)),
    darkPhenotypePercent: darkPercent,
    lightPhenotypePercent: 100 - darkPercent,
    populationSize,
  };

  return {
    generation: 0,
    population,
    history: [initialRecord],
    environmentDarkness,
    selectionPressure,
    pFrequency: p,
    seed,
  };
}

export function stepGeneration(state: SelectionState): SelectionState {
  const nextGen = state.generation + 1;
  const rng = createSeededRandom(state.seed + nextGen * 1000);
  const N = state.population.length;

  // Relative fitness based on camouflage contrast with background.
  const darkFitness = 1.0 - Math.abs(1.0 - state.environmentDarkness) * state.selectionPressure;
  const lightFitness = 1.0 - Math.abs(0.0 - state.environmentDarkness) * state.selectionPressure;

  const wDark = Math.max(0.05, darkFitness);
  const wLight = Math.max(0.05, lightFitness);
  const currentP = state.pFrequency;
  const currentQ = 1 - currentP;

  // Genotype frequencies before selection.
  const fDD = currentP * currentP;
  const fDd = 2 * currentP * currentQ;
  const fdd = currentQ * currentQ;
  const wBar = (fDD + fDd) * wDark + fdd * wLight;
  const expectedP = (fDD * wDark + 0.5 * fDd * wDark) / wBar;

  // Sample the next generation with stochastic binomial sampling.
  let darkAlleleCount = 0;
  const nextPopulation: Organism[] = [];
  let darkPhenoCount = 0;

  for (let i = 0; i < N; i++) {
    const a1 = rng() < expectedP ? 'D' : 'd';
    const a2 = rng() < expectedP ? 'D' : 'd';
    if (a1 === 'D') darkAlleleCount++;
    if (a2 === 'D') darkAlleleCount++;

    const genotype = (a1 === 'D' && a2 === 'D') ? 'DD' : (a1 === 'd' && a2 === 'd') ? 'dd' : 'Dd';
    const phenotype = genotype === 'dd' ? 'light' : 'dark';
    if (phenotype === 'dark') darkPhenoCount++;

    nextPopulation.push({
      id: i,
      genotype,
      phenotype,
      survived: true,
      ...randomHabitatPosition(rng),
    });
  }

  const newP = darkAlleleCount / (2 * N);
  const newQ = 1 - newP;
  const darkPercent = Math.round((darkPhenoCount / N) * 100);

  const record: GenerationRecord = {
    generation: nextGen,
    pDarkAllele: Number(newP.toFixed(3)),
    qLightAllele: Number(newQ.toFixed(3)),
    darkPhenotypePercent: darkPercent,
    lightPhenotypePercent: 100 - darkPercent,
    populationSize: N,
  };

  return {
    ...state,
    generation: nextGen,
    population: nextPopulation,
    history: [...state.history.slice(-59), record],
    pFrequency: newP,
  };
}
