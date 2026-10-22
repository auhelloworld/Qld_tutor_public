'use client';
import { useState, useEffect } from 'react';
import { fetchWritingHistory, fetchCurriculum } from '../../lib/api';
import { getTopicDisplayName } from '../../lib/curriculum_helpers';
import type { WritingHistoryEntry, Curriculum } from '../../lib/api-types';
import { Calendar, Award, CheckCircle, AlertCircle, FileText, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';

interface Props {
  onBackToPractice: () => void;
  onSelectTopic: (entry: WritingHistoryEntry) => void;
}

const PROMPT_TYPE_LABELS: Record<string, string> = {
  persuasive: 'Persuasive',
  narrative: 'Narrative / Imaginative',
  analytical: 'Analytical Essay',
  expository: 'Informative / Expository',
};

function getPromptTypeLabel(entry: WritingHistoryEntry): string {
  if (entry.year_level >= 11) {
    if (entry.prompt_type === 'persuasive') return 'Public Audience Written Response';
    if (entry.prompt_type === 'narrative') return 'Imaginative Response';
  }
  return PROMPT_TYPE_LABELS[entry.prompt_type] || entry.prompt_type;
}

function getWritingTopicLabel(entry: WritingHistoryEntry): string {
  const title = entry.topic_title?.trim();
  if (title) return title;
  const prompt = entry.topic_prompt?.trim();
  if (prompt) return prompt;
  if (entry.topic_id?.trim()) return entry.topic_id;
  return 'Custom topic';
}

function isScoredHistoryEntry(entry: WritingHistoryEntry): boolean {
  const status = (entry as { llm_status?: string }).llm_status;
  if (status === 'mock' || status === 'unavailable') return false;
  if ((entry as { insufficient_evidence?: boolean }).insufficient_evidence) return false;
  return (entry.total_score ?? 0) > 0 || (entry.criterion_scores?.length ?? 0) > 0;
}

function buildCriterionAverages(history: WritingHistoryEntry[]) {
  const totals = new Map<string, { name: string; scorePctSum: number; count: number; latestPct: number }>();
  history.filter(isScoredHistoryEntry).forEach((entry) => {
    entry.criterion_scores?.forEach((cs) => {
      const key = `${entry.prompt_type}:${cs.name}`;
      const pct = cs.max_score > 0 ? Math.round((cs.score / cs.max_score) * 100) : 0;
      const current = totals.get(key) || { name: cs.name, scorePctSum: 0, count: 0, latestPct: pct };
      current.scorePctSum += pct;
      current.count += 1;
      current.latestPct = pct;
      totals.set(key, current);
    });
  });
  return Array.from(totals.values())
    .map(item => ({ ...item, averagePct: Math.round(item.scorePctSum / item.count) }))
    .sort((a, b) => a.averagePct - b.averagePct)
    .slice(0, 6);
}

export default function WritingPortfolio({ onBackToPractice, onSelectTopic }: Props) {
  const [history, setHistory] = useState<WritingHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [totalAssessments, setTotalAssessments] = useState<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchWritingHistory(),
      fetchCurriculum().catch(() => null)
    ])
      .then(([historyRes, currRes]) => {
        if (active) {
          setHistory(historyRes?.assessments || []);
          setTruncated(historyRes?.truncated === true);
          setTotalAssessments(historyRes?.total_assessments);
          if (currRes) setCurriculum(currRes);
          setLoading(false);
        }
      })
      .catch(err => {
        if (active) {
          console.error('Failed to load portfolio history:', err);
          setError('Failed to load writing history.');
          setLoading(false);
        }
      });

    return () => { active = false; };
  }, []);

  const toggleExpand = (idx: number) => {
    setExpandedIndex(expandedIndex === idx ? null : idx);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 2rem', gap: '1rem' }}>
        <div style={{
          width: 36, height: 36,
          border: '3px solid var(--accent-color)',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Loading your portfolio history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', maxWidth: 600, margin: '2rem auto' }}>
        <AlertCircle size={32} style={{ color: 'var(--error)', marginBottom: '0.75rem' }} />
        <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Error Loading History</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem', marginBottom: '1.5rem' }}>{error}</p>
        <button onClick={onBackToPractice} className="btn-primary" style={{ padding: '0.6rem 1.5rem' }}>
          Back to Writing Lab
        </button>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center', maxWidth: 600, margin: '2rem auto' }}>
        <FileText size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
        <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Your Portfolio is Empty</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, marginBottom: '1.5rem' }}>
          You haven&apos;t completed any writing assessments yet. Select a topic, submit your first draft, and start tracking your improvement here!
        </p>
        <button onClick={onBackToPractice} className="btn-primary" style={{ padding: '0.6rem 2rem' }}>
          Start First Writing Practice
        </button>
      </div>
    );
  }

  const criterionAverages = buildCriterionAverages(history);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: '3rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          My Writing Portfolio ({history.length} {history.length === 1 ? 'Essay' : 'Essays'})
        </h2>
        <button onClick={onBackToPractice} className="btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
          New Practice
        </button>
      </div>

      {truncated && (
        <div style={{
          padding: '0.7rem 1rem', marginBottom: '1.25rem', borderRadius: '8px',
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5,
        }}>
          Showing your most recent assessments{totalAssessments ? ` (${history.length} of ${totalAssessments} total)` : ''}. Older entries are not displayed.
        </div>
      )}


      {criterionAverages.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
            Criterion averages
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 0, lineHeight: 1.5 }}>
            Average share of available marks across scored attempts — not a time trend. Weakest criteria are useful next-draft targets.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            {criterionAverages.map((item) => (
              <div key={item.name} style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  <span>{item.name}</span>
                  <span>{item.averagePct}%</span>
                </div>
                <div style={{ height: 6, background: 'rgba(0,0,0,0.08)', borderRadius: 3, overflow: 'hidden', marginTop: '0.45rem' }}>
                  <div style={{ height: '100%', width: `${item.averagePct}%`, background: item.averagePct >= 70 ? 'var(--success)' : item.averagePct >= 45 ? '#f59e0b' : 'var(--error)' }} />
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                  {item.count} attempt{item.count === 1 ? '' : 's'} tracked
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {history.map((entry, idx) => {
          const isExpanded = expandedIndex === idx;
          const isInsufficient = entry.insufficient_evidence === true;
          const percentage = !isInsufficient && entry.max_total_score > 0
            ? Math.round((entry.total_score / entry.max_total_score) * 100)
            : null;
          const dateStr = new Date(entry.timestamp).toLocaleDateString('en-AU', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          });

          return (
            <div key={idx} className="glass-card" style={{
              borderRadius: '12px',
              border: isExpanded ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
              overflow: 'hidden',
              transition: 'all 0.2s',
            }}>
              {/* Card Header (always visible) */}
              <div 
                onClick={() => toggleExpand(idx)}
                style={{
                  padding: '1.25rem',
                  background: isExpanded ? 'rgba(99,102,241,0.03)' : 'transparent',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  flexWrap: 'wrap',
                  gap: '1rem',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                      padding: '2px 8px', borderRadius: '4px',
                      background: 'rgba(8,145,178,0.12)', color: '#0891b2'
                    }}>
                      {getPromptTypeLabel(entry)}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>
                      Year {entry.year_level}
                    </span>
                  </div>
                  <div
                    title={getWritingTopicLabel(entry)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      color: 'var(--text-primary)', fontSize: '0.92rem', fontWeight: 700,
                      maxWidth: 'min(620px, 75vw)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    <FileText size={14} style={{ flex: '0 0 auto', color: 'var(--accent-color)' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {getWritingTopicLabel(entry)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    <Calendar size={12} />
                    <span>{dateStr}</span>
                    <span>•</span>
                    <span>{entry.word_count} words</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                  <div style={{ textAlign: 'right' }}>
                    {isInsufficient ? (
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#d97706' }}>
                        Not scored
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {entry.total_score} <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 400 }}>/ {entry.max_total_score}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {percentage}%
                        </div>
                      </>
                    )}
                  </div>


                  <div style={{ color: 'var(--text-muted)' }}>
                    {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </div>
                </div>
              </div>

              {/* Card Content (Visible when expanded) */}
              {isExpanded && (
                <div style={{
                  padding: '1.25rem',
                  borderTop: '1px solid var(--border-color)',
                  background: 'var(--bg-primary)',
                }}>
                  {/* Summary row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                    {/* Strengths */}
                    {entry.strengths && entry.strengths.length > 0 && (
                      <div className="glass-panel" style={{ padding: '1rem', borderLeft: '3px solid var(--success)' }}>
                        <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--success)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <CheckCircle size={14} /> Key Strengths
                        </h4>
                        <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          {entry.strengths.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}

                    {/* Next Steps */}
                    {entry.next_learning_steps && entry.next_learning_steps.length > 0 && (
                      <div className="glass-panel" style={{ padding: '1rem', borderLeft: '3px solid #f59e0b' }}>
                        <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f59e0b', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Award size={14} /> Next Learning Steps
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {entry.next_learning_steps.map((step, i) => (
                            <div key={i} style={{ fontSize: '0.8rem', lineHeight: 1.4 }}>
                              <strong style={{ color: 'var(--text-primary)' }}>{step.priority_goal}</strong>: {step.recommendation}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Detailed Criterion Scores */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
                      Criterion Rubric Details
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
                      {entry.criterion_scores.map((cs, i) => {
                        const pct = cs.max_score > 0 ? (cs.score / cs.max_score) * 100 : 0;
                        return (
                          <div key={i} style={{
                            padding: '0.75rem',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-secondary)',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                              <span style={{ color: 'var(--text-primary)' }}>{cs.name}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{cs.score} / {cs.max_score}</span>
                            </div>
                            <div style={{ height: 6, background: 'rgba(0,0,0,0.05)', borderRadius: 3, overflow: 'hidden', marginBottom: '0.35rem' }}>
                              <div style={{
                                height: '100%',
                                width: `${pct}%`,
                                background: pct >= 70 ? 'var(--success)' : pct >= 40 ? '#f59e0b' : 'var(--error)',
                                borderRadius: 3,
                              }} />
                            </div>
                            {cs.feedback && (
                              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                                {cs.feedback}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Remediation Links */}
                  {entry.remediation_links && entry.remediation_links.length > 0 && (
                    <div style={{ marginBottom: '1.5rem' }}>
                      <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                        Recommended Learning Material
                      </h4>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {entry.remediation_links.map((tid) => {
                          const label = curriculum ? getTopicDisplayName(curriculum, tid, tid) : tid;
                          return (
                            <div key={tid} style={{
                              fontSize: '0.75rem', padding: '4px 10px', borderRadius: '4px',
                              border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                              display: 'inline-flex', alignItems: 'center', gap: '4px'
                            }}>
                              <strong style={{ color: 'var(--accent-color)' }}>{tid}</strong>
                              {label !== tid && <span style={{ color: 'var(--text-secondary)' }}>— {label}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Action row */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                    <button
                      onClick={() => onSelectTopic(entry)}
                      className="btn-secondary"
                      style={{
                        padding: '0.4rem 1rem', fontSize: '0.8rem',
                        display: 'flex', alignItems: 'center', gap: '6px',
                        color: 'var(--text-primary)'
                      }}
                    >
                      Write Another Draft <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
