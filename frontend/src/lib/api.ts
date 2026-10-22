import { getStudentId, STUDENT_ID_HEADER, getStudentToken, clearToken, STORAGE_KEY, TOKEN_STORAGE_KEY } from "./student_id";
import { storageSubjectFor } from "./subject_registry";
import type { ErrorCauseCode } from "./constants";
import type {
  Curriculum,
  ContentAvailability,
  Exercise,
  TutorMarkResponse,
  TutorExplainResponse,
  TutorSuggestResponse,
  TutorDialogueResponse,
  TopicProgress,
  ProgressSummary,
  DailySummary,
  WeeklyLearningSummary,
  StudentWeeklyReport,
  StudentWeeklyReflection,
  TodayStudyPlan,
  Recommendation,
  WorkedExample,
  Misconception,
  WorkedExampleEntry,
  StudyPlan,
  ExamStartResponse,
  ExamResult,
  ExamHistoryItem,
  ExamActiveSession,
  ImportedPaper,
  MistakesResponse,
  TrapNotebookResponse,
  ErrorTaxonomyResponse,
  ChallengeStartResponse,
  PSMTResponse,
  PSMTHistoryResponse,
  DiagnosticStatusResponse,
  DiagnosticStartResponse,
  DiagnosticRespondResponse,
  WritingAssessmentResponse,
  WritingHistoryResponse,
  ParentWritingHistoryResponse,
  WritingRevisionCompareResponse,
  GrammarRemediationResponse,
  CriterionScore,
  WritingTopicContextPayload,
  HealthCheck,
  Subject,
  YearLevel,
  BankReviewStatus,
  BankReviewImportResult,
  BankReviewSession,
  BankReviewItemPayload,
  BankReviewAppendReport,
  BankReviewWriteResult,
} from "./api-types";
import type { WritingTopic } from "./writing-topics";

// Browser requests stay on the frontend origin and are proxied by Next.js.
// Server-side requests can reach FastAPI directly inside the shared container.
function getApiBase(): string {
  if (typeof window !== 'undefined') return '';
  return 'http://127.0.0.1:8000';
}

export const API_BASE = `${getApiBase()}/api`;
export const PARENT_AUTH_INVALID_EVENT = 'parent-auth-invalid';

export function createMutationRequestId(prefix = 'mutation'): string {
  const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomUuid}`;
}

function createDeterministicMutationRequestId(prefix: string, parts: string[]): string {
  // Keep legacy callers compatible while making a repeated identical mutation
  // replayable even when they do not pass an explicit request ID.
  let hash = 2166136261;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16)}`;
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthCheck> {
  return safeFetch<HealthCheck>(`${API_BASE}/health`, { signal });
}

/**
 * Enhanced fetch wrapper that:
 * - Attaches the X-Student-Id header automatically
 * - Bypasses the browser HTTP cache (cache: 'no-store')
 * - Supports AbortController signal for request cancellation
 * - Throws a structured error on non-2xx responses
 */
interface SafeFetchOptions extends Omit<RequestInit, 'signal'> {
  signal?: AbortSignal;
  timeout?: number; // Timeout in milliseconds
}

export async function safeFetch<T = unknown>(url: string, options?: SafeFetchOptions): Promise<T> {
  const headers = new Headers((options?.headers as HeadersInit) ?? {});
  
  // Attach JWT Bearer Authorization header (supporting X-Student-Id fallback)
  if (!headers.has('Authorization') && !headers.has(STUDENT_ID_HEADER)) {
    // Avoid recursive call when retrieving the token itself
    if (!url.endsWith('/student/token')) {
      const token = await getStudentToken();
      if (token && token !== 'ssr-placeholder') {
        const authValue = token.startsWith('eyJ') ? `Bearer ${token}` : token;
        headers.set('Authorization', authValue);
        headers.set(STUDENT_ID_HEADER, authValue);
      } else {
        // Fallback to plain student ID if no token or SSR placeholder
        headers.set(STUDENT_ID_HEADER, getStudentId());
      }
    } else {
      headers.set(STUDENT_ID_HEADER, getStudentId());
    }
  }

  // To prevent exposing the shared API_KEY in Next.js browser JavaScript chunks (vulnerability fix),
  // we do not send X-API-Key from the browser. The backend verify_api_key middleware
  // is updated to allow requests originating from allowed CORS origins or with active sessions.
  // Attach the parent token when present. Parent Dashboard reads and writes
  // require it in addition to the active student session.
  if (typeof window !== 'undefined' && !headers.has('X-Parent-Token')) {
    try {
      const parentToken = sessionStorage.getItem('parent_token');
      if (parentToken) headers.set('X-Parent-Token', parentToken);
    } catch {}
  }

  let signal = options?.signal;
  let timeoutId: NodeJS.Timeout | undefined;

  if (options?.timeout) {
    const controller = new AbortController();
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
      if (signal.aborted) {
        controller.abort();
      }
    }
    signal = controller.signal;
    timeoutId = setTimeout(() => {
      controller.abort(new Error('Request timed out'));
    }, options.timeout);
  }

  try {
    const fetchOptions: RequestInit = {
      ...options,
      headers,
      signal,
      cache: options?.cache ?? 'no-store',
    };
    // Remove custom timeout property so it doesn't get passed to window.fetch
    delete (fetchOptions as any).timeout;

    const res = await fetch(url, fetchOptions);
    if (!res.ok) {
      const text = await res.text();
      const parentSessionInvalid =
        (res.status === 401 && (text.includes('parent_auth_required') || text.includes('parent_auth_invalid')))
        || (res.status === 403 && text.includes('student_scope_mismatch'));
      if (parentSessionInvalid && typeof window !== 'undefined') {
        try {
          sessionStorage.removeItem('parent_auth');
          sessionStorage.removeItem('parent_token');
          window.dispatchEvent(new CustomEvent(PARENT_AUTH_INVALID_EVENT));
        } catch {}
      }
      if ((res.status === 400 || res.status === 401) && (text.includes('invalid_student_id') || text.includes('missing_student_id'))) {
        clearToken();
        const freshToken = await getStudentToken();
        if (freshToken && freshToken !== 'ssr-placeholder') {
          const authValue = freshToken.startsWith('eyJ') ? `Bearer ${freshToken}` : freshToken;
          headers.set('Authorization', authValue);
          headers.set(STUDENT_ID_HEADER, authValue);
          const retryRes = await fetch(url, { ...fetchOptions, headers });
          if (retryRes.ok) return retryRes.json() as Promise<T>;
          const retryText = await retryRes.text();
          throw new Error(formatApiError(retryRes.status, retryText));
        }
      }
      throw new Error(formatApiError(res.status, text));
    }
    return res.json() as Promise<T>;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function formatApiError(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text);
    const detail = parsed?.detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => item?.msg || item?.message)
        .filter(Boolean);
      if (messages.length > 0) return messages.join(' ');
    }
    if (typeof detail === 'string') return detail;
    if (detail?.message) return detail.message;
    if (parsed?.message) return parsed.message;
  } catch {
    // Fall through to raw text.
  }
  return `API Error ${status}: ${text}`;
}

