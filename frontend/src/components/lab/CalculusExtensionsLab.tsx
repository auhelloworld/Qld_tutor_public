'use client';

import React, { useMemo, useState, useCallback, useEffect} from 'react';
import { Mafs, Coordinates, Plot, Line, LaTeX as MafsLaTeX } from 'mafs';
import MafsStage from './MafsStage';
import LearnPanel from './LearnPanel';
import LabSceneLayout from './LabSceneLayout';
import LabControlCard from './LabControlCard';
import LabSliderInput from './LabSliderInput';
import type { LabActivityMeta } from '../../lib/lab-activities';
import { clampInteger, LAB_RENDER_LIMITS } from '../../lib/lab-performance';
import { useLabVariant } from '../../lib/use-lab-variant';

// ─── Exported math helpers (testable) ───────────────────────────────────

/** Normalize a direction field vector to unit length for uniform display. */
export function normalizeFieldVector(vx: number, vy: number): [number, number] {
  const mag = Math.sqrt(vx * vx + vy * vy);
  if (mag < 1e-12) return [0, 0];
  return [vx / mag, vy / mag];
}

/** Compute direction field segment endpoints for dy/dx = slopeFn(x, y). */
export function computeDirectionFieldSegments(
  slopeFn: (x: number, y: number) => number,
  gridSize: number,
  xRange: [number, number],
  yRange: [number, number],
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const cappedGrid = clampInteger(
    gridSize,
    2,
    LAB_RENDER_LIMITS.directionFieldGrid,
  );
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const dx = (xRange[1] - xRange[0]) / (cappedGrid - 1);
  const dy = (yRange[1] - yRange[0]) / (cappedGrid - 1);
  const halfLen = Math.min(dx, dy) * 0.4;

  for (let i = 0; i < cappedGrid; i++) {
    for (let j = 0; j < cappedGrid; j++) {
      const x = xRange[0] + i * dx;
      const y = yRange[0] + j * dy;
      const slope = slopeFn(x, y);
      if (!Number.isFinite(slope)) continue;
      const angle = Math.atan(slope);
      const cos = Math.cos(angle) * halfLen;
      const sin = Math.sin(angle) * halfLen;
      segments.push({
        x1: x - cos,
        y1: y - sin,
        x2: x + cos,
        y2: y + sin,
      });
    }
  }
  return segments;
}

/** Newton's method iterations for f(x) = x² - k, f'(x) = 2x. Defaults: k=2, x0=1. */
export function newtonIterations(x0: number, maxIter: number, k: number = 2): number[] {
  const cap = clampInteger(maxIter, 0, LAB_RENDER_LIMITS.numericalIterations);
  const result: number[] = [x0];
  let x = x0;
  for (let i = 0; i < cap; i++) {
    const fx = x * x - k;
    const fpx = 2 * x;
    if (Math.abs(fpx) < 1e-12) break;
    x = x - fx / fpx;
    result.push(x);
    if (Math.abs(fx) < 1e-14) break;
  }
  return result;
}

/**
 * Put Newton iterate labels in dedicated lanes below the whole parabola.
 * Since f(x) = x² − k is never below −k, these y-coordinates cannot be
 * crossed by the curve, unlike the old fixed −0.45/−1.05 positions.
 */
export function newtonLabelPosition(xn: number, index: number, k: number): [number, number] {
  const lane = index % 2;
  return [xn, -Math.abs(k) - 0.5 - lane * 0.35];
}

/** Trapezoidal rule for f(x) = x² on [a, b]. Defaults: a=0, b=1. */
export function trapezoidalEstimate(n: number, intervalStart: number = 0, intervalEnd: number = 1): number {
  const cap = clampInteger(n, 1, LAB_RENDER_LIMITS.numericalIterations);
  const width = intervalEnd - intervalStart;
  const h = width / cap;
  let sum = 0;
  for (let i = 0; i < cap; i++) {
    const x0 = intervalStart + i * h;
    const x1 = intervalStart + (i + 1) * h;
    sum += (x0 * x0 + x1 * x1) * h / 2;
  }
  return sum;
}

