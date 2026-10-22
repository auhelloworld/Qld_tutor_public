'use client';

import { useEffect, useMemo, useState } from 'react';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabSliderInput from '../../../lab-shared/LabSliderInput';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import {
  calculateCarbonClimate,
  CARBON_CLIMATE_MODEL_LIMITATIONS,
  type CarbonClimateSceneData,
  type CarbonReservoirId,
} from '../../../../lib/science-lab/models/carbon-climate';

type CarbonControlKey = Exclude<keyof CarbonClimateSceneData, 'kind'>;

const reservoirVisuals: Array<{
  id: CarbonReservoirId;
  x: number;
  y: number;
  width: number;
  height: number;
  colour: string;
  shape: 'round' | 'square';
}> = [
  { id: 'atmosphere', x: 190, y: 28, width: 170, height: 64, colour: '#38bdf8', shape: 'round' },
  { id: 'biosphere', x: 24, y: 174, width: 150, height: 74, colour: '#22c55e', shape: 'round' },
  { id: 'hydrosphere', x: 376, y: 174, width: 150, height: 74, colour: '#2563eb', shape: 'round' },
  { id: 'geosphere', x: 190, y: 306, width: 170, height: 64, colour: '#a16207', shape: 'square' },
];

function signed(value: number, suffix: string): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} ${suffix}`;
}

export default function CarbonClimateScene({
  sceneData,
  onSceneDataChange,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<CarbonClimateSceneData>) {
  const [controls, setControls] = useState<CarbonClimateSceneData>({
    kind: 'carbon-climate',
    combustion: sceneData.combustion ?? 50,
    photosynthesis: sceneData.photosynthesis ?? 50,
    oceanUptake: sceneData.oceanUptake ?? 50,
    albedo: sceneData.albedo ?? 0.3,
    greenhouseGasPpm: sceneData.greenhouseGasPpm ?? 420,
  });
  const result = useMemo(() => calculateCarbonClimate(controls), [controls]);

  const changeControl = <K extends CarbonControlKey>(
    key: K,
    value: CarbonClimateSceneData[K],
  ) => {
    setControls((previous) => ({ ...previous, [key]: value }));
    onSceneDataChange?.({ [key]: value } as Partial<CarbonClimateSceneData>);
  };

  useEffect(() => {
    onReadoutChange?.(isRevealed
      ? {
          atmosphericCarbon: result.reservoirs.atmosphere.carbonGt,
          atmosphereChange: result.atmosphericChangeGtPerYear,
          projectedCo2: result.projectedCo2Ppm,
          energyImbalance: result.energyImbalanceWm2,
          temperatureProxy: result.temperatureProxyC,
          climateTendency: result.climateTendency,
        }
      : {});
  }, [isRevealed, onReadoutChange, result]);

  const trajectoryTemperatures = result.trajectory.map((point) => point.temperatureProxyC);
  const minTemperature = Math.min(-1, ...trajectoryTemperatures);
  const maxTemperature = Math.max(1, ...trajectoryTemperatures);
  const temperatureSpan = Math.max(1, maxTemperature - minTemperature);
  const temperaturePoints = result.trajectory
    .map((point) => {
      const x = 58 + (point.year / result.projectionYears) * 432;
      const y = 188 - ((point.temperatureProxyC - minTemperature) / temperatureSpan) * 138;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard
            title="Carbon flux controls"
            description="Change one process at a time, then trace where the carbon moves."
          >
            <LabSliderInput
              id="carbon-combustion"
              label="Combustion rate"
              ariaLabel="Combustion rate index"
              value={controls.combustion}
              min={0}
              max={100}
              step={1}
              decimals={0}
              valueSuffix="%"
              onChange={(value) => changeControl('combustion', value)}
            />
            <LabSliderInput
              id="carbon-photosynthesis"
              label="Photosynthesis capacity"
              ariaLabel="Photosynthesis capacity index"
              value={controls.photosynthesis}
              min={0}
              max={100}
              step={1}
              decimals={0}
              valueSuffix="%"
              onChange={(value) => changeControl('photosynthesis', value)}
            />
            <LabSliderInput
              id="carbon-ocean"
              label="Ocean uptake capacity"
              ariaLabel="Ocean carbon uptake capacity index"
              value={controls.oceanUptake}
              min={0}
              max={100}
              step={1}
              decimals={0}
              valueSuffix="%"
              onChange={(value) => changeControl('oceanUptake', value)}
            />
          </LabControlCard>

          <LabControlCard
            title="Climate-energy controls"
            description="Albedo changes absorbed sunlight; greenhouse gas concentration changes outgoing energy."
          >
            <LabSliderInput
              id="carbon-albedo"
              label="Planetary albedo"
              ariaLabel="Planetary albedo fraction"
              value={controls.albedo}
              min={0.2}
              max={0.45}
              step={0.01}
              decimals={2}
              onChange={(value) => changeControl('albedo', value)}
            />
            <LabSliderInput
              id="greenhouseGasPpm"
              label="Greenhouse Gas Concentration"
              ariaLabel="Atmospheric greenhouse gas concentration"
              value={controls.greenhouseGasPpm}
              min={280}
              max={800}
              step={10}
              decimals={0}
              valueSuffix=" ppm"
              onChange={(value) => changeControl('greenhouseGasPpm', value)}
            />
          </LabControlCard>

          <LabControlCard title="Teaching-model boundaries" compact>
            <p style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700 }}>
              This is an explanatory sensitivity model, not a climate forecast.
            </p>
            <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.45 }}>
              {CARBON_CLIMATE_MODEL_LIMITATIONS.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          </LabControlCard>
        </div>
      }
      visual={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="glass-panel" style={{ padding: '12px' }}>
            <svg
              viewBox="0 0 550 410"
              className="science-scene-svg"
              role="img"
              aria-label={isRevealed
                ? `Linked carbon reservoirs and fluxes. Atmosphere changes ${signed(result.atmosphericChangeGtPerYear, 'gigatonnes of carbon per year')}.`
                : 'Linked atmosphere, biosphere, hydrosphere and geosphere teaching-model reservoirs; numerical results are hidden until prediction submission.'}
            >
              <title>Carbon reservoirs and annual transfer fluxes</title>
              <defs>
                <marker id="carbon-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#64748b" />
                </marker>
              </defs>
              <rect x="1" y="1" width="548" height="408" rx="12" fill="var(--bg-primary)" stroke="var(--border-color)" />
              <text x="275" y="20" textAnchor="middle" fill="var(--text-primary)" fontSize="14" fontWeight="700">
                Carbon cycle: active reservoirs and gross annual fluxes
              </text>

              <g stroke="#64748b" fill="none" markerEnd="url(#carbon-arrow)">
                <path d="M230 306 C210 270, 230 125, 255 92" strokeWidth={isRevealed ? Math.min(8, 2 + result.fluxes[0].rateGtPerYear / 25) : 3} />
                <path d="M230 92 C170 112, 132 140, 114 174" strokeWidth={isRevealed ? Math.min(8, 2 + result.fluxes[1].rateGtPerYear / 35) : 3} />
                <path d="M84 174 C112 128, 165 100, 255 92" strokeDasharray="6 4" strokeWidth={isRevealed ? Math.min(8, 2 + result.fluxes[2].rateGtPerYear / 35) : 3} />
                <path d="M330 92 C390 112, 430 140, 451 174" strokeWidth={isRevealed ? Math.min(8, 2 + result.fluxes[3].rateGtPerYear / 2) : 3} />
              </g>

              <text x="178" y="266" fill="var(--text-secondary)" fontSize="10">combustion ↑</text>
              <text x="72" y="121" fill="var(--text-secondary)" fontSize="10">photosynthesis ↓</text>
              <text x="120" y="105" fill="var(--text-secondary)" fontSize="10">respiration ↑</text>
              <text x="391" y="122" fill="var(--text-secondary)" fontSize="10">ocean uptake ↓</text>

              {reservoirVisuals.map((visual) => {
                const reservoir = result.reservoirs[visual.id];
                return (
                  <g key={visual.id}>
                    <rect
                      x={visual.x}
                      y={visual.y}
                      width={visual.width}
                      height={visual.height}
                      rx={visual.shape === 'round' ? 22 : 4}
                      fill={`${visual.colour}22`}
                      stroke={visual.colour}
                      strokeWidth="3"
                    />
                    <text x={visual.x + visual.width / 2} y={visual.y + 25} textAnchor="middle" fill="var(--text-primary)" fontSize="13" fontWeight="700">
                      {reservoir.label}
                    </text>
                    <text x={visual.x + visual.width / 2} y={visual.y + 45} textAnchor="middle" fill={visual.colour} fontSize="11" fontWeight="700">
                      {isRevealed ? `${reservoir.carbonGt.toLocaleString()} Gt C` : 'quantity hidden'}
                    </text>
                    {isRevealed && (
                      <text x={visual.x + visual.width / 2} y={visual.y + 59} textAnchor="middle" fill="var(--text-secondary)" fontSize="9">
                        30 y change: {signed(reservoir.changeGt, 'Gt C')}
                      </text>
                    )}
                  </g>
                );
              })}

              <g transform="translate(18 386)" fontSize="9" fill="var(--text-secondary)">
                <rect width="16" height="10" rx="5" fill="#38bdf833" stroke="#38bdf8" />
                <text x="22" y="9">rounded box = surface reservoir</text>
                <rect x="190" width="16" height="10" fill="#a1620733" stroke="#a16207" />
                <text x="212" y="9">square box = geological store</text>
                <path d="M385 5 h18" stroke="#64748b" markerEnd="url(#carbon-arrow)" />
                <text x="410" y="9">arrow = carbon flux</text>
              </g>
            </svg>
          </div>

          <div className="glass-panel" style={{ padding: '12px' }}>
            <svg
              viewBox="0 0 550 235"
              className="science-scene-svg"
              role="img"
              aria-label={isRevealed
                ? `Energy-balance temperature proxy graph over ${result.projectionYears} years, ending at ${result.temperatureProxyC.toFixed(2)} degrees Celsius relative proxy.`
                : 'Energy-balance graph with a year axis; the result curve and numerical temperature scale are hidden until prediction submission.'}
            >
              <title>Linked energy-balance and temperature-proxy view</title>
              <rect x="1" y="1" width="548" height="233" rx="12" fill="var(--bg-primary)" stroke="var(--border-color)" />
              <text x="275" y="20" textAnchor="middle" fill="var(--text-primary)" fontSize="14" fontWeight="700">
                Energy balance → temperature proxy
              </text>
              <line x1="58" y1="188" x2="500" y2="188" stroke="var(--text-secondary)" />
              <line x1="58" y1="42" x2="58" y2="188" stroke="var(--text-secondary)" />
              {[0, 10, 20, 30].map((year) => (
                <g key={year}>
                  <line x1={58 + (year / 30) * 432} y1="188" x2={58 + (year / 30) * 432} y2="193" stroke="var(--text-secondary)" />
                  <text x={58 + (year / 30) * 432} y="207" textAnchor="middle" fill="var(--text-secondary)" fontSize="9">{year}</text>
                </g>
              ))}
              <text x="279" y="224" textAnchor="middle" fill="var(--text-secondary)" fontSize="10">Projection time (years)</text>
              <text x="14" y="116" textAnchor="middle" transform="rotate(-90 14 116)" fill="var(--text-secondary)" fontSize="10">Temperature proxy (°C)</text>
              <text x="52" y="50" textAnchor="end" fill="var(--text-secondary)" fontSize="9">{isRevealed ? maxTemperature.toFixed(1) : 'scale'}</text>
              <text x="52" y="188" textAnchor="end" fill="var(--text-secondary)" fontSize="9">{isRevealed ? minTemperature.toFixed(1) : 'locked'}</text>
              {isRevealed ? (
                <>
                  <polyline points={temperaturePoints} fill="none" stroke="#ef4444" strokeWidth="3" />
                  <circle cx="490" cy={188 - ((result.temperatureProxyC - minTemperature) / temperatureSpan) * 138} r="5" fill="#ef4444" />
                  <rect x="315" y="28" width="215" height="52" rx="8" fill="#0f172acc" stroke="#475569" />
                  <text x="325" y="45" fill="#f8fafc" fontSize="10">Absorbed: {result.absorbedSolarWm2.toFixed(1)} W m⁻²</text>
                  <text x="325" y="59" fill="#f8fafc" fontSize="10">Outgoing proxy: {result.outgoingLongwaveWm2.toFixed(1)} W m⁻²</text>
                  <text x="325" y="73" fill="#fca5a5" fontSize="10" fontWeight="700">Net: {signed(result.energyImbalanceWm2, 'W m⁻²')} ({result.climateTendency})</text>
                </>
              ) : (
                <g>
                  <rect x="115" y="80" width="330" height="58" rx="10" fill="var(--bg-secondary)" stroke="var(--border-color)" strokeDasharray="6 4" />
                  <text x="280" y="105" textAnchor="middle" fill="var(--text-primary)" fontSize="12" fontWeight="700">Prediction gate</text>
                  <text x="280" y="123" textAnchor="middle" fill="var(--text-secondary)" fontSize="10">Submit a prediction to reveal the numerical trajectory.</text>
                </g>
              )}
              <g transform="translate(72 30)" fontSize="9" fill="var(--text-secondary)">
                <line x1="0" y1="5" x2="24" y2="5" stroke="#ef4444" strokeWidth="3" />
                <text x="30" y="9">red line = temperature proxy</text>
              </g>
            </svg>
          </div>
        </div>
      }
    />
  );
}
