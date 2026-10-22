'use client';

import React, { useState } from 'react';
import { Mafs, Coordinates, Circle, Ellipse, Line, Plot, Point, Text, Polygon, LaTeX as MafsLaTeX } from 'mafs';
import type { LabActivityMeta, SohcahtoaSceneData } from '../../lib/lab-activities';
import { clampNumber, LAB_RENDER_LIMITS } from '../../lib/lab-performance';
import LearnPanel from './LearnPanel';
import MafsStage from './MafsStage';
import LabSceneLayout from './LabSceneLayout';
import LabSliderInput from './LabSliderInput';
import LabControlCard from './LabControlCard';
import { useLabVariant } from '../../lib/use-lab-variant';
import type { AngleFigureSceneData } from '../../lib/lab-activities';
import {
  ANGLE_VIEW_BOX,
  LOWER_LINE_Y,
  UPPER_LINE_Y,
  arcLabelPoint,
  parallelLinesGeometry,
  regularPolygonPoints,
  triangleGeometry,
} from '../../lib/lab-angle-geometry';
import LabNumberInput from '../lab-shared/LabNumberInput';

interface GeometryExtensionsLabProps {
  activity: LabActivityMeta;
  mafsHeight: number;
  mode?: 'explore' | 'learn';
  onComplete: (id: string, success: boolean) => void;
  onExit: () => void;
  topicSelector?: React.ReactNode;
}

// ─── Circle Scaling Scene ─────────────────────────────────────────────────────

function CircleScalingScene({
  stepIndex,
  revealed,
  mafsHeight,
  radius,
  scaleFactor,
  interaction = 'static',
}: {
  stepIndex: number;
  revealed: boolean;
  mafsHeight: number;
  radius: number;
  scaleFactor: number;
  interaction?: 'explore' | 'static';
}) {
  const circumference = 2 * Math.PI * radius;
  const area = Math.PI * radius * radius;

  const showScaled = stepIndex === 2;
  const scaledRadius = radius * scaleFactor;
  const extent = (showScaled ? scaledRadius : radius) + 2;

  return (
    <>
      <MafsStage mafsHeight={mafsHeight} ariaLabel="Circle with adjustable radius showing circumference and area" interaction={interaction}>
        <Mafs
          height={mafsHeight}
          viewBox={{ x: [-extent, extent] as [number, number], y: [-extent, extent] as [number, number] }}
          pan={interaction === 'explore'}
          zoom={interaction === 'explore' ? { min: 0.5, max: 4 } : false}
        >
          <Coordinates.Cartesian xAxis={{ lines: 2 }} yAxis={{ lines: 2 }} subdivisions={1} />

          {/* Main circle */}
          <Circle center={[0, 0]} radius={radius} color="var(--accent-color)" weight={2} />
          {/* Radius line */}
          <Line.Segment point1={[0, 0]} point2={[radius, 0]} color="var(--accent-color)" weight={2} />
          <MafsLaTeX at={[radius / 2, -0.6]} tex={`r = ${radius}`} color="var(--accent-color)" />

          {/* Scaled circle for step 2 (area scaling) */}
          {showScaled && revealed && (
            <Circle center={[0, 0]} radius={scaledRadius} color="var(--text-secondary)" weight={1} fillOpacity={0.05} strokeOpacity={0.4} />
          )}

          {/* Reveal computed values after submit */}
          {revealed && stepIndex === 0 && (
            <MafsLaTeX at={[0, radius + 1.2]} tex={`C = ${2 * radius}\\pi \\approx ${circumference.toFixed(2)}`} color="var(--success)" />
          )}
          {revealed && stepIndex === 1 && (
            <MafsLaTeX at={[0, radius + 1.2]} tex={`A = ${Number((radius * radius).toFixed(2))}\\pi \\approx ${area.toFixed(2)}`} color="var(--success)" />
          )}
          {revealed && stepIndex === 2 && (
            <MafsLaTeX at={[0, -radius - 1.5]} tex={`\\text{Area factor} = ${scaleFactor}^2 = ${scaleFactor * scaleFactor}`} color="var(--success)" />
          )}
        </Mafs>
      </MafsStage>
    </>
  );
}

// ─── Pythagoras Scene ─────────────────────────────────────────────────────────

