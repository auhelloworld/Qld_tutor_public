'use client';
import { useEffect, useState, useMemo } from 'react';
import {
  analyticsScopeFromYear,
  fetchCurriculum,
  fetchDailySummary,
  fetchWeeklyLearningSummary,
  fetchMisconceptions,
  fetchProgressSummary,
  fetchStudyPlans,
  syllabusSubjectFromPickerSubject,
} from '../../lib/api';
import { getSubject, getYear, getNavView, setNavView, type NavView } from '../../lib/preferences';
import FrameworkSubjectYearPicker from '../../components/FrameworkSubjectYearPicker';
import { BarChart3, Target, AlertTriangle, Flame, Zap, Calendar } from 'lucide-react';
import Link from 'next/link';
import {
  topicLabel,
  groupKey,
  findTopicInCurriculum,
  topicBelongsToYear,
} from '../../lib/curriculum_helpers';
import { getLearningGroup, getLearningGroupOrder } from '../../lib/learning_groups';
import { ENABLE_LEARNING_MAP } from '../../lib/feature-flags';
import { buildMistakesHref, buildPracticeHref } from '../../lib/scoped_navigation';
import BackToPracticeLink from '../../components/BackToPracticeLink';
import WeeklyLearningSummary from '../../components/WeeklyLearningSummary';
import WeeklyReportEntryCard from '../../components/WeeklyReportEntryCard';
import { masteryBand } from '../../lib/format';
import { ERROR_TYPE_LABELS } from '../../lib/constants';
import type { Curriculum, TopicProgress, Misconception, CurriculumTopic, DailySummary, WeeklyLearningSummary as WeeklyLearningSummaryData } from '../../lib/api-types';

const PLAN_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  concept_reteach: { bg: 'rgba(239,68,68,0.15)', color: '#dc2626', label: '⚠️ Reteach' },
  drill_practice: { bg: 'rgba(251,191,36,0.15)', color: '#d97706', label: '🔁 Drill' },
  explain_prioritized: { bg: 'rgba(168,85,247,0.15)', color: '#c084fc', label: '📖 Explain' },
  daily_practice: { bg: 'rgba(59,130,246,0.15)', color: '#3b82f6', label: '📝 Practice' },
  weekly_revision: { bg: 'rgba(34,197,94,0.15)', color: '#16a34a', label: '🔄 Revise' },
  assessment: { bg: 'rgba(59,130,246,0.15)', color: '#3b82f6', label: '🚀 Start' },
};

const SORT_LABELS: Record<string, string> = {
  mastery: 'Weakest first',
  accuracy: 'Lowest accuracy',
  attempts: 'Most attempts',
};

interface TopicPlan {
  topic: string;
  action: string;
  message: string;
}

function hasDirectLearningEvidence(topic: TopicProgress): boolean {
  if (topic.direct_attempts_count !== undefined) {
    return topic.direct_attempts_count > 0;
  }
  if ((topic.diagnostic_evidence?.direct_questions ?? 0) > 0) return true;
  if (topic.diagnostic_evidence?.inferred_from_strand) return false;
  // Compatibility only for payloads from before direct_attempts_count existed.
  return (topic.evidence_count ?? topic.attempts_count) > 0;
}

function hasInferredOnlyEvidence(topic: TopicProgress): boolean {
  return Boolean(topic.diagnostic_evidence?.inferred_from_strand)
    && !hasDirectLearningEvidence(topic);
}

