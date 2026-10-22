'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './BankReviewPanel.module.css';
import MathMarkdown from '../MathMarkdown';
import GuidedQuestionCard from '../guided/GuidedQuestionCard';
import GuidedFeedbackCard from '../guided/GuidedFeedbackCard';
import {
  bankReviewAppend,
  bankReviewCloseSession,
  bankReviewFlag,
  bankReviewImport,
  bankReviewImportExam,
  bankReviewItem,
  bankReviewListExams,
  bankReviewListTargets,
  bankReviewLoadBank,
  bankReviewMark,
  bankReviewSaveBank,
  bankReviewSaveExam,
  bankReviewSession,
  bankReviewStatus,
  bankReviewUpdateItem,
  bankReviewExport,
  bankReviewBulkStatus,
  bankReviewDeleteItem,
} from '../../lib/api';
import type {
  BankReviewAppendReport,
  BankReviewExamPaper,
  BankReviewImportResult,
  BankReviewIndexItem,
  BankReviewItemPayload,
  BankReviewTargetFile,
  Exercise,
  SubPartResult,
  TutorMarkResponse,
} from '../../lib/api-types';

type FilterMode = 'all' | 'diagrams' | 'errors' | 'unreviewed';

type SubPartDraft = {
  label: string;
  question: string;
  answer: string;
  marks: string;
};

type EditDraft = {
  question: string;
  answer: string;
  stepsText: string;
  rubricPointsText: string;
  status: "active" | "draft";
  difficulty: string;
  subParts: SubPartDraft[];
  /** Pretty-printed JSON for diagram_data; empty string = no diagram */
  diagramDataText: string;
  /** Image path/URL/data URI; empty string = no image */
  imageText: string;
  sampleReasoning: string;
  /** Accessibility text describing the diagram/image */
  diagramDescription: string;
};

function keyPointLabels(rubric: unknown): string[] {
  if (!rubric || typeof rubric !== 'object') return [];
  const points = (rubric as { key_points?: unknown }).key_points;
  if (!Array.isArray(points)) return [];
  return points.map((p) => {
    if (typeof p === 'string') return p;
    if (p && typeof p === 'object') {
      const row = p as { text?: unknown; label?: unknown; description?: unknown };
      return String(row.text ?? row.label ?? row.description ?? '');
    }
    return String(p ?? '');
  }).filter((s) => s.trim().length > 0);
}

function nextPartLabel(index: number): string {
  if (index < 26) return String.fromCharCode(97 + index); // a, b, c…
  return `p${index + 1}`;
}

function draftSubParts(ex: Record<string, unknown>): SubPartDraft[] {
  const raw = Array.isArray(ex.sub_parts) ? ex.sub_parts : [];
  return raw.map((p, i) => {
    const row = (p && typeof p === 'object') ? p as Record<string, unknown> : {};
    return {
      label: String(row.label ?? nextPartLabel(i)),
      question: String(row.question ?? ''),
      answer: String(row.answer ?? ''),
      marks: row.marks != null && row.marks !== '' ? String(row.marks) : '1',
    };
  });
}

function formatDiagramDataText(diagram: unknown): string {
  if (diagram == null || diagram === '') return '';
  if (typeof diagram === 'string') {
    try {
      return JSON.stringify(JSON.parse(diagram), null, 2);
    } catch {
      return diagram;
    }
  }
  try {
    return JSON.stringify(diagram, null, 2);
  } catch {
    return '';
  }
}

function draftFromExercise(ex: Record<string, unknown>): EditDraft {
  const steps = Array.isArray(ex.steps) ? ex.steps.map((s) => String(s)) : [];
  const statusRaw = String(ex.status ?? 'active').toLowerCase();
  return {
    question: String(ex.question ?? ''),
    answer: String(ex.answer ?? ''),
    stepsText: steps.join('\n'),
    rubricPointsText: keyPointLabels(ex.rubric).join('\n'),
    status: statusRaw === 'draft' ? 'draft' : 'active',
    difficulty: String(ex.difficulty ?? ''),
    subParts: draftSubParts(ex),
    diagramDataText: formatDiagramDataText(ex.diagram_data),
    imageText: String(ex.image ?? ''),
    sampleReasoning: String(ex.sample_reasoning ?? ''),
    diagramDescription: String(ex.diagram_description ?? ''),
  };
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  lineHeight: 1.45,
};

const previewBoxStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--text-primary)',
  lineHeight: 1.5,
  minHeight: 48,
  overflow: 'auto',
};

function subjectWantsLatexPreview(subject: string | null | undefined): boolean {
  const s = String(subject || '').toLowerCase();
  // English (and similar text subjects) edit as plain text only.
  if (!s || s === 'english' || s.includes('english') || s === 'literature' || s === 'eal') {
    return false;
  }
  // Science sometimes uses light math notation — keep preview on for non-English.
  return true;
}

