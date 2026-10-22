'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import type { FoodWebSceneData } from '../../../../lib/science-lab/activity-types';
import {
  INITIAL_SPECIES,
  FOOD_WEB_LINKS,
  propagateFoodWebChange,
  type SpeciesNode,
} from '../../../../lib/science-lab/models/food-web';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';
import {
  useDocumentHidden,
  usePrefersReducedMotion,
} from '../../../../lib/science-lab/use-scene-canvas';
import SimulationControls from '../../controls/SimulationControls';

type Perturbation = Parameters<typeof propagateFoodWebChange>[1];
type ActiveLayer = FoodWebSceneData['activeLayer'];

interface FoodWebViewState {
  generation: number;
  species: Record<string, SpeciesNode>;
  perturbation: Perturbation;
  activeLayer: ActiveLayer;
}

/** Always start/reset from a fresh snapshot rather than the exported baseline object. */
function createInitialSpecies(): Record<string, SpeciesNode> {
  return propagateFoodWebChange(INITIAL_SPECIES, 'none', 0);
}

export default function FoodWebScene({
  sceneData,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<FoodWebSceneData>) {
  const [ecosystem, setEcosystem] = useState<FoodWebViewState>(() => ({
    species: createInitialSpecies(),
    generation: sceneData.generation ?? 0,
    perturbation: 'none',
    activeLayer: sceneData.activeLayer ?? 'all',
  }));
  const [isPlaying, setIsPlaying] = useState(sceneData.isPlaying ?? false);
  const isDocumentHidden = useDocumentHidden();
  const isReducedMotion = usePrefersReducedMotion();
  const resumeAfterReducedMotionRef = useRef(false);
  const wasReducedMotionRef = useRef(false);
  const shouldAutoAdvance = isPlaying && !isDocumentHidden && !isReducedMotion;
  const { species, generation, perturbation, activeLayer } = ecosystem;

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
    setEcosystem((previous) => ({
      ...previous,
      generation: previous.generation + 1,
      species: propagateFoodWebChange(previous.species, previous.perturbation, 1),
    }));
  }, []);

  // Auto-advance generations only while playback can perform visible work.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (shouldAutoAdvance) {
      timer = setInterval(handleStep, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [shouldAutoAdvance, handleStep]);

  /** Biomass per trophic level, shared by the readouts and the linked view. */
  const trophicTotals = {
    producer: Math.round(species.grasses.currentBiomassKg + species.acacia.currentBiomassKg),
    herbivore: Math.round(species.insects.currentBiomassKg + species.wallaby.currentBiomassKg),
    predator: Math.round(species.quoll.currentBiomassKg + species.eagle.currentBiomassKg),
  };
  const biomassScaleMax = Math.max(
    1,
    trophicTotals.producer,
    trophicTotals.herbivore,
    trophicTotals.predator,
  );

  useEffect(() => {
    onReadoutChange?.(isRevealed
      ? {
          generationCount: generation,
          producerBiomass: `${trophicTotals.producer} kg`,
          herbivoreBiomass: `${trophicTotals.herbivore} kg`,
          predatorBiomass: `${trophicTotals.predator} kg`,
          energyLossPercent: 90,
        }
      : {});
  }, [
    generation,
    isRevealed,
    trophicTotals.producer,
    trophicTotals.herbivore,
    trophicTotals.predator,
    onReadoutChange,
  ]);

  const handlePerturbationSelect = (newPerturbation: Perturbation) => {
    // A perturbation selection establishes generation zero; it must not secretly
    // advance biomass or race an existing playback interval.
    resumeAfterReducedMotionRef.current = false;
    setIsPlaying(false);
    setEcosystem((previous) => ({
      ...previous,
      generation: 0,
      species: createInitialSpecies(),
      perturbation: newPerturbation,
    }));
  };

  const handleLayerSelect = (newLayer: ActiveLayer) => {
    setEcosystem((previous) => ({ ...previous, activeLayer: newLayer }));
  };

  const handleReset = () => {
    resumeAfterReducedMotionRef.current = false;
    setIsPlaying(false);
    setEcosystem({
      generation: 0,
      species: createInitialSpecies(),
      perturbation: 'none',
      activeLayer: sceneData.activeLayer ?? 'all',
    });
  };

  const playbackStatus = isDocumentHidden
    ? 'paused while page hidden'
    : isReducedMotion
      ? 'paused for reduced motion'
      : isPlaying
        ? 'running'
        : 'paused';

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Species Population Adjuster">
            <div
              id="perturbation"
              role="group"
              aria-label="Select ecosystem perturbation scenario"
              style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
            >
              <button
                type="button"
                aria-pressed={perturbation === 'none'}
                onClick={() => handlePerturbationSelect('none')}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  textAlign: 'left',
                  border: '1px solid var(--border-color)',
                  background: perturbation === 'none' ? 'var(--accent-color, #10b981)' : 'var(--bg-primary)',
                  color: perturbation === 'none' ? '#fff' : 'var(--text-primary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ⚖️ Balanced Grassland (Baseline)
              </button>
              <button
                type="button"
                aria-pressed={perturbation === 'remove_predator'}
                onClick={() => handlePerturbationSelect('remove_predator')}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  textAlign: 'left',
                  border: '1px solid var(--border-color)',
                  background: perturbation === 'remove_predator' ? 'var(--accent-color, #10b981)' : 'var(--bg-primary)',
                  color: perturbation === 'remove_predator' ? '#fff' : 'var(--text-primary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🦅 Remove Apex Predators (Trophic Cascade)
              </button>
              <button
                type="button"
                aria-pressed={perturbation === 'drought'}
                onClick={() => handlePerturbationSelect('drought')}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  textAlign: 'left',
                  border: '1px solid var(--border-color)',
                  background: perturbation === 'drought' ? 'var(--accent-color, #10b981)' : 'var(--bg-primary)',
                  color: perturbation === 'drought' ? '#fff' : 'var(--text-primary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ☀️ Severe Drought (Producer Crash)
              </button>
              <button
                type="button"
                aria-pressed={perturbation === 'insect_crash'}
                onClick={() => handlePerturbationSelect('insect_crash')}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  textAlign: 'left',
                  border: '1px solid var(--border-color)',
                  background: perturbation === 'insect_crash' ? 'var(--accent-color, #10b981)' : 'var(--bg-primary)',
                  color: perturbation === 'insect_crash' ? '#fff' : 'var(--text-primary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🦗 Pesticide Application (Insect Crash)
              </button>
            </div>
          </LabControlCard>

          <LabControlCard title="Flow Visualization Layer">
            <div
              id="layerToggle"
              role="group"
              aria-label="Toggle between matter cycling and energy flow layers"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}
            >
              <button
                type="button"
                aria-pressed={activeLayer === 'all'}
                onClick={() => handleLayerSelect('all')}
                style={{
                  padding: '6px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: activeLayer === 'all' ? 'var(--accent-color, #10b981)' : 'var(--bg-primary)',
                  color: activeLayer === 'all' ? '#fff' : 'var(--text-primary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                All Links
              </button>
              <button
                type="button"
                aria-pressed={activeLayer === 'energy'}
                onClick={() => handleLayerSelect('energy')}
                style={{
                  padding: '6px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: activeLayer === 'energy' ? '#f59e0b' : 'var(--bg-primary)',
                  color: activeLayer === 'energy' ? '#fff' : 'var(--text-primary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Energy (One-Way)
              </button>
              <button
                type="button"
                aria-pressed={activeLayer === 'matter'}
                onClick={() => handleLayerSelect('matter')}
                style={{
                  padding: '6px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: activeLayer === 'matter' ? '#38bdf8' : 'var(--bg-primary)',
                  color: activeLayer === 'matter' ? '#fff' : 'var(--text-primary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Matter (Cycle)
              </button>
            </div>
          </LabControlCard>

          <LabControlCard title="Generation Step Controls">
            <div id="playback" role="group" aria-label="Step through ecosystem generations">
              <SimulationControls
                isPlaying={isPlaying}
                onTogglePlay={() => setIsPlaying((previous) => !previous)}
                onStepForward={handleStep}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Australian Grassland Food Web (Generation {generation})
            </h4>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {activeLayer === 'energy'
                ? isRevealed ? '⚡ Energy flow (non-cycling)' : '⚡ Energy flow'
                : activeLayer === 'matter'
                  ? isRevealed ? '🔄 Matter cycle (closed loop)' : '🔄 Matter cycle'
                  : 'All interactions'}
            </span>
          </div>

          <div
            aria-label="Food web link legend"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 14px',
              marginBottom: '8px',
              color: 'var(--text-secondary)',
              fontSize: '10px',
              lineHeight: 1.4,
            }}
          >
            {isRevealed ? (
              <>
                <span>E → solid arrow: one-way energy flow</span>
                <span>M ⇢ dashed arrow: matter transfer or recycling</span>
                <span>E+M — · — feeding transfers both</span>
                <span>Heat ⇢ dotted exit: energy dissipates</span>
              </>
            ) : (
              <>
                <span>E → solid arrow: energy pathway</span>
                <span>M ⇢ dashed arrow: matter pathway</span>
                <span>E+M — · — combined feeding pathway</span>
                <span>Heat ⇢ dotted marker: thermal pathway</span>
              </>
            )}
          </div>
          <svg
            viewBox="0 0 440 340"
            className="science-scene-svg"
            style={{ maxWidth: '760px', background: '#0f172a', borderRadius: '12px' }}
            role="img"
            aria-label={
              isRevealed
                ? `Australian grassland food web at generation ${generation}, showing ${activeLayer} links. Producer biomass ${trophicTotals.producer} kilograms, herbivore biomass ${trophicTotals.herbivore} kilograms, and predator biomass ${trophicTotals.predator} kilograms.`
                : `Australian grassland food web at generation ${generation}, showing ${activeLayer} links. Quantitative biomass and energy-loss results are hidden until prediction is submitted.`
            }
          >
            <title>
              {isRevealed
                ? `Grassland food web, generation ${generation}`
                : 'Grassland food web with results locked until prediction'}
            </title>
            <defs>
              <marker id="arrowEnergy" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
              </marker>
              <marker id="arrowMatter" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
              </marker>
              <marker id="arrowCombined" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#e2e8f0" />
              </marker>
            </defs>

            {(activeLayer === 'all' || activeLayer === 'energy') && (
              <g transform="translate(40, 20)">
                <circle r="14" fill="#fbbf24" opacity="0.8" />
                <text x="0" y="4" fill="#000" fontSize="9" fontWeight="bold" textAnchor="middle">Sun</text>
                <line x1="14" y1="14" x2="60" y2="250" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 3" markerEnd="url(#arrowEnergy)" />
              </g>
            )}

            {(activeLayer === 'all' || activeLayer === 'energy') && (
              <g>
                <text x="345" y="40" fill="#ef4444" fontSize="10" fontWeight="bold">
                  {isRevealed ? '🔥 90% Heat Lost' : '🔥 Heat dissipates'}
                </text>
                <line x1="260" y1="50" x2="340" y2="40" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="2 2" />
                <line x1="240" y1="160" x2="340" y2="45" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="2 2" />
              </g>
            )}

            {FOOD_WEB_LINKS.map((link, index) => {
              if (activeLayer === 'energy' && link.type === 'matter') return null;
              if (activeLayer === 'matter' && link.type === 'energy') return null;

              const source = species[link.from];
              const destination = species[link.to];
              if (!source || !destination) return null;

              const isMatterRecycle = link.from === 'decomposers';
              const isCombined = activeLayer === 'all' && link.type === 'both';
              const isMatterLink =
                isMatterRecycle ||
                link.type === 'matter' ||
                (activeLayer === 'matter' && link.type === 'both');
              const strokeColor = isCombined
                ? '#e2e8f0'
                : isMatterLink
                  ? '#38bdf8'
                  : '#f59e0b';
              const marker = isCombined
                ? 'url(#arrowCombined)'
                : isMatterLink
                  ? 'url(#arrowMatter)'
                  : 'url(#arrowEnergy)';
              const lineCode = isCombined ? 'E+M' : isMatterLink ? 'M' : 'E';

              return (
                <g key={index}>
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={destination.x}
                    y2={destination.y}
                    stroke={strokeColor}
                    strokeWidth={isMatterRecycle ? 2 : 1.8}
                    strokeDasharray={isCombined ? '8 3 2 3' : isMatterLink ? '4 3' : undefined}
                    markerEnd={marker}
                  />
                  <text
                    x={(source.x + destination.x) / 2 - 7}
                    y={(source.y + destination.y) / 2 - 4}
                    fill={strokeColor}
                    fontSize="7"
                    fontWeight="bold"
                  >
                    {lineCode}
                  </text>
                  {link.label && activeLayer !== 'energy' && (
                    <text
                      x={(source.x + destination.x) / 2 + 10}
                      y={(source.y + destination.y) / 2 + 14}
                      fill="#38bdf8"
                      fontSize="8"
                      fontWeight="bold"
                    >
                      {link.label}
                    </text>
                  )}
                </g>
              );
            })}

            {Object.values(species).map((speciesNode) => {
              const biomassRatio = speciesNode.currentBiomassKg / speciesNode.baseBiomassKg;
              const visibleBiomassRatio = isRevealed ? biomassRatio : 1;
              let nodeColor = '#3b82f6';
              if (speciesNode.trophicLevel === 'producer') nodeColor = '#10b981';
              if (speciesNode.trophicLevel === 'carnivore' || speciesNode.trophicLevel === 'apex') nodeColor = '#ef4444';
              if (speciesNode.trophicLevel === 'decomposer') nodeColor = '#8b5cf6';

              return (
                <g key={speciesNode.id} transform={`translate(${speciesNode.x}, ${speciesNode.y})`}>
                  <circle
                    r={Math.max(12, Math.min(26, 18 * Math.sqrt(visibleBiomassRatio)))}
                    fill={nodeColor}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    opacity={isRevealed && biomassRatio <= 0.05 ? 0.3 : 1}
                  />
                  <text x="0" y="-28" fill="#f8fafc" fontSize="10" fontWeight="bold" textAnchor="middle">
                    {speciesNode.name}
                  </text>
                  <text x="0" y="-16" fill="#94a3b8" fontSize="8" textAnchor="middle">
                    {isRevealed ? `${Math.round(speciesNode.currentBiomassKg)} kg` : 'Biomass hidden'}
                  </text>
                </g>
              );
            })}
          </svg>
          <p style={{ margin: '8px 2px 0', color: 'var(--text-muted)', fontSize: '10px' }}>
            Generation {generation} · {playbackStatus} · {isRevealed ? 'biomass revealed' : 'biomass locked'}
          </p>

          <h4
            style={{ margin: '14px 0 6px', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}
          >
            Linked view: biomass held at each trophic level
          </h4>
          <svg
            viewBox="0 0 440 155"
            className="science-scene-svg"
            style={{ maxWidth: '760px', background: '#0f172a', borderRadius: '12px' }}
            role="img"
            aria-label={isRevealed
              ? `Biomass by trophic level at generation ${generation}. Producers ${trophicTotals.producer} kilograms, herbivores ${trophicTotals.herbivore} kilograms, predators ${trophicTotals.predator} kilograms. Horizontal axis is biomass in kilograms.`
              : 'Biomass chart with a horizontal kilograms axis. Quantitative results are hidden until prediction is submitted.'}
          >
            <title>
              {isRevealed
                ? `Trophic-level biomass at generation ${generation}`
                : 'Trophic-level biomass values locked until prediction'}
            </title>
            {isRevealed ? (
              <>
                {([
                  { label: 'Producers', value: trophicTotals.producer, colour: '#22c55e' },
                  { label: 'Herbivores', value: trophicTotals.herbivore, colour: '#38bdf8' },
                  { label: 'Predators', value: trophicTotals.predator, colour: '#f97316' },
                ] as const).map((row, index) => {
                  const barWidth = Math.max(2, (row.value / biomassScaleMax) * 250);
                  const y = 18 + index * 30;
                  return (
                    <g key={row.label}>
                      <text x="12" y={y + 13} fill="#94a3b8" fontSize="12">{row.label}</text>
                      <rect x="110" y={y} width="250" height="16" rx="8" fill="#1e293b" />
                      <rect x="110" y={y} width={barWidth} height="16" rx="8" fill={row.colour} />
                      <text x="368" y={y + 13} fill="#e2e8f0" fontSize="12">{row.value} kg</text>
                    </g>
                  );
                })}
                <line x1="110" y1="112" x2="360" y2="112" stroke="#64748b" strokeWidth="1.5" />
                {[0, 0.5, 1].map((fraction) => {
                  const x = 110 + fraction * 250;
                  return (
                    <g key={fraction}>
                      <line x1={x} y1="108" x2={x} y2="116" stroke="#64748b" strokeWidth="1" />
                      <text x={x} y="128" fill="#94a3b8" fontSize="8" textAnchor="middle">
                        {Math.round(biomassScaleMax * fraction)}
                      </text>
                    </g>
                  );
                })}
                <text x="235" y="146" fill="#94a3b8" fontSize="9" textAnchor="middle">
                  Biomass (kg)
                </text>
              </>
            ) : (
              <text x="220" y="70" fill="#94a3b8" fontSize="12" textAnchor="middle">
                Biomass values unlock after prediction
              </text>
            )}
          </svg>
        </div>
      }
    />
  );
}
