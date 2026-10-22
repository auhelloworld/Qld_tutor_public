'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Mafs, Coordinates, MovablePoint, Point, Circle, Text, Line, LaTeX as MafsLaTeX } from 'mafs';
import { MapPin, HelpCircle } from 'lucide-react';
import MafsStage from './MafsStage';
import LearnPanel from './LearnPanel';
import TryItCard from './TryItCard';
import LabSceneLayout from './LabSceneLayout';
import LabControlCard from './LabControlCard';
import { LAB_ACTIVITIES, type LabActivityId } from '../../lib/lab-activities';
import { getExplorePrompts } from '../../lib/lab-explore-prompts';
import { useLabVariant } from '../../lib/use-lab-variant';
import { formatValueLaTeX } from '../../lib/math-utils';
import LabNumberInput from '../lab-shared/LabNumberInput';

interface ExplorerTabProps {
  isExact?: boolean;
  mafsHeight: number;
  mode?: 'explore' | 'learn';
  activityId?: LabActivityId;
  onActivityComplete?: (activityId: string, success: boolean) => void;
  onExitLearn?: () => void;
}

export default function ExplorerTab({
  isExact = true,
  mafsHeight,
  mode = 'explore',
  activityId,
  onActivityComplete,
  onExitLearn,
}: ExplorerTabProps) {
  const [explorerPoint, setExplorerPoint] = useState<[number, number]>([3, 2]);
  // P3: Second point for gradient/midpoint/distance
  const [secondPoint, setSecondPoint] = useState<[number, number]>([-2, -1]);
  const [showTwoPoint, setShowTwoPoint] = useState(false);
  const [learnRevealed, setLearnRevealed] = useState(false);
  const [learnStep, setLearnStep] = useState(0);
  const variant = useLabVariant(activityId);
  const getVariantSceneData = variant.getSceneData;

  useEffect(() => {
    setLearnRevealed(false);
    if (activityId === 'explorer-quadrant-predict') {
      const sd = getVariantSceneData(learnStep);
      if (sd && sd.kind === 'quadrant-point') {
        setExplorerPoint(sd.point);
      } else {
        const points: [number, number][] = [[3, -2], [-5, 7], [-4, -3]];
        setExplorerPoint(points[learnStep] ?? points[0]);
      }
      setShowTwoPoint(false);
    } else if (activityId === 'explorer-distance-from-origin') {
      const sd = getVariantSceneData(learnStep);
      if (sd && sd.kind === 'distance-from-origin') {
        setExplorerPoint(sd.point);
      } else {
        const points: [number, number][] = [[3, 4], [1, 1], [5, 12]];
        setExplorerPoint(points[learnStep] ?? points[0]);
      }
      setSecondPoint([0, 0]);
      setShowTwoPoint(false);
    } else if (activityId === 'explorer-two-point-measures') {
      const sd = getVariantSceneData(learnStep);
      if (sd && sd.kind === 'two-point-measures') {
        setExplorerPoint(sd.p);
        setSecondPoint(sd.q);
      } else {
        setExplorerPoint([-2, -3]);
        setSecondPoint([3, 9]);
      }
      setShowTwoPoint(true);
    }
  }, [activityId, learnStep, variant.variantSeed, getVariantSceneData]);

  const snappedX = Math.round(explorerPoint[0]);
  const snappedY = Math.round(explorerPoint[1]);
  const snappedPointDiffers =
    Math.abs(explorerPoint[0] - snappedX) >= 0.05 ||
    Math.abs(explorerPoint[1] - snappedY) >= 0.05;

  const quadrant = useMemo(() => {
    const [x, y] = explorerPoint;
    const isZeroX = Math.abs(x) < 0.05;
    const isZeroY = Math.abs(y) < 0.05;

    if (isZeroX && isZeroY) return { name: 'Origin', description: 'x ≈ 0, y ≈ 0 (0, 0)' };
    if (isZeroX) return { name: 'Y-Axis', description: 'x ≈ 0 (Vertical Axis)' };
    if (isZeroY) return { name: 'X-Axis', description: 'y ≈ 0 (Horizontal Axis)' };

    if (x > 0 && y > 0) return { name: 'Quadrant I', description: 'x > 0, y > 0 (Top Right)' };
    if (x < 0 && y > 0) return { name: 'Quadrant II', description: 'x < 0, y > 0 (Top Left)' };
    if (x < 0 && y < 0) return { name: 'Quadrant III', description: 'x < 0, y < 0 (Bottom Left)' };
    return { name: 'Quadrant IV', description: 'x > 0, y < 0 (Bottom Right)' };
  }, [explorerPoint]);

  // P3: Two-point calculations
  const twoPointMetrics = useMemo(() => {
    if (!showTwoPoint) return null;
    const [x1, y1] = explorerPoint;
    const [x2, y2] = secondPoint;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const midpoint: [number, number] = [(x1 + x2) / 2, (y1 + y2) / 2];
    const gradient = Math.abs(dx) < 0.001 ? NaN : dy / dx;
    return { distance, midpoint, gradient };
  }, [explorerPoint, secondPoint, showTwoPoint]);

  const handleActivityComplete = useCallback(
    (id: string, success: boolean) => {
      onActivityComplete?.(id, success);
    },
    [onActivityComplete]
  );

  // Learn mode panel
  const activity = activityId ? LAB_ACTIVITIES[activityId] : undefined;

  // The number line is one-dimensional, so it gets a short, wide canvas with no
  // vertical axis instead of the coordinate plane used by the other activities.
  if (mode === 'learn' && activity && onExitLearn && activityId === 'explorer-number-line') {
    const generated = getVariantSceneData(learnStep);
    const authored = activity.steps[learnStep]?.sceneData;
    const scene = generated && generated.kind === 'number-line'
      ? generated
      : authored && authored.kind === 'number-line'
        ? authored
        : { kind: 'number-line' as const, min: -6, max: 6, points: [] as number[] };
    const lineHeight = Math.max(170, Math.round(mafsHeight / 3));

    return (
      <LabSceneLayout
        control={
          <LearnPanel
            key={activity.id}
            activity={activity}
            onComplete={handleActivityComplete}
            onExit={onExitLearn}
            onRevealChange={setLearnRevealed}
            onStepChange={setLearnStep}
            {...variant.learnPanelProps}
          />
        }
        visual={
          <>
            <MafsStage
              mafsHeight={lineHeight}
              maxCanvasWidth={960}
              ariaLabel="Number line for the current learning activity"
              interaction="static"
            >
              <Mafs
                height={lineHeight}
                viewBox={{ x: [scene.min, scene.max] as [number, number], y: [-1, 1] as [number, number] }}
                pan={false}
                zoom={false}
                preserveAspectRatio={false}
              >
                <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={false} />

                {scene.points.map((value) => (
                  <React.Fragment key={`mark-${value}`}>
                    <Point x={value} y={0} color="var(--accent-color)" />
                    <MafsLaTeX at={[value, 0.45]} tex={String(value)} color="var(--accent-color)" />
                  </React.Fragment>
                ))}

                {/* The solution set is the answer, so it stays hidden until submit. */}
                {learnRevealed && scene.interval && (
                  <>
                    <Line.Segment
                      point1={[scene.interval.from, 0]}
                      point2={[scene.interval.to, 0]}
                      color="var(--success)"
                      weight={6}
                    />
                    {scene.interval.closedFrom ? (
                      <Point x={scene.interval.from} y={0} color="var(--success)" />
                    ) : (
                      <Circle center={[scene.interval.from, 0]} radius={0.16} color="var(--success)" fillOpacity={0} />
                    )}
                    {scene.interval.closedTo ? (
                      <Point x={scene.interval.to} y={0} color="var(--success)" />
                    ) : (
                      <Circle center={[scene.interval.to, 0]} radius={0.16} color="var(--success)" fillOpacity={0} />
                    )}
                  </>
                )}
              </Mafs>
            </MafsStage>
            <div
              className="lab-visual-info glass-panel"
              aria-live="polite"
              style={{ padding: '10px 14px', fontSize: '13px', color: 'var(--text-secondary)' }}
            >
              {learnRevealed
                ? 'A filled endpoint is included in the solution; a hollow one is excluded.'
                : 'Predict first. Any solution set stays hidden until you submit.'}
            </div>
          </>
        }
      />
    );
  }

  if (mode === 'learn' && activity && onExitLearn) {
    const isQuadrantActivity = activityId === 'explorer-quadrant-predict';
    const isDistanceActivity = activityId === 'explorer-distance-from-origin';
    const isMeasureActivity = activityId === 'explorer-two-point-measures';
    const showPrimaryPoint = !isQuadrantActivity || learnRevealed;

    return (
      <LabSceneLayout
        control={
          <>
            <LearnPanel
              key={activity.id}
              activity={activity}
              onComplete={handleActivityComplete}
              onExit={onExitLearn}
              onRevealChange={setLearnRevealed}
              onStepChange={setLearnStep}
              {...variant.learnPanelProps}
            />
          </>
        }
        visual={
          <>
            <MafsStage
              mafsHeight={mafsHeight}
              ariaLabel="Coordinate plane for the current learning activity"
              interaction="static"
              footer={learnRevealed ? (
                <fieldset className="glass-panel" style={{ padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                  <legend style={{ fontSize: '12px', fontWeight: 700 }}>Explore point coordinates</legend>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))', gap: '8px' }}>
                    <label style={{ fontSize: '11px' }}>P x<LabNumberInput aria-label="Learning point P x-coordinate" step="0.5" value={explorerPoint[0]} onChange={(event) => setExplorerPoint([Number(event.target.value), explorerPoint[1]])} style={{ width: '100%', display: 'block' }} /></label>
                    <label style={{ fontSize: '11px' }}>P y<LabNumberInput aria-label="Learning point P y-coordinate" step="0.5" value={explorerPoint[1]} onChange={(event) => setExplorerPoint([explorerPoint[0], Number(event.target.value)])} style={{ width: '100%', display: 'block' }} /></label>
                    {isMeasureActivity && (
                      <>
                        <label style={{ fontSize: '11px' }}>Q x<LabNumberInput aria-label="Learning point Q x-coordinate" step="0.5" value={secondPoint[0]} onChange={(event) => setSecondPoint([Number(event.target.value), secondPoint[1]])} style={{ width: '100%', display: 'block' }} /></label>
                        <label style={{ fontSize: '11px' }}>Q y<LabNumberInput aria-label="Learning point Q y-coordinate" step="0.5" value={secondPoint[1]} onChange={(event) => setSecondPoint([secondPoint[0], Number(event.target.value)])} style={{ width: '100%', display: 'block' }} /></label>
                      </>
                    )}
                  </div>
                </fieldset>
              ) : undefined}
            >
              <Mafs
                height={mafsHeight}
                viewBox={{ x: [-8, 8] as [number, number], y: [-8, 13] as [number, number] }}
                pan={false}
                zoom={false}
              >
                <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: 1 }} subdivisions={2} />

                {isDistanceActivity && (
                  <Line.Segment point1={[0, 0]} point2={explorerPoint} color="var(--text-secondary)" style="dashed" />
                )}

                {isMeasureActivity && (
                  <>
                    <Line.Segment point1={explorerPoint} point2={secondPoint} color="var(--text-secondary)" weight={2} />
                    {learnRevealed ? (
                      <MovablePoint point={secondPoint} onMove={(point) => setSecondPoint([Number(point[0].toFixed(1)), Number(point[1].toFixed(1))])} color="var(--text-secondary)" />
                    ) : (
                      <Point x={secondPoint[0]} y={secondPoint[1]} color="var(--text-secondary)" />
                    )}
                    <MafsLaTeX
                      at={[secondPoint[0] + 0.3, secondPoint[1] + 0.3]}
                      tex={learnRevealed ? `Q(${secondPoint[0]},\\,${secondPoint[1]})` : 'Q'}
                      color="var(--text-secondary)"
                    />
                    {learnRevealed && twoPointMetrics && (
                      <>
                        <Circle center={twoPointMetrics.midpoint} radius={0.2} color="var(--success)" />
                        <MafsLaTeX
                          at={[twoPointMetrics.midpoint[0] + 0.3, twoPointMetrics.midpoint[1] + 0.3]}
                          tex={`M(${twoPointMetrics.midpoint[0]},\\,${twoPointMetrics.midpoint[1]})`}
                          color="var(--success)"
                        />
                      </>
                    )}
                  </>
                )}

                {showPrimaryPoint && (
                  <>
                    {learnRevealed ? (
                      <MovablePoint point={explorerPoint} onMove={(point) => setExplorerPoint([Number(point[0].toFixed(1)), Number(point[1].toFixed(1))])} color="var(--accent-color)" />
                    ) : (
                      <Point x={explorerPoint[0]} y={explorerPoint[1]} color="var(--accent-color)" />
                    )}
                    <MafsLaTeX
                      at={[explorerPoint[0] - 0.3, explorerPoint[1] - 0.3]}
                      tex={learnRevealed ? `P(${explorerPoint[0]},\\,${explorerPoint[1]})` : 'P'}
                      color="var(--accent-color)"
                    />
                  </>
                )}
              </Mafs>
            </MafsStage>

            <div className="lab-visual-info glass-panel" aria-live="polite" style={{ padding: '10px 14px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {!learnRevealed && 'Submit a prediction to reveal coordinates and measurements. Calculated measurements are hidden until then.'}
              {learnRevealed && isQuadrantActivity && `The point is (${explorerPoint[0]}, ${explorerPoint[1]}). Move it across an axis to see the signs change.`}
              {learnRevealed && isDistanceActivity && `Distance from the origin: ${Math.hypot(explorerPoint[0], explorerPoint[1]).toFixed(3)}.`}
              {learnRevealed && isMeasureActivity && twoPointMetrics && `Gradient ${Number.isFinite(twoPointMetrics.gradient) ? twoPointMetrics.gradient.toFixed(3) : 'undefined'}; midpoint (${twoPointMetrics.midpoint[0].toFixed(2)}, ${twoPointMetrics.midpoint[1].toFixed(2)}); distance ${twoPointMetrics.distance.toFixed(3)}.`}
            </div>
          </>
        }
      />
    );
  }

  return (
    <LabSceneLayout
      align="stretch"
      control={
        <LabControlCard>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MapPin size={18} color="var(--accent-color)" /> Drag & Explore
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            Drag the point <strong>P</strong> on the grid to change its location. The coordinates, quadrant, and axis placement will update in real time.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div aria-live="polite" aria-atomic="true" style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-secondary)' }}>Point P Coordinates:</span>
            <span style={{ fontSize: '18px', fontWeight: '800', fontFamily: 'monospace', color: 'var(--accent-color)' }}>
              ({explorerPoint[0].toFixed(1)}, {explorerPoint[1].toFixed(1)})
            </span>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-secondary)' }}>Snapped Grid Point:</span>
            <span style={{ fontSize: '18px', fontWeight: '800', fontFamily: 'monospace', color: 'var(--success)' }}>
              ({snappedX}, {snappedY})
            </span>
          </div>

          <div aria-live="polite" style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-secondary)' }}>Quadrant / Position:</span>
              <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--accent-purple)', background: 'rgba(168,85,247,0.1)', padding: '4px 8px', borderRadius: '4px' }}>
                {quadrant.name}
              </span>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'right' }}>
              {quadrant.description}
            </span>
          </div>
        </div>

        {/* P3: Two-point toggle */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
          <label htmlFor="two-point-toggle" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              id="two-point-toggle"
              type="checkbox"
              checked={showTwoPoint}
              onChange={(e) => setShowTwoPoint(e.target.checked)}
              style={{ accentColor: 'var(--accent-color)' }}
            />
            Show second point Q (gradient, midpoint, distance)
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))', gap: '8px' }}>
          <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            P x
            <LabNumberInput aria-label="Point P x-coordinate" step="0.5" value={explorerPoint[0]} onChange={(event) => setExplorerPoint([Number(event.target.value), explorerPoint[1]])} style={{ width: '100%', marginTop: '4px' }} />
          </label>
          <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            P y
            <LabNumberInput aria-label="Point P y-coordinate" step="0.5" value={explorerPoint[1]} onChange={(event) => setExplorerPoint([explorerPoint[0], Number(event.target.value)])} style={{ width: '100%', marginTop: '4px' }} />
          </label>
          {showTwoPoint && (
            <>
              <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                Q x
                <LabNumberInput aria-label="Point Q x-coordinate" step="0.5" value={secondPoint[0]} onChange={(event) => setSecondPoint([Number(event.target.value), secondPoint[1]])} style={{ width: '100%', marginTop: '4px' }} />
              </label>
              <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                Q y
                <LabNumberInput aria-label="Point Q y-coordinate" step="0.5" value={secondPoint[1]} onChange={(event) => setSecondPoint([secondPoint[0], Number(event.target.value)])} style={{ width: '100%', marginTop: '4px' }} />
              </label>
            </>
          )}
        </div>

        {/* P3: Two-point metrics */}
        {showTwoPoint && twoPointMetrics && (
          <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>Point Q:</span>
              <span style={{ fontSize: '15px', fontWeight: '700', fontFamily: 'monospace', color: 'var(--accent-purple)' }}>
                ({secondPoint[0].toFixed(1)}, {secondPoint[1].toFixed(1)})
              </span>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>Gradient (m):</span>
              <span style={{ fontSize: '15px', fontWeight: '700', fontFamily: 'monospace', color: 'var(--accent-color)' }}>
                {isNaN(twoPointMetrics.gradient) ? 'undefined (vertical)' : twoPointMetrics.gradient.toFixed(3)}
              </span>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>Midpoint M:</span>
              <span style={{ fontSize: '15px', fontWeight: '700', fontFamily: 'monospace', color: 'var(--success)' }}>
                ({twoPointMetrics.midpoint[0].toFixed(2)}, {twoPointMetrics.midpoint[1].toFixed(2)})
              </span>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>Distance PQ:</span>
              <span data-testid="explorer-distance-pq" style={{ fontSize: '15px', fontWeight: '700', fontFamily: 'monospace', color: 'var(--accent-purple)' }}>
                {formatValueLaTeX(twoPointMetrics.distance, isExact)}
              </span>
            </div>
          </div>
        )}

        {/* General Info Alert */}
        <div style={{ display: 'flex', gap: '10px', background: 'rgba(99,102,241,0.04)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(99,102,241,0.1)', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
          <HelpCircle size={16} color="var(--accent-color)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            Coordinate axes partition the space. Drag the point to see how coordinates change as you cross quadrant boundaries.
            {showTwoPoint && ' Enable the second point to explore gradient, midpoint, and distance.'}
          </span>
        </div>

        <TryItCard prompts={getExplorePrompts('explorer')} />
      </LabControlCard>
      }
      visual={
      <MafsStage mafsHeight={mafsHeight} ariaLabel="Coordinate plane with draggable points" interaction="explore">
        <Mafs
          height={mafsHeight}
          viewBox={{ x: [-14, 14] as [number, number], y: [-14, 14] as [number, number] }}
          pan={true}
          zoom={{ min: 0.5, max: 4 }}
        >
          <Coordinates.Cartesian xAxis={{ lines: 2 }} yAxis={{ lines: 2 }} subdivisions={2} />

          {/* P3: Line segment between P and Q */}
          {showTwoPoint && (
            <>
              <Line.ThroughPoints
                point1={explorerPoint}
                point2={secondPoint}
                color="var(--text-secondary)"
                opacity={0.35}
                style="dashed"
              />
              <Line.Segment
                point1={explorerPoint}
                point2={secondPoint}
                color="var(--text-secondary)"
                weight={2}
              />
              {/* Midpoint marker */}
              {twoPointMetrics && (
                <>
                  <Circle center={twoPointMetrics.midpoint} radius={0.2} color="var(--success)" />
                  <g className="mafs-point-label mafs-point-label--nw">
                    <MafsLaTeX at={twoPointMetrics.midpoint} tex="M" color="var(--success)" />
                  </g>
                </>
              )}
              <MovablePoint
                point={secondPoint}
                onMove={(coords) => {
                  const cx = Math.max(-14, Math.min(14, coords[0]));
                  const cy = Math.max(-14, Math.min(14, coords[1]));
                  setSecondPoint([cx, cy]);
                }}
                color="var(--text-secondary)"
              />
              <g className="mafs-point-label mafs-point-label--ne">
                <MafsLaTeX at={secondPoint} tex="Q" color="var(--text-secondary)" />
              </g>
            </>
          )}

          {/* Point P */}
          <MovablePoint
            point={explorerPoint}
            onMove={(coords) => {
              const cx = Math.max(-14, Math.min(14, coords[0]));
              const cy = Math.max(-14, Math.min(14, coords[1]));
              setExplorerPoint([cx, cy]);
            }}
            color="var(--accent-color)"
          />
          <g className="mafs-point-label mafs-point-label--sw">
            <MafsLaTeX at={explorerPoint} tex="P" color="var(--accent-color)" />
          </g>

          {/* Avoid duplicating P's coordinate label when P is already exactly on the snapped point. */}
          {snappedPointDiffers && (
            <>
              <Circle center={[snappedX, snappedY]} radius={0.15} color="var(--success)" />
              <g className="mafs-point-label mafs-point-label--ne">
                <MafsLaTeX at={[snappedX, snappedY]} tex={`(${snappedX},\\,${snappedY})`} color="var(--text-primary)" />
              </g>
            </>
          )}

          {/* Quadrant labels */}
          {/* Quadrant labels — plain language Roman-numeral labels, keep Text */}
          <Text x={3.5} y={3.5} color="rgba(255,255,255,0.05)" size={24} svgTextProps={{ fontWeight: 'bold' }}>QI</Text>
          <Text x={-4.5} y={3.5} color="rgba(255,255,255,0.05)" size={24} svgTextProps={{ fontWeight: 'bold' }}>QII</Text>
          <Text x={-4.5} y={-4.5} color="rgba(255,255,255,0.05)" size={24} svgTextProps={{ fontWeight: 'bold' }}>QIII</Text>
          <Text x={4.2} y={-4.5} color="rgba(255,255,255,0.05)" size={24} svgTextProps={{ fontWeight: 'bold' }}>QIV</Text>
        </Mafs>
      </MafsStage>
      }
    />
  );
}
