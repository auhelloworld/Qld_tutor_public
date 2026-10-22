'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabSliderInput from '../../../lab-shared/LabSliderInput';
import SimulationControls from '../../controls/SimulationControls';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import { useDocumentHidden, usePrefersReducedMotion } from '../../../../lib/science-lab/use-scene-canvas';
import {
  calculateHalfLife,
  HALF_LIFE_MODEL_LIMITATIONS,
  RADIATION_CONCEPT_COMPARISON,
  type HalfLifeSceneData,
} from '../../../../lib/science-lab/models/half-life';

export default function HalfLifeScene({
  sceneData,
  onSceneDataChange,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<HalfLifeSceneData>) {
  const [initialNuclei, setInitialNuclei] = useState(sceneData.initialNuclei ?? 96);
  const [halfLifeSeconds, setHalfLifeSeconds] = useState(sceneData.halfLifeSeconds ?? 20);
  const [elapsedTimeSeconds, setElapsedTimeSeconds] = useState(sceneData.elapsedTimeSeconds ?? 0);
  const [timeStepSeconds, setTimeStepSeconds] = useState(sceneData.timeStepSeconds ?? 5);
  const [seed, setSeed] = useState(sceneData.seed ?? 42);
  const [isPlaying, setIsPlaying] = useState(false);
  const isDocumentHidden = useDocumentHidden();
  const isReducedMotion = usePrefersReducedMotion();
  const maxTime = halfLifeSeconds * 5;
  const effectiveTimeStepSeconds = Math.min(timeStepSeconds, maxTime, 60);

  const modelInput = useMemo<HalfLifeSceneData>(() => ({
    kind: 'half-life',
    initialNuclei,
    halfLifeSeconds,
    elapsedTimeSeconds,
    timeStepSeconds: effectiveTimeStepSeconds,
    seed,
  }), [effectiveTimeStepSeconds, elapsedTimeSeconds, halfLifeSeconds, initialNuclei, seed]);
  const result = useMemo(() => calculateHalfLife(modelInput), [modelInput]);

  const resetSample = useCallback(() => {
    setIsPlaying(false);
    setElapsedTimeSeconds(0);
    onSceneDataChange?.({ elapsedTimeSeconds: 0 });
  }, [onSceneDataChange]);

  const changeInitialNuclei = (value: number) => {
    setInitialNuclei(value);
    setIsPlaying(false);
    setElapsedTimeSeconds(0);
    onSceneDataChange?.({ initialNuclei: value, elapsedTimeSeconds: 0 });
  };
  const changeHalfLife = (value: number) => {
    setHalfLifeSeconds(value);
    setIsPlaying(false);
    setElapsedTimeSeconds(0);
    onSceneDataChange?.({ halfLifeSeconds: value, elapsedTimeSeconds: 0 });
  };
  const changeSeed = (value: number) => {
    setSeed(value);
    setIsPlaying(false);
    setElapsedTimeSeconds(0);
    onSceneDataChange?.({ seed: value, elapsedTimeSeconds: 0 });
  };
  const changeElapsed = (value: number) => {
    const next = Math.max(0, Math.min(maxTime, value));
    setElapsedTimeSeconds(next);
    onSceneDataChange?.({ elapsedTimeSeconds: next });
  };
  const stepForward = useCallback(() => {
    setElapsedTimeSeconds((previous) => Math.min(maxTime, previous + effectiveTimeStepSeconds));
  }, [effectiveTimeStepSeconds, maxTime]);

  useEffect(() => {
    if (!isPlaying || isDocumentHidden || isReducedMotion) return;
    const timer = setInterval(stepForward, 700);
    return () => clearInterval(timer);
  }, [isDocumentHidden, isPlaying, isReducedMotion, stepForward]);

  useEffect(() => {
    if (elapsedTimeSeconds >= maxTime && isPlaying) setIsPlaying(false);
  }, [elapsedTimeSeconds, isPlaying, maxTime]);

  useEffect(() => {
    onReadoutChange?.(isRevealed
      ? {
          elapsedTime: result.elapsedTimeSeconds,
          remainingNuclei: result.remainingCount,
          decayedNuclei: result.decayedCount,
          remainingPercent: Math.round(result.remainingFraction * 100),
          theoreticalRemaining: Number(result.theoreticalRemaining.toFixed(1)),
          activity: Number(result.activityPerSecond.toFixed(2)),
        }
      : {});
  }, [isRevealed, onReadoutChange, result]);

  const columns = Math.max(1, ...result.nuclei.map((nucleus) => nucleus.column + 1));
  const rows = Math.max(1, ...result.nuclei.map((nucleus) => nucleus.row + 1));
  const spacing = Math.min(27, 420 / columns, 218 / rows);
  const gridStartX = (480 - (columns - 1) * spacing) / 2;
  const gridStartY = 46 + (220 - (rows - 1) * spacing) / 2;
  const curveEnd = Math.max(maxTime, elapsedTimeSeconds, effectiveTimeStepSeconds);
  const theoreticalPoints = result.curve.map((point) => {
    const x = 55 + (point.timeSeconds / curveEnd) * 405;
    const y = 178 - (point.expectedRemaining / initialNuclei) * 132;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const samplePoints = Array.from({ length: 21 }, (_, index) => {
    const time = (curveEnd * index) / 20;
    const remaining = result.nuclei.filter((nucleus) => nucleus.decayTimeSeconds > time).length;
    return {
      x: 55 + (time / curveEnd) * 405,
      y: 178 - (remaining / initialNuclei) * 132,
    };
  });
  const elapsedX = 55 + (Math.min(elapsedTimeSeconds, curveEnd) / curveEnd) * 405;

  const playbackStatus = isDocumentHidden
    ? 'Paused while page is hidden'
    : isReducedMotion
      ? 'Paused for reduced motion'
      : isPlaying
        ? 'Running seeded decay sample'
        : 'Paused';

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Radioactive sample">
            <LabSliderInput
              id="initialNuclei"
              label="Initial Sample Size"
              ariaLabel="Initial number of unstable nuclei"
              value={initialNuclei}
              min={16}
              max={160}
              step={1}
              decimals={0}
              onChange={changeInitialNuclei}
            />
            <LabSliderInput
              id="half-life-duration"
              label="Half-life"
              ariaLabel="Isotope half-life in seconds"
              value={halfLifeSeconds}
              min={1}
              max={120}
              step={1}
              decimals={0}
              valueSuffix=" s"
              onChange={changeHalfLife}
            />
            <LabSliderInput
              id="half-life-seed"
              label="Sample seed"
              ariaLabel="Deterministic radioactive sample seed"
              value={seed}
              min={0}
              max={9999}
              step={1}
              decimals={0}
              onChange={changeSeed}
            />
          </LabControlCard>

          <LabControlCard title="Time controls">
            <LabSliderInput
              id="half-life-elapsed"
              label="Elapsed time"
              ariaLabel="Elapsed decay time in seconds"
              value={Math.min(elapsedTimeSeconds, maxTime)}
              min={0}
              max={maxTime}
              step={0.5}
              decimals={1}
              valueSuffix=" s"
              onChange={changeElapsed}
            />
            <LabSliderInput
              id="timeStepSeconds"
              label="Time Step"
              ariaLabel="Simulation time step in seconds"
              value={effectiveTimeStepSeconds}
              min={0.5}
              max={Math.min(60, maxTime)}
              step={0.5}
              decimals={1}
              valueSuffix=" s"
              onChange={(value) => {
                setTimeStepSeconds(value);
                onSceneDataChange?.({ timeStepSeconds: value });
              }}
            />
            <SimulationControls
              isPlaying={isPlaying}
              onTogglePlay={() => setIsPlaying((previous) => !previous)}
              onStepForward={stepForward}
              onReset={resetSample}
            />
            <p aria-live="polite" style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '11px' }}>
              {playbackStatus}. Same settings + same seed = same sample.
            </p>
          </LabControlCard>

          <LabControlCard title="Irradiation is not contamination" compact>
            <div style={{ display: 'grid', gap: '8px', fontSize: '11px', lineHeight: 1.4 }}>
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                <strong style={{ color: '#f59e0b' }}>◇ Irradiation:</strong> {RADIATION_CONCEPT_COMPARISON.irradiation}
              </p>
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                <strong style={{ color: '#ef4444' }}>● Contamination:</strong> {RADIATION_CONCEPT_COMPARISON.contamination}
              </p>
            </div>
          </LabControlCard>

          <LabControlCard title="Scientific limits" compact>
            <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.45 }}>
              {HALF_LIFE_MODEL_LIMITATIONS.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          </LabControlCard>
        </div>
      }
      visual={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="glass-panel" style={{ padding: '12px' }}>
            <svg
              viewBox="0 0 480 300"
              className="science-scene-svg"
              role="img"
              aria-label={isRevealed
                ? `Seeded nuclei grid at ${elapsedTimeSeconds.toFixed(1)} seconds: ${result.remainingCount} remain and ${result.decayedCount} have decayed.`
                : 'Seeded radioactive nuclei grid; decay outcomes are hidden until prediction submission.'}
            >
              <title>Seeded radioactive nuclei grid</title>
              <rect x="1" y="1" width="478" height="298" rx="12" fill="var(--bg-primary)" stroke="var(--border-color)" />
              <text x="240" y="23" textAnchor="middle" fill="var(--text-primary)" fontSize="14" fontWeight="700">Nuclei sample</text>
              {result.nuclei.map((nucleus) => {
                const x = gridStartX + nucleus.column * spacing;
                const y = gridStartY + nucleus.row * spacing;
                const decayed = nucleus.decayTimeSeconds <= elapsedTimeSeconds;
                return (
                  <g key={nucleus.id} transform={`translate(${x} ${y})`}>
                    <circle
                      r={Math.max(4, spacing * 0.29)}
                      fill={isRevealed ? (decayed ? '#334155' : '#22c55e') : '#64748b'}
                      stroke={isRevealed && decayed ? '#ef4444' : '#cbd5e1'}
                      strokeWidth="1.5"
                    />
                    {isRevealed && decayed && (
                      <path d="M-3.5 -3.5 L3.5 3.5 M3.5 -3.5 L-3.5 3.5" stroke="#fca5a5" strokeWidth="1.5" />
                    )}
                  </g>
                );
              })}
              {!isRevealed && (
                <g>
                  <rect x="95" y="122" width="290" height="52" rx="9" fill="#0f172aee" stroke="#94a3b8" strokeDasharray="5 4" />
                  <text x="240" y="144" textAnchor="middle" fill="#f8fafc" fontSize="12" fontWeight="700">Outcomes hidden</text>
                  <text x="240" y="161" textAnchor="middle" fill="#cbd5e1" fontSize="10">Submit a prediction to reveal which nuclei decayed.</text>
                </g>
              )}
              <g transform="translate(70 279)" fill="var(--text-secondary)" fontSize="9">
                <circle cx="0" cy="0" r="5" fill="#22c55e" stroke="#cbd5e1" />
                <text x="10" y="3">circle = undecayed nucleus</text>
                <circle cx="185" cy="0" r="5" fill="#334155" stroke="#ef4444" />
                <path d="M181 -4 L189 4 M189 -4 L181 4" stroke="#fca5a5" />
                <text x="197" y="3">crossed circle = decayed nucleus</text>
              </g>
            </svg>
          </div>

          <div className="glass-panel" style={{ padding: '12px' }}>
            <svg
              viewBox="0 0 480 225"
              className="science-scene-svg"
              role="img"
              aria-label={isRevealed
                ? `Decay graph in seconds and nuclei, showing the seeded sample against the theoretical half-life curve.`
                : 'Decay graph with time in seconds and number of nuclei axes; data are hidden until prediction submission.'}
            >
              <title>Seeded sample and theoretical radioactive-decay curve</title>
              <rect x="1" y="1" width="478" height="223" rx="12" fill="var(--bg-primary)" stroke="var(--border-color)" />
              <text x="240" y="22" textAnchor="middle" fill="var(--text-primary)" fontSize="14" fontWeight="700">Nuclei remaining over time</text>
              <line x1="55" y1="178" x2="460" y2="178" stroke="var(--text-secondary)" />
              <line x1="55" y1="46" x2="55" y2="178" stroke="var(--text-secondary)" />
              {[0, 1, 2, 3, 4, 5].map((multiple) => {
                const x = 55 + (multiple / 5) * 405;
                return (
                  <g key={multiple}>
                    <line x1={x} y1="178" x2={x} y2="183" stroke="var(--text-secondary)" />
                    <text x={x} y="196" textAnchor="middle" fill="var(--text-secondary)" fontSize="8">{Math.round((curveEnd * multiple) / 5)}</text>
                  </g>
                );
              })}
              {[0, 0.5, 1].map((fraction) => {
                const y = 178 - fraction * 132;
                return (
                  <g key={fraction}>
                    <line x1="50" y1={y} x2="55" y2={y} stroke="var(--text-secondary)" />
                    <text x="46" y={y + 3} textAnchor="end" fill="var(--text-secondary)" fontSize="8">{Math.round(initialNuclei * fraction)}</text>
                  </g>
                );
              })}
              <text x="258" y="214" textAnchor="middle" fill="var(--text-secondary)" fontSize="10">Elapsed time (s)</text>
              <text x="14" y="112" textAnchor="middle" transform="rotate(-90 14 112)" fill="var(--text-secondary)" fontSize="10">Nuclei remaining (count)</text>
              {isRevealed ? (
                <>
                  <polyline points={theoreticalPoints} fill="none" stroke="#38bdf8" strokeWidth="2.5" />
                  {samplePoints.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="2.5" fill="#f59e0b" />)}
                  <line x1={elapsedX} y1="46" x2={elapsedX} y2="178" stroke="#ef4444" strokeDasharray="5 4" />
                </>
              ) : (
                <text x="258" y="116" textAnchor="middle" fill="var(--text-secondary)" fontSize="11">Curve hidden by prediction gate</text>
              )}
              <g transform="translate(185 34)" fill="var(--text-secondary)" fontSize="8">
                <line x1="0" y1="0" x2="20" y2="0" stroke="#38bdf8" strokeWidth="2.5" />
                <text x="25" y="3">theoretical curve</text>
                <circle cx="118" cy="0" r="3" fill="#f59e0b" />
                <text x="126" y="3">seeded sample</text>
              </g>
            </svg>
          </div>
        </div>
      }
    />
  );
}
