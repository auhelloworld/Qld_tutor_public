import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MoreToolsPanel from '../components/MoreToolsPanel';
import ParentNextStepsCard from '../components/guided/ParentNextStepsCard';
import GuidedFeedbackCard from '../components/guided/GuidedFeedbackCard';
import GuidedHelpDrawer from '../components/guided/GuidedHelpDrawer';
import GuidedQuestionCard from '../components/guided/GuidedQuestionCard';
import GuidedPracticeShell from '../components/guided/GuidedPracticeShell';
import GuidedSessionSummary from '../components/guided/GuidedSessionSummary';
import DialoguePanel from '../components/tutor/DialoguePanel';
import { getSubjectAdapter } from '../lib/guided-subject-adapters';
import { describeHighAchieverSelection, getHighAchieverTopicCandidates, scoreHighAchieverExercise } from '../lib/high-achiever-selector';
import type { Exercise, TutorMarkResponse, WorkedExample } from '../lib/api-types';

Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
});

describe('Guided Practice - parent summary rendering', () => {
  it('does not turn an awaiting-review answer into a zero score', () => {
    render(
      <GuidedSessionSummary
        total={5}
        attempted={1}
        pendingReview={1}
        hintClicks={0}
        workedExamplesOpened={0}
      />
    );

    expect(screen.getByText('Review pending')).toBeTruthy();
    expect(screen.getByText(/1 awaiting parent review/i)).toBeTruthy();
    expect(screen.getByText(/Wait for the review result/i)).toBeTruthy();
    expect(screen.queryByText(/Homework complete/i)).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByText(/parent review pending/i)).toBeNull();
  });

  it('renders backend next-step data when available', () => {
    render(
      <ParentNextStepsCard
        score={2}
        total={5}
        hintClicks={1}
        workedExamplesOpened={0}
        topicName="Fallback Topic"
        config={getSubjectAdapter('math').parentSummaryConfig}
        subjectColor="#4f46e5"
        onContinue={() => {}}
        backendData={{
          headline: 'Core concept review recommended',
          what_went_well: ['Persisted through multiple attempts.'],
          main_difficulty: 'Gaps in topic-specific rules or definitions',
          why_it_matters: 'Concepts serve as building blocks.',
          next_practice_action: 'Review the concept card together.',
          suggested_duration_minutes: 15,
          weekly_coaching_plan: {
            focus: 'Strengthen factor reasoning this week.',
            student_actions: ['Redo two questions and check each step.'],
            parent_questions: ['What did you try first?'],
            review_topics: ['Prime factorisation, HCF and LCM'],
          },
          focus_area: { name: 'Prime factorisation, HCF and LCM' },
        }}
      />
    );

    expect(screen.getByText('Core concept review recommended')).toBeTruthy();
    expect(screen.getByText('Persisted through multiple attempts.')).toBeTruthy();
    expect(screen.getByText(/Prime factorisation, HCF and LCM/)).toBeTruthy();
    expect(screen.getByText(/Review the concept card together/)).toBeTruthy();
    expect(screen.getByText(/15 minutes today/)).toBeTruthy();
    expect(screen.getByText(/This week[’']s coaching plan/)).toBeTruthy();
    expect(screen.getByText(/Redo two questions and check each step/)).toBeTruthy();
  });

  it('frames tutor-support timing as an independence signal in summaries', () => {
    render(
      <ParentNextStepsCard
        score={3}
        total={5}
        hintClicks={2}
        hintsBeforeAttempt={1}
        hintsAfterAttempt={1}
        workedExamplesOpened={0}
        topicName="Number properties"
        config={getSubjectAdapter('math').parentSummaryConfig}
        subjectColor="#4f46e5"
        onContinue={() => {}}
      />
    );

    expect(screen.getByText(/Next goal: attempt one step before opening Concept/)).toBeTruthy();
  });

  it('uses worked-example activity in the parent strengths summary', () => {
    render(
      <ParentNextStepsCard
        score={2}
        total={5}
        hintClicks={0}
        workedExamplesOpened={2}
        topicName="Linear equations"
        config={getSubjectAdapter('math').parentSummaryConfig}
        subjectColor="#4f46e5"
      />
    );

    expect(screen.getByText(/Reviewed 2 worked examples to compare methods/i)).toBeTruthy();
  });
});

describe('Guided Practice - feedback rendering', () => {
  it('does not show plain Correct for threshold-correct partial reasoning', () => {
    const markResponse: TutorMarkResponse = {
      is_correct: true,
      question_type: 'reasoning',
      score: 4,
      max_score: 5,
      feedback: 'Good reasoning, but add the missing justification.',
      key_points_met: ['Correct method'],
      key_points_missed: ['Explain why the method works'],
      key_points: [
        { text: 'Method selection', met: true },
        {
          text: 'Justification and reasoning',
          met: false,
          why_missed: 'The response gives a result but does not justify why the method applies.',
          how_to_fix: 'What reason can you add to show why your conclusion follows?',
        },
      ],
    };

    render(
      <GuidedFeedbackCard
        markResponse={markResponse}
        onNext={() => {}}
        onExplainMyAnswer={() => {}}
        onTryAgain={() => {}}
        isLastQuestion={false}
        subjectColor="#4f46e5"
        partialSuccessLabel={getSubjectAdapter('math').partialSuccessLabel(4, 5, 'reasoning')}
      />
    );

    expect(screen.getByText('Strong answer — refine for full marks')).toBeTruthy();
    expect(screen.queryByText('Correct! Well Done.')).toBeNull();
    expect(screen.getByText(/Rubric Points: 4 \/ 5/)).toBeTruthy();
    expect(screen.getByText(/Still missing: 1 rubric point need more work/)).toBeTruthy();
    expect(screen.getByText('Method selection')).toBeTruthy();
    expect(screen.getByText('Justification and reasoning')).toBeTruthy();
    expect(screen.getByText('Achieved')).toBeTruthy();
    expect(screen.getByText('Needs work')).toBeTruthy();
    expect(screen.getByText(/does not justify why the method applies/i)).toBeTruthy();
    expect(screen.getByText(/What reason can you add/i)).toBeTruthy();
    expect(screen.queryByText(/Point 1 demonstrated/i)).toBeNull();
    expect(screen.queryByText(/Explain why the method works/)).toBeNull();
  });

  it('does not label a zero-score reasoning response as partly correct', () => {
    const markResponse: TutorMarkResponse = {
      is_correct: false,
      question_type: 'reasoning',
      score: 0,
      max_score: 3,
      feedback: 'Use evidence from the passage and explain how the language shows Elara is an outsider.',
      key_points_missed: ['Identify language features', 'Explain outsider identity', 'Use evidence'],
    };

    render(
      <GuidedFeedbackCard
        markResponse={markResponse}
        onNext={() => {}}
        onExplainMyAnswer={() => {}}
        onTryAgain={() => {}}
        isLastQuestion={false}
        subjectColor="#4f46e5"
        partialSuccessLabel={getSubjectAdapter('english').partialSuccessLabel(0, 3, 'reasoning')}
      />
    );

    expect(screen.getByText('Not quite right')).toBeTruthy();
    expect(screen.getByText(/Rubric Points: 0 \/ 3/)).toBeTruthy();
    expect(screen.queryByText(/Partly correct/i)).toBeNull();
    expect(screen.queryByText(/Your reasoning is developing/i)).toBeNull();
  });

  it('does not offer direct correct-answer reveal after an incorrect guided attempt', () => {
    const markResponse: TutorMarkResponse = {
      is_correct: false,
      question_type: 'short_answer',
      feedback: 'Check whether you used the highest common factor rather than a common multiple.',
      error_type: 'concept_gap',
    };
    const exercise: Exercise = {
      id: 'q1',
      topic: 'AC9M7N02',
      topic_ids: ['AC9M7N02'],
      question: 'Find the HCF of 18 and 24.',
      answer: '6',
      question_type: 'short_answer',
    };

    render(
      <GuidedFeedbackCard
        markResponse={markResponse}
        exercise={exercise}
        studentAnswer="12"
        onNext={() => {}}
        onExplainMyAnswer={() => {}}
        onTryAgain={() => {}}
        isLastQuestion={false}
        subjectColor="#4f46e5"
        partialSuccessLabel={{ label: 'Needs another attempt', tone: 'needs_work' }}
      />
    );

    expect(screen.queryByRole('button', { name: /show correct answer/i })).toBeNull();
    expect(screen.queryByText(/^Answer:/i)).toBeNull();
  });

  it('offers a human-review escalation for a deterministic incorrect verdict', () => {
    const markResponse: TutorMarkResponse = {
      is_correct: false,
      question_type: 'short_answer',
      feedback: 'Not quite — check your value.',
      error_type: 'incorrect_value',
      deterministic: true,
    };
    const exercise: Exercise = {
      id: 'q-det', topic: 'AC9M7N02', topic_ids: ['AC9M7N02'],
      question: 'Simplify 50% as a fraction.', answer: '1/2', question_type: 'short_answer',
    };
    render(
      <GuidedFeedbackCard
        markResponse={markResponse} exercise={exercise} studentAnswer="1/2"
        onNext={() => {}} onExplainMyAnswer={() => {}} onTryAgain={() => {}}
        isLastQuestion={false} subjectColor="#4f46e5"
        partialSuccessLabel={{ label: 'Needs another attempt', tone: 'needs_work' }}
      />
    );
    expect(screen.getByRole('button', { name: /request a review/i })).toBeTruthy();
  });

  it('shows a queued note (no button) when an answer is already pending review', () => {
    const markResponse: TutorMarkResponse = {
      is_correct: false,
      question_type: 'short_answer',
      feedback: 'Saved for review.',
      error_type: 'parent_review_pending',
    };
    const exercise: Exercise = {
      id: 'q-pend', topic: 'AC9E7LE02', topic_ids: ['AC9E7LE02'],
      question: 'Explain the effect of the metaphor.', answer: '...', question_type: 'short_answer',
    };
    render(
      <GuidedFeedbackCard
        markResponse={markResponse} exercise={exercise} studentAnswer="It builds tension."
        onNext={() => {}} onExplainMyAnswer={() => {}} onTryAgain={() => {}}
        isLastQuestion={false} subjectColor="#4f46e5"
        partialSuccessLabel={{ label: 'Needs another attempt', tone: 'needs_work' }}
      />
    );
    expect(screen.getByText(/Saved for parent review/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /request a review/i })).toBeNull();
  });

  it('renders parent_review_pending as a neutral awaiting-review state, not a wrong verdict', () => {
    const markResponse: TutorMarkResponse = {
      is_correct: false,
      question_type: 'short_answer',
      feedback: 'Saved for review.',
      error_type: 'parent_review_pending',
    };
    const exercise: Exercise = {
      id: 'q-pend2', topic: 'AC9E7LE02', topic_ids: ['AC9E7LE02'],
      question: 'Explain the effect of the metaphor.', answer: '...', question_type: 'short_answer',
    };
    render(
      <GuidedFeedbackCard
        markResponse={markResponse} exercise={exercise} studentAnswer="It builds tension."
        onNext={() => {}} onExplainMyAnswer={() => {}} onTryAgain={() => {}}
        isLastQuestion={false} subjectColor="#4f46e5"
        partialSuccessLabel={{ label: 'Needs another attempt', tone: 'needs_work' }}
      />
    );
    // Neutral header, never the red wrong banner.
    expect(screen.getByText(/Saved for review — not yet marked/i)).toBeTruthy();
    expect(screen.queryByText('Not quite right')).toBeNull();
    // No misconception/repair framing for a deferred-to-human answer.
    expect(screen.queryByText(/Pattern detected/i)).toBeNull();
    expect(screen.queryByText(/Repair this pattern/i)).toBeNull();
    // No "Try Again" (would imply a wrong verdict); offer a neutral next action.
    expect(screen.queryByRole('button', { name: /Try Again/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Get a hint/i })).toBeNull();
  });

  it('hides unverified rubric details while reasoning is pending review', () => {
    const markResponse: TutorMarkResponse = {
      is_correct: false,
      question_type: 'reasoning',
      outcome: 'pending',
      score: 0,
      max_score: 3,
      feedback: 'Saved for review.',
      error_type: 'parent_review_pending',
      key_points: [{ text: 'Unverified criterion text', met: false }],
    };

    render(
      <GuidedFeedbackCard
        markResponse={markResponse}
        onNext={() => {}}
        onExplainMyAnswer={() => {}}
        onTryAgain={() => {}}
        isLastQuestion={false}
        subjectColor="#4f46e5"
        partialSuccessLabel={{ label: 'Pending', tone: 'needs_work' }}
      />
    );

    expect(screen.getByText(/Saved for review — not yet marked/i)).toBeTruthy();
    expect(screen.queryByText(/Rubric Points:/i)).toBeNull();
    expect(screen.queryByText('Unverified criterion text')).toBeNull();
  });

  it('does not offer review escalation on a correct answer', () => {
    const markResponse: TutorMarkResponse = { is_correct: true, question_type: 'short_answer', feedback: 'Correct!' };
    const exercise: Exercise = {
      id: 'q-ok', topic: 'AC9M7N02', topic_ids: ['AC9M7N02'],
      question: '2+2?', answer: '4', question_type: 'short_answer',
    };
    render(
      <GuidedFeedbackCard
        markResponse={markResponse} exercise={exercise} studentAnswer="4"
        onNext={() => {}} onExplainMyAnswer={() => {}} onTryAgain={() => {}}
        isLastQuestion={false} subjectColor="#4f46e5"
        partialSuccessLabel={{ label: 'Correct', tone: 'success' }}
      />
    );
    expect(screen.queryByRole('button', { name: /request a review/i })).toBeNull();
    expect(screen.queryByText(/Saved for parent review/i)).toBeNull();
  });
  it('offers a broken-question escape while keeping the normal correction action', () => {
    const onSkipQuestion = vi.fn();
    render(
      <GuidedFeedbackCard
        markResponse={{
          is_correct: false,
          question_type: 'short_answer',
          feedback: 'Try correcting the first step.',
          error_type: 'concept_gap',
        }}
        onNext={() => {}}
        onExplainMyAnswer={() => {}}
        onTryAgain={() => {}}
        onSkipQuestion={onSkipQuestion}
        requiresCorrection
        isLastQuestion={false}
        subjectColor="#4f46e5"
        partialSuccessLabel={{ label: 'Needs another attempt', tone: 'needs_work' }}
      />
    );

    expect(screen.getByText(/Make one short correction attempt/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Question unavailable or broken\? Skip it/i }));
    expect(onSkipQuestion).toHaveBeenCalledOnce();
  });
});

