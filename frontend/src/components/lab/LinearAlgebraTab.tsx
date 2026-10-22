'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Mafs, Coordinates, Point, Polygon, Vector, Transform, LaTeX as MafsLaTeX } from 'mafs';
import MafsStage from './MafsStage';
import LearnPanel from './LearnPanel';
import TryItCard from './TryItCard';
import LabSceneLayout from './LabSceneLayout';
import ConceptConnectionsLab from './ConceptConnectionsLab';
import { LAB_ACTIVITIES, type LabActivityId } from '../../lib/lab-activities';
import { getExplorePrompts } from '../../lib/lab-explore-prompts';
import { clampNumber } from '../../lib/lab-performance';
import { useLabVariant } from '../../lib/use-lab-variant';
import { formatValueLaTeX } from '../../lib/math-utils';
import LabNumberInput from '../lab-shared/LabNumberInput';

// ─── Pure helper functions (exported for testing) ────────────────────────────

/** Add two 2D vectors component-wise. */
export function vectorAdd(a: [number, number], b: [number, number]): [number, number] {
  return [a[0] + b[0], a[1] + b[1]];
}

/** Magnitude (length) of a 2D vector. */
export function vectorMagnitude(v: [number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1]);
}

/** Apply a 2×2 matrix [[a,b],[c,d]] to a point [x,y]. */
export function matrixTransform(
  matrix: [[number, number], [number, number]],
  point: [number, number],
): [number, number] {
  return [
    matrix[0][0] * point[0] + matrix[0][1] * point[1],
    matrix[1][0] * point[0] + matrix[1][1] * point[1],
  ];
}

/** Determinant of a 2×2 matrix [[a,b],[c,d]]. */
export function matrixDeterminant(matrix: [[number, number], [number, number]]): number {
  return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
}

/** Multiply two complex numbers represented as [real, imag]. */
export function complexMultiply(
  a: [number, number],
  b: [number, number],
): [number, number] {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}

/** Modulus of a complex number [real, imag]. */
export function complexModulus(z: [number, number]): number {
  return Math.sqrt(z[0] * z[0] + z[1] * z[1]);
}

/** Argument (in degrees) of a complex number [real, imag]. */
export function complexArgument(z: [number, number]): number {
  return (Math.atan2(z[1], z[0]) * 180) / Math.PI;
}

// ─── Scene types ─────────────────────────────────────────────────────────────

type LinearScene = 'linear-vector-resultant' | 'linear-matrix-transform' | 'linear-complex-plane' | 'linear-complex-multiplication';