function PythagorasScene({
  stepIndex,
  revealed,
  mafsHeight,
  sideA,
  sideB,
  interaction = 'static',
}: {
  stepIndex: number;
  revealed: boolean;
  mafsHeight: number;
  sideA: number;
  sideB: number;
  interaction?: 'explore' | 'static';
}) {
  // Use the passed side lengths (from variant sceneData or fixed defaults)
  const a = sideA;
  const b = sideB;
  const c = Math.sqrt(a * a + b * b);
  const cDisplay = Number.isInteger(c) ? c : Number(c.toFixed(2));
  // Scale triangle to fit viewbox
  const scale = 5 / Math.max(a, b, c);
  const ax = a * scale;
  const by = b * scale;

  return (
    <>
      <MafsStage mafsHeight={mafsHeight} ariaLabel="Right triangle with labelled sides for Pythagoras theorem" interaction={interaction}>
        <Mafs
          height={mafsHeight}
          viewBox={{ x: [-2, 8] as [number, number], y: [-2, 8] as [number, number] }}
          pan={interaction === 'explore'}
          zoom={interaction === 'explore' ? { min: 0.5, max: 4 } : false}
        >
          <Coordinates.Cartesian xAxis={{ lines: 2 }} yAxis={{ lines: 2 }} subdivisions={1} />

          {/* Right triangle at origin */}
          <Polygon
            points={[[0, 0], [ax, 0], [0, by]]}
            color="var(--accent-color)"
            weight={2}
            fillOpacity={0.08}
          />
          {/* Right angle marker */}
          <Line.Segment point1={[0.4, 0]} point2={[0.4, 0.4]} color="var(--text-secondary)" weight={1} />
          <Line.Segment point1={[0.4, 0.4]} point2={[0, 0.4]} color="var(--text-secondary)" weight={1} />

          {/* Labels - always show side names — mathematical variable notation */}
          <MafsLaTeX at={[ax / 2, -0.6]} tex={`a = ${a}`} color="var(--accent-color)" />
          <MafsLaTeX at={[-0.9, by / 2]} tex={stepIndex === 1 && !revealed ? 'b = ?' : `b = ${b}`} color="var(--accent-color)" />

          {/* Hypotenuse label - show value only after reveal */}
          {revealed ? (
            <MafsLaTeX at={[ax / 2 + 0.5, by / 2 + 0.5]} tex={`c = ${cDisplay}`} color="var(--success)" />
          ) : (
            <MafsLaTeX at={[ax / 2 + 0.5, by / 2 + 0.5]} tex={stepIndex === 1 ? `c = ${cDisplay}` : 'c = ?'} color="var(--text-secondary)" />
          )}

          {/* Verification overlay — Pythagorean formula */}
          {revealed && (
            /* Centre the potentially long verification formula in the fixed viewBox. */
            <MafsLaTeX at={[3, by + 1]} tex={`${a}^2 + ${b}^2 = ${a * a} + ${b * b} = ${a * a + b * b} = ${cDisplay}^2`} color="var(--success)" />
          )}
        </Mafs>
      </MafsStage>
    </>
  );
}

// ─── SOHCAHTOA Scene ──────────────────────────────────────────────────────────

function SohcahtoaScene({
  stepIndex,
  revealed,
  mafsHeight,
  angleDeg,
  sceneData,
  interaction = 'static',
}: {
  stepIndex: number;
  revealed: boolean;
  mafsHeight: number;
  angleDeg: number;
  sceneData?: SohcahtoaSceneData;
  interaction?: 'explore' | 'static';
}) {
  const rad = (angleDeg * Math.PI) / 180;
  const adj = sceneData?.adj ?? 4;
  const opp = sceneData?.opp ?? Number((adj * Math.tan(rad)).toFixed(2));
  const hyp = sceneData?.hyp ?? Number((adj / Math.cos(rad)).toFixed(2));
  const ratio = sceneData?.ratio ?? (stepIndex === 2 ? 'tangent' : 'sine');
  const scale = 4 / Math.max(opp, adj);
  const adjScaled = adj * scale;
  const oppScaled = opp * scale;

  return (
    <>
      <MafsStage mafsHeight={mafsHeight} ariaLabel="Labelled right triangle for SOHCAHTOA trigonometric ratios" interaction={interaction}>
        <Mafs
          height={mafsHeight}
          viewBox={{ x: [-1, 7] as [number, number], y: [-1, 7] as [number, number] }}
          pan={interaction === 'explore'}
          zoom={interaction === 'explore' ? { min: 0.5, max: 4 } : false}
        >
          <Coordinates.Cartesian xAxis={{ lines: 2 }} yAxis={{ lines: 2 }} subdivisions={1} />

          {/* Right triangle */}
          <Polygon
            points={[[0, 0], [adjScaled, 0], [adjScaled, oppScaled]]}
            color="var(--accent-color)"
            weight={2}
            fillOpacity={0.06}
          />
          {/* Right angle marker */}
          <Line.Segment
            point1={[adjScaled - 0.3, 0]}
            point2={[adjScaled - 0.3, 0.3]}
            color="var(--text-secondary)"
            weight={1}
          />
          <Line.Segment
            point1={[adjScaled - 0.3, 0.3]}
            point2={[adjScaled, 0.3]}
            color="var(--text-secondary)"
            weight={1}
          />

          {/* Labels */}
          <MafsLaTeX at={[adjScaled / 2, -0.5]} tex={`\\text{adj} = ${adj}`} color="var(--accent-color)" />
          <MafsLaTeX at={[adjScaled + 0.7, oppScaled / 2]} tex={`\\text{opp} = ${opp}`} color="var(--accent-color)" />
          <MafsLaTeX at={[adjScaled / 2 - 0.5, oppScaled / 2 + 0.5]} tex={`\\text{hyp} = ${hyp === Number(Math.sqrt(50).toFixed(2)) ? '5\\sqrt{2}' : hyp}`} color="var(--text-secondary)" />

          {/* Angle θ label — mathematical symbol */}
          <MafsLaTeX at={[0.9, 0.4]} tex="\theta" color="var(--text-primary)" />

          {/* Reveal computed ratios — trigonometric formulas */}
          {revealed && stepIndex === 0 && (
            <MafsLaTeX
              at={[adjScaled / 2, oppScaled + 1]}
              tex={ratio === 'sine'
                ? '\\sin\\theta = \\frac{\\text{opp}}{\\text{hyp}}'
                : ratio === 'cosine'
                  ? '\\cos\\theta = \\frac{\\text{adj}}{\\text{hyp}}'
                  : '\\tan\\theta = \\frac{\\text{opp}}{\\text{adj}}'}
              color="var(--success)"
            />
          )}
          {revealed && stepIndex === 1 && (
            <MafsLaTeX at={[adjScaled / 2, oppScaled + 1]} tex={`\\sin\\theta = \\frac{${opp}}{${hyp}} = ${(opp / hyp).toFixed(2)}`} color="var(--success)" />
          )}
          {revealed && stepIndex === 2 && (
            <MafsLaTeX at={[adjScaled / 2, oppScaled + 1]} tex={`\\tan\\theta = \\frac{${opp}}{${adj}} = ${(opp / adj).toFixed(2)} \\Rightarrow \\theta = ${angleDeg}^{\\circ}`} color="var(--success)" />
          )}
        </Mafs>
      </MafsStage>
    </>
  );
}

