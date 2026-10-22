'use client';

import React from 'react';
import MathMarkdown from '../MathMarkdown';
import QuestionContext from '../QuestionContext';
import { formatStudentAnswer } from '../../lib/format';
import { buildPracticeHref } from '../../lib/scoped_navigation';
import BackToPracticeLink from '../BackToPracticeLink';
import type { ExamResult, ExamReviewMode, Subject, YearLevel } from '../../lib/api-types';

interface ExamResultsProps {
  results: ExamResult;
  reviewMode: ExamReviewMode;
  setReviewMode: React.Dispatch<React.SetStateAction<ExamReviewMode>>;
  subject?: Subject;
  year?: YearLevel;
  onRestart: () => void;
}

export default function ExamResults({
  results,
  reviewMode,
  setReviewMode,
  subject,
  year,
  onRestart,
}: ExamResultsProps) {
  const pendingCount = results.pending_count ?? results.results_per_question.filter(item => item.requires_review).length;
  const scoredQuestions = results.scored_questions ?? Math.max(0, results.total_questions - pendingCount);
  const provisional = Boolean(results.provisional || pendingCount > 0);
  const allPending = pendingCount > 0 && scoredQuestions === 0;
  const displayPercentage = allPending ? null : results.percentage;
  const grade = displayPercentage === null
    ? null
    : displayPercentage >= 80
      ? 'A'
      : displayPercentage >= 70
      ? 'B'
      : displayPercentage >= 60
      ? 'C'
      : displayPercentage >= 50
      ? 'D'
      : 'E';
  const gradeColor = displayPercentage === null
    ? '#d97706'
    : displayPercentage >= 70 ? '#16a34a' : displayPercentage >= 50 ? '#d97706' : '#dc2626';
  const isEnglish = subject === 'english';
  const isScience = subject === 'science';
  const unansweredCount = results.results_per_question.filter(item => item.unanswered).length;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '24px' }}>📊 Exam Results</h1>

      {/* Score summary */}
      <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', fontWeight: '800', color: gradeColor }}>
          {allPending ? 'Pending' : `${displayPercentage}%`}
        </div>
        {results.total_score !== undefined && results.total_max_score !== undefined && (
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {results.total_score} / {results.total_max_score} marks (mark-weighted)
            {!provisional && grade && (
              <> — Practice indicator: <strong style={{ color: gradeColor }}>{grade}</strong></>
            )}
          </div>
        )}
        <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {results.correct} / {results.total_questions} questions fully correct
          {scoredQuestions < results.total_questions
            ? ` · ${scoredQuestions} scored`
            : ''}
        </div>
        {provisional && (
          <div style={{ marginTop: '10px', fontSize: '13px', color: '#d97706', fontWeight: 600 }}>
            {allPending
              ? `Pending — ${pendingCount} response${pendingCount === 1 ? '' : 's'} are awaiting review. No percentage is shown until at least one response is scored.`
              : `Provisional ${results.percentage}% based on ${scoredQuestions} scored response${scoredQuestions === 1 ? '' : 's'}; ${pendingCount} response${pendingCount === 1 ? '' : 's'} awaiting review. Letter grade suppressed until scoring is complete.`}
          </div>
        )}
        {results.submitted_late && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            Submitted after the server deadline; graded from the last autosaved answers.
          </div>
        )}
        {unansweredCount > 0 && (
          <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            {unansweredCount} question{unansweredCount === 1 ? ' was' : 's were'} not answered. They score 0 marks but are not added to your Error Book as mistakes.
          </div>
        )}
        <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
          Practice indicator only — not an official school or QCAA grade.
        </div>
      </div>

      {/* Strand breakdown */}
      <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Strand Breakdown</h2>
        {results.strand_breakdown.map(s => (
          <div key={s.strand} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
            <span style={{ width: '100px', fontSize: '13px', fontWeight: '600' }}>{s.strand}</span>
            <div
              role="progressbar"
              aria-valuenow={s.percentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${s.strand} performance percentage`}
              style={{ flex: 1, height: '8px', background: 'var(--bg-secondary)', borderRadius: '4px', overflow: 'hidden' }}
            >
              <div
                style={{
                  width: `${s.percentage}%`,
                  height: '100%',
                  background:
                    s.percentage >= 70
                      ? '#16a34a'
                      : s.percentage >= 50
                      ? '#d97706'
                      : '#dc2626',
                  borderRadius: '4px',
                }}
              />
            </div>
            <span style={{ fontSize: '13px', fontWeight: '600', minWidth: '50px', textAlign: 'right' }}>
              {s.correct}/{s.total}
            </span>
          </div>
        ))}
      </div>

      {/* Weak topics — clickable, jump to practice */}
      {results.weak_topics.length > 0 && (
        <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '4px' }}>⚠️ Topics to Revise</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            Click any topic to go straight to practice.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {results.weak_topics.map(t => {
              const topicName = results.topic_names?.[t];
              return (
                <a
                  key={t}
                  href={buildPracticeHref({ subject, year, topic: t })}
                  style={{
                    fontSize: '12px',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    background: 'rgba(239,68,68,0.1)',
                    color: '#dc2626',
                    fontFamily: topicName ? undefined : 'monospace',
                    textDecoration: 'none',
                    border: '1px solid rgba(239,68,68,0.25)',
                    transition: 'all 0.15s',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  >
                    {topicName ? (
                      <>
                        {topicName}{' '}
                        <small style={{ fontFamily: 'monospace', fontSize: '10.5px', opacity: 0.8 }}>{t}</small>
                      </>
                    ) : t} <span style={{ opacity: 0.7 }}>↗</span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-question review — collapsible for parent review session */}
      <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '600' }}>Question Review</h2>
          <button
            onClick={() => setReviewMode(m => (m === 'collapsed' ? 'expanded' : 'collapsed'))}
            style={{
              fontSize: '12px',
              padding: '4px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            {reviewMode === 'collapsed' ? '▼ Show all answers' : '▲ Collapse'}
          </button>
        </div>
        {results.results_per_question.map((r, i) => (
          <div
            key={i}
            style={{ padding: '10px 0', borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.06))' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{ fontSize: '16px', flexShrink: 0 }} aria-label={r.unanswered ? 'Not answered' : undefined}>
                {r.requires_review ? '⏳' : r.is_correct ? '✅' : r.unanswered ? '⚪' : '❌'}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.5' }}>
                  {r.question_view ? (
                    <>
                      <div style={{ fontWeight: 700 }}>Q{i + 1}.</div>
                      {/* The same stimulus, table, image and parts the student saw. */}
                      <QuestionContext question={r.question_view} showSubParts />
                      {r.question_view.choices && r.question_view.choices.length > 0 && (
                        <ul
                          aria-label={`Choices for question ${i + 1}`}
                          style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: '4px' }}
                        >
                          {r.question_view.choices.map(choice => (
                            <li key={choice}>
                              <MathMarkdown inline>{choice}</MathMarkdown>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <MathMarkdown>
                      {`Q${i + 1}. ${r.question}`}
                    </MathMarkdown>
                  )}
                </div>
                {r.requires_review && (
                  <div style={{ fontSize: '12px', marginTop: '6px', color: '#d97706', fontWeight: 600 }}>
                    ⏳ Extended response — submitted for review{r.max_score ? ` (worth ${r.max_score} marks)` : ''}.
                  </div>
                )}
                {r.feedback && (
                  <div style={{ fontSize: '12px', marginTop: '4px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    <MathMarkdown>{r.feedback}</MathMarkdown>
                  </div>
                )}
                {/* Always show incorrect details; show correct answer only in expanded mode */}
                {((!r.is_correct && !r.requires_review) || reviewMode === 'expanded') && (
                  <div style={{ fontSize: '12px', marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {!r.is_correct && !r.requires_review && (
                      r.unanswered ? (
                        <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Not answered</span>
                      ) : (
                        <span style={{ color: '#dc2626', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          ✗{' '}
                          <MathMarkdown inline>
                            {formatStudentAnswer(r.student_answer) || '(blank)'}
                          </MathMarkdown>
                        </span>
                      )
                    )}
                    {!r.requires_review && (
                      <span style={{ color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        ✓{' '}
                        <MathMarkdown inline>
                          {r.correct_answer}
                        </MathMarkdown>
                      </span>
                    )}
                    <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                      {r.difficulty === 'foundational' ? 'Foundational' : r.difficulty === 'developing' ? 'Developing' : 'Extension'}
                    </span>
                    {r.score !== undefined && r.max_score !== undefined && (
                      <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                        Score: {r.score}/{r.max_score}
                      </span>
                    )}
                  </div>
                )}
                {!r.requires_review && (!r.is_correct || reviewMode === 'expanded') && r.solution_steps && r.solution_steps.length > 0 && (
                  <details style={{ fontSize: '12px', marginTop: '6px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--accent-color)' }}>Worked solution</summary>
                    <ol style={{ margin: '6px 0 0', paddingLeft: '20px', lineHeight: 1.6, color: 'var(--text-primary)' }}>
                      {r.solution_steps.map((step, stepIdx) => (
                        <li key={stepIdx}>
                          <MathMarkdown>{step}</MathMarkdown>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {r.part_results && r.part_results.length > 0 && (
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {r.part_results.map(part => (
                      <div
                        key={part.label}
                        style={{
                          fontSize: '11.5px',
                          color: 'var(--text-secondary)',
                          display: 'flex',
                          gap: '6px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span style={{
                          color: (part as { error_type?: string }).error_type === 'parent_review_pending' || r.requires_review
                            ? '#d97706'
                            : part.is_correct ? '#16a34a' : '#dc2626',
                          fontWeight: 700,
                        }}>
                          {(part as { error_type?: string }).error_type === 'parent_review_pending' || (r.requires_review && !part.student_answer)
                            ? 'Pending'
                            : part.is_correct ? 'Correct' : 'Incorrect'}
                        </span>
                        <span>Part {String(part.label).toUpperCase()}</span>
                        {part.marks !== undefined && <span>{part.marks} mark{part.marks === 1 ? '' : 's'}</span>}
                        {part.student_answer && (
                          <span>
                            Your answer: <MathMarkdown inline>{formatStudentAnswer(part.student_answer)}</MathMarkdown>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Personalised Exam Tips */}
      <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>💡 Next Steps</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', color: 'var(--text-secondary)' }}>
          {allPending ? (
            <div style={{ lineHeight: 1.6 }}>
              Wait for the extended responses to be reviewed. Once scoring is available, this section will show practice-focused next steps.
            </div>
          ) : isEnglish ? (
            <>
              <div style={{ fontWeight: 600, color: gradeColor }}>Score: {results.percentage}% — English practice set</div>
              <div>📖 <strong>Evidence:</strong> Support each claim with a short quotation or precise detail from the stimulus.</div>
              <div>✍️ <strong>Structure:</strong> Plan paragraphs with a clear point, evidence, and explanation before polishing language.</div>
              <div>🔤 <strong>Conventions:</strong> Leave 3–5 minutes to check spelling, punctuation, and sentence control.</div>
            </>
          ) : isScience ? (
            <>
              <div style={{ fontWeight: 600, color: gradeColor }}>Score: {results.percentage}% — Science practice set</div>
              <div>🔬 <strong>CER:</strong> State a claim, cite data/evidence, then explain the scientific reasoning.</div>
              <div>🧪 <strong>Variables:</strong> Name independent, dependent, and controlled variables when designing investigations.</div>
              <div>📊 <strong>Data:</strong> Read axes/units carefully and describe trends before interpreting cause.</div>
            </>
          ) : (
            <>
              {results.percentage < 50 && (
                <>
                  <div style={{ color: '#dc2626', fontWeight: '600' }}>
                    Score: {results.percentage}% — Keep going, every practice session counts.
                  </div>
                  <div>
                    🎯 <strong>Priority:</strong> Focus on the topics flagged above. Revisit each one in practice mode before
                    trying another exam.
                  </div>
                  <div>
                    📖 <strong>Strategy:</strong> For each wrong question, read the worked example and attempt a similar
                    question immediately.
                  </div>
                </>
              )}
              {results.percentage >= 50 && results.percentage < 70 && (
                <>
                  <div style={{ color: '#d97706', fontWeight: '600' }}>
                    Score: {results.percentage}% — Solid foundation, room to grow.
                  </div>
                  <div>
                    📝 <strong>Show working:</strong> Method marks are available even when the final answer is wrong.
                  </div>
                  <div>
                    🔢 <strong>Estimate first:</strong> Before calculating, estimate the answer range to catch arithmetic errors.
                  </div>
                </>
              )}
              {results.percentage >= 70 && results.percentage < 85 && (
                <>
                  <div style={{ color: '#16a34a', fontWeight: '600' }}>Score: {results.percentage}% — Strong result!</div>
                  <div>
                    📈 <strong>Push higher:</strong> Practise complex unfamiliar items and justified reasoning under time.
                  </div>
                </>
              )}
              {results.percentage >= 85 && (
                <>
                  <div style={{ color: '#16a34a', fontWeight: '700' }}>Score: {results.percentage}% — Excellent! 🌟</div>
                  <div>
                    🔬 <strong>Challenge yourself:</strong> Attempt harder timed papers and explain solutions out loud.
                  </div>
                </>
              )}
              <div style={{ marginTop: '4px', paddingTop: '10px', borderTop: '1px solid var(--border-color)', fontSize: '13px' }}>
                📝 <strong>Always show working</strong> — even a wrong final answer can earn method marks in the real exam.
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
        <button
          onClick={onRestart}
          style={{
            padding: '10px 20px',
            borderRadius: '6px',
            background: 'var(--accent-color)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontWeight: '600',
          }}
        >
          Take Another Exam
        </button>
        <BackToPracticeLink subject={subject} year={year} />
      </div>
    </div>
  );
}