// ---------------------------------------------------------------------------
// Curriculum
// ---------------------------------------------------------------------------

export interface CurriculumRequestScope {
  subject: string;
  scope: string;
}

const curriculumCache = new Map<string, Curriculum>();
const curriculumRequests = new Map<string, Promise<Curriculum>>();

function curriculumCacheKey(requestedScope?: CurriculumRequestScope): string {
  return requestedScope
    ? `scope:${requestedScope.subject}:${requestedScope.scope}`
    : 'full';
}

function curriculumUrl(requestedScope?: CurriculumRequestScope): string {
  if (!requestedScope) return `${API_BASE}/curriculum`;
  const params = new URLSearchParams({
    subject: requestedScope.subject,
    scope: requestedScope.scope,
  });
  return `${API_BASE}/curriculum?${params.toString()}`;
}

function waitForCurriculum(
  request: Promise<Curriculum>,
  signal?: AbortSignal,
): Promise<Curriculum> {
  if (!signal) return request;
  if (signal.aborted) {
    return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    request.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export function resetCurriculumCacheForTests(): void {
  curriculumCache.clear();
  curriculumRequests.clear();
}

export async function fetchCurriculum(
  signal?: AbortSignal,
  requestedScope?: CurriculumRequestScope,
): Promise<Curriculum> {
  const key = curriculumCacheKey(requestedScope);
  const cached = curriculumCache.get(key) ?? (
    requestedScope ? curriculumCache.get('full') : undefined
  );
  if (cached) return cached;

  let request = curriculumRequests.get(key);
  if (!request) {
    // Keep the shared request independent of any one component's lifecycle.
    // Individual callers may stop waiting via their own AbortSignal.
    request = safeFetch<Curriculum>(curriculumUrl(requestedScope), { cache: 'default' })
      .then(curriculum => {
        curriculumCache.set(key, curriculum);
        return curriculum;
      })
      .finally(() => {
        curriculumRequests.delete(key);
      });
    curriculumRequests.set(key, request);
  }
  return waitForCurriculum(request, signal);
}

export async function fetchContentAvailability(signal?: AbortSignal): Promise<ContentAvailability> {
  return safeFetch<ContentAvailability>(`${API_BASE}/content/availability`, { signal });
}

export async function fetchExercises(
  topic: string,
  signal?: AbortSignal,
  subject?: Subject,
  yearLevel?: number,
  unit?: number,
  syllabusSubject?: string,
): Promise<Exercise[]> {
  const params = new URLSearchParams({ topic });
  appendPickerSubjectScope(params, subject, { yearLevel, unit, syllabusSubject });
  return safeFetch<Exercise[]>(`${API_BASE}/exercises?${params.toString()}`, { signal });
}

// ---------------------------------------------------------------------------
// Tutor Engine
// ---------------------------------------------------------------------------

export async function tutorExplain(conceptId: string, signal?: AbortSignal): Promise<TutorExplainResponse> {
  return safeFetch<TutorExplainResponse>(`${API_BASE}/tutor/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ concept_id: conceptId }),
    signal,
  });
}

export type SupportLevel = 0 | 1 | 2 | 3 | 4;
export type AnswerConfidence = 'guess' | 'maybe' | 'sure';

export interface TutorMarkMetadata {
  requestId?: string;
  isSpeedRound?: boolean;
  isRevision?: boolean;
  reviewSource?: string;
  reviewQuestionId?: string;
  todayTaskId?: string;
  usedShowAnswer?: boolean;
  supportLevel?: SupportLevel;
  confidence?: AnswerConfidence | null;
  guidedPhase?: 'guided' | 'fading' | 'independent';
  firstAttempt?: boolean;
  rootFirstAttempt?: boolean;
  correctionCompleted?: boolean;
  selfExplanation?: string | null;
  /** "I don't know": record a miss without an answer. */
  gaveUp?: boolean;
  /** Last try on the question: a miss returns the right answer. */
  revealAnswer?: boolean;
}

export async function tutorMark(
  questionId: string,
  studentAnswer: string,
  signal?: AbortSignal,
  opts?: TutorMarkMetadata,
): Promise<TutorMarkResponse> {
  const payload: Record<string, unknown> = {
    request_id: opts?.requestId,
    question_id: questionId,
    student_answer: studentAnswer,
    is_speed_round: opts?.isSpeedRound ?? false,
    used_show_answer: opts?.usedShowAnswer ?? false,
    is_revision: opts?.isRevision ?? false,
  };
  if (opts?.reviewSource !== undefined) payload.review_source = opts.reviewSource;
  if (opts?.reviewQuestionId !== undefined) payload.review_question_id = opts.reviewQuestionId;
  if (opts?.todayTaskId !== undefined) payload.today_task_id = opts.todayTaskId;
  if (opts?.supportLevel !== undefined) payload.support_level = opts.supportLevel;
  if (opts?.confidence != null) payload.confidence = opts.confidence;
  if (opts?.guidedPhase !== undefined) payload.guided_phase = opts.guidedPhase;
  if (opts?.firstAttempt !== undefined) payload.first_attempt = opts.firstAttempt;
  if (opts?.rootFirstAttempt !== undefined) payload.root_first_attempt = opts.rootFirstAttempt;
  if (opts?.correctionCompleted !== undefined) payload.correction_completed = opts.correctionCompleted;
  if (opts?.selfExplanation?.trim()) payload.self_explanation = opts.selfExplanation.trim();
  if (opts?.gaveUp) payload.gave_up = true;
  if (opts?.revealAnswer) payload.reveal_answer = true;

  return safeFetch<TutorMarkResponse>(`${API_BASE}/tutor/mark`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function updateTutorAttemptMetadata(
  questionId: string,
  attemptId: string | undefined,
  selfExplanation: string,
  signal?: AbortSignal,
): Promise<{ success: boolean }> {
  return safeFetch<{ success: boolean }>(`${API_BASE}/tutor/attempt-metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question_id: questionId,
      attempt_id: attemptId ?? null,
      self_explanation: selfExplanation.trim(),
    }),
    signal,
  });
}

export async function tutorFlagReview(questionId: string, studentAnswer: string, signal?: AbortSignal): Promise<{ ok: boolean }> {
  return safeFetch<{ ok: boolean }>(`${API_BASE}/tutor/flag-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question_id: questionId, student_answer: studentAnswer }),
    signal,
  });
}

/** Right answer for a question the student has already answered. Question payloads carry no answer key. */
export async function tutorShowAnswer(
  questionId: string,
  signal?: AbortSignal,
): Promise<{ question_id: string; correct_answer: string }> {
  return safeFetch<{ question_id: string; correct_answer: string }>(`${API_BASE}/tutor/show-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question_id: questionId }),
    signal,
  });
}