export interface KinematicsExample {
  title: string;
  equations: string;
  position: (t: number) => number;
  velocity: (t: number) => number;
  acceleration: (t: number) => number;
  positionRange: [number, number];
  velocityRange: [number, number];
  accelerationRange: [number, number];
  positionLines: number;
  velocityLines: number;
  accelerationLines: number;
}

/** Distinct Explore models; Learn intentionally stays on the authored s(t)=t² example. */
export const KINEMATICS_EXAMPLES: readonly KinematicsExample[] = [
  {
    title: 'Constant acceleration',
    equations: 's(t) = t²,  v(t) = 2t,  a(t) = 2',
    position: (t) => t * t,
    velocity: (t) => 2 * t,
    acceleration: () => 2,
    positionRange: [-1, 18],
    velocityRange: [-1, 11],
    accelerationRange: [-1, 4],
    positionLines: 4,
    velocityLines: 2,
    accelerationLines: 1,
  },
  {
    title: 'Constant velocity',
    equations: 's(t) = 3t + 1,  v(t) = 3,  a(t) = 0',
    position: (t) => 3 * t + 1,
    velocity: () => 3,
    acceleration: () => 0,
    positionRange: [-1, 16],
    velocityRange: [-1, 5],
    accelerationRange: [-1, 2],
    positionLines: 4,
    velocityLines: 1,
    accelerationLines: 1,
  },
  {
    title: 'Direction reversal',
    equations: 's(t) = t(t − 3)²,  v(t) = 3t² − 12t + 9,  a(t) = 6t − 12',
    position: (t) => t * (t - 3) * (t - 3),
    velocity: (t) => 3 * t * t - 12 * t + 9,
    acceleration: (t) => 6 * t - 12,
    positionRange: [-1, 6],
    velocityRange: [-4, 10],
    accelerationRange: [-13, 13],
    positionLines: 1,
    velocityLines: 2,
    accelerationLines: 4,
  },
];

export function kinematicsValues(
  t: number,
  exampleIndex: number = 0,
): { s: number; v: number; a: number } {
  const example = KINEMATICS_EXAMPLES[exampleIndex] ?? KINEMATICS_EXAMPLES[0];
  return {
    s: example.position(t),
    v: example.velocity(t),
    a: example.acceleration(t),
  };
}

// ─── Props ───────────────────────────────────────────────────────────────

interface CalculusExtensionsLabProps {
  activity: LabActivityMeta;
  mafsHeight: number;
  mode?: 'explore' | 'learn';
  onComplete: (activityId: string, success: boolean) => void;
  onExit: () => void;
  topicSelector?: React.ReactNode;
}

// ─── Component ───────────────────────────────────────────────────────────

