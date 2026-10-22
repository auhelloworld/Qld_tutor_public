'use client';

import { BookOpen, Target, MessageCircle, Clock, Sparkles } from 'lucide-react';

interface EnglishWeeklySummaryProps {
  data: {
    summary_available?: boolean;
    total_attempts?: number;
    correct_count?: number;
    accuracy?: number;
    writing_submissions?: number;
    strongest_facet_label?: string;
    strongest_facet_accuracy?: number;
    most_practised_facet_label?: string;
    target_skill?: string;
    target_action?: string;
    example_response?: string;
    discussion_prompt?: string;
    home_activity?: string;
  } | null;
  loading?: boolean;
}

export default function EnglishWeeklySummary({ data, loading }: EnglishWeeklySummaryProps) {
  if (!data) return null;

  if (!data.summary_available) {
    return (
      <div className="glass-panel" style={{ padding: '24px', marginTop: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <BookOpen size={22} style={{ color: 'var(--text-muted)' }} />
          <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0 }}>English Weekly Snapshot</h3>
        </div>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0 }}>
          No English practice data yet this week. Encourage your child to complete a few English exercises or submit one writing draft to build their learning profile.
        </p>
      </div>
    );
  }

  const accuracyColor = (data.accuracy || 0) >= 70 ? '#16a34a' : (data.accuracy || 0) >= 40 ? '#d97706' : '#dc2626';

  return (
    <div className="glass-panel" style={{ padding: '28px', marginTop: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <BookOpen size={22} style={{ color: 'var(--accent-color)' }} />
        <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0 }}>English Weekly Snapshot</h3>
        {loading && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: 'auto' }}>Loading...</span>
        )}
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <div style={{ textAlign: 'center', padding: '14px', background: 'var(--bg-secondary)', borderRadius: '10px' }}>
          <div style={{ fontSize: '28px', fontWeight: '800', color: accuracyColor }}>{data.accuracy ?? 0}%</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Accuracy</div>
        </div>
        <div style={{ textAlign: 'center', padding: '14px', background: 'var(--bg-secondary)', borderRadius: '10px' }}>
          <div style={{ fontSize: '28px', fontWeight: '800', color: 'var(--text-primary)' }}>{data.total_attempts ?? 0}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Questions</div>
        </div>
        <div style={{ textAlign: 'center', padding: '14px', background: 'var(--bg-secondary)', borderRadius: '10px' }}>
          <div style={{ fontSize: '28px', fontWeight: '800', color: 'var(--accent-color)' }}>{data.writing_submissions ?? 0}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Drafts</div>
        </div>
        {data.strongest_facet_label && (
          <div style={{ textAlign: 'center', padding: '14px', background: 'var(--bg-secondary)', borderRadius: '10px' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>{data.strongest_facet_label}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Strongest Area{data.strongest_facet_accuracy !== undefined ? ` · ${data.strongest_facet_accuracy}%` : ''}
            </div>
          </div>
        )}
      </div>

      {data.most_practised_facet_label && (
        <p style={{ margin: '-8px 0 18px 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
          Most practised this week: <strong>{data.most_practised_facet_label}</strong>
        </p>
      )}

      {/* Target skill */}
      {data.target_skill && (
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '16px', padding: '14px', background: 'rgba(245,158,11,0.06)', borderRadius: '10px', border: '1px solid rgba(245,158,11,0.15)' }}>
          <Target size={18} style={{ color: '#d97706', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#d97706', marginBottom: '4px' }}>
              Focus Skill: {data.target_skill}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
              {data.target_action}
            </div>
          </div>
        </div>
      )}

      {/* Example response */}
      {data.example_response && (
        <div style={{ marginBottom: '16px', padding: '14px', background: 'rgba(99,102,241,0.06)', borderRadius: '10px', border: '1px solid rgba(99,102,241,0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <Sparkles size={16} style={{ color: 'var(--accent-color)' }} />
            <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Student Work Sample</span>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6', fontStyle: 'italic' }}>
            &ldquo;{data.example_response}&rdquo;
          </div>
        </div>
      )}

      {/* Discussion prompt */}
      {data.discussion_prompt && (
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '16px', padding: '14px', background: 'rgba(34,197,94,0.06)', borderRadius: '10px', border: '1px solid rgba(34,197,94,0.15)' }}>
          <MessageCircle size={18} style={{ color: '#16a34a', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#16a34a', marginBottom: '4px' }}>
              Discussion Prompt
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
              {data.discussion_prompt}
            </div>
          </div>
        </div>
      )}

      {/* 5-minute activity */}
      {data.home_activity && (
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '14px', background: 'rgba(99,102,241,0.06)', borderRadius: '10px', border: '1px solid rgba(99,102,241,0.15)' }}>
          <Clock size={18} style={{ color: 'var(--accent-color)', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent-color)', marginBottom: '4px' }}>
              5-Minute Home Activity
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
              {data.home_activity}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
