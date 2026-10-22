'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Mafs, Coordinates, Plot, Point, Text, Line, Polygon, LaTeX as MafsLaTeX } from 'mafs';
import MafsStage from './MafsStage';
import LearnPanel from './LearnPanel';
import TryItCard from './TryItCard';
import LabSceneLayout from './LabSceneLayout';
import LabControlCard from './LabControlCard';
import ConceptConnectionsLab from './ConceptConnectionsLab';
import { LAB_ACTIVITIES, type LabActivityId, type TreeDiagramEvent } from '../../lib/lab-activities';
import { getExplorePrompts } from '../../lib/lab-explore-prompts';
import { LAB_RENDER_LIMITS, clampInteger, clampNumber } from '../../lib/lab-performance';
import { useLabVariant } from '../../lib/use-lab-variant';
import { formatValueLaTeX } from '../../lib/math-utils';
import LabNumberInput from '../lab-shared/LabNumberInput';

// ─── Types ─────────────────────────────────────────────────────────────────────

type StatisticsModule =
  | 'distribution-shape'
  | 'normal-zscore'
  | 'probability-simulation'
  | 'scatter-regression'
  | 'box-plot'
  | 'tree-two-way'
  | 'sampling-distribution';

interface StatisticsTabProps {
  isExact?: boolean;
  mafsHeight: number;
  mode?: 'explore' | 'learn';
  activityId?: LabActivityId;
  onActivityComplete?: (activityId: string, success: boolean) => void;
  onExitLearn?: () => void;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_DATA = LAB_RENDER_LIMITS.dataPoints; // 40
const MAX_TRIALS = LAB_RENDER_LIMITS.probabilityTrials; // 200

const MODULE_OPTIONS: { id: StatisticsModule; label: string }[] = [
  { id: 'distribution-shape', label: 'Distribution Shape' },
  { id: 'normal-zscore', label: 'Normal & z-Scores' },
  { id: 'probability-simulation', label: 'Probability Simulation' },
  { id: 'scatter-regression', label: 'Scatter & Regression' },
  { id: 'box-plot', label: 'Box Plot' },
  { id: 'tree-two-way', label: 'Tree & Two-Way' },
  { id: 'sampling-distribution', label: 'Why Larger Samples Vary Less' },
];

// ─── Deterministic helpers ─────────────────────────────────────────────────────

/** Van der Corput low-discrepancy sequence in base 2 — deterministic, no RNG */
function vanDerCorput(index: number): number {
  let result = 0;
  let denom = 1;
  let n = index;
  while (n > 0) {
    denom *= 2;
    result += (n % 2) / denom;
    n = Math.floor(n / 2);
  }
  return result;
}

/** Compute mean of an array */
function mean(data: number[]): number {
  if (data.length === 0) return 0;
  return data.reduce((s, v) => s + v, 0) / data.length;
}

/** Compute median of a sorted array */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return sorted[Math.floor(n / 2)];
  return (sorted[Math.floor(n / 2) - 1] + sorted[Math.floor(n / 2)]) / 2;
}

/** Standard deviation (population) */
function stdDev(data: number[]): number {
  if (data.length < 2) return 0;
  const m = mean(data);
  const variance = data.reduce((s, v) => s + (v - m) ** 2, 0) / data.length;
  return Math.sqrt(variance);
}

/**
 * Five-number summary: min, Q1, median, Q3, max.
 * Uses the exclusive (Tukey) quartile method: Q1 is the median of values below the overall median,
 * Q3 is the median of values above.
 */
export function fiveNumberSummary(data: number[]): { min: number; q1: number; median: number; q3: number; max: number } {
  if (data.length === 0) return { min: 0, q1: 0, median: 0, q3: 0, max: 0 };
  const sorted = [...data].sort((a, b) => a - b);
  const n = sorted.length;
  const med = median(sorted);
  const midIdx = Math.floor(n / 2);
  const lowerHalf = n % 2 === 1 ? sorted.slice(0, midIdx) : sorted.slice(0, midIdx);
  const upperHalf = n % 2 === 1 ? sorted.slice(midIdx + 1) : sorted.slice(midIdx);
  const q1 = lowerHalf.length > 0 ? median(lowerHalf) : sorted[0];
  const q3 = upperHalf.length > 0 ? median(upperHalf) : sorted[n - 1];
  return { min: sorted[0], q1, median: med, q3, max: sorted[n - 1] };
}

/**
 * Tree diagram probability: P(event sequence) without replacement.
 * Takes counts by category and a draw sequence (indices into categories).
 */
export function treeProbWithoutReplacement(counts: number[], draws: number[]): number {
  if (counts.length === 0 || draws.length === 0) return 0;
  const pool = [...counts];
  let total = pool.reduce((s, v) => s + v, 0);
  let prob = 1;
  for (const idx of draws) {
    if (idx < 0 || idx >= pool.length || pool[idx] <= 0 || total <= 0) return 0;
    prob *= pool[idx] / total;
    pool[idx]--;
    total--;
  }
  return prob;
}

/**
 * Two-way table: given |A|, |B|, |A∩B| and total N, compute |neither|.
 */
export function twoWayNeither(total: number, sizeA: number, sizeB: number, intersection: number): number {
  if (total <= 0) return 0;
  const union = sizeA + sizeB - intersection;
  return Math.max(0, total - union);
}

/** Normal PDF */
export function normalPdf(x: number, mu: number, sigma: number): number {
  if (sigma <= 0) return 0;
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

/** Approximate normal CDF using Abramowitz & Stegun */
export function normalCdf(x: number, mu: number, sigma: number): number {
  if (sigma <= 0) return x >= mu ? 1 : 0;
  const z = (x - mu) / sigma;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327; // 1/sqrt(2*pi)
  const p =
    d * Math.exp(-0.5 * z * z) *
    (t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));
  return z >= 0 ? 1 - p : p;
}

/** Bounded least-squares linear regression */
export function leastSquares(points: [number, number][]): { slope: number; intercept: number; r: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0, r: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of points) {
    sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return { slope: 0, intercept: sy / n, r: 0 };
  const slope = Math.max(-100, Math.min(100, (n * sxy - sx * sy) / denom));
  const intercept = Math.max(-1000, Math.min(1000, (sy - slope * sx) / n));
  // Pearson r
  const denomR = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  const r = denomR > 1e-12 ? Math.max(-1, Math.min(1, (n * sxy - sx * sy) / denomR)) : 0;
  return { slope, intercept, r };
}