/** Source textarea; optional live MathMarkdown/LaTeX preview (side-by-side). */
function LatexEditField({
  label,
  hint,
  value,
  onChange,
  rows = 4,
  minHeight = 100,
  placeholder,
  previewMode = 'block',
  showLatexPreview = true,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  minHeight?: number;
  placeholder?: string;
  /** 'lines' = each non-empty line as a list item with its own MathMarkdown */
  previewMode?: 'block' | 'lines';
  showLatexPreview?: boolean;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
        {label}
        {hint && showLatexPreview && (
          <span style={{ fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>{hint}</span>
        )}
      </div>
      {showLatexPreview ? (
        <div
          className={styles.editFieldGrid}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
            gap: 10,
            alignItems: 'stretch',
            width: '100%',
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>
              Source
            </div>
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              rows={rows}
              placeholder={placeholder}
              style={{ ...fieldStyle, resize: 'vertical', minHeight }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>
              Preview (LaTeX)
            </div>
            <div style={{ ...previewBoxStyle, minHeight }}>
              {!value.trim() ? (
                <span style={{ color: 'var(--text-muted)' }}>(empty)</span>
              ) : previewMode === 'lines' ? (
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {value
                    .split('\n')
                    .map((line) => line.trimEnd())
                    .filter((line) => line.length > 0)
                    .map((line, i) => (
                      <li key={i} style={{ marginBottom: 6 }}>
                        <MathMarkdown>{line}</MathMarkdown>
                      </li>
                    ))}
                </ol>
              ) : (
                <MathMarkdown>{value}</MathMarkdown>
              )}
            </div>
          </div>
        </div>
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          style={{ ...fieldStyle, resize: 'vertical', minHeight }}
        />
      )}
    </div>
  );
}

/**
 * Parent-gated exercise bank import / preview / mark / append tool.
 * Expects an active parent session (sessionStorage parent_token via safeFetch).
 */
export default function BankReviewPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [indexItems, setIndexItems] = useState<BankReviewIndexItem[]>([]);
  const [importSummary, setImportSummary] = useState<BankReviewImportResult | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [itemPayload, setItemPayload] = useState<BankReviewItemPayload | null>(null);
  const [loadingItem, setLoadingItem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [appendReport, setAppendReport] = useState<BankReviewAppendReport | null>(null);
  const [showInspector, setShowInspector] = useState(true);
  // Local answer state so preview matches Guided Practice interaction.
  const [previewAnswer, setPreviewAnswer] = useState('');
  const [multiPartResults, setMultiPartResults] = useState<SubPartResult[]>([]);
  const [activeMultipartLabel, setActiveMultipartLabel] = useState<string | null>(null);
  const [markResponse, setMarkResponse] = useState<TutorMarkResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [sourceKind, setSourceKind] = useState<'exam' | 'bank' | 'bank_file' | string>('bank');
  const [examFilename, setExamFilename] = useState<string | null>(null);
  const [bankFilename, setBankFilename] = useState<string | null>(null);
  const [examMeta, setExamMeta] = useState<{ title?: string | null; time_limit_minutes?: number | null }>({});
  const [examPapers, setExamPapers] = useState<BankReviewExamPaper[]>([]);
  const [bankTargets, setBankTargets] = useState<BankReviewTargetFile[]>([]);
  const [examDefaultSubject, setExamDefaultSubject] = useState('math');
  const [examDefaultYear, setExamDefaultYear] = useState('7');
  const [saveExamMessage, setSaveExamMessage] = useState('');
  /** Session indices successfully saved via Save edits (green tick in sidebar). */
  const [editedIndexes, setEditedIndexes] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    let active = true;
    bankReviewStatus()
      .then((s) => { if (active) setEnabled(Boolean(s.enabled)); })
      .catch(() => { if (active) setEnabled(false); });
    return () => { active = false; };
  }, []);

  const refreshExamList = useCallback(async () => {
    try {
      const res = await bankReviewListExams();
      setExamPapers(res.papers || []);
    } catch {
      setExamPapers([]);
    }
  }, []);

  const refreshBankList = useCallback(async () => {
    try {
      const res = await bankReviewListTargets();
      setBankTargets(res.targets || []);
    } catch {
      setBankTargets([]);
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      void refreshExamList();
      void refreshBankList();
    }
  }, [enabled, refreshExamList, refreshBankList]);

  const applyImportResult = (result: BankReviewImportResult) => {
    setImportSummary(result);
    setSessionId(result.session_id);
    const kind = result.source_kind
      || (result.detected_format === 'imported_exam'
        ? 'exam'
        : result.detected_format === 'production_bank'
          ? 'bank_file'
          : 'bank');
    setSourceKind(kind);
    setExamFilename(result.exam_filename ?? null);
    setBankFilename(result.bank_filename ?? (kind === 'bank_file' ? result.source_name : null));
    setExamMeta(result.exam_meta || {});
    setSaveExamMessage('');
    setEditedIndexes(new Set());
  };

  const filteredIndexes = useMemo(() => {
    return indexItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (filter === 'diagrams') return item.has_diagram;
        if (filter === 'errors') return item.has_errors || !item.valid_for_append;
        if (filter === 'unreviewed') return !item.reviewed;
        return true;
      });
  }, [indexItems, filter]);

  const loadItem = useCallback(async (sid: string, index: number) => {
    setLoadingItem(true);
    setError('');
    try {
      const payload = await bankReviewItem(sid, index);
      setItemPayload(payload);
      setCurrentIndex(index);
      setPreviewAnswer('');
      setMultiPartResults([]);
      setActiveMultipartLabel(null);
      setMarkResponse(null);
      setEditDraft(draftFromExercise(payload.exercise as Record<string, unknown>));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load item');
      setItemPayload(null);
      setEditDraft(null);
    } finally {
      setLoadingItem(false);
    }
  }, []);

  const refreshSession = useCallback(async (sid: string, preferIndex = 0) => {
    const session = await bankReviewSession(sid);
    setIndexItems(session.items);
    setSourceName(session.source_name);
    const kind = session.source_kind
      || (session.detected_format === 'imported_exam'
        ? 'exam'
        : session.detected_format === 'production_bank'
          ? 'bank_file'
          : 'bank');
    setSourceKind(kind);
    setExamFilename(session.exam_filename ?? null);
    setBankFilename(session.bank_filename ?? (kind === 'bank_file' ? session.source_name : null));
    setExamMeta(session.exam_meta || {});
    const nextIndex = Math.min(Math.max(preferIndex, 0), Math.max(session.total - 1, 0));
    if (session.total > 0) {
      await loadItem(sid, nextIndex);
    } else {
      setItemPayload(null);
      setEditDraft(null);
      setCurrentIndex(0);
    }
  }, [loadItem]);

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError('');
    setAppendReport(null);
    setSaveExamMessage('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const result = await bankReviewImport(parsed, file.name);
      applyImportResult(result);
      await refreshSession(result.session_id, 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed');
      setSessionId(null);
      setIndexItems([]);
      setItemPayload(null);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenExamPaper = async (filename: string) => {
    setBusy(true);
    setError('');
    setAppendReport(null);
    setSaveExamMessage('');
    try {
      const yearNum = Number.parseInt(examDefaultYear, 10);
      const result = await bankReviewImportExam(filename, {
        default_subject: examDefaultSubject || undefined,
        default_year_level: Number.isFinite(yearNum) ? yearNum : undefined,
      });
      applyImportResult(result);
      await refreshSession(result.session_id, 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to open exam paper');
      setSessionId(null);
      setIndexItems([]);
      setItemPayload(null);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveExam = async () => {
    if (!sessionId) return;
    const defaultName = examFilename || `${(sourceName || 'reviewed_exam').replace(/\.json$/i, '')}.json`;
    const filename = window.prompt(
      'Save to data/exams/ as (basename .json). Creates .bak if file exists.',
      defaultName,
    );
    const validCount = indexItems.filter((item) => item.valid_for_append).length;
    const invalidCount = Math.max(indexItems.length - validCount, 0);
    if (!window.confirm(
      `Write ${validCount} valid question(s) to data/exams/${filename}?\n\n`
        + (invalidCount
          ? `${invalidCount} invalid question(s) will block the write. `
          : '')
        + 'A verified .bak is required before replacing an existing paper.',
    )) return;
    setBusy(true);
    setError('');
    setSaveExamMessage('');
    try {
      const res = await bankReviewSaveExam(sessionId, {
        filename,
        title: examMeta.title || sourceName || undefined,
        time_limit_minutes: examMeta.time_limit_minutes ?? undefined,
        create_backup: true,
      });
      setExamFilename(res.filename);
      setSourceKind('exam');
      setSourceName(res.title || filename);
      setExamMeta({ title: res.title || filename, time_limit_minutes: res.time_limit_minutes });
      setSaveExamMessage(
        `Saved ${res.num_questions} questions → data/exams/${res.filename}`
          + ` · backup ${res.backup_created ? 'verified' : 'not created (new file)'}`,
      );
      await refreshExamList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save exam failed');
    } finally {
      setBusy(false);
    }
  };

  const handleOpenBank = async (filename: string) => {
    setBusy(true);
    setError('');
    setAppendReport(null);
    setSaveExamMessage('');
    try {
      const result = await bankReviewLoadBank(filename);
      applyImportResult(result);
      await refreshSession(result.session_id, 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load bank');
      setSessionId(null);
      setIndexItems([]);
      setItemPayload(null);
    } finally {
      setBusy(false);
    }
  };

  /** Write the full session array to data/exercise_*.json after explicit confirmation. */
  const writeBankToDisk = async (opts?: {
    filename?: string;
  }): Promise<{
    filename: string;
    num_items: number;
    backup_created: boolean;
    reload_succeeded: boolean;
  } | null> => {
    if (!sessionId) return null;
    const defaultName = opts?.filename || bankFilename || sourceName || '';
    if (!defaultName) {
      throw new Error('No bank filename — open a production bank first (Open & edit).');
    }
    const validCount = indexItems.filter((item) => item.valid_for_append).length;
    const invalidCount = Math.max(indexItems.length - validCount, 0);
    const prompted = window.prompt(
      'Overwrite production bank under data/ (exercise_*.json). Creates .bak first.\n\n'
        + `This replaces the ENTIRE file with ${validCount} valid session item(s)`
        + (invalidCount ? `; ${invalidCount} invalid item(s) will block the write.` : '.')
        + '\n\nEnter the target basename:',
      defaultName,
    );
    if (!prompted) return null;
    if (!window.confirm(
      `Write ${validCount} valid item(s) to data/${prompted}?\n\n`
        + 'This overwrites the production practice bank. A verified .bak is required before replacement.',
    )) return null;

    const res = await bankReviewSaveBank(sessionId, {
      filename: prompted,
      create_backup: true,
      require_all_valid: true,
    });
    setBankFilename(res.filename);
    setSourceKind('bank_file');
    setSourceName(res.filename);
    await refreshBankList();
    return {
      filename: res.filename,
      num_items: res.num_items,
      backup_created: Boolean(res.backup_created),
      reload_succeeded: Boolean(res.reload_succeeded),
    };
  };

  const handleSaveBank = async () => {
    if (!sessionId) return;
    setBusy(true);
    setError('');
    setSaveExamMessage('');
    try {
      const res = await writeBankToDisk();
      if (res) {
        setSaveExamMessage(
          `Saved ${res.num_items} items → data/${res.filename}`
            + ` · backup ${res.backup_created ? 'verified' : 'not created (new file)'}`
            + ` · tutor bank ${res.reload_succeeded ? 'reloaded' : 'not reloaded'}`,
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save bank failed');
    } finally {
      setBusy(false);
    }
  };

  const isExamSession = sourceKind === 'exam' || importSummary?.detected_format === 'imported_exam';
  const isBankFileSession = sourceKind === 'bank_file'
    || importSummary?.detected_format === 'production_bank'
    || Boolean(bankFilename);
  const isUploadedJsonSession = !isExamSession && !isBankFileSession;
  const persistActionLabel = isBankFileSession
    ? 'Save bank'
    : isExamSession
      ? 'Save exam'
      : 'Download updated JSON';

  const goRelative = (delta: number) => {
    if (!sessionId || filteredIndexes.length === 0) return;
    const pos = filteredIndexes.findIndex((row) => row.index === currentIndex);
    const base = pos >= 0 ? pos : 0;
    const nextPos = Math.min(Math.max(base + delta, 0), filteredIndexes.length - 1);
    void loadItem(sessionId, filteredIndexes[nextPos].index);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' || e.key === 'j') {
        e.preventDefault();
        goRelative(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'k') {
        e.preventDefault();
        goRelative(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, filteredIndexes, currentIndex]);

  const markReviewed = async () => {
    if (!sessionId || !itemPayload) return;
    setBusy(true);
    try {
      await bankReviewFlag(sessionId, currentIndex, true);
      setIndexItems((prev) => prev.map((it, i) => (
        i === currentIndex ? { ...it, reviewed: true } : it
      )));
      setItemPayload((prev) => prev ? {
        ...prev,
        meta: { ...prev.meta, reviewed: true },
      } : prev);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to flag item');
    } finally {
      setBusy(false);
    }
  };

  const deleteCurrentItem = async () => {
    if (!sessionId || !itemPayload) return;
    const itemId = String(itemPayload.meta.id || (itemPayload.exercise as Exercise).id || '');
    if (!window.confirm(
      `Delete ${itemId ? `question ${itemId}` : 'this question'} from the review session?\n\n`
      + `The source is not changed yet. Use ${persistActionLabel} to persist the deletion.`,
    )) return;

    setBusy(true);
    setError('');
    setAppendReport(null);
    try {
      const result = await bankReviewDeleteItem(sessionId, currentIndex);
      setEditedIndexes((prev) => {
        const next = new Set<number>();
        prev.forEach((index) => {
          if (index === result.deleted_index) return;
          next.add(index > result.deleted_index ? index - 1 : index);
        });
        return next;
      });
      await refreshSession(sessionId, result.next_index ?? 0);
      setSaveExamMessage(
        `Removed ${itemId ? `question ${itemId}` : 'the question'} from this review session. `
        + `Use ${persistActionLabel} to persist the deletion.`,
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete item');
    } finally {
      setBusy(false);
    }
  };

  const applyPayloadUpdate = (payload: BankReviewItemPayload) => {
    setItemPayload(payload);
    setEditDraft(draftFromExercise(payload.exercise as Record<string, unknown>));
    setIndexItems((prev) => prev.map((it, i) => (
      i === payload.index ? { ...payload.meta } : it
    )));
    setMarkResponse(null);
  };

  const saveEdits = async () => {
    if (!sessionId || !editDraft) return;
    setSavingEdit(true);
    setError('');
    setSaveExamMessage('');
    try {
      const stepsNormalized = editDraft.stepsText
        .split('\n')
        .map((s) => s.trimEnd())
        .filter((s) => s.length > 0);
      const qtype = (itemPayload?.exercise as Exercise | undefined)?.question_type;
      const isReasoning = qtype === 'reasoning';
      const isMultiPart = qtype === 'multi_part'
        || (editDraft.subParts.length > 0 && Array.isArray((itemPayload?.exercise as Exercise | undefined)?.sub_parts));

      const diagramTrim = editDraft.diagramDataText.trim();
      let diagram_data: Record<string, unknown> | undefined;
      let clear_diagram = false;
      if (!diagramTrim) {
        // Clear only if the original item had a diagram
        const hadDiagram = !!(itemPayload?.exercise as { diagram_data?: unknown } | undefined)?.diagram_data;
        if (hadDiagram) clear_diagram = true;
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(diagramTrim);
        } catch {
          throw new Error('diagram_data must be valid JSON (object).');
        }
        if (parsed === null) {
          clear_diagram = true;
        } else if (typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('diagram_data must be a JSON object, e.g. { "type": "number_line", ... }.');
        } else {
          diagram_data = parsed as Record<string, unknown>;
        }
      }

      const imageTrim = editDraft.imageText.trim();
      let image: string | undefined;
      let clear_image = false;
      if (!imageTrim) {
        const hadImage = Boolean(
          (itemPayload?.exercise as { image?: unknown } | undefined)?.image,
        );
        if (hadImage) clear_image = true;
      } else {
        image = imageTrim;
      }

      const body: {
        index: number;
        question: string;
        answer: string;
        steps: string[];
        status: 'active' | 'draft';
        difficulty?: string;
        rubric_key_points?: string[];
        sub_parts?: Array<{ label: string; question: string; answer: string; marks?: number | null }>;
        diagram_data?: Record<string, unknown>;
        clear_diagram?: boolean;
        image?: string;
        clear_image?: boolean;
        sample_reasoning?: string;
        clear_sample_reasoning?: boolean;
        diagram_description?: string;
        clear_diagram_description?: boolean;
      } = {
        index: currentIndex,
        question: editDraft.question,
        answer: editDraft.answer,
        steps: stepsNormalized,
        status: editDraft.status,
      };
      if (editDraft.difficulty) body.difficulty = editDraft.difficulty;
      // Only send rubric points for reasoning items (avoid wiping/creating rubric on other types).
      if (isReasoning) {
        body.rubric_key_points = editDraft.rubricPointsText
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
      if (isMultiPart || editDraft.subParts.length > 0) {
        body.sub_parts = editDraft.subParts
          .filter((p) => p.question.trim().length > 0)
          .map((p, i) => {
            const marksRaw = p.marks.trim();
            let marks: number | null = null;
            if (marksRaw !== '') {
              const n = Number(marksRaw);
              marks = Number.isFinite(n) ? n : 1;
            }
            return {
              label: p.label.trim() || nextPartLabel(i),
              question: p.question,
              answer: p.answer,
              marks,
            };
          });
      }
      if (clear_diagram) body.clear_diagram = true;
      if (diagram_data) body.diagram_data = diagram_data;
      if (clear_image) body.clear_image = true;
      if (image) body.image = image;

      // sample_reasoning: always send for reasoning items; also if draft has text or original had it
      const hadSample = Boolean(
        (itemPayload?.exercise as { sample_reasoning?: unknown } | undefined)?.sample_reasoning,
      );
      if (isReasoning || hadSample || editDraft.sampleReasoning.trim()) {
        if (!editDraft.sampleReasoning.trim()) {
          body.clear_sample_reasoning = true;
        } else {
          body.sample_reasoning = editDraft.sampleReasoning;
        }
      }

      // diagram_description
      const hadDesc = Boolean(
        (itemPayload?.exercise as { diagram_description?: unknown } | undefined)?.diagram_description,
      );
      if (hadDesc || editDraft.diagramDescription.trim()) {
        if (!editDraft.diagramDescription.trim()) {
          body.clear_diagram_description = true;
        } else {
          body.diagram_description = editDraft.diagramDescription;
        }
      }

      const payload = await bankReviewUpdateItem(sessionId, body);
      applyPayloadUpdate(payload);
      setEditedIndexes((prev) => {
        const next = new Set(prev);
        next.add(currentIndex);
        return next;
      });

      // Edits are deliberately session-only. Durable production replacement is a
      // separate, explicitly confirmed Save bank / Save exam action below.
      setSaveExamMessage(
        `Saved in session only. Use ${persistActionLabel}${isUploadedJsonSession ? ' or Append' : ' / Append'} to write the change outside this temporary session.`,
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save edits');
    } finally {
      setSavingEdit(false);
    }
  };

  const updateSubPart = (index: number, patch: Partial<SubPartDraft>) => {
    setEditDraft((d) => {
      if (!d) return d;
      const subParts = d.subParts.map((p, i) => (i === index ? { ...p, ...patch } : p));
      return { ...d, subParts };
    });
  };

  const addSubPart = () => {
    setEditDraft((d) => {
      if (!d) return d;
      const i = d.subParts.length;
      return {
        ...d,
        subParts: [
          ...d.subParts,
          { label: nextPartLabel(i), question: '', answer: '', marks: '1' },
        ],
      };
    });
  };

  const removeSubPart = (index: number) => {
    setEditDraft((d) => {
      if (!d) return d;
      return { ...d, subParts: d.subParts.filter((_, i) => i !== index) };
    });
  };

  const resetEdits = () => {
    if (!itemPayload) return;
    setEditDraft(draftFromExercise(itemPayload.exercise as Record<string, unknown>));
  };

  const exportSession = async (activate: boolean) => {
    if (!sessionId) return;
    setBusy(true);
    setError('');
    try {
      const data = await bankReviewExport(sessionId, activate);
      if (activate) {
        await refreshSession(sessionId, currentIndex);
      }
      const blob = new Blob([JSON.stringify(data.exercises, null, 2) + '\n'], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const base = (sourceName || 'session').replace(/\.json$/i, '');
      const filename = isUploadedJsonSession
        ? `${base}_edited${activate ? '_active' : ''}.json`
        : `${base}_export${activate ? '_active' : ''}.json`;
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setSaveExamMessage(`Downloaded ${data.total} items as ${filename}.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const activateAllDrafts = async () => {
    if (!sessionId) return;
    if (!window.confirm('Set status=active on all items in this session? (needed for practice to load them after Append)')) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await bankReviewBulkStatus(sessionId, 'active', 'all');
      await refreshSession(sessionId, currentIndex);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Bulk activate failed');
    } finally {
      setBusy(false);
    }
  };

  const buildSubmitAnswer = (ex: Exercise, answer: string): string => {
    if (ex.question_type !== 'multi_part' || !ex.sub_parts?.length) {
      return answer;
    }
    const normaliseLabel = (label: unknown) => String(label || '').toLowerCase().trim();
    let activePart = activeMultipartLabel
      ? ex.sub_parts.find((p) => normaliseLabel(p.label) === activeMultipartLabel)
      : null;
    if (!activePart) {
      activePart = ex.sub_parts.find((p) => {
        const r = multiPartResults.find((res) => normaliseLabel(res.label) === normaliseLabel(p.label));
        return !r || !r.student_answer;
      }) || ex.sub_parts[0];
    }
    const label = normaliseLabel(activePart?.label);
    return JSON.stringify({ [label]: answer.trim() });
  };

  const handleSubmitMark = async () => {
    if (!sessionId || !itemPayload?.exercise) return;
    const ex = itemPayload.exercise as Exercise;
    if (!previewAnswer.trim()) {
      setError('Enter an answer before submitting.');
      return;
    }
    setSubmitting(true);
    setError('');
    setMarkResponse(null);
    try {
      const submitAnswer = buildSubmitAnswer(ex, previewAnswer);
      const res = await bankReviewMark(sessionId, currentIndex, submitAnswer);
      setMarkResponse(res);
      if (res.part_results) {
        setMultiPartResults(res.part_results);
      }
      // Auto-flag as reviewed after a successful mark pipeline call
      await bankReviewFlag(sessionId, currentIndex, true);
      setIndexItems((prev) => prev.map((it, i) => (
        i === currentIndex ? { ...it, reviewed: true } : it
      )));
      setItemPayload((prev) => prev ? {
        ...prev,
        meta: { ...prev.meta, reviewed: true },
      } : prev);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Marking failed');
    } finally {
      setSubmitting(false);
    }
  };

  const partialSuccessLabel = useMemo(() => {
    if (!markResponse) return { label: '', tone: 'needs_work' };
    if (markResponse.error_type === 'parent_review_pending') {
      return { label: 'Awaiting review', tone: 'pending' };
    }
    if (markResponse.is_correct) {
      if (
        markResponse.question_type === 'reasoning'
        && typeof markResponse.score === 'number'
        && typeof markResponse.max_score === 'number'
        && markResponse.score < markResponse.max_score
      ) {
        return { label: 'Partially correct', tone: 'partial' };
      }
      return { label: 'Correct', tone: 'success' };
    }
    if (typeof markResponse.score === 'number' && markResponse.score > 0) {
      return { label: 'Partial credit', tone: 'partial' };
    }
    return { label: 'Needs work', tone: 'needs_work' };
  }, [markResponse]);

  const doAppend = async (mode: 'all_valid' | 'reviewed_only') => {
    if (!sessionId) return;
    if (!window.confirm(
      mode === 'all_valid'
        ? 'Append all valid items to production bank files on disk?'
        : 'Append only reviewed valid items to production bank files?',
    )) return;
    setBusy(true);
    setError('');
    try {
      const report = await bankReviewAppend(sessionId, mode);
      setAppendReport(report);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Append failed');
    } finally {
      setBusy(false);
    }
  };

  const exercise = itemPayload?.exercise;
  const meta = itemPayload?.meta;
  // Exercise API type omits subject; bank/exam payloads still carry it on the object.
  const exerciseSubject = (exercise as { subject?: string } | undefined)?.subject;
  const showLatexPreview = subjectWantsLatexPreview(meta?.subject ?? exerciseSubject);

  if (enabled === null) {
    return (
      <div style={{ padding: 40, color: 'var(--text-secondary)' }}>Checking bank review status…</div>
    );
  }

  if (!enabled) {
    return (
      <div style={{ padding: 8 }}>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, fontSize: 14 }}>
          Bank review needs Parent Dashboard access. Set server-side{' '}
          <code>PARENT_PASSWORD</code> and unlock the parent dashboard first.
        </p>
      </div>
    );
  }

  return (
    <div style={{ color: 'var(--text-primary)', boxSizing: 'border-box' }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: 12,
      }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Upload JSON → edit / delete → <strong>Download updated JSON</strong>. Open a production bank →{' '}
          <strong>Save bank</strong> (overwrite <code>data/exercise_*.json</code>); exams use{' '}
          <strong>Save exam</strong> (<code>data/exams/</code>). <strong>Append</strong> only adds new ids.
        </div>
      </header>

      {error && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 8,
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.35)',
          color: '#b91c1c',
          fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {importSummary && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid var(--border-color)',
          fontSize: 13,
          color: 'var(--text-secondary)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>
          Loaded <strong>{sourceName}</strong>
          {importSummary.detected_format ? ` (${importSummary.detected_format})` : ''}
          {isExamSession ? ' · exam QA mode' : ''}
          {isBankFileSession ? ' · production bank edit mode' : ''}:{' '}
          {importSummary.total} items · {importSummary.valid_for_append} schema-ok ·{' '}
          {importSummary.with_errors} with errors
          {examFilename ? ` · exam ${examFilename}` : ''}
          {bankFilename ? ` · bank ${bankFilename}` : ''}
          {typeof importSummary.draft_status_count === 'number' && importSummary.draft_status_count > 0
            ? ` · ${importSummary.draft_status_count} draft status`
            : ''}
          {!isExamSession && !isBankFileSession && (
            <>
              {' · targets: '}
              {Object.entries(importSummary.target_histogram).map(([k, v]) => `${k}(${v})`).join(', ') || '—'}
            </>
          )}
          </span>
          {sessionId && (
            <button
              onClick={async () => {
                if (!window.confirm('Close this review session? Unsaved changes will be lost.')) return;
                try {
                  await bankReviewCloseSession(sessionId);
                } catch { /* already gone */ }
                setSessionId(null);
                setImportSummary(null);
                setCurrentIndex(0);
              }}
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', cursor: 'pointer', color: 'var(--text-secondary)', whiteSpace: 'nowrap', marginLeft: 8 }}
            >
              Close Session
            </button>
          )}
        </div>
      )}

      {saveExamMessage && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 8,
          background: 'rgba(34,197,94,0.1)',
          border: '1px solid rgba(34,197,94,0.35)',
          color: 'var(--text-primary)',
          fontSize: 13,
        }}>
          {saveExamMessage}
        </div>
      )}

      {!sessionId && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          width: '100%',
          maxWidth: 'min(100%, 820px)',
          margin: '0 auto',
        }}>
          <div className="glass-panel" style={{ padding: 28, borderRadius: 14 }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 16,
              flexWrap: 'wrap',
              marginBottom: 12,
            }}>
              <div style={{ minWidth: 0, flex: '1 1 280px' }}>
                <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>
                  Upload exercise JSON
                </h3>
                <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Upload exercise / exam JSON, or open a production bank below. Supported shapes:
                </p>
              </div>
              <label style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--accent-color)',
                color: '#fff',
                padding: '10px 14px',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 13,
                cursor: busy ? 'wait' : 'pointer',
                flexShrink: 0,
              }}>
                {busy ? 'Working…' : 'Upload JSON'}
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  disabled={busy}
                  onChange={(e) => void handleUpload(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-secondary)', lineHeight: 1.55, fontSize: 14 }}>
              <li>Bank array: <code>[ {'{'}…{'}'}, … ]</code></li>
              <li>Wrapper: <code>{'{ "exercises": […] }'}</code></li>
              <li>Generation batch: <code>{'{ "candidates": […] }'}</code></li>
              <li><strong>Mock exam:</strong> <code>{'{ "title", "time_limit_minutes", "questions": […] }'}</code></li>
            </ul>
            <p style={{ margin: '10px 0 0', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
              Production banks: <strong>Open bank</strong> → edit → <strong>Save bank</strong> overwrites that
              <code> data/exercise_*.json</code> (with <code>.bak</code>). Exams use <strong>Save exam</strong>.
            </p>
          </div>

          <div className="glass-panel" style={{ padding: 20, borderRadius: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)' }}>
                Open production bank (data/exercise_*.json)
              </h3>
              <button type="button" onClick={() => void refreshBankList()} disabled={busy} style={navBtnStyle}>
                Refresh banks
              </button>
            </div>
            {bankTargets.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
                No <code>exercise_*.json</code> files found under <code>data/</code>.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                {bankTargets.map((t) => (
                  <li key={t.file} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border-color)',
                    background: 'rgba(255,255,255,0.02)',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>
                        {t.file}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {t.count >= 0 ? `${t.count} items` : 'unreadable'}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy || t.count < 0}
                      onClick={() => void handleOpenBank(t.file)}
                      style={{
                        ...navBtnStyle,
                        background: 'var(--accent-color)',
                        color: '#fff',
                        borderColor: 'var(--accent-color)',
                      }}
                    >
                      Open & edit
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="glass-panel" style={{ padding: 20, borderRadius: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)' }}>
                Open from data/exams/
              </h3>
              <button type="button" onClick={() => void refreshExamList()} disabled={busy} style={navBtnStyle}>
                Refresh list
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Default subject{' '}
                <select
                  value={examDefaultSubject}
                  onChange={(e) => setExamDefaultSubject(e.target.value)}
                  style={{ ...fieldStyle, width: 'auto', padding: '6px 8px' }}
                >
                  {['math', 'english', 'science', 'methods', 'specialist'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Default year{' '}
                <input
                  value={examDefaultYear}
                  onChange={(e) => setExamDefaultYear(e.target.value)}
                  style={{ ...fieldStyle, width: 64, padding: '6px 8px' }}
                />
              </label>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                (fills missing fields for preview/mark only)
              </span>
            </div>
            {examPapers.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
                No <code>*.json</code> papers found under <code>data/exams/</code>.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {examPapers.map((p) => (
                  <li key={p.filename} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border-color)',
                    background: 'rgba(255,255,255,0.02)',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>
                        {p.title}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {p.filename}
                        {p.num_questions >= 0 ? ` · ${p.num_questions} Q` : ''}
                        {p.time_limit_minutes != null ? ` · ${p.time_limit_minutes} min` : ''}
                        {p.error ? ` · ${p.error}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy || p.num_questions < 0}
                      onClick={() => void handleOpenExamPaper(p.filename)}
                      style={{
                        ...navBtnStyle,
                        background: 'var(--accent-color)',
                        color: '#fff',
                        borderColor: 'var(--accent-color)',
                      }}
                    >
                      Open & review
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {sessionId && (
        <div
          className={styles.reviewGrid}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(200px, min(28vw, 320px)) minmax(0, 1fr)',
            gap: 'clamp(10px, 1.5vw, 16px)',
            alignItems: 'start',
            width: '100%',
            maxHeight: 'calc(100vh - 140px)',
          }}
        >
          {/* Sidebar list */}
          <aside className="glass-panel" style={{
            borderRadius: 12,
            padding: 12,
            maxHeight: 'calc(100vh - 140px)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            minWidth: 0,
            width: '100%',
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {([
                ['all', 'All'],
                ['diagrams', 'Diagrams'],
                ['errors', 'Errors'],
                ['unreviewed', 'Unreviewed'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '4px 8px',
                    borderRadius: 999,
                    border: filter === key ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
                    background: filter === key ? 'rgba(99,102,241,0.12)' : 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    boxShadow: 'none',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              {filteredIndexes.length} shown · {indexItems.filter((i) => i.reviewed).length} reviewed
              {editedIndexes.size > 0 ? ` · ${editedIndexes.size} edited` : ''}
            </div>
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filteredIndexes.map(({ item, index }) => {
                const wasEdited = editedIndexes.has(index);
                return (
                <button
                  key={`${item.id}-${index}`}
                  type="button"
                  onClick={() => sessionId && void loadItem(sessionId, index)}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: index === currentIndex
                      ? '1px solid var(--accent-color)'
                      : wasEdited
                        ? '1px solid rgba(34,197,94,0.45)'
                        : '1px solid var(--border-color)',
                    background: index === currentIndex
                      ? 'rgba(99,102,241,0.1)'
                      : wasEdited
                        ? 'rgba(34,197,94,0.08)'
                        : 'rgba(255,255,255,0.02)',
                    cursor: 'pointer',
                    boxShadow: 'none',
                    color: 'var(--text-primary)',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 6,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 700, wordBreak: 'break-all', minWidth: 0 }}>
                      {index + 1}. {item.id || '(no id)'}
                    </div>
                    {wasEdited && (
                      <span
                        title="Edited this session (Save edits)"
                        aria-label="Edited"
                        style={{
                          flexShrink: 0,
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: 'rgba(34,197,94,0.2)',
                          border: '1px solid rgba(34,197,94,0.65)',
                          color: '#16a34a',
                          fontSize: 12,
                          fontWeight: 800,
                          lineHeight: '16px',
                          textAlign: 'center',
                        }}
                      >
                        ✓
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {item.question_type}
                    {item.diagram_type ? ` · ${item.diagram_type}` : ''}
                    {item.has_errors ? ' · ⚠' : ''}
                    {item.reviewed ? ' · reviewed' : ''}
                    {wasEdited ? ' · edited' : ''}
                  </div>
                </button>
                );
              })}
            </div>
          </aside>

          {/* Main: bank-review chrome + guided-practice question card */}
          <main style={{
            minHeight: 0,
            maxHeight: 'calc(100vh - 140px)',
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minWidth: 0,
            width: '100%',
          }}>
            {loadingItem && (
              <div className="glass-panel" style={{ padding: 16, borderRadius: 12, color: 'var(--text-secondary)' }}>
                Loading item…
              </div>
            )}
            {!loadingItem && exercise && meta && (
              <>
                {/* Bank-review metadata (kept above the practice-style card) */}
                <div className="glass-panel" style={{ borderRadius: 12, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Bank review metadata
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {[
                      meta.id,
                      meta.question_type,
                      meta.subject,
                      meta.year_level != null ? `Y${meta.year_level}` : null,
                      meta.unit != null ? `U${meta.unit}` : null,
                      meta.difficulty,
                      meta.diagram_type,
                      meta.target_file,
                      meta.valid_for_append ? 'append-ok' : 'blocked',
                      meta.reviewed ? 'reviewed' : 'unreviewed',
                    ].filter(Boolean).map((chip) => (
                      <span key={String(chip)} style={{
                        fontSize: 12,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 999,
                        background: String(chip) === 'blocked'
                          ? 'rgba(239,68,68,0.12)'
                          : String(chip) === 'append-ok'
                            ? 'rgba(34,197,94,0.12)'
                            : 'rgba(255,255,255,0.04)',
                        border: '1px solid var(--border-color)',
                      }}>
                        {String(chip)}
                      </span>
                    ))}
                  </div>
                  {(meta.topic_ids?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                      Topics: {(meta.topic_ids || []).join(', ')}
                    </div>
                  )}
                  {(itemPayload.issues?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: '#b91c1c' }}>
                        Validation issues
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                        {itemPayload.issues.map((iss, i) => (
                          <li key={i} style={{ color: iss.severity === 'error' ? '#b91c1c' : '#b45309', marginBottom: 2 }}>
                            [{iss.severity}] {iss.code}: {iss.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {meta.target_error && (
                    <div style={{ marginTop: 8, fontSize: 13, color: '#b91c1c' }}>
                      Target mapping: {meta.target_error}
                    </div>
                  )}
                </div>

                {/* Same question UI as Guided Practice */}
                {!markResponse && (
                  <GuidedQuestionCard
                    exercise={exercise as Exercise}
                    answer={previewAnswer}
                    onSetAnswer={setPreviewAnswer}
                    onSubmit={() => { void handleSubmitMark(); }}
                    submitting={submitting}
                    multiPartResults={multiPartResults}
                    activeMultipartLabel={activeMultipartLabel}
                    onSetActivePart={setActiveMultipartLabel}
                    subjectColor="var(--accent-color)"
                  />
                )}
                {markResponse && (
                  <GuidedFeedbackCard
                    markResponse={markResponse}
                    exercise={exercise as Exercise}
                    studentAnswer={previewAnswer}
                    onNext={() => goRelative(1)}
                    onExplainMyAnswer={() => {
                      setError('Explain-my-answer dialogue is not wired in bank review; use Inspector for authoring answers.');
                    }}
                    onTryAgain={() => {
                      setMarkResponse(null);
                      setPreviewAnswer('');
                    }}
                    isLastQuestion={currentIndex >= indexItems.length - 1}
                    subjectColor="var(--accent-color)"
                    partialSuccessLabel={partialSuccessLabel}
                    isMultiPart={(exercise as Exercise).question_type === 'multi_part'}
                    multiPartHasRemaining={
                      (exercise as Exercise).question_type === 'multi_part'
                      && !!(exercise as Exercise).sub_parts?.some((p) => {
                        const label = String(p.label || '').toLowerCase().trim();
                        const r = multiPartResults.find((pr) => String(pr.label || '').toLowerCase().trim() === label);
                        return r?.is_correct !== true;
                      })
                    }
                    onContinuePart={() => {
                      setMarkResponse(null);
                      setPreviewAnswer('');
                    }}
                  />
                )}
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4 }}>
                  Submit runs the live marking pipeline (MCQ / short answer / reasoning / multi-part).
                  Results are <strong>not</strong> written to student logs. Newly imported items work without append first.
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" onClick={() => goRelative(-1)} disabled={busy} style={navBtnStyle}>← Prev</button>
                  <button type="button" onClick={() => goRelative(1)} disabled={busy} style={navBtnStyle}>Next →</button>
                  <button type="button" onClick={() => void markReviewed()} disabled={busy} style={navBtnStyle}>
                    Mark reviewed
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteCurrentItem()}
                    disabled={busy}
                    style={{
                      ...navBtnStyle,
                      color: '#b91c1c',
                      borderColor: 'rgba(185,28,28,0.45)',
                    }}
                  >
                    Delete question
                  </button>
                  <button type="button" onClick={() => setShowInspector((v) => !v)} style={navBtnStyle}>
                    {showInspector ? 'Hide inspector' : 'Show inspector'}
                  </button>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)', alignSelf: 'center' }}>
                    {currentIndex + 1} / {indexItems.length} · j/k or arrows
                  </span>
                </div>

                {showInspector && editDraft && (
                  <section className="glass-panel" style={{
                    borderRadius: 12,
                    padding: 14,
                    fontSize: 14,
                    color: 'var(--text-secondary)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      <h3 style={{ fontSize: 14, color: 'var(--text-primary)', margin: 0 }}>
                        Edit question / answer — Save updates this review session; use the explicit durable action below to write disk
                      </h3>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" onClick={resetEdits} disabled={savingEdit} style={navBtnStyle}>
                          Reset
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveEdits()}
                          disabled={savingEdit || busy}
                          style={{
                            ...navBtnStyle,
                            background: 'var(--accent-color)',
                            color: '#fff',
                            borderColor: 'var(--accent-color)',
                          }}
                        >
                          {savingEdit ? 'Saving…' : 'Save edits'}
                        </button>
                      </div>
                    </div>
                    {isBankFileSession && (
                      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                        <strong>Save edits</strong> changes this temporary review session only. Use the explicit
                        <strong> Save bank</strong> action below to overwrite <code>data/{bankFilename || sourceName || 'exercise_*.json'}</code>
                        {' '}(after strict validation and a verified backup).
                      </p>
                    )}

                    <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                      <label style={{ flex: '1 1 200px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Status</div>
                        <select
                          value={editDraft.status}
                          onChange={(e) => setEditDraft((d) => (d ? {
                            ...d,
                            status: e.target.value === 'draft' ? 'draft' : 'active',
                          } : d))}
                          style={{ ...fieldStyle, maxWidth: 220 }}
                        >
                          <option value="draft">draft (not loaded by practice)</option>
                          <option value="active">active (practice / adaptive)</option>
                        </select>
                      </label>
                      <label style={{ flex: '1 1 200px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Difficulty</div>
                        <select
                          value={editDraft.difficulty}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, difficulty: e.target.value } : d))}
                          style={{ ...fieldStyle, maxWidth: 220 }}
                        >
                          <option value="">—</option>
                          <option value="foundational">foundational</option>
                          <option value="developing">developing</option>
                          <option value="extending">extending</option>
                        </select>
                      </label>
                    </div>

                    <LatexEditField
                      label="Question"
                      hint="use $...$ for math"
                      value={editDraft.question}
                      onChange={(v) => setEditDraft((d) => (d ? { ...d, question: v } : d))}
                      rows={5}
                      minHeight={110}
                      showLatexPreview={showLatexPreview}
                    />

                    {/* Stem-level answer: hide for multi_part (answers live on sub_parts) */}
                    {(exercise as Exercise).question_type !== 'multi_part' && (
                      <LatexEditField
                        label="Answer"
                        hint="use $...$ for math"
                        value={editDraft.answer}
                        onChange={(v) => setEditDraft((d) => (d ? { ...d, answer: v } : d))}
                        rows={3}
                        minHeight={80}
                        showLatexPreview={showLatexPreview}
                      />
                    )}

                    {/* Multi-part sub-questions */}
                    {((exercise as Exercise).question_type === 'multi_part' || editDraft.subParts.length > 0) && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                          marginBottom: 8,
                        }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                            Sub-parts
                            <span style={{ fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>
                              (label · question · answer · marks)
                            </span>
                          </div>
                          <button type="button" onClick={addSubPart} disabled={savingEdit} style={navBtnStyle}>
                            + Add part
                          </button>
                        </div>
                        {editDraft.subParts.length === 0 && (
                          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-muted)' }}>
                            No sub-parts yet. Add at least one part for multi_part marking.
                          </p>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {editDraft.subParts.map((part, pi) => (
                            <div
                              key={`part-${pi}`}
                              style={{
                                border: '1px solid var(--border-color)',
                                borderRadius: 10,
                                padding: 12,
                                background: 'rgba(255,255,255,0.02)',
                              }}
                            >
                              <div style={{
                                display: 'flex',
                                gap: 8,
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                marginBottom: 8,
                              }}>
                                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  Label{' '}
                                  <input
                                    value={part.label}
                                    onChange={(e) => updateSubPart(pi, { label: e.target.value })}
                                    style={{ ...fieldStyle, width: 64, padding: '6px 8px' }}
                                  />
                                </label>
                                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  Marks{' '}
                                  <input
                                    value={part.marks}
                                    onChange={(e) => updateSubPart(pi, { marks: e.target.value })}
                                    style={{ ...fieldStyle, width: 64, padding: '6px 8px' }}
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => removeSubPart(pi)}
                                  disabled={savingEdit}
                                  style={{ ...navBtnStyle, marginLeft: 'auto' }}
                                >
                                  Remove
                                </button>
                              </div>
                              <LatexEditField
                                label={`Part ${part.label || nextPartLabel(pi)} — question`}
                                hint="use $...$ for math"
                                value={part.question}
                                onChange={(v) => updateSubPart(pi, { question: v })}
                                rows={3}
                                minHeight={72}
                                showLatexPreview={showLatexPreview}
                              />
                              <LatexEditField
                                label={`Part ${part.label || nextPartLabel(pi)} — answer`}
                                hint="use $...$ for math"
                                value={part.answer}
                                onChange={(v) => updateSubPart(pi, { answer: v })}
                                rows={2}
                                minHeight={56}
                                showLatexPreview={showLatexPreview}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <LatexEditField
                      label="Steps"
                      hint="(one step per line)"
                      value={editDraft.stepsText}
                      onChange={(v) => setEditDraft((d) => (d ? { ...d, stepsText: v } : d))}
                      rows={5}
                      minHeight={110}
                      placeholder={"Step 1 text\nStep 2 text"}
                      previewMode="lines"
                      showLatexPreview={showLatexPreview}
                    />

                    {/* Rubric scoring points only apply to reasoning items */}
                    {(exercise as Exercise).question_type === 'reasoning' && (
                      <LatexEditField
                        label="Rubric key points"
                        hint="(one point per line · reasoning scoring only)"
                        value={editDraft.rubricPointsText}
                        onChange={(v) => setEditDraft((d) => (d ? { ...d, rubricPointsText: v } : d))}
                        rows={4}
                        minHeight={96}
                        placeholder={"Criterion 1\nCriterion 2"}
                        previewMode="lines"
                        showLatexPreview={showLatexPreview}
                      />
                    )}

                    {((exercise as Exercise).question_type === 'reasoning'
                      || Boolean(editDraft.sampleReasoning)
                      || Boolean(exercise.sample_reasoning)) && (
                      <LatexEditField
                        label="Sample reasoning"
                        hint="model answer / worked narrative · use $...$ for math"
                        value={editDraft.sampleReasoning}
                        onChange={(v) => setEditDraft((d) => (d ? { ...d, sampleReasoning: v } : d))}
                        rows={6}
                        minHeight={120}
                        placeholder="Explain the reasoning a strong student would give…"
                        showLatexPreview={showLatexPreview}
                      />
                    )}

                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                        diagram_data
                        <span style={{ fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>
                          (JSON object · leave empty to remove · must include &quot;type&quot; for renderers)
                        </span>
                      </div>
                      <textarea
                        value={editDraft.diagramDataText}
                        onChange={(e) => setEditDraft((d) => (d ? {
                          ...d,
                          diagramDataText: e.target.value,
                        } : d))}
                        rows={10}
                        spellCheck={false}
                        placeholder={'{\n  "type": "number_line",\n  "min": 0,\n  "max": 10\n}'}
                        style={{
                          ...fieldStyle,
                          resize: 'vertical',
                          minHeight: 160,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          fontSize: 12,
                          lineHeight: 1.4,
                        }}
                      />
                      {(() => {
                        const t = editDraft.diagramDataText.trim();
                        if (!t) {
                          return (
                            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                              No diagram (empty). Save edits to clear an existing diagram.
                            </div>
                          );
                        }
                        try {
                          const parsed = JSON.parse(t);
                          if (parsed === null) {
                            return (
                              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                                null → will clear diagram on save.
                              </div>
                            );
                          }
                          if (typeof parsed !== 'object' || Array.isArray(parsed)) {
                            return (
                              <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}>
                                Must be a JSON object, not array/primitive.
                              </div>
                            );
                          }
                          const dtype = (parsed as { type?: unknown }).type;
                          return (
                            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                              JSON OK
                              {dtype != null ? ` · type: ${String(dtype)}` : ' · warning: missing type'}
                              {' · preview updates after Save edits'}
                            </div>
                          );
                        } catch {
                          return (
                            <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}>
                              Invalid JSON — fix before Save edits.
                            </div>
                          );
                        }
                      })()}
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                        diagram_description
                        <span style={{ fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>
                          (accessibility alt-text describing the visual)
                        </span>
                      </div>
                      <textarea
                        value={editDraft.diagramDescription}
                        onChange={(e) => setEditDraft((d) => (d ? {
                          ...d,
                          diagramDescription: e.target.value,
                        } : d))}
                        rows={3}
                        placeholder="Describe what the diagram shows for screen readers and fallback display…"
                        style={{
                          ...fieldStyle,
                          resize: 'vertical',
                          minHeight: 60,
                          fontSize: 13,
                          lineHeight: 1.4,
                        }}
                      />
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <label
                        htmlFor="bank-review-image-input"
                        style={{
                          display: 'block',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                          marginBottom: 4,
                        }}
                      >
                        image
                        <span style={{ fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>
                          (path / URL / data URI · leave empty to remove)
                        </span>
                      </label>
                      <textarea
                        id="bank-review-image-input"
                        value={editDraft.imageText}
                        onChange={(e) => setEditDraft((d) => (d ? {
                          ...d,
                          imageText: e.target.value,
                        } : d))}
                        rows={3}
                        spellCheck={false}
                        placeholder="/images/example.svg"
                        style={{
                          ...fieldStyle,
                          resize: 'vertical',
                          minHeight: 72,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          fontSize: 12,
                          lineHeight: 1.4,
                        }}
                      />
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                        marginTop: 6,
                      }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          Preview updates after Save edits.
                        </span>
                        {editDraft.imageText.trim() && (
                          <button
                            type="button"
                            onClick={() => setEditDraft((d) => (d ? { ...d, imageText: '' } : d))}
                            disabled={savingEdit}
                            style={navBtnStyle}
                          >
                            Clear image
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                )}
              </>
            )}
          </main>
        </div>
      )}

      {sessionId && (
        <footer style={{
          marginTop: 14,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
        }}>
          {isBankFileSession && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSaveBank()}
              style={{
                background: 'var(--accent-color)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 14px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Save bank → data/exercise_*.json
            </button>
          )}
          {isExamSession && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSaveExam()}
              style={{
                background: isBankFileSession ? undefined : 'var(--accent-color)',
                color: isBankFileSession ? undefined : '#fff',
                border: isBankFileSession ? '1px solid var(--border-color)' : 'none',
                borderRadius: 8,
                padding: '10px 14px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Save exam → data/exams/
            </button>
          )}
          {isUploadedJsonSession && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void exportSession(false)}
              style={{
                background: 'var(--accent-color)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 14px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Download updated JSON
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void doAppend('all_valid')}
            style={navBtnStyle}
            title={
              isBankFileSession
                ? 'Append only adds new ids; prefer Save bank to update existing items in place'
                : isExamSession
                  ? 'Optional: push items into production exercise banks (needs full bank schema)'
                  : undefined
            }
          >
            Append all valid
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void doAppend('reviewed_only')}
            style={navBtnStyle}
          >
            Append reviewed only
          </button>
          {!isExamSession && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void activateAllDrafts()}
              style={navBtnStyle}
            >
              Set all → active
            </button>
          )}
          {!isUploadedJsonSession && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void exportSession(false)}
              style={navBtnStyle}
            >
              Export JSON
            </button>
          )}
          {!isExamSession && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void exportSession(true)}
              style={navBtnStyle}
            >
              Export as active JSON
            </button>
          )}
        </footer>
      )}

      {appendReport && (
        <div className="glass-panel" style={{ marginTop: 14, padding: 14, borderRadius: 12, fontSize: 13 }}>
          <strong>Append report</strong>
          <div style={{ marginTop: 6 }}>
            Added {appendReport.added_total} · selected {appendReport.selected_count} ·
            duplicates skipped {appendReport.skipped_duplicate.length} ·
            blocked invalid {appendReport.blocked_invalid.length} ·
            blocked unmapped {appendReport.blocked_unmapped.length}
          </div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {appendReport.files.map((f) => (
              <li key={f.file}>{f.file}: +{f.added}</li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  padding: '8px 12px',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  boxShadow: 'none',
};
