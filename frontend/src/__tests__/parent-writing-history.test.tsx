import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ParentWritingHistory from '../components/parent/ParentWritingHistory';

describe('ParentWritingHistory', () => {
  it('renders scoped summary fields without draft content', () => {
    render(
      <ParentWritingHistory
        data={{
          student_id: 'student-1',
          assessments: [{
            timestamp: '2026-08-01T00:00:00+00:00',
            year_level: 11,
            prompt_type: 'analytical',
            topic_title: 'A text',
            word_count: 420,
            total_score: 8,
            max_total_score: 10,
            has_source_text: true,
            has_writer_statement: false,
            is_senior: true,
          }],
        }}
      />,
    );

    expect(screen.getByText(/Writing History/)).toBeTruthy();
    expect(screen.getByText(/Analytical · Year 11/)).toBeTruthy();
    expect(screen.getByText('8/10 (80%)')).toBeTruthy();
    expect(screen.queryByText('private draft')).toBeNull();
  });

  it('states when the selected scope has no assessments', () => {
    render(<ParentWritingHistory data={{ student_id: 'student-1', assessments: [] }} />);
    expect(screen.getByText('No writing assessments in this scope yet.')).toBeTruthy();
  });
});
