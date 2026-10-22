'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import type { SeasonsSceneData } from '../../../../lib/science-lab/activity-types';
import { calculateSolarGeometry } from '../../../../lib/science-lab/models/seasons';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSliderInput from '../../../lab-shared/LabSliderInput';

export default function SeasonsScene({
  sceneData,
  onSceneDataChange,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<SeasonsSceneData>) {
  const [dayOfYear, setDayOfYear] = useState(sceneData.dayOfYear ?? 355);
  const [axialTiltDeg, setAxialTiltDeg] = useState(sceneData.axialTiltDeg ?? 23.5);
  const [latitudeDeg, setLatitudeDeg] = useState(sceneData.latitudeDeg ?? -27.5);
  const [isZeroTilt, setIsZeroTilt] = useState(false);

  const svgOrbitRef = useRef<SVGSVGElement | null>(null);
  const [isDraggingOrbit, setIsDraggingOrbit] = useState(false);

  const effectiveTilt = isZeroTilt ? 0 : axialTiltDeg;

  // Keep derived geometry referentially stable so publishing a readout to the
  // parent cannot retrigger this effect indefinitely on an otherwise unchanged scene.
  const geometry = useMemo(
    () => calculateSolarGeometry(dayOfYear, latitudeDeg, effectiveTilt),
    [dayOfYear, latitudeDeg, effectiveTilt],
  );

  useEffect(() => {
    onReadoutChange?.(isRevealed
      ? {
          monthName: `${geometry.monthName} (Day ${geometry.dayOfYear})`,
          solarAltitude: geometry.noonSolarAltitudeDeg,
          daylightHours: geometry.daylightHours,
          solarIntensity: geometry.solarIntensityPercent,
          seasonSouthern: `${geometry.southernSeason} (South) / ${geometry.northernSeason} (North)`,
        }
      : {});
  }, [geometry, isRevealed, onReadoutChange]);

  const handleDayChange = useCallback(
    (newDay: number) => {
      const d = Math.max(1, Math.min(365, Math.round(newDay)));
      setDayOfYear(d);
      if (onSceneDataChange) {
        onSceneDataChange({ dayOfYear: d });
      }
    },
    [onSceneDataChange],
  );

  const handleTiltChange = useCallback(
    (newTilt: number) => {
      // Editing the tilt is an explicit choice, so it leaves the zero-tilt
      // counterfactual rather than being silently ignored.
      setIsZeroTilt(false);
      setAxialTiltDeg(newTilt);
      if (onSceneDataChange) {
        onSceneDataChange({ axialTiltDeg: newTilt });
      }
    },
    [onSceneDataChange],
  );

  const handleLatitudeChange = useCallback(
    (newLat: number) => {
      setLatitudeDeg(newLat);
      if (onSceneDataChange) {
        onSceneDataChange({ latitudeDeg: newLat });
      }
    },
    [onSceneDataChange],
  );

  // Top-down orbital view geometry. Earth must travel along the SAME ellipse
  // that is drawn, so the drawn path and the draggable node cannot diverge.
  const ORBIT_RX = 150;
  const ORBIT_RY = 105;
  const ORBIT_CX = 215;
  const ORBIT_CY = 155;
  const ORBIT_VIEW_W = 430;
  const ORBIT_VIEW_H = 310;

  // Only the Earth node starts a drag. The focusable SVG remains the keyboard
  // slider alternative and receives captured move/up events after a real drag starts.
  const handleOrbitPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    e.stopPropagation();
    setIsDraggingOrbit(true);
    svgOrbitRef.current?.setPointerCapture?.(e.pointerId);
  };
  const handleOrbitPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    setIsDraggingOrbit(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
  };

  const handleOrbitPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDraggingOrbit || !svgOrbitRef.current) return;
    const rect = svgOrbitRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Map client coords into viewBox units, then normalise by the ellipse radii
    // so atan2 yields the ellipse's parametric angle rather than a screen angle.
    const scale = Math.min(rect.width / ORBIT_VIEW_W, rect.height / ORBIT_VIEW_H);
    const offsetX = (rect.width - ORBIT_VIEW_W * scale) / 2;
    const offsetY = (rect.height - ORBIT_VIEW_H * scale) / 2;
    const vx = (e.clientX - rect.left - offsetX) / scale;
    const vy = (e.clientY - rect.top - offsetY) / scale;

    let angleRad = Math.atan2((vy - ORBIT_CY) / ORBIT_RY, (vx - ORBIT_CX) / ORBIT_RX);
    if (angleRad < 0) angleRad += 2 * Math.PI;

    // Angle 0 is the March equinox (day 80), matching calculateSolarGeometry.
    let day = Math.round((angleRad / (2 * Math.PI)) * 365) + 80;
    if (day > 365) day -= 365;
    handleDayChange(day);
  };

  // Keyboard navigation: step month by month (Shift) or day by day
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      handleDayChange(dayOfYear + (e.shiftKey ? 30 : 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      handleDayChange(dayOfYear - (e.shiftKey ? 30 : 1));
    }
  };

  const earthOrbitX = ORBIT_CX + ORBIT_RX * Math.cos(geometry.orbitalAngleRad);
  const earthOrbitY = ORBIT_CY + ORBIT_RY * Math.sin(geometry.orbitalAngleRad);

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Orbital & Planetary Controls">
            <LabSliderInput
              id="dayOfYear"
              label="Day of Year"
              ariaLabel="Day of year slider"
              value={dayOfYear}
              min={1}
              max={365}
              step={1}
              decimals={0}
              onChange={handleDayChange}
            />

            {/* Quick Solstice & Equinox Jumps */}
            <div
              role="group"
              aria-label="Solstice and equinox date presets"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' }}
            >
              <button
                type="button"
                aria-pressed={dayOfYear === 355}
                onClick={() => handleDayChange(355)}
                style={{
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: dayOfYear === 355 ? 'var(--accent-color, #10b981)' : 'var(--bg-primary)',
                  color: dayOfYear === 355 ? '#fff' : 'var(--text-primary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ☀️ Dec Solstice (Day 355)
              </button>
              <button
                type="button"
                aria-pressed={dayOfYear === 172}
                onClick={() => handleDayChange(172)}
                style={{
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: dayOfYear === 172 ? 'var(--accent-color, #10b981)' : 'var(--bg-primary)',
                  color: dayOfYear === 172 ? '#fff' : 'var(--text-primary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ❄️ Jun Solstice (Day 172)
              </button>
              <button
                type="button"
                aria-pressed={dayOfYear === 80}
                onClick={() => handleDayChange(80)}
                style={{
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: dayOfYear === 80 ? 'var(--accent-color, #10b981)' : 'var(--bg-primary)',
                  color: dayOfYear === 80 ? '#fff' : 'var(--text-primary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🌱 Mar Equinox (Day 80)
              </button>
              <button
                type="button"
                aria-pressed={dayOfYear === 264}
                onClick={() => handleDayChange(264)}
                style={{
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: dayOfYear === 264 ? 'var(--accent-color, #10b981)' : 'var(--bg-primary)',
                  color: dayOfYear === 264 ? '#fff' : 'var(--text-primary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🍂 Sep Equinox (Day 264)
              </button>
            </div>
          </LabControlCard>

          <LabControlCard title="Axial Tilt & Latitude">
            <LabSliderInput
              id="axialTiltDeg"
              label="Axial Tilt"
              ariaLabel="Axial tilt in degrees"
              value={effectiveTilt}
              min={0}
              max={45}
              step={0.5}
              valueSuffix="°"
              onChange={handleTiltChange}
            />

            <div style={{ marginTop: '8px' }}>
              <button
                id="zeroTiltToggle"
                type="button"
                aria-label="Toggle zero tilt counterfactual — zero axial tilt"
                aria-pressed={isZeroTilt}
                onClick={() => setIsZeroTilt((prev) => !prev)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: isZeroTilt ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg-primary)',
                  color: isZeroTilt ? '#ef4444' : 'var(--text-primary)',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {isZeroTilt
                  ? `Zero Tilt (Counterfactual): ON — restore tilt (${axialTiltDeg.toFixed(1)}°)`
                  : 'Zero Tilt (Counterfactual): OFF — set tilt to 0.0°'}
              </button>
            </div>

            <div style={{ marginTop: '12px' }}>
              <LabSliderInput
                id="latitudeDeg"
                label="Observer Latitude"
                ariaLabel="Observer latitude in degrees"
                value={latitudeDeg}
                min={-90}
                max={90}
                step={0.5}
                valueSuffix="°"
                onChange={handleLatitudeChange}
              />
            </div>
          </LabControlCard>
        </div>
      }
      visual={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Linked View 1: Top-down orbital view */}
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
                View 1: Orbit Top-Down View (Drag Earth or use Arrow Keys)
              </h4>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {geometry.monthName} · Day {geometry.dayOfYear}
              </span>
            </div>

            <svg
              ref={svgOrbitRef}
              viewBox={`0 0 ${ORBIT_VIEW_W} ${ORBIT_VIEW_H}`}
              className="science-scene-svg"
              style={{
                background: '#0b1120',
                borderRadius: '12px',
              }}
              tabIndex={0}
              role="img"
              aria-label={
                isRevealed
                  ? `Interactive top-down orbit. Currently ${geometry.monthName}, day ${geometry.dayOfYear}, with ${effectiveTilt.toFixed(1)} degrees axial tilt. Southern hemisphere season ${geometry.southernSeason}; northern hemisphere season ${geometry.northernSeason}. Use arrow keys to change the date, or hold Shift to step by month.`
                  : `Interactive top-down orbit. Currently ${geometry.monthName}, day ${geometry.dayOfYear}, with ${effectiveTilt.toFixed(1)} degrees axial tilt. Hemisphere season outcomes are hidden until prediction is submitted. Use arrow keys to change the date, or hold Shift to step by month.`
              }
              onPointerUp={handleOrbitPointerUp}
              onPointerCancel={handleOrbitPointerUp}
              onPointerMove={handleOrbitPointerMove}
              onKeyDown={handleKeyDown}
            >
              <title>
                {isRevealed
                  ? `Earth orbit and hemisphere seasons on day ${geometry.dayOfYear}`
                  : `Earth orbit position on day ${geometry.dayOfYear}; season results locked`}
              </title>
              <defs>
                <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#fef08a" />
                  <stop offset="60%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#b45309" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Orbit path — Earth is constrained to this exact ellipse */}
              <ellipse
                cx={ORBIT_CX}
                cy={ORBIT_CY}
                rx={ORBIT_RX}
                ry={ORBIT_RY}
                fill="none"
                stroke="#475569"
                strokeWidth="2"
                strokeDasharray="6 5"
              />

              {/* Solstice & Equinox Markers, offset clear of the orbit path */}
              <text x={ORBIT_CX + ORBIT_RX + 8} y={ORBIT_CY + 4} fill="#94a3b8" fontSize="12">Mar</text>
              <text x={ORBIT_CX - ORBIT_RX - 34} y={ORBIT_CY + 4} fill="#94a3b8" fontSize="12">Sep</text>
              <text x={ORBIT_CX - 30} y={ORBIT_CY - ORBIT_RY - 12} fill="#94a3b8" fontSize="12">Jun solstice</text>
              <text x={ORBIT_CX - 30} y={ORBIT_CY + ORBIT_RY + 22} fill="#94a3b8" fontSize="12">Dec solstice</text>

              {/* Sun in centre */}
              <circle cx={ORBIT_CX} cy={ORBIT_CY} r="40" fill="url(#sunGlow)" />
              <circle cx={ORBIT_CX} cy={ORBIT_CY} r="19" fill="#fbbf24" />
              <text x={ORBIT_CX} y={ORBIT_CY + 4} textAnchor="middle" fill="#78350f" fontSize="11" fontWeight="bold">Sun</text>

              {/* Earth drag node. The axis keeps a fixed direction in space
                  (axial parallelism), which is the point of step 1. */}
              <g
                transform={`translate(${earthOrbitX}, ${earthOrbitY})`}
                data-science-drag-handle="earth"
                onPointerDown={handleOrbitPointerDown}
                style={{ cursor: isDraggingOrbit ? 'grabbing' : 'grab' }}
              >
                <circle r="15" fill="#3b82f6" stroke="#93c5fd" strokeWidth="2.5" />
                <line
                  x1={-Math.sin((effectiveTilt * Math.PI) / 180) * 22}
                  y1={-22}
                  x2={Math.sin((effectiveTilt * Math.PI) / 180) * 22}
                  y2={22}
                  stroke="#ef4444"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <circle r="3.5" fill="#f8fafc" />
              </g>
            </svg>
          </div>

          {/* Linked View 2: Side Cross-Section & Insolation Angle */}
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
                View 2: Earth Axial Tilt Cross-Section & Solar Angle
              </h4>
              <span style={{ fontSize: '11px', fontWeight: 700, color: isRevealed ? '#10b981' : 'var(--text-muted)' }}>
                {isRevealed ? `Noon Solar Angle: ${geometry.noonSolarAltitudeDeg}°` : 'Noon Solar Angle: 🔒'}
              </span>
            </div>

            <svg
              viewBox="0 0 430 250"
              className="science-scene-svg"
              style={{
                background: '#0f172a',
                borderRadius: '12px',
              }}
              role="img"
              aria-label={
                isRevealed
                  ? `Side cross section of Earth with a ${effectiveTilt.toFixed(1)} degree axial tilt. The observer at latitude ${latitudeDeg.toFixed(1)} degrees sees a noon solar altitude of ${geometry.noonSolarAltitudeDeg} degrees. Southern hemisphere season ${geometry.southernSeason}; northern hemisphere season ${geometry.northernSeason}.`
                  : `Side cross section of Earth with a ${effectiveTilt.toFixed(1)} degree axial tilt and the observer marked at latitude ${latitudeDeg.toFixed(1)} degrees. Solar angle and hemisphere season outcomes are hidden until a prediction is submitted.`
              }
            >
              <title>
                {isRevealed
                  ? `Axial tilt, observer latitude, and solar angle on day ${geometry.dayOfYear}`
                  : 'Axial tilt and observer latitude; solar result locked'}
              </title>
              {/* Incident sunlight rays from the left */}
              <line x1="14" y1="60" x2="140" y2="60" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="4 4" />
              <line x1="14" y1="125" x2="155" y2="125" stroke="#f59e0b" strokeWidth="3.5" />
              <line x1="14" y1="190" x2="140" y2="190" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="4 4" />
              <text x="16" y="34" fill="#fbbf24" fontSize="13" fontWeight="bold">Direct solar rays ➔</text>

              {/* Earth sphere in cross section */}
              <g transform="translate(265, 125)">
                <circle r="80" fill="#1e3a8a" stroke="#60a5fa" strokeWidth="2.5" />

                {/* Night side (away from the Sun, i.e. the right-hand limb) */}
                <path d="M 0 -80 A 80 80 0 0 1 0 80 Z" fill="rgba(0,0,0,0.5)" />

                {/* Tilted rotation axis. Positive tilt leans the North pole away
                    from the viewer's left, matching the orbit view. */}
                <g transform={`rotate(${effectiveTilt})`}>
                  <line x1="0" y1="-100" x2="0" y2="100" stroke="#ef4444" strokeWidth="3" />
                  <text x="6" y="-86" fill="#f87171" fontSize="12" fontWeight="bold">N</text>
                  <text x="6" y="96" fill="#f87171" fontSize="12" fontWeight="bold">S</text>

                  {/* Equator */}
                  <line x1="-80" y1="0" x2="80" y2="0" stroke="#38bdf8" strokeWidth="2" strokeDasharray="4 4" />

                  {/* Observer marker. SVG rotation is clockwise and screen-y
                      grows downward, so a NEGATIVE (southern) latitude must be
                      drawn BELOW the equator: rotate by -latitude. */}
                  <g transform={`rotate(${-latitudeDeg})`}>
                    <circle cx="80" cy="0" r="5.5" fill="#fbbf24" stroke="#fff" strokeWidth="2" />
                    <text x="90" y="4" fill="#fbbf24" fontSize="12" fontWeight="bold">
                      Observer {latitudeDeg.toFixed(1)}°
                    </text>
                  </g>
                </g>
              </g>
            </svg>
            <div
              aria-label="Hemisphere and marker legend"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px 14px',
                marginTop: '8px',
                color: 'var(--text-secondary)',
                fontSize: '10px',
              }}
            >
              <span>N ↑ northern hemisphere / north pole</span>
              <span>S ↓ southern hemisphere / south pole</span>
              <span>● Observer marker at selected latitude</span>
              <span>⇢ Dashed and solid rays show incident sunlight</span>
            </div>
          </div>
        </div>
      }
    />
  );
}