export function simulateProbability(
  trials: number,
  probability: number,
): { trials: number; successes: number; proportion: number } {
  const cappedTrials = clampInteger(trials, 1, MAX_TRIALS);
  const cappedProbability = clampNumber(probability, 0, 1, 0);
  let successes = 0;
  for (let index = 1; index <= cappedTrials; index++) {
    if (vanDerCorput(index) < cappedProbability) successes++;
  }
  return {
    trials: cappedTrials,
    successes,
    proportion: successes / cappedTrials,
  };
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function StatisticsTab({
  isExact = true,
  mafsHeight,
  mode = 'explore',
  activityId,
  onActivityComplete,
  onExitLearn,
}: StatisticsTabProps) {
  // ─── Module selector state ─────────────────────────────────────────────
  const [activeModule, setActiveModule] = useState<StatisticsModule>('distribution-shape');
  const [learnRevealed, setLearnRevealed] = useState(false);
  const [learnStep, setLearnStep] = useState(0);
  const variant = useLabVariant(activityId);
  const getVariantSceneData = variant.getSceneData;

  // ─── Distribution Shape state ──────────────────────────────────────────
  const [distData, setDistData] = useState<number[]>([2, 3, 3, 4, 8]);
  const [distInput, setDistInput] = useState('');

  // ─── Normal z-score state ──────────────────────────────────────────────
  const [normMean, setNormMean] = useState(60);
  const [normSd, setNormSd] = useState(5);
  const [normX, setNormX] = useState(70);

  // ─── Probability simulation state ──────────────────────────────────────
  const [probTrials, setProbTrials] = useState(50);
  const [probP, setProbP] = useState(0.5);

  // ─── Scatter regression state ──────────────────────────────────────────
  const [scatterPoints, setScatterPoints] = useState<[number, number][]>([
    [1, 2.5], [2, 4], [3, 5.5], [4, 7], [5, 8.5], [6, 10], [7, 12], [8, 14],
  ]);
  const [scatterXInput, setScatterXInput] = useState('');
  const [scatterYInput, setScatterYInput] = useState('');

  // ─── Box plot state ────────────────────────────────────────────────────
  const [boxData, setBoxData] = useState<number[]>([3, 5, 7, 8, 12, 14, 16]);
  const [boxInput, setBoxInput] = useState('');

  // ─── Tree/Two-way state ────────────────────────────────────────────────
  const [treeScenarioStep, setTreeScenarioStep] = useState(0);
  const [treeEvent, setTreeEvent] = useState<TreeDiagramEvent>('both-red');
  const [treeExploreScene, setTreeExploreScene] = useState<'tree' | 'table'>('tree');
  const [treeRedCount, setTreeRedCount] = useState(3);
  const [treeBlueCount, setTreeBlueCount] = useState(2);
  const [tableSportMusic, setTableSportMusic] = useState(15);
  const [tableSportTotal, setTableSportTotal] = useState(25);
  const [tableMusicTotal, setTableMusicTotal] = useState(20);
  const [tableGrandTotal, setTableGrandTotal] = useState(40);

  // ─── Sync learn mode to correct module ─────────────────────────────────
  useEffect(() => {
    if (activityId) {
      if (activityId === 'statistics-distribution-shape') setActiveModule('distribution-shape');
      else if (activityId === 'statistics-normal-zscore') setActiveModule('normal-zscore');
      else if (activityId === 'statistics-probability-simulation') setActiveModule('probability-simulation');
      else if (activityId === 'statistics-scatter-regression') setActiveModule('scatter-regression');
      else if (activityId === 'statistics-box-plot') setActiveModule('box-plot');
      else if (activityId === 'statistics-tree-two-way') setActiveModule('tree-two-way');
      else if (activityId === 'statistics-sampling-distribution') setActiveModule('sampling-distribution');
    }
  }, [mode, activityId]);

  // Reset learn-mode visual state on step change
  useEffect(() => {
    setLearnRevealed(false);
    // A variant supplies the exact data the prompt states; the literals below are
    // the authored fallback.
    const generated = getVariantSceneData(learnStep);
    if (generated && generated.kind === 'dataset') {
      if (activityId === 'statistics-box-plot') setBoxData(generated.values);
      else setDistData(generated.values);
      return;
    }
    if (generated && generated.kind === 'probability') {
      setProbTrials(100);
      setProbP(generated.p);
      return;
    }
    if (generated && generated.kind === 'scatter') {
      setScatterPoints(generated.points);
      return;
    }
    if (generated && generated.kind === 'two-way') {
      setTreeScenarioStep(learnStep);
      setTreeEvent(generated.treeEvent ?? 'both-red');
      return;
    }

    if (activityId === 'statistics-distribution-shape') {
      const datasets: number[][] = [[2, 3, 3, 4, 8], [2, 3, 3, 4, 8], [2, 3, 3, 4, 20]];
      setDistData(datasets[learnStep] ?? datasets[0]);
    } else if (activityId === 'statistics-normal-zscore') {
      const sd = getVariantSceneData(learnStep);
      if (sd && sd.kind === 'normal-zscore') {
        setNormMean(sd.mu);
        setNormSd(sd.sigma);
        setNormX(sd.x);
      } else {
        setNormMean(60);
        setNormSd(5);
        setNormX(learnStep === 0 ? 70 : learnStep === 1 ? 65 : 55);
      }
    } else if (activityId === 'statistics-probability-simulation') {
      setProbTrials(100);
      setProbP(learnStep === 0 ? 0.5 : learnStep === 1 ? 0.3 : 0.25);
    } else if (activityId === 'statistics-scatter-regression') {
      setScatterPoints(
        learnStep === 1
          ? [[1, 3], [2, 5], [3, 7], [4, 9], [5, 11]]
          : [[1, 3], [2, 5], [3, 5], [4, 9], [5, 9]],
      );
    } else if (activityId === 'statistics-box-plot') {
      const datasets: number[][] = [
        [3, 5, 7, 8, 12, 14, 16],
        [3, 5, 7, 8, 12, 14, 16],
        [3, 5, 7, 8, 12, 14, 16],
      ];
      setBoxData(datasets[learnStep] ?? datasets[0]);
    } else if (activityId === 'statistics-tree-two-way') {
      setTreeScenarioStep(learnStep);
      setTreeEvent('both-red');
    }
  }, [activityId, learnStep, variant.variantSeed, getVariantSceneData]);

  // ─── Computed statistics ───────────────────────────────────────────────
  const distSorted = useMemo(() => [...distData].sort((a, b) => a - b), [distData]);
  const distMean = useMemo(() => mean(distData), [distData]);
  const distMedian = useMemo(() => median(distSorted), [distSorted]);

  const normZ = useMemo(() => normSd > 0 ? (normX - normMean) / normSd : 0, [normX, normMean, normSd]);
  const normArea = useMemo(() => normalCdf(normX, normMean, normSd), [normX, normMean, normSd]);

  const regression = useMemo(() => leastSquares(scatterPoints), [scatterPoints]);

  const boxSummary = useMemo(() => fiveNumberSummary(boxData), [boxData]);

  const treeExploreProb = useMemo(
    () => treeProbWithoutReplacement([treeRedCount, treeBlueCount], [0, 0]),
    [treeRedCount, treeBlueCount],
  );
  const tableExploreNeither = useMemo(
    () => twoWayNeither(tableGrandTotal, tableSportTotal, tableMusicTotal, tableSportMusic),
    [tableGrandTotal, tableSportTotal, tableMusicTotal, tableSportMusic],
  );

  // ─── Probability simulation (deterministic, no history retained) ───────
  const probResult = useMemo(
    () => simulateProbability(probTrials, probP),
    [probTrials, probP],
  );

  // ─── Handlers ──────────────────────────────────────────────────────────
  const handleLearnStepChange = useCallback((step: number) => {
    setLearnRevealed(false);
    setLearnStep(step);
  }, []);

  const handleAddDistValue = useCallback(() => {
    const v = parseFloat(distInput);
    if (!Number.isFinite(v)) return;
    setDistData((prev) => {
      if (prev.length >= MAX_DATA) return prev;
      return [...prev, Math.max(-100, Math.min(100, v))];
    });
    setDistInput('');
  }, [distInput]);

  const handleResetDist = useCallback(() => {
    setDistData([2, 3, 3, 4, 8]);
  }, []);

  const handleAddScatterPoint = useCallback(() => {
    const x = parseFloat(scatterXInput);
    const y = parseFloat(scatterYInput);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    setScatterPoints((prev) => {
      if (prev.length >= MAX_DATA) return prev;
      return [...prev, [Math.max(-50, Math.min(50, x)), Math.max(-50, Math.min(50, y))]];
    });
    setScatterXInput('');
    setScatterYInput('');
  }, [scatterXInput, scatterYInput]);

  const handleResetScatter = useCallback(() => {
    setScatterPoints([[1, 2.5], [2, 4], [3, 5.5], [4, 7], [5, 8.5], [6, 10], [7, 12], [8, 14]]);
  }, []);

  const handleAddBoxValue = useCallback(() => {
    const v = parseFloat(boxInput);
    if (!Number.isFinite(v)) return;
    setBoxData((prev) => {
      if (prev.length >= MAX_DATA) return prev;
      return [...prev, Math.max(-100, Math.min(100, v))];
    });
    setBoxInput('');
  }, [boxInput]);

  const handleRemoveLastBox = useCallback(() => {
    setBoxData((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const handleResetBox = useCallback(() => {
    setBoxData([3, 5, 7, 8, 12, 14, 16]);
  }, []);

  // ─── Learn mode rendering ──────────────────────────────────────────────
  const learnActivity = activityId ? LAB_ACTIVITIES[activityId] : undefined;
  const samplingTopicSelector = (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
      Statistics module
      <select
        aria-label="Statistics connection module"
        value={activeModule}
        onChange={(event) => setActiveModule(event.target.value as StatisticsModule)}
        style={{ padding: '9px 10px', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
      >
        {MODULE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
  const isSamplingConnection = activityId === 'statistics-sampling-distribution'
    || (mode === 'explore' && activeModule === 'sampling-distribution');
  if (isSamplingConnection && (mode === 'explore' || (learnActivity && onExitLearn && onActivityComplete))) {
    return (
      <ConceptConnectionsLab
        activity={LAB_ACTIVITIES['statistics-sampling-distribution']}
        mafsHeight={mafsHeight}
        mode={mode}
        topicSelector={samplingTopicSelector}
        onComplete={onActivityComplete ?? (() => undefined)}
        onExit={onExitLearn ?? (() => undefined)}
      />
    );
  }

  if (mode === 'learn' && learnActivity && onExitLearn && onActivityComplete) {
    return (
      <LabSceneLayout
        control={
          <LearnPanel
            key={learnActivity.id}
            activity={learnActivity}
          onComplete={onActivityComplete}
          onExit={onExitLearn}
          onRevealChange={setLearnRevealed}
          onStepChange={handleLearnStepChange}
          {...variant.learnPanelProps}
        />
        }
        visual={
        <>
          {activeModule === 'distribution-shape' && (
            <LearnDistributionVis
              data={distData}
              sorted={distSorted}
              mean={distMean}
              median={distMedian}
              mafsHeight={mafsHeight}
              revealed={learnRevealed}
            />
          )}
          {activeModule === 'normal-zscore' && (
            <div data-testid="statistics-normal-scene">
            <LearnNormalVis
              mu={normMean}
              sigma={normSd}
              x={normX}
              z={normZ}
              area={normArea}
              step={learnStep}
              mafsHeight={mafsHeight}
              revealed={learnRevealed}
            />
            </div>
          )}
          {activeModule === 'probability-simulation' && (
            <LearnProbabilityVis
              trials={probResult.trials}
              successes={probResult.successes}
              proportion={probResult.proportion}
              p={probP}
              mafsHeight={mafsHeight}
              revealed={learnRevealed}
            />
          )}
          {activeModule === 'scatter-regression' && (
            <LearnScatterVis
              points={scatterPoints}
              regression={regression}
              mafsHeight={mafsHeight}
              revealed={learnRevealed}
            />
          )}
          {activeModule === 'box-plot' && (
            <LearnBoxPlotVis
              data={boxData}
              mafsHeight={mafsHeight}
              revealed={learnRevealed}
            />
          )}
          {activeModule === 'tree-two-way' && (
            <LearnTreeTwoWayVis
              step={treeScenarioStep}
              revealed={learnRevealed}
              treeEvent={treeEvent}
            />
          )}
          {!learnRevealed && (
            <div className="lab-visual-info glass-panel" aria-live="polite" style={{ padding: '10px 14px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Submit your answer to reveal the computed statistics and visual overlays.
            </div>
          )}
        </>
        }
      />
    );
  }

  // ─── Explore mode rendering ─────────────────────────────────────────────
  return (
    <LabSceneLayout
      align="stretch"
      control={
      <LabControlCard>
        {/* Module selector */}
        <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
            Statistics Module
          </legend>
          <div role="radiogroup" aria-label="Statistics module selector" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {MODULE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                role="radio"
                aria-checked={activeModule === opt.id}
                onClick={() => setActiveModule(opt.id)}
                onKeyDown={(e) => {
                  const idx = MODULE_OPTIONS.findIndex((o) => o.id === activeModule);
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveModule(MODULE_OPTIONS[(idx + 1) % MODULE_OPTIONS.length].id);
                  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveModule(MODULE_OPTIONS[(idx - 1 + MODULE_OPTIONS.length) % MODULE_OPTIONS.length].id);
                  }
                }}
                tabIndex={activeModule === opt.id ? 0 : -1}
                style={{
                  padding: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: '1px solid var(--border-color)',
                  background: activeModule === opt.id ? 'var(--accent-color)' : 'var(--bg-secondary)',
                  color: activeModule === opt.id ? 'white' : 'var(--text-primary)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Module-specific controls */}
        {activeModule === 'distribution-shape' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>Distribution Shape</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
              Add or remove data values to explore how mean, median, and shape change. Max {MAX_DATA} values.
            </p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label htmlFor="dist-val-input" className="sr-only">New data value</label>
              <input
                id="dist-val-input"
                type="number"
                aria-label="New data value"
                value={distInput}
                onChange={(e) => setDistInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddDistValue(); }}
                placeholder="Value"
                style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px' }}
              />
              <button
                onClick={handleAddDistValue}
                disabled={distData.length >= MAX_DATA}
                aria-label="Add data value"
                style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: 'pointer', background: 'var(--accent-color)', color: 'white' }}
              >
                Add
              </button>
              <button
                onClick={handleResetDist}
                aria-label="Reset distribution data"
                style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: '1px solid var(--border-color)', cursor: 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              >
                Reset
              </button>
            </div>
            <div aria-live="polite" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              n = {distData.length} | Mean = {distMean.toFixed(2)} | Median = {distMedian.toFixed(2)} | SD = {stdDev(distData).toFixed(2)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', maxHeight: '80px', overflowY: 'auto', wordBreak: 'break-all' }}>
              Data: [{distSorted.join(', ')}]
            </div>
          </div>
        )}

        {activeModule === 'normal-zscore' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>Normal Distribution</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
              Adjust mean (μ), standard deviation (σ), and x-value to explore z-scores and shaded areas.
            </p>
            <label style={{ fontSize: '12px', fontWeight: 600 }}>
              Mean (μ)
              <LabNumberInput
                aria-label="Mean mu"
                value={normMean}
                onChange={(e) => setNormMean(clampNumber(Number(e.target.value), -100, 100, normMean))}
                step={1}
                style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
              />
            </label>
            <label style={{ fontSize: '12px', fontWeight: 600 }}>
              Standard deviation (σ)
              <LabNumberInput
                aria-label="Standard deviation sigma"
                value={normSd}
                onChange={(e) => setNormSd(clampNumber(Number(e.target.value), 0.5, 30, normSd))}
                step={0.5}
                min={0.5}
                style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
              />
            </label>
            <label style={{ fontSize: '12px', fontWeight: 600 }}>
              x-value
              <LabNumberInput
                aria-label="x value for z-score"
                value={normX}
                onChange={(e) => setNormX(clampNumber(
                  Number(e.target.value),
                  normMean - 5 * normSd,
                  normMean + 5 * normSd,
                  normX,
                ))}
                step={1}
                style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
              />
            </label>
            <div aria-live="polite" style={{ padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '12px' }}>
              <div><strong>z = (x − μ) / σ = <span data-testid="statistics-normal-z">{normZ.toFixed(3)}</span></strong></div>
              <div>P(X ≤ {normX}) ≈ <span data-testid="statistics-normal-area">{(normArea * 100).toFixed(2)}</span>%</div>
            </div>
          </div>
        )}

        {activeModule === 'probability-simulation' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>Probability Simulation</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
              Deterministic simulation using a low-discrepancy sequence. Max {MAX_TRIALS} trials. No randomness or timers.
            </p>
            <label style={{ fontSize: '12px', fontWeight: 600 }}>
              Number of trials
              <LabNumberInput
                aria-label="Number of trials"
                value={probTrials}
                onChange={(e) => setProbTrials(clampInteger(Number(e.target.value) || 1, 1, MAX_TRIALS))}
                min={1}
                max={MAX_TRIALS}
                step={10}
                style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
              />
            </label>
            <label style={{ fontSize: '12px', fontWeight: 600 }}>
              Probability of success (p)
              <LabNumberInput
                aria-label="Probability of success"
                value={probP}
                onChange={(e) => setProbP(clampNumber(Number(e.target.value), 0, 1, probP))}
                min={0}
                max={1}
                step={0.05}
                style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
              />
            </label>
            <div aria-live="polite" style={{ padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '12px' }}>
              <div>Trials: {probResult.trials} | Successes: {probResult.successes}</div>
              <div>Simulated proportion: <strong>{probResult.proportion.toFixed(4)}</strong></div>
              <div>Expected (np): {(probResult.trials * probP).toFixed(1)}</div>
            </div>
          </div>
        )}

        {activeModule === 'scatter-regression' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>Scatter & Regression</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
              Add points to see the least-squares line update. Max {MAX_DATA} points.
            </p>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                type="number"
                aria-label="New scatter point x"
                value={scatterXInput}
                onChange={(e) => setScatterXInput(e.target.value)}
                placeholder="x"
                style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '12px' }}
              />
              <input
                type="number"
                aria-label="New scatter point y"
                value={scatterYInput}
                onChange={(e) => setScatterYInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddScatterPoint(); }}
                placeholder="y"
                style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '12px' }}
              />
              <button
                onClick={handleAddScatterPoint}
                disabled={scatterPoints.length >= MAX_DATA}
                aria-label="Add scatter point"
                style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: 'pointer', background: 'var(--accent-color)', color: 'white' }}
              >
                Add
              </button>
              <button
                onClick={handleResetScatter}
                aria-label="Reset scatter data"
                style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: '1px solid var(--border-color)', cursor: 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              >
                Reset
              </button>
            </div>
            <div aria-live="polite" style={{ padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '12px' }}>
              <div>n = {scatterPoints.length}</div>
              <div data-testid="statistics-regression-eq">y = <span data-testid="statistics-slope">{formatValueLaTeX(regression.slope, isExact)}</span>x + <span data-testid="statistics-intercept">{formatValueLaTeX(regression.intercept, isExact)}</span></div>
              <div>r = {regression.r.toFixed(4)}</div>
            </div>
          </div>
        )}

        {activeModule === 'box-plot' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>Box Plot Explorer</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
              Add, remove, or reset data values to explore the five-number summary and box-and-whisker plot. Max {MAX_DATA} values.
            </p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label htmlFor="box-val-input" className="sr-only">New box plot value</label>
              <input
                id="box-val-input"
                type="number"
                aria-label="New box plot value"
                value={boxInput}
                onChange={(e) => setBoxInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddBoxValue(); }}
                placeholder="Value"
                style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px' }}
              />
              <button
                onClick={handleAddBoxValue}
                disabled={boxData.length >= MAX_DATA}
                aria-label="Add box plot value"
                style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: 'pointer', background: 'var(--accent-color)', color: 'white' }}
              >
                Add
              </button>
              <button
                onClick={handleRemoveLastBox}
                disabled={boxData.length <= 1}
                aria-label="Remove last box plot value"
                style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: '1px solid var(--border-color)', cursor: 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              >
                Remove
              </button>
              <button
                onClick={handleResetBox}
                aria-label="Reset box plot data"
                style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: '1px solid var(--border-color)', cursor: 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              >
                Reset
              </button>
            </div>
            <div data-testid="box-plot-summary" aria-live="polite" style={{ padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '12px' }}>
              <div>n = {boxData.length}</div>
              <div>Min = {boxSummary.min} | Q1 = {boxSummary.q1} | Median = {boxSummary.median} | Q3 = {boxSummary.q3} | Max = {boxSummary.max}</div>
              <div>IQR = {boxSummary.q3 - boxSummary.q1}</div>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', maxHeight: '60px', overflowY: 'auto', wordBreak: 'break-all' }}>
              Data: [{[...boxData].sort((a, b) => a - b).join(', ')}]
            </div>
          </div>
        )}

        {activeModule === 'tree-two-way' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>Tree & Two-Way Explorer</h3>
            <div role="radiogroup" aria-label="Tree or table scene" style={{ display: 'flex', gap: '6px' }}>
              <button
                role="radio"
                aria-checked={treeExploreScene === 'tree'}
                onClick={() => setTreeExploreScene('tree')}
                tabIndex={treeExploreScene === 'tree' ? 0 : -1}
                style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 700, borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--border-color)', background: treeExploreScene === 'tree' ? 'var(--accent-color)' : 'var(--bg-secondary)', color: treeExploreScene === 'tree' ? 'white' : 'var(--text-primary)' }}
              >
                Tree Diagram
              </button>
              <button
                role="radio"
                aria-checked={treeExploreScene === 'table'}
                onClick={() => setTreeExploreScene('table')}
                tabIndex={treeExploreScene === 'table' ? 0 : -1}
                style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 700, borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--border-color)', background: treeExploreScene === 'table' ? 'var(--accent-color)' : 'var(--bg-secondary)', color: treeExploreScene === 'table' ? 'white' : 'var(--text-primary)' }}
              >
                Two-Way Table
              </button>
            </div>
            {treeExploreScene === 'tree' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                  Adjust the number of red and blue marbles to explore conditional probability without replacement.
                </p>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  Red marbles
                  <LabNumberInput
                    aria-label="Red marble count"
                    value={treeRedCount}
                    onChange={(e) => setTreeRedCount(clampInteger(Number(e.target.value) || 1, 1, 20))}
                    min={1}
                    max={20}
                    style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
                  />
                </label>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  Blue marbles
                  <LabNumberInput
                    aria-label="Blue marble count"
                    value={treeBlueCount}
                    onChange={(e) => setTreeBlueCount(clampInteger(Number(e.target.value) || 1, 1, 20))}
                    min={1}
                    max={20}
                    style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
                  />
                </label>
                <div data-testid="tree-explore-result" aria-live="polite" style={{ padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '12px' }}>
                  P(both red) = {treeRedCount}/{treeRedCount + treeBlueCount} × {treeRedCount - 1}/{treeRedCount + treeBlueCount - 1} = {treeExploreProb.toFixed(4)}
                </div>
              </div>
            )}
            {treeExploreScene === 'table' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                  Adjust the two-way table values to explore set relationships and &quot;neither&quot; calculations.
                </p>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  Sport ∩ Music
                  <LabNumberInput
                    aria-label="Sport and Music intersection"
                    value={tableSportMusic}
                    onChange={(e) => setTableSportMusic(clampInteger(Number(e.target.value) || 0, 0, Math.min(tableSportTotal, tableMusicTotal)))}
                    min={0}
                    style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
                  />
                </label>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  Total Sport
                  <LabNumberInput
                    aria-label="Total sport count"
                    value={tableSportTotal}
                    onChange={(e) => setTableSportTotal(clampInteger(Number(e.target.value) || 1, 1, tableGrandTotal))}
                    min={1}
                    style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
                  />
                </label>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  Total Music
                  <LabNumberInput
                    aria-label="Total music count"
                    value={tableMusicTotal}
                    onChange={(e) => setTableMusicTotal(clampInteger(Number(e.target.value) || 1, 1, tableGrandTotal))}
                    min={1}
                    style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
                  />
                </label>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  Grand Total
                  <LabNumberInput
                    aria-label="Grand total"
                    value={tableGrandTotal}
                    onChange={(e) => setTableGrandTotal(clampInteger(Number(e.target.value) || 2, 2, 200))}
                    min={2}
                    style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
                  />
                </label>
                <div data-testid="table-explore-result" aria-live="polite" style={{ padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '12px' }}>
                  <div>Union = {tableSportTotal} + {tableMusicTotal} − {tableSportMusic} = {tableSportTotal + tableMusicTotal - tableSportMusic}</div>
                  <div>Neither = {tableGrandTotal} − {tableSportTotal + tableMusicTotal - tableSportMusic} = {tableExploreNeither}</div>
                </div>
              </div>
            )}
          </div>
        )}

        <TryItCard prompts={getExplorePrompts('statistics')} />
      </LabControlCard>
      }
      visual={
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {activeModule === 'distribution-shape' && (
          <ExploreDistributionVis data={distData} sorted={distSorted} mean={distMean} median={distMedian} mafsHeight={mafsHeight} />
        )}
        {activeModule === 'normal-zscore' && (
          <ExploreNormalVis mu={normMean} sigma={normSd} x={normX} z={normZ} area={normArea} mafsHeight={mafsHeight} />
        )}
        {activeModule === 'probability-simulation' && (
          <ExploreProbabilityVis trials={probResult.trials} successes={probResult.successes} p={probP} mafsHeight={mafsHeight} />
        )}
        {activeModule === 'scatter-regression' && (
          <ExploreScatterVis points={scatterPoints} regression={regression} mafsHeight={mafsHeight} />
        )}
        {activeModule === 'box-plot' && (
          <ExploreBoxPlotVis data={boxData} summary={boxSummary} mafsHeight={mafsHeight} />
        )}
        {activeModule === 'tree-two-way' && (
          <ExploreTreeTwoWayVis
            scene={treeExploreScene}
            redCount={treeRedCount}
            blueCount={treeBlueCount}
            sportMusic={tableSportMusic}
            sportTotal={tableSportTotal}
            musicTotal={tableMusicTotal}
            grandTotal={tableGrandTotal}
            neither={tableExploreNeither}
            prob={treeExploreProb}
          />
        )}
      </div>
      }
    />
  );
}

