'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, Pause, Play, Target, Info, Lightbulb, BookOpen } from 'lucide-react';
import { PRESCRIBED_TEXT_LIST_NOTE, SENIOR_TASK_VERSION_NOTE, usesPrescribedText, type WritingTopic } from '../../lib/writing-topics';
import { getWritingGuidelines } from '../../lib/writing_guidelines';
import { WRITING_TIME_PRESETS, type WritingTimeMode } from '../../lib/writing_timer';

type TimeMode = WritingTimeMode;

interface Props {
  promptType: 'persuasive' | 'narrative' | 'analytical' | 'expository';
  selectedTopic: WritingTopic | null;
  topicWordLimit?: { min: number; max: number };
  isSenior?: boolean;
  yearLevel?: number;
  draftText: string;
  onChange: (text: string) => void;
  customTopicPrompt?: string;
  onCustomTopicPromptChange?: (text: string) => void;
  sourceText: string;
  onSourceTextChange: (text: string) => void;
  writerStatement: string;
  onWriterStatementChange: (text: string) => void;
  taskSheetText?: string;
  onTaskSheetTextChange?: (text: string) => void;
  schoolIsmgText?: string;
  onSchoolIsmgTextChange?: (text: string) => void;
  timeMode: TimeMode;
  timeRemaining: number;
  formattedTime: string;
  isTimerRunning: boolean;
  onTimerToggle: () => void;
  onTimeModeChange: (mode: TimeMode) => void;
  customMinutes: number;
  onCustomMinutesChange: (min: number) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  assessmentStage?: 'idle' | 'preparing' | 'assessing' | 'saving';
}

const NAPLAN_PERSUASIVE_CRITERIA = [
  { domain: 'Authorial', name: 'Audience', max: 6, hint: 'Capacity to orient, engage, and persuade the reader.' },
  { domain: 'Authorial', name: 'Text Structure', max: 4, hint: 'Organisation of structural components (introduction, body, conclusion).' },
  { domain: 'Authorial', name: 'Ideas', max: 5, hint: 'Selection, relevance, and elaboration of ideas for an argument.' },
  { domain: 'Authorial', name: 'Persuasive Devices', max: 4, hint: 'Use of rhetorical techniques (e.g., emotive language, rhetorical questions).' },
  { domain: 'Language', name: 'Vocabulary', max: 5, hint: 'Range and precision of language choices.' },
  { domain: 'Language', name: 'Cohesion', max: 4, hint: 'Control of multiple threads and relationships across the text.' },
  { domain: 'Language', name: 'Paragraphing', max: 3, hint: 'Segmenting text into paragraphs to support the argument structure.' },
  { domain: 'Language', name: 'Sentence Structure', max: 6, hint: 'Production of grammatically correct and meaningful sentences.' },
  { domain: 'Language', name: 'Punctuation', max: 5, hint: 'Correct and appropriate punctuation to aid reading.' },
  { domain: 'Language', name: 'Spelling', max: 6, hint: 'Accuracy of spelling and difficulty of words used.' },
];

const NAPLAN_NARRATIVE_CRITERIA = [
  { domain: 'Authorial', name: 'Audience', max: 6, hint: 'Capacity to orient, engage, and affect the reader.' },
  { domain: 'Authorial', name: 'Text Structure', max: 4, hint: 'Organisation of narrative features (orientation, complication, resolution).' },
  { domain: 'Authorial', name: 'Ideas', max: 5, hint: 'Creation, selection, and crafting of ideas for a story.' },
  { domain: 'Authorial', name: 'Character and Setting', max: 4, hint: 'Portrayal and development of characters and the sense of place/atmosphere.' },
  { domain: 'Language', name: 'Vocabulary', max: 5, hint: 'Range and precision of contextually appropriate language choices.' },
  { domain: 'Language', name: 'Cohesion', max: 4, hint: 'Control of multiple threads and relationships across the text.' },
  { domain: 'Language', name: 'Paragraphing', max: 2, hint: 'Segmenting text into paragraphs to assist the reader.' },
  { domain: 'Language', name: 'Sentence Structure', max: 6, hint: 'Production of grammatically correct and meaningful sentences.' },
  { domain: 'Language', name: 'Punctuation', max: 5, hint: 'Correct and appropriate punctuation to aid reading.' },
  { domain: 'Language', name: 'Spelling', max: 6, hint: 'Accuracy of spelling and the difficulty of the words used.' },
];

const JUNIOR_ANALYTICAL_CRITERIA = [
  { domain: 'TEEL', name: 'Point / Thesis', max: 5, hint: 'Clear topic sentence or thesis that answers the prompt.' },
  { domain: 'TEEL', name: 'Evidence / Integration', max: 5, hint: 'Relevant evidence or examples integrated smoothly.' },
  { domain: 'TEEL', name: 'Explanation / Analysis', max: 5, hint: 'Explains how language features, techniques, or ideas construct meaning.' },
  { domain: 'TEEL', name: 'Structure / Mechanics', max: 5, hint: 'Clear TEEL/PEEL structure and control of grammar, spelling, and punctuation.' },
];

