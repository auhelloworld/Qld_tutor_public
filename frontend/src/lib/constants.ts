/**
 * Shared constants used across the frontend.
 *
 * Previously duplicated across TutorInterface, ExamPage, ChallengePage, etc.
 * Consolidated here per frontend review fix #1.
 */

// ---------------------------------------------------------------------------
// Math symbol toolbar — used in answer textareas across the app
// ---------------------------------------------------------------------------

export interface MathSymbol {
  label: string;
  value: string;
  description: string;
}

export const MATH_SYMBOLS: MathSymbol[] = [
  { label: '√', value: '√()', description: 'Square root' },
  { label: 'x²', value: '²', description: 'Square' },
  { label: 'xʸ', value: '^()', description: 'Exponent' },
  { label: 'a/b', value: '/', description: 'Fraction' },
  { label: '( )', value: '()', description: 'Parentheses' },
  { label: '|x|', value: '||', description: 'Absolute value' },
  { label: '×', value: '×', description: 'Multiplication' },
  { label: '÷', value: '÷', description: 'Division' },
  { label: '±', value: '±', description: 'Plus or minus' },
  { label: 'π', value: 'π', description: 'Pi' },
  { label: 'θ', value: 'θ', description: 'Theta' },
  { label: '°', value: '°', description: 'Degrees' },
  { label: '<', value: '<', description: 'Less than' },
  { label: '≤', value: '≤', description: 'Less than or equal' },
  { label: '>', value: '>', description: 'Greater than' },
  { label: '≥', value: '≥', description: 'Greater than or equal' },
  { label: '≠', value: '≠', description: 'Not equal' },
];

export const ADVANCED_MATH_SYMBOLS: MathSymbol[] = [
  { label: '∠', value: '∠', description: 'Angle' },
  { label: '≈', value: '≈', description: 'Approximately equal' },
  { label: '∞', value: '∞', description: 'Infinity' },
  { label: '∫', value: '∫', description: 'Integral' },
  { label: '∑', value: '∑', description: 'Summation' },
  { label: 'lim', value: 'lim()', description: 'Limit template' },
  { label: 'dy/dx', value: 'dy/dx', description: 'Derivative' },
  { label: 'sin', value: 'sin()', description: 'Sine template' },
  { label: 'cos', value: 'cos()', description: 'Cosine template' },
  { label: 'tan', value: 'tan()', description: 'Tangent template' },
  { label: 'log', value: 'log()', description: 'Logarithm template' },
  { label: 'ln', value: 'ln()', description: 'Natural logarithm template' },
  { label: 'Δ', value: 'Δ', description: 'Delta' },
  { label: 'α', value: 'α', description: 'Alpha' },
  { label: 'β', value: 'β', description: 'Beta' },
  { label: '→', value: '→', description: 'Vector or approaches arrow' },
  { label: '·', value: '·', description: 'Dot product' },
  { label: '∂', value: '∂', description: 'Partial derivative' },
  { label: '∇', value: '∇', description: 'Nabla' },
];

// ---------------------------------------------------------------------------
// Error type labels — synced with data/error_taxonomy.json
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Error type labels — synced with data/error_taxonomy*.json
// Math taxonomy is the default; English/Science to be populated later.
// ---------------------------------------------------------------------------

const MATH_ERROR_TYPE_LABELS: Record<string, string> = {
  calculation_error: 'Calculation error', sign_error: 'Sign error',
  order_of_ops: 'Order of operations', fraction_error: 'Fraction error',
  decimal_percentage_error: 'Decimal/percentage error', rounding_error: 'Rounding error',
  exponent_error: 'Exponent error', formula_misuse: 'Formula misuse',
  substitution_error: 'Substitution error', algebra_setup: 'Algebra setup',
  equation_solving_error: 'Equation solving', distribution_error: 'Distribution error',
  like_terms_error: 'Like terms error', scale_ratio_error: 'Scale/ratio error',
  unit_error: 'Unit error', measurement_dimension_error: 'Measurement dimension',
  geometry_reasoning_error: 'Geometry reasoning', graph_error: 'Graph/coordinate error',
  statistics_error: 'Statistics error', probability_error: 'Probability error',
  algorithmic_reasoning_error: 'Algorithmic reasoning', reading_comprehension: 'Reading comprehension',
  visual_misread: 'Visual misread', concept_gap: 'Concept gap',
  incomplete_answer: 'Incomplete answer', answer_format_error: 'Answer format',
  weak_text_evidence: 'Weak text evidence',
  inference_error: 'Inference error',
  grammar_convention: 'Grammar convention',
  vocabulary_precision: 'Vocabulary precision',
  punctuation: 'Punctuation',
  spelling: 'Spelling',
  expression_clarity: 'Expression clarity',
  concept_misunderstanding: 'Concept misunderstanding',
  evidence_mismatch: 'Evidence mismatch',
  variable_confusion: 'Variable confusion',
  data_interpretation: 'Data interpretation',
  scientific_vocabulary: 'Scientific vocabulary',
  claim_evidence_reasoning_gap: 'Claim-evidence-reasoning gap',
  safety_or_method_error: 'Safety or method error',
  grammar_syntax: 'Grammar and syntax',
  inferential_comprehension: 'Inferential comprehension',
  literal_comprehension: 'Literal comprehension',
  punctuation_mechanics: 'Punctuation mechanics',
  spelling_mechanics: 'Spelling mechanics',
  textual_analysis: 'Textual analysis',
  vocabulary_register: 'Vocabulary and register',
  writing_composition: 'Writing composition',
  // "I don't know" in Today practice: a miss with no answer.
  dont_know: 'Did not know yet',
};

