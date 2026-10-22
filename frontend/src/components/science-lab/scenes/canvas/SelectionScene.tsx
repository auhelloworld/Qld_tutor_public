'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import type { SelectionSceneData } from '../../../../lib/science-lab/activity-types';
import {
  initSelectionState,
  stepGeneration,
  type SelectionState,
} from '../../../../lib/science-lab/models/selection';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSliderInput from '../../../lab-shared/LabSliderInput';
import {
  useDocumentHidden,
  usePrefersReducedMotion,
  useSceneCanvas,
} from '../../../../lib/science-lab/use-scene-canvas';
import SimulationControls from '../../controls/SimulationControls';

/** Logical drawing world for the habitat canvas. */
const HABITAT_W = 380;
const HABITAT_H = 180;
const POPULATION_SIZE = 100;

export default function SelectionScene({
  sceneData,
  onSceneDataChange,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<SelectionSceneData>) {
  const [selectionPressure, setSelectionPressure] = useState(sceneData.selectionPressure ?? 0.7);
  const [environmentDarkness, setEnvironmentDarkness] = useState(0.8);
  const [initialFrequency, setInitialFrequency] = useState(sceneData.initialFrequency ?? 0.2);
  const [seed, setSeed] = useState(sceneData.seed ?? 42);
  const [isPlaying, setIsPlaying] = useState(sceneData.isPlaying ?? false);
  const [state, setState] = useState<SelectionState>(() =>
    initSelectionState(
      sceneData.initialFrequency ?? 0.2,
      0.8,
      sceneData.selectionPressure ?? 0.7,
      POPULATION_SIZE,
      sceneData.seed ?? 42,
    ),
  );

  const { canvasRef, canvasStyle, prepareFrame, logicalWidth, logicalHeight } = useSceneCanvas(
    HABITAT_W,
    HABITAT_H,
    880,
  );
  const isDocumentHidden = useDocumentHidden();
  const isReducedMotion = usePrefersReducedMotion();
  const resumeAfterReducedMotionRef = useRef(false);
  const wasReducedMotionRef = useRef(false);
  const shouldAutoAdvance = isPlaying && !isDocumentHidden && !isReducedMotion;

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

  const handleStep = useCallback(() => {
    setState((previous) => stepGeneration(previous));
  }, []);

  const handleRunN = (count: number) => {
    setState((previous) => {
      let next = previous;
      for (let index = 0; index < count; index++) {
        next = stepGeneration(next);
      }
      return next;
    });
  };

  const restartPopulation = (nextInitialFrequency: number, nextSeed: number) => {
    resumeAfterReducedMotionRef.current = false;
    setIsPlaying(false);
    setState(initSelectionState(
      nextInitialFrequency,
      environmentDarkness,
      selectionPressure,
      POPULATION_SIZE,
      nextSeed,
    ));
  };

  const handleInitialFrequencyChange = (value: number) => {
    setInitialFrequency(value);
    restartPopulation(value, seed);
    onSceneDataChange?.({ initialFrequency: value, generation: 0, isPlaying: false });
  };

  const handleSeedChange = (value: number) => {
    setSeed(value);
    restartPopulation(initialFrequency, value);
    onSceneDataChange?.({ seed: value, generation: 0, isPlaying: false });
  };

  const handleReset = () => {
    restartPopulation(initialFrequency, seed);
    onSceneDataChange?.({ generation: 0, isPlaying: false });
  };

  const handlePlayToggle = () => {
    setIsPlaying((previous) => {
      const next = !previous;
      onSceneDataChange?.({ isPlaying: next });
      return next;
    });
  };

  // Auto-advance generations only while playback can perform visible work.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (shouldAutoAdvance) {
      timer = setInterval(handleStep, 500);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [shouldAutoAdvance, handleStep]);

  useEffect(() => {
    if (!isRevealed) {
      onReadoutChange?.({});
      return;
    }
    const latestRecord = state.history[state.history.length - 1];
    if (!latestRecord) return;
    onReadoutChange?.({
      generationNumber: latestRecord.generation,
      darkAlleleFreq: latestRecord.pDarkAllele,
      lightAlleleFreq: latestRecord.qLightAllele,
      darkPhenotypePercent: latestRecord.darkPhenotypePercent,
      lightPhenotypePercent: latestRecord.lightPhenotypePercent,
      survivingCount: latestRecord.populationSize,
    });
  }, [isRevealed, state, onReadoutChange]);

  // Render visual canvas.
  const renderFrame = useCallback(() => {
    const ctx = prepareFrame();
    if (!ctx) return;

    const width = logicalWidth;
    const height = logicalHeight;
    const bgVal = Math.round(230 - environmentDarkness * 180);
    ctx.fillStyle = `rgb(${bgVal}, ${bgVal}, ${bgVal})`;
    ctx.fillRect(0, 0, width, height);

    // Tree bark texture lines.
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 2;
    for (let x = 10; x < width; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (x % 20) - 10, height);
      ctx.stroke();
    }

    for (const organism of state.population) {
      ctx.save();
      ctx.translate(organism.x, organism.y);
      if (organism.phenotype === 'dark') {
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#0f172a';
      } else {
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#cbd5e1';
      }
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(-8, 4);
      ctx.lineTo(0, 2);
      ctx.lineTo(8, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }, [environmentDarkness, state.population, prepareFrame, logicalWidth, logicalHeight]);

  useEffect(() => {
    renderFrame();
  }, [renderFrame]);

  const latest = state.history[state.history.length - 1];
  const firstRecord = state.history[0];
  const playbackStatus = isDocumentHidden
    ? 'Paused while this page is hidden'
    : isReducedMotion
      ? 'Paused for reduced motion'
      : isPlaying
        ? 'Running generations'
        : 'Paused';

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Selection Environment">
            <LabSliderInput
              id="environmentDarkness"
              label="Environment Camouflage Background"
              ariaLabel="Environment darkness slider (0=light birch, 1=soot dark)"
              value={environmentDarkness}
              min={0}
              max={1}
              step={0.05}
              onChange={(value) => {
                setEnvironmentDarkness(value);
                setState((previous) => ({ ...previous, environmentDarkness: value }));
              }}
            />

            <div
              role="group"
              aria-label="Forest bark preset"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' }}
            >
              <button
                type="button"
                aria-pressed={environmentDarkness === 0.1}
                onClick={() => {
                  setEnvironmentDarkness(0.1);
                  setState((previous) => ({ ...previous, environmentDarkness: 0.1 }));
                }}
                style={{
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: environmentDarkness === 0.1 ? 'var(--accent-color, #10b981)' : 'var(--bg-primary)',
                  color: environmentDarkness === 0.1 ? '#fff' : 'var(--text-primary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🌳 Light Lichen Bark
              </button>
              <button
                type="button"
                aria-pressed={environmentDarkness === 0.9}
                onClick={() => {
                  setEnvironmentDarkness(0.9);
                  setState((previous) => ({ ...previous, environmentDarkness: 0.9 }));
                }}
                style={{
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: environmentDarkness === 0.9 ? 'var(--accent-color, #10b981)' : 'var(--bg-primary)',
                  color: environmentDarkness === 0.9 ? '#fff' : 'var(--text-primary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🏭 Sooty Industrial Bark
              </button>
            </div>

            <div style={{ marginTop: '12px' }}>
              <LabSliderInput
                id="selection-pressure"
                label="Predation Pressure"
                ariaLabel="Predation pressure slider"
                value={selectionPressure}
                min={0}
                max={1}
                step={0.05}
                onChange={(value) => {
                  setSelectionPressure(value);
                  setState((previous) => ({ ...previous, selectionPressure: value }));
                  onSceneDataChange?.({ selectionPressure: value });
                }}
              />
            </div>

            <div style={{ marginTop: '12px' }}>
              <LabSliderInput
                id="selection-initial-frequency"
                label="Initial Dark Allele Frequency (p)"
                ariaLabel="Initial frequency of dark allele"
                value={initialFrequency}
                min={0.05}
                max={0.95}
                step={0.05}
                onChange={handleInitialFrequencyChange}
              />
            </div>

            <div style={{ marginTop: '12px' }}>
              <LabSliderInput
                id="selection-seed"
                label="Simulation Random Seed"
                ariaLabel="Simulation random seed"
                value={seed}
                min={1}
                max={100}
                step={1}
                onChange={handleSeedChange}
              />
            </div>
          </LabControlCard>

          <LabControlCard title="Generation Run Controls">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
              <button
                type="button"
                onClick={handleStep}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                ⏭ Run 1 Gen
              </button>
              <button
                type="button"
                onClick={() => handleRunN(10)}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                ⏩ Run 10 Gens
              </button>
            </div>

            <SimulationControls
              isPlaying={isPlaying}
              onTogglePlay={handlePlayToggle}
              onStepForward={handleStep}
              onReset={handleReset}
            />
          </LabControlCard>
        </div>
      }
      visual={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div
            className="glass-panel"
            style={{
              padding: '16px',
              borderRadius: '16px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Population Habitat (Generation {state.generation})
              </h4>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {isRevealed && latest
                  ? `${latest.darkPhenotypePercent}% Dark / ${latest.lightPhenotypePercent}% Light`
                  : 'Phenotype split 🔒'}
              </span>
            </div>

            <canvas
              ref={canvasRef}
              className="science-scene-canvas"
              style={{ ...canvasStyle, borderRadius: '12px' }}
              aria-label={
                isRevealed && latest
                  ? `Peppered moth habitat at generation ${latest.generation}. Dark phenotype ${latest.darkPhenotypePercent} percent and light phenotype ${latest.lightPhenotypePercent} percent on the selected bark background.`
                  : `Peppered moth variation on the selected bark background at generation ${state.generation}. The phenotype split and allele results are hidden until prediction is submitted.`
              }
              role="img"
            >
              Your browser does not support HTML5 Canvas.
            </canvas>
            <p
              style={{
                margin: '8px 2px 0',
                color: 'var(--text-muted)',
                fontSize: '10px',
                lineHeight: 1.4,
              }}
            >
              Generation {state.generation} · bark darkness {environmentDarkness.toFixed(2)} ·{' '}
              {playbackStatus} · {isRevealed ? 'results revealed' : 'results locked'}
            </p>
          </div>

          <div
            className="glass-panel"
            style={{
              padding: '16px',
              borderRadius: '16px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Allele Frequency Curve across Generations
              </h4>
              <div
                aria-label="Allele frequency series legend"
                style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '11px', fontWeight: 600 }}
              >
                <span style={{ color: '#10b981' }}>
                  <span aria-hidden="true" style={{ display: 'inline-block', width: '20px', borderTop: '3px solid currentColor', marginRight: '4px', verticalAlign: 'middle' }} />
                  Dark allele p — solid line
                </span>
                <span style={{ color: '#94a3b8' }}>
                  <span aria-hidden="true" style={{ display: 'inline-block', width: '20px', borderTop: '2px dashed currentColor', marginRight: '4px', verticalAlign: 'middle' }} />
                  Light allele q – – dashed line
                </span>
              </div>
            </div>

            <svg
              viewBox="0 0 400 170"
              className="science-scene-svg"
              style={{ maxWidth: '880px', background: '#0f172a', borderRadius: '12px' }}
              role="img"
              aria-label={isRevealed && latest
                ? `Allele frequency curve from generation ${firstRecord?.generation ?? 0} through ${latest.generation}. Dark allele frequency ${latest.pDarkAllele}, light allele frequency ${latest.qLightAllele}. Vertical axis is allele frequency from zero to one.`
                : 'Allele frequency graph with proportion and generation axes. Quantitative results are hidden until prediction is submitted.'}
            >
              <title>
                {isRevealed
                  ? `Allele frequencies through generation ${latest?.generation ?? 0}`
                  : 'Allele frequency results locked until prediction'}
              </title>
              <line x1="52" y1="20" x2="380" y2="20" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="52" y1="72.5" x2="380" y2="72.5" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="52" y1="125" x2="380" y2="125" stroke="#475569" strokeWidth="1.5" />
              <line x1="52" y1="20" x2="52" y2="125" stroke="#475569" strokeWidth="1.5" />

              <text x="30" y="24" fill="#94a3b8" fontSize="9">1.0</text>
              <text x="30" y="76" fill="#94a3b8" fontSize="9">0.5</text>
              <text x="30" y="129" fill="#94a3b8" fontSize="9">0.0</text>
              <text x="12" y="80" fill="#94a3b8" fontSize="9" textAnchor="middle" transform="rotate(-90 12 80)">
                Allele frequency (proportion)
              </text>
              <text x="216" y="160" fill="#94a3b8" fontSize="9" textAnchor="middle">Generation</text>
              <text x="52" y="142" fill="#94a3b8" fontSize="9" textAnchor="middle">
                {firstRecord?.generation ?? 0}
              </text>
              <text x="380" y="142" fill="#94a3b8" fontSize="9" textAnchor="middle">
                {latest?.generation ?? 0}
              </text>

              {isRevealed && state.history.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.5"
                  points={state.history.map((record, index) => {
                    const x = 52 + (index / Math.max(1, state.history.length - 1)) * 328;
                    const y = 125 - record.pDarkAllele * 105;
                    return `${x},${y}`;
                  }).join(' ')}
                />
              )}

              {isRevealed && state.history.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth="1.5"
                  strokeDasharray="5 3"
                  points={state.history.map((record, index) => {
                    const x = 52 + (index / Math.max(1, state.history.length - 1)) * 328;
                    const y = 125 - record.qLightAllele * 105;
                    return `${x},${y}`;
                  }).join(' ')}
                />
              )}
            </svg>
          </div>
        </div>
      }
    />
  );
}
