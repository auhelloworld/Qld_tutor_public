'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlateBoundarySceneData } from '../../../../lib/science-lab/activity-types';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import {
  calculatePlateBoundary,
  type PlateBoundaryType,
} from '../../../../lib/science-lab/models/plate-boundary';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSliderInput from '../../../lab-shared/LabSliderInput';

type PlateDataView = PlateBoundarySceneData & {
  leftDensityGcm3?: number;
  rightDensityGcm3?: number;
};

const BOUNDARY_TYPES: PlateBoundaryType[] = ['divergent', 'convergent', 'transform'];

function boundaryButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 9px',
    borderRadius: '7px',
    border: '1px solid var(--border-color)',
    background: active ? 'rgba(234, 88, 12, 0.16)' : 'var(--bg-primary)',
    color: active ? '#ea580c' : 'var(--text-primary)',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'capitalize',
    cursor: 'pointer',
  };
}

export default function PlateBoundaryScene({
  sceneData,
  onSceneDataChange,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<PlateBoundarySceneData>) {
  const data = sceneData as PlateDataView;
  const [boundaryType, setBoundaryType] = useState<PlateBoundaryType>(data.boundaryType ?? 'divergent');
  const [plateSpeedCmPerYear, setPlateSpeed] = useState(data.plateSpeedCmPerYear);
  const [leftDensityGcm3, setLeftDensity] = useState(data.leftDensityGcm3 ?? 2.9);
  const [rightDensityGcm3, setRightDensity] = useState(data.rightDensityGcm3 ?? 2.7);

  const result = useMemo(() => calculatePlateBoundary({
    boundaryType,
    plateSpeedCmPerYear,
    leftDensityGcm3,
    rightDensityGcm3,
  }), [boundaryType, leftDensityGcm3, plateSpeedCmPerYear, rightDensityGcm3]);

  const emitPatch = useCallback((patch: Partial<PlateDataView>) => {
    onSceneDataChange?.(patch as Partial<PlateBoundarySceneData>);
  }, [onSceneDataChange]);

  useEffect(() => {
    onReadoutChange?.(isRevealed
      ? {
          boundaryType,
          maximumEarthquakeDepthKm: result.maximumEarthquakeDepthKm,
          volcanoPattern: result.volcanoPattern,
          edgeCrustAgeMa: result.edgeCrustAgeMa,
          magneticStripePattern: result.magneticStripePattern,
          subductingPlate: result.subductingPlate,
        }
      : {});
  }, [boundaryType, isRevealed, onReadoutChange, result]);

  const selectBoundary = (type: PlateBoundaryType) => {
    setBoundaryType(type);
    emitPatch({ boundaryType: type });
  };

  const maximumAge = Math.max(...result.crustAgeProfile.map((point) => point.ageMa), 1);
  const agePoints = result.crustAgeProfile.map((point) => {
    const x = 408 + ((point.distanceKm + 200) / 400) * 275;
    const y = 480 - (point.ageMa / maximumAge) * 82;
    return `${x},${y}`;
  }).join(' ');
  const leftSubducts = result.subductingPlate === 'left';

  const quakePoints = boundaryType === 'convergent'
    ? Array.from({ length: 6 }, (_, index) => ({ x: leftSubducts ? 340 + index * 35 : 380 - index * 35, y: 210 + index * 18 }))
    : boundaryType === 'divergent'
      ? [{ x: 345, y: 205 }, { x: 375, y: 210 }, { x: 360, y: 225 }]
      : [{ x: 330, y: 205 }, { x: 350, y: 230 }, { x: 370, y: 215 }, { x: 392, y: 238 }];

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Boundary type">
            <div role="group" aria-label="Plate boundary type" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' }}>
              {BOUNDARY_TYPES.map((type) => (
                <button key={type} type="button" aria-pressed={boundaryType === type} onClick={() => selectBoundary(type)} style={boundaryButtonStyle(boundaryType === type)}>{type}</button>
              ))}
            </div>
          </LabControlCard>

          <LabControlCard title="Plate motion">
            <LabSliderInput
              id="plateSpeedCmPerYear"
              label="Plate Speed"
              ariaLabel="Plate speed in centimetres per year — relative plate speed"
              value={plateSpeedCmPerYear}
              min={1}
              max={12}
              step={1}
              decimals={0}
              valueSuffix=" cm/yr"
              onChange={(value) => { setPlateSpeed(value); emitPatch({ plateSpeedCmPerYear: value }); }}
            />
          </LabControlCard>

          <LabControlCard title="Plate density comparison" description="Density changes which plate can descend at a convergent boundary.">
            <LabSliderInput
              id="plate-left-density"
              label="Left plate density"
              ariaLabel="Left plate density in grams per cubic centimetre"
              value={leftDensityGcm3}
              min={2.6}
              max={3.3}
              step={0.1}
              decimals={1}
              valueSuffix=" g/cm³"
              onChange={(value) => { setLeftDensity(value); emitPatch({ leftDensityGcm3: value }); }}
            />
            <div style={{ marginTop: '12px' }}>
              <LabSliderInput
                id="plate-right-density"
                label="Right plate density"
                ariaLabel="Right plate density in grams per cubic centimetre"
                value={rightDensityGcm3}
                min={2.6}
                max={3.3}
                step={0.1}
                decimals={1}
                valueSuffix=" g/cm³"
                onChange={(value) => { setRightDensity(value); emitPatch({ rightDensityGcm3: value }); }}
              />
            </div>
          </LabControlCard>
        </div>
      }
      visual={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          <div className="glass-panel" style={{ padding: '14px', borderRadius: '14px', background: 'var(--bg-secondary)' }}>
            <svg
              viewBox="0 0 720 525"
              className="science-scene-svg"
              role="img"
              aria-label={isRevealed
                ? `${boundaryType} plate boundary at ${plateSpeedCmPerYear} centimetres per year. ${result.earthquakePattern} ${result.volcanoPattern} ${result.crustProcess} ${result.magneticStripePattern}`
                : `${boundaryType} plate-motion cross section at ${plateSpeedCmPerYear} centimetres per year. Earthquake, volcano, crust-age and magnetic-stripe evidence is hidden until the prediction is submitted.`}
              style={{ background: '#0f172a', borderRadius: '12px' }}
            >
              <title>{isRevealed ? `${boundaryType} boundary cross-section and linked geological evidence` : `${boundaryType} plate motion with evidence locked`}</title>
              <defs>
                <marker id="plate-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#f8fafc" /></marker>
                <linearGradient id="plate-mantle" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#9a3412" /><stop offset="100%" stopColor="#431407" /></linearGradient>
              </defs>
              <text x="24" y="30" fill="#f8fafc" fontSize="16" fontWeight="bold">Plate boundary cross-section</text>
              <text x="24" y="50" fill="#94a3b8" fontSize="11">Arrow length represents relative speed; density controls subduction.</text>

              <rect x="25" y="185" width="670" height="135" rx="8" fill="url(#plate-mantle)" />
              <text x="360" y="304" textAnchor="middle" fill="#fed7aa" fontSize="12" fontWeight="bold">HOT, MOSTLY SOLID MANTLE ROCK — slowly flowing, NOT a liquid ocean</text>

              {boundaryType === 'divergent' && <g>
                <path d="M25 145 H320 L345 185 H25 Z" fill="#334155" stroke="#94a3b8" strokeWidth="2" />
                <path d="M695 145 H400 L375 185 H695 Z" fill="#334155" stroke="#94a3b8" strokeWidth="2" />
                <path d="M342 185 Q360 125 378 185 Z" fill="#f97316" stroke="#fdba74" strokeWidth="2" />
                <line x1="310" y1="115" x2={310 - plateSpeedCmPerYear * 7} y2="115" stroke="#f8fafc" strokeWidth="5" markerEnd="url(#plate-arrow)" />
                <line x1="410" y1="115" x2={410 + plateSpeedCmPerYear * 7} y2="115" stroke="#f8fafc" strokeWidth="5" markerEnd="url(#plate-arrow)" />
                <text x="360" y="92" textAnchor="middle" fill="#fdba74" fontSize="11">ridge / new crust</text>
              </g>}

              {boundaryType === 'convergent' && <g>
                {result.subductingPlate === 'neither' ? <>
                  <path d="M25 150 H320 L360 125 L400 150 H695 V190 H25 Z" fill="#475569" stroke="#cbd5e1" strokeWidth="2" />
                  <path d="M320 150 L360 110 L400 150" fill="#64748b" stroke="#cbd5e1" strokeWidth="2" />
                </> : leftSubducts ? <>
                  <path d="M25 145 H340 L600 290 L560 300 L315 185 H25 Z" fill="#334155" stroke="#93c5fd" strokeWidth="2" />
                  <path d="M695 145 H370 L335 185 H695 Z" fill="#475569" stroke="#cbd5e1" strokeWidth="2" />
                  <path d="M475 190 Q500 150 515 115 Q530 150 550 190" fill="#f97316" stroke="#fdba74" strokeWidth="2" />
                </> : <>
                  <path d="M695 145 H380 L120 290 L160 300 L405 185 H695 Z" fill="#334155" stroke="#93c5fd" strokeWidth="2" />
                  <path d="M25 145 H350 L385 185 H25 Z" fill="#475569" stroke="#cbd5e1" strokeWidth="2" />
                  <path d="M170 190 Q190 150 205 115 Q220 150 245 190" fill="#f97316" stroke="#fdba74" strokeWidth="2" />
                </>}
                <line x1={250 - plateSpeedCmPerYear * 4} y1="112" x2="320" y2="112" stroke="#f8fafc" strokeWidth="5" markerEnd="url(#plate-arrow)" />
                <line x1={470 + plateSpeedCmPerYear * 4} y1="112" x2="400" y2="112" stroke="#f8fafc" strokeWidth="5" markerEnd="url(#plate-arrow)" />
                <text x="360" y="92" textAnchor="middle" fill="#fdba74" fontSize="11">collision / trench zone</text>
              </g>}

              {boundaryType === 'transform' && <g>
                <path d="M25 145 H350 V195 H25 Z" fill="#334155" stroke="#93c5fd" strokeWidth="2" />
                <path d="M370 135 H695 V185 H370 Z" fill="#475569" stroke="#cbd5e1" strokeWidth="2" />
                <line x1="360" y1="120" x2="360" y2="270" stroke="#fbbf24" strokeWidth="4" strokeDasharray="8 5" />
                <line x1="250" y1="112" x2={250 + plateSpeedCmPerYear * 6} y2="112" stroke="#f8fafc" strokeWidth="5" markerEnd="url(#plate-arrow)" />
                <line x1="470" y1="218" x2={470 - plateSpeedCmPerYear * 6} y2="218" stroke="#f8fafc" strokeWidth="5" markerEnd="url(#plate-arrow)" />
                <text x="375" y="105" fill="#fde68a" fontSize="11">fault; opposite horizontal motion</text>
              </g>}

              {isRevealed ? <g aria-label="Earthquake and volcano evidence">
                {quakePoints.map((point, index) => <g key={`quake-${index}`} transform={`translate(${point.x}, ${point.y})`}><circle r="6" fill="#facc15" stroke="#713f12" /><path d="M-3 -1 L0 -5 L2 0 L5 2 L1 3 L-1 6 L-2 2 Z" fill="#713f12" /></g>)}
                <text x="35" y="338" fill="#fde68a" fontSize="10">★ earthquakes: max model depth {result.maximumEarthquakeDepthKm} km</text>
                <text x="340" y="338" fill="#fdba74" fontSize="10">▲ orange peaks: magma/volcano sites where expected</text>
              </g> : <g><rect x="180" y="205" width="360" height="46" rx="8" fill="#0f172a" opacity="0.88" stroke="#64748b" /><text x="360" y="233" textAnchor="middle" fill="#cbd5e1" fontSize="12">Earthquake and volcano evidence locked</text></g>}

              <g transform="translate(30, 360)" aria-label="Magnetic stripe evidence">
                <text x="0" y="0" fill="#f8fafc" fontSize="12" fontWeight="bold">Magnetic stripe evidence (plan view)</text>
                {isRevealed ? Array.from({ length: 12 }, (_, index) => {
                  const offset = boundaryType === 'transform' && index >= 6 ? 10 : 0;
                  const opacity = boundaryType === 'convergent' && (index < 2 || index > 9) ? 0.25 : 1;
                  return <rect key={index} x={8 + index * 28} y={18 + offset} width="27" height="34" fill={index % 2 === 0 ? '#7dd3fc' : '#334155'} stroke="#0f172a" opacity={opacity} />;
                }) : <rect x="8" y="18" width="335" height="42" rx="5" fill="#1e293b" stroke="#64748b" strokeDasharray="6 5" />}
                <line x1="176" y1="12" x2="176" y2="66" stroke="#fbbf24" strokeWidth="3" />
                <text x="176" y="80" textAnchor="middle" fill="#94a3b8" fontSize="9">boundary</text>
                <rect x="8" y="92" width="12" height="10" fill="#7dd3fc" /><text x="26" y="101" fill="#cbd5e1" fontSize="9">light band — one polarity</text>
                <rect x="160" y="92" width="12" height="10" fill="#334155" /><text x="178" y="101" fill="#cbd5e1" fontSize="9">dark band — reversed polarity</text>
              </g>

              <g transform="translate(395, 360)" aria-label="Crust age versus distance graph">
                <text x="145" y="0" textAnchor="middle" fill="#f8fafc" fontSize="12" fontWeight="bold">Crust age profile</text>
                <line x1="13" y1="120" x2="288" y2="120" stroke="#cbd5e1" strokeWidth="1.5" />
                <line x1="13" y1="38" x2="13" y2="120" stroke="#cbd5e1" strokeWidth="1.5" />
                <text x="150" y="140" textAnchor="middle" fill="#94a3b8" fontSize="9">Distance from boundary (km)</text>
                <text x="-8" y="80" transform="rotate(-90 -8 80)" textAnchor="middle" fill="#94a3b8" fontSize="9">Age (Ma)</text>
                <text x="13" y="133" textAnchor="middle" fill="#94a3b8" fontSize="8">−200</text>
                <text x="150" y="133" textAnchor="middle" fill="#94a3b8" fontSize="8">0</text>
                <text x="288" y="133" textAnchor="middle" fill="#94a3b8" fontSize="8">200</text>
                <text x="8" y="42" textAnchor="end" fill="#94a3b8" fontSize="8">{isRevealed ? maximumAge : '?'}</text>
                {isRevealed ? <><polyline points={agePoints.split(' ').map((pair) => { const [x, y] = pair.split(',').map(Number); return `${x - 395},${y - 360}`; }).join(' ')} fill="none" stroke="#a78bfa" strokeWidth="3" />{result.crustAgeProfile.map((point) => { const x = 13 + ((point.distanceKm + 200) / 400) * 275; const y = 120 - (point.ageMa / maximumAge) * 82; return <circle key={point.distanceKm} cx={x} cy={y} r="4" fill="#a78bfa" stroke="#ede9fe" />; })}</> : <text x="150" y="82" textAnchor="middle" fill="#94a3b8" fontSize="20">?</text>}
                <line x1="18" y1="156" x2="42" y2="156" stroke="#a78bfa" strokeWidth="3" /><circle cx="30" cy="156" r="3" fill="#a78bfa" /><text x="49" y="160" fill="#cbd5e1" fontSize="9">purple line + points — modelled crust age</text>
              </g>
            </svg>
          </div>

          <div className="glass-panel" aria-live="polite" style={{ padding: '12px 14px', borderRadius: '12px', color: 'var(--text-primary)', fontSize: '12px' }}>
            <strong>Mantle reminder:</strong> {result.mantleStatement}
            {isRevealed
              ? <><br /><strong>Evidence:</strong> {result.earthquakePattern} {result.volcanoPattern} {result.crustProcess} {result.magneticStripePattern}</>
              : <><br /><strong>Prediction gate:</strong> predict the evidence pattern, then submit to reveal earthquake, volcano, crust-age and magnetic-stripe outcomes.</>}
          </div>
        </div>
      }
    />
  );
}
