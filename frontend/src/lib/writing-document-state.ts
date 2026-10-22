import type { WritingTopic } from './writing-topics';
import type { WritingTimeMode } from './writing_timer';

export const WRITING_DOCUMENT_KEY = 'qld_tutor_writing_document_v1';
export const WRITING_DOCUMENT_VERSION = 1 as const;

export const LEGACY_WRITING_STATE_KEYS = [
  'qld_tutor_writing_phase',
  'qld_tutor_writing_prompt_type',
  'qld_tutor_writing_year_level',
  'qld_tutor_writing_draft_text',
  'qld_tutor_writing_custom_topic_prompt',
  'qld_tutor_writing_source_text',
  'qld_tutor_writing_writer_statement',
  'qld_tutor_writing_task_sheet_text',
  'qld_tutor_writing_school_ismg_text',
  'qld_tutor_writing_selected_topic',
  'qld_tutor_writing_pending_assessment',
  'qld_tutor_writing_timer_ends_at',
  'qld_tutor_writing_timer_paused_remaining',
] as const;

export type WritingDocumentPhase = 'select' | 'topic_select' | 'edit' | 'results' | 'portfolio';
export type WritingDocumentPromptType = 'persuasive' | 'narrative' | 'analytical' | 'expository';

export type PendingWritingAssessment = {
  requestId: string;
  submissionSignature: string;
};

export type WritingDocument = {
  version: typeof WRITING_DOCUMENT_VERSION;
  phase: WritingDocumentPhase;
  promptType: WritingDocumentPromptType | null;
  selectedTopic: WritingTopic | null;
  yearLevel: number;
  draftText: string;
  customTopicPrompt: string;
  sourceText: string;
  writerStatement: string;
  taskSheetText: string;
  schoolIsmgText: string;
  timeMode: WritingTimeMode;
  customMinutes: number;
  timerEndsAt: number | null;
  timerPausedRemaining: number | null;
  pendingAssessment: PendingWritingAssessment | null;
  revisionAnchorTimestamp: string | null;
};

type WritingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PHASES = new Set<WritingDocumentPhase>(['select', 'topic_select', 'edit', 'results', 'portfolio']);
const PROMPT_TYPES = new Set<WritingDocumentPromptType>(['persuasive', 'narrative', 'analytical', 'expository']);
const TIME_MODES = new Set<WritingTimeMode>(['unlimited', 'naplan', 'qcaa', 'custom']);

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function pendingAssessmentValue(value: unknown): PendingWritingAssessment | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PendingWritingAssessment>;
  if (typeof candidate.requestId !== 'string' || typeof candidate.submissionSignature !== 'string') {
    return null;
  }
  return {
    requestId: candidate.requestId,
    submissionSignature: candidate.submissionSignature,
  };
}

export function createWritingDocument(overrides: Partial<WritingDocument> = {}): WritingDocument {
  return {
    phase: 'select',
    promptType: null,
    selectedTopic: null,
    yearLevel: 7,
    draftText: '',
    customTopicPrompt: '',
    sourceText: '',
    writerStatement: '',
    taskSheetText: '',
    schoolIsmgText: '',
    timeMode: 'unlimited',
    customMinutes: 60,
    timerEndsAt: null,
    timerPausedRemaining: null,
    pendingAssessment: null,
    revisionAnchorTimestamp: null,
    ...overrides,
    version: WRITING_DOCUMENT_VERSION,
  };
}

export function readWritingDocument(storage: WritingStorage): WritingDocument | null {
  const raw = storage.getItem(WRITING_DOCUMENT_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== WRITING_DOCUMENT_VERSION) {
      return null;
    }

    const yearLevel = typeof parsed.yearLevel === 'number'
      && Number.isInteger(parsed.yearLevel)
      && parsed.yearLevel >= 7
      && parsed.yearLevel <= 12
      ? parsed.yearLevel
      : 7;
    const customMinutes = typeof parsed.customMinutes === 'number'
      && Number.isFinite(parsed.customMinutes)
      && parsed.customMinutes > 0
      ? parsed.customMinutes
      : 60;

    return createWritingDocument({
      phase: typeof parsed.phase === 'string' && PHASES.has(parsed.phase as WritingDocumentPhase)
        ? parsed.phase as WritingDocumentPhase
        : 'select',
      promptType: typeof parsed.promptType === 'string' && PROMPT_TYPES.has(parsed.promptType as WritingDocumentPromptType)
        ? parsed.promptType as WritingDocumentPromptType
        : null,
      selectedTopic: parsed.selectedTopic && typeof parsed.selectedTopic === 'object'
        ? parsed.selectedTopic as WritingTopic
        : null,
      yearLevel,
      draftText: stringValue(parsed.draftText),
      customTopicPrompt: stringValue(parsed.customTopicPrompt),
      sourceText: stringValue(parsed.sourceText),
      writerStatement: stringValue(parsed.writerStatement),
      taskSheetText: stringValue(parsed.taskSheetText),
      schoolIsmgText: stringValue(parsed.schoolIsmgText),
      timeMode: typeof parsed.timeMode === 'string' && TIME_MODES.has(parsed.timeMode as WritingTimeMode)
        ? parsed.timeMode as WritingTimeMode
        : 'unlimited',
      customMinutes,
      timerEndsAt: finitePositiveNumber(parsed.timerEndsAt),
      timerPausedRemaining: finitePositiveNumber(parsed.timerPausedRemaining),
      pendingAssessment: pendingAssessmentValue(parsed.pendingAssessment),
      revisionAnchorTimestamp: typeof parsed.revisionAnchorTimestamp === 'string'
        ? parsed.revisionAnchorTimestamp
        : null,
    });
  } catch {
    return null;
  }
}

export function writeWritingDocument(storage: WritingStorage, document: WritingDocument): void {
  const serialised = JSON.stringify({ ...document, version: WRITING_DOCUMENT_VERSION });
  storage.setItem(WRITING_DOCUMENT_KEY, serialised);
}

export function updateWritingDocument(
  storage: WritingStorage,
  patch: Partial<WritingDocument>,
): WritingDocument {
  const next = createWritingDocument({
    ...(readWritingDocument(storage) ?? {}),
    ...patch,
  });
  writeWritingDocument(storage, next);
  return next;
}

export function clearWritingDocument(storage: WritingStorage): void {
  storage.removeItem(WRITING_DOCUMENT_KEY);
}

export function clearLegacyWritingState(storage: Pick<Storage, 'removeItem'>): void {
  for (const key of LEGACY_WRITING_STATE_KEYS) {
    storage.removeItem(key);
  }
}
