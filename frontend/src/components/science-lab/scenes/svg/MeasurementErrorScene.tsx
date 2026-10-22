'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import type { MeasurementErrorSceneData as RegisteredMeasurementErrorSceneData } from '../../../../lib/science-lab/activity-types';
import {
  generateMeasurementStudy,
  type MeasurementErrorSceneData,
} from '../../../../lib/science-lab/models/measurement-error';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSliderInput from '../../../lab-shared/LabSliderInput';

type MeasurementErrorModelSceneProps = Omit<
  ScienceSceneProps<RegisteredMeasurementErrorSceneData>,
  'sceneData' | 'onSceneDataChange'
> & {
  sceneData: MeasurementErrorSceneData;
  onSceneDataChange?: (patch: Partial<MeasurementErrorSceneData>) => void;
};

export default function MeasurementErrorScene(
  props: ScienceSceneProps<RegisteredMeasurementErrorSceneData> | MeasurementErrorModelSceneProps,
) {
  const { onReadoutChange, isRevealed = false } = props;
  const sceneData = props.sceneData as Partial<MeasurementErrorSceneData> & {
    instrumentResolution?: number;
    randomErrorRange?: number;
    systematicOffset?: number;
    trialCount?: number;
  };
  const onSceneDataChange = props.onSceneDataChange as MeasurementErrorModelSceneProps['onSceneDataChange'];
  const [trueValue, setTrueValue] = useState(sceneData.trueValue ?? 50);
  const [resolution, setResolution] = useState(sceneData.resolution ?? sceneData.instrumentResolution ?? 0.5);
  const [randomError, setRandomError] = useState(sceneData.randomError ?? sceneData.randomErrorRange ?? 1);
  const [systematicBias, setSystematicBias] = useState(sceneData.systematicBias ?? sceneData.systematicOffset ?? 1);
  const [sampleSize, setSampleSize] = useState(sceneData.sampleSize ?? sceneData.trialCount ?? 12);
  const [seed, setSeed] = useState(sceneData.seed ?? 42);
  const [calibrated, setCalibrated] = useState(sceneData.calibrated ?? false);

  useEffect(() => {
    setTrueValue(sceneData.trueValue ?? 50);
    setResolution(sceneData.resolution ?? sceneData.instrumentResolution ?? 0.5);
    setRandomError(sceneData.randomError ?? sceneData.randomErrorRange ?? 1);
    setSystematicBias(sceneData.systematicBias ?? sceneData.systematicOffset ?? 1);
    setSampleSize(sceneData.sampleSize ?? sceneData.trialCount ?? 12);
    setSeed(sceneData.seed ?? 42);
    setCalibrated(sceneData.calibrated ?? false);
  }, [
    sceneData.calibrated,
    sceneData.instrumentResolution,
    sceneData.randomError,
    sceneData.randomErrorRange,
    sceneData.resolution,
    sceneData.sampleSize,
    sceneData.seed,
    sceneData.systematicBias,
    sceneData.systematicOffset,
    sceneData.trialCount,
    sceneData.trueValue,
  ]);

  const modelData = useMemo<MeasurementErrorSceneData>(() => ({
    kind: 'measurement-error',
    trueValue,
    resolution,
    randomError,
    systematicBias,
    sampleSize,
    seed,
    calibrated,
  }), [calibrated, randomError, resolution, sampleSize, seed, systematicBias, trueValue]);
  const study = useMemo(() => generateMeasurementStudy(modelData), [modelData]);

  useEffect(() => {
    onReadoutChange?.(isRevealed ? {
      mean: study.mean,
      range: study.range,
      absoluteError: study.absoluteError,
      outliers: study.outlierIndices.length === 0 ? 'None by 1.5×IQR rule' : study.outlierIndices.join(', '),
      effectiveBias: study.effectiveBias,
      calibration: calibrated ? 'Bias removed in counterfactual' : 'Uncalibrated',
    } : {});
  }, [calibrated, isRevealed, onReadoutChange, study]);

  const updateNumber = (
    setter: React.Dispatch<React.SetStateAction<number>>,
    patch: Partial<MeasurementErrorSceneData>,
    value: number,
  ) => {
    setter(value);
    onSceneDataChange?.(patch);
  };
  const toggleCalibration = () => {
    const next = !calibrated;
    setCalibrated(next);
    onSceneDataChange?.({ calibrated: next });
  };
  const nextRepeat = () => {
    const next = seed + 1;
    setSeed(next);
    onSceneDataChange?.({ seed: next });
  };

  const chart = { left: 70, right: 680, top: 142, bottom: 330 };
  const values = study.samples.map((sample) => sample.value);
  const configuredCentre = trueValue + (calibrated ? 0 : systematicBias);
  const configuredPadding = Math.max(resolution * 2, randomError * 4 + resolution, 0.5);
  const configuredLow = Math.min(trueValue, configuredCentre) - configuredPadding;
  const configuredHigh = Math.max(trueValue, configuredCentre) + configuredPadding;
  // Before reveal, ticks depend only on visible controls. Once revealed, the
  // domain may tighten around the actual sample without leaking it in advance.
  const low = isRevealed ? Math.min(study.trueValue, study.mean, ...values) : configuredLow;
  const high = isRevealed ? Math.max(study.trueValue, study.mean, ...values) : configuredHigh;
  const yPadding = isRevealed
    ? Math.max(resolution * 2, (high - low) * 0.15, 0.5)
    : 0;
  const yMin = low - yPadding;
  const yMax = high + yPadding;
  const xFor = (index: number) => chart.left
    + ((index - 1) / Math.max(1, study.samples.length - 1)) * (chart.right - chart.left);
  const yFor = (value: number) => chart.bottom
    - ((value - yMin) / (yMax - yMin)) * (chart.bottom - chart.top);

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Instrument & quantity">
            <LabSliderInput id="measurement-true" label="True value" ariaLabel="True value in centimetres" value={trueValue} min={10} max={100} step={0.5} decimals={1} valueSuffix=" cm" onChange={(value) => updateNumber(setTrueValue, { trueValue: value }, value)} />
            <div style={{ marginTop: '12px' }}>
              <LabSliderInput id="measurement-resolution" label="Resolution" ariaLabel="Instrument resolution in centimetres" value={resolution} min={0.1} max={2} step={0.1} decimals={1} valueSuffix=" cm" onChange={(value) => updateNumber(setResolution, { resolution: value }, value)} />
            </div>
          </LabControlCard>
          <LabControlCard title="Error sources">
            <LabSliderInput id="measurement-random" label="Random error scale" ariaLabel="Random measurement error scale in centimetres" value={randomError} min={0} max={5} step={0.1} decimals={1} valueSuffix=" cm" onChange={(value) => updateNumber(setRandomError, { randomError: value }, value)} />
            <div style={{ marginTop: '12px' }}>
              <LabSliderInput id="measurement-bias" label="Systematic bias" ariaLabel="Systematic measurement bias in centimetres" value={systematicBias} min={-5} max={5} step={0.1} decimals={1} valueSuffix=" cm" onChange={(value) => updateNumber(setSystematicBias, { systematicBias: value }, value)} />
            </div>
            <button
              type="button"
              aria-label="Calibration counterfactual removing systematic bias"
              aria-pressed={calibrated}
              onClick={toggleCalibration}
              style={{ width: '100%', marginTop: '12px', padding: '8px', borderRadius: '7px', border: '1px solid var(--border-color)', background: calibrated ? 'rgba(59, 130, 246, 0.18)' : 'var(--bg-primary)', color: calibrated ? '#60a5fa' : 'var(--text-primary)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
            >
              {calibrated ? '✓ Calibrated: systematic bias set to 0 cm' : 'Counterfactual: calibrate away systematic bias'}
            </button>
          </LabControlCard>
          <LabControlCard title="Repeated sampling">
            <LabSliderInput id="measurement-size" label="Sample size" ariaLabel="Number of repeated measurements" value={sampleSize} min={3} max={50} step={1} decimals={0} onChange={(value) => updateNumber(setSampleSize, { sampleSize: value }, value)} />
            <div style={{ marginTop: '12px' }}>
              <LabSliderInput id="measurement-seed" label="Sample seed" ariaLabel="Repeatable measurement sample seed" value={seed} min={1} max={999} step={1} decimals={0} onChange={(value) => updateNumber(setSeed, { seed: Math.round(value) }, Math.round(value))} />
            </div>
            <button type="button" onClick={nextRepeat} style={{ width: '100%', marginTop: '10px', padding: '7px', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Generate next repeatable sample (seed + 1)</button>
          </LabControlCard>
        </div>
      }
      visual={
        <div className="glass-panel" style={{ padding: '16px', borderRadius: '16px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)' }}>Repeated Measurements & Error Graph</h4>
            <strong style={{ fontSize: '11px', color: isRevealed ? '#10b981' : 'var(--text-muted)' }}>{isRevealed ? `Mean ${study.mean.toFixed(2)} cm` : 'Statistics 🔒'}</strong>
          </div>
          <svg
            viewBox="0 0 720 370"
            className="science-scene-svg"
            role="img"
            aria-label={isRevealed
              ? `${study.samples.length} repeatable measurements in centimetres. Mean ${study.mean.toFixed(2)}, range ${study.range.toFixed(2)}, absolute error ${study.absoluteError.toFixed(2)}, and ${study.outlierIndices.length} Tukey outliers.`
              : `${study.samples.length} measurements configured with ${resolution.toFixed(1)} centimetre resolution. Samples and statistics are locked until the prediction is submitted.`}
            style={{ background: '#0f172a', borderRadius: '12px' }}
          >
            <title>{isRevealed ? 'Measurement samples with true value, mean, and outliers' : 'Measurement apparatus and locked data graph'}</title>
            <rect x="42" y="32" width="636" height="65" rx="10" fill="#111827" stroke="#475569" />
            <text x="58" y="51" fill="#e2e8f0" fontSize="10" fontWeight="bold">Instrument scale (cm)</text>
            {Array.from({ length: 21 }, (_, index) => index).map((tick) => {
              const x = 80 + tick * 28;
              return <line key={tick} x1={x} y1="62" x2={x} y2={tick % 5 === 0 ? 88 : 80} stroke={tick % 5 === 0 ? '#f8fafc' : '#64748b'} strokeWidth={tick % 5 === 0 ? 2 : 1} />;
            })}
            <text x="360" y="90" textAnchor="middle" fill="#94a3b8" fontSize="9">smallest division represents the selected resolution ({resolution.toFixed(1)} cm)</text>

            <line x1={chart.left} y1={chart.bottom} x2={chart.right} y2={chart.bottom} stroke="#94a3b8" strokeWidth="1.5" />
            <line x1={chart.left} y1={chart.top} x2={chart.left} y2={chart.bottom} stroke="#94a3b8" strokeWidth="1.5" />
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
              const value = yMin + (yMax - yMin) * fraction;
              return (
                <g key={fraction}>
                  <line x1={chart.left - 5} y1={yFor(value)} x2={chart.right} y2={yFor(value)} stroke="#334155" />
                  <text x={chart.left - 9} y={yFor(value) + 3} textAnchor="end" fill="#cbd5e1" fontSize="9">{value.toFixed(1)}</text>
                </g>
              );
            })}
            {[1, Math.ceil(study.samples.length / 2), study.samples.length].filter((value, index, array) => array.indexOf(value) === index).map((tick) => (
              <g key={tick}>
                <line x1={xFor(tick)} y1={chart.bottom} x2={xFor(tick)} y2={chart.bottom + 5} stroke="#94a3b8" />
                <text x={xFor(tick)} y={chart.bottom + 17} textAnchor="middle" fill="#cbd5e1" fontSize="9">{tick}</text>
              </g>
            ))}
            <text x={(chart.left + chart.right) / 2} y="365" textAnchor="middle" fill="#e2e8f0" fontSize="10">Measurement number (sample index)</text>
            <text transform="translate(17 238) rotate(-90)" textAnchor="middle" fill="#e2e8f0" fontSize="10">Measured value (cm)</text>

            {isRevealed ? (
              <>
                <line x1={chart.left} y1={yFor(study.trueValue)} x2={chart.right} y2={yFor(study.trueValue)} stroke="#34d399" strokeWidth="2" />
                <line x1={chart.left} y1={yFor(study.mean)} x2={chart.right} y2={yFor(study.mean)} stroke="#fbbf24" strokeWidth="2" strokeDasharray="7 4" />
                {study.samples.map((sample) => (
                  <circle key={sample.index} cx={xFor(sample.index)} cy={yFor(sample.value)} r={sample.isOutlier ? 6 : 4} fill={sample.isOutlier ? '#ef4444' : '#60a5fa'} stroke={sample.isOutlier ? '#fecaca' : '#dbeafe'} strokeWidth="1.5">
                    <title>{`Sample ${sample.index}: ${sample.value} cm${sample.isOutlier ? ', Tukey outlier' : ''}`}</title>
                  </circle>
                ))}
              </>
            ) : (
              <g>
                <rect x="205" y="205" width="350" height="62" rx="10" fill="#111827" stroke="#475569" />
                <text x="380" y="231" textAnchor="middle" fill="#cbd5e1" fontSize="13" fontWeight="bold">Predict, then reveal the repeatable sample</text>
                <text x="380" y="252" textAnchor="middle" fill="#94a3b8" fontSize="10">The graph geometry and summary statistics are hidden.</text>
              </g>
            )}
          </svg>
          <div aria-label="Measurement graph legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: '8px', color: 'var(--text-secondary)', fontSize: '10px' }}>
            <span>● blue: measurement</span><span>● red ring: outlier by 1.5×IQR rule</span><span>— green: true value</span><span>-- amber: sample mean</span>
          </div>
          <p style={{ margin: '7px 2px 0', color: 'var(--text-muted)', fontSize: '10px', lineHeight: 1.45 }}>Calibration removes only the modelled systematic bias; it does not remove random error or resolution limits. {study.limitation}</p>
        </div>
      }
    />
  );
}
