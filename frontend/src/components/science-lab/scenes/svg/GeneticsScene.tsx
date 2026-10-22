'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import type { GeneticsSceneData as RegisteredGeneticsSceneData } from '../../../../lib/science-lab/activity-types';
import {
  formatRatio,
  simulateGenetics,
  type DiploidGenotype,
  type DominanceMode,
  type GeneticsSceneData,
} from '../../../../lib/science-lab/models/genetics';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSliderInput from '../../../lab-shared/LabSliderInput';

type GeneticsModelSceneProps = Omit<
  ScienceSceneProps<RegisteredGeneticsSceneData>,
  'sceneData' | 'onSceneDataChange'
> & {
  sceneData: GeneticsSceneData;
  onSceneDataChange?: (patch: Partial<GeneticsSceneData>) => void;
};

const optionStyle = (selected: boolean): React.CSSProperties => ({
  padding: '7px 8px', borderRadius: '7px', border: '1px solid var(--border-color)',
  background: selected ? 'rgba(168, 85, 247, 0.18)' : 'var(--bg-primary)',
  color: selected ? '#c084fc' : 'var(--text-primary)', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
});

export default function GeneticsScene(
  props: ScienceSceneProps<RegisteredGeneticsSceneData> | GeneticsModelSceneProps,
) {
  const { onReadoutChange, isRevealed = false } = props;
  const sceneData = props.sceneData as Partial<GeneticsSceneData> & {
    trait?: 'pea-colour' | 'flower-colour' | 'blood-type';
  };
  const onSceneDataChange = props.onSceneDataChange as GeneticsModelSceneProps['onSceneDataChange'];
  const initialParent1 = sceneData.parent1Genotype === 'AA'
    || sceneData.parent1Genotype === 'Aa'
    || sceneData.parent1Genotype === 'aa'
    ? sceneData.parent1Genotype
    : 'Aa';
  const initialParent2 = sceneData.parent2Genotype === 'AA'
    || sceneData.parent2Genotype === 'Aa'
    || sceneData.parent2Genotype === 'aa'
    ? sceneData.parent2Genotype
    : 'Aa';
  const [parent1Genotype, setParent1Genotype] = useState<DiploidGenotype>(initialParent1);
  const [parent2Genotype, setParent2Genotype] = useState<DiploidGenotype>(initialParent2);
  const [dominanceMode, setDominanceMode] = useState<DominanceMode>(
    sceneData.dominanceMode ?? (sceneData.trait === 'blood-type' ? 'codominant' : 'complete'),
  );
  const [offspringCount, setOffspringCount] = useState(sceneData.offspringCount ?? 40);
  const [seed, setSeed] = useState(sceneData.seed ?? 42);

  useEffect(() => {
    const nextParent1 = sceneData.parent1Genotype === 'AA'
      || sceneData.parent1Genotype === 'Aa'
      || sceneData.parent1Genotype === 'aa'
      ? sceneData.parent1Genotype
      : 'Aa';
    const nextParent2 = sceneData.parent2Genotype === 'AA'
      || sceneData.parent2Genotype === 'Aa'
      || sceneData.parent2Genotype === 'aa'
      ? sceneData.parent2Genotype
      : 'Aa';
    setParent1Genotype(nextParent1);
    setParent2Genotype(nextParent2);
    setDominanceMode(sceneData.dominanceMode ?? (sceneData.trait === 'blood-type' ? 'codominant' : 'complete'));
    setOffspringCount(sceneData.offspringCount ?? 40);
    setSeed(sceneData.seed ?? 42);
  }, [
    sceneData.dominanceMode,
    sceneData.offspringCount,
    sceneData.parent1Genotype,
    sceneData.parent2Genotype,
    sceneData.seed,
    sceneData.trait,
  ]);

  const modelData = useMemo<GeneticsSceneData>(() => ({
    kind: 'genetics', parent1Genotype, parent2Genotype, dominanceMode, offspringCount, seed,
  }), [dominanceMode, offspringCount, parent1Genotype, parent2Genotype, seed]);
  const result = useMemo(() => simulateGenetics(modelData), [modelData]);
  const expectedRatio = formatRatio(result.expectedGenotypes, true);
  const observedRatio = formatRatio(result.observedGenotypes);
  const phenotypeRatio = formatRatio(result.expectedPhenotypes, true);

  useEffect(() => {
    onReadoutChange?.(isRevealed ? {
      expectedGenotypeRatio: expectedRatio,
      observedGenotypeCounts: observedRatio,
      expectedPhenotypeRatio: phenotypeRatio,
      offspringSample: result.offspring.length,
      seed,
    } : {});
  }, [expectedRatio, isRevealed, observedRatio, onReadoutChange, phenotypeRatio, result.offspring.length, seed]);

  const updateParent = (parent: 1 | 2, genotype: DiploidGenotype) => {
    if (parent === 1) {
      setParent1Genotype(genotype);
      onSceneDataChange?.({ parent1Genotype: genotype });
    } else {
      setParent2Genotype(genotype);
      onSceneDataChange?.({ parent2Genotype: genotype });
    }
  };
  const updateDominance = (mode: DominanceMode) => {
    setDominanceMode(mode);
    onSceneDataChange?.({ dominanceMode: mode });
  };
  const updateCount = (count: number) => {
    const next = Math.round(count);
    setOffspringCount(next);
    onSceneDataChange?.({ offspringCount: next });
  };
  const updateSeed = (nextSeed: number) => {
    const next = Math.max(1, Math.round(nextSeed));
    setSeed(next);
    onSceneDataChange?.({ seed: next });
  };

  const chart = { left: 465, right: 735, top: 296, bottom: 438 };
  const maxObserved = Math.max(1, ...result.observedGenotypes.map((part) => part.count));
  const barWidth = (count: number) => (count / maxObserved) * (chart.right - chart.left);

  const genotypeControl = (parent: 1 | 2, selected: DiploidGenotype) => (
    <div role="group" aria-label={`Parent ${parent} genotype`} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
      {(['AA', 'Aa', 'aa'] as const).map((genotype) => (
        <button key={genotype} type="button" aria-pressed={selected === genotype} onClick={() => updateParent(parent, genotype)} style={optionStyle(selected === genotype)}>{genotype}</button>
      ))}
    </div>
  );

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Parent genotypes">
            <p style={{ margin: '0 0 6px', fontSize: '11px', color: 'var(--text-secondary)' }}>Parent 1</p>
            {genotypeControl(1, parent1Genotype)}
            <p style={{ margin: '12px 0 6px', fontSize: '11px', color: 'var(--text-secondary)' }}>Parent 2</p>
            {genotypeControl(2, parent2Genotype)}
          </LabControlCard>
          <LabControlCard title="Dominance relationship">
            <div role="group" aria-label="Allele dominance relationship" style={{ display: 'grid', gap: '6px' }}>
              {([
                ['complete', 'Complete dominance'],
                ['incomplete', 'Incomplete dominance'],
                ['codominant', 'Codominance'],
              ] as const).map(([mode, label]) => (
                <button key={mode} type="button" aria-pressed={dominanceMode === mode} onClick={() => updateDominance(mode)} style={optionStyle(dominanceMode === mode)}>{label}</button>
              ))}
            </div>
          </LabControlCard>
          <LabControlCard title="Repeated offspring">
            <LabSliderInput id="genetics-count" label="Offspring sample" ariaLabel="Number of simulated offspring" value={offspringCount} min={4} max={200} step={4} decimals={0} onChange={updateCount} />
            <div style={{ marginTop: '12px' }}>
              <LabSliderInput id="seed" label="Sample Seed" ariaLabel="Repeatable genetics sample seed" value={seed} min={1} max={999} step={1} decimals={0} onChange={updateSeed} />
            </div>
            <div role="group" aria-label="Quick offspring sample seeds" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '9px' }}>
              {[42, 43].map((preset) => <button key={preset} type="button" aria-pressed={seed === preset} onClick={() => updateSeed(preset)} style={optionStyle(seed === preset)}>Seed {preset}</button>)}
            </div>
          </LabControlCard>
        </div>
      }
      visual={
        <div className="glass-panel" style={{ padding: '16px', borderRadius: '16px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)' }}>Chromosome → Gamete → Offspring</h4>
            <strong style={{ fontSize: '11px', color: isRevealed ? '#10b981' : 'var(--text-muted)' }}>{isRevealed ? `Expected ${expectedRatio}` : 'Offspring ratio 🔒'}</strong>
          </div>
          <svg
            viewBox="0 0 760 470"
            className="science-scene-svg"
            role="img"
            aria-label={isRevealed
              ? `Single-gene cross ${parent1Genotype} by ${parent2Genotype} with ${dominanceMode} dominance. Expected genotype ratio ${expectedRatio}; observed counts from ${offspringCount} offspring are ${observedRatio}.`
              : `DNA, gene, chromosome, meiosis, and gametes for a ${parent1Genotype} by ${parent2Genotype} cross. Offspring outcomes are locked until the prediction is submitted.`}
            style={{ background: '#0f172a', borderRadius: '12px' }}
          >
            <title>{isRevealed ? 'Single-gene inheritance from chromosomes to repeated offspring' : 'Chromosomes and gametes with offspring results locked'}</title>

            <text x="24" y="27" fill="#e2e8f0" fontSize="11" fontWeight="bold">DNA, gene, and chromosome are different scales</text>
            <g transform="translate(38 47)">
              {Array.from({ length: 7 }, (_, index) => (
                <g key={index}>
                  <circle cx={index * 16} cy={12 + (index % 2) * 13} r="3" fill="#60a5fa" />
                  <circle cx={index * 16} cy={25 - (index % 2) * 13} r="3" fill="#f472b6" />
                  <line x1={index * 16} y1={12 + (index % 2) * 13} x2={index * 16} y2={25 - (index % 2) * 13} stroke={index >= 2 && index <= 4 ? '#fbbf24' : '#64748b'} />
                </g>
              ))}
              <text x="50" y="48" textAnchor="middle" fill="#94a3b8" fontSize="9">DNA; amber segment = gene</text>
            </g>
            <path d="M 155 66 L 206 66" stroke="#94a3b8" strokeWidth="2" />
            <g transform="translate(225 42)" stroke="#a78bfa" strokeWidth="6" strokeLinecap="round">
              <line x1="0" y1="0" x2="32" y2="48" /><line x1="32" y1="0" x2="0" y2="48" />
              <rect x="10" y="20" width="12" height="8" fill="#fbbf24" stroke="none" />
              <text x="16" y="67" textAnchor="middle" fill="#94a3b8" fontSize="9" stroke="none">chromosome carries genes</text>
            </g>

            <text x="335" y="27" fill="#e2e8f0" fontSize="11" fontWeight="bold">Meiosis separates allele copies into gametes</text>
            {[{ x: 355, label: 'Parent 1', genotype: parent1Genotype, gametes: result.parent1Gametes }, { x: 590, label: 'Parent 2', genotype: parent2Genotype, gametes: result.parent2Gametes }].map((parent) => (
              <g key={parent.label} transform={`translate(${parent.x} 46)`}>
                <text x="55" y="0" textAnchor="middle" fill="#cbd5e1" fontSize="10" fontWeight="bold">{parent.label}: {parent.genotype}</text>
                <line x1="38" y1="14" x2="38" y2="62" stroke="#60a5fa" strokeWidth="7" strokeLinecap="round" />
                <line x1="72" y1="14" x2="72" y2="62" stroke="#f472b6" strokeWidth="7" strokeLinecap="round" />
                <text x="38" y="42" textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="bold">{parent.genotype[0]}</text>
                <text x="72" y="42" textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="bold">{parent.genotype[1]}</text>
                <path d="M 55 68 L 24 92 M 55 68 L 86 92" stroke="#94a3b8" strokeWidth="1.5" />
                {parent.gametes.map((allele, index) => (
                  <g key={`${allele}-${index}`}>
                    <circle cx={index === 0 ? 20 : 90} cy="108" r="18" fill="#1e293b" stroke={index === 0 ? '#60a5fa' : '#f472b6'} strokeWidth="2" />
                    <text x={index === 0 ? 20 : 90} y="113" textAnchor="middle" fill="#f8fafc" fontSize="15" fontWeight="bold">{allele}</text>
                  </g>
                ))}
                <text x="55" y="139" textAnchor="middle" fill="#94a3b8" fontSize="9">gametes (one allele each)</text>
              </g>
            ))}

            <text x="25" y="220" fill="#e2e8f0" fontSize="11" fontWeight="bold">Punnett square: expected probabilities</text>
            {isRevealed ? (
              <g transform="translate(70 246)">
                {result.parent2Gametes.map((allele, column) => <text key={`${allele}-${column}`} x={88 + column * 82} y="-10" textAnchor="middle" fill="#60a5fa" fontSize="14" fontWeight="bold">{allele}</text>)}
                {result.parent1Gametes.map((allele, row) => <text key={`${allele}-${row}`} x="-18" y={48 + row * 70} textAnchor="middle" fill="#f472b6" fontSize="14" fontWeight="bold">{allele}</text>)}
                {result.punnett.map((row, rowIndex) => row.map((genotype, columnIndex) => (
                  <g key={`${rowIndex}-${columnIndex}`}>
                    <rect x={48 + columnIndex * 82} y={12 + rowIndex * 70} width="80" height="68" fill="#1e293b" stroke="#64748b" />
                    <text x={88 + columnIndex * 82} y={52 + rowIndex * 70} textAnchor="middle" fill="#f8fafc" fontSize="18" fontWeight="bold">{genotype}</text>
                  </g>
                )))}
                <text x="128" y="172" textAnchor="middle" fill="#cbd5e1" fontSize="10">Expected genotype ratio: {expectedRatio}</text>
                <text x="128" y="188" textAnchor="middle" fill="#94a3b8" fontSize="9">Expected phenotype ratio: {phenotypeRatio}</text>
              </g>
            ) : (
              <g><rect x="45" y="250" width="330" height="160" rx="10" fill="#111827" stroke="#475569" /><text x="210" y="325" textAnchor="middle" fill="#cbd5e1" fontSize="13" fontWeight="bold">Punnett outcomes 🔒</text><text x="210" y="347" textAnchor="middle" fill="#94a3b8" fontSize="10">Predict before revealing the ratio.</text></g>
            )}

            <text x="455" y="220" fill="#e2e8f0" fontSize="11" fontWeight="bold">Repeated offspring: observed counts</text>
            <line x1={chart.left} y1={chart.bottom} x2={chart.right} y2={chart.bottom} stroke="#94a3b8" />
            <line x1={chart.left} y1={chart.top} x2={chart.left} y2={chart.bottom} stroke="#94a3b8" />
            <text x="600" y="463" textAnchor="middle" fill="#e2e8f0" fontSize="10">Observed offspring count (individuals)</text>
            {isRevealed ? result.observedGenotypes.map((part, index) => (
              <g key={part.label}>
                <text x={chart.left - 10} y={chart.top + 29 + index * 40} textAnchor="end" fill="#cbd5e1" fontSize="11">{part.label}</text>
                <rect x={chart.left} y={chart.top + 14 + index * 40} width={barWidth(part.count)} height="22" rx="4" fill={index === 0 ? '#60a5fa' : index === 1 ? '#a78bfa' : '#f472b6'} />
                <text x={chart.left + barWidth(part.count) + 7} y={chart.top + 29 + index * 40} fill="#f8fafc" fontSize="10">{part.count}</text>
              </g>
            )) : <g><rect x="485" y="315" width="220" height="70" rx="10" fill="#111827" stroke="#475569" /><text x="595" y="347" textAnchor="middle" fill="#cbd5e1" fontSize="12" fontWeight="bold">Sample counts 🔒</text><text x="595" y="368" textAnchor="middle" fill="#94a3b8" fontSize="9">Same seed = same offspring.</text></g>}
          </svg>
          <div aria-label="Genetics diagram legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: '8px', color: 'var(--text-secondary)', fontSize: '10px' }}><span>blue/pink rods: homologous chromosomes</span><span>outlined circles: gametes</span><span>bars: observed genotype counts</span></div>
          <p style={{ margin: '7px 2px 0', color: '#fbbf24', fontSize: '10px', fontWeight: 700 }}>Dominant means expressed in a heterozygote; it does not mean common, better, or stronger.</p>
          <p style={{ margin: '4px 2px 0', color: 'var(--text-muted)', fontSize: '10px', lineHeight: 1.45 }}>{result.limitation}</p>
        </div>
      }
    />
  );
}
