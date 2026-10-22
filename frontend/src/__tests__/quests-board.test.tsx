import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { claimQuest, fetchQuestsOverview } from '../lib/api';
import type { QuestsOverview } from '../lib/api-types';
import QuestsPage from '../app/quests/page';

vi.mock('../lib/preferences', () => ({ getSubject: () => 'math', getYear: () => 'year7' }));
vi.mock('../lib/toast', () => ({ showToast: vi.fn() }));

const overview: QuestsOverview = {
  enabled: true,
  stars: 120,
  xp: 40,
  level: 2,
  title: 'Apprentice',
  xp_to_next: 100,
  xp_progress: 0.4,
  freeze_tokens: 0,
  chests: 0,
  chests_enabled: true,
  shop_enabled: false,
  daily_star_cap: 300,
  daily_stars_earned: 30,
  streak_days: 3,
  today_attempts: 4,
  today_correct: 3,
  daily_goal: 20,
  quests: [
    {
      id: 'daily_goal',
      title: "Hit today's practice goal",
      emoji: '🎯',
      reward_stars: 18,
      description: 'Complete your daily question goal.',
      progress: 0.2,
      complete: false,
      claimed: false,
      claimable: false,
    },
    {
      id: 'accuracy_ok',
      title: 'Solid accuracy',
      emoji: '✨',
      reward_stars: 14,
      description: 'Build a reliable answer streak.',
      progress: 0.4,
      complete: false,
      claimed: false,
      claimable: false,
    },
    {
      id: 'streak_tick',
      title: 'Keep the streak alive',
      emoji: '🔥',
      reward_stars: 10,
      description: 'Practice at least once today.',
      progress: 0,
      complete: false,
      claimed: false,
      claimable: false,
    },
    {
      id: 'interleave_3',
      title: 'Interleaver',
      emoji: '🔀',
      reward_stars: 16,
      description: 'Answer questions from 3+ different strands today.',
      progress: 0.33,
      complete: false,
      claimed: false,
      claimable: false,
    },
    {
      id: 'error_fix_5',
      title: 'Repair five mistakes',
      emoji: '🧩',
      reward_stars: 20,
      description: 'Close Error Book loops.',
      progress: 0,
      complete: false,
      claimed: false,
      claimable: false,
    },
  ],
  catalog: [],
  pending_redemptions: 0,
  ledger: [
    { id: 'l1', delta: 5, reason: 'mark', meta: {}, day: '2026-07-30', at: '2026-07-30T00:00:00Z' },
    { id: 'l2', delta: -20, reason: 'spin_cost', meta: {}, day: '2026-07-30', at: '2026-07-30T00:01:00Z' },
  ],
  currency_name: 'stars',
  currency_emoji: '⭐',
  spin: {
    enabled: true,
    cost_stars: 20,
    max_per_day: 10,
    spins_used: 2,
    spins_remaining: 8,
    can_spin: true,
    prizes: [
      { chance: 40, stars: 0, label: 'No luck this time', emoji: '🙈' },
      { chance: 25, stars: 15, label: '15 stars', emoji: '⭐' },
      { chance: 15, stars: 20, label: '20 stars', emoji: '✨' },
      { chance: 10, stars: 30, label: '30 stars', emoji: '🌟' },
      { chance: 5, stars: 50, label: '50 stars', emoji: '💫' },
      { chance: 3.9, stars: 100, label: '100 stars', emoji: '🎉' },
      { chance: 1, stars: 500, label: '500 stars', emoji: '🏆' },
      { chance: 0.1, stars: 1000, label: 'JACKPOT — 1000 stars', emoji: '💎' },
    ],
  },
};

vi.mock('../lib/api', () => ({
  fetchQuestsOverview: vi.fn(async () => overview),
  claimQuest: vi.fn(),
  openQuestChest: vi.fn(),
  redeemQuestReward: vi.fn(),
  spinQuestWheel: vi.fn(),
}));

afterEach(cleanup);

