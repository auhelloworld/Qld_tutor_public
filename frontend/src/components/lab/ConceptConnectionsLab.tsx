'use client';

import React, { useMemo, useState } from 'react';
import {
  Circle,
  Coordinates,
  LaTeX as MafsLaTeX,
  Line,
  Mafs,
  MovablePoint,
  Plot,
  Point,
  Polygon,
  Vector,
} from 'mafs';
import type { LabActivityMeta, LabSceneData } from '../../lib/lab-activities';
import LearnPanel from './LearnPanel';
import LabControlCard from './LabControlCard';
import LabSceneLayout from './LabSceneLayout';
import LabSliderInput from './LabSliderInput';
import MafsStage from './MafsStage';
import TryItCard from './TryItCard';
import { getExplorePrompts } from '../../lib/lab-explore-prompts';
import { useLabVariant } from '../../lib/use-lab-variant';

interface ConceptConnectionsLabProps {
  activity: LabActivityMeta;
  mafsHeight: number;
  mode: 'explore' | 'learn';
  topicSelector?: React.ReactNode;
  onComplete: (activityId: string, success: boolean) => void;
  onExit: () => void;
}

interface SceneFrameProps extends ConceptConnectionsLabProps {
  controls: React.ReactNode;
  visual: React.ReactNode;
  revealed: boolean;
  onRevealChange: (revealed: boolean) => void;
  onStepChange: (step: number) => void;
  variantLearnPanelProps: {
    variantSeed: number | null;
    variantSteps: LabActivityMeta['steps'] | undefined;
    onNewVariant: (() => void) | undefined;
  };
}