const INFORMATIVE_CRITERIA = [
  { domain: 'Informative', name: 'Purpose and Audience', max: 5, hint: 'Clear informative purpose and awareness of what the reader needs to understand.' },
  { domain: 'Informative', name: 'Text Structure', max: 5, hint: 'Logical introduction, sequenced sections, and a useful conclusion.' },
  { domain: 'Informative', name: 'Ideas and Explanation', max: 5, hint: 'Relevant facts, examples, definitions, and clear explanations.' },
  { domain: 'Informative', name: 'Language and Cohesion', max: 5, hint: 'Precise vocabulary, cohesive links, varied sentences, and editing control.' },
];

const ISMG_ANALYTICAL_CRITERIA = [
  { domain: 'ISMG', name: 'Knowledge application', max: 9, hint: 'Analyse perspectives, representations, and the effects of stylistic devices.' },
  { domain: 'ISMG', name: 'Organisation and development', max: 8, hint: 'Synthesis of evidence from texts; logical sequencing of ideas.' },
  { domain: 'ISMG', name: 'Textual features', max: 8, hint: 'Discriminating language choices; control of grammar, punctuation, and spelling.' },
];

const ISMG_CREATIVE_CRITERIA = [
  { domain: 'ISMG', name: 'Knowledge application', max: 9, hint: 'Create perspectives effectively; manipulate aesthetic features for emotional response.' },
  { domain: 'ISMG', name: 'Organisation and development', max: 8, hint: 'Use of imaginative genre conventions (plot, characterisation); sequencing.' },
  { domain: 'ISMG', name: 'Textual features', max: 8, hint: 'Creative language choices; control of grammar, punctuation, and spelling.' },
];

const ISMG_PUBLIC_PERSUASIVE_CRITERIA = [
  { domain: 'ISMG', name: 'Knowledge application', max: 9, hint: 'Analyse perspectives, representations, values, and the effects of aesthetic or stylistic choices.' },
  { domain: 'ISMG', name: 'Organisation and development', max: 8, hint: 'Use public-audience genre conventions for the selected form; synthesise and connect subject matter.' },
  { domain: 'ISMG', name: 'Textual features', max: 8, hint: 'Discriminating language choices for audience and purpose; control of grammar and mechanics.' },
];

function getCriteria(promptType: string, isSenior: boolean) {
  if (isSenior) {
    if (promptType === 'narrative') return ISMG_CREATIVE_CRITERIA;
    if (promptType === 'analytical') return ISMG_ANALYTICAL_CRITERIA;
    return ISMG_PUBLIC_PERSUASIVE_CRITERIA;
  }
  if (promptType === 'persuasive') return NAPLAN_PERSUASIVE_CRITERIA;
  if (promptType === 'analytical') return JUNIOR_ANALYTICAL_CRITERIA;
  if (promptType === 'expository') return INFORMATIVE_CRITERIA;
  return NAPLAN_NARRATIVE_CRITERIA;
}

function getPlanHeadings(promptType: Props['promptType'], isSenior?: boolean): string[] {
  if (isSenior) {
    if (promptType === 'analytical') {
      return ['Thesis', 'Text evidence 1', 'Analysis of aesthetic/stylistic feature', 'Text evidence 2', 'Evaluation', 'Conclusion'];
    }
    if (promptType === 'narrative') {
      return ['Intended perspective', 'Representation', 'Aesthetic features', 'Structure', "Writer's statement notes"];
    }
    return ['Audience', 'Purpose', 'Representations/texts to analyse', 'Cultural assumptions/values', 'Public-audience genre conventions'];
  }
  if (promptType === 'persuasive') {
    return ['Position', 'Audience', 'Reason 1 and evidence', 'Reason 2 and evidence', 'Reason 3 and evidence', 'Conclusion'];
  }
  if (promptType === 'expository') {
    return ['Topic', 'Audience', 'Key fact 1', 'Example or explanation', 'Key fact 2', 'Conclusion'];
  }
  return ['Character', 'Setting', 'Complication', 'Turning point', 'Resolution', 'Language feature goal'];
}

function buildPlanHeadingText(headings: string[]): string {
  return headings.map(heading => `${heading}:`).join('\n');
}

function getChecklistItems(promptType: Props['promptType'], isSenior?: boolean): string[] {
  const items = ['I answered the prompt.', 'I used paragraphs.', 'I checked punctuation/spelling.'];
  if (promptType === 'analytical' || isSenior) items.push('I used evidence from the text.');
  if (promptType === 'expository') items.push('I explained facts clearly instead of just listing them.');
  if (isSenior && promptType === 'narrative') items.push("My writer's statement explains key choices.");
  return items;
}

