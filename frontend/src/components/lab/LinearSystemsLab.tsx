'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Coordinates, Mafs, MovablePoint, Plot, Point, LaTeX as MafsLaTeX } from 'mafs';
import type { LabActivityMeta } from '../../lib/lab-activities';
import LearnPanel from './LearnPanel';
import { useLabVariant } from '../../lib/use-lab-variant';
import MafsStage from './MafsStage';
import LabSceneLayout from './LabSceneLayout';
import LabNumberInput from '../lab-shared/LabNumberInput';

interface LinearSystemsLabProps {
  activity: LabActivityMeta;
  mafsHeight: number;
  onComplete: (activityId: string, success: boolean) => void;
  onExit: () => void;
}

interface LineSystem {
  first: { m: number; c: number; label: string };
  second: { m: number; c: number; label: string };
}

const PRIMARY_SYSTEM: LineSystem = {
  first: { m: 2, c: 1, label: 'y = 2x + 1' },
  second: { m: -1, c: 7, label: 'y = -x + 7' },
};

// The authored "Test an Inequality Region" steps use these boundaries: they
// meet at (2, 3), (1, 3) is inside, and the extension maximum of 2x + y is 7.
const INEQUALITY_SYSTEM: LineSystem = {
  first: { m: 1, c: 1, label: 'y = x + 1' },
  second: { m: -1, c: 5, label: 'y = -x + 5' },
};

const TRANSFER_SYSTEM: LineSystem = {
  first: { m: 1, c: -1, label: 'y = x - 1' },
  second: { m: -3, c: 11, label: 'y = -3x + 11' },
};

/** Render `y = mx + c` the way the authored labels do. */
function lineLabel(m: number, c: number): string {
  const slope = m === 1 ? 'x' : m === -1 ? '-x' : `${m}x`;
  if (c === 0) return `y = ${slope}`;
  return `y = ${slope} ${c < 0 ? '-' : '+'} ${Math.abs(c)}`;
}

function intersection(system: LineSystem): [number, number] | null {
  const denominator = system.first.m - system.second.m;
  if (Math.abs(denominator) < 1e-10) return null;
  const x = (system.second.c - system.first.c) / denominator;
  return [x, system.first.m * x + system.first.c];
}