describe('Guided Practice - pre-attempt help safety', () => {
  const workedExample: WorkedExample = {
    has_worked_example: true,
    worked_example: {
      question: 'Find the HCF of 18 and 24.',
      answer: '6',
      steps: [
        { step: 1, instruction: 'List the factors.', result: '18: 1,2,3,6,9,18; 24: 1,2,3,4,6,8,12,24' },
      ],
    },
  };

  it('does not expose worked example final answer before an attempt', () => {
    render(
      <GuidedHelpDrawer
        lessonContent={null}
        workedExample={workedExample}
        chatHistory={[]}
        onSendMessage={() => {}}
        dialogueLoading={false}
        helpChips={[]}
        subjectColor="#4f46e5"
        hasAttempted={false}
      />
    );

    expect((screen.getByRole('button', { name: /Example/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/Final Answer/i)).toBeNull();
    expect(screen.queryByText('6')).toBeNull();
  });

  it('unlocks worked example after an attempt', () => {
    render(
      <GuidedHelpDrawer
        lessonContent={null}
        workedExample={workedExample}
        chatHistory={[]}
        onSendMessage={() => {}}
        dialogueLoading={false}
        helpChips={[]}
        subjectColor="#4f46e5"
        hasAttempted={true}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Example/i }));
    expect(screen.getByText(/Final Answer/i)).toBeTruthy();
  });

  it('uses the stricter first-step pre-attempt mode for the first-step chip', () => {
    const onSendMessage = vi.fn();
    render(
      <GuidedHelpDrawer
        lessonContent={null}
        workedExample={null}
        chatHistory={[]}
        onSendMessage={onSendMessage}
        dialogueLoading={false}
        helpChips={getSubjectAdapter('math').helpChips}
        subjectColor="#4f46e5"
        hasAttempted={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /What is the first step/i }));

    expect(onSendMessage).toHaveBeenCalledWith(expect.stringContaining('[PRE_ATTEMPT_FIRST_STEP] '));
    expect(onSendMessage).toHaveBeenCalledWith(expect.stringContaining('only the first setup step'));
  });

  it('uses concept pre-attempt mode for explain and notice chips', () => {
    const onSendMessage = vi.fn();
    render(
      <GuidedHelpDrawer
        lessonContent={null}
        workedExample={null}
        chatHistory={[]}
        onSendMessage={onSendMessage}
        dialogueLoading={false}
        helpChips={getSubjectAdapter('math').helpChips}
        subjectColor="#4f46e5"
        hasAttempted={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Explain the idea/i }));
    fireEvent.click(screen.getByRole('button', { name: /What should I notice/i }));

    expect(onSendMessage).toHaveBeenNthCalledWith(1, expect.stringContaining('[PRE_ATTEMPT_CONCEPT] '));
    expect(onSendMessage).toHaveBeenNthCalledWith(2, expect.stringContaining('[PRE_ATTEMPT_CONCEPT] '));
  });

  it('shows an explain-my-answer writing mode instead of quick chips', () => {
    render(
      <GuidedHelpDrawer
        lessonContent={null}
        workedExample={null}
        chatHistory={[{ role: 'system', content: 'Write your solution step by step.' }]}
        onSendMessage={() => {}}
        dialogueLoading={false}
        helpChips={getSubjectAdapter('math').helpChips}
        subjectColor="#4f46e5"
        hasAttempted={true}
        isExplaining={true}
      />
    );

    expect(screen.getByText(/Write each step you tried/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Write your working step by step/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Explain the idea/i })).toBeNull();
  });

  it('limits pre-attempt Concept content to rules, goals, criteria, and vocabulary', () => {
    render(
      <GuidedHelpDrawer
        lessonContent={{
          core_rule: 'HCF is the greatest common factor.',
          has_lesson_content: true,
          lesson_content: {
            learning_objectives: ['Find the HCF of two numbers', 'Use prime factors'],
            success_criteria: ['I can list factors of a number'],
            explanation_sections: [
              {
                type: 'concept',
                heading: 'What is HCF?',
                body: 'The highest common factor is shared by both numbers.',
              },
              {
                type: 'method',
                heading: 'How to find it',
                body: 'List factors and pick the greatest shared one.',
              },
            ],
            key_vocabulary: [{ term: 'factor', definition: 'A number that divides evenly' }],
            common_mistakes: ['Confusing HCF with LCM'],
            real_world_connections: ['Sharing items into equal groups'],
            additional_worked_examples: [
              {
                question: 'HCF of 12 and 18',
                answer: '6',
                steps: [{ step: 1, instruction: 'List factors', result: '1,2,3,6' }],
              },
            ],
          },
        }}
        workedExample={null}
        chatHistory={[]}
        onSendMessage={() => {}}
        dialogueLoading={false}
        helpChips={[]}
        subjectColor="#4f46e5"
        hasAttempted={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Concept/i }));

    expect(screen.getByText(/HCF is the greatest common factor/i)).toBeTruthy();
    expect(screen.getByText(/What you will learn/i)).toBeTruthy();
    expect(screen.getByText(/Success Criteria/i)).toBeTruthy();
    expect(screen.getByText(/Key Vocabulary/i)).toBeTruthy();
    expect(screen.queryByText(/The highest common factor is shared by both numbers/i)).toBeNull();
    expect(screen.queryByText(/How to find it/i)).toBeNull();
    expect(screen.queryByText(/Extra examples/i)).toBeNull();
    expect(screen.queryByText(/^Answer: 6$/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /More lesson detail/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Read/i })).toBeNull();
  });

  it('restores worked lesson steps and answers after an attempt', () => {
    render(
      <GuidedHelpDrawer
        lessonContent={{
          core_rule: 'Use the rule safely.',
          lesson_content: {
            additional_worked_examples: [{
              question: 'A different practice question',
              answer: '42',
              steps: [{ step: 1, instruction: 'Apply the rule', result: '42' }],
            }],
          },
        }}
        workedExample={null}
        chatHistory={[]}
        onSendMessage={() => {}}
        dialogueLoading={false}
        helpChips={[]}
        subjectColor="#4f46e5"
        hasAttempted={true}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Concept/i }));
    expect(screen.getByText(/Extra examples/i)).toBeTruthy();
    expect(screen.getByText(/Answer: 42/i)).toBeTruthy();
  });
});

