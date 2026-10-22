/**
 * Shared TypeScript types for API responses and domain models.
 *
 * Centralises types previously defined ad-hoc across pages/components,
 * eliminating pervasive `any` usage. Add new types here as the API evolves.
 */

export type Subject =
  | 'math'
  | 'english'
  | 'science'
  | 'senior_math'
  | 'senior_english'
  | 'senior_science'
  | (string & {});
export type YearLevel =
  | 'year7'
  | 'year8'
  | 'year9'
  | 'year10'
  | 'unit1'
  | 'unit2'
  | 'unit3'
  | 'unit4'
  | (string & {});

export interface HealthCheck {
  status: string;
  message: string;
  llm_status: 'mock' | 'healthy' | 'degraded' | 'unreachable' | string;
  cors_origins?: string[];
}

export interface TutorLabLink {
  href: string;
  title: string;
  objective: string;
}

// ---------------------------------------------------------------------------
// Curriculum
// ---------------------------------------------------------------------------

export interface CurriculumTopic {
  topic_id: string;
  name?: string;
  content_descriptor_text?: string;
  strand?: string;
  sub_strand?: string;
  unit?: string | number;
  sequence?: number;
  pathway_group?: string;
}

export type Curriculum = Record<string, Record<string, Record<string, CurriculumTopic>>>;

export interface ContentAvailability {
  by_subject: Record<string, number>;
  by_year: Record<string, Record<string, number>>;
  by_unit: Record<string, Record<string, number>>;
  runtime_validation?: {
    skipped_invalid_count: number;
    skipped_invalid_ids: string[];
  };
}

// ---------------------------------------------------------------------------
// Exercises / Questions
// ---------------------------------------------------------------------------

export interface SubPart {
  label: string;
  question: string;
  marks: number;
  max_score?: number | null;
  choices?: string[];
  correct_choice?: string | null;
  answer?: string;
  rubric?: Record<string, unknown> | null;
  partial_credit?: Record<string, unknown> | null;
  answer_tolerance?: Record<string, unknown> | null;
  alternative_answers?: string[] | null;
  steps?: string[] | null;
  difficulty?: string | null;
  diagram_data?: Record<string, unknown> | null;
  image?: string | null;
  diagram_description?: string | null;
}


export interface Rubric {
  max_score: number;
  scoring_criteria?: string[];
}


export interface MathExerciseMetadata {
  strand?: string | null;
  sub_strand?: string | null;
  skill?: string | null;
  calculator_allowed?: boolean | null;
  expected_working_steps?: string[] | null;
  prerequisite_skills?: string[] | null;
  common_misconceptions?: string[] | null;
  strategy_focus?: string | null;
  representation_type?: string | null;
}

export interface EnglishExerciseMetadata {
  facet?:
    | 'reading_comprehension'
    | 'text_evidence'
    | 'language_conventions'
    | 'vocabulary'
    | 'writing_structure'
    | 'spelling_punctuation'
    | null;
  passage?: string | null;
  stimulus_id?: string | null;
  passage_mode?: 'stimulus' | 'inline' | 'none' | null;
  evidence_spans?: Record<string, unknown>[] | null;
  accepted_answer_variants?: string[] | null;
  grammar_focus?: string | null;
  writing_skill?: string | null;
}

export interface ScienceExerciseMetadata {
  strand?: string | null;
  sub_strand?: string | null;
  science_understanding?: string | null;
  science_inquiry_skill?: string | null;
  science_as_human_endeavour?: string | null;
  practical_context?: string | null;
  safety_notes?: string[] | null;
  equipment?: string[] | null;
  data_representation?: 'table' | 'graph' | 'diagram' | 'model' | 'calculation' | 'extended_response' | null;
  variables?: Record<string, unknown> | null;
  claim_evidence_reasoning?: boolean | null;
}

export interface Exercise {
  id: string;
  question: string;
  passage?: string | null;
  resolved_passage?: string | null;
  question_type: 'short_answer' | 'multiple_choice' | 'reasoning' | 'multi_part';
  topic_ids: string[];
  topic?: string;
  choices?: string[];
  sub_parts?: SubPart[];
  rubric?: Rubric;
  difficulty?: string;
  complexity?: 'simple_familiar' | 'complex_familiar' | 'complex_unfamiliar';
  diagram_data?: Record<string, unknown> | null;
  image?: string;
  answer?: string;
  correct_answer?: string;
  correct_choice?: string;
  sample_reasoning?: string;
  answer_tolerance?: Record<string, unknown> | null;
  partial_credit?: Record<string, unknown> | null;
  framework?: string;
  concept_card?: {
    hint_levels?: unknown[];
  };
  math_metadata?: MathExerciseMetadata | null;
  english_metadata?: EnglishExerciseMetadata | null;
  science_metadata?: ScienceExerciseMetadata | null;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'tutor' | 'system' | 'student';
  content: string;
  type?: 'success' | 'error' | 'dialogue';
}

// ---------------------------------------------------------------------------
// Tutor Engine
// ---------------------------------------------------------------------------

export interface SubPartResult {
  label: string;
  is_correct: boolean;
  outcome?: 'correct' | 'incorrect' | 'pending' | 'unanswered' | 'dismissed';
  student_answer?: string;
  correct_answer?: string;
  marks?: number;
  score?: number;
  max_score?: number;
  error_type?: string | null;
  feedback?: string | null;
  next_step?: string | null;
}

