'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuestSpinResult, QuestSpinStatus } from '../../lib/api-types';

/**
 * Quest-board prize wheel.
 *
 * Slices are drawn equal-sized and the real odds are printed in the legend: a
 * proportional wheel would render the 0.1% jackpot as a 0.36° sliver, which
 * looks like a rendering bug and hides the actual chance. The legend is the
 * source of truth for probability, and it is plain text so assistive technology
 * reads it too.
 *
 * The wheel diameter and label radius come from CSS custom properties so the
 * dial can shrink on narrow screens without the labels drifting off the slices.
 */

const SLICE_COLOURS = [
  '#64748b', // no luck
  '#0ea5e9',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#ec4899',
  '#ef4444',
  '#facc15', // jackpot
];

/** Full turns added before settling, so the wheel visibly spins. */
const FLOURISH_TURNS = 5;
const SPIN_MS = 3600;

interface SpinWheelProps {
  status: QuestSpinStatus;
  stars: number;
  currencyEmoji: string;
  /** Performs the spin; resolves with the server-decided prize. */
  onSpin: () => Promise<QuestSpinResult>;
  /** Called once the wheel has finished settling, so totals refresh in sync. */
  onSettled: () => void;
  disabled?: boolean;
}

export default function SpinWheel({
  status,
  stars,
  currencyEmoji,
  onSpin,
  onSettled,
  disabled = false,
}: SpinWheelProps) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<QuestSpinResult | null>(null);
  const [spinError, setSpinError] = useState('');
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
    };
  }, []);

  const prizes = useMemo(() => status.prizes ?? [], [status.prizes]);
  const sliceAngle = prizes.length > 0 ? 360 / prizes.length : 360;

  const wheelBackground = useMemo(() => {
    if (prizes.length === 0) return 'var(--bg-secondary)';
    const stops = prizes.map((_, index) => {
      const colour = SLICE_COLOURS[index % SLICE_COLOURS.length];
      return `${colour} ${index * sliceAngle}deg ${(index + 1) * sliceAngle}deg`;
    });
    return `conic-gradient(from -${sliceAngle / 2}deg, ${stops.join(', ')})`;
  }, [prizes, sliceAngle]);

  const affordable = stars >= status.cost_stars;
  const outOfSpins = status.spins_remaining <= 0;
  const blocked = disabled || spinning || !status.enabled || outOfSpins || !affordable;

  const blockedReason = !status.enabled
    ? 'The wheel is switched off for this profile.'
    : outOfSpins
      ? `Daily limit reached — ${status.max_per_day} spins per day. Come back tomorrow.`
      : !affordable
        ? `You need ${status.cost_stars}${currencyEmoji} to spin. Keep practising to earn more.`
        : '';

  const handleSpin = async () => {
    if (blocked) return;
    setSpinning(true);
    setResult(null);
    setSpinError('');
    try {
      const spin = await onSpin();
      if (!mounted.current) return;
      // Land the winning slice under the pointer at the top of the wheel.
      const target = spin.prize.index * sliceAngle;
      setRotation((current) => {
        const settled = current + FLOURISH_TURNS * 360;
        const alignment = (((-target - settled) % 360) + 360) % 360;
        return settled + alignment;
      });
      if (settleTimer.current) clearTimeout(settleTimer.current);
      const reduceMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        if (!mounted.current) return;
        setResult(spin);
        setSpinning(false);
        onSettled();
      }, reduceMotion ? 0 : SPIN_MS);
    } catch (error) {
      if (!mounted.current) return;
      setSpinning(false);
      setSpinError(error instanceof Error ? error.message : 'Spin failed. Please try again.');
    }
  };

  /** Big wins get extra flourish; a 15⭐ nudge should not look like a jackpot. */
  const winTier = result?.prize.won
    ? result.prize.stars >= 500
      ? 'jackpot'
      : result.prize.stars >= 100
        ? 'big'
        : 'small'
    : null;

  return (
    <section className="quest-panel spin-panel" style={{ padding: 18, marginBottom: 16 }}>
      <div className="spin-head">
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>🎡 Spin the wheel</h2>
        <span className="spin-meta">
          {status.cost_stars}
          {currencyEmoji} per spin · {status.spins_remaining} of {status.max_per_day} left today
        </span>
      </div>

      <div className="spin-body">
        <div className="spin-stage">
          <div className="spin-pointer" aria-hidden="true" />
          <div
            className={`spin-wheel${spinning ? ' is-spinning' : ''}${winTier ? ` is-won tier-${winTier}` : ''}`}
            style={{
              background: wheelBackground,
              transform: `rotate(${rotation}deg)`,
              transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.16, 0.84, 0.12, 1)` : 'none',
            }}
            aria-hidden="true"
          >
            {prizes.map((prize, index) => (
              <span
                key={prize.label}
                className="spin-slice"
                style={{
                  transform: `rotate(${index * sliceAngle}deg) translateY(calc(var(--spin-label-radius) * -1))`,
                }}
              >
                <span className="spin-slice-emoji">{prize.emoji}</span>
                <span className="spin-slice-value">
                  {prize.stars > 0 ? `${prize.stars}${currencyEmoji}` : 'miss'}
                </span>
              </span>
            ))}
          </div>
          <span className="spin-hub" aria-hidden="true">
            {currencyEmoji}
          </span>
        </div>

        <div className="spin-side">
          <button
            type="button"
            className="spin-button"
            onClick={() => void handleSpin()}
            disabled={blocked}
            aria-label={`Spin the wheel for ${status.cost_stars} stars. ${status.spins_remaining} spins left today.`}
          >
            {spinning ? 'Spinning…' : `Spin · ${status.cost_stars}${currencyEmoji}`}
          </button>

          {/* Single live region: the visible outcome is also the announced one. */}
          <div className="spin-outcome" role="status" aria-live="polite">
            {result ? (
              <div className={`spin-result${winTier ? ` tier-${winTier}` : ' tier-miss'}`}>
                <span className="spin-result-emoji">{result.prize.emoji}</span>
                <div className="spin-result-text">
                  <strong className="spin-result-label">{result.prize.label}</strong>
                  <span className="spin-result-net">
                    {result.prize.won
                      ? `${result.net_stars >= 0 ? '+' : ''}${result.net_stars}${currencyEmoji} after the ${result.cost_stars}${currencyEmoji} spin`
                      : `You spent ${result.cost_stars}${currencyEmoji}`}
                  </span>
                  <span className="spin-result-balance">
                    Balance {result.stars}
                    {currencyEmoji} · {result.spins_remaining} spins left today
                  </span>
                </div>
              </div>
            ) : (
              <p className="spin-note">
                {spinning
                  ? 'Good luck…'
                  : spinError || blockedReason || 'One roll on the prize table below.'}
              </p>
            )}
          </div>

          <ul className="spin-odds">
            {prizes.map((prize, index) => (
              <li key={prize.label} className={result?.prize.index === index ? 'is-hit' : undefined}>
                <span
                  className="spin-odds-swatch"
                  style={{ background: SLICE_COLOURS[index % SLICE_COLOURS.length] }}
                  aria-hidden="true"
                />
                <span className="spin-odds-label">
                  {prize.emoji} {prize.label}
                </span>
                <span className="spin-odds-chance">{prize.chance}%</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