function SceneFrame({
  activity,
  mode,
  topicSelector,
  onComplete,
  onExit,
  controls,
  visual,
  revealed,
  onRevealChange,
  onStepChange,
  variantLearnPanelProps,
}: SceneFrameProps) {
  return (
    <LabSceneLayout
      align="stretch"
      control={mode === 'learn' ? (
        <LearnPanel
          activity={activity}
          onComplete={onComplete}
          onExit={onExit}
          onRevealChange={onRevealChange}
          onStepChange={onStepChange}
          {...variantLearnPanelProps}
        />
      ) : (
        <LabControlCard>
          {topicSelector}
          {controls}
          <TryItCard prompts={getExplorePrompts(activity.tab, activity.id)} />
        </LabControlCard>
      )}
      visual={(
        <>
          {visual}
          {mode === 'learn' && !revealed && (
            <div className="lab-visual-info glass-panel" aria-live="polite" style={{ padding: '10px 14px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Make a prediction, then submit to reveal the linked values and explanation.
            </div>
          )}
        </>
      )}
    />
  );
}

function sliderGroup(children: React.ReactNode) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>{children}</div>;
}

function readout(children: React.ReactNode) {
  return (
    <div aria-live="polite" style={{ padding: '12px', borderRadius: '9px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '13px', lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

function sceneData(activity: LabActivityMeta, step: number): LabSceneData | undefined {
  return activity.steps[step]?.sceneData;
}

export default function ConceptConnectionsLab(props: ConceptConnectionsLabProps) {
  const [step, setStep] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const variant = useLabVariant(props.activity.id);
  const activeSceneData = variant.getSceneData(step) ?? sceneData(props.activity, step);
  const shared = {
    ...props,
    step,
    revealed,
    activeSceneData,
    variantLearnPanelProps: variant.learnPanelProps,
    onRevealChange: setRevealed,
    onStepChange: (nextStep: number) => {
      setRevealed(false);
      setStep(nextStep);
    },
  };

  switch (props.activity.id) {
    case 'sandbox-piecewise-absolute':
      return <PiecewiseAbsoluteScene {...shared} />;
    case 'calculus-accumulation-link':
      return <AccumulationScene {...shared} />;
    case 'calculus-function-derivative-link':
      return <FunctionDerivativeScene {...shared} />;
    case 'statistics-sampling-distribution':
      return <SamplingDistributionScene {...shared} />;
    case 'geometry-trig-connections':
      return <TrigConnectionsScene {...shared} />;
    case 'linear-complex-multiplication':
      return <ComplexMultiplicationScene {...shared} />;
    default:
      return null;
  }
}

type ConnectionSceneProps = ConceptConnectionsLabProps & {
  step: number;
  revealed: boolean;
  activeSceneData: LabSceneData | undefined;
  variantLearnPanelProps: SceneFrameProps['variantLearnPanelProps'];
  onRevealChange: (revealed: boolean) => void;
  onStepChange: (step: number) => void;
};

function PiecewiseAbsoluteScene(props: ConnectionSceneProps) {
  const authored = props.activeSceneData;
  const fixed = authored?.kind === 'piecewise-absolute' ? authored : undefined;
  const [a, setA] = useState(2);
  const [h, setH] = useState(1);
  const [k, setK] = useState(-1);
  const [traceX, setTraceX] = useState(3);
  const values = props.mode === 'learn'
    ? { a: fixed?.a ?? 2, h: fixed?.h ?? 1, k: fixed?.k ?? -1, x: fixed?.x ?? 1 }
    : { a, h, k, x: traceX };
  const y = values.a * Math.abs(values.x - values.h) + values.k;
  const table = [-2, -1, 0, 1, 2].map((offset) => {
    const x = values.h + offset;
    return [x, values.a * Math.abs(offset) + values.k] as const;
  });
  const show = props.mode === 'explore' || props.revealed;

  return (
    <SceneFrame
      {...props}
      controls={(
        <>
          <h3 style={{ margin: 0 }}>One rule, two straight lines and a graph</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>Change a, h and k. Watch the vertex move and compare the left side, right side, table and graph.</p>
          {sliderGroup(<>
            <LabSliderInput id="piecewise-a" label="Stretch or flip (a)" ariaLabel="Absolute value scale a" value={a} min={-3} max={3} step={0.5} onChange={setA} />
            <LabSliderInput id="piecewise-h" label="Move left or right (h)" ariaLabel="Absolute value horizontal shift h" value={h} min={-4} max={4} step={0.5} onChange={setH} />
            <LabSliderInput id="piecewise-k" label="Move up or down (k)" ariaLabel="Absolute value vertical shift k" value={k} min={-4} max={4} step={0.5} onChange={setK} />
            <LabSliderInput id="piecewise-x" label="Choose an x-value" ariaLabel="Absolute value trace x" value={traceX} min={-6} max={6} step={0.5} onChange={setTraceX} />
          </>)}
          {readout(<>
            <strong>Rule: f(x) = {a}|x − ({h})| + ({k})</strong><br />
            Left-side gradient: {(-a).toFixed(2)} · Right-side gradient: {a.toFixed(2)}<br />
            Vertex: ({h}, {k}) · At x = {traceX}, y = {y.toFixed(2)}
          </>)}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', fontSize: '11px' }}>
            {table.map(([xValue, yValue]) => <div key={xValue} style={{ textAlign: 'center', padding: '6px 2px', background: 'var(--bg-secondary)', borderRadius: '5px' }}>x={xValue}<br /><strong>{yValue}</strong></div>)}
          </div>
        </>
      )}
      visual={(
        <MafsStage mafsHeight={props.mafsHeight} ariaLabel="Absolute value graph with piecewise branches and trace point" interaction={props.mode === 'explore' ? 'explore' : 'static'}>
          <Mafs height={props.mafsHeight} viewBox={{ x: [-7, 7], y: [-7, 7] }} pan={props.mode === 'explore'} zoom={props.mode === 'explore' ? { min: 0.5, max: 3 } : false}>
            <Coordinates.Cartesian />
            <Plot.OfX y={(xValue) => values.a * Math.abs(xValue - values.h) + values.k} color="var(--accent-color)" weight={3} />
            <Plot.OfX y={(xValue) => xValue <= values.h ? -values.a * (xValue - values.h) + values.k : NaN} color="var(--text-secondary)" style="dashed" weight={2} />
            <Plot.OfX y={(xValue) => xValue >= values.h ? values.a * (xValue - values.h) + values.k : NaN} color="var(--success)" style="dashed" weight={2} />
            <Point x={values.h} y={values.k} color="var(--accent-purple)" />
            {show && <Point x={values.x} y={y} color="var(--success)" />}
            {show && <MafsLaTeX at={[values.x + 0.5, y + 0.5]} tex={`(${values.x},${Number(y.toFixed(2))})`} color="var(--success)" />}
          </Mafs>
        </MafsStage>
      )}
    />
  );
}

function AccumulationScene(props: ConnectionSceneProps) {
  const authored = props.activeSceneData;
  const fixed = authored?.kind === 'accumulation-link' ? authored : undefined;
  const [m, setM] = useState(2);
  const [c, setC] = useState(1);
  const [x, setX] = useState(2);
  const values = props.mode === 'learn' ? { m: fixed?.m ?? 2, c: fixed?.c ?? 1, x: fixed?.x ?? 2 } : { m, c, x };
  const rate = (at: number) => values.m * at + values.c;
  const accumulation = (at: number) => 0.5 * values.m * at * at + values.c * at;
  const start = Math.min(0, values.x);
  const end = Math.max(0, values.x);
  const areaPoints: [number, number][] = [[start, 0]];
  for (let index = 0; index <= 32; index++) {
    const pointX = start + ((end - start) * index) / 32;
    areaPoints.push([pointX, rate(pointX)]);
  }
  areaPoints.push([end, 0]);
  const show = props.mode === 'explore' || props.revealed;

  return (
    <SceneFrame
      {...props}
      controls={(
        <>
          <h3 style={{ margin: 0 }}>Area builds a running total</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>The green area from 0 to x is the running total A(x). A positive rate makes the total rise; a negative rate makes it fall.</p>
          {sliderGroup(<>
            <LabSliderInput id="acc-m" label="Rate line steepness (m)" ariaLabel="Rate function gradient" value={m} min={-3} max={3} step={0.5} onChange={setM} />
            <LabSliderInput id="acc-c" label="Starting rate (c)" ariaLabel="Rate function intercept" value={c} min={-3} max={3} step={0.5} onChange={setC} />
            <LabSliderInput id="acc-x" label="Where to stop adding area (x)" ariaLabel="Accumulation endpoint" value={x} min={-4} max={4} step={0.25} onChange={setX} />
          </>)}
          {readout(<>
            Rate rule: f(x) = {m}x + {c}<br />
            Running-total rule: A(x) = {(m / 2).toFixed(2)}x² + {c}x<br />
            <strong>At x = {x}: total A(x) = {accumulation(x).toFixed(3)} · current rate f(x) = {rate(x).toFixed(3)}</strong><br />
            The total graph’s gradient is A′(x) = f(x).
          </>)}
        </>
      )}
      visual={(
        <MafsStage mafsHeight={props.mafsHeight} ariaLabel="Rate function, accumulation graph and signed area" interaction={props.mode === 'explore' ? 'explore' : 'static'}>
          <Mafs height={props.mafsHeight} viewBox={{ x: [-5, 5], y: [-8, 10] }} pan={props.mode === 'explore'} zoom={props.mode === 'explore' ? { min: 0.5, max: 3 } : false}>
            <Coordinates.Cartesian />
            <Plot.OfX y={rate} color="var(--accent-color)" weight={3} />
            <Plot.OfX y={accumulation} color="var(--accent-purple)" style="dashed" weight={3} />
            <Polygon points={areaPoints} color="var(--success)" fillOpacity={0.2} strokeOpacity={0.5} />
            {show && <Point x={values.x} y={accumulation(values.x)} color="var(--accent-purple)" />}
            {show && <Point x={values.x} y={rate(values.x)} color="var(--accent-color)" />}
            {props.mode === 'explore' && <MovablePoint point={[values.x, accumulation(values.x)]} onMove={(point) => setX(Number(Math.max(-4, Math.min(4, point[0])).toFixed(2)))} color="var(--accent-purple)" />}
            <MafsLaTeX at={[-4.2, rate(-4.2) + 0.7]} tex="f" color="var(--accent-color)" />
            <MafsLaTeX at={[3.8, accumulation(3.8) + 0.7]} tex="A" color="var(--accent-purple)" />
          </Mafs>
        </MafsStage>
      )}
    />
  );
}

function FunctionDerivativeScene(props: ConnectionSceneProps) {
  const authored = props.activeSceneData;
  const fixed = authored?.kind === 'function-derivative-link' ? authored : undefined;
  const [a, setA] = useState(1);
  const [c, setC] = useState(-3);
  const [x, setX] = useState(0);
  const values = props.mode === 'learn'
    ? { a: fixed?.a ?? 1, b: fixed?.b ?? 0, c: fixed?.c ?? -3, d: fixed?.d ?? 0, x: fixed?.x ?? 0 }
    : { a, b: 0, c, d: 0, x };
  const fn = (at: number) => values.a * at ** 3 + values.b * at ** 2 + values.c * at + values.d;
  const derivative = (at: number) => 3 * values.a * at ** 2 + 2 * values.b * at + values.c;
  const slope = derivative(values.x);
  const show = props.mode === 'explore' || props.revealed;

  return (
    <SceneFrame
      {...props}
      controls={(
        <>
          <h3 style={{ margin: 0 }}>The graph’s slope and its derivative</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>Move x along both graphs. The green height f′(x) tells whether the blue graph is rising, falling or flat at that x-value.</p>
          {sliderGroup(<>
            <LabSliderInput id="fd-a" label="Cubic shape (a)" ariaLabel="Cubic coefficient" value={a} min={-2} max={2} step={0.25} onChange={setA} />
            <LabSliderInput id="fd-c" label="Linear term (c)" ariaLabel="Linear coefficient" value={c} min={-6} max={6} step={0.5} onChange={setC} />
            <LabSliderInput id="fd-x" label="Move along both graphs (x)" ariaLabel="Shared function derivative x" value={x} min={-3} max={3} step={0.1} onChange={setX} />
          </>)}
          {readout(<>
            Blue graph: f(x) = {a}x³ + {c}x<br />
            Green derivative: f′(x) = {3 * a}x² + {c}<br />
            <strong>At x = {x}, f′(x) = {slope.toFixed(3)} → the blue graph is {slope > 0.001 ? 'rising' : slope < -0.001 ? 'falling' : 'flat (stationary)'}</strong>
          </>)}
        </>
      )}
      visual={(
        <MafsStage mafsHeight={props.mafsHeight} ariaLabel="Original function and derivative graph with shared x marker" interaction={props.mode === 'explore' ? 'explore' : 'static'}>
          <Mafs height={props.mafsHeight} viewBox={{ x: [-4, 4], y: [-10, 10] }} pan={props.mode === 'explore'} zoom={props.mode === 'explore' ? { min: 0.5, max: 3 } : false}>
            <Coordinates.Cartesian />
            <Plot.OfX y={fn} color="var(--accent-color)" weight={3} />
            <Plot.OfX y={derivative} color="var(--success)" style="dashed" weight={3} />
            {show && <Point x={values.x} y={fn(values.x)} color="var(--accent-color)" />}
            {show && <Point x={values.x} y={slope} color="var(--success)" />}
            <Line.Segment point1={[values.x, -10]} point2={[values.x, 10]} color="var(--text-secondary)" style="dashed" weight={1} />
            {props.mode === 'explore' && <MovablePoint point={[values.x, fn(values.x)]} onMove={(point) => setX(Number(Math.max(-3, Math.min(3, point[0])).toFixed(2)))} color="var(--accent-color)" />}
            <MafsLaTeX at={[-3.5, fn(-3.5)]} tex="f" color="var(--accent-color)" />
            <MafsLaTeX at={[2.7, derivative(2.7)]} tex="f'" color="var(--success)" />
          </Mafs>
        </MafsStage>
      )}
    />
  );
}

function deterministicUniform(repetition: number, draw: number): number {
  // Hash the sample and observation indices into a stable pseudo-random value.
  // Keeping each sample's stream separate makes changing n behave like adding
  // observations to the same repeated samples rather than replacing them.
  let value = Math.imul(repetition + 1, 0x9e3779b1) ^ Math.imul(draw + 1, 0x85ebca6b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4_294_967_296;
}

function samplingProportions(p: number, sampleSize: number, repetitions: number): number[] {
  return Array.from({ length: repetitions }, (_, repetition) => {
    let successes = 0;
    for (let draw = 0; draw < sampleSize; draw++) {
      if (deterministicUniform(repetition, draw) < p) successes++;
    }
    return successes / sampleSize;
  });
}

function SamplingDistributionScene(props: ConnectionSceneProps) {
  const authored = props.activeSceneData;
  const fixed = authored?.kind === 'sampling-distribution' ? authored : undefined;
  const [p, setP] = useState(0.5);
  const [sampleSize, setSampleSize] = useState(25);
  const [repetitions, setRepetitions] = useState(80);
  const values = props.mode === 'learn'
    ? { p: fixed?.p ?? 0.5, sampleSize: fixed?.sampleSize ?? 25, repetitions: fixed?.repetitions ?? 80 }
    : { p, sampleSize: Math.round(sampleSize), repetitions: Math.round(repetitions) };
  const proportions = useMemo(() => samplingProportions(values.p, values.sampleSize, values.repetitions), [values.p, values.sampleSize, values.repetitions]);
  const standardError = Math.sqrt((values.p * (1 - values.p)) / values.sampleSize);
  const margin = 1.96 * standardError;
  const stacks = new Map<number, number>();
  const points = proportions.map((proportion) => {
    const bucket = Math.round(proportion * 40) / 40;
    const stack = stacks.get(bucket) ?? 0;
    stacks.set(bucket, stack + 1);
    return [bucket, stack + 1] as [number, number];
  });
  const maxStack = Math.max(4, ...points.map((point) => point[1]));
  const show = props.mode === 'explore' || props.revealed;

  return (
    <SceneFrame
      {...props}
      controls={(
        <>
          <h3 style={{ margin: 0 }}>Why larger samples vary less</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>Each dot is one sample’s proportion (p-hat). Increase n and watch the dots bunch closer to the true population proportion p.</p>
          {sliderGroup(<>
            <LabSliderInput id="sampling-p" label="True population proportion (p)" ariaLabel="Population proportion" value={p} min={0.1} max={0.9} step={0.05} onChange={setP} />
            <LabSliderInput id="sampling-n" label="Observations in each sample (n)" ariaLabel="Sampling distribution sample size" value={sampleSize} min={10} max={200} step={5} onChange={setSampleSize} decimals={0} />
            <LabSliderInput id="sampling-r" label="Number of samples" ariaLabel="Sampling distribution repetitions" value={repetitions} min={20} max={120} step={10} onChange={setRepetitions} decimals={0} />
          </>)}
          {readout(<>
            True proportion: p = {p.toFixed(2)}<br />
            Typical sample-to-sample spread (standard error): {standardError.toFixed(4)}<br />
            <strong>Approximate range containing 95% of sample proportions: [{Math.max(0, p - margin).toFixed(3)}, {Math.min(1, p + margin).toFixed(3)}]</strong>
          </>)}
        </>
      )}
      visual={(
        <MafsStage mafsHeight={props.mafsHeight} ariaLabel="Sampling distribution of sample proportions" interaction="static">
          <Mafs height={props.mafsHeight} viewBox={{ x: [-0.05, 1.05], y: [-1, maxStack + 3], padding: 0 }} preserveAspectRatio={false} pan={false} zoom={false}>
            <Coordinates.Cartesian
              xAxis={{ lines: 0.1, labels: (value) => value.toFixed(1) }}
              yAxis={{ lines: 2, labels: (value) => String(Math.round(value)) }}
              subdivisions={1}
            />
            {points.map((point, index) => <Point key={`${point[0]}-${point[1]}-${index}`} x={point[0]} y={point[1]} color="var(--accent-color)" />)}
            <Line.Segment point1={[values.p, 0]} point2={[values.p, maxStack + 1]} color="var(--success)" weight={2} />
            {show && <Line.Segment point1={[Math.max(0, values.p - margin), -0.5]} point2={[Math.min(1, values.p + margin), -0.5]} color="var(--accent-purple)" weight={5} />}
            {show && <MafsLaTeX at={[values.p, maxStack + 2]} tex={`SE=${standardError.toFixed(3)}`} color="var(--success)" />}
          </Mafs>
        </MafsStage>
      )}
    />
  );
}

function TrigConnectionsScene(props: ConnectionSceneProps) {
  const authored = props.activeSceneData;
  const fixed = authored?.kind === 'trig-connections' ? authored : undefined;
  const [angleDeg, setAngleDeg] = useState(30);
  const [amplitude, setAmplitude] = useState(1);
  const [phaseDeg, setPhaseDeg] = useState(0);
  const values = props.mode === 'learn'
    ? { angleDeg: fixed?.angleDeg ?? 30, amplitude: fixed?.amplitude ?? 1, phaseDeg: fixed?.phaseDeg ?? 0 }
    : { angleDeg, amplitude, phaseDeg };
  const theta = (values.angleDeg * Math.PI) / 180;
  const phase = (values.phaseDeg * Math.PI) / 180;
  const circlePoint: [number, number] = [-3 + Math.cos(theta), Math.sin(theta)];
  const graphX = theta + phase;
  const graphY = values.amplitude * Math.sin(theta);
  const show = props.mode === 'explore' || props.revealed;

  return (
    <SceneFrame
      {...props}
      controls={(
        <>
          <h3 style={{ margin: 0 }}>A circle point becomes a sine wave</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>As the point rotates, its height becomes the sine value. Amplitude changes the wave’s height; phase shift moves it left or right.</p>
          {sliderGroup(<>
            <LabSliderInput id="trig-angle" label="Rotation angle (θ)" ariaLabel="Unit circle angle in degrees" value={angleDeg} min={0} max={360} step={5} onChange={setAngleDeg} valueSuffix="°" decimals={0} />
            <LabSliderInput id="trig-amplitude" label="Wave height (amplitude A)" ariaLabel="Sine graph amplitude" value={amplitude} min={0.5} max={3} step={0.25} onChange={setAmplitude} />
            <LabSliderInput id="trig-phase" label="Move wave left or right (phase h)" ariaLabel="Sine graph phase shift in degrees" value={phaseDeg} min={-180} max={180} step={15} onChange={setPhaseDeg} valueSuffix="°" decimals={0} />
          </>)}
          {readout(<>
            Circle point: (cos θ, sin θ) = ({Math.cos((angleDeg * Math.PI) / 180).toFixed(3)}, {Math.sin((angleDeg * Math.PI) / 180).toFixed(3)})<br />
            <strong>Wave: y = {amplitude} sin(x − {phaseDeg}°), with heights from {-amplitude} to {amplitude}</strong>
          </>)}
        </>
      )}
      visual={(
        <MafsStage mafsHeight={props.mafsHeight} ariaLabel="Unit circle linked to transformed sine graph" interaction="static">
          <Mafs height={props.mafsHeight} viewBox={{ x: [-5, 8], y: [-4, 4] }} pan={false} zoom={false}>
            <Coordinates.Cartesian />
            <Circle center={[-3, 0]} radius={1} color="var(--text-secondary)" />
            <Line.Segment point1={[-3, 0]} point2={circlePoint} color="var(--accent-color)" weight={3} />
            <Point x={circlePoint[0]} y={circlePoint[1]} color="var(--accent-color)" />
            <Plot.OfX y={(xValue) => xValue >= -0.5 && xValue <= 7.5 ? values.amplitude * Math.sin(xValue - phase) : NaN} color="var(--success)" weight={3} />
            {show && <Point x={graphX} y={graphY} color="var(--accent-purple)" />}
            {show && <Line.Segment point1={[circlePoint[0], circlePoint[1]]} point2={[graphX, graphY]} color="var(--accent-purple)" style="dashed" weight={1} />}
            <MafsLaTeX at={[-3, -1.5]} tex={`\\theta=${values.angleDeg}^{\\circ}`} color="var(--accent-color)" />
          </Mafs>
        </MafsStage>
      )}
    />
  );
}

function multiplyComplex(z: [number, number], w: [number, number]): [number, number] {
  return [z[0] * w[0] - z[1] * w[1], z[0] * w[1] + z[1] * w[0]];
}

function complexModulus(z: [number, number]): number {
  return Math.hypot(z[0], z[1]);
}

function complexArgument(z: [number, number]): number {
  return (Math.atan2(z[1], z[0]) * 180) / Math.PI;
}

function ComplexMultiplicationScene(props: ConnectionSceneProps) {
  const authored = props.activeSceneData;
  const fixed = authored?.kind === 'complex-multiplication' ? authored : undefined;
  const [zr, setZr] = useState(2);
  const [zi, setZi] = useState(1);
  const [wr, setWr] = useState(1);
  const [wi, setWi] = useState(1);
  const z: [number, number] = props.mode === 'learn' ? fixed?.z ?? [1, 1] : [zr, zi];
  const w: [number, number] = props.mode === 'learn' ? fixed?.w ?? [1, 1] : [wr, wi];
  const product = multiplyComplex(z, w);
  const show = props.mode === 'explore' || props.revealed;

  return (
    <SceneFrame
      {...props}
      controls={(
        <>
          <h3 style={{ margin: 0 }}>Complex multiplication turns and stretches</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>Multiplying z by w turns z through the direction angle of w and stretches its distance from the origin by |w|.</p>
          {sliderGroup(<>
            <LabSliderInput id="complex-zr" label="Horizontal part of z (Re z)" ariaLabel="Complex z real part" value={zr} min={-4} max={4} step={0.5} onChange={setZr} />
            <LabSliderInput id="complex-zi" label="Vertical part of z (Im z)" ariaLabel="Complex z imaginary part" value={zi} min={-4} max={4} step={0.5} onChange={setZi} />
            <LabSliderInput id="complex-wr" label="Horizontal part of w (Re w)" ariaLabel="Complex multiplier real part" value={wr} min={-3} max={3} step={0.5} onChange={setWr} />
            <LabSliderInput id="complex-wi" label="Vertical part of w (Im w)" ariaLabel="Complex multiplier imaginary part" value={wi} min={-3} max={3} step={0.5} onChange={setWi} />
          </>)}
          {readout(<>
            Starting number: z = {zr} + {zi}i · Multiplier: w = {wr} + {wi}i<br />
            Result: zw = {product[0].toFixed(2)} + {product[1].toFixed(2)}i<br />
            <strong>Stretch factor |w| = {complexModulus(w).toFixed(3)} · Turn angle arg(w) = {complexArgument(w).toFixed(1)}°</strong>
          </>)}
        </>
      )}
      visual={(
        <MafsStage mafsHeight={props.mafsHeight} ariaLabel="Argand diagram showing complex multiplication as rotation and scale" interaction="static">
          <Mafs height={props.mafsHeight} viewBox={{ x: [-8, 8], y: [-8, 8] }} pan={false} zoom={false}>
            <Coordinates.Cartesian xAxis={{ labels: (value) => `${value}` }} yAxis={{ labels: (value) => `${value}i` }} />
            <Vector tail={[0, 0]} tip={z} color="var(--accent-color)" weight={3} />
            <Point x={z[0]} y={z[1]} color="var(--accent-color)" />
            <Vector tail={[0, 0]} tip={w} color="var(--text-secondary)" weight={2} />
            {show && <Vector tail={[0, 0]} tip={product} color="var(--success)" weight={3} />}
            {show && <Point x={product[0]} y={product[1]} color="var(--success)" />}
            <MafsLaTeX at={[z[0] + 0.5, z[1] + 0.5]} tex="z" color="var(--accent-color)" />
            <MafsLaTeX at={[w[0] + 0.5, w[1] + 0.5]} tex="w" color="var(--text-secondary)" />
            {show && <MafsLaTeX at={[product[0] + 0.6, product[1] + 0.5]} tex="zw" color="var(--success)" />}
          </Mafs>
        </MafsStage>
      )}
    />
  );
}
