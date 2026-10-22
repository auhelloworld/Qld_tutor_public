'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mafs, Coordinates, MovablePoint, Point, Plot, LaTeX as MafsLaTeX } from 'mafs';
import { Copy, Sliders, HelpCircle, AlertCircle } from 'lucide-react';
import * as math from 'mathjs';
import {
  findRootsNumerical,
  findTurningPoints,
  formatValueLaTeX,
  formatValuePlain,
  averageSpeed,
} from '../../lib/math-utils';
import { BlockLaTeX } from './MathLabCommon';
import MafsStage from './MafsStage';
import LearnPanel from './LearnPanel';
import { useLabVariant } from '../../lib/use-lab-variant';
import LinearSystemsLab from './LinearSystemsLab';
import AdvancedCurvesLab from './AdvancedCurvesLab';
import ConceptConnectionsLab from './ConceptConnectionsLab';
import TryItCard from './TryItCard';
import LabSceneLayout from './LabSceneLayout';
import LabControlCard from './LabControlCard';
import LabSliderInput from './LabSliderInput';
import { LAB_ACTIVITIES, type LabActivityId } from '../../lib/lab-activities';
import { getExplorePrompts } from '../../lib/lab-explore-prompts';
import LabNumberInput from '../lab-shared/LabNumberInput';

type FunctionType = 'linear' | 'quadratic' | 'cubic' | 'exponential' | 'absolute' | 'sinusoidal' | 'logarithmic' | 'custom';
type SandboxExploreTopic = 'functions' | 'sandbox-piecewise-absolute' | 'sandbox-polar-curves' | 'sandbox-parametric-curves' | 'sandbox-distance-time';

interface SandboxTabProps {
  isExact: boolean;
  mafsHeight: number;
  preset?: string;
  mode?: 'explore' | 'learn';
  activityId?: LabActivityId;
  onActivityComplete?: (activityId: string, success: boolean) => void;
  onExitLearn?: () => void;
}