export default function Dashboard() {
  const [progress, setProgress] = useState<TopicProgress[]>([]);
  const [directAttemptTotal, setDirectAttemptTotal] = useState(0);
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [misconceptions, setMisconceptions] = useState<Misconception[]>([]);
  const [misconceptionLoadError, setMisconceptionLoadError] = useState<string | null>(null);
  const [daily, setDaily] = useState<DailySummary | null>(null);
  const [weeklySummary, setWeeklySummary] = useState<WeeklyLearningSummaryData | null>(null);
  const [plans, setPlans] = useState<Record<string, TopicPlan>>({});
  const [, setPlansLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pickerValue, setPickerValue] = useState({ subject: 'math', year: 'year7' });
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setPickerValue({ subject: getSubject(), year: getYear() });
    });
    return () => { active = false; };
  }, []);
  const [sortMode, setSortMode] = useState<'mastery' | 'accuracy' | 'attempts'>('mastery');
  // Curriculum view shared with the Learning Map navigation (same preference key).
  const [navView, setNavViewState] = useState<NavView>('learning');
  useEffect(() => {
    if (!ENABLE_LEARNING_MAP) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setNavViewState(getNavView());
    });
    return () => { active = false; };
  }, []);
  const learningMode = ENABLE_LEARNING_MAP && navView === 'learning';
  const changeNavView = (next: NavView) => { setNavViewState(next); setNavView(next); };
  const practiceHref = buildPracticeHref({ subject: pickerValue.subject, year: pickerValue.year });
  const changeScope = (next: { subject: string; year: string }) => {
    setLoadError(null);
    setLoading(true);
    setPlans({});
    setMisconceptionLoadError(null);
    setPickerValue(next);
  };
  const retryLoad = () => {
    setLoadError(null);
    setLoading(true);
    setPlans({});
    setMisconceptionLoadError(null);
    setReloadKey(value => value + 1);
  };

  useEffect(() => { document.title = 'Analytics — QLD AI Tutor'; return () => { document.title = 'QLD AI Tutor'; }; }, []);

  useEffect(() => {
    const abort = new AbortController();
    const analyticsScope = {
      ...analyticsScopeFromYear(pickerValue.year),
      includeUnattempted: true,
      syllabusSubject: syllabusSubjectFromPickerSubject(pickerValue.subject),
    };
    const misconceptionRequest = fetchMisconceptions({ subject: pickerValue.subject }, abort.signal)
      .catch(error => {
        if (!abort.signal.aborted) {
          console.warn('Optional misconception guidance unavailable:', error);
          setMisconceptionLoadError('Optional misconception guidance is unavailable; core progress and study plans remain available.');
        }
        return [] as Misconception[];
      });
    Promise.all([
      fetchProgressSummary(pickerValue.subject, abort.signal, analyticsScope),
      fetchCurriculum(abort.signal, {
        subject: pickerValue.subject,
        scope: pickerValue.year,
      }),
      misconceptionRequest,
      fetchDailySummary(pickerValue.subject, abort.signal, analyticsScope).catch(() => null),
      fetchWeeklyLearningSummary(7, abort.signal).catch(() => null),
    ])
      .then(([progressSummary, curr, mis, day, week]) => {
        const prog = progressSummary.topics;
        setProgress(prog);
        setDirectAttemptTotal(progressSummary.total_direct_attempts);
        setCurriculum(curr);
        setMisconceptions(mis || []);
        setDaily(day);
        setWeeklySummary(week);
        setLoadError(null);
        setLoading(false);

        // Fetch study plans for the weakest 6 topics of the active year level
        if (prog && prog.length > 0) {
          setPlansLoading(true);
          const activeYearFiltered = prog.filter(p =>
            topicBelongsToYear(String(p.topic ?? ''), pickerValue.subject, pickerValue.year, curr)
            && hasDirectLearningEvidence(p)
          );
          const sortedByMastery = [...activeYearFiltered].sort((a, b) => (a.bkt_mastery ?? -1) - (b.bkt_mastery ?? -1));
          const weakestTopics = sortedByMastery.slice(0, 6).map(p => p.topic);
          fetchStudyPlans(pickerValue.subject, weakestTopics, abort.signal).then(result => {
            setPlans((result?.plans || {}) as Record<string, TopicPlan>);
            setPlansLoading(false);
          }).catch(() => setPlansLoading(false));
        }
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error(error);
        setLoadError('Could not load learning analytics. Your saved progress has not been removed.');
        setLoading(false);
      });
    return () => abort.abort();
  }, [pickerValue.subject, pickerValue.year, reloadKey]);

  const yearFilteredProgress = progress.filter(p =>
    topicBelongsToYear(String(p.topic ?? ''), pickerValue.subject, pickerValue.year, curriculum)
  );

  const sortedProgress = useMemo(() => {
    const arr = [...yearFilteredProgress];
    if (sortMode === 'mastery') arr.sort((a, b) => (a.bkt_mastery ?? -1) - (b.bkt_mastery ?? -1));
    else if (sortMode === 'accuracy') arr.sort((a, b) => (a.accuracy ?? -1) - (b.accuracy ?? -1));
    else arr.sort((a, b) => b.attempts_count - a.attempts_count);
    return arr;
  }, [yearFilteredProgress, sortMode]);

  // Bucket by learning group (default) or official strand (toggle).
  const { buckets, groupNames, totalAttempts, masteredCount, avgMastery, directCoveredCount, estimatedCount, notStartedCount, recommendedTopic } = useMemo(() => {
    const b: Record<string, { key: string; topicData: TopicProgress; resolved: CurriculumTopic | null }[]> = {};
    for (const topicData of sortedProgress) {
      const topicKey = String(topicData?.topic ?? '');
      const resolved = findTopicInCurriculum(curriculum, topicKey);
      let gk = resolved ? groupKey(resolved) : 'Other';
      if (learningMode && resolved) {
        gk = getLearningGroup(resolved, pickerValue.subject, pickerValue.year) ?? gk;
      }
      if (!b[gk]) b[gk] = [];
      b[gk].push({ key: topicKey, topicData, resolved });
    }
    const order = learningMode ? getLearningGroupOrder(pickerValue.subject, pickerValue.year) : [];
    const gn = Object.keys(b).sort((g1, g2) => {
      if (g1 === 'Other') return 1; if (g2 === 'Other') return -1;
      // Canonical learning-group order first (keeps headers aligned with navigation).
      const i1 = order.indexOf(g1); const i2 = order.indexOf(g2);
      if (i1 !== -1 && i2 !== -1) return i1 - i2;
      if (i1 !== -1) return -1;
      if (i2 !== -1) return 1;
      if (sortMode === 'mastery') {
        const g1Min = Math.min(...b[g1].map(x => x.topicData.bkt_mastery ?? -1));
        const g2Min = Math.min(...b[g2].map(x => x.topicData.bkt_mastery ?? -1));
        return g1Min - g2Min;
      }
      return g1.localeCompare(g2);
    });
    const directTopics = sortedProgress.filter(hasDirectLearningEvidence);
    const inferredTopics = sortedProgress.filter(hasInferredOnlyEvidence);
    const attempts = directAttemptTotal;
    const notStarted = sortedProgress.filter(p => (p.evidence_count ?? p.attempts_count) === 0).length;
    const mastered = directTopics.filter(p => p.status === 'mastered').length;
    const masteryEvidence = directTopics.filter(p => p.bkt_mastery !== null && p.bkt_mastery !== undefined);
    const avg = masteryEvidence.length > 0
      ? (masteryEvidence.reduce((sum, topic) => sum + (topic.bkt_mastery ?? 0), 0) / masteryEvidence.length * 100).toFixed(0)
      : 0;
    const nextTopic = [...directTopics]
      .filter(topic => topic.status !== 'mastered')
      .sort((a, b) => (a.bkt_mastery ?? -1) - (b.bkt_mastery ?? -1))[0] ?? null;
    return {
      buckets: b,
      groupNames: gn,
      totalAttempts: attempts,
      masteredCount: mastered,
      avgMastery: avg,
      directCoveredCount: directTopics.length,
      estimatedCount: inferredTopics.length,
      notStartedCount: notStarted,
      recommendedTopic: nextTopic,
    };
  }, [sortedProgress, curriculum, learningMode, pickerValue.subject, pickerValue.year, sortMode, directAttemptTotal]);

  if (loading) return <div role="status" aria-live="polite" className="app-container" style={{ alignItems: 'center', justifyContent: 'center' }}>Loading Analytics...</div>;

  if (loadError) {
    return (
      <div className="app-container" style={{ flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', textAlign: 'center', padding: '24px' }}>
        <div role="alert" className="glass-panel" style={{ maxWidth: '560px', padding: '24px' }}>
          <AlertTriangle aria-hidden="true" color="var(--error)" style={{ margin: '0 auto 12px' }} />
          <h1 style={{ fontSize: '20px', marginBottom: '8px' }}>Analytics unavailable</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>{loadError}</p>
          <button type="button" onClick={retryLoad} className="btn-primary" style={{ minHeight: '44px', padding: '10px 18px' }}>
            Retry
          </button>
        </div>
        <BackToPracticeLink href={practiceHref} />
      </div>
    );
  }

  return (
    <div className="app-container" style={{ flexDirection: 'column', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '12px' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '24px' }}>
          <BarChart3 color="var(--accent-color)" /> Progress & Next Step
        </h1>
        <BackToPracticeLink href={practiceHref} />
      </div>

      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Picker */}
        {curriculum && (
          <div className="glass-panel" style={{ padding: '16px' }}>
            <FrameworkSubjectYearPicker curriculum={curriculum} value={pickerValue} onChange={changeScope} />
          </div>
        )}

        <WeeklyReportEntryCard summary={weeklySummary} />

        {/* Summary bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
          <SummaryCard icon={<Target size={20} color="#16a34a" />} label="Mastered from direct evidence" value={`${masteredCount}/${directCoveredCount} topics`} sub={`Avg direct mastery ${avgMastery}%`} />
          <SummaryCard icon={<BarChart3 size={20} color="#6366f1" />} label="Coverage" value={`${directCoveredCount}/${sortedProgress.length} direct`} sub={`${estimatedCount} estimated · ${notStartedCount} not started`} />
          <SummaryCard icon={<Calendar size={20} color="#c084fc" />} label="All Time" value={`${totalAttempts} direct attempt${totalAttempts === 1 ? '' : 's'}`} sub="Physical scored events, excluding strand estimates" />
          {daily ? (
            <>
              <SummaryCard icon={<Flame size={20} color="#f59e0b" />} label="Across all subjects streak" value={`${daily.streak_days ?? 0} day${daily.streak_days !== 1 ? 's' : ''}`} sub={daily.streak_message ?? ''} />
              <SummaryCard icon={<Zap size={20} color="#3b82f6" />} label="Across all subjects today" value={`${daily.today_attempts} attempts`} sub={`${(daily.today_accuracy ?? 0).toFixed(0)}% accuracy · ${daily.today_correct ?? 0} correct`} />
            </>
          ) : (
            <>
              <SummaryCard icon={<Flame size={20} color="#f59e0b" />} label="Across all subjects streak" value="—" sub="Unavailable" />
              <SummaryCard icon={<Zap size={20} color="#3b82f6" />} label="Across all subjects today" value="—" sub="Unavailable" />
            </>
          )}
        </div>

        <WeeklyLearningSummary summary={weeklySummary} audience="student" />

        <a
          href="/lab"
          className="glass-panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px 16px',
            color: 'var(--text-primary)',
            textDecoration: 'none',
            border: '1px solid var(--border-color)',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: '22px' }}>🧪</span>
          <span>
            <strong style={{ display: 'block' }}>Interactive Maths Lab</strong>
            <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Explore graphs, geometry, statistics and senior mathematics visually.</span>
          </span>
        </a>

        {misconceptionLoadError && (
          <div role="status" aria-live="polite" style={{ marginBottom: '16px', padding: '10px 12px', borderRadius: '8px', color: 'var(--text-secondary)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
            {misconceptionLoadError}
          </div>
        )}

        {recommendedTopic && (
          <div className="glass-panel" style={{
            padding: '18px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: '16px', flexWrap: 'wrap', borderLeft: '4px solid var(--accent-color)',
          }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--accent-color)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                Recommended next step
              </div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Continue with {topicLabel(findTopicInCurriculum(curriculum, recommendedTopic.topic), recommendedTopic.topic)}
              </div>
              <div style={{ marginTop: '4px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                {plans[recommendedTopic.topic]?.message || 'Use one short practice set to strengthen the weakest directly assessed topic.'}
              </div>
            </div>
            <Link
              href={buildPracticeHref({ subject: pickerValue.subject, year: pickerValue.year, topic: recommendedTopic.topic })}
              className="btn-primary"
              style={{ padding: '10px 18px', textDecoration: 'none', fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              Continue practising →
            </Link>
          </div>
        )}

        {sortedProgress.length === 0 ? (
          <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
            <div style={{ fontSize: '16px', fontWeight: '600' }}>No learning data for {pickerValue.year.replace('year', 'Year ')}</div>
            <div style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
              Start practising to see your progress here.
            </div>
            <Link href={practiceHref}
              style={{
                display: 'inline-block', marginTop: '16px', fontSize: '13px', padding: '8px 16px',
                borderRadius: '8px', background: 'rgba(99,102,241,0.12)', color: 'var(--accent-color)',
                border: '1px solid rgba(99,102,241,0.3)', textDecoration: 'none', fontWeight: '600',
              }}>
              Start Practising →
            </Link>
          </div>
        ) : (
          <>
            {/* Sort controls + view toggle */}
            <div role="group" aria-label="Sort topics" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Sort by:</span>
              {(['mastery', 'accuracy', 'attempts'] as const).map(m => (
                <button key={m} type="button" aria-pressed={sortMode === m} onClick={() => setSortMode(m)} style={{
                  padding: '5px 10px', fontSize: '13px', borderRadius: '6px', cursor: 'pointer',
                  background: sortMode === m ? 'var(--accent-color)' : 'transparent',
                  color: sortMode === m ? '#fff' : 'var(--text-primary)',
                  border: `1px solid ${sortMode === m ? 'var(--accent-color)' : 'var(--border-color)'}`,
                  fontWeight: '600',
                }}>{SORT_LABELS[m]}</button>
              ))}
              {ENABLE_LEARNING_MAP && (
                <span role="group" aria-label="Group by" style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
                  <button onClick={() => changeNavView('learning')} aria-pressed={navView === 'learning'} style={{
                    padding: '5px 10px', fontSize: '12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 700,
                    background: navView === 'learning' ? 'rgba(59,130,246,0.12)' : 'transparent',
                    color: navView === 'learning' ? 'var(--accent-color)' : 'var(--text-secondary)',
                    border: `1px solid ${navView === 'learning' ? 'var(--accent-color)' : 'var(--border-color)'}`,
                  }}>Learning map</button>
                  <button onClick={() => changeNavView('strands')} aria-pressed={navView === 'strands'} style={{
                    padding: '5px 10px', fontSize: '12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 700,
                    background: navView === 'strands' ? 'rgba(59,130,246,0.12)' : 'transparent',
                    color: navView === 'strands' ? 'var(--accent-color)' : 'var(--text-secondary)',
                    border: `1px solid ${navView === 'strands' ? 'var(--accent-color)' : 'var(--border-color)'}`,
                  }}>Curriculum strands</button>
                </span>
              )}
            </div>

            {groupNames.map(gName => (
              <section key={gName}>
                <h2 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--accent-color)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px', paddingBottom: '6px', borderBottom: '1px solid var(--border-color)' }}>
                  {gName}
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: '20px' }}>
                  {buckets[gName].map(({ key, topicData, resolved }) => {
                    const plan = plans[key];
                    const mastery = topicData.bkt_mastery;
                    const accuracy = topicData.accuracy;
                    const evidenceCount = topicData.evidence_count ?? topicData.attempts_count;
                    const directEvidence = hasDirectLearningEvidence(topicData);
                    const inferredDiagnostic = hasInferredOnlyEvidence(topicData);
                    const directEvidenceCount = topicData.direct_attempts_count ?? topicData.diagnostic_evidence?.direct_questions ?? (directEvidence ? evidenceCount : 0);
                    const isNotStarted = topicData.status === 'not_started' || evidenceCount === 0 || mastery === null || mastery === undefined;
                    const isMastered = directEvidence && !isNotStarted && topicData.status === 'mastered';
                    // Mastery does not fade; a low current estimate on a mastered topic means "review", not "weak".
                    const isWeak = directEvidence && !isNotStarted && !isMastered && mastery <= 0.5;
                    const confidence = topicData.confidence ?? (evidenceCount > 0 ? 'medium' : 'none');
                    const desc = masteryBand({
                      status: topicData.status,
                      bktMastery: mastery,
                      confidence,
                      evidenceCount,
                      accuracy,
                    });
                    return (
                      <div key={key} className="glass-panel" style={{ padding: '20px', borderColor: isWeak ? 'rgba(239,68,68,0.3)' : undefined }}>
                        {/* Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '12px' }}>
                          <div style={{ flex: 1 }}>
                            <h3 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              {topicLabel(resolved, key)}
                              <span style={{
                                fontSize: '10px',
                                background: 'rgba(99,102,241,0.1)',
                                color: 'var(--accent-color)',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontFamily: 'monospace',
                                fontWeight: '600'
                              }}>
                                {key}
                              </span>
                            </h3>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                {isNotStarted
                                  ? 'Not started'
                                  : inferredDiagnostic
                                    ? 'Strand estimate only'
                                    : `${directEvidenceCount} direct evidence`}
                              </span>
                              {(inferredDiagnostic || confidence === 'low' || confidence === 'none') && (
                                <span style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '999px', background: 'rgba(251,191,36,0.16)', color: '#d97706', fontWeight: 700 }}>
                                  {inferredDiagnostic ? 'Not directly tested' : 'Low confidence'}
                                </span>
                              )}
                            </div>
                          </div>
                          {/* Action badge */}
                          {inferredDiagnostic ? (
                            <span style={{
                              fontSize: '11px', padding: '2px 10px', borderRadius: '12px', fontWeight: '700', whiteSpace: 'nowrap',
                              background: 'rgba(245,158,11,0.14)', color: '#d97706',
                            }}>
                              Estimate only
                            </span>
                          ) : isMastered ? (
                            <span style={{ fontSize: '11px', padding: '2px 10px', borderRadius: '12px', fontWeight: '700', whiteSpace: 'nowrap', background: desc.band === 'Extension-ready' ? 'rgba(124,58,237,0.15)' : 'rgba(34,197,94,0.15)', color: desc.color }}>
                              {desc.band === 'Extension-ready' ? '🚀 Extension-ready' : '✅ Secure'}
                            </span>
                          ) : isNotStarted ? (
                            <span style={{
                              fontSize: '11px', padding: '2px 10px', borderRadius: '12px', fontWeight: '700', whiteSpace: 'nowrap',
                              background: PLAN_STYLES.assessment.bg,
                              color: PLAN_STYLES.assessment.color,
                            }}>
                              {PLAN_STYLES.assessment.label}
                            </span>
                          ) : plan ? (
                            <span style={{
                              fontSize: '11px', padding: '2px 10px', borderRadius: '12px', fontWeight: '700', whiteSpace: 'nowrap',
                              background: (PLAN_STYLES[plan.action] || PLAN_STYLES.daily_practice).bg,
                              color: (PLAN_STYLES[plan.action] || PLAN_STYLES.daily_practice).color,
                            }}>
                              {(PLAN_STYLES[plan.action] || PLAN_STYLES.daily_practice).label}
                            </span>
                          ) : null}
                        </div>

                        {/* Mastery bar */}
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '3px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><BarChart3 size={12} /> {inferredDiagnostic ? 'Estimated level' : 'Mastery'}</span>
                            <span style={{ color: inferredDiagnostic ? '#d97706' : desc.color, fontWeight: 600 }}>
                              {inferredDiagnostic ? 'Not directly tested' : `${desc.band}${!isNotStarted && desc.showPercent ? ` · ${(mastery * 100).toFixed(0)}%` : ''}`}
                            </span>
                          </div>
                          <div
                            role="progressbar"
                            aria-label={`${inferredDiagnostic ? 'Estimated level' : 'Current mastery'} for ${topicLabel(resolved, key)}`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round((isNotStarted ? 0 : mastery) * 100)}
                            aria-valuetext={inferredDiagnostic ? 'Not directly tested' : desc.band}
                            style={{ width: '100%', height: '6px', background: 'var(--bg-primary)', borderRadius: '3px' }}
                          >
                            <div style={{
                              width: `${isNotStarted ? 0 : mastery * 100}%`, height: '100%', borderRadius: '3px',
                              background: inferredDiagnostic ? '#d97706' : isMastered ? '#16a34a' : isWeak ? '#dc2626' : 'var(--accent-color)',
                              opacity: inferredDiagnostic ? 0.45 : 1,
                            }} />
                          </div>
                        </div>

                        {/* Mini stats row */}
                        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', fontSize: '12px' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--text-secondary)' }}>
                            <Target size={12} /> {inferredDiagnostic ? 'No direct accuracy yet' : accuracy === null || accuracy === undefined ? 'No accuracy yet' : `${(accuracy * 100).toFixed(0)}% accuracy`}
                          </span>
                          {directEvidence && plan?.message && (
                            <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              💬 {plan.message}
                            </span>
                          )}
                        </div>

                        {/* Practice and Review links */}
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: topicData.top_errors && Object.keys(topicData.top_errors).length > 0 ? '10px' : 0 }}>
                          <Link href={buildPracticeHref({ subject: pickerValue.subject, year: pickerValue.year, topic: key })}
                            style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '6px', background: 'rgba(99,102,241,0.15)', color: 'var(--accent-color)', textDecoration: 'none', fontWeight: '600', display: 'inline-block' }}>
                            {inferredDiagnostic ? 'Practise to confirm →' : 'Practise →'}
                          </Link>
                          {directEvidence && topicData.top_errors && Object.keys(topicData.top_errors).length > 0 && (
                            <Link href={buildMistakesHref({ subject: pickerValue.subject, year: pickerValue.year, topic: key })}
                              style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '6px', background: 'rgba(239,68,68,0.12)', color: 'var(--error)', textDecoration: 'none', fontWeight: '600', display: 'inline-block' }}>
                              ⚠️ Review Mistakes
                            </Link>
                          )}
                        </div>

                        {/* Errors — compact, only if errors exist */}
                        {isWeak && topicData.top_errors && Object.keys(topicData.top_errors).length > 0 && (
                          <div style={{ background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.15)', padding: '10px 12px', borderRadius: '6px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--error)', fontWeight: '600', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <AlertTriangle size={12} /> Historical error evidence
                            </div>
                            {topicData.top_misconceptions && Object.keys(topicData.top_misconceptions).length > 0 && (
                              Object.entries(topicData.top_misconceptions).slice(0, 2).map(([mid, count]) => {
                                const mc = misconceptions.find(m => m.misconception_id === mid);
                                return (
                                  <div key={mid} style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{mc?.name || mid.replace(/_/g, ' ')}</span>
                                    <span>{String(count)}×</span>
                                  </div>
                                );
                              })
                            )}
                            {Object.entries(topicData.top_errors).slice(0, 2).map(([err, count]) => (
                              <div key={err} style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                                <span>{ERROR_TYPE_LABELS[err] || err.replace(/_/g, ' ')}</span>
                                <span>{String(count)}×</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="glass-panel" style={{ padding: '16px', textAlign: 'center' }}>
      <div style={{ marginBottom: '6px' }}>{icon}</div>
      <div style={{ fontSize: '20px', fontWeight: '700' }}>{value}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{label}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', opacity: 0.8 }}>{sub}</div>
    </div>
  );
}
