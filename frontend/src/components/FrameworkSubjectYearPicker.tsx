'use client';
import { useEffect, useMemo } from 'react';
import { getSubject, setSubject, getYear, setYear } from '../lib/preferences';
import { subjectDisplayName } from '../lib/format';
import type { Subject, YearLevel } from '../lib/api-types';
import type { Curriculum } from '../lib/curriculum_helpers';

interface PickerValue {
  subject: Subject;
  year: YearLevel;
}

interface Props {
  curriculum: Curriculum | null;
  value: PickerValue;
  onChange: (next: PickerValue) => void;
  initialiseFromPreferences?: boolean;
}

export default function FrameworkSubjectYearPicker({
  curriculum,
  value,
  onChange,
  initialiseFromPreferences = true,
}: Props) {
  const subjects = useMemo(() => Object.keys(curriculum || {}), [curriculum]);
  const years = Object.keys(curriculum?.[value.subject] ?? {}).sort((a, b) => {
    const aNum = parseInt(a.replace('year', '').replace('unit', ''), 10);
    const bNum = parseInt(b.replace('year', '').replace('unit', ''), 10);
    return aNum - bNum;
  });

  // On mount, initialise from localStorage; validate against curriculum
  useEffect(() => {
    if (!curriculum || subjects.length === 0) return;

    if (!initialiseFromPreferences) {
      const nextSubject = subjects.includes(value.subject) ? value.subject : subjects[0];
      const availableYears = Object.keys(curriculum[nextSubject] ?? {});
      const nextYear = availableYears.includes(value.year)
        ? value.year
        : (availableYears[0] || 'year7');
      if (nextSubject !== value.subject || nextYear !== value.year) {
        onChange({ subject: nextSubject, year: nextYear });
      }
      return;
    }

    let storedSubject = getSubject();
    let storedYear = getYear();

    // Validate subject
    if (!subjects.includes(storedSubject)) {
      storedSubject = subjects[0];
      setSubject(storedSubject);
    }

    // Validate year
    const availableYears = Object.keys(curriculum[storedSubject] ?? {});
    if (!availableYears.includes(storedYear)) {
      storedYear = availableYears[0] || 'year7';
      setYear(storedYear);
    }

    if (storedSubject !== value.subject || storedYear !== value.year) {
      onChange({ subject: storedSubject, year: storedYear });
    }
  }, [curriculum, initialiseFromPreferences, onChange, subjects, value.subject, value.year]);

  const handleSubjectChange = (newSubject: string) => {
    setSubject(newSubject);
    const availableYears = Object.keys(curriculum?.[newSubject] ?? {}).sort((a, b) => {
      const aNum = parseInt(a.replace('year', '').replace('unit', ''), 10);
      const bNum = parseInt(b.replace('year', '').replace('unit', ''), 10);
      return aNum - bNum;
    });
    // Keep current year if available for the new subject, otherwise fallback to first available
    const newYear = availableYears.includes(value.year) ? value.year : (availableYears[0] || value.year);
    setYear(newYear);
    onChange({ subject: newSubject, year: newYear });
  };

  const handleYearChange = (newYear: string) => {
    setYear(newYear);
    onChange({ subject: value.subject, year: newYear });
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '12px', alignItems: 'flex-end', width: '100%' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <label htmlFor="picker-subject" style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
          Subject
        </label>
        <select
          id="picker-subject"
          value={value.subject}
          onChange={e => handleSubjectChange(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', fontSize: '15px', width: '100%', boxSizing: 'border-box' }}
        >
          {subjects.map(s => <option key={s} value={s}>{subjectDisplayName(s)}</option>)}
        </select>
      </div>
      <div style={{ width: '110px', flexShrink: 0 }}>
        <label htmlFor="picker-year" style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
          {value.year.startsWith('unit') ? 'Unit' : 'Year'}
        </label>
        <select
          id="picker-year"
          value={value.year}
          onChange={e => handleYearChange(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', fontSize: '15px', width: '100%', boxSizing: 'border-box' }}
        >
          {years.map(y => <option key={y} value={y}>{y.startsWith('unit') ? y.replace('unit', 'Unit ') : y.replace('year', 'Year ')}</option>)}
        </select>
      </div>
    </div>
  );
}
