import { getStudentId } from '../student_id';
import type {
  ObservationDefinition,
  ObservationField,
  ObservationReadoutValue,
  ObservationReadouts,
} from './activity-types';

const INQUIRY_NOTEBOOK_VERSION = 1 as const;
const INQUIRY_NOTEBOOK_STORAGE_PREFIX = 'qld-science-lab-inquiry-notebook-v1:';
const MAX_ACTIVITY_ID_LENGTH = 128;
const MAX_STORED_OBSERVATIONS = 100;
const NUMERIC_READOUT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export interface InquiryVariables {
  independent: string;
  dependent: string;
  controlled: string;
}

export interface InquiryCer {
  claim: string;
  evidence: string;
  reasoning: string;
}

export interface InquiryObservationMeasurement {
  fieldId: string;
  label: string;
  value: string;
}

export interface InquiryObservationSnapshot {
  id: string;
  capturedAt: string;
  measurements: InquiryObservationMeasurement[];
}

export interface InquiryNotebookDraft {
  version: typeof INQUIRY_NOTEBOOK_VERSION;
  activityId: string;
  updatedAt: string | null;
  predictionIndex: number | null;
  predictionReasoning: string;
  variables: InquiryVariables;
  observations: InquiryObservationSnapshot[];
  cer: InquiryCer;
  modelLimitation: string;
  visitedStepIds: string[];
}

export interface InquiryNotebookCompletion {
  predictionReasoning: boolean;
  variables: boolean;
  observationCount: boolean;
  distinctObservations: boolean;
  cer: boolean;
  modelLimitation: boolean;
}

function isSafeActivityId(activityId: string): boolean {
  return (
    activityId.length > 0 &&
    activityId.length <= MAX_ACTIVITY_ID_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(activityId)
  );
}

function legacyStorageKey(activityId: string): string | null {
  return isSafeActivityId(activityId)
    ? `${INQUIRY_NOTEBOOK_STORAGE_PREFIX}${encodeURIComponent(activityId)}`
    : null;
}

