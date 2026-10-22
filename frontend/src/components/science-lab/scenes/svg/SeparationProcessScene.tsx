'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { SeparationProcessSceneData } from '../../../../lib/science-lab/activity-types';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import {
  COMPONENT_LABELS,
  createSeparationState,
  executeSeparationStep,
  SEPARATION_METHOD_LABELS,
  SEPARATION_SCENARIOS,
  type ComponentId,
  type SeparationMethod,
  type SeparationScenarioId,
} from '../../../../lib/science-lab/models/separation-process';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';

type SeparationDataView = SeparationProcessSceneData;

const SCENARIO_IDS: SeparationScenarioId[] = ['sand-salt-water', 'ink', 'ethanol-water'];
const METHODS: SeparationMethod[] = ['filtration', 'evaporation', 'crystallisation', 'chromatography', 'distillation', 'decantation'];
const COMPONENT_COLOURS: Record<ComponentId, string> = {
  sand: '#d6a85f',
  salt: '#f8fafc',
  water: '#38bdf8',
  'blue-dye': '#2563eb',
  'yellow-dye': '#facc15',
  'red-dye': '#ef4444',
  ethanol: '#c084fc',
};

function controlButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: '7px 8px',
    borderRadius: '7px',
    border: '1px solid var(--border-color)',
    background: active ? 'rgba(14, 165, 233, 0.16)' : 'var(--bg-primary)',
    color: active ? '#0284c7' : 'var(--text-primary)',
    fontSize: '11px',
    fontWeight: 700,
    cursor: 'pointer',
  };
}

function isMethod(value: string): value is SeparationMethod {
  return METHODS.includes(value as SeparationMethod);
}

