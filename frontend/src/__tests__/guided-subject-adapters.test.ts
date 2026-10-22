import { describe, it, expect } from 'vitest';
import { getSubjectAdapter } from '../lib/guided-subject-adapters';
import type { Exercise } from '../lib/api-types';

describe('Guided Subject Adapters & Reasoning Outcomes', () => {
  describe('Math Adapter', () => {
    const adapter = getSubjectAdapter('math');

    it('should return correct partial success labels for math reasoning', () => {
      expect(adapter.partialSuccessLabel(5, 5)).toEqual({ label: 'Full marks', tone: 'excellent' });
      expect(adapter.partialSuccessLabel(4, 5)).toEqual({ label: 'Strong answer — refine for full marks', tone: 'strong' });
      expect(adapter.partialSuccessLabel(3, 5)).toEqual({ label: 'Partly correct — revise the missing reasoning', tone: 'developing' });
      expect(adapter.partialSuccessLabel(2, 5)).toEqual({ label: 'Needs another attempt', tone: 'needs_work' });
      expect(adapter.partialSuccessLabel(0, 5)).toEqual({ label: 'Needs another attempt', tone: 'needs_work' });
    });

    it('should compute correct advanced score', () => {
      const easyEx: Exercise = {
        id: '1',
        topic: 'AC9M7N02',
        difficulty: 'developing',
        question_type: 'short_answer',
        complexity: 'simple_familiar',
        question: 'Solve',
        answer: '2',
        framework: 'AC9_MATHS',
        topic_ids: ['AC9M7N02']
      };

      const hardReasoningEx: Exercise = {
        id: '2',
        topic: 'AC9M7N02',
        difficulty: 'extending',
        question_type: 'reasoning',
        complexity: 'complex_unfamiliar',
        question: 'Explain why...',
        answer: 'Because...',
        framework: 'AC9_MATHS',
        topic_ids: ['AC9M7N02']
      };

      expect(adapter.advancedScore(easyEx)).toBe(0);
      // extending (+4), reasoning (+3), complex_unfamiliar (+2) = 9
      expect(adapter.advancedScore(hardReasoningEx)).toBe(9);
    });

    it('rewards optional math metadata without requiring it', () => {
      const metadataEx: Exercise = {
        id: '3',
        topic: 'AC9M7N02',
        difficulty: 'developing',
        question_type: 'reasoning',
        complexity: 'complex_familiar',
        question: 'Explain your method.',
        answer: 'Use inverse operations.',
        framework: 'AC9_MATHS',
        topic_ids: ['AC9M7N02'],
        math_metadata: {
          calculator_allowed: false,
          expected_working_steps: ['Set up equation', 'Solve', 'Check'],
        },
      };

      // reasoning (+3), no calculator (+1), working steps (+1), complex_familiar (+1) = 6
      expect(adapter.advancedScore(metadataEx)).toBe(6);
    });
  });

  describe('English Adapter', () => {
    const adapter = getSubjectAdapter('english');

    it('should return correct partial success labels for english reasoning', () => {
      expect(adapter.partialSuccessLabel(5, 5)).toEqual({ label: 'Excellent response', tone: 'excellent' });
      expect(adapter.partialSuccessLabel(4, 5)).toEqual({ label: 'Strong response — add clearer evidence', tone: 'strong' });
      expect(adapter.partialSuccessLabel(3, 5)).toEqual({ label: 'Good idea — improve expression', tone: 'developing' });
      expect(adapter.partialSuccessLabel(2, 5)).toEqual({ label: 'Needs another attempt', tone: 'needs_work' });
      expect(adapter.partialSuccessLabel(0, 3)).toEqual({ label: 'Needs another attempt', tone: 'needs_work' });
    });

    it('should compute correct advanced score for english', () => {
      const easyEx: Exercise = {
        id: '1',
        topic: 'vocab',
        difficulty: 'developing',
        question_type: 'short_answer',
        complexity: 'simple_familiar',
        question: 'Define',
        answer: 'run',
        framework: 'AC9_ENGLISH',
        topic_ids: ['vocab']
      };

      const extendingReasoningEx: Exercise = {
        id: '2',
        topic: 'comprehension',
        difficulty: 'extending',
        question_type: 'reasoning',
        complexity: 'complex_unfamiliar',
        question: 'Analyze...',
        answer: 'Because...',
        framework: 'AC9_ENGLISH',
        topic_ids: ['comprehension']
      };

      expect(adapter.advancedScore(easyEx)).toBe(0);
      // extending (+5), reasoning (+3), complex_unfamiliar (+2) = 10
      expect(adapter.advancedScore(extendingReasoningEx)).toBe(10);
    });

    it('rewards text-evidence metadata for analytical English tasks', () => {
      const evidenceEx: Exercise = {
        id: '3',
        topic: 'comprehension',
        difficulty: 'extending',
        question_type: 'reasoning',
        complexity: 'complex_familiar',
        question: 'Use evidence to analyse the character.',
        answer: 'The quote shows...',
        framework: 'AC9_ENGLISH',
        topic_ids: ['comprehension'],
        english_metadata: { facet: 'text_evidence' },
      };

      // extending (+5), reasoning (+3), text_evidence (+2) = 10
      expect(adapter.advancedScore(evidenceEx)).toBe(10);
    });
  });

  describe('Science Adapter', () => {
    const adapter = getSubjectAdapter('science');

    it('should return correct partial success labels', () => {
      expect(adapter.partialSuccessLabel(5, 5)).toEqual({ label: 'Accurate scientific response', tone: 'excellent' });
      expect(adapter.partialSuccessLabel(4, 5)).toEqual({ label: 'Strong science reasoning — add precision', tone: 'strong' });
      expect(adapter.partialSuccessLabel(3, 5)).toEqual({ label: 'Developing answer — strengthen evidence', tone: 'developing' });
      expect(adapter.partialSuccessLabel(2, 5)).toEqual({ label: 'Needs another attempt', tone: 'needs_work' });
    });

    it('rewards science inquiry and CER metadata', () => {
      const scienceEx: Exercise = {
        id: 's1',
        topic: 'variables',
        difficulty: 'extending',
        question_type: 'reasoning',
        complexity: 'complex_unfamiliar',
        question: 'Explain whether the claim is supported by the data.',
        answer: 'The claim is supported because...',
        framework: 'AC9_SCIENCE',
        topic_ids: ['AC9S7I02'],
        science_metadata: {
          science_inquiry_skill: 'Processing data',
          claim_evidence_reasoning: true,
          data_representation: 'graph',
        },
      };

      // extending (+4), reasoning (+3), inquiry (+2), CER (+2), graph (+1), complex_unfamiliar (+2) = 14
      expect(adapter.advancedScore(scienceEx)).toBe(14);
      expect(adapter.facetDisplayName('claim_evidence_reasoning')).toBe('Claim, Evidence & Reasoning');
    });
  });

  describe('Adapter retrieval helper', () => {
    it('should resolve specific adapters and default fallback', () => {
      expect(getSubjectAdapter('math').subject).toBe('math');
      expect(getSubjectAdapter('MATHEMATICS').subject).toBe('math');
      expect(getSubjectAdapter('english').subject).toBe('english');
      expect(getSubjectAdapter('science').subject).toBe('science');
      expect(getSubjectAdapter(undefined).subject).toBe('default');
    });
  });
});