// ─── Visualization Sub-Components ──────────────────────────────────────────────

interface DistributionVisProps {
  data: number[];
  sorted: number[];
  mean: number;
  median: number;
  mafsHeight: number;
  revealed?: boolean;
}

function ExploreDistributionVis({ data, sorted, mean: m, median: med, mafsHeight }: DistributionVisProps) {
  // Build frequency bins
  const { maxFreq, minVal, maxVal } = useMemo(() => {
    if (data.length === 0) return { maxFreq: 1, minVal: 0, maxVal: 10 };
    const mn = sorted[0];
    const mx = sorted[sorted.length - 1];
    const freq: Record<number, number> = {};
    for (const v of sorted) freq[v] = (freq[v] || 0) + 1;
    const mf = Math.max(1, ...Object.values(freq));
    return { maxFreq: mf, minVal: mn - 1, maxVal: mx + 1 };
  }, [data, sorted]);

  return (
    <MafsStage mafsHeight={mafsHeight} ariaLabel="Dot plot and distribution shape visualization" interaction="explore">
      <Mafs height={mafsHeight} viewBox={{ x: [minVal - 1, maxVal + 1] as [number, number], y: [-0.5, maxFreq + 2.5] as [number, number] }} pan={true} zoom={{ min: 0.5, max: 4 }}>
        <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: 1 }} />
        {/* Dot plot */}
        {sorted.map((val, i) => {
          const countBelow = sorted.slice(0, i).filter((v) => v === val).length;
          return <Point key={`${val}-${i}`} x={val} y={countBelow + 0.5} color="var(--accent-color)" />;
        })}
        {/* Mean line */}
        <Plot.OfX y={(x) => (Math.abs(x - m) < 0.02 ? maxFreq + 0.5 : NaN)} color="var(--text-secondary)" />
        {/* Keep the centre labels on clearly separate rows when their x-values are close. */}
        <Text x={m} y={maxFreq + 1.8} color="var(--text-secondary)" size={11}>Mean</Text>
        {/* Median line */}
        <Plot.OfX y={(x) => (Math.abs(x - med) < 0.02 ? maxFreq + 0.5 : NaN)} color="var(--success)" />
        <Text x={med} y={maxFreq + 0.3} color="var(--success)" size={11}>Median</Text>
      </Mafs>
    </MafsStage>
  );
}