export async function tutorReflect(questionId: string, reflectionType: string, signal?: AbortSignal): Promise<{ success: boolean }> {
  return safeFetch<{ success: boolean }>(`${API_BASE}/tutor/reflect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question_id: questionId, reflection_type: reflectionType }),
    signal,
  });
}

export async function tutorSuggest(
  topic: string,
  mode: "retrieve" | "error_book" = "retrieve",
  exclude_id?: string,
  signal?: AbortSignal,
  subject?: Subject,
  yearLevel?: number,
  unit?: number,
  syllabusSubject?: string,
): Promise<TutorSuggestResponse> {
  const body: { topic: string; mode: "retrieve" | "error_book"; exclude_id?: string; subject?: Subject; year_level?: number; unit?: number; syllabus_subject?: string } = { topic, mode };
  if (exclude_id) body.exclude_id = exclude_id;
  if (subject) {
    body.subject = backendSubjectFromPickerSubject(subject);
    const impliedSyllabus = syllabusSubjectFromPickerSubject(subject);
    if (impliedSyllabus && !syllabusSubject) body.syllabus_subject = impliedSyllabus;
  }
  if (yearLevel !== undefined) body.year_level = yearLevel;
  if (unit !== undefined) body.unit = unit;
  if (syllabusSubject !== undefined) body.syllabus_subject = syllabusSubject;
  return safeFetch<TutorSuggestResponse>(`${API_BASE}/tutor/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export async function fetchStudyPlan(
  topic: string,
  subject: Subject = "math",
  signal?: AbortSignal,
): Promise<StudyPlan> {
  const params = new URLSearchParams({
    topic,
    subject: backendSubjectFromPickerSubject(subject),
  });
  return safeFetch<StudyPlan>(`${API_BASE}/tutor/plan?${params.toString()}`, { signal });
}

export async function fetchStudyPlans(
  subject: Subject = "math",
  topics: string[] = [],
  signal?: AbortSignal,
): Promise<{ plans: Record<string, StudyPlan & { topic?: string }> }> {
  return safeFetch<{ plans: Record<string, StudyPlan & { topic?: string }> }>(
    `${API_BASE}/tutor/plans`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: backendSubjectFromPickerSubject(subject), topics }),
      signal,
    },
  );
}

export interface AnalyticsScopeOptions {
  yearLevel?: number;
  unit?: number;
  syllabusSubject?: string;
  includeUnattempted?: boolean;
}

export function analyticsScopeFromYear(year: YearLevel): AnalyticsScopeOptions {
  const yearMatch = /^year(\d+)$/.exec(String(year));
  if (yearMatch) return { yearLevel: Number(yearMatch[1]) };
  const unitMatch = /^unit(\d+)$/.exec(String(year));
  if (unitMatch) return { unit: Number(unitMatch[1]) };
  return {};
}

export function syllabusSubjectFromPickerSubject(subject: Subject | string): string | undefined {
  const value = String(subject || "");
  if (!value.startsWith("senior_")) return undefined;
  const suffix = value.replace(/^senior_/, "");
  return suffix || undefined;
}

export function backendSubjectFromPickerSubject(subject: Subject | string = "math"): Subject {
  return storageSubjectFor(String(subject || "math")) as Subject;
}

function appendAnalyticsScope(params: URLSearchParams, scope?: AnalyticsScopeOptions) {
  if (scope?.yearLevel !== undefined) params.set("year_level", String(scope.yearLevel));
  if (scope?.unit !== undefined) params.set("unit", String(scope.unit));
  if (scope?.syllabusSubject) params.set("syllabus_subject", scope.syllabusSubject);
}

function appendPickerSubjectScope(
  params: URLSearchParams,
  subject?: Subject | string,
  scope?: AnalyticsScopeOptions,
) {
  params.set("subject", backendSubjectFromPickerSubject(subject || "math"));
  const impliedSyllabus = subject ? syllabusSubjectFromPickerSubject(subject) : undefined;
  if (impliedSyllabus && !scope?.syllabusSubject) {
    params.set("syllabus_subject", impliedSyllabus);
  }
  appendAnalyticsScope(params, scope);
}

export async function fetchProgress(
  subject: Subject = "math",
  signal?: AbortSignal,
  scope?: AnalyticsScopeOptions,
): Promise<TopicProgress[]> {
  const params = new URLSearchParams();
  appendPickerSubjectScope(params, subject, scope);
  if (scope?.includeUnattempted) params.set("include_unattempted", "true");
  return safeFetch<TopicProgress[]>(`${API_BASE}/tutor/progress?${params.toString()}`, { signal });
}

export async function fetchProgressSummary(
  subject: Subject = "math",
  signal?: AbortSignal,
  scope?: AnalyticsScopeOptions,
): Promise<ProgressSummary> {
  const params = new URLSearchParams();
  appendPickerSubjectScope(params, subject, scope);
  if (scope?.includeUnattempted) params.set("include_unattempted", "true");
  return safeFetch<ProgressSummary>(`${API_BASE}/tutor/progress-summary?${params.toString()}`, { signal });
}

export async function fetchRecommend(subject: Subject = "math", year: YearLevel = "year7", signal?: AbortSignal): Promise<Recommendation> {
  return safeFetch<Recommendation>(
    `${API_BASE}/tutor/recommend?subject=${backendSubjectFromPickerSubject(subject)}&year=${year}`,
    { signal },
  );
}

export async function fetchTodayPlan(
  subject: Subject = "math",
  year: YearLevel = "year7",
  signal?: AbortSignal,
): Promise<TodayStudyPlan> {
  const params = new URLSearchParams({
    subject: backendSubjectFromPickerSubject(subject),
    year: String(year),
  });
  const syllabusSubject = syllabusSubjectFromPickerSubject(subject);
  if (syllabusSubject) params.set("syllabus_subject", syllabusSubject);
  return safeFetch<TodayStudyPlan>(`${API_BASE}/tutor/today-plan?${params.toString()}`, { signal });
}

export async function tutorDialogue(
  questionId: string,
  studentMessage: string,
  signal?: AbortSignal,
  requestId?: string,
): Promise<TutorDialogueResponse> {
  return safeFetch<TutorDialogueResponse>(`${API_BASE}/tutor/dialogue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request_id: requestId,
      question_id: questionId,
      student_message: studentMessage,
    }),
    signal,
  });
}

// --- Misconception Library Endpoints ---

export async function fetchMisconceptions(
  params?: { subject?: string; topic_id?: string },
  signal?: AbortSignal,
): Promise<Misconception[]> {
  const searchParams = new URLSearchParams();
  if (params?.subject) searchParams.set("subject", backendSubjectFromPickerSubject(params.subject));
  if (params?.topic_id) searchParams.set("topic_id", params.topic_id);
  const qs = searchParams.toString();
  return safeFetch<Misconception[]>(`${API_BASE}/misconceptions/list${qs ? `?${qs}` : ""}`, { signal });
}

export async function fetchWorkedExamples(
  params?: { subject?: string; topic_id?: string },
  signal?: AbortSignal,
): Promise<WorkedExampleEntry[]> {
  const searchParams = new URLSearchParams();
  if (params?.subject) searchParams.set("subject", backendSubjectFromPickerSubject(params.subject));
  if (params?.topic_id) searchParams.set("topic_id", params.topic_id);
  const qs = searchParams.toString();
  return safeFetch<WorkedExampleEntry[]>(`${API_BASE}/worked_examples/list${qs ? `?${qs}` : ""}`, { signal });
}

// --- Diagnostic Endpoints ---

export async function diagnosticStatus(
  subject: Subject,
  yearLevel: number,
  signal?: AbortSignal,
): Promise<DiagnosticStatusResponse> {
  return safeFetch<DiagnosticStatusResponse>(
    `${API_BASE}/diagnostic/status?subject=${subject}&year_level=${yearLevel}`,
    { signal },
  );
}

export async function diagnosticStart(
  subject: Subject,
  yearLevel: number,
  signal?: AbortSignal,
  area?: string,
): Promise<DiagnosticStartResponse> {
  return safeFetch<DiagnosticStartResponse>(`${API_BASE}/diagnostic/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject, year_level: yearLevel, ...(area ? { area } : {}) }),
    signal,
  });
}

