export type SeparationScenarioId =
  | 'sand-salt-water'
  | 'ink'
  | 'ethanol-water';

export type SeparationMethod =
  | 'filtration'
  | 'evaporation'
  | 'crystallisation'
  | 'chromatography'
  | 'distillation'
  | 'decantation';

export type ComponentId =
  | 'sand'
  | 'salt'
  | 'water'
  | 'blue-dye'
  | 'yellow-dye'
  | 'red-dye'
  | 'ethanol';

export type ComponentAmounts = Partial<Record<ComponentId, number>>;

export interface SeparationScenario {
  id: SeparationScenarioId;
  label: string;
  description: string;
  initial: ComponentAmounts;
  componentOrder: ComponentId[];
  suggestedSequence: SeparationMethod[];
}

export interface SeparationProduct {
  step: number;
  method: SeparationMethod;
  targetComponents: ComponentId[];
  amounts: ComponentAmounts;
  purityPercent: number;
  yieldPercent: number;
}

export interface SeparationHistoryEntry {
  step: number;
  method: SeparationMethod;
  fit: 'strong' | 'partial' | 'poor';
  feedback: string;
  changedMixture: boolean;
}

export interface SeparationState {
  scenarioId: SeparationScenarioId;
  initial: ComponentAmounts;
  remaining: ComponentAmounts;
  recovered: ComponentAmounts;
  lost: ComponentAmounts;
  products: SeparationProduct[];
  history: SeparationHistoryEntry[];
}

interface ProcessRule {
  targetComponents: ComponentId[];
  capture: ComponentAmounts;
  loss?: ComponentAmounts;
  purityScale: number;
  fit: SeparationHistoryEntry['fit'];
  feedback: string;
}

export const SEPARATION_METHOD_LABELS: Record<SeparationMethod, string> = {
  filtration: 'Filtration',
  evaporation: 'Evaporation',
  crystallisation: 'Crystallisation',
  chromatography: 'Chromatography',
  distillation: 'Distillation',
  decantation: 'Decantation',
};

export const COMPONENT_LABELS: Record<ComponentId, string> = {
  sand: 'Sand',
  salt: 'Salt',
  water: 'Water',
  'blue-dye': 'Blue dye',
  'yellow-dye': 'Yellow dye',
  'red-dye': 'Red dye',
  ethanol: 'Ethanol',
};

export const SEPARATION_SCENARIOS: Record<SeparationScenarioId, SeparationScenario> = {
  'sand-salt-water': {
    id: 'sand-salt-water',
    label: 'Sand + salt + water',
    description: 'An insoluble solid and a dissolved solid in water.',
    initial: { sand: 40, salt: 25, water: 100 },
    componentOrder: ['sand', 'salt', 'water'],
    suggestedSequence: ['filtration', 'crystallisation', 'distillation'],
  },
  ink: {
    id: 'ink',
    label: 'Water-based ink',
    description: 'Several soluble dyes carried by water.',
    initial: { water: 90, 'blue-dye': 3, 'yellow-dye': 3, 'red-dye': 3 },
    componentOrder: ['blue-dye', 'yellow-dye', 'red-dye', 'water'],
    suggestedSequence: ['chromatography'],
  },
  'ethanol-water': {
    id: 'ethanol-water',
    label: 'Ethanol + water',
    description: 'Two miscible liquids with different boiling ranges.',
    initial: { ethanol: 60, water: 40 },
    componentOrder: ['ethanol', 'water'],
    suggestedSequence: ['distillation'],
  },
};

const EMPTY_RULE: ProcessRule = {
  targetComponents: [],
  capture: {},
  purityScale: 1,
  fit: 'poor',
  feedback: 'This method does not exploit a useful property difference in this mixture.',
};