function LearnDistributionVis({ sorted, mean: m, median: med, mafsHeight, revealed }: DistributionVisProps) {
  const maxFreq = useMemo(() => {
    const freq: Record<number, number> = {};
    for (const v of sorted) freq[v] = (freq[v] || 0) + 1;
    return Math.max(1, ...Object.values(freq));
  }, [sorted]);

  const minVal = sorted.length > 0 ? sorted[0] - 1 : 0;
  const maxVal = sorted.length > 0 ? sorted[sorted.length - 1] + 1 : 10;

  return (
    <MafsStage mafsHeight={mafsHeight} ariaLabel="Distribution shape learning visualization" interaction="static">
      <Mafs height={mafsHeight} viewBox={{ x: [minVal - 1, maxVal + 1] as [number, number], y: [-0.5, maxFreq + 3.5] as [number, number] }} pan={false} zoom={false}>
        <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: 1 }} />
        {sorted.map((val, i) => {
          const countBelow = sorted.slice(0, i).filter((v) => v === val).length;
          return <Point key={`${val}-${i}`} x={val} y={countBelow + 0.5} color="var(--accent-color)" />;
        })}
        {revealed && (
          <>
            <Plot.OfX y={(x) => (Math.abs(x - m) < 0.02 ? maxFreq + 0.5 : NaN)} color="var(--text-secondary)" />
            <MafsLaTeX at={[m, maxFreq + 0.7]} tex={`\\text{Mean}=${m.toFixed(1)}`} color="var(--text-secondary)" />
            <Plot.OfX y={(x) => (Math.abs(x - med) < 0.02 ? maxFreq + 0.5 : NaN)} color="var(--success)" />
            <MafsLaTeX at={[med, maxFreq + 2.7]} tex={`\\text{Median}=${med}`} color="var(--success)" />
          </>
        )}
      </Mafs>
    </MafsStage>
  );
}