export interface DiagnosticAnswerOptions {
  /** "I haven't learned this yet": scored as not known, never as a mistake. */
  notLearned?: boolean;
  confidence?: 'guess' | 'maybe' | 'sure' | null;
}

export async function diagnosticRespond(
  reportId: string,
  questionId: string,
  studentAnswer: string,
  signal?: AbortSignal,
  requestId?: string,
  options: DiagnosticAnswerOptions = {},
): Promise<DiagnosticRespondResponse> {
  const effectiveRequestId = requestId || createDeterministicMutationRequestId(
    'diagnostic',
    [reportId, questionId, studentAnswer, options.notLearned ? 'not-learned' : '', options.confidence || ''],
  );
  return safeFetch<DiagnosticRespondResponse>(`${API_BASE}/diagnostic/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request_id: effectiveRequestId,
      report_id: reportId,
      question_id: questionId,
      student_answer: studentAnswer,
      ...(options.notLearned ? { not_learned: true } : {}),
      ...(options.confidence ? { confidence: options.confidence } : {}),
    }),
    signal,
  });
}

export async function diagnosticDismiss(
  subject: Subject,
  yearLevel: number,
  signal?: AbortSignal,
): Promise<void> {
  return safeFetch<void>(`${API_BASE}/diagnostic/dismiss`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject, year_level: yearLevel }),
    signal,
  });
}

// --- Mistakes / Error Book ---

export interface MistakeQueryOptions {
  subject?: Subject;
  topic_id?: string;
  error_type?: string;
  sort?: 'recent' | 'mastery';
  status?: 'active' | 'resolved';
  limit?: number;
  offset?: number;
  yearLevel?: number;
  unit?: number;
  syllabusSubject?: string;
}

export interface MistakeResolveOptions {
  subject?: Subject;
  question_id: string;
  topic_id: string;
  resolved: boolean;
  resolutionSource?: 'demonstrated_correction' | 'manual_dismissal';
  yearLevel?: number;
  unit?: number;
  syllabusSubject?: string;
  requestId?: string;
}

export async function fetchMistakes(options: MistakeQueryOptions = {}, signal?: AbortSignal): Promise<MistakesResponse> {
  const params = new URLSearchParams();
  appendPickerSubjectScope(params, options.subject || 'math', options);
  if (options.topic_id) params.set('topic_id', options.topic_id);
  if (options.error_type) params.set('error_type', options.error_type);
  if (options.sort) params.set('sort', options.sort);
  if (options.status) params.set('status', options.status);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  return safeFetch<MistakesResponse>(`${API_BASE}/tutor/mistakes?${params.toString()}`, { signal });
}

export async function fetchTrapNotebook(
  options: Pick<MistakeQueryOptions, 'subject' | 'topic_id' | 'yearLevel' | 'unit' | 'syllabusSubject'> = {},
  signal?: AbortSignal,
): Promise<TrapNotebookResponse> {
  const params = new URLSearchParams();
  appendPickerSubjectScope(params, options.subject || 'math', options);
  if (options.topic_id) params.set('topic_id', options.topic_id);
  return safeFetch<TrapNotebookResponse>(`${API_BASE}/tutor/trap-notebook?${params.toString()}`, { signal });
}

export async function fetchErrorTaxonomy(subject: Subject = 'math', signal?: AbortSignal): Promise<ErrorTaxonomyResponse> {
  const params = new URLSearchParams({ subject: backendSubjectFromPickerSubject(subject) });
  return safeFetch<ErrorTaxonomyResponse>(`${API_BASE}/tutor/error-taxonomy?${params.toString()}`, { signal });
}

export async function recordMistakeCause(
  options: {
    subject?: Subject;
    question_id: string;
    topic_id: string;
    error_cause: ErrorCauseCode;
    ifThenStrategy?: string;
    yearLevel?: number;
    unit?: number;
    syllabusSubject?: string;
    requestId?: string;
  },
  signal?: AbortSignal,
): Promise<{ closure_stage: string; error_cause: string; if_then_strategy?: string | null; cause_recorded_at: string }> {
  const backendSubject = backendSubjectFromPickerSubject(options.subject || "math");
  const syllabusSubject = options.syllabusSubject ?? syllabusSubjectFromPickerSubject(options.subject || "math");
  const effectiveRequestId = options.requestId || createDeterministicMutationRequestId(
    'mistake_cause',
    [
      backendSubject,
      options.question_id,
      options.topic_id,
      options.error_cause,
      options.ifThenStrategy?.trim() || '',
      String(options.yearLevel ?? ''),
      String(options.unit ?? ''),
      syllabusSubject || '',
    ],
  );
  return safeFetch(`${API_BASE}/tutor/mistakes/cause`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request_id: effectiveRequestId,
      subject: backendSubject,
      question_id: options.question_id,
      topic_id: options.topic_id,
      error_cause: options.error_cause,
      if_then_strategy: options.ifThenStrategy?.trim() || undefined,
      year_level: options.yearLevel,
      unit: options.unit,
      syllabus_subject: syllabusSubject,
    }),
    signal,
  });
}

export async function resolveMistakeReview(
  options: MistakeResolveOptions,
  signal?: AbortSignal,
): Promise<{
  status: string;
  resolved: boolean;
  review_count: number;
  closure_stage: string;
  transfer_correct_at?: string | null;
  consolidation_due_at?: string | null;
  closed_at?: string | null;
}> {
  const backendSubject = backendSubjectFromPickerSubject(options.subject || "math");
  const syllabusSubject = options.syllabusSubject ?? syllabusSubjectFromPickerSubject(options.subject || "math");
  const effectiveRequestId = options.requestId || createDeterministicMutationRequestId(
    'mistake_resolve',
    [
      backendSubject,
      options.question_id,
      options.topic_id,
      String(options.resolved),
      options.resolutionSource || 'manual_dismissal',
      String(options.yearLevel ?? ''),
      String(options.unit ?? ''),
      syllabusSubject || '',
    ],
  );
  return safeFetch(
    `${API_BASE}/tutor/mistakes/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: effectiveRequestId,
        subject: backendSubject,
        question_id: options.question_id,
        topic_id: options.topic_id,
        resolved: options.resolved,
        resolution_source: options.resolutionSource ?? "manual_dismissal",
        year_level: options.yearLevel,
        unit: options.unit,
        syllabus_subject: syllabusSubject,
      }),
      signal,
    },
  );
}

// --- Worked Example (concept card) ---

