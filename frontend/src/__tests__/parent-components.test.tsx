import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ActivityCalendar from '../components/parent/ActivityCalendar';
import CoverageConfidence from '../components/parent/CoverageConfidence';
import DailySummaryCards from '../components/parent/DailySummaryCards';
import ExamHistory from '../components/parent/ExamHistory';
import ParentAuth from '../components/parent/ParentAuth';
import PendingReviews from '../components/parent/PendingReviews';
import RestoreModal from '../components/parent/RestoreModal';
import StudentManagement from '../components/parent/StudentManagement';
import StrandProgress from '../components/parent/StrandProgress';

vi.mock('../lib/student_id', () => ({
  getStudentId: () => '11111111-1111-4111-8111-111111111111',
  getDisplayName: () => 'Current student',
}));

afterEach(() => cleanup());

describe('Parent analytics presentation contracts', () => {
  it('uses authoritative status instead of raw high BKT for mastered coverage', () => {
    const { container } = render(
      <CoverageConfidence progress={[{
        topic: 'AC9M7N02',
        attempts_count: 2,
        evidence_count: 2,
        direct_attempts_count: 2,
        accuracy: 1,
        bkt_mastery: 0.95,
        top_errors: {},
        confidence: 'medium',
        status: 'promising',
      }]} />,
    );
    expect(container.textContent).toContain('Mastered');
    expect(container.textContent).toContain('0Mastered');
  });

  it('labels global habit metrics and independent accuracy', () => {
    render(
      <DailySummaryCards
        daily={{
          scope: 'all_subjects',
          today_attempts: 4,
          today_correct: 3,
          today_independent_attempts: 2,
          today_independent_correct: 1,
          today_independent_accuracy: 50,
          daily_goal: 10,
          goal_progress: 0.4,
          streak_days: 3,
        }}
        examsCount={1}
      />,
    );
    expect(screen.getByText(/Questions across all subjects today/i)).toBeTruthy();
    expect(screen.getByText(/Independent accuracy across all subjects today/i)).toBeTruthy();
    expect(screen.getByText(/Show Answer submissions are excluded/i)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: /all-subject daily question goal/i }).getAttribute('aria-valuenow')).toBe('40');
  });

  it('marks provisional exam scores', () => {
    render(<ExamHistory exams={[{
      exam_id: 'exam-1',
      started_at: '2026-07-30T10:00:00+00:00',
      correct: 7,
      total_questions: 10,
      percentage: 70.4,
      provisional: true,
    }]} />);
    expect(screen.getByText(/Provisional · pending review/i)).toBeTruthy();
    expect(screen.getByText('70%')).toBeTruthy();
  });

  it('renders frozen activity separately from no activity', () => {
    render(<ActivityCalendar activityDates={[
      { date: '2026-07-30', active: false, frozen: true },
      { date: '2026-07-31', active: false },
    ]} />);
    expect(screen.getByRole('gridcell', { name: /2026-07-30: streak freeze used/i })).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: /2026-07-31: no activity, today/i })).toBeTruthy();
  });

  it('adds accessible values to strand progress', () => {
    render(<StrandProgress strandStats={{ Number: { mastered: 2, total: 5 } }} />);
    const bar = screen.getByRole('progressbar', { name: /Number: 2 of 5 topics mastered/i });
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
  });
});

describe('Parent controls accessibility', () => {
  it('labels login input and announces errors', () => {
    render(<ParentAuth passwordInput="" passwordError="Incorrect password" onPasswordChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Parent password')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Incorrect password');
  });

  it('opens RestoreModal as a dialog, focuses Cancel and closes with Escape', () => {
    const onCancel = vi.fn();
    render(<RestoreModal target={{ uuid: '22222222-2222-4222-8222-222222222222', name: 'Target student' }} onCancel={onCancel} onConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /Switch Student Identity/i })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders all household profiles and can switch to another student', () => {
    const onSwitch = vi.fn();
    render(
      <StudentManagement
        students={[
          {
            student_id: '11111111-1111-4111-8111-111111111111',
            display_name: 'Current student',
            subjects: ['math'],
          },
          {
            student_id: '22222222-2222-4222-8222-222222222222',
            display_name: 'Registered only',
            subjects: [],
          },
        ]}
        listError=""
        deleting={null}
        deleteBusy={false}
        onSwitchToStudent={onSwitch}
        onDeleteStudent={vi.fn()}
      />,
    );

    expect(screen.getByText('Current student')).toBeTruthy();
    expect(screen.getByText('Registered only')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to' }));
    expect(onSwitch).toHaveBeenCalledWith(expect.objectContaining({
      student_id: '22222222-2222-4222-8222-222222222222',
    }));
  });

  it('dims and disables only the review being submitted', () => {
    const reviews = [
      { review_key: 'first', question_id: 'q1', student_answer: 'a', correct_answer: 'b', topic: 'T1' },
      { review_key: 'second', question_id: 'q2', student_answer: 'c', correct_answer: 'd', topic: 'T2' },
    ];
    render(<PendingReviews reviews={reviews} reviewing="first" parentSubject="math" onReview={vi.fn()} />);
    const rejectButtons = screen.getAllByRole('button', { name: 'Reject' }) as HTMLButtonElement[];
    expect(rejectButtons[0].disabled).toBe(true);
    expect(rejectButtons[0].style.opacity).toBe('0.5');
    expect(rejectButtons[1].disabled).toBe(false);
    expect(rejectButtons[1].style.opacity).toBe('1');
  });
});