// ─── Normal z-score Visualization ─────────────────────────────────────────────

interface NormalVisProps {
  mu: number;
  sigma: number;
  x: number;
  z: number;
  area: number;
  step?: number;
  mafsHeight: number;
  revealed?: boolean;
}

function ExploreNormalVis({ mu, sigma, x, z, area, mafsHeight }: NormalVisProps) {
  const xMin = mu - 4 * sigma;
  const xMax = mu + 4 * sigma;
  const yMax = normalPdf(mu, mu, sigma) * 1.3;
  const readoutX = x >= mu ? mu - 2.4 * sigma : mu + 2.4 * sigma;

  return (
    <MafsStage mafsHeight={mafsHeight} ariaLabel={`Normal distribution with mean ${mu}, standard deviation ${sigma}. Shaded area to the left of x=${x} is ${(area * 100).toFixed(1)} percent.`} interaction="explore">
      <Mafs height={mafsHeight} viewBox={{ x: [xMin, xMax] as [number, number], y: [-yMax * 0.15, yMax] as [number, number] }} preserveAspectRatio={false} pan={true} zoom={{ min: 0.5, max: 4 }}>
        <Coordinates.Cartesian xAxis={{ lines: sigma }} yAxis={false} />
        {/* Normal curve */}
        <Plot.OfX y={(xv) => normalPdf(xv, mu, sigma)} color="var(--accent-color)" />
        {/* Shaded region under curve to the left of x */}
        <Plot.Inequality
          y={{ '<=' : (xv: number) => xv <= x ? normalPdf(xv, mu, sigma) : 0, '>=' : () => 0 }}
          color="var(--accent-color)"
        />
        {/* x marker */}
        <Line.Segment point1={[x, 0]} point2={[x, normalPdf(x, mu, sigma)]} color="var(--text-secondary)" />
        <g className="mafs-label mafs-label--axis-readout mafs-label--offset-right">
          <MafsLaTeX at={[x, 0]} tex={`x=${x}`} color="var(--text-secondary)" />
        </g>
        {/* Mean marker */}
        <Line.Segment point1={[mu, 0]} point2={[mu, normalPdf(mu, mu, sigma)]} color="var(--text-secondary)" style="dashed" opacity={0.55} />
        <g className="mafs-label mafs-label--axis-readout">
          <MafsLaTeX at={[mu, 0]} tex={`\\mu=${mu}`} color="var(--text-secondary)" />
        </g>
        {/* Keep the z-score and probability as compact, stacked readouts on narrow canvases. */}
        <MafsLaTeX at={[readoutX, yMax * 0.95]} tex={`z=${z.toFixed(2)}`} color="var(--accent-color)" />
        <MafsLaTeX at={[readoutX, yMax * 0.15]} tex={`P=${(area * 100).toFixed(1)}\\%`} color="var(--accent-color)" />
      </Mafs>
    </MafsStage>
  );
}

function LearnNormalVis({ mu, sigma, x, z, area, step = 0, mafsHeight, revealed }: NormalVisProps) {
  const xMin = mu - 4 * sigma;
  const xMax = mu + 4 * sigma;
  const yMax = normalPdf(mu, mu, sigma) * 1.3;
  const readoutX = x >= mu ? mu - 2.4 * sigma : mu + 2.4 * sigma;

  return (
    <MafsStage mafsHeight={mafsHeight} ariaLabel="Normal distribution learning visualization" interaction="static">
      <Mafs height={mafsHeight} viewBox={{ x: [xMin, xMax] as [number, number], y: [-yMax * 0.15, yMax] as [number, number] }} preserveAspectRatio={false} pan={false} zoom={false}>
        <Coordinates.Cartesian xAxis={{ lines: sigma }} yAxis={false} />
        <Plot.OfX y={(xv) => normalPdf(xv, mu, sigma)} color="var(--accent-color)" />
        {step !== 1 && (
          <>
            <Line.Segment point1={[x, 0]} point2={[x, normalPdf(x, mu, sigma)]} color="var(--text-secondary)" />
            <g className="mafs-label mafs-label--axis-readout mafs-label--offset-right">
              <MafsLaTeX at={[x, 0]} tex={`x=${x}`} color="var(--text-secondary)" />
            </g>
          </>
        )}
        {revealed && (
          <>
            {step === 1 ? (
              <>
                <Plot.Inequality
                  y={{
                    '<=': (xv: number) => (
                      xv >= mu - sigma && xv <= mu + sigma
                        ? normalPdf(xv, mu, sigma)
                        : 0
                    ),
                    '>=': () => 0,
                  }}
                  color="var(--accent-color)"
                />
                <Line.Segment point1={[mu - sigma, 0]} point2={[mu - sigma, normalPdf(mu - sigma, mu, sigma)]} color="var(--text-secondary)" />
                <Line.Segment point1={[mu + sigma, 0]} point2={[mu + sigma, normalPdf(mu + sigma, mu, sigma)]} color="var(--text-secondary)" />
                <MafsLaTeX at={[mu, yMax * 0.55]} tex="P\approx 68.3\%" color="var(--accent-color)" />
              </>
            ) : (
              <>
                <Plot.Inequality
                  y={{ '<=': (xv: number) => xv <= x ? normalPdf(xv, mu, sigma) : 0, '>=': () => 0 }}
                  color="var(--accent-color)"
                />
                <MafsLaTeX at={[readoutX, yMax * 0.95]} tex={`z=${z.toFixed(2)}`} color="var(--accent-color)" />
                <MafsLaTeX at={[readoutX, yMax * 0.15]} tex={`P=${(area * 100).toFixed(1)}\\%`} color="var(--accent-color)" />
              </>
            )}
          </>
        )}
        <g className="mafs-label mafs-label--axis-readout">
          <MafsLaTeX at={[mu, 0]} tex={`\\mu=${mu}`} color="var(--text-secondary)" />
        </g>
      </Mafs>
    </MafsStage>
  );
}