export async function fetchTopicWorkedExample(topicId: string, signal?: AbortSignal): Promise<WorkedExample> {
  return safeFetch<WorkedExample>(`${API_BASE}/tutor/worked-example?topic_id=${topicId}`, { signal });
}

// --- Mock Exam ---

export async function examStart(
  params: {
    subject?: Subject;
    year_level?: number;
    unit?: number;
    syllabus_subject?: string;
    num_questions?: number;
    time_limit_minutes?: number;
    exam_file?: string;
    sf_ratio?: number;
    cf_ratio?: number;
    cu_ratio?: number;
    exam_type?: string;
  } = {},
  signal?: AbortSignal,
): Promise<ExamStartResponse> {
  return safeFetch<ExamStartResponse>(`${API_BASE}/exam/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: backendSubjectFromPickerSubject(params.subject || "math"),
      year_level: params.year_level ?? (params.unit === undefined ? 7 : null),
      unit: params.unit ?? null,
      syllabus_subject: params.syllabus_subject ?? syllabusSubjectFromPickerSubject(params.subject || "math") ?? null,
      num_questions: params.num_questions || 20,
      time_limit_minutes: params.time_limit_minutes || 45,
      exam_file: params.exam_file || null,
      sf_ratio: params.sf_ratio !== undefined ? params.sf_ratio : 0.6,
      cf_ratio: params.cf_ratio !== undefined ? params.cf_ratio : 0.3,
      cu_ratio: params.cu_ratio !== undefined ? params.cu_ratio : 0.1,
      exam_type: params.exam_type || "mixed",
    }),
    signal,
  });
}

export async function examListPapers(signal?: AbortSignal): Promise<ImportedPaper[]> {
  return safeFetch<ImportedPaper[]>(`${API_BASE}/exam/list-papers`, { signal });
}

/** Newest unsubmitted exam in this scope, or `active: null`. */
export async function examActive(
  subject: Subject = "math",
  signal?: AbortSignal,
  scope?: AnalyticsScopeOptions,
): Promise<{ active: ExamActiveSession | null }> {
  const params = new URLSearchParams();
  appendPickerSubjectScope(params, subject, scope);
  return safeFetch(`${API_BASE}/exam/active?${params.toString()}`, { signal });
}

/** Continue an unsubmitted exam: same paper order, answers and server deadline. */
export async function examResume(examId: string, subject: Subject = "math", signal?: AbortSignal): Promise<ExamStartResponse> {
  return safeFetch<ExamStartResponse>(`${API_BASE}/exam/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: backendSubjectFromPickerSubject(subject), exam_id: examId }),
    signal,
  });
}

/** Delete an unsubmitted exam and its saved answers. */
export async function examDiscard(examId: string, subject: Subject = "math"): Promise<{ ok: boolean; exam_id: string }> {
  return safeFetch(`${API_BASE}/exam/discard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: backendSubjectFromPickerSubject(subject), exam_id: examId }),
  });
}

export async function examSave(
  examId: string,
  payload: {
    responses?: Record<string, string>;
    current_index?: number;
    flagged?: string[];
    revision?: number;
  },
  subject: Subject = "math",
  signal?: AbortSignal,
): Promise<{ ok: boolean; saved_at?: string; deadline_at?: string; save_revision?: number; stale?: boolean; duplicate?: boolean; error?: string; message?: string }> {
  return safeFetch(`${API_BASE}/exam/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: backendSubjectFromPickerSubject(subject),
      exam_id: examId,
      responses: payload.responses,
      current_index: payload.current_index,
      flagged: payload.flagged,
      revision: payload.revision,
    }),
    signal,
  });
}

// Browsers cap the combined in-flight keepalive request body budget at roughly
// 64 KiB. Leave room for implementation overhead and refuse oversized bodies
// so the caller can fall back to the normal visibilitychange save path.
export const EXAM_KEEPALIVE_MAX_BYTES = 60 * 1024;

export function examSaveOnExit(
  examId: string,
  payload: {
    responses?: Record<string, string>;
    current_index?: number;
    flagged?: string[];
    revision?: number;
  },
  subject: Subject = "math",
): boolean {
  if (typeof window === "undefined") return false;

  const body = JSON.stringify({
    subject: backendSubjectFromPickerSubject(subject),
    exam_id: examId,
    responses: payload.responses,
    current_index: payload.current_index,
    flagged: payload.flagged,
    revision: payload.revision,
  });
  if (new TextEncoder().encode(body).byteLength > EXAM_KEEPALIVE_MAX_BYTES) {
    return false;
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  const token = localStorage.getItem(TOKEN_STORAGE_KEY) || getStudentId();
  const authValue = token.startsWith("eyJ") ? `Bearer ${token}` : token;
  headers.set("Authorization", authValue);
  headers.set(STUDENT_ID_HEADER, authValue);

  try {
    void fetch(`${API_BASE}/exam/save`, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      keepalive: true,
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function examSubmit(
  examId: string,
  responses: Record<string, string>,
  subject: Subject = "math",
  signal?: AbortSignal
): Promise<ExamResult> {
  return safeFetch<ExamResult>(`${API_BASE}/exam/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: backendSubjectFromPickerSubject(subject), exam_id: examId, responses }),
    signal,
  });
}

export async function examHistory(
  subject: Subject = "math",
  signal?: AbortSignal,
  scope?: AnalyticsScopeOptions,
): Promise<ExamHistoryItem[]> {
  const params = new URLSearchParams();
  appendPickerSubjectScope(params, subject, scope);
  return safeFetch<ExamHistoryItem[]>(`${API_BASE}/exam/history?${params.toString()}`, { signal });
}

// --- Daily Goals ---

export async function fetchDailySummary(
  subject: Subject = "math",
  signal?: AbortSignal,
  scope?: AnalyticsScopeOptions,
): Promise<DailySummary> {
  const params = new URLSearchParams();
  appendPickerSubjectScope(params, subject, scope);
  return safeFetch<DailySummary>(`${API_BASE}/tutor/daily-summary?${params.toString()}`, { signal });
}

export async function fetchWeeklyLearningSummary(
  days: number = 7,
  signal?: AbortSignal,
): Promise<WeeklyLearningSummary> {
  const params = new URLSearchParams({ days: String(days) });
  return safeFetch<WeeklyLearningSummary>(`${API_BASE}/tutor/weekly-learning-summary?${params.toString()}`, { signal });
}

export async function fetchStudentWeeklyReport(
  weekStart?: string,
  signal?: AbortSignal,
): Promise<StudentWeeklyReport> {
  const params = new URLSearchParams();
  if (weekStart) params.set('week_start', weekStart);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return safeFetch<StudentWeeklyReport>(`${API_BASE}/tutor/weekly-report${query}`, { signal });
}

export async function saveStudentWeeklyReflection(
  reflection: Pick<StudentWeeklyReflection, 'proud_of' | 'challenge' | 'next_week_intention'> & { week_start: string },
  signal?: AbortSignal,
): Promise<StudentWeeklyReflection & { week_start: string }> {
  return safeFetch<StudentWeeklyReflection & { week_start: string }>(`${API_BASE}/tutor/weekly-report/reflection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reflection),
    signal,
  });
}

export async function fetchQuestsOverview(
  subject: Subject = "math",
  signal?: AbortSignal,
): Promise<import("./api-types").QuestsOverview> {
  const params = new URLSearchParams({ subject: backendSubjectFromPickerSubject(subject) });
  return safeFetch(`${API_BASE}/quests/overview?${params.toString()}`, { signal });
}

export async function claimQuest(
  questId: string,
  subject: Subject = "math",
  signal?: AbortSignal,
): Promise<{ ok: boolean; awarded: number; stars: number; level: number; xp: number }> {
  return safeFetch(`${API_BASE}/quests/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quest_id: questId, subject: backendSubjectFromPickerSubject(subject) }),
    signal,
  });
}

export async function openQuestChest(
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  loot: { type: string; amount: number; label: string };
  stars: number;
  chests: number;
  freeze_tokens: number;
  level: number;
}> {
  return safeFetch(`${API_BASE}/quests/open-chest`, { method: "POST", signal });
}

export async function spinQuestWheel(
  signal?: AbortSignal,
): Promise<import("./api-types").QuestSpinResult> {
  return safeFetch(`${API_BASE}/quests/spin`, { method: "POST", signal });
}

export async function redeemQuestReward(
  catalogId: string,
  quantity: number = 1,
  signal?: AbortSignal,
): Promise<{ ok: boolean; redemption: Record<string, unknown>; stars: number; quantity?: number }> {
  return safeFetch(`${API_BASE}/quests/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ catalog_id: catalogId, quantity: Math.max(1, Math.min(20, quantity || 1)) }),
    signal,
  });
}