// ─── Unit Circle Scene ────────────────────────────────────────────────────────

function UnitCircleScene({
  stepIndex,
  revealed,
  mafsHeight,
  angleDeg,
  interaction = 'static',
}: {
  stepIndex: number;
  revealed: boolean;
  mafsHeight: number;
  angleDeg: number;
  interaction?: 'explore' | 'static';
}) {
  const rad = (angleDeg * Math.PI) / 180;
  const cosVal = Math.cos(rad);
  const sinVal = Math.sin(rad);

  return (
    <>
      <MafsStage mafsHeight={mafsHeight} ariaLabel="Unit circle with angle, sine and cosine readout" interaction={interaction}>
        <Mafs
          height={mafsHeight}
          viewBox={{ x: [-2, 2] as [number, number], y: [-2, 2] as [number, number] }}
          pan={interaction === 'explore'}
          zoom={interaction === 'explore' ? { min: 0.5, max: 4 } : false}
        >
          <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: 1 }} subdivisions={2} />

          {/* Unit circle */}
          <Ellipse center={[0, 0]} radius={[1, 1]} color="var(--border-color)" weight={1} />

          {/* User-controlled angle ray and point */}
          <Line.Segment point1={[0, 0]} point2={[cosVal, sinVal]} color="var(--accent-color)" weight={2} />
          {revealed && (
            <>
              <Point x={cosVal} y={sinVal} color="var(--accent-color)" />
              <Line.Segment point1={[cosVal, 0]} point2={[cosVal, sinVal]} color="var(--text-secondary)" weight={1} />
              <Line.Segment point1={[0, sinVal]} point2={[cosVal, sinVal]} color="var(--success)" weight={1} />
              <Point x={cosVal} y={0} color="var(--text-secondary)" />
              <Point x={0} y={sinVal} color="var(--success)" />
            </>
          )}

          {/* Angle label — mathematical symbol */}
          <MafsLaTeX at={[0.35, 0.2]} tex="\theta" color="var(--text-primary)" />

          {/* Reveal answers after submit — trigonometric formulas */}
          {revealed && (
            <>
              <MafsLaTeX at={[cosVal, -0.25]} tex={`\\cos\\theta = ${cosVal.toFixed(2)}`} color="var(--text-secondary)" />
              <MafsLaTeX at={[-0.6, sinVal > 0 ? sinVal + 0.15 : sinVal - 0.15]} tex={`\\sin\\theta = ${sinVal.toFixed(2)}`} color="var(--success)" />
              {stepIndex === 0 && (
                <MafsLaTeX at={[0.3, 1.5]} tex="(\cos\frac{\pi}{2},\,\sin\frac{\pi}{2}) = (0, 1)" color="var(--success)" />
              )}
              {stepIndex === 1 && (
                <MafsLaTeX at={[-0.5, 1.5]} tex="\cos\pi = -1" color="var(--success)" />
              )}
              {stepIndex === 2 && (
                <MafsLaTeX at={[0, -1.5]} tex="\text{Q III: } \sin\theta < 0" color="var(--success)" />
              )}
            </>
          )}
        </Mafs>
      </MafsStage>
    </>
  );
}

