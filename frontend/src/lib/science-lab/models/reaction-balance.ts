export type ReactionId = 'water-formation' | 'methane-combustion' | 'iron-oxidation';
export type SystemMode = 'closed' | 'open';
export type AtomSymbol = 'H' | 'C' | 'O' | 'Fe';

export interface ChemicalSpecies {
  formula: string;
  name: string;
  atoms: Partial<Record<AtomSymbol, number>>;
  state: 's' | 'l' | 'g';
}

export interface ReactionDefinition {
  id: ReactionId;
  label: string;
  reactants: ChemicalSpecies[];
  products: ChemicalSpecies[];
  balancedCoefficients: number[];
  openSystemExplanation: string;
  openExchange: 'product-escapes' | 'reactant-enters';
  openRetentionPercent: number;
}

export interface ReactionBalanceResult {
  reaction: ReactionDefinition;
  coefficients: number[];
  reactantCounts: Partial<Record<AtomSymbol, number>>;
  productCounts: Partial<Record<AtomSymbol, number>>;
  atomSymbols: AtomSymbol[];
  balanced: boolean;
  reactantMassUnits: number;
  productMassUnits: number;
  balanceTiltDeg: number;
  closedBeforeMassUnits: number;
  closedAfterMassUnits: number;
  openBeforeMassUnits: number;
  openAfterMassUnits: number;
  systemMode: SystemMode;
}

const RELATIVE_ATOMIC_MASS: Record<AtomSymbol, number> = {
  H: 1,
  C: 12,
  O: 16,
  Fe: 56,
};

export const REACTIONS: Record<ReactionId, ReactionDefinition> = {
  'water-formation': {
    id: 'water-formation',
    label: 'Hydrogen + oxygen → water',
    reactants: [
      { formula: 'H₂', name: 'hydrogen', atoms: { H: 2 }, state: 'g' },
      { formula: 'O₂', name: 'oxygen', atoms: { O: 2 }, state: 'g' },
    ],
    products: [
      { formula: 'H₂O', name: 'water', atoms: { H: 2, O: 1 }, state: 'l' },
    ],
    balancedCoefficients: [2, 1, 2],
    openSystemExplanation: 'Water vapour can leave the measured container, so measured mass may fall.',
    openExchange: 'product-escapes',
    openRetentionPercent: 75,
  },
  'methane-combustion': {
    id: 'methane-combustion',
    label: 'Methane combustion',
    reactants: [
      { formula: 'CH₄', name: 'methane', atoms: { C: 1, H: 4 }, state: 'g' },
      { formula: 'O₂', name: 'oxygen', atoms: { O: 2 }, state: 'g' },
    ],
    products: [
      { formula: 'CO₂', name: 'carbon dioxide', atoms: { C: 1, O: 2 }, state: 'g' },
      { formula: 'H₂O', name: 'water', atoms: { H: 2, O: 1 }, state: 'g' },
    ],
    balancedCoefficients: [1, 2, 1, 2],
    openSystemExplanation: 'Gaseous products can leave the balance pan unless the system is sealed.',
    openExchange: 'product-escapes',
    openRetentionPercent: 60,
  },
  'iron-oxidation': {
    id: 'iron-oxidation',
    label: 'Iron + oxygen → iron(III) oxide',
    reactants: [
      { formula: 'Fe', name: 'iron', atoms: { Fe: 1 }, state: 's' },
      { formula: 'O₂', name: 'oxygen', atoms: { O: 2 }, state: 'g' },
    ],
    products: [
      { formula: 'Fe₂O₃', name: 'iron(III) oxide', atoms: { Fe: 2, O: 3 }, state: 's' },
    ],
    balancedCoefficients: [4, 3, 2],
    openSystemExplanation: 'Oxygen enters from the air, so the measured solid gains mass.',
    openExchange: 'reactant-enters',
    openRetentionPercent: 100,
  },
};

function coefficient(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(8, Math.round(value ?? 1)));
}

export function normaliseCoefficients(
  reactionId: ReactionId,
  values: number[],
): number[] {
  const reaction = REACTIONS[reactionId];
  const count = reaction.reactants.length + reaction.products.length;
  return Array.from({ length: count }, (_, index) => coefficient(values[index]));
}

function formulaMass(species: ChemicalSpecies): number {
  return (Object.entries(species.atoms) as [AtomSymbol, number][]).reduce(
    (total, [atom, count]) => total + RELATIVE_ATOMIC_MASS[atom] * count,
    0,
  );
}

function countAtoms(
  species: ChemicalSpecies[],
  coefficients: number[],
): Partial<Record<AtomSymbol, number>> {
  const counts: Partial<Record<AtomSymbol, number>> = {};
  species.forEach((item, index) => {
    const multiplier = coefficients[index] ?? 1;
    (Object.entries(item.atoms) as [AtomSymbol, number][]).forEach(([atom, count]) => {
      counts[atom] = (counts[atom] ?? 0) + count * multiplier;
    });
  });
  return counts;
}

function sideMass(species: ChemicalSpecies[], coefficients: number[]): number {
  return species.reduce(
    (total, item, index) => total + formulaMass(item) * (coefficients[index] ?? 1),
    0,
  );
}

/** Count atoms and compare modelled measured mass inside open and closed boundaries. */
export function calculateReactionBalance(
  reactionId: ReactionId,
  rawCoefficients: number[],
  systemMode: SystemMode,
): ReactionBalanceResult {
  const reaction = REACTIONS[reactionId];
  const coefficients = normaliseCoefficients(reactionId, rawCoefficients);
  const split = reaction.reactants.length;
  const reactantCoefficients = coefficients.slice(0, split);
  const productCoefficients = coefficients.slice(split);
  const reactantCounts = countAtoms(reaction.reactants, reactantCoefficients);
  const productCounts = countAtoms(reaction.products, productCoefficients);
  const atomSymbols = Array.from(new Set<AtomSymbol>([
    ...Object.keys(reactantCounts) as AtomSymbol[],
    ...Object.keys(productCounts) as AtomSymbol[],
  ]));
  const balanced = atomSymbols.every(
    (atom) => (reactantCounts[atom] ?? 0) === (productCounts[atom] ?? 0),
  );
  const reactantMassUnits = sideMass(reaction.reactants, reactantCoefficients);
  const productMassUnits = sideMass(reaction.products, productCoefficients);
  const largerMass = Math.max(reactantMassUnits, productMassUnits, 1);
  const balanceTiltDeg = Math.max(
    -14,
    Math.min(14, ((productMassUnits - reactantMassUnits) / largerMass) * 18),
  );

  let openBeforeMassUnits = reactantMassUnits;
  let openAfterMassUnits = productMassUnits;
  if (reaction.openExchange === 'product-escapes') {
    openAfterMassUnits = Math.round(productMassUnits * (reaction.openRetentionPercent / 100));
  } else {
    openBeforeMassUnits = reaction.reactants.reduce((total, item, index) => {
      if (item.state === 'g') return total;
      return total + formulaMass(item) * (reactantCoefficients[index] ?? 1);
    }, 0);
  }

  return {
    reaction,
    coefficients,
    reactantCounts,
    productCounts,
    atomSymbols,
    balanced,
    reactantMassUnits,
    productMassUnits,
    balanceTiltDeg,
    closedBeforeMassUnits: reactantMassUnits,
    closedAfterMassUnits: productMassUnits,
    openBeforeMassUnits,
    openAfterMassUnits,
    systemMode,
  };
}
