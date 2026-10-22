import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScienceLearnPanel from '../components/science-lab/ScienceLearnPanel';
import { SCIENCE_ACTIVITIES } from '../lib/science-lab/activities';
import {
  getCompletedScienceActivityIds,
  getScienceLabCompletions,
  markScienceActivityCompleted,
} from '../lib/science-lab/completion';
import { STORAGE_KEY as STUDENT_ID_STORAGE_KEY } from '../lib/student_id';

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const SEASONS = SCIENCE_ACTIVITIES['SCI-SEASONS-01'];
const INITIAL_READOUTS = {
  monthName: 'December',
  solarAltitude: 82.5,
  daylightHours: 13.8,
};

function submitIncorrectPrediction(): void {
  const incorrectIndex = SEASONS.prediction.correctIndex === 0 ? 1 : 0;
  fireEvent.click(screen.getAllByRole('radio')[incorrectIndex]);
  fireEvent.click(screen.getByRole('button', { name: /Submit Prediction/i }));
}

function visitEveryInquiryStep(): void {
  SEASONS.learnSteps.forEach((step, index) => {
    fireEvent.click(screen.getByRole('button', {
      name: `Step ${index + 1}: ${step.title}`,
    }));
  });
}

function fillWrittenNotebook(): void {
  fireEvent.change(screen.getByLabelText('Prediction reasoning'), {
    target: { value: 'I think orbital distance causes the change, and I will test that idea.' },
  });
  fireEvent.change(screen.getByLabelText('Independent variable'), {
    target: { value: 'Day of year' },
  });
  fireEvent.change(screen.getByLabelText('Dependent variable'), {
    target: { value: 'Solar altitude' },
  });
  fireEvent.change(screen.getByLabelText('Controlled variables'), {
    target: { value: 'Latitude and axial tilt' },
  });

  fireEvent.click(screen.getByText('3. Claim, evidence, reasoning and limitation'));
  fireEvent.change(screen.getByLabelText('CER claim'), {
    target: { value: 'Axial tilt changes sunlight received in Brisbane.' },
  });
  fireEvent.change(screen.getByLabelText('CER evidence'), {
    target: { value: 'The recorded solar-altitude snapshots differ.' },
  });
  fireEvent.change(screen.getByLabelText('CER reasoning'), {
    target: { value: 'More direct sunlight concentrates energy over a smaller area.' },
  });
  fireEvent.change(screen.getByLabelText('Model limitation'), {
    target: { value: SEASONS.modelLimitations[0] },
  });
}

function prepareAlmostCompleteInquiry(): void {
  submitIncorrectPrediction();
  visitEveryInquiryStep();
  fillWrittenNotebook();
  const record = screen.getByRole('button', { name: 'Record current observation' });
  fireEvent.click(record);
  fireEvent.click(record);
  fireEvent.click(record);
}

