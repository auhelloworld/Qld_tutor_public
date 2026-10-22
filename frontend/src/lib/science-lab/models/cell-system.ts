/** Cell-to-tissue-to-organ-system failure-cascade teaching model. */

export type CellType = 'plant' | 'animal';
export type FunctionStatus = 'functioning' | 'strained' | 'failing';

export interface CellSystemSceneData {
  kind: 'cell-system';
  cellType: CellType;
  membraneFunction: number;
  mitochondriaFunction: number;
  chloroplastFunction: number;
  tissueDemand: number;
}

export interface CascadeStage {
  id: 'cell' | 'tissue' | 'organ-system';
  label: string;
  outputPercent: number;
  status: FunctionStatus;
  explanation: string;
}

export interface CellSystemResult {
  cellType: CellType;
  atpSupplyPercent: number;
  transportPercent: number;
  gasExchangePercent: number;
  photosynthesisPercent: number | null;
  tissueOutputPercent: number;
  organSystemOutputPercent: number;
  limitingFunction: string;
  cascade: CascadeStage[];
}

export const CELL_SYSTEM_MODEL_LIMITATIONS = [
  'Percentages are relative teaching indices, not clinical measurements or rates for a particular species.',
  'A cell, one representative tissue and one organ-system output are linked; regulation, repair, storage and many organelles are omitted.',
  'Chloroplast control affects plant cells only. Animal cells obtain chemical energy from food rather than photosynthesis.',
] as const;

function clamp(value: number, min: number, max: number, fallback: number): number {
  const finite = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, finite));
}

function roundPercent(value: number): number {
  return Math.round(clamp(value, 0, 100, 0));
}

function statusFor(value: number): FunctionStatus {
  if (value >= 75) return 'functioning';
  if (value >= 45) return 'strained';
  return 'failing';
}

export function calculateCellSystem(sceneData: CellSystemSceneData): CellSystemResult {
  const cellType: CellType = sceneData.cellType === 'plant' ? 'plant' : 'animal';
  const membrane = clamp(sceneData.membraneFunction, 0, 100, 85) / 100;
  const mitochondria = clamp(sceneData.mitochondriaFunction, 0, 100, 85) / 100;
  const chloroplast = clamp(sceneData.chloroplastFunction, 0, 100, 85) / 100;
  const tissueDemand = clamp(sceneData.tissueDemand, 20, 100, 60);

  const chemicalInput = cellType === 'plant' ? 0.4 + 0.6 * chloroplast : 1;
  const atpSupply = 100 * mitochondria * (0.35 + 0.65 * membrane) * chemicalInput;
  const transport = 100 * membrane * (0.25 + 0.75 * (atpSupply / 100));
  const photosynthesis = cellType === 'plant' ? 100 * chloroplast * membrane : null;
  const gasExchange = cellType === 'plant'
    ? 100 * membrane * (0.3 + 0.7 * chloroplast)
    : 100 * membrane * (0.4 + 0.6 * mitochondria);

  const cellularCapacity = Math.min(atpSupply, transport, gasExchange);
  const requiredCapacity = 40 + tissueDemand * 0.6;
  const tissueOutput = Math.min(100, (cellularCapacity / requiredCapacity) * 100);
  const organOutput = tissueOutput * (0.65 + 0.35 * (transport / 100));

  const candidates = [
    { label: 'ATP supply', value: atpSupply },
    { label: 'membrane transport', value: transport },
    { label: 'gas exchange', value: gasExchange },
    ...(photosynthesis === null ? [] : [{ label: 'photosynthesis', value: photosynthesis }]),
  ];
  const limitingFunction = candidates.reduce((lowest, candidate) =>
    candidate.value < lowest.value ? candidate : lowest,
  ).label;

  const atpSupplyPercent = roundPercent(atpSupply);
  const transportPercent = roundPercent(transport);
  const gasExchangePercent = roundPercent(gasExchange);
  const photosynthesisPercent = photosynthesis === null ? null : roundPercent(photosynthesis);
  const tissueOutputPercent = roundPercent(tissueOutput);
  const organSystemOutputPercent = roundPercent(organOutput);
  const tissueLabel = cellType === 'plant' ? 'Leaf tissue' : 'Muscle tissue';
  const organLabel = cellType === 'plant' ? 'Whole-plant transport & growth' : 'Movement system output';

  return {
    cellType,
    atpSupplyPercent,
    transportPercent,
    gasExchangePercent,
    photosynthesisPercent,
    tissueOutputPercent,
    organSystemOutputPercent,
    limitingFunction,
    cascade: [
      {
        id: 'cell',
        label: `${cellType === 'plant' ? 'Plant' : 'Animal'} cell processes`,
        outputPercent: roundPercent(cellularCapacity),
        status: statusFor(cellularCapacity),
        explanation: `${limitingFunction} is the current bottleneck inside the cell.`,
      },
      {
        id: 'tissue',
        label: tissueLabel,
        outputPercent: tissueOutputPercent,
        status: statusFor(tissueOutput),
        explanation: `Cell supply is compared with a ${Math.round(tissueDemand)}% tissue demand.`,
      },
      {
        id: 'organ-system',
        label: organLabel,
        outputPercent: organSystemOutputPercent,
        status: statusFor(organOutput),
        explanation: 'Reduced tissue output propagates to the larger biological system.',
      },
    ],
  };
}
