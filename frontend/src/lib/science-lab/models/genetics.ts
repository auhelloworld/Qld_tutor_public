import { createSeededRandom } from '../seeded-random';

export type Allele = 'A' | 'a';
export type DiploidGenotype = 'AA' | 'Aa' | 'aa';
export type DominanceMode = 'complete' | 'incomplete' | 'codominant';

export interface GeneticsSceneData {
  kind: 'genetics';
  parent1Genotype: DiploidGenotype;
  parent2Genotype: DiploidGenotype;
  dominanceMode: DominanceMode;
  offspringCount: number;
  seed: number;
}

export interface RatioPart {
  label: string;
  count: number;
  probability: number;
}

export interface OffspringRecord {
  index: number;
  parent1Allele: Allele;
  parent2Allele: Allele;
  genotype: DiploidGenotype;
  phenotype: string;
}

export interface GeneticsResult {
  punnett: DiploidGenotype[][];
  parent1Gametes: Allele[];
  parent2Gametes: Allele[];
  expectedGenotypes: RatioPart[];
  expectedPhenotypes: RatioPart[];
  observedGenotypes: RatioPart[];
  observedPhenotypes: RatioPart[];
  offspring: OffspringRecord[];
  limitation: string;
}

const GENOTYPES: DiploidGenotype[] = ['AA', 'Aa', 'aa'];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function allelesFor(genotype: DiploidGenotype): [Allele, Allele] {
  if (genotype === 'AA') return ['A', 'A'];
  if (genotype === 'aa') return ['a', 'a'];
  return ['A', 'a'];
}

function combineAlleles(first: Allele, second: Allele): DiploidGenotype {
  if (first === 'A' && second === 'A') return 'AA';
  if (first === 'a' && second === 'a') return 'aa';
  return 'Aa';
}

export function phenotypeFor(
  genotype: DiploidGenotype,
  dominanceMode: DominanceMode,
): string {
  if (dominanceMode === 'complete') {
    return genotype === 'aa' ? 'recessive phenotype' : 'dominant phenotype';
  }
  if (dominanceMode === 'incomplete') {
    if (genotype === 'AA') return 'A homozygous phenotype';
    if (genotype === 'Aa') return 'intermediate phenotype';
    return 'a homozygous phenotype';
  }
  if (genotype === 'AA') return 'A phenotype';
  if (genotype === 'Aa') return 'both A and a phenotypes';
  return 'a phenotype';
}

function ratioParts(labels: string[], values: string[]): RatioPart[] {
  return labels.map((label) => {
    const count = values.filter((value) => value === label).length;
    return { label, count, probability: values.length === 0 ? 0 : count / values.length };
  });
}

function uniqueInOrder(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

/**
 * Produces the exact Punnett probabilities and a repeatable finite sample.
 * Dominance changes phenotype labels, not allele sampling probabilities.
 */
export function simulateGenetics(data: GeneticsSceneData): GeneticsResult {
  const parent1Gametes = allelesFor(data.parent1Genotype);
  const parent2Gametes = allelesFor(data.parent2Genotype);
  const punnett = parent1Gametes.map((first) => (
    parent2Gametes.map((second) => combineAlleles(first, second))
  ));
  const exactGenotypes = punnett.flat();
  const exactPhenotypes = exactGenotypes.map((genotype) => (
    phenotypeFor(genotype, data.dominanceMode)
  ));

  const offspringCount = Math.round(clamp(
    Number.isFinite(data.offspringCount) ? data.offspringCount : 40,
    4,
    200,
  ));
  const seed = (Number.isFinite(data.seed) ? data.seed : 42) | 0;
  const rng = createSeededRandom(seed);
  const offspring: OffspringRecord[] = Array.from({ length: offspringCount }, (_, index) => {
    const parent1Allele = parent1Gametes[Math.floor(rng() * 2)];
    const parent2Allele = parent2Gametes[Math.floor(rng() * 2)];
    const genotype = combineAlleles(parent1Allele, parent2Allele);
    return {
      index: index + 1,
      parent1Allele,
      parent2Allele,
      genotype,
      phenotype: phenotypeFor(genotype, data.dominanceMode),
    };
  });
  const observedGenotypeValues = offspring.map((record) => record.genotype);
  const observedPhenotypeValues = offspring.map((record) => record.phenotype);
  const phenotypeLabels = uniqueInOrder(exactPhenotypes);

  return {
    punnett,
    parent1Gametes,
    parent2Gametes,
    expectedGenotypes: ratioParts(GENOTYPES, exactGenotypes),
    expectedPhenotypes: ratioParts(phenotypeLabels, exactPhenotypes),
    observedGenotypes: ratioParts(GENOTYPES, observedGenotypeValues),
    observedPhenotypes: ratioParts(phenotypeLabels, observedPhenotypeValues),
    offspring,
    limitation: 'This single-gene model assumes independent segregation and equal gamete probability; real traits may involve linkage, multiple genes, environment, mutation, or unequal viability.',
  };
}

function greatestCommonDivisor(first: number, second: number): number {
  let a = Math.abs(first);
  let b = Math.abs(second);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

export function formatRatio(parts: RatioPart[], simplify = false): string {
  const nonZero = parts.filter((part) => part.count > 0);
  if (nonZero.length === 0) return 'none';
  const divisor = simplify
    ? nonZero.reduce((common, part) => greatestCommonDivisor(common, part.count), nonZero[0].count)
    : 1;
  return nonZero
    .map((part) => `${part.label} ${part.count / divisor}`)
    .join(' : ');
}
