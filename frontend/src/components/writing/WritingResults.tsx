'use client';
import { useState, useEffect } from 'react';
import type { CriterionScore, WritingHighlight, CognitiveVerbScore, NextLearningStep, RevisionPlanItem, ParagraphFeedback, SourceUseFeedback, WritingSkillDrill, Curriculum, GrammarRemediationResponse, WritingRevisionCompareResponse } from '../../lib/api-types';
import { fetchCurriculum } from '../../lib/api';
import { getTopicDisplayName } from '../../lib/curriculum_helpers';
import ReactMarkdown from 'react-markdown';
import WritingByoPanel from './WritingByoPanel';

const markdownComponents = {
  ul: ({ children }: any) => <ul style={{ listStyleType: 'disc', paddingLeft: '1.25rem', margin: '0.4rem 0' }}>{children}</ul>,
  ol: ({ children }: any) => <ol style={{ listStyleType: 'decimal', paddingLeft: '1.25rem', margin: '0.4rem 0' }}>{children}</ol>,
  p: ({ children }: any) => <p style={{ margin: '0.4rem 0', lineHeight: 1.6 }}>{children}</p>,
  li: ({ children }: any) => <li style={{ margin: '0.2rem 0' }}>{children}</li>,
  strong: ({ children }: any) => <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>,
};

type HighlightSegment = { text: string; highlight?: WritingHighlight };

// Correctness labels are errors; every other label is an optional suggestion.
const ERROR_ISSUE_RE = /error|spelling|punctuation|grammar|fragment|run_on|tense|agreement|capitali[sz]|apostrophe|comma_splice/i;

function highlightKind(issueType: string): { label: string; color: string; background: string } {
  return ERROR_ISSUE_RE.test(issueType)
    ? { label: 'Error', color: 'var(--error)', background: 'rgba(239,68,68,0.22)' }
    : { label: 'Suggestion', color: 'var(--accent-color)', background: 'rgba(99,102,241,0.2)' };
}

