'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabSliderInput from '../../../lab-shared/LabSliderInput';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import {
  calculateMoonTides,
  MOON_TIDES_MODEL_LIMITATIONS,
  type MoonTidesSceneData,
} from '../../../../lib/science-lab/models/moon-tides';

const VIEW_W = 520;
const VIEW_H = 300;
const EARTH_X = 270;
const EARTH_Y = 150;
const ORBIT_RADIUS = 103;

function normaliseAngle(value: number): number {
  return ((value % 360) + 360) % 360;
}

function phaseDiscPath(angleDeg: number, cx: number, cy: number, radius: number): string {
  const angle = (normaliseAngle(angleDeg) * Math.PI) / 180;
  if (angle <= Math.PI) {
    const controlX = cx + 2 * radius * Math.cos(angle);
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 0 1 ${cx} ${cy + radius} Q ${controlX} ${cy} ${cx} ${cy - radius} Z`;
  }
  const controlX = cx - 2 * radius * Math.cos(angle);
  return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 0 0 ${cx} ${cy + radius} Q ${controlX} ${cy} ${cx} ${cy - radius} Z`;
}

export default function MoonTidesScene({
  sceneData,
  onSceneDataChange,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<MoonTidesSceneData>) {
  const [orbitalAngleDeg, setOrbitalAngleDeg] = useState(sceneData.orbitalAngleDeg ?? 45);
  const [orbitalInclinationDeg, setOrbitalInclinationDeg] = useState(sceneData.orbitalInclinationDeg ?? 5.1);
  const normalInclinationRef = useRef((sceneData.orbitalInclinationDeg ?? 5.1) || 5.1);
  const [isDragging, setIsDragging] = useState(false);
  const orbitRef = useRef<SVGSVGElement | null>(null);
  const result = useMemo(() => calculateMoonTides({
    kind: 'moon-tides',
    orbitalAngleDeg,
    orbitalInclinationDeg,
  }), [orbitalAngleDeg, orbitalInclinationDeg]);

  const setAngle = (value: number) => {
    const next = normaliseAngle(value);
    setOrbitalAngleDeg(next);
    onSceneDataChange?.({ orbitalAngleDeg: next });
  };
  const setInclination = (value: number) => {
    if (value > 0) normalInclinationRef.current = value;
    setOrbitalInclinationDeg(value);
    onSceneDataChange?.({ orbitalInclinationDeg: value });
  };

  useEffect(() => {
    onReadoutChange?.(isRevealed
      ? {
          phaseName: result.phaseName,
          illuminatedPercent: Math.round(result.illuminatedFraction * 100),
          moonHeight: result.moonHeightDeg,
          eclipseStatus: result.eclipseStatus,
          tideType: result.tideType,
          tideRange: result.tideRangeMetres,
        }
      : {});
  }, [isRevealed, onReadoutChange, result]);

  const updateFromPointer = (event: ReactPointerEvent<SVGElement>) => {
    if (!orbitRef.current) return;
    const rect = orbitRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
    const offsetX = (rect.width - VIEW_W * scale) / 2;
    const offsetY = (rect.height - VIEW_H * scale) / 2;
    const x = (event.clientX - rect.left - offsetX) / scale;
    const y = (event.clientY - rect.top - offsetY) / scale;
    const angle = (Math.atan2(-(y - EARTH_Y), -(x - EARTH_X)) * 180) / Math.PI;
    setAngle(angle);
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    event.stopPropagation();
    setIsDragging(true);
    orbitRef.current?.setPointerCapture?.(event.pointerId);
    updateFromPointer(event);
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (isDragging) updateFromPointer(event);
  };
  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };
  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setAngle(orbitalAngleDeg + (event.shiftKey ? 15 : 1));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setAngle(orbitalAngleDeg - (event.shiftKey ? 15 : 1));
    }
  };

  const angleRad = (orbitalAngleDeg * Math.PI) / 180;
  const moonX = EARTH_X - ORBIT_RADIUS * Math.cos(angleRad);
  const moonY = EARTH_Y - ORBIT_RADIUS * Math.sin(angleRad);
  const nodeRad = (result.nodeLongitudeDeg * Math.PI) / 180;
  const nodeDx = ORBIT_RADIUS * Math.cos(nodeRad);
  const nodeDy = ORBIT_RADIUS * Math.sin(nodeRad);
  const phasePath = phaseDiscPath(orbitalAngleDeg, 120, 105, 48);
  const tidePoints = result.tideCurve.map((point) => {
    const x = 54 + (point.hour / 24) * 424;
    const y = 180 - ((point.heightMetres - 0.6) / 2.8) * 132;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard
            title="Moon orbit controls"
            description="Drag the Moon in the top view, use arrow keys, or set the angle with the slider."
          >
            <LabSliderInput
              id="orbitalAngleDeg"
              label="Moon Orbital Angle"
              ariaLabel="Moon orbital angle in degrees"
              value={orbitalAngleDeg}
              min={0}
              max={359}
              step={1}
              decimals={0}
              valueSuffix="°"
              onChange={setAngle}
            />
            <LabSliderInput
              id="orbitalInclinationDeg"
              label="Orbital Inclination"
              ariaLabel="Moon orbital inclination in degrees"
              value={orbitalInclinationDeg}
              min={0}
              max={10}
              step={0.1}
              decimals={1}
              valueSuffix="°"
              onChange={setInclination}
            />
            <button
              id="zeroInclinationToggle"
              type="button"
              aria-label="Zero orbital inclination counterfactual"
              aria-pressed={orbitalInclinationDeg === 0}
              onClick={() => setInclination(
                orbitalInclinationDeg === 0 ? normalInclinationRef.current : 0,
              )}
              style={{
                width: '100%',
                marginTop: '8px',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: orbitalInclinationDeg === 0 ? '#7c3aed33' : 'var(--bg-primary)',
                color: orbitalInclinationDeg === 0 ? '#a78bfa' : 'var(--text-primary)',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {orbitalInclinationDeg === 0
                ? 'Zero Inclination (Counterfactual): ON — restore normal orbit inclination'
                : 'Zero Inclination (Counterfactual): OFF — remove orbital tilt'}
            </button>
            <div
              role="group"
              aria-label="Moon phase position presets"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' }}
            >
              {[
                { label: 'New (0°)', angle: 0 },
                { label: 'First quarter (90°)', angle: 90 },
                { label: 'Full (180°)', angle: 180 },
                { label: 'Third quarter (270°)', angle: 270 },
              ].map((preset) => (
                <button
                  key={preset.angle}
                  type="button"
                  aria-pressed={orbitalAngleDeg === preset.angle}
                  onClick={() => setAngle(preset.angle)}
                  style={{
                    padding: '7px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: orbitalAngleDeg === preset.angle ? '#7c3aed33' : 'var(--bg-primary)',
                    color: orbitalAngleDeg === preset.angle ? '#a78bfa' : 'var(--text-primary)',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </LabControlCard>

          <LabControlCard title="Eclipse checkpoint" compact>
            <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700, lineHeight: 1.4 }}>
              An eclipse needs two conditions: New/Full Moon alignment <em>and</em> proximity to the orbit-node plane.
            </p>
            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.4 }}>
              The usual ≈5° inclination makes the shadow miss during most monthly New and Full Moons. A 0° orbit is a useful counterfactual, not the real orbit.
            </p>
          </LabControlCard>

          <LabControlCard title="Scientific limits" compact>
            <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.45 }}>
              {MOON_TIDES_MODEL_LIMITATIONS.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          </LabControlCard>
        </div>
      }
      visual={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="glass-panel" style={{ padding: '12px' }}>
            <svg
              ref={orbitRef}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className="science-scene-svg"
              role="img"
              tabIndex={0}
              aria-label={isRevealed
                ? `Top view of the Sun, Earth and Moon at ${orbitalAngleDeg.toFixed(0)} degrees. ${result.eclipseExplanation}`
                : 'Interactive top view of the Sun, Earth, inclined lunar orbit and node line. Exact alignment result is hidden until prediction submission.'}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onKeyDown={handleKeyDown}
            >
              <title>Draggable top view of Moon orbit and eclipse geometry</title>
              <defs>
                <radialGradient id="sun-glow">
                  <stop offset="0" stopColor="#fef08a" />
                  <stop offset="1" stopColor="#f59e0b" />
                </radialGradient>
                <marker id="sun-ray-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#f59e0b" />
                </marker>
              </defs>
              <rect x="1" y="1" width="518" height="298" rx="12" fill="#07111f" stroke="var(--border-color)" />
              <text x="260" y="22" textAnchor="middle" fill="#f8fafc" fontSize="14" fontWeight="700">Top view: phase alignment + orbit nodes</text>
              <circle cx="48" cy="150" r="29" fill="url(#sun-glow)" stroke="#fde047" strokeWidth="2" />
              <text x="48" y="190" textAnchor="middle" fill="#fde68a" fontSize="10">Sun</text>
              {[112, 150, 188].map((y) => <line key={y} x1="80" y1={y} x2="232" y2={y} stroke="#f59e0b" strokeOpacity="0.5" markerEnd="url(#sun-ray-arrow)" />)}
              <path d="M288 138 L500 116 L500 184 L288 162 Z" fill="#0f172a" stroke="#475569" strokeDasharray="5 4" />
              <text x="425" y="107" textAnchor="middle" fill="#94a3b8" fontSize="9">Earth shadow region (rescaled)</text>
              <circle cx={EARTH_X} cy={EARTH_Y} r="21" fill="#2563eb" stroke="#93c5fd" strokeWidth="2" />
              <path d={`M${EARTH_X - 15} ${EARTH_Y + 4} q12 -12 27 -2 q-6 15 -22 14z`} fill="#22c55e" opacity="0.8" />
              <text x={EARTH_X} y={EARTH_Y + 35} textAnchor="middle" fill="#bfdbfe" fontSize="10">Earth</text>
              <circle cx={EARTH_X} cy={EARTH_Y} r={ORBIT_RADIUS} fill="none" stroke="#a78bfa" strokeWidth="2" strokeDasharray="7 5" />
              <line
                x1={EARTH_X - nodeDx}
                y1={EARTH_Y + nodeDy}
                x2={EARTH_X + nodeDx}
                y2={EARTH_Y - nodeDy}
                stroke="#22c55e"
                strokeWidth="2"
              />
              <text x={EARTH_X + nodeDx + 8} y={EARTH_Y - nodeDy} fill="#86efac" fontSize="9">node</text>
              <g
                transform={`translate(${moonX} ${moonY})`}
                data-science-drag-handle="moon"
                onPointerDown={handlePointerDown}
                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
              >
                <circle r="14" fill="#e2e8f0" stroke="#fff" strokeWidth="2" />
                <circle cx="-4" cy="-3" r="2" fill="#94a3b8" />
                <circle cx="4" cy="5" r="2.5" fill="#94a3b8" />
              </g>
              <text x={moonX} y={moonY - 21} textAnchor="middle" fill="#f8fafc" fontSize="9">Moon</text>
              <g transform="translate(18 278)" fill="#cbd5e1" fontSize="8">
                <circle cx="0" cy="0" r="5" fill="#e2e8f0" />
                <text x="10" y="3">circle = Moon (drag target)</text>
                <line x1="145" y1="0" x2="167" y2="0" stroke="#22c55e" strokeWidth="2" />
                <text x="174" y="3">green line = orbit nodes</text>
                <path d="M330 -5 L352 -2 L352 5 L330 2 Z" fill="#0f172a" stroke="#475569" />
                <text x="360" y="3">wedge = shadow</text>
              </g>
            </svg>
          </div>

          <div className="glass-panel" style={{ padding: '12px' }}>
            <svg
              viewBox="0 0 520 225"
              className="science-scene-svg"
              role="img"
              aria-label={isRevealed
                ? `Earth observer view: ${result.phaseName}, ${Math.round(result.illuminatedFraction * 100)} percent illuminated. ${result.eclipseExplanation}`
                : 'Earth observer view of lunar phase and height relative to the shadow plane; exact readouts are hidden until prediction submission.'}
            >
              <title>Linked Earth-observer phase and shadow-plane view</title>
              <rect x="1" y="1" width="518" height="223" rx="12" fill="var(--bg-primary)" stroke="var(--border-color)" />
              <text x="260" y="22" textAnchor="middle" fill="var(--text-primary)" fontSize="14" fontWeight="700">Earth observer linked view</text>
              <circle cx="120" cy="105" r="50" fill="#111827" stroke="#94a3b8" strokeWidth="2" />
              <path d={phasePath} fill="#f8fafc" />
              <circle cx="104" cy="91" r="5" fill="#94a3b8" opacity="0.35" />
              <circle cx="132" cy="118" r="7" fill="#94a3b8" opacity="0.3" />
              <text x="120" y="174" textAnchor="middle" fill="var(--text-primary)" fontSize="12" fontWeight="700">
                {isRevealed ? result.phaseName : 'Observed phase appearance'}
              </text>
              <text x="120" y="190" textAnchor="middle" fill="var(--text-secondary)" fontSize="9">
                {isRevealed ? `${Math.round(result.illuminatedFraction * 100)}% illuminated` : 'fraction hidden by prediction gate'}
              </text>

              <line x1="270" y1="108" x2="490" y2="108" stroke="#f59e0b" strokeDasharray="6 4" />
              <rect x="332" y="96" width="126" height="24" rx="12" fill="#64748b33" stroke="#64748b" />
              <circle cx="307" cy="108" r="15" fill="#2563eb" stroke="#93c5fd" />
              <circle cx="430" cy={108 - result.moonHeightDeg * 9} r="9" fill="#e2e8f0" stroke="#64748b" />
              <line x1="430" y1="108" x2="430" y2={108 - result.moonHeightDeg * 9} stroke="#a78bfa" strokeDasharray="3 3" />
              <text x="380" y="78" textAnchor="middle" fill="var(--text-secondary)" fontSize="9">side-on height relative to shadow plane</text>
              <text x="380" y="160" textAnchor="middle" fill={isRevealed && result.eclipseStatus.includes('eclipse') ? '#ef4444' : 'var(--text-primary)'} fontSize="11" fontWeight="700">
                {isRevealed ? result.eclipseStatus : 'alignment result hidden'}
              </text>
              <text x="380" y="180" textAnchor="middle" fill="var(--text-secondary)" fontSize="9">
                dashed line = ecliptic plane · purple segment = Moon height
              </text>
            </svg>
          </div>

          <div className="glass-panel" style={{ padding: '12px' }}>
            <svg
              viewBox="0 0 520 225"
              className="science-scene-svg"
              role="img"
              aria-label={isRevealed
                ? `${result.tideType} tide teaching graph across 24 hours with a ${result.tideRangeMetres.toFixed(2)} metre modelled range.`
                : 'Spring and neap tide graph with hour and idealised tide-height axes; curve is hidden until prediction submission.'}
            >
              <title>Spring-neap tide graph linked to Moon angle</title>
              <rect x="1" y="1" width="518" height="223" rx="12" fill="var(--bg-primary)" stroke="var(--border-color)" />
              <text x="260" y="22" textAnchor="middle" fill="var(--text-primary)" fontSize="14" fontWeight="700">Idealised spring–neap tide response</text>
              <line x1="54" y1="180" x2="478" y2="180" stroke="var(--text-secondary)" />
              <line x1="54" y1="42" x2="54" y2="180" stroke="var(--text-secondary)" />
              {[0, 6, 12, 18, 24].map((hour) => (
                <g key={hour}>
                  <line x1={54 + (hour / 24) * 424} y1="180" x2={54 + (hour / 24) * 424} y2="185" stroke="var(--text-secondary)" />
                  <text x={54 + (hour / 24) * 424} y="198" textAnchor="middle" fill="var(--text-secondary)" fontSize="8">{hour}</text>
                </g>
              ))}
              {[1, 2, 3].map((height) => (
                <g key={height}>
                  <line x1="49" y1={180 - ((height - 0.6) / 2.8) * 132} x2="54" y2={180 - ((height - 0.6) / 2.8) * 132} stroke="var(--text-secondary)" />
                  <text x="45" y={183 - ((height - 0.6) / 2.8) * 132} textAnchor="end" fill="var(--text-secondary)" fontSize="8">{height}</text>
                </g>
              ))}
              <text x="266" y="215" textAnchor="middle" fill="var(--text-secondary)" fontSize="10">Time (hours)</text>
              <text x="14" y="112" textAnchor="middle" transform="rotate(-90 14 112)" fill="var(--text-secondary)" fontSize="10">Idealised tide height (m)</text>
              {isRevealed ? (
                <>
                  <polyline points={tidePoints} fill="none" stroke="#06b6d4" strokeWidth="3" />
                  <rect x="337" y="29" width="151" height="33" rx="7" fill="#0f172acc" stroke="#475569" />
                  <text x="347" y="43" fill="#f8fafc" fontSize="9">Pattern: {result.tideType} tide</text>
                  <text x="347" y="56" fill="#67e8f9" fontSize="9">Model range: {result.tideRangeMetres.toFixed(2)} m</text>
                </>
              ) : (
                <text x="266" y="116" textAnchor="middle" fill="var(--text-secondary)" fontSize="11">Tide curve hidden by prediction gate</text>
              )}
              <g transform="translate(75 34)" fill="var(--text-secondary)" fontSize="8">
                <line x1="0" y1="0" x2="22" y2="0" stroke="#06b6d4" strokeWidth="3" />
                <text x="28" y="3">cyan line = combined lunar + solar tide proxy</text>
              </g>
            </svg>
          </div>
        </div>
      }
    />
  );
}
