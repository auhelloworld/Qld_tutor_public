/**
 * React hook for managing Lab variant state in scene components.
 * Encapsulates seed generation, variant step creation, and reset logic.
 */

import { useState, useCallback, useMemo } from 'react';
import type { LearnStep, LabSceneData } from './lab-activities';
import { makeVariant, hasVariants as checkHasVariants } from './lab-variants';

export interface UseLabVariantResult {
  /** Current variant seed (null = use fixed steps) */
  variantSeed: number | null;
  /** Generated variant steps (empty if no variants) */
  variantSteps: LearnStep[];
  /** Whether this activity supports variants */
  hasVariants: boolean;
  /** Request a new random variant (resets seed) */
  newVariant: () => void;
  /** Get the sceneData for a specific step index (typed). Returns undefined if not available. */
  getSceneData: (stepIndex: number) => LabSceneData | undefined;
  /** Props to spread onto LearnPanel */
  learnPanelProps: {
    variantSeed: number | null;
    variantSteps: LearnStep[] | undefined;
    onNewVariant: (() => void) | undefined;
  };
}

/**
 * Hook for scene components that render LearnPanel.
 * Manages variant seed state and provides generated steps.
 */
export function useLabVariant(activityId: string | undefined): UseLabVariantResult {
  const [variantSeed, setVariantSeed] = useState<number | null>(null);

  const supportsVariants = activityId ? checkHasVariants(activityId) : false;

  const variantSteps = useMemo(() => {
    if (!activityId || variantSeed == null) return [];
    const result = makeVariant(activityId, variantSeed);
    return result.hasVariants ? result.steps : [];
  }, [activityId, variantSeed]);

  const newVariant = useCallback(() => {
    // Use Date.now() XORed with a counter for variety
    setVariantSeed(Date.now() ^ Math.floor(Math.random() * 0x7fffffff));
  }, []);

  const getSceneData = useCallback((stepIndex: number): LabSceneData | undefined => {
    if (variantSeed == null || variantSteps.length === 0) return undefined;
    return variantSteps[stepIndex]?.sceneData;
  }, [variantSeed, variantSteps]);

  const learnPanelProps = useMemo(() => ({
    variantSeed,
    variantSteps: variantSeed != null && variantSteps.length > 0 ? variantSteps : undefined,
    onNewVariant: supportsVariants ? newVariant : undefined,
  }), [variantSeed, variantSteps, supportsVariants, newVariant]);

  return {
    variantSeed,
    variantSteps,
    hasVariants: supportsVariants,
    newVariant,
    getSceneData,
    learnPanelProps,
  };
}