export default function SandboxTab({ isExact, mafsHeight, preset = '', mode = 'explore', activityId, onActivityComplete, onExitLearn }: SandboxTabProps) {
  const [exploreTopic, setExploreTopic] = useState<SandboxExploreTopic>('functions');
  const [funType, setFunType] = useState<FunctionType>(
    preset === 'quadratic_vertex' ? 'quadratic' : 'linear'
  );

  // Sync explore topic/funType from activityId in explore mode
  useEffect(() => {
    if (mode === 'explore' && activityId) {
      if (activityId === 'sandbox-piecewise-absolute') {
        setExploreTopic('sandbox-piecewise-absolute');
      } else if (activityId === 'sandbox-distance-time') {
        setExploreTopic('sandbox-distance-time');
      } else if (activityId === 'sandbox-polar-curves') {
        setExploreTopic('sandbox-polar-curves');
      } else if (activityId === 'sandbox-parametric-curves') {
        setExploreTopic('sandbox-parametric-curves');
      }
    }
  }, [mode, activityId]);

  // Linear coefficients (y = mx + c)
  const [m, setM] = useState<number>(1);
  const [c, setC] = useState<number>(0);

  // Quadratic coefficients (y = ax^2 + bx + c)
  const [a, setA] = useState<number>(preset === 'quadratic_vertex' ? 1 : 0.5);
  const [b, setB] = useState<number>(preset === 'quadratic_vertex' ? -4 : 0);
  const [qC, setQC] = useState<number>(preset === 'quadratic_vertex' ? 3 : 0);

  // Cubic coefficients
  const [cubA, setCubA] = useState<number>(0.5);
  const [cubB, setCubB] = useState<number>(0);
  const [cubC, setCubC] = useState<number>(-1.5);
  const [cubD, setCubD] = useState<number>(0);

  // Exponential coefficients (y = a * b^x + c)
  const [expA, setExpA] = useState<number>(1);
  const [expBase, setExpBase] = useState<number>(2);
  const [expC, setExpC] = useState<number>(0);

  // Absolute Value coefficients (y = a * |x - h| + k)
  const [absA, setAbsA] = useState<number>(1);
  const [absH, setAbsH] = useState<number>(0);
  const [absK, setAbsK] = useState<number>(0);

  // Sinusoidal coefficients
  const [amp, setAmp] = useState<number>(2);
  const [freq, setFreq] = useState<number>(1);
  const [phase, setPhase] = useState<number>(0);
  const [vShift, setVShift] = useState<number>(0);

  // Logarithmic coefficients (y = a * ln(x - h) + k)
  const [logA, setLogA] = useState<number>(1);
  const [logH, setLogH] = useState<number>(0);
  const [logK, setLogK] = useState<number>(0);

  // Custom Expression State
  const [customExpr, setCustomExpr] = useState<string>('x^2 - 3');

  // Snap/Trace Point state
  const [sandboxTraceX, setSandboxTraceX] = useState<number>(
    preset === 'quadratic_vertex' ? 2 : 0
  );
  const [copiedLabel, setCopiedLabel] = useState<string>('');
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [learnRevealed, setLearnRevealed] = useState(false);
  const [learnStep, setLearnStep] = useState(0);
  const variant = useLabVariant(activityId);
  const getVariantSceneData = variant.getSceneData;

  useEffect(() => {
    setLearnRevealed(false);
    // A variant supplies the exact numbers the prompt states, so prompt and
    // canvas cannot disagree. The literals below are the authored fallback.
    const sd = getVariantSceneData(learnStep);
    if (sd && sd.kind === 'exponential-plot') {
      if (sd.family === 'exponential') {
        setFunType('exponential');
        setExpA(sd.a);
        setExpBase(sd.base);
        setExpC(sd.c);
      } else {
        // y = log_b(x) is rendered as ln(x)/ln(b) by the shared evaluator.
        setFunType('logarithmic');
        setLogA(1 / Math.log(sd.base));
        setLogH(0);
        setLogK(sd.c);
      }
      setSandboxTraceX(1);
      return;
    }

    if (sd && sd.kind === 'function-plot') {
      setFunType(sd.funType);
      if (sd.funType === 'linear') {
        setM(sd.m ?? 1);
        setC(sd.c ?? 0);
      } else {
        setA(sd.a ?? 1);
        setB(sd.b ?? 0);
        setQC(sd.k ?? 0);
      }
      setSandboxTraceX(sd.traceX);
      return;
    }

    if (activityId === 'sandbox-gradient-effect') {
      setFunType('linear');
      setM(learnStep === 0 ? 2 : -1);
      setC(1);
      setSandboxTraceX(learnStep === 0 ? 3 : 0);
    } else if (activityId === 'sandbox-vertex-predict') {
      setFunType('quadratic');
      setA(1);
      setB(-4);
      setQC(3);
      setSandboxTraceX(2);
    } else if (activityId === 'sandbox-intercept-find') {
      setFunType('quadratic');
      setA(1);
      setB(-5);
      setQC(6);
      setSandboxTraceX(0);
    } else if (activityId === 'sandbox-distance-time') {
      setFunType('linear');
      // Step 0: cyclist at a constant speed; step 1 is conceptual; step 2 is a
      // multi-segment journey answered from the prompt rather than the graph.
      setM(15);
      setC(0);
      setSandboxTraceX(learnStep === 0 ? 2 : 1);
    }
  }, [activityId, learnStep, variant.variantSeed, getVariantSceneData]);

  useEffect(() => {
    if (mode === 'explore' && exploreTopic === 'sandbox-distance-time') {
      setFunType('linear');
      setM(15);
      setC(0);
      setSandboxTraceX(2);
    }
  }, [mode, exploreTopic]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  // Safe custom function compiler with validation
  const parsedCustom = useMemo(() => {
    const fallback: (value: number) => number = () => NaN;
    if (!customExpr.trim()) return { evaluator: fallback, error: '' };
    try {
      const node = math.parse(customExpr);
      const compiled = node.compile();
      const evaluator = (x: number) => {
        try {
          const res = compiled.evaluate({ x });
          return typeof res === 'number' && !isNaN(res) && isFinite(res) ? res : NaN;
        } catch { return NaN; }
      };
      return { evaluator, error: '' };
    } catch {
      return { evaluator: fallback, error: 'Syntax error. Check operator symbols (e.g. use * for multiply, ^ for power).' };
    }
  }, [customExpr]);
  const parsedCustomEvaluator = parsedCustom.evaluator;
  const exprError = parsedCustom.error;

  // Active evaluator depending on function family
  const currentEvaluator = useCallback((x: number) => {
    switch (funType) {
      case 'linear': return m * x + c;
      case 'quadratic': return a * (x * x) + b * x + qC;
      case 'cubic': return cubA * (x * x * x) + cubB * (x * x) + cubC * x + cubD;
      case 'exponential': {
        if (expBase <= 0) return NaN;
        const val = expA * Math.pow(expBase, x) + expC;
        if (!Number.isFinite(val)) return NaN;
        return val;
      }
      case 'absolute': return absA * Math.abs(x - absH) + absK;
      case 'sinusoidal': return amp * Math.sin(freq * x + phase) + vShift;
      case 'logarithmic': {
        if (x <= logH) return NaN;
        const val = logA * Math.log(x - logH) + logK;
        if (isNaN(val) || !isFinite(val)) return NaN;
        return val;
      }
      case 'custom': return parsedCustomEvaluator(x);
      default: return NaN;
    }
  }, [funType, m, c, a, b, qC, cubA, cubB, cubC, cubD, expA, expBase, expC, absA, absH, absK, amp, freq, phase, vShift, logA, logH, logK, parsedCustomEvaluator]);

  // LaTeX representation of the equation
  const mathLaTeX = useMemo(() => {
    switch (funType) {
      case 'linear': {
        const mVal = formatValueLaTeX(m, isExact);
        const cVal = formatValueLaTeX(c, isExact);
        let term1 = '';
        if (m === 1) term1 = 'x';
        else if (m === -1) term1 = '-x';
        else if (m !== 0) term1 = `${mVal}x`;
        
        let term2 = '';
        if (c > 0) term2 = `+ ${cVal}`;
        else if (c < 0) term2 = `- ${formatValueLaTeX(Math.abs(c), isExact)}`;
        
        if (!term1 && !term2) return 'y = 0';
        return `y = ${term1} ${term2}`.trim();
      }
      case 'quadratic': {
        const aVal = formatValueLaTeX(a, isExact);
        const bVal = formatValueLaTeX(b, isExact);
        const cVal = formatValueLaTeX(qC, isExact);
        
        let term1 = '';
        if (a === 1) term1 = 'x^2';
        else if (a === -1) term1 = '-x^2';
        else if (a !== 0) term1 = `${aVal}x^2`;
        
        let term2 = '';
        if (b === 1) term2 = '+ x';
        else if (b === -1) term2 = '- x';
        else if (b > 0) term2 = `+ ${bVal}x`;
        else if (b < 0) term2 = `- ${formatValueLaTeX(Math.abs(b), isExact)}x`;
        
        let term3 = '';
        if (qC > 0) term3 = `+ ${cVal}`;
        else if (qC < 0) term3 = `- ${formatValueLaTeX(Math.abs(qC), isExact)}`;
        
        if (!term1 && !term2 && !term3) return 'y = 0';
        return `y = ${term1} ${term2} ${term3}`.trim().replace(/\s+/g, ' ');
      }
      case 'cubic': {
        const aVal = formatValueLaTeX(cubA, isExact);
        const bVal = formatValueLaTeX(cubB, isExact);
        const cVal = formatValueLaTeX(cubC, isExact);
        const dVal = formatValueLaTeX(cubD, isExact);
        
        let term1 = '';
        if (cubA === 1) term1 = 'x^3';
        else if (cubA === -1) term1 = '-x^3';
        else if (cubA !== 0) term1 = `${aVal}x^3`;
        
        let term2 = '';
        if (cubB === 1) term2 = '+ x^2';
        else if (cubB === -1) term2 = '- x^2';
        else if (cubB > 0) term2 = `+ ${bVal}x^2`;
        else if (cubB < 0) term2 = `- ${formatValueLaTeX(Math.abs(cubB), isExact)}x^2`;
        
        let term3 = '';
        if (cubC === 1) term3 = '+ x';
        else if (cubC === -1) term3 = '- x';
        else if (cubC > 0) term3 = `+ ${cVal}x`;
        else if (cubC < 0) term3 = `- ${formatValueLaTeX(Math.abs(cubC), isExact)}x`;
        
        let term4 = '';
        if (cubD > 0) term4 = `+ ${dVal}`;
        else if (cubD < 0) term4 = `- ${formatValueLaTeX(Math.abs(cubD), isExact)}`;
        
        return `y = ${term1} ${term2} ${term3} ${term4}`.trim().replace(/\s+/g, ' ');
      }
      case 'exponential': {
        const aVal = formatValueLaTeX(expA, isExact);
        const bVal = formatValueLaTeX(expBase, isExact);
        const cVal = formatValueLaTeX(expC, isExact);
        const term1 = expA === 1 ? '' : `${aVal} \\cdot `;
        const term2 = `${term1}(${bVal})^x`;
        let term3 = '';
        if (expC > 0) term3 = `+ ${cVal}`;
        else if (expC < 0) term3 = `- ${formatValueLaTeX(Math.abs(expC), isExact)}`;
        return `y = ${term2} ${term3}`.trim();
      }
      case 'absolute': {
        const aVal = formatValueLaTeX(absA, isExact);
        const hVal = formatValueLaTeX(absH, isExact);
        const kVal = formatValueLaTeX(absK, isExact);
        const term1 = absA === 1 ? '' : absA === -1 ? '-' : `${aVal}`;
        
        let inner = 'x';
        if (absH > 0) inner = `x - ${hVal}`;
        else if (absH < 0) inner = `x + ${formatValueLaTeX(Math.abs(absH), isExact)}`;
        
        let term3 = '';
        if (absK > 0) term3 = `+ ${kVal}`;
        else if (absK < 0) term3 = `- ${formatValueLaTeX(Math.abs(absK), isExact)}`;
        
        return `y = ${term1}|${inner}| ${term3}`.trim();
      }
      case 'sinusoidal': {
        const aVal = formatValueLaTeX(amp, isExact);
        const bVal = formatValueLaTeX(freq, isExact);
        const cVal = formatValueLaTeX(phase, isExact);
        const dVal = formatValueLaTeX(vShift, isExact);
        
        const term1 = amp === 1 ? '' : amp === -1 ? '-' : `${aVal}`;
        const term2 = freq === 1 ? 'x' : `${bVal}x`;
        let inner = term2;
        if (phase > 0) inner = `${term2} + ${cVal}`;
        else if (phase < 0) inner = `${term2} - ${formatValueLaTeX(Math.abs(phase), isExact)}`;
        
        let term4 = '';
        if (vShift > 0) term4 = `+ ${dVal}`;
        else if (vShift < 0) term4 = `- ${formatValueLaTeX(Math.abs(vShift), isExact)}`;
        
        return `y = ${term1}\\sin(${inner}) ${term4}`.trim();
      }
      case 'logarithmic': {
        const aVal = formatValueLaTeX(logA, isExact);
        const hVal = formatValueLaTeX(logH, isExact);
        const kVal = formatValueLaTeX(logK, isExact);
        const term1 = logA === 1 ? '' : logA === -1 ? '-' : `${aVal}`;
        
        let inner = 'x';
        if (logH > 0) inner = `x - ${hVal}`;
        else if (logH < 0) inner = `x + ${formatValueLaTeX(Math.abs(logH), isExact)}`;
        
        let term3 = '';
        if (logK > 0) term3 = `+ ${kVal}`;
        else if (logK < 0) term3 = `- ${formatValueLaTeX(Math.abs(logK), isExact)}`;
        
        return `y = ${term1}\\ln(${inner}) ${term3}`.trim();
      }
      case 'custom':
        return `f(x) = ${customExpr}`;
      default:
        return '';
    }
  }, [funType, m, c, a, b, qC, cubA, cubB, cubC, cubD, expA, expBase, expC, absA, absH, absK, amp, freq, phase, vShift, logA, logH, logK, customExpr, isExact]);

  // Compute key mathematical features
  const keyFeatures = useMemo(() => {
    const f = currentEvaluator;
    
    // 1. Y-Intercept
    let yInt: [number, number] | null = null;
    if (funType !== 'logarithmic' || logH < 0) {
      const yVal = f(0);
      if (!isNaN(yVal) && isFinite(yVal)) {
        yInt = [0, yVal];
      }
    }
    
    // 2. X-Intercepts
    let xInts: [number, number][] = [];
    if (funType === 'linear') {
      if (m !== 0) {
        xInts = [[-c/m, 0]];
      }
    } else if (funType === 'quadratic') {
      const disc = b*b - 4*a*qC;
      if (disc > 0 && a !== 0) {
        xInts = [
          [(-b + Math.sqrt(disc)) / (2*a), 0],
          [(-b - Math.sqrt(disc)) / (2*a), 0]
        ];
      } else if (disc === 0 && a !== 0) {
        xInts = [[-b / (2*a), 0]];
      }
    } else if (funType === 'logarithmic') {
      if (logA !== 0) {
        const root = logH + Math.exp(-logK / logA);
        if (!isNaN(root) && isFinite(root)) {
          xInts = [[root, 0]];
        }
      }
    } else {
      // Numerical roots finder
      const roots = findRootsNumerical(f, -12, 12);
      xInts = roots.map(rx => [rx, 0]);
    }
    
    // 3. Turning Points (Vertices / Extrema)
    let turningPoints: [number, number][] = [];
    if (funType === 'linear' || funType === 'logarithmic') {
      // none
    } else if (funType === 'quadratic') {
      if (a !== 0) {
        const vx = -b / (2*a);
        turningPoints = [[vx, f(vx)]];
      }
    } else if (funType === 'absolute') {
      turningPoints = [[absH, absK]];
    } else {
      // Numerical turning point finder
      const tps = findTurningPoints(f, -12, 12);
      turningPoints = tps.map(tx => [tx, f(tx)]);
    }
    
    // 4. Asymptotes
    let asymptotes: { type: 'horizontal' | 'vertical'; value: number }[] = [];
    if (funType === 'exponential') {
      asymptotes = [{ type: 'horizontal', value: expC }];
    } else if (funType === 'logarithmic') {
      asymptotes = [{ type: 'vertical', value: logH }];
    }
    
    return { yInt, xInts, turningPoints, asymptotes };
  }, [funType, currentEvaluator, m, c, a, b, qC, absH, absK, expC, logA, logH, logK]);

  const keyFeaturesPlain = useMemo(() => {
    const lines = [`Equation: ${mathLaTeX}`];
    lines.push(`y-intercept: ${keyFeatures.yInt ? `(0, ${formatValuePlain(keyFeatures.yInt[1])})` : 'None'}`);
    lines.push(`x-intercepts: ${keyFeatures.xInts.length > 0 ? keyFeatures.xInts.map(([x]) => `(${formatValuePlain(x)}, 0)`).join(', ') : 'None'}`);
    if (keyFeatures.turningPoints.length > 0) {
      lines.push(`turning points: ${keyFeatures.turningPoints.map(([x, y]) => `(${formatValuePlain(x)}, ${formatValuePlain(y)})`).join(', ')}`);
    }
    if (keyFeatures.asymptotes.length > 0) {
      lines.push(`asymptotes: ${keyFeatures.asymptotes.map(item => item.type === 'horizontal' ? `y = ${formatValuePlain(item.value)}` : `x = ${formatValuePlain(item.value)}`).join(', ')}`);
    }
    return lines.join('\n');
  }, [mathLaTeX, keyFeatures]);

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLabel(label);
      if (copyResetTimerRef.current !== null) {
        clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = setTimeout(() => {
        setCopiedLabel('');
        copyResetTimerRef.current = null;
      }, 1400);
    } catch {
      setCopiedLabel('');
    }
  };

  // Snapping Targets list
  const snapTargets = useMemo(() => {
    const targets: { x: number; y: number; label: string; latex: string }[] = [];
    
    if (keyFeatures.yInt) {
      const [x, y] = keyFeatures.yInt;
      targets.push({ x, y, label: 'y-int', latex: `(0, ${formatValueLaTeX(y, isExact)})` });
    }
    
    keyFeatures.xInts.forEach(([x]) => {
      targets.push({ x, y: 0, label: 'x-int', latex: `(${formatValueLaTeX(x, isExact)}, 0)` });
    });
    
    keyFeatures.turningPoints.forEach(([x, y]) => {
      const label = funType === 'absolute' || funType === 'quadratic' ? 'Vertex' : 'Turning Point';
      targets.push({ x, y, label, latex: `(${formatValueLaTeX(x, isExact)}, ${formatValueLaTeX(y, isExact)})` });
    });
    
    return targets;
  }, [keyFeatures, isExact, funType]);

  // Subcomponent for right-side visual grid rendering of trace point & feature markers
  const sandboxPlotContent = useMemo(() => {
    const snapThreshold = 0.2;
    
    // 1. Clamp / Validate xVal based on function type to prevent NaN in domain (e.g. log)
    let xVal = sandboxTraceX;
    if (funType === 'logarithmic') {
      if (xVal <= logH) {
        xVal = logH + 1; // Default to 1 unit to the right of vertical asymptote
      }
    }
    xVal = Math.max(-12, Math.min(12, xVal));
    if (!Number.isFinite(currentEvaluator(xVal))) {
      for (let offset = 0.1; offset <= 24; offset += 0.1) {
        const candidates = [xVal + offset, xVal - offset];
        const validCandidate = candidates.find(
          (candidate) => candidate >= -12 && candidate <= 12 && Number.isFinite(currentEvaluator(candidate))
        );
        if (validCandidate !== undefined) {
          xVal = Number(validCandidate.toFixed(2));
          break;
        }
      }
    }

    let activeTraceX = xVal;
    let isSnapped = false;
    let snapLabel = '';

    // 2. Snap target detection
    const nearestTarget = snapTargets.reduce((nearest, target) => {
      const dist = Math.abs(xVal - target.x);
      if (dist < snapThreshold) {
        if (!nearest || dist < Math.abs(xVal - nearest.x)) {
          return target;
        }
      }
      return nearest;
    }, null as typeof snapTargets[0] | null);

    if (nearestTarget) {
      activeTraceX = nearestTarget.x;
      isSnapped = true;
      snapLabel = nearestTarget.label;
    }

    const traceYUnsnapped = currentEvaluator(xVal);
    const traceYSnapped = currentEvaluator(activeTraceX);

    const featureElements: React.ReactNode[] = [];

    // Render Y-Intercept
    if (keyFeatures.yInt) {
      const [x, y] = keyFeatures.yInt;
      featureElements.push(
        <React.Fragment key="y-int">
          <Point x={x} y={y} color="var(--text-secondary)" />
          <MafsLaTeX at={[x + 0.6, y + 1.2]} tex={`y\\text{-int}\\;(0,\\,${formatValuePlain(y)})`} color="var(--text-secondary)" />
        </React.Fragment>
      );
    }

    // Render X-Intercepts
    keyFeatures.xInts.forEach(([x], idx) => {
      const duplicatesYIntercept = keyFeatures.yInt
        ? Math.abs(x - keyFeatures.yInt[0]) < 0.01 && Math.abs(keyFeatures.yInt[1]) < 0.01
        : false;
      if (duplicatesYIntercept) return;
      featureElements.push(
        <React.Fragment key={`x-int-${idx}`}>
          <Point x={x} y={0} color="var(--text-secondary)" />
          {funType !== 'cubic' && funType !== 'sinusoidal' && funType !== 'custom' && (
            <MafsLaTeX
              at={[x + (idx % 2 === 0 ? -0.6 : 0.6), idx % 2 === 0 ? -1.0 : 1.0]}
              tex={`x_{${idx + 1}}\\;(${formatValuePlain(x)},\\,0)`}
              color="var(--text-secondary)"
            />
          )}
        </React.Fragment>
      );
    });

    // Render Vertices / Turning Points
    keyFeatures.turningPoints.forEach(([x, y], idx) => {
      featureElements.push(
        <React.Fragment key={`tp-${idx}`}>
          <Point x={x} y={y} color="var(--text-secondary)" />
          {funType !== 'cubic' && funType !== 'sinusoidal' && funType !== 'custom' && (
            <MafsLaTeX
              at={[x + 0.5, y - 3.5]}
              tex={`V\\;(${formatValuePlain(x)},\\,${formatValuePlain(y)})`}
              color="var(--text-secondary)"
            />
          )}
        </React.Fragment>
      );
    });

    return (
      <>
        {/* Main curve */}
        <Plot.OfX y={currentEvaluator} color="var(--accent-color)" weight={3} />

        {/* Asymptotes */}
        {keyFeatures.asymptotes.map((asymp, idx) => {
          if (asymp.type === 'horizontal') {
            return (
              <Plot.OfX
                key={`asymp-${idx}`}
                y={() => asymp.value}
                color="var(--text-secondary)"
                style="dashed"
                weight={1.5}
              />
            );
          }
          if (asymp.type === 'vertical') {
            return (
              <Plot.OfY
                key={`asymp-${idx}`}
                x={() => asymp.value}
                color="var(--text-secondary)"
                style="dashed"
                weight={1.5}
              />
            );
          }
          return null;
        })}

        {/* Feature marker elements */}
        {(mode !== 'learn' || learnRevealed) && featureElements}

        {Number.isFinite(traceYUnsnapped) && (
          <>
        {/* Draggable Trace point directly on the curve (rendered at unsnapped xVal to prevent dragging stuckness) */}
        <MovablePoint
          point={[xVal, traceYUnsnapped]}
          onMove={(coords) => {
            let cx = Math.max(-12, Math.min(12, coords[0]));
            if (funType === 'logarithmic') {
              cx = Math.max(logH + 0.1, cx);
            }
            setSandboxTraceX(parseFloat(cx.toFixed(2)));
          }}
          color="var(--text-secondary)"
        />

        {/* Vertical segment from the x-axis to the trace point */}
        <Plot.Parametric
          xy={(t) => [xVal, t * traceYUnsnapped]}
          domain={[0, 1]}
          color="var(--text-secondary)"
          style="dashed"
          weight={1}
        />

        {/* Trace point label (coordinates follow the point smoothly, but coordinate values snap to key features) */}
        {(mode !== 'learn' || learnRevealed) && !isSnapped && (
          <MafsLaTeX
            at={[xVal + 0.3, traceYUnsnapped + (traceYUnsnapped > 0 ? 0.3 : -0.3)]}
            tex={`\\textbf{${isSnapped ? snapLabel : 'P'}}\\;(${formatValuePlain(isSnapped ? activeTraceX : xVal)},\\,${formatValuePlain(isSnapped ? traceYSnapped : traceYUnsnapped)})`}
            color="var(--text-secondary)"
          />
        )}
          </>
        )}
      </>
    );
  }, [sandboxTraceX, snapTargets, keyFeatures, currentEvaluator, funType, logH, mode, learnRevealed]);

  const exploreTopicSelector = (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
      Explore topic
      <select
        aria-label="Sandbox explore topic"
        value={exploreTopic}
        onChange={(event) => setExploreTopic(event.target.value as SandboxExploreTopic)}
        style={{
          padding: '9px 10px',
          borderRadius: '7px',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
        }}
      >
        <option value="functions">Cartesian functions</option>
        <option value="sandbox-piecewise-absolute">Absolute value: rule, table and graph</option>
        <option value="sandbox-distance-time">Distance–time graphs</option>
        <option value="sandbox-polar-curves">Polar curves</option>
        <option value="sandbox-parametric-curves">Parametric curves</option>
      </select>
    </label>
  );

  // Learn mode
  const learnActivity = activityId ? LAB_ACTIVITIES[activityId] : undefined;
  const isPiecewiseConnection = activityId === 'sandbox-piecewise-absolute'
    || (mode === 'explore' && exploreTopic === 'sandbox-piecewise-absolute');
  if (isPiecewiseConnection && (mode === 'explore' || (learnActivity && onExitLearn && onActivityComplete))) {
    const connectionActivity = learnActivity?.id === 'sandbox-piecewise-absolute'
      ? learnActivity
      : LAB_ACTIVITIES['sandbox-piecewise-absolute'];
    return (
      <ConceptConnectionsLab
        activity={connectionActivity}
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
    (activityId === 'sandbox-simultaneous-lines' || activityId === 'sandbox-inequality-region')
  ) {
    return (
      <LinearSystemsLab
        activity={learnActivity}
        mafsHeight={mafsHeight}
        onComplete={onActivityComplete}
        onExit={onExitLearn}
      />
    );
  }

  if (
    mode === 'learn' &&
    learnActivity &&
    onExitLearn &&
    onActivityComplete &&
    (activityId === 'sandbox-polar-curves' || activityId === 'sandbox-parametric-curves')
  ) {
    return (
      <AdvancedCurvesLab
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
        align="stretch"
        control={
          <>
            <LearnPanel
              key={learnActivity.id}
              activity={learnActivity}
              onComplete={onActivityComplete}
              onExit={onExitLearn}
              onRevealChange={setLearnRevealed}
              onStepChange={setLearnStep}
              {...variant.learnPanelProps}
            />
            <div className="glass-panel" style={{ padding: '10px 14px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <label htmlFor="learn-trace-x" style={{ display: 'block', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
                Trace-point x = {sandboxTraceX}
              </label>
              <LabNumberInput id="learn-trace-x" aria-label="Learning trace-point x-coordinate" step="0.5" value={sandboxTraceX} onChange={(event) => setSandboxTraceX(Number(event.target.value))} style={{ width: '100%', marginBottom: '6px' }} />
              Step {learnStep + 1}: drag the trace point or use the input to test values. Intercept and turning-point markers appear only after you submit.
            </div>
          </>
        }
        visual={
          <MafsStage mafsHeight={mafsHeight} ariaLabel="Function graph for the current learning activity" interaction="static">
            <Mafs
              height={mafsHeight}
              viewBox={{ x: [-8, 8] as [number, number], y: [-8, 10] as [number, number] }}
              pan={false}
              zoom={false}
            >
              <Coordinates.Cartesian xAxis={{ lines: 1 }} yAxis={{ lines: 1 }} subdivisions={2} />
              {sandboxPlotContent}
            </Mafs>
          </MafsStage>
        }
      />
    );
  }

  if (mode === 'explore' && exploreTopic !== 'functions' && exploreTopic !== 'sandbox-distance-time') {
    return (
        <AdvancedCurvesLab
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

  // Distance-time explore uses the standard function sandbox in linear mode.
  // Reuse the production helper so the displayed rate and Learn mathematics share one rule.
  const isDistanceTimeExplore = mode === 'explore' && exploreTopic === 'sandbox-distance-time';
  const distanceTimeAverageSpeed = isDistanceTimeExplore
    ? averageSpeed(Math.abs(currentEvaluator(2) - currentEvaluator(0)), 2)
    : 0;

  return (
    <LabSceneLayout
      align="stretch"
      control={
      <LabControlCard>
        {exploreTopicSelector}
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sliders size={18} color="var(--accent-color)" /> {isDistanceTimeExplore ? 'Distance–Time Graph Explorer' : 'Function Sandbox'}
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            {isDistanceTimeExplore
              ? 'Adjust the gradient to change the speed. The slope of a distance–time graph represents average speed.'
              : 'Select a function family and drag the sliders, or type custom equations to chart them instantly in the grid.'}
          </p>
          {isDistanceTimeExplore && (
            <output
              aria-label="Average speed over the first two hours"
              style={{ display: 'block', marginTop: '8px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
            >
              Average speed over 2 h: {formatValuePlain(distanceTimeAverageSpeed)} distance units/h
            </output>
          )}
        </div>

        {/* Function Type Selector */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
            Function Family
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {(['linear', 'quadratic', 'cubic', 'exponential', 'absolute', 'sinusoidal', 'logarithmic', 'custom'] as FunctionType[]).map((type) => (
              <button
                key={type}
                onClick={() => setFunType(type)}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: '600',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: '1px solid var(--border-color)',
                  background: funType === type ? 'var(--accent-color)' : 'var(--bg-secondary)',
                  color: funType === type ? 'white' : 'var(--text-primary)',
                  transition: 'all 0.15s'
                }}
              >
                {type === 'absolute' ? 'Abs Value' : type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Real-time Equation Display */}
        <div style={{ background: 'var(--bg-secondary)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600', marginBottom: '4px' }}>Active Equation</div>
          <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--accent-color)', wordBreak: 'break-all', display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
            <BlockLaTeX math={mathLaTeX} />
          </div>
          <button
            type="button"
            onClick={() => copyText('equation', mathLaTeX)}
            style={{
              marginTop: '8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              fontWeight: '700',
              cursor: 'pointer',
            }}
          >
            <Copy size={13} /> {copiedLabel === 'equation' ? 'Copied' : 'Copy equation'}
          </button>
        </div>

        {/* Real-time Key Features List */}
        <div style={{ background: 'rgba(255,255,255,0.01)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            📊 Key Graph Features
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
            {/* Y-intercept */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)' }}>y-intercept:</span>
              <span style={{ fontWeight: '600', fontFamily: 'monospace' }}>
                {keyFeatures.yInt ? `(0, ${formatValueLaTeX(keyFeatures.yInt[1], isExact)})` : 'None'}
              </span>
            </div>
            {/* X-intercepts */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <span style={{ color: 'var(--text-secondary)' }}>x-intercept(s):</span>
              <span style={{ fontWeight: '600', fontFamily: 'monospace', textAlign: 'right' }}>
                {keyFeatures.xInts.length > 0
                  ? keyFeatures.xInts.map(([x]) => `(${formatValueLaTeX(x, isExact)}, 0)`).join(', ')
                  : 'None'}
              </span>
            </div>
            {/* Turning points / Vertices */}
            {keyFeatures.turningPoints.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {funType === 'quadratic' || funType === 'absolute' ? 'Vertex:' : 'Turning Point(s):'}
                </span>
                <span style={{ fontWeight: '600', fontFamily: 'monospace', textAlign: 'right' }}>
                  {keyFeatures.turningPoints.map(([x, y]) => `(${formatValueLaTeX(x, isExact)}, ${formatValueLaTeX(y, isExact)})`).join(', ')}
                </span>
              </div>
            )}
            {/* Asymptotes */}
            {keyFeatures.asymptotes.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Asymptote(s):</span>
                <span style={{ fontWeight: '600', fontFamily: 'monospace', color: 'var(--accent-purple)' }}>
                  {keyFeatures.asymptotes.map(a => a.type === 'horizontal' ? `y = ${formatValueLaTeX(a.value, isExact)}` : `x = ${formatValueLaTeX(a.value, isExact)}`).join(', ')}
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => copyText('features', keyFeaturesPlain)}
            style={{
              marginTop: '12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              fontWeight: '700',
              cursor: 'pointer',
            }}
          >
            <Copy size={13} /> {copiedLabel === 'features' ? 'Copied' : 'Copy features'}
          </button>
        </div>

        {/* Custom input or slider list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
          
          {funType === 'logarithmic' && (
            <>
              <LabSliderInput
                id="sandbox-log-a"
                label="Multiplier (a)"
                ariaLabel="Logarithmic scale factor a"
                value={logA}
                min={-3}
                max={3}
                step={0.5}
                onChange={(v) => setLogA(v)}
              />
              <LabSliderInput
                id="sandbox-log-h"
                label="Asymptote Shift (h)"
                ariaLabel="Logarithmic vertical asymptote shift h"
                value={logH}
                min={-4}
                max={4}
                step={1}
                onChange={(v) => setLogH(v)}
                decimals={0}
              />
              <LabSliderInput
                id="sandbox-log-k"
                label="Constant (k)"
                ariaLabel="Logarithmic vertical shift k"
                value={logK}
                min={-4}
                max={4}
                step={1}
                onChange={(v) => setLogK(v)}
                decimals={0}
              />
            </>
          )}

          {funType === 'custom' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label htmlFor="sandbox-custom-expression" style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                Enter Expression f(x):
              </label>
              <input
                id="sandbox-custom-expression"
                type="text"
                value={customExpr}
                onChange={(e) => setCustomExpr(e.target.value)}
                placeholder="e.g. x^2 - 3*x + 1"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '15px',
                  fontFamily: 'monospace',
                  background: 'var(--bg-secondary)',
                  border: exprError ? '1px solid #ef4444' : '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                }}
              />
              {exprError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', fontSize: '11px' }}>
                  <AlertCircle size={14} />
                  <span>{exprError}</span>
                </div>
              )}
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '10px', borderRadius: '8px', marginTop: '4px' }}>
                <strong>💡 Syntax Guide:</strong>
                <ul style={{ margin: '4px 0 0 12px', padding: 0 }}>
                  <li>Multiplication: Use asterisk (e.g. <code>2*x</code>)</li>
                  <li>Exponents: Use caret or double asterisk (e.g. <code>x^2</code>)</li>
                  <li>Trigonometry: <code>sin(x), cos(x)</code></li>
                  <li>Absolute value: <code>abs(x)</code></li>
                  <li>Square root: <code>sqrt(x)</code></li>
                </ul>
              </div>
            </div>
          )}

          {funType === 'linear' && (
            <>
              <LabSliderInput
                id="sandbox-m"
                label="Slope (m)"
                ariaLabel="Linear slope"
                value={m}
                min={-4}
                max={4}
                step={0.5}
                onChange={(v) => setM(v)}
              />
              <LabSliderInput
                id="sandbox-c"
                label="Y-Intercept (c)"
                ariaLabel="Linear y-intercept"
                value={c}
                min={-4}
                max={4}
                step={1}
                onChange={(v) => setC(v)}
                decimals={0}
              />
            </>
          )}

          {funType === 'quadratic' && (
            <>
              <LabSliderInput
                id="sandbox-quad-a"
                label="Coeff (a)"
                ariaLabel="Quadratic leading coefficient a"
                value={a}
                min={-2}
                max={2}
                step={0.2}
                onChange={(v) => setA(v)}
              />
              <LabSliderInput
                id="sandbox-quad-b"
                label="Linear coeff (b)"
                ariaLabel="Quadratic linear coefficient b"
                value={b}
                min={-3}
                max={3}
                step={0.5}
                onChange={(v) => setB(v)}
              />
              <LabSliderInput
                id="sandbox-quad-c"
                label="Constant (c)"
                ariaLabel="Quadratic constant c"
                value={qC}
                min={-4}
                max={4}
                step={1}
                onChange={(v) => setQC(v)}
                decimals={0}
              />
            </>
          )}

          {funType === 'cubic' && (
            <>
              <LabSliderInput
                id="sandbox-cub-a"
                label="Coeff (a)"
                ariaLabel="Cubic leading coefficient a"
                value={cubA}
                min={-1.5}
                max={1.5}
                step={0.1}
                onChange={(v) => setCubA(v)}
              />
              <LabSliderInput
                id="sandbox-cub-b"
                label="Coeff (b)"
                ariaLabel="Cubic x-squared coefficient b"
                value={cubB}
                min={-2}
                max={2}
                step={0.5}
                onChange={(v) => setCubB(v)}
              />
              <LabSliderInput
                id="sandbox-cub-c"
                label="Coeff (c)"
                ariaLabel="Cubic x coefficient c"
                value={cubC}
                min={-3}
                max={3}
                step={0.5}
                onChange={(v) => setCubC(v)}
              />
              <LabSliderInput
                id="sandbox-cub-d"
                label="Constant (d)"
                ariaLabel="Cubic constant d"
                value={cubD}
                min={-4}
                max={4}
                step={1}
                onChange={(v) => setCubD(v)}
                decimals={0}
              />
            </>
          )}

          {funType === 'exponential' && (
            <>
              <LabSliderInput
                id="sandbox-exp-a"
                label="Multiplier (a)"
                ariaLabel="Exponential scale factor a"
                value={expA}
                min={-3}
                max={3}
                step={0.5}
                onChange={(v) => setExpA(v)}
              />
              <LabSliderInput
                id="sandbox-exp-base"
                label="Base (b)"
                ariaLabel="Exponential growth base b"
                value={expBase}
                min={0.1}
                max={4}
                step={0.1}
                onChange={(v) => setExpBase(v)}
              />
              <LabSliderInput
                id="sandbox-exp-c"
                label="Constant (c)"
                ariaLabel="Exponential asymptote shift c"
                value={expC}
                min={-4}
                max={4}
                step={1}
                onChange={(v) => setExpC(v)}
                decimals={0}
              />
            </>
          )}

          {funType === 'absolute' && (
            <>
              <LabSliderInput
                id="sandbox-abs-a"
                label="Multiplier (a)"
                ariaLabel="Absolute value slope steepness a"
                value={absA}
                min={-3}
                max={3}
                step={0.5}
                onChange={(v) => setAbsA(v)}
              />
              <LabSliderInput
                id="sandbox-abs-h"
                label="Horizontal (h)"
                ariaLabel="Absolute value vertex horizontal shift h"
                value={absH}
                min={-4}
                max={4}
                step={1}
                onChange={(v) => setAbsH(v)}
                decimals={0}
              />
              <LabSliderInput
                id="sandbox-abs-k"
                label="Vertical (k)"
                ariaLabel="Absolute value vertex vertical shift k"
                value={absK}
                min={-4}
                max={4}
                step={1}
                onChange={(v) => setAbsK(v)}
                decimals={0}
              />
            </>
          )}

          {funType === 'sinusoidal' && (
            <>
              <LabSliderInput
                id="sandbox-sin-amp"
                label="Amplitude (A)"
                ariaLabel="Sinusoidal amplitude A"
                value={amp}
                min={0.5}
                max={4}
                step={0.5}
                onChange={(v) => setAmp(v)}
              />
              <LabSliderInput
                id="sandbox-sin-freq"
                label="Frequency (B)"
                ariaLabel="Sinusoidal frequency B"
                value={freq}
                min={0.5}
                max={3}
                step={0.2}
                onChange={(v) => setFreq(v)}
              />
              <LabSliderInput
                id="sandbox-sin-phase"
                label="Move left or right (phase C)"
                ariaLabel="Sinusoidal phase shift C"
                value={phase}
                min={-3.1}
                max={3.1}
                step={0.4}
                onChange={(v) => setPhase(v)}
              />
              <LabSliderInput
                id="sandbox-sin-vshift"
                label="Vertical Shift (D)"
                ariaLabel="Sinusoidal vertical offset D"
                value={vShift}
                min={-3}
                max={3}
                step={1}
                onChange={(v) => setVShift(v)}
                decimals={0}
              />
            </>
          )}

        </div>

        <div>
          <label htmlFor="sandbox-trace-x-input" style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px' }}>
            Trace-point x-coordinate
          </label>
          <LabNumberInput id="sandbox-trace-x-input" step="0.5" value={sandboxTraceX} onChange={(event) => setSandboxTraceX(Number(event.target.value))} style={{ width: '100%' }} />
        </div>

        {/* General Info Alert */}
        <div style={{ display: 'flex', gap: '10px', background: 'rgba(99,102,241,0.04)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(99,102,241,0.1)', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
          <HelpCircle size={16} color="var(--accent-color)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            Preset families help you visualize key algebra curriculum curves. Custom mode supports freeform mathematical expressions.
          </span>
        </div>

        <TryItCard prompts={getExplorePrompts('sandbox', exploreTopic !== 'functions' ? exploreTopic : undefined)} />
      </LabControlCard>
      }
      visual={
      <MafsStage mafsHeight={mafsHeight} ariaLabel="Function graph with trace point and key features" interaction="explore">
        <Mafs
          height={mafsHeight}
          viewBox={isDistanceTimeExplore
            ? { x: [-1, 4] as [number, number], y: [-5, 35] as [number, number] }
            : { x: [-14, 14] as [number, number], y: [-14, 14] as [number, number] }}
          preserveAspectRatio={isDistanceTimeExplore ? false : 'contain'}
          pan={true}
          zoom={{ min: 0.5, max: 4 }}
        >
          {/* Grid Lines */}
          <Coordinates.Cartesian
            xAxis={{ lines: isDistanceTimeExplore ? 1 : 2 }}
            yAxis={{ lines: isDistanceTimeExplore ? 5 : 2 }}
            subdivisions={2}
          />

          {sandboxPlotContent}
        </Mafs>
      </MafsStage>
      }
    />
  );
}