describe('ScienceLearnPanel inquiry completion workflow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    localStorage.setItem(STUDENT_ID_STORAGE_KEY, STUDENT_A);
  });

  it('allows an incorrect prediction to complete only after visited steps and durable distinct evidence', async () => {
    const { rerender, unmount } = render(
      <ScienceLearnPanel activity={SEASONS} readouts={INITIAL_READOUTS} onTransfer={() => undefined} />,
    );

    submitIncorrectPrediction();
    expect(screen.getByText(/scientific result differs from your prediction/i)).toBeDefined();
    visitEveryInquiryStep();
    fillWrittenNotebook();

    const record = screen.getByRole('button', { name: 'Record current observation' });
    fireEvent.click(record);
    fireEvent.click(record);
    expect(getCompletedScienceActivityIds().has(SEASONS.id)).toBe(false);

    fireEvent.click(record);
    expect(getCompletedScienceActivityIds().has(SEASONS.id)).toBe(false);
    expect(screen.getByText('1/2 different snapshots recorded')).toBeDefined();

    rerender(
      <ScienceLearnPanel
        activity={SEASONS}
        readouts={{ ...INITIAL_READOUTS, solarAltitude: 39.2, daylightHours: 10.4 }}
        onTransfer={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Record current observation' }));

    await waitFor(() => {
      expect(getCompletedScienceActivityIds().has(SEASONS.id)).toBe(true);
      expect(screen.getByText(/Investigation complete/i)).toBeDefined();
    });
    expect(screen.getByText('Draft saved in this browser.')).toBeDefined();

    const completionBeforeReopen = getScienceLabCompletions()[SEASONS.id];
    unmount();
    render(
      <ScienceLearnPanel activity={SEASONS} readouts={INITIAL_READOUTS} onTransfer={() => undefined} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Investigation complete/i)).toBeDefined();
    });
    expect(getScienceLabCompletions()[SEASONS.id]).toEqual(completionBeforeReopen);
  }, 10_000);

  it('loads each activity draft independently when the activity prop changes', () => {
    const wave = SCIENCE_ACTIVITIES['SCI-WAVE-01'];
    const { rerender } = render(
      <ScienceLearnPanel activity={SEASONS} readouts={INITIAL_READOUTS} onTransfer={() => undefined} />,
    );

    fireEvent.change(screen.getByLabelText('Prediction reasoning'), {
      target: { value: 'Seasons-only reasoning' },
    });

    rerender(
      <ScienceLearnPanel activity={wave} readouts={{ frequencyReadout: 2 }} onTransfer={() => undefined} />,
    );
    expect((screen.getByLabelText('Prediction reasoning') as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Prediction reasoning'), {
      target: { value: 'Waves-only reasoning' },
    });

    rerender(
      <ScienceLearnPanel activity={SEASONS} readouts={INITIAL_READOUTS} onTransfer={() => undefined} />,
    );
    expect((screen.getByLabelText('Prediction reasoning') as HTMLTextAreaElement).value).toBe(
      'Seasons-only reasoning',
    );
  });

  it('keeps a complete in-memory notebook as a session draft when notebook saving fails', async () => {
    const { rerender } = render(
      <ScienceLearnPanel activity={SEASONS} readouts={INITIAL_READOUTS} onTransfer={() => undefined} />,
    );
    prepareAlmostCompleteInquiry();
    rerender(
      <ScienceLearnPanel
        activity={SEASONS}
        readouts={{ ...INITIAL_READOUTS, solarAltitude: 39.2, daylightHours: 10.4 }}
        onTransfer={() => undefined}
      />,
    );

    const originalSetItem = Storage.prototype.setItem;
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
      if (key.includes('qld-science-lab-inquiry-notebook')) {
        throw new DOMException('Full', 'QuotaExceededError');
      }
      originalSetItem.call(this, key, value);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record current observation' }));

    expect(getCompletedScienceActivityIds().has(SEASONS.id)).toBe(false);
    expect(screen.queryByText(/Investigation complete/i)).toBeNull();
    expect(screen.getByText(/Session draft only/i)).toBeDefined();
    expect(screen.getByText(/cannot count as persistently complete/i)).toBeDefined();

    storageSpy.mockRestore();
    fireEvent.change(screen.getByLabelText('CER reasoning'), {
      target: { value: 'Storage recovered, so this complete inquiry can now be persisted.' },
    });
    await waitFor(() => {
      expect(getCompletedScienceActivityIds().has(SEASONS.id)).toBe(true);
      expect(screen.getByText(/Investigation complete/i)).toBeDefined();
    });
  }, 10_000);

  it('does not update completion UI when the completion record write fails', async () => {
    const { rerender } = render(
      <ScienceLearnPanel activity={SEASONS} readouts={INITIAL_READOUTS} onTransfer={() => undefined} />,
    );
    prepareAlmostCompleteInquiry();
    rerender(
      <ScienceLearnPanel
        activity={SEASONS}
        readouts={{ ...INITIAL_READOUTS, solarAltitude: 39.2, daylightHours: 10.4 }}
        onTransfer={() => undefined}
      />,
    );

    const originalSetItem = Storage.prototype.setItem;
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
      if (key.startsWith('qld-science-lab-completed-v1:')) {
        throw new DOMException('Blocked', 'SecurityError');
      }
      originalSetItem.call(this, key, value);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record current observation' }));

    await waitFor(() => {
      expect(screen.getByText(/Session draft only/i)).toBeDefined();
    });
    expect(getCompletedScienceActivityIds().has(SEASONS.id)).toBe(false);
    expect(screen.queryByText(/Investigation complete/i)).toBeNull();

    storageSpy.mockRestore();
    fireEvent.change(screen.getByLabelText('CER claim'), {
      target: { value: 'A persisted completion is only shown after its record is stored.' },
    });
    await waitFor(() => {
      expect(getCompletedScienceActivityIds().has(SEASONS.id)).toBe(true);
      expect(screen.getByText(/Investigation complete/i)).toBeDefined();
    });
  }, 10_000);

  it('restores completion UI from an existing profile-scoped completion record', async () => {
    expect(markScienceActivityCompleted(SEASONS.id)).toBe(true);
    render(
      <ScienceLearnPanel activity={SEASONS} readouts={INITIAL_READOUTS} onTransfer={() => undefined} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Investigation complete/i)).toBeDefined();
    });
  });
});
