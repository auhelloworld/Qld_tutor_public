'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { Mafs, Coordinates, Plot, Line, LaTeX as MafsLaTeX } from 'mafs';
import MafsStage from './MafsStage';
import LearnPanel from './LearnPanel';
import { useLabVariant } from '../../lib/use-lab-variant';
import LabSceneLayout from './LabSceneLayout';
import LabControlCard from './LabControlCard';
import LabSliderInput from './LabSliderInput';
import type { LabActivityMeta } from '../../lib/lab-activities';
import { LAB_RENDER_LIMITS } from '../../lib/lab-performance';

// ─── Exported math helpers (testable) ───────────────────────────────────

export type PolarPreset = 'cardioid' | 'spiral' | 'lemniscate';

/** Evaluate r(θ) for a polar curve preset. */
export function evaluatePolarR(preset: PolarPreset, theta: number, a: number): number {
  switch (preset) {
    case 'cardioid':
      return a * (1 + Math.cos(theta));
    case 'spiral':
      return a * theta / (2 * Math.PI);
    case 'lemniscate': {
      // Bernoulli's lemniscate: r² = a² cos(2θ). The two real branches
      // are rendered separately below, so invalid angles are not connected.
      const cosine = Math.cos(2 * theta);
      return cosine >= 0 ? a * Math.sqrt(cosine) : Number.NaN;
    }
  }
}