function buildHighlightSegments(text: string, highlights: WritingHighlight[]): HighlightSegment[] {
  if (!text) return [];
  const ordered = highlights
    .filter(item => Number.isInteger(item.start_index) && Number.isInteger(item.end_index))
    .filter(item => item.start_index >= 0 && item.end_index > item.start_index)
    .sort((a, b) => a.start_index - b.start_index || a.end_index - b.end_index);
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const highlight of ordered) {
    const start = Math.max(cursor, Math.min(text.length, highlight.start_index));
    const end = Math.max(start, Math.min(text.length, highlight.end_index));
    if (end <= start) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    segments.push({ text: text.slice(start, end), highlight });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

interface Props {
  isSenior?: boolean;
  yearLevel?: number;
  promptType?: 'persuasive' | 'narrative' | 'analytical' | 'expository' | null;
  totalScore: number;
  maxTotalScore: number;
  criterionScores: CriterionScore[];
  highlights: WritingHighlight[];
  draftText?: string;
  remediationLinks: string[];
  overallFeedback: string;
  strengths: string[];
  nextLearningSteps: NextLearningStep[];
  revisionPlan?: RevisionPlanItem[];
  paragraphFeedback?: ParagraphFeedback | null;
  sourceUseFeedback?: SourceUseFeedback | null;
  writingSkillDrills?: WritingSkillDrill[];
  grammarRemediation?: GrammarRemediationResponse | null;
  grammarRemediationLoading?: boolean;
  revisionCompare?: WritingRevisionCompareResponse | null;
  compareLoading?: boolean;
  taskAlignmentWarnings?: string[];
  writerStatementFeedback?: string;
  cognitiveVerbScores?: CognitiveVerbScore[];
  llmStatus?: 'live' | 'mock' | 'external' | 'skipped';
  insufficientEvidence?: boolean;
  onExportPrompt?: () => Promise<import('../../lib/api').WritingPromptExport>;
  onImportResult?: (externalText: string) => Promise<void>;
  onEdit: () => void;
  onPracticeTopics?: (topicIds: string[]) => void;
  onLoadGrammarRemediation?: () => void;
  canRetry: boolean;
  iterationCount: number;
}

export default function WritingResults({
  isSenior, yearLevel, totalScore, maxTotalScore,
  criterionScores, highlights,
  draftText = '',
  remediationLinks, overallFeedback, strengths, nextLearningSteps,
  revisionPlan = [], paragraphFeedback,
  sourceUseFeedback, writingSkillDrills = [], grammarRemediation = null,
  grammarRemediationLoading = false, revisionCompare = null, compareLoading = false,
  taskAlignmentWarnings = [],
  writerStatementFeedback, cognitiveVerbScores,
  llmStatus,
  insufficientEvidence = false,
  onExportPrompt, onImportResult,
  onEdit, onPracticeTopics, onLoadGrammarRemediation, canRetry, iterationCount,
}: Props) {
  const percentage = maxTotalScore > 0
    ? Math.round((totalScore / maxTotalScore) * 100)
    : 0;
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const visibleStrengths = strengths.filter(s => s.trim());
  const visibleNextSteps = nextLearningSteps.filter(s => s.priority_goal?.trim() || s.recommendation?.trim());
  const visibleRevisionPlan = revisionPlan.filter(item => item.target?.trim() && item.how?.trim()).slice(0, 3);
  const criterionDeltas = (revisionCompare?.original_criterion_scores || [])
    .map(original => {
      const current = criterionScores.find(cs => cs.criterion_number === original.criterion_number);
      if (!current) return null;
      return {
        criterionNumber: current.criterion_number,
        name: current.name || original.name,
        previous: original.score,
        current: current.score,
        maxScore: current.max_score || original.max_score,
        delta: current.score - original.score,
      };
    })
    .filter((item): item is {
      criterionNumber: number;
      name: string;
      previous: number;
      current: number;
      maxScore: number;
      delta: number;
    } => item !== null);
  const hasGrammarRemediation = Boolean(
    grammarRemediationLoading
    || grammarRemediation?.revision_task?.trim()
    || (grammarRemediation?.drills?.length || 0) > 0
    || (grammarRemediation?.writing_skill_drills?.length || 0) > 0
  );
  const grammarRemediationTitle = grammarRemediation?.grammar_focus ? 'Grammar-in-Context Revision' : 'Writing-Skill Revision';
  const hasParagraphFeedback = Boolean(
    paragraphFeedback?.strongest_paragraph?.trim()
    || paragraphFeedback?.paragraph_to_revise_first?.trim()
    || paragraphFeedback?.sentence_level_improvement?.trim()
  );
  const isMockResult = llmStatus === 'mock';
  const mockSafeText = (value: string) => !/LLM_API_KEY|\.env|enable (?:full )?AI|connect an AI|AI marking/i.test(value);
  const mockNextSteps = visibleNextSteps.filter(step => mockSafeText(`${step.priority_goal} ${step.why_it_matters} ${step.recommendation}`));
  const mockRevisionPlan = visibleRevisionPlan.filter(item => mockSafeText(`${item.target} ${item.why} ${item.how}`));
  const highlightedDraft = buildHighlightSegments(draftText, highlights);

  useEffect(() => {
    const requestedScope = !isSenior && yearLevel && yearLevel >= 7 && yearLevel <= 10
      ? { subject: 'english', scope: `year${yearLevel}` }
      : undefined;
    fetchCurriculum(undefined, requestedScope)
      .then(setCurriculum)
      .catch(err => console.error("Failed to load curriculum:", err));
  }, [isSenior, yearLevel]);

  if (insufficientEvidence) {
    return (
      <div style={{ maxWidth: 1125, margin: '0 auto', padding: '2rem 1rem' }}>
        <div role="status" style={{
          padding: '1rem 1.1rem', marginBottom: '1.25rem', borderRadius: '10px',
          background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)',
          color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: 1.55,
        }}>
          <strong>Not enough evidence for a fair score yet.</strong> This response is guidance only and has not been scored or saved as a portfolio assessment.
        </div>
        <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.25rem', borderLeft: '4px solid #f59e0b' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.6rem' }}>
            Build out the draft before Assess
          </h2>
          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <ReactMarkdown components={markdownComponents}>{overallFeedback}</ReactMarkdown>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.5, marginBottom: 0 }}>
            Add developed ideas, evidence, and explanation, then assess again. This attempt does not use a revision slot.
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button onClick={onEdit} className="btn-primary" style={{ padding: '0.75rem 2rem' }}>
            Continue editing
          </button>
        </div>
      </div>
    );
  }

  if (isMockResult) {
    return (
      <div style={{ maxWidth: 1125, margin: '0 auto', padding: '2rem 1rem' }}>
        <div role="status" style={{
          padding: '0.95rem 1.1rem', marginBottom: '1.25rem', borderRadius: '10px',
          background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)',
          color: 'var(--text-primary)', fontSize: '0.88rem', lineHeight: 1.55,
        }}>
          <strong>Local draft pre-check only.</strong> No AI assessment was completed, so no score or criterion marks are shown. Use your own AI below for a full formative assessment, or continue editing the draft.
        </div>

        {(onExportPrompt && onImportResult) && (
          <WritingByoPanel prominent onExport={onExportPrompt} onImport={onImportResult} />
        )}

        <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.25rem', borderLeft: '4px solid #f59e0b' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.6rem' }}>
            Local draft pre-check
          </h2>
          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <ReactMarkdown components={markdownComponents}>{overallFeedback || 'Your draft was saved. A full ideas, structure and evidence assessment requires a live or external AI result.'}</ReactMarkdown>
          </div>
        </div>

        {visibleStrengths.length > 0 && (
          <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--success)', marginBottom: '0.65rem' }}>
              What the pre-check confirmed
            </h3>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              {visibleStrengths.map((strength, index) => <li key={index}>{strength}</li>)}
            </ul>
          </div>
        )}

        {(mockNextSteps.length > 0 || mockRevisionPlan.length > 0 || hasParagraphFeedback) && (
          <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.65rem' }}>
              Mechanical checks to revise
            </h3>
            <div style={{ display: 'grid', gap: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.86rem', lineHeight: 1.55 }}>
              {mockNextSteps.map((step, index) => (
                <div key={`step-${index}`}>
                  <strong style={{ color: 'var(--text-primary)' }}>{step.priority_goal || 'Revision step'}:</strong>{' '}
                  {step.recommendation || step.why_it_matters}
                </div>
              ))}
              {mockRevisionPlan.map((item, index) => (
                <div key={`plan-${index}`}>
                  <strong style={{ color: 'var(--text-primary)' }}>{item.target}:</strong> {item.how}
                </div>
              ))}
              {paragraphFeedback?.sentence_level_improvement && (
                <div>
                  <strong style={{ color: 'var(--text-primary)' }}>Sentence check:</strong> {paragraphFeedback.sentence_level_improvement}
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button onClick={onEdit} className="btn-primary" style={{ padding: '0.75rem 2rem' }}>
            Edit draft
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1125, margin: '0 auto', padding: '2rem 1rem' }}>
      {llmStatus === 'external' && (
        <div style={{
          padding: '0.7rem 1.1rem', marginBottom: '1.25rem', borderRadius: '10px',
          background: 'rgba(8,145,178,0.10)', border: '1px solid rgba(8,145,178,0.3)',
          color: 'var(--text-primary)', fontSize: '0.82rem', lineHeight: 1.5,
        }}>
          🤖 Assessed by an external AI you chose — formative practice feedback, not official marking.
        </div>
      )}

      {(onExportPrompt && onImportResult) && (
        <WritingByoPanel
          prominent={false}
          onExport={onExportPrompt}
          onImport={onImportResult}
        />
      )}

      {/* Score Overview */}
      <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', marginBottom: '1.5rem' }}>
        {isSenior ? (
          <div style={{
            padding: '0.75rem 1.5rem', borderRadius: '12px',
            background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
            display: 'inline-block', marginBottom: '1rem',
          }}>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#8b5cf6' }}>
              QCAA-style Formative Feedback
            </span>
          </div>
        ) : (
          <div style={{
            width: 100, height: 100, borderRadius: '50%',
            background: 'var(--accent-color)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: '1rem',
          }}>
            <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#fff' }}>
              {percentage}%
            </span>
          </div>
        )}
        <div style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
          <strong>{totalScore}</strong> / {maxTotalScore} points ({percentage}%)
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Draft {iterationCount} of 3
        </div>
        {isSenior && (
          <div style={{
            margin: '0.75rem auto 0', maxWidth: 560, padding: '0.65rem 0.9rem',
            borderRadius: '8px', background: 'rgba(139,92,246,0.10)',
            border: '1px solid rgba(139,92,246,0.25)', color: 'var(--text-secondary)',
            fontSize: '0.82rem', lineHeight: 1.5,
          }}>
            <strong style={{ color: '#8b5cf6' }}>Practice feedback modelled on QCAA English ISMG categories.</strong> Your official result depends on your school task sheet, exact ISMG, assessment conditions, and teacher/QCAA confirmation.
          </div>
        )}
        {!isSenior && (
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem', fontStyle: 'italic' }}>
            Practice score is a formative rubric-style indicator, not an official NAPLAN or school result.
          </div>
        )}
      </div>

      {(visibleNextSteps.length > 0 || visibleRevisionPlan.length > 0) && (
        <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent-color)' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
            🎯 Start here
          </h3>
          <p style={{ margin: '0 0 0.85rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Focus on these one or two things first. The full breakdown is below when you want the detail.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            {visibleNextSteps[0] && (
              <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong style={{ color: '#f59e0b' }}>Focus skill:</strong>{' '}
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{visibleNextSteps[0].priority_goal || 'Revise one priority skill'}</span>
                {visibleNextSteps[0].recommendation && <span> — Try: {visibleNextSteps[0].recommendation}</span>}
              </div>
            )}
            {visibleRevisionPlan[0] && (
              <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--accent-color)' }}>First revision:</strong>{' '}
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{visibleRevisionPlan[0].target}</span>
                {visibleRevisionPlan[0].how && <span> — Try: {visibleRevisionPlan[0].how}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {visibleRevisionPlan.length > 0 && (
        <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderLeft: '3px solid var(--accent-color)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
            Revise These First
          </h3>
          <p style={{ margin: '0 0 0.85rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Focus on these changes before reading the full diagnostic detail.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {visibleRevisionPlan.map((item, i) => (
              <div key={`${item.priority}-${i}`} style={{ padding: '0.85rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.3rem' }}>
                  {i + 1}. {item.target}
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {item.why}
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5, marginTop: '0.25rem' }}>
                  Try: {item.how}
                </div>
                {item.success_criteria && item.success_criteria.length > 0 && (
                  <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {item.success_criteria.map((criterion, idx) => <li key={idx}>Success check: {criterion}</li>)}
                  </ul>
                )}
                {item.example_revision && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--success)', lineHeight: 1.5, marginTop: '0.4rem', background: 'rgba(34,197,94,0.06)', padding: '0.5rem', borderRadius: '6px' }}>
                    Sentence-level example, do not copy: {item.example_revision}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Criterion Scores — shared between NAPLAN and ATAR */}
      {criterionScores.length > 0 && (<>
      {/* Strengths & Areas */}
      {(visibleStrengths.length > 0 || visibleNextSteps.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {visibleStrengths.length > 0 && (
            <div className="glass-card" style={{ padding: '1.25rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--success)', marginBottom: '0.75rem' }}>
                Strengths
              </h3>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                {visibleStrengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {visibleNextSteps.length > 0 && (
            <div className="glass-card" style={{ padding: '1.25rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#f59e0b', marginBottom: '0.75rem' }}>
                Next Learning Steps
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {visibleNextSteps.map((s, i) => (
                  <div key={i} style={{ borderLeft: '3px solid var(--accent-color)', paddingLeft: '0.75rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                      {i + 1}. {s.priority_goal || 'Revise one priority skill'}
                    </div>
                    {s.why_it_matters && (
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                        {s.why_it_matters}
                      </div>
                    )}
                    {s.recommendation && (
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Try: {s.recommendation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Per-Criterion Scores */}
      <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Criterion Breakdown
        </h3>
        {criterionScores.map((cs) => {
          const pct = Math.round((cs.score / cs.max_score) * 100);
          const isWeak = cs.score < cs.max_score * 0.6;
          const unverifiedQuotes = cs.unverified_quotes ?? [];
          return (
            <div key={cs.criterion_number} style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                  {cs.criterion_number}. {cs.name}
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                    ({cs.domain})
                  </span>
                </span>
                <span style={{
                  fontSize: '0.8rem', fontWeight: 600,
                  color: isWeak ? 'var(--error)' : 'var(--success)',
                }}>
                  {cs.score}/{cs.max_score}
                </span>
              </div>
              <div style={{
                height: 6, borderRadius: 3, background: 'var(--bg-secondary)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  width: `${pct}%`,
                  background: isWeak ? 'var(--error)' : 'var(--success)',
                  transition: 'width 0.5s ease',
                }} />
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem', lineHeight: 1.4 }}>
                <ReactMarkdown components={markdownComponents}>{cs.feedback}</ReactMarkdown>
              </div>
              {unverifiedQuotes.length > 0 && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.2rem', lineHeight: 1.4 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>⚠ Not found in your draft:</strong>{' '}
                  {unverifiedQuotes.map(quote => `“${quote}”`).join(', ')}. Check this part of the feedback.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Cognitive Verb Scores — senior only */}
      {cognitiveVerbScores && cognitiveVerbScores.length > 0 && (
        <div className="glass-card" style={{
          padding: '1.25rem', marginBottom: '1.5rem',
          borderLeft: '3px solid #f59e0b',
        }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
            Cognitive Demand Feedback
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.4 }}>
            This is a learning guide for senior writing skills, not a separate official mark.
          </p>
          {cognitiveVerbScores.map((cvs, i) => {
            const pct = (cvs.score / 5) * 100;
            return (
              <div key={i} style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                  <span style={{
                    fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)',
                    padding: '2px 8px', borderRadius: '4px',
                    background: 'rgba(245,158,11,0.12)',
                  }}>
                    {cvs.verb}
                  </span>
                  <span style={{
                    fontSize: '0.8rem', fontWeight: 600,
                    color: cvs.score >= 3 ? 'var(--success)' : cvs.score >= 2 ? '#f59e0b' : 'var(--error)',
                  }}>
                    {cvs.score}/5
                  </span>
                </div>
                <div style={{
                  height: 6, borderRadius: 3, background: 'var(--bg-secondary)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: `${Math.min(pct, 100)}%`,
                    background: cvs.score >= 3 ? 'var(--success)' : cvs.score >= 2 ? '#f59e0b' : 'var(--error)',
                    transition: 'width 0.5s ease',
                  }} />
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem', lineHeight: 1.4 }}>
                  <ReactMarkdown components={markdownComponents}>{cvs.feedback}</ReactMarkdown>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Highlights */}
      {highlights.length > 0 && (
        <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
            In-Text Highlights
          </h3>
          {highlightedDraft.length > 0 && (
            <div
              aria-label="Draft with in-text feedback highlights"
              style={{
                whiteSpace: 'pre-wrap',
                padding: '0.9rem',
                marginBottom: '0.9rem',
                borderRadius: '8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                fontSize: '0.88rem',
                lineHeight: 1.65,
              }}
            >
              {highlightedDraft.map((segment, index) => segment.highlight ? (
                <mark
                  key={`highlight-${index}`}
                  title={`${highlightKind(segment.highlight.issue_type).label}: ${segment.highlight.issue_type.replace(/_/g, ' ')}: ${segment.highlight.suggestion}`}
                  style={{
                    background: highlightKind(segment.highlight.issue_type).background,
                    color: 'inherit',
                    borderBottom: `2px solid ${highlightKind(segment.highlight.issue_type).color}`,
                    padding: '0 2px',
                  }}
                >
                  {segment.text}
                </mark>
              ) : (
                <span key={`text-${index}`}>{segment.text}</span>
              ))}
            </div>
          )}
          {highlights.map((h, i) => {
            const kind = highlightKind(h.issue_type);
            return (
            <div key={i} style={{
              padding: '0.75rem', marginBottom: '0.5rem',
              borderLeft: `3px solid ${kind.color}`,
              background: 'var(--bg-secondary)',
              borderRadius: '0 8px 8px 0',
            }}>
              <p style={{
                fontSize: '0.85rem', fontStyle: 'italic', color: 'var(--text-primary)',
                marginBottom: '0.25rem', lineHeight: 1.4,
              }}>
                &ldquo;{h.text_snippet}&rdquo;
              </p>
              <p style={{ fontSize: '0.75rem', color: kind.color, marginBottom: '0.25rem' }}>
                <strong>{kind.label}:</strong> {h.issue_type.replace(/_/g, ' ')}
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                {h.suggestion}
              </p>
            </div>
            );
          })}
        </div>
      )}

      {/* Remediation Links */}
      {remediationLinks.length > 0 && onPracticeTopics && (
        <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
            Practise These Topics to Improve
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', flexDirection: 'column', alignItems: 'flex-start' }}>
            {remediationLinks.map((tid) => {
              const label = curriculum ? getTopicDisplayName(curriculum, tid, tid) : tid;
              return (
                <button
                  key={tid}
                  onClick={() => onPracticeTopics([tid])}
                  className="btn-secondary"
                  style={{
                    padding: '0.6rem 1rem', fontSize: '0.85rem', width: '100%',
                    textAlign: 'left', display: 'flex', gap: '8px', alignItems: 'center',
                    justifyContent: 'flex-start', color: 'var(--text-primary)',
                  }}
                >
                  <strong style={{ color: 'var(--accent-color)' }}>{tid}</strong>
                  {label !== tid && <span style={{ color: 'var(--text-secondary)' }}>— {label}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      </>)}

      {/* Revision Progress */}
      {(revisionCompare || compareLoading) && (
        <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderLeft: '3px solid #06b6d4' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#06b6d4', marginBottom: '0.35rem' }}>
            Revision Progress
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 0.75rem 0' }}>
            This panel compares <strong style={{ color: 'var(--text-secondary)' }}>text changes only</strong>
            {' '}(word count, sentences, paragraphs, vocabulary). It does not re-score your draft.
            To update criterion scores and overall feedback, click <strong style={{ color: 'var(--text-secondary)' }}>Assess</strong> again after revising.
          </p>
          {compareLoading && !revisionCompare ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
              Comparing this draft with your original submission...
            </p>
          ) : revisionCompare && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '0.85rem' }}>
                <div style={{ padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Words</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {revisionCompare.revised_word_count}
                    <span style={{ fontSize: '0.8rem', color: revisionCompare.word_count_change >= 0 ? 'var(--success)' : 'var(--error)', marginLeft: '0.35rem' }}>
                      {revisionCompare.word_count_change >= 0 ? '+' : ''}{revisionCompare.word_count_change}
                    </span>
                  </div>
                </div>
                <div style={{ padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Paragraphs</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {revisionCompare.paragraph_count.original} {'->'} {revisionCompare.paragraph_count.revised}
                  </div>
                </div>
                <div style={{ padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Sentences</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {revisionCompare.sentence_count.original} {'->'} {revisionCompare.sentence_count.revised}
                  </div>
                </div>
              </div>
              {revisionCompare.new_vocabulary.length > 0 && (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>New vocabulary:</strong> {revisionCompare.new_vocabulary.slice(0, 8).join(', ')}
                </div>
              )}
              {criterionDeltas.length > 0 && (
                <div style={{ marginTop: '0.85rem' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.45rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Criterion movement
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.5rem' }}>
                    {criterionDeltas.map(item => {
                      const color = item.delta > 0 ? 'var(--success)' : item.delta < 0 ? 'var(--error)' : 'var(--text-muted)';
                      const deltaText = item.delta > 0 ? `+${item.delta}` : item.delta === 0 ? 'no change' : String(item.delta);
                      return (
                        <div
                          key={item.criterionNumber}
                          style={{
                            padding: '0.65rem',
                            background: 'var(--bg-secondary)',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            fontSize: '0.8rem',
                            color: 'var(--text-secondary)',
                            lineHeight: 1.4,
                          }}
                        >
                          <div style={{ color: 'var(--text-primary)', fontWeight: 700, marginBottom: '0.2rem' }}>
                            {item.criterionNumber}. {item.name}
                          </div>
                          <span>{item.previous}/{item.maxScore} {'->'} {item.current}/{item.maxScore}</span>
                          <span style={{ color, fontWeight: 700, marginLeft: '0.35rem' }}>
                            ({deltaText})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5, marginTop: '0.45rem' }}>
                {revisionCompare.original_scored === false || revisionCompare.original_insufficient_evidence
                  ? 'No scored baseline was available for the original draft; run Assess after adding enough development.'
                  : `Baseline score from the original assessment: ${revisionCompare.original_score}/${revisionCompare.original_max_score}.`}
                {criterionDeltas.length > 0
                  ? ' Criterion movement below compares that baseline with your latest full assessment (not the live editor draft).'
                  : revisionCompare.original_scored === false || revisionCompare.original_insufficient_evidence
                    ? ' Re-assess after editing to create criterion scores.'
                    : ' Re-assess after editing to see whether criterion scores improved.'}
              </div>
            </>
          )}
        </div>
      )}

      {/* Paragraph Coaching */}
      {hasParagraphFeedback && (
        <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
            Paragraph Coaching
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            {paragraphFeedback?.strongest_paragraph && (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--success)' }}>Strongest:</strong> {paragraphFeedback.strongest_paragraph}
              </div>
            )}
            {paragraphFeedback?.paragraph_to_revise_first && (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong style={{ color: '#f59e0b' }}>Revise first:</strong> {paragraphFeedback.paragraph_to_revise_first}
              </div>
            )}
            {paragraphFeedback?.sentence_level_improvement && (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--accent-color)' }}>Sentence move:</strong> {paragraphFeedback.sentence_level_improvement}
              </div>
            )}
          </div>
        </div>
      )}


      {/* Task Alignment Warnings */}
      {taskAlignmentWarnings.length > 0 && (
        <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderLeft: '3px solid #f59e0b' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#f59e0b', marginBottom: '0.75rem' }}>
            Task Alignment Check
          </h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {taskAlignmentWarnings.map((warning, i) => <li key={i}>{warning}</li>)}
          </ul>
        </div>
      )}

      {/* Source Use Feedback */}
      {sourceUseFeedback && (
        <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderLeft: '3px solid #06b6d4' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#06b6d4', marginBottom: '0.75rem' }}>
            Source Evidence Check
          </h3>
          <div style={{ display: 'grid', gap: '0.6rem', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5 }}>
            <div><strong style={{ color: 'var(--text-primary)' }}>Uses source evidence:</strong> {sourceUseFeedback.uses_source_evidence ? 'Yes' : 'Not clearly yet'}</div>
            {sourceUseFeedback.best_evidence_used && <div><strong style={{ color: 'var(--text-primary)' }}>Best evidence:</strong> {sourceUseFeedback.best_evidence_used}</div>}
            {sourceUseFeedback.missing_or_misread_evidence && <div><strong style={{ color: 'var(--text-primary)' }}>Check next:</strong> {sourceUseFeedback.missing_or_misread_evidence}</div>}
            {sourceUseFeedback.quote_integration_tip && <div><strong style={{ color: 'var(--text-primary)' }}>Quote tip:</strong> {sourceUseFeedback.quote_integration_tip}</div>}
          </div>
        </div>
      )}

      {/* Micro Drills */}
      {(writingSkillDrills.length > 0 || hasGrammarRemediation || onLoadGrammarRemediation) && (
        <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
            Targeted Micro-Drills
          </h3>
          {onLoadGrammarRemediation && !grammarRemediation && !grammarRemediationLoading && (
            <button
              type="button"
              onClick={onLoadGrammarRemediation}
              style={{
                marginBottom: '0.85rem',
                padding: '0.65rem 0.9rem',
                borderRadius: '8px',
                border: '1px solid rgba(245,158,11,0.28)',
                background: 'rgba(245,158,11,0.08)',
                color: '#b45309',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: 'none',
              }}
            >
              Load grammar revision task
            </button>
          )}
          {hasGrammarRemediation && (
            <div style={{ padding: '0.9rem', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)', marginBottom: '0.85rem' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f59e0b', marginBottom: '0.35rem' }}>
                {grammarRemediationTitle}
              </div>
              {grammarRemediationLoading && !grammarRemediation ? (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Finding a targeted revision task from your draft...
                </div>
              ) : grammarRemediation && (
                <>
                  <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <ReactMarkdown components={markdownComponents}>{grammarRemediation.revision_task}</ReactMarkdown>
                  </div>
                  {grammarRemediation.drills.length > 0 && (
                    <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.65rem' }}>
                      {grammarRemediation.drills.slice(0, 3).map((drill, i) => (
                        <div key={drill.id || i} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.6rem', lineHeight: 1.45 }}>
                          <strong style={{ color: 'var(--text-primary)' }}>{drill.grammar_focus || grammarRemediation.grammar_focus || 'Practice drill'}:</strong> {drill.question}
                        </div>
                      ))}
                    </div>
                  )}
                  {(grammarRemediation.writing_skill_drills?.length || 0) > 0 && (
                    <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.65rem' }}>
                      {grammarRemediation.writing_skill_drills!.slice(0, 3).map((drill, i) => (
                        <div key={`${drill.criterion_number}-${i}`} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.6rem', lineHeight: 1.45 }}>
                          <strong style={{ color: 'var(--text-primary)' }}>{drill.skill}:</strong> {drill.drill_prompt}
                          <div style={{ marginTop: '0.25rem', color: 'var(--text-muted)' }}>{drill.practice_tip}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
            {writingSkillDrills.slice(0, 3).map((drill, i) => (
              <div key={`${drill.criterion_number}-${i}`} style={{ padding: '0.85rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.3rem' }}>{drill.skill}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{drill.drill_prompt}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5, marginTop: '0.3rem' }}>{drill.practice_tip}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overall Feedback — shared between NAPLAN and ATAR */}
      {overallFeedback && (
        <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
            Overall Feedback
          </h3>
          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <ReactMarkdown components={markdownComponents}>{overallFeedback}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Writer's Statement Feedback — senior creative only */}
      {writerStatementFeedback && (
        <div className="glass-panel" style={{
          padding: '1.25rem', marginBottom: '1.5rem',
          borderLeft: '3px solid #8b5cf6',
        }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#8b5cf6', marginBottom: '0.5rem' }}>
            Writer&apos;s Statement Feedback
          </h3>
          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <ReactMarkdown components={markdownComponents}>{writerStatementFeedback}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
        {canRetry && (
          <button onClick={onEdit} className="btn-primary" style={{ padding: '0.75rem 2rem' }}>
            Edit and Resubmit ({3 - iterationCount} remaining)
          </button>
        )}
      </div>
    </div>
  );
}
