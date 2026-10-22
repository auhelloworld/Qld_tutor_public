import Link from 'next/link';
import { ArrowRight, BookOpenCheck, CalendarDays, Sparkles } from 'lucide-react';
import type { WeeklyLearningSummary } from '../lib/api-types';

interface WeeklyReportEntryCardProps {
  summary: WeeklyLearningSummary | null;
}

export default function WeeklyReportEntryCard({ summary }: WeeklyReportEntryCardProps) {
  const evidenceLine = !summary
    ? 'Open your Monday–Sunday review, even when learning evidence is still building.'
    : summary.attempts === 0
      ? 'No scored practice yet — choose one small next step for this week.'
      : `${summary.first_independent_correct} first-try independent · ${summary.mistake_closures} mistake${summary.mistake_closures === 1 ? '' : 's'} closed · ${summary.activity_days} active day${summary.activity_days === 1 ? '' : 's'}`;

  return (
    <Link
      href="/weekly-report"
      className="glass-panel"
      aria-label="Open my weekly learning review"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '20px',
        padding: '22px 24px',
        color: 'var(--text-primary)',
        textDecoration: 'none',
        border: '1px solid rgba(99,102,241,0.35)',
        background: 'linear-gradient(135deg, rgba(79,70,229,0.14), rgba(14,165,233,0.08), rgba(255,255,255,0.78))',
        boxShadow: '0 14px 36px rgba(79,70,229,0.12)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', minWidth: 0, flex: '1 1 420px' }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '14px',
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          background: 'var(--accent-gradient)',
          boxShadow: 'var(--accent-glow)',
          flexShrink: 0,
        }}>
          <BookOpenCheck size={25} aria-hidden="true" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--accent-color)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Your weekly review
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <CalendarDays size={12} aria-hidden="true" /> Monday–Sunday
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: '21px', fontWeight: 800 }}>See what you learned and choose one next step</h2>
          <p style={{ margin: '5px 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
            {evidenceLine}
          </p>
        </div>
      </div>
      <span className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 16px', fontSize: '13px', fontWeight: 800, whiteSpace: 'nowrap' }}>
        <Sparkles size={15} aria-hidden="true" /> Open review <ArrowRight size={15} aria-hidden="true" />
      </span>
    </Link>
  );
}