export const ERROR_TYPE_LABELS: Record<string, string> = MATH_ERROR_TYPE_LABELS;

// ---------------------------------------------------------------------------
// Student reflection causes — shared by normal practice and the Error Book
// ---------------------------------------------------------------------------

export type ErrorCauseCode =
  | 'calculation_slip'
  | 'concept_gap'
  | 'problem_misreading'
  | 'logical_stuck'
  | 'vocabulary_gap'
  | 'text_misreading'
  | 'distractor_trap'
  | 'grammar_confusion'
  | 'expression_gap'
  | 'time_pressure'
  | 'random_guess'
  | 'other';

export interface ErrorCauseOption {
  value: ErrorCauseCode;
  label: string;
  shortLabel: string;
  emoji: string;
}

const COMMON_ERROR_CAUSES: ErrorCauseOption[] = [
  { value: 'random_guess', label: "Random Guess (I wasn't sure and chose randomly)", shortLabel: 'Guessed', emoji: '🎲' },
  { value: 'other', label: 'Other (none of these quite fits)', shortLabel: 'Other', emoji: '💭' },
];

const ERROR_CAUSE_OPTIONS_BY_SUBJECT: Record<'math' | 'english' | 'science', ErrorCauseOption[]> = {
  math: [
    { value: 'calculation_slip', label: 'Calculation Slip (I made a calculation or input typo)', shortLabel: 'Calculation slip', emoji: '✏️' },
    { value: 'concept_gap', label: "Concept/Formula Gap (I don't understand the concept or formula yet)", shortLabel: 'Concept unclear', emoji: '📐' },
    { value: 'problem_misreading', label: 'Problem Misreading (I misread constraints, numbers or units)', shortLabel: 'Misread the problem', emoji: '🔍' },
    { value: 'logical_stuck', label: 'Logical Stuck (I got stuck in the middle steps)', shortLabel: 'Stuck in the steps', emoji: '🧱' },
    ...COMMON_ERROR_CAUSES,
  ],
  english: [
    { value: 'vocabulary_gap', label: "Vocabulary or Spelling Gap (I didn't know the word or spelling rule)", shortLabel: 'Vocabulary/spelling gap', emoji: '📖' },
    { value: 'text_misreading', label: 'Text Misreading (I misread a detail or question keyword)', shortLabel: 'Misread the text', emoji: '🔍' },
    { value: 'distractor_trap', label: 'Distractor Trap (I fell for a misleading option)', shortLabel: 'Distractor trap', emoji: '🕳️' },
    { value: 'grammar_confusion', label: 'Rule Confusion (I confused grammar or punctuation rules)', shortLabel: 'Grammar/rule confusion', emoji: '❓' },
    { value: 'expression_gap', label: 'Expression Gap (I could not explain the idea clearly)', shortLabel: 'Could not explain clearly', emoji: '💬' },
    ...COMMON_ERROR_CAUSES,
  ],
  science: [
    { value: 'concept_gap', label: "Concept Gap (I don't understand the scientific idea yet)", shortLabel: 'Concept unclear', emoji: '🔬' },
    { value: 'problem_misreading', label: 'Question Misreading (I missed data, units or a condition)', shortLabel: 'Misread the question', emoji: '🔍' },
    { value: 'logical_stuck', label: 'Reasoning Stuck (I got stuck linking evidence to the answer)', shortLabel: 'Reasoning stuck', emoji: '🧱' },
    { value: 'expression_gap', label: 'Expression Gap (I could not explain the evidence clearly)', shortLabel: 'Could not explain clearly', emoji: '💬' },
    ...COMMON_ERROR_CAUSES,
  ],
};

export function getErrorCauseOptions(subject: string | null | undefined): ErrorCauseOption[] {
  const normalized = String(subject || '').toLowerCase();
  if (normalized.includes('english')) return ERROR_CAUSE_OPTIONS_BY_SUBJECT.english;
  if (normalized.includes('science')) return ERROR_CAUSE_OPTIONS_BY_SUBJECT.science;
  return ERROR_CAUSE_OPTIONS_BY_SUBJECT.math;
}
