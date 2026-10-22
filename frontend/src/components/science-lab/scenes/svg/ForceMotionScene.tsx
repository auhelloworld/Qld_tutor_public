'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import type { ForceMotionSceneData } from '../../../../lib/science-lab/activity-types';
import {
  initForceMotionState,
  stepForceMotion,
  type ForceMotionState,
} from '../../../../lib/science-lab/models/force-motion';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSliderInput from '../../../lab-shared/LabSliderInput';
import SimulationControls from '../../controls/SimulationControls';
import {
  useDocumentHidden,
  usePrefersReducedMotion,
} from '../../../../lib/science-lab/use-scene-canvas';

const VIEW_W = 480;
const VIEW_H = 240;
const TRACK_LEFT_X = 50;
const TRACK_WIDTH = 360;
const TRACK_Y = 180;
const TRACK_MIN_M = -8;
const TRACK_MAX_M = 8;
const TRACK_SPAN_M = TRACK_MAX_M - TRACK_MIN_M;
const METRES_TO_VIEW = TRACK_WIDTH / TRACK_SPAN_M;
const FORCE_MIN_N = -60;
const FORCE_MAX_N = 60;
const FORCE_STEP_N = 2;
/** View units drawn per newton of applied force. */
const FORCE_ARROW_SCALE = 1.2;

/** The single conversion used by the block, trace, ticks, and force drag origin. */
function modelPositionToViewX(positionM: number): number {
  const offsetM = positionM - TRACK_MIN_M;
  const wrappedM = (offsetM % TRACK_SPAN_M + TRACK_SPAN_M) % TRACK_SPAN_M;
  // Keep the exact positive seam at the visible upper endpoint; positions
  // beyond it continue from the lower endpoint on the next rendered frame.
  if (wrappedM === 0 && positionM > TRACK_MIN_M) {
    return TRACK_LEFT_X + TRACK_WIDTH;
  }
  return TRACK_LEFT_X + wrappedM * METRES_TO_VIEW;
}

function clampForce(forceN: number): number {
  return Math.max(FORCE_MIN_N, Math.min(FORCE_MAX_N, forceN));
}

