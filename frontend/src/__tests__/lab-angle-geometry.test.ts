/**
 * Numeric verification of the Angle Reasoning figure.
 *
 * The first version of this scene drew a transversal whose slope was half the
 * stated angle, and centred the angle arc on a point that was not even on the
 * transversal. These tests re-derive the drawn angles from the drawn coordinates
 * so that class of defect fails the suite instead of only looking wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  ANGLE_VIEW_BOX,
  LOWER_LINE_Y,
  UPPER_LINE_Y,
  arcLabelPoint,
  parallelLinesGeometry,
  regularPolygonPoints,
  triangleGeometry,
  type AngleRelation,
} from '../lib/lab-angle-geometry';
import { makeVariant } from '../lib/lab-variants';
import { LAB_ACTIVITIES } from '../lib/lab-activities';

const RELATIONS: AngleRelation[] = ['corresponding', 'alternate', 'co-interior'];
const GIVEN_ANGLES = [35, 40, 45, 55, 60, 70, 75];

/** Interior angle, in degrees, between two rays leaving a shared vertex. */
function angleBetween(
  vertex: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const v1 = [a[0] - vertex[0], a[1] - vertex[1]];
  const v2 = [b[0] - vertex[0], b[1] - vertex[1]];
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const mag = Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]);
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function pointOnRay(centre: [number, number], deg: number, radius = 1): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [centre[0] + radius * Math.cos(rad), centre[1] + radius * Math.sin(rad)];
}

describe('parallel-lines figure', () => {
  it.each(GIVEN_ANGLES)('the transversal passes through both marked vertices (%i°)', (given) => {
    for (const relation of RELATIONS) {
      const g = parallelLinesGeometry(given, relation);
      const { point1, point2 } = g.transversal;
      const slope = (point2[1] - point1[1]) / (point2[0] - point1[0]);
      // The drawn transversal must have exactly the stated inclination.
      expect((Math.atan(slope) * 180) / Math.PI).toBeCloseTo(given, 6);
      // Both arc centres must lie on that segment.
      for (const vertex of [g.upperVertex, g.lowerVertex]) {
        const expectedY = point1[1] + slope * (vertex[0] - point1[0]);
        expect(expectedY, `${relation} @ ${given}°`).toBeCloseTo(vertex[1], 6);
      }
      expect(g.upperVertex[1]).toBe(UPPER_LINE_Y);
      expect(g.lowerVertex[1]).toBe(LOWER_LINE_Y);
    }
  });

  it.each(GIVEN_ANGLES)('the marked arc subtends exactly the stated angle (%i°)', (given) => {
    for (const relation of RELATIONS) {
      const { givenArc } = parallelLinesGeometry(given, relation);
      // Rebuild the two rays from the arc's own start/end and measure them.
      const measured = angleBetween(
        givenArc.centre,
        pointOnRay(givenArc.centre, givenArc.startDeg),
        pointOnRay(givenArc.centre, givenArc.endDeg),
      );
      expect(measured).toBeCloseTo(given, 6);
      expect(givenArc.valueDeg).toBe(given);
    }
  });

  it.each(GIVEN_ANGLES)('the given arc is an interior angle between the parallels (%i°)', (given) => {
    const { givenArc } = parallelLinesGeometry(given, 'co-interior');
    // Its bisector must point into the strip between the two lines.
    const [, labelY] = arcLabelPoint(givenArc, 0.9);
    expect(labelY).toBeLessThan(UPPER_LINE_Y);
    expect(labelY).toBeGreaterThan(LOWER_LINE_Y);
  });

  it.each(GIVEN_ANGLES)('the partner arc subtends the value the question expects (%i°)', (given) => {
    const expected: Record<AngleRelation, number> = {
      corresponding: given,
      alternate: given,
      'co-interior': 180 - given,
    };
    for (const relation of RELATIONS) {
      const { partnerArc } = parallelLinesGeometry(given, relation);
      const measured = angleBetween(
        partnerArc.centre,
        pointOnRay(partnerArc.centre, partnerArc.startDeg),
        pointOnRay(partnerArc.centre, partnerArc.endDeg),
      );
      expect(measured, `${relation} @ ${given}°`).toBeCloseTo(expected[relation], 6);
      expect(partnerArc.valueDeg).toBe(expected[relation]);
    }
  });

  it('every generated parallel-lines step agrees with its own figure', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const result = makeVariant('geometry-angle-reasoning', seed);
      if (!result.hasVariants) continue;
      const step = result.steps[0];
      const scene = step.sceneData;
      expect(scene?.kind).toBe('angle-figure');
      if (!scene || scene.kind !== 'angle-figure') continue;
      const relation = scene.relation as AngleRelation;
      expect(RELATIONS).toContain(relation);
      expect(step.prompt).toContain(relation);
      const g = parallelLinesGeometry(scene.angles[0], relation);
      // The answer in the step must be the angle the partner arc actually spans.
      expect(Number(step.acceptedAnswers[0])).toBeCloseTo(g.partnerArc.valueDeg, 6);
      // And the marked angle must be the one quoted in the prompt.
      expect(step.prompt).toContain(`${g.givenArc.valueDeg}°`);
    }
  });

  it('the authored (non-variant) step also matches its figure', () => {
    const step = LAB_ACTIVITIES['geometry-angle-reasoning'].steps[0];
    const scene = step.sceneData;
    expect(scene?.kind).toBe('angle-figure');
    if (!scene || scene.kind !== 'angle-figure') return;
    const g = parallelLinesGeometry(scene.angles[0], scene.relation as AngleRelation);
    expect(Number(step.acceptedAnswers[0])).toBeCloseTo(g.partnerArc.valueDeg, 6);
  });
});

