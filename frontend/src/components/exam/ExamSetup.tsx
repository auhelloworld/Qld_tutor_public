'use client';

import React, { useEffect, useMemo, useState } from 'react';
import FrameworkSubjectYearPicker from '../FrameworkSubjectYearPicker';
import BackToPracticeLink from '../BackToPracticeLink';
import { backendSubjectFromPickerSubject } from '../../lib/api';
import type { ContentAvailability, ExamActiveSession, ExamHistoryItem, ImportedPaper, Subject, YearLevel } from '../../lib/api-types';
import type { Curriculum } from '../../lib/curriculum_helpers';

interface PickerValue {
  subject: Subject;
  year: YearLevel;
}

interface ExamSetupProps {
  loading: boolean;
  history: ExamHistoryItem[];
  importedPapers: ImportedPaper[];
  selectedPaper: string;
  setSelectedPaper: (paper: string) => void;
  curriculum: Curriculum | null;
  contentAvailability: ContentAvailability | null;
  pickerValue: PickerValue;
  setPickerValue: (v: PickerValue) => void;
  numQuestions: number;
  setNumQuestions: (num: number) => void;
  timeLimitMin: number;
  setTimeLimitMin: (time: number) => void;
  sfRatio: number;
  setSfRatio: (ratio: number) => void;
  cfRatio: number;
  setCfRatio: (ratio: number) => void;
  cuRatio: number;
  setCuRatio: (ratio: number) => void;
  handleStart: () => void;
  examType: string;
  setExamType: (type: string) => void;
  /** Newest unsubmitted exam in the selected scope. */
  activeExam?: ExamActiveSession | null;
  onResumeActive?: (exam: ExamActiveSession) => void;
  onDiscardActive?: (exam: ExamActiveSession) => void;
}

interface ExamTypeOption {
  value: string;
  label: string;
  description: string;
}

function hasAuthoredContent(
  availability: ContentAvailability | null,
  subject: string,
  scope: string,
): boolean {
  if (!availability) return true;
  // Availability is keyed by the exercise-bank (storage) subject, e.g. the
  // picker's "senior_methods" maps to "methods".
  const storageSubject = backendSubjectFromPickerSubject(subject);
  if (scope.startsWith('unit')) {
    return (availability.by_unit?.[storageSubject]?.[scope] ?? 0) > 0;
  }
  return (availability.by_year?.[storageSubject]?.[scope] ?? 0) > 0;
}

function examTypeOptions(subject: Subject): ExamTypeOption[] {
  const subjectKey = String(subject);
  if (["senior_methods", "senior_general", "senior_specialist", "senior_essential"].includes(subjectKey)) {
    return [
      { value: 'mixed', label: 'Mixed practice set', description: 'Balanced questions across the selected unit.' },
      { value: 'paper_1', label: '📝 Paper 1 (technology-free)', description: 'Exam-style questions to be answered without a calculator.' },
      { value: 'paper_2', label: '🖩 Paper 2 (technology-active)', description: 'Questions intended for calculator/technology use (mainly Units 3–4).' },
    ];
  }
  if (subject === 'english') {
    return [
      { value: 'mixed', label: 'Mixed English practice set', description: 'Balanced reading, language, and response practice.' },
      { value: 'naplan_literacy', label: 'NAPLAN literacy', description: 'Short reading, vocabulary, spelling, grammar, and punctuation practice.' },
      { value: 'reading', label: 'Reading comprehension', description: 'Focus on text evidence, inference, vocabulary, and comprehension.' },
      { value: 'language_conventions', label: 'Language conventions', description: 'Grammar, punctuation, spelling, and sentence control.' },
      { value: 'extended_response', label: 'Extended response', description: 'Longer analytical or written-response practice where available.' },
    ];
  }
  if (subject === 'science') {
    return [
      { value: 'mixed', label: 'Mixed Science practice set', description: 'Balanced science understanding, inquiry, and data practice.' },
      { value: 'inquiry', label: 'Science inquiry', description: 'Variables, methods, fair tests, and evaluating investigations.' },
      { value: 'data_interpretation', label: 'Data interpretation', description: 'Tables, graphs, diagrams, and evidence-based conclusions.' },
      { value: 'extended_response', label: 'Extended response', description: 'Claim-evidence-reasoning and explanation questions.' },
      { value: 'practical_reasoning', label: 'Practical reasoning', description: 'Apply science ideas to practical contexts and methods.' },
    ];
  }
  return [
    { value: 'mixed', label: 'Mixed Maths practice set', description: 'Balanced simple familiar, complex familiar, and complex unfamiliar questions.' },
    { value: 'naplan_numeracy', label: '📝 NAPLAN numeracy', description: 'Fast mixed numeracy: short items with broad topic coverage.' },
    { value: 'fluency_check', label: '⚡ Fluency check', description: 'Accuracy and speed: foundational and developing short-answer and MCQ.' },
    { value: 'challenge_amc', label: '🏆 AMC challenge', description: 'High-achiever extension: AMC and complex-unfamiliar problems.' },
  ];
}

function formatExamDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

const COURSE_LABELS: Record<string, string> = {
  math: 'Mathematics',
  english: 'English',
  science: 'Science',
  methods: 'Mathematical Methods',
  general: 'General Mathematics',
  specialist: 'Specialist Mathematics',
  essential: 'Essential Mathematics',
};

function formatExamContext(exam: ExamHistoryItem): string {
  const course = COURSE_LABELS[exam.syllabus_subject || exam.subject || '']
    || exam.syllabus_subject
    || exam.subject
    || 'Exam';
  const scope = exam.year_level != null
    ? `Year ${exam.year_level}`
    : exam.unit != null
      ? `Unit ${exam.unit}`
      : null;
  return [course, scope].filter(Boolean).join(' · ');
}

function formatExamType(value?: string): string {
  if (!value) return 'Exam';
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function ActiveExamCard({
  exam,
  loading,
  onResume,
  onDiscard,
}: {
  exam: ExamActiveSession;
  loading: boolean;
  onResume?: (exam: ExamActiveSession) => void;
  onDiscard?: (exam: ExamActiveSession) => void;
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const minutesLeft = Math.ceil(exam.remaining_seconds / 60);
  const timeText = minutesLeft > 0
    ? `${minutesLeft} min left. The timer kept running while you were away.`
    : 'Time is up. Resume to submit your saved answers.';
  return (
    <section
      aria-labelledby="active-exam-title"
      className="glass-panel"
      style={{ padding: '16px 20px', marginBottom: '20px', border: '1px solid rgba(217,119,6,0.4)' }}
    >
      <h2 id="active-exam-title" style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 4px' }}>
        ⏸ Unfinished exam
      </h2>
      <p style={{ margin: '0 0 4px', fontSize: '14px', color: 'var(--text-primary)' }}>
        {formatExamType(exam.exam_type)} · {exam.answered_count} of {exam.total_questions} answered
      </p>
      <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-secondary)' }}>{timeText}</p>
      {confirmDiscard ? (
        <div role="group" aria-label="Confirm discard" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-primary)', flexBasis: '100%' }}>
            Discard this exam? Its saved answers will be deleted.
          </span>
          <button type="button" className="btn-secondary" disabled={loading} onClick={() => onDiscard?.(exam)}>
            Yes, discard
          </button>
          <button type="button" className="btn-secondary" disabled={loading} onClick={() => setConfirmDiscard(false)}>
            Keep it
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button type="button" className="btn-secondary" disabled={loading} onClick={() => onResume?.(exam)}>
            Resume exam
          </button>
          <button type="button" className="btn-secondary" disabled={loading} onClick={() => setConfirmDiscard(true)}>
            Discard
          </button>
        </div>
      )}
    </section>
  );
}

