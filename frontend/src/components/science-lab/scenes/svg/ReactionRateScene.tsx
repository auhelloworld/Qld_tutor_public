'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import type { ReactionRateSceneData as RegisteredReactionRateSceneData } from '../../../../lib/science-lab/activity-types';
import {
  calculateReactionRate,
  type ReactionRateSceneData,
} from '../../../../lib/science-lab/models/reaction-rate';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSliderInput from '../../../lab-shared/LabSliderInput';

type ReactionRateModelSceneProps = Omit<
  ScienceSceneProps<RegisteredReactionRateSceneData>,
  'sceneData' | 'onSceneDataChange'
> & {
  sceneData: ReactionRateSceneData;
  onSceneDataChange?: (patch: Partial<ReactionRateSceneData>) => void;
};

export default function ReactionRateScene(
  props: ScienceSceneProps<RegisteredReactionRateSceneData> | ReactionRateModelSceneProps,
) {
  const { onReadoutChange, isRevealed = false } = props;
  const sceneData = props.sceneData as Partial<ReactionRateSceneData> & {
    concentrationMolL?: number;
  };
  const onSceneDataChange = props.onSceneDataChange as ReactionRateModelSceneProps['onSceneDataChange'];
  const [temperatureC, setTemperatureC] = useState(sceneData.temperatureC ?? 25);
  const [concentrationRelative, setConcentrationRelative] = useState(
    sceneData.concentrationRelative ?? sceneData.concentrationMolL ?? 1,
  );
  const [surfaceAreaFactor, setSurfaceAreaFactor] = useState(sceneData.surfaceAreaFactor ?? 1);
  const [catalystEnabled, setCatalystEnabled] = useState(sceneData.catalystEnabled ?? false);
  const [seed, setSeed] = useState(sceneData.seed ?? 42);

  useEffect(() => {
    setTemperatureC(sceneData.temperatureC ?? 25);
    setConcentrationRelative(sceneData.concentrationRelative ?? sceneData.concentrationMolL ?? 1);
    setSurfaceAreaFactor(sceneData.surfaceAreaFactor ?? 1);
    setCatalystEnabled(sceneData.catalystEnabled ?? false);
    setSeed(sceneData.seed ?? 42);
  }, [
    sceneData.catalystEnabled,
    sceneData.concentrationMolL,
    sceneData.concentrationRelative,
    sceneData.seed,
    sceneData.surfaceAreaFactor,
    sceneData.temperatureC,
  ]);

  const modelData = useMemo<ReactionRateSceneData>(() => ({
    kind: 'reaction-rate', temperatureC, concentrationRelative, surfaceAreaFactor, catalystEnabled, seed,
  }), [catalystEnabled, concentrationRelative, seed, surfaceAreaFactor, temperatureC]);
  const result = useMemo(() => calculateReactionRate(modelData), [modelData]);
  const noCatalystReference = useMemo(
    () => calculateReactionRate({ ...modelData, catalystEnabled: false }),
    [modelData],
  );

  useEffect(() => {
    onReadoutChange?.(isRevealed ? {
      collisionFrequencyIndex: result.collisionFrequencyIndex,
      activationBarrierIndex: result.activationBarrierIndex,
      successfulCollisionIndex: result.successfulCollisionIndex,
      relativeRateIndex: result.relativeRateIndex,
      catalyst: catalystEnabled ? 'Present' : 'Absent',
    } : {});
  }, [catalystEnabled, isRevealed, onReadoutChange, result]);

  const update = (
    setter: React.Dispatch<React.SetStateAction<number>>,
    patch: Partial<ReactionRateSceneData>,
    value: number,
  ) => {
    setter(value);
    onSceneDataChange?.(patch);
  };
  const toggleCatalyst = () => {
    const next = !catalystEnabled;
    setCatalystEnabled(next);
    onSceneDataChange?.({ catalystEnabled: next });
  };
  const nextSnapshot = () => {
    const next = seed + 1;
    setSeed(next);
    onSceneDataChange?.({ seed: next });
  };

  const graph = { left: 74, right: 720, top: 264, bottom: 421 };
  const xFor = (time: number) => graph.left + (time / 10) * (graph.right - graph.left);
  const yFor = (percent: number) => graph.bottom - (percent / 100) * (graph.bottom - graph.top);
  const pathFor = (points: typeof result.concentrationCurve) => points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(point.timeRelative).toFixed(1)} ${yFor(point.concentrationPercent).toFixed(1)}`)
    .join(' ');

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Collision factors">
            <LabSliderInput id="reaction-temperature" label="Temperature" ariaLabel="Reaction temperature in degrees Celsius" value={temperatureC} min={5} max={80} step={1} decimals={0} valueSuffix=" °C" onChange={(value) => update(setTemperatureC, { temperatureC: value }, value)} />
            <div style={{ marginTop: '12px' }}><LabSliderInput id="reaction-concentration" label="Starting concentration" ariaLabel="Relative starting reactant concentration" value={concentrationRelative} min={0.25} max={2.5} step={0.25} decimals={2} valueSuffix=" ×" onChange={(value) => update(setConcentrationRelative, { concentrationRelative: value }, value)} /></div>
            <div style={{ marginTop: '12px' }}><LabSliderInput id="reaction-area" label="Exposed surface area" ariaLabel="Relative exposed surface area factor" value={surfaceAreaFactor} min={0.5} max={4} step={0.5} decimals={1} valueSuffix=" ×" onChange={(value) => update(setSurfaceAreaFactor, { surfaceAreaFactor: value }, value)} /></div>
          </LabControlCard>
          <LabControlCard title="Activation-energy counterfactual">
            <button
              type="button"
              aria-label="Catalyst counterfactual"
              aria-pressed={catalystEnabled}
              onClick={toggleCatalyst}
              style={{ width: '100%', padding: '9px', borderRadius: '7px', border: '1px solid var(--border-color)', background: catalystEnabled ? 'rgba(16, 185, 129, 0.18)' : 'var(--bg-primary)', color: catalystEnabled ? '#34d399' : 'var(--text-primary)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
            >
              {catalystEnabled ? '✓ Catalyst present: lower pathway shown' : 'Counterfactual: add a catalyst'}
            </button>
            <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: '10px', lineHeight: 1.4 }}>A catalyst lowers the activation barrier. It does not increase particle concentration and is not consumed by the model.</p>
          </LabControlCard>
          <LabControlCard title="Repeatable collision snapshot">
            <LabSliderInput id="reaction-seed" label="Snapshot seed" ariaLabel="Repeatable collision snapshot seed" value={seed} min={1} max={999} step={1} decimals={0} onChange={(value) => update(setSeed, { seed: Math.round(value) }, Math.round(value))} />
            <button type="button" onClick={nextSnapshot} style={{ width: '100%', marginTop: '10px', padding: '7px', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Next deterministic snapshot (seed + 1)</button>
          </LabControlCard>
        </div>
      }
      visual={
        <div className="glass-panel" style={{ padding: '16px', borderRadius: '16px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)' }}>Collision Theory, Energy Barrier & Concentration–Time</h4>
            <strong style={{ fontSize: '11px', color: isRevealed ? '#10b981' : 'var(--text-muted)' }}>{isRevealed ? `Relative rate index ${result.relativeRateIndex.toFixed(2)}` : 'Rate outcome 🔒'}</strong>
          </div>
          <svg
            viewBox="0 0 760 455"
            className="science-scene-svg"
            role="img"
            aria-label={isRevealed
              ? `Relative collision frequency index ${result.collisionFrequencyIndex.toFixed(2)}, activation barrier index ${result.activationBarrierIndex.toFixed(2)}, and relative rate index ${result.relativeRateIndex.toFixed(2)}. The lower graph shows reactant concentration percent over relative model time.`
              : `Collision snapshot and qualitative activation pathway at ${temperatureC} degrees Celsius. Relative rate values and the concentration-time curve are locked until the prediction is submitted.`}
            style={{ background: '#0f172a', borderRadius: '12px' }}
          >
            <title>{isRevealed ? 'Relative collision-theory rate model and concentration-time curve' : 'Collision theory views with quantitative rate outcome locked'}</title>

            <text x="24" y="27" fill="#e2e8f0" fontSize="11" fontWeight="bold">Particle collision snapshot (seed {seed})</text>
            <rect x="24" y="39" width="338" height="170" rx="9" fill="#111827" stroke="#475569" />
            {result.particles.map((particle) => {
              const x = 30 + particle.x * 326;
              const y = 45 + particle.y * 158;
              const radians = particle.directionDeg * Math.PI / 180;
              const dx = Math.cos(radians) * 9 * particle.speedRelative;
              const dy = Math.sin(radians) * 9 * particle.speedRelative;
              const aboveBarrier = isRevealed && particle.hasSufficientEnergy;
              return (
                <g key={particle.id}>
                  <line x1={x} y1={y} x2={x + dx} y2={y + dy} stroke="#64748b" strokeWidth="1" />
                  <circle cx={x} cy={y} r={aboveBarrier ? 5 : 3.5} fill={aboveBarrier ? '#fbbf24' : particle.id % 2 === 0 ? '#60a5fa' : '#f472b6'} stroke={aboveBarrier ? '#fef3c7' : 'none'} />
                </g>
              );
            })}
            <text x="193" y="226" textAnchor="middle" fill="#94a3b8" fontSize="9">Illustrative microstate; seed changes positions, not the calculated rate index.</text>

            <text x="405" y="27" fill="#e2e8f0" fontSize="11" fontWeight="bold">Activation-energy profile (relative energy index)</text>
            <line x1="405" y1="198" x2="738" y2="198" stroke="#94a3b8" />
            <line x1="405" y1="49" x2="405" y2="198" stroke="#94a3b8" />
            <text transform="translate(387 127) rotate(-90)" textAnchor="middle" fill="#cbd5e1" fontSize="9">Relative energy (index)</text>
            <text x="572" y="218" textAnchor="middle" fill="#cbd5e1" fontSize="9">Reaction progress (qualitative)</text>
            <path d="M 410 170 C 485 170, 500 70, 560 62 C 620 70, 630 155, 730 150" fill="none" stroke="#f87171" strokeWidth="2" strokeDasharray="6 4" />
            {catalystEnabled
              ? <path d="M 410 170 C 485 170, 510 112, 560 105 C 620 112, 640 155, 730 150" fill="none" stroke="#34d399" strokeWidth="3" />
              : <path d="M 410 170 C 485 170, 500 70, 560 62 C 620 70, 630 155, 730 150" fill="none" stroke="#f87171" strokeWidth="3" />}
            <line x1="560" y1="170" x2="560" y2={catalystEnabled ? 105 : 62} stroke="#fbbf24" strokeWidth="1.5" />
            <text x="568" y="128" fill="#fbbf24" fontSize="9">{isRevealed ? `barrier = ${result.activationBarrierIndex.toFixed(2)} index` : 'activation barrier'}</text>

            <line x1={graph.left} y1={graph.bottom} x2={graph.right} y2={graph.bottom} stroke="#94a3b8" strokeWidth="1.5" />
            <line x1={graph.left} y1={graph.top} x2={graph.left} y2={graph.bottom} stroke="#94a3b8" strokeWidth="1.5" />
            {[0, 2, 4, 6, 8, 10].map((tick) => <g key={tick}><line x1={xFor(tick)} y1={graph.bottom} x2={xFor(tick)} y2={graph.bottom + 5} stroke="#94a3b8" /><text x={xFor(tick)} y={graph.bottom + 17} textAnchor="middle" fill="#cbd5e1" fontSize="9">{tick}</text></g>)}
            {[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line x1={graph.left - 5} y1={yFor(tick)} x2={graph.right} y2={yFor(tick)} stroke="#334155" /><text x={graph.left - 9} y={yFor(tick) + 3} textAnchor="end" fill="#cbd5e1" fontSize="9">{tick}</text></g>)}
            <text x={(graph.left + graph.right) / 2} y="450" textAnchor="middle" fill="#e2e8f0" fontSize="10">Model time (relative units)</text>
            <text transform="translate(18 343) rotate(-90)" textAnchor="middle" fill="#e2e8f0" fontSize="10">Reactant concentration (% initial)</text>
            {isRevealed ? (
              <>
                {catalystEnabled && <path d={pathFor(noCatalystReference.concentrationCurve)} fill="none" stroke="#f87171" strokeWidth="2" strokeDasharray="6 4" />}
                <path d={pathFor(result.concentrationCurve)} fill="none" stroke={catalystEnabled ? '#34d399' : '#60a5fa'} strokeWidth="3" />
              </>
            ) : (
              <g><rect x="220" y="310" width="360" height="62" rx="10" fill="#111827" stroke="#475569" /><text x="400" y="336" textAnchor="middle" fill="#cbd5e1" fontSize="13" fontWeight="bold">Predict before revealing concentration–time</text><text x="400" y="357" textAnchor="middle" fill="#94a3b8" fontSize="10">Axes remain visible; quantitative curve geometry is hidden.</text></g>
            )}
          </svg>
          <div aria-label="Reaction-rate diagram legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: '8px', color: 'var(--text-secondary)', fontSize: '10px' }}>
            <span>● blue/pink: reactant particles</span>
            {isRevealed && <span>● amber ring: sampled particle above the model energy barrier</span>}
            <span>-- red: no-catalyst reference</span>
            <span>— green/blue: selected concentration curve</span>
          </div>
          <p style={{ margin: '7px 2px 0', color: 'var(--text-muted)', fontSize: '10px', lineHeight: 1.45 }}>Collision frequency depends on temperature, concentration, and exposed surface area here; the catalyst changes the successful fraction by lowering the barrier, not the collision-frequency index. {result.limitation}</p>
        </div>
      }
    />
  );
}
