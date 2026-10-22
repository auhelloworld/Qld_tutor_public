'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import type { ParticleModelSceneData } from '../../../../lib/science-lab/activity-types';
import {
  initParticleSystem,
  measureParticleSystem,
  stepParticleSystem,
  type ParticleMetrics,
  type ParticleSystemState,
} from '../../../../lib/science-lab/models/particles';
import { assertScienceRenderBudget } from '../../../../lib/science-lab/performance';
import {
  useDocumentHidden,
  usePrefersReducedMotion,
  useSceneCanvas,
} from '../../../../lib/science-lab/use-scene-canvas';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSliderInput from '../../../lab-shared/LabSliderInput';
import SimulationControls from '../../controls/SimulationControls';

const WORLD_W = 440;
const WORLD_H = 320;
const FIXED_STEP_SECONDS = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;
const PARTICLE_SEED = 42;

type MacroMetrics = Pick<
  ParticleMetrics,
  'relativeSpeed' | 'meanSpacingPx' | 'relativePressure' | 'stateLabel'
>;

function toMacroMetrics(metrics: ParticleMetrics): MacroMetrics {
  return {
    relativeSpeed: metrics.relativeSpeed,
    meanSpacingPx: metrics.meanSpacingPx,
    relativePressure: metrics.relativePressure,
    stateLabel: metrics.stateLabel,
  };
}