/** Convert polar (r, θ) to Cartesian [x, y]. */
export function polarToCartesian(r: number, theta: number): [number, number] {
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

/** Standard parametric presets returning [x, y] for parameter t. */
export function evaluateParametric(
  preset: 'circle' | 'line' | 'ellipse',
  t: number,
  a: number,
  b: number,
): [number, number] {
  switch (preset) {
    case 'circle':
      return [a * Math.cos(t), a * Math.sin(t)];
    case 'line':
      return [a * t, b * t];
    case 'ellipse':
      return [a * Math.cos(t), b * Math.sin(t)];
  }
}

// ─── Props ───────────────────────────────────────────────────────────────

interface AdvancedCurvesLabProps {
  activity: LabActivityMeta;
  mafsHeight: number;
  mode?: 'explore' | 'learn';
  onComplete: (activityId: string, success: boolean) => void;
  onExit: () => void;
  topicSelector?: React.ReactNode;
}

// ─── Component ───────────────────────────────────────────────────────────

export default function AdvancedCurvesLab({
  activity,
  mafsHeight,
  mode = 'learn',
  onComplete,
  onExit,
  topicSelector,
}: AdvancedCurvesLabProps) {
  const [learnRevealed, setLearnRevealed] = useState(false);
  const [learnStep, setLearnStep] = useState(0);

  // Explore lists one button per graded example. The unlockable extension step
  // is not an example, and including it produced a fourth button in a
  // three-column grid that repeated an earlier picture.
  const exploreExampleSteps = activity.steps.filter((step) => step.tier !== 'extension');
  const variant = useLabVariant(activity.id);
  const showResults = mode === 'explore' || learnRevealed;

  // Parameter controls
  const [polarA, setPolarA] = useState(2);
  const [paramT, setParamT] = useState(Math.PI / 2);

  const isPolar = activity.id === 'sandbox-polar-curves';

  // ─── Polar curve rendering ────────────────────────────────────────────

  // A variant supplies the preset and amplitude the prompt states; the step-based
  // literals are the authored fallback.
  const curveScene = variant.getSceneData(learnStep);
  const generatedCurve = curveScene && curveScene.kind === 'curve-preset' ? curveScene : null;

  React.useEffect(() => {
    if (generatedCurve && generatedCurve.family === 'polar') {
      setPolarA(generatedCurve.a);
    }
  }, [generatedCurve]);

  const polarPreset = useMemo((): PolarPreset => {
    if (generatedCurve && generatedCurve.family === 'polar') {
      return generatedCurve.preset as PolarPreset;
    }
    if (learnStep === 0) return 'cardioid';
    if (learnStep === 1) return 'spiral';
    return 'lemniscate';
  }, [generatedCurve, learnStep]);

  const polarCurveDomains = useMemo((): [number, number][] => {
    if (polarPreset === 'lemniscate') {
      return [
        [-Math.PI / 4, Math.PI / 4],
        [3 * Math.PI / 4, 5 * Math.PI / 4],
      ];
    }
    return [[0, 2 * Math.PI]];
  }, [polarPreset]);

  const polarTraceTheta = polarPreset === 'lemniscate' ? 0 : Math.PI / 2;

  const polarXY = useCallback(
    (t: number): [number, number] => {
      const r = evaluatePolarR(polarPreset, t, polarA);
      return polarToCartesian(r, t);
    },
    [polarPreset, polarA],
  );

  // ─── Parametric curve rendering ───────────────────────────────────────

  const paramPreset = useMemo((): 'circle' | 'line' | 'ellipse' => {
    if (generatedCurve && generatedCurve.family === 'parametric') {
      return generatedCurve.preset as 'circle' | 'line' | 'ellipse';
    }
    if (learnStep === 0) return 'circle';
    if (learnStep === 1) return 'line';
    return 'circle';
  }, [generatedCurve, learnStep]);

  const paramA = useMemo(() => {
    if (generatedCurve && generatedCurve.family === 'parametric') return generatedCurve.a;
    if (paramPreset === 'line') return 2;
    return 1; // unit circle
  }, [generatedCurve, paramPreset]);
  const paramB = useMemo(() => {
    if (generatedCurve && generatedCurve.family === 'parametric') return generatedCurve.b ?? 1;
    if (paramPreset === 'line') return 1;
    return 1;
  }, [generatedCurve, paramPreset]);

  const parametricXY = useCallback(
    (t: number): [number, number] => evaluateParametric(paramPreset, t, paramA, paramB),
    [paramPreset, paramA, paramB],
  );

  // Current parametric point for the trace marker
  const currentPoint = useMemo((): [number, number] => {
    if (isPolar) return polarXY(polarTraceTheta);
    return parametricXY(paramT);
  }, [isPolar, polarTraceTheta, polarXY, parametricXY, paramT]);

  const currentPolarRadius = isPolar
    ? evaluatePolarR(polarPreset, polarTraceTheta, polarA)
    : Number.NaN;

  // Reset param on step change
  const handleStepChange = useCallback((step: number) => {
    setLearnStep(step);
    setLearnRevealed(false);
    setParamT(Math.PI / 2);
  }, []);

  const handleRevealChange = useCallback((revealed: boolean) => {
    setLearnRevealed(revealed);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <LabSceneLayout
      control={
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {mode === 'learn' ? (
          <LearnPanel
            key={activity.id}
            activity={activity}
            onComplete={onComplete}
            onExit={onExit}
            onRevealChange={handleRevealChange}
            onStepChange={handleStepChange}
            {...variant.learnPanelProps}
          />
        ) : (
          <div className="glass-panel" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {topicSelector && <div className="lab-topic-selector">{topicSelector}</div>}
            <div>
              <h2 style={{ margin: 0, fontSize: '18px' }}>{activity.title}</h2>
              <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
                {activity.objective}
              </p>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>Curve preset</legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {exploreExampleSteps.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    aria-pressed={learnStep === index}
                    onClick={() => handleStepChange(index)}
                    style={{
                      padding: '8px 4px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      background: learnStep === index ? 'var(--accent-color)' : 'var(--bg-secondary)',
                      color: learnStep === index ? 'white' : 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '11px',
                    }}
                  >
                    {isPolar
                      ? ['Cardioid', 'Archimedean spiral', 'Lemniscate'][index]
                      : ['Circle', 'Line', 'Trace'][index]}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        {/* Parameter control */}
        <LabControlCard compact>
          {isPolar ? (
            <LabSliderInput
              id="polar-a"
              label="Scale parameter a"
              ariaLabel="Polar scale parameter a"
              value={polarA}
              min={0.5}
              max={2}
              step={0.1}
              onChange={setPolarA}
            />
          ) : (
            <LabSliderInput
              id="param-t"
              label="Parameter t"
              ariaLabel="Parametric t parameter"
              value={paramT}
              min={0}
              max={2 * Math.PI}
              step={0.05}
              onChange={setParamT}
              valueSuffix=" rad"
              decimals={2}
            />
          )}

          {/* Answer overlay — hidden until submit */}
          {showResults && (
            <div
              aria-live="polite"
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                padding: '8px',
                borderRadius: '6px',
                background: 'rgba(99,102,241,0.04)',
                border: '1px solid rgba(99,102,241,0.1)',
              }}
            >
              {isPolar && (
                <>
                  <div>
                    Model:{' '}
                    <code>
                      {polarPreset === 'cardioid' && 'r = a(1 + cos θ)'}
                      {polarPreset === 'spiral' && 'r = aθ/(2π)'}
                      {polarPreset === 'lemniscate' && 'r² = a² cos(2θ)'}
                    </code>
                  </div>
                  <div>
                    At θ = {polarTraceTheta.toFixed(2)}: r = {currentPolarRadius.toFixed(2)}; Cartesian point = ({currentPoint[0].toFixed(2)}, {currentPoint[1].toFixed(2)})
                  </div>
                  {polarPreset === 'cardioid' && ' — cardioid with a cusp at the pole'}
                  {polarPreset === 'spiral' && ' — one-turn Archimedean spiral'}
                  {polarPreset === 'lemniscate' && ' — two-loop Bernoulli lemniscate'}
                </>
              )}
              {!isPolar && (
                <>
                  At t = {paramT.toFixed(2)}: ({currentPoint[0].toFixed(2)}, {currentPoint[1].toFixed(2)})
                  {paramPreset === 'circle' && ' — unit circle'}
                  {paramPreset === 'line' && ' — straight line, dy/dx = 1/2'}
                </>
              )}
            </div>
          )}
        </LabControlCard>
      </div>
      }
      visual={
      <>
        <MafsStage
          mafsHeight={mafsHeight}
          ariaLabel={isPolar ? 'Polar coordinate grid with angle labels and polar curve visualization' : 'Parametric curve visualization'}
          interaction={mode === 'explore' ? 'explore' : 'static'}
        >
          <Mafs
            height={mafsHeight}
            viewBox={{ x: [-4.5, 4.5] as [number, number], y: [-4.5, 4.5] as [number, number] }}
            pan={mode === 'explore'}
            zoom={mode === 'explore' ? { min: 0.5, max: 4 } : false}
          >
            {isPolar ? (
              <>
                <Coordinates.Polar xAxis={false} yAxis={false} lines={1} subdivisions={4} />
                <MafsLaTeX at={[3.45, 0.2]} tex="0" color="var(--text-secondary)" />
                <MafsLaTeX at={[2.45, 2.45]} tex="\frac{\pi}{4}" color="var(--text-secondary)" />
                <MafsLaTeX at={[0.25, 3.45]} tex="\frac{\pi}{2}" color="var(--text-secondary)" />
                <MafsLaTeX at={[-2.45, 2.45]} tex="\frac{3\pi}{4}" color="var(--text-secondary)" />
                <MafsLaTeX at={[-3.45, 0.2]} tex="\pi" color="var(--text-secondary)" />
                <MafsLaTeX at={[-2.45, -2.45]} tex="\frac{5\pi}{4}" color="var(--text-secondary)" />
                <MafsLaTeX at={[0.25, -3.45]} tex="\frac{3\pi}{2}" color="var(--text-secondary)" />
                <MafsLaTeX at={[2.45, -2.45]} tex="\frac{7\pi}{4}" color="var(--text-secondary)" />
              </>
            ) : (
              <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: 1 }} subdivisions={2} />
            )}

            {/* Main curve is an answer-bearing layer in Learn mode. */}
            {showResults && isPolar && polarCurveDomains.map(([domainStart, domainEnd], index) => (
              <Plot.Parametric
                key={`polar-branch-${index}`}
                xy={polarXY}
                domain={[domainStart, domainEnd]}
                color="var(--accent-color)"
                weight={3}
                maxSamplingDepth={LAB_RENDER_LIMITS.curveSamplingDepth}
              />
            ))}
            {showResults && !isPolar && (
              <Plot.Parametric
                xy={parametricXY}
                domain={[0, 2 * Math.PI]}
                color="var(--accent-color)"
                weight={3}
                maxSamplingDepth={LAB_RENDER_LIMITS.curveSamplingDepth}
              />
            )}

            {/* Trace marker — hidden until submit */}
            {showResults && (
              <>
                <Line.Segment
                  point1={[0, 0]}
                  point2={currentPoint}
                  color="var(--text-secondary)"
                  style="dashed"
                  weight={1}
                />
                {!isPolar && (
                  <MafsLaTeX
                    at={[currentPoint[0] + 0.3, currentPoint[1] + 0.3]}
                    tex={`(${currentPoint[0].toFixed(2)},\\,${currentPoint[1].toFixed(2)})`}
                    color="var(--text-secondary)"
                  />
                )}
              </>
            )}
          </Mafs>
        </MafsStage>
      </>
      }
    />
  );
}