describe('quest board', () => {
  it('renders the spin wheel above the daily quest board', async () => {
    render(<QuestsPage />);
    await waitFor(() => expect(screen.getByText(/Spin the wheel/)).toBeTruthy());

    const wheel = screen.getByText(/🎡 Spin the wheel/);
    const quests = screen.getByText(/Today's quests/);
    // Node.compareDocumentPosition: 4 === quests follows the wheel in the DOM.
    expect(wheel.compareDocumentPosition(quests) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/20⭐ per spin · 8 of 10 left today/)).toBeTruthy();
  });

  it('collapses recent activity by default and expands on click', async () => {
    render(<QuestsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Recent activity/ })).toBeTruthy());

    const toggle = screen.getByRole('button', { name: /Recent activity/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const panel = document.getElementById('quest-activity-list');
    expect(panel?.hasAttribute('hidden')).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('quest-activity-list')?.hasAttribute('hidden')).toBe(false);
    expect(screen.getByText(/spin cost/)).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('quest-activity-list')?.hasAttribute('hidden')).toBe(true);
  });

  it('shows how many activity entries are hidden while collapsed', async () => {
    render(<QuestsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Recent activity/ })).toBeTruthy());
    expect(screen.getByText('(2)')).toBeTruthy();
  });
});


  it('exposes level and quest progress to assistive technology', async () => {
    render(<QuestsPage />);
    await waitFor(() => expect(screen.getByRole('progressbar', { name: /Level XP progress/i })).toBeTruthy());

    const level = screen.getByRole('progressbar', { name: /Level XP progress/i });
    expect(level.getAttribute('aria-valuenow')).toBe('40');
    expect(level.getAttribute('aria-valuemax')).toBe('100');

    const quest = screen.getByRole('progressbar', { name: /Hit today's practice goal progress/i });
    expect(quest.getAttribute('aria-valuenow')).toBe('20');
    expect(quest.getAttribute('aria-valuemax')).toBe('100');
  });



describe('quest learning actions', () => {
  it('uses the scoped destination for each learning quest', async () => {
    render(<QuestsPage />);
    const startLinks = await screen.findAllByRole('link', { name: 'Start now' });
    const startHrefs = startLinks.map((link) => link.getAttribute('href'));
    const errorBook = screen.getByRole('link', { name: 'Open Error Book' });

    expect(startHrefs).toContain('/today?subject=math&year=year7');
    expect(startHrefs.filter((href) => href === '/?subject=math&year=year7')).toHaveLength(2);
    expect(errorBook.getAttribute('href')).toBe('/mistakes?subject=math&year=year7');

    const interleaverRow = screen.getByText('Interleaver').closest('.quest-row');
    expect(interleaverRow).toBeTruthy();
    expect(within(interleaverRow as HTMLElement).queryByRole('link')).toBeNull();
    const lockedClaim = within(interleaverRow as HTMLElement).getByRole('button', {
      name: /Claim \(1 of 3 strands complete\)/i,
    });
    expect((lockedClaim as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Claim' })).toBeNull();
  });
});


describe('quest claim lifecycle', () => {
  it('lets a completed Interleaver be claimed and then shows Claimed', async () => {
    const completed = {
      ...overview,
      quests: overview.quests.map((quest) => (
        quest.id === 'interleave_3'
          ? { ...quest, complete: true, claimable: true, progress: 1 }
          : quest
      )),
    };
    const claimed = {
      ...completed,
      quests: completed.quests.map((quest) => (
        quest.id === 'interleave_3'
          ? { ...quest, claimable: false, claimed: true }
          : quest
      )),
    };
    vi.mocked(fetchQuestsOverview)
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce(claimed);
    vi.mocked(claimQuest).mockResolvedValueOnce({
      ok: true,
      awarded: 16,
      stars: 136,
      level: 2,
      xp: 56,
    });

    render(<QuestsPage />);

    const row = (await screen.findByText('Interleaver')).closest('.quest-row') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Claim' })).toBeTruthy();
    expect(within(row).queryByText('+16⭐')).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Claim' }));

    await waitFor(() => expect(claimQuest).toHaveBeenCalledWith('interleave_3', 'math'));
    expect(await screen.findByText('Claimed ✓')).toBeTruthy();
    const claimedRow = screen.getByText('Interleaver').closest('.quest-row') as HTMLElement;
    expect(within(claimedRow).queryByRole('button', { name: 'Claim' })).toBeNull();
    expect(within(claimedRow).queryByText('+16⭐')).toBeNull();
  });
});
