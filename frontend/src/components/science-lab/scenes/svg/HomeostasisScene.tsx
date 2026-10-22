'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import type { HomeostasisSceneData as RegisteredHomeostasisSceneData } from '../../../../lib/science-lab/activity-types';
import {
  simulateHomeostasis,
  type HomeostasisCondition,
  type HomeostasisDisturbance,
  type HomeostasisSceneData,
} from '../../../../lib/science-lab/models/homeostasis';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSliderInput from '../../../lab-shared/LabSliderInput';

type HomeostasisModelSceneProps = Omit<
  ScienceSceneProps<RegisteredHomeostasisSceneData>,
  'sceneData' | 'onSceneDataChange'
> & {
  sceneData: HomeostasisSceneData;
  onSceneDataChange?: (patch: Partial<HomeostasisSceneData>) => void;
};

const buttonStyle = (selected: boolean): React.CSSProperties => ({
  padding: '7px 9px',
  borderRadius: '7px',
  border: '1px solid var(--border-color)',
  background: selected ? 'rgba(16, 185, 129, 0.18)' : 'var(--bg-primary)',
  color: selected ? '#10b981' : 'var(--text-primary)',
  fontSize: '11px',
  fontWeight: 700,
  cursor: 'pointer',
});

export default function HomeostasisScene(
  props: ScienceSceneProps<RegisteredHomeostasisSceneData> | HomeostasisModelSceneProps,
) {
  const { onReadoutChange, isRevealed = false } = props;
  const sceneData = props.sceneData as Partial<HomeostasisSceneData>;
  const onSceneDataChange = props.onSceneDataChange as HomeostasisModelSceneProps['onSceneDataChange'];
  const [disturbance, setDisturbance] = useState<HomeostasisDisturbance>(sceneData.disturbance ?? 'meal');
  const [insulinSensitivity, setInsulinSensitivity] = useState(sceneData.insulinSensitivity ?? 1);
  const [controllerStrength, setControllerStrength] = useState(sceneData.controllerStrength ?? 1);
  const [condition, setCondition] = useState<HomeostasisCondition>(sceneData.condition ?? 'normal');
  const [seed, setSeed] = useState(sceneData.seed ?? 42);

  useEffect(() => {
    setDisturbance(sceneData.disturbance ?? 'meal');
    setInsulinSensitivity(sceneData.insulinSensitivity ?? 1);
    setControllerStrength(sceneData.controllerStrength ?? 1);
    setCondition(sceneData.condition ?? 'normal');
    setSeed(sceneData.seed ?? 42);
  }, [
    sceneData.condition,
    sceneData.controllerStrength,
    sceneData.disturbance,
    sceneData.insulinSensitivity,
    sceneData.seed,
  ]);

  const modelData = useMemo<HomeostasisSceneData>(() => ({
    kind: 'homeostasis',
    disturbance,
    insulinSensitivity,
    controllerStrength,
    condition,
    seed,
  }), [condition, controllerStrength, disturbance, insulinSensitivity, seed]);
  const result = useMemo(() => simulateHomeostasis(modelData), [modelData]);
  const normalReference = useMemo(
    () => simulateHomeostasis({ ...modelData, condition: 'normal' }, 'normal'),
    [modelData],
  );

  useEffect(() => {
    onReadoutChange?.(isRevealed ? {
      condition,
      disturbance,
      peakGlucose: result.peakGlucoseMmolL,
      minimumGlucose: result.minimumGlucoseMmolL,
      finalGlucose: result.finalGlucoseMmolL,
      returnTime: result.returnTimeMin === null ? 'Not within 180 min' : result.returnTimeMin,
    } : {});
  }, [condition, disturbance, isRevealed, onReadoutChange, result]);

  const setDisturbanceAndPatch = (next: HomeostasisDisturbance) => {
    setDisturbance(next);
    onSceneDataChange?.({ disturbance: next });
  };
  const setSensitivityAndPatch = (next: number) => {
    setInsulinSensitivity(next);
    onSceneDataChange?.({ insulinSensitivity: next });
  };
  const setControllerAndPatch = (next: number) => {
    setControllerStrength(next);
    onSceneDataChange?.({ controllerStrength: next });
  };
  const setConditionAndPatch = (next: HomeostasisCondition) => {
    setCondition(next);
    onSceneDataChange?.({ condition: next });
  };
  const setSeedAndPatch = (next: number) => {
    const normalised = Math.max(1, Math.round(next));
    setSeed(normalised);
    onSceneDataChange?.({ seed: normalised });
  };

  const chart = { left: 68, right: 680, top: 174, bottom: 342 };
  // Fixed physiological display bounds prevent the locked chart axes from
  // revealing the simulated peak before the prediction is submitted.
  const yMin = 2;
  const yMax = 15;
  const xFor = (time: number) => chart.left + (time / 180) * (chart.right - chart.left);
  const yFor = (glucose: number) => chart.bottom
    - ((glucose - yMin) / (yMax - yMin)) * (chart.bottom - chart.top);
  const pathFor = (points: typeof result.points) => points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(point.timeMin).toFixed(1)} ${yFor(point.glucoseMmolL).toFixed(1)}`)
    .join(' ');

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Disturbance" description="Apply one disturbance to the glucose set point.">
            <div role="group" aria-label="Glucose disturbance" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {(['meal', 'exercise'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={disturbance === option}
                  onClick={() => setDisturbanceAndPatch(option)}
                  style={buttonStyle(disturbance === option)}
                >
                  {option === 'meal' ? 'Meal: glucose enters blood' : 'Exercise: glucose uptake rises'}
                </button>
              ))}
            </div>
          </LabControlCard>

          <LabControlCard title="Negative-feedback controller">
            <LabSliderInput
              id="homeostasis-sensitivity"
              label="Insulin sensitivity"
              ariaLabel="Relative insulin sensitivity"
              value={insulinSensitivity}
              min={0.1}
              max={1.5}
              step={0.1}
              decimals={1}
              valueSuffix=" ×"
              onChange={setSensitivityAndPatch}
            />
            <div style={{ marginTop: '12px' }}>
              <LabSliderInput
                id="homeostasis-controller"
                label="Controller strength"
                ariaLabel="Relative feedback controller strength"
                value={controllerStrength}
                min={0}
                max={1.5}
                step={0.1}
                decimals={1}
                valueSuffix=" ×"
                onChange={setControllerAndPatch}
              />
            </div>
          </LabControlCard>

          <LabControlCard title="Counterfactual & repeat">
            <div role="group" aria-label="Health condition counterfactual" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {(['normal', 'diabetes'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={condition === option}
                  onClick={() => setConditionAndPatch(option)}
                  style={buttonStyle(condition === option)}
                >
                  {option === 'normal' ? 'Normal feedback' : 'Diabetes counterfactual'}
                </button>
              ))}
            </div>
            <div style={{ marginTop: '12px' }}>
              <LabSliderInput
                id="homeostasis-seed"
                label="Repeatable scenario seed"
                ariaLabel="Repeatable homeostasis scenario seed"
                value={seed}
                min={1}
                max={999}
                step={1}
                decimals={0}
                onChange={setSeedAndPatch}
              />
            </div>
          </LabControlCard>
        </div>
      }
      visual={
        <div className="glass-panel" style={{ padding: '16px', borderRadius: '16px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)' }}>Negative Feedback & Blood-glucose Time Graph</h4>
            <strong style={{ fontSize: '11px', color: isRevealed ? '#10b981' : 'var(--text-muted)' }}>
              {isRevealed ? `Final ${result.finalGlucoseMmolL.toFixed(2)} mmol/L` : 'Outcome 🔒'}
            </strong>
          </div>
          <svg
            viewBox="0 0 720 370"
            className="science-scene-svg"
            role="img"
            aria-label={isRevealed
              ? `${condition} feedback after a ${disturbance} disturbance. Glucose ranges from ${result.minimumGlucoseMmolL.toFixed(2)} to ${result.peakGlucoseMmolL.toFixed(2)} millimoles per litre over 180 minutes.`
              : `Negative feedback diagram for a ${disturbance} disturbance. The quantitative glucose time graph is locked until the prediction is submitted.`}
            style={{ background: '#0f172a', borderRadius: '12px' }}
          >
            <title>{isRevealed ? 'Blood-glucose negative-feedback response over time' : 'Negative-feedback pathway with glucose outcome locked'}</title>

            <g aria-label="Negative feedback pathway">
              <rect x="32" y="38" width="128" height="54" rx="9" fill="#1e3a8a" stroke="#60a5fa" />
              <text x="96" y="59" textAnchor="middle" fill="#dbeafe" fontSize="11" fontWeight="bold">Disturbance</text>
              <text x="96" y="77" textAnchor="middle" fill="#93c5fd" fontSize="10">{disturbance === 'meal' ? 'glucose input ↑' : 'muscle uptake ↑'}</text>
              <path d="M 160 65 L 222 65" stroke="#f59e0b" strokeWidth="2.5" markerEnd="url(#homeostasis-arrow)" />
              <rect x="226" y="38" width="132" height="54" rx="9" fill="#3f1d57" stroke="#c084fc" />
              <text x="292" y="59" textAnchor="middle" fill="#f3e8ff" fontSize="11" fontWeight="bold">Sensor / controller</text>
              <text x="292" y="77" textAnchor="middle" fill="#d8b4fe" fontSize="10">compare with 5.0 mmol/L</text>
              <path d="M 358 65 L 420 65" stroke="#10b981" strokeWidth="2.5" markerEnd="url(#homeostasis-arrow)" />
              <rect x="424" y="38" width="132" height="54" rx="9" fill="#064e3b" stroke="#34d399" />
              <text x="490" y="59" textAnchor="middle" fill="#d1fae5" fontSize="11" fontWeight="bold">Effectors</text>
              <text x="490" y="77" textAnchor="middle" fill="#6ee7b7" fontSize="10">storage / release</text>
              <path d="M 556 65 C 650 65, 650 126, 292 126 L 292 96" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="6 4" markerEnd="url(#homeostasis-arrow)" />
              <text x="548" y="119" fill="#fca5a5" fontSize="10">response opposes change (− feedback)</text>
            </g>
            <defs>
              <marker id="homeostasis-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
              </marker>
            </defs>

            <line x1={chart.left} y1={chart.bottom} x2={chart.right} y2={chart.bottom} stroke="#94a3b8" strokeWidth="1.5" />
            <line x1={chart.left} y1={chart.top} x2={chart.left} y2={chart.bottom} stroke="#94a3b8" strokeWidth="1.5" />
            {[0, 30, 60, 90, 120, 150, 180].map((tick) => (
              <g key={tick}>
                <line x1={xFor(tick)} y1={chart.bottom} x2={xFor(tick)} y2={chart.bottom + 5} stroke="#94a3b8" />
                <text x={xFor(tick)} y={chart.bottom + 17} textAnchor="middle" fill="#cbd5e1" fontSize="9">{tick}</text>
              </g>
            ))}
            {Array.from({ length: yMax - yMin + 1 }, (_, index) => yMin + index).map((tick) => (
              <g key={tick}>
                <line x1={chart.left - 5} y1={yFor(tick)} x2={chart.left} y2={yFor(tick)} stroke="#94a3b8" />
                <text x={chart.left - 10} y={yFor(tick) + 3} textAnchor="end" fill="#cbd5e1" fontSize="9">{tick}</text>
              </g>
            ))}
            <text x={(chart.left + chart.right) / 2} y="366" textAnchor="middle" fill="#e2e8f0" fontSize="10">Time after disturbance (min)</text>
            <text transform="translate(16 258) rotate(-90)" textAnchor="middle" fill="#e2e8f0" fontSize="10">Blood glucose (mmol/L)</text>

            {isRevealed ? (
              <>
                <line x1={chart.left} y1={yFor(5)} x2={chart.right} y2={yFor(5)} stroke="#fbbf24" strokeDasharray="5 4" />
                {condition === 'diabetes' && <path d={pathFor(normalReference.points)} fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="6 4" />}
                <path d={pathFor(result.points)} fill="none" stroke={condition === 'diabetes' ? '#f87171' : '#34d399'} strokeWidth="3" />
              </>
            ) : (
              <g>
                <rect x="210" y="220" width="330" height="60" rx="10" fill="#111827" stroke="#475569" />
                <text x="375" y="246" textAnchor="middle" fill="#cbd5e1" fontSize="13" fontWeight="bold">Submit your prediction to reveal the time graph</text>
                <text x="375" y="266" textAnchor="middle" fill="#94a3b8" fontSize="10">Controls and the qualitative feedback loop remain available.</text>
              </g>
            )}
          </svg>
          <div aria-label="Homeostasis graph legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: '8px', color: 'var(--text-secondary)', fontSize: '10px' }}>
            <span>— solid green/red: selected condition</span>
            <span>-- blue: normal reference in diabetes counterfactual</span>
            <span>-- amber: 5.0 mmol/L classroom set point</span>
          </div>
          <p style={{ margin: '7px 2px 0', color: 'var(--text-muted)', fontSize: '10px', lineHeight: 1.45 }}>{result.limitation}</p>
        </div>
      }
    />
  );
}
