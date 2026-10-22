import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AuthModal from '../components/AuthModal';
import CurriculumTree from '../components/CurriculumTree';
import ErrorBoundary from '../components/ErrorBoundary';
import ProgressiveDisclosure from '../components/ProgressiveDisclosure';
import TutorHeader from '../components/tutor/TutorHeader';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('shared UI/UX regressions', () => {
  it('shows student-safe curriculum recovery and invokes Retry', () => {
    const onRetry = vi.fn();
    render(
      <CurriculumTree
        curriculum={null}
        activeTopic=""
        onSelectTopic={() => {}}
        loadError
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText(/could not load the curriculum/i)).toBeTruthy();
    expect(screen.queryByText(/uvicorn|backend\/venv/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not crash when a year slice is missing (scoped filter race)', () => {
    expect(() => {
      render(
        <CurriculumTree
          curriculum={{ math: { year7: undefined as unknown as Record<string, never> } } as never}
          activeTopic=""
          onSelectTopic={() => {}}
        />,
      );
    }).not.toThrow();
    // Shell still mounts (heading text depends on learning-map feature flag).
    expect(document.body.textContent).toMatch(/Curriculum|Learning Map/i);
  });

  it('exposes disclosure state and controlled region semantics', () => {
    render(
      <ProgressiveDisclosure label="More tools">
        <div>Advanced content</div>
      </ProgressiveDisclosure>,
    );

    const button = screen.getByRole('button', { name: /More tools/i });
    const regionId = button.getAttribute('aria-controls');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(regionId).toBeTruthy();
    expect(button.style.outline).not.toBe('none');
    expect(document.getElementById(regionId as string)?.hidden).toBe(true);
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(regionId as string)?.hidden).toBe(false);
    expect(screen.getByText('Advanced content')).toBeTruthy();
  });

  it('renders the authentication form as a labelled modal and closes on Escape', () => {
    const onClose = vi.fn();
    render(<AuthModal onClose={onClose} />);

    const dialog = screen.getByRole('dialog', { name: 'Welcome back' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('hides raw exception text and offers safe recovery actions', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ThrowingChild = () => {
      throw new Error('SECRET_INTERNAL_STACK_DETAIL');
    };

    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.queryByText('SECRET_INTERNAL_STACK_DETAIL')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Return to practice' }).getAttribute('href')).toBe('/');
  });

  it('shows subject, year and topic context in the practice header', () => {
    render(
      <TutorHeader
        currentEx={{ id: 'q1' }}
        onExplain={() => {}}
        feedbackWidth={360}
        topic="AC9M7A02"
        subject="math"
        yearLevel="year7"
      />,
    );

    expect(screen.getByText('Practice')).toBeTruthy();
    expect(screen.getByText(/Mathematics · Year 7 · AC9M7A02/)).toBeTruthy();
  });
});
