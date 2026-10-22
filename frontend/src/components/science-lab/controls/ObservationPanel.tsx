'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ObservationDefinition,
  ObservationField,
  ObservationReadoutValue,
  ObservationReadouts,
} from '../../../lib/science-lab/activity-types';
import MathMarkdown from '../../MathMarkdown';

export interface ObservationPanelProps {
  observation: ObservationDefinition;
  readouts: ObservationReadouts;
  isUnlocked?: boolean;
}

const NUMERIC_READOUT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const VISUALLY_HIDDEN_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * Observation metadata owns units for bare measurements. Existing scenes may
 * still emit formatted or status strings; those strings remain authoritative
 * and are never given a second suffix.
 */
function formatObservationValue(
  value: ObservationReadoutValue | undefined,
  field: ObservationField,
): string {
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
    return '—';
  }

  const text = String(value).trim();
  if (!text) return '—';

  if (!field.unit || text.endsWith(field.unit)) return text;

  const isBareMeasurement = typeof value === 'number' || NUMERIC_READOUT.test(text);
  return isBareMeasurement ? `${text} ${field.unit}` : text;
}

export default function ObservationPanel({
  observation,
  readouts,
  isUnlocked = true,
}: ObservationPanelProps) {
  const measurements = useMemo(
    () => observation.fields.map((field) => ({
      field,
      value: formatObservationValue(readouts[field.id], field),
    })),
    [observation.fields, readouts],
  );
  const currentSummary = useMemo(() => {
    const availableMeasurements = measurements.filter(({ value }) => value !== '—');
    if (availableMeasurements.length === 0) return 'Live measurements are ready.';
    return `Current measurements: ${availableMeasurements
      .map(({ field, value }) => `${field.label}: ${value}`)
      .join('; ')}.`;
  }, [measurements]);
  const [announcedSummary, setAnnouncedSummary] = useState('');
  const latestSummaryRef = useRef(currentSummary);

  useEffect(() => {
    latestSummaryRef.current = currentSummary;
  }, [currentSummary]);

  useEffect(() => {
    if (!isUnlocked) return;

    // Scene readouts may update every animation frame. Sample the latest values
    // at a low frequency so continuous simulations remain available without
    // flooding assistive technology with frame-by-frame announcements.
    const announceLatestSummary = () => {
      setAnnouncedSummary(latestSummaryRef.current);
    };
    const initialAnnouncement = window.setTimeout(announceLatestSummary, 600);
    const announcementInterval = window.setInterval(announceLatestSummary, 4000);

    return () => {
      window.clearTimeout(initialAnnouncement);
      window.clearInterval(announcementInterval);
    };
  }, [isUnlocked]);

  useEffect(() => {
    if (!isUnlocked) return;
    // Announce about 1 s after the readings stop changing, so a control change
    // is heard soon. Continuous motion resets this timer every frame and
    // stays on the 4 s sampling above.
    const settledAnnouncement = window.setTimeout(() => setAnnouncedSummary(currentSummary), 1000);
    return () => window.clearTimeout(settledAnnouncement);
  }, [currentSummary, isUnlocked]);

  return (
    <div
      className="glass-panel"
      style={{
        padding: '16px',
        borderRadius: '12px',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        marginBottom: '16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span aria-hidden="true" style={{ fontSize: '18px' }}>📊</span>
        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
          {observation.title}
        </h4>
      </div>

      {!isUnlocked ? (
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          <span aria-hidden="true">🔒</span>{' '}
          Submit your prediction above to reveal quantitative live measurements.
        </div>
      ) : (
        <>
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            style={VISUALLY_HIDDEN_STYLE}
          >
            {announcedSummary}
          </div>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '8px',
              margin: 0,
            }}
          >
            {measurements.map(({ field, value }) => (
              <div
                key={field.id}
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <dt style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  <MathMarkdown inline>{field.label}</MathMarkdown>
                </dt>
                <dd style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
