import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ExamSetup from '../components/exam/ExamSetup';
import type { Curriculum, Subject, YearLevel } from '../lib/api-types';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock('../components/FrameworkSubjectYearPicker', () => ({
  default: ({ curriculum, value }: { curriculum: Curriculum | null; value: { subject: Subject; year: YearLevel } }) => (
    <div data-testid="subject-year-picker">
      {value.subject} {value.year} subjects:{Object.keys(curriculum || {}).join(',')}
    </div>
  ),
}));

afterEach(() => cleanup());

const baseProps = {
  loading: false,
  history: [],
  importedPapers: [],
  selectedPaper: '',
  setSelectedPaper: vi.fn(),
  curriculum: null,
  contentAvailability: null,
  pickerValue: { subject: 'math' as Subject, year: 'year7' as YearLevel },
  setPickerValue: vi.fn(),
  numQuestions: 20,
  setNumQuestions: vi.fn(),
  timeLimitMin: 45,
  setTimeLimitMin: vi.fn(),
  techMode: 'mixed' as const,
  setTechMode: vi.fn(),
  sfRatio: 60,
  setSfRatio: vi.fn(),
  cfRatio: 30,
  setCfRatio: vi.fn(),
  cuRatio: 10,
  setCuRatio: vi.fn(),
  handleStart: vi.fn(),
  examType: 'mixed',
  setExamType: vi.fn(),
};

describe('ExamSetup subject-aware Phase 4 safeguards', () => {
  it('shows English-specific exam focus options', () => {
    render(<ExamSetup {...baseProps} pickerValue={{ subject: 'english', year: 'year7' }} />);

    expect(screen.getByText('Reading comprehension')).toBeTruthy();
    expect(screen.getByText('Language conventions')).toBeTruthy();
    expect(screen.getByText('Extended response')).toBeTruthy();
    expect(screen.queryByText('Simple familiar')).toBeNull();
  });

  it('shows Maths-specific exam focus options', () => {
    render(<ExamSetup {...baseProps} pickerValue={{ subject: 'math', year: 'year7' }} />);

    expect(screen.getByText('Mixed Maths practice set')).toBeTruthy();
    expect(screen.getByText('📝 NAPLAN numeracy')).toBeTruthy();
    expect(screen.getByText('⚡ Fluency check')).toBeTruthy();
    expect(screen.getByText('🏆 AMC challenge')).toBeTruthy();
    expect(screen.getByText('Simple Familiar (SF)')).toBeTruthy();
    expect(screen.getByText('Complex Familiar (CF)')).toBeTruthy();
    expect(screen.getByText('Complex Unfamiliar (CU)')).toBeTruthy();
    expect(screen.getByText('50 questions')).toBeTruthy();
    expect(screen.queryByText('55 questions')).toBeNull();
    expect(screen.queryByText('Reading comprehension')).toBeNull();
  });

  it('labels generated senior tasks as practice sets', () => {
    render(<ExamSetup {...baseProps} pickerValue={{ subject: 'senior_english' as Subject, year: 'unit3' as YearLevel }} />);

    expect(screen.getByText('📝 Practice Set')).toBeTruthy();
    expect(screen.getByText('Practice Set Focus')).toBeTruthy();
    expect(screen.getByText(/Senior generated tasks are labelled as practice sets/i)).toBeTruthy();
  });

  it('shows Methods Paper 1 / Paper 2 presets for senior methods', () => {
    render(<ExamSetup {...baseProps} pickerValue={{ subject: 'senior_methods' as Subject, year: 'unit3' as YearLevel }} />);

    expect(screen.getByText('📝 Paper 1 (technology-free)')).toBeTruthy();
    expect(screen.getByText('🖩 Paper 2 (technology-active)')).toBeTruthy();
    // Maths AC9 presets must not leak into the senior methods options.
    expect(screen.queryByText('🏆 AMC challenge')).toBeNull();
  });

  it('filters generated paper picker scopes with no authored exercises', () => {
    render(
      <ExamSetup
        {...baseProps}
        curriculum={{
          math: { year7: {} },
          science: { year7: {} },
        }}
        contentAvailability={{
          by_subject: { math: 10 },
          by_year: { math: { year7: 10 }, science: { year7: 0 } },
          by_unit: {},
        }}
      />
    );

    expect(screen.getByTestId('subject-year-picker').textContent).toContain('subjects:math');
    expect(screen.getByTestId('subject-year-picker').textContent).not.toContain('science');
  });
});


describe('ExamSetup history context', () => {
  it('shows scope, exam type, and provisional status in past history', () => {
    render(
      <ExamSetup
        {...baseProps}
        history={[{
          started_at: '2026-08-01T00:00:00+00:00',
          subject: 'methods',
          unit: 3,
          syllabus_subject: 'methods',
          exam_type: 'paper_1',
          provisional: true,
          correct: 8,
          total_questions: 10,
          percentage: 80,
        }]}
      />
    );

    expect(screen.getByText('Mathematical Methods · Unit 3')).toBeTruthy();
    expect(screen.getByText('Paper 1 · Provisional · pending review')).toBeTruthy();
    expect(screen.getByText('8/10 correct')).toBeTruthy();
  });
});