export default function SeparationProcessScene({
  sceneData,
  onSceneDataChange,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<SeparationProcessSceneData>) {
  const data = sceneData;
  const initialScenario = data.scenarioId;
  const [scenarioId, setScenarioId] = useState<SeparationScenarioId>(initialScenario);
  const [plannedSequence, setPlannedSequence] = useState<SeparationMethod[]>(() =>
    data.methodSequence.filter((method) => isMethod(method)),
  );
  const [nextStepIndex, setNextStepIndex] = useState(0);
  const [processState, setProcessState] = useState(() => createSeparationState(initialScenario));
  const scenario = SEPARATION_SCENARIOS[scenarioId];
  const latestProduct = processState.products[processState.products.length - 1];
  const latestHistory = processState.history[processState.history.length - 1];

  const emitPatch = useCallback((patch: Partial<SeparationDataView>) => {
    onSceneDataChange?.(patch);
  }, [onSceneDataChange]);

  useEffect(() => {
    onReadoutChange?.(isRevealed
      ? {
          executedSteps: processState.history.length,
          recoveredProducts: processState.products.length,
          purityPercent: latestProduct?.purityPercent ?? 0,
          yieldPercent: latestProduct?.yieldPercent ?? 0,
          methodFit: latestHistory?.fit ?? 'No step executed',
        }
      : {});
  }, [isRevealed, latestHistory, latestProduct, onReadoutChange, processState.history.length, processState.products.length]);

  const changeScenario = (nextScenario: SeparationScenarioId) => {
    setScenarioId(nextScenario);
    setPlannedSequence([]);
    setNextStepIndex(0);
    setProcessState(createSeparationState(nextScenario));
    emitPatch({ scenarioId: nextScenario, methodSequence: [] });
  };

  const appendMethod = (method: SeparationMethod) => {
    const next = [...plannedSequence, method].slice(0, 8);
    setPlannedSequence(next);
    emitPatch({ methodSequence: next });
  };

  const executeNext = () => {
    const method = plannedSequence[nextStepIndex];
    if (!method) return;
    setProcessState((current) => executeSeparationStep(current, method));
    setNextStepIndex((index) => index + 1);
  };

  const executeAll = () => {
    if (nextStepIndex >= plannedSequence.length) return;
    setProcessState((current) => plannedSequence.slice(nextStepIndex).reduce(
      (state, method) => executeSeparationStep(state, method),
      current,
    ));
    setNextStepIndex(plannedSequence.length);
  };

  const resetMixture = () => {
    setProcessState(createSeparationState(scenarioId));
    setNextStepIndex(0);
  };

  const maximumAmount = Math.max(...scenario.componentOrder.map((component) => scenario.initial[component] ?? 0), 1);
  const amountBarHeight = (amount: number) => (amount / maximumAmount) * 100;
  const sequenceText = plannedSequence.length > 0
    ? plannedSequence.map((method) => SEPARATION_METHOD_LABELS[method]).join(' → ')
    : 'No methods planned';
  const recoveredNames = useMemo(
    () => scenario.componentOrder.filter((component) => (processState.recovered[component] ?? 0) > 0).map((component) => COMPONENT_LABELS[component]),
    [processState.recovered, scenario.componentOrder],
  );

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Mixture Scenario">
            <div id="scenarioId" role="group" aria-label="Select mixture scenario" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {SCENARIO_IDS.map((id) => (
                <button key={id} type="button" aria-pressed={scenarioId === id} onClick={() => changeScenario(id)} style={controlButtonStyle(scenarioId === id)}>
                  {SEPARATION_SCENARIOS[id].label}
                </button>
              ))}
            </div>
            <p style={{ margin: '9px 0 0', color: 'var(--text-muted)', fontSize: '11px' }}>{scenario.description}</p>
          </LabControlCard>

          <LabControlCard title="Method Sequence" description="Select methods in the order the mixture should pass through them.">
            <div id="methodSequence" role="group" aria-label="Add a separation method to the planned sequence" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px' }}>
              {METHODS.map((method) => (
                <button key={method} type="button" aria-pressed={plannedSequence.includes(method)} onClick={() => appendMethod(method)} style={controlButtonStyle(plannedSequence.includes(method))}>
                  + {SEPARATION_METHOD_LABELS[method]}
                </button>
              ))}
            </div>
            <ol aria-label="Planned process sequence" style={{ margin: '10px 0 0', paddingLeft: '20px', color: 'var(--text-secondary)', fontSize: '11px' }}>
              {plannedSequence.length === 0 ? <li>Add a method to begin.</li> : plannedSequence.map((method, index) => (
                <li key={`${method}-${index}`} style={{ fontWeight: index === nextStepIndex ? 700 : 400 }}>
                  {SEPARATION_METHOD_LABELS[method]} {index < nextStepIndex ? '✓' : ''}
                </li>
              ))}
            </ol>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px', marginTop: '10px' }}>
              <button id="executeNext" type="button" aria-label="Execute the next planned separation stage — execute next" aria-pressed={nextStepIndex < plannedSequence.length} disabled={nextStepIndex >= plannedSequence.length} onClick={executeNext} style={controlButtonStyle(nextStepIndex < plannedSequence.length)}>Execute Next Stage</button>
              <button type="button" aria-pressed={nextStepIndex < plannedSequence.length} disabled={nextStepIndex >= plannedSequence.length} onClick={executeAll} style={controlButtonStyle(nextStepIndex < plannedSequence.length)}>Run remaining</button>
              <button type="button" aria-pressed={plannedSequence.length === 0} onClick={() => { setPlannedSequence([]); setNextStepIndex(0); emitPatch({ methodSequence: [] }); }} style={controlButtonStyle(plannedSequence.length === 0)}>Clear plan</button>
              <button id="resetProcess" type="button" aria-label="Reset the mixture and process — reset mixture" aria-pressed={processState.history.length === 0} onClick={resetMixture} style={controlButtonStyle(processState.history.length === 0)}>Reset Process</button>
            </div>
          </LabControlCard>
        </div>
      }
      visual={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          <div className="glass-panel" style={{ padding: '14px', borderRadius: '14px', background: 'var(--bg-secondary)' }}>
            <svg
              viewBox="0 0 720 450"
              className="science-scene-svg"
              role="img"
              aria-label={isRevealed
                ? `${scenario.label} separation process. ${processState.history.length} steps executed. Recovered components: ${recoveredNames.join(', ') || 'none'}. Latest purity ${latestProduct?.purityPercent ?? 0} percent and yield ${latestProduct?.yieldPercent ?? 0} percent.`
                : `${scenario.label} process builder. Planned sequence is ${sequenceText}. Recovered components, purity, yield and method-fit verdicts are hidden until the prediction is submitted.`}
              style={{ background: '#0f172a', borderRadius: '12px' }}
            >
              <title>{isRevealed ? 'Accumulated mixture separation, recovered products and quality graph' : 'Mixture separation sequence with outcomes locked'}</title>
              <text x="24" y="30" fill="#f8fafc" fontSize="16" fontWeight="bold">Separation Process Designer</text>
              <text x="24" y="50" fill="#94a3b8" fontSize="11">Each executed operation changes the material available to later steps.</text>

              <g transform="translate(35, 78)" aria-label="Starting mixture vessel">
                <path d="M5 0 V105 Q5 125 25 125 H115 Q135 125 135 105 V0" fill="#172554" stroke="#93c5fd" strokeWidth="3" />
                {scenario.componentOrder.map((component, index) => {
                  const initial = scenario.initial[component] ?? 0;
                  const height = Math.max(5, (initial / scenario.componentOrder.reduce((sum, item) => sum + (scenario.initial[item] ?? 0), 0)) * 85);
                  const y = 115 - scenario.componentOrder.slice(0, index + 1).reduce((sum, item) => sum + Math.max(5, ((scenario.initial[item] ?? 0) / scenario.componentOrder.reduce((total, entry) => total + (scenario.initial[entry] ?? 0), 0)) * 85), 0);
                  return <rect key={component} x="12" y={y} width="116" height={height} fill={COMPONENT_COLOURS[component]} opacity="0.8" />;
                })}
                <text x="70" y="146" textAnchor="middle" fill="#cbd5e1" fontSize="11">Starting mixture</text>
              </g>

              <line x1="178" y1="140" x2="548" y2="140" stroke="#64748b" strokeWidth="4" markerEnd="url(#separation-arrow)" />
              <defs><marker id="separation-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#64748b" /></marker></defs>
              {plannedSequence.slice(0, 5).map((method, index) => {
                const x = 210 + index * 70;
                const executed = index < nextStepIndex;
                return <g key={`${method}-node-${index}`} transform={`translate(${x}, 110)`}>
                  <rect width="58" height="58" rx="8" fill={executed ? '#075985' : '#1e293b'} stroke={index === nextStepIndex ? '#fbbf24' : '#64748b'} strokeWidth="2" />
                  <text x="29" y="25" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">{SEPARATION_METHOD_LABELS[method].slice(0, 8)}</text>
                  <text x="29" y="43" textAnchor="middle" fill={executed ? '#7dd3fc' : '#94a3b8'} fontSize="10">{executed ? 'done ✓' : index === nextStepIndex ? 'next' : 'queued'}</text>
                </g>;
              })}
              {plannedSequence.length === 0 && <text x="360" y="128" textAnchor="middle" fill="#94a3b8" fontSize="12">Build a sequence to connect the process train.</text>}

              <g transform="translate(575, 78)" aria-label="Recovered product vessel">
                <path d="M5 0 V105 Q5 125 25 125 H90 Q110 125 110 105 V0" fill="#052e16" stroke="#6ee7b7" strokeWidth="3" />
                {isRevealed ? scenario.componentOrder.map((component, index) => {
                  const recovered = processState.recovered[component] ?? 0;
                  const height = (recovered / maximumAmount) * 85;
                  return height > 0 ? <rect key={component} x={14 + index * 20} y={115 - height} width="16" height={height} fill={COMPONENT_COLOURS[component]} /> : null;
                }) : <text x="58" y="70" textAnchor="middle" fill="#94a3b8" fontSize="24">?</text>}
                <text x="58" y="146" textAnchor="middle" fill="#cbd5e1" fontSize="11">Recovered</text>
              </g>

              <g transform="translate(35, 270)" aria-label="Component recovery graph">
                <text x="0" y="0" fill="#f8fafc" fontSize="13" fontWeight="bold">Material account after executed steps</text>
                <line x1="42" y1="125" x2="400" y2="125" stroke="#cbd5e1" strokeWidth="1.5" />
                <line x1="42" y1="20" x2="42" y2="125" stroke="#cbd5e1" strokeWidth="1.5" />
                <text x="17" y="78" transform="rotate(-90 17 78)" textAnchor="middle" fill="#94a3b8" fontSize="9">Relative amount (parts)</text>
                <text x="36" y="128" textAnchor="end" fill="#94a3b8" fontSize="9">0</text>
                <text x="36" y="24" textAnchor="end" fill="#94a3b8" fontSize="9">{isRevealed ? maximumAmount : '?'}</text>
                {scenario.componentOrder.map((component, index) => {
                  const x = 75 + index * 82;
                  const remaining = processState.remaining[component] ?? 0;
                  const recovered = processState.recovered[component] ?? 0;
                  return <g key={component}>
                    {isRevealed && <>
                      <rect x={x} y={125 - amountBarHeight(remaining)} width="22" height={amountBarHeight(remaining)} fill="#38bdf8" />
                      <rect x={x + 24} y={125 - amountBarHeight(recovered)} width="22" height={amountBarHeight(recovered)} fill="#10b981" />
                    </>}
                    {!isRevealed && <text x={x + 22} y="78" textAnchor="middle" fill="#94a3b8" fontSize="18">?</text>}
                    <text x={x + 22} y="141" textAnchor="middle" fill="#cbd5e1" fontSize="9">{COMPONENT_LABELS[component]}</text>
                  </g>;
                })}
              </g>

              <g transform="translate(475, 285)" aria-label="Quality readout">
                <rect width="210" height="105" rx="10" fill="#1e293b" stroke="#475569" />
                <text x="105" y="24" textAnchor="middle" fill="#f8fafc" fontSize="12" fontWeight="bold">Latest collected product</text>
                <text x="18" y="51" fill="#cbd5e1" fontSize="11">Purity</text>
                <text x="190" y="51" textAnchor="end" fill="#6ee7b7" fontSize="12" fontWeight="bold">{isRevealed ? `${latestProduct?.purityPercent ?? 0}%` : '?'}</text>
                <text x="18" y="74" fill="#cbd5e1" fontSize="11">Cumulative target yield</text>
                <text x="190" y="74" textAnchor="end" fill="#7dd3fc" fontSize="12" fontWeight="bold">{isRevealed ? `${latestProduct?.yieldPercent ?? 0}%` : '?'}</text>
                <text x="18" y="95" fill="#cbd5e1" fontSize="10">Method fit: {isRevealed ? latestHistory?.fit ?? '—' : 'locked'}</text>
              </g>

              <g transform="translate(45, 430)" aria-label="Material graph legend">
                <rect width="14" height="10" fill="#38bdf8" /><text x="20" y="9" fill="#cbd5e1" fontSize="10">blue bar — remaining</text>
                <rect x="145" width="14" height="10" fill="#10b981" /><text x="165" y="9" fill="#cbd5e1" fontSize="10">green bar — recovered</text>
                <rect x="315" width="14" height="10" fill="#64748b" /><text x="335" y="9" fill="#cbd5e1" fontSize="10">grey process node — not executed</text>
              </g>
            </svg>
          </div>

          <div className="glass-panel" aria-live="polite" style={{ padding: '12px 14px', borderRadius: '12px', color: 'var(--text-primary)', fontSize: '12px' }}>
            {isRevealed
              ? latestHistory
                ? <><strong>{SEPARATION_METHOD_LABELS[latestHistory.method]} — {latestHistory.fit} fit:</strong> {latestHistory.feedback}</>
                : <><strong>No operation executed.</strong> Build a sequence, then run a step to generate evidence.</>
              : <><strong>Prediction gate:</strong> run the process, but submit your prediction before purity, yield, recovered identities and method-fit feedback are revealed.</>}
          </div>
        </div>
      }
    />
  );
}
