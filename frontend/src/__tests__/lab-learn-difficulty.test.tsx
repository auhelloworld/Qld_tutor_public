/**
 * Contracts for the raised Learn difficulty:
 *  - every activity has 3 core steps plus exactly one unlockable extension step;
 *  - prompts do not hand the student the method or the answer;
 *  - the extension step only appears after every core step is correct;
 *  - hints are freely available and never change the recorded result;
 *  - expression answers are marked by numeric-sampling equivalence;
 *  - every activity offers a repeatable variant whose extension question form
 *    actually changes between seeds.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LearnPanel from '../components/lab/LearnPanel';
import {
  ALL_ACTIVITY_IDS,
  LAB_ACTIVITIES,
  type LabActivityMeta,
  type LearnStep,
} from '../lib/lab-activities';
import { SCENE_SYNCED_VARIANTS, VARIANT_WHITELIST, makeVariant } from '../lib/lab-variants';

function coreSteps(steps: LearnStep[]): LearnStep[] {
  return steps.filter((step) => step.tier !== 'extension');
}

function extensionSteps(steps: LearnStep[]): LearnStep[] {
  return steps.filter((step) => step.tier === 'extension');
}

// ─── Catalogue shape ─────────────────────────────────────────────────────────

describe('Learn activity difficulty structure', () => {
  it('every activity has three core steps and exactly one extension step', () => {
    for (const id of ALL_ACTIVITY_IDS) {
      const activity = LAB_ACTIVITIES[id];
      expect(coreSteps(activity.steps), `${id} core steps`).toHaveLength(3);
      expect(extensionSteps(activity.steps), `${id} extension steps`).toHaveLength(1);
    }
  });

  it('the extension step is always the last step', () => {
    for (const id of ALL_ACTIVITY_IDS) {
      const { steps } = LAB_ACTIVITIES[id];
      expect(steps[steps.length - 1].tier, id).toBe('extension');
    }
  });

  it('every extension step carries feedback for both outcomes and a hint', () => {
    for (const id of ALL_ACTIVITY_IDS) {
      const [extension] = extensionSteps(LAB_ACTIVITIES[id].steps);
      expect(extension.feedbackCorrect.length, id).toBeGreaterThan(10);
      expect(extension.feedbackIncorrect.length, id).toBeGreaterThan(10);
      expect(extension.hint, id).toBeTruthy();
    }
  });

  it('no prompt states the method the student is meant to choose', () => {
    // These phrases previously appeared in prompts, which removed the decision
    // the activity is supposed to be practising. They belong in `hint`.
    const methodGiveaways = [
      /use x = -b\/\(2a\)/i,
      /\(set x = 0\)/i,
      /factorise x²/i,
      /\(substitute x = \d/i,
      /use z = \(x/i,
    ];
    for (const id of ALL_ACTIVITY_IDS) {
      for (const step of LAB_ACTIVITIES[id].steps) {
        for (const pattern of methodGiveaways) {
          expect(pattern.test(step.prompt), `${id}: ${step.prompt}`).toBe(false);
        }
      }
    }
  });

  it('no prompt contains one of its own accepted answers as a worked example', () => {
    for (const id of ALL_ACTIVITY_IDS) {
      for (const step of LAB_ACTIVITIES[id].steps) {
        // Only check answers distinctive enough that their appearance would be a leak.
        for (const answer of step.acceptedAnswers) {
          const trimmed = answer.trim();
          if (trimmed.length < 4 || /^-?[\d.]+$/.test(trimmed)) continue;
          const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const leak = new RegExp(`\\(e\\.g\\.[^)]*${escaped}`, 'i');
          expect(leak.test(step.prompt), `${id}: ${step.prompt}`).toBe(false);
        }
      }
    }
  });

  it('at least eight activities ask for an expression answer', () => {
    const withEquivalence = ALL_ACTIVITY_IDS.filter((id) =>
      LAB_ACTIVITIES[id].steps.some((step) => step.equivalence !== undefined),
    );
    expect(withEquivalence.length).toBeGreaterThanOrEqual(8);
  });

  it('the two-point activity no longer reuses the 3-4-5 answer of 5', () => {
    const answers = coreSteps(LAB_ACTIVITIES['explorer-two-point-measures'].steps)
      .map((step) => step.acceptedAnswers[0]);
    expect(answers).not.toContain('5');
    expect(answers).toContain('13');
  });

  it('the simultaneous-lines transfer step no longer repeats the taught answer', () => {
    const steps = coreSteps(LAB_ACTIVITIES['sandbox-simultaneous-lines'].steps);
    expect(steps[2].prompt).toContain('Transfer');
    expect(steps[2].acceptedAnswers[0]).not.toBe(steps[0].acceptedAnswers[0]);
  });
});

// ─── Variant coverage ────────────────────────────────────────────────────────

describe('Variant coverage across the whole catalogue', () => {
  it('every activity is variant-enabled', () => {
    for (const id of ALL_ACTIVITY_IDS) {
      expect(VARIANT_WHITELIST.has(id), id).toBe(true);
    }
  });

  it('scene-synced variants all regenerate their core steps', () => {
    expect(SCENE_SYNCED_VARIANTS.size).toBeGreaterThanOrEqual(17);
    for (const id of SCENE_SYNCED_VARIANTS) {
      expect(ALL_ACTIVITY_IDS).toContain(id as (typeof ALL_ACTIVITY_IDS)[number]);
      // The first core prompt must actually change across seeds.
      const prompts = new Set<string>();
      for (let seed = 1; seed <= 40; seed += 1) {
        const result = makeVariant(id, seed);
        if (!result.hasVariants) continue;
        prompts.add(result.steps.filter((s) => s.tier !== 'extension')[0].prompt);
      }
      expect(prompts.size, `${id} core prompt variety`).toBeGreaterThanOrEqual(2);
    }
  });

  it('activities without core generators keep their authored core steps', () => {
    for (const id of ALL_ACTIVITY_IDS) {
      if (SCENE_SYNCED_VARIANTS.has(id)) continue;
      const result = makeVariant(id, 12345);
      expect(result.hasVariants).toBe(true);
      if (!result.hasVariants) continue;
      const authoredCore = coreSteps(LAB_ACTIVITIES[id].steps).map((s) => s.prompt);
      const variantCore = coreSteps(result.steps).map((s) => s.prompt);
      expect(variantCore, id).toEqual(authoredCore);
    }
  });

  it('the extension question form changes across seeds for every activity', () => {
    for (const id of ALL_ACTIVITY_IDS) {
      const prompts = new Set<string>();
      for (let seed = 1; seed <= 60; seed += 1) {
        const result = makeVariant(id, seed);
        if (!result.hasVariants) continue;
        prompts.add(extensionSteps(result.steps)[0].prompt);
      }
      expect(prompts.size, `${id} extension prompt variety`).toBeGreaterThanOrEqual(2);
    }
  });

  it('variant generation stays deterministic per seed', () => {
    for (const id of ALL_ACTIVITY_IDS) {
      expect(makeVariant(id, 7), id).toEqual(makeVariant(id, 7));
    }
  });
});

// ─── Panel behaviour ─────────────────────────────────────────────────────────

const twoCoreOneExtension: LabActivityMeta = {
  id: 'explorer-quadrant-predict',
  tab: 'explorer',
  title: 'Test Activity',
  objective: 'Check the extension gate and support tracking.',
  level: 'junior',
  strand: 'number-algebra',
  band: '7-8',
  steps: [
    {
      prompt: 'Core one: what is 2 + 2?',
      type: 'answer',
      acceptedAnswers: ['4'],
      tolerance: 0.01,
      feedbackCorrect: 'Core one correct.',
      feedbackIncorrect: 'Core one wrong.',
      hint: 'Add them.',
    },
    {
      prompt: 'Core two: what is 3 × 3?',
      type: 'answer',
      acceptedAnswers: ['9'],
      tolerance: 0.01,
      feedbackCorrect: 'Core two correct.',
      feedbackIncorrect: 'Core two wrong.',
    },
    {
      prompt: 'Extension: differentiate x².',
      type: 'answer',
      acceptedAnswers: ['2x'],
      equivalence: { variables: ['x'] },
      feedbackCorrect: 'Extension correct.',
      feedbackIncorrect: 'Extension wrong.',
      hint: 'Power rule.',
      tier: 'extension',
    },
  ],
};

function submit(value: string) {
  fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
}

describe('LearnPanel extension gate and support tracking', () => {
  it('progress covers only the core steps', () => {
    render(<LearnPanel activity={twoCoreOneExtension} onComplete={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('2');
  });

  it('offers the extension challenge only after every core step is correct', () => {
    render(<LearnPanel activity={twoCoreOneExtension} onComplete={vi.fn()} onExit={vi.fn()} />);
    submit('4');
    fireEvent.click(screen.getByText(/Next/));
    submit('9');
    fireEvent.click(screen.getByText('Finish'));
    expect(screen.getByText(/Extension challenge/)).toBeTruthy();
  });

  it('withholds the extension challenge when a core step was wrong', () => {
    render(<LearnPanel activity={twoCoreOneExtension} onComplete={vi.fn()} onExit={vi.fn()} />);
    submit('4');
    fireEvent.click(screen.getByText(/Next/));
    submit('8');
    fireEvent.click(screen.getByText('Finish'));
    expect(screen.queryByText(/Extension challenge/)).toBeNull();
  });

  it('treats hints as free: using one changes nothing about the result', () => {
    const onComplete = vi.fn();
    const { unmount } = render(
      <LearnPanel activity={twoCoreOneExtension} onComplete={onComplete} onExit={vi.fn()} />,
    );
    submit('4');
    fireEvent.click(screen.getByText(/Next/));
    submit('9');
    fireEvent.click(screen.getByText('Finish'));
    const unaidedHeading = screen.getByText('Every step correct');
    expect(unaidedHeading).toBeTruthy();
    expect(screen.getByText(/You got 2 out of 2 correct/)).toBeTruthy();
    expect(onComplete).toHaveBeenCalledWith('explorer-quadrant-predict', true);
    unmount();

    const onCompleteWithHint = vi.fn();
    render(
      <LearnPanel activity={twoCoreOneExtension} onComplete={onCompleteWithHint} onExit={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('Show hint'));
    expect(screen.getByText('Add them.')).toBeTruthy();
    submit('4');
    fireEvent.click(screen.getByText(/Next/));
    submit('9');
    fireEvent.click(screen.getByText('Finish'));
    // Identical outcome, and no mention of hints in the summary.
    expect(screen.getByText('Every step correct')).toBeTruthy();
    expect(screen.getByText(/You got 2 out of 2 correct/)).toBeTruthy();
    expect(screen.queryByText(/hint/i)).toBeNull();
    expect(onCompleteWithHint).toHaveBeenCalledWith('explorer-quadrant-predict', true);
    // The extension challenge is still offered after a hinted run.
    expect(screen.getByText(/Extension challenge/)).toBeTruthy();
  });

  it('requires every core step for success, not a bare majority', () => {
    const onComplete = vi.fn();
    render(<LearnPanel activity={twoCoreOneExtension} onComplete={onComplete} onExit={vi.fn()} />);
    submit('4');
    fireEvent.click(screen.getByText(/Next/));
    submit('8');
    fireEvent.click(screen.getByText('Finish'));
    expect(onComplete).toHaveBeenCalledWith('explorer-quadrant-predict', false);
  });

  it('marks an equivalent expression answer on the extension step', () => {
    render(<LearnPanel activity={twoCoreOneExtension} onComplete={vi.fn()} onExit={vi.fn()} />);
    submit('4');
    fireEvent.click(screen.getByText(/Next/));
    submit('9');
    fireEvent.click(screen.getByText('Finish'));
    fireEvent.click(screen.getByText(/Extension challenge/));
    expect(screen.getByText('Extension: differentiate x².')).toBeTruthy();
    // Not a listed accepted answer, but algebraically identical.
    submit('x + x');
    expect(screen.getByText('Extension correct.')).toBeTruthy();
    fireEvent.click(screen.getByText('Finish'));
    expect(screen.getByText(/Extension challenge cleared/)).toBeTruthy();
  });

  it('still rejects junk that merely starts like an expression', () => {
    render(<LearnPanel activity={twoCoreOneExtension} onComplete={vi.fn()} onExit={vi.fn()} />);
    submit('4');
    fireEvent.click(screen.getByText(/Next/));
    submit('9');
    fireEvent.click(screen.getByText('Finish'));
    fireEvent.click(screen.getByText(/Extension challenge/));
    submit('2xyz');
    expect(screen.getByText('Extension wrong.')).toBeTruthy();
  });

  it('reports an uncleared extension without withdrawing the core result', () => {
    const onComplete = vi.fn();
    render(<LearnPanel activity={twoCoreOneExtension} onComplete={onComplete} onExit={vi.fn()} />);
    submit('4');
    fireEvent.click(screen.getByText(/Next/));
    submit('9');
    fireEvent.click(screen.getByText('Finish'));
    expect(onComplete).toHaveBeenCalledWith('explorer-quadrant-predict', true);
    fireEvent.click(screen.getByText(/Extension challenge/));
    submit('3x');
    fireEvent.click(screen.getByText('Finish'));
    expect(screen.getByText(/Extension challenge not cleared/)).toBeTruthy();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