// ─── Probability Simulation Visualization ─────────────────────────────────────

interface ProbabilityVisProps {
  trials: number;
  successes: number;
  proportion?: number;
  p: number;
  mafsHeight: number;
  revealed?: boolean;
}

function ExploreProbabilityVis({ trials, successes, p, mafsHeight }: ProbabilityVisProps) {
  // Show a bar chart: successes vs failures
  const failures = trials - successes;
  const maxBar = Math.max(successes, failures, 1);

  return (
    <MafsStage mafsHeight={mafsHeight} ariaLabel={`Probability simulation bar chart. ${successes} successes out of ${trials} trials.`} interaction="explore">
      <Mafs height={mafsHeight} viewBox={{ x: [-1, 4] as [number, number], y: [-maxBar * 0.12, maxBar * 1.3] as [number, number] }} preserveAspectRatio={false} pan={true} zoom={{ min: 0.5, max: 4 }}>
        <Coordinates.Cartesian xAxis={{ lines: false, labels: false }} yAxis={{ lines: Math.max(1, Math.floor(maxBar / 5)) }} />
        {/* Success bar */}
        <Polygon points={[[0.2, 0], [1.3, 0], [1.3, successes], [0.2, successes]]} color="var(--success)" svgPolygonProps={{ fillOpacity: 0.5 }} />
        {/* "Success" is a plain language label — keep Text */}
        <Text x={0.75} y={-maxBar * 0.05} color="var(--success)" size={11}>Success</Text>
        <MafsLaTeX at={[0.75, successes + maxBar * 0.05]} tex={`${successes}`} color="var(--success)" />
        {/* Failure bar */}
        <Polygon points={[[1.7, 0], [2.8, 0], [2.8, failures], [1.7, failures]]} color="var(--error)" svgPolygonProps={{ fillOpacity: 0.5 }} />
        {/* "Failure" is a plain language label — keep Text */}
        <Text x={2.25} y={-maxBar * 0.05} color="var(--error)" size={11}>Failure</Text>
        <MafsLaTeX at={[2.25, failures + maxBar * 0.05]} tex={`${failures}`} color="var(--error)" />
        {/* Expected line */}
        <Line.Segment point1={[-0.5, trials * p]} point2={[3.5, trials * p]} color="var(--accent-color)" style="dashed" />
        <Text x={3.2} y={trials * p + maxBar * 0.05} color="var(--accent-color)" size={10}>Expected</Text>
      </Mafs>
    </MafsStage>
  );
}

function LearnProbabilityVis({ trials, successes, p, mafsHeight, revealed }: ProbabilityVisProps) {
  const failures = trials - successes;
  const maxBar = Math.max(successes, failures, 1);

  return (
    <MafsStage mafsHeight={mafsHeight} ariaLabel="Probability simulation learning visualization" interaction="static">
      <Mafs height={mafsHeight} viewBox={{ x: [-1, 4] as [number, number], y: [-maxBar * 0.12, maxBar * 1.3] as [number, number] }} preserveAspectRatio={false} pan={false} zoom={false}>
        <Coordinates.Cartesian xAxis={{ lines: false, labels: false }} yAxis={{ lines: Math.max(1, Math.floor(maxBar / 5)) }} />
        {revealed ? (
          <>
            <Polygon points={[[0.2, 0], [1.3, 0], [1.3, successes], [0.2, successes]]} color="var(--success)" svgPolygonProps={{ fillOpacity: 0.5 }} />
            <MafsLaTeX at={[0.75, successes + maxBar * 0.05]} tex={`${successes}`} color="var(--success)" />
            <Polygon points={[[1.7, 0], [2.8, 0], [2.8, failures], [1.7, failures]]} color="var(--error)" svgPolygonProps={{ fillOpacity: 0.5 }} />
            <MafsLaTeX at={[2.25, failures + maxBar * 0.05]} tex={`${failures}`} color="var(--error)" />
            <Line.Segment point1={[-0.5, trials * p]} point2={[3.5, trials * p]} color="var(--accent-color)" style="dashed" />
            {/* "Expected" is a plain language label — keep Text */}
            <Text x={3.2} y={trials * p + maxBar * 0.05} color="var(--accent-color)" size={10}>Expected</Text>
          </>
        ) : (
          /* "Results hidden until submit" is a plain instructional sentence — keep Text */
          <Text x={1.5} y={maxBar * 0.5} color="var(--text-secondary)" size={12}>
            Results hidden until submit
          </Text>
        )}
        {/* "Success" and "Failure" are plain language labels — keep Text */}
        <Text x={0.75} y={-maxBar * 0.05} color="var(--text-secondary)" size={11}>Success</Text>
        <Text x={2.25} y={-maxBar * 0.05} color="var(--text-secondary)" size={11}>Failure</Text>
      </Mafs>
    </MafsStage>
  );
}

// ─── Scatter & Regression Visualization ───────────────────────────────────────

interface ScatterVisProps {
  points: [number, number][];
  regression: { slope: number; intercept: number; r: number };
  mafsHeight: number;
  revealed?: boolean;
}

function ExploreScatterVis({ points, regression, mafsHeight }: ScatterVisProps) {
  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    if (points.length === 0) return { xMin: -1, xMax: 10, yMin: -1, yMax: 10 };
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const xLo = Math.min(...xs);
    const xHi = Math.max(...xs);
    const yLo = Math.min(...ys);
    const yHi = Math.max(...ys);
    const xPad = Math.max(1, (xHi - xLo) * 0.15);
    const yPad = Math.max(1, (yHi - yLo) * 0.15);
    return { xMin: xLo - xPad, xMax: xHi + xPad, yMin: yLo - yPad, yMax: yHi + yPad };
  }, [points]);

  return (
    <MafsStage mafsHeight={mafsHeight} ariaLabel={`Scatter plot with ${points.length} points. Regression: y = ${regression.slope.toFixed(2)}x + ${regression.intercept.toFixed(2)}, r = ${regression.r.toFixed(3)}`} interaction="explore">
      <Mafs height={mafsHeight} viewBox={{ x: [xMin, xMax] as [number, number], y: [yMin, yMax] as [number, number] }} pan={true} zoom={{ min: 0.5, max: 4 }}>
        <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: 1 }} />
        {/* Data points */}
        {points.map(([px, py], i) => (
          <Point key={i} x={px} y={py} color="var(--accent-color)" />
        ))}
        {/* Regression line */}
        {points.length >= 2 && (
          <Plot.OfX
            y={(x) => {
              const yVal = regression.slope * x + regression.intercept;
              return yVal > yMax + 5 || yVal < yMin - 5 ? NaN : yVal;
            }}
            color="var(--text-secondary)"
          />
        )}
        {/* r value — formula */}
        <MafsLaTeX at={[(xMin + xMax) / 2, yMax - (yMax - yMin) * 0.08]} tex={`r = ${regression.r.toFixed(3)}`} color="var(--text-secondary)" />
      </Mafs>
    </MafsStage>
  );
}