const RULES: Record<SeparationScenarioId, Partial<Record<SeparationMethod, ProcessRule>>> = {
  'sand-salt-water': {
    filtration: {
      targetComponents: ['sand'],
      capture: { sand: 0.92, salt: 0.01, water: 0.03 },
      purityScale: 1,
      fit: 'strong',
      feedback: 'The insoluble sand is retained while most dissolved salt passes through.',
    },
    decantation: {
      targetComponents: ['sand'],
      capture: { sand: 0.55, salt: 0.02, water: 0.1 },
      purityScale: 1,
      fit: 'partial',
      feedback: 'Settling and pouring removes some liquid, but leaves a wetter, less complete solid recovery.',
    },
    evaporation: {
      targetComponents: ['salt'],
      capture: { salt: 0.72, sand: 0.08 },
      loss: { water: 0.75 },
      purityScale: 0.92,
      fit: 'partial',
      feedback: 'Salt remains as water leaves, but the evaporated water is not recovered.',
    },
    crystallisation: {
      targetComponents: ['salt'],
      capture: { salt: 0.65, sand: 0.02, water: 0.01 },
      loss: { water: 0.35 },
      purityScale: 0.98,
      fit: 'strong',
      feedback: 'Controlled solvent loss forms relatively pure salt crystals.',
    },
    distillation: {
      targetComponents: ['water'],
      capture: { water: 0.78, salt: 0.01 },
      purityScale: 0.98,
      fit: 'strong',
      feedback: 'Boiling and condensing recovers water while non-volatile salt remains.',
    },
  },
  ink: {
    chromatography: {
      targetComponents: ['blue-dye', 'yellow-dye', 'red-dye'],
      capture: {
        'blue-dye': 0.82,
        'yellow-dye': 0.8,
        'red-dye': 0.78,
        water: 0.02,
      },
      purityScale: 0.96,
      fit: 'strong',
      feedback: 'Different attractions to the paper and solvent separate the dye bands.',
    },
    evaporation: {
      targetComponents: ['blue-dye', 'yellow-dye', 'red-dye'],
      capture: { 'blue-dye': 0.65, 'yellow-dye': 0.65, 'red-dye': 0.65 },
      loss: { water: 0.8 },
      purityScale: 0.36,
      fit: 'partial',
      feedback: 'Removing water concentrates all dyes together; it does not separate one dye from another.',
    },
    distillation: {
      targetComponents: ['water'],
      capture: { water: 0.75, 'blue-dye': 0.01, 'yellow-dye': 0.01, 'red-dye': 0.01 },
      purityScale: 0.98,
      fit: 'partial',
      feedback: 'Distillation can recover the solvent, but does not resolve the individual dye mixture.',
    },
  },
  'ethanol-water': {
    distillation: {
      targetComponents: ['ethanol'],
      capture: { ethanol: 0.8, water: 0.1 },
      purityScale: 0.95,
      fit: 'strong',
      feedback: 'Vapour enrichment and condensation recover an ethanol-rich fraction.',
    },
    evaporation: {
      targetComponents: [],
      capture: {},
      loss: { ethanol: 0.7, water: 0.15 },
      purityScale: 1,
      fit: 'poor',
      feedback: 'Uncollected vapour loses material instead of recovering a separated liquid.',
    },
  },
};

function copyAmounts(amounts: ComponentAmounts): ComponentAmounts {
  return { ...amounts };
}

function roundAmount(value: number): number {
  return Math.round(value * 10) / 10;
}

function sumComponents(amounts: ComponentAmounts, components: ComponentId[]): number {
  return components.reduce((total, component) => total + (amounts[component] ?? 0), 0);
}

export function createSeparationState(
  scenarioId: SeparationScenarioId,
): SeparationState {
  const initial = copyAmounts(SEPARATION_SCENARIOS[scenarioId].initial);
  return {
    scenarioId,
    initial,
    remaining: copyAmounts(initial),
    recovered: {},
    lost: {},
    products: [],
    history: [],
  };
}

/** Execute one process step and accumulate recovered, remaining and lost material. */
export function executeSeparationStep(
  state: SeparationState,
  method: SeparationMethod,
): SeparationState {
  const rule = RULES[state.scenarioId][method] ?? EMPTY_RULE;
  const remaining = copyAmounts(state.remaining);
  const recovered = copyAmounts(state.recovered);
  const lost = copyAmounts(state.lost);
  const productAmounts: ComponentAmounts = {};
  const components = SEPARATION_SCENARIOS[state.scenarioId].componentOrder;

  for (const component of components) {
    const available = remaining[component] ?? 0;
    const captured = roundAmount(available * (rule.capture[component] ?? 0));
    const afterCapture = Math.max(0, available - captured);
    const discarded = roundAmount(afterCapture * (rule.loss?.[component] ?? 0));

    remaining[component] = roundAmount(Math.max(0, afterCapture - discarded));
    if (captured > 0) {
      productAmounts[component] = captured;
      recovered[component] = roundAmount((recovered[component] ?? 0) + captured);
    }
    if (discarded > 0) {
      lost[component] = roundAmount((lost[component] ?? 0) + discarded);
    }
  }

  const step = state.history.length + 1;
  const productTotal = sumComponents(productAmounts, components);
  const productTarget = sumComponents(productAmounts, rule.targetComponents);
  const initialTarget = sumComponents(state.initial, rule.targetComponents);
  const recoveredTarget = sumComponents(recovered, rule.targetComponents);
  const purityPercent = productTotal > 0
    ? Math.round((productTarget / productTotal) * rule.purityScale * 100)
    : 0;
  const yieldPercent = initialTarget > 0
    ? Math.min(100, Math.round((recoveredTarget / initialTarget) * 100))
    : 0;
  const changedMixture = productTotal > 0 || Object.values(rule.loss ?? {}).some((value) => value > 0);

  const product: SeparationProduct = {
    step,
    method,
    targetComponents: [...rule.targetComponents],
    amounts: productAmounts,
    purityPercent,
    yieldPercent,
  };

  return {
    ...state,
    remaining,
    recovered,
    lost,
    products: productTotal > 0 ? [...state.products, product] : state.products,
    history: [
      ...state.history,
      {
        step,
        method,
        fit: rule.fit,
        feedback: rule.feedback,
        changedMixture,
      },
    ],
  };
}
