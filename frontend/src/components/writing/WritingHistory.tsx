'use client';
import { useState } from 'react';
import type { WritingAssessmentResponse } from '../../lib/api-types';

interface Props {
  iterations: WritingAssessmentResponse[];
  onTryAgain: () => void;
  maxIterations: number;
}

export default function WritingHistory({ iterations, onTryAgain, maxIterations }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (iterations.length === 0) return null;

  const scoredIterations = iterations.filter(iteration => !iteration.insufficient_evidence);
  const insufficientCount = iterations.length - scoredIterations.length;
  const hasMultiple = scoredIterations.length >= 2;

  // Build a per-criterion comparison for the last two scored iterations.
  const criterionComparison: { name: string; prevScore: number; prevMax: number; curScore: number; curMax: number }[] = [];
  if (hasMultiple) {
    const prev = scoredIterations[scoredIterations.length - 2];
    const cur = scoredIterations[scoredIterations.length - 1];
    const prevMap = new Map(prev.criterion_scores.map(c => [c.criterion_number, c]));
    for (const cs of cur.criterion_scores) {
      const prevCs = prevMap.get(cs.criterion_number);
      criterionComparison.push({
        name: cs.name,
        prevScore: prevCs?.score ?? 0,
        prevMax: prevCs?.max_score ?? cs.max_score,
        curScore: cs.score,
        curMax: cs.max_score,
      });
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '1rem 1rem 2rem' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
        Draft History
      </h3>

      {insufficientCount > 0 && (
        <div role="status" style={{
          padding: '0.7rem 0.9rem', marginBottom: '0.9rem', borderRadius: '8px',
          background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.3)',
          color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.45,
        }}>
          {insufficientCount} evidence-limited attempt{insufficientCount === 1 ? '' : 's'} not shown as scored drafts or counted against revision slots.
        </div>
      )}

      {scoredIterations.map((it, i) => {
        const prev = i > 0 ? scoredIterations[i - 1] : null;
        const delta = prev ? it.total_score - prev.total_score : null;
        const deltaPct = prev && prev.total_score > 0
          ? Math.round((delta! / prev.max_total_score) * 100)
          : null;

        return (
          <div key={i} className="glass-card" style={{
            padding: '1rem',
            marginBottom: '0.75rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                Draft {i + 1}
              </span>
              <span style={{ marginLeft: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {it.total_score} / {it.max_total_score}
              </span>
            </div>
            <div>
              {delta !== null && deltaPct !== null && (
                <span style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--error)' : 'var(--text-secondary)',
                }}>
                  {delta > 0 ? '+' : ''}{deltaPct}% from previous
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* Per-criterion progress (last two drafts) */}
      {hasMultiple && criterionComparison.length > 0 && (
        <div className="glass-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.95rem',
              padding: 0, fontFamily: 'inherit',
            }}
          >
            <span style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
            Criterion Progress (Draft {iterations.length - 1} → {iterations.length})
          </button>
          {expanded && (
            <div style={{ marginTop: '0.75rem' }}>
              {criterionComparison.map((c, i) => {
                const prevPct = c.prevMax > 0 ? (c.prevScore / c.prevMax) * 100 : 0;
                const curPct = c.curMax > 0 ? (c.curScore / c.curMax) * 100 : 0;
                const improved = curPct > prevPct;
                const declined = curPct < prevPct;
                return (
                  <div key={i} style={{ marginBottom: '0.6rem' }}>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      fontSize: '0.8rem', marginBottom: '0.15rem',
                    }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{c.name}</span>
                      <span style={{
                        fontWeight: 600,
                        color: improved ? 'var(--success)' : declined ? 'var(--error)' : 'var(--text-secondary)',
                      }}>
                        {c.prevScore}/{c.prevMax} → {c.curScore}/{c.curMax}
                      </span>
                    </div>
                    {/* Bar comparison */}
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', height: 18 }}>
                      <div style={{
                        flex: 1, height: 8, borderRadius: 4,
                        background: 'var(--bg-secondary)', overflow: 'hidden',
                        position: 'relative',
                      }}>
                        {/* Previous score bar */}
                        <div style={{
                          position: 'absolute', top: 0, left: 0, height: '100%',
                          width: `${Math.min(prevPct, 100)}%`,
                          background: declined ? 'rgba(239,68,68,0.3)' : 'rgba(100,116,139,0.3)',
                          borderRadius: 4,
                          transition: 'width 0.5s',
                        }} />
                        {/* Current score bar (overlay) */}
                        <div style={{
                          position: 'absolute', top: 0, left: 0, height: '100%',
                          width: `${Math.min(curPct, 100)}%`,
                          background: improved ? 'rgba(34,197,94,0.5)' : declined ? 'rgba(239,68,68,0.5)' : 'rgba(99,102,241,0.4)',
                          borderRadius: 4,
                          transition: 'width 0.5s',
                          zIndex: 1,
                        }} />
                      </div>
                      {/* Change indicator */}
                      {improved && <span style={{ fontSize: '0.7rem', color: 'var(--success)' }}>▲</span>}
                      {declined && <span style={{ fontSize: '0.7rem', color: 'var(--error)' }}>▼</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {scoredIterations.length < maxIterations && (
        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <button onClick={onTryAgain} className="btn-primary" style={{ padding: '0.5rem 1.5rem' }}>
            Try Again ({maxIterations - scoredIterations.length} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