describe('triangle figure', () => {
  const PAIRS: [number, number][] = [
    [30, 30],
    [30, 70],
    [55, 70],
    [70, 70],
    [45, 45],
    [65, 68],
  ];

  it.each(PAIRS)('drawn vertex angles equal the stated angles (%i°, %i°)', (a, b) => {
    const { vertices, leftArc, rightArc } = triangleGeometry(a, b);
    const [left, right, apex] = vertices;
    expect(angleBetween(left, right, apex)).toBeCloseTo(a, 6);
    expect(angleBetween(right, left, apex)).toBeCloseTo(b, 6);
    // The apex angle then follows from the angle sum.
    expect(angleBetween(apex, left, right)).toBeCloseTo(180 - a - b, 6);
    expect(leftArc.valueDeg).toBe(a);
    expect(rightArc.valueDeg).toBe(b);
  });

  it.each(PAIRS)('the whole triangle fits inside the view box (%i°, %i°)', (a, b) => {
    const { vertices } = triangleGeometry(a, b);
    for (const [x, y] of vertices) {
      expect(x).toBeGreaterThanOrEqual(ANGLE_VIEW_BOX.x[0]);
      expect(x).toBeLessThanOrEqual(ANGLE_VIEW_BOX.x[1]);
      expect(y).toBeGreaterThanOrEqual(ANGLE_VIEW_BOX.y[0]);
      expect(y).toBeLessThanOrEqual(ANGLE_VIEW_BOX.y[1]);
    }
  });

  it('every generated triangle step agrees with its own figure', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const result = makeVariant('geometry-angle-reasoning', seed);
      if (!result.hasVariants) continue;
      const step = result.steps[1];
      const scene = step.sceneData;
      if (!scene || scene.kind !== 'angle-figure') continue;
      const [a, b] = scene.angles;
      const { vertices } = triangleGeometry(a, b);
      expect(angleBetween(vertices[0], vertices[1], vertices[2])).toBeCloseTo(a, 6);
      expect(angleBetween(vertices[1], vertices[0], vertices[2])).toBeCloseTo(b, 6);
      expect(Number(step.acceptedAnswers[0])).toBeCloseTo(180 - a - b, 6);
    }
  });
});

describe('polygon figure', () => {
  it.each([5, 6, 7, 8, 9, 10])('draws %i vertices whose interior angles sum correctly', (sides) => {
    const points = regularPolygonPoints(sides);
    expect(points).toHaveLength(sides);
    let total = 0;
    for (let i = 0; i < sides; i += 1) {
      const previous = points[(i - 1 + sides) % sides];
      const next = points[(i + 1) % sides];
      total += angleBetween(points[i], previous, next);
    }
    expect(total).toBeCloseTo(180 * (sides - 2), 4);
  });

  it('keeps every vertex inside the view box', () => {
    for (const sides of [5, 6, 7, 8, 9, 10, 12]) {
      for (const [x, y] of regularPolygonPoints(sides)) {
        expect(Math.abs(x)).toBeLessThanOrEqual(ANGLE_VIEW_BOX.x[1]);
        expect(Math.abs(y)).toBeLessThanOrEqual(ANGLE_VIEW_BOX.y[1]);
      }
    }
  });
});