export async function setDailyGoal(dailyGoal: number, subject: Subject = "math", signal?: AbortSignal): Promise<void> {
  return safeFetch<void>(`${API_BASE}/tutor/set-daily-goal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ daily_goal: dailyGoal, subject: backendSubjectFromPickerSubject(subject) }),
    signal,
  });
}

// --- Challenge / Speed Round ---

export async function challengeStart(
  topic: string,
  timeLimitSeconds: number = 120,
  yearLevel: number = 7,
  subject: Subject = "math",
  numQuestions: number = 10,
  signal?: AbortSignal,
): Promise<ChallengeStartResponse> {
  return safeFetch<ChallengeStartResponse>(`${API_BASE}/speed-round/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: backendSubjectFromPickerSubject(subject),
      year_level: yearLevel,
      topic,
      num_questions: numQuestions,
      time_limit_seconds: timeLimitSeconds,
      challenge_mode: true,
    }),
    signal,
  });
}

// --- PSMT Helper ---

export async function checkPSMT(
  subject: Subject,
  sectionName: string,
  draftText: string,
  images: string[] = [],
  signal?: AbortSignal,
  requestId?: string,
): Promise<PSMTResponse> {
  return safeFetch<PSMTResponse>(`${API_BASE}/tutor/psmt/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request_id: requestId,
      subject: backendSubjectFromPickerSubject(subject),
      section_name: sectionName,
      draft_text: draftText,
      images,
    }),
    signal,
  });
}

export async function fetchPSMTHistory(limit = 10, signal?: AbortSignal): Promise<PSMTHistoryResponse> {
  return safeFetch<PSMTHistoryResponse>(`${API_BASE}/tutor/psmt/history?limit=${limit}`, { signal });
}

// ---------------------------------------------------------------------------
// Parent review
// ---------------------------------------------------------------------------
// Student Auth
// ---------------------------------------------------------------------------

interface AuthResponse {
  student_id: string;
  access_token: string;
  display_name: string;
}

const AUTH_BASE = `${getApiBase()}/api/auth`;

export async function authRegister(name: string, password: string, signal?: AbortSignal): Promise<AuthResponse> {
  const studentId = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  const res = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password, student_id: studentId || undefined }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.detail?.message || err?.message || "Registration failed");
  }
  return res.json();
}

export async function authLogin(name: string, password: string, signal?: AbortSignal): Promise<AuthResponse> {
  const res = await fetch(`${AUTH_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.detail?.message || err?.message || "Login failed");
  }
  return res.json();
}

// ---------------------------------------------------------------------------

export async function fetchPendingReviews(
  studentId: string,
  subject: string = "math",
  signal?: AbortSignal,
  scope?: AnalyticsScopeOptions,
): Promise<any> {
  const params = new URLSearchParams({
    student_id: studentId,
    subject: backendSubjectFromPickerSubject(subject),
  });
  appendAnalyticsScope(params, scope);
  return safeFetch<any>(`${API_BASE}/parent/review-queue?${params.toString()}`, { signal });
}

