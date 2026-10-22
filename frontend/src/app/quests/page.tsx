'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import BackToPracticeLink from '../../components/BackToPracticeLink';
import SpinWheel from '../../components/quests/SpinWheel';
import {
  claimQuest,
  fetchQuestsOverview,
  openQuestChest,
  redeemQuestReward,
  spinQuestWheel,
} from '../../lib/api';
import Link from 'next/link';
import { getSubject, getYear } from '../../lib/preferences';
import { buildMistakesHref, buildPracticeHref, buildTodayHref } from '../../lib/scoped_navigation';
import type { QuestsOverview, Subject } from '../../lib/api-types';
import { showToast } from '../../lib/toast';
import {
  getQuestSceneryId,
  sceneriesByRegion,
  setQuestSceneryId,
  type QuestScenery,
  getQuestScenery,
} from '../../lib/quest-scenery';
import './quests.css';

/** High-contrast back control for scenic (dark) quest backgrounds. */
const QUEST_BACK_STYLE: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.95)',
  color: '#0f172a',
  border: '1px solid rgba(255, 255, 255, 0.9)',
  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
  fontWeight: 700,
};

export default function QuestsPage() {
  const [subject] = useState<Subject>(() => (getSubject() as Subject) || 'math');
  const [year] = useState(() => getYear() || 'year7');
  const [data, setData] = useState<QuestsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lootMsg, setLootMsg] = useState('');
  const [sceneryId, setSceneryId] = useState('default');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  /** catalog_id → qty for multi-redeem */
  const [redeemQty, setRedeemQty] = useState<Record<string, number>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => setSceneryId(getQuestSceneryId()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const scenery = useMemo(() => getQuestScenery(sceneryId), [sceneryId]);
  const regions = useMemo(() => sceneriesByRegion(), []);

  const pickScenery = (id: string) => {
    setSceneryId(id);
    setQuestSceneryId(id);
  };

  const reload = useCallback(async () => {
    setError('');
    try {
      const overview = await fetchQuestsOverview(subject);
      setData(overview);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load quests');
    } finally {
      setLoading(false);
    }
  }, [subject]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const onClaim = async (questId: string) => {
    setBusy(true);
    setLootMsg('');
    try {
      const res = await claimQuest(questId, subject);
      showToast(`+${res.awarded} ⭐ claimed!`, 'success');
      await reload();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Claim failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onOpenChest = async () => {
    setBusy(true);
    setLootMsg('');
    try {
      const res = await openQuestChest();
      const loot = res.loot as {
        label?: string;
        type?: string;
        amount?: number;
        cash_label?: string;
      };
      if (loot.type === 'cash_grand_prize') {
        setLootMsg(`💵 ${loot.label || `Cash prize ${loot.cash_label || ''} — ask a parent to approve`}!`);
        showToast('Cash grand prize — waiting for parent', 'success');
      } else {
        setLootMsg(
          `🎁 ${loot.label || 'Loot'}${loot.type === 'stars' ? ` (+${loot.amount}⭐)` : ''}!`,
        );
        showToast('Chest opened!', 'success');
      }
      await reload();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'No chest to open', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onRedeem = async (catalogId: string, title: string, unitCost: number, maxQty: number) => {
    const qty = Math.max(1, Math.min(maxQty, redeemQty[catalogId] ?? 1));
    const total = unitCost * qty;
    const label = qty > 1 ? `${title} ×${qty}` : title;
    if (
      !window.confirm(
        `Redeem ${label} for ${total}⭐?\nStars are held until a parent approves (or rejects and refunds).`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await redeemQuestReward(catalogId, qty);
      const auto = Boolean((res.redemption as { auto?: boolean } | undefined)?.auto);
      showToast(
        auto
          ? `Got ${label}!`
          : `Redeem request sent (${label}) — waiting for parent approval`,
        'success',
      );
      setRedeemQty((q) => ({ ...q, [catalogId]: 1 }));
      await reload();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Redeem failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const shellStyle = sceneryCssVars(scenery);
  const questActionHref = (questId: string) => {
    if (questId === 'error_fix_5') return buildMistakesHref({ subject, year });
    if (questId === 'accuracy_ok' || questId === 'streak_tick') {
      return buildPracticeHref({ subject, year });
    }
    return buildTodayHref({ subject, year });
  };

  if (loading) {
    return (
      <div className="quest-board-root" style={shellStyle}>
        <div className="quest-board-inner quest-muted">Loading quest board…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="quest-board-root" style={shellStyle}>
        <div className="quest-board-inner">
          <BackToPracticeLink style={QUEST_BACK_STYLE} />
          <p style={{ marginTop: 16, color: '#fecaca' }}>{error || 'Unavailable'}</p>
          <button
            type="button"
            className="quest-btn"
            style={{ marginTop: 12 }}
            onClick={() => {
              setLoading(true);
              void reload();
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data.enabled) {
    return (
      <div className="quest-board-root" style={shellStyle}>
        <div className="quest-board-inner">
          <BackToPracticeLink style={QUEST_BACK_STYLE} />
          <p className="quest-muted" style={{ marginTop: 16 }}>Quests are turned off by a parent.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="quest-board-root" style={shellStyle}>
      <div className="quest-board-inner">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 18,
          }}
        >
          <div>
            <h1 className="quest-board-title">⚔️ Quest Board</h1>
            <p className="quest-board-sub">
              Earn ⭐ Stars, level up, open chests, and redeem real rewards.
            </p>
            <div style={{ marginTop: 10 }}>
              <span className="scene-caption" title={scenery.subtitle}>
                {scenery.emoji} {scenery.name}
                <span style={{ opacity: 0.65, fontWeight: 500 }}>· {scenery.subtitle}</span>
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="quest-btn quest-btn-ghost"
              onClick={() => setPickerOpen((v) => !v)}
              aria-expanded={pickerOpen}
            >
              🖼️ {pickerOpen ? 'Hide scenes' : 'Change scene'}
            </button>
            <BackToPracticeLink style={QUEST_BACK_STYLE} />
          </div>
        </div>

        {pickerOpen && (
          <section className="quest-panel" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Choose a backdrop</h2>
              <span className="quest-faint" style={{ fontSize: 12 }}>
                Saved on this device · QLD & China scenery
              </span>
            </div>
            <div className="scenery-picker" style={{ marginTop: 12 }}>
              {regions.map((group) => (
                <div key={group.region}>
                  <div className="scenery-region-label">{group.label}</div>
                  <div className="scenery-row" style={{ marginTop: 6 }}>
                    {group.items.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`scenery-chip${sceneryId === s.id ? ' is-active' : ''}`}
                        onClick={() => pickScenery(s.id)}
                        title={s.subtitle}
                      >
                        <span
                          className="scenery-swatch"
                          style={{
                            ['--swatch-bg' as string]: s.backgroundColor,
                            ['--swatch-img' as string]: s.backgroundImage,
                          } as CSSProperties}
                          aria-hidden
                        />
                        <span>
                          {s.emoji} {s.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Hero card */}
        <div className="quest-panel" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' }}>
            <div style={{ flex: '1 1 200px' }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'rgba(226,232,240,0.65)',
                }}
              >
                {data.title}
              </div>
              <div
                style={{
                  fontFamily: 'Outfit, sans-serif',
                  fontSize: 34,
                  fontWeight: 800,
                  marginTop: 4,
                  // Use longhand only — mixing background + backgroundClip warns in React
                  backgroundImage: `linear-gradient(120deg, ${scenery.titleFrom}, ${scenery.titleTo})`,
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                Lv. {data.level}
              </div>
              <div
                className="quest-progress-track"
                style={{ marginTop: 10, height: 10 }}
                role="progressbar"
                aria-label="Level XP progress"
                aria-valuemin={0}
                aria-valuemax={data.xp_to_next}
                aria-valuenow={Math.min(data.xp, data.xp_to_next)}
              >
                <div
                  className="quest-progress-fill"
                  style={{ width: `${Math.round(data.xp_progress * 100)}%` }}
                />
              </div>
              <div className="quest-muted" style={{ fontSize: 12, marginTop: 6 }}>
                {data.xp} / {data.xp_to_next} XP to next level
              </div>
            </div>

            <div className="quest-stat">
              <div className="quest-stat-value" style={{ color: '#fbbf24' }}>
                {data.currency_emoji} {data.stars}
              </div>
              <div className="quest-stat-label">{data.currency_name}</div>
              <div className="quest-faint" style={{ fontSize: 11, marginTop: 4 }}>
                Today +{data.daily_stars_earned}/{data.daily_star_cap}
              </div>
            </div>

            <div className="quest-stat">
              <div className="quest-stat-value">🔥 {data.streak_days}</div>
              <div className="quest-stat-label">Day streak</div>
              {typeof data.streak_reward_cycle_day === 'number' && (
                <div className="quest-faint" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.3 }}>
                  Reward day {data.streak_reward_cycle_day}/{data.streak_reward_cycle_days ?? 14}
                  {typeof data.streak_reward_stars === 'number' ? ` · +${data.streak_reward_stars}⭐` : ''}
                </div>
              )}
            </div>

            <div className="quest-stat">
              <div className="quest-stat-value">📦 {data.chests}</div>
              <div className="quest-stat-label">Chests</div>
              {(data.grand_prize_chests ?? 0) > 0 && (
                <div className="quest-faint" style={{ fontSize: 11, marginTop: 4, color: '#fbbf24' }}>
                  💵 {data.grand_prize_chests}× cash prize ($
                  {data.cash_prize?.prize_dollars ?? 100})
                </div>
              )}
              <button
                type="button"
                className="quest-btn"
                disabled={busy || data.chests < 1 || !data.chests_enabled}
                onClick={() => void onOpenChest()}
                style={{ marginTop: 8, width: '100%', fontSize: 12, padding: '6px 10px' }}
              >
                {(data.grand_prize_chests ?? 0) > 0 ? 'Open grand prize' : 'Open chest'}
              </button>
            </div>
          </div>

          {data.cash_prize && !data.cash_prize.already_awarded && (
            <div
              style={{
                marginTop: 16,
                padding: '18px 20px',
                borderRadius: 14,
                background: data.cash_prize.eligible
                  ? 'linear-gradient(135deg, rgba(251,191,36,0.22), rgba(251,191,36,0.08))'
                  : 'rgba(251,191,36,0.08)',
                border: data.cash_prize.eligible
                  ? '2px solid #fbbf24'
                  : '1px solid rgba(251,191,36,0.25)',
                boxShadow: data.cash_prize.eligible
                  ? '0 0 30px rgba(251,191,36,0.25), inset 0 0 30px rgba(251,191,36,0.06)'
                  : 'none',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 28 }}>💵</span>
                <div>
                  <div style={{ fontWeight: 800, color: '#fbbf24', fontSize: 18, letterSpacing: '-0.02em' }}>
                    ${data.cash_prize.prize_dollars} cash prize
                  </div>
                  <div className="quest-muted" style={{ fontSize: 11 }}>
                    {data.cash_prize.eligible
                      ? '🏆 You qualify! Open a chest to claim.'
                      : `Need ${data.cash_prize.need_streak}-day streak & ≥${data.cash_prize.need_avg}⭐/day avg`}
                  </div>
                </div>
                {data.cash_prize.eligible && (
                  <span style={{ marginLeft: 'auto', fontSize: 24, animation: 'none' }}>✨</span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 140px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: 'rgba(248,250,252,0.7)' }}>Streak</span>
                    <span style={{ fontWeight: 700, color: data.cash_prize.streak_days >= data.cash_prize.need_streak ? '#4ade80' : '#fbbf24' }}>
                      {data.cash_prize.streak_days}/{data.cash_prize.need_streak}
                    </span>
                  </div>
                  <div
                    className="quest-progress-track"
                    style={{ height: 6, borderRadius: 999 }}
                    role="progressbar"
                    aria-label="Cash prize streak progress"
                    aria-valuemin={0}
                    aria-valuemax={data.cash_prize.need_streak}
                    aria-valuenow={Math.min(data.cash_prize.streak_days, data.cash_prize.need_streak)}
                  >
                    <div
                      className="quest-progress-fill"
                      style={{
                        width: `${Math.min(100, (data.cash_prize.streak_days / data.cash_prize.need_streak) * 100)}%`,
                        background: data.cash_prize.streak_days >= data.cash_prize.need_streak
                          ? 'linear-gradient(90deg, #4ade80, #22d3ee)'
                          : 'linear-gradient(90deg, #fbbf24, #fb923c)',
                      }}
                    />
                  </div>
                </div>
                <div style={{ flex: '1 1 140px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: 'rgba(248,250,252,0.7)' }}>Avg ⭐/day</span>
                    <span style={{ fontWeight: 700, color: data.cash_prize.avg_stars >= data.cash_prize.need_avg ? '#4ade80' : '#fbbf24' }}>
                      {data.cash_prize.avg_stars}/{data.cash_prize.need_avg}
                    </span>
                  </div>
                  <div
                    className="quest-progress-track"
                    style={{ height: 6, borderRadius: 999 }}
                    role="progressbar"
                    aria-label="Cash prize average stars progress"
                    aria-valuemin={0}
                    aria-valuemax={data.cash_prize.need_avg}
                    aria-valuenow={Math.min(data.cash_prize.avg_stars, data.cash_prize.need_avg)}
                  >
                    <div
                      className="quest-progress-fill"
                      style={{
                        width: `${Math.min(100, (data.cash_prize.avg_stars / data.cash_prize.need_avg) * 100)}%`,
                        background: data.cash_prize.avg_stars >= data.cash_prize.need_avg
                          ? 'linear-gradient(90deg, #4ade80, #22d3ee)'
                          : 'linear-gradient(90deg, #fbbf24, #fb923c)',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {lootMsg && (
            <div
              style={{
                marginTop: 14,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(34,197,94,0.18)',
                border: '1px solid rgba(34,197,94,0.35)',
                fontWeight: 600,
              }}
            >
              {lootMsg}
            </div>
          )}
          {data.freeze_tokens > 0 && (
            <div className="quest-muted" style={{ marginTop: 10, fontSize: 13 }}>
              🛡️ Streak freezes ready: {data.freeze_tokens}
              <span className="quest-faint">
                {' '}— auto-used if you miss one day between study days
              </span>
            </div>
          )}
          {data.freeze_applied_today && (
            <div
              style={{
                marginTop: 10,
                padding: '8px 12px',
                borderRadius: 10,
                background: 'var(--qb-accent-soft)',
                border: '1px solid var(--qb-panel-border)',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              🛡️ A streak freeze was used for yesterday — your chain is still alive!
            </div>
          )}
        </div>

        <SpinWheel
          status={data.spin}
          stars={data.stars}
          currencyEmoji={data.currency_emoji}
          onSpin={spinQuestWheel}
          onSettled={() => void reload()}
          disabled={busy}
        />

        {/* Quests */}
        <section className="quest-panel" style={{ padding: 18, marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 12px' }}>Today&apos;s quests</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.quests.map((q) => (
              <div
                key={q.id}
                className={`quest-row${q.claimed ? ' is-claimed' : ''}${q.claimable ? ' is-claimable' : ''}`}
              >
                <span style={{ fontSize: 28, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.35))' }}>
                  {q.emoji}
                </span>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{q.title}</div>
                  <div className="quest-muted" style={{ fontSize: 12 }}>{q.description}</div>
                  <div
                    className="quest-progress-track"
                    role="progressbar"
                    aria-label={`${q.title} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(q.progress * 100)}
                  >
                    <div
                      className="quest-progress-fill"
                      style={{ width: `${Math.round(q.progress * 100)}%` }}
                    />
                  </div>
                </div>
                {!q.claimed && !q.claimable && (
                  <div style={{ fontWeight: 800, color: '#fbbf24', fontSize: 15 }}>
                    +{q.reward_stars}⭐
                  </div>
                )}
                {!q.complete && !q.claimable && !q.claimed && q.id !== 'interleave_3' && (
                  <Link
                    href={questActionHref(q.id)}
                    className="quest-btn"
                    style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                  >
                    {q.id === 'error_fix_5' ? 'Open Error Book' : 'Start now'}
                  </Link>
                )}
                {q.id === 'interleave_3' && !q.complete && !q.claimable && !q.claimed && (
                  <button
                    type="button"
                    className="quest-btn"
                    disabled
                    title={`Complete ${Math.min(3, Math.round(q.progress * 3))} of 3 strands to claim`}
                    aria-label={`Claim (${Math.min(3, Math.round(q.progress * 3))} of 3 strands complete)`}
                  >
                    Claim
                  </button>
                )}
                {q.claimed ? (
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#4ade80' }}>Claimed ✓</span>
                ) : q.claimable ? (
                  <button
                    type="button"
                    className="quest-btn"
                    disabled={busy}
                    onClick={() => void onClaim(q.id)}
                  >
                    Claim
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <p className="quest-faint" style={{ margin: '12px 0 0', fontSize: 12 }}>
            Practice on the main page to progress quests. Stars also drop when you answer questions.
          </p>
        </section>

        {/* Shop */}
        {data.shop_enabled && (
          <section className="quest-panel" style={{ padding: 18, marginBottom: 16 }}>
            <h2 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 4px' }}>🏪 Reward shop</h2>
            <p className="quest-muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
              Redeem holds stars until a parent approves. Pending requests: {data.pending_redemptions}
            </p>
            <div className="shop-grid">
              {data.catalog.map((item) => {
                const byStars = Math.floor(data.stars / Math.max(1, item.cost_stars));
                const byStock = item.stock == null ? 20 : Math.max(0, item.stock);
                const maxQty = Math.max(0, Math.min(20, byStars, byStock));
                const qty = Math.max(1, Math.min(maxQty || 1, redeemQty[item.id] ?? 1));
                const totalCost = item.cost_stars * qty;
                const canBuy = maxQty >= 1 && data.stars >= totalCost;
                return (
                  <div key={item.id} className="shop-card">
                    <div className="shop-card-emoji">{item.emoji}</div>
                    <div style={{ fontWeight: 700, fontSize: 14, textAlign: 'center' }}>{item.title}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#fbbf24', textAlign: 'center' }}>
                      {item.cost_stars}⭐ each
                    </div>
                    {item.description && (
                      <div className="quest-faint" style={{ fontSize: 11, textAlign: 'center', lineHeight: 1.35 }}>
                        {item.description}
                      </div>
                    )}
                    <label
                      className="quest-muted"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        fontSize: 12,
                      }}
                    >
                      Qty
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, maxQty)}
                        value={qty}
                        disabled={busy || maxQty < 1}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          const next = Number.isFinite(n)
                            ? Math.max(1, Math.min(Math.max(1, maxQty), Math.round(n)))
                            : 1;
                          setRedeemQty((q) => ({ ...q, [item.id]: next }));
                        }}
                        style={{
                          width: 52,
                          padding: '4px 6px',
                          borderRadius: 8,
                          border: '1px solid rgba(255,255,255,0.2)',
                          background: 'rgba(0,0,0,0.25)',
                          color: '#f8fafc',
                          textAlign: 'center',
                        }}
                      />
                    </label>
                    <div className="quest-faint" style={{ fontSize: 11, textAlign: 'center' }}>
                      Total {totalCost}⭐
                      {maxQty > 0 ? ` · max ${maxQty}` : ''}
                    </div>
                    <button
                      type="button"
                      className="quest-btn"
                      disabled={busy || !canBuy}
                      onClick={() => void onRedeem(item.id, item.title, item.cost_stars, maxQty)}
                      style={{ marginTop: 'auto', width: '100%', fontSize: 12 }}
                    >
                      {qty > 1 ? `Redeem ×${qty}` : 'Redeem'}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Ledger */}
        <section className="quest-panel" style={{ padding: 18 }}>
          <button
            type="button"
            className="quest-activity-toggle"
            aria-expanded={activityOpen}
            aria-controls="quest-activity-list"
            onClick={() => setActivityOpen((open) => !open)}
          >
            <span>Recent activity</span>
            <span className="quest-faint">
              <span>({data.ledger.length})</span> <span aria-hidden="true">{activityOpen ? '▴' : '▾'}</span>
            </span>
          </button>
          <div id="quest-activity-list" hidden={!activityOpen} style={{ marginTop: 12 }}>
            {data.ledger.length === 0 ? (
              <p className="quest-faint" style={{ margin: 0, fontSize: 13 }}>
                Answer practice questions to start earning stars.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.ledger.map((row) => (
                  <li
                    key={row.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      fontSize: 13,
                      padding: '8px 10px',
                      borderRadius: 10,
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <span className="quest-muted">
                      {row.reason.replace(/_/g, ' ')}
                      {row.meta && typeof row.meta === 'object' && 'question_id' in row.meta
                        ? ` · ${String((row.meta as { question_id?: string }).question_id || '').slice(0, 24)}`
                        : ''}
                    </span>
                    <span style={{ fontWeight: 800, color: row.delta >= 0 ? '#4ade80' : '#f87171' }}>
                      {row.delta >= 0 ? '+' : ''}{row.delta}⭐
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function sceneryCssVars(s: QuestScenery): CSSProperties {
  return {
    ['--qb-bg-color' as string]: s.backgroundColor,
    ['--qb-bg-image' as string]: s.backgroundImage,
    ['--qb-panel-tint' as string]: s.panelTint,
    ['--qb-panel-border' as string]: s.panelBorder,
    ['--qb-accent' as string]: s.accent,
    ['--qb-accent-soft' as string]: s.accentSoft,
    ['--qb-title-from' as string]: s.titleFrom,
    ['--qb-title-to' as string]: s.titleTo,
  } as CSSProperties;
}