export interface TutorMarkResponse {
  quest_award?: QuestAward;
  is_correct: boolean;
  outcome?: 'correct' | 'incorrect' | 'pending' | 'unanswered' | 'dismissed';
  attempt_id?: string;
  feedback: string;
  score?: number;
  max_score?: number;
  question_type?: string;
  key_points_met?: string[];
  key_points_missed?: string[];
  key_points?: KeyPointResult[];
  error_type?: string | null;
  retryable?: boolean;
  error_pattern?: string | null;
  deterministic?: boolean;
  misconception_id?: string | null;
  misconception_name?: string | null;
  misconception_explanation?: string | null;
  next_step?: string | null;
  new_misconception?: { name: string; description: string; student_facing_explanation: string } | null;
  part_results?: SubPartResult[];
  review_resolution_eligible?: boolean;
  review_match?: ErrorBookVariationMatch | null;
  /** Sent only after a final miss: "I don't know", or a last try with `reveal_answer`. */
  correct_answer?: string;
  /** The question's own worked steps. Sent only with `correct_answer`. */
  solution_steps?: string[];
}

export interface KeyPointResult {
  text: string;
  met: boolean;
  why_missed?: string | null;
  how_to_fix?: string | null;
}

export interface TutorExplainResponse {
  explanation?: string;
  has_lesson_content?: boolean;
  core_rule?: string;
  lesson_content?: LessonContent;
}

export interface LessonContent {
  learning_objectives?: string[];
  explanation_sections?: LessonSection[];
  key_vocabulary?: { term: string; definition: string }[];
  common_mistakes?: string[];
  real_world_connections?: string[];
  additional_worked_examples?: WorkedExampleStep[];
  guided_practice?: WorkedExampleStep[];
  independent_practice?: WorkedExampleStep[];
  success_criteria?: string[];
}

export interface LessonSection {
  type: 'example' | 'warning' | 'connection' | 'method' | 'concept' | string;
  heading: string;
  body: string;
  diagram?: Record<string, unknown> | null;
}

export interface WorkedExampleStep {
  step?: number;
  instruction?: string;
  result?: string;
  question?: string;
  answer?: string;
  steps?: { step: number; instruction: string; result: string }[];
}

export interface ErrorBookVariationMatch {
  eligible: boolean;
  score?: number;
  reasons?: string[];
  blockers?: string[];
  source_question_id?: string | null;
  candidate_question_id?: string | null;
  same_primary_topic?: boolean;
  misconception_or_skill_match?: boolean;
  not_materially_easier?: boolean;
  unseen?: boolean;
}

export interface TutorSuggestResponse {
  question: Exercise | null;
  total?: number;
  all_seen?: boolean;
  variation_match?: ErrorBookVariationMatch | null;
}

export interface TutorDialogueResponse {
  tutor_message: string;
  suggested_actions?: string[];
  dialogue_session_id?: string | null;
}

// ---------------------------------------------------------------------------
// Student Progress
// ---------------------------------------------------------------------------

export interface TopicProgress {
  topic: string;
  bkt_mastery: number | null;
  independent_bkt_mastery?: number | null;
  accuracy: number | null;
  attempts_count: number;
  top_errors: Record<string, number>;
  top_misconceptions?: Record<string, number>;
  strand?: string;
  status?: 'not_started' | 'emerging' | 'developing' | 'promising' | 'mastered';
  mastery_label?: string;
  evidence_count?: number;
  supported_evidence_count?: number;
  independent_evidence_count?: number;
  independent_accuracy?: number | null;
  scored_evidence_count?: number;
  scored_attempt_keys?: string[];
  direct_attempts_count?: number;
  diagnostic_attempts_count?: number;
  confidence?: 'none' | 'low' | 'medium' | 'high';
  diagnostic_evidence?: {
    direct_questions?: number;
    inferred_from_strand?: boolean;
    strand?: string;
    confidence?: 'none' | 'low' | 'medium' | 'high' | string;
  } | null;
  last_attempt_at?: string | null;
}

export interface ProgressSummary {
  topics: TopicProgress[];
  total_direct_attempts: number;
}

export interface DailySummary {
  scope?: 'all_subjects';
  date?: string;
  today_attempts: number;
  today_correct?: number;
  daily_goal: number;
  streak_days?: number;
  streak_message?: string;
  goal_met?: boolean;
  goal_progress?: number;
  today_accuracy?: number;
  today_independent_attempts?: number;
  today_independent_correct?: number;
  today_independent_accuracy?: number | null;
  activity_dates?: { date: string; active: boolean; frozen?: boolean }[];
  streak_freeze_applied?: boolean;
  freeze_tokens?: number;
  quest_stars?: number;
  quest_level?: number;
  quest_daily_stars?: number;
  quest_daily_cap?: number;
  quest_enabled?: boolean;
}

export interface WeeklyTopicEvidence {
  attempts: number;
  correct: number;
  incorrect: number;
  independent_attempts: number;
  first_independent_correct: number;
  supported_correct: number;
}

export interface WeeklySubjectEvidence extends WeeklyTopicEvidence {
  topics: Record<string, WeeklyTopicEvidence>;
}