export async function submitParentReview(review: {
  student_id: string;
  subject: string;
  topic: string;
  question_id: string;
  student_answer: string;
  correct: boolean;
  attempt_id?: string | null;
  exam_id?: string | null;
  part_label?: string | null;
}, signal?: AbortSignal): Promise<any> {
  return safeFetch<any>(`${API_BASE}/parent/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...review, subject: backendSubjectFromPickerSubject(review.subject) }),
    signal,
  });
}

export async function getPuMode(signal?: AbortSignal): Promise<{ pu_mode: boolean }> {
  return safeFetch<{ pu_mode: boolean }>(`${API_BASE}/parent/pu-mode`, { signal });
}

/** Validate the parent password server-side and return a short-lived parent token. */
export async function parentLogin(password: string): Promise<{ token: string }> {
  return safeFetch<{ token: string }>(`${API_BASE}/parent/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export async function setPuMode(enabled: boolean, signal?: AbortSignal): Promise<{ pu_mode: boolean }> {
  return safeFetch<{ pu_mode: boolean }>(`${API_BASE}/parent/pu-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
    signal,
  });
}

export async function parentQuestsSnapshot(signal?: AbortSignal): Promise<Record<string, unknown>> {
  return safeFetch(`${API_BASE}/parent/quests/snapshot`, { signal });
}

export async function parentQuestsSettings(
  body: {
    enabled?: boolean;
    shop_enabled?: boolean;
    chests_enabled?: boolean;
    spin_enabled?: boolean;
    daily_star_cap?: number;
  },
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return safeFetch(`${API_BASE}/parent/quests/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export async function parentQuestsSaveCatalog(
  item: {
    id?: string;
    title: string;
    emoji?: string;
    cost_stars: number;
    category?: string;
    stock?: number | null;
    enabled?: boolean;
    description?: string;
  },
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return safeFetch(`${API_BASE}/parent/quests/catalog`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
    signal,
  });
}

export async function parentQuestsDeleteCatalog(
  catalogId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return safeFetch(`${API_BASE}/parent/quests/catalog/${encodeURIComponent(catalogId)}`, {
    method: "DELETE",
    signal,
  });
}

export async function parentQuestsResolve(
  redemptionId: string,
  approve: boolean,
  parentNote = "",
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return safeFetch(`${API_BASE}/parent/quests/redemptions/${encodeURIComponent(redemptionId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approve, parent_note: parentNote }),
    signal,
  });
}

// ---------------------------------------------------------------------------
// Writing Assessment
// ---------------------------------------------------------------------------

export async function fetchWritingTopics(yearLevel?: number, signal?: AbortSignal): Promise<WritingTopic[]> {
  const qs = yearLevel ? `?year_level=${yearLevel}` : '';
  return safeFetch<WritingTopic[]>(`${API_BASE}/tutor/writing/topics${qs}`, { signal });
}

export const WRITING_ASSESS_TIMEOUT_MS = 190000;

type WritingRequestOptions = {
  sourceText?: string;
  writerStatement?: string;
  taskSheetText?: string;
  schoolIsmgText?: string;
  topicId?: string;
  topicPrompt?: string;
  topicContext?: WritingTopicContextPayload;
  timeLimitMinutes?: number;
  timeTakenSeconds?: number;
  revisionOf?: string;
  assessmentRequestId?: string;
};

function buildWritingRequestBody(
  subject: string,
  yearLevel: number,
  promptType: 'persuasive' | 'narrative' | 'analytical' | 'expository',
  draftText: string,
  options?: WritingRequestOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    subject: backendSubjectFromPickerSubject(subject),
    year_level: yearLevel,
    prompt_type: promptType,
    draft_text: draftText,
  };
  if (options?.sourceText) body.source_text = options.sourceText;
  if (options?.writerStatement) body.writer_statement = options.writerStatement;
  if (options?.taskSheetText) body.task_sheet_text = options.taskSheetText;
  if (options?.schoolIsmgText) body.school_ismg_text = options.schoolIsmgText;
  if (options?.topicId) body.topic_id = options.topicId;
  if (options?.topicPrompt) body.topic_prompt = options.topicPrompt;
  if (options?.topicContext) body.topic_context = options.topicContext;
  if (options?.timeLimitMinutes) body.time_limit_minutes = options.timeLimitMinutes;
  if (options?.timeTakenSeconds) body.time_taken_seconds = options.timeTakenSeconds;
  if (options?.revisionOf) body.revision_of = options.revisionOf;
  if (options?.assessmentRequestId) body.assessment_request_id = options.assessmentRequestId;
  return body;
}

export async function fetchWritingAssess(
  subject: string,
  yearLevel: number,
  promptType: 'persuasive' | 'narrative' | 'analytical' | 'expository',
  draftText: string,
  options?: WritingRequestOptions,
  signal?: AbortSignal,
): Promise<WritingAssessmentResponse> {
  return safeFetch<WritingAssessmentResponse>(`${API_BASE}/tutor/writing/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildWritingRequestBody(subject, yearLevel, promptType, draftText, options)),
    signal,
    timeout: WRITING_ASSESS_TIMEOUT_MS, // 10s beyond the backend's 180s end-to-end deadline
  });
}

export interface WritingPromptExport {
  structured_prompt: string;
  readable_prompt: string;
  schema_hint: string;
}

export async function fetchWritingExportPrompt(
  subject: string,
  yearLevel: number,
  promptType: 'persuasive' | 'narrative' | 'analytical' | 'expository',
  draftText: string,
  options?: WritingRequestOptions,
  signal?: AbortSignal,
): Promise<WritingPromptExport> {
  return safeFetch<WritingPromptExport>(`${API_BASE}/tutor/writing/export-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildWritingRequestBody(subject, yearLevel, promptType, draftText, options)),
    signal,
  });
}

export async function fetchWritingImportResult(
  subject: string,
  yearLevel: number,
  promptType: 'persuasive' | 'narrative' | 'analytical' | 'expository',
  draftText: string,
  externalText: string,
  options?: WritingRequestOptions,
  signal?: AbortSignal,
): Promise<WritingAssessmentResponse> {
  return safeFetch<WritingAssessmentResponse>(`${API_BASE}/tutor/writing/import-result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...buildWritingRequestBody(subject, yearLevel, promptType, draftText, options),
      external_text: externalText,
    }),
    signal,
  });
}

export async function fetchWritingHistory(signal?: AbortSignal): Promise<WritingHistoryResponse> {
  return safeFetch<WritingHistoryResponse>(`${API_BASE}/tutor/writing/history`, { signal });
}

export async function fetchWritingCompare(
  originalTimestamp: string,
  revisedText: string,
  signal?: AbortSignal,
): Promise<WritingRevisionCompareResponse> {
  return safeFetch<WritingRevisionCompareResponse>(`${API_BASE}/tutor/writing/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      original_timestamp: originalTimestamp,
      revised_text: revisedText,
    }),
    signal,
    timeout: 90000, // 90s client-side timeout
  });
}

export async function fetchGrammarRemediation(
  payload: {
    criterionScores: CriterionScore[];
    draftText: string;
    yearLevel: number;
    promptType: 'persuasive' | 'narrative' | 'analytical' | 'expository';
  },
  signal?: AbortSignal,
): Promise<GrammarRemediationResponse> {
  return safeFetch<GrammarRemediationResponse>(`${API_BASE}/tutor/writing/grammar-remediation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      criterion_scores: payload.criterionScores,
      draft_text: payload.draftText,
      year_level: payload.yearLevel,
      prompt_type: payload.promptType,
    }),
    signal,
    timeout: 90000, // 90s client-side timeout
  });
}

export async function fetchParentNextSteps(
  subject: Subject = "math",
  year: YearLevel = "year7",
  signal?: AbortSignal,
  scope?: AnalyticsScopeOptions,
): Promise<any> {
  const params = new URLSearchParams();
  params.set("year", year);
  appendPickerSubjectScope(params, subject, scope ?? analyticsScopeFromYear(year));
  return safeFetch<any>(
    `${API_BASE}/tutor/parent-next-steps?${params.toString()}`,
    { signal }
  );
}

export async function fetchLearningFacets(
  subject: Subject = "math",
  signal?: AbortSignal,
  scope?: AnalyticsScopeOptions,
): Promise<any> {
  const params = new URLSearchParams();
  appendPickerSubjectScope(params, subject, scope);
  return safeFetch<any>(
    `${API_BASE}/tutor/learning-facets?${params.toString()}`,
    { signal }
  );
}

export async function fetchParentEnglishSummary(
  studentId: string,
  signal?: AbortSignal,
  scope?: AnalyticsScopeOptions,
): Promise<any> {
  const params = new URLSearchParams();
  params.set("student_id", studentId);
  appendAnalyticsScope(params, scope);
  return safeFetch<any>(
    `${API_BASE}/parent/english-summary?${params.toString()}`,
    { signal }
  );
}

export async function fetchParentWritingHistory(
  studentId: string,
  signal?: AbortSignal,
  scope?: AnalyticsScopeOptions,
): Promise<ParentWritingHistoryResponse> {
  const params = new URLSearchParams();
  params.set("student_id", studentId);
  appendAnalyticsScope(params, scope);
  return safeFetch<ParentWritingHistoryResponse>(
    `${API_BASE}/parent/writing-history?${params.toString()}`,
    { signal },
  );
}

export async function fetchAdvancedLesson(
  topicId: string,
  subject: Subject = "math",
  year: YearLevel = "year7",
  signal?: AbortSignal
): Promise<any> {
  const params = new URLSearchParams();
  params.set("topic_id", topicId);
  params.set("year", year);
  appendPickerSubjectScope(params, subject, analyticsScopeFromYear(year));
  return safeFetch<any>(
    `${API_BASE}/tutor/advanced-lesson?${params.toString()}`,
    { signal }
  );
}

