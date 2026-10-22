'use client';
import { useEffect, useState } from 'react';
import { diagnosticStatus } from '../../lib/api';
import type { DiagnosticArea, DiagnosticBand, Subject } from '../../lib/api-types';

const BAND_LABEL: Record<DiagnosticBand, string> = {
  start_here: 'Start here',
  building: 'Building',
  secure: 'Secure',
};

function areaNotes(area: DiagnosticArea): string[] {
  const notes: string[] = [];
  if (area.confident_errors.length > 0) notes.push(`Sure but wrong: ${area.confident_errors.join(', ')}`);
  if (area.not_learned) notes.push(`Not learned yet: ${area.not_learned} (not a mistake)`);
  notes.push(...area.misconception_notes);
  const check = area.prior_year_check;
  if (check) notes.push(`Year ${check.year} check (${check.topic_id}): ${check.correct ? 'correct' : 'not yet'}`);
  return notes;
}

/** Parent view of the current diagnostic placement and its change per area. */
export default function DiagnosticSummary({ subject, year }: { subject: Subject; year: string }) {
  const yearLevel = /^year(7|8|9|10)$/.exec(year)?.[1];
  const supported = Boolean(yearLevel) && ['math', 'english', 'science'].includes(subject);
  const [areas, setAreas] = useState<Record<string, DiagnosticArea>>({});

  useEffect(() => {
    if (!supported) return;
    const abort = new AbortController();
    diagnosticStatus(subject, Number(yearLevel), abort.signal)
      .then(data => setAreas(data.completed ? data.areas || {} : {}))
      .catch(() => setAreas({}));
    return () => abort.abort();
  }, [subject, yearLevel, supported]);

  const rows = Object.entries(areas);
  if (!supported || rows.length === 0) return null;
  const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border-color)', textAlign: 'left' as const };
  return (
    <section className="glass-panel" aria-label="Diagnostic placement" style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 4px 0' }}>Diagnostic placement</h2>
      <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: '13px' }}>
        A short placement check, not a grade. Each area has only a few questions.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr>
            <th scope="col" style={cell}>Area</th>
            <th scope="col" style={cell}>Result</th>
            <th scope="col" style={cell}>Correct</th>
            <th scope="col" style={cell}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, area]) => (
            <tr key={name}>
              <td style={cell}>{name}</td>
              <td style={cell}>
                {BAND_LABEL[area.band]}
                {area.previous_band && area.previous_band !== area.band ? ` (was ${BAND_LABEL[area.previous_band]})` : ''}
              </td>
              <td style={cell}>{area.correct} of {area.questions}</td>
              <td style={cell}>{areaNotes(area).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
