import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import ParticleModelScene from '../components/science-lab/scenes/canvas/ParticleModelScene';
import WaveMediumScene from '../components/science-lab/scenes/canvas/WaveMediumScene';
import { SimulationClock } from '../lib/science-lab/simulation-clock';

describe('Science Lab Scene Cleanup and Lifecycle Contracts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cleans up animation frame on ParticleModelScene unmount', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = render(
      <ParticleModelScene
        sceneData={{
          kind: 'particle-model',
          temperatureK: 300,
          stateMode: 'states',
          particleCount: 120,
          isPlaying: true,
        }}
      />,
    );

    unmount();
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('cleans up animation frame on WaveMediumScene unmount', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = render(
      <WaveMediumScene
        sceneData={{
          kind: 'wave-medium',
          frequencyHz: 1.5,
          amplitudePx: 30,
          hasMedium: true,
          waveType: 'side-by-side',
          isPlaying: true,
        }}
      />,
    );

    unmount();
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('SimulationClock steps deterministically and stops cleanly', () => {
    let steps = 0;
    const clock = new SimulationClock({
      fixedDtSeconds: 0.02,
      onStep: () => {
        steps++;
      },
    });

    expect(clock.running).toBe(false);
    clock.stepOnce();
    expect(steps).toBe(1);

    clock.start();
    expect(clock.running).toBe(true);

    clock.stop();
    expect(clock.running).toBe(false);
  });
});
