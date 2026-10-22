export interface EnergyEfficiencyInputs {
  inputEnergyKJ: number;
  efficiencyPercent: number;
  frictionPercent: number;
  loadPercent: number;
}

export interface EnergyEfficiencyResult extends EnergyEfficiencyInputs {
  usefulEnergyKJ: number;
  wasteEnergyKJ: number;
  conversionLossKJ: number;
  frictionLossKJ: number;
  unloadedLossKJ: number;
  effectiveEfficiencyPercent: number;
  conservationDifferenceKJ: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundEnergy(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Deterministic energy-accounting model. Every input kilojoule is assigned to
 * useful transfer or one of the waste pathways; friction never destroys energy.
 */
export function calculateEnergyEfficiency(
  inputs: EnergyEfficiencyInputs,
): EnergyEfficiencyResult {
  const inputEnergyKJ = clamp(inputs.inputEnergyKJ, 10, 500);
  const efficiencyPercent = clamp(inputs.efficiencyPercent, 10, 100);
  const frictionPercent = clamp(inputs.frictionPercent, 0, 60);
  const loadPercent = clamp(inputs.loadPercent, 0, 100);

  const convertedEnergy = inputEnergyKJ * (efficiencyPercent / 100);
  const conversionLoss = inputEnergyKJ - convertedEnergy;
  const frictionLoss = convertedEnergy * (frictionPercent / 100);
  const energyAfterFriction = convertedEnergy - frictionLoss;
  const usefulEnergy = energyAfterFriction * (loadPercent / 100);
  const unloadedLoss = energyAfterFriction - usefulEnergy;

  const usefulEnergyKJ = roundEnergy(usefulEnergy);
  const wasteEnergyKJ = roundEnergy(inputEnergyKJ - usefulEnergyKJ);

  return {
    inputEnergyKJ: roundEnergy(inputEnergyKJ),
    efficiencyPercent: Math.round(efficiencyPercent),
    frictionPercent: Math.round(frictionPercent),
    loadPercent: Math.round(loadPercent),
    usefulEnergyKJ,
    wasteEnergyKJ,
    conversionLossKJ: roundEnergy(conversionLoss),
    frictionLossKJ: roundEnergy(frictionLoss),
    unloadedLossKJ: roundEnergy(unloadedLoss),
    effectiveEfficiencyPercent: Math.round((usefulEnergy / inputEnergyKJ) * 100),
    conservationDifferenceKJ: roundEnergy(inputEnergyKJ - usefulEnergyKJ - wasteEnergyKJ),
  };
}