const SCENE_LABELS: Record<LinearScene, string> = {
  'linear-vector-resultant': 'Vector Resultant',
  'linear-matrix-transform': 'Matrix Transform',
  'linear-complex-plane': 'Complex Plane',
  'linear-complex-multiplication': 'Complex: Turn & Stretch',
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface LinearAlgebraTabProps {
  isExact?: boolean;
  mafsHeight: number;
  mode?: 'explore' | 'learn';
  activityId?: LabActivityId;
  onActivityComplete?: (activityId: string, success: boolean) => void;
  onExitLearn?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function LinearAlgebraTab({
  isExact = true,
  mafsHeight,
  mode = 'explore',
  activityId,
  onActivityComplete,
  onExitLearn,
}: LinearAlgebraTabProps) {
  // Scene selector
  const [scene, setScene] = useState<LinearScene>('linear-vector-resultant');

  // Learn mode state
  const [learnRevealed, setLearnRevealed] = useState(false);
  const [learnStep, setLearnStep] = useState(0);
  const variant = useLabVariant(activityId);
  const getVariantSceneData = variant.getSceneData;

  // ─── Vector Resultant state ─────────────────────────────────────────────
  const [vecAx, setVecAx] = useState(3);
  const [vecAy, setVecAy] = useState(1);
  const [vecBx, setVecBx] = useState(-1);
  const [vecBy, setVecBy] = useState(2);

  // ─── Matrix Transform state ─────────────────────────────────────────────
  const [matA, setMatA] = useState(2);
  const [matB, setMatB] = useState(0);
  const [matC, setMatC] = useState(0);
  const [matD, setMatD] = useState(1);

  // ─── Complex Plane state ────────────────────────────────────────────────
  const [cReal, setCReal] = useState(3);
  const [cImag, setCImag] = useState(2);

  // Sync scene with activityId in explore and learn mode
  useEffect(() => {
    if (activityId) {
      if (activityId === 'linear-vector-resultant') setScene('linear-vector-resultant');
      else if (activityId === 'linear-matrix-transform') setScene('linear-matrix-transform');
      else if (activityId === 'linear-complex-plane') setScene('linear-complex-plane');
      else if (activityId === 'linear-complex-multiplication') setScene('linear-complex-multiplication');
    }
  }, [mode, activityId]);

  // Reset learn-reveal when step changes
  useEffect(() => {
    setLearnRevealed(false);

    // Set up step-specific configurations for Learn mode
    if (mode === 'learn' && activityId === 'linear-vector-resultant') {
      const sd = getVariantSceneData(learnStep);
      if (sd && sd.kind === 'vector-resultant') {
        setVecAx(sd.vecA[0]);
        setVecAy(sd.vecA[1]);
        setVecBx(sd.vecB[0]);
        setVecBy(sd.vecB[1]);
      } else {
        const configs: Array<{ ax: number; ay: number; bx: number; by: number }> = [
          { ax: 3, ay: 4, bx: 0, by: 0 }, // magnitude of (3,4)
          { ax: 2, ay: -1, bx: -5, by: 3 }, // addition
          { ax: 0, ay: 4, bx: 0, by: 0 }, // direction
        ];
        const cfg = configs[learnStep] ?? configs[0];
        setVecAx(cfg.ax);
        setVecAy(cfg.ay);
        setVecBx(cfg.bx);
        setVecBy(cfg.by);
      }
    } else if (mode === 'learn' && activityId === 'linear-matrix-transform') {
      const sd = getVariantSceneData(learnStep);
      if (sd && sd.kind === 'matrix-transform') {
        setMatA(sd.matrix[0][0]);
        setMatB(sd.matrix[0][1]);
        setMatC(sd.matrix[1][0]);
        setMatD(sd.matrix[1][1]);
      } else {
        const configs: Array<{ a: number; b: number; c: number; d: number }> = [
          { a: 2, b: 0, c: 0, d: 1 }, // stretch x
          { a: 0, b: -1, c: 1, d: 0 }, // rotation 90
          { a: 2, b: 0, c: 0, d: 3 }, // det=6
        ];
        const cfg = configs[learnStep] ?? configs[0];
        setMatA(cfg.a);
        setMatB(cfg.b);
        setMatC(cfg.c);
        setMatD(cfg.d);
      }
    } else if (mode === 'learn' && activityId === 'linear-complex-plane') {
      const sd = getVariantSceneData(learnStep);
      if (sd && sd.kind === 'complex-plane') {
        setCReal(sd.re);
        setCImag(sd.im);
      } else {
        const configs: Array<{ re: number; im: number }> = [
          { re: 3, im: 4 }, // modulus
          { re: 1, im: 2 }, // first addend; the sum is revealed separately
          { re: 1, im: 0 }, // multiply by i direction
        ];
        const cfg = configs[learnStep] ?? configs[0];
        setCReal(cfg.re);
        setCImag(cfg.im);
      }
    }
  }, [learnStep, mode, activityId, variant.variantSeed, getVariantSceneData]);

  // ─── Computed values ────────────────────────────────────────────────────

  const vecA: [number, number] = [vecAx, vecAy];
  const vecB: [number, number] = [vecBx, vecBy];
  const resultant = vectorAdd(vecA, vecB);
  const resultantMag = vectorMagnitude(resultant);
  const vecAMag = vectorMagnitude(vecA);

  const matrix: [[number, number], [number, number]] = [[matA, matB], [matC, matD]];
  const det = matrixDeterminant(matrix);

  // Unit square polygon for matrix transform
  const originalPoly: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const transformedPoly: [number, number][] = originalPoly.map((pt) =>
    matrixTransform(matrix, pt),
  );
  const activeVariantScene = getVariantSceneData(learnStep);
  const matrixTarget: [number, number] | null = mode === 'learn' && learnStep < 2
    ? (activeVariantScene?.kind === 'matrix-transform'
      ? activeVariantScene.point
      : (learnStep === 0 ? [3, 2] : [2, 1]))
    : null;
  const transformedTarget = matrixTarget
    ? matrixTransform(matrix, matrixTarget)
    : null;

  const complexZ: [number, number] = [cReal, cImag];
  const zModulus = complexModulus(complexZ);
  const zArgument = complexArgument(complexZ);
  const zTimesI = complexMultiply(complexZ, [0, 1]);
  const isComplexAddition = mode === 'learn' && learnStep === 1;
  const complexOther: [number, number] | null = isComplexAddition
    ? (activeVariantScene?.kind === 'complex-plane' && activeVariantScene.other
      ? activeVariantScene.other
      : [3, -1])
    : null;
  const typedComplexResult = activeVariantScene?.kind === 'complex-plane'
    ? activeVariantScene.result
    : undefined;
  const complexResult: [number, number] = typedComplexResult
    ?? (isComplexAddition ? [4, 1] : zTimesI);

  // ─── Learn mode handling ────────────────────────────────────────────────

  const handleRevealChange = useCallback((revealed: boolean) => {
    setLearnRevealed(revealed);
  }, []);

  const handleStepChange = useCallback((step: number) => {
    setLearnRevealed(false);
    setLearnStep(step);
  }, []);

  const learnActivity = activityId ? LAB_ACTIVITIES[activityId] : undefined;

  // ─── Determine whether answer-bearing elements should be visible ────────
  const showResult = mode === 'explore' || learnRevealed;
  const vectorBIsZero = Math.hypot(vecB[0], vecB[1]) < 0.1;
  const vectorBLabelAt: [number, number] = [
    (showResult ? vecA[0] + vecB[0] / 2 : vecB[0] / 2) + 0.45,
    (showResult ? vecA[1] + vecB[1] / 2 : vecB[1] / 2) + (vectorBIsZero ? -0.8 : 0.4),
  ];

  // ─── Render ─────────────────────────────────────────────────────────────

  // Scene controls live in the left column so every tab shares one layout.
  const renderSceneControls = () => {
    switch (scene) {
      case 'linear-vector-resultant':
        return (
          <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Vector A components
              </legend>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                  x:
                  <LabNumberInput
                    value={vecAx}
                    onChange={(e) => setVecAx(clampNumber(Number(e.target.value), -10, 10, vecAx))}
                    step={0.5}
                    aria-label="Vector A x-component"
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                  y:
                  <LabNumberInput
                    value={vecAy}
                    onChange={(e) => setVecAy(clampNumber(Number(e.target.value), -10, 10, vecAy))}
                    step={0.5}
                    aria-label="Vector A y-component"
                    style={inputStyle}
                  />
                </label>
              </div>
            </fieldset>
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Vector B components
              </legend>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                  x:
                  <LabNumberInput
                    value={vecBx}
                    onChange={(e) => setVecBx(clampNumber(Number(e.target.value), -10, 10, vecBx))}
                    step={0.5}
                    aria-label="Vector B x-component"
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                  y:
                  <LabNumberInput
                    value={vecBy}
                    onChange={(e) => setVecBy(clampNumber(Number(e.target.value), -10, 10, vecBy))}
                    step={0.5}
                    aria-label="Vector B y-component"
                    style={inputStyle}
                  />
                </label>
              </div>
            </fieldset>

            {/* Info readout */}
            {showResult && (
              <div
                role="status"
                aria-live="polite"
                style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}
              >
                <strong>Resultant:</strong> ({resultant[0].toFixed(2)}, {resultant[1].toFixed(2)})
                &nbsp;|&nbsp;
                <strong>|A+B|:</strong> <span data-testid="linear-resultant-mag">{formatValueLaTeX(resultantMag, isExact)}</span>
                &nbsp;|&nbsp;
                <strong>|A|:</strong> <span data-testid="linear-vec-a-mag">{formatValueLaTeX(vecAMag, isExact)}</span>
              </div>
            )}
          </div>
        );
      case 'linear-matrix-transform':
        return (
          <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                2×2 Matrix [a b; c d]
              </legend>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', maxWidth: '200px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                  a:
                  <LabNumberInput
                    value={matA}
                    onChange={(e) => setMatA(clampNumber(Number(e.target.value), -5, 5, matA))}
                    step={0.5}
                    aria-label="Matrix entry a (row 1, column 1)"
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                  b:
                  <LabNumberInput
                    value={matB}
                    onChange={(e) => setMatB(clampNumber(Number(e.target.value), -5, 5, matB))}
                    step={0.5}
                    aria-label="Matrix entry b (row 1, column 2)"
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                  c:
                  <LabNumberInput
                    value={matC}
                    onChange={(e) => setMatC(clampNumber(Number(e.target.value), -5, 5, matC))}
                    step={0.5}
                    aria-label="Matrix entry c (row 2, column 1)"
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                  d:
                  <LabNumberInput
                    value={matD}
                    onChange={(e) => setMatD(clampNumber(Number(e.target.value), -5, 5, matD))}
                    step={0.5}
                    aria-label="Matrix entry d (row 2, column 2)"
                    style={inputStyle}
                  />
                </label>
              </div>
            </fieldset>

            {/* Determinant / area factor (hidden before reveal in Learn) */}
            {showResult && (
              <div
                role="status"
                aria-live="polite"
                style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}
              >
                <strong>det(M):</strong> {det.toFixed(3)}
                &nbsp;|&nbsp;
                <strong>Area factor:</strong> {Math.abs(det).toFixed(3)}
                {det < 0 && ' (orientation reversed)'}
              </div>
            )}
          </div>
        );
      case 'linear-complex-plane':
        return (
          <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Complex number z = a + bi
              </legend>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                  Horizontal part (Re):
                  <LabNumberInput
                    value={cReal}
                    onChange={(e) => setCReal(clampNumber(Number(e.target.value), -10, 10, cReal))}
                    step={0.5}
                    aria-label="Real part of z"
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                  Vertical part (Im):
                  <LabNumberInput
                    value={cImag}
                    onChange={(e) => setCImag(clampNumber(Number(e.target.value), -10, 10, cImag))}
                    step={0.5}
                    aria-label="Imaginary part of z"
                    style={inputStyle}
                  />
                </label>
              </div>
            </fieldset>

            {/* Modulus, argument, multiplication result (hidden before reveal in Learn) */}
            {showResult && (
              <div
                role="status"
                aria-live="polite"
                style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}
              >
                {mode === 'learn' ? (
                  <>
                    {learnStep === 0 && <><strong>Distance from origin (modulus |z|):</strong> <span data-testid="linear-complex-modulus">{formatValueLaTeX(zModulus, isExact)}</span></>}
                    {learnStep === 1 && <><strong>Sum:</strong> ({complexResult[0].toFixed(2)} + {complexResult[1].toFixed(2)}i)</>}
                    {learnStep === 2 && <><strong>Turn:</strong> 90° anticlockwise; <strong>z × i:</strong> ({complexResult[0].toFixed(2)} + {complexResult[1].toFixed(2)}i)</>}
                  </>
                ) : (
                  <>
                    <strong>Distance from origin (|z|):</strong> <span data-testid="linear-complex-modulus">{formatValueLaTeX(zModulus, isExact)}</span>
                    &nbsp;|&nbsp;
                    <strong>Direction angle (arg z):</strong> {zArgument.toFixed(1)}°
                    &nbsp;|&nbsp;
                    <strong>z × i:</strong> ({complexResult[0].toFixed(2)} + {complexResult[1].toFixed(2)}i)
                  </>
                )}
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  const isComplexMultiplication = activityId === 'linear-complex-multiplication'
    || (mode === 'explore' && scene === 'linear-complex-multiplication');
  if (isComplexMultiplication && (mode === 'explore' || (learnActivity && onActivityComplete && onExitLearn))) {
    const connectionSelector = (
      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
        Scene
        <select
          value={scene}
          onChange={(event) => setScene(event.target.value as LinearScene)}
          aria-label="Select complex connection scene"
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
        >
          {(Object.keys(SCENE_LABELS) as LinearScene[]).map((key) => <option key={key} value={key}>{SCENE_LABELS[key]}</option>)}
        </select>
      </label>
    );
    return (
      <ConceptConnectionsLab
        activity={LAB_ACTIVITIES['linear-complex-multiplication']}
        mafsHeight={mafsHeight}
        mode={mode}
        topicSelector={connectionSelector}
        onComplete={onActivityComplete ?? (() => undefined)}
        onExit={onExitLearn ?? (() => undefined)}
      />
    );
  }

  return (
    <LabSceneLayout
      control={
        <>
        {/* Learn keeps the guided panel on the left; Explore uses the scene selector there. */}
        {mode === 'learn' && learnActivity && onActivityComplete && onExitLearn ? (
          <LearnPanel
            activity={learnActivity}
            onComplete={onActivityComplete}
            onExit={onExitLearn}
            onRevealChange={handleRevealChange}
            onStepChange={handleStepChange}
            {...variant.learnPanelProps}
          />
        ) : (
          <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label
              htmlFor="linear-scene-select"
              style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}
            >
              Scene
            </label>
            <select
              id="linear-scene-select"
              value={scene}
              onChange={(e) => setScene(e.target.value as LinearScene)}
              aria-label="Select linear algebra scene"
              style={{
                padding: '8px 12px',
                fontSize: '14px',
                borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              width: '100%',
            }}
          >
            {(Object.keys(SCENE_LABELS) as LinearScene[]).map((key) => (
              <option key={key} value={key}>
                {SCENE_LABELS[key]}
              </option>
            ))}
          </select>
          <TryItCard prompts={getExplorePrompts('linear-algebra')} />
        </div>
        )}
        {renderSceneControls()}
        </>
      }
      visual={
      <>
      {/* ─── Vector Resultant Scene ──────────────────────────────────────── */}
      {scene === 'linear-vector-resultant' && (
        <>
          <MafsStage mafsHeight={mafsHeight} ariaLabel="Vector addition visualisation" interaction={mode === 'explore' ? 'explore' : 'static'}>
            <Mafs
              height={mafsHeight}
              viewBox={{ x: [-6, 6], y: [-6, 6], padding: 0.5 }}
              pan={mode === 'explore'}
              zoom={mode === 'explore' ? { min: 0.5, max: 4 } : false}
            >
              <Coordinates.Cartesian />
              {/* Vector A: from origin */}
              <Vector
                tail={[0, 0]}
                tip={vecA}
                color="var(--accent-color)"
                weight={2.5}
              />
              <g className="mafs-label mafs-label--key">
                <MafsLaTeX at={[vecA[0] + 0.45, vecA[1] + 0.4]} tex="\mathbf{A}" color="var(--accent-color)" />
              </g>

              {/* Before reveal, draw B from the origin; translate it head-to-tail afterwards. */}
              <Vector
                tail={showResult ? vecA : [0, 0]}
                tip={showResult ? resultant : vecB}
                color="var(--text-secondary)"
                weight={2.5}
              />
              <g className="mafs-label mafs-label--key">
                <MafsLaTeX
                  at={vectorBLabelAt}
                  tex="\mathbf{B}"
                  color="var(--text-secondary)"
                />
              </g>

              {/* Resultant (hidden before reveal in Learn) */}
              {showResult && (
                <>
                  <Vector
                    tail={[0, 0]}
                    tip={resultant}
                    color="var(--success)"
                    weight={3}
                    style="dashed"
                  />
                  <g className="mafs-label mafs-label--key">
                    <MafsLaTeX at={[resultant[0] / 2 + 0.75, resultant[1] / 2 + 0.05]} tex="\mathbf{R}" color="var(--success)" />
                  </g>
                </>
              )}
            </Mafs>
          </MafsStage>
        </>
      )}

      {/* ─── Matrix Transform Scene ──────────────────────────────────────── */}
      {scene === 'linear-matrix-transform' && (
        <>
          <MafsStage mafsHeight={mafsHeight} ariaLabel="Matrix transformation visualisation" interaction={mode === 'explore' ? 'explore' : 'static'}>
            <Mafs
              height={mafsHeight}
              viewBox={{ x: [-7, 7], y: [-7, 7], padding: 0.5 }}
              pan={mode === 'explore'}
              zoom={mode === 'explore' ? { min: 0.5, max: 4 } : false}
            >
              <Coordinates.Cartesian />

              {/* Original unit square */}
              <Polygon
                points={originalPoly}
                color="var(--accent-color)"
                fillOpacity={0.15}
                strokeOpacity={0.8}
                weight={2}
              />
              <MafsLaTeX at={[0.5, -0.4]} tex="\text{Original}" color="var(--accent-color)" />
              {matrixTarget && (
                <>
                  <Point x={matrixTarget[0]} y={matrixTarget[1]} color="var(--accent-color)" />
                  <MafsLaTeX at={[matrixTarget[0] + 0.3, matrixTarget[1] + 0.3]} tex="P" color="var(--accent-color)" />
                </>
              )}

              {/* Transformed polygon via Transform wrapper (static image) */}
              {showResult && (
                <Transform matrix={[matrix[0][0], matrix[0][1], 0, matrix[1][0], matrix[1][1], 0]}>
                  <Polygon
                    points={originalPoly}
                    color="var(--success)"
                    fillOpacity={0.2}
                    strokeOpacity={0.9}
                    weight={2}
                  />
                </Transform>
              )}
              {showResult && (
                <>
                  <MafsLaTeX
                    at={[(transformedPoly[0][0] + transformedPoly[2][0]) / 2, (transformedPoly[0][1] + transformedPoly[2][1]) / 2 + 0.7]}
                    tex="\text{Image}"
                    color="var(--success)"
                  />
                  {transformedTarget && (
                    <>
                      <Point x={transformedTarget[0]} y={transformedTarget[1]} color="var(--success)" />
                      <MafsLaTeX at={[transformedTarget[0] + 0.3, transformedTarget[1] + 0.3]} tex={`P'=(${transformedTarget[0]}, ${transformedTarget[1]})`} color="var(--success)" />
                    </>
                  )}
                </>
              )}
            </Mafs>
          </MafsStage>

          {/* Matrix input controls */}
        </>
      )}

      {/* ─── Complex Plane Scene ─────────────────────────────────────────── */}
      {scene === 'linear-complex-plane' && (
        <>
          <MafsStage mafsHeight={mafsHeight} ariaLabel="Complex plane visualisation" interaction={mode === 'explore' ? 'explore' : 'static'}>
            <Mafs
              height={mafsHeight}
              viewBox={{ x: [-6, 6], y: [-6, 6], padding: 0.5 }}
              pan={mode === 'explore'}
              zoom={mode === 'explore' ? { min: 0.5, max: 4 } : false}
            >
              <Coordinates.Cartesian
                xAxis={{ labels: (n) => `${n}` }}
                yAxis={{ labels: (n) => `${n}i` }}
              />

              {/* z point */}
              <Point x={cReal} y={cImag} color="var(--accent-color)" />
              <Vector
                tail={[0, 0]}
                tip={[cReal, cImag]}
                color="var(--accent-color)"
                weight={2}
              />
              <g className="mafs-label mafs-label--key">
                <MafsLaTeX at={[cReal + 0.45, cImag + 0.4]} tex={isComplexAddition ? 'z_1' : 'z'} color="var(--accent-color)" />
              </g>

              {complexOther && (
                <>
                  <Point x={complexOther[0]} y={complexOther[1]} color="var(--text-secondary)" />
                  <Vector tail={[0, 0]} tip={complexOther} color="var(--text-secondary)" weight={2} />
                  <g className="mafs-label mafs-label--key">
                    <MafsLaTeX at={[complexOther[0] + 0.45, complexOther[1] + 0.4]} tex="z_2" color="var(--text-secondary)" />
                  </g>
                </>
              )}

              {/* Result (hidden before reveal in Learn) */}
              {showResult && (
                <>
                  <Point x={complexResult[0]} y={complexResult[1]} color="var(--success)" />
                  <Vector
                    tail={[0, 0]}
                    tip={complexResult}
                    color="var(--success)"
                    weight={2}
                    style="dashed"
                  />
                  <g className="mafs-label mafs-label--key">
                    <MafsLaTeX at={[complexResult[0] + 0.45, complexResult[1] + 0.4]} tex={isComplexAddition ? 'z_1+z_2' : 'zi'} color="var(--success)" />
                  </g>
                </>
              )}
            </Mafs>
          </MafsStage>

          {/* Complex controls */}
        </>
      )}
      </>
      }
    />
  );
}

// ─── Shared styles ───────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '70px',
  padding: '6px 8px',
  fontSize: '14px',
  fontFamily: 'monospace',
  borderRadius: '6px',
  border: '1px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
};