export interface WeeklyLearningSummary {
  scope: 'all_subjects';
  days: number;
  window_start: string;
  window_end: string;
  attempts: number;
  activity_days: number;
  independent_correct: number;
  first_independent_correct: number;
  supported_correct: number;
  revision_attempts: number;
  mistake_closures: number;
  self_explanations: number;
  confidence_judgements: number;
  confidence_counts: { guess: number; maybe: number; sure: number };
  high_confidence_errors: number;
  low_confidence_correct: number;
  active_minutes_estimate: number;
  activity_window_count: number;
  independent_secured_per_10_active_minutes: number | null;
  time_basis: 'active_timestamp_windows';
  time_basis_note: string;
  subject_breakdown: Record<string, WeeklySubjectEvidence>;
  next_action: string;
}

export type WeeklyReportEvidenceStatus = 'none' | 'limited' | 'sufficient';

export interface StudentWeeklyReflection {
  proud_of: string;
  challenge: string;
  next_week_intention: string;
  updated_at: string;
}

export interface WeeklyTopicDetail {
  code: string;
  title: string;
  description: string;
  key_idea?: string;
  success_criteria?: string[];
}

export interface WeeklyTopicInsight {
  topic: string;
  message: string;
  topic_detail?: WeeklyTopicDetail | null;
}

export interface WeeklyTopicActivity {
  topic: string;
  title: string;
  attempts: number;
  correct: number;
  incorrect: number;
  first_independent_correct: number;
  supported_correct: number;
}

export interface WeeklyReportSubjectInsight {
  subject: string;
  subject_label: string;
  attempts: number;
  correct: number;
  accuracy: number | null;
  first_independent_correct: number;
  supported_correct: number;
  topics_touched?: number;
  topics_with_repeated_evidence?: number;
  topic_overview?: WeeklyTopicActivity[];
  additional_topic_count?: number;
  evidence_status: WeeklyReportEvidenceStatus;
  highlight: WeeklyTopicInsight | null;
  focus: WeeklyTopicInsight | null;
}

export interface StudentWeeklyReport {
  report_version: number;
  scope: 'all_subjects';
  calendar_basis: 'monday_sunday';
  timezone: 'Australia/Brisbane';
  week_start: string;
  week_end: string;
  is_current_week: boolean;
  period_status: 'in_progress' | 'complete';
  generated_at: string;
  history_week_starts: string[];
  evidence_status: WeeklyReportEvidenceStatus;
  activity_summary?: {
    attempts: number;
    active_days: number;
    subject_count: number;
    topic_count: number;
    repeated_topic_count: number;
    incorrect_answers: number;
    message: string;
    basis_note: string;
  };
  summary: WeeklyLearningSummary;
  weekly_highlight: string;
  weekly_highlight_detail?: WeeklyTopicDetail | null;
  focus_message: string;
  focus_detail?: WeeklyTopicDetail | null;
  next_week_goal: {
    kind?: 'practice' | 'check' | 'review' | 'reflect';
    title: string;
    action: string;
    subject: string | null;
    topic: string | null;
    topic_detail?: WeeklyTopicDetail | null;
    practice_count?: number;
    success_criteria?: string;
    help_guidance?: string;
    cta_label?: string;
    href?: string;
  };
  subject_reports: WeeklyReportSubjectInsight[];
  comparison: {
    available: boolean;
    previous_week_start: string;
    attempts_delta: number;
    first_independent_correct_delta: number;
    message: string;
  };
  reflection: StudentWeeklyReflection | null;
  evidence_note: string;
}

export type TodayStudyTaskKind = 'diagnostic' | 'revision' | 'mistake' | 'focus' | 'exit' | 'extra' | 'mixed';

export interface TodayReviewTopicProgress {
  topic_id: string;
  answered: number;
  done: boolean;
}

export interface TodayStudyTask {
  id: string;
  kind: TodayStudyTaskKind;
  title: string;
  reason: string;
  estimated_minutes: number;
  /** Time still expected for this step; 0 when the step is done. */
  remaining_minutes: number;
  /** Most questions the step can ask (0 for a reflection step). Steps can stop earlier on evidence. */
  question_target: number;
  question_completed: number;
  independent_correct_count?: number;
  supported_progress?: boolean;
  independent_secured?: boolean;
  topic_ids?: string[];
  /** Curriculum names aligned with `topic_ids`; an unknown topic falls back to its ID. */
  topic_names?: string[];
  practice_mode?: 'guided' | 'independent';
  /** Review step: progress of each topic. A topic is done after one unaided right answer or two answers. */
  topic_progress?: TodayReviewTopicProgress[];
  /** New-topic step: show the short lesson before the first question. */
  learn_step?: boolean;
  /** New-topic step: the topic's "I can" statement. */
  success_criterion?: string | null;
  completed: boolean;
  href: string;
  topic_id?: string | null;
  question_id?: string | null;
  closure_stage?: MistakeClosureStage;
  consolidation_due_at?: string | null;
  /** Final check: closed until the other steps are done. */
  locked?: boolean;
  /** New-topic and one-more-topic steps: every topic of the scope, until the first answer. */
  topic_options?: TodayStudyTask[];
  /** Topic option: the topic the plan suggests. */
  recommended?: boolean;
  /** Topic option: the topic is mastered already. */
  mastered?: boolean;
  /** Topic option: prerequisites in this year or unit that are not learned yet. */
  missing_prerequisites?: string[];
  missing_prerequisite_names?: string[];
}

