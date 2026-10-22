'use client';

import { useEffect, useMemo, useState } from 'react';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabSliderInput from '../../../lab-shared/LabSliderInput';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import {
  calculateCellSystem,
  CELL_SYSTEM_MODEL_LIMITATIONS,
  type CellSystemSceneData,
  type CellType,
  type FunctionStatus,
} from '../../../../lib/science-lab/models/cell-system';

type CellControlKey = 'membraneFunction' | 'mitochondriaFunction' | 'chloroplastFunction' | 'tissueDemand';

function statusColour(status: FunctionStatus): string {
  if (status === 'functioning') return '#22c55e';
  if (status === 'strained') return '#f59e0b';
  return '#ef4444';
}

export default function CellSystemScene({
  sceneData,
  onSceneDataChange,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<CellSystemSceneData>) {
  const [controls, setControls] = useState<CellSystemSceneData>({
    kind: 'cell-system',
    cellType: sceneData.cellType ?? 'plant',
    membraneFunction: sceneData.membraneFunction ?? 85,
    mitochondriaFunction: sceneData.mitochondriaFunction ?? 85,
    chloroplastFunction: sceneData.chloroplastFunction ?? 85,
    tissueDemand: sceneData.tissueDemand ?? 60,
  });
  const result = useMemo(() => calculateCellSystem(controls), [controls]);

  const changeCellType = (cellType: CellType) => {
    setControls((previous) => ({ ...previous, cellType }));
    onSceneDataChange?.({ cellType });
  };
  const changeControl = (key: CellControlKey, value: number) => {
    setControls((previous) => ({ ...previous, [key]: value }));
    onSceneDataChange?.({ [key]: value } as Partial<CellSystemSceneData>);
  };

  useEffect(() => {
    onReadoutChange?.(isRevealed
      ? {
          cellType: result.cellType,
          atpSupply: result.atpSupplyPercent,
          membraneTransport: result.transportPercent,
          gasExchange: result.gasExchangePercent,
          photosynthesis: result.photosynthesisPercent ?? 'not present in animal cells',
          tissueOutput: result.tissueOutputPercent,
          organSystemOutput: result.organSystemOutputPercent,
          limitingFunction: result.limitingFunction,
        }
      : {});
  }, [isRevealed, onReadoutChange, result]);

  const membraneOpacity = 0.25 + controls.membraneFunction / 135;
  const mitochondriaOpacity = 0.2 + controls.mitochondriaFunction / 125;
  const chloroplastOpacity = 0.2 + controls.chloroplastFunction / 125;
  const tissueLabel = controls.cellType === 'plant' ? 'leaf tissue' : 'muscle tissue';
  const organLabel = controls.cellType === 'plant' ? 'whole plant' : 'movement system';

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Cell system">
            <div role="group" aria-label="Plant or animal cell" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {(['plant', 'animal'] as const).map((cellType) => (
                <button
                  key={cellType}
                  type="button"
                  aria-pressed={controls.cellType === cellType}
                  onClick={() => changeCellType(cellType)}
                  style={{
                    padding: '8px',
                    borderRadius: '7px',
                    border: '1px solid var(--border-color)',
                    background: controls.cellType === cellType ? (cellType === 'plant' ? '#22c55e33' : '#38bdf833') : 'var(--bg-primary)',
                    color: controls.cellType === cellType ? (cellType === 'plant' ? '#4ade80' : '#38bdf8') : 'var(--text-primary)',
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'capitalize',
                    cursor: 'pointer',
                  }}
                >
                  {cellType === 'plant' ? '▭ Plant cell' : '○ Animal cell'}
                </button>
              ))}
            </div>
          </LabControlCard>

          <LabControlCard
            title="Cell-process controls"
            description="Reduce one function and follow the consequences beyond the cell."
          >
            <LabSliderInput
              id="cell-membrane"
              label="Membrane function"
              ariaLabel="Cell membrane transport and exchange function percent"
              value={controls.membraneFunction}
              min={0}
              max={100}
              step={1}
              decimals={0}
              valueSuffix="%"
              onChange={(value) => changeControl('membraneFunction', value)}
            />
            <LabSliderInput
              id="cell-mitochondria"
              label="Mitochondria function"
              ariaLabel="Mitochondria ATP production function percent"
              value={controls.mitochondriaFunction}
              min={0}
              max={100}
              step={1}
              decimals={0}
              valueSuffix="%"
              onChange={(value) => changeControl('mitochondriaFunction', value)}
            />
            <LabSliderInput
              id="chloroplastFunction"
              label="Chloroplast Function"
              ariaLabel="Chloroplast function percent for plant cells"
              value={controls.chloroplastFunction}
              min={0}
              max={100}
              step={1}
              decimals={0}
              valueSuffix="%"
              onChange={(value) => changeControl('chloroplastFunction', value)}
            />
            {controls.cellType === 'animal' && (
              <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.4 }}>
                This stored plant-cell setting becomes active when Plant cell is selected; animal cells obtain chemical energy from food molecules and do not use chloroplasts.
              </p>
            )}
          </LabControlCard>

          <LabControlCard title="Tissue demand">
            <LabSliderInput
              id="tissueDemand"
              label={`${controls.cellType === 'plant' ? 'Leaf' : 'Muscle'} Tissue Demand`}
              ariaLabel="Relative tissue demand percent"
              value={controls.tissueDemand}
              min={20}
              max={100}
              step={1}
              decimals={0}
              valueSuffix="%"
              onChange={(value) => changeControl('tissueDemand', value)}
            />
          </LabControlCard>

          <LabControlCard title="Scientific limits" compact>
            <p style={{ margin: '0 0 7px', color: 'var(--text-primary)', fontSize: '11px', fontWeight: 700 }}>
              Dynamic systems model — not a static organelle-label diagram.
            </p>
            <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.45 }}>
              {CELL_SYSTEM_MODEL_LIMITATIONS.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          </LabControlCard>
        </div>
      }
      visual={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="glass-panel" style={{ padding: '12px' }}>
            <svg
              viewBox="0 0 540 370"
              className="science-scene-svg"
              role="img"
              aria-label={isRevealed
                ? `${controls.cellType} cell process view: ATP ${result.atpSupplyPercent} percent, transport ${result.transportPercent} percent and gas exchange ${result.gasExchangePercent} percent.`
                : `Interactive ${controls.cellType} cell process view; quantitative outputs are hidden until prediction submission.`}
            >
              <title>Linked organelle processes inside a functioning cell</title>
              <defs>
                <marker id="cell-process-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
                </marker>
              </defs>
              <rect x="1" y="1" width="538" height="368" rx="12" fill="var(--bg-primary)" stroke="var(--border-color)" />
              <text x="270" y="23" textAnchor="middle" fill="var(--text-primary)" fontSize="14" fontWeight="700">
                {controls.cellType === 'plant' ? 'Plant cell' : 'Animal cell'}: linked processes, not just labels
              </text>

              {controls.cellType === 'plant' ? (
                <g>
                  <rect x="90" y="52" width="350" height="218" rx="28" fill="#22c55e12" stroke="#16a34a" strokeWidth="7" />
                  <rect x="101" y="63" width="328" height="196" rx="23" fill="#0ea5e915" stroke="#38bdf8" strokeWidth="4" opacity={membraneOpacity} />
                </g>
              ) : (
                <g>
                  <ellipse cx="270" cy="161" rx="177" ry="112" fill="#0ea5e915" stroke="#38bdf8" strokeWidth="5" opacity={membraneOpacity} />
                </g>
              )}

              <circle cx="270" cy="158" r="44" fill="#a78bfa33" stroke="#a78bfa" strokeWidth="3" />
              <text x="270" y="154" textAnchor="middle" fill="var(--text-primary)" fontSize="11" fontWeight="700">nucleus</text>
              <text x="270" y="170" textAnchor="middle" fill="var(--text-secondary)" fontSize="9">coordinates activity</text>

              {[[165, 112], [342, 198], [172, 216]].map(([x, y], index) => (
                <g key={index} transform={`translate(${x} ${y})`} opacity={mitochondriaOpacity}>
                  <ellipse rx="31" ry="15" fill="#f9731633" stroke="#f97316" strokeWidth="2.5" />
                  <path d="M-20 0 q8 -10 16 0 t16 0 t16 0" fill="none" stroke="#fb923c" strokeWidth="2" />
                </g>
              ))}
              {controls.cellType === 'plant' && [[357, 105], [183, 168]].map(([x, y], index) => (
                <g key={index} transform={`translate(${x} ${y})`} opacity={chloroplastOpacity}>
                  <rect x="-31" y="-15" width="62" height="30" rx="14" fill="#22c55e33" stroke="#22c55e" strokeWidth="2.5" />
                  <path d="M-19 -6 h38 M-19 0 h38 M-19 6 h38" stroke="#4ade80" />
                </g>
              ))}

              <g stroke="#94a3b8" strokeWidth="2" fill="none" markerEnd="url(#cell-process-arrow)">
                <path d="M66 110 C96 110 105 110 132 112" opacity={membraneOpacity} />
                <path d="M202 112 C225 120 230 126 238 136" opacity={mitochondriaOpacity} />
                <path d="M302 188 C318 194 325 196 334 198" opacity={mitochondriaOpacity} />
                <path d="M408 208 C448 208 462 193 474 180" opacity={membraneOpacity} />
              </g>
              <text x="38" y="100" fill="#38bdf8" fontSize="9" fontWeight="700">O₂ / CO₂ / nutrients</text>
              <text x="226" y="107" fill="#fb923c" fontSize="9" fontWeight="700">ATP supply</text>
              <text x="449" y="169" fill="#38bdf8" fontSize="9" fontWeight="700">transport out</text>

              {isRevealed ? (
                <g>
                  <rect x="167" y="282" width="206" height="38" rx="7" fill="#0f172add" stroke="#475569" />
                  <text x="270" y="297" textAnchor="middle" fill="#f8fafc" fontSize="9">ATP {result.atpSupplyPercent}% · transport {result.transportPercent}% · gas exchange {result.gasExchangePercent}%</text>
                  <text x="270" y="311" textAnchor="middle" fill="#fca5a5" fontSize="9" fontWeight="700">Current bottleneck: {result.limitingFunction}</text>
                </g>
              ) : (
                <text x="270" y="302" textAnchor="middle" fill="var(--text-secondary)" fontSize="10">Process outputs hidden by prediction gate</text>
              )}
              <g transform="translate(88 348)" fill="var(--text-secondary)" fontSize="8">
                <rect x="0" y="-8" width="20" height="12" rx="6" fill="#22c55e33" stroke="#22c55e" />
                <text x="26" y="1">striped capsule = chloroplast</text>
                <ellipse cx="190" cy="-2" rx="12" ry="7" fill="#f9731633" stroke="#f97316" />
                <text x="208" y="1">folded oval = mitochondrion</text>
                <line x1="362" y1="-8" x2="362" y2="6" stroke="#38bdf8" strokeWidth="4" />
                <text x="372" y="1">blue boundary = membrane</text>
              </g>
            </svg>
          </div>

          <div className="glass-panel" style={{ padding: '12px' }}>
            <svg
              viewBox="0 0 540 255"
              className="science-scene-svg"
              role="img"
              aria-label={isRevealed
                ? `Failure cascade from cell to ${tissueLabel} to ${organLabel}; final system output is ${result.organSystemOutputPercent} percent.`
                : `Qualitative failure cascade from cell to ${tissueLabel} to ${organLabel}; numerical outputs are hidden until prediction submission.`}
            >
              <title>Cell-to-tissue-to-organ-system failure cascade</title>
              <defs>
                <marker id="cascade-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#64748b" />
                </marker>
              </defs>
              <rect x="1" y="1" width="538" height="253" rx="12" fill="var(--bg-primary)" stroke="var(--border-color)" />
              <text x="270" y="23" textAnchor="middle" fill="var(--text-primary)" fontSize="14" fontWeight="700">Failure cascade: cell → tissue → organ system</text>
              {result.cascade.map((stage, index) => {
                const x = 30 + index * 175;
                const colour = statusColour(stage.status);
                const barWidth = isRevealed ? stage.outputPercent * 1.25 : 78;
                return (
                  <g key={stage.id}>
                    <rect x={x} y="68" width="135" height="116" rx={stage.id === 'cell' ? 28 : 9} fill={`${colour}16`} stroke={colour} strokeWidth="3" />
                    <text x={x + 67.5} y="91" textAnchor="middle" fill="var(--text-primary)" fontSize="10" fontWeight="700">{stage.label}</text>
                    <rect x={x + 5} y="108" width="125" height="16" rx="8" fill="#334155" />
                    <rect x={x + 5} y="108" width={barWidth} height="16" rx="8" fill={colour} />
                    <text x={x + 67.5} y="146" textAnchor="middle" fill={colour} fontSize="11" fontWeight="700">
                      {isRevealed ? `${stage.outputPercent}% · ${stage.status}` : stage.status}
                    </text>
                    <text x={x + 67.5} y="164" textAnchor="middle" fill="var(--text-secondary)" fontSize="8">
                      {stage.id === 'cell' ? 'ATP · exchange · transport' : stage.id === 'tissue' ? `demand ${controls.tissueDemand}%` : 'integrated output'}
                    </text>
                    {index < result.cascade.length - 1 && (
                      <line x1={x + 139} y1="126" x2={x + 169} y2="126" stroke="#64748b" strokeWidth="3" markerEnd="url(#cascade-arrow)" />
                    )}
                  </g>
                );
              })}
              <g transform="translate(42 219)" fill="var(--text-secondary)" fontSize="8">
                <circle cx="0" cy="0" r="6" fill="#22c55e" />
                <text x="11" y="3">green = functioning</text>
                <path d="M130 -6 L136 6 L124 6 Z" fill="#f59e0b" />
                <text x="143" y="3">triangle = strained</text>
                <rect x="274" y="-6" width="12" height="12" fill="#ef4444" />
                <text x="294" y="3">square = failing</text>
                <line x1="393" y1="0" x2="416" y2="0" stroke="#64748b" markerEnd="url(#cascade-arrow)" />
                <text x="424" y="3">effect propagates</text>
              </g>
              {!isRevealed && (
                <text x="270" y="244" textAnchor="middle" fill="var(--text-secondary)" fontSize="9">Exact percentages are gated; qualitative status remains explorable.</text>
              )}
            </svg>
          </div>
        </div>
      }
    />
  );
}
