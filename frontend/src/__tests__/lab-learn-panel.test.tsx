import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LearnPanel from '../components/lab/LearnPanel';
import type { LabActivityMeta } from '../lib/lab-activities';

const mockActivity: LabActivityMeta = {
  id: 'explorer-quadrant-predict',
  tab: 'explorer',
  title: 'Test Activity',
  objective: 'Test the learn panel works correctly.',
  level: 'junior',
  strand: 'number-algebra',
  band: '7-8',
  steps: [
    {
      prompt: 'What is 2 + 2?',
      type: 'answer',
      acceptedAnswers: ['4'],
      tolerance: 0.01,
      feedbackCorrect: 'Correct! 2 + 2 = 4.',
      feedbackIncorrect: 'Not quite. 2 + 2 = 4.',
      hint: 'Think of basic addition.',
    },
    {
      prompt: 'What is 3 × 3?',
      type: 'answer',
      acceptedAnswers: ['9'],
      feedbackCorrect: 'Correct! 3 × 3 = 9.',
      feedbackIncorrect: 'Not quite. 3 × 3 = 9.',
    },
  ],
};

describe('LearnPanel', () => {
  it('renders the objective and first step prompt', () => {
    render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText('Test the learn panel works correctly.')).toBeTruthy();
    expect(screen.getByText('What is 2 + 2?')).toBeTruthy();
  });

  it('answer is hidden until submit (feedback not visible initially)', () => {
    render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
    expect(screen.queryByText('Correct! 2 + 2 = 4.')).toBeNull();
    expect(screen.queryByText('Not quite. 2 + 2 = 4.')).toBeNull();
  });

  it('shows correct feedback on correct answer', () => {
    render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
    const input = screen.getByLabelText('Your answer:');
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(screen.getByText('Submit'));
    expect(screen.getByText('Correct! 2 + 2 = 4.')).toBeTruthy();
  });

  it('shows incorrect feedback on wrong answer', () => {
    render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
    const input = screen.getByLabelText('Your answer:');
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByText('Submit'));
    expect(screen.getByText('Not quite. 2 + 2 = 4.')).toBeTruthy();
  });

  it('advances to next step after submit + Next', () => {
    render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
    const input = screen.getByLabelText('Your answer:');
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(screen.getByText('Submit'));
    // First step: not the last, so button says "Next"
    fireEvent.click(screen.getByText(/Next/));
    expect(screen.getByText('What is 3 × 3?')).toBeTruthy();
  });

  it('calls onComplete when all steps are finished', () => {
    const onComplete = vi.fn();
    render(<LearnPanel activity={mockActivity} onComplete={onComplete} onExit={vi.fn()} />);

    // Step 1: answer correctly, then click Next (not last step)
    const input1 = screen.getByLabelText('Your answer:');
    fireEvent.change(input1, { target: { value: '4' } });
    fireEvent.click(screen.getByText('Submit'));
    fireEvent.click(screen.getByText(/Next/));

    // Step 2: answer correctly, then click Finish (last step)
    const input2 = screen.getByLabelText('Your answer:');
    fireEvent.change(input2, { target: { value: '9' } });
    fireEvent.click(screen.getByText('Submit'));
    fireEvent.click(screen.getByText('Finish'));

    expect(onComplete).toHaveBeenCalledWith('explorer-quadrant-predict', true);
  });

  it('calls onExit when exit button is clicked', () => {
    const onExit = vi.fn();
    render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={onExit} />);
    fireEvent.click(screen.getByLabelText('Exit learn mode'));
    expect(onExit).toHaveBeenCalled();
  });

  it('shows hint when hint button is clicked', () => {
    render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByText('Show hint'));
    expect(screen.getByText('Think of basic addition.')).toBeTruthy();
  });

  it('handles numeric tolerance correctly', () => {
    render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
    const input = screen.getByLabelText('Your answer:');
    fireEvent.change(input, { target: { value: '4.005' } });
    fireEvent.click(screen.getByText('Submit'));
    expect(screen.getByText('Correct! 2 + 2 = 4.')).toBeTruthy();
  });

  it('does not accept a numeric prefix followed by invalid characters', () => {
    render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: '4abc' } });
    fireEvent.click(screen.getByText('Submit'));
    expect(screen.getByText('Not quite. 2 + 2 = 4.')).toBeTruthy();
  });

  it('progress bar exposes current step values', () => {
    render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
    const progress = screen.getByRole('progressbar');
    expect(progress.getAttribute('aria-valuenow')).toBe('1');
    expect(progress.getAttribute('aria-valuemax')).toBe('2');
  });

  it('notifies the scene when an answer is revealed and the step changes', () => {
    const onRevealChange = vi.fn();
    const onStepChange = vi.fn();
    render(
      <LearnPanel
        activity={mockActivity}
        onComplete={vi.fn()}
        onExit={vi.fn()}
        onRevealChange={onRevealChange}
        onStepChange={onStepChange}
      />
    );
    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: '4' } });
    fireEvent.click(screen.getByText('Submit'));
    expect(onRevealChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText(/Next/));
    expect(onRevealChange).toHaveBeenLastCalledWith(false);
    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it('can restart the same activity from step one after completion', () => {
    render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: '4' } });
    fireEvent.click(screen.getByText('Submit'));
    fireEvent.click(screen.getByText(/Next/));
    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: '9' } });
    fireEvent.click(screen.getByText('Submit'));
    fireEvent.click(screen.getByText('Finish'));
    fireEvent.click(screen.getByText('Try again'));
    expect(screen.getByText('What is 2 + 2?')).toBeTruthy();
    expect(screen.queryByText('Correct! 2 + 2 = 4.')).toBeNull();
  });

  // --- S8: Unicode normalisation tests ---
  describe('S8: bilateral answer normalisation', () => {
    it('accepts Unicode minus sign (U+2212) as equivalent to ASCII minus', () => {
      const negActivity: LabActivityMeta = {
        ...mockActivity,
        steps: [
          {
            prompt: 'What is 1 - 4?',
            type: 'answer',
            acceptedAnswers: ['-3'],
            feedbackCorrect: 'Correct!',
            feedbackIncorrect: 'Incorrect.',
          },
          mockActivity.steps[1],
        ],
      };
      render(<LearnPanel activity={negActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: '\u22123' } });
      fireEvent.click(screen.getByText('Submit'));
      expect(screen.getByText('Correct!')).toBeTruthy();
    });

    it('still rejects trailing characters even after normalisation', () => {
      render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: '4xyz' } });
      fireEvent.click(screen.getByText('Submit'));
      expect(screen.getByText('Not quite. 2 + 2 = 4.')).toBeTruthy();
    });

    it('accepts fullwidth digits as equivalent', () => {
      render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
      // Fullwidth 4 is U+FF14
      fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: '\uFF14' } });
      fireEvent.click(screen.getByText('Submit'));
      expect(screen.getByText('Correct! 2 + 2 = 4.')).toBeTruthy();
    });

    it('accepts answer with trailing period removed', () => {
      render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: '4.' } });
      fireEvent.click(screen.getByText('Submit'));
      expect(screen.getByText('Correct! 2 + 2 = 4.')).toBeTruthy();
    });

    it('numeric tolerance works with normalised input', () => {
      render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
      // U+2212 3.995 should match 4 within tolerance 0.01
      // Actually the accepted answer is '4', tolerance 0.01, so −3.995 won't match
      // But let's use the correct scenario: fullwidth 4.005
      fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: '\uFF14\uFF0E\uFF10\uFF10\uFF15' } });
      fireEvent.click(screen.getByText('Submit'));
      expect(screen.getByText('Correct! 2 + 2 = 4.')).toBeTruthy();
    });
  });

  // --- S8: MathSymbolKeyboard integration ---
  describe('S8: MathSymbolKeyboard integration', () => {
    it('renders symbol keyboard buttons', () => {
      render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
      // MathSymbolKeyboard renders buttons with symbol labels
      expect(screen.getByTitle('Square root')).toBeTruthy();
      expect(screen.getByTitle('Pi')).toBeTruthy();
      expect(screen.getByTitle('Theta')).toBeTruthy();
      expect(screen.getByTitle('Less than')).toBeTruthy();
      expect(screen.getByTitle('Greater than')).toBeTruthy();
    });

    it('symbol keyboard is disabled after submission', () => {
      render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: '4' } });
      fireEvent.click(screen.getByText('Submit'));
      const sqrtBtn = screen.getByTitle('Square root');
      expect(sqrtBtn).toHaveProperty('disabled', true);
    });

    it('can still submit without using symbol keyboard (keyboard is optional)', () => {
      render(<LearnPanel activity={mockActivity} onComplete={vi.fn()} onExit={vi.fn()} />);
      const input = screen.getByLabelText('Your answer:');
      fireEvent.change(input, { target: { value: '4' } });
      fireEvent.click(screen.getByText('Submit'));
      expect(screen.getByText('Correct! 2 + 2 = 4.')).toBeTruthy();
    });
  });

  // --- S4: Variant support ---
  describe('S4: variant support', () => {
    const variantSteps = [
      {
        prompt: 'What is 5 + 5?',
        type: 'answer' as const,
        acceptedAnswers: ['10'],
        tolerance: 0.01,
        feedbackCorrect: 'Correct! 5 + 5 = 10.',
        feedbackIncorrect: 'Not quite. 5 + 5 = 10.',
        hint: 'Add them.',
      },
      {
        prompt: 'What is 6 × 6?',
        type: 'answer' as const,
        acceptedAnswers: ['36'],
        feedbackCorrect: 'Correct! 6 × 6 = 36.',
        feedbackIncorrect: 'Not quite. 6 × 6 = 36.',
      },
    ];

    it('shows New numbers button when onNewVariant is provided for whitelisted activity', () => {
      const pythagorasActivity: LabActivityMeta = {
        ...mockActivity,
        id: 'geometry-pythagoras',
      };
      render(
        <LearnPanel
          activity={pythagorasActivity}
          onComplete={vi.fn()}
          onExit={vi.fn()}
          onNewVariant={vi.fn()}
          variantSeed={42}
          variantSteps={variantSteps}
        />
      );
      expect(screen.getByLabelText('New numbers')).toBeTruthy();
    });

    it('shows New numbers for any catalogued activity', () => {
      render(
        <LearnPanel
          activity={mockActivity}
          onComplete={vi.fn()}
          onExit={vi.fn()}
          onNewVariant={vi.fn()}
          variantSeed={42}
          variantSteps={variantSteps}
        />
      );
      expect(screen.getByLabelText('New numbers')).toBeTruthy();
    });

    it('does not show New numbers for an id outside the catalogue', () => {
      const unknownActivity = {
        ...mockActivity,
        id: 'explorer-not-a-real-activity' as LabActivityMeta['id'],
      };
      render(
        <LearnPanel
          activity={unknownActivity}
          onComplete={vi.fn()}
          onExit={vi.fn()}
          onNewVariant={vi.fn()}
          variantSeed={42}
          variantSteps={variantSteps}
        />
      );
      expect(screen.queryByLabelText('New numbers')).toBeNull();
    });

    it('uses variant steps when variantSeed and variantSteps are provided', () => {
      const pythagorasActivity: LabActivityMeta = {
        ...mockActivity,
        id: 'geometry-pythagoras',
      };
      render(
        <LearnPanel
          activity={pythagorasActivity}
          onComplete={vi.fn()}
          onExit={vi.fn()}
          variantSeed={42}
          variantSteps={variantSteps}
        />
      );
      expect(screen.getByText('What is 5 + 5?')).toBeTruthy();
      expect(screen.queryByText('What is 2 + 2?')).toBeNull();
    });

    it('falls back to activity.steps when variantSeed is null', () => {
      render(
        <LearnPanel
          activity={mockActivity}
          onComplete={vi.fn()}
          onExit={vi.fn()}
          variantSeed={null}
          variantSteps={undefined}
        />
      );
      expect(screen.getByText('What is 2 + 2?')).toBeTruthy();
    });

    it('clicking New numbers calls onNewVariant', () => {
      const onNewVariant = vi.fn();
      const pythagorasActivity: LabActivityMeta = {
        ...mockActivity,
        id: 'geometry-pythagoras',
      };
      render(
        <LearnPanel
          activity={pythagorasActivity}
          onComplete={vi.fn()}
          onExit={vi.fn()}
          onNewVariant={onNewVariant}
          variantSeed={42}
          variantSteps={variantSteps}
        />
      );
      fireEvent.click(screen.getByLabelText('New numbers'));
      expect(onNewVariant).toHaveBeenCalledTimes(1);
    });

    it('variant answers work correctly with acceptance checking', () => {
      const pythagorasActivity: LabActivityMeta = {
        ...mockActivity,
        id: 'geometry-pythagoras',
      };
      render(
        <LearnPanel
          activity={pythagorasActivity}
          onComplete={vi.fn()}
          onExit={vi.fn()}
          variantSeed={42}
          variantSteps={variantSteps}
        />
      );
      const input = screen.getByLabelText('Your answer:');
      fireEvent.change(input, { target: { value: '10' } });
      fireEvent.click(screen.getByText('Submit'));
      expect(screen.getByText('Correct! 5 + 5 = 10.')).toBeTruthy();
    });

    it('old fixed answer is rejected when variant is active', () => {
      const pythagorasActivity: LabActivityMeta = {
        ...mockActivity,
        id: 'geometry-pythagoras',
      };
      render(
        <LearnPanel
          activity={pythagorasActivity}
          onComplete={vi.fn()}
          onExit={vi.fn()}
          variantSeed={42}
          variantSteps={variantSteps}
        />
      );
      const input = screen.getByLabelText('Your answer:');
      fireEvent.change(input, { target: { value: '4' } });
      fireEvent.click(screen.getByText('Submit'));
      expect(screen.getByText('Not quite. 5 + 5 = 10.')).toBeTruthy();
    });
  });
});