export default function ParticleModelScene({
  sceneData,
  onSceneDataChange,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<ParticleModelSceneData>) {
  const requestedParticleCount = Math.min(
    250,
    Math.max(1, Math.round(sceneData.particleCount ?? 120)),
  );
  const [temperatureK, setTemperatureK] = useState(sceneData.temperatureK ?? 300);
  const [mode, setMode] = useState<'states' | 'diffusion' | 'dissolving'>(
    sceneData.stateMode ?? 'states',
  );
  const [isPlaying, setIsPlaying] = useState(sceneData.isPlaying ?? true);
  const [showExpandingParticleModel, setShowExpandingParticleModel] = useState(false);
  const [initialSystem] = useState(() =>
    initParticleSystem(
      sceneData.stateMode ?? 'states',
      sceneData.temperatureK ?? 300,
      WORLD_W,
      WORLD_H,
      PARTICLE_SEED,
      requestedParticleCount,
    ),
  );
  const stateRef = useRef<ParticleSystemState>(initialSystem);
  const [macro, setMacro] = useState<MacroMetrics>(() =>
    toMacroMetrics(measureParticleSystem(initialSystem)),
  );
  const animFrameIdRef = useRef<number | null>(null);
  const lastReadoutKeyRef = useRef<string | null>(null);
  const previousParticleCountRef = useRef(requestedParticleCount);

  const { canvasRef, canvasStyle, prepareFrame, logicalWidth, logicalHeight } = useSceneCanvas(
    WORLD_W,
    WORLD_H,
    880,
  );
  const isDocumentHidden = useDocumentHidden();
  const isReducedMotion = usePrefersReducedMotion();
  const resumeAfterReducedMotionRef = useRef(false);
  const wasReducedMotionRef = useRef(false);
  const shouldAnimate = isPlaying && !isDocumentHidden && !isReducedMotion;

  useEffect(() => {
    if (isReducedMotion && !wasReducedMotionRef.current) {
      setIsPlaying((previous) => {
        resumeAfterReducedMotionRef.current = previous;
        return false;
      });
    } else if (!isReducedMotion && wasReducedMotionRef.current && resumeAfterReducedMotionRef.current) {
      resumeAfterReducedMotionRef.current = false;
      setIsPlaying(true);
    }
    wasReducedMotionRef.current = isReducedMotion;
  }, [isReducedMotion]);

  const publishMetrics = useCallback(
    (metrics: ParticleMetrics) => {
      const nextMacro = toMacroMetrics(metrics);
      setMacro((previous) =>
        previous.relativeSpeed === nextMacro.relativeSpeed &&
        previous.meanSpacingPx === nextMacro.meanSpacingPx &&
        previous.relativePressure === nextMacro.relativePressure &&
        previous.stateLabel === nextMacro.stateLabel
          ? previous
          : nextMacro,
      );

      if (!onReadoutChange) return;

      const readouts: Record<string, string | number> = isRevealed
        ? {
            temperatureReadout: temperatureK,
            avgKineticEnergy: `${metrics.relativeSpeed.toFixed(2)}× baseline`,
            meanSpacing: `${metrics.meanSpacingPx} canvas px instantaneous proximity`,
            stateLabel: metrics.stateLabel,
            gasPressure: `${metrics.relativePressure.toFixed(2)} relative index`,
          }
        : {};
      const readoutKey = JSON.stringify(readouts);
      if (readoutKey !== lastReadoutKeyRef.current) {
        lastReadoutKeyRef.current = readoutKey;
        onReadoutChange(readouts);
      }
    },
    [isRevealed, onReadoutChange, temperatureK],
  );

  const renderFrame = useCallback(() => {
    const ctx = prepareFrame();
    if (!ctx) return;

    const width = logicalWidth;
    const height = logicalHeight;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, width - 8, height - 8);

    const particles = stateRef.current.particles;
    assertScienceRenderBudget('particles', particles.length);

    if (showExpandingParticleModel) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
      ctx.fillRect(0, 0, width, 26);
      ctx.fillStyle = '#fca5a5';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText(
        isRevealed
          ? 'CONTRAST MODEL: particle radius changes with temperature'
          : 'MODEL B: alternative particle-size representation',
        12,
        18,
      );
    }

    const radiusFactor = showExpandingParticleModel
      ? 1 + Math.max(0, (temperatureK - 140) / 380) * 1.6
      : 1;

    for (const particle of particles) {
      const radius = particle.radius * radiusFactor;
      ctx.beginPath();
      if (particle.kind === 'solute') {
        // Solute uses a diamond, so species remains identifiable without colour.
        ctx.moveTo(particle.x, particle.y - radius * 1.25);
        ctx.lineTo(particle.x + radius * 1.25, particle.y);
        ctx.lineTo(particle.x, particle.y + radius * 1.25);
        ctx.lineTo(particle.x - radius * 1.25, particle.y);
        ctx.closePath();
        ctx.fillStyle = '#ec4899';
      } else {
        ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        if (temperatureK < 200) {
          ctx.fillStyle = '#38bdf8';
        } else if (temperatureK >= 420) {
          ctx.fillStyle = '#fb923c';
        } else {
          ctx.fillStyle = '#60a5fa';
        }
      }
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = particle.kind === 'solute' ? 1.5 : 1;
      ctx.stroke();
    }
  }, [
    isRevealed,
    logicalHeight,
    logicalWidth,
    prepareFrame,
    showExpandingParticleModel,
    temperatureK,
  ]);

  const replaceSystem = useCallback(
    (newMode: 'states' | 'diffusion' | 'dissolving') => {
      const nextSystem = initParticleSystem(
        newMode,
        temperatureK,
        WORLD_W,
        WORLD_H,
        PARTICLE_SEED,
        requestedParticleCount,
      );
      stateRef.current = nextSystem;
      publishMetrics(measureParticleSystem(nextSystem, temperatureK));
      renderFrame();
    },
    [publishMetrics, renderFrame, requestedParticleCount, temperatureK],
  );

  useEffect(() => {
    if (previousParticleCountRef.current === requestedParticleCount) return;
    previousParticleCountRef.current = requestedParticleCount;
    replaceSystem(mode);
  }, [mode, replaceSystem, requestedParticleCount]);

  const handleModeChange = useCallback(
    (newMode: 'states' | 'diffusion' | 'dissolving') => {
      setMode(newMode);
      replaceSystem(newMode);
      onSceneDataChange?.({ stateMode: newMode });
    },
    [onSceneDataChange, replaceSystem],
  );

  const handleTemperatureChange = useCallback(
    (newTemperature: number) => {
      setTemperatureK(newTemperature);
      onSceneDataChange?.({ temperatureK: newTemperature });
    },
    [onSceneDataChange],
  );

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((previous) => {
      const next = !previous;
      onSceneDataChange?.({ isPlaying: next });
      return next;
    });
  }, [onSceneDataChange]);

  const handleStepForward = useCallback(() => {
    const { state, metrics } = stepParticleSystem(
      stateRef.current,
      FIXED_STEP_SECONDS,
      temperatureK,
    );
    stateRef.current = state;
    publishMetrics(metrics);
    renderFrame();
  }, [publishMetrics, renderFrame, temperatureK]);

  const handleReset = useCallback(() => {
    replaceSystem(mode);
  }, [mode, replaceSystem]);

  useEffect(() => {
    publishMetrics(measureParticleSystem(stateRef.current, temperatureK));
    renderFrame();
  }, [isRevealed, publishMetrics, renderFrame, temperatureK]);

  useEffect(() => {
    renderFrame();
    if (!shouldAnimate) return;

    let cancelled = false;
    let lastTime: number | null = null;
    let accumulator = 0;

    const tick = (now: number) => {
      if (cancelled) return;

      if (lastTime === null) lastTime = now;
      accumulator += Math.min(
        Math.max(0, (now - lastTime) / 1000),
        FIXED_STEP_SECONDS * MAX_STEPS_PER_FRAME,
      );
      lastTime = now;

      let latestMetrics: ParticleMetrics | null = null;
      let steps = 0;
      while (accumulator >= FIXED_STEP_SECONDS && steps < MAX_STEPS_PER_FRAME) {
        const result = stepParticleSystem(
          stateRef.current,
          FIXED_STEP_SECONDS,
          temperatureK,
        );
        stateRef.current = result.state;
        latestMetrics = result.metrics;
        accumulator -= FIXED_STEP_SECONDS;
        steps += 1;
      }

      if (latestMetrics) publishMetrics(latestMetrics);
      renderFrame();
      if (!cancelled) animFrameIdRef.current = requestAnimationFrame(tick);
    };

    animFrameIdRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
    };
  }, [publishMetrics, renderFrame, shouldAnimate, temperatureK]);

  const playbackStatus = isDocumentHidden
    ? 'Paused while this page is hidden'
    : isReducedMotion
      ? 'Paused for reduced motion'
      : isPlaying
        ? 'Running'
        : 'Paused';

  const counterfactualButtonText = isRevealed
    ? showExpandingParticleModel
      ? '🔄 Counterfactual: return to the fixed-radius particle model'
      : '⚡ Counterfactual: compare with a temperature-scaled radius model'
    : showExpandingParticleModel
      ? '🔄 Counterfactual: show Model A'
      : '⚡ Counterfactual: show Model B for comparison';

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Thermal & State Controls">
            <LabSliderInput
              id="particle-temp"
              label="System Temperature (T)"
              ariaLabel="System temperature in Kelvin"
              value={temperatureK}
              min={100}
              max={600}
              step={5}
              valueSuffix=" K"
              onChange={handleTemperatureChange}
            />

            <div
              role="group"
              aria-label="Temperature presets"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '6px',
                marginTop: '8px',
              }}
            >
              {[
                { label: '🧊 Solid (140K)', value: 140, active: temperatureK === 140, colour: '#38bdf8' },
                {
                  label: '💧 Liquid (300K)',
                  value: 300,
                  active: temperatureK === 300,
                  colour: '#60a5fa',
                },
                { label: '💨 Gas (520K)', value: 520, active: temperatureK === 520, colour: '#fb923c' },
              ].map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  aria-pressed={temperatureK === preset.value}
                  onClick={() => handleTemperatureChange(preset.value)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: preset.active ? `${preset.colour}33` : 'var(--bg-primary)',
                    color: preset.active ? preset.colour : 'var(--text-primary)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </LabControlCard>

          <LabControlCard title="Counterfactual: Compare Two Models">
            <button
              type="button"
              aria-label="Temperature-scaled particle-radius counterfactual"
              aria-pressed={showExpandingParticleModel}
              onClick={() => setShowExpandingParticleModel((previous) => !previous)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                textAlign: 'left',
                border: '1px solid var(--border-color)',
                background: showExpandingParticleModel
                  ? 'rgba(239, 68, 68, 0.15)'
                  : 'var(--bg-primary)',
                color: showExpandingParticleModel ? '#ef4444' : 'var(--text-primary)',
                fontWeight: 700,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {counterfactualButtonText}
            </button>
            <p
              style={{
                margin: '8px 0 0',
                fontSize: '11px',
                color: 'var(--text-secondary)',
                lineHeight: 1.45,
              }}
            >
              {isRevealed
                ? 'The physical model keeps each particle radius fixed; heating changes the motion and arrangement represented by the model.'
                : 'Compare Model A and Model B, then submit your prediction before the model verdict is shown.'}
            </p>
          </LabControlCard>

          <LabControlCard title="Simulation Mode">
            <div
              id="stateMode"
              role="group"
              aria-label="Select particle simulation mode"
              style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
            >
              {[
                { label: '1. States of Matter & Phase Transitions', value: 'states' as const },
                { label: '2. Particle Diffusion Rate (Mixing)', value: 'diffusion' as const },
                { label: '3. Dissolving vs Melting', value: 'dissolving' as const },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={mode === option.value}
                  onClick={() => handleModeChange(option.value)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    textAlign: 'left',
                    border: '1px solid var(--border-color)',
                    background:
                      mode === option.value
                        ? 'var(--accent-color, #10b981)'
                        : 'var(--bg-primary)',
                    color: mode === option.value ? '#fff' : 'var(--text-primary)',
                    fontWeight: 600,
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </LabControlCard>

          <LabControlCard title="Playback">
            <div id="playback" role="group" aria-label="Simulation playback controls">
              <SimulationControls
                isPlaying={isPlaying}
                onTogglePlay={handleTogglePlay}
                onStepForward={handleStepForward}
                onReset={handleReset}
              />
            </div>
          </LabControlCard>
        </div>
      }
      visual={
        <div
          className="glass-panel"
          style={{
            padding: '16px',
            borderRadius: '16px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
            }}
          >
            <h4
              style={{
                margin: 0,
                fontSize: '13px',
                fontWeight: 700,
                color: 'var(--text-primary)',
              }}
            >
              Microscopic Particle Canvas ({mode.toUpperCase()} MODE)
            </h4>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {requestedParticleCount} particles
            </span>
          </div>

          <canvas
            ref={canvasRef}
            className="science-scene-canvas"
            style={{ ...canvasStyle, borderRadius: '12px', background: '#0f172a' }}
            aria-label={
              isRevealed
                ? `Interactive idealised particle model in ${mode} mode at ${temperatureK} kelvin. Current qualitative state: ${macro.stateLabel}. Circular solvent particles and diamond solute particles use canvas coordinates; particle-particle forces are not simulated.`
                : `Interactive idealised particle model in ${mode} mode at ${temperatureK} kelvin. Circular solvent particles and diamond solute particles are shown; quantitative results and the model verdict are hidden until prediction is submitted.`
            }
            role="img"
          >
            Your browser does not support HTML5 Canvas.
          </canvas>

          <div
            aria-label="Particle model legend"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 14px',
              marginTop: '8px',
              color: 'var(--text-secondary)',
              fontSize: '10px',
              lineHeight: 1.4,
            }}
          >
            <span>○ Solvent particle (circle)</span>
            <span>◆ Solute particle (diamond)</span>
            <span>Solid: ordered, close vibration</span>
            <span>Liquid: close, mobile arrangement</span>
            <span>Gas: widely spaced, rapid motion</span>
          </div>
          <p
            style={{
              margin: '6px 2px 0',
              color: 'var(--text-muted)',
              fontSize: '10px',
              lineHeight: 1.4,
            }}
          >
            {mode} mode · {temperatureK} K · {playbackStatus} ·{' '}
            {isRevealed ? `state ${macro.stateLabel}` : 'measurements locked'}
          </p>

          <h4
            style={{
              margin: '14px 0 6px',
              fontSize: '13px',
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
          >
            Linked model measurements
          </h4>
          <svg
            viewBox="0 0 440 116"
            className="science-scene-svg"
            style={{ maxWidth: '880px', background: '#0f172a', borderRadius: '12px' }}
            role="img"
            aria-label={
              isRevealed
                ? `Model readings: qualitative state ${macro.stateLabel}, instantaneous nearest-neighbour display distance ${macro.meanSpacingPx} canvas pixels, relative motion ${macro.relativeSpeed.toFixed(2)} times baseline, and relative pressure index ${macro.relativePressure.toFixed(2)}. The fixed canvas boundary means this distance is not a thermal expansion measurement.`
                : 'Linked model measurements are hidden until prediction is submitted.'
            }
          >
            <title>
              {isRevealed
                ? `Linked particle measurements at ${temperatureK} kelvin`
                : 'Linked particle measurements locked until prediction'}
            </title>
            {isRevealed ? (
              <>
                <text x="14" y="20" fill="#94a3b8" fontSize="12">
                  Qualitative state
                </text>
                <text x="14" y="40" fill="#f8fafc" fontSize="15" fontWeight="bold">
                  {macro.stateLabel}
                </text>

                <text x="150" y="20" fill="#94a3b8" fontSize="12">
                  Instantaneous neighbour distance
                </text>
                <rect x="150" y="28" width="120" height="12" rx="6" fill="#1e293b" />
                <rect
                  x="150"
                  y="28"
                  width={Math.max(2, Math.min(120, macro.meanSpacingPx * 4))}
                  height="12"
                  rx="6"
                  fill="#38bdf8"
                />
                <text x="150" y="60" fill="#e2e8f0" fontSize="12">
                  {macro.meanSpacingPx} canvas px
                </text>

                <text x="300" y="20" fill="#94a3b8" fontSize="12">
                  Relative pressure proxy
                </text>
                <rect x="300" y="28" width="120" height="12" rx="6" fill="#1e293b" />
                <rect
                  x="300"
                  y="28"
                  width={Math.max(2, Math.min(120, macro.relativePressure * 45))}
                  height="12"
                  rx="6"
                  fill="#fb923c"
                />
                <text x="300" y="60" fill="#e2e8f0" fontSize="12">
                  {macro.relativePressure.toFixed(2)} relative index
                </text>
                <text x="150" y="76" fill="#64748b" fontSize="8">
                  0
                </text>
                <text x="270" y="76" fill="#64748b" fontSize="8" textAnchor="end">
                  30 canvas px
                </text>
                <text x="300" y="76" fill="#64748b" fontSize="8">
                  0
                </text>
                <text x="420" y="76" fill="#64748b" fontSize="8" textAnchor="end">
                  2.7 relative
                </text>

                <text x="14" y="104" fill="#94a3b8" fontSize="12">
                  Relative mean motion: {macro.relativeSpeed.toFixed(2)}× baseline
                </text>
              </>
            ) : (
              <>
                <text x="220" y="40" textAnchor="middle" fill="#94a3b8" fontSize="14">
                  Measurements locked
                </text>
                <text x="220" y="62" textAnchor="middle" fill="#64748b" fontSize="12">
                  Submit your prediction to reveal model values.
                </text>
              </>
            )}
          </svg>
          {isRevealed && (
            <p
              style={{
                margin: '8px 2px 0',
                color: 'var(--text-muted)',
                fontSize: '10px',
                lineHeight: 1.4,
              }}
            >
              Idealised display: positions and speeds use canvas units, and the fixed-boundary
              neighbour distance is not a thermal expansion measurement. Motion includes wall
              reflections but no hard-sphere collisions or intermolecular-force calculation.
            </p>
          )}
        </div>
      }
    />
  );
}
