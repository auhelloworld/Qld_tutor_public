'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { EnergyEfficiencySceneData } from '../../../../lib/science-lab/activity-types';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import { calculateEnergyEfficiency } from '../../../../lib/science-lab/models/energy-efficiency';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSliderInput from '../../../lab-shared/LabSliderInput';

type EnergyDataView = EnergyEfficiencySceneData & {
  inputEnergyKJ?: number;
  efficiencyPercent?: number;
  frictionPercent?: number;
  loadPercent?: number;
};

const buttonStyle = (active: boolean): React.CSSProperties => ({
  padding: '7px 9px',
  borderRadius: '7px',
  border: '1px solid var(--border-color)',
  background: active ? 'rgba(16, 185, 129, 0.18)' : 'var(--bg-primary)',
  color: active ? '#059669' : 'var(--text-primary)',
  fontSize: '11px',
  fontWeight: 700,
  cursor: 'pointer',
});

export default function EnergyEfficiencyScene({
  sceneData,
  onSceneDataChange,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<EnergyEfficiencySceneData>) {
  const data = sceneData as EnergyDataView;
  const [inputEnergyKJ, setInputEnergyKJ] = useState(data.inputEnergyKJ ?? 100);
  const [efficiencyPercent, setEfficiencyPercent] = useState(data.efficiencyPercent ?? 75);
  const [frictionPercent, setFrictionPercent] = useState(data.frictionPercent ?? 15);
  const [loadPercent, setLoadPercent] = useState(data.loadPercent ?? 80);

  const result = useMemo(
    () => calculateEnergyEfficiency({ inputEnergyKJ, efficiencyPercent, frictionPercent, loadPercent }),
    [inputEnergyKJ, efficiencyPercent, frictionPercent, loadPercent],
  );

  const emitPatch = useCallback((patch: Partial<EnergyDataView>) => {
    onSceneDataChange?.(patch as Partial<EnergyEfficiencySceneData>);
  }, [onSceneDataChange]);

  useEffect(() => {
    onReadoutChange?.(isRevealed
      ? {
          inputEnergyKJ: result.inputEnergyKJ,
          usefulEnergyKJ: result.usefulEnergyKJ,
          wasteEnergyKJ: result.wasteEnergyKJ,
          effectiveEfficiencyPercent: result.effectiveEfficiencyPercent,
          conservationDifferenceKJ: result.conservationDifferenceKJ,
        }
      : {});
  }, [isRevealed, onReadoutChange, result]);

  const setEfficiencyPreset = (efficiency: number, friction: number, load: number) => {
    setEfficiencyPercent(efficiency);
    setFrictionPercent(friction);
    setLoadPercent(load);
    emitPatch({ efficiencyPercent: efficiency, frictionPercent: friction, loadPercent: load });
  };

  const usefulFraction = result.usefulEnergyKJ / result.inputEnergyKJ;
  const wasteFraction = result.wasteEnergyKJ / result.inputEnergyKJ;
  const barHeight = (energyKJ: number) => (energyKJ / result.inputEnergyKJ) * 170;

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Energy supplied">
            <LabSliderInput
              id="energy-input"
              label="Input energy"
              ariaLabel="Input energy in kJ"
              value={inputEnergyKJ}
              min={10}
              max={500}
              step={10}
              decimals={0}
              valueSuffix=" kJ"
              onChange={(value) => {
                setInputEnergyKJ(value);
                emitPatch({ inputEnergyKJ: value });
              }}
            />
          </LabControlCard>

          <LabControlCard title="Device and load">
            <LabSliderInput
              id="energy-device-efficiency"
              label="Device conversion efficiency"
              ariaLabel="Device conversion efficiency percent"
              value={efficiencyPercent}
              min={10}
              max={100}
              step={5}
              decimals={0}
              valueSuffix="%"
              onChange={(value) => {
                setEfficiencyPercent(value);
                emitPatch({ efficiencyPercent: value });
              }}
            />
            <div style={{ marginTop: '12px' }}>
              <LabSliderInput
                id="energy-friction"
                label="Frictional loss"
                ariaLabel="Frictional loss percent of converted energy"
                value={frictionPercent}
                min={0}
                max={60}
                step={5}
                decimals={0}
                valueSuffix="%"
                onChange={(value) => {
                  setFrictionPercent(value);
                  emitPatch({ frictionPercent: value });
                }}
              />
            </div>
            <div style={{ marginTop: '12px' }}>
              <LabSliderInput
                id="energy-load"
                label="Useful load"
                ariaLabel="Useful load percent"
                value={loadPercent}
                min={0}
                max={100}
                step={5}
                decimals={0}
                valueSuffix="%"
                onChange={(value) => {
                  setLoadPercent(value);
                  emitPatch({ loadPercent: value });
                }}
              />
            </div>
          </LabControlCard>

          <LabControlCard title="Compare setups" compact>
            <div role="group" aria-label="Energy setup presets" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' }}>
              <button type="button" aria-pressed={efficiencyPercent === 90 && frictionPercent === 5 && loadPercent === 100} onClick={() => setEfficiencyPreset(90, 5, 100)} style={buttonStyle(efficiencyPercent === 90 && frictionPercent === 5 && loadPercent === 100)}>Low loss</button>
              <button type="button" aria-pressed={efficiencyPercent === 70 && frictionPercent === 25 && loadPercent === 80} onClick={() => setEfficiencyPreset(70, 25, 80)} style={buttonStyle(efficiencyPercent === 70 && frictionPercent === 25 && loadPercent === 80)}>Friction</button>
              <button type="button" aria-pressed={efficiencyPercent === 75 && frictionPercent === 10 && loadPercent === 30} onClick={() => setEfficiencyPreset(75, 10, 30)} style={buttonStyle(efficiencyPercent === 75 && frictionPercent === 10 && loadPercent === 30)}>Light load</button>
            </div>
          </LabControlCard>
        </div>
      }
      visual={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          <div className="glass-panel" style={{ padding: '14px', borderRadius: '14px', background: 'var(--bg-secondary)' }}>
            <svg
              viewBox="0 0 720 420"
              className="science-scene-svg"
              role="img"
              aria-label={isRevealed
                ? `Energy flow model. ${result.inputEnergyKJ} kJ input becomes ${result.usefulEnergyKJ} kJ useful energy and ${result.wasteEnergyKJ} kJ waste energy. Total energy is conserved.`
                : `Energy flow model with ${result.inputEnergyKJ} kJ input. Useful and waste quantities are hidden until the prediction is submitted.`}
              style={{ background: '#0f172a', borderRadius: '12px' }}
            >
              <title>{isRevealed ? 'Sankey flow and energy bars showing conserved energy' : 'Energy input with calculated flows locked'}</title>
              <text x="28" y="32" fill="#f8fafc" fontSize="16" fontWeight="bold">Energy transfer workbench</text>
              <text x="28" y="52" fill="#94a3b8" fontSize="11">Input → useful transfer + thermal/sound waste</text>

              <rect x="35" y="125" width="115" height="90" rx="9" fill="#2563eb" stroke="#93c5fd" strokeWidth="2" />
              <text x="92" y="158" textAnchor="middle" fill="white" fontSize="13" fontWeight="bold">INPUT</text>
              <text x="92" y="181" textAnchor="middle" fill="white" fontSize="12">{result.inputEnergyKJ} kJ</text>
              <text x="92" y="198" textAnchor="middle" fill="#dbeafe" fontSize="10">electrical / chemical</text>

              {isRevealed ? (
                <>
                  <path d="M150 155 C225 155 245 105 330 105" fill="none" stroke="#10b981" strokeWidth={10 + usefulFraction * 52} strokeLinecap="round" />
                  <path d="M150 195 C225 195 245 260 330 260" fill="none" stroke="#f97316" strokeWidth={10 + wasteFraction * 52} strokeLinecap="round" />
                  <rect x="330" y="72" width="125" height="70" rx="8" fill="#064e3b" stroke="#6ee7b7" strokeWidth="2" />
                  <text x="392" y="101" textAnchor="middle" fill="#d1fae5" fontSize="12" fontWeight="bold">USEFUL</text>
                  <text x="392" y="122" textAnchor="middle" fill="white" fontSize="13">{result.usefulEnergyKJ} kJ</text>
                  <rect x="330" y="225" width="125" height="70" rx="8" fill="#7c2d12" stroke="#fdba74" strokeWidth="2" />
                  <text x="392" y="254" textAnchor="middle" fill="#ffedd5" fontSize="12" fontWeight="bold">WASTE</text>
                  <text x="392" y="275" textAnchor="middle" fill="white" fontSize="13">{result.wasteEnergyKJ} kJ</text>
                  <text x="228" y="322" textAnchor="middle" fill="#cbd5e1" fontSize="10">Waste pathways: conversion {result.conversionLossKJ} kJ · friction {result.frictionLossKJ} kJ · unloaded {result.unloadedLossKJ} kJ</text>
                </>
              ) : (
                <g aria-label="Calculated Sankey branches locked">
                  <path d="M150 175 C230 175 250 175 330 175" fill="none" stroke="#64748b" strokeWidth="28" strokeLinecap="round" strokeDasharray="8 8" />
                  <rect x="330" y="135" width="125" height="80" rx="8" fill="#1e293b" stroke="#64748b" strokeWidth="2" />
                  <text x="392" y="171" textAnchor="middle" fill="#cbd5e1" fontSize="12" fontWeight="bold">RESULT LOCKED</text>
                  <text x="392" y="191" textAnchor="middle" fill="#94a3b8" fontSize="11">Useful ? + waste ?</text>
                </g>
              )}

              <g transform="translate(500, 75)">
                <text x="85" y="-15" textAnchor="middle" fill="#f8fafc" fontSize="13" fontWeight="bold">Energy bars</text>
                <line x1="28" y1="190" x2="172" y2="190" stroke="#cbd5e1" strokeWidth="1.5" />
                <line x1="28" y1="20" x2="28" y2="190" stroke="#cbd5e1" strokeWidth="1.5" />
                <text x="12" y="110" transform="rotate(-90 12 110)" textAnchor="middle" fill="#94a3b8" fontSize="10">Energy (kJ)</text>
                <text x="22" y="194" textAnchor="end" fill="#94a3b8" fontSize="9">0</text>
                <text x="22" y="109" textAnchor="end" fill="#94a3b8" fontSize="9">{Math.round(result.inputEnergyKJ / 2)}</text>
                <text x="22" y="24" textAnchor="end" fill="#94a3b8" fontSize="9">{result.inputEnergyKJ}</text>
                <rect x="48" y="20" width="28" height="170" fill="#2563eb" />
                {isRevealed && <rect x="93" y={190 - barHeight(result.usefulEnergyKJ)} width="28" height={barHeight(result.usefulEnergyKJ)} fill="#10b981" />}
                {isRevealed && <rect x="138" y={190 - barHeight(result.wasteEnergyKJ)} width="28" height={barHeight(result.wasteEnergyKJ)} fill="#f97316" />}
                {!isRevealed && <text x="130" y="110" textAnchor="middle" fill="#94a3b8" fontSize="20">?</text>}
                <text x="62" y="207" textAnchor="middle" fill="#93c5fd" fontSize="9">Input</text>
                <text x="107" y="207" textAnchor="middle" fill="#6ee7b7" fontSize="9">Useful</text>
                <text x="152" y="207" textAnchor="middle" fill="#fdba74" fontSize="9">Waste</text>
              </g>

              <g transform="translate(35, 365)" aria-label="Energy flow legend">
                <rect width="16" height="10" fill="#2563eb" /><text x="22" y="9" fill="#cbd5e1" fontSize="10">blue block — supplied input</text>
                <rect x="190" width="16" height="10" fill="#10b981" /><text x="212" y="9" fill="#cbd5e1" fontSize="10">green band — useful transfer</text>
                <rect x="395" width="16" height="10" fill="#f97316" /><text x="417" y="9" fill="#cbd5e1" fontSize="10">orange band — dispersed energy</text>
              </g>
              <text x="360" y="402" textAnchor="middle" fill="#fde68a" fontSize="12" fontWeight="bold">Energy has not disappeared: input energy is redistributed, not destroyed.</text>
            </svg>
          </div>

          <div className="glass-panel" aria-live="polite" style={{ padding: '12px 14px', borderRadius: '12px', color: 'var(--text-primary)', fontSize: '12px' }}>
            {isRevealed
              ? <><strong>Account closed:</strong> {result.inputEnergyKJ} kJ = {result.usefulEnergyKJ} kJ useful + {result.wasteEnergyKJ} kJ waste. Effective efficiency is {result.effectiveEfficiencyPercent}%.</>
              : <><strong>Prediction gate:</strong> adjust the system, predict the split, then submit to reveal useful and waste quantities.</>}
          </div>
        </div>
      }
    />
  );
}
