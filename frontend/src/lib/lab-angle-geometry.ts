/**
 * Geometry for the Angle Reasoning scene, kept as pure functions so the drawn
 * figure can be verified numerically instead of by eye.
 *
 * Contracts the tests enforce:
 * - the transversal really passes through the vertex the arc is centred on;
 * - the angle actually subtended by the drawn rays equals the angle in the
 *   prompt;
 * - the revealed partner arc subtends the value the question asks for;
 * - the triangle's drawn vertex angles equal the two angles in the prompt, and
 *   the whole figure fits inside the declared view box.
 */

export const ANGLE_VIEW_BOX = { x: [-6, 6] as [number, number], y: [-5, 5] as [number, number] };

/** Upper and lower parallel lines used by the transversal figure. */
export const UPPER_LINE_Y = 2;
export const LOWER_LINE_Y = -2;

export type AngleRelation = 'corresponding' | 'alternate' | 'co-interior';

export interface Arc {
  centre: [number, number];
  startDeg: number;
  endDeg: number;
  /** Angle the arc subtends, in degrees. */
  valueDeg: number;
}

export interface ParallelLinesGeometry {
  /** Transversal drawn as a segment, clipped to the view box height. */
  transversal: { point1: [number, number]; point2: [number, number] };
  /** Intersection with the upper line, where the given angle is marked. */
  upperVertex: [number, number];
  /** Intersection with the lower line, where the partner angle is marked. */
  lowerVertex: [number, number];
  givenArc: Arc;
  partnerArc: Arc;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Point on an arc at the given fraction of its sweep, pushed out by `scale`. */
export function arcLabelPoint(arc: Arc, radius: number, scale = 1.45): [number, number] {
  const mid = toRad((arc.startDeg + arc.endDeg) / 2);
  return [arc.centre[0] + radius * scale * Math.cos(mid), arc.centre[1] + radius * scale * Math.sin(mid)];
}

/**
 * Build the transversal figure for a given interior angle.
 *
 * The given angle is marked at the upper vertex as the interior angle on the
 * left of the transversal, so it sits between the parallel lines. The partner
 * arc is then placed at the lower vertex according to the relationship asked
 * about, which is what makes corresponding/alternate equal and co-interior
 * supplementary.
 */
export function parallelLinesGeometry(givenDeg: number, relation: AngleRelation): ParallelLinesGeometry {
  const slope = Math.tan(toRad(givenDeg));
  const upperVertex: [number, number] = [0, UPPER_LINE_Y];
  // y = UPPER_LINE_Y + slope * x, so the lower line is met at x = -4 / slope.
  const lowerVertex: [number, number] = [(LOWER_LINE_Y - UPPER_LINE_Y) / slope, LOWER_LINE_Y];

  const xAt = (y: number) => (y - UPPER_LINE_Y) / slope;
  const transversal = {
    point1: [xAt(ANGLE_VIEW_BOX.y[0] + 0.6), ANGLE_VIEW_BOX.y[0] + 0.6] as [number, number],
    point2: [xAt(ANGLE_VIEW_BOX.y[1] - 0.6), ANGLE_VIEW_BOX.y[1] - 0.6] as [number, number],
  };

  // At the upper vertex the interior directions are 180° (left along the line)
  // and 180 + given (down the transversal), so that arc subtends `given`.
  const givenArc: Arc = {
    centre: upperVertex,
    startDeg: 180,
    endDeg: 180 + givenDeg,
    valueDeg: givenDeg,
  };

  const partnerArc: Arc =
    relation === 'corresponding'
      ? { centre: lowerVertex, startDeg: 180, endDeg: 180 + givenDeg, valueDeg: givenDeg }
      : relation === 'alternate'
        ? { centre: lowerVertex, startDeg: 0, endDeg: givenDeg, valueDeg: givenDeg }
        : { centre: lowerVertex, startDeg: givenDeg, endDeg: 180, valueDeg: 180 - givenDeg };

  return { transversal, upperVertex, lowerVertex, givenArc, partnerArc };
}

export interface TriangleGeometry {
  vertices: [[number, number], [number, number], [number, number]];
  leftArc: Arc;
  rightArc: Arc;
  apexLabelAt: [number, number];
}

/**
 * Build a triangle with the two given base angles.
 *
 * The base length is chosen so the apex stays inside the view box for any pair
 * of acute angles, and the figure is centred horizontally.
 */
export function triangleGeometry(angleADeg: number, angleBDeg: number): TriangleGeometry {
  const tanA = Math.tan(toRad(angleADeg));
  const tanB = Math.tan(toRad(angleBDeg));
  const headroom = ANGLE_VIEW_BOX.y[1] - 0.6 - LOWER_LINE_Y;
  // Apex height for base b is b·tanA·tanB/(tanA + tanB); solve for the largest
  // base that keeps it within the available headroom, capped at 8 units wide.
  const heightPerUnitBase = (tanA * tanB) / (tanA + tanB);
  const base = Math.min(8, headroom / heightPerUnitBase);
  const left: [number, number] = [-base / 2, LOWER_LINE_Y];
  const right: [number, number] = [base / 2, LOWER_LINE_Y];
  const apexX = left[0] + (base * tanB) / (tanA + tanB);
  const apexY = LOWER_LINE_Y + base * heightPerUnitBase;
  const apex: [number, number] = [apexX, apexY];

  const leftArc: Arc = { centre: left, startDeg: 0, endDeg: angleADeg, valueDeg: angleADeg };
  const rightArc: Arc = {
    centre: right,
    startDeg: 180 - angleBDeg,
    endDeg: 180,
    valueDeg: angleBDeg,
  };

  return { vertices: [left, right, apex], leftArc, rightArc, apexLabelAt: [apexX, apexY - 0.7] };
}

/** Vertices of a regular polygon centred on the origin. */
export function regularPolygonPoints(sides: number, radius = 4): [number, number][] {
  return Array.from({ length: sides }, (_, i) => {
    const theta = (2 * Math.PI * i) / sides - Math.PI / 2;
    return [radius * Math.cos(theta), radius * Math.sin(theta)] as [number, number];
  });
}
