/**
 * Food Web Ecosystem Dynamics Pure Model
 * Models trophic cascades, the 10% ecological energy rule, and matter cycling.
 */

export interface SpeciesNode {
  id: string;
  name: string;
  trophicLevel: 'producer' | 'herbivore' | 'carnivore' | 'apex' | 'decomposer';
  baseBiomassKg: number;
  currentBiomassKg: number;
  energyKj: number;
  x: number;
  y: number;
}

export interface FoodWebLink {
  from: string;
  to: string;
  type: 'energy' | 'matter' | 'both';
  label?: string;
}

export interface EcosystemState {
  generation: number;
  species: Record<string, SpeciesNode>;
  perturbation: 'none' | 'remove_predator' | 'drought' | 'insect_crash';
  activeLayer: 'all' | 'matter' | 'energy';
}

export const INITIAL_SPECIES: Record<string, SpeciesNode> = {
  grasses: {
    id: 'grasses',
    name: 'Native Grasses',
    trophicLevel: 'producer',
    baseBiomassKg: 10000,
    currentBiomassKg: 10000,
    energyKj: 100000,
    x: 80,
    y: 280,
  },
  acacia: {
    id: 'acacia',
    name: 'Acacia Shrubs',
    trophicLevel: 'producer',
    baseBiomassKg: 8000,
    currentBiomassKg: 8000,
    energyKj: 80000,
    x: 200,
    y: 280,
  },
  insects: {
    id: 'insects',
    name: 'Grasshoppers & Beetles',
    trophicLevel: 'herbivore',
    baseBiomassKg: 1200,
    currentBiomassKg: 1200,
    energyKj: 12000,
    x: 80,
    y: 170,
  },
  wallaby: {
    id: 'wallaby',
    name: 'Agile Wallaby',
    trophicLevel: 'herbivore',
    baseBiomassKg: 800,
    currentBiomassKg: 800,
    energyKj: 8000,
    x: 200,
    y: 170,
  },
  quoll: {
    id: 'quoll',
    name: 'Northern Quoll',
    trophicLevel: 'carnivore',
    baseBiomassKg: 150,
    currentBiomassKg: 150,
    energyKj: 1500,
    x: 100,
    y: 70,
  },
  eagle: {
    id: 'eagle',
    name: 'Wedge-tailed Eagle',
    trophicLevel: 'apex',
    baseBiomassKg: 30,
    currentBiomassKg: 30,
    energyKj: 300,
    x: 220,
    y: 50,
  },
  decomposers: {
    id: 'decomposers',
    name: 'Soil Fungi & Bacteria',
    trophicLevel: 'decomposer',
    baseBiomassKg: 2000,
    currentBiomassKg: 2000,
    energyKj: 500,
    x: 340,
    y: 220,
  },
};

export const FOOD_WEB_LINKS: FoodWebLink[] = [
  // Grazing / Predation links (Energy & Matter)
  { from: 'grasses', to: 'insects', type: 'both' },
  { from: 'grasses', to: 'wallaby', type: 'both' },
  { from: 'acacia', to: 'wallaby', type: 'both' },
  { from: 'insects', to: 'quoll', type: 'both' },
  { from: 'wallaby', to: 'eagle', type: 'both' },
  { from: 'quoll', to: 'eagle', type: 'both' },

  // Decomposer inputs (Matter & minimal residual chemical energy)
  { from: 'grasses', to: 'decomposers', type: 'matter' },
  { from: 'insects', to: 'decomposers', type: 'matter' },
  { from: 'wallaby', to: 'decomposers', type: 'matter' },
  { from: 'quoll', to: 'decomposers', type: 'matter' },
  { from: 'eagle', to: 'decomposers', type: 'matter' },

  // Nutrient recycling (Matter only - Soil nutrients back to Plants)
  { from: 'decomposers', to: 'grasses', type: 'matter', label: 'Soil Nutrients (N, P)' },
  { from: 'decomposers', to: 'acacia', type: 'matter', label: 'Soil Nutrients (N, P)' },
];

export function propagateFoodWebChange(
  currentSpecies: Record<string, SpeciesNode>,
  perturbation: 'none' | 'remove_predator' | 'drought' | 'insect_crash',
  generations: number,
): Record<string, SpeciesNode> {
  const result: Record<string, SpeciesNode> = JSON.parse(JSON.stringify(currentSpecies));

  for (let g = 0; g < generations; g++) {
    if (perturbation === 'remove_predator') {
      result.eagle.currentBiomassKg = 0;
      result.quoll.currentBiomassKg = Math.max(0, result.quoll.currentBiomassKg * 0.2);
      // Herbivores boom due to lack of predation
      result.wallaby.currentBiomassKg = Math.min(2200, result.wallaby.currentBiomassKg * 1.15);
      result.insects.currentBiomassKg = Math.min(2600, result.insects.currentBiomassKg * 1.12);
      // Overgrazing reduces producers
      result.grasses.currentBiomassKg = Math.max(2500, result.grasses.currentBiomassKg * 0.85);
      result.acacia.currentBiomassKg = Math.max(3000, result.acacia.currentBiomassKg * 0.88);
    } else if (perturbation === 'drought') {
      // Producers crash
      result.grasses.currentBiomassKg = Math.max(1500, result.grasses.currentBiomassKg * 0.7);
      result.acacia.currentBiomassKg = Math.max(2000, result.acacia.currentBiomassKg * 0.75);
      // Herbivores decline from starvation
      result.wallaby.currentBiomassKg = Math.max(200, result.wallaby.currentBiomassKg * 0.8);
      result.insects.currentBiomassKg = Math.max(300, result.insects.currentBiomassKg * 0.78);
      // Predators decline
      result.quoll.currentBiomassKg = Math.max(30, result.quoll.currentBiomassKg * 0.8);
      result.eagle.currentBiomassKg = Math.max(5, result.eagle.currentBiomassKg * 0.75);
    } else if (perturbation === 'insect_crash') {
      result.insects.currentBiomassKg = Math.max(50, result.insects.currentBiomassKg * 0.1);
      // Quoll crashes due to food loss
      result.quoll.currentBiomassKg = Math.max(20, result.quoll.currentBiomassKg * 0.6);
      // Grasses recover partially
      result.grasses.currentBiomassKg = Math.min(13000, result.grasses.currentBiomassKg * 1.05);
    } else {
      // Natural recovery towards baseline
      for (const key of Object.keys(result)) {
        const node = result[key];
        node.currentBiomassKg += (node.baseBiomassKg - node.currentBiomassKg) * 0.2;
      }
    }
  }

  return result;
}