function CircleRadiusControl({ radius, onRadiusChange }: { radius: number; onRadiusChange: (radius: number) => void }) {
  return (
    <LabControlCard title="Radius control" compact>
      <LabSliderInput
        id="circle-radius"
        label="r"
        ariaLabel="Circle radius"
        value={radius}
        min={1}
        max={6}
        step={0.5}
        onChange={onRadiusChange}
      />
    </LabControlCard>
  );
}

function PythagorasControl({ revealed, sideA, sideB, onSideAChange, onSideBChange }: { revealed: boolean; sideA: number; sideB: number; onSideAChange: (value: number) => void; onSideBChange: (value: number) => void }) {
  if (!revealed) return null;
  return (
    <fieldset className="lab-scene-control" style={{ padding: '12px 14px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
      <legend style={{ fontSize: '12px', fontWeight: 700 }}>Explore side lengths</legend>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <label style={{ fontSize: '11px' }}>Side a<LabNumberInput min={1} max={20} step={1} value={sideA} onChange={(e) => onSideAChange(clampNumber(Number(e.target.value), 1, 20, sideA))} aria-label="Triangle side a" style={{ width: '100%', display: 'block', padding: '8px 6px', boxSizing: 'border-box' }} /></label>
        <label style={{ fontSize: '11px' }}>Side b<LabNumberInput min={1} max={20} step={1} value={sideB} onChange={(e) => onSideBChange(clampNumber(Number(e.target.value), 1, 20, sideB))} aria-label="Triangle side b" style={{ width: '100%', display: 'block', padding: '8px 6px', boxSizing: 'border-box' }} /></label>
      </div>
      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '8px 0 0' }}>Hypotenuse = √({sideA}² + {sideB}²) = {Math.sqrt(sideA * sideA + sideB * sideB).toFixed(2)}</p>
    </fieldset>
  );
}

function SohcahtoaControl({ revealed, angleDeg, onAngleChange }: { revealed: boolean; angleDeg: number; onAngleChange: (angle: number) => void }) {
  if (!revealed) return null;
  const rad = (angleDeg * Math.PI) / 180;
  return (
    <LabControlCard title="Angle explorer" compact>
      <LabSliderInput
        id="soh-angle"
        label="θ"
        ariaLabel="Angle theta in degrees"
        value={angleDeg}
        min={5}
        max={85}
        step={1}
        onChange={onAngleChange}
        valueSuffix="°"
        decimals={0}
      />
      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '8px 0 0' }}>sin {angleDeg}° = {Math.sin(rad).toFixed(3)} · cos {angleDeg}° = {Math.cos(rad).toFixed(3)} · tan {angleDeg}° = {Math.tan(rad).toFixed(3)}</p>
    </LabControlCard>
  );
}

function UnitCircleAngleControl({
  angleDeg,
  revealed,
  onAngleChange,
}: {
  angleDeg: number;
  revealed: boolean;
  onAngleChange: (deg: number) => void;
}) {
  const rad = (angleDeg * Math.PI) / 180;

  return (
    <LabControlCard title="Angle control" compact>
      <LabSliderInput
        id="unit-circle-angle"
        label="θ"
        ariaLabel="Unit circle angle in degrees"
        value={angleDeg}
        min={0}
        max={360}
        step={5}
        onChange={onAngleChange}
        valueSuffix="°"
        decimals={0}
      />
      {revealed && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
          <span>cos {angleDeg}° = <strong>{Math.cos(rad).toFixed(3)}</strong></span>
          <span>sin {angleDeg}° = <strong>{Math.sin(rad).toFixed(3)}</strong></span>
        </div>
      )}
    </LabControlCard>
  );
}

// ─── Angle Reasoning Scene ────────────────────────────────────────────────────

/** Arc marking an angle, drawn parametrically because Mafs has no angle primitive. */
function AngleArc({
  centre,
  startDeg,
  endDeg,
  radius,
  color,
}: {
  centre: [number, number];
  startDeg: number;
  endDeg: number;
  radius: number;
  color: string;
}) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  return (
    <Plot.Parametric
      xy={(t) => [centre[0] + radius * Math.cos(t), centre[1] + radius * Math.sin(t)]}
      t={[toRad(startDeg), toRad(endDeg)]}
      color={color}
      weight={2}
      maxSamplingDepth={LAB_RENDER_LIMITS.curveSamplingDepth}
    />
  );
}

