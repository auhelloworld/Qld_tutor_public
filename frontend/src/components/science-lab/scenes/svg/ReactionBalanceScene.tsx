'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactionBalanceSceneData } from '../../../../lib/science-lab/activity-types';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import {
  calculateReactionBalance,
  normaliseCoefficients,
  REACTIONS,
  type ReactionId,
  type SystemMode,
} from '../../../../lib/science-lab/models/reaction-balance';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSliderInput from '../../../lab-shared/LabSliderInput';

const REACTION_IDS: ReactionId[] = ['water-formation', 'methane-combustion', 'iron-oxidation'];

function selectStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 10px',
    borderRadius: '7px',
    border: '1px solid var(--border-color)',
    background: active ? 'rgba(59, 130, 246, 0.18)' : 'var(--bg-primary)',
    color: active ? '#2563eb' : 'var(--text-primary)',
    textAlign: 'left',
    fontSize: '11px',
    fontWeight: 700,
    cursor: 'pointer',
  };
}

export default function ReactionBalanceScene({
  sceneData,
  onSceneDataChange,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<ReactionBalanceSceneData>) {
  const data = sceneData;
  const [reactionId, setReactionId] = useState<ReactionId>(data.reactionId);
  const [coefficients, setCoefficients] = useState<number[]>(() =>
    normaliseCoefficients(data.reactionId, data.coefficients),
  );
  const [systemMode, setSystemMode] = useState<SystemMode>(data.systemMode);

  const result = useMemo(
    () => calculateReactionBalance(reactionId, coefficients, systemMode),
    [coefficients, reactionId, systemMode],
  );

  const emitPatch = useCallback((patch: Partial<ReactionBalanceSceneData>) => {
    onSceneDataChange?.(patch);
  }, [onSceneDataChange]);

  useEffect(() => {
    onReadoutChange?.(isRevealed
      ? {
          balanced: result.balanced ? 'Balanced' : 'Not balanced',
          reactantMassUnits: result.reactantMassUnits,
          productMassUnits: result.productMassUnits,
          measuredBefore: systemMode === 'closed' ? result.closedBeforeMassUnits : result.openBeforeMassUnits,
          measuredAfter: systemMode === 'closed' ? result.closedAfterMassUnits : result.openAfterMassUnits,
          systemMode,
        }
      : {});
  }, [isRevealed, onReadoutChange, result, systemMode]);

  const changeReaction = (nextId: ReactionId) => {
    const nextCoefficients = normaliseCoefficients(nextId, []);
    setReactionId(nextId);
    setCoefficients(nextCoefficients);
    emitPatch({ reactionId: nextId, coefficients: nextCoefficients });
  };

  const changeCoefficient = (index: number, value: number) => {
    const next = coefficients.map((current, currentIndex) => currentIndex === index ? Math.round(value) : current);
    setCoefficients(next);
    emitPatch({ coefficients: next });
  };

  const species = [...result.reaction.reactants, ...result.reaction.products];
  const reactantCount = result.reaction.reactants.length;
  const displayedBefore = systemMode === 'closed' ? result.closedBeforeMassUnits : result.openBeforeMassUnits;
  const displayedAfter = systemMode === 'closed' ? result.closedAfterMassUnits : result.openAfterMassUnits;
  const massAxisMaximum = Math.max(displayedBefore, displayedAfter, 1);
  const massBarHeight = (mass: number) => (mass / massAxisMaximum) * 92;

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Choose a reaction">
            <div role="group" aria-label="Reaction choices" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {REACTION_IDS.map((id) => (
                <button key={id} type="button" aria-pressed={reactionId === id} onClick={() => changeReaction(id)} style={selectStyle(reactionId === id)}>
                  {REACTIONS[id].label}
                </button>
              ))}
            </div>
          </LabControlCard>

          <LabControlCard title="Equation Coefficients" description="Only the large coefficients can change. Formula subscripts are fixed identities.">
            <div id="coefficients" role="group" aria-label="Adjust whole-number equation coefficients" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {species.map((item, index) => (
                <LabSliderInput
                  key={`${reactionId}-${item.formula}-${index}`}
                  id={`reaction-coefficient-${index}`}
                  label={`${index < reactantCount ? 'Reactant' : 'Product'} ${item.formula} coefficient`}
                  ariaLabel={`Coefficient before ${item.name}; formula subscripts cannot change`}
                  value={coefficients[index] ?? 1}
                  min={1}
                  max={8}
                  step={1}
                  decimals={0}
                  onChange={(value) => changeCoefficient(index, value)}
                />
              ))}
            </div>
          </LabControlCard>

          <LabControlCard title="Measurement boundary" compact>
            <div role="group" aria-label="Open or closed system" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {(['closed', 'open'] as SystemMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={systemMode === mode}
                  onClick={() => {
                    setSystemMode(mode);
                    emitPatch({ systemMode: mode });
                  }}
                  style={selectStyle(systemMode === mode)}
                >
                  {mode === 'closed' ? '🔒 Closed' : '↗ Open'} system
                </button>
              ))}
            </div>
          </LabControlCard>
        </div>
      }
      visual={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          <div className="glass-panel" style={{ padding: '14px', borderRadius: '14px', background: 'var(--bg-secondary)' }}>
            <svg
              viewBox="0 0 720 500"
              className="science-scene-svg"
              role="img"
              aria-label={isRevealed
                ? `${result.reaction.label}. Reactant and product atom counts are ${result.balanced ? 'equal, so the equation is balanced' : 'not equal, so the equation is not balanced'}. ${systemMode} system measurement is selected.`
                : `${result.reaction.label} coefficient editor. Atom counts, balance verdict and mass comparison are hidden until the prediction is submitted. Formula subscripts cannot be edited.`}
              style={{ background: '#0f172a', borderRadius: '12px' }}
            >
              <title>{isRevealed ? 'Atomic rearrangement, equation balance and mass boundary comparison' : 'Reaction coefficient model with results locked'}</title>
              <text x="24" y="30" fill="#f8fafc" fontSize="16" fontWeight="bold">Atoms rearrange; they are not created or destroyed</text>
              <text x="24" y="50" fill="#94a3b8" fontSize="11">Large numbers are adjustable coefficients. Small formula subscripts remain fixed.</text>

              <g aria-label="Chemical equation">
                {result.reaction.reactants.map((item, index) => {
                  const x = result.reaction.reactants.length === 1 ? 170 : 95 + index * 155;
                  return <g key={`r-${item.formula}`} transform={`translate(${x}, 102)`}>
                    <circle r="34" fill="#1e3a8a" stroke="#93c5fd" strokeWidth="2" />
                    <text x="0" y="-3" textAnchor="middle" fill="#bfdbfe" fontSize="11">× {coefficients[index]}</text>
                    <text x="0" y="18" textAnchor="middle" fill="white" fontSize="18" fontWeight="bold">{item.formula}</text>
                  </g>;
                })}
                {result.reaction.reactants.length > 1 && <text x="172" y="108" textAnchor="middle" fill="#cbd5e1" fontSize="24">+</text>}
                <text x="342" y="110" textAnchor="middle" fill="#fbbf24" fontSize="30">→</text>
                {result.reaction.products.map((item, productIndex) => {
                  const index = reactantCount + productIndex;
                  const x = result.reaction.products.length === 1 ? 530 : 455 + productIndex * 150;
                  return <g key={`p-${item.formula}`} transform={`translate(${x}, 102)`}>
                    <circle r="34" fill="#064e3b" stroke="#6ee7b7" strokeWidth="2" />
                    <text x="0" y="-3" textAnchor="middle" fill="#a7f3d0" fontSize="11">× {coefficients[index]}</text>
                    <text x="0" y="18" textAnchor="middle" fill="white" fontSize="18" fontWeight="bold">{item.formula}</text>
                  </g>;
                })}
                {result.reaction.products.length > 1 && <text x="530" y="108" textAnchor="middle" fill="#cbd5e1" fontSize="24">+</text>}
              </g>

              <g transform="translate(0, 190)" aria-label="Equation balance">
                <line x1="260" y1="10" x2="460" y2="10" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" transform={`rotate(${isRevealed ? result.balanceTiltDeg : 0} 360 10)`} />
                <path d="M360 12 L335 67 H385 Z" fill="#475569" stroke="#cbd5e1" strokeWidth="2" />
                <line x1="280" y1="10" x2="280" y2="45" stroke="#94a3b8" strokeWidth="2" />
                <line x1="440" y1="10" x2="440" y2="45" stroke="#94a3b8" strokeWidth="2" />
                <rect x="235" y="45" width="90" height="18" rx="5" fill="#1e3a8a" />
                <rect x="395" y="45" width="90" height="18" rx="5" fill="#064e3b" />
                <text x="280" y="59" textAnchor="middle" fill="white" fontSize="10">Reactant side</text>
                <text x="440" y="59" textAnchor="middle" fill="white" fontSize="10">Product side</text>
                <text x="360" y="88" textAnchor="middle" fill={isRevealed && result.balanced ? '#6ee7b7' : '#fbbf24'} fontSize="13" fontWeight="bold">
                  {isRevealed ? (result.balanced ? '✓ BALANCED' : 'Not balanced — adjust coefficients') : 'Balance verdict locked'}
                </text>
              </g>

              <g transform="translate(40, 300)" aria-label="Atom count table">
                <text x="0" y="0" fill="#f8fafc" fontSize="13" fontWeight="bold">Atom counts</text>
                <text x="72" y="20" fill="#93c5fd" fontSize="10" textAnchor="middle">Reactants</text>
                <text x="142" y="20" fill="#6ee7b7" fontSize="10" textAnchor="middle">Products</text>
                {result.atomSymbols.map((atom, index) => (
                  <g key={atom} transform={`translate(0, ${38 + index * 28})`}>
                    <rect width="170" height="23" rx="4" fill={index % 2 === 0 ? '#1e293b' : '#172033'} />
                    <text x="12" y="16" fill="white" fontSize="11" fontWeight="bold">{atom}</text>
                    <text x="72" y="16" fill="#bfdbfe" fontSize="11" textAnchor="middle">{isRevealed ? result.reactantCounts[atom] ?? 0 : '?'}</text>
                    <text x="142" y="16" fill="#a7f3d0" fontSize="11" textAnchor="middle">{isRevealed ? result.productCounts[atom] ?? 0 : '?'}</text>
                  </g>
                ))}
              </g>

              <g transform="translate(300, 298)" aria-label={`${systemMode} system measured mass graph`}>
                <text x="170" y="2" textAnchor="middle" fill="#f8fafc" fontSize="13" fontWeight="bold">{systemMode === 'closed' ? 'Closed' : 'Open'} system mass</text>
                <line x1="40" y1="135" x2="300" y2="135" stroke="#cbd5e1" strokeWidth="1.5" />
                <line x1="40" y1="30" x2="40" y2="135" stroke="#cbd5e1" strokeWidth="1.5" />
                <text x="18" y="84" transform="rotate(-90 18 84)" textAnchor="middle" fill="#94a3b8" fontSize="9">Relative mass units</text>
                <text x="34" y="138" textAnchor="end" fill="#94a3b8" fontSize="9">0</text>
                <text x="34" y="34" textAnchor="end" fill="#94a3b8" fontSize="9">{isRevealed ? massAxisMaximum : '?'}</text>
                {isRevealed ? <>
                  <rect x="95" y={135 - massBarHeight(displayedBefore)} width="48" height={massBarHeight(displayedBefore)} fill="#3b82f6" />
                  <rect x="205" y={135 - massBarHeight(displayedAfter)} width="48" height={massBarHeight(displayedAfter)} fill="#10b981" />
                  <text x="119" y={128 - massBarHeight(displayedBefore)} textAnchor="middle" fill="#bfdbfe" fontSize="10">{displayedBefore}</text>
                  <text x="229" y={128 - massBarHeight(displayedAfter)} textAnchor="middle" fill="#a7f3d0" fontSize="10">{displayedAfter}</text>
                </> : <text x="170" y="88" textAnchor="middle" fill="#94a3b8" fontSize="22">?</text>}
                <text x="119" y="151" textAnchor="middle" fill="#93c5fd" fontSize="10">Before</text>
                <text x="229" y="151" textAnchor="middle" fill="#6ee7b7" fontSize="10">After</text>
              </g>

              <g transform="translate(40, 470)" aria-label="Diagram legend">
                <circle cx="6" cy="-3" r="6" fill="#1e3a8a" stroke="#93c5fd" /><text x="18" y="1" fill="#cbd5e1" fontSize="10">blue circle — reactant formula</text>
                <circle cx="202" cy="-3" r="6" fill="#064e3b" stroke="#6ee7b7" /><text x="214" y="1" fill="#cbd5e1" fontSize="10">green circle — product formula</text>
                <rect x="405" y="-9" width="12" height="12" fill="#3b82f6" /><text x="423" y="1" fill="#cbd5e1" fontSize="10">bar — mass inside boundary</text>
              </g>
            </svg>
          </div>

          <div className="glass-panel" aria-live="polite" style={{ padding: '12px 14px', borderRadius: '12px', color: 'var(--text-primary)', fontSize: '12px' }}>
            {isRevealed ? (
              result.balanced
                ? <><strong>Conserved:</strong> matching atom counts give equal closed-system mass ({result.closedBeforeMassUnits} → {result.closedAfterMassUnits} relative units). In the open comparison, {result.reaction.openSystemExplanation.toLowerCase()}</>
                : <><strong>Keep balancing:</strong> unequal atom counts mean these coefficients do not yet describe a conserving reaction amount. Subscripts must stay unchanged.</>
            ) : <><strong>Prediction gate:</strong> choose coefficients and predict whether each atom count matches; submit to see the count and mass checks.</>}
          </div>
        </div>
      }
    />
  );
}
