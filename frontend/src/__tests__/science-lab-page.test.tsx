import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ScienceLabDirectory from '../components/science-lab/ScienceLabDirectory';
import ScienceLearnPanel from '../components/science-lab/ScienceLearnPanel';
import PredictionPanel from '../components/science-lab/controls/PredictionPanel';
import ObservationPanel from '../components/science-lab/controls/ObservationPanel';
import ExplanationPanel from '../components/science-lab/controls/ExplanationPanel';
import { SCIENCE_ACTIVITIES } from '../lib/science-lab/activities';
import {
  buildScienceTransferPracticeHref,
  resolveScienceTransferTopic,
  withScienceSelectionYear,
} from '../lib/science-lab/topic-links';

describe('Science Lab UI Shell & Component Tests', () => {
  describe('ScienceLabDirectory', () => {
    it('renders directory with all 18 activities and forwards the selected year', () => {
      const selectSpy = vi.fn();
      render(<ScienceLabDirectory onSelectActivity={selectSpy} />);

      expect(screen.getByText(/Interactive Science Lab/i)).toBeDefined();
      expect(screen.getByText('Earth, Sun and the Seasons')).toBeDefined();
      expect(screen.getByText('Particle Model: States, Expansion & Diffusion')).toBeDefined();
      expect(screen.getAllByRole('button', { name: /Start Lab:/i })).toHaveLength(18);
      expect(screen.getByRole('status').textContent).toMatch(/^18 labs match/);

      const year10Btn = screen.getByRole('button', { name: 'Year 10' });
      fireEvent.click(year10Btn);
      expect(screen.getByText('Natural Selection Across Generations')).toBeDefined();
      expect(screen.queryByText('Earth, Sun and the Seasons')).toBeNull();

      const startBtn = screen.getAllByRole('button', { name: /Start Lab:/i })[0];
      fireEvent.click(startBtn);
      expect(selectSpy).toHaveBeenCalledWith('SCI-FORCE-01', 'learn', 10);
    });

    it('maps All Years to undefined for both learn and sandbox selections', () => {
      const selectSpy = vi.fn();
      render(<ScienceLabDirectory onSelectActivity={selectSpy} />);
      const firstActivity = Object.values(SCIENCE_ACTIVITIES)[0];

      fireEvent.click(screen.getAllByRole('button', { name: /Start Lab:/i })[0]);
      expect(selectSpy).toHaveBeenLastCalledWith(firstActivity.id, 'learn', undefined);

      fireEvent.click(screen.getAllByRole('button', { name: /Sandbox:/i })[0]);
      expect(selectSpy).toHaveBeenLastCalledWith(firstActivity.id, 'explore', undefined);
    });
  });

  describe('Science transfer course context', () => {
    it('replaces the selected year before resolving and drops a stale source topic', () => {
      const activity = SCIENCE_ACTIVITIES['SCI-FORCE-01'];
      const nextContext = withScienceSelectionYear(
        { subject: 'science', year: 'year7', topic: 'AC9S7U04' },
        10,
      );

      expect(nextContext).toEqual({
        subject: 'science',
        year: 'year10',
        topic: undefined,
      });
      expect(resolveScienceTransferTopic(activity, nextContext)).toBe('AC9S10U05');

      const href = buildScienceTransferPracticeHref('AC9S10U05');
      const params = new URL(href, 'https://qld-tutor.local').searchParams;
      expect(params.get('subject')).toBe('science');
      expect(params.get('year')).toBe('year10');
      expect(params.get('topic')).toBe('AC9S10U05');
    });

    it('retains a compatible originating topic and preserves All Years context', () => {
      const activity = SCIENCE_ACTIVITIES['SCI-FORCE-01'];
      const sourceContext = { subject: 'science', year: 'year7', topic: 'AC9S7U04' };
      const nextContext = withScienceSelectionYear(sourceContext, undefined);

      expect(nextContext).toEqual(sourceContext);
      expect(resolveScienceTransferTopic(activity, nextContext)).toBe('AC9S7U04');
    });
  });

  describe('PredictionPanel Gating', () => {
    it('keeps submit disabled until a radio option is chosen, then reveals neutral feedback', () => {
      const predictSpy = vi.fn();
      const predDef = SCIENCE_ACTIVITIES['SCI-SEASONS-01'].prediction;
      const incorrectIndex = predDef.correctIndex === 0 ? 1 : 0;
      const optionLetter = String.fromCharCode(65 + incorrectIndex);

      render(
        <PredictionPanel
          prediction={predDef}
          onPredict={predictSpy}
          isSubmitted={false}
        />,
      );

      const submitBtn = screen.getByRole('button', { name: /Submit Prediction/i });
      expect((submitBtn as HTMLButtonElement).disabled).toBe(true);

      const option = screen.getByRole('radio', { name: new RegExp(`^${optionLetter}\\.`) });
      fireEvent.click(option);
      expect((option as HTMLInputElement).checked).toBe(true);
      expect((submitBtn as HTMLButtonElement).disabled).toBe(false);

      fireEvent.click(submitBtn);
      expect(predictSpy).toHaveBeenCalledWith(incorrectIndex);

      const feedback = screen.getByRole('status');
      expect(feedback.textContent).toContain(
        'The scientific result differs from your prediction — that comparison is useful evidence.',
      );
    });
  });

  describe('ObservationPanel & ExplanationPanel', () => {
    it('ObservationPanel displays locked message when not unlocked, then metrics when unlocked', () => {
      const obsDef = SCIENCE_ACTIVITIES['SCI-SEASONS-01'].observation;
      const { rerender } = render(
        <ObservationPanel
          observation={obsDef}
          readouts={{}}
          isUnlocked={false}
        />,
      );

      expect(screen.getByText(/Submit your prediction above/i)).toBeDefined();

      rerender(
        <ObservationPanel
          observation={obsDef}
          readouts={{
            monthName: 'December',
            solarAltitude: '82.5',
            daylightHours: '13.8',
          }}
          isUnlocked={true}
        />,
      );

      expect(screen.getByText('82.5 °')).toBeDefined();
      expect(screen.getByText('13.8 hrs')).toBeDefined();
    });

    it('ExplanationPanel displays model assumptions and transfer challenge button', () => {
      const transferSpy = vi.fn();
      render(
        <ExplanationPanel
          modelLimitations={['Assumes circular orbit', 'Neglects atmospheric refraction']}
          transferTopicId="AC9S7U03"
          onTransfer={transferSpy}
        />,
      );

      expect(screen.getByText(/Assumes circular orbit/i)).toBeDefined();
      const transferBtn = screen.getByRole('button', { name: /Start Transfer Practice/i });
      fireEvent.click(transferBtn);
      expect(transferSpy).toHaveBeenCalled();
    });
  });

  describe('ScienceLearnPanel Inquiry Workflow', () => {
    it('steps through inquiry phases and reveals observations upon prediction', () => {
      const transferSpy = vi.fn();
      const activity = SCIENCE_ACTIVITIES['SCI-SEASONS-01'];

      render(
        <ScienceLearnPanel
          activity={activity}
          readouts={{
            solarAltitude: 82.5,
            daylightHours: 13.8,
          }}
          onTransfer={transferSpy}
        />,
      );

      expect(screen.getByText('Orient: Earth’s Fixed Axis in Space')).toBeDefined();

      const step2Btn = screen.getByRole('button', {
        name: `Step 2: ${activity.learnSteps[1].title}`,
      });
      fireEvent.click(step2Btn);
      expect(
        screen.getByRole('heading', { name: /Predict: Cause of Seasonal Temperature/i }),
      ).toBeDefined();
    });
  });
});