export default function LinearSystemsLab({
  activity,
  mafsHeight,
  onComplete,
  onExit,
}: LinearSystemsLabProps) {
  const isInequality = activity.id === 'sandbox-inequality-region';
  const [stepIndex, setStepIndex] = useState(0);
  const variant = useLabVariant(activity.id);
  const [revealed, setRevealed] = useState(false);
  const [testPoint, setTestPoint] = useState<[number, number]>([0, 0]);

  // A variant supplies the exact lines the prompt states; the literals above are
  // the authored fallback. Step index 2 is the transfer system; the extension
  // step (index 3) returns to the primary system because its prompt refers back
  // to that intersection. A variant extension has no scene data of its own, so
  // it reuses the variant's first (primary) system.
  const variantScene = variant.getSceneData(stepIndex)
    ?? (variant.variantSeed != null ? variant.getSceneData(0) : undefined);
  const variantSystem: LineSystem | null =
    variantScene && variantScene.kind === 'line-system'
      ? {
          first: {
            m: variantScene.first.m,
            c: variantScene.first.c,
            label: lineLabel(variantScene.first.m, variantScene.first.c),
          },
          second: {
            m: variantScene.second.m,
            c: variantScene.second.c,
            label: lineLabel(variantScene.second.m, variantScene.second.c),
          },
        }
      : null;

  const system = variantSystem ?? (
    isInequality
      ? INEQUALITY_SYSTEM
      : stepIndex === 2 ? TRANSFER_SYSTEM : PRIMARY_SYSTEM
  );
  const solution = useMemo(() => intersection(system), [system]);
  const lowerBoundary = useCallback((x: number) => system.first.m * x + system.first.c, [system]);
  const upperBoundary = useCallback((x: number) => system.second.m * x + system.second.c, [system]);
  const satisfiesRegion =
    testPoint[1] >= lowerBoundary(testPoint[0]) - 1e-9 &&
    testPoint[1] <= upperBoundary(testPoint[0]) + 1e-9;

  // Keep the draggable test point in step with the generated or authored scene.
  useEffect(() => {
    if (!isInequality) return;
    if (variantScene && variantScene.kind === 'line-system' && variantScene.testPoint) {
      setTestPoint(variantScene.testPoint);
    }
  }, [isInequality, variantScene]);

  const handleStepChange = (nextStep: number) => {
    setStepIndex(nextStep);
    setRevealed(false);
    if (isInequality && !variantSystem) {
      setTestPoint(nextStep === 1 ? [0, 0] : nextStep === 2 ? [1, 3] : [2, 3]);
    }
  };

  return (
    <LabSceneLayout
      control={
        <LearnPanel
          activity={activity}
          onComplete={onComplete}
          onExit={onExit}
          onRevealChange={setRevealed}
          onStepChange={handleStepChange}
          {...variant.learnPanelProps}
        />
      }
      visual={
        <>
          <MafsStage
            mafsHeight={mafsHeight}
            ariaLabel={isInequality ? 'Two linear inequalities and their feasible region' : 'Two lines and their intersection'}
            footer={isInequality ? (
              <fieldset className="glass-panel" style={{ padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                <legend style={{ fontSize: '12px', fontWeight: 700 }}>Test-point coordinates</legend>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <label style={{ fontSize: '11px' }}>
                    x
                    <LabNumberInput aria-label="Inequality test-point x-coordinate" step="0.5" value={testPoint[0]} onChange={(event) => setTestPoint([Number(event.target.value), testPoint[1]])} style={{ width: '100%', display: 'block' }} />
                  </label>
                  <label style={{ fontSize: '11px' }}>
                    y
                    <LabNumberInput aria-label="Inequality test-point y-coordinate" step="0.5" value={testPoint[1]} onChange={(event) => setTestPoint([testPoint[0], Number(event.target.value)])} style={{ width: '100%', display: 'block' }} />
                  </label>
                </div>
              </fieldset>
            ) : undefined}
          >
            <Mafs
              height={mafsHeight}
              viewBox={{ x: [-6, 8] as [number, number], y: [-6, 10] as [number, number] }}
              pan={false}
              zoom={false}
            >
              <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: 1 }} subdivisions={2} />

              {isInequality ? (
                <>
                  {revealed && (
                    <Plot.Inequality
                      y={{ '>=': lowerBoundary, '<=': upperBoundary }}
                      color="var(--text-secondary)"
                      fillOpacity={0.2}
                      weight={2}
                    />
                  )}
                  <Plot.OfX y={lowerBoundary} color="var(--accent-color)" weight={2} />
                  <Plot.OfX y={upperBoundary} color="var(--text-secondary)" weight={2} />
                  <MovablePoint
                    point={testPoint}
                    onMove={(point) => setTestPoint([Number(point[0].toFixed(2)), Number(point[1].toFixed(2))])}
                    color="var(--success)"
                  />
                  <MafsLaTeX
                    at={[testPoint[0] + 0.3, testPoint[1] + 0.3]}
                    tex={revealed
                      ? `T(${testPoint[0]},\\,${testPoint[1]})\\text{ — ${satisfiesRegion ? 'inside' : 'outside'}}`
                      : `T(${testPoint[0]},\\,${testPoint[1]})`}
                    color="var(--success)"
                  />
                </>
              ) : (
                <>
                  <Plot.OfX y={(x) => system.first.m * x + system.first.c} color="var(--accent-color)" weight={3} />
                  <Plot.OfX y={(x) => system.second.m * x + system.second.c} color="var(--text-secondary)" weight={3} />
                  {revealed && solution && (
                    <>
                      <Point x={solution[0]} y={solution[1]} color="var(--success)" />
                      <MafsLaTeX at={[solution[0] + 0.3, solution[1] + 0.3]} tex={`\\text{solution}\\,(${solution[0]},\\,${solution[1]})`} color="var(--success)" />
                    </>
                  )}
                </>
              )}
            </Mafs>
          </MafsStage>
        <div
          className="lab-visual-info glass-panel"
          style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}
        >
          {isInequality ? (
            <>
              <strong style={{ color: 'var(--text-primary)' }}>Boundaries:</strong>{' '}
              {system.first.label} and {system.second.label}.
              Drag T to test another point. The overlap and inside/outside result appear only after you submit a prediction.
            </>
          ) : (
            <>
              <strong style={{ color: 'var(--text-primary)' }}>Current system:</strong>{' '}
              {system.first.label} and {system.second.label}. The solution marker stays hidden until you submit.
            </>
          )}
        </div>
        </>
      }
    />
  );
}
