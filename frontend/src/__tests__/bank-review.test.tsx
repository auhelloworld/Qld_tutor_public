import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import BankReviewPanel from '../components/parent/BankReviewPanel';

vi.mock('../lib/api', () => ({
  bankReviewStatus: vi.fn(),
  bankReviewImport: vi.fn(),
  bankReviewImportExam: vi.fn(),
  bankReviewListExams: vi.fn(),
  bankReviewListTargets: vi.fn(),
  bankReviewLoadBank: vi.fn(),
  bankReviewSaveBank: vi.fn(),
  bankReviewSaveExam: vi.fn(),
  bankReviewSession: vi.fn(),
  bankReviewItem: vi.fn(),
  bankReviewFlag: vi.fn(),
  bankReviewAppend: vi.fn(),
  bankReviewMark: vi.fn(),
  bankReviewUpdateItem: vi.fn(),
  bankReviewExport: vi.fn(),
  bankReviewBulkStatus: vi.fn(),
  bankReviewDeleteItem: vi.fn(),
}));

import {
  bankReviewStatus,
  bankReviewImport,
  bankReviewListExams,
  bankReviewListTargets,
  bankReviewLoadBank,
  bankReviewSession,
  bankReviewItem,
  bankReviewUpdateItem,
  bankReviewSaveBank,
  bankReviewDeleteItem,
  bankReviewExport,
} from '../lib/api';

