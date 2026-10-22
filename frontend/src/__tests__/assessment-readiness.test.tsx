import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import AssessmentReadiness from '../components/parent/AssessmentReadiness';
import type { ExamHistoryItem } from '../lib/api-types';


afterEach(() => cleanup());

function exam(index: number, percentage: number, overrides: Partial<ExamHistoryItem> = {}): ExamHistoryItem {
  return {
    exam_id: `exam-${index}`,
    subject: 'math',
    year_level: 7,
    exam_type: 'mixed',
    started_at: `2026-07-0${index}T00:00:00+00:00`,
    completed_at: `2026-07-0${index}T00:30:00+00:00`,
    percentage,
    correct: Math.round(percentage / 10),
    total_questions: 10,
    ...overrides,
  };
}

describe('AssessmentReadiness comparable trend windows', () => {
  it('requires two two-exam windows of the same final exam type', () => {
    render(
      <AssessmentReadiness
        exams={[
          exam(3, 80),
          exam(2, 75),
          exam(1, 95, { exam_type: 'reading' }),
          exam(4, 100, { provisional: true }),
        ]}
        latestPsmt={null}
        showPsmt={false}
      />
    );

    expect(screen.getByText(/Two two-exam windows are required/i)).toBeTruthy();
  });

  it('compares two windows only after four comparable final exams', () => {
    render(
      <AssessmentReadiness
        exams={[
          exam(4, 90),
          exam(3, 86),
          exam(2, 70),
          exam(1, 68),
        ]}
        latestPsmt={null}
        showPsmt={false}
      />
    );

    expect(screen.getByText(/Improving across two comparable two-exam windows/i)).toBeTruthy();
  });
});