function AngleFigureScene({
  sceneData,
  revealed,
  mafsHeight,
  interaction = 'static',
}: {
  sceneData?: AngleFigureSceneData;
  revealed: boolean;
  mafsHeight: number;
  interaction?: 'explore' | 'static';
}) {
  const figure = sceneData?.figure ?? 'parallel-lines';
  const angles = sceneData?.angles ?? [55];
  const sides = sceneData?.sides ?? 7;
  const relation = sceneData?.relation ?? 'co-interior';

  // All positions come from the shared pure geometry so the drawing and the
  // prompt cannot disagree; see lab-angle-geometry.ts for the contracts.
  const parallel = parallelLinesGeometry(angles[0] ?? 55, relation);
  const triangle = triangleGeometry(angles[0] ?? 55, angles[1] ?? 70);
  const polygonPoints = regularPolygonPoints(sides);
  const arcRadius = 0.9;

  return (
    <>
      <MafsStage mafsHeight={mafsHeight} ariaLabel={`Angle reasoning figure: ${figure}`} interaction={interaction}>
        <Mafs
          height={mafsHeight}
          viewBox={{ x: ANGLE_VIEW_BOX.x, y: ANGLE_VIEW_BOX.y }}
          pan={interaction === 'explore'}
          zoom={interaction === 'explore' ? { min: 0.5, max: 4 } : false}
        >
          <Coordinates.Cartesian xAxis={{ lines: 2 }} yAxis={{ lines: 2 }} subdivisions={1} />

          {figure === 'parallel-lines' && (
            <>
              <Line.Segment point1={[-5.5, UPPER_LINE_Y]} point2={[5.5, UPPER_LINE_Y]} color="var(--accent-color)" weight={2} />
              <Line.Segment point1={[-5.5, LOWER_LINE_Y]} point2={[5.5, LOWER_LINE_Y]} color="var(--accent-color)" weight={2} />
              <Line.Segment
                point1={parallel.transversal.point1}
                point2={parallel.transversal.point2}
                color="var(--text-secondary)"
                weight={2}
              />
              <AngleArc
                centre={parallel.givenArc.centre}
                startDeg={parallel.givenArc.startDeg}
                endDeg={parallel.givenArc.endDeg}
                radius={arcRadius}
                color="var(--success)"
              />
              <MafsLaTeX
                at={arcLabelPoint(parallel.givenArc, arcRadius)}
                tex={`${parallel.givenArc.valueDeg}^{\\circ}`}
                color="var(--success)"
              />
              <AngleArc
                centre={parallel.partnerArc.centre}
                startDeg={parallel.partnerArc.startDeg}
                endDeg={parallel.partnerArc.endDeg}
                radius={arcRadius}
                color="var(--text-secondary)"
              />
              <MafsLaTeX
                at={arcLabelPoint(parallel.partnerArc, arcRadius)}
                tex={revealed ? `${parallel.partnerArc.valueDeg}^{\\circ}` : '?'}
                color="var(--text-secondary)"
              />
            </>
          )}

          {figure === 'triangle' && (
            <>
              <Polygon
                points={triangle.vertices}
                color="var(--accent-color)"
                svgPolygonProps={{ fillOpacity: 0.15 }}
              />
              <AngleArc
                centre={triangle.leftArc.centre}
                startDeg={triangle.leftArc.startDeg}
                endDeg={triangle.leftArc.endDeg}
                radius={0.8}
                color="var(--success)"
              />
              <MafsLaTeX
                at={arcLabelPoint(triangle.leftArc, 0.8)}
                tex={`${triangle.leftArc.valueDeg}^{\\circ}`}
                color="var(--success)"
              />
              <AngleArc
                centre={triangle.rightArc.centre}
                startDeg={triangle.rightArc.startDeg}
                endDeg={triangle.rightArc.endDeg}
                radius={0.8}
                color="var(--success)"
              />
              <MafsLaTeX
                at={arcLabelPoint(triangle.rightArc, 0.8)}
                tex={`${triangle.rightArc.valueDeg}^{\\circ}`}
                color="var(--success)"
              />
              <MafsLaTeX
                at={triangle.apexLabelAt}
                tex={revealed ? `${180 - triangle.leftArc.valueDeg - triangle.rightArc.valueDeg}^{\\circ}` : '?'}
                color="var(--text-secondary)"
              />
            </>
          )}

          {figure === 'polygon' && (
            <>
              <Polygon points={polygonPoints} color="var(--accent-color)" svgPolygonProps={{ fillOpacity: 0.12 }} />
              {revealed &&
                polygonPoints.slice(2, -1).map((point, index) => (
                  <Line.Segment
                    key={`diagonal-${index}`}
                    point1={polygonPoints[0]}
                    point2={point}
                    color="var(--text-secondary)"
                    style="dashed"
                  />
                ))}
              <MafsLaTeX at={[0, -4.6]} tex={`n = ${sides}`} color="var(--accent-color)" />
            </>
          )}
        </Mafs>
      </MafsStage>
    </>
  );
}

// ─── Similarity and Congruence Scene ──────────────────────────────────────────

/**
 * Compute the scale factor between two similar triangles.
 * Returns the ratio of corresponding sides (larger / smaller).
 */
export function similarityScaleFactor(sideOriginal: number, sideImage: number): number {
  if (sideOriginal <= 0) return 0;
  return sideImage / sideOriginal;
}

/**
 * Scale a triangle's sides by a given factor.
 */
export function scaleSides(sides: [number, number, number], factor: number): [number, number, number] {
  return [sides[0] * factor, sides[1] * factor, sides[2] * factor];
}

