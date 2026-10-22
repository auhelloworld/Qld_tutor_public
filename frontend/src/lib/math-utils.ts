import * as math from 'mathjs';

export const findRootBisection = (
  f: (x: number) => number,
  a: number,
  b: number,
  tol = 1e-6,
  maxIter = 50
): number => {
  let fa = f(a);
  let fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return NaN;
  if (Math.abs(fa) < tol) return a;
  if (Math.abs(fb) < tol) return b;
  if (fa * fb > 0) return NaN;
  let left = a;
  let right = b;
  for (let i = 0; i < maxIter; i++) {
    const mid = (left + right) / 2;
    const fmid = f(mid);
    if (!Number.isFinite(fmid)) return NaN;
    if (Math.abs(fmid) < tol || Math.abs(right - left) / 2 < tol) {
      return mid;
    }
    if (fa * fmid < 0) {
      right = mid;
      fb = fmid;
    } else {
      left = mid;
      fa = fmid;
    }
  }
  return (left + right) / 2;
};

export const findRootsNumerical = (
  f: (x: number) => number,
  minX = -6,
  maxX = 6,
  steps = 120
): number[] => {
  const roots: number[] = [];
  const dx = (maxX - minX) / steps;
  let prevX = minX;
  let prevY = f(minX);

  for (let i = 1; i <= steps; i++) {
    const currX = minX + i * dx;
    const currY = f(currX);

    if (Number.isFinite(prevY) && Math.abs(prevY) < 1e-9) {
      if (roots.length === 0 || Math.abs(roots[roots.length - 1] - prevX) > 1e-3) {
        roots.push(prevX);
      }
    }

    if (Number.isFinite(prevY) && Number.isFinite(currY) && prevY * currY < 0) {
      const root = findRootBisection(f, prevX, currX);
      if (!isNaN(root)) {
        if (roots.length === 0 || Math.abs(roots[roots.length - 1] - root) > 1e-3) {
          roots.push(root);
        }
      }
    }

    prevX = currX;
    prevY = currY;
  }

  if (Number.isFinite(prevY) && Math.abs(prevY) < 1e-9) {
    if (roots.length === 0 || Math.abs(roots[roots.length - 1] - prevX) > 1e-3) {
      roots.push(prevX);
    }
  }

  return roots.map(r => parseFloat(r.toFixed(5)));
};

export const numDeriv = (f: (x: number) => number, h = 1e-5) => (x: number) =>
  (f(x + h) - f(x - h)) / (2 * h);

export const findTurningPoints = (
  f: (x: number) => number,
  minX = -6,
  maxX = 6
): number[] => {
  const df = numDeriv(f);
  const roots = findRootsNumerical(df, minX, maxX, 120);
  return roots.filter(x => {
    const fx = f(x);
    if (isNaN(fx) || !isFinite(fx)) return false;
    const dfLeft = df(x - 0.01);
    const dfRight = df(x + 0.01);
    return dfLeft * dfRight < 0; // Sign changed: local extremum
  });
};

export const getExactLaTeX = (val: number): string | null => {
  const epsilon = 1e-9;
  const absVal = Math.abs(val);
  const sign = val < 0 ? '-' : '';

  if (Math.abs(absVal - Math.PI) < epsilon) return sign + '\\pi';
  if (Math.abs(absVal - Math.PI / 2) < epsilon) return sign + '\\frac{\\pi}{2}';
  if (Math.abs(absVal - Math.sqrt(2)) < epsilon) return sign + '\\sqrt{2}';
  if (Math.abs(absVal - Math.sqrt(3)) < epsilon) return sign + '\\sqrt{3}';
  if (Math.abs(absVal - Math.sqrt(2) / 2) < epsilon) return sign + '\\frac{\\sqrt{2}}{2}';
  if (Math.abs(absVal - Math.sqrt(3) / 2) < epsilon) return sign + '\\frac{\\sqrt{3}}{2}';

  try {
    const f = math.fraction(val) as any;
    if (f.d === 1) return (f.n * f.s).toString();
    if (f.d < 100) {
      const fracSign = f.n * f.s < 0 ? '-' : '';
      return `${fracSign}\\frac{${Math.abs(f.n)}}{${f.d}}`;
    }
  } catch {
    // ignore
  }
  return null;
};

export const formatValueLaTeX = (val: number, isExact: boolean): string => {
  if (!Number.isFinite(val)) return '\\text{undefined}';
  if (Math.abs(val) < 1e-10) return '0';
  if (!isExact) return parseFloat(val.toFixed(3)).toString();
  const exact = getExactLaTeX(val);
  return exact !== null ? exact : parseFloat(val.toFixed(3)).toString();
};

export const formatValuePlain = (val: number): string => {
  if (Math.abs(val) < 1e-10) return '0';
  const rounded = parseFloat(val.toFixed(3));
  if (Math.abs(rounded - Math.round(rounded)) < 1e-10) return Math.round(rounded).toString();
  return rounded.toString();
};

/**
 * Compute average speed = distance / time.
 * Returns 0 for non-positive time (stationary/invalid) and for zero distance.
 */
export function averageSpeed(distance: number, time: number): number {
  if (time <= 0 || !Number.isFinite(time)) return 0;
  if (!Number.isFinite(distance)) return 0;
  return distance / time;
}