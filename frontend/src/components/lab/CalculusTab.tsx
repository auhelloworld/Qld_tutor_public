'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Mafs, Coordinates, MovablePoint, Plot, Polygon, LaTeX as MafsLaTeX } from 'mafs';
import { Activity, HelpCircle } from 'lucide-react';
import * as math from 'mathjs';
import { formatValueLaTeX } from '../../lib/math-utils';
import { LaTeX } from './MathLabCommon';
import MafsStage from './MafsStage';
import LearnPanel from './LearnPanel';
import CalculusExtensionsLab from './CalculusExtensionsLab';
import ConceptConnectionsLab from './ConceptConnectionsLab';
import TryItCard from './TryItCard';
import LabSceneLayout from './LabSceneLayout';
import LabControlCard from './LabControlCard';
import LabSliderInput from './LabSliderInput';
import { LAB_ACTIVITIES, type LabActivityId } from '../../lib/lab-activities';
import { getExplorePrompts } from '../../lib/lab-explore-prompts';
import { useLabVariant } from '../../lib/use-lab-variant';

type CalculusExploreTopic =
  | 'core-calculus'
  | 'calculus-accumulation-link'
  | 'calculus-function-derivative-link'
  | 'calculus-direction-field'
  | 'calculus-kinematics-links'
  | 'calculus-numerical-methods';

interface CalculusTabProps {
  isExact: boolean;
  mafsHeight: number;
  preset?: string;
  mode?: 'explore' | 'learn';
  activityId?: LabActivityId;
  onActivityComplete?: (activityId: string, success: boolean) => void;
  onExitLearn?: () => void;
}

/**
 * Evaluator factory for calculus tab expressions.
 * P0 fix: Returns NaN (not 0) for non-finite values so Mafs breaks the plot path correctly.
 */
export function createCalculusEvaluator(expr: string): {
  evaluator: (x: number) => number;
  derivativeEvaluator: (x: number) => number;
  error: string;
} {
  const fallback: (value: number) => number = () => NaN;
  if (!expr.trim()) {
    return { evaluator: fallback, derivativeEvaluator: fallback, error: '' };
  }
  try {
    const node = math.parse(expr);
    const compiled = node.compile();
    const derivativeCompiled = math.derivative(expr, 'x').compile();
    const evaluator = (x: number) => {
      try {
        const result = compiled.evaluate({ x });
        // P0: Return NaN for non-finite results instead of 0
        return typeof result === 'number' && Number.isFinite(result) ? result : NaN;
      } catch {
        return NaN;
      }
    };
    const derivativeEvaluator = (x: number) => {
      try {
        const result = derivativeCompiled.evaluate({ x });
        return typeof result === 'number' && Number.isFinite(result) ? result : NaN;
      } catch {
        return NaN;
      }
    };
    return { evaluator, derivativeEvaluator, error: '' };
  } catch {
    return { evaluator: fallback, derivativeEvaluator: fallback, error: 'Invalid expression' };
  }
}

/**
 * Compute Riemann sum (left endpoint). Exported for testing.
 */
export function computeRiemannSum(
  evaluator: (x: number) => number,
  a: number,
  b: number,
  n: number
): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isInteger(n) || n <= 0) return NaN;
  let sum = 0;
  const dx = (b - a) / n;
  for (let i = 0; i < n; i++) {
    const val = evaluator(a + i * dx);
    if (!Number.isFinite(val)) return NaN;
    sum += val * dx;
  }
  return sum;
}

