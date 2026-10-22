'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Lightbulb,
  RefreshCw,
  Save,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import { fetchStudentWeeklyReport, saveStudentWeeklyReflection } from '../../lib/api';
import type { StudentWeeklyReflection, StudentWeeklyReport, WeeklyReportEvidenceStatus, WeeklyTopicActivity, WeeklyTopicDetail } from '../../lib/api-types';

interface ReflectionDraft {
  proud_of: string;
  challenge: string;
  next_week_intention: string;
}

const EMPTY_REFLECTION: ReflectionDraft = {
  proud_of: '',
  challenge: '',
  next_week_intention: '',
};

function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${isoDate}T00:00:00Z`));
}

function weekOptionLabel(weekStart: string, currentWeekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const range = `${new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(start)}–${new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(end)}`;
  return `${weekStart === currentWeekStart ? 'Current week' : 'Week'} · ${range}`;
}

function evidenceLabel(status: WeeklyReportEvidenceStatus): string {
  if (status === 'sufficient') return 'Enough practice to choose a focus';
  if (status === 'limited') return 'Still building a picture';
  return 'Start with one small set';
}

function evidenceColours(status: WeeklyReportEvidenceStatus): { color: string; background: string; border: string } {
  if (status === 'sufficient') return { color: '#047857', background: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.24)' };
  if (status === 'limited') return { color: '#b45309', background: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.25)' };
  return { color: 'var(--text-secondary)', background: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.20)' };
}

function signedNumber(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

interface EvidenceReflectionPrompt {
  question: string;
  evidence: string;
  placeholder: string;
}

function evidenceReflectionPrompt(report: StudentWeeklyReport): EvidenceReflectionPrompt {
  const summary = report.summary;
  if (summary.high_confidence_errors > 0) {
    return {
      question: 'What clue will you use next time to check an answer that feels certain?',
      evidence: `${summary.high_confidence_errors} high-confidence error${summary.high_confidence_errors === 1 ? '' : 's'} this week`,
      placeholder: 'Name one check you can do before submitting.',
    };
  }
  if (summary.supported_correct > summary.first_independent_correct) {
    return {
      question: 'What will you try before opening Concept or Chat next time?',
      evidence: `${summary.supported_correct} answer${summary.supported_correct === 1 ? '' : 's'} solved with tutor support; ${summary.first_independent_correct} solved independently`,
      placeholder: 'Name one step you can try on your own first.',
    };
  }
  if (summary.mistake_closures > 0) {
    return {
      question: 'What did you change that helped you fix one mistake?',
      evidence: `${summary.mistake_closures} mistake loop${summary.mistake_closures === 1 ? '' : 's'} closed`,
      placeholder: 'Describe the change in your method or checking.',
    };
  }
  if (summary.revision_attempts > 0) {
    return {
      question: 'What became easier after you tried it again later?',
      evidence: `${summary.revision_attempts} revision attempt${summary.revision_attempts === 1 ? '' : 's'}`,
      placeholder: 'Name the idea or step that was easier to recall.',
    };
  }
  if (summary.attempts === 0) {
    return {
      question: 'What is one small practice action you can start with next week?',
      evidence: 'No scored practice evidence yet',
      placeholder: 'Choose a small action, time, or first topic.',
    };
  }
  return {
    question: 'What one small action will help you explain an answer without help next week?',
    evidence: `${summary.first_independent_correct} answer${summary.first_independent_correct === 1 ? '' : 's'} solved without help`,
    placeholder: report.next_week_goal.action,
  };
}

export default function WeeklyReportPage() {
  const [requestedWeek, setRequestedWeek] = useState<string | undefined>();
  const [queryReady, setQueryReady] = useState(false);
  const [report, setReport] = useState<StudentWeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [reflection, setReflection] = useState<ReflectionDraft>(EMPTY_REFLECTION);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const activeWeekRef = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedWeek(params.get('week_start') || undefined);
    setQueryReady(true);
  }, []);

  useEffect(() => {
    document.title = 'My Weekly Learning Review — QLD AI Tutor';
    return () => { document.title = 'QLD AI Tutor'; };
  }, []);

  const loadReport = useCallback((signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    setSaveMessage(null);
    return fetchStudentWeeklyReport(requestedWeek, signal)
      .then(data => {
        activeWeekRef.current = data.week_start;
        setReport(data);
        setReflection(data.reflection ? {
          proud_of: data.reflection.proud_of,
          challenge: data.reflection.challenge,
          next_week_intention: data.reflection.next_week_intention,
        } : EMPTY_REFLECTION);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load your weekly review.');
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
  }, [requestedWeek]);

  useEffect(() => {
    if (!queryReady) return;
    const abort = new AbortController();
    void loadReport(abort.signal);
    return () => abort.abort();
  }, [loadReport, queryReady, retryKey]);

  const chooseWeek = (weekStart: string) => {
    if (saving) return;
    activeWeekRef.current = weekStart;
    setRequestedWeek(weekStart);
    const url = new URL(window.location.href);
    url.searchParams.set('week_start', weekStart);
    window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
  };

  const updateReflection = (field: keyof ReflectionDraft, value: string) => {
    setReflection(current => ({ ...current, [field]: value }));
    setSaveMessage(null);
  };

  const saveReflection = async () => {
    if (!report || saving) return;
    const savingWeekStart = report.week_start;
    setSaving(true);
    setSaveMessage(null);
    try {
      const saved = await saveStudentWeeklyReflection({
        week_start: savingWeekStart,
        ...reflection,
      });
      if (activeWeekRef.current !== saved.week_start) return;
      const savedReflection: StudentWeeklyReflection = {
        proud_of: saved.proud_of,
        challenge: saved.challenge,
        next_week_intention: saved.next_week_intention,
        updated_at: saved.updated_at,
      };
      setReport(current => current?.week_start === saved.week_start
        ? { ...current, reflection: savedReflection }
        : current);
      setSaveMessage('Reflection saved for this week.');
    } catch (saveError) {
      setSaveMessage(saveError instanceof Error ? saveError.message : 'Could not save your reflection.');
    } finally {
      setSaving(false);
    }
  };

  if (!queryReady || loading) {
    return (
      <main style={{ maxWidth: '1080px', margin: '0 auto', padding: '32px 20px' }}>
        <div className="glass-panel" role="status" style={{ padding: '42px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <RefreshCw size={26} aria-hidden="true" style={{ marginBottom: '10px' }} />
          <div>Building your weekly learning review…</div>
        </div>
      </main>
    );
  }

  if (error || !report) {
    return (
      <main style={{ maxWidth: '820px', margin: '0 auto', padding: '32px 20px' }}>
        <div className="glass-panel" role="alert" style={{ padding: '36px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '24px', marginBottom: '8px' }}>Your weekly review is unavailable</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '18px' }}>{error ?? 'No report was returned.'}</p>
          <button className="btn-primary" onClick={() => setRetryKey(value => value + 1)} style={{ padding: '10px 18px' }}>Try again</button>
          <div style={{ marginTop: '16px' }}><Link href="/dashboard">Return to Progress</Link></div>
        </div>
      </main>
    );
  }

  const evidenceStyle = evidenceColours(report.evidence_status);
  const currentWeekStart = report.history_week_starts[0] ?? report.week_start;
  const hasReflection = Boolean(report.reflection);
  const reflectionPrompt = evidenceReflectionPrompt(report);
  const topicsCovered = report.activity_summary?.topic_count ?? Object.values(report.summary.subject_breakdown)
    .reduce((total, subject) => total + Object.keys(subject.topics).length, 0);
  const repeatedTopics = report.activity_summary?.repeated_topic_count ?? Object.values(report.summary.subject_breakdown)
    .reduce((total, subject) => total + Object.values(subject.topics)
      .filter(topic => topic.attempts >= 2).length, 0);
  const nextStepCount = report.next_week_goal.practice_count ?? 3;
  const nextStepStartText = nextStepCount > 0
    ? `Try ${nextStepCount} short question${nextStepCount === 1 ? '' : 's'}.`
    : 'Do not add a new practice set.';
  const nextStepHref = report.next_week_goal.href ?? (report.next_week_goal.subject
    ? `/guided-practice?subject=${encodeURIComponent(report.next_week_goal.subject)}${report.next_week_goal.topic ? `&topic=${encodeURIComponent(report.next_week_goal.topic)}` : ''}`
    : '/guided-practice');

  return (
    <main style={{ maxWidth: '1080px', margin: '0 auto', padding: '24px 20px 56px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '22px' }}>
        <div>
          <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '13px', marginBottom: '8px' }}>
            <ArrowLeft size={14} aria-hidden="true" /> Back to Progress
          </Link>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '11px', margin: 0, fontSize: 'clamp(26px, 4vw, 36px)', fontWeight: 800 }}>
            <BookOpenCheck color="var(--accent-color)" aria-hidden="true" /> My Weekly Learning Review
          </h1>
          <p style={{ margin: '5px 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
            Notice progress, choose one focus, and make your next step clear.
          </p>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '230px', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
          Review week
          <select
            value={report.week_start}
            disabled={saving}
            onChange={event => chooseWeek(event.target.value)}
            style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', font: 'inherit' }}
          >
            {report.history_week_starts.map(weekStart => (
              <option key={weekStart} value={weekStart}>{weekOptionLabel(weekStart, currentWeekStart)}</option>
            ))}
          </select>
        </label>
      </header>

      <section className="glass-panel" style={{ padding: '22px 24px', marginBottom: '18px', background: 'linear-gradient(135deg, rgba(79,70,229,0.12), rgba(255,255,255,0.78))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--accent-color)', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <CalendarDays size={14} aria-hidden="true" /> {report.is_current_week ? 'Week in progress' : 'Completed week'}
            </div>
            <h2 style={{ margin: '5px 0 2px', fontSize: '23px' }}>{formatDate(report.week_start)} – {formatDate(report.week_end)}</h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>Monday–Sunday · Australia/Brisbane · all subjects</p>
          </div>
          <span style={{ padding: '7px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, color: evidenceStyle.color, background: evidenceStyle.background, border: `1px solid ${evidenceStyle.border}` }}>
            {evidenceLabel(report.evidence_status)}
          </span>
        </div>
      </section>

      <section className="glass-panel" aria-labelledby="next-step-heading" style={{ padding: '24px', marginBottom: '18px', borderTop: '4px solid #4f46e5', background: 'linear-gradient(135deg, rgba(79,70,229,0.11), rgba(255,255,255,0.78))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: '#4f46e5', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <Target size={18} aria-hidden="true" /> Your one next step
        </div>
        <h2 id="next-step-heading" style={{ margin: '7px 0 5px', fontSize: '22px' }}>{report.next_week_goal.title}</h2>
        <p style={{ margin: 0, maxWidth: '820px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>{report.next_week_goal.action}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '9px', marginTop: '16px' }}>
          <ActionStep number="1" label={nextStepCount > 0 ? 'Start' : 'Use existing work'} text={nextStepStartText} />
          <ActionStep
            number="2"
            label={report.next_week_goal.kind === 'review' ? 'Correct one step' : report.next_week_goal.kind === 'reflect' ? 'Reflect' : 'Work independently'}
            text={report.next_week_goal.kind === 'review'
              ? 'Use one existing mistake instead of starting more questions.'
              : report.next_week_goal.kind === 'reflect'
                ? 'Write one strategy you want to remember next week.'
                : 'Make a real first attempt before opening Concept or Chat.'}
          />
          <ActionStep number="3" label="You are done when" text={report.next_week_goal.success_criteria ?? 'You can explain one key step in your own words.'} />
        </div>
        {report.next_week_goal.help_guidance && (
          <p style={{ margin: '12px 0 0', color: 'var(--text-secondary)', fontSize: '12px', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--text-primary)' }}>If you get stuck:</strong> {report.next_week_goal.help_guidance}
          </p>
        )}
        <Link
          href={nextStepHref}
          className="btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '15px', padding: '10px 16px', textDecoration: 'none', fontSize: '13px' }}
        >
          {report.next_week_goal.cta_label ?? 'Start this practice'} <ChevronRight size={15} aria-hidden="true" />
        </Link>
      </section>

      <section className="glass-panel" aria-labelledby="weekly-evidence-heading" style={{ padding: '22px', marginBottom: '18px' }}>
        <h2 id="weekly-evidence-heading" style={{ fontSize: '19px', marginBottom: '4px' }}>Your week at a glance</h2>
        <p style={{ margin: '0 0 13px', color: 'var(--text-secondary)', fontSize: '12.5px' }}>
          {report.activity_summary?.message ?? 'What you completed—not a score or a label of your ability.'}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '10px' }}>
          <Metric label="Questions completed" value={report.summary.attempts} detail={`${report.summary.activity_days} active day${report.summary.activity_days === 1 ? '' : 's'}`} />
          <Metric label="Topics covered" value={topicsCovered} detail={`${repeatedTopics} with repeated evidence`} />
          <Metric label="Correct independently" value={report.summary.first_independent_correct} detail="first try, no tutor support" />
          <Metric label="Correct with tutor support" value={report.summary.supported_correct} detail="next: retry one independently" />
          <Metric label="Mistakes fixed" value={report.summary.mistake_closures} detail={`${report.summary.revision_attempts} question${report.summary.revision_attempts === 1 ? '' : 's'} retried`} />
          <Metric label="Explanations written" value={report.summary.self_explanations} detail="answers explained in your words" />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginTop: '14px', padding: '11px 12px', borderRadius: '10px', background: 'rgba(99,102,241,0.06)', color: 'var(--text-secondary)', fontSize: '12.5px', lineHeight: 1.5 }}>
          <TrendingUp size={16} aria-hidden="true" style={{ color: 'var(--accent-color)', marginTop: '2px', flexShrink: 0 }} />
          {report.comparison.available ? (
            <span><strong style={{ color: 'var(--text-primary)' }}>Compared with last week:</strong> {report.comparison.message} Questions completed {signedNumber(report.comparison.attempts_delta)}; correct independently {signedNumber(report.comparison.first_independent_correct_delta)}.</span>
          ) : (
            <span><strong style={{ color: 'var(--text-primary)' }}>No week-to-week comparison yet.</strong> Complete practice in another week to see how your learning pattern changes.</span>
          )}
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', marginBottom: '18px' }}>
        <InsightCard
          icon={<Sparkles size={19} />}
          eyebrow="What worked"
          title="A win from this week"
          body={report.weekly_highlight}
          colour="#047857"
          background="rgba(16,185,129,0.08)"
          detail={report.weekly_highlight_detail}
        />
        <InsightCard
          icon={<Lightbulb size={19} />}
          eyebrow="What to improve"
          title="Your practice focus"
          body={report.focus_message}
          colour="#b45309"
          background="rgba(245,158,11,0.08)"
          detail={report.focus_detail}
        />
      </div>

      <section aria-labelledby="subjects-heading" style={{ marginBottom: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginBottom: '10px' }}>
          <h2 id="subjects-heading" style={{ fontSize: '20px' }}>By subject</h2>
          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>A focus appears after you try a topic at least twice.</span>
        </div>
        {report.subject_reports.length === 0 ? (
          <div className="glass-panel" style={{ padding: '30px', textAlign: 'center' }}>
            <div style={{ fontSize: '34px', marginBottom: '8px' }}>🌱</div>
            <h3 style={{ fontSize: '17px', marginBottom: '5px' }}>Your report will grow with your practice</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '14px' }}>Complete one short scored set to begin building subject evidence.</p>
            <Link href="/" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 15px', textDecoration: 'none', fontSize: '13px' }}>Choose practice <ChevronRight size={14} /></Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
            {report.subject_reports.map(subject => {
              const subjectEvidence = evidenceColours(subject.evidence_status);
              const subjectTopicCount = subject.topics_touched
                ?? Object.keys(report.summary.subject_breakdown[subject.subject]?.topics ?? {}).length;
              return (
                <article key={subject.subject} className="glass-panel" style={{ padding: '18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '12px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '17px' }}>{subject.subject_label}</h3>
                      <div style={{ marginTop: '3px', color: 'var(--text-secondary)', fontSize: '12px' }}>{subject.attempts} question{subject.attempts === 1 ? '' : 's'} across {subjectTopicCount} topic{subjectTopicCount === 1 ? '' : 's'} · {subject.first_independent_correct} correct independently</div>
                    </div>
                    <span style={{ padding: '4px 7px', borderRadius: '999px', fontSize: '10px', fontWeight: 800, color: subjectEvidence.color, background: subjectEvidence.background, border: `1px solid ${subjectEvidence.border}` }}>
                      {subject.evidence_status === 'sufficient' && subject.accuracy !== null ? `${subject.accuracy.toFixed(0)}% observed` : evidenceLabel(subject.evidence_status)}
                    </span>
                  </div>
                  <SubjectNote label="Bright spot" text={subject.highlight?.message ?? 'More practice is needed before naming a reliable bright spot.'} detail={subject.highlight?.topic_detail} positive />
                  <SubjectNote label="Keep building" text={subject.focus?.message ?? 'No single topic focus is identified yet.'} detail={subject.focus?.topic_detail} />
                  {subject.topic_overview && subject.topic_overview.length > 0 && (
                    <TopicActivityList
                      topics={subject.topic_overview}
                      total={subjectTopicCount}
                      additionalCount={subject.additional_topic_count ?? 0}
                    />
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="glass-panel" aria-labelledby="reflection-heading" style={{ padding: '24px', marginBottom: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '14px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div>
            <h2 id="reflection-heading" style={{ fontSize: '20px', margin: 0 }}>My reflection</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '13px' }}>Answer one question selected from this week’s evidence.</p>
          </div>
          {hasReflection && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#047857', fontSize: '12px', fontWeight: 700 }}><CheckCircle2 size={15} /> Saved</span>}
        </div>
        <div style={{ maxWidth: '760px' }}>
          <div style={{ marginBottom: '10px', padding: '9px 11px', borderRadius: '9px', background: 'rgba(99,102,241,0.07)', color: 'var(--text-secondary)', fontSize: '11.5px' }}>
            <strong style={{ color: 'var(--accent-color)' }}>Evidence trigger:</strong> {reflectionPrompt.evidence}
          </div>
          <ReflectionField
            label={reflectionPrompt.question}
            value={reflection.next_week_intention}
            onChange={value => updateReflection('next_week_intention', value)}
            placeholder={reflectionPrompt.placeholder}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '15px' }}>
          <button className="btn-primary" onClick={saveReflection} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '10px 16px', opacity: saving ? 0.65 : 1 }}>
            <Save size={15} aria-hidden="true" /> {saving ? 'Saving…' : 'Save reflection'}
          </button>
          {saveMessage && <span role="status" style={{ fontSize: '12.5px', color: saveMessage.startsWith('Reflection saved') ? '#047857' : '#b91c1c' }}>{saveMessage}</span>}
        </div>
      </section>

      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '11px', lineHeight: 1.55 }}>
        This report describes observed learning evidence, not ability. {report.evidence_note} {report.activity_summary?.basis_note} Time estimates use attempt timestamp windows and are not stopwatch totals.
      </p>
    </main>
  );
}

function InsightCard({
  icon,
  eyebrow,
  title,
  body,
  colour,
  background,
  detail,
  successCriteria,
  helpGuidance,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  colour: string;
  background: string;
  detail?: WeeklyTopicDetail | null;
  successCriteria?: string;
  helpGuidance?: string;
}) {
  return (
    <article className="glass-panel" style={{ padding: '19px', borderTop: `3px solid ${colour}`, background }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: colour, fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{icon}{eyebrow}</div>
      <h2 style={{ margin: 0, fontSize: '17px' }}>{title}</h2>
      <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.55 }}>{body}</p>
      {detail && <TopicDetail detail={detail} />}
      {(successCriteria || helpGuidance) && (
        <div style={{ marginTop: '11px', paddingTop: '10px', borderTop: '1px solid rgba(79,70,229,0.16)', color: 'var(--text-secondary)', fontSize: '12px', lineHeight: 1.5 }}>
          {successCriteria && <div><strong style={{ color: 'var(--text-primary)' }}>Success looks like:</strong> {successCriteria}</div>}
          {helpGuidance && <div style={{ marginTop: successCriteria ? '6px' : 0 }}><strong style={{ color: 'var(--text-primary)' }}>Using help:</strong> {helpGuidance}</div>}
        </div>
      )}
    </article>
  );
}

function TopicDetail({ detail }: { detail: WeeklyTopicDetail }) {
  return (
    <div style={{ marginTop: '11px', padding: '10px 11px', borderRadius: '9px', background: 'rgba(255,255,255,0.48)', color: 'var(--text-secondary)', fontSize: '12px', lineHeight: 1.5 }}>
      <div><strong style={{ color: 'var(--text-primary)' }}>In simple terms:</strong> {detail.description || `This topic is called ${detail.title}.`}</div>
      {detail.key_idea && <div style={{ marginTop: '5px' }}><strong style={{ color: 'var(--text-primary)' }}>Key idea:</strong> {detail.key_idea}</div>}
      {detail.code && <div style={{ marginTop: '6px', color: 'var(--text-muted)', fontSize: '10.5px' }}>Course code: {detail.code}</div>}
    </div>
  );
}

function TopicActivityList({ topics, total, additionalCount }: { topics: WeeklyTopicActivity[]; total: number; additionalCount: number }) {
  return (
    <details style={{ marginTop: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '9px' }}>
      <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '11.5px', fontWeight: 700 }}>
        See topic activity ({topics.length} of {total})
      </summary>
      <div style={{ display: 'grid', gap: '7px', marginTop: '9px' }}>
        {topics.map(topic => (
          <div key={topic.topic} style={{ padding: '8px 9px', borderRadius: '8px', background: 'rgba(100,116,139,0.06)', fontSize: '11px', color: 'var(--text-secondary)' }}>
            <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: '2px' }}>{topic.title}</strong>
            {topic.attempts} question{topic.attempts === 1 ? '' : 's'} · {topic.correct} correct · {topic.first_independent_correct} first-try independent
            {topic.incorrect > 0 && <span style={{ color: '#b45309' }}> · {topic.incorrect} to review</span>}
          </div>
        ))}
        {additionalCount > 0 && <div style={{ color: 'var(--text-muted)', fontSize: '10.5px' }}>+ {additionalCount} more topic{additionalCount === 1 ? '' : 's'} with lighter evidence</div>}
      </div>
    </details>
  );
}

function ActionStep({ number, label, text }: { number: string; label: string; text: string }) {
  return (
    <div style={{ display: 'flex', gap: '9px', padding: '11px', borderRadius: '10px', border: '1px solid rgba(79,70,229,0.16)', background: 'rgba(255,255,255,0.46)' }}>
      <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: '23px', height: '23px', flexShrink: 0, borderRadius: '999px', background: '#4f46e5', color: 'white', fontSize: '11px', fontWeight: 800 }}>{number}</span>
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-primary)' }}>{label}</strong>
        <span style={{ display: 'block', marginTop: '2px', color: 'var(--text-secondary)', fontSize: '11.5px', lineHeight: 1.45 }}>{text}</span>
      </div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div style={{ padding: '12px', borderRadius: '11px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.35)' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '10.5px', fontWeight: 800, lineHeight: 1.3 }}>{label}</div>
      <div style={{ marginTop: '4px', fontSize: '22px', fontWeight: 800 }}>{new Intl.NumberFormat('en-AU').format(value)}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '10.5px' }}>{detail}</div>
    </div>
  );
}

function SubjectNote({ label, text, detail, positive = false }: { label: string; text: string; detail?: WeeklyTopicDetail | null; positive?: boolean }) {
  return (
    <div style={{ marginTop: '9px', padding: '10px 11px', borderRadius: '9px', background: positive ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.06)', fontSize: '12.5px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
      <strong style={{ display: 'block', color: positive ? '#047857' : '#b45309', fontSize: '11px', marginBottom: '2px' }}>{label}</strong>
      {text}
      {detail && (
        <div style={{ marginTop: '7px', paddingTop: '7px', borderTop: '1px solid rgba(100,116,139,0.16)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{detail.title}</strong>
          {detail.description && <div style={{ marginTop: '2px' }}>{detail.description}</div>}
        </div>
      )}
    </div>
  );
}

function ReflectionField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12.5px', fontWeight: 700 }}>
      {label}
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={500}
        rows={4}
        style={{ width: '100%', resize: 'vertical', padding: '11px 12px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', font: 'inherit', fontWeight: 400, lineHeight: 1.5 }}
      />
      <span style={{ alignSelf: 'flex-end', color: 'var(--text-muted)', fontSize: '10px', fontWeight: 500 }}>{value.length}/500</span>
    </label>
  );
}