function SimilarityScene({
  stepIndex,
  revealed,
  mafsHeight,
  scaleFactor,
  interaction = 'static',
}: {
  stepIndex: number;
  revealed: boolean;
  mafsHeight: number;
  scaleFactor: number;
  interaction?: 'explore' | 'static';
}) {
  // Triangle ABC: 3-4-5 (step 0, 1) or 7-24-25 (step 2)
  const originalSides: [number, number, number] = stepIndex === 2 ? [7, 24, 25] : [3, 4, 5];
  const k = stepIndex === 2 ? 1 : scaleFactor;
  const scaledSides = scaleSides(originalSides, k);

  // Scale for display
  const maxSide = Math.max(...scaledSides, ...originalSides);
  const displayScale = 5 / maxSide;

  const origPts: [number, number][] = [
    [-6, -2],
    [-6 + originalSides[0] * displayScale, -2],
    [-6, -2 + originalSides[1] * displayScale],
  ];

  const scaledPts: [number, number][] = [
    [1, -2],
    [1 + scaledSides[0] * displayScale, -2],
    [1, -2 + scaledSides[1] * displayScale],
  ];

  return (
    <>
      <MafsStage mafsHeight={mafsHeight} ariaLabel="Similar triangles comparison" interaction={interaction}>
        <Mafs
          height={mafsHeight}
          viewBox={{ x: [-8, 8] as [number, number], y: [-4, 6] as [number, number] }}
          pan={interaction === 'explore'}
          zoom={interaction === 'explore' ? { min: 0.5, max: 4 } : false}
        >
          <Coordinates.Cartesian xAxis={{ lines: 2 }} yAxis={{ lines: 2 }} subdivisions={1} />

          {/* Original triangle ABC */}
          <Polygon points={origPts} color="var(--accent-color)" svgPolygonProps={{ fillOpacity: 0.15 }} />
          {/* "ABC: ..." — plain geometric vertex identification label, keep Text */}
          <Text x={origPts[0][0]} y={origPts[0][1] - 0.6} size={11} color="var(--accent-color)">
            {`ABC: ${originalSides[0]}, ${originalSides[1]}, ${originalSides[2]}`}
          </Text>

          {/* Scaled triangle (revealed or explore) */}
          {(revealed || interaction === 'explore') && k !== 1 && (
            <>
              <Polygon points={scaledPts} color="var(--text-secondary)" svgPolygonProps={{ fillOpacity: 0.15, strokeDasharray: '4 4' }} />
              {/* "DEF: ..." — plain geometric vertex identification label, keep Text */}
              <Text x={scaledPts[0][0]} y={scaledPts[0][1] - 0.6} size={11} color="var(--text-secondary)">
                {`DEF: ${scaledSides[0]}, ${scaledSides[1]}, ${scaledSides[2]}`}
              </Text>
            </>
          )}

          {/* Congruent triangle (step 2) */}
          {stepIndex === 2 && (revealed || interaction === 'explore') && (
            <>
              <Polygon points={scaledPts} color="var(--success)" svgPolygonProps={{ fillOpacity: 0.1 }} />
              {/* "Congruent: ..." — plain language label, keep Text */}
              <Text x={scaledPts[0][0]} y={scaledPts[0][1] - 0.6} size={11} color="var(--success)">
                {`Congruent: ${originalSides[0]}, ${originalSides[1]}, ${originalSides[2]}`}
              </Text>
            </>
          )}

          {revealed && (
            <MafsLaTeX at={[0, 5]} tex={stepIndex === 2
              ? '\\text{Scale factor} = 1\\;(\\text{congruent})'
              : `\\text{Scale factor} = ${k}`} color="var(--text-primary)" />
          )}
        </Mafs>
      </MafsStage>
    </>
  );
}