export default function ExamSetup({
  loading,
  history,
  importedPapers,
  selectedPaper,
  setSelectedPaper,
  curriculum,
  contentAvailability,
  pickerValue,
  setPickerValue,
  numQuestions,
  setNumQuestions,
  timeLimitMin,
  setTimeLimitMin,
  sfRatio,
  setSfRatio,
  cfRatio,
  setCfRatio,
  cuRatio,
  setCuRatio,
  handleStart,
  examType,
  setExamType,
  activeExam = null,
  onResumeActive,
  onDiscardActive,
}: ExamSetupProps) {
  const pickerCurriculum = useMemo(() => {
    if (!curriculum || !contentAvailability || selectedPaper !== '') return curriculum;
    const filtered = Object.fromEntries(
      Object.entries(curriculum)
        .map(([subject, scopes]) => {
          const availableScopes = Object.fromEntries(
            Object.entries(scopes).filter(([scope]) =>
              hasAuthoredContent(contentAvailability, subject, scope)
            )
          );
          return [subject, availableScopes];
        })
        .filter(([, scopes]) => Object.keys(scopes).length > 0)
    ) as Curriculum;
    return Object.keys(filtered).length > 0 ? filtered : curriculum;
  }, [curriculum, contentAvailability, selectedPaper]);
  const options = examTypeOptions(pickerValue.subject);
  const selectedOption = options.find(option => option.value === examType) ?? options[0];
  const isSeniorPracticeSet = pickerValue.year.startsWith('unit') && selectedPaper === '';
  const availabilitySubject = backendSubjectFromPickerSubject(pickerValue.subject);
  const selectedAvailabilityRaw = pickerValue.year.startsWith('unit')
    ? contentAvailability?.by_unit?.[availabilitySubject]?.[pickerValue.year]
    : contentAvailability?.by_year?.[availabilitySubject]?.[pickerValue.year];
  const selectedAvailabilityCount = contentAvailability ? (selectedAvailabilityRaw ?? 0) : undefined;
  const generatedPaperUnavailable = selectedPaper === '' && selectedAvailabilityCount === 0;

  useEffect(() => {
    if (!options.some(option => option.value === examType)) {
      setExamType('mixed');
    }
  }, [examType, options, setExamType]);

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '24px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>
        {isSeniorPracticeSet ? '📝 Practice Set' : '📝 Mock Exam'}
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '14px' }}>
        Simulate a timed exam to practise under real conditions.
      </p>

      {activeExam && (
        <ActiveExamCard
          key={activeExam.exam_id}
          exam={activeExam}
          loading={loading}
          onResume={onResumeActive}
          onDiscard={onDiscardActive}
        />
      )}

      <div style={{ marginBottom: '20px' }}>
        <FrameworkSubjectYearPicker
          curriculum={pickerCurriculum}
          value={pickerValue}
          onChange={setPickerValue}
        />
      </div>

      <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>Number of Questions</label>
            <select
              value={numQuestions}
              onChange={e => setNumQuestions(Number(e.target.value))}
              style={{
                display: 'block',
                marginTop: '4px',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                width: '100%',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
              }}
            >
              <option value={10}>10 questions (quick practice)</option>
              <option value={20}>20 questions (standard)</option>
              <option value={30}>30 questions (full exam)</option>
              <option value={40}>40 questions</option>
              <option value={50}>50 questions</option>
            </select>
          </div>

          {/* Subject-aware focus selection for generated papers */}
          {selectedPaper === '' && (
            <div>
              <label style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                {isSeniorPracticeSet ? 'Practice Set Focus' : 'Exam Focus'}
              </label>
              <select
                value={examType}
                onChange={e => setExamType(e.target.value)}
                style={{
                  display: 'block',
                  marginTop: '4px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  width: '100%',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                }}
              >
                {options.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <p style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                {selectedOption.description}
              </p>
              {isSeniorPracticeSet && (
                <p style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Senior generated tasks are labelled as practice sets unless you choose an imported paper with official-like structure.
                </p>
              )}
            </div>
          )}
          {selectedPaper === '' && selectedAvailabilityCount !== undefined && (
            <div style={{
              padding: '10px 12px',
              borderRadius: '8px',
              border: generatedPaperUnavailable ? '1px solid rgba(220,38,38,0.35)' : '1px solid var(--border-color)',
              background: generatedPaperUnavailable ? 'rgba(220,38,38,0.08)' : 'rgba(255,255,255,0.02)',
              color: generatedPaperUnavailable ? '#dc2626' : 'var(--text-secondary)',
              fontSize: '12px',
              lineHeight: 1.45,
            }}>
              {generatedPaperUnavailable
                ? 'No authored exercises are available for this selected course scope yet. Choose another year/course or use an imported paper.'
                : `${selectedAvailabilityCount} authored exercises available for this selected scope.`}
            </div>
          )}
          <div>
            <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>Time Limit</label>
            <select
              value={timeLimitMin}
              onChange={e => setTimeLimitMin(Number(e.target.value))}
              style={{
                display: 'block',
                marginTop: '4px',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                width: '100%',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
              }}
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>60 minutes</option>
              <option value={90}>90 minutes</option>
            </select>
          </div>

          {/* Complexity Ratios (only for random generated paper for math) */}
          {selectedPaper === '' && pickerValue.subject === 'math' && (
            <div>
              <label
                style={{
                  fontSize: '15px',
                  fontWeight: '600',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>Complexity Ratios 📊</span>
                <span style={{ color: '#16a34a', fontWeight: '700' }}>Total: 100% ✓</span>
              </label>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  marginTop: '6px',
                  padding: '12px',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                }}
              >
                {/* SF Slider */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      marginBottom: '4px',
                    }}
                  >
                    <span>Simple Familiar (SF)</span>
                    <span>{sfRatio}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={sfRatio}
                    onChange={e => {
                      const sf = Number(e.target.value);
                      setSfRatio(sf);
                      if (sf + cfRatio > 100) {
                        setCfRatio(100 - sf);
                        setCuRatio(0);
                      } else {
                        setCuRatio(100 - sf - cfRatio);
                      }
                    }}
                    style={{ width: '100%', accentColor: 'var(--accent-color)' }}
                  />
                </div>

                {/* CF Slider */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      marginBottom: '4px',
                    }}
                  >
                    <span>Complex Familiar (CF)</span>
                    <span>{cfRatio}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={cfRatio}
                    onChange={e => {
                      const cf = Number(e.target.value);
                      if (sfRatio + cf > 100) {
                        setCfRatio(100 - sfRatio);
                        setCuRatio(0);
                      } else {
                        setCfRatio(cf);
                        setCuRatio(100 - sfRatio - cf);
                      }
                    }}
                    style={{ width: '100%', accentColor: 'var(--accent-color)' }}
                  />
                </div>

                {/* CU Value (Locked/Derived) */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      marginBottom: '4px',
                    }}
                  >
                    <span>Complex Unfamiliar (CU)</span>
                    <span style={{ fontWeight: '700' }}>{cuRatio}%</span>
                  </div>
                  <div
                    style={{
                      height: '8px',
                      borderRadius: '4px',
                      background: 'var(--bg-secondary)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${cuRatio}%`,
                        height: '100%',
                        borderRadius: '4px',
                        background: cuRatio > 0 ? 'var(--accent-color)' : 'transparent',
                        transition: 'width 0.2s ease',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Imported papers selector */}
          {importedPapers.length > 0 && (
            <div>
              <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                Use Imported Paper (optional)
              </label>
              <select
                value={selectedPaper}
                onChange={e => setSelectedPaper(e.target.value)}
                style={{
                  display: 'block',
                  marginTop: '4px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  width: '100%',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="">Random from question bank</option>
                {importedPapers.map(p => (
                  <option key={p.filename} value={p.filename}>
                    {p.title} ({p.num_questions} questions, {p.time_limit_minutes} min)
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={handleStart}
            disabled={loading || generatedPaperUnavailable}
            style={{
              padding: '12px 24px',
              fontSize: '15px',
              fontWeight: '700',
              background: 'var(--accent-color)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: loading || generatedPaperUnavailable ? 'not-allowed' : 'pointer',
              marginTop: '8px',
              opacity: loading || generatedPaperUnavailable ? 0.6 : 1,
            }}
          >
            {loading ? 'Building paper...' : 'Start Exam'}
          </button>
        </div>
      </div>

      {/* Past exams */}
      {history.length > 0 && (
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Past Exams</h2>
          {history.map((h, i) => (
            <div
              key={i}
              className="glass-panel"
              style={{
                padding: '12px 16px',
                marginBottom: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
                  {formatExamContext(h)}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {formatExamType(h.exam_type)} · {h.provisional ? 'Provisional · pending review' : 'Final'}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                  {formatExamDate(h.started_at)}
                </div>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>
                  {h.correct}/{h.total_questions} correct
                </div>
              </div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: '700',
                  color:
                    h.percentage >= 70
                      ? '#16a34a'
                      : h.percentage >= 50
                      ? '#d97706'
                      : '#dc2626',
                }}
              >
                {h.percentage}%
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '24px', textAlign: 'center' }}>
        <BackToPracticeLink />
      </div>
    </div>
  );
}
