import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LabDirectory from '../components/lab/LabDirectory';
import { ALL_ACTIVITY_IDS, LAB_STRAND_LABELS, type LabStrand } from '../lib/lab-activities';

describe('LabDirectory', () => {
  it('renders cards for all activities', () => {
    render(<LabDirectory onSelect={vi.fn()} completedActivities={new Set()} />);
    // Each activity should have a card with its title
    for (const id of ALL_ACTIVITY_IDS) {
      const card = document.querySelector(`[data-activity-id="${id}"]`);
      expect(card).not.toBeNull();
    }
  });

  it('renders free explore cards for all 6 tabs', () => {
    render(<LabDirectory onSelect={vi.fn()} completedActivities={new Set()} />);
    expect(document.querySelector('[data-tab="explorer"][data-mode="explore"]')).not.toBeNull();
    expect(document.querySelector('[data-tab="sandbox"][data-mode="explore"]')).not.toBeNull();
    expect(document.querySelector('[data-tab="calculus"][data-mode="explore"]')).not.toBeNull();
    expect(document.querySelector('[data-tab="geometry"][data-mode="explore"]')).not.toBeNull();
    expect(document.querySelector('[data-tab="statistics"][data-mode="explore"]')).not.toBeNull();
    expect(document.querySelector('[data-tab="linear-algebra"][data-mode="explore"]')).not.toBeNull();
  });

  it('clicking an activity card calls onSelect with correct params', () => {
    const onSelect = vi.fn();
    render(<LabDirectory onSelect={onSelect} completedActivities={new Set()} />);
    const card = document.querySelector('[data-activity-id="explorer-quadrant-predict"]') as HTMLElement;
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith('explorer', 'learn', 'explorer-quadrant-predict');
  });

  it('clicking an explore card calls onSelect with explore mode', () => {
    const onSelect = vi.fn();
    render(<LabDirectory onSelect={onSelect} completedActivities={new Set()} />);
    const card = document.querySelector('[data-tab="sandbox"][data-mode="explore"]') as HTMLElement;
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith('sandbox', 'explore');
  });

  it('shows checkmark for completed activities', () => {
    const completed = new Set(['explorer-quadrant-predict']);
    render(<LabDirectory onSelect={vi.fn()} completedActivities={completed} />);
    const card = document.querySelector('[data-activity-id="explorer-quadrant-predict"]');
    expect(card?.getAttribute('data-completed')).toBe('true');
  });

  it('does not show checkmark for uncompleted activities', () => {
    render(<LabDirectory onSelect={vi.fn()} completedActivities={new Set()} />);
    const card = document.querySelector('[data-activity-id="explorer-quadrant-predict"]');
    expect(card?.getAttribute('data-completed')).toBe('false');
  });

  it('renders Junior Activities section', () => {
    render(<LabDirectory onSelect={vi.fn()} completedActivities={new Set()} />);
    expect(screen.getByText('Junior Activities')).toBeTruthy();
  });

  it('renders Senior Activities section', () => {
    render(<LabDirectory onSelect={vi.fn()} completedActivities={new Set()} />);
    expect(screen.getByText('Senior Activities')).toBeTruthy();
  });

  // ─── S1 Information Architecture ────────────────────────────────────────

  it('renders exactly 6 Explore cards', () => {
    render(<LabDirectory onSelect={vi.fn()} completedActivities={new Set()} />);
    const exploreCards = document.querySelectorAll('[data-mode="explore"]');
    expect(exploreCards.length).toBe(6);
  });

  it('renders 45 activity cards', () => {
    render(<LabDirectory onSelect={vi.fn()} completedActivities={new Set()} />);
    const activityCards = document.querySelectorAll('[data-activity-id]');
    expect(activityCards.length).toBe(45);
  });

  it('displays completion counter with 0 / 45 when none completed', () => {
    render(<LabDirectory onSelect={vi.fn()} completedActivities={new Set()} />);
    const counter = screen.getByTestId('completion-counter');
    expect(counter.textContent).toContain('0');
    expect(counter.textContent).toContain('45');
  });

  it('displays completion counter with 1 / 45 when one completed', () => {
    const completed = new Set(['explorer-quadrant-predict']);
    const handleSelect = vi.fn();
    render(<LabDirectory onSelect={handleSelect} completedActivities={completed} />);
    const counter = screen.getByTestId('completion-counter');
    expect(counter.textContent).toContain('1');
    expect(counter.textContent).toContain('45');
  });

  it('renders strand filter chips with aria-pressed', () => {
    render(<LabDirectory onSelect={vi.fn()} completedActivities={new Set()} />);
    const group = screen.getByRole('group', { name: /filter activities by strand/i });
    expect(group).toBeTruthy();

    // "All" chip is pressed by default
    const allChip = screen.getByRole('button', { name: 'All' });
    expect(allChip.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking a strand chip filters to show only that strand', () => {
    render(<LabDirectory onSelect={vi.fn()} completedActivities={new Set()} />);

    // Click the "Calculus" strand chip
    const calcChip = screen.getByRole('button', { name: 'Calculus' });
    fireEvent.click(calcChip);

    expect(calcChip.getAttribute('aria-pressed')).toBe('true');

    // The calculus activities include the original five plus curve sketching,
    // area between, accumulation, and function–derivative connections.
    const activityCards = document.querySelectorAll('[data-activity-id]');
    expect(activityCards.length).toBe(9);
  });

  it('strand heading exists for each used strand', () => {
    render(<LabDirectory onSelect={vi.fn()} completedActivities={new Set()} />);
    // Check that at least the strands that have activities have headings
    const usedStrands: LabStrand[] = [
      'number-algebra',
      'functions-graphs',
      'measurement-geometry',
      'trigonometry',
      'statistics-probability',
      'calculus',
      'vectors-matrices-complex',
    ];
    for (const strand of usedStrands) {
      const headings = screen.getAllByTestId(`strand-heading-${strand}`);
      expect(headings.length).toBeGreaterThan(0);
      expect(headings.every((heading) => heading.textContent === LAB_STRAND_LABELS[strand])).toBe(true);
    }
  });

  it('every activity card has a band badge', () => {
    render(<LabDirectory onSelect={vi.fn()} completedActivities={new Set()} />);
    for (const id of ALL_ACTIVITY_IDS) {
      const badge = screen.getByTestId(`band-badge-${id}`);
      expect(badge).toBeTruthy();
      expect(['Yrs 7–8', 'Yrs 9–10', 'Senior']).toContain(badge.textContent);
    }
  });

  it('strand chip click link: filter then click a card', () => {
    const onSelect = vi.fn();
    render(<LabDirectory onSelect={onSelect} completedActivities={new Set()} />);

    // Click "Trigonometry" strand chip
    const trigChip = screen.getByRole('button', { name: 'Trigonometry' });
    fireEvent.click(trigChip);

    // Should show only trig activities
    const cards = document.querySelectorAll('[data-activity-id]');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThan(29);

    // Click the first card
    fireEvent.click(cards[0]);
    expect(onSelect).toHaveBeenCalled();
  });
});