function SimilarityControl({
  revealed,
  scaleFactor,
  onScaleFactorChange,
}: {
  revealed: boolean;
  scaleFactor: number;
  onScaleFactorChange: (k: number) => void;
}) {
  return (
    <LabControlCard title="Scale factor" compact>
      {revealed && (
        <LabSliderInput
          id="similarity-scale"
          label="k"
          ariaLabel="Similarity scale factor"
          value={scaleFactor}
          min={0.5}
          max={4}
          step={0.5}
          onChange={onScaleFactorChange}
        />
      )}
      {!revealed && (
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
          Submit your answer to see the scaled triangle and adjust the factor.
        </div>
      )}
    </LabControlCard>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GeometryExtensionsLab({
  activity,
  mafsHeight,
  mode = 'learn',
  onComplete,
  onExit,
  topicSelector,
}: GeometryExtensionsLabProps) {
  const [stepIndex, setStepIndex] = useState(0);

  // Explore lists one button per graded example. The unlockable extension step
  // is not an example, and including it produced a fourth button in a
  // three-column grid that repeated an earlier picture.
  const exploreExampleSteps = activity.steps.filter((step) => step.tier !== 'extension');
  const [revealed, setRevealed] = useState(false);
  const showResults = mode === 'explore' || revealed;
  const interaction: 'explore' | 'static' = mode === 'explore' ? 'explore' : 'static';
  const variant = useLabVariant(activity.id);

  // Circle scaling state
  const [radius, setRadius] = useState(4);
  // Pythagoras state
  const [sideA, setSideA] = useState(6);
  const [sideB, setSideB] = useState(8);
  // SOHCAHTOA state
  const [sohAngle, setSohAngle] = useState(37);
  // Unit circle state
  const [ucAngle, setUcAngle] = useState(90);
  // Similarity state
  const [simScaleFactor, setSimScaleFactor] = useState(2);

  const handleStepChange = (nextStep: number) => {
    setStepIndex(nextStep);
    setRevealed(false);

    // Sync canvas from variant sceneData if available
    const sd = variant.getSceneData(nextStep);

    // Reset controls to match the new step's scenario
    if (activity.id === 'geometry-circle-scaling') {
      if (sd && sd.kind === 'circle-scaling') {
        setRadius(sd.radius);
      } else if (nextStep === 0) setRadius(4);
      else if (nextStep === 1) setRadius(3);
      else setRadius(2);
    } else if (activity.id === 'geometry-pythagoras') {
      if (sd && sd.kind === 'pythagoras') {
        setSideA(sd.a);
        setSideB(sd.b);
      } else if (nextStep === 0) { setSideA(6); setSideB(8); }
      else if (nextStep === 1) { setSideA(5); setSideB(12); }
      else { setSideA(7); setSideB(24); }
    } else if (activity.id === 'geometry-sohcahtoa') {
      if (sd && sd.kind === 'sohcahtoa') {
        setSohAngle(sd.angleDeg);
      } else if (nextStep === 0) setSohAngle(37);
      else if (nextStep === 1) setSohAngle(37);
      else setSohAngle(45);
    } else if (activity.id === 'geometry-unit-circle') {
      if (sd && sd.kind === 'unit-circle') {
        setUcAngle(sd.angleDeg);
      } else if (nextStep === 0) setUcAngle(90);
      else if (nextStep === 1) setUcAngle(180);
      else setUcAngle(225);
    } else if (activity.id === 'geometry-similarity-ratio') {
      if (sd && sd.kind === 'similarity') {
        setSimScaleFactor(sd.scaleFactor);
      } else if (nextStep === 0) setSimScaleFactor(2);
      else if (nextStep === 1) setSimScaleFactor(2);
      else setSimScaleFactor(1);
    }
  };

  const handleRevealChange = (rev: boolean) => {
    setRevealed(rev);
  };

  // Sync canvas params when variant changes (New numbers clicked)
  React.useEffect(() => {
    if (variant.variantSeed == null) return;
    const sd = variant.getSceneData(stepIndex);
    if (!sd) return;
    if (activity.id === 'geometry-circle-scaling' && sd.kind === 'circle-scaling') {
      setRadius(sd.radius);
    } else if (activity.id === 'geometry-pythagoras' && sd.kind === 'pythagoras') {
      setSideA(sd.a);
      setSideB(sd.b);
    } else if (activity.id === 'geometry-sohcahtoa' && sd.kind === 'sohcahtoa') {
      setSohAngle(sd.angleDeg);
    } else if (activity.id === 'geometry-unit-circle' && sd.kind === 'unit-circle') {
      setUcAngle(sd.angleDeg);
    } else if (activity.id === 'geometry-similarity-ratio' && sd.kind === 'similarity') {
      setSimScaleFactor(sd.scaleFactor);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant.variantSeed]);

  const activeVariantScene = variant.getSceneData(stepIndex);
  const authoredScene = activity.steps[stepIndex]?.sceneData;

  const renderScene = () => {
    switch (activity.id) {
      case 'geometry-circle-scaling':
        return (
          <CircleScalingScene
            stepIndex={stepIndex}
            revealed={showResults}
            mafsHeight={mafsHeight}
            radius={radius}
            scaleFactor={activeVariantScene?.kind === 'circle-scaling' ? activeVariantScene.scaleFactor : (stepIndex === 2 ? 3 : 1)}
            interaction={interaction}
          />
        );
      case 'geometry-pythagoras':
        return (
          <PythagorasScene
            stepIndex={stepIndex}
            revealed={showResults}
            mafsHeight={mafsHeight}
            sideA={sideA}
            sideB={sideB}
            interaction={interaction}
          />
        );
      case 'geometry-sohcahtoa':
        return (
          <SohcahtoaScene
            stepIndex={stepIndex}
            revealed={showResults}
            mafsHeight={mafsHeight}
            angleDeg={sohAngle}
            sceneData={activeVariantScene?.kind === 'sohcahtoa' ? activeVariantScene : undefined}
            interaction={interaction}
          />
        );
      case 'geometry-unit-circle':
        return (
          <UnitCircleScene
            stepIndex={stepIndex}
            revealed={showResults}
            mafsHeight={mafsHeight}
            angleDeg={ucAngle}
            interaction={interaction}
          />
        );
      case 'geometry-angle-reasoning':
        return (
          <AngleFigureScene
            sceneData={activeVariantScene?.kind === 'angle-figure' ? activeVariantScene : authoredScene?.kind === 'angle-figure' ? authoredScene : undefined}
            revealed={showResults}
            mafsHeight={mafsHeight}
            interaction={interaction}
          />
        );
      case 'geometry-similarity-ratio':
        return (
          <SimilarityScene
            stepIndex={stepIndex}
            revealed={showResults}
            mafsHeight={mafsHeight}
            scaleFactor={simScaleFactor}
            interaction={interaction}
          />
        );
      default:
        return null;
    }
  };

  const renderSceneControls = () => {
    switch (activity.id) {
      case 'geometry-circle-scaling':
        return <CircleRadiusControl radius={radius} onRadiusChange={setRadius} />;
      case 'geometry-pythagoras':
        return <PythagorasControl revealed={showResults} sideA={sideA} sideB={sideB} onSideAChange={setSideA} onSideBChange={setSideB} />;
      case 'geometry-sohcahtoa':
        return <SohcahtoaControl revealed={showResults} angleDeg={sohAngle} onAngleChange={setSohAngle} />;
      case 'geometry-unit-circle':
        return <UnitCircleAngleControl angleDeg={ucAngle} revealed={showResults} onAngleChange={setUcAngle} />;
      case 'geometry-similarity-ratio':
        return <SimilarityControl revealed={showResults} scaleFactor={simScaleFactor} onScaleFactorChange={setSimScaleFactor} />;
      default:
        return null;
    }
  };

  return (
    <LabSceneLayout
      control={
      <>
      {mode === 'learn' ? (
        <>
          <LearnPanel
            activity={activity}
            onComplete={onComplete}
            onExit={onExit}
            onRevealChange={handleRevealChange}
            onStepChange={handleStepChange}
            {...variant.learnPanelProps}
          />
          {renderSceneControls()}
        </>
      ) : (
        <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {topicSelector && <div className="lab-topic-selector">{topicSelector}</div>}
          <div>
            <h2 style={{ margin: 0, fontSize: '18px' }}>{activity.title}</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
              {activity.objective} Adjust the controls and compare the three bounded examples.
            </p>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>Example</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {exploreExampleSteps.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  aria-pressed={stepIndex === index}
                  aria-label={`Example ${index + 1}`}
                  onClick={() => handleStepChange(index)}
                  style={{
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: stepIndex === index ? 'var(--accent-color)' : 'var(--bg-secondary)',
                    color: stepIndex === index ? 'white' : 'var(--text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          </fieldset>
          {renderSceneControls()}
        </div>
      )}
      </>
      }
      visual={
      <>
        {renderScene()}

        <div
          className="lab-visual-info glass-panel"
          aria-live="polite"
          style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}
        >
          {activity.id === 'geometry-angle-reasoning' && (
            <>
              <strong style={{ color: 'var(--text-primary)' }}>Angle reasoning:</strong>{' '}
              The two horizontal lines are parallel. Each example marks the known angle and leaves the
              one in question as ?, which is revealed once you submit.
            </>
          )}
          {activity.id === 'geometry-circle-scaling' && (
            <>
              <strong style={{ color: 'var(--text-primary)' }}>Circle scaling:</strong>{' '}
              Adjust the radius to explore how circumference (C = 2πr) scales linearly and area (A = πr²) scales quadratically.
            </>
          )}
          {activity.id === 'geometry-pythagoras' && (
            <>
              <strong style={{ color: 'var(--text-primary)' }}>Pythagoras:</strong>{' '}
              The right triangle updates for each example. Use a² + b² = c² to connect the side lengths.
            </>
          )}
          {activity.id === 'geometry-sohcahtoa' && (
            <>
              <strong style={{ color: 'var(--text-primary)' }}>SOHCAHTOA:</strong>{' '}
              Opposite, adjacent and hypotenuse are labelled. Use the angle explorer to compare the three ratios.
            </>
          )}
          {activity.id === 'geometry-similarity-ratio' && (
            <>
              <strong style={{ color: 'var(--text-primary)' }}>Similarity:</strong>{' '}
              The two triangles share their angles. Change the scale factor to see every side multiply by
              it, while a factor of 1 makes the triangles congruent.
              {showResults && ` Current scale factor k = ${stepIndex === 2 ? 1 : simScaleFactor}.`}
            </>
          )}
          {activity.id === 'geometry-unit-circle' && (
            <>
              <strong style={{ color: 'var(--text-primary)' }}>Unit circle:</strong>{' '}
              Move the angle slider. The horizontal projection shows cosine (x) and the result projection shows sine (y).
            </>
          )}
        </div>
      </>
      }
    />
  );
}
