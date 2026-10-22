'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Mafs, Coordinates, Line, MovablePoint, Point, Polygon, Plot, Transform, LaTeX as MafsLaTeX } from 'mafs';
import { RefreshCw, HelpCircle } from 'lucide-react';
import { formatValueLaTeX } from '../../lib/math-utils';
import { LaTeX, BlockLaTeX } from './MathLabCommon';
import MafsStage from './MafsStage';
import LearnPanel from './LearnPanel';
import { useLabVariant } from '../../lib/use-lab-variant';
import GeometryExtensionsLab from './GeometryExtensionsLab';
import ConceptConnectionsLab from './ConceptConnectionsLab';
import TryItCard from './TryItCard';
import LabSceneLayout from './LabSceneLayout';
import LabControlCard from './LabControlCard';
import LabSliderInput from './LabSliderInput';
import { LAB_ACTIVITIES, type LabActivityId } from '../../lib/lab-activities';
import { getExplorePrompts } from '../../lib/lab-explore-prompts';
import LabNumberInput from '../lab-shared/LabNumberInput';

type GeometryTransType = 'reflect_x' | 'reflect_y' | 'reflect_line' | 'translate' | 'rotate' | 'enlarge';
type GeometryExploreTopic =
  | 'transformations'
  | 'geometry-angle-reasoning'
  | 'geometry-circle-scaling'
  | 'geometry-pythagoras'
  | 'geometry-sohcahtoa'
  | 'geometry-unit-circle'
  | 'geometry-trig-connections'
  | 'geometry-similarity-ratio';

interface GeometryTabProps {
  isExact: boolean;
  mafsHeight: number;
  mode?: 'explore' | 'learn';
  activityId?: LabActivityId;
  onActivityComplete?: (activityId: string, success: boolean) => void;
  onExitLearn?: () => void;
}