export interface TodayStudyPlan {
  session_id: string;
  date: string;
  subject: string;
  scope: string;
  /** The day's "I can" goal: the new topic's success criterion. */
  goal?: string | null;
  estimated_minutes: number;
  remaining_minutes: number;
  question_completed: number;
  completed_tasks: number;
  total_tasks: number;
  complete: boolean;
  independent_secured: boolean;
  /** Earliest upcoming topic review or mistake check in this scope. */
  next_review_at?: string | null;
  next_task_id?: string | null;
  next_href?: string | null;
  tasks: TodayStudyTask[];
  /** Optional steps after the day is done: one more topic, then mixed practice. */
  more_practice?: TodayStudyTask[];
}

// ---------------------------------------------------------------------------
// Quests / Stars (game motivation)
// ---------------------------------------------------------------------------

export interface QuestAward {
  awarded: number;
  raw_stars?: number;
  stars: number;
  xp?: number;
  level: number;
  title?: string;
  daily_earned?: number;
  daily_cap?: number;
  skipped?: string;
}

export interface QuestItem {
  id: string;
  title: string;
  emoji: string;
  reward_stars: number;
  description: string;
  progress: number;
  complete: boolean;
  claimed: boolean;
  claimable: boolean;
  /** Keep-streak only: day inside biweekly reward ladder (1..14). */
  streak_cycle_day?: number;
  streak_cycle_len?: number;
}

export interface QuestCatalogItem {
  id: string;
  title: string;
  emoji: string;
  cost_stars: number;
  category: string;
  stock?: number | null;
  enabled?: boolean;
  description?: string;
}

export interface QuestLedgerEntry {
  id: string;
  delta: number;
  reason: string;
  meta?: Record<string, unknown>;
  day?: string;
  at?: string;
}

export interface QuestSpinPrize {
  chance: number;
  stars: number;
  label: string;
  emoji: string;
}

export interface QuestSpinStatus {
  enabled: boolean;
  cost_stars: number;
  max_per_day: number;
  spins_used: number;
  spins_remaining: number;
  can_spin: boolean;
  prizes: QuestSpinPrize[];
}

export interface QuestSpinResult {
  ok: true;
  prize: QuestSpinPrize & {
    index: number;
    won: boolean;
  };
  cost_stars: number;
  net_stars: number;
  stars: number;
  level: number;
  spins_used: number;
  spins_remaining: number;
  max_per_day: number;
}

export interface QuestsOverview {
  enabled: boolean;
  stars: number;
  xp: number;
  level: number;
  title: string;
  xp_to_next: number;
  xp_progress: number;
  freeze_tokens: number;
  chests: number;
  /** Unopened cash grand prize chests (28-day + high avg → $100 for parent). */
  grand_prize_chests?: number;
  cash_prize?: {
    need_streak: number;
    need_avg: number;
    prize_dollars: number;
    streak_days: number;
    avg_stars: number;
    eligible: boolean;
    already_awarded: boolean;
    progress_streak: number;
    progress_avg: number;
  };
  chests_enabled: boolean;
  shop_enabled: boolean;
  daily_star_cap: number;
  daily_stars_earned: number;
  streak_days: number;
  /** Day 1–14 on the keep-streak reward ladder (wraps every 2 weeks). */
  streak_reward_cycle_day?: number;
  streak_reward_cycle_days?: number;
  /** Stars awarded if keep-streak is claimed today. */
  streak_reward_stars?: number;
  streak_reward_max?: number;
  freeze_applied_today?: boolean;
  today_attempts: number;
  today_correct: number;
  daily_goal: number;
  quests: QuestItem[];
  catalog: QuestCatalogItem[];
  pending_redemptions: number;
  ledger: QuestLedgerEntry[];
  spin: QuestSpinStatus;
  currency_name: string;
  currency_emoji: string;
}

export interface Recommendation {
  recommendation_type: 'diagnostic_prompt' | 'revision' | string;
  topic_id?: string;
  topic?: string;
  name?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Worked Examples & Misconceptions
// ---------------------------------------------------------------------------

export interface WorkedExample {
  has_worked_example: boolean;
  worked_example?: WorkedExampleData;
  core_rule?: string;
}

export interface WorkedExampleData {
  question: string;
  steps: { step: number; instruction: string; result: string }[];
  answer: string;
  explanation?: string;
}

export interface Misconception {
  misconception_id: string;
  name: string;
  student_facing_explanation: string;
  topic_id?: string;
}

export interface WorkedExampleEntry {
  name: string;
  steps: { step_number: number; prose: string; math_latex?: string }[];
  targets_misconception_ids?: string[];
}

// ---------------------------------------------------------------------------
// Study Plan
// ---------------------------------------------------------------------------

export interface StudyPlan {
  action: 'concept_reteach' | 'drill_practice' | 'daily_practice' | 'weekly_revision' | 'maintenance' | 'assessment' | string;
  message: string;
  trigger?: string;
  bkt_mastery?: number | null;
  established_mastery?: number | null;
  independent_bkt_mastery?: number | null;
  independent_established_mastery?: number | null;
  evidence_count?: number;
  supported_evidence_count?: number;
  confidence?: 'none' | 'low' | 'medium' | 'high';
  status?: 'not_started' | 'emerging' | 'developing' | 'promising' | 'mastered';
}

// ---------------------------------------------------------------------------
// Mock Exam
// ---------------------------------------------------------------------------

export interface ExamQuestion {
  id: string;
  question: string;
  question_type: 'short_answer' | 'multiple_choice' | 'reasoning' | 'multi_part';
  difficulty: string;
  complexity: string | null;
  topic_ids: string[];
  choices?: string[];
  rubric?: { max_score: number };
  sub_parts?: SubPart[];
  diagram_data?: Record<string, unknown> | null;
  image?: string;
  challenge_strategy?: string;
  strategy_prompt?: string;
  post_challenge_reflection_prompt?: string;
  is_extension?: boolean;
}

export interface ExamStartResponse {
  exam_id: string;
  questions: ExamQuestion[];
  time_limit_minutes: number;
  total_questions?: number;
  requested_questions?: number;
  responses?: Record<string, string>;
  resumed?: boolean;
  started_at?: string;
  deadline_at?: string;
  current_index?: number;
  flagged?: string[];
  save_revision?: number;
  error?: string;
  message?: string;
  exam_type?: string;
  warning?: {
    code: string;
    message: string;
    requested_exam_type?: string;
    fallback_exam_type?: string;
  } | null;
}

export interface ExamResult {
  error?: string;
  message?: string;
  exam_id: string;
  total_questions: number;
  correct: number;
  percentage: number;
  total_score?: number;
  total_max_score?: number;
  pending_count?: number;
  scored_questions?: number;
  provisional?: boolean;
  grading_status?: 'complete' | 'complete_with_pending' | 'pending' | 'timed_out' | string;
  grading_timed_out?: boolean;
  grading_warning?: string | null;
  submitted_late?: boolean;
  strand_breakdown: StrandBreakdown[];
  weak_topics: string[];
  /** Topic ID → curriculum name. Older results do not have it. */
  topic_names?: Record<string, string>;
  results_per_question: ExamResultItem[];
  time_limit_minutes: number;
  deadline_at?: string;
}

export interface StrandBreakdown {
  strand: string;
  correct: number;
  total: number;
  percentage: number;
}

export interface ExamResultItem {
  question_id: string;
  question: string;
  correct_answer: string;
  student_answer: string;
  is_correct: boolean;
  difficulty: string;
  score?: number;
  max_score?: number;
  part_results?: SubPartResult[];
  requires_review?: boolean;
  feedback?: string;
  /** Answer-free question as the student saw it. Sent only in the submit response. */
  question_view?: ExamQuestion;
  /** Worked steps. Sent only after submission. */
  solution_steps?: string[];
  /** The student left this question blank: 0 marks, but not an Error Book mistake. */
  unanswered?: boolean;
}

export interface ExamHistoryItem {
  exam_id?: string;
  subject?: string;
  year_level?: number | null;
  unit?: number | null;
  syllabus_subject?: string | null;
  exam_type?: string;
  provisional?: boolean;
  started_at: string;
  completed_at?: string;
  correct: number;
  total_questions: number;
  percentage: number;
  time_limit_minutes?: number;
}

/** Summary of an unsubmitted exam from GET /api/exam/active. */
export interface ExamActiveSession {
  exam_id: string;
  started_at: string;
  deadline_at: string;
  /** Server-side time left at the time of the request. */
  remaining_seconds: number;
  time_limit_minutes: number;
  total_questions: number;
  answered_count: number;
  exam_type?: string;
  imported_from?: string | null;
}

export type ExamReviewMode = 'collapsed' | 'expanded';

// ---------------------------------------------------------------------------
// Challenge / Speed Round
// ---------------------------------------------------------------------------

export interface ChallengeStartResponse {
  session_id?: string;
  questions: ExamQuestion[];
  time_limit_seconds: number;
  total?: number;
  challenge_mode?: boolean;
  strategy_counts?: Record<string, number>;
  error?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Diagnostic
// ---------------------------------------------------------------------------

export interface DiagnosticQuestion {
  id: string;
  question: string;
  question_type?: 'short_answer' | 'multiple_choice' | 'reasoning' | 'multi_part';
  topic_ids?: string[];
  subject?: Subject;
  difficulty?: string;
  complexity?: Exercise['complexity'];
  choices?: string[];
  sub_parts?: SubPart[];
  passage?: string | null;
  resolved_passage?: string | null;
  diagram_data?: Record<string, unknown> | null;
  image?: string;
  math_metadata?: MathExerciseMetadata | null;
  english_metadata?: EnglishExerciseMetadata | null;
  science_metadata?: ScienceExerciseMetadata | null;
}

export interface DiagnosticProgress {
  current: number;
  total: number;
  area_current?: number;
  area_total?: number;
}

export interface DiagnosticCoverage {
  reduced: boolean;
  available_difficulty_bands: string[];
  missing_difficulty_bands: string[];
  message?: string | null;
  subject: string;
  area_count?: number;
  estimated_questions?: number;
}

export type DiagnosticBand = 'secure' | 'building' | 'start_here';

/** One reported curriculum area (a strand; Science Understanding is split). */
export interface DiagnosticArea {
  band: DiagnosticBand;
  ability: number;
  questions: number;
  correct: number;
  /** "I haven't learned this yet" answers; counted in questions, not in correct. */
  not_learned?: number;
  start_topic: string | null;
  confident_errors: string[];
  misconception_notes: string[];
  previous_band?: DiagnosticBand | null;
  prior_year_check?: { year: number; topic_id: string; correct: boolean };
}

export interface DiagnosticStartResponse {
  report_id: string;
  question: DiagnosticQuestion;
  progress: DiagnosticProgress;
  coverage?: DiagnosticCoverage;
  error?: string;
  message?: string;
}

export interface DiagnosticRespondResponse {
  question?: DiagnosticQuestion;
  progress?: DiagnosticProgress;
  completed: boolean;
  report_id?: string;
  areas?: Record<string, DiagnosticArea>;
  start_topics?: string[];
  area_scope?: string | null;
  is_correct?: boolean;
  response_outcome?: 'correct' | 'incorrect' | 'pending' | 'unanswered' | 'dismissed' | string;
  grading_deferred?: boolean;
  llm_adjudicated?: boolean;
  grading_warnings?: string[];
  valid_completion?: boolean;
  scored_responses?: number;
  unscored_responses?: number;
  coverage?: DiagnosticCoverage | null;
  retake_available?: boolean;
  next_eligible_at?: string | null;
  detail?: { message?: string };
  error?: string;
  message?: string;
}

export interface DiagnosticStatusResponse {
  completed: boolean;
  report_id?: string | null;
  completed_at?: string | null;
  in_progress?: boolean;
  current?: number;
  total?: number;
  started_at?: string | null;
  areas?: Record<string, DiagnosticArea>;
  start_topics?: string[];
  responses_count?: number;
  grading_warnings?: string[];
  valid_completion?: boolean | null;
  scored_responses?: number;
  unscored_responses?: number;
  coverage?: DiagnosticCoverage | null;
  retake_available?: boolean;
  next_eligible_at?: string | null;
}

export type MistakeClosureStage =
  | 'needs_understanding'
  | 'needs_retry'
  | 'needs_transfer'
  | 'needs_consolidation'
  | 'closed'
  | 'dismissed';

// ---------------------------------------------------------------------------
// Mistakes
// ---------------------------------------------------------------------------

export interface Mistake {
  question_id: string;
  attempt_id?: string | null;
  outcome?: 'incorrect';
  topic_id: string;
  subject?: Subject | string;
  year_level?: number | null;
  unit?: number | null;
  syllabus_subject?: string | null;
  source?: 'practice' | 'diagnostic' | string;
  status?: 'active' | 'resolved' | 'corrected' | 'dismissed' | 'fixed_by_later_correct' | string;
  resolved?: boolean;
  resolved_at?: string | null;
  review_count?: number;
  resolution_source?: 'demonstrated_correction' | 'manual_dismissal' | string | null;
  closure_stage?: MistakeClosureStage;
  error_cause?: string | null;
  cause_recorded_at?: string | null;
  self_explanation?: string | null;
  if_then_strategy?: string | null;
  retry_correct_at?: string | null;
  transfer_correct_at?: string | null;
  consolidation_due_at?: string | null;
  closed_at?: string | null;
  last_incorrect_at?: string;
  last_correct_after_error_at?: string | null;
  repeat_count?: number;
  recommended_review_action?: string;
  question: string;
  passage?: string | null;
  resolved_passage?: string | null;
  diagram_data?: Record<string, unknown> | null;
  image?: string | null;
  correct_answer: string;
  /** The question's own worked steps. */
  solution_steps?: string[];
  student_answer?: string;
  error_type: string | null;
  error_severity?: string | null;
  error_tip?: string | null;
  attempt_count?: number;
  misconception_id: string | null;
  misconception_name?: string | null;
  misconception_explanation?: string | null;
  worked_example_name?: string | null;
  worked_example_id?: string | null;
  timestamp: string;
  question_type: string;
  choices?: string[] | null;
  sub_parts?: SubPart[] | null;
}

export interface MistakeSummary {
  total: number;
  active: number;
  resolved: number;
  closed?: number;
  dismissed?: number;
  reviews: number;
  topic_counts: Record<string, number>;
  error_type_counts: Record<string, number>;
  topic_progress: Record<string, { total: number; overcome: number; reviews: number }>;
}

export interface MistakesResponse {
  mistakes: Mistake[];
  total: number;
  returned: number;
  offset: number;
  has_more: boolean;
  summary: MistakeSummary;
}

export interface ErrorTaxonomyEntry {
  code: string;
  label: string;
  description?: string | null;
  severity?: string | null;
  tip?: string | null;
}

export interface ErrorTaxonomyResponse {
  subject: string;
  error_types: ErrorTaxonomyEntry[];
}

export interface TrapNotebookWorkedExample {
  question: string;
  steps: string[];
  answer: string;
}

export interface TrapNotebookEntry {
  id: string;
  source: 'repeated_mistake' | 'spaced_revision' | string;
  topic_id: string;
  question_id?: string | null;
  question: string;
  key_rule: string;
  personal_trap: string;
  worked_example?: TrapNotebookWorkedExample | null;
  next_review_at: string;
  timestamp: string;
  attempt_count: number;
  error_type?: string | null;
  gap_classification?: Record<string, unknown> | null;
}

export interface TrapNotebookResponse {
  entries: TrapNotebookEntry[];
  total: number;
}

// ---------------------------------------------------------------------------
// PSMT
// ---------------------------------------------------------------------------

export interface PSMTResponse {
  feedback: string;
  structured_feedback?: PSMTStructuredFeedback;
  history_item?: PSMTHistoryItem | null;
  llm_status?: 'live' | 'mock' | 'unavailable';
}

export interface PSMTStructuredFeedback {
  mentor_feedback_markdown: string;
  criterion_scores: Record<string, number | null>;
  readiness_level: 'ready' | 'developing' | 'needs_attention' | string;
  top_gaps: string[];
  next_revision_actions: string[];
  safety_flags: string[];
}

export interface PSMTHistoryItem {
  timestamp: string;
  llm_status?: 'live';
  subject: string;
  section_name: string;
  draft_length: number;
  image_count: number;
  readiness_level: 'ready' | 'developing' | 'needs_attention' | string;
  criterion_scores?: Record<string, number | null>;
  top_gaps: string[];
  next_revision_actions: string[];
  safety_flags?: string[];
  feedback_excerpt: string;
}

export interface PSMTHistoryResponse {
  items: PSMTHistoryItem[];
  latest: PSMTHistoryItem | null;
  total: number;
}

// ---------------------------------------------------------------------------
// Imported exam papers
// ---------------------------------------------------------------------------

export interface ImportedPaper {
  filename: string;
  title: string;
  num_questions: number;
  time_limit_minutes: number;
}

export interface PersonalBest {
  correct: number;
  total: number;
  accuracy: number;
  timeLimit: number;
  date: string;
}

// ---------------------------------------------------------------------------
// Writing Assessment
// ---------------------------------------------------------------------------

export interface CriterionScore {
  criterion_number: number;
  domain: 'Authorial' | 'Language' | 'ISMG' | 'TEEL' | 'Informative' | 'Ideas';
  name: string;
  score: number;
  max_score: number;
  feedback: string;
  /** Quotes in `feedback` that the server did not find in the draft or task texts. */
  unverified_quotes?: string[];
}

export interface WritingHighlight {
  criterion_number: number;
  text_snippet: string;
  start_index: number;
  end_index: number;
  issue_type: string;
  suggestion: string;
}

export interface CognitiveVerbScore {
  verb: string;
  score: number;
  feedback: string;
  criterion_numbers?: number[];
}

export interface NextLearningStep {
  priority_goal: string;
  why_it_matters: string;
  recommendation: string;
}

export interface RevisionPlanItem {
  priority: number;
  target: string;
  why: string;
  how: string;
  example_revision?: string | null;
  success_criteria?: string[];
}

export interface SourceUseFeedback {
  uses_source_evidence: boolean;
  best_evidence_used?: string;
  missing_or_misread_evidence?: string;
  quote_integration_tip?: string;
}

export interface WritingSkillDrill {
  criterion_number: number;
  skill: string;
  drill_prompt: string;
  practice_tip: string;
}

export interface WritingTopicContextPayload {
  topic_title?: string;
  context?: string;
  target_audience?: string;
  mode?: string;
  prescribed_text?: string;
  task_conditions?: {
    label?: string;
    planningMinutes?: number;
    writingMinutes?: number;
    conditionsNote?: string;
  };
  official_source?: {
    label: string;
    url?: string;
    note?: string;
  };
  writing_tips?: string[];
  stimulus_text?: string;
  word_limit?: { min: number; max: number };
}

export interface ParagraphFeedback {
  strongest_paragraph?: string;
  paragraph_to_revise_first?: string;
  sentence_level_improvement?: string;
}

export interface WritingAssessmentResponse {
  timestamp?: string;
  revision_of?: string | null;
  assessment_request_id?: string;
  llm_status?: 'live' | 'mock' | 'external' | 'skipped';
  insufficient_evidence?: boolean;
  is_senior?: boolean;
  total_score: number;
  max_total_score: number;
  /** @deprecated Legacy field — no longer displayed to students */
  estimated_band?: number;
  portfolio_saved?: boolean | null;
  criterion_scores: CriterionScore[];
  highlights: WritingHighlight[];
  remediation_links: string[];
  overall_feedback: string;
  strengths: string[];
  next_learning_steps: NextLearningStep[];
  revision_plan?: RevisionPlanItem[];
  paragraph_feedback?: ParagraphFeedback | null;
  source_use_feedback?: SourceUseFeedback | null;
  writing_skill_drills?: WritingSkillDrill[];
  task_alignment_warnings?: string[];
  writer_statement_feedback?: string;
  cognitive_verb_scores?: CognitiveVerbScore[];
}

export interface WritingHistoryEntry {
  timestamp: string;
  insufficient_evidence?: boolean;
  year_level: number;
  prompt_type: 'persuasive' | 'narrative' | 'analytical' | 'expository';
  topic_id?: string | null;
  topic_title?: string | null;
  topic_description?: string | null;
  topic_prompt?: string | null;
  topic_source_text?: string | null;
  topic_word_limit?: { min: number; max: number } | null;
  topic_guiding_questions?: string[] | null;
  topic_think_about?: string[] | null;
  topic_writing_tips?: string[] | null;
  topic_target_audience?: string | null;
  topic_context?: string | null;
  topic_prescribed_text?: string | null;
  topic_mode?: string | null;
  topic_task_conditions?: {
    label?: string;
    planningMinutes?: number;
    writingMinutes?: number;
    conditionsNote?: string;
  } | null;
  topic_official_source?: {
    label: string;
    url?: string;
    note?: string;
  } | null;
  topic_rubric_profile?: string | null;
  word_count: number;
  total_score: number;
  max_total_score: number;
  estimated_band?: number;
  time_taken_seconds?: number;
  has_source_text: boolean;
  has_writer_statement: boolean;
  criterion_scores: CriterionScore[];
  remediation_links: string[];
  strengths: string[];
  next_learning_steps: NextLearningStep[];
  revision_plan?: RevisionPlanItem[];
  paragraph_feedback?: ParagraphFeedback | null;
  source_use_feedback?: SourceUseFeedback | null;
  writing_skill_drills?: WritingSkillDrill[];
  task_alignment_warnings?: string[];
  revision_of?: string | null;
}

export interface WritingHistoryResponse {
  student_id: string;
  assessments: WritingHistoryEntry[];
  total_assessments?: number;
  truncated?: boolean;
}

export interface ParentWritingHistoryEntry {
  timestamp: string;
  year_level: number;
  prompt_type: 'persuasive' | 'narrative' | 'analytical' | 'expository' | string;
  topic_title?: string | null;
  word_count: number;
  total_score: number;
  max_total_score: number;
  estimated_band?: number | null;
  time_taken_seconds?: number | null;
  has_source_text: boolean;
  has_writer_statement: boolean;
  criterion_scores?: Array<{
    criterion_number?: number;
    name?: string;
    score?: number;
    max_score?: number;
  }>;
  revision_of?: string | null;
  llm_status?: string | null;
  insufficient_evidence?: boolean;
  is_senior?: boolean;
}

export interface ParentWritingHistoryResponse {
  student_id: string;
  assessments: ParentWritingHistoryEntry[];
  total_assessments?: number;
  truncated?: boolean;
  scope?: {
    year_level?: number | null;
    unit?: number | null;
    syllabus_subject?: string | null;
  };
}

export interface WritingRevisionCompareResponse {
  original_timestamp: string;
  original_score: number | null;
  original_max_score: number | null;
  original_scored?: boolean;
  original_insufficient_evidence?: boolean;
  original_word_count: number;
  revised_word_count: number;
  word_count_change: number;
  new_vocabulary: string[];
  removed_vocabulary: string[];
  sentence_count: {
    original: number;
    revised: number;
  };
  paragraph_count: {
    original: number;
    revised: number;
  };
  original_criterion_scores: CriterionScore[];
  feedback: string;
}

export interface GrammarRemediationDrill {
  id?: string;
  question: string;
  topic_ids: string[];
  facet?: string;
  grammar_focus?: string | null;
}

export interface GrammarRemediationResponse {
  weakest_criterion: string | null;
  error_code: string | null;
  subtype_code: string | null;
  facet: string | null;
  drills: GrammarRemediationDrill[];
  revision_task: string;
  grammar_focus: string | null;
  writing_skill_drills?: WritingSkillDrill[];
}

// ---------------------------------------------------------------------------
// Bank review (dev-only)
// ---------------------------------------------------------------------------

export interface BankReviewStatus {
  enabled: boolean;
  auth?: string;
  message?: string | null;
}

export interface BankReviewImportResult {
  session_id: string;
  source_name: string;
  source_kind?: 'exam' | 'bank' | 'bank_file' | string;
  detected_format?: string;
  exam_filename?: string | null;
  bank_filename?: string | null;
  exam_meta?: {
    title?: string | null;
    time_limit_minutes?: number | null;
  };
  total: number;
  valid_for_append: number;
  with_errors: number;
  draft_status_count?: number;
  target_histogram: Record<string, number>;
}

export interface BankReviewExamPaper {
  filename: string;
  title: string;
  time_limit_minutes?: number | null;
  num_questions: number;
  error?: string;
}

export interface BankReviewTargetFile {
  file: string;
  path: string;
  count: number;
}

export interface BankReviewIndexItem {
  id: string | null;
  question_type: string;
  subject?: string | null;
  year_level?: number | null;
  unit?: number | null;
  difficulty?: string | null;
  diagram_type?: string | null;
  has_diagram: boolean;
  target_file?: string | null;
  target_error?: string | null;
  valid_for_append: boolean;
  issue_count: number;
  has_errors: boolean;
  reviewed: boolean;
  topic_ids?: string[];
}

export interface BankReviewSession {
  session_id: string;
  source_name: string;
  source_kind?: 'exam' | 'bank' | 'bank_file' | string;
  detected_format?: string;
  exam_filename?: string | null;
  bank_filename?: string | null;
  exam_meta?: {
    title?: string | null;
    time_limit_minutes?: number | null;
  };
  total: number;
  items: BankReviewIndexItem[];
}

export interface BankReviewIssue {
  severity: string;
  code: string;
  message: string;
}

export interface BankReviewItemPayload {
  index: number;
  total: number;
  meta: BankReviewIndexItem;
  exercise: Exercise & Record<string, unknown>;
  issues: BankReviewIssue[];
  valid_for_append: boolean;
}

export interface BankReviewWriteResult {
  ok: boolean;
  filename: string;
  path: string;
  num_items?: number;
  title?: string;
  time_limit_minutes?: number;
  num_questions?: number;
  /** Backward-compatible alias; true only when a backup was actually created. */
  backup: boolean;
  backup_requested: boolean;
  backup_created: boolean;
  backup_path: string | null;
  reload_succeeded?: boolean;
  reload?: Record<string, unknown>;
}

export interface BankReviewAppendReport {
  added_total: number;
  files: Array<{
    file: string;
    added: number;
    skipped_duplicate: string[];
    added_ids: string[];
  }>;
  skipped_duplicate: string[];
  blocked_invalid: string[];
  blocked_unmapped: string[];
  selected_count: number;
  reload?: Record<string, unknown>;
}
