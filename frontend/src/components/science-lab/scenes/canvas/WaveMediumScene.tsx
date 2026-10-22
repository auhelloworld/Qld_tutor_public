'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScienceSceneProps } from '../../../../lib/science-lab/renderer-registry';
import type { WaveMediumSceneData } from '../../../../lib/science-lab/activity-types';
import {
  calculateWaveComparisonMetrics,
  getLongitudinalDisplacement,
  getTransverseDisplacement,
} from '../../../../lib/science-lab/models/waves';
import LabSceneLayout from '../../../lab-shared/LabSceneLayout';
import LabControlCard from '../../../lab-shared/LabControlCard';
import LabSliderInput from '../../../lab-shared/LabSliderInput';
import SimulationControls from '../../controls/SimulationControls';
import {
  useDocumentHidden,
  usePrefersReducedMotion,
  useSceneCanvas,
} from '../../../../lib/science-lab/use-scene-canvas';

const WAVE_W = 460;
const WAVE_H = 320;
const FIXED_STEP_SECONDS = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;

export default function WaveMediumScene({
  sceneData,
  onSceneDataChange,
  onReadoutChange,
  isRevealed = false,
}: ScienceSceneProps<WaveMediumSceneData>) {
  const [frequencyHz, setFrequencyHz] = useState(sceneData.frequencyHz ?? 1.5);
  const [amplitudePx, setAmplitudePx] = useState(sceneData.amplitudePx ?? 30);
  const [hasMedium, setHasMedium] = useState(sceneData.hasMedium ?? true);
  const [displayMode, setDisplayMode] = useState<
    'side-by-side' | 'transverse' | 'longitudinal'
  >(sceneData.waveType ?? 'side-by-side');
  const [showRuler, setShowRuler] = useState(true);
  const [isPlaying, setIsPlaying] = useState(sceneData.isPlaying ?? true);

  const { canvasRef, canvasStyle, prepareFrame, logicalWidth, logicalHeight } = useSceneCanvas(
    WAVE_W,
    WAVE_H,
    920,
  );
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
  const timeRef = useRef(0);
  const animFrameIdRef = useRef<number | null>(null);
  const lastReadoutKeyRef = useRef<string | null>(null);

  const comparisonMetrics = useMemo(
    () => calculateWaveComparisonMetrics(frequencyHz, hasMedium, 340),
    [frequencyHz, hasMedium],
  );
  const mechanicalMetrics = comparisonMetrics.mechanical;
  const electromagneticMetrics = comparisonMetrics.electromagnetic;

  useEffect(() => {
    if (!onReadoutChange) return;

    let readouts: Record<string, string | number>;
    if (!isRevealed) {
      readouts = {};
    } else if (displayMode === 'transverse') {
      readouts = {
        frequencyReadout: electromagneticMetrics.frequencyHz,
        wavelengthReadout: `${electromagneticMetrics.relativeWavelength.toFixed(2)}× reference (EM relative)`,
        waveSpeedReadout: `${electromagneticMetrics.relativeWaveSpeed.toFixed(2)}× reference (EM relative)`,
        periodReadout: electromagneticMetrics.periodSec,
        mediumStatus: hasMedium
          ? 'Electromagnetic channel: material-medium setting does not control transmission'
          : 'Electromagnetic channel: transmitted in vacuum',
      };
    } else if (displayMode === 'longitudinal') {
      readouts = {
        frequencyReadout: mechanicalMetrics.frequencyHz,
        wavelengthReadout: mechanicalMetrics.isTransmissible
          ? mechanicalMetrics.wavelengthM
          : 'Mechanical sound: not defined without a medium',
        waveSpeedReadout: mechanicalMetrics.isTransmissible
          ? mechanicalMetrics.waveSpeedMps
          : 'Mechanical sound: no transmission',
        periodReadout: mechanicalMetrics.periodSec,
        mediumStatus: hasMedium
          ? 'Material medium present: mechanical sound transmitted'
          : 'Vacuum: mechanical sound blocked',
      };
    } else {
      readouts = {
        frequencyReadout: mechanicalMetrics.frequencyHz,
        wavelengthReadout: mechanicalMetrics.isTransmissible
          ? `Mechanical: ${mechanicalMetrics.wavelengthM} m; EM: ${electromagneticMetrics.relativeWavelength.toFixed(2)}× relative`
          : `Mechanical: not defined; EM: ${electromagneticMetrics.relativeWavelength.toFixed(2)}× relative`,
        waveSpeedReadout: mechanicalMetrics.isTransmissible
          ? `Mechanical: ${mechanicalMetrics.waveSpeedMps} m/s; EM: ${electromagneticMetrics.relativeWaveSpeed.toFixed(2)}× relative`
          : `Mechanical: no transmission; EM: ${electromagneticMetrics.relativeWaveSpeed.toFixed(2)}× relative`,
        periodReadout: mechanicalMetrics.periodSec,
        mediumStatus: hasMedium
          ? 'Material medium present: mechanical sound and EM channels shown separately'
          : 'Vacuum: mechanical sound blocked; electromagnetic channel transmitted',
      };
    }

    const readoutKey = JSON.stringify(readouts);
    if (readoutKey !== lastReadoutKeyRef.current) {
      lastReadoutKeyRef.current = readoutKey;
      onReadoutChange(readouts);
    }
  }, [
    displayMode,
    electromagneticMetrics,
    hasMedium,
    isRevealed,
    mechanicalMetrics,
    onReadoutChange,
  ]);

  const handleFrequencyChange = useCallback(
    (newFrequency: number) => {
      setFrequencyHz(newFrequency);
      onSceneDataChange?.({ frequencyHz: newFrequency });
    },
    [onSceneDataChange],
  );

  const handleAmplitudeChange = useCallback(
    (newAmplitude: number) => {
      setAmplitudePx(newAmplitude);
      onSceneDataChange?.({ amplitudePx: newAmplitude });
    },
    [onSceneDataChange],
  );

  const handleMediumToggle = useCallback(() => {
    setHasMedium((previous) => {
      const next = !previous;
      onSceneDataChange?.({ hasMedium: next });
      return next;
    });
  }, [onSceneDataChange]);

  const handleDisplayModeChange = useCallback(
    (newDisplayMode: 'side-by-side' | 'transverse' | 'longitudinal') => {
      setDisplayMode(newDisplayMode);
      onSceneDataChange?.({ waveType: newDisplayMode });
    },
    [onSceneDataChange],
  );

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((previous) => {
      const next = !previous;
      onSceneDataChange?.({ isPlaying: next });
      return next;
    });
  }, [onSceneDataChange]);

  const renderFrame = useCallback(() => {
    const ctx = prepareFrame();
    if (!ctx) return;

    const width = logicalWidth;
    const height = logicalHeight;
    const time = timeRef.current;
    const visualWavelengthPx = 160 / frequencyHz;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    if (displayMode === 'side-by-side' || displayMode === 'transverse') {
      const centerY = displayMode === 'side-by-side' ? height * 0.28 : height * 0.5;

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(20, centerY);
      ctx.lineTo(width - 20, centerY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let x = 20; x <= width - 20; x += 3) {
        const y =
          centerY +
          getTransverseDisplacement(
            x,
            time,
            frequencyHz,
            amplitudePx,
            visualWavelengthPx,
          );
        if (x === 20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      for (let x = 30; x <= width - 30; x += 24) {
        const displacement = getTransverseDisplacement(
          x,
          time,
          frequencyHz,
          amplitudePx,
          visualWavelengthPx,
        );
        ctx.strokeStyle = 'rgba(96, 165, 250, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, centerY);
        ctx.lineTo(x, centerY + displacement);
        ctx.stroke();
      }

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(
        isRevealed
          ? hasMedium
            ? 'Electromagnetic transverse field (conceptual; not to scale)'
            : 'Electromagnetic transverse field propagates in vacuum'
          : 'Transverse field representation',
        24,
        displayMode === 'side-by-side' ? 20 : 30,
      );
    }

    if (displayMode === 'side-by-side' || displayMode === 'longitudinal') {
      const centerY = displayMode === 'side-by-side' ? height * 0.72 : height * 0.5;
      const labelY = displayMode === 'side-by-side' ? height * 0.54 : 30;

      ctx.fillStyle = hasMedium ? '#a855f7' : '#94a3b8';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(
        hasMedium
          ? 'Mechanical longitudinal sound: material particles oscillate parallel ↔'
          : isRevealed
            ? 'Mechanical longitudinal sound: no medium, so no propagation'
            : 'Mechanical longitudinal channel',
        24,
        labelY,
      );

      if (hasMedium) {
        const numCols = 32;
        const numRows = 4;
        const colSpacing = (width - 60) / numCols;

        for (let row = 0; row < numRows; row++) {
          const rowY = centerY - 20 + row * 14;
          for (let column = 0; column < numCols; column++) {
            const baseX = 30 + column * colSpacing;
            const displacement = getLongitudinalDisplacement(
              baseX,
              time,
              frequencyHz,
              amplitudePx * 0.6,
              visualWavelengthPx,
              true,
            );
            ctx.fillStyle = '#c084fc';
            ctx.beginPath();
            ctx.arc(baseX + displacement, rowY, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (isRevealed) {
        ctx.strokeStyle = '#64748b';
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(30, centerY - 30, width - 60, 60);
        ctx.setLineDash([]);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px sans-serif';
        ctx.fillText('No material particles are present in this channel.', 92, centerY + 4);
      }
    }

    if (
      showRuler &&
      isRevealed &&
      hasMedium &&
      displayMode !== 'transverse'
    ) {
      const rulerY = height - 24;
      ctx.strokeStyle = '#f59e0b';
      ctx.fillStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(40, rulerY);
      ctx.lineTo(40 + visualWavelengthPx, rulerY);
      ctx.moveTo(40, rulerY - 6);
      ctx.lineTo(40, rulerY + 6);
      ctx.moveTo(40 + visualWavelengthPx, rulerY - 6);
      ctx.lineTo(40 + visualWavelengthPx, rulerY + 6);
      ctx.stroke();
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(
        `Mechanical λ = ${mechanicalMetrics.wavelengthM} m (drawing not to scale)`,
        50,
        rulerY - 8,
      );
    }

    if (!isRevealed && !hasMedium) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.97)';
      ctx.fillRect(12, 12, width - 24, height - 24);
      ctx.strokeStyle = '#475569';
      ctx.strokeRect(12, 12, width - 24, height - 24);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Vacuum comparison hidden', width / 2, height / 2 - 8);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px sans-serif';
      ctx.fillText('Submit your prediction to reveal both channel outcomes.', width / 2, height / 2 + 14);
      ctx.textAlign = 'start';
    }
  }, [
    amplitudePx,
    displayMode,
    frequencyHz,
    hasMedium,
    isRevealed,
    logicalHeight,
    logicalWidth,
    mechanicalMetrics.wavelengthM,
    prepareFrame,
    showRuler,
  ]);

  useEffect(() => {
    renderFrame();
    if (!shouldAnimate) return;

    let cancelled = false;
    let lastTime: number | null = null;
    let accumulator = 0;

    const tick = (now: number) => {
      if (cancelled) return;

      if (lastTime === null) lastTime = now;
      accumulator += Math.min(
        Math.max(0, (now - lastTime) / 1000),
        FIXED_STEP_SECONDS * MAX_STEPS_PER_FRAME,
      );
      lastTime = now;

      let steps = 0;
      while (accumulator >= FIXED_STEP_SECONDS && steps < MAX_STEPS_PER_FRAME) {
        timeRef.current += FIXED_STEP_SECONDS;
        accumulator -= FIXED_STEP_SECONDS;
        steps += 1;
      }

      renderFrame();
      if (!cancelled) animFrameIdRef.current = requestAnimationFrame(tick);
    };

    animFrameIdRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
    };
  }, [renderFrame, shouldAnimate]);

  const playbackStatus = isDocumentHidden
    ? 'Paused while this page is hidden'
    : isReducedMotion
      ? 'Paused for reduced motion'
      : isPlaying
        ? 'Running'
        : 'Paused';

  const waveControlState = `${frequencyHz.toFixed(1)} hertz, display amplitude ${amplitudePx} canvas pixels`;
  const canvasAriaLabel = !isRevealed
    ? `Interactive conceptual wave canvas at ${waveControlState}, in ${displayMode} mode with ${hasMedium ? 'a material medium' : 'vacuum'} selected. Exact wavelength, readouts, and the vacuum comparison are hidden until prediction is submitted.`
    : displayMode === 'transverse'
      ? hasMedium
        ? `Conceptual electromagnetic transverse field channel at ${waveControlState}. A material medium is selected; display metrics are relative and the drawing is not to scale.`
        : `Conceptual electromagnetic transverse field channel at ${waveControlState}, transmitted in vacuum. Display metrics are relative and the drawing is not to scale.`
      : displayMode === 'longitudinal'
        ? hasMedium
          ? `Mechanical longitudinal sound at ${waveControlState} is transmitted through the material medium at ${mechanicalMetrics.waveSpeedMps} metres per second with wavelength ${mechanicalMetrics.wavelengthM} metres.`
          : `Mechanical longitudinal sound at ${waveControlState} is not transmitted in vacuum because no material particles are present.`
        : hasMedium
          ? `Separate wave channels at ${waveControlState}. Mechanical sound is transmitted through the material medium at ${mechanicalMetrics.waveSpeedMps} metres per second with wavelength ${mechanicalMetrics.wavelengthM} metres; the electromagnetic transverse field is conceptual and not to scale.`
          : `Separate wave channels at ${waveControlState} in vacuum. Mechanical longitudinal sound is not transmitted because no material particles are present; the electromagnetic transverse field is transmitted.`;

  const revealedStatus =
    displayMode === 'transverse'
      ? 'EM field · relative display only'
      : mechanicalMetrics.isTransmissible
        ? `Mechanical sound: v = ${mechanicalMetrics.waveSpeedMps} m/s · λ = ${mechanicalMetrics.wavelengthM} m`
        : displayMode === 'longitudinal'
          ? 'Mechanical sound: no vacuum transmission'
          : 'Mechanical: no transmission · EM: transmitted';

  return (
    <LabSceneLayout
      control={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <LabControlCard title="Wave Parameters">
            <LabSliderInput
              id="frequencyHz"
              label="Wave Frequency"
              ariaLabel="Frequency in Hertz"
              value={frequencyHz}
              min={0.5}
              max={3}
              step={0.1}
              valueSuffix=" Hz"
              onChange={handleFrequencyChange}
            />
            <div style={{ marginTop: '12px' }}>
              <LabSliderInput
                id="amplitudePx"
                label="Relative Wave Amplitude"
                ariaLabel="Relative wave amplitude"
                value={amplitudePx}
                min={10}
                max={50}
                step={2}
                valueSuffix=" px"
                onChange={handleAmplitudeChange}
              />
            </div>
          </LabControlCard>

          <LabControlCard title="Medium & Counterfactuals">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                id="mediumToggle"
                type="button"
                aria-label="Toggle medium presence for vacuum test — material-medium removal counterfactual"
                aria-pressed={!hasMedium}
                onClick={handleMediumToggle}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: !hasMedium
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'var(--bg-primary)',
                  color: !hasMedium ? '#ef4444' : 'var(--text-primary)',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {hasMedium
                  ? 'Medium Present (Air vs Vacuum): ON — remove the material medium'
                  : 'Medium Present (Air vs Vacuum): OFF — restore the material medium'}
              </button>

              <button
                type="button"
                aria-label="Mechanical wavelength ruler"
                aria-pressed={showRuler}
                onClick={() => setShowRuler((previous) => !previous)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: showRuler
                    ? 'rgba(245, 158, 11, 0.15)'
                    : 'var(--bg-primary)',
                  color: showRuler ? '#f59e0b' : 'var(--text-primary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {showRuler
                  ? isRevealed
                    ? '✓ Mechanical Wavelength Ruler ON'
                    : '✓ Wavelength Ruler ON · measurement locked'
                  : '✗ Wavelength Ruler OFF'}
              </button>
            </div>
          </LabControlCard>

          <LabControlCard title="Display Mode">
            <div
              id="waveTypeSelect"
              role="group"
              aria-label="Select wave type display mode"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}
            >
              {[
                { label: 'Side-by-Side', value: 'side-by-side' as const, colour: '#10b981' },
                { label: 'EM Transverse', value: 'transverse' as const, colour: '#38bdf8' },
                { label: 'Sound Longitudinal', value: 'longitudinal' as const, colour: '#a855f7' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={displayMode === option.value}
                  onClick={() => handleDisplayModeChange(option.value)}
                  style={{
                    padding: '6px 4px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background:
                      displayMode === option.value ? option.colour : 'var(--bg-primary)',
                    color: displayMode === option.value ? '#fff' : 'var(--text-primary)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </LabControlCard>

          <LabControlCard title="Playback Controls">
            <SimulationControls
              isPlaying={isPlaying}
              onTogglePlay={handleTogglePlay}
              onStepForward={() => {
                timeRef.current += FIXED_STEP_SECONDS;
                renderFrame();
              }}
              onReset={() => {
                timeRef.current = 0;
                renderFrame();
              }}
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
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
            }}
          >
            <h4
              style={{
                margin: 0,
                fontSize: '13px',
                fontWeight: 700,
                color: 'var(--text-primary)',
              }}
            >
              Mechanical Sound & Electromagnetic Field Canvas
            </h4>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: isRevealed ? '#10b981' : 'var(--text-muted)',
              }}
            >
              {isRevealed ? revealedStatus : 'Measurements & vacuum outcome 🔒'}
            </span>
          </div>

          <canvas
            ref={canvasRef}
            className="science-scene-canvas"
            style={{ ...canvasStyle, borderRadius: '12px', background: '#0f172a' }}
            aria-label={canvasAriaLabel}
            role="img"
          >
            Your browser does not support HTML5 Canvas.
          </canvas>
          <div
            aria-label="Wave channel legend"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 16px',
              marginTop: '8px',
              color: 'var(--text-secondary)',
              fontSize: '10px',
              lineHeight: 1.4,
            }}
          >
            <span>∿ Continuous transverse curve — electromagnetic field channel</span>
            <span>● ●● ● particle spacing ↔ — mechanical longitudinal sound channel</span>
          </div>
          <p
            style={{
              margin: '6px 2px 0',
              color: 'var(--text-muted)',
              fontSize: '10px',
              lineHeight: 1.4,
            }}
          >
            {displayMode === 'side-by-side'
              ? 'Both channels'
              : displayMode === 'transverse'
                ? 'Electromagnetic channel'
                : 'Mechanical sound channel'}{' '}
            · {hasMedium ? 'material medium selected' : 'vacuum selected'} · {playbackStatus} ·{' '}
            {isRevealed ? 'outcome revealed' : 'outcome locked'}
          </p>
          {isRevealed && (
            <p
              style={{
                margin: '8px 2px 0',
                color: 'var(--text-muted)',
                fontSize: '10px',
                lineHeight: 1.4,
              }}
            >
              The sound ruler uses physical sound metrics; canvas distances and the
              electromagnetic field drawing are conceptual and not to scale.
            </p>
          )}
        </div>
      }
    />
  );
}