describe('BankReviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(bankReviewListExams).mockResolvedValue({ exams_dir: 'data/exams', papers: [] });
    vi.mocked(bankReviewListTargets).mockResolvedValue({ data_dir: 'data', targets: [] });
  });

  it('shows parent-password message when bank review is unavailable', async () => {
    vi.mocked(bankReviewStatus).mockResolvedValue({ enabled: false, auth: 'parent' });
    render(<BankReviewPanel />);
    await waitFor(() => {
      expect(screen.getByText(/PARENT_PASSWORD/i)).toBeTruthy();
    });
  });

  it('loads session and renders exercise content with diagram meta', async () => {
    vi.mocked(bankReviewStatus).mockResolvedValue({ enabled: true, auth: 'parent' });
    vi.mocked(bankReviewImport).mockResolvedValue({
      session_id: 'sess-1',
      source_name: 'sample.json',
      total: 1,
      valid_for_append: 1,
      with_errors: 0,
      target_histogram: { 'exercise_7_math.json': 1 },
    });
    vi.mocked(bankReviewSession).mockResolvedValue({
      session_id: 'sess-1',
      source_name: 'sample.json',
      total: 1,
      items: [{
        id: 'math_test_1',
        question_type: 'short_answer',
        subject: 'math',
        year_level: 7,
        unit: null,
        difficulty: 'foundational',
        diagram_type: 'number_line',
        has_diagram: true,
        target_file: 'exercise_7_math.json',
        target_error: null,
        valid_for_append: true,
        issue_count: 0,
        has_errors: false,
        reviewed: false,
        topic_ids: ['AC9M7N01'],
      }],
    });
    vi.mocked(bankReviewItem).mockResolvedValue({
      index: 0,
      total: 1,
      meta: {
        id: 'math_test_1',
        question_type: 'short_answer',
        subject: 'math',
        year_level: 7,
        unit: null,
        difficulty: 'foundational',
        diagram_type: 'number_line',
        has_diagram: true,
        target_file: 'exercise_7_math.json',
        target_error: null,
        valid_for_append: true,
        issue_count: 0,
        has_errors: false,
        reviewed: false,
        topic_ids: ['AC9M7N01'],
      },
      exercise: {
        id: 'math_test_1',
        topic: 'Number',
        question: 'Where is $\\sqrt{2}$ on the number line?',
        answer: 'Between 1 and 2',
        steps: [],
        subject: 'math',
        year_level: 7,
        topic_ids: ['AC9M7N01'],
        question_type: 'short_answer',
        diagram_data: { type: 'number_line', min: 0, max: 3, marks: [] },
      } as any,
      issues: [],
      valid_for_append: true,
    });

    render(<BankReviewPanel />);
    await waitFor(() => {
      expect(document.querySelector('input[type="file"]')).toBeTruthy();
      expect(screen.getByRole('heading', { name: /Upload exercise JSON/i })).toBeTruthy();
      expect(document.querySelector('input[type="file"]')?.closest('.glass-panel')).toBeTruthy();
    });

    const file = new File(
      [JSON.stringify([{ id: 'math_test_1' }])],
      'sample.json',
      { type: 'application/json' },
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const text = document.body.textContent || '';
      expect(text).toContain('math_test_1');
      expect(text).toContain('number_line');
      expect(text).toMatch(/Append all valid/i);
      expect(screen.getByRole('button', { name: /Delete question/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Download updated JSON/i })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Save bank/i })).toBeNull();
      expect(screen.getByLabelText(/image/i)).toBeTruthy();
    });

    vi.mocked(bankReviewDeleteItem).mockResolvedValue({
      ok: true,
      deleted_id: 'math_test_1',
      deleted_index: 0,
      total: 0,
      next_index: null,
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Delete question/i }));
    await waitFor(() => {
      expect(bankReviewDeleteItem).toHaveBeenCalledWith('sess-1', 0);
      expect(document.body.textContent).toContain('Use Download updated JSON to persist the deletion.');
    });
    confirmSpy.mockRestore();

    vi.mocked(bankReviewExport).mockResolvedValue({
      source_name: 'sample.json',
      total: 0,
      activated: false,
      exercises: [],
    });
    const createObjectURL = vi.fn(() => 'blob:bank-review');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole('button', { name: /Download updated JSON/i }));
    await waitFor(() => {
      expect(bankReviewExport).toHaveBeenCalledWith('sess-1', false);
      expect(document.body.textContent).toContain('Downloaded 0 items as sample_edited.json.');
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:bank-review');
    anchorClick.mockRestore();
  });

  it('keeps production edits in the review session until an explicit durable save', async () => {
    vi.mocked(bankReviewStatus).mockResolvedValue({ enabled: true, auth: 'parent' });
    vi.mocked(bankReviewListTargets).mockResolvedValue({
      data_dir: 'data',
      targets: [{ file: 'exercise_7_math.json', path: 'data/exercise_7_math.json', count: 1 }],
    });
    const exercise = {
      id: 'production_edit_1',
      topic: 'Number',
      question: 'What is $1+1$?',
      answer: '2',
      steps: ['Add.'],
      subject: 'math',
      year_level: 7,
      topic_ids: ['AC9M7N01'],
      question_type: 'short_answer',
      difficulty: 'foundational',
      status: 'active',
    } as any;
    const meta = {
      id: 'production_edit_1',
      question_type: 'short_answer',
      subject: 'math',
      year_level: 7,
      unit: null,
      difficulty: 'foundational',
      diagram_type: null,
      has_diagram: false,
      target_file: 'exercise_7_math.json',
      target_error: null,
      valid_for_append: true,
      issue_count: 0,
      has_errors: false,
      reviewed: false,
      topic_ids: ['AC9M7N01'],
    };
    vi.mocked(bankReviewLoadBank).mockResolvedValue({
      session_id: 'production-session',
      source_name: 'exercise_7_math.json',
      source_kind: 'bank_file',
      detected_format: 'production_bank',
      bank_filename: 'exercise_7_math.json',
      total: 1,
      valid_for_append: 1,
      with_errors: 0,
      target_histogram: { 'exercise_7_math.json': 1 },
    });
    vi.mocked(bankReviewSession).mockResolvedValue({
      session_id: 'production-session',
      source_name: 'exercise_7_math.json',
      source_kind: 'bank_file',
      detected_format: 'production_bank',
      bank_filename: 'exercise_7_math.json',
      total: 1,
      items: [meta],
    });
    vi.mocked(bankReviewItem).mockResolvedValue({
      index: 0,
      total: 1,
      meta,
      exercise,
      issues: [],
      valid_for_append: true,
    });
    vi.mocked(bankReviewUpdateItem).mockResolvedValue({
      index: 0,
      total: 1,
      meta,
      exercise: { ...exercise, question: 'Updated question' },
      issues: [],
      valid_for_append: true,
    });

    render(<BankReviewPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open & edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Open & edit' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save edits' })).toBeTruthy());
    const textboxes = screen.getAllByRole('textbox');
    fireEvent.change(textboxes[0], { target: { value: 'Updated question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));

    await waitFor(() => {
      expect(bankReviewUpdateItem).toHaveBeenCalled();
      expect(document.body.textContent).toContain('Saved in session only');
    });
    expect(bankReviewSaveBank).not.toHaveBeenCalled();
  });
});
