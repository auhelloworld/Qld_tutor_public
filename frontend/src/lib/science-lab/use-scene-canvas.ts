'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared canvas plumbing for Science Lab scenes.
 *
 * Replaces the previous `width`/`height` attributes plus
 * `style={{ width: '100%', maxHeight: 'Npx' }}` pattern, which had three
 * measured defects at a 768px viewport (the plan's target tablet):
 *
 * 1. Aspect distortion. Once the CSS width exceeded the bitmap width, the
 *    capped CSS height stretched the bitmap horizontally — measured 1.56x on
 *    the particle scene, 1.49x on the wave scene and 1.81x on the selection
 *    scene. That made isotropic particle motion look directionally biased and
 *    desynchronised the wave scene's on-screen wavelength from its measured
 *    readout.
 * 2. Blur on high-DPI screens: the backing store ignored devicePixelRatio
 *    (measured 1.17x effective backing ratio on a dpr-2 device).
 * 3. No growth: the drawing never used the width its column offered.
 *
 * The scene keeps drawing in a FIXED logical coordinate space (so simulation
 * world bounds stay valid); this hook only scales the backing store by dpr and
 * lets CSS scale the element while preserving the aspect ratio exactly.
 */
export interface UseSceneCanvasResult {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** CSS to apply to the canvas element. Keeps aspect exact, allows growth. */
  canvasStyle: React.CSSProperties;
  /** Sizes the backing store, applies the dpr transform, clears the frame. */
  prepareFrame: () => CanvasRenderingContext2D | null;
  logicalWidth: number;
  logicalHeight: number;
}

export function useSceneCanvas(
  logicalWidth: number,
  logicalHeight: number,
  maxDisplayWidth = logicalWidth * 2,
): UseSceneCanvasResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dpr, setDpr] = useState(1);

  useEffect(() => {
    const sync = () => setDpr(Math.min(window.devicePixelRatio || 1, 3));
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const prepareFrame = useCallback((): CanvasRenderingContext2D | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const backingW = Math.round(logicalWidth * dpr);
    const backingH = Math.round(logicalHeight * dpr);
    if (canvas.width !== backingW) canvas.width = backingW;
    if (canvas.height !== backingH) canvas.height = backingH;

    // All scene draw code works in logical units from here on.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }, [dpr, logicalWidth, logicalHeight]);

  const canvasStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    height: 'auto',
    // `aspect-ratio` with `height: auto` keeps the drawing undistorted at every
    // width, which `max-height` did not.
    aspectRatio: `${logicalWidth} / ${logicalHeight}`,
    maxWidth: `${maxDisplayWidth}px`,
    margin: '0 auto',
  };

  return { canvasRef, canvasStyle, prepareFrame, logicalWidth, logicalHeight };
}

/**
 * True while the document is hidden, so scenes can pause simulation on hidden
 * pages and resume on the same fixed time step without background catch-up.
 */
export function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const sync = () => setHidden(document.visibilityState === 'hidden');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  return hidden;
}

/** True when the user has asked for reduced motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Reactive reduced-motion preference used to suspend animation work while
 * preserving the user's play intent, so animation can resume if it changes.
 */
export function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mediaQuery.matches);
    sync();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', sync);
      return () => mediaQuery.removeEventListener('change', sync);
    }

    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

  return reducedMotion;
}