function LearnScatterVis({ points, regression, mafsHeight, revealed }: ScatterVisProps) {
  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    if (points.length === 0) return { xMin: -1, xMax: 10, yMin: -1, yMax: 10 };
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const xLo = Math.min(...xs);
    const xHi = Math.max(...xs);
    const yLo = Math.min(...ys);
    const yHi = Math.max(...ys);
    const xPad = Math.max(1, (xHi - xLo) * 0.15);
    const yPad = Math.max(1, (yHi - yLo) * 0.15);
    return { xMin: xLo - xPad, xMax: xHi + xPad, yMin: yLo - yPad, yMax: yHi + yPad };
  }, [points]);

  return (
    <MafsStage mafsHeight={mafsHeight} ariaLabel="Scatter plot learning visualization" interaction="static">
      <Mafs height={mafsHeight} viewBox={{ x: [xMin, xMax] as [number, number], y: [yMin, yMax] as [number, number] }} pan={false} zoom={false}>
        <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: 1 }} />
        {points.map(([px, py], i) => (
          <Point key={i} x={px} y={py} color="var(--accent-color)" />
        ))}
        {revealed && points.length >= 2 && (
          <>
            <Plot.OfX
              y={(x) => {
                const yVal = regression.slope * x + regression.intercept;
                return yVal > yMax + 5 || yVal < yMin - 5 ? NaN : yVal;
              }}
              color="var(--text-secondary)"
            />
            <MafsLaTeX at={[(xMin + xMax) / 2, yMax - (yMax - yMin) * 0.08]} tex={`y = ${regression.slope.toFixed(2)}x + ${regression.intercept.toFixed(2)},\\; r = ${regression.r.toFixed(3)}`} color="var(--text-secondary)" />
          </>
        )}
      </Mafs>
    </MafsStage>
  );
}

// ─── P5 S6-J: Box Plot Visualization ─────────────────────────────────────────

interface BoxPlotVisProps {
  data: number[];
  mafsHeight: number;
  revealed: boolean;
}

function LearnBoxPlotVis({ data, mafsHeight, revealed }: BoxPlotVisProps) {
  const summary = useMemo(() => fiveNumberSummary(data), [data]);
  const xMin = Math.min(summary.min - 2, 0);
  const xMax = summary.max + 2;

  return (
    <>
      <MafsStage mafsHeight={Math.min(mafsHeight, 240)} ariaLabel="Box plot learning visualization" interaction="static">
        <Mafs
          height={Math.min(mafsHeight, 240)}
          viewBox={{ x: [xMin, xMax] as [number, number], y: [-3, 3] as [number, number] }}
          pan={false}
          zoom={false}
        >
          <Coordinates.Cartesian xAxis={{ lines: 2 }} yAxis={false} />
          {/* Always show data points as dots */}
          {data.map((v, i) => (
            <Point key={i} x={v} y={-1.5} color="var(--accent-color)" />
          ))}
          {/* Box-and-whisker only after reveal */}
          {revealed && (
            <>
              {/* Whiskers */}
              <Line.Segment point1={[summary.min, 0]} point2={[summary.q1, 0]} color="var(--text-primary)" />
              <Line.Segment point1={[summary.q3, 0]} point2={[summary.max, 0]} color="var(--text-primary)" />
              {/* Box */}
              <Polygon
                points={[[summary.q1, -0.8], [summary.q3, -0.8], [summary.q3, 0.8], [summary.q1, 0.8]]}
                color="var(--accent-color)"
                svgPolygonProps={{ fillOpacity: 0.2 }}
              />
              {/* Median line */}
              <Line.Segment point1={[summary.median, -0.8]} point2={[summary.median, 0.8]} color="var(--success)" />
              {/* Labels — statistical quartile notation is mathematical */}
              <MafsLaTeX at={[summary.min, 1.0]} tex={`\\text{Min}=${summary.min}`} color="var(--text-secondary)" />
              <MafsLaTeX at={[summary.q1, 2.8]} tex={`Q_1=${summary.q1}`} color="var(--text-secondary)" />
              <MafsLaTeX at={[summary.median, 1.0]} tex={`\\text{Med}=${summary.median}`} color="var(--success)" />
              <MafsLaTeX at={[summary.q3, 2.8]} tex={`Q_3=${summary.q3}`} color="var(--text-secondary)" />
              <MafsLaTeX at={[summary.max, 1.0]} tex={`\\text{Max}=${summary.max}`} color="var(--text-secondary)" />
            </>
          )}
        </Mafs>
      </MafsStage>
      {revealed && (
        <div className="lab-visual-info glass-panel" aria-live="polite" style={{ padding: '10px 14px', fontSize: '13px' }}>
          Five-number summary: Min={summary.min}, Q1={summary.q1}, Median={summary.median}, Q3={summary.q3}, Max={summary.max} | IQR={summary.q3 - summary.q1}
        </div>
      )}
    </>
  );
}

// ─── P5 S6-J: Tree Diagram / Two-Way Table Visualization (DOM) ───────────────

interface TreeTwoWayVisProps {
  step: number;
  revealed: boolean;
  /** Event the tree step asks about; defaults to the authored "both red". */
  treeEvent?: TreeDiagramEvent;
}

const TREE_EVENT_WORKING: Record<TreeDiagramEvent, string> = {
  'both-red': 'P(both red) = 3/5 × 2/4 = 6/20 = 3/10',
  'both-blue': 'P(both blue) = 2/5 × 1/4 = 2/20 = 1/10',
  'exactly-one-red': 'P(exactly one red) = 6/20 + 6/20 = 12/20 = 3/5',
};