describe('LearnPanel variant reset behaviour', () => {
  it('resets a submitted step when the variant seed changes', () => {
    const initialSteps = [
      {
        prompt: 'Old variant prompt',
        type: 'answer' as const,
        acceptedAnswers: ['10'],
        feedbackCorrect: 'Old variant correct.',
        feedbackIncorrect: 'Old variant incorrect.',
      },
      {
        prompt: 'Old variant second prompt',
        type: 'answer' as const,
        acceptedAnswers: ['12'],
        feedbackCorrect: 'Old second correct.',
        feedbackIncorrect: 'Old second incorrect.',
      },
    ];
    const nextSteps = [
      {
        prompt: 'New variant prompt',
        type: 'answer' as const,
        acceptedAnswers: ['14'],
        feedbackCorrect: 'New variant correct.',
        feedbackIncorrect: 'New variant incorrect.',
      },
      {
        prompt: 'New variant second prompt',
        type: 'answer' as const,
        acceptedAnswers: ['16'],
        feedbackCorrect: 'New second correct.',
        feedbackIncorrect: 'New second incorrect.',
      },
    ];

    const { rerender } = render(
      <LearnPanel
        activity={mockActivity}
        onComplete={vi.fn()}
        onExit={vi.fn()}
        variantSeed={1}
        variantSteps={initialSteps}
      />,
    );
    fireEvent.change(screen.getByLabelText('Your answer:'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getByText('Old variant incorrect.')).toBeTruthy();

    rerender(
      <LearnPanel
        activity={mockActivity}
        onComplete={vi.fn()}
        onExit={vi.fn()}
        variantSeed={2}
        variantSteps={nextSteps}
      />,
    );

    expect(screen.getByText('New variant prompt')).toBeTruthy();
    expect(screen.queryByText('Old variant incorrect.')).toBeNull();
    expect((screen.getByLabelText('Your answer:') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
  });
});
