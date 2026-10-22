import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WritingAssessment from '../components/writing/WritingAssessment';
import WritingEditor from '../components/writing/WritingEditor';
import WritingPortfolio from '../components/writing/WritingPortfolio';
import WritingPromptSelector from '../components/writing/WritingPromptSelector';
import WritingResults from '../components/writing/WritingResults';
import WritingHistory from '../components/writing/WritingHistory';
import type { CriterionScore } from '../lib/api-types';
import { fetchWritingAssess, fetchWritingCompare, fetchWritingHistory } from '../lib/api';
import {
  WRITING_DOCUMENT_KEY,
  createWritingDocument,
  readWritingDocument,
  writeWritingDocument,
} from '../lib/writing-document-state';

vi.mock('../lib/api', () => ({
  fetchCurriculum: vi.fn(async () => ({})),
  fetchWritingTopics: vi.fn(async () => []),
  fetchWritingAssess: vi.fn(),
  fetchWritingCompare: vi.fn(),
  fetchWritingExportPrompt: vi.fn(),
  fetchWritingImportResult: vi.fn(),
  fetchGrammarRemediation: vi.fn(),
  fetchWritingHistory: vi.fn(async () => ({
    assessments: [
      {
        timestamp: '2026-06-18T10:00:00Z',
        prompt_type: 'persuasive',
        year_level: 11,
        word_count: 850,
        total_score: 18,
        max_total_score: 25,
        estimated_band: null,
        criterion_scores: [],
        strengths: [],
        next_learning_steps: [],
        highlights: [],
        overall_feedback: 'Developing analysis.',
      },
    ],
  })),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

const baseEditorProps = {
  promptType: 'persuasive' as const,
  selectedTopic: null,
  topicWordLimit: { min: 300, max: 800 },
  isSenior: false,
  draftText: '',
  onChange: vi.fn(),
  sourceText: '',
  onSourceTextChange: vi.fn(),
  writerStatement: '',
  onWriterStatementChange: vi.fn(),
  timeMode: 'unlimited' as const,
  timeRemaining: 0,
  formattedTime: '00:00',
  isTimerRunning: false,
  onTimerToggle: vi.fn(),
  onTimeModeChange: vi.fn(),
  customMinutes: 60,
  onCustomMinutesChange: vi.fn(),
  onSubmit: vi.fn(),
  isSubmitting: false,
};

describe('Writing Hub Phase 3 process supports', () => {
  it('renders junior planning template and can insert headings into the draft', () => {
    const onChange = vi.fn();
    render(<WritingEditor {...baseEditorProps} onChange={onChange} />);

    const planningToggle = screen.getByRole('button', { name: /Plan before writing \(optional\)/i });
    expect(planningToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Position')).toBeNull();
    fireEvent.click(planningToggle);
    expect(planningToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Position')).toBeTruthy();
    expect(screen.getByText('Reason 1 and evidence')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Insert brainstorm headings into draft/i }));
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('Position:'));
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('Reason 3 and evidence:'));
  });

  it('shows optional checklist and blocks drafts below the backend minimum', () => {
    const onSubmit = vi.fn();
    render(
      <WritingEditor
        {...baseEditorProps}
        draftText="Short draft with a few words only."
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText(/needs at least 50 words/i)).toBeTruthy();
    expect(screen.getByText('Optional pre-submit checklist')).toBeTruthy();
    expect(screen.getByText('I answered the prompt.')).toBeTruthy();

    const submit = screen.getByRole('button', { name: /Submit for Assessment/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders senior QCAA formative notice and senior creative planning prompts', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        promptType="narrative"
        isSenior={true}
        topicWordLimit={{ min: 700, max: 1200 }}
      />
    );

    expect(screen.getByText(/Practice feedback modelled on QCAA English ISMG categories/i)).toBeTruthy();
    expect(screen.getByText(/use the studied text as a springboard/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Plan before writing \(optional\)/i }));
    expect(screen.getByText('Intended perspective')).toBeTruthy();
    expect(screen.getByText("Writer's statement notes")).toBeTruthy();
    expect(screen.getByText("My writer's statement explains key choices.")).toBeTruthy();
  });

  it('keeps selected senior task context visible while drafting', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        promptType="persuasive"
        isSenior={true}
        selectedTopic={{
          id: 'senior-context',
          type: 'persuasive',
          yearLevels: [11],
          category: 'QCAA practice',
          title: 'Public audience task',
          description: 'A senior practice task.',
          prompt: 'Write a feature article about representations of ambition.',
          context: 'Respond for a youth magazine audience.',
          targetAudience: 'Teen readers',
          mode: 'Feature article',
          prescribedText: 'Macbeth',
          taskConditions: { label: 'Practice conditions', planningMinutes: 15, writingMinutes: 75, conditionsNote: 'Closed book.' },
          officialSource: { label: 'School task sheet', note: 'Use as formative context only.' },
          wordLimit: { min: 800, max: 1000 },
          writingTips: ['Use public-audience register.'],
        }}
        topicWordLimit={{ min: 800, max: 1000 }}
      />
    );

    expect(screen.getByText(/Audience \/ form:/i)).toBeTruthy();
    expect(screen.getByText(/Teen readers \| Feature article/i)).toBeTruthy();
    expect(screen.getByText(/Prescribed text:/i)).toBeTruthy();
    expect(screen.getByText(/Macbeth/i)).toBeTruthy();
    expect(screen.getByText(/800-1000 words/i)).toBeTruthy();
    expect(screen.getByText(/15 min planning; 75 min writing; Closed book/i)).toBeTruthy();
    expect(screen.getByText(/School task sheet - Use as formative context only/i)).toBeTruthy();
    expect(screen.getByText(/Respond for a youth magazine audience/i)).toBeTruthy();
  });

  it('shows senior formative notice on prompt selection and results', async () => {
    const criterionScores: CriterionScore[] = [
      { criterion_number: 1, domain: 'ISMG', name: 'Knowledge application', score: 5, max_score: 9, feedback: 'Developing analysis.' },
    ];
    const originalCriterionScores: CriterionScore[] = [
      { criterion_number: 1, domain: 'ISMG', name: 'Knowledge application', score: 4, max_score: 9, feedback: 'Earlier analysis needed more evidence.' },
    ];

    const { rerender } = render(<WritingPromptSelector yearLevel={11} onSelect={() => {}} />);
    expect(screen.getByText(/official result depends on your school task sheet/i)).toBeTruthy();

    await act(async () => {
      rerender(
        <WritingResults
          isSenior={true}
          promptType="analytical"
          yearLevel={11}
          totalScore={12}
          maxTotalScore={25}
          criterionScores={criterionScores}
          highlights={[]}
          remediationLinks={[]}
          overallFeedback="Keep refining your evidence."
          strengths={['Clear idea']}
          nextLearningSteps={[{ priority_goal: 'Evidence', why_it_matters: 'It supports your analysis.', recommendation: 'Embed shorter quotes.' }]}
          revisionPlan={[{ priority: 1, target: 'Strengthen evidence', why: 'Evidence supports the claim.', how: 'Add one short quotation and explain its effect.', example_revision: 'This image positions the reader to feel uneasy.' }]}
          paragraphFeedback={{ strongest_paragraph: 'The opening paragraph has a clear idea.', paragraph_to_revise_first: 'The second paragraph needs more evidence.', sentence_level_improvement: 'Split one long sentence into two clearer sentences.' }}
          sourceUseFeedback={{ uses_source_evidence: true, best_evidence_used: 'short quote', missing_or_misread_evidence: 'Add one more detail.', quote_integration_tip: 'Introduce the quote before explaining it.' }}
          writingSkillDrills={[{ criterion_number: 1, skill: 'Evidence', drill_prompt: 'Revise one paragraph for evidence.', practice_tip: 'Use a short quote and explain it.' }]}
          grammarRemediation={{ weakest_criterion: 'Sentence Structure', error_code: 'grammar_syntax', subtype_code: 'sentence_fragment', facet: 'language_conventions', grammar_focus: 'sentence_grammar', revision_task: 'Revise one sentence for clearer grammar.', drills: [{ id: 'drill-1', question: 'Choose the sentence with correct punctuation.', topic_ids: ['AC9E7LA05'], facet: 'language_conventions', grammar_focus: 'sentence_grammar' }] }}
          revisionCompare={{ original_timestamp: '2026-06-18T10:00:00Z', original_score: 10, original_max_score: 25, original_word_count: 120, revised_word_count: 150, word_count_change: 30, new_vocabulary: ['motif', 'contrast'], removed_vocabulary: [], sentence_count: { original: 8, revised: 10 }, paragraph_count: { original: 3, revised: 4 }, original_criterion_scores: originalCriterionScores, feedback: 'Compare drafts.' }}
          taskAlignmentWarnings={['Check the required audience from the task sheet.']}
          onEdit={() => {}}
          canRetry={true}
          iterationCount={1}
        />
      );
    });
    expect(screen.getByText(/official result depends on your school task sheet/i)).toBeTruthy();
    expect(screen.getByText('Revise These First')).toBeTruthy();
    expect(screen.getByText(/Sentence-level example, do not copy/i)).toBeTruthy();
    expect(screen.getByText('Paragraph Coaching')).toBeTruthy();
    expect(screen.getByText('Source Evidence Check')).toBeTruthy();
    expect(screen.getByText('Targeted Micro-Drills')).toBeTruthy();
    expect(screen.getByText('Revision Progress')).toBeTruthy();
    expect(screen.getByText('Criterion movement')).toBeTruthy();
    expect(screen.getByText(/4\/9/i)).toBeTruthy();
    expect(screen.getByText(/\+1/i)).toBeTruthy();
    expect(screen.getByText('Grammar-in-Context Revision')).toBeTruthy();
    expect(screen.getByText(/Revise one sentence for clearer grammar/i)).toBeTruthy();
    expect(screen.getByText(/motif, contrast/i)).toBeTruthy();
    expect(screen.getByText('Task Alignment Check')).toBeTruthy();
  });

  it('hides placeholder scores and criteria in mock mode', async () => {
    await act(async () => {
      render(
        <WritingResults
          isSenior={false}
          yearLevel={7}
          promptType="persuasive"
          totalScore={0}
          maxTotalScore={48}
          criterionScores={[{ criterion_number: 1, domain: 'Ideas', name: 'Ideas', score: 0, max_score: 6, feedback: 'Placeholder.' }]}
          highlights={[]}
          remediationLinks={[]}
          overallFeedback="Local draft pre-check: 120 words across 8 sentences."
          strengths={['Produced a complete draft.']}
          nextLearningSteps={[{ priority_goal: 'Fix punctuation', why_it_matters: 'Clarity matters.', recommendation: 'Add missing full stops.' }]}
          llmStatus="mock"
          onEdit={() => {}}
          canRetry={true}
          iterationCount={1}
        />
      );
    });

    expect(screen.getAllByText(/Local draft pre-check/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Band 1/i)).toBeNull();
    expect(screen.queryByText(/0\s*\/\s*48 points/i)).toBeNull();
    expect(screen.queryByText('Criterion Breakdown')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit draft' })).toBeTruthy();
  });

  it('renders insufficient evidence without a score and preserves the revision slot', async () => {
    const onEdit = vi.fn();
    await act(async () => {
      render(
        <WritingResults
          isSenior={false}
          yearLevel={7}
          promptType="persuasive"
          totalScore={0}
          maxTotalScore={48}
          criterionScores={[]}
          highlights={[]}
          remediationLinks={[]}
          overallFeedback="This draft needs more developed evidence before scoring."
          strengths={[]}
          nextLearningSteps={[]}
          insufficientEvidence={true}
          llmStatus="skipped"
          onEdit={onEdit}
          canRetry={true}
          iterationCount={0}
        />
      );
    });

    expect(screen.getByText(/Not enough evidence for a fair score yet/i)).toBeTruthy();
    expect(screen.queryByText(/0\s*\/\s*48 points/i)).toBeNull();
    expect(screen.queryByText('Criterion Breakdown')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Continue editing/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    cleanup();
    render(
      <WritingHistory
        iterations={[
          { insufficient_evidence: true, total_score: 0, max_total_score: 48, criterion_scores: [] },
          { insufficient_evidence: false, total_score: 20, max_total_score: 48, criterion_scores: [] },
        ] as any}
        onTryAgain={() => {}}
        maxIterations={3}
      />
    );
    expect(screen.getByText(/evidence-limited attempt not shown as scored drafts/i)).toBeTruthy();
    expect(screen.getByText('Draft 1')).toBeTruthy();
    expect(screen.queryByText('Draft 2')).toBeNull();
    expect(screen.getByRole('button', { name: /Try Again \(2 remaining\)/i })).toBeTruthy();
  });

  it('retains complete scoring for a validated external AI result', async () => {
    await act(async () => {
      render(
        <WritingResults
          isSenior={false}
          yearLevel={7}
          promptType="persuasive"
          totalScore={30}
          maxTotalScore={48}
          criterionScores={[{ criterion_number: 1, domain: 'Ideas', name: 'Ideas', score: 4, max_score: 6, feedback: 'Clear position.' }]}
          highlights={[]}
          remediationLinks={[]}
          overallFeedback="Clear persuasive structure."
          strengths={['Clear position']}
          nextLearningSteps={[]}
          llmStatus="external"
          onEdit={() => {}}
          canRetry={true}
          iterationCount={1}
        />
      );
    });

    expect(screen.getByText(/Assessed by an external AI/i)).toBeTruthy();
    expect(screen.queryByText(/Band/i)).toBeNull();
    expect(screen.getByText('63%')).toBeTruthy();
    expect(screen.getByText((_, element) => element?.tagName === 'DIV' && element.textContent?.trim() === '30 / 48 points (63%)')).toBeTruthy();
    expect(screen.getByText('Criterion Breakdown')).toBeTruthy();
  });

  it('uses junior practice wording for Year 10 instead of official NAPLAN wording', () => {
    render(<WritingPromptSelector yearLevel={10} onSelect={() => {}} />);

    expect(screen.getByText(/junior writing feedback/i)).toBeTruthy();
    expect(screen.queryByText(/official NAPLAN/i)).toBeNull();
  });

  it('shows expository as a supported junior writing type', () => {
    const onSelect = vi.fn();
    render(<WritingPromptSelector yearLevel={8} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /Informative \/ Expository/i }));
    expect(onSelect).toHaveBeenCalledWith('expository');
  });

  it('renders the expository writing guide content', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        promptType="expository"
        topicWordLimit={{ min: 300, max: 700 }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Writing Guide/i }));
    expect(screen.getByText(/Explain a topic clearly and accurately/i)).toBeTruthy();
    expect(screen.getByText(/Make the purpose and audience clear/i)).toBeTruthy();
  });

  it('uses accurate senior public-audience guide language', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        isSenior={true}
        promptType="persuasive"
        topicWordLimit={{ min: 800, max: 1200 }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Writing Guide/i }));
    expect(screen.getByText(/Analyse representations in text\/s/i)).toBeTruthy();
    expect(screen.getAllByText(/article, blog, essay, or column/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Analyse representations and perspectives in text\/s/i)).toBeTruthy();
    expect(screen.queryByText(/QCAA IA2/i)).toBeNull();
  });

  it('keeps junior persuasive guide separate from senior public-audience guidance', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        promptType="persuasive"
        topicWordLimit={{ min: 300, max: 800 }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Writing Guide/i }));
    expect(screen.getByText('Persuasive Writing Guide')).toBeTruthy();
    expect(screen.getByText(/Apply persuasive and rhetorical devices/i)).toBeTruthy();
    expect(screen.queryByText(/Public Audience Written Response Guide/i)).toBeNull();
    expect(screen.queryByText(/analyse representations/i)).toBeNull();
  });

  it('keeps junior narrative guide separate from senior imaginative guidance', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        promptType="narrative"
        topicWordLimit={{ min: 300, max: 800 }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Writing Guide/i }));
    expect(screen.getByText('Narrative Writing Guide')).toBeTruthy();
    expect(screen.getByText(/Shape the ending deliberately/i)).toBeTruthy();
    expect(screen.queryByText(/writer's statement/i)).toBeNull();
    expect(screen.queryByText(/springboard/i)).toBeNull();
  });

  it('shows senior imaginative guide material for source-text springboard tasks', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        promptType="narrative"
        isSenior={true}
        topicWordLimit={{ min: 700, max: 1200 }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Writing Guide/i }));
    expect(screen.getByText('Imaginative Response Guide')).toBeTruthy();
    expect(screen.getByText(/uses a literary text as a springboard/i)).toBeTruthy();
    expect(screen.getByText(/Justify choices in the writer's statement/i)).toBeTruthy();
  });

  it('uses evidence-before-analysis wording in the analytical guide', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        promptType="analytical"
        topicWordLimit={{ min: 300, max: 600 }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Writing Guide/i }));
    expect(screen.getByText(/Topic sentence, Evidence, Explanation\/analysis, Link/i)).toBeTruthy();
    expect(screen.getByText('Analytical Paragraph Guide')).toBeTruthy();
  });

  it('shows senior analytical essay guide material for senior analytical tasks', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        promptType="analytical"
        isSenior={true}
        topicWordLimit={{ min: 800, max: 1200 }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Writing Guide/i }));
    expect(screen.getByText('Senior Analytical Essay Guide')).toBeTruthy();
    expect(screen.getByText(/Develop a sustained analysis/i)).toBeTruthy();
    expect(screen.getByText(/Integrate textual evidence/i)).toBeTruthy();
  });

  it('uses dynamic topic word limits in the draft placeholder', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        topicWordLimit={{ min: 600, max: 1000 }}
      />
    );

    expect(screen.getByPlaceholderText(/Aim for 600-1000 words/i)).toBeTruthy();
  });

  it('uses practice score wording for Year 8 and avoids made-up levels', async () => {
    const criterionScores: CriterionScore[] = [
      { criterion_number: 1, domain: 'Informative', name: 'Purpose and Audience', score: 3, max_score: 5, feedback: 'Clear purpose.' },
    ];

    await act(async () => {
      render(
        <WritingResults
          isSenior={false}
          yearLevel={8}
          promptType="expository"
          totalScore={12}
          maxTotalScore={20}
          criterionScores={criterionScores}
          highlights={[]}
          remediationLinks={[]}
          overallFeedback="Good explanation."
          strengths={['Clear topic']}
          nextLearningSteps={[]}
          onEdit={() => {}}
          canRetry={true}
          iterationCount={1}
        />
      );
    });

    expect(screen.getByText(/Practice score is a formative rubric-style indicator/i)).toBeTruthy();
    expect(screen.queryByText(/Level 5/i)).toBeNull();
    expect(screen.queryByText(/Band/i)).toBeNull();
  });

  it('loads grammar remediation only when requested', async () => {
    const onLoadGrammarRemediation = vi.fn();

    await act(async () => {
      render(
        <WritingResults
          isSenior={false}
          yearLevel={8}
          promptType="expository"
          totalScore={12}
          maxTotalScore={20}
          criterionScores={[{ criterion_number: 1, domain: 'Informative', name: 'Purpose and Audience', score: 3, max_score: 5, feedback: 'Clear purpose.' }]}
          highlights={[]}
          remediationLinks={[]}
          overallFeedback="Good explanation."
          strengths={[]}
          nextLearningSteps={[]}
          writingSkillDrills={[]}
          onLoadGrammarRemediation={onLoadGrammarRemediation}
          onEdit={() => {}}
          canRetry={true}
          iterationCount={1}
        />
      );
    });

    expect(screen.getByText('Targeted Micro-Drills')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Load grammar revision task/i }));
    expect(onLoadGrammarRemediation).toHaveBeenCalledOnce();
  });

  it('uses prompt-specific senior timer labels', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        promptType="persuasive"
        isSenior={true}
        yearLevel={11}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /No timer/i }));
    expect(screen.getByText(/120 min practice — use Custom for school task conditions/i)).toBeTruthy();
    expect(screen.queryByText(/QCAA EA \(120 min\)/i)).toBeNull();
  });

  it('labels senior persuasive portfolio entries as public-audience responses', async () => {
    render(<WritingPortfolio onBackToPractice={() => {}} onSelectTopic={() => {}} />);

    expect(await screen.findByText('Public Audience Written Response')).toBeTruthy();
    expect(screen.queryByText(/^Persuasive$/i)).toBeNull();
  });

  it('does not display numeric NAPLAN band in results - always percentage', async () => {
    await act(async () => {
      render(
        <WritingResults
          isSenior={false}
          yearLevel={7}
          promptType="persuasive"
          totalScore={35}
          maxTotalScore={48}
          criterionScores={[{ criterion_number: 1, domain: 'Ideas', name: 'Ideas', score: 5, max_score: 6, feedback: 'Good.' }]}
          highlights={[]}
          remediationLinks={[]}
          overallFeedback="Solid persuasive argument."
          strengths={['Clear position']}
          nextLearningSteps={[]}
          onEdit={() => {}}
          canRetry={true}
          iterationCount={1}
        />
      );
    });

    // No Band display at all - always show percentage
    expect(screen.queryByText(/Band \d/)).toBeNull();
    expect(screen.getByText('73%')).toBeTruthy();
    expect(screen.getByText(/formative rubric-style indicator/i)).toBeTruthy();
  });

  it('discards legacy split-key drafts without migrating them', () => {
    localStorage.setItem('qld_tutor_writing_phase', 'edit');
    localStorage.setItem('qld_tutor_writing_prompt_type', 'persuasive');
    localStorage.setItem('qld_tutor_writing_draft_text', 'Legacy draft must be discarded.');

    render(<WritingAssessment />);

    expect(screen.getByRole('combobox', { name: /Year level/i })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Writing draft/i })).toBeNull();
    expect(localStorage.getItem('qld_tutor_writing_phase')).toBeNull();
    expect(localStorage.getItem('qld_tutor_writing_prompt_type')).toBeNull();
    expect(localStorage.getItem('qld_tutor_writing_draft_text')).toBeNull();
  });

  it('restores a draft only from the versioned atomic document', async () => {
    writeWritingDocument(localStorage, createWritingDocument({
      phase: 'edit',
      promptType: 'persuasive',
      yearLevel: 8,
      draftText: 'Versioned draft survives a reload.',
      customTopicPrompt: 'A current topic',
    }));

    render(<WritingAssessment />);

    const editor = await screen.findByRole('textbox', { name: /Writing draft/i }) as HTMLTextAreaElement;
    expect(editor.value).toBe('Versioned draft survives a reload.');
    expect(readWritingDocument(localStorage)?.customTopicPrompt).toBe('A current topic');
  });

  it('keeps the latest draft and warns when an assessment cannot be saved to the portfolio', async () => {
    vi.mocked(fetchWritingAssess).mockResolvedValueOnce({
      timestamp: '2026-07-31T00:00:00Z',
      portfolio_saved: false,
      llm_status: 'live',
      is_senior: false,
      total_score: 30,
      max_total_score: 48,
      criterion_scores: [],
      highlights: [],
      remediation_links: [],
      overall_feedback: 'Clear argument.',
      strengths: [],
      next_learning_steps: [],
    });

    render(<WritingAssessment />);
    expect(screen.getByRole('combobox', { name: /Year level/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Persuasive/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Use My Own Topic/i }));

    const draft = Array.from({ length: 55 }, (_, index) => `word${index}`).join(' ');
    fireEvent.change(screen.getByRole('textbox', { name: /Writing draft/i }), {
      target: { value: draft },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit for Assessment/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/portfolio save failed/i);
    expect(readWritingDocument(localStorage)?.draftText).toBe(draft);
    expect(localStorage.getItem('qld_tutor_writing_draft_text')).toBeNull();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 750));
    });
    expect(fetchWritingCompare).not.toHaveBeenCalled();
  });

  it('reuses the same assessment request ID after a timeout retry', async () => {
    vi.mocked(fetchWritingAssess)
      .mockRejectedValueOnce(new Error('Request timed out'))
      .mockResolvedValueOnce({
        timestamp: '2026-08-08T05:24:21Z',
        assessment_request_id: 'server-echo',
        portfolio_saved: true,
        llm_status: 'live',
        is_senior: false,
        total_score: 42,
        max_total_score: 47,
        criterion_scores: [],
        highlights: [],
        remediation_links: [],
        overall_feedback: 'Assessment recovered without a duplicate.',
        strengths: [],
        next_learning_steps: [],
      });

    render(<WritingAssessment />);
    fireEvent.click(screen.getByRole('button', { name: /^Persuasive/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Use My Own Topic/i }));
    const draft = Array.from({ length: 55 }, (_, index) => `retry${index}`).join(' ');
    fireEvent.change(screen.getByRole('textbox', { name: /Writing draft/i }), {
      target: { value: draft },
    });

    fireEvent.click(screen.getByRole('button', { name: /Submit for Assessment/i }));
    await waitFor(() => {
      expect(fetchWritingAssess).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /Submit for Assessment/i }).hasAttribute('disabled')).toBe(false);
    });

    fireEvent.click(screen.getByRole('button', { name: /Submit for Assessment/i }));
    await screen.findByText('Assessment recovered without a duplicate.');

    expect(fetchWritingAssess).toHaveBeenCalledTimes(2);
    const firstOptions = vi.mocked(fetchWritingAssess).mock.calls[0][4];
    const secondOptions = vi.mocked(fetchWritingAssess).mock.calls[1][4];
    expect(firstOptions?.assessmentRequestId).toBeTruthy();
    expect(secondOptions?.assessmentRequestId).toBe(firstOptions?.assessmentRequestId);
    expect(readWritingDocument(localStorage)?.pendingAssessment ?? null).toBeNull();
    expect(localStorage.getItem('qld_tutor_writing_pending_assessment')).toBeNull();
  });

  it('labels the senior analytical preset as a 120-minute timer with separate planning', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        promptType="analytical"
        isSenior={true}
        yearLevel={11}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /No timer/i }));
    expect(screen.getByText(/120 min writing timer — allow 15 min planning first/i)).toBeTruthy();
  });

  it('labels the senior narrative preset as a 120-minute timer with separate planning and school-condition warning', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        promptType="narrative"
        isSenior={true}
        yearLevel={11}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /No timer/i }));
    expect(screen.getByText(/120 min working timer — allow 15 min planning/i)).toBeTruthy();
    expect(screen.getByText(/check school conditions/i)).toBeTruthy();
  });

  it('does not recreate a cleared draft on pagehide after a durable portfolio save', async () => {
    vi.mocked(fetchWritingAssess).mockResolvedValueOnce({
      timestamp: '2026-07-31T00:01:00Z',
      portfolio_saved: true,
      llm_status: 'live',
      is_senior: false,
      total_score: 31,
      max_total_score: 48,
      criterion_scores: [],
      highlights: [],
      remediation_links: [],
      overall_feedback: 'Durably saved assessment.',
      strengths: [],
      next_learning_steps: [],
    });

    render(<WritingAssessment />);
    fireEvent.click(screen.getByRole('button', { name: /^Persuasive/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Use My Own Topic/i }));
    const draft = Array.from({ length: 55 }, (_, index) => `saved${index}`).join(' ');
    fireEvent.change(screen.getByRole('textbox', { name: /Writing draft/i }), {
      target: { value: draft },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit for Assessment/i }));

    await screen.findByText('Durably saved assessment.');
    expect(localStorage.getItem(WRITING_DOCUMENT_KEY)).toBeNull();
    expect(localStorage.getItem('qld_tutor_writing_draft_text')).toBeNull();
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(localStorage.getItem(WRITING_DOCUMENT_KEY)).toBeNull();
    expect(localStorage.getItem('qld_tutor_writing_draft_text')).toBeNull();
  });

  it('provides accessible name for the main writing textarea', () => {
    render(
      <WritingEditor
        {...baseEditorProps}
        draftText="Hello world"
      />
    );

    expect(screen.getByRole('textbox', { name: /Writing draft/i })).toBeTruthy();
  });

  it('shows truncated notice in portfolio when response has truncated=true', async () => {
    vi.mocked(fetchWritingHistory).mockResolvedValueOnce({
      student_id: 'test-student',
      assessments: [
        {
          timestamp: '2026-06-18T10:00:00Z',
          prompt_type: 'persuasive',
          year_level: 9,
          word_count: 600,
          total_score: 20,
          max_total_score: 48,
          criterion_scores: [],
          strengths: [],
          next_learning_steps: [],
          has_source_text: false,
          has_writer_statement: false,
          remediation_links: [],
        },
      ],
      truncated: true,
      total_assessments: 25,
    });

    render(<WritingPortfolio onBackToPractice={() => {}} onSelectTopic={() => {}} />);
    expect(await screen.findByText(/Showing your most recent assessments/i)).toBeTruthy();
    expect(screen.getByText(/1 of 25 total/i)).toBeTruthy();
  });

  it('shows the writing topic on each portfolio record', async () => {
    vi.mocked(fetchWritingHistory).mockResolvedValueOnce({
      student_id: 'test-student',
      assessments: [
        {
          timestamp: '2026-08-08T05:00:00Z',
          prompt_type: 'persuasive',
          year_level: 7,
          topic_id: 'junior-topic-1',
          topic_title: 'Should students have homework?',
          topic_prompt: 'Write a persuasive response about homework.',
          word_count: 385,
          total_score: 42,
          max_total_score: 47,
          criterion_scores: [],
          strengths: [],
          next_learning_steps: [],
          has_source_text: false,
          has_writer_statement: false,
          remediation_links: [],
        },
        {
          timestamp: '2026-08-08T05:01:00Z',
          prompt_type: 'narrative',
          year_level: 8,
          topic_id: null,
          topic_title: null,
          topic_prompt: null,
          word_count: 300,
          total_score: 20,
          max_total_score: 47,
          criterion_scores: [],
          strengths: [],
          next_learning_steps: [],
          has_source_text: false,
          has_writer_statement: false,
          remediation_links: [],
        },
      ],
      truncated: false,
      total_assessments: 2,
    });

    render(<WritingPortfolio onBackToPractice={() => {}} onSelectTopic={() => {}} />);

    expect(await screen.findByText('Should students have homework?')).toBeTruthy();
    expect(screen.getByText('Custom topic')).toBeTruthy();
  });

  it('does not show band in portfolio history cards', async () => {
    render(<WritingPortfolio onBackToPractice={() => {}} onSelectTopic={() => {}} />);

    await screen.findByText('Public Audience Written Response');
    expect(screen.queryByText(/Band/i)).toBeNull();
    expect(screen.queryByText(/^B\d$/)).toBeNull();
  });
});