export default function CalculusTab({
  isExact,
  mafsHeight,
  preset = '',
  mode = 'explore',
  activityId,
  onActivityComplete,
  onExitLearn,
}: CalculusTabProps) {
  const [exploreTopic, setExploreTopic] = useState<CalculusExploreTopic>('core-calculus');
  const [calcX0, setCalcX0] = useState<number>(preset === 'derivative_tangent' ? 2 : 1);
  const [riemannN, setRiemannN] = useState<number>(preset === 'riemann_area' ? 12 : 10);
  const [integralA, setIntegralA] = useState<number>(preset === 'riemann_area' ? 0 : -2);
  const [integralB, setIntegralB] = useState<number>(preset === 'riemann_area' ? 3 : 2);
  const [calcExpr, setCalcExpr] = useState<string>(
    preset === 'derivative_tangent' ? 'x^2 - 3*x + 2' : 'x^2'
  );
  const [learnRevealed, setLearnRevealed] = useState(false);
  const [learnStep, setLearnStep] = useState(0);
  const variant = useLabVariant(activityId);

  // Sync the explore scene with the requested activity, the same way the other
  // tabs do. Without this an Explore deep link to a calculus extension scene
  // landed on the default core-calculus explorer instead.
  useEffect(() => {
    if (mode !== 'explore' || !activityId) return;
    const extensionTopics: CalculusExploreTopic[] = [
      'calculus-accumulation-link',
      'calculus-function-derivative-link',
      'calculus-direction-field',
      'calculus-kinematics-links',
      'calculus-numerical-methods',
    ];
    if (extensionTopics.includes(activityId as CalculusExploreTopic)) {
      setExploreTopic(activityId as CalculusExploreTopic);
    }
  }, [mode, activityId]);

  useEffect(() => {
    setLearnRevealed(false);
    // A variant supplies the exact curve and sample size the prompt states; the
    // literals below are the authored fallback.
    const sd = variant.getSceneData(learnStep);
    if (sd && sd.kind === 'tangent-curve') {
      const linear = sd.b === 0 ? '' : ` ${sd.b < 0 ? '-' : '+'} ${Math.abs(sd.b)}*x`;
      const constant = sd.c === 0 ? '' : ` ${sd.c < 0 ? '-' : '+'} ${Math.abs(sd.c)}`;
      setCalcExpr(`${sd.a === 1 ? '' : `${sd.a}*`}x^2${linear}${constant}`);
      setCalcX0(sd.x0);
      return;
    }
    if (sd && sd.kind === 'curve-analysis') {
      const quad = sd.b === 0 ? '' : ` ${sd.b < 0 ? '-' : '+'} ${Math.abs(sd.b)}*x^2`;
      const linear = sd.c === 0 ? '' : ` ${sd.c < 0 ? '-' : '+'} ${Math.abs(sd.c)}*x`;
      const constant = sd.d === 0 ? '' : ` ${sd.d < 0 ? '-' : '+'} ${Math.abs(sd.d)}`;
      setCalcExpr(`${sd.a === 1 ? '' : `${sd.a}*`}x^3${quad}${linear}${constant}`);
      setCalcX0(sd.x0);
      return;
    }
    if (sd && sd.kind === 'area-between') {
      setCalcExpr('x^2');
      setIntegralA(sd.from);
      setIntegralB(sd.to);
      setCalcX0(sd.to);
      return;
    }
    if (sd && sd.kind === 'riemann') {
      setCalcExpr('x^2');
      setIntegralA(0);
      setIntegralB(1);
      setRiemannN(sd.n);
      return;
    }

    if (activityId === 'calculus-tangent-slope-predict') {
      setCalcExpr('x^2 - 3*x');
      setCalcX0(learnStep === 2 ? 1.5 : 2);
    } else if (activityId === 'calculus-riemann-convergence') {
      setCalcExpr('x^2');
      setIntegralA(0);
      setIntegralB(1);
      setRiemannN([4, 10, 50][learnStep] ?? 4);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, learnStep, variant.variantSeed]);

  const parsedCalc = useMemo(() => createCalculusEvaluator(calcExpr), [calcExpr]);
  const parsedCalcEvaluator = parsedCalc.evaluator;
  const calcDerivativeEvaluator = parsedCalc.derivativeEvaluator;
  const calcError = parsedCalc.error;

  const formatValue = useCallback(
    (val: number) => {
      if (!Number.isFinite(val)) return 'undefined';
      if (Math.abs(val) < 1e-10) return '0';
      if (!isExact) return parseFloat(val.toFixed(3)).toString();

      const epsilon = 1e-9;
      if (Math.abs(Math.abs(val) - Math.PI) < epsilon) return (val < 0 ? '-' : '') + 'π';
      if (Math.abs(Math.abs(val) - Math.PI / 2) < epsilon) return (val < 0 ? '-' : '') + 'π/2';
      if (Math.abs(Math.abs(val) - Math.sqrt(2)) < epsilon) return (val < 0 ? '-' : '') + '√2';
      if (Math.abs(Math.abs(val) - Math.sqrt(3)) < epsilon) return (val < 0 ? '-' : '') + '√3';
      if (Math.abs(Math.abs(val) - Math.sqrt(2) / 2) < epsilon) return (val < 0 ? '-' : '') + '√2/2';
      if (Math.abs(Math.abs(val) - Math.sqrt(3) / 2) < epsilon) return (val < 0 ? '-' : '') + '√3/2';

      try {
        const f = math.fraction(val);
        const denominator = Number(f.d);
        const numerator = Number(f.n) * Number(f.s);
        if (denominator === 1) return numerator.toString();
        if (denominator < 100) return `${numerator}/${denominator}`;
      } catch {
        // ignore
      }
      return parseFloat(val.toFixed(3)).toString();
    },
    [isExact]
  );

  const f0 = parsedCalcEvaluator(calcX0);
  const mSlope = calcDerivativeEvaluator(calcX0);

  // Riemann Sums calculation
  const rects = (() => {
    const arr = [];
    const dx = (integralB - integralA) / riemannN;
    for (let i = 0; i < riemannN; i++) {
      const xL = integralA + i * dx;
      const xR = xL + dx;
      const yH = parsedCalcEvaluator(xL);
      if (!Number.isFinite(yH)) return [];
      arr.push(
        <Polygon
          key={`rect-${i}`}
          points={[
            [xL, 0],
            [xR, 0],
            [xR, yH],
            [xL, yH],
          ]}
          color="var(--text-secondary)"
          fillOpacity={0.2}
        />
      );
    }
    return arr;
  })();

  const estimatedArea = useMemo(
    () => computeRiemannSum(parsedCalcEvaluator, integralA, integralB, riemannN),
    [integralA, integralB, riemannN, parsedCalcEvaluator]
  );

  const exploreTopicSelector = (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
      Explore topic
      <select
        aria-label="Calculus explore topic"
        value={exploreTopic}
        onChange={(event) => setExploreTopic(event.target.value as CalculusExploreTopic)}
        style={{
          padding: '9px 10px',
          borderRadius: '7px',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
        }}
      >
        <option value="core-calculus">Derivatives and integrals</option>
        <option value="calculus-accumulation-link">Area, running total and rate</option>
        <option value="calculus-function-derivative-link">Graph slope and derivative</option>
        <option value="calculus-direction-field">Direction fields</option>
        <option value="calculus-kinematics-links">Position, velocity and acceleration</option>
        <option value="calculus-numerical-methods">Numerical methods</option>
      </select>
    </label>
  );

  // Learn mode
  const activity = activityId ? LAB_ACTIVITIES[activityId] : undefined;
  const isConnectionActivity = activityId === 'calculus-accumulation-link'
    || activityId === 'calculus-function-derivative-link'
    || (mode === 'explore' && (
      exploreTopic === 'calculus-accumulation-link'
      || exploreTopic === 'calculus-function-derivative-link'
    ));
  if (isConnectionActivity && (mode === 'explore' || (activity && onExitLearn && onActivityComplete))) {
    const connectionId = activity?.id === 'calculus-accumulation-link' || activity?.id === 'calculus-function-derivative-link'
      ? activity.id
      : exploreTopic as 'calculus-accumulation-link' | 'calculus-function-derivative-link';
    return (
      <ConceptConnectionsLab
        activity={LAB_ACTIVITIES[connectionId]}
        mafsHeight={mafsHeight}
        mode={mode}
        topicSelector={exploreTopicSelector}
        onComplete={onActivityComplete ?? (() => undefined)}
        onExit={onExitLearn ?? (() => undefined)}
      />
    );
  }
  if (
    mode === 'learn'
    && activity
    && onExitLearn
    && onActivityComplete
    && (
      activity.id === 'calculus-direction-field'
      || activity.id === 'calculus-kinematics-links'
      || activity.id === 'calculus-numerical-methods'
    )
  ) {
    return (
      <CalculusExtensionsLab
        key={activity.id}
        activity={activity}
        mafsHeight={mafsHeight}
        onComplete={onActivityComplete}
        onExit={onExitLearn}
      />
    );
  }

  if (mode === 'learn' && activity && onExitLearn && onActivityComplete) {
    const isTangentActivity = activityId === 'calculus-tangent-slope-predict';
    const isRiemannActivity = activityId === 'calculus-riemann-convergence';
    const isCurveActivity = activityId === 'calculus-curve-sketching';
    const isAreaActivity = activityId === 'calculus-area-between';
    // Variant data when present, otherwise the authored step's own scene, so the
    // canvas always shows exactly what the prompt describes.
    const stepScene = variant.getSceneData(learnStep) ?? activity.steps[learnStep]?.sceneData;
    const areaScene = stepScene && stepScene.kind === 'area-between' ? stepScene : undefined;
    const curveScene = stepScene && stepScene.kind === 'curve-analysis' ? stepScene : undefined;
    const areaLine = (x: number) => (areaScene ? areaScene.lineSlope * x + areaScene.lineIntercept : 0);
    const secondDerivative = curveScene ? 6 * curveScene.a * calcX0 + 2 * curveScene.b : 0;

    return (
      <LabSceneLayout
        control={
          <>
            <LearnPanel
              key={activity.id}
              activity={activity}
              onComplete={onActivityComplete}
              onExit={onExitLearn}
              onRevealChange={setLearnRevealed}
              onStepChange={setLearnStep}
              {...variant.learnPanelProps}
            />
            <LabControlCard compact>
              {isTangentActivity && (
                <LabSliderInput
                  id="learn-tangent-x"
                  label="Explore tangent point x₀"
                  ariaLabel="Learning tangent x-coordinate"
                  value={calcX0}
                  min={-2}
                  max={4}
                  step={0.1}
                  onChange={setCalcX0}
                />
              )}
              {isRiemannActivity && (
                <LabSliderInput
                  id="learn-riemann-n"
                  label="Explore left rectangles: n"
                  ariaLabel="Learning Riemann rectangle count"
                  value={riemannN}
                  min={1}
                  max={100}
                  step={1}
                  onChange={setRiemannN}
                  decimals={0}
                />
              )}
              <div aria-live="polite" style={{ marginTop: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                {!learnRevealed && 'Make a prediction first. The tangent/result or Riemann rectangles/estimate are hidden.'}
                {learnRevealed && isTangentActivity && `Tangent slope at x₀ = ${formatValue(calcX0)} is ${formatValue(mSlope)}.`}
                {learnRevealed && isRiemannActivity && `Left Riemann estimate on [0, 1]: ${formatValue(estimatedArea)}.`}
                {learnRevealed && isCurveActivity && `f''(${formatValue(calcX0)}) = ${formatValue(secondDerivative)}, so the curve is concave ${secondDerivative > 0 ? 'up' : 'down'} there. The dashed curve is f'.`}
                {learnRevealed && isAreaActivity && areaScene && `The shaded region runs from x = ${formatValue(areaScene.from)} to x = ${formatValue(areaScene.to)}.`}
              </div>
            </LabControlCard>
          </>
        }
        visual={
          <MafsStage mafsHeight={mafsHeight} ariaLabel="Calculus graph for the current learning activity" interaction="static">
            <Mafs
              height={mafsHeight}
              viewBox={{ x: [-3, 5] as [number, number], y: [-5, 8] as [number, number] }}
              pan={false}
              zoom={false}
            >
              <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: 1 }} subdivisions={2} />
              <Plot.OfX y={parsedCalcEvaluator} color="var(--accent-color)" weight={3} />
              {isRiemannActivity && learnRevealed && rects}

              {isAreaActivity && areaScene && (
                <>
                  <Plot.OfX y={areaLine} color="var(--text-secondary)" weight={2} />
                  {/* Outside the crossings the parabola is above the line, so the
                      shaded set is empty there and needs no x-clipping. */}
                  {learnRevealed && (
                    <Plot.Inequality
                      y={{ '>=': (x: number) => x * x, '<=': areaLine }}
                      color="var(--success)"
                      fillOpacity={0.25}
                      weight={2}
                    />
                  )}
                </>
              )}

              {isCurveActivity && curveScene && learnRevealed && (
                <Plot.OfX
                  y={(x) => 3 * curveScene.a * x * x + 2 * curveScene.b * x + curveScene.c}
                  color="var(--text-secondary)"
                  style="dashed"
                  weight={2}
                />
              )}
              {isTangentActivity && (
                <>
                  {learnRevealed && Number.isFinite(f0) && Number.isFinite(mSlope) && (
                    <Plot.OfX y={(x) => mSlope * (x - calcX0) + f0} color="var(--text-secondary)" style="dashed" weight={2} />
                  )}
                  <MovablePoint
                    point={[calcX0, Number.isFinite(f0) ? f0 : 0]}
                    onMove={(coords) => setCalcX0(Number(Math.max(-2, Math.min(4, coords[0])).toFixed(2)))}
                    color="var(--text-secondary)"
                  />
                  <MafsLaTeX
                    at={[calcX0 + 0.3, (Number.isFinite(f0) ? f0 : 0) + 0.3]}
                    tex={learnRevealed ? `x_0=${formatValue(calcX0)},\\; m=${formatValue(mSlope)}` : 'x_0'}
                    color="var(--text-secondary)"
                  />
                </>
              )}
            </Mafs>
          </MafsStage>
        }
      />
    );
  }

  if (mode === 'explore' && exploreTopic !== 'core-calculus') {
    return (
        <CalculusExtensionsLab
          key={exploreTopic}
          activity={LAB_ACTIVITIES[exploreTopic]}
          mafsHeight={mafsHeight}
          mode="explore"
          topicSelector={exploreTopicSelector}
          onComplete={() => undefined}
          onExit={() => undefined}
        />
    );
  }

  return (
    <LabSceneLayout
      align="stretch"
      control={
      <LabControlCard>
        {exploreTopicSelector}
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={18} color="var(--accent-color)" /> Calculus Explorer
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            Drag the point to see the tangent line (instantaneous rate of change). Adjust rectangles to visualize Riemann sums (definite integral area).
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label htmlFor="calc-expr-input" style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>Function f(x):</label>
          <input
            id="calc-expr-input"
            type="text"
            value={calcExpr}
            onChange={(e) => setCalcExpr(e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              fontSize: '15px',
              fontFamily: 'monospace',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
            }}
          />
          {calcError && (
            <span style={{ fontSize: '12px', color: '#ff4d4f', fontWeight: '600', marginTop: '2px' }}>
              ⚠️ {calcError}
            </span>
          )}
        </div>

        <LabSliderInput
          id="calc-tangent"
          label="Tangent Point x₀"
          ariaLabel="Calculus tangent point x-coordinate"
          value={calcX0}
          min={-5}
          max={5}
          step={0.5}
          onChange={(v) => setCalcX0(v)}
        />

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>
            <span>Integral Bounds: <LaTeX math={`[${formatValueLaTeX(integralA, isExact)}, ${formatValueLaTeX(integralB, isExact)}]`} /></span>
          </div>
          {/* Integral bound sliders: paired with mutual constraint (a ≤ b); no single numeric-input semantics — kept as bare range. */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label htmlFor="calc-bound-a" className="sr-only">Lower bound a</label>
            <input
              id="calc-bound-a"
              type="range"
              min="-5"
              max="5"
              step="0.1"
              value={integralA}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setIntegralA(val);
                if (val > integralB) setIntegralB(val);
              }}
              style={{ width: '50%', accentColor: 'var(--accent-purple)' }}
            />
            <label htmlFor="calc-bound-b" className="sr-only">Upper bound b</label>
            <input
              id="calc-bound-b"
              type="range"
              min="-5"
              max="5"
              step="0.1"
              value={integralB}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setIntegralB(val);
                if (val < integralA) setIntegralA(val);
              }}
              style={{ width: '50%', accentColor: 'var(--accent-purple)' }}
            />
          </div>
        </div>

        <LabSliderInput
          id="calc-riemann"
          label="Riemann Rectangles n"
          ariaLabel="Riemann rectangle count"
          value={riemannN}
          min={1}
          max={100}
          step={1}
          onChange={(v) => setRiemannN(v)}
          decimals={0}
        />

        <div aria-live="polite" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>Tangent Slope:</div>
            <div style={{ fontSize: '16px', fontWeight: '800', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center' }}>
              <LaTeX math={`m = ${formatValueLaTeX(calcDerivativeEvaluator(calcX0), isExact)}`} />
            </div>
          </div>
          <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {/* P0 fix: Changed from "Est. Area" to "Signed Area (Left Riemann)" */}
            <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }} title="Negative when f(x) < 0">
              Signed Area (Left Riemann):
            </div>
            <div style={{ fontSize: '16px', fontWeight: '800', color: 'var(--accent-color)', display: 'flex', alignItems: 'center' }}>
              <LaTeX math={`\\approx ${formatValueLaTeX(estimatedArea, isExact)}`} />
            </div>
          </div>
        </div>

        {/* General Info Alert */}
        <div style={{ display: 'flex', gap: '10px', background: 'rgba(99,102,241,0.04)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(99,102,241,0.1)', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
          <HelpCircle size={16} color="var(--accent-color)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            Drag the point to move the tangent line. The Riemann sum shows the signed area — negative when f(x) &lt; 0. More rectangles improve the approximation.
          </span>
        </div>

        <TryItCard prompts={getExplorePrompts('calculus', exploreTopic !== 'core-calculus' ? exploreTopic : undefined)} />
      </LabControlCard>
      }
      visual={
      <MafsStage mafsHeight={mafsHeight} ariaLabel="Calculus function plot with tangent line and Riemann rectangles" interaction="explore">
        <Mafs
          height={mafsHeight}
          viewBox={{ x: [-14, 14] as [number, number], y: [-14, 14] as [number, number] }}
          pan={true}
          zoom={{ min: 0.5, max: 4 }}
        >
          <Coordinates.Cartesian xAxis={{ lines: 2 }} yAxis={{ lines: 2 }} subdivisions={2} />
          {rects}
          <Plot.OfX y={parsedCalcEvaluator} color="var(--accent-color)" weight={3} />
          {Number.isFinite(f0) && Number.isFinite(mSlope) && (
            <>
              <Plot.OfX y={(x) => mSlope * (x - calcX0) + f0} color="var(--text-secondary)" style="dashed" weight={2} />
              <MovablePoint
                point={[calcX0, f0]}
                onMove={(coords) => {
                  const cx = Math.max(-5, Math.min(5, coords[0]));
                  setCalcX0(parseFloat(cx.toFixed(2)));
                }}
                color="var(--text-secondary)"
              />
              <MafsLaTeX at={[calcX0 + 0.3, f0 + 0.3]} tex={`P(${formatValue(calcX0)},\\,${formatValue(f0)})`} color="var(--text-secondary)" />
            </>
          )}
        </Mafs>
      </MafsStage>
      }
    />
  );
}
