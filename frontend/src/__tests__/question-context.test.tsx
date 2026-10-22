import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import QuestionContext from '../components/QuestionContext';

vi.mock('../components/DiagramRenderer', () => ({
  default: ({ data }: { data: Record<string, unknown> }) => <div data-testid="diagram">{String(data.type)}</div>,
}));

describe('QuestionContext', () => {
  it('renders a resolved stimulus before the question', () => {
    render(
      <QuestionContext
        question={{
          question: 'How does the writer create tension?',
          passage: 'The streetlights flickered as the crowd fell silent.',
        }}
      />,
    );
    expect(screen.getByRole('region', { name: 'Stimulus' }).textContent).toContain('streetlights flickered');
    expect(screen.getByText(/How does the writer create tension/)).toBeTruthy();
  });

  it('strips duplicate passage and question headers when passage is resolved', () => {
    render(
      <QuestionContext
        question={{
          question: '**Passage:**\nThis is a sample passage text.\n\n**Question:** What is the main idea?',
          passage: 'This is a sample passage text.',
        }}
      />,
    );
    expect(screen.getByRole('region', { name: 'Stimulus' }).textContent).toContain('This is a sample passage text');
    expect(screen.getByText('What is the main idea?')).toBeTruthy();
    expect(screen.queryByText(/Passage:/)).toBeNull();
    expect(screen.queryByText(/Question:/)).toBeNull();
  });

  it('renders top-level and part-level visuals without answers', () => {
    render(
      <QuestionContext
        showSubParts
        question={{
          question: 'Use the diagrams.',
          diagram_data: { type: 'force_diagram' },
          sub_parts: [
            {
              label: 'a',
              question: 'Interpret the box plot.',
              marks: 2,
              diagram_data: { type: 'box_plot' },
            },
          ],
        }}
      />,
    );
    expect(screen.getAllByTestId('diagram')).toHaveLength(2);
    expect(screen.getByText(/Part A \(2 marks\)/)).toBeTruthy();
  });

  it('caps question images at 450px while remaining responsive', () => {
    render(
      <QuestionContext
        question={{
          question: 'Use the image.',
          image: '/question-image.png',
        }}
      />,
    );

    const image = screen.getByRole('img', { name: 'Question diagram' });
    expect(image.style.maxWidth).toBe('min(100%, 450px)');
    expect(image.style.width).toBe('auto');
    expect(image.style.height).toBe('auto');
    expect(image.style.maxHeight).toBe('min(400px, 60vh)');
    expect(image.style.objectFit).toBe('contain');
  });
});
