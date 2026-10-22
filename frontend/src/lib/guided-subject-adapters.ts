import { Exercise } from './api-types';
import { getReasoningOutcome } from './reasoning-feedback';

export interface HelpChip {
  label: string;
  prompt: string;
  preAttemptMode?: 'concept' | 'first_step';
}

export interface ParentSummaryConfig {
  defaultStrengths: string[];
  defaultFocus: string;
  defaultActions: string[];
  whyItMatters: string;
}

export interface GuidedSubjectAdapter {
  subject: string;
  helpChips: HelpChip[];
  partialSuccessLabel: (score: number, maxScore: number, questionType?: string) => { label: string; tone: 'excellent' | 'strong' | 'developing' | 'needs_work' };
  advancedScore: (exercise: Exercise) => number;
  parentSummaryConfig: ParentSummaryConfig;
  studyCoachTip: string;
  facetDisplayName: (facetKey: string) => string;
}

const MATH_ADAPTER: GuidedSubjectAdapter = {
  subject: 'math',
  helpChips: [
    { label: '💡 Explain the idea', prompt: 'Explain the core mathematical concept behind this question without solving it.', preAttemptMode: 'concept' },
    { label: '🔍 What should I notice?', prompt: 'What details, constraints, or keywords should I notice before trying this question?', preAttemptMode: 'concept' },
    { label: '🪜 What is the first step?', prompt: 'What is only the first setup step I should take before I continue on my own?', preAttemptMode: 'first_step' },
    { label: '📝 Show a similar example', prompt: 'Show a similar example using different numbers, but stop before the final answer and do not solve this question.', preAttemptMode: 'concept' }
  ],
  partialSuccessLabel: (score: number, maxScore: number) => {
    return getReasoningOutcome(score, maxScore);
  },
  advancedScore: (ex: Exercise) => {
    let score = 0;
    if (ex.difficulty === 'AMC') score += 5;
    else if (ex.difficulty === 'extending') score += 4;
    if (ex.question_type === 'reasoning') score += 3;
    if (ex.question_type === 'multi_part') score += 2;
    if (ex.math_metadata?.calculator_allowed === false) score += 1;
    if (ex.math_metadata?.expected_working_steps?.length) score += 1;
    if (ex.complexity === 'complex_unfamiliar') score += 2;
    else if (ex.complexity === 'complex_familiar') score += 1;
    return score;
  },
  parentSummaryConfig: {
    defaultStrengths: [
      'Calculations were accurate in core steps.',
      'Identified prime factor trees correctly.',
      'Met reasoning rubrics on multi-step questions.'
    ],
    defaultFocus: 'Distinguishing common factors from multiples and verifying final units.',
    defaultActions: [
      'Ask your child to explain the difference between HCF and LCM aloud.',
      'Do 3 more developing questions before moving to extending ones.'
    ],
    whyItMatters: 'High-level maths marks often depend on explaining why a method works and keeping calculations organized, not just writing the final number.'
  },
  studyCoachTip: 'Take your time on reasoning questions. The tutor evaluates your steps, so type out why you chose your calculations!',
  facetDisplayName: (key: string) => {
    const map: Record<string, string> = {
      fluency: 'Calculation Fluency',
      conceptual_understanding: 'Conceptual Understanding',
      reasoning: 'Mathematical Reasoning',
      problem_solving: 'Problem Solving',
      independence: 'Learning Independence'
    };
    return map[key] || key;
  }
};