describe('Guided Practice - Phase 5 interaction safety', () => {
  const multiPartExercise: Exercise = {
    id: 'mp1',
    topic: 'AC9M7N02',
    topic_ids: ['AC9M7N02'],
    question: 'Answer both parts.',
    answer: '{"a":"6","b":"8"}',
    question_type: 'multi_part',
    sub_parts: [
      { label: 'a', question: 'Find 2 + 4.', answer: '6', marks: 1 },
      { label: 'b', question: 'Find 3 + 5.', answer: '8', marks: 1 },
    ],
  } as Exercise;

  it('disables guided multi-part submit until the active part has an answer', () => {
    const onSubmit = vi.fn();
    const baseProps = {
      exercise: multiPartExercise,
      onSetAnswer: vi.fn(),
      onSubmit,
      submitting: false,
      multiPartResults: [],
      activeMultipartLabel: 'a',
      onSetActivePart: vi.fn(),
      subjectColor: '#4f46e5',
    };

    const { rerender } = render(<GuidedQuestionCard {...baseProps} answer="" />);
    expect((screen.getByRole('button', { name: /Submit Answer/i }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<GuidedQuestionCard {...baseProps} answer="6" />);
    fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('shows the maths symbol toolbar for a multi-part answer and exposes Skip', () => {
    const onSetAnswer = vi.fn();
    const onSkip = vi.fn();
    render(
      <GuidedQuestionCard
        exercise={multiPartExercise}
        answer=""
        onSetAnswer={onSetAnswer}
        onSubmit={() => {}}
        onSkip={onSkip}
        submitting={false}
        multiPartResults={[]}
        activeMultipartLabel="a"
        onSetActivePart={() => {}}
        subjectColor="#4f46e5"
        showMathToolbar
      />
    );

    fireEvent.click(screen.getByTitle('Square root'));
    expect(onSetAnswer).toHaveBeenCalledWith('√()');

    fireEvent.click(screen.getByRole('button', { name: 'Skip question' }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('switches to the worked-example tab when the external action fires after an attempt', () => {
    const workedExample: WorkedExample = {
      has_worked_example: true,
      worked_example: {
        question: 'Find the HCF of 18 and 24.',
        answer: '6',
        steps: [{ step: 1, instruction: 'List the factors.', result: 'Common factor 6' }],
      },
    };

    const { rerender } = render(
      <GuidedHelpDrawer
        lessonContent={null}
        workedExample={workedExample}
        chatHistory={[]}
        onSendMessage={() => {}}
        dialogueLoading={false}
        helpChips={[]}
        subjectColor="#4f46e5"
        hasAttempted={true}
        exampleOpenToken={0}
      />
    );

    expect(screen.queryByText(/Final Answer/i)).toBeNull();

    rerender(
      <GuidedHelpDrawer
        lessonContent={null}
        workedExample={workedExample}
        chatHistory={[]}
        onSendMessage={() => {}}
        dialogueLoading={false}
        helpChips={[]}
        subjectColor="#4f46e5"
        hasAttempted={true}
        exampleOpenToken={1}
      />
    );

    expect(screen.getByText(/Final Answer/i)).toBeTruthy();
  });

  it('shows only supported guided suggested actions', () => {
    const onSuggestedAction = vi.fn();

    render(
      <GuidedHelpDrawer
        lessonContent={null}
        workedExample={null}
        chatHistory={[{ role: 'tutor', content: 'Try a next step.' }]}
        onSendMessage={() => {}}
        suggestedActions={['try_again', 'unsupported_action']}
        onSuggestedAction={onSuggestedAction}
        dialogueLoading={false}
        helpChips={[]}
        subjectColor="#4f46e5"
        hasAttempted={true}
      />
    );

    expect(screen.getByRole('button', { name: /Suggested action: Try again/i })).toBeTruthy();
    expect(screen.queryByText('unsupported_action')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Suggested action: Try again/i }));
    expect(onSuggestedAction).toHaveBeenCalledWith('try_again');
  });

  it('suppresses unsupported full-practice suggested actions', () => {
    const onSendMessage = vi.fn();

    render(
      <DialoguePanel
        chat={[]}
        loading={false}
        dialogueLoading={false}
        suggestedActions={['try_again', 'unsupported_action']}
        dialogueDisabled={false}
        currentEx={{ id: 'q1' }}
        lastAnswerCorrect={false}
        lastAnswerIncorrect={true}
        isExplaining={false}
        onSendMessage={onSendMessage}
        onStartExplain={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: /Suggested action: Try again/i })).toBeTruthy();
    expect(screen.queryByText('unsupported_action')).toBeNull();
  });
});

describe('Guided Practice - More Tools disclosure', () => {
  it('keeps advanced tools available under disclosure for Year 7', () => {
    render(<MoreToolsPanel year="year7" />);

    expect(screen.getByText('🧪 Math Lab').closest('[hidden]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /More Tools/i }));
    expect(screen.getByText('🧪 Math Lab')).toBeTruthy();
    expect(screen.getByText('📐 PSMT Assistant (senior extension)')).toBeTruthy();
    expect(screen.getByText(/mainly designed for Years 11–12/)).toBeTruthy();
  });

  it('labels PSMT as a senior tool for senior years', () => {
    render(<MoreToolsPanel year="year11" />);

    fireEvent.click(screen.getByRole('button', { name: /More Tools/i }));
    expect(screen.getByText('📐 PSMT Assistant')).toBeTruthy();
    expect(screen.getByText(/senior mathematical modelling/)).toBeTruthy();
  });

  it('recognises QCAA unit scopes as senior study', () => {
    render(<MoreToolsPanel year="unit1" />);

    fireEvent.click(screen.getByRole('button', { name: /More Tools/i }));
    expect(screen.getByText('📐 PSMT Assistant')).toBeTruthy();
    expect(screen.queryByText(/senior extension/i)).toBeNull();
  });
});

describe('Guided Practice - High Achiever selector', () => {
  it('prioritises mastery-band and mistake topics ahead of arbitrary active topic', () => {
    const candidates = getHighAchieverTopicCandidates({
      activeTopic: 'AC9M7N01',
      sequence: ['AC9M7N01', 'AC9M7N02', 'AC9M7N03'],
      progress: [
        { topic: 'AC9M7N01', bkt_mastery: 0.3, attempts_count: 3, accuracy: 0.4 },
        { topic: 'AC9M7N02', bkt_mastery: 0.72, attempts_count: 3, accuracy: 0.9 },
      ],
      mistakes: [{ topic: 'AC9M7N03', question_id: 'q3', timestamp: '2026-06-15T10:00:00Z' }],
    });

    expect(candidates[0]).toBe('AC9M7N02');
    expect(candidates).toContain('AC9M7N03');
  });

  it('scores advanced exercises above core exercises after cooldown', () => {
    const advanced: Exercise = {
      id: 'q-advanced',
      topic: 'AC9M7N02',
      topic_ids: ['AC9M7N02'],
      question: 'Explain a non-routine strategy.',
      answer: 'Because...',
      question_type: 'reasoning',
      difficulty: 'extending',
      complexity: 'complex_unfamiliar',
    };
    const core: Exercise = {
      id: 'q-core',
      topic: 'AC9M7N02',
      topic_ids: ['AC9M7N02'],
      question: 'Calculate 2 + 2.',
      answer: '4',
      question_type: 'short_answer',
      difficulty: 'developing',
      complexity: 'simple_familiar',
    };
    const progress = new Map([['AC9M7N02', 0.75]]);
    const mistakeTime = new Date('2026-06-15T09:00:00Z').toISOString();
    const nowMs = new Date('2026-06-15T10:00:00Z').getTime();

    const advancedScore = scoreHighAchieverExercise({
      exercise: advanced,
      topicId: 'AC9M7N02',
      progressByTopic: progress,
      adapterScore: getSubjectAdapter('math').advancedScore(advanced),
      mistakes: [{ question_id: 'q-advanced', timestamp: mistakeTime }],
      nowMs,
    });
    const coreScore = scoreHighAchieverExercise({
      exercise: core,
      topicId: 'AC9M7N02',
      progressByTopic: progress,
      adapterScore: getSubjectAdapter('math').advancedScore(core),
      nowMs,
    });

    expect(advancedScore).toBeGreaterThan(coreScore);
  });

  it('describes why a high achiever question is a stretch', () => {
    const exercise: Exercise = {
      id: 'q-advanced',
      topic: 'AC9M7N02',
      topic_ids: ['AC9M7N02'],
      question: 'Explain a non-routine strategy.',
      answer: 'Because...',
      question_type: 'reasoning',
      difficulty: 'AMC',
      complexity: 'complex_unfamiliar',
    };

    const reason = describeHighAchieverSelection({
      exercise,
      topicId: 'AC9M7N02',
      progressByTopic: new Map([['AC9M7N02', 0.75]]),
      mistakes: [{ topic_id: 'AC9M7N02', question_id: 'q-other' }],
    });

    expect(reason).toContain('Extension challenge:');
    expect(reason).toContain('recent mistake topic');
    expect(reason).toContain('AMC-style challenge');
    expect(reason).toContain('complex unfamiliar thinking');
  });
});

describe('Guided Practice - session controls', () => {
  const curriculum = {
    math: {
      '7': {
        sequence: ['AC9M7N01', 'AC9M7N02'],
        AC9M7N01: { name: 'Number properties' },
        AC9M7N02: { name: 'Algebra patterns' },
      },
    },
  };

  it('shows answered progress without counting replacements as completed', () => {
    render(
      <GuidedPracticeShell
        topicDisplayName="Number properties"
        subject="math"
        yearLevel="7"
        questionIndex={0}
        totalQuestions={5}
        completedQuestions={0}
        replacedQuestions={1}
        isHighAchiever={false}
        allowHighAchiever={false}
        onToggleHighAchiever={() => {}}
        onExit={() => {}}
        dailySummary={null}
      >
        <div>Replacement question</div>
      </GuidedPracticeShell>
    );

    expect(screen.getByText('0/5 answered · 1 replaced')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: /Guided questions answered/i }).getAttribute('aria-valuenow')).toBe('0');
    expect(screen.queryByRole('switch', { name: /Use high achiever questions/i })).toBeNull();
  });

  it('asks for confirmation before switching topics after progress', () => {
    const onChangeTopic = vi.fn();

    render(
      <GuidedPracticeShell
        topicDisplayName="Number properties"
        subject="math"
        yearLevel="7"
        questionIndex={1}
        totalQuestions={5}
        isHighAchiever={false}
        onToggleHighAchiever={() => {}}
        onExit={() => {}}
        dailySummary={null}
        activeTopic="AC9M7N01"
        curriculum={curriculum}
        onChangeTopic={onChangeTopic}
        hasSessionProgress={true}
        selectionReason="Recommended next topic based on your progress."
      >
        <div>Question area</div>
      </GuidedPracticeShell>
    );

    fireEvent.change(screen.getByLabelText(/Switch Topic Manually/i), { target: { value: 'AC9M7N02' } });
    expect(screen.getByText('Start a new guided set on this topic?')).toBeTruthy();
    expect(onChangeTopic).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Start new set/i }));
    expect(onChangeTopic).toHaveBeenCalledWith('AC9M7N02');
  });

  it('shows selection reason, high-achiever caption, and finish-session action', () => {
    const onFinishSession = vi.fn();

    render(
      <GuidedPracticeShell
        topicDisplayName="Number properties"
        subject="math"
        yearLevel="7"
        questionIndex={0}
        totalQuestions={5}
        isHighAchiever={true}
        onToggleHighAchiever={() => {}}
        onExit={() => {}}
        dailySummary={null}
        activeTopic="AC9M7N01"
        curriculum={curriculum}
        onChangeTopic={() => {}}
        onFinishSession={onFinishSession}
        selectionReason="Extension challenge selected from your stronger areas and recent mistakes."
      >
        <div>Question area</div>
      </GuidedPracticeShell>
    );

    expect(screen.getByText(/Why this question\?/)).toBeTruthy();
    expect(screen.getByText(/Extension challenge selected/)).toBeTruthy();
    expect(screen.getByText(/Uses harder and less familiar questions/)).toBeTruthy();
    const highAchieverToggle = screen.getByRole('switch', { name: /Use high achiever questions/i });
    expect(highAchieverToggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('option', { name: 'Algebra patterns (AC9M7N02)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Finish session now/i }));
    expect(onFinishSession).toHaveBeenCalledOnce();
  });
});


describe('Guided Practice - backend coaching fields', () => {
  it('renders the existing next step and misconception explanation without another request', () => {
    const markResponse: TutorMarkResponse = {
      is_correct: false,
      question_type: 'short_answer',
      outcome: 'incorrect',
      feedback: 'Check the operation you chose.',
      error_type: 'concept_gap',
      next_step: 'Write the inverse operation before solving again.',
      misconception_explanation: 'An inverse operation undoes the original operation.',
    };

    render(
      <GuidedFeedbackCard
        markResponse={markResponse}
        onNext={() => {}}
        onExplainMyAnswer={() => {}}
        onTryAgain={() => {}}
        isLastQuestion={false}
        subjectColor="#4f46e5"
        partialSuccessLabel={{ label: 'Needs another attempt', tone: 'needs_work' }}
      />
    );

    expect(screen.getByTestId('guided-next-step').textContent).toContain('Write the inverse operation');
    expect(screen.getByTestId('guided-misconception-explanation').textContent).toContain('undoes the original operation');
  });

  it('does not present coaching fields for a pending verdict', () => {
    const markResponse: TutorMarkResponse = {
      is_correct: false,
      question_type: 'short_answer',
      outcome: 'pending',
      feedback: 'Saved for review.',
      next_step: 'This must not be shown as a verdict.',
      misconception_explanation: 'This must not be shown as a diagnosed misconception.',
    };

    render(
      <GuidedFeedbackCard
        markResponse={markResponse}
        onNext={() => {}}
        onExplainMyAnswer={() => {}}
        onTryAgain={() => {}}
        isLastQuestion={false}
        subjectColor="#4f46e5"
        partialSuccessLabel={{ label: 'Pending', tone: 'needs_work' }}
      />
    );

    expect(screen.queryByTestId('guided-next-step')).toBeNull();
    expect(screen.queryByTestId('guided-misconception-explanation')).toBeNull();
  });
});
