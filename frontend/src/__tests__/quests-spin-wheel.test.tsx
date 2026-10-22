import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SpinWheel from '../components/quests/SpinWheel';
import type { QuestSpinResult, QuestSpinStatus } from '../lib/api-types';

const PRIZES = [
  { chance: 40, stars: 0, label: 'No luck this time', emoji: '🙈' },
  { chance: 25, stars: 15, label: '15 stars', emoji: '⭐' },
  { chance: 15, stars: 20, label: '20 stars', emoji: '✨' },
  { chance: 10, stars: 30, label: '30 stars', emoji: '🌟' },
  { chance: 5, stars: 50, label: '50 stars', emoji: '💫' },
  { chance: 3.9, stars: 100, label: '100 stars', emoji: '🎉' },
  { chance: 1, stars: 500, label: '500 stars', emoji: '🏆' },
  { chance: 0.1, stars: 1000, label: 'JACKPOT — 1000 stars', emoji: '💎' },
];

function status(overrides: Partial<QuestSpinStatus> = {}): QuestSpinStatus {
  return {
    enabled: true,
    cost_stars: 20,
    max_per_day: 10,
    spins_used: 0,
    spins_remaining: 10,
    can_spin: true,
    prizes: PRIZES,
    ...overrides,
  };
}

function result(overrides: Partial<QuestSpinResult> = {}): QuestSpinResult {
  return {
    ok: true,
    prize: { ...PRIZES[3], index: 3, won: true },
    cost_stars: 20,
    net_stars: 10,
    stars: 110,
    level: 2,
    spins_used: 1,
    spins_remaining: 9,
    max_per_day: 10,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SpinWheel', () => {
  it('shows the cost, the daily allowance and every prize chance', () => {
    render(
      <SpinWheel status={status()} stars={100} currencyEmoji="⭐" onSpin={vi.fn()} onSettled={vi.fn()} />,
    );
    expect(screen.getByText(/20⭐ per spin · 10 of 10 left today/)).toBeTruthy();
    // Odds are text, not just slice colours, so they are readable and auditable.
    for (const prize of PRIZES) {
      expect(screen.getByText(`${prize.chance}%`)).toBeTruthy();
    }
  });

  it('disables the spin when the student cannot afford it', () => {
    render(
      <SpinWheel status={status()} stars={19} currencyEmoji="⭐" onSpin={vi.fn()} onSettled={vi.fn()} />,
    );
    expect((screen.getByRole('button', { name: /Spin the wheel/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/You need 20⭐ to spin/)).toBeTruthy();
  });

  it('disables the spin and explains when the daily limit is reached', () => {
    render(
      <SpinWheel
        status={status({ spins_used: 10, spins_remaining: 0, can_spin: false })}
        stars={500}
        currencyEmoji="⭐"
        onSpin={vi.fn()}
        onSettled={vi.fn()}
      />,
    );
    expect((screen.getByRole('button', { name: /Spin the wheel/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Daily limit reached — 10 spins per day/)).toBeTruthy();
  });

  it('announces the prize and refreshes totals once the wheel settles', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSpin = vi.fn().mockResolvedValue(result());
    const onSettled = vi.fn();
    render(
      <SpinWheel status={status()} stars={100} currencyEmoji="⭐" onSpin={onSpin} onSettled={onSettled} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Spin the wheel/ }));
    await waitFor(() => expect(onSpin).toHaveBeenCalledTimes(1));
    // Totals must not refresh mid-animation, or the balance changes before the reveal.
    expect(onSettled).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3700);
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').textContent).toContain('30 stars');
    expect(screen.getByRole('status').textContent).toContain('+10⭐');
  });

  it('reports a losing spin as a spend, not a win', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSpin = vi.fn().mockResolvedValue(
      result({
        prize: { ...PRIZES[0], index: 0, won: false },
        net_stars: -20,
        stars: 80,
      }),
    );
    render(
      <SpinWheel status={status()} stars={100} currencyEmoji="⭐" onSpin={onSpin} onSettled={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Spin the wheel/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3700);
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('No luck this time');
    });
    expect(screen.getByRole('status').textContent).toContain('You spent 20⭐');
  });

  it('does not spin when the wheel is switched off for the profile', () => {
    const onSpin = vi.fn();
    render(
      <SpinWheel
        status={status({ enabled: false, can_spin: false })}
        stars={500}
        currencyEmoji="⭐"
        onSpin={onSpin}
        onSettled={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Spin the wheel/ }));
    expect(onSpin).not.toHaveBeenCalled();
    expect(screen.getByText(/switched off for this profile/)).toBeTruthy();
  });

  it('renders each slice with its prize value on the dial', () => {
    render(
      <SpinWheel status={status()} stars={100} currencyEmoji="⭐" onSpin={vi.fn()} onSettled={vi.fn()} />,
    );
    // Every winning slice shows its star value; the losing slice is labelled.
    for (const prize of PRIZES.filter((p) => p.stars > 0)) {
      expect(screen.getByText(`${prize.stars}⭐`)).toBeTruthy();
    }
    expect(screen.getByText('miss')).toBeTruthy();
  });

  it('shows a prominent outcome card and highlights the winning legend row', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSpin = vi.fn().mockResolvedValue(
      result({ prize: { ...PRIZES[7], index: 7, won: true }, net_stars: 980, stars: 1080 }),
    );
    const { container } = render(
      <SpinWheel status={status()} stars={100} currencyEmoji="⭐" onSpin={onSpin} onSettled={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Spin the wheel/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3700);
    });

    const card = container.querySelector('.spin-result');
    expect(card).toBeTruthy();
    // A 1000-star win gets the jackpot treatment, not the ordinary one.
    expect(card?.className).toContain('tier-jackpot');
    expect(card?.textContent).toContain('JACKPOT');
    expect(card?.textContent).toContain('+980⭐');
    expect(card?.textContent).toContain('Balance 1080⭐');
    // The wheel itself celebrates, and the matching legend row is marked.
    expect(container.querySelector('.spin-wheel')?.className).toContain('is-won');
    expect(container.querySelectorAll('.spin-odds li.is-hit')).toHaveLength(1);
  });

  it('does not celebrate a losing spin', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSpin = vi.fn().mockResolvedValue(
      result({ prize: { ...PRIZES[0], index: 0, won: false }, net_stars: -20, stars: 80 }),
    );
    const { container } = render(
      <SpinWheel status={status()} stars={100} currencyEmoji="⭐" onSpin={onSpin} onSettled={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Spin the wheel/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3700);
    });
    expect(container.querySelector('.spin-result')?.className).toContain('tier-miss');
    expect(container.querySelector('.spin-wheel')?.className).not.toContain('is-won');
  });
});


describe('SpinWheel resilience', () => {
  it('announces a rejected spin without an unhandled promise', async () => {
    const onSpin = vi.fn().mockRejectedValue(new Error('Spin unavailable — try again'));
    render(
      <SpinWheel status={status()} stars={100} currencyEmoji="⭐" onSpin={onSpin} onSettled={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Spin the wheel/ }));
    await waitFor(() => expect(onSpin).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Spin unavailable — try again');
    });
    expect((screen.getByRole('button', { name: /Spin the wheel/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('cancels the settlement callback when unmounted mid-spin', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSpin = vi.fn().mockResolvedValue(result());
    const onSettled = vi.fn();
    const view = render(
      <SpinWheel status={status()} stars={100} currencyEmoji="⭐" onSpin={onSpin} onSettled={onSettled} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Spin the wheel/ }));
    await waitFor(() => expect(onSpin).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('reveals and announces immediately when reduced motion is requested', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const onSettled = vi.fn();
    render(
      <SpinWheel
        status={status()}
        stars={100}
        currencyEmoji="⭐"
        onSpin={vi.fn().mockResolvedValue(result())}
        onSettled={onSettled}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Spin the wheel/ }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').textContent).toContain('30 stars');
  });
});