function studentStorageKey(activityId: string): string | null {
  if (!isSafeActivityId(activityId) || typeof window === 'undefined') return null;
  const studentId = getStudentId();
  return studentId === 'ssr-placeholder'
    ? null
    : `${INQUIRY_NOTEBOOK_STORAGE_PREFIX}${encodeURIComponent(studentId)}:${encodeURIComponent(activityId)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sanitiseMeasurements(value: unknown): InquiryObservationMeasurement[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    const measurement = asRecord(candidate);
    if (!measurement) return [];

    const fieldId = asString(measurement.fieldId).trim();
    const label = asString(measurement.label).trim();
    const formattedValue = asString(measurement.value).trim();
    if (!fieldId || !label || !formattedValue || formattedValue === '—') return [];

    return [{ fieldId, label, value: formattedValue }];
  });
}

function sanitiseObservations(value: unknown): InquiryObservationSnapshot[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_STORED_OBSERVATIONS).flatMap((candidate) => {
    const snapshot = asRecord(candidate);
    if (!snapshot) return [];

    const id = asString(snapshot.id).trim();
    const capturedAt = asString(snapshot.capturedAt).trim();
    const measurements = sanitiseMeasurements(snapshot.measurements);
    if (!id || !capturedAt || measurements.length === 0) return [];

    return [{ id, capturedAt, measurements }];
  });
}

function sanitiseNotebook(value: unknown, activityId: string): InquiryNotebookDraft | null {
  const candidate = asRecord(value);
  if (
    !candidate ||
    candidate.version !== INQUIRY_NOTEBOOK_VERSION ||
    candidate.activityId !== activityId
  ) {
    return null;
  }

  const variables = asRecord(candidate.variables);
  const cer = asRecord(candidate.cer);
  const predictionIndex = candidate.predictionIndex;
  const visitedStepIds = Array.isArray(candidate.visitedStepIds)
    ? [...new Set(candidate.visitedStepIds.filter((item): item is string => typeof item === 'string'))]
    : [];

  return {
    version: INQUIRY_NOTEBOOK_VERSION,
    activityId,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : null,
    predictionIndex:
      typeof predictionIndex === 'number' &&
      Number.isInteger(predictionIndex) &&
      predictionIndex >= 0
        ? predictionIndex
        : null,
    predictionReasoning: asString(candidate.predictionReasoning),
    variables: {
      independent: asString(variables?.independent),
      dependent: asString(variables?.dependent),
      controlled: asString(variables?.controlled),
    },
    observations: sanitiseObservations(candidate.observations),
    cer: {
      claim: asString(cer?.claim),
      evidence: asString(cer?.evidence),
      reasoning: asString(cer?.reasoning),
    },
    modelLimitation: asString(candidate.modelLimitation),
    visitedStepIds,
  };
}

export function createEmptyInquiryNotebook(activityId: string): InquiryNotebookDraft {
  return {
    version: INQUIRY_NOTEBOOK_VERSION,
    activityId,
    updatedAt: null,
    predictionIndex: null,
    predictionReasoning: '',
    variables: {
      independent: '',
      dependent: '',
      controlled: '',
    },
    observations: [],
    cer: {
      claim: '',
      evidence: '',
      reasoning: '',
    },
    modelLimitation: '',
    visitedStepIds: [],
  };
}

export interface InquiryNotebookLoadResult {
  notebook: InquiryNotebookDraft;
  persisted: boolean;
  storageAvailable: boolean;
}

function emptyLoadResult(
  activityId: string,
  storageAvailable: boolean,
): InquiryNotebookLoadResult {
  return {
    notebook: createEmptyInquiryNotebook(activityId),
    persisted: false,
    storageAvailable,
  };
}

function parseStoredNotebook(raw: string, activityId: string): InquiryNotebookDraft | null {
  try {
    return sanitiseNotebook(JSON.parse(raw), activityId);
  } catch {
    return null;
  }
}

/**
 * Load one activity draft for the active student. A legacy activity-only draft
 * is claimed once and deleted only after the profile-scoped write succeeds.
 */
export function loadInquiryNotebookWithStatus(activityId: string): InquiryNotebookLoadResult {
  if (!isSafeActivityId(activityId) || typeof window === 'undefined') {
    return emptyLoadResult(activityId, false);
  }

  try {
    const scopedKey = studentStorageKey(activityId);
    const legacyKey = legacyStorageKey(activityId);
    if (!scopedKey || !legacyKey) return emptyLoadResult(activityId, false);

    const scopedRaw = window.localStorage.getItem(scopedKey);
    const scopedNotebook = scopedRaw === null
      ? null
      : parseStoredNotebook(scopedRaw, activityId);
    const legacyRaw = window.localStorage.getItem(legacyKey);

    if (legacyRaw === null) {
      return scopedNotebook
        ? { notebook: scopedNotebook, persisted: true, storageAvailable: true }
        : emptyLoadResult(activityId, true);
    }

    const legacyNotebook = parseStoredNotebook(legacyRaw, activityId);
    if (!legacyNotebook) {
      return scopedNotebook
        ? { notebook: scopedNotebook, persisted: true, storageAvailable: true }
        : emptyLoadResult(activityId, true);
    }

    // A profile-scoped draft wins conflicts. Rewriting that chosen value before
    // deleting legacy also safely handles scoped+legacy overlap from old tabs.
    const notebook = scopedNotebook ?? legacyNotebook;
    try {
      window.localStorage.setItem(scopedKey, JSON.stringify(notebook));
    } catch {
      return scopedNotebook
        ? { notebook: scopedNotebook, persisted: true, storageAvailable: false }
        : emptyLoadResult(activityId, false);
    }

    try {
      window.localStorage.removeItem(legacyKey);
    } catch {
      return { notebook, persisted: true, storageAvailable: false };
    }
    return { notebook, persisted: true, storageAvailable: true };
  } catch {
    return emptyLoadResult(activityId, false);
  }
}

/** Load one activity draft without consulting completion or mastery storage. */
export function loadInquiryNotebook(activityId: string): InquiryNotebookDraft {
  return loadInquiryNotebookWithStatus(activityId).notebook;
}

/** Save one activity draft. False means the in-memory draft should remain usable. */
export function saveInquiryNotebook(notebook: InquiryNotebookDraft): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const key = studentStorageKey(notebook.activityId);
    const legacyKey = legacyStorageKey(notebook.activityId);
    if (!key || !legacyKey) return false;
    window.localStorage.setItem(key, JSON.stringify(notebook));
    // Any successful profile write also finishes cleanup left by an old tab or
    // an earlier interrupted migration. A failed cleanup remains unavailable.
    window.localStorage.removeItem(legacyKey);
    return true;
  } catch {
    return false;
  }
}

export function removeInquiryNotebook(activityId: string): void {
  if (typeof window === 'undefined') return;

  try {
    const scopedKey = studentStorageKey(activityId);
    const legacyKey = legacyStorageKey(activityId);
    if (scopedKey) window.localStorage.removeItem(scopedKey);
    if (legacyKey) window.localStorage.removeItem(legacyKey);
  } catch {
    // Browser storage or identity may be blocked; there is nothing else to remove.
  }
}

/**
 * Format a readout from generic observation metadata. Scene-specific units or
 * display rules are intentionally not reproduced here: already formatted and
 * status strings remain authoritative.
 */
export function formatInquiryObservationValue(
  value: ObservationReadoutValue | undefined,
  field: ObservationField,
): string | null {
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
    return null;
  }

  const text = String(value).trim();
  if (!text) return null;
  if (!field.unit || text.endsWith(field.unit)) return text;

  const isBareMeasurement = typeof value === 'number' || NUMERIC_READOUT.test(text);
  return isBareMeasurement ? `${text} ${field.unit}` : text;
}

function newSnapshotId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through to a local, non-security-sensitive identifier.
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Capture an immutable, human-readable snapshot of the current live readouts. */
export function createInquiryObservationSnapshot(
  observation: ObservationDefinition,
  readouts: ObservationReadouts,
  options: { id?: string; capturedAt?: string } = {},
): InquiryObservationSnapshot | null {
  const measurements = observation.fields.flatMap((field) => {
    const value = formatInquiryObservationValue(readouts[field.id], field);
    return value === null
      ? []
      : [{ fieldId: field.id, label: field.label, value }];
  });

  if (measurements.length === 0) return null;

  return {
    id: options.id ?? newSnapshotId(),
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    measurements,
  };
}

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

function observationSignature(snapshot: InquiryObservationSnapshot): string {
  return JSON.stringify(
    [...snapshot.measurements]
      .sort((left, right) => left.fieldId.localeCompare(right.fieldId))
      .map(({ fieldId, value }) => [fieldId, value.trim()]),
  );
}

export function countDistinctInquiryObservations(
  observations: InquiryObservationSnapshot[],
): number {
  return new Set(observations.map(observationSignature)).size;
}

export function getInquiryNotebookCompletion(
  notebook: InquiryNotebookDraft,
): InquiryNotebookCompletion {
  return {
    predictionReasoning: hasText(notebook.predictionReasoning),
    variables:
      hasText(notebook.variables.independent) &&
      hasText(notebook.variables.dependent) &&
      hasText(notebook.variables.controlled),
    observationCount: notebook.observations.length >= 3,
    distinctObservations: countDistinctInquiryObservations(notebook.observations) >= 2,
    cer:
      hasText(notebook.cer.claim) &&
      hasText(notebook.cer.evidence) &&
      hasText(notebook.cer.reasoning),
    modelLimitation: hasText(notebook.modelLimitation),
  };
}

export function isInquiryNotebookEvidenceComplete(
  notebook: InquiryNotebookDraft,
): boolean {
  return Object.values(getInquiryNotebookCompletion(notebook)).every(Boolean);
}