function LearnTreeTwoWayVis({ step, revealed, treeEvent = 'both-red' }: TreeTwoWayVisProps) {
  // Step 0: Tree diagram for marbles without replacement
  // Step 1: Two-way table
  // Step 2: Conditional probability from the table
  if (step === 0) {
    // Before submission the tree shows its structure and branch probabilities
    // only. The path products answer the question, so they stay hidden.
    const path = (label: string, product: string) => (revealed ? `${label} = ${product}` : label);
    return (
      <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h4 style={{ fontSize: '14px', fontWeight: 700, margin: 0 }}>Tree Diagram: Marbles without replacement</h4>
        <div data-testid="tree-diagram" style={{ fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8', whiteSpace: 'pre' }}>
{`         ┌─ R (2/4) → ${path('RR', '3/5 × 2/4 = 6/20')}
    R ───┤
   3/5   └─ B (2/4) → ${path('RB', '3/5 × 2/4 = 6/20')}
Start┤
   2/5   ┌─ R (3/4) → ${path('BR', '2/5 × 3/4 = 6/20')}
    B ───┤
         └─ B (1/4) → ${path('BB', '2/5 × 1/4 = 2/20')}`}
        </div>
        {revealed && (
          <div className="lab-visual-info" aria-live="polite" style={{ padding: '8px 12px', fontSize: '12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
            {TREE_EVENT_WORKING[treeEvent]}
          </div>
        )}
        {!revealed && (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            Multiply along the branches. The path probabilities appear after you submit your answer.
          </div>
        )}
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h4 style={{ fontSize: '14px', fontWeight: 700, margin: 0 }}>Two-Way Table</h4>
        <table data-testid="two-way-table" style={{ borderCollapse: 'collapse', fontSize: '13px', width: '100%', maxWidth: '320px' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}></th>
              <th style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>Music</th>
              <th style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>No Music</th>
              <th style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px', fontWeight: 600 }}>Sport</td>
              <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>15</td>
              <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{revealed ? '10' : '?'}</td>
              <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>25</td>
            </tr>
            <tr>
              <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px', fontWeight: 600 }}>No Sport</td>
              <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{revealed ? '5' : '?'}</td>
              <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{revealed ? '10' : '?'}</td>
              <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{revealed ? '15' : '?'}</td>
            </tr>
            <tr>
              <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px', fontWeight: 600 }}>Total</td>
              <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>20</td>
              <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{revealed ? '20' : '?'}</td>
              <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>40</td>
            </tr>
          </tbody>
        </table>
        {revealed && (
          <div className="lab-visual-info" aria-live="polite" style={{ padding: '8px 12px', fontSize: '12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
            Neither = 40 − (25 + 20 − 15) = 10
          </div>
        )}
      </div>
    );
  }

  // Step 2: Conditional probability
  return (
    <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h4 style={{ fontSize: '14px', fontWeight: 700, margin: 0 }}>Conditional Probability from Two-Way Table</h4>
      <table data-testid="two-way-table" style={{ borderCollapse: 'collapse', fontSize: '13px', width: '100%', maxWidth: '320px' }}>
        <thead>
          <tr>
            <th style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}></th>
            <th style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>Music</th>
            <th style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>No Music</th>
            <th style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: revealed ? 'var(--bg-secondary)' : 'transparent' }}>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px', fontWeight: 600 }}>Sport</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>15</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>10</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>25</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px', fontWeight: 600 }}>No Sport</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>5</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>10</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>15</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px', fontWeight: 600 }}>Total</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>20</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>20</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>40</td>
          </tr>
        </tbody>
      </table>
      {revealed && (
        <div className="lab-visual-info" aria-live="polite" style={{ padding: '8px 12px', fontSize: '12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
          P(Music | Sport) = 15/25 = 3/5 = 0.6
        </div>
      )}
      {!revealed && (
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
          Focus on the Sport row. Submit your answer to see the conditional probability.
        </div>
      )}
    </div>
  );
}

// ─── Explore Box Plot Visualization ───────────────────────────────────────────

interface ExploreBoxPlotVisProps {
  data: number[];
  summary: { min: number; q1: number; median: number; q3: number; max: number };
  mafsHeight: number;
}

function ExploreBoxPlotVis({ data, summary, mafsHeight }: ExploreBoxPlotVisProps) {
  const xMin = Math.min(summary.min - 2, 0);
  const xMax = summary.max + 2;

  return (
    <div data-testid="box-plot-explore-vis">
      <MafsStage mafsHeight={Math.min(mafsHeight, 280)} ariaLabel={`Box plot visualization with ${data.length} data points. Min=${summary.min}, Q1=${summary.q1}, Median=${summary.median}, Q3=${summary.q3}, Max=${summary.max}`} interaction="explore">
        <Mafs
          height={Math.min(mafsHeight, 280)}
          viewBox={{ x: [xMin, xMax] as [number, number], y: [-3, 3] as [number, number] }}
          pan={true}
          zoom={{ min: 0.5, max: 4 }}
        >
          <Coordinates.Cartesian xAxis={{ lines: 2 }} yAxis={false} />
          {/* Data points as dots below the box */}
          {data.map((v, i) => (
            <Point key={i} x={v} y={-2} color="var(--accent-color)" />
          ))}
          {/* Whiskers */}
          <Line.Segment point1={[summary.min, 0]} point2={[summary.q1, 0]} color="var(--text-primary)" />
          <Line.Segment point1={[summary.q3, 0]} point2={[summary.max, 0]} color="var(--text-primary)" />
          {/* Box */}
          <Polygon
            points={[[summary.q1, -0.8], [summary.q3, -0.8], [summary.q3, 0.8], [summary.q1, 0.8]]}
            color="var(--accent-color)"
            svgPolygonProps={{ fillOpacity: 0.2 }}
          />
          {/* Median line */}
          <Line.Segment point1={[summary.median, -0.8]} point2={[summary.median, 0.8]} color="var(--success)" />
          {/* Min/Max end caps */}
          <Line.Segment point1={[summary.min, -0.4]} point2={[summary.min, 0.4]} color="var(--text-primary)" />
          <Line.Segment point1={[summary.max, -0.4]} point2={[summary.max, 0.4]} color="var(--text-primary)" />
          {/* Labels */}
          <Text x={summary.min} y={1.3} color="var(--text-secondary)" size={10}>Min</Text>
          <Text x={summary.q1} y={1.3} color="var(--text-secondary)" size={10}>Q1</Text>
          <Text x={summary.median} y={1.5} color="var(--success)" size={10}>Med</Text>
          <Text x={summary.q3} y={1.3} color="var(--text-secondary)" size={10}>Q3</Text>
          <Text x={summary.max} y={1.3} color="var(--text-secondary)" size={10}>Max</Text>
        </Mafs>
      </MafsStage>
    </div>
  );
}

// ─── Explore Tree/Two-Way Visualization (DOM) ─────────────────────────────────

interface ExploreTreeTwoWayVisProps {
  scene: 'tree' | 'table';
  redCount: number;
  blueCount: number;
  sportMusic: number;
  sportTotal: number;
  musicTotal: number;
  grandTotal: number;
  neither: number;
  prob: number;
}

function ExploreTreeTwoWayVis({
  scene,
  redCount,
  blueCount,
  sportMusic,
  sportTotal,
  musicTotal,
  grandTotal,
  neither,
  prob,
}: ExploreTreeTwoWayVisProps) {
  const total = redCount + blueCount;
  const pFirstRed = redCount / total;
  const pSecondRedGivenRed = total > 1 ? (redCount - 1) / (total - 1) : 0;

  if (scene === 'tree') {
    // Derive all branch probabilities
    const pFirstBlue = blueCount / total;
    const pSecondBlueGivenRed = total > 1 ? blueCount / (total - 1) : 0;
    const pSecondRedGivenBlue = total > 1 ? redCount / (total - 1) : 0;
    const pSecondBlueGivenBlue = total > 1 ? (blueCount - 1) / (total - 1) : 0;

    return (
      <div data-testid="tree-explore-vis" className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h4 style={{ fontSize: '14px', fontWeight: 700, margin: 0 }}>Tree Diagram: {redCount} red, {blueCount} blue — without replacement</h4>
        <div data-testid="tree-diagram-explore" role="img" aria-label={`Tree diagram showing probability ${prob.toFixed(4)} of drawing two red marbles`} style={{ fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8', whiteSpace: 'pre', overflowX: 'auto' }}>
{`         ┌─ R (${redCount - 1}/${total - 1}) → RR = ${pFirstRed.toFixed(3)} × ${pSecondRedGivenRed.toFixed(3)} = ${prob.toFixed(4)}
    R ───┤
  ${redCount}/${total}   └─ B (${blueCount}/${total - 1}) → RB = ${pFirstRed.toFixed(3)} × ${pSecondBlueGivenRed.toFixed(3)} = ${(pFirstRed * pSecondBlueGivenRed).toFixed(4)}
Start┤
  ${blueCount}/${total}   ┌─ R (${redCount}/${total - 1}) → BR = ${pFirstBlue.toFixed(3)} × ${pSecondRedGivenBlue.toFixed(3)} = ${(pFirstBlue * pSecondRedGivenBlue).toFixed(4)}
    B ───┤
         └─ B (${blueCount - 1}/${total - 1}) → BB = ${pFirstBlue.toFixed(3)} × ${pSecondBlueGivenBlue.toFixed(3)} = ${(pFirstBlue * pSecondBlueGivenBlue).toFixed(4)}`}
        </div>
        <div aria-live="polite" style={{ padding: '8px 12px', fontSize: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          P(both red) = {redCount}/{total} × {redCount - 1}/{total - 1} = {prob.toFixed(4)}
        </div>
      </div>
    );
  }

  // Two-way table scene
  const sportOnly = sportTotal - sportMusic;
  const musicOnly = musicTotal - sportMusic;
  const noSport = grandTotal - sportTotal;

  return (
    <div data-testid="table-explore-vis" className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h4 style={{ fontSize: '14px', fontWeight: 700, margin: 0 }}>Two-Way Table</h4>
      <table data-testid="two-way-table-explore" aria-label="Two-way frequency table for Sport and Music" style={{ borderCollapse: 'collapse', fontSize: '13px', width: '100%', maxWidth: '360px' }}>
        <thead>
          <tr>
            <th style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}></th>
            <th style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>Music</th>
            <th style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>No Music</th>
            <th style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px', fontWeight: 600 }}>Sport</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{sportMusic}</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{sportOnly}</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{sportTotal}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px', fontWeight: 600 }}>No Sport</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{musicOnly}</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{neither}</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{noSport}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px', fontWeight: 600 }}>Total</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{musicTotal}</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{grandTotal - musicTotal}</td>
            <td style={{ border: '1px solid var(--border-color)', padding: '6px 10px' }}>{grandTotal}</td>
          </tr>
        </tbody>
      </table>
      <div aria-live="polite" style={{ padding: '8px 12px', fontSize: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
        <div>Union = {sportTotal} + {musicTotal} − {sportMusic} = {sportTotal + musicTotal - sportMusic}</div>
        <div>Neither = {grandTotal} − {sportTotal + musicTotal - sportMusic} = {neither}</div>
        {sportTotal > 0 && <div>P(Music | Sport) = {sportMusic}/{sportTotal} = {(sportMusic / sportTotal).toFixed(4)}</div>}
      </div>
    </div>
  );
}