// --- Bank review (dev-only; backend gated by BANK_REVIEW_ENABLED) ---

export async function bankReviewStatus(signal?: AbortSignal): Promise<BankReviewStatus> {
  return safeFetch<BankReviewStatus>(`${API_BASE}/dev/bank-review/status`, { signal });
}

/** Import bank array, generation candidates, items wrapper, or exam { questions }. */
export async function bankReviewImport(
  payload: unknown,
  sourceName = "upload.json",
  signal?: AbortSignal,
): Promise<BankReviewImportResult> {
  let body: unknown;
  if (Array.isArray(payload)) {
    body = { exercises: payload, source_name: sourceName };
  } else if (payload && typeof payload === "object") {
    body = { ...(payload as Record<string, unknown>), source_name: sourceName };
  } else {
    body = { exercises: [], source_name: sourceName };
  }
  return safeFetch<BankReviewImportResult>(`${API_BASE}/dev/bank-review/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export async function bankReviewListExams(
  signal?: AbortSignal,
): Promise<{ exams_dir: string; papers: import("./api-types").BankReviewExamPaper[] }> {
  return safeFetch(`${API_BASE}/dev/bank-review/exams`, { signal });
}

export async function bankReviewImportExam(
  filename: string,
  opts?: { default_subject?: string; default_year_level?: number },
  signal?: AbortSignal,
): Promise<BankReviewImportResult> {
  return safeFetch<BankReviewImportResult>(`${API_BASE}/dev/bank-review/import-exam`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename,
      default_subject: opts?.default_subject ?? null,
      default_year_level: opts?.default_year_level ?? null,
    }),
    signal,
  });
}

export async function bankReviewSaveExam(
  sessionId: string,
  opts?: {
    filename?: string;
    title?: string;
    time_limit_minutes?: number;
    create_backup?: boolean;
  },
  signal?: AbortSignal,
): Promise<BankReviewWriteResult> {
  return safeFetch(`${API_BASE}/dev/bank-review/session/${sessionId}/save-exam`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: opts?.filename ?? null,
      title: opts?.title ?? null,
      time_limit_minutes: opts?.time_limit_minutes ?? null,
      create_backup: opts?.create_backup ?? true,
    }),
    signal,
  });
}

export async function bankReviewListTargets(
  signal?: AbortSignal,
): Promise<{ data_dir: string; targets: import("./api-types").BankReviewTargetFile[] }> {
  return safeFetch(`${API_BASE}/dev/bank-review/targets`, { signal });
}

export async function bankReviewLoadBank(
  filename: string,
  signal?: AbortSignal,
): Promise<BankReviewImportResult> {
  return safeFetch<BankReviewImportResult>(`${API_BASE}/dev/bank-review/load-bank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
    signal,
  });
}

export async function bankReviewSaveBank(
  sessionId: string,
  opts?: {
    filename?: string;
    create_backup?: boolean;
    require_all_valid?: boolean;
  },
  signal?: AbortSignal,
): Promise<BankReviewWriteResult> {
  return safeFetch(`${API_BASE}/dev/bank-review/session/${sessionId}/save-bank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: opts?.filename ?? null,
      create_backup: opts?.create_backup ?? true,
      require_all_valid: opts?.require_all_valid ?? true,
    }),
    signal,
  });
}

export async function bankReviewCloseSession(
  sessionId: string,
): Promise<{ status: string; session_id: string }> {
  return safeFetch<{ status: string; session_id: string }>(
    `${API_BASE}/dev/bank-review/session/${sessionId}`,
    { method: 'DELETE' },
  );
}

export async function bankReviewSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<BankReviewSession> {
  return safeFetch<BankReviewSession>(`${API_BASE}/dev/bank-review/session/${sessionId}`, { signal });
}

export async function bankReviewItem(
  sessionId: string,
  index: number,
  signal?: AbortSignal,
): Promise<BankReviewItemPayload> {
  return safeFetch<BankReviewItemPayload>(
    `${API_BASE}/dev/bank-review/session/${sessionId}/item?index=${index}`,
    { signal },
  );
}

export async function bankReviewDeleteItem(
  sessionId: string,
  index: number,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  deleted_id: string | null;
  deleted_index: number;
  total: number;
  next_index: number | null;
}> {
  return safeFetch(
    `${API_BASE}/dev/bank-review/session/${sessionId}/item?index=${index}`,
    { method: "DELETE", signal },
  );
}

export async function bankReviewFlag(
  sessionId: string,
  index: number,
  reviewed: boolean,
  signal?: AbortSignal,
): Promise<{ id: string; reviewed: boolean }> {
  return safeFetch(`${API_BASE}/dev/bank-review/session/${sessionId}/flag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index, reviewed }),
    signal,
  });
}

export async function bankReviewAppend(
  sessionId: string,
  mode: "all_valid" | "reviewed_only" | "ids" = "all_valid",
  ids: string[] = [],
  signal?: AbortSignal,
): Promise<BankReviewAppendReport> {
  return safeFetch<BankReviewAppendReport>(`${API_BASE}/dev/bank-review/session/${sessionId}/append`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, ids }),
    signal,
  });
}

export async function bankReviewMark(
  sessionId: string,
  index: number,
  studentAnswer: string,
  signal?: AbortSignal,
): Promise<TutorMarkResponse> {
  return safeFetch<TutorMarkResponse>(`${API_BASE}/dev/bank-review/session/${sessionId}/mark`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index, student_answer: studentAnswer }),
    signal,
    timeout: 120_000,
  });
}

export async function bankReviewUpdateItem(
  sessionId: string,
  payload: {
    index: number;
    question?: string;
    answer?: string;
    steps?: string[];
    choices?: string[];
    correct_choice?: string;
    rubric_key_points?: string[];
    status?: "active" | "draft";
    sub_parts?: Array<{
      label: string;
      question: string;
      answer: string;
      marks?: number | null;
    }>;
    diagram_data?: Record<string, unknown> | null;
    clear_diagram?: boolean;
    image?: string | null;
    clear_image?: boolean;
    sample_reasoning?: string | null;
    clear_sample_reasoning?: boolean;
  },
  signal?: AbortSignal,
): Promise<BankReviewItemPayload> {
  return safeFetch<BankReviewItemPayload>(`${API_BASE}/dev/bank-review/session/${sessionId}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function bankReviewExport(
  sessionId: string,
  activate = false,
  signal?: AbortSignal,
): Promise<{ source_name?: string; total: number; activated: boolean; exercises: unknown[] }> {
  const q = activate ? "?activate=true" : "";
  return safeFetch(`${API_BASE}/dev/bank-review/session/${sessionId}/export${q}`, { signal });
}

export async function bankReviewBulkStatus(
  sessionId: string,
  status: "active" | "draft" = "active",
  mode: "all" | "valid_only" = "all",
  signal?: AbortSignal,
): Promise<{ changed: number; status: string; mode: string }> {
  return safeFetch(`${API_BASE}/dev/bank-review/session/${sessionId}/bulk-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, mode }),
    signal,
  });
}