const ENGLISH_ADAPTER: GuidedSubjectAdapter = {
  subject: 'english',
  helpChips: [
    { label: '📖 Explain the question', prompt: 'What is the question asking me to do in this reading task without giving me the response?', preAttemptMode: 'concept' },
    { label: '🔍 Find evidence', prompt: 'What kind of evidence should I look for, without selecting the exact answer for me?', preAttemptMode: 'concept' },
    { label: '📝 Explain the grammar idea', prompt: 'Explain the grammar or literary term used in this question without answering it.', preAttemptMode: 'concept' },
    { label: '✍️ How can I improve my sentence?', prompt: 'What structure should a strong sentence response use here? Give a template, not the completed answer.', preAttemptMode: 'concept' }
  ],
  partialSuccessLabel: (score: number, maxScore: number) => {
    const pct = maxScore > 0 ? score / maxScore : 0;
    if (pct >= 1) return { label: 'Excellent response', tone: 'excellent' };
    if (pct >= 0.8) return { label: 'Strong response — add clearer evidence', tone: 'strong' };
    if (pct >= 0.5) return { label: 'Good idea — improve expression', tone: 'developing' };
    return { label: 'Needs another attempt', tone: 'needs_work' };
  },
  advancedScore: (ex: Exercise) => {
    let score = 0;
    if (ex.difficulty === 'extending') score += 5;
    if (ex.question_type === 'reasoning') score += 3;
    if (ex.question_type === 'multi_part') score += 3;
    if (ex.english_metadata?.facet === 'text_evidence') score += 2;
    if (ex.english_metadata?.facet === 'writing_structure') score += 1;
    if (ex.english_metadata?.facet === 'language_conventions') score += 1;
    if (ex.complexity === 'complex_unfamiliar') score += 2;
    return score;
  },
  parentSummaryConfig: {
    defaultStrengths: [
      'Used text evidence effectively.',
      'Structured grammar and spelling accurately.',
      'Understood inference and author tone.'
    ],
    defaultFocus: 'Quoting textual evidence directly and varying sentence starters.',
    defaultActions: [
      'Ask your child to highlight or underline the specific sentence that proves their answer.',
      'Have your child read their draft aloud to spot run-on sentences.'
    ],
    whyItMatters: 'English success relies on precision in text references and clear structure. Explaining how they found their answer builds strong analytical thinking.'
  },
  studyCoachTip: 'Focus on using clear text evidence. Identify exact sentences or words from the passage to justify your analysis!',
  facetDisplayName: (key: string) => {
    const map: Record<string, string> = {
      comprehension: 'Reading Comprehension',
      text_evidence: 'Text Evidence',
      language_conventions: 'Language Conventions',
      vocabulary: 'Vocabulary',
      writing_structure: 'Writing Structure',
      independence: 'Learning Independence'
    };
    return map[key] || key;
  }
};

const SCIENCE_ADAPTER: GuidedSubjectAdapter = {
  subject: 'science',
  helpChips: [
    { label: '🔬 Explain the concept', prompt: 'Explain the science concept behind this question without solving it.', preAttemptMode: 'concept' },
    { label: '📊 What evidence matters?', prompt: 'What observations, data, or evidence should I inspect before answering?', preAttemptMode: 'concept' },
    { label: '🧪 Identify variables', prompt: 'Help me identify what to look for when deciding the independent, dependent, and controlled variables.', preAttemptMode: 'concept' },
    { label: '🧠 CER structure', prompt: 'Help me structure a claim, evidence, and reasoning response without writing the answer for me.', preAttemptMode: 'concept' }
  ],
  partialSuccessLabel: (score: number, maxScore: number) => {
    const pct = maxScore > 0 ? score / maxScore : 0;
    if (pct >= 1) return { label: 'Accurate scientific response', tone: 'excellent' };
    if (pct >= 0.8) return { label: 'Strong science reasoning — add precision', tone: 'strong' };
    if (pct >= 0.5) return { label: 'Developing answer — strengthen evidence', tone: 'developing' };
    return { label: 'Needs another attempt', tone: 'needs_work' };
  },
  advancedScore: (ex: Exercise) => {
    let score = 0;
    if (ex.difficulty === 'extending') score += 4;
    if (ex.question_type === 'reasoning') score += 3;
    if (ex.question_type === 'multi_part') score += 2;
    if (ex.science_metadata?.science_inquiry_skill) score += 2;
    if (ex.science_metadata?.claim_evidence_reasoning) score += 2;
    if (ex.science_metadata?.data_representation === 'graph' || ex.science_metadata?.data_representation === 'table') score += 1;
    if (ex.complexity === 'complex_unfamiliar') score += 2;
    else if (ex.complexity === 'complex_familiar') score += 1;
    return score;
  },
  parentSummaryConfig: {
    defaultStrengths: [
      'Used scientific vocabulary accurately.',
      'Connected observations to evidence.',
      'Identified variables or patterns in data.'
    ],
    defaultFocus: 'Explaining the link between claim, evidence, and scientific reasoning.',
    defaultActions: [
      'Ask your child to state the claim, evidence, and reasoning in three separate sentences.',
      'Review any graph, table, or diagram and identify what it shows before answering.'
    ],
    whyItMatters: 'Science understanding grows when students connect concepts to evidence, investigations, and data rather than memorising isolated facts.'
  },
  studyCoachTip: 'Use evidence from data, observations, or diagrams, then explain why it supports your scientific claim.',
  facetDisplayName: (key: string) => {
    const map: Record<string, string> = {
      conceptual_knowledge: 'Conceptual Knowledge',
      inquiry_design: 'Inquiry Design',
      data_interpretation: 'Data Interpretation',
      scientific_reasoning: 'Scientific Reasoning',
      science_in_context: 'Science in Context',
      independence: 'Learning Independence',
      scientific_understanding: 'Conceptual Knowledge',
      science_inquiry_skill: 'Inquiry Design',
      science_as_human_endeavour: 'Science in Context',
      evidence_analysis: 'Scientific Reasoning',
      claim_evidence_reasoning: 'Claim, Evidence & Reasoning',
      data_representation: 'Data Interpretation',
      variables: 'Inquiry Variables'
    };
    return map[key] || key;
  }
};