export default function ForceMotionScene({
  sceneData,
  onSceneDataChange,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<ForceMotionSceneData>) {
  const [massKg, setMassKg] = useState(sceneData.massKg ?? 5);
  const [appliedForceN, setAppliedForceN] = useState(sceneData.appliedForceN ?? 20);
  const [frictionEnabled, setFrictionEnabled] = useState(sceneData.frictionEnabled ?? true);
  const [traceEnabled, setTraceEnabled] = useState(sceneData.traceEnabled ?? true);
  const [isPlaying, setIsPlaying] = useState(sceneData.isPlaying ?? true);
  const [displayState, setDisplayState] = useState<ForceMotionState>(() =>
    initForceMotionState(
      sceneData.massKg ?? 5,
      sceneData.appliedForceN ?? 20,
      sceneData.frictionEnabled ?? true,
    ),
  );
  const stateRef = useRef<ForceMotionState>(displayState);
  const animFrameIdRef = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [isDraggingForce, setIsDraggingForce] = useState(false);
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

  const syncDisplayParameters = useCallback(
    (forceN: number, friction: boolean, mass: number) => {
      const next = stepForceMotion(stateRef.current, 0, forceN, friction, mass);
      stateRef.current = next;
      setDisplayState(next);
    },
    [],
  );

  const handleForceChange = useCallback(
    (newForce: number) => {
      const forceN = clampForce(newForce);
      setAppliedForceN(forceN);
      syncDisplayParameters(forceN, frictionEnabled, massKg);
      onSceneDataChange?.({ appliedForceN: forceN });
    },
    [frictionEnabled, massKg, onSceneDataChange, syncDisplayParameters],
  );

  const handleMassChange = useCallback(
    (newMass: number) => {
      setMassKg(newMass);
      syncDisplayParameters(appliedForceN, frictionEnabled, newMass);
      onSceneDataChange?.({ massKg: newMass });
    },
    [appliedForceN, frictionEnabled, onSceneDataChange, syncDisplayParameters],
  );

  const handleFrictionToggle = () => {
    const next = !frictionEnabled;
    setFrictionEnabled(next);
    syncDisplayParameters(appliedForceN, next, massKg);
    onSceneDataChange?.({ frictionEnabled: next });
  };

  const handleTraceToggle = () => {
    const next = !traceEnabled;
    setTraceEnabled(next);
    onSceneDataChange?.({ traceEnabled: next });
  };

  const handlePlayToggle = () => {
    setIsPlaying((previous) => {
      const next = !previous;
      onSceneDataChange?.({ isPlaying: next });
      return next;
    });
  };

  /** Convert a viewport pointer to force using the same block position as the drawing. */
  const forceFromPointer = useCallback((clientX: number): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const viewScale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
    const offsetX = (rect.width - VIEW_W * viewScale) / 2;
    const viewX = (clientX - rect.left - offsetX) / viewScale;
    const blockX = modelPositionToViewX(stateRef.current.positionM);
    const rawForceN = (viewX - blockX) / FORCE_ARROW_SCALE;
    const steppedForceN = Math.round(rawForceN / FORCE_STEP_N) * FORCE_STEP_N;
    return clampForce(steppedForceN);
  }, []);

  const handleForcePointerDown = (event: React.PointerEvent<SVGGElement>) => {
    event.stopPropagation();
    setIsDraggingForce(true);
    svgRef.current?.setPointerCapture?.(event.pointerId);
  };

  const handleSvgPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!isDraggingForce) return;
    const next = forceFromPointer(event.clientX);
    if (next !== null) handleForceChange(next);
  };

  const handleSvgPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    setIsDraggingForce(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  // Simulation tick. Do not keep an idle animation frame alive while gated.
  useEffect(() => {
    if (!shouldAnimate) return;

    let cancelled = false;
    let lastTime: number | null = null;

    const tick = (now: number) => {
      if (cancelled) return;
      if (lastTime === null) lastTime = now;
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const nextState = stepForceMotion(
        stateRef.current,
        dt,
        appliedForceN,
        frictionEnabled,
        massKg,
      );
      stateRef.current = nextState;
      setDisplayState(nextState);

      animFrameIdRef.current = requestAnimationFrame(tick);
    };

    animFrameIdRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
    };
  }, [shouldAnimate, appliedForceN, frictionEnabled, massKg]);

  useEffect(() => {
    onReadoutChange?.(isRevealed
      ? {
          netForceN: displayState.netForceN,
          acceleration: displayState.accelerationMs2,
          velocity: displayState.velocityMs,
          frictionN: displayState.frictionForceN,
          positionM: displayState.positionM,
        }
      : {});
  }, [displayState, isRevealed, onReadoutChange]);

  const handleReset = () => {
    resumeAfterReducedMotionRef.current = false;
    const resetState = initForceMotionState(massKg, appliedForceN, frictionEnabled);
    stateRef.current = resetState;
    setDisplayState(resetState);
    setIsPlaying(false);
    onSceneDataChange?.({ isPlaying: false });
  };

  const handleStepForward = () => {
    const nextState = stepForceMotion(
      stateRef.current,
      0.05,
      appliedForceN,
      frictionEnabled,
      massKg,
    );
    stateRef.current = nextState;
    setDisplayState(nextState);
  };

  const screenX = modelPositionToViewX(displayState.positionM);
  const weightN = massKg * 9.8;
  const verticalArrowLength = Math.max(24, Math.min(48, weightN * 0.2));
  const playbackStatus = isDocumentHidden
    ? 'Paused while this page is hidden'
    : isReducedMotion
      ? 'Paused for reduced motion'
      : isPlaying
        ? 'Running'
        : 'Paused';

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Force & Mass Controls">
            <LabSliderInput
              id="appliedForceN"
              label="Applied Force"
              ariaLabel="Applied force in Newtons"
              value={appliedForceN}
              min={FORCE_MIN_N}
              max={FORCE_MAX_N}
              step={FORCE_STEP_N}
              valueSuffix=" N"
              onChange={handleForceChange}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' }}>
              <button
                type="button"
                aria-pressed={appliedForceN === 0}
                onClick={() => handleForceChange(0)}
                style={{
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: appliedForceN === 0 ? 'var(--accent-color, #10b981)' : 'var(--bg-primary)',
                  color: appliedForceN === 0 ? '#fff' : 'var(--text-primary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                0 N (Release Force)
              </button>
              <button
                type="button"
                aria-pressed={appliedForceN === 40}
                onClick={() => handleForceChange(40)}
                style={{
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: appliedForceN === 40 ? 'var(--accent-color, #10b981)' : 'var(--bg-primary)',
                  color: appliedForceN === 40 ? '#fff' : 'var(--text-primary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                +40 N Push
              </button>
            </div>

            <div style={{ marginTop: '12px' }}>
              <LabSliderInput
                id="force-mass"
                label="Object Mass (m)"
                ariaLabel="Object mass in kilograms"
                value={massKg}
                min={1}
                max={20}
                step={1}
                valueSuffix=" kg"
                onChange={handleMassChange}
              />
            </div>
          </LabControlCard>

          <LabControlCard title="Friction & Visual Options">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                id="frictionToggle"
                type="button"
                aria-label="Toggle friction force — frictionless counterfactual"
                aria-pressed={!frictionEnabled}
                onClick={handleFrictionToggle}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: !frictionEnabled ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-primary)',
                  color: !frictionEnabled ? '#3b82f6' : 'var(--text-primary)',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {frictionEnabled
                  ? 'Friction Enabled: ON — counterfactual removes friction (μ = 0)'
                  : 'Friction Enabled: OFF — restore normal surface friction (μ = 0.2)'}
              </button>

              <button
                id="traceToggle"
                type="button"
                aria-label="Toggle motion trace overlay"
                aria-pressed={traceEnabled}
                onClick={handleTraceToggle}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: traceEnabled ? 'rgba(168, 85, 247, 0.15)' : 'var(--bg-primary)',
                  color: traceEnabled ? '#a855f7' : 'var(--text-primary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {traceEnabled ? 'Show Motion Trace: ON' : 'Show Motion Trace: OFF'}
              </button>
            </div>
          </LabControlCard>

          <LabControlCard title="Simulation Playback">
            <SimulationControls
              isPlaying={isPlaying}
              onTogglePlay={handlePlayToggle}
              onStepForward={handleStepForward}
              onReset={handleReset}
            />
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
              Free Body Diagram & Horizontal Track
            </h4>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#10b981' }}>
              {isRevealed
                ? `F_net = ${displayState.netForceN} N · a = ${displayState.accelerationMs2} m/s²`
                : 'F_net · a 🔒'}
            </span>
          </div>

          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="science-scene-svg"
            style={{
              maxWidth: '960px',
              background: '#0f172a',
              borderRadius: '12px',
              cursor: isDraggingForce ? 'grabbing' : 'default',
              touchAction: 'none',
            }}
            role="img"
            aria-label={
              isRevealed
                ? `Interactive force and motion diagram. Applied force ${appliedForceN} newtons on a ${massKg} kilogram block; net force ${displayState.netForceN} newtons, acceleration ${displayState.accelerationMs2} metres per second squared, and velocity ${displayState.velocityMs} metres per second. Drag the applied-force handle labelled F app, or use the slider.`
                : `Interactive force and motion diagram. Applied force ${appliedForceN} newtons on a ${massKg} kilogram block. Net force, acceleration, friction magnitude, and velocity results are hidden until prediction is submitted. Drag the applied-force handle labelled F app, or use the slider.`
            }
            onPointerMove={handleSvgPointerMove}
            onPointerUp={handleSvgPointerUp}
            onPointerCancel={handleSvgPointerUp}
          >
            <title>
              {isRevealed
                ? `Force vectors and position track for a ${massKg} kilogram block`
                : 'Force vectors and position track with calculated results locked'}
            </title>
            {/* Ground / Track */}
            <line x1="20" y1={TRACK_Y} x2="460" y2={TRACK_Y} stroke="#475569" strokeWidth="4" />
            {Array.from({ length: 9 }).map((_, index) => {
              const positionM = TRACK_MIN_M + index * 2;
              const x = modelPositionToViewX(positionM);
              return (
                <g key={positionM} transform={`translate(${x}, ${TRACK_Y})`}>
                  <line x1="0" y1="0" x2="0" y2="8" stroke="#64748b" strokeWidth="1.5" />
                  <text x="-8" y="20" fill="#64748b" fontSize="9">{positionM}m</text>
                </g>
              );
            })}
            <text x="230" y="226" fill="#94a3b8" fontSize="10" textAnchor="middle">
              Horizontal position x (m)
            </text>

            {/* Motion Ghost Trace */}
            {traceEnabled && displayState.trace.map((point, index) => (
              <circle
                key={`${point.timeSec}-${index}`}
                cx={modelPositionToViewX(point.x)}
                cy={TRACK_Y - 20}
                r="4"
                fill="#a855f7"
                opacity={((index + 1) / displayState.trace.length) * 0.4}
              />
            ))}

            {/* Sliding Block and all vectors share this model-derived origin. */}
            <g transform={`translate(${screenX}, ${TRACK_Y})`}>
              <rect
                x="-25"
                y="-40"
                width="50"
                height="40"
                rx="6"
                fill="#3b82f6"
                stroke="#93c5fd"
                strokeWidth="2"
              />
              <text x="0" y="-17" fill="#fff" fontSize="11" fontWeight="bold" textAnchor="middle">
                {massKg} kg
              </text>

              {/* Applied Force Vector (Green); the zero-force handle remains draggable. */}
              <g>
                {appliedForceN !== 0 && (
                  <>
                    <line
                      x1="0"
                      y1="-20"
                      x2={appliedForceN * FORCE_ARROW_SCALE}
                      y2="-20"
                      stroke="#10b981"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <polygon
                      points={appliedForceN > 0
                        ? `${appliedForceN * FORCE_ARROW_SCALE + 6},-20 ${appliedForceN * FORCE_ARROW_SCALE},-24 ${appliedForceN * FORCE_ARROW_SCALE},-16`
                        : `${appliedForceN * FORCE_ARROW_SCALE - 6},-20 ${appliedForceN * FORCE_ARROW_SCALE},-24 ${appliedForceN * FORCE_ARROW_SCALE},-16`}
                      fill="#10b981"
                    />
                  </>
                )}
                <g
                  data-force-drag-handle=""
                  onPointerDown={handleForcePointerDown}
                  style={{ cursor: 'ew-resize' }}
                >
                  <circle
                    cx={appliedForceN * FORCE_ARROW_SCALE}
                    cy="-20"
                    r="9"
                    fill="#10b981"
                    fillOpacity="0.25"
                    stroke="#6ee7b7"
                    strokeWidth="1.5"
                  />
                </g>
                <text
                  x={appliedForceN * FORCE_ARROW_SCALE}
                  y="-49"
                  fill="#10b981"
                  fontSize="10"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  F_app = {appliedForceN}N
                </text>
              </g>

              {/* Friction Force Vector (Red) */}
              {displayState.frictionForceN !== 0 && (
                <g>
                  <line
                    x1="0"
                    y1="-7"
                    x2={displayState.frictionForceN * 1.5}
                    y2="-7"
                    stroke="#ef4444"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <polygon
                    points={displayState.frictionForceN > 0
                      ? `${displayState.frictionForceN * 1.5 + 5},-7 ${displayState.frictionForceN * 1.5},-11 ${displayState.frictionForceN * 1.5},-3`
                      : `${displayState.frictionForceN * 1.5 - 5},-7 ${displayState.frictionForceN * 1.5},-11 ${displayState.frictionForceN * 1.5},-3`}
                    fill="#ef4444"
                  />
                  <text
                    x={displayState.frictionForceN * 1.5}
                    y="7"
                    fill="#ef4444"
                    fontSize="9"
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {isRevealed ? `f = ${displayState.frictionForceN}N` : 'f (friction)'}
                  </text>
                </g>
              )}

              {/* Normal force and weight complete the free-body diagram. */}
              <g>
                <line
                  x1="0"
                  y1="-40"
                  x2="0"
                  y2={-40 - verticalArrowLength}
                  stroke="#fbbf24"
                  strokeWidth="2.5"
                />
                <polygon
                  points={`0,${-46 - verticalArrowLength} -4,${-40 - verticalArrowLength} 4,${-40 - verticalArrowLength}`}
                  fill="#fbbf24"
                />
                <text x="7" y={-43 - verticalArrowLength} fill="#fbbf24" fontSize="9" fontWeight="bold">
                  {isRevealed ? `N = ${weightN.toFixed(1)}N` : 'N (normal)'}
                </text>

                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2={verticalArrowLength}
                  stroke="#f472b6"
                  strokeWidth="2.5"
                />
                <polygon
                  points={`0,${verticalArrowLength + 6} -4,${verticalArrowLength} 4,${verticalArrowLength}`}
                  fill="#f472b6"
                />
                <text x="7" y={verticalArrowLength + 5} fill="#f472b6" fontSize="9" fontWeight="bold">
                  {isRevealed ? `W = mg = ${weightN.toFixed(1)}N` : 'W = mg (weight)'}
                </text>
              </g>

              {/* Velocity Vector (Cyan) */}
              {Math.abs(displayState.velocityMs) > 0.05 && (
                <g transform="translate(0, -92)">
                  <line
                    x1="0"
                    y1="0"
                    x2={displayState.velocityMs * 6}
                    y2="0"
                    stroke="#38bdf8"
                    strokeWidth="2"
                    strokeDasharray="2 2"
                  />
                  <text
                    x={displayState.velocityMs * 6}
                    y="-4"
                    fill="#38bdf8"
                    fontSize="9"
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {isRevealed ? `v = ${displayState.velocityMs} m/s` : 'v (velocity)'}
                  </text>
                </g>
              )}
            </g>
          </svg>
          <div
            aria-label="Force vector legend"
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
            <span>F_app → solid horizontal: applied force</span>
            <span>f ← solid opposing: friction</span>
            <span>N ↑ solid vertical: normal force</span>
            <span>W ↓ solid vertical: weight</span>
            <span>v ⇢ dashed horizontal: velocity</span>
            <span>● fading dots: motion trace</span>
          </div>
          <p style={{ margin: '6px 2px 0', color: 'var(--text-muted)', fontSize: '10px' }}>
            Position axis: metres · force vectors: newtons · {playbackStatus} ·{' '}
            {isRevealed ? 'calculated motion revealed' : 'calculated motion locked'}
          </p>
        </div>
      }
    />
  );
}