export default function CalculusExtensionsLab({
  activity,
  mafsHeight,
  mode = 'learn',
  onComplete,
  onExit,
  topicSelector,
}: CalculusExtensionsLabProps) {
  const [learnRevealed, setLearnRevealed] = useState(false);
  const [learnStep, setLearnStep] = useState(0);

  // Explore lists one button per graded example. The unlockable extension step
  // is not an example, and including it produced a fourth button in a
  // three-column grid that repeated an earlier picture.
  const exploreExampleSteps = activity.steps.filter((step) => step.tier !== 'extension');
  const showResults = mode === 'explore' || learnRevealed;
  const variant = useLabVariant(activity.id);

  // Direction field controls
  const [dfGridSize] = useState(LAB_RENDER_LIMITS.directionFieldGrid);

  // Kinematics control
  const [kinT, setKinT] = useState(1);

  // Numerical methods controls
  const [newtonIters, setNewtonIters] = useState(3);
  const [trapN, setTrapN] = useState(4);

  const isDirectionField = activity.id === 'calculus-direction-field';
  const isKinematics = activity.id === 'calculus-kinematics-links';
  const isNumerical = activity.id === 'calculus-numerical-methods';

  // ─── Direction field ──────────────────────────────────────────────────

  // A variant supplies the carrying capacity the prompt states; 4 is the
  // authored fallback.
  const learnScene = variant.getSceneData(learnStep);
  const dfCarryingCapacity =
    learnScene && learnScene.kind === 'direction-field' ? learnScene.carryingCapacity : 4;

  const dfSlopeFn = useCallback(
    (_x: number, y: number): number => {
      // dy/dx = y for steps 0-1; logistic P(1 - P/K) for step 2
      if (learnStep < 2) return y;
      return y * (1 - y / dfCarryingCapacity);
    },
    [learnStep, dfCarryingCapacity],
  );

  // Compute step size for Plot.VectorField from the render limit and viewBox range
  const dfVectorFieldStep = useMemo(() => {
    const range = 6; // viewBox is [-3, 3], so total width = 6
    return range / (LAB_RENDER_LIMITS.directionFieldGrid - 1);
  }, []);

  // VectorField xy function: returns a normalized direction vector at each point
  const dfVectorFieldXY = useCallback(
    (point: [number, number]): [number, number] => {
      const slope = dfSlopeFn(point[0], point[1]);
      if (!Number.isFinite(slope)) return [0, 0];
      return normalizeFieldVector(1, slope);
    },
    [dfSlopeFn],
  );

  // Keep legacy segment computation for render-budget tests (exported)
  const dirFieldSegments = useMemo(
    () =>
      isDirectionField
        ? computeDirectionFieldSegments(dfSlopeFn, dfGridSize, [-3, 3], [-3, 3])
        : [],
    [isDirectionField, dfSlopeFn, dfGridSize],
  );

  // Solution curve for dy/dx = y is y = e^x passing through (0,1)
  const solutionCurveXY = useCallback(
    (t: number): [number, number] => {
      if (learnStep < 2) {
        // y = e^x (passes through (0,1))
        return [t, Math.exp(t)];
      }
      // Logistic solution y = 4/(1 + e^{-t}) — approaches equilibrium at 4
      return [t, 4 / (1 + Math.exp(-t))];
    },
    [learnStep],
  );

  // ─── Kinematics ──────────────────────────────────────────────────────

  const kinExampleIndex =
    learnScene && learnScene.kind === 'kinematics'
      ? learnScene.exampleIndex
      : mode === 'explore'
        ? learnStep
        : 0;
  const kinExample = KINEMATICS_EXAMPLES[kinExampleIndex] ?? KINEMATICS_EXAMPLES[0];
  const kinValues = useMemo(
    () => kinematicsValues(kinT, kinExampleIndex),
    [kinT, kinExampleIndex],
  );
  const kinGraphHeight = Math.max(180, Math.round(mafsHeight / 3));
  const labelY = useCallback((value: number, range: [number, number]) => {
    const padding = (range[1] - range[0]) * 0.08;
    const shifted = value + (value < 0 ? -padding : padding);
    return Math.max(range[0] + padding, Math.min(range[1] - padding, shifted));
  }, []);

  // ─── Numerical methods ────────────────────────────────────────────────

  // Which numerical picture this step needs comes from the step's own scene data
  // (variant first, then the authored step), never from the step index: the
  // extension step asks about Newton again, so an index rule showed the wrong
  // diagram and made three of the four steps look identical.
  const numericalSceneData = variant.getSceneData(learnStep) ?? activity.steps[learnStep]?.sceneData;
  const showsNewton = numericalSceneData?.kind === 'numerical-newton';
  const newtonK = (numericalSceneData && numericalSceneData.kind === 'numerical-newton') ? numericalSceneData.k : 2;
  const newtonX0 = (numericalSceneData && numericalSceneData.kind === 'numerical-newton') ? numericalSceneData.x0 : 1;
  const trapStart = (numericalSceneData && numericalSceneData.kind === 'numerical-trapezoid') ? numericalSceneData.intervalStart : 0;
  const trapEnd = (numericalSceneData && numericalSceneData.kind === 'numerical-trapezoid') ? numericalSceneData.intervalEnd : 1;
  const scenePartitions =
    numericalSceneData && numericalSceneData.kind === 'numerical-trapezoid'
      ? numericalSceneData.partitions
      : undefined;

  // Keep the strip-count slider in step with the scene, so the coarse and fine
  // partitions the two trapezoid steps describe are actually drawn differently.
  useEffect(() => {
    if (scenePartitions !== undefined) setTrapN(scenePartitions);
  }, [scenePartitions]);

  const newtonPts = useMemo(
    () => (isNumerical && showsNewton ? newtonIterations(newtonX0, newtonIters, newtonK) : []),
    [isNumerical, showsNewton, newtonIters, newtonK, newtonX0],
  );

  const trapEstimate = useMemo(
    () => (isNumerical && !showsNewton ? trapezoidalEstimate(trapN, trapStart, trapEnd) : 0),
    [isNumerical, showsNewton, trapN, trapStart, trapEnd],
  );

  const trapExact = useMemo(
    () => (trapEnd ** 3 - trapStart ** 3) / 3,
    [trapStart, trapEnd],
  );

  // ─── Handlers ─────────────────────────────────────────────────────────

  const handleStepChange = useCallback((step: number) => {
    setLearnStep(step);
    setLearnRevealed(false);
  }, []);

  const handleRevealChange = useCallback((revealed: boolean) => {
    setLearnRevealed(revealed);
  }, []);

  const activityPanel = mode === 'learn' ? (
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
      {topicSelector && <div className="lab-topic-selector">{topicSelector}</div>
      }
      <div>
        <h2 style={{ margin: 0, fontSize: '18px' }}>{activity.title}</h2>
        <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
          {activity.objective}
        </p>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>Example</legend>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
          {exploreExampleSteps.map((_, index) => (
            <button
              key={index}
              type="button"
              aria-pressed={learnStep === index}
              aria-label={isKinematics && mode === 'explore'
                ? `Example ${index + 1}: ${KINEMATICS_EXAMPLES[index]?.title ?? ''}`
                : `Example ${index + 1}`}
              onClick={() => handleStepChange(index)}
              style={{
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: learnStep === index ? 'var(--accent-color)' : 'var(--bg-secondary)',
                color: learnStep === index ? 'white' : 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );

  // ─── Render: Direction Field ──────────────────────────────────────────

  if (isDirectionField) {
    return (
      <LabSceneLayout
        control={activityPanel}
        visual={
        <>
          <MafsStage mafsHeight={mafsHeight} ariaLabel="Direction field visualization" interaction={mode === 'explore' ? 'explore' : 'static'}>
            <Mafs
              height={mafsHeight}
              viewBox={{ x: [-3, 3] as [number, number], y: [-3, 3] as [number, number] }}
              pan={mode === 'explore'}
              zoom={mode === 'explore' ? { min: 0.5, max: 4 } : false}
            >
              <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: 1 }} subdivisions={2} />

              {/* Direction field via Mafs native VectorField */}
              <Plot.VectorField
                xy={dfVectorFieldXY}
                step={dfVectorFieldStep}
                color="var(--text-secondary)"
              />

              {/* Solution curve — revealed only after submit */}
              {showResults && (
                <Plot.Parametric
                  xy={solutionCurveXY}
                  domain={[-3, 3]}
                  color="var(--accent-color)"
                  weight={3}
                  maxSamplingDepth={LAB_RENDER_LIMITS.curveSamplingDepth}
                />
              )}
            </Mafs>
          </MafsStage>

          {/* Readout — revealed only after submit */}
          {showResults && (
            <div
              className="lab-visual-info glass-panel"
              style={{ padding: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}
            >
              {learnStep < 2
                ? 'Solution curve: y = eˣ (passes through (0,1)). Equilibrium at y = 0.'
                : 'Logistic solution: equilibrium at P = 4. Population approaches 4 as t → ∞.'}
            </div>
          )}

          {/* Keep dirFieldSegments referenced so it is not tree-shaken */}
          {false && dirFieldSegments}
        </>
        }
      />
    );
  }

  // ─── Render: Kinematics ───────────────────────────────────────────────

  if (isKinematics) {
    return (
      <LabSceneLayout
        control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {activityPanel}

          {/* Time control */}
          <LabControlCard compact>
            {mode === 'explore' && (
              <div
                data-testid="kinematics-example-summary"
                style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.55 }}
              >
                <strong style={{ color: 'var(--text-primary)' }}>{kinExample.title}</strong>
                <div>{kinExample.equations}</div>
              </div>
            )}
            <LabSliderInput
              id="kin-t"
              label="Time t"
              ariaLabel="Kinematics time parameter"
              value={kinT}
              min={0}
              max={4}
              step={0.1}
              onChange={setKinT}
            />

            {/* Values — visible after submit */}
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
                s({kinT.toFixed(1)}) = {kinValues.s.toFixed(2)}, v({kinT.toFixed(1)}) = {kinValues.v.toFixed(2)}, a({kinT.toFixed(1)}) = {kinValues.a.toFixed(2)}
              </div>
            )}
          </LabControlCard>
        </div>
        }
        visual={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Position */}
          <MafsStage mafsHeight={kinGraphHeight} maxCanvasWidth={960} ariaLabel={`Position graph s(t), ${kinExample.title}`} interaction={mode === 'explore' ? 'explore' : 'static'}>
            <Mafs
              height={kinGraphHeight}
              width="auto"
              preserveAspectRatio={false}
              viewBox={{ x: [0, 5] as [number, number], y: kinExample.positionRange }}
              pan={mode === 'explore'}
              zoom={mode === 'explore' ? { min: 0.5, max: 4 } : false}
            >
              <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: kinExample.positionLines }} subdivisions={2} />
              <Plot.OfX y={kinExample.position} color="var(--accent-color)" weight={3} />
              {showResults && (
                <MafsLaTeX at={[Math.min(kinT + 0.4, 4.6), labelY(kinValues.s, kinExample.positionRange)]} tex={`s=${kinValues.s.toFixed(1)}`} color="var(--accent-color)" />
              )}
            </Mafs>
          </MafsStage>

          {showResults && (
            <>
              {/* Velocity */}
          <MafsStage mafsHeight={kinGraphHeight} maxCanvasWidth={960} ariaLabel={`Velocity graph v(t), ${kinExample.title}`} interaction={mode === 'explore' ? 'explore' : 'static'}>
            <Mafs
              height={kinGraphHeight}
              width="auto"
              preserveAspectRatio={false}
              viewBox={{ x: [0, 5] as [number, number], y: kinExample.velocityRange }}
              pan={mode === 'explore'}
              zoom={mode === 'explore' ? { min: 0.5, max: 4 } : false}
            >
              <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: kinExample.velocityLines }} subdivisions={2} />
              <Plot.OfX y={kinExample.velocity} color="var(--text-secondary)" weight={3} />
              <MafsLaTeX at={[Math.min(kinT + 0.4, 4.6), labelY(kinValues.v, kinExample.velocityRange)]} tex={`v=${kinValues.v.toFixed(1)}`} color="var(--text-secondary)" />
            </Mafs>
          </MafsStage>

          {/* Acceleration */}
          <MafsStage mafsHeight={kinGraphHeight} maxCanvasWidth={960} ariaLabel={`Acceleration graph a(t), ${kinExample.title}`} interaction={mode === 'explore' ? 'explore' : 'static'}>
            <Mafs
              height={kinGraphHeight}
              width="auto"
              preserveAspectRatio={false}
              viewBox={{ x: [0, 5] as [number, number], y: kinExample.accelerationRange }}
              pan={mode === 'explore'}
              zoom={mode === 'explore' ? { min: 0.5, max: 4 } : false}
            >
              <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: kinExample.accelerationLines }} subdivisions={2} />
              <Plot.OfX y={kinExample.acceleration} color="var(--text-secondary)" weight={3} />
              <MafsLaTeX at={[Math.min(kinT + 0.4, 4.6), labelY(kinValues.a, kinExample.accelerationRange)]} tex={`a=${kinValues.a.toFixed(1)}`} color="var(--text-secondary)" />
            </Mafs>
          </MafsStage>
            </>
          )}
        </div>
        }
      />
    );
  }

  // ─── Render: Numerical Methods ────────────────────────────────────────

  return (
    <LabSceneLayout
      control={
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {activityPanel}

        {mode === 'explore' && showsNewton && (
          <div
            data-testid="newton-method-explanation"
            className="glass-panel"
            style={{ padding: '12px 14px', fontSize: '12px', lineHeight: 1.55, color: 'var(--text-secondary)' }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>How to read Example 1</strong>
            <p style={{ margin: '6px 0' }}>
              We are solving <strong>f(x) = x² − {newtonK} = 0</strong>; the x-axis crossing is √{newtonK}.
            </p>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              <li>The blue curve is f(x) = x² − {newtonK}.</li>
              <li>The dashed vertical segment goes from xₙ to the curve.</li>
              <li>The solid sloping segment is the tangent; its x-axis intercept is xₙ₊₁.</li>
            </ul>
            <p style={{ margin: '6px 0 0' }}>Repeating the steps makes the estimates converge to √{newtonK}.</p>
          </div>
        )}

        {mode === 'explore' && !showsNewton && (
          <div
            data-testid="trapezoid-method-explanation"
            className="glass-panel"
            style={{ padding: '12px 14px', fontSize: '12px', lineHeight: 1.55, color: 'var(--text-secondary)' }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>How to read Examples 2–3</strong>
            <p style={{ margin: '6px 0' }}>
              We estimate the area under <strong>y = x²</strong> on [{trapStart}, {trapEnd}] by replacing the curve with straight top edges.
            </p>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              <li>The blue curve is the exact boundary of the region.</li>
              <li>Each grey outline is one trapezoid; its sloping top joins two points on the curve.</li>
              <li>More trapezoids follow the curve more closely, so the approximation error usually becomes smaller.</li>
            </ul>
          </div>
        )}

        {/* Controls */}
        <LabControlCard compact>
          {showsNewton && (
            <LabSliderInput
              id="newton-iter"
              label="Newton iterations"
              ariaLabel="Number of Newton iterations"
              value={newtonIters}
              min={1}
              max={LAB_RENDER_LIMITS.numericalIterations}
              step={1}
              onChange={setNewtonIters}
              decimals={0}
            />
          )}
          {!showsNewton && (
            <LabSliderInput
              id="trap-n"
              label="Trapezoids"
              ariaLabel="Number of trapezoids"
              value={trapN}
              min={1}
              max={LAB_RENDER_LIMITS.numericalIterations}
              step={1}
              onChange={setTrapN}
              decimals={0}
            />
          )}

          {/* Result overlays — hidden before submit */}
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
              {showsNewton && newtonPts.length > 1 && (
                <>
                  Newton iterates: {newtonPts.map((x) => x.toFixed(6)).join(' → ')}
                  <br />
                  √{newtonK} ≈ {Math.sqrt(newtonK).toFixed(6)}
                </>
              )}
              {!showsNewton && (
                <>
                  Trapezoidal estimate ({trapN} subintervals): {trapEstimate.toFixed(6)}
                  <br />
                  Exact ∫{trapStart === 0 ? '₀' : `_${trapStart}`}{trapEnd === 1 ? '¹' : `^${trapEnd}`} x² dx = {trapExact.toFixed(6)}
                  <br />
                  Error: {Math.abs(trapEstimate - trapExact).toFixed(6)}
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
          ariaLabel={showsNewton ? 'Newton method visualization' : 'Trapezoidal rule visualization'}
          interaction={mode === 'explore' ? 'explore' : 'static'}
        >
          <Mafs
            height={mafsHeight}
            viewBox={
              showsNewton
                ? {
                    x: [-1, Math.max(4, newtonX0 + 1, Math.sqrt(newtonK) + 1)] as [number, number],
                    // Reserve a label rail below f(x) ≥ −k so xₙ labels stay readable.
                    y: [-newtonK - 1.35, Math.max(4, newtonK + 2)] as [number, number],
                  }
                : {
                    x: [trapStart - 0.5, trapEnd + 0.5] as [number, number],
                    y: [-0.2, Math.max(1.2, trapEnd * trapEnd * 1.2)] as [number, number],
                  }
            }
            pan={mode === 'explore'}
            zoom={mode === 'explore' ? { min: 0.5, max: 4 } : false}
          >
            <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: 1 }} subdivisions={2} />

            {showsNewton && (
              <>
                {/* f(x) = x² - k */}
                <Plot.OfX y={(x) => x * x - newtonK} color="var(--accent-color)" weight={3} />

                {/* Newton iteration lines — hidden before submit */}
                {showResults &&
                  newtonPts.map((xn, idx) => {
                    if (idx >= newtonPts.length - 1) return null;
                    const fn = xn * xn - newtonK;
                    const xNext = newtonPts[idx + 1];
                    return (
                      <React.Fragment key={idx}>
                        {/* Vertical to curve */}
                        <Line.Segment
                          point1={[xn, 0]}
                          point2={[xn, fn]}
                          color="var(--text-secondary)"
                          style="dashed"
                          weight={1}
                        />
                        {/* Tangent to x-axis */}
                        <Line.Segment
                          point1={[xn, fn]}
                          point2={[xNext, 0]}
                          color="var(--text-secondary)"
                          weight={2}
                        />
                        <MafsLaTeX
                          at={newtonLabelPosition(xn, idx, newtonK)}
                          tex={`x_{${idx}}`}
                          color="var(--text-secondary)"
                        />
                      </React.Fragment>
                    );
                  })}
              </>
            )}

            {!showsNewton && (
              <>
                {/* f(x) = x² */}
                <Plot.OfX y={(x) => x * x} color="var(--accent-color)" weight={3} />

                {/* Trapezoid outlines — hidden before submit */}
                {showResults &&
                  Array.from({ length: Math.min(trapN, LAB_RENDER_LIMITS.numericalIterations) }, (_, i) => {
                    const h = (trapEnd - trapStart) / trapN;
                    const x0 = trapStart + i * h;
                    const x1 = trapStart + (i + 1) * h;
                    const y0 = x0 * x0;
                    const y1 = x1 * x1;
                    return (
                      <React.Fragment key={i}>
                        <Line.Segment point1={[x0, 0]} point2={[x0, y0]} color="var(--text-secondary)" weight={1} opacity={0.5} />
                        <Line.Segment point1={[x0, y0]} point2={[x1, y1]} color="var(--text-secondary)" weight={2} />
                        <Line.Segment point1={[x1, y1]} point2={[x1, 0]} color="var(--text-secondary)" weight={1} opacity={0.5} />
                        <Line.Segment point1={[x0, 0]} point2={[x1, 0]} color="var(--text-secondary)" weight={1} opacity={0.3} />
                      </React.Fragment>
                    );
                  })}
              </>
            )}
          </Mafs>
        </MafsStage>
      </>
      }
    />
  );
}
