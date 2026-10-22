'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import MathMarkdown from '../../components/MathMarkdown';
import MathSymbolKeyboard from '../../components/MathSymbolKeyboard';
import BackToPracticeLink from '../../components/BackToPracticeLink';
import { challengeStart, tutorMark, fetchCurriculum } from '../../lib/api';
import { getYear, getSubject } from '../../lib/preferences';
import { formatTime } from '../../lib/format';
import { isMathSubject } from '../../lib/subject_registry';

interface SubPart {
  label: string;
  question: string;
  marks: number;
  choices?: string[];
  answer?: string;
}

interface ChallengeQuestion {
  id: string;
  question: string;
  question_type: string;
  topic_ids: string[];
  difficulty?: string;
  challenge_strategy?: string;
  strategy_prompt?: string;
  post_challenge_reflection_prompt?: string;
  is_extension?: boolean;
  choices?: string[];
  sub_parts?: SubPart[];
}

interface PersonalBest {
  correct: number;
  total: number;
  accuracy: number;
  timeLimit: number;
  date: string;
}

type Phase = 'setup' | 'in_progress' | 'results';

function newMutationRequestId(prefix: string): string {
  const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomUuid}`;
}

const STRATEGY_LABELS: Record<string, string> = {
  draw_diagram: 'Draw a diagram',
  work_backwards: 'Work backwards',
  systematic_listing: 'Systematic listing',
  parity: 'Parity check',
  invariants: 'Find invariants',
  estimation: 'Estimate and check',
  algebraic_representation: 'Algebraic representation',
};

interface QuestionResult {
  qid: string;
  question: string;
  correct: boolean;
  studentAnswer: string;
  correctAnswer?: string;
  challengeStrategy?: string;
  strategyPrompt?: string;
}

interface ExtensionProgress {
  attempts: number;
  correct: number;
  strategies: Record<string, { attempts: number; correct: number }>;
}

export default function ChallengePage() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [topicId, setTopicId] = useState('');
  const [timeLimit, setTimeLimit] = useState(300);
  const [maxQuestions, setMaxQuestions] = useState(15);
  const [questions, setQuestions] = useState<ChallengeQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [multiPartAnswers, setMultiPartAnswers] = useState<Record<string, Record<string, string>>>({});
  const [activePartLabel, setActivePartLabel] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [incorrectCount, setIncorrectCount] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [loading, setLoading] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const [error, setError] = useState('');
  const [isNewBest, setIsNewBest] = useState(false);
  const [personalBest, setPersonalBest] = useState<PersonalBest | null>(null);
  const [extensionProgress, setExtensionProgress] = useState<ExtensionProgress | null>(null);
  const [startTime, setStartTime] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [questionResults, setQuestionResults] = useState<QuestionResult[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const progressRecordedRef = useRef(false);
  const markRequestRef = useRef<{ key: string; requestId: string } | null>(null);
  const [gradingError, setGradingError] = useState('');
  const [curriculum, setCurriculum] = useState<any>(null);
  const [pickerSubject] = useState(getSubject());
  const [pickerYear] = useState(getYear());
  const showMathKeyboard = isMathSubject(pickerSubject);

  // Load curriculum for the active topic-selector scope.
  useEffect(() => {
    fetchCurriculum(undefined, {
      subject: pickerSubject,
      scope: pickerYear,
    }).then(setCurriculum).catch(() => {});
  }, [pickerSubject, pickerYear]);

  // Build list of (topicId, label) pairs from curriculum
  const topicOptions: { id: string; label: string }[] = [];
  if (curriculum) {
    const subj = curriculum[pickerSubject];
    if (subj) {
      const yearData = subj[pickerYear];
      if (yearData) {
        for (const [tid, topicData] of Object.entries(yearData)) {
          if (tid === 'sequence') continue;
          const label = typeof topicData === 'object' && topicData !== null
            ? (topicData as any).display_name || (topicData as any).name || tid
            : tid;
          topicOptions.push({ id: tid, label: `${label} (${tid})` });
        }
      }
    }
  }

  // Read topic from URL on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const topic = params.get('topic');
      if (topic) setTopicId(topic);
    }
  }, []);

  useEffect(() => {
    setActivePartLabel(null);
  }, [currentIdx]);

  // Load personal best for this topic
  useEffect(() => {
    if (topicId && typeof window !== 'undefined') {
      const stored = localStorage.getItem(`challenge_pb_${topicId}`);
      if (stored) {
        try { setPersonalBest(JSON.parse(stored)); } catch { setPersonalBest(null); }
      } else {
        setPersonalBest(null);
      }
    }
  }, [topicId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `challenge_extension_${pickerSubject}_${getYear()}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try { setExtensionProgress(JSON.parse(stored)); } catch { setExtensionProgress(null); }
    } else {
      setExtensionProgress(null);
    }
  }, [pickerSubject]);

  const finishChallenge = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    setElapsedTime(elapsed);
    setPhase('results');
  }, [startTime]);

  // Timer countdown
  useEffect(() => {
    if (phase !== 'in_progress') return;
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          // Time's up — end the challenge
          if (timerRef.current) clearInterval(timerRef.current);
          finishChallenge();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [finishChallenge, phase]);

  // Check and save personal best
  useEffect(() => {
    if (phase !== 'results' || !topicId) return;
    const accuracy = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;
    const current: PersonalBest = {
      correct: correctCount,
      total: totalAnswered,
      accuracy,
      timeLimit,
      date: new Date().toISOString(),
    };

    const stored = localStorage.getItem(`challenge_pb_${topicId}`);
    let prev: PersonalBest | null = null;
    if (stored) {
      try { prev = JSON.parse(stored); } catch { prev = null; }
    }

    // New best if more correct answers (at same or better accuracy)
    const isBest = !prev || correctCount > prev.correct || (correctCount === prev.correct && accuracy > prev.accuracy);
    if (isBest && totalAnswered > 0) {
      localStorage.setItem(`challenge_pb_${topicId}`, JSON.stringify(current));
      setIsNewBest(true);
      setPersonalBest(current);
    } else {
      setIsNewBest(false);
    }
  }, [phase, topicId, correctCount, totalAnswered, timeLimit]);

  useEffect(() => {
    if (phase !== 'results' || progressRecordedRef.current || questionResults.length === 0 || typeof window === 'undefined') return;

    const key = `challenge_extension_${pickerSubject}_${getYear()}`;
    let next: ExtensionProgress = { attempts: 0, correct: 0, strategies: {} };
    const stored = localStorage.getItem(key);
    if (stored) {
      try { next = JSON.parse(stored); } catch { next = { attempts: 0, correct: 0, strategies: {} }; }
    }

    for (const result of questionResults) {
      const strategy = result.challengeStrategy || 'mixed';
      next.attempts += 1;
      if (result.correct) next.correct += 1;
      const bucket = next.strategies[strategy] || { attempts: 0, correct: 0 };
      bucket.attempts += 1;
      if (result.correct) bucket.correct += 1;
      next.strategies[strategy] = bucket;
    }

    localStorage.setItem(key, JSON.stringify(next));
    setExtensionProgress(next);
    progressRecordedRef.current = true;
  }, [phase, questionResults, pickerSubject]);

  const handleStart = async () => {
    if (!topicId.trim()) {
      setError('Please enter a topic ID.');
      return;
    }
    setStartLoading(true);
    setError('');
    try {
      const yearLevel = parseInt(getYear().replace('year', '')) || 7;
      const data = await challengeStart(topicId.trim(), timeLimit, yearLevel, pickerSubject, maxQuestions);
      if (data.error === 'no_exercises') {
        setError(data.message || 'No exercises found for this topic.');
        setStartLoading(false);
        return;
      }
      setQuestions(data.questions || []);
      setTimeLeft(data.time_limit_seconds || timeLimit);
      setCurrentIdx(0);
      setAnswer('');
      setCorrectCount(0);
      setIncorrectCount(0);
      setTotalAnswered(0);
      setStartTime(Date.now());
      progressRecordedRef.current = false;
      markRequestRef.current = null;
      setGradingError('');
      setPhase('in_progress');
    } catch (e: any) {
      setError(e?.message || 'Failed to start challenge.');
    }
    setStartLoading(false);
  };

  const handleSubmitAnswer = async () => {
    if (loading) return;
    const currentQ = questions[currentIdx];
    if (!currentQ) return;

    let submittedAnswer = '';
    if (currentQ.question_type === 'multiple_choice') {
      submittedAnswer = answer.trim();
    } else if (currentQ.question_type === 'multi_part' && currentQ.sub_parts) {
      // Serialize multi-part answers into labeled format
      const parts = multiPartAnswers[currentQ.id];
      if (parts) {
        submittedAnswer = currentQ.sub_parts
          .map(p => {
            const label = String(p.label || '').toLowerCase().trim();
            const val = (parts[label] || '').trim();
            return val ? `${label}: ${val}` : null;
          })
          .filter(Boolean)
          .join('\n');
      }
    } else {
      submittedAnswer = answer.trim();
    }

    if (!submittedAnswer) return;

    const requestKey = `${currentQ.id}|${submittedAnswer}`;
    const markRequest = markRequestRef.current?.key === requestKey
      ? markRequestRef.current
      : { key: requestKey, requestId: newMutationRequestId('challenge-mark') };
    markRequestRef.current = markRequest;
    setLoading(true);
    setGradingError('');

    let res;
    try {
      // Reuse the ID when the same answer is retried after a transport or
      // infrastructure failure, so the server can safely replay the mutation.
      res = await tutorMark(currentQ.id, submittedAnswer, undefined, {
        isSpeedRound: true,
        requestId: markRequest.requestId,
      });
    } catch {
      setGradingError('Marking is temporarily unavailable. Your answer has not been counted. Please retry.');
      setLoading(false);
      return;
    }

    const pending = res.retryable === true
      || res.outcome === 'pending'
      || res.error_type === 'parent_review_pending'
      || res.error_type === 'grading_deferred'
      || res.error_type === 'llm_unavailable';
    if (pending) {
      setGradingError('Marking is temporarily unavailable. Your answer has not been counted as incorrect. Please retry.');
      setLoading(false);
      return;
    }

    markRequestRef.current = null;
    const isCorrect = Boolean(res.is_correct);
    const correctAnswer = (res as any).correct_answer;
    if (isCorrect) {
      setCorrectCount(prev => prev + 1);
    } else {
      setIncorrectCount(prev => prev + 1);
    }
    setQuestionResults(prev => [...prev, {
      qid: currentQ.id,
      question: currentQ.question,
      correct: isCorrect,
      studentAnswer: submittedAnswer,
      correctAnswer,
      challengeStrategy: currentQ.challenge_strategy,
      strategyPrompt: currentQ.strategy_prompt,
    }]);
    setTotalAnswered(prev => prev + 1);

    // Move to next question or finish
    const nextIdx = currentIdx + 1;
    if (nextIdx >= questions.length || (totalAnswered + 1) >= maxQuestions) {
      finishChallenge();
    } else {
      setCurrentIdx(nextIdx);
      setAnswer('');
      setMultiPartAnswers(prev => {
        const next = { ...prev };
        delete next[currentQ.id];
        return next;
      });
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && answer.trim() && !loading) {
      e.preventDefault();
      handleSubmitAnswer();
    }
  };

  const handleRestart = () => {
    setPhase('setup');
    setQuestions([]);
    setCurrentIdx(0);
    setAnswer('');
    setCorrectCount(0);
    setIncorrectCount(0);
    setTotalAnswered(0);
    setError('');
    setIsNewBest(false);
    setQuestionResults([]);
    progressRecordedRef.current = false;
    markRequestRef.current = null;
    setGradingError('');
  };


  const accuracy = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

  // --- RENDER ---

  if (phase === 'setup') {
    return (
      <div style={{ maxWidth: '600px', margin: '60px auto', padding: '0 20px' }}>
        <div className="glass-panel" style={{ padding: '40px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            ⚡ Speed Round
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '15px' }}>
            Answer as many questions as possible before time runs out. Test your speed and accuracy!
          </p>

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '12px', marginBottom: '20px', color: '#dc2626', fontSize: '14px' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label htmlFor="topic-select" style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
              Topic
            </label>
            <select
              id="topic-select"
              value={topicId}
              onChange={e => setTopicId(e.target.value)}
              style={{
                width: '100%', padding: '12px 16px', fontSize: '16px',
                background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                borderRadius: '8px', color: 'var(--text-primary)',
              }}
            >
              <option value="">— Select a topic —</option>
              {topicOptions.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>

            <div>
              <label style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '10px' }}>
                Time Limit
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[300, 600, 900].map(t => (
                  <button
                    key={t}
                    onClick={() => setTimeLimit(t)}
                    style={{
                      flex: 1, padding: '12px', fontSize: '15px', fontWeight: '600',
                      borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s',
                      background: timeLimit === t ? 'var(--accent-color)' : 'var(--bg-secondary)',
                      color: timeLimit === t ? 'white' : 'var(--text-primary)',
                      border: timeLimit === t ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                    }}
                  >
                    {t / 60}m
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '10px' }}>
                Max Questions
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[5, 10, 15, 20].map(n => (
                  <button
                    key={n}
                    onClick={() => setMaxQuestions(n)}
                    style={{
                      flex: 1, padding: '12px', fontSize: '15px', fontWeight: '600',
                      borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s',
                      background: maxQuestions === n ? 'var(--accent-color)' : 'var(--bg-secondary)',
                      color: maxQuestions === n ? 'white' : 'var(--text-primary)',
                      border: maxQuestions === n ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {personalBest && (
              <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '8px', padding: '12px', fontSize: '13px', color: '#d97706' }}>
                🏆 Personal Best: {personalBest.correct} correct ({personalBest.accuracy}% accuracy)
              </div>
            )}

            <button
              onClick={handleStart}
              disabled={startLoading || !topicId.trim()}
              style={{
                padding: '16px', fontSize: '18px', fontWeight: '700',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: 'white', border: 'none', borderRadius: '10px',
                cursor: startLoading ? 'wait' : 'pointer', opacity: startLoading || !topicId.trim() ? 0.6 : 1,
                minHeight: '56px',
              }}
            >
              {startLoading ? 'Loading questions...' : '🚀 Start Challenge'}
            </button>
          </div>

          <div style={{ marginTop: '24px', textAlign: 'center' }}>
            <BackToPracticeLink />
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'in_progress') {
    const currentQ = questions[currentIdx];
    const timerColor = timeLeft <= 10 ? '#ef4444' : timeLeft <= 30 ? '#f59e0b' : 'var(--text-primary)';

    return (
      <div className="speed-round-play-shell">
        {/* Timer Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Q{currentIdx + 1} / {questions.length} · ✅ {correctCount} · ❌ {incorrectCount}
          </div>
          <div
            role="timer"
            aria-live="polite"
            aria-label={`Time remaining: ${formatTime(timeLeft)}`}
            style={{
              fontSize: '32px', fontWeight: '800', fontFamily: 'monospace',
              color: timerColor, transition: 'color 0.3s',
              textShadow: timeLeft <= 10 ? '0 0 12px rgba(239,68,68,0.5)' : 'none',
            }}
          >
            {formatTime(timeLeft)}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: '4px', background: 'var(--bg-secondary)', borderRadius: '2px', marginBottom: '24px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${(timeLeft / timeLimit) * 100}%`, background: timerColor, transition: 'width 1s linear, background 0.3s' }} />
        </div>

        {gradingError && (
          <div role="alert" style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: '8px', color: '#a16207', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.28)', fontSize: '13px', lineHeight: 1.5 }}>
            {gradingError}
          </div>
        )}

        {/* Question */}
        <div className="glass-panel speed-round-question-panel" style={{ padding: '32px' }}>
          {currentQ ? (
            <>
              {currentQ.strategy_prompt && (
                <div style={{ marginBottom: '18px', padding: '12px 14px', borderRadius: '8px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.22)' }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--accent-color)', marginBottom: '4px' }}>
                    Strategy: {STRATEGY_LABELS[currentQ.challenge_strategy || ''] || 'Challenge strategy'}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    {currentQ.strategy_prompt}
                  </div>
                </div>
              )}

              <div style={{ fontSize: '18px', lineHeight: '1.6', marginBottom: '24px' }}>
                <MathMarkdown>
                  {currentQ.question}
                </MathMarkdown>
              </div>

              {/* MCQ choices */}
              {currentQ.question_type === 'multiple_choice' && currentQ.choices ? (
                <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                  <legend className="sr-only">Select your answer</legend>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                    {currentQ.choices.map((choice: any, idx: number) => {
                      const choiceText = typeof choice === 'object' && choice !== null ? choice.value : choice;
                      return (
                        <label
                          key={idx}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '12px',
                            padding: '12px 16px', borderRadius: '8px', cursor: 'pointer',
                            background: answer === choiceText ? 'rgba(99,102,241,0.15)' : 'var(--bg-secondary)',
                            border: answer === choiceText ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                            transition: 'all 0.15s',
                          }}
                        >
                          <input
                            type="radio"
                            name="challenge-mcq"
                            value={choiceText}
                            checked={answer === choiceText}
                            onChange={e => setAnswer(e.target.value)}
                            style={{ width: '18px', height: '18px', accentColor: 'var(--accent-color)' }}
                          />
                          <span style={{ fontSize: '15px' }}>
                            <MathMarkdown inline>
                              {choiceText}
                            </MathMarkdown>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : currentQ.question_type === 'multi_part' && currentQ.sub_parts ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                  {currentQ.sub_parts.map((part, idx) => {
                    const partLabel = String(part.label || '').toLowerCase().trim();
                    const partAnswer = multiPartAnswers[currentQ.id]?.[partLabel] || '';
                    const partInputId = `speed-round-part-${currentQ.id}-${partLabel}`;
                    return (
                      <div key={idx} style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)' }}>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--accent-color)', marginBottom: '4px' }}>
                          Part ({part.label}) — {part.marks || 1} mark{part.marks > 1 ? 's' : ''}
                        </div>
                        <div style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '8px', lineHeight: '1.6' }}>
                          <MathMarkdown>{part.question}</MathMarkdown>
                        </div>
                        {part.choices ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                            {part.choices.map((choice, cIdx) => {
                              const isSelected = partAnswer === choice || 
                                (String(part.answer || "").trim().length === 1 && 
                                 partAnswer.toUpperCase() === String.fromCharCode(65 + cIdx));
                              return (
                                <label
                                  key={cIdx}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '8px 12px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color)',
                                    background: isSelected ? 'rgba(59,130,246,0.1)' : 'transparent',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                  }}
                                >
                                  <input
                                    type="radio"
                                    name={`challenge-choice-${currentQ.id}-${partLabel}`}
                                    value={choice}
                                    checked={isSelected}
                                    onChange={() => {
                                      setActivePartLabel(null);
                                      const correctAns = String(part.answer || "").trim().toUpperCase();
                                      const isLetterAnswer = /^[A-G]$/.test(correctAns);
                                      const finalVal = isLetterAnswer ? String.fromCharCode(65 + cIdx) : choice;
                                      setMultiPartAnswers(prev => ({
                                        ...prev,
                                        [currentQ.id]: { ...(prev[currentQ.id] || {}), [partLabel]: finalVal }
                                      }));
                                    }}
                                    style={{ accentColor: 'var(--accent-color)' }}
                                  />
                                  <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                                    <MathMarkdown inline>{choice}</MathMarkdown>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <>
                            <textarea
                              id={partInputId}
                              className="auto-growing-textarea"
                              value={partAnswer}
                              onFocus={() => setActivePartLabel(partLabel)}
                              onChange={e => {
                                setMultiPartAnswers(prev => ({
                                  ...prev,
                                  [currentQ.id]: { ...(prev[currentQ.id] || {}), [partLabel]: e.target.value }
                                }));
                              }}
                              onKeyDown={e => {
                                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                  handleSubmitAnswer();
                                }
                              }}
                              rows={2}
                              placeholder={`Answer for part (${part.label})...`}
                              style={{
                                width: '100%', minHeight: '72px', maxHeight: 'min(32dvh, 240px)',
                                padding: '10px 14px', borderRadius: '6px',
                                border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                                color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box',
                                resize: 'vertical',
                              }}
                            />
                            {showMathKeyboard && activePartLabel === partLabel && (
                              <MathSymbolKeyboard
                                textareaId={partInputId}
                                onInsert={value => {
                                  setMultiPartAnswers(prev => ({
                                    ...prev,
                                    [currentQ.id]: { ...(prev[currentQ.id] || {}), [partLabel]: value }
                                  }));
                                }}
                              />
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <>
                  {showMathKeyboard && (
                    <MathSymbolKeyboard
                      textareaId="speed-round-answer"
                      onInsert={setAnswer}
                    />
                  )}
                  <textarea
                    id="speed-round-answer"
                    className="auto-growing-textarea"
                    value={answer}
                    onChange={e => setAnswer(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your answer... (Cmd/Ctrl+Enter to submit)"
                    autoFocus
                    style={{
                      width: '100%', minHeight: '96px', maxHeight: 'min(42dvh, 380px)', padding: '12px 16px', fontSize: '16px',
                      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                      borderRadius: '8px', color: 'var(--text-primary)', resize: 'vertical',
                      marginBottom: '16px',
                    }}
                  />
                </>
              )}

              <button
                onClick={handleSubmitAnswer}
                disabled={loading || (currentQ.question_type === 'multi_part' && currentQ.sub_parts
                  ? !currentQ.sub_parts.some(p => multiPartAnswers[currentQ.id]?.[String(p.label).toLowerCase().trim()]?.trim())
                  : !answer.trim()
                )}
                style={{
                  width: '100%', padding: '14px', fontSize: '16px', fontWeight: '700',
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  color: 'white', border: 'none', borderRadius: '8px',
                  cursor: loading || (currentQ.question_type === 'multi_part' && currentQ.sub_parts
                    ? !currentQ.sub_parts.some(p => multiPartAnswers[currentQ.id]?.[String(p.label).toLowerCase().trim()]?.trim())
                    : !answer.trim()
                  ) ? 'not-allowed' : 'pointer',
                  opacity: loading || (currentQ.question_type === 'multi_part' && currentQ.sub_parts
                    ? !currentQ.sub_parts.some(p => multiPartAnswers[currentQ.id]?.[String(p.label).toLowerCase().trim()]?.trim())
                    : !answer.trim()
                  ) ? 0.6 : 1,
                  minHeight: '48px',
                }}
              >
                {loading ? 'Checking...' : gradingError ? 'Retry Marking' : 'Submit & Next →'}
              </button>

              <button
                onClick={finishChallenge}
                style={{
                  width: '100%', marginTop: '12px', padding: '10px', fontSize: '13px',
                  background: 'transparent', border: '1px solid var(--border-color)',
                  borderRadius: '8px', color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                End Challenge Early
              </button>
            </>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
              No more questions available.
            </div>
          )}
        </div>
      </div>
    );
  }

  // Results phase
  return (
    <div className="speed-round-results-shell">
      <div className="glass-panel speed-round-results-panel" style={{ padding: '40px', textAlign: 'center' }}>
        {isNewBest && (
          <div style={{
            fontSize: '24px', marginBottom: '16px',
            animation: 'pulse 1s ease-in-out infinite',
          }}>
            🏆 Personal Best!
          </div>
        )}

        <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '8px' }}>
          ⚡ Challenge Complete!
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '14px' }}>
          Topic: {topicId}
        </p>

        <div className="speed-round-stat-grid" style={{ marginBottom: '32px' }}>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '20px' }}>
            <div style={{ fontSize: '32px', fontWeight: '800', color: 'var(--text-primary)' }}>{totalAnswered}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Answered</div>
          </div>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '20px' }}>
            <div style={{ fontSize: '32px', fontWeight: '800', color: '#16a34a' }}>{correctCount}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Correct</div>
          </div>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '20px' }}>
            <div style={{ fontSize: '32px', fontWeight: '800', color: accuracy >= 80 ? '#16a34a' : accuracy >= 50 ? '#d97706' : '#dc2626' }}>
              {accuracy}%
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Accuracy</div>
          </div>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '20px' }}>
            <div style={{ fontSize: '32px', fontWeight: '800', color: 'var(--text-primary)' }}>{formatTime(elapsedTime)}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Time Used</div>
          </div>
        </div>

        {personalBest && !isNewBest && (
          <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '8px', padding: '12px', marginBottom: '24px', fontSize: '13px', color: '#d97706' }}>
            🏆 Your best: {personalBest.correct} correct ({personalBest.accuracy}% accuracy)
          </div>
        )}

        <div className="speed-round-insight-grid">
        {questionResults.some(q => q.challengeStrategy) && (
          <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: '8px', padding: '14px', marginBottom: '24px', textAlign: 'left' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px' }}>Challenge Reflection</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: '1.5' }}>
              What made this hard, and which strategy helped most?
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {Object.entries(questionResults.reduce<Record<string, number>>((acc, item) => {
                const strategy = item.challengeStrategy || 'mixed';
                acc[strategy] = (acc[strategy] || 0) + 1;
                return acc;
              }, {})).map(([strategy, count]) => (
                <span key={strategy} style={{ fontSize: '12px', padding: '5px 8px', borderRadius: '999px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                  {STRATEGY_LABELS[strategy] || strategy}: {count}
                </span>
              ))}
            </div>
          </div>
        )}

        {extensionProgress && extensionProgress.attempts > 0 && (
          <div style={{ marginBottom: '24px', textAlign: 'left' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '10px' }}>Extension Strategy Progress</h2>
            <div style={{ display: 'grid', gap: '8px' }}>
              {Object.entries(extensionProgress.strategies).slice(0, 5).map(([strategy, progress]) => (
                <div key={strategy} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', borderRadius: '8px', background: 'var(--bg-secondary)', fontSize: '12px' }}>
                  <span>{STRATEGY_LABELS[strategy] || strategy}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{progress.correct}/{progress.attempts}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>

        {/* Question review */}
        {questionResults.length > 0 && (
          <div style={{ marginBottom: '24px', textAlign: 'left' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '12px' }}>📋 Question Review</h2>
            <div className="speed-round-review-grid">
              {questionResults.map((qr, i) => (
                <div key={i} style={{
                  padding: '10px 14px', borderRadius: '8px',
                  background: qr.correct ? 'rgba(34,197,94,0.05)' : 'rgba(239,68,68,0.05)',
                  border: `1px solid ${qr.correct ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                }}>
                  <div style={{ fontSize: '13px', marginBottom: '4px' }}>
                    <span style={{ fontWeight: '600', color: qr.correct ? '#16a34a' : '#dc2626' }}>
                      Q{i + 1}: {qr.correct ? '✅ Correct' : '❌ Incorrect'}
                    </span>
                    {qr.challengeStrategy && (
                      <span style={{ marginLeft: '8px', color: 'var(--text-secondary)' }}>
                        {STRATEGY_LABELS[qr.challengeStrategy] || qr.challengeStrategy}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    <MathMarkdown inline>{qr.question.substring(0, 120) + (qr.question.length > 120 ? '…' : '')}</MathMarkdown>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Your answer: <MathMarkdown inline>{qr.studentAnswer.substring(0, 80)}</MathMarkdown>
                    {!qr.correct && qr.correctAnswer && (
                      <> — Correct: <MathMarkdown inline>{qr.correctAnswer}</MathMarkdown></>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
          <button
            onClick={handleRestart}
            style={{
              padding: '14px', fontSize: '16px', fontWeight: '700',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer',
            }}
          >
            🔄 Try Again
          </button>
          <BackToPracticeLink style={{ display: 'inline-flex', justifyContent: 'center', width: '100%', boxSizing: 'border-box' }} />
        </div>
      </div>
    </div>
  );
}