export default function GeometryTab({ isExact, mafsHeight, mode = 'explore', activityId, onActivityComplete, onExitLearn }: GeometryTabProps) {
  const [exploreTopic, setExploreTopic] = useState<GeometryExploreTopic>('transformations');
  const [ptA, setPtA] = useState<[number, number]>([-3, 1]);
  const [ptB, setPtB] = useState<[number, number]>([-1, 4]);
  const [ptC, setPtC] = useState<[number, number]>([-4, 3]);
  const [geomTrans, setGeomTrans] = useState<GeometryTransType>('reflect_y');
  const [dx, setDx] = useState<number>(3);
  const [dy, setDy] = useState<number>(1);
  const [rotAngle, setRotAngle] = useState<number>(90);
  const [mirrorM, setMirrorM] = useState<number>(1);
  const [mirrorC, setMirrorC] = useState<number>(0);
  // P3: Enlargement state
  const [scaleFactor, setScaleFactor] = useState<number>(2);
  const [enlargeCentre, setEnlargeCentre] = useState<[number, number]>([0, 0]);
  const [learnRevealed, setLearnRevealed] = useState(false);
  const [learnStep, setLearnStep] = useState(0);
  const variant = useLabVariant(activityId);

  // Sync explore topic with activityId for explore deep links
  useEffect(() => {
    if (activityId) {
      const geoTopics: GeometryExploreTopic[] = [
        'geometry-angle-reasoning',
        'geometry-circle-scaling',
        'geometry-pythagoras',
        'geometry-sohcahtoa',
        'geometry-unit-circle',
        'geometry-trig-connections',
        'geometry-similarity-ratio',
      ];
      if (geoTopics.includes(activityId as GeometryExploreTopic)) {
        setExploreTopic(activityId as GeometryExploreTopic);
      }
    }
  }, [mode, activityId]);

  useEffect(() => {
    setLearnRevealed(false);
    let source: [number, number] = [3, 5];

    // A variant supplies the exact point and transformation the prompt states;
    // the literals below are the authored fallback.
    const sd = variant.getSceneData(learnStep);
    if (sd && sd.kind === 'transform-point') {
      source = sd.source;
      setGeomTrans(sd.transform);
      if (sd.angleDeg !== undefined) setRotAngle(sd.angleDeg);
      if (sd.scaleFactor !== undefined) setScaleFactor(sd.scaleFactor);
      if (sd.centre !== undefined) setEnlargeCentre(sd.centre);
    } else if (activityId === 'geometry-reflect-predict') {
      const sources: [number, number][] = [[3, 5], [-2, 4], [1, -3]];
      source = sources[learnStep] ?? sources[0];
      setGeomTrans(learnStep === 0 ? 'reflect_x' : 'reflect_y');
    } else if (activityId === 'geometry-rotation-image') {
      const sources: [number, number][] = [[1, 0], [2, 3], [0, 4]];
      const angles = [90, 180, 270];
      source = sources[learnStep] ?? sources[0];
      setGeomTrans('rotate');
      setRotAngle(angles[learnStep] ?? angles[0]);
    } else if (activityId === 'geometry-enlarge-predict') {
      const sources: [number, number][] = [[2, 1], [3, 2], [4, 0]];
      const factors = [2, 3, 0.5];
      const centres: [number, number][] = [[0, 0], [1, 1], [0, 0]];
      source = sources[learnStep] ?? sources[0];
      setGeomTrans('enlarge');
      setScaleFactor(factors[learnStep] ?? factors[0]);
      setEnlargeCentre(centres[learnStep] ?? centres[0]);
    }

    // These Learn activities ask about a single point, so only P is positioned.
    // The Explore triangle keeps its own vertices.
    if (activityId?.startsWith('geometry-')) {
      setPtA(source);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, learnStep, variant.variantSeed]);

  // Mapping formula calculations
  const geometryRuleText = useMemo(() => {
    switch (geomTrans) {
      case 'reflect_x':
        return { rule: '(x, y) \\rightarrow (x, -y)', desc: 'Reflecting across the X-axis negates the vertical coordinate.' };
      case 'reflect_y':
        return { rule: '(x, y) \\rightarrow (-x, y)', desc: 'Reflecting across the Y-axis negates the horizontal coordinate.' };
      case 'reflect_line': {
        const mirrorMLaTeX = formatValueLaTeX(mirrorM, isExact);
        const mirrorCLaTeX = formatValueLaTeX(mirrorC, isExact);
        let lineEq = '';
        if (mirrorM === 1) lineEq = 'x';
        else if (mirrorM === -1) lineEq = '-x';
        else if (mirrorM !== 0) lineEq = `${mirrorMLaTeX}x`;
        
        if (mirrorC > 0) lineEq += ` + ${mirrorCLaTeX}`;
        else if (mirrorC < 0) lineEq += ` - ${formatValueLaTeX(Math.abs(mirrorC), isExact)}`;
        
        if (!lineEq) lineEq = '0';
        return { rule: `\\text{Reflection across } y = ${lineEq}`, desc: 'Maps points across an arbitrary line.' };
      }
      case 'translate': {
        const dxSign = dx >= 0 ? `+ ${formatValueLaTeX(dx, isExact)}` : `- ${formatValueLaTeX(Math.abs(dx), isExact)}`;
        const dySign = dy >= 0 ? `+ ${formatValueLaTeX(dy, isExact)}` : `- ${formatValueLaTeX(Math.abs(dy), isExact)}`;
        return { rule: `(x, y) \\rightarrow (x ${dxSign}, y ${dySign})`, desc: 'Translation slides all points by a fixed distance/direction.' };
      }
      case 'rotate':
        return {
          rule: `\\text{Rotation by } ${rotAngle}^\\circ \\text{ around } (0,0)`,
          desc: rotAngle === 90 ? '(x, y) → (-y, x)' : rotAngle === 180 ? '(x, y) → (-x, -y)' : rotAngle === 270 ? '(x, y) → (y, -x)' : 'Formula: (x·cosθ - y·sinθ, x·sinθ + y·cosθ)'
        };
      case 'enlarge': {
        const kVal = formatValueLaTeX(scaleFactor, isExact);
        const cxVal = formatValueLaTeX(enlargeCentre[0], isExact);
        const cyVal = formatValueLaTeX(enlargeCentre[1], isExact);
        return {
          rule: `\\text{Enlargement, } k = ${kVal} \\text{ from } (${cxVal}, ${cyVal})`,
          desc: `P' = C + k(P - C). Each point moves ${scaleFactor > 1 ? 'further from' : 'closer to'} the centre.`,
        };
      }
      default:
        return { rule: '', desc: '' };
    }
  }, [geomTrans, dx, dy, rotAngle, mirrorM, mirrorC, isExact, scaleFactor, enlargeCentre]);

  // Geometry image point transformations — wrapped in useCallback for stable reference
  const transformPoint = useCallback((p: [number, number]): [number, number] => {
    const [x, y] = p;
    switch (geomTrans) {
      case 'reflect_x':
        return [x, -y];
      case 'reflect_y':
        return [-x, y];
      case 'reflect_line': {
        const m2 = mirrorM * mirrorM;
        const den = 1 + m2;
        const nx = ((1 - m2) / den) * x + ((2 * mirrorM) / den) * y - ((2 * mirrorM * mirrorC) / den);
        const ny = ((2 * mirrorM) / den) * x - ((1 - m2) / den) * y + ((2 * mirrorC) / den);
        return [parseFloat(nx.toFixed(2)), parseFloat(ny.toFixed(2))];
      }
      case 'translate':
        return [x + dx, y + dy];
      case 'rotate': {
        const rad = (rotAngle * Math.PI) / 180;
        const rx = x * Math.cos(rad) - y * Math.sin(rad);
        const ry = x * Math.sin(rad) + y * Math.cos(rad);
        return [parseFloat(rx.toFixed(2)), parseFloat(ry.toFixed(2))];
      }
      case 'enlarge': {
        const [cx, cy] = enlargeCentre;
        const nx = cx + scaleFactor * (x - cx);
        const ny = cy + scaleFactor * (y - cy);
        return [parseFloat(nx.toFixed(2)), parseFloat(ny.toFixed(2))];
      }
      default:
        return [x, y];
    }
  }, [geomTrans, dx, dy, rotAngle, mirrorM, mirrorC, scaleFactor, enlargeCentre]);

  const ptA_prime = useMemo(() => transformPoint(ptA), [ptA, transformPoint]);
  const ptB_prime = useMemo(() => transformPoint(ptB), [ptB, transformPoint]);
  const ptC_prime = useMemo(() => transformPoint(ptC), [ptC, transformPoint]);

  const exploreTopicSelector = (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
      Explore topic
      <select
        aria-label="Geometry explore topic"
        value={exploreTopic}
        onChange={(event) => setExploreTopic(event.target.value as GeometryExploreTopic)}
        style={{
          padding: '9px 10px',
          borderRadius: '7px',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
        }}
      >
        <option value="transformations">Transformations</option>
        <option value="geometry-circle-scaling">Circle scaling</option>
        <option value="geometry-pythagoras">Pythagoras</option>
        <option value="geometry-sohcahtoa">SOHCAHTOA</option>
        <option value="geometry-unit-circle">Unit circle</option>
        <option value="geometry-trig-connections">Unit circle to sine wave</option>
        <option value="geometry-angle-reasoning">Angle Reasoning</option>
        <option value="geometry-similarity-ratio">Similarity & Congruence</option>
      </select>
    </label>
  );

  // Learn mode
  const learnActivity = activityId ? LAB_ACTIVITIES[activityId] : undefined;
  const isTrigConnection = activityId === 'geometry-trig-connections'
    || (mode === 'explore' && exploreTopic === 'geometry-trig-connections');
  if (isTrigConnection && (mode === 'explore' || (learnActivity && onExitLearn && onActivityComplete))) {
    return (
      <ConceptConnectionsLab
        activity={LAB_ACTIVITIES['geometry-trig-connections']}
        mafsHeight={mafsHeight}
        mode={mode}
        topicSelector={exploreTopicSelector}
        onComplete={onActivityComplete ?? (() => undefined)}
        onExit={onExitLearn ?? (() => undefined)}
      />
    );
  }
  if (
    mode === 'learn' &&
    learnActivity &&
    onExitLearn &&
    onActivityComplete &&
    (activityId === 'geometry-angle-reasoning' ||
      activityId === 'geometry-circle-scaling' ||
      activityId === 'geometry-pythagoras' ||
      activityId === 'geometry-sohcahtoa' ||
      activityId === 'geometry-unit-circle' ||
      activityId === 'geometry-similarity-ratio')
  ) {
    return (
      <GeometryExtensionsLab
        key={learnActivity.id}
        activity={learnActivity}
        mafsHeight={mafsHeight}
        onComplete={onActivityComplete}
        onExit={onExitLearn}
      />
    );
  }

  if (mode === 'learn' && learnActivity && onExitLearn && onActivityComplete) {
    return (
      <LabSceneLayout
        control={
          <LearnPanel
            key={learnActivity.id}
            activity={learnActivity}
            onComplete={onActivityComplete}
            onExit={onExitLearn}
            onRevealChange={setLearnRevealed}
            onStepChange={setLearnStep}
            {...variant.learnPanelProps}
          />
        }
        visual={
          <>
            <MafsStage
              mafsHeight={mafsHeight}
              ariaLabel="Geometry transformation for the current learning activity"
              interaction="static"
              footer={learnRevealed ? (
                <fieldset className="glass-panel" style={{ padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                  <legend style={{ fontSize: '12px', fontWeight: 700 }}>Explore transformation</legend>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Drag P{geomTrans === 'enlarge' ? ' or the centre' : ''}, or use these keyboard-accessible inputs.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))', gap: '8px' }}>
                    <label style={{ fontSize: '11px' }}>P x<LabNumberInput aria-label="Learning geometry point P x-coordinate" step="0.5" value={ptA[0]} onChange={(event) => setPtA([Number(event.target.value), ptA[1]])} style={{ width: '100%', display: 'block' }} /></label>
                    <label style={{ fontSize: '11px' }}>P y<LabNumberInput aria-label="Learning geometry point P y-coordinate" step="0.5" value={ptA[1]} onChange={(event) => setPtA([ptA[0], Number(event.target.value)])} style={{ width: '100%', display: 'block' }} /></label>
                    {geomTrans === 'enlarge' && (
                      <>
                        <label style={{ fontSize: '11px' }}>Centre x<LabNumberInput aria-label="Enlargement centre x-coordinate" step="0.5" value={enlargeCentre[0]} onChange={(event) => setEnlargeCentre([Number(event.target.value), enlargeCentre[1]])} style={{ width: '100%', display: 'block' }} /></label>
                        <label style={{ fontSize: '11px' }}>Centre y<LabNumberInput aria-label="Enlargement centre y-coordinate" step="0.5" value={enlargeCentre[1]} onChange={(event) => setEnlargeCentre([enlargeCentre[0], Number(event.target.value)])} style={{ width: '100%', display: 'block' }} /></label>
                        <label style={{ fontSize: '11px' }}>Scale factor<LabNumberInput aria-label="Enlargement scale factor" step="0.5" value={scaleFactor} onChange={(event) => setScaleFactor(Number(event.target.value))} style={{ width: '100%', display: 'block' }} /></label>
                      </>
                    )}
                  </div>
                </fieldset>
              ) : undefined}
            >
              <Mafs
                height={mafsHeight}
                viewBox={{ x: [-10, 10] as [number, number], y: [-8, 8] as [number, number] }}
                pan={false}
                zoom={false}
              >
                <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: 1 }} subdivisions={2} />
                {/* The prompt names one point, so the canvas shows one point. */}
                {!learnRevealed && <Point x={ptA[0]} y={ptA[1]} color="var(--accent-color)" />}
                <MafsLaTeX at={[ptA[0] - 0.3, ptA[1] - 0.3]} tex={`P\\,(${ptA[0]},\\,${ptA[1]})`} color="var(--accent-color)" />

                {geomTrans === 'enlarge' && (
                  <>
                    {learnRevealed ? (
                      <MovablePoint point={enlargeCentre} onMove={(point) => setEnlargeCentre([Number(point[0].toFixed(1)), Number(point[1].toFixed(1))])} color="var(--success)" />
                    ) : (
                      <Point x={enlargeCentre[0]} y={enlargeCentre[1]} color="var(--success)" />
                    )}
                    <MafsLaTeX at={[enlargeCentre[0] - 2.8, enlargeCentre[1] - 2.4]} tex={`\\text{Centre}\\,(${enlargeCentre[0]},\\,${enlargeCentre[1]})`} color="var(--success)" />
                  </>
                )}

                {learnRevealed && (
                  <>
                    <Line.Segment point1={ptA} point2={ptA_prime} color="var(--text-secondary)" style="dashed" />
                    <Point x={ptA_prime[0]} y={ptA_prime[1]} color="var(--text-secondary)" />
                    <MovablePoint point={ptA} onMove={(coords) => setPtA([Number(coords[0].toFixed(1)), Number(coords[1].toFixed(1))])} color="var(--accent-color)" />
                    <MafsLaTeX at={[ptA_prime[0] + 0.3, ptA_prime[1] + 0.3]} tex={`P'\\,(${ptA_prime[0]},\\,${ptA_prime[1]})`} color="var(--text-secondary)" />
                  </>
                )}
              </Mafs>
            </MafsStage>
            {!learnRevealed && (
              <div className="lab-visual-info glass-panel" aria-live="polite" style={{ padding: '10px 14px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Predict the image first. The transformed image and coordinates are hidden until you submit.
              </div>
            )}
          </>
        }
      />
    );
  }

  if (mode === 'explore' && exploreTopic !== 'transformations') {
    return (
        <GeometryExtensionsLab
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
            <RefreshCw size={18} color="var(--accent-color)" /> Geometric Transformations
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            Drag the vertices <strong>A, B, C</strong> of the primary triangle. Select a transformation below to see its image shape <strong>A′, B′, C′</strong> render in muted dashed styling.
          </p>
        </div>

        {/* Transformation type selector */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
            Transformation Type
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {[
              { id: 'reflect_y', label: 'Reflect Y-Axis' },
              { id: 'reflect_x', label: 'Reflect X-Axis' },
              { id: 'reflect_line', label: 'Reflect y = mx + c' },
              { id: 'translate', label: 'Translation' },
              { id: 'rotate', label: 'Rotation' },
              { id: 'enlarge', label: 'Enlargement' }
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setGeomTrans(t.id as GeometryTransType)}
                style={{
                  padding: '8px',
                  fontSize: '12px',
                  fontWeight: '600',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: '1px solid var(--border-color)',
                  background: geomTrans === t.id ? 'var(--accent-color)' : 'var(--bg-secondary)',
                  color: geomTrans === t.id ? 'white' : 'var(--text-primary)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Rule readouts */}
        <div style={{ background: 'var(--bg-secondary)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600', marginBottom: '4px' }}>Mapping Formula</div>
          <div style={{ fontSize: '16px', fontWeight: '800', color: 'var(--accent-color)', display: 'flex', alignItems: 'center' }}>
            <BlockLaTeX math={geometryRuleText.rule} />
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
            {geometryRuleText.desc}
          </div>
        </div>

        {geomTrans === 'translate' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <LabSliderInput
              id="geom-dx"
              label="Horizontal Shift (dx)"
              ariaLabel="Translation horizontal shift"
              value={dx}
              min={-5}
              max={5}
              step={1}
              onChange={(v) => setDx(v)}
              decimals={0}
            />
            <LabSliderInput
              id="geom-dy"
              label="Vertical Shift (dy)"
              ariaLabel="Translation vertical shift"
              value={dy}
              min={-5}
              max={5}
              step={1}
              onChange={(v) => setDy(v)}
              decimals={0}
            />
          </div>
        )}

        {geomTrans === 'reflect_line' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <LabSliderInput
              id="geom-mirror-m"
              label="Slope (m)"
              ariaLabel="Mirror line slope"
              value={mirrorM}
              min={-3}
              max={3}
              step={0.5}
              onChange={(v) => setMirrorM(v)}
            />
            <LabSliderInput
              id="geom-mirror-c"
              label="Y-Intercept (c)"
              ariaLabel="Mirror line y-intercept"
              value={mirrorC}
              min={-5}
              max={5}
              step={1}
              onChange={(v) => setMirrorC(v)}
              decimals={0}
            />
          </div>
        )}

        {geomTrans === 'rotate' && (
          <div>
            {/* Discrete angle preset buttons — not a slider+value; kept as buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '700', marginBottom: '8px' }}>
              <span>Rotation Angle = {rotAngle}°</span>
            </div>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
              {[90, 180, 270, 360].map((deg) => (
                <button
                  key={deg}
                  onClick={() => setRotAngle(deg)}
                  style={{
                    flex: 1,
                    padding: '6px',
                    fontSize: '11px',
                    fontWeight: '700',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: rotAngle === deg ? 'var(--accent-purple)' : 'var(--bg-secondary)',
                    color: rotAngle === deg ? 'white' : 'var(--text-primary)',
                    cursor: 'pointer'
                  }}
                >
                  {deg}°
                </button>
              ))}
            </div>
            <LabSliderInput
              id="geom-rotate"
              label="Rotation Angle"
              ariaLabel="Rotation angle in degrees"
              value={rotAngle}
              min={0}
              max={360}
              step={15}
              onChange={(v) => setRotAngle(v)}
              valueSuffix="°"
              decimals={0}
            />
          </div>
        )}

        {geomTrans === 'enlarge' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <LabSliderInput
              id="geom-scale"
              label="Scale Factor (k)"
              ariaLabel="Enlargement scale factor"
              value={scaleFactor}
              min={0.5}
              max={3}
              step={0.25}
              onChange={(v) => setScaleFactor(v)}
              decimals={2}
            />
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Centre of enlargement: ({enlargeCentre[0]}, {enlargeCentre[1]}) — drag the ⊕ point on the grid.
            </div>
          </div>
        )}

        {/* Point coordinates list */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
          <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
            📊 Vertices Mapping:
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: '4px', alignItems: 'center' }}>
              <LaTeX math={`A(${formatValueLaTeX(ptA[0], isExact)}, ${formatValueLaTeX(ptA[1], isExact)})`} />
              <span style={{ color: 'var(--accent-color)', fontWeight: '700', margin: '0 8px' }}>→</span>
              <LaTeX math={`A'(${formatValueLaTeX(ptA_prime[0], isExact)}, ${formatValueLaTeX(ptA_prime[1], isExact)})`} style={{ color: 'var(--accent-color)', fontWeight: '700' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: '4px', alignItems: 'center' }}>
              <LaTeX math={`B(${formatValueLaTeX(ptB[0], isExact)}, ${formatValueLaTeX(ptB[1], isExact)})`} />
              <span style={{ color: 'var(--accent-color)', fontWeight: '700', margin: '0 8px' }}>→</span>
              <LaTeX math={`B'(${formatValueLaTeX(ptB_prime[0], isExact)}, ${formatValueLaTeX(ptB_prime[1], isExact)})`} style={{ color: 'var(--accent-color)', fontWeight: '700' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: '4px', alignItems: 'center' }}>
              <LaTeX math={`C(${formatValueLaTeX(ptC[0], isExact)}, ${formatValueLaTeX(ptC[1], isExact)})`} />
              <span style={{ color: 'var(--accent-color)', fontWeight: '700', margin: '0 8px' }}>→</span>
              <LaTeX math={`C'(${formatValueLaTeX(ptC_prime[0], isExact)}, ${formatValueLaTeX(ptC_prime[1], isExact)})`} style={{ color: 'var(--accent-color)', fontWeight: '700' }} />
            </div>
          </div>
        </div>

        <fieldset style={{ border: '1px solid var(--border-color)', borderRadius: '10px', padding: '10px 12px' }}>
          <legend style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>Triangle coordinates</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))', gap: '8px' }}>
            <label style={{ fontSize: '11px' }}>A x<LabNumberInput aria-label="Vertex A x-coordinate" step="0.5" value={ptA[0]} onChange={(event) => setPtA([Number(event.target.value), ptA[1]])} style={{ width: '100%', display: 'block' }} /></label>
            <label style={{ fontSize: '11px' }}>A y<LabNumberInput aria-label="Vertex A y-coordinate" step="0.5" value={ptA[1]} onChange={(event) => setPtA([ptA[0], Number(event.target.value)])} style={{ width: '100%', display: 'block' }} /></label>
            <label style={{ fontSize: '11px' }}>B x<LabNumberInput aria-label="Vertex B x-coordinate" step="0.5" value={ptB[0]} onChange={(event) => setPtB([Number(event.target.value), ptB[1]])} style={{ width: '100%', display: 'block' }} /></label>
            <label style={{ fontSize: '11px' }}>B y<LabNumberInput aria-label="Vertex B y-coordinate" step="0.5" value={ptB[1]} onChange={(event) => setPtB([ptB[0], Number(event.target.value)])} style={{ width: '100%', display: 'block' }} /></label>
            <label style={{ fontSize: '11px' }}>C x<LabNumberInput aria-label="Vertex C x-coordinate" step="0.5" value={ptC[0]} onChange={(event) => setPtC([Number(event.target.value), ptC[1]])} style={{ width: '100%', display: 'block' }} /></label>
            <label style={{ fontSize: '11px' }}>C y<LabNumberInput aria-label="Vertex C y-coordinate" step="0.5" value={ptC[1]} onChange={(event) => setPtC([ptC[0], Number(event.target.value)])} style={{ width: '100%', display: 'block' }} /></label>
          </div>
        </fieldset>

        {/* General Info Alert */}
        <div style={{ display: 'flex', gap: '10px', background: 'rgba(99,102,241,0.04)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(99,102,241,0.1)', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
          <HelpCircle size={16} color="var(--accent-color)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            Drag vertices A, B, or C on the coordinate plane to modify the source triangle, and watch the target transformation react instantly.
          </span>
        </div>

        <TryItCard prompts={getExplorePrompts('geometry', exploreTopic !== 'transformations' ? exploreTopic : undefined)} />
      </LabControlCard>
      }
      visual={
      <MafsStage mafsHeight={mafsHeight} ariaLabel="Geometry coordinate plane with original and transformed shapes" interaction="explore">
        <Mafs
          height={mafsHeight}
          viewBox={{
            x: [-14, 14] as [number, number],
            y: [-14, 14] as [number, number]
          }}
          pan={true}
          zoom={{ min: 0.5, max: 4 }}
        >
          <Coordinates.Cartesian xAxis={{ lines: 2 }} yAxis={{ lines: 2 }} subdivisions={2} />

          {geomTrans === 'reflect_line' && (
            <Plot.OfX y={(x) => mirrorM * x + mirrorC} color="var(--accent-color)" style="dashed" weight={1} />
          )}

          {geomTrans === 'enlarge' && (
            <MovablePoint
              point={enlargeCentre}
              onMove={(coords) => setEnlargeCentre([Math.round(coords[0]), Math.round(coords[1])])}
              color="var(--success)"
            />
          )}

          <Polygon points={[ptA, ptB, ptC]} color="var(--accent-color)" svgPolygonProps={{ fillOpacity: 0.1 }} />
          {geomTrans === 'enlarge' ? (
            <Transform
              matrix={[
                scaleFactor, 0, enlargeCentre[0] * (1 - scaleFactor),
                0, scaleFactor, enlargeCentre[1] * (1 - scaleFactor),
              ]}
            >
              <Polygon points={[ptA, ptB, ptC]} color="var(--text-secondary)" svgPolygonProps={{ fillOpacity: 0.15, strokeDasharray: '4 4' }} />
            </Transform>
          ) : (
            <Polygon points={[ptA_prime, ptB_prime, ptC_prime]} color="var(--text-secondary)" svgPolygonProps={{ fillOpacity: 0.15, strokeDasharray: '4 4' }} />
          )}

          <MovablePoint point={ptA} onMove={(coords) => setPtA([Math.round(coords[0]), Math.round(coords[1])])} color="var(--accent-color)" />
          <MovablePoint point={ptB} onMove={(coords) => setPtB([Math.round(coords[0]), Math.round(coords[1])])} color="var(--accent-color)" />
          <MovablePoint point={ptC} onMove={(coords) => setPtC([Math.round(coords[0]), Math.round(coords[1])])} color="var(--accent-color)" />

          <g className="mafs-point-label mafs-point-label--sw">
            <MafsLaTeX at={ptA} tex="A" color="var(--accent-color)" />
          </g>
          <g className="mafs-point-label mafs-point-label--se">
            <MafsLaTeX at={ptB} tex="B" color="var(--accent-color)" />
          </g>
          <g className="mafs-point-label mafs-point-label--nw">
            <MafsLaTeX at={ptC} tex="C" color="var(--accent-color)" />
          </g>
          <g className="mafs-point-label mafs-point-label--ne">
            <MafsLaTeX at={ptA_prime} tex="A'" color="var(--text-secondary)" />
          </g>
          <g className="mafs-point-label mafs-point-label--sw">
            <MafsLaTeX at={[ptB_prime[0] - 0.7, ptB_prime[1]]} tex="B'" color="var(--text-secondary)" />
          </g>
          <g className="mafs-point-label mafs-point-label--se">
            <MafsLaTeX at={ptC_prime} tex="C'" color="var(--text-secondary)" />
          </g>
        </Mafs>
      </MafsStage>
      }
    />
  );
}