const DEFAULT_ADAPTER: GuidedSubjectAdapter = {
  subject: 'default',
  helpChips: [
    { label: '💡 Explain the concept', prompt: 'Explain the core concept behind this question without solving it.', preAttemptMode: 'concept' },
    { label: '🪜 What is the first step?', prompt: 'What is only the first setup step to approach this question?', preAttemptMode: 'first_step' },
    { label: '📝 Show a similar example', prompt: 'Show me a similar example, but stop before the final answer.', preAttemptMode: 'concept' }
  ],
  partialSuccessLabel: (score: number, maxScore: number) => {
    const pct = maxScore > 0 ? score / maxScore : 0;
    if (pct >= 1) return { label: 'Correct!', tone: 'excellent' };
    if (pct >= 0.8) return { label: 'Very close!', tone: 'strong' };
    if (pct >= 0.5) return { label: 'Partially correct', tone: 'developing' };
    return { label: 'Needs another attempt', tone: 'needs_work' };
  },
  advancedScore: (ex: Exercise) => {
    let score = 0;
    if (ex.difficulty === 'extending' || ex.difficulty === 'AMC') score += 4;
    if (ex.question_type === 'reasoning' || ex.question_type === 'multi_part') score += 2;
    return score;
  },
  parentSummaryConfig: {
    defaultStrengths: [
      'Attempted all questions diligently.',
      'Used hints productively when stuck.'
    ],
    defaultFocus: 'Core vocabulary, reading constraints, and reviewing explanations.',
    defaultActions: [
      'Review the worked examples together before trying again.',
      'Ask your child to describe the main idea of the lesson in their own words.'
    ],
    whyItMatters: 'Self-learning requires balanced practice, vocabulary familiarity, and identifying patterns in mistakes to avoid repeating them.'
  },
  studyCoachTip: 'Take your time when answering. Use the Socratic hints if you get stuck, and try to explain your reasoning!',
  facetDisplayName: (key: string) => {
    const map: Record<string, string> = {
      // Science facets support
      scientific_understanding: 'Scientific Understanding',
      inquiry_skills: 'Inquiry Skills',
      evidence_analysis: 'Evidence & Analysis',
      // Default facets fallback
      fluency: 'Fluency',
      conceptual_understanding: 'Conceptual Understanding',
      reasoning: 'Reasoning',
      problem_solving: 'Problem Solving',
      independence: 'Learning Independence'
    };
    return map[key] || key;
  }
};

export function getSubjectAdapter(subject?: string): GuidedSubjectAdapter {
  if (!subject) return DEFAULT_ADAPTER;
  const s = subject.toLowerCase().trim();
  if (s === 'math' || s === 'mathematics') return MATH_ADAPTER;
  if (s === 'english') return ENGLISH_ADAPTER;
  if (s === 'science') return SCIENCE_ADAPTER;
  return DEFAULT_ADAPTER;
}