const TIME_PRESETS: { value: TimeMode; label: string }[] = [
  { value: 'unlimited', label: 'No limit' },
  { value: 'naplan', label: WRITING_TIME_PRESETS.naplan.label },
  { value: 'qcaa', label: WRITING_TIME_PRESETS.qcaa.label },
  { value: 'custom', label: 'Custom' },
];

function getSeniorTimerLabel(promptType: Props['promptType']): string {
  if (promptType === 'analytical') return '120 min writing timer — allow 15 min planning first';
  if (promptType === 'narrative') return '120 min working timer — allow 15 min planning; check school conditions';
  if (promptType === 'persuasive') return '120 min practice — use Custom for school task conditions';
  return '120 min practice — use Custom for school task conditions';
}

export default function WritingEditor({
  promptType, selectedTopic, topicWordLimit, isSenior, yearLevel = 7, draftText, onChange,
  customTopicPrompt = '', onCustomTopicPromptChange = () => {},
  sourceText, onSourceTextChange,
  writerStatement, onWriterStatementChange,
  taskSheetText = '', onTaskSheetTextChange = () => {},
  schoolIsmgText = '', onSchoolIsmgTextChange = () => {},
  timeMode, timeRemaining, formattedTime, isTimerRunning,
  onTimerToggle, onTimeModeChange, customMinutes, onCustomMinutesChange,
  onSubmit, isSubmitting,
  assessmentStage = 'idle',
}: Props) {
  const [showCriteria, setShowCriteria] = useState(false);
  const [showTaskDetails, setShowTaskDetails] = useState(true);
  const [showTimerSetup, setShowTimerSetup] = useState(false);
  const [showHandbook, setShowHandbook] = useState(false);
  const [showSchoolTask, setShowSchoolTask] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [showPlanFirst, setShowPlanFirst] = useState(false);
  const [outline, setOutline] = useState(() => ({
    thesis: '',
    points: ['', '', ''], // Start with 3 arguments
    pov: '',
    complication: '',
    resolution: '',
    theme: '',
  }));
  const [planResponses, setPlanResponses] = useState<Record<string, string>>({});
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const criteria = getCriteria(promptType, isSenior ?? false);
  const writingGuide = getWritingGuidelines(promptType, isSenior);
  const wordCount = draftText.trim() ? draftText.trim().split(/\s+/).length : 0;
  const maxWords = topicWordLimit?.max ?? 2000;
  const overLimit = wordCount > maxWords;
  const nearLimit = wordCount > maxWords - 200 && wordCount <= maxWords;
  const isAnalytical = promptType === 'analytical';
  const isCustomTask = !selectedTopic;
  const needsWriterStatement = isSenior && promptType === 'narrative';
  const isNaplanYear = yearLevel === 7 || yearLevel === 9;
  const timerUrgent = timeRemaining > 0 && timeRemaining <= 60;
  const planHeadings = getPlanHeadings(promptType, isSenior);
  const checklistItems = getChecklistItems(promptType, isSenior);
  const requiredMinWords = isSenior ? 80 : 50;
  const suggestedMinWords = topicWordLimit?.min ?? requiredMinWords;
  const belowRequiredMinimum = wordCount > 0 && wordCount < requiredMinWords;
  const belowSuggestedMinimum = wordCount >= requiredMinWords && wordCount < suggestedMinWords;
  const needsCustomPrompt = isCustomTask && isAnalytical;
  const missingCustomPrompt = needsCustomPrompt && !customTopicPrompt.trim();
  const submitDisabled = isSubmitting || overLimit || !draftText.trim() || belowRequiredMinimum || (isAnalytical && !sourceText.trim()) || missingCustomPrompt;
  const wordTargetText = topicWordLimit
    ? `${topicWordLimit.min}-${topicWordLimit.max} words`
    : isSenior
      ? '600-1200 words, or your school task limit'
      : '300-800 words for a complete response';
  const timerPresets = TIME_PRESETS.map(p => (
    p.value === 'qcaa'
      ? { ...p, label: isSenior ? getSeniorTimerLabel(promptType) : 'Extended practice (120 min)' }
      : p
  ));

  const insertPlanHeadings = () => {
    const headingText = buildPlanHeadingText(planHeadings);
    onChange(draftText.trim() ? `${headingText}\n\n${draftText}` : `${headingText}\n`);
    setShowPlanFirst(false);
  };

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto', padding: '2rem 1rem' }}>
      {/* Header: title + word count + timer toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>
          {selectedTopic
            ? selectedTopic.title
            : isSenior
              ? ({ analytical: 'Analytical Essay (EA-style)', narrative: 'Imaginative (IA3-style)', persuasive: 'Public Audience Written Response' } as Record<string, string>)[promptType]
              : `Write Your ${promptType.charAt(0).toUpperCase() + promptType.slice(1)}`}
        </h2>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {/* Timer controls */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowTimerSetup(!showTimerSetup)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.35rem',
                padding: '6px 12px', borderRadius: '6px', fontSize: '13px',
                border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 600,
              }}
            >
              <Clock size={14} />
              {timeMode === 'unlimited' ? 'No timer' : formattedTime}
              <ChevronDown size={14} />
            </button>
            {showTimerSetup && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: '4px',
                background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                borderRadius: '8px', padding: '0.75rem', zIndex: 50,
                minWidth: '200px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}>
                {timerPresets.map(p => (
                  <button
                    key={p.value}
                    onClick={() => { onTimeModeChange(p.value); setShowTimerSetup(false); }}
                    style={{
                      display: 'block', width: '100%', padding: '6px 10px', fontSize: '13px',
                      textAlign: 'left', background: timeMode === p.value ? 'rgba(99,102,241,0.1)' : 'transparent',
                      border: 'none', borderRadius: '4px', cursor: 'pointer',
                      color: 'var(--text-primary)', fontWeight: timeMode === p.value ? 600 : 400,
                    }}
                  >
                    {p.label}
                  </button>
                ))}
                {timeMode === 'custom' && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={customMinutes}
                      aria-label="Custom time in minutes"
                      onChange={e => onCustomMinutesChange(Math.max(1, Math.min(180, Number(e.target.value))))}
                      style={{
                        width: '70px', padding: '4px 8px', fontSize: '13px',
                        border: '1px solid var(--border-color)', borderRadius: '4px',
                        background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                      }}
                    />
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>min</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Timer pause/play */}
          {timeMode !== 'unlimited' && (
            <button
              type="button"
              onClick={onTimerToggle}
              aria-label={isTimerRunning ? 'Pause timer' : 'Resume timer'}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                padding: '6px 10px', borderRadius: '6px', fontSize: '13px',
                border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 600,
              }}
              title={isTimerRunning ? 'Pause' : 'Resume'}
            >
              {isTimerRunning ? <Pause size={14} /> : <Play size={14} />}
            </button>
          )}

          <span style={{
            fontSize: '0.75rem',
            color: 'var(--success)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginRight: '0.5rem',
            background: 'rgba(34,197,94,0.06)',
            padding: '2px 8px',
            borderRadius: '12px',
            border: '1px solid rgba(34,197,94,0.15)',
            fontWeight: 500,
          }}>
            <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success)' }} />
            Saved locally
          </span>

          <span style={{
            fontSize: '0.875rem', fontWeight: 600,
            color: overLimit ? 'var(--error)' : nearLimit ? '#f59e0b' : 'var(--text-secondary)',
          }}>
            {wordCount} / {maxWords} words
          </span>
        </div>
      </div>

      {isSenior && (
        <div style={{
          padding: '0.75rem 1rem', marginBottom: '1rem',
          background: 'rgba(139,92,246,0.10)', border: '1px solid rgba(139,92,246,0.25)',
          borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5,
        }}>
          <strong style={{ color: '#8b5cf6' }}>Practice feedback modelled on QCAA English ISMG categories.</strong> Your official result depends on your school task sheet, exact ISMG, assessment conditions, and teacher/QCAA confirmation.
          {promptType === 'narrative' && (
            <span> For IA3-style practice, use the studied text as a springboard and check your teacher&apos;s exam conditions, including note/source access.</span>
          )}
        </div>
      )}

      {isSenior && (
        <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem', borderLeft: '4px solid #8b5cf6' }}>
          <button
            onClick={() => setShowSchoolTask(prev => !prev)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer',
              fontSize: '0.95rem', fontWeight: 700, padding: 0,
            }}
          >
            <span>School task sheet / ISMG</span>
            {showSchoolTask ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
          {showSchoolTask && (
            <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.9rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Task sheet
                <textarea
                  value={taskSheetText}
                  onChange={e => onTaskSheetTextChange(e.target.value)}
                  placeholder="Paste your school task instructions, audience, purpose, conditions, and word limit..."
                  style={{ minHeight: 120, padding: '0.65rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem', lineHeight: 1.5 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                ISMG / criteria
                <textarea
                  value={schoolIsmgText}
                  onChange={e => onSchoolIsmgTextChange(e.target.value)}
                  placeholder="Paste the criteria or ISMG your teacher gave you..."
                  style={{ minHeight: 120, padding: '0.65rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem', lineHeight: 1.5 }}
                />
              </label>
              <p style={{ gridColumn: '1 / -1', margin: 0, color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                The AI will use pasted school material as task context, but feedback remains formative and is not an official mark.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Timer urgency banner */}
      {timeMode !== 'unlimited' && timerUrgent && (
        <div style={{
          padding: '0.5rem 1rem', marginBottom: '1rem',
          background: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444',
          borderRadius: '8px', color: '#ef4444', fontWeight: 700, fontSize: '0.9rem',
          textAlign: 'center', animation: 'pulse 1s ease-in-out infinite',
        }}>
          ⏱ Time is almost up! {formattedTime} remaining.
        </div>
      )}

      {/* Topic/Task Details — High Visibility */}
      {selectedTopic && (
        <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-color)' }}>
              <Target size={18} />
              <span style={{ fontWeight: 700, fontSize: '0.9rem', textTransform: 'uppercase' }}>Current Task</span>
            </div>
            <button 
              onClick={() => setShowTaskDetails(!showTaskDetails)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              {showTaskDetails ? 'Hide Details' : 'Show Details'}
            </button>
          </div>
          
          <p style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: showTaskDetails ? '1rem' : 0, lineHeight: 1.5 }}>
            {selectedTopic.prompt}
          </p>

          {showTaskDetails && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                {(selectedTopic.targetAudience || selectedTopic.mode) && (
                  <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Audience / form:</strong>{' '}
                    {[selectedTopic.targetAudience, selectedTopic.mode].filter(Boolean).join(' | ')}
                  </div>
                )}
                {selectedTopic.prescribedText && (
                  <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Prescribed text:</strong> {selectedTopic.prescribedText}
                    {isSenior && usesPrescribedText(selectedTopic) && (
                      <div style={{ marginTop: '0.35rem' }}>{PRESCRIBED_TEXT_LIST_NOTE}</div>
                    )}
                  </div>
                )}
                {(selectedTopic.wordLimit || topicWordLimit) && (
                  <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Word limit:</strong>{' '}
                    {(selectedTopic.wordLimit || topicWordLimit)!.min}-{(selectedTopic.wordLimit || topicWordLimit)!.max} words
                  </div>
                )}
                {selectedTopic.taskConditions && (
                  <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Task conditions:</strong>{' '}
                    {[
                      selectedTopic.taskConditions.label,
                      selectedTopic.taskConditions.planningMinutes !== undefined ? `${selectedTopic.taskConditions.planningMinutes} min planning` : null,
                      selectedTopic.taskConditions.writingMinutes !== undefined ? `${selectedTopic.taskConditions.writingMinutes} min writing` : null,
                      selectedTopic.taskConditions.conditionsNote,
                    ].filter(Boolean).join('; ')}
                  </div>
                )}
                {selectedTopic.officialSource && (
                  <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Source:</strong>{' '}
                    {[selectedTopic.officialSource.label, selectedTopic.officialSource.note].filter(Boolean).join(' - ')}
                  </div>
                )}
                {selectedTopic.stimulusText && !isAnalytical && (
                  <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Stimulus note:</strong> stimulus text is included with this task.
                  </div>
                )}
              </div>
              {selectedTopic.context && (
                <p style={{ margin: '0 0 1rem', fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Context:</strong> {selectedTopic.context}
                </p>
              )}
              {isSenior && (
                <p style={{ margin: '0 0 1rem', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Syllabus:</strong> {SENIOR_TASK_VERSION_NOTE}
                </p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
              {selectedTopic.guidingQuestions && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    <Info size={14} />
                    <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>GUIDING QUESTIONS</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {selectedTopic.guidingQuestions.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
              )}
              {(selectedTopic.writingTips || selectedTopic.thinkAbout) && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#f59e0b', marginBottom: '0.5rem' }}>
                    <Lightbulb size={14} />
                    <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>WRITING TIPS</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {(selectedTopic.writingTips || selectedTopic.thinkAbout || []).map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.25rem', borderLeft: '4px solid #8b5cf6' }}>
        <button
          type="button"
          onClick={() => setShowPlanFirst(prev => !prev)}
          aria-expanded={showPlanFirst}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer',
            fontSize: '1rem', fontWeight: 700, padding: 0, textAlign: 'left', gap: '12px',
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span>Plan before writing (optional)</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Spend 3–5 minutes organising ideas, or start drafting immediately below.
            </span>
          </span>
          {showPlanFirst ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        {showPlanFirst && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Use these optional brainstorming prompts before drafting. Your notes stay local in this browser and are not submitted separately.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
              {planHeadings.map((heading) => (
                <label key={heading} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {heading}
                  <textarea
                    value={planResponses[heading] || ''}
                    onChange={e => setPlanResponses(prev => ({ ...prev, [heading]: e.target.value }))}
                    placeholder={`Brainstorm your ${heading.toLowerCase()}...`}
                    style={{ minHeight: 72, padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem' }}
                  />
                </label>
              ))}
            </div>
            <button
              onClick={insertPlanHeadings}
              className="btn-secondary"
              style={{ alignSelf: 'flex-start', padding: '0.5rem 0.9rem', fontSize: '0.85rem', color: 'var(--text-primary)' }}
            >
              Insert brainstorm headings into draft
            </button>
          </div>
        )}
      </div>

      {isPlanning ? (
        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', color: 'var(--accent-color)' }}>
            <BookOpen size={24} />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Pre-Writing Planning Wizard</h3>
          </div>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            Lower your cognitive load by planning your structure before writing. Research shows that outlining leads to higher-scoring essays.
          </p>

          {promptType === 'narrative' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label htmlFor="outline-pov" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-primary)' }}>Narrative Point of View (POV)</label>
                <input
                  id="outline-pov"
                  type="text"
                  placeholder="e.g., First-person (I, we) or Third-person limited (he, she)"
                  value={outline.pov}
                  onChange={e => setOutline(prev => ({ ...prev, pov: e.target.value }))}
                  style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label htmlFor="outline-complication" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-primary)' }}>Central Complication (The Conflict)</label>
                <textarea
                  id="outline-complication"
                  placeholder="What is the main problem or turning point that happens in the story?"
                  value={outline.complication}
                  onChange={e => setOutline(prev => ({ ...prev, complication: e.target.value }))}
                  style={{ width: '100%', minHeight: 80, padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', resize: 'vertical' }}
                />
              </div>
              <div>
                <label htmlFor="outline-resolution" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-primary)' }}>Resolution</label>
                <textarea
                  id="outline-resolution"
                  placeholder="How does the conflict end?"
                  value={outline.resolution}
                  onChange={e => setOutline(prev => ({ ...prev, resolution: e.target.value }))}
                  style={{ width: '100%', minHeight: 80, padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', resize: 'vertical' }}
                />
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label htmlFor="outline-thesis" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-primary)' }}>Thesis Statement</label>
                <textarea
                  id="outline-thesis"
                  placeholder="What is your clear, arguable response to the prompt? (e.g. School uniforms should be banned because...)"
                  value={outline.thesis}
                  onChange={e => setOutline(prev => ({ ...prev, thesis: e.target.value }))}
                  style={{ width: '100%', minHeight: 60, padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', resize: 'vertical' }}
                />
              </div>
              
              {outline.points.map((arg, idx) => (
                <div key={idx}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                    <label htmlFor={`outline-point-${idx}`} style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Argument Point {idx + 1}
                    </label>
                    {outline.points.length > 1 && (
                      <button
                        onClick={() => {
                          setOutline(prev => {
                            const newPoints = prev.points.filter((_, i) => i !== idx);
                            return { ...prev, points: newPoints };
                          });
                        }}
                        style={{
                          background: 'none', border: 'none', color: 'var(--error)',
                          cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <input
                    id={`outline-point-${idx}`}
                    type="text"
                    placeholder={`e.g. Reason ${idx + 1} supporting your thesis`}
                    value={arg}
                    onChange={e => {
                      const val = e.target.value;
                      setOutline(prev => {
                        const newPoints = [...prev.points];
                        newPoints[idx] = val;
                        return { ...prev, points: newPoints };
                      });
                    }}
                    style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  />
                </div>
              ))}

              {outline.points.length < 6 && (
                <button
                  onClick={() => {
                    setOutline(prev => ({ ...prev, points: [...prev.points, ''] }));
                  }}
                  className="btn-secondary"
                  style={{ alignSelf: 'flex-start', padding: '0.4rem 1rem', fontSize: '0.8rem', color: 'var(--text-primary)' }}
                >
                  + Add Argument Point ({6 - outline.points.length} remaining)
                </button>
              )}
            </div>
          )}

          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setIsPlanning(false)}
              className="btn-primary"
              style={{ padding: '0.6rem 2rem', fontSize: '0.95rem' }}
            >
              Start Writing Draft
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
          {/* Main Column */}
          <div style={{ flex: '3 1 600px', minWidth: '320px' }}>
            {/* Source text input (analytical only) */}
            {isAnalytical && (
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="writing-source-text" style={{
            display: 'block', fontSize: '0.875rem', fontWeight: 600,
            color: 'var(--text-primary)', marginBottom: '0.4rem',
          }}>
            Source Text {selectedTopic?.prescribedText ? `(${selectedTopic.prescribedText})` : '(the text you are analysing)'}
          </label>
          <textarea
            id="writing-source-text"
            value={sourceText}
            onChange={(e) => onSourceTextChange(e.target.value)}
            placeholder={selectedTopic?.stimulusText || `Paste the passage / text you are analysing here...\n\nMake sure to include the full text so the AI can evaluate how well you analyse it.`}
            style={{
              width: '100%', minHeight: 120, padding: '0.75rem',
              fontSize: '0.9rem', lineHeight: 1.6,
              fontFamily: 'Inter, sans-serif', color: 'var(--text-primary)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)', borderRadius: '12px',
              resize: 'vertical', outline: 'none',
            }}
          />
          {!sourceText.trim() && (
            <p style={{ fontSize: '0.8rem', color: '#f59e0b', marginTop: '0.3rem' }}>
              Analytical essays require a source text to be assessed.
            </p>
          )}
        </div>
      )}

      {/* Assessment Criteria — collapsible */}
      <div style={{ marginBottom: '1rem' }}>
        <button
          onClick={() => setShowCriteria(!showCriteria)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.5rem 0.75rem', borderRadius: '8px',
            border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
            cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 600,
            fontSize: '0.875rem',
          }}
        >
          {showCriteria ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          How Your Writing Will Be Assessed
          {isSenior
            ? ` (${criteria.length} QCAA-style formative criteria)`
            : isNaplanYear
              ? ` (${criteria.length} NAPLAN-style Criteria, ${promptType})`
              : ` (${criteria.length} Junior Writing Criteria, ${promptType})`}
        </button>
        {showCriteria && (
          <div style={{
            marginTop: '0.5rem', padding: '1.25rem',
            border: '1px solid var(--border-color)', borderRadius: '8px',
            background: 'var(--bg-secondary)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1rem' }}>
              {criteria.map(c => (
                <div key={c.name} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                  <span style={{
                    minWidth: '2.5rem', height: '1.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '8px', fontSize: '0.9rem', fontWeight: 700,
                    background: c.domain === 'Authorial' ? 'rgba(59,130,246,0.15)' : c.domain === 'ISMG' ? 'rgba(139,92,246,0.15)' : 'rgba(16,185,129,0.15)',
                    color: c.domain === 'Authorial' ? '#3b82f6' : c.domain === 'ISMG' ? '#8b5cf6' : '#10b981',
                  }}>
                    {c.max}
                  </span>
                  <div>
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>(/{c.max})</span>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0', lineHeight: 1.5 }}>
                      {c.hint}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Custom task prompt */}
      {isCustomTask && (
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="writing-task-prompt" style={{
            display: 'block', fontSize: '0.875rem', fontWeight: 600,
            color: 'var(--text-primary)', marginBottom: '0.4rem',
          }}>
            Task / Prompt {needsCustomPrompt ? '(required for analytical practice)' : '(optional but recommended)'}
          </label>
          <textarea
            id="writing-task-prompt"
            value={customTopicPrompt}
            onChange={(e) => onCustomTopicPromptChange(e.target.value)}
            placeholder="Paste your teacher's prompt or write the question you are responding to..."
            style={{
              width: '100%', minHeight: 90, padding: '0.75rem',
              fontSize: '0.9rem', lineHeight: 1.6,
              fontFamily: 'Inter, sans-serif', color: 'var(--text-primary)',
              background: 'var(--bg-secondary)',
              border: missingCustomPrompt ? '2px solid #f59e0b' : '1px solid var(--border-color)',
              borderRadius: '12px',
              resize: 'vertical', outline: 'none',
            }}
          />
          {missingCustomPrompt && (
            <p style={{ fontSize: '0.8rem', color: '#f59e0b', marginTop: '0.3rem' }}>
              Add the analytical question so the feedback can judge how directly you answered it.
            </p>
          )}
        </div>
      )}

      {/* Main draft textarea */}
      <textarea
        aria-label="Writing draft"
        value={draftText}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Start writing your ${promptType === 'expository' ? 'informative/expository' : promptType} text here...\n\n- Use Australian English spelling (colour, organise, analyse)\n- Structure your writing with clear paragraphs\n- Aim for ${wordTargetText}`}
        disabled={isSubmitting}
        className="glass-card"
        style={{
          width: '100%',
          minHeight: 600,
          padding: '1.25rem',
          fontSize: '1rem',
          lineHeight: 1.8,
          fontFamily: 'Inter, sans-serif',
          color: 'var(--text-primary)',
          background: 'var(--bg-secondary)',
          border: overLimit ? '2px solid var(--error)' : '1px solid var(--border-color)',
          borderRadius: '12px',
          resize: 'vertical',
          outline: 'none',
        }}
      />

      {/* Writer's Statement (senior creative only) */}
      {needsWriterStatement && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{
            padding: '0.75rem 1rem', marginBottom: '0.5rem',
            background: 'rgba(139,92,246,0.1)', borderRadius: '8px',
            border: '1px solid rgba(139,92,246,0.2)',
          }}>
            <h3 id="writer-statement-heading" style={{ fontSize: '0.95rem', fontWeight: 600, color: '#8b5cf6', marginBottom: '0.25rem' }}>
              Optional writer reflection
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Use this if your school task asks for a writer&apos;s statement or reflection. Explain the genre,
              perspective, language features, and reader effect you were aiming for.
            </p>
          </div>
          <textarea
            aria-labelledby="writer-statement-heading"
            value={writerStatement}
            onChange={(e) => onWriterStatementChange(e.target.value)}
            placeholder={`Explain your creative choices:\n\n- What genre or form did you choose and why?\n- How did you use language features to create meaning?\n- What effect did you want to have on the reader?\n- What literary devices did you use and to what effect?`}
            style={{
              width: '100%', minHeight: 150, padding: '0.75rem',
              fontSize: '0.9rem', lineHeight: 1.6,
              fontFamily: 'Inter, sans-serif', color: 'var(--text-primary)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)', borderRadius: '12px',
              resize: 'vertical', outline: 'none',
            }}
          />
        </div>
      )}

      {overLimit && (
        <p style={{ color: 'var(--error)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
          Your draft exceeds the {maxWords} word limit. Please trim it before submitting.
        </p>
      )}

      {belowSuggestedMinimum && (
        <p style={{ color: '#f59e0b', fontSize: '0.875rem', marginTop: '0.5rem' }}>
          This task needs at least {suggestedMinWords} words for a score. You have {wordCount} ({suggestedMinWords - wordCount} more). If you submit now, you get short-draft feedback, not a score.
        </p>
      )}

      {belowRequiredMinimum && (
        <p style={{ color: 'var(--error)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
          Your draft needs at least {requiredMinWords} words before it can be assessed. You have {wordCount} ({requiredMinWords - wordCount} more).
        </p>
      )}

      <div className="glass-card" style={{ padding: '1rem', marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>Optional pre-submit checklist</div>
        {checklistItems.map(item => (
          <label key={item} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={!!checkedItems[item]}
              onChange={e => setCheckedItems(prev => ({ ...prev, [item]: e.target.checked }))}
            />
            {item}
          </label>
        ))}
      </div>

      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onSubmit}
          disabled={submitDisabled}
          className="btn-primary"
          style={{
            padding: '0.75rem 2rem',
            fontSize: '1rem',
            fontWeight: 600,
            opacity: submitDisabled ? 0.5 : 1,
          }}
        >
          {isSubmitting ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{
                display: 'inline-block',
                width: 16, height: 16,
                border: '2px solid #fff',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              Assessing...
            </span>
          ) : belowSuggestedMinimum ? (
            'Get short-draft feedback (not scored)'
          ) : (
            'Submit for Assessment'
          )}
        </button>
      </div>

      {/* The live region stays mounted so screen readers announce each new stage. */}
      <div
        role="status"
        aria-live="polite"
        style={{
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: '0.82rem',
          marginTop: isSubmitting ? '0.75rem' : 0,
          lineHeight: 1.5,
        }}
      >
        {isSubmitting && (
          <>
            <strong style={{ color: 'var(--text-primary)' }}>
              {assessmentStage === 'preparing'
                ? 'Preparing your assessment…'
                : assessmentStage === 'saving'
                  ? 'Saving your assessment…'
                  : 'Assessing your writing…'}
            </strong>
            <br />
            This can take up to about 3 minutes; keep this tab open.
          </>
        )}
      </div>
          </div>

          {/* Sidebar Column */}
          <div style={{ flex: '1 1 300px', minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => setIsPlanning(true)}
                className="btn-secondary"
                style={{
                  flex: 1, padding: '0.5rem', fontSize: '0.85rem',
                  display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center',
                  color: 'var(--text-primary)'
                }}
              >
                <Target size={14} /> Edit Plan
              </button>
              <button
                onClick={() => setShowHandbook(!showHandbook)}
                className="btn-secondary"
                style={{
                  flex: 1, padding: '0.5rem', fontSize: '0.85rem',
                  display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center',
                  background: showHandbook ? 'rgba(99,102,241,0.1)' : 'transparent',
                  color: 'var(--text-primary)'
                }}
              >
                <BookOpen size={14} /> Writing Guide
              </button>
            </div>

            {/* Student's Plan Outline Summary */}
            <div className="glass-panel" style={{ padding: '1rem' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-color)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Target size={14} /> Your Writing Plan
              </h4>
              {promptType === 'narrative' ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div><strong>POV:</strong> {outline.pov || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Not planned</span>}</div>
                  <div style={{ wordBreak: 'break-word', lineHeight: 1.4 }}><strong>Complication:</strong> {outline.complication || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Not planned</span>}</div>
                  <div style={{ wordBreak: 'break-word', lineHeight: 1.4 }}><strong>Resolution:</strong> {outline.resolution || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Not planned</span>}</div>
                </div>
              ) : (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ wordBreak: 'break-word', lineHeight: 1.4 }}><strong>Thesis:</strong> {outline.thesis || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Not planned</span>}</div>
                  {outline.points.map((pt, idx) => (
                    <div key={idx} style={{ wordBreak: 'break-word', lineHeight: 1.4 }}>
                      <strong>Point {idx + 1}:</strong> {pt || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Not planned</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Handbook Guide */}
            {showHandbook && (
              <div className="glass-panel" style={{ padding: '1.25rem', maxHeight: '600px', overflowY: 'auto' }}>
                <h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BookOpen size={18} /> {writingGuide?.title || 'Writing Guide'}
                </h4>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                  {writingGuide?.description}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {writingGuide?.criteria.map((c, i) => (
                    <div key={i} style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '4px' }}>{c.text}</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.5 }}>{c.explanation}</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--success)', marginTop: '6px', background: 'rgba(34,197,94,0.06)', padding: '8px', borderRadius: '6px', lineHeight: 1.5 }}>
                        <strong>Example:</strong> {c.example}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--error)', marginTop: '6px', background: 'rgba(239,68,68,0.06)', padding: '8px', borderRadius: '6px', lineHeight: 1.5 }}>
                        <strong>Avoid:</strong> {c.mistake}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
