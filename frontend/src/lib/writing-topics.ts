export interface WritingTaskConditions {
  label?: string;
  planningMinutes?: number;
  writingMinutes?: number;
  conditionsNote?: string;
}

export interface WritingOfficialSource {
  label: string;
  url?: string;
  note?: string;
}

export interface WritingTopic {
  id: string;
  type: 'persuasive' | 'narrative' | 'analytical' | 'expository';
  yearLevels: number[];
  category: string;
  title: string;
  description: string;
  prompt: string;
  stimulusText?: string;
  guidingQuestions?: string[];
  thinkAbout?: string[];
  context?: string;
  targetAudience?: string;
  prescribedText?: string;
  mode?: string;
  taskConditions?: WritingTaskConditions;
  officialSource?: WritingOfficialSource;
  rubricProfile?: 'naplan_style' | 'junior_curriculum' | 'senior_qcaa_general' | string;
  wordLimit?: { min: number; max: number };
  writingTips?: string[];
  difficulty?: 'Standard' | 'Advanced';
  status?: 'draft' | 'active';
  disabled?: boolean;
}

/** Shown with every senior task: the syllabus and cohort that the practice is modelled on. */
export const SENIOR_TASK_VERSION_NOTE =
  'Modelled on the QCAA 2025 senior English syllabuses (for students who finish Year 12 in 2026 or later). Practice task — not an official QCAA task.';

/** Prescribed text lists change between cohorts. */
export const PRESCRIBED_TEXT_LIST_NOTE =
  'Prescribed texts change between cohorts. Check the QCAA 2026–2029 prescribed text list and the texts your school registered.';

/** True when a senior task responds to a prescribed text (not an original unseen extract). */
export function usesPrescribedText(topic: Pick<WritingTopic, 'prescribedText' | 'stimulusText'>): boolean {
  return Boolean(topic.prescribedText && !topic.stimulusText);
}
