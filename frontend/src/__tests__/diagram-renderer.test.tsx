import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import DiagramRenderer from '../components/DiagramRenderer';

type DiagramFixture = Parameters<typeof DiagramRenderer>[0]['data'] & { title?: string };
interface ExplanationSectionFixture { diagram?: DiagramFixture | null }
interface AuthoredTopicFixture {
  syllabus_subject?: string;
  unit?: number;
  concept_card: { lesson_content: { explanation_sections: ExplanationSectionFixture[] } };
}

afterEach(() => cleanup());

// Geometry constants mirror the component (w=360, h=300, pad=40).
const W = 360, H = 300, PAD = 40;
const AVAIL_W = W - 2 * PAD; // 200
const AVAIL_H = H - 2 * PAD; // 140

function polygonPoints(container: HTMLElement): number[][] {
  const poly = container.querySelector('polygon');
  expect(poly).toBeTruthy();
  return (poly!.getAttribute('points') || '')
    .trim()
    .split(/\s+/)
    .map((pt) => pt.split(',').map(Number));
}

describe('DiagramRenderer right_triangle to-scale', () => {
  it('scales legs proportionally from numeric base and height', () => {
    const { container } = render(
      <DiagramRenderer data={{ type: 'right_triangle', labels: { base: '20 cm', height: '10 cm' } }} />,
    );
    const [bl, br, tl] = polygonPoints(container);
    // Right angle anchored bottom-left.
    expect(bl).toEqual([PAD, H - PAD]);
    const drawnW = br[0] - bl[0];
    const drawnH = bl[1] - tl[1];
    // base:height = 2:1 must be preserved in the drawn triangle.
    expect(drawnW / drawnH).toBeCloseTo(2, 5);
    // Fits inside the drawing area.
    expect(drawnW).toBeLessThanOrEqual(AVAIL_W + 0.001);
    expect(drawnH).toBeLessThanOrEqual(AVAIL_H + 0.001);
  });

  it('recovers a missing leg from the hypotenuse via Pythagoras (5-12-13)', () => {
    const { container } = render(
      <DiagramRenderer data={{ type: 'right_triangle', labels: { base: '5 cm', height: '?', hypotenuse: '13 cm' } }} />,
    );
    const [bl, br, tl] = polygonPoints(container);
    const drawnW = br[0] - bl[0];
    const drawnH = bl[1] - tl[1];
    // height should be recovered as 12, so height:base = 12:5 = 2.4.
    expect(drawnH / drawnW).toBeCloseTo(12 / 5, 5);
  });

  it('falls back to the fixed shape when legs are non-numeric', () => {
    const { container } = render(
      <DiagramRenderer data={{ type: 'right_triangle', labels: { base: 'ground', height: 'wall', hypotenuse: '5 m' } }} />,
    );
    const [bl, br, tl] = polygonPoints(container);
    const drawnW = br[0] - bl[0];
    const drawnH = bl[1] - tl[1];
    expect(drawnW).toBeCloseTo(AVAIL_W, 5);
    expect(drawnH).toBeCloseTo(AVAIL_H, 5);
  });
});

describe('DiagramRenderer triangle labels', () => {
  it('renders side and vertex labels for sine/cosine-rule diagrams', () => {
    const { container } = render(
      <DiagramRenderer
        data={{ type: 'triangle', labels: { a: 'A', b: 'B', c: 'C', side_a: 'a', side_b: 'b', side_c: 'c' } }}
      />,
    );
    expect(container.querySelector('polygon')).toBeTruthy();
    expect(container.textContent).toContain('A');
    expect(container.textContent).toContain('B');
    expect(container.textContent).toContain('C');
    expect(container.textContent).toContain('a');
    expect(container.textContent).toContain('b');
    expect(container.textContent).toContain('c');
  });
});

describe('DiagramRenderer diagram math labels', () => {
  it('normalizes LaTeX units in rectangular-prism labels', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'rectangular_prism',
          labels: { length: '$8\\text{ cm}$', width: '$4\\text{ cm}$', height: '$3\\text{ cm}$' },
        }}
      />,
    );
    expect(container.textContent).toContain('8 cm');
    expect(container.textContent).toContain('4 cm');
    expect(container.textContent).toContain('3 cm');
    expect(container.textContent).not.toContain('$');
    expect(container.textContent).not.toContain('\\text');
  });

  it('repairs a malformed ext text command without changing ordinary words', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'rectangular_prism',
          labels: { length: '$8 ext{ cm}$', width: 'text label', height: 'extent' },
        }}
      />,
    );
    expect(container.textContent).toContain('8 cm');
    expect(container.textContent).toContain('text label');
    expect(container.textContent).toContain('extent');
    expect(container.textContent).not.toContain('ext{ cm}');
  });
});

describe('DiagramRenderer function_graph scatter', () => {
  it('renders a curve path from a STRING function spec (regression: was empty)', () => {
    const { container } = render(
      <DiagramRenderer
        data={{ type: 'function_graph', x_min: -3, x_max: 3, y_min: -1, y_max: 9, functions: ['f(x) = x^2'] }}
      />,
    );
    // The string expression must now produce a drawn curve path.
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].getAttribute('d') || '').toContain('M');
  });

  it('renders a curve path from a lesson-content {expression} function spec', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'function_graph',
          x_min: -2,
          x_max: 4,
          y_min: -5,
          y_max: 5,
          functions: [{ expression: 'x^2-2*x-3', label: 'two roots' }],
        }}
      />,
    );
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].getAttribute('d') || '').toContain('M');
  });

  it('renders an exponential curve and a dashed asymptote', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'function_graph', x_min: -3, x_max: 3, y_min: -1, y_max: 8,
          functions: [{ expr: 'e^x', label: 'y=e^x' }],
          asymptotes: [{ y: 0 }],
        }}
      />,
    );
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
    // The asymptote is a dashed line.
    const dashed = Array.from(container.querySelectorAll('line')).filter(
      (l) => l.getAttribute('stroke-dasharray'),
    );
    expect(dashed.length).toBeGreaterThan(0);
  });

  it('renders a shaded area-under-curve region for an integral visual', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'function_graph', x_min: 0, x_max: 4, y_min: 0, y_max: 9,
          functions: ['x^2 / 2'],
          shaded: [{ fn: 0, from: 1, to: 3 }],
        }}
      />,
    );
    // Shaded region path is a closed area (ends with Z).
    const closed = Array.from(container.querySelectorAll('path')).filter(
      (p) => (p.getAttribute('d') || '').trim().endsWith('Z'),
    );
    expect(closed.length).toBeGreaterThan(0);
  });
});

describe('DiagramRenderer senior Methods visuals', () => {
  it('renders labelled radians and a sector without NaN geometry', () => {
    const circle = render(
      <DiagramRenderer
        data={{
          type: 'unit_circle',
          title: 'Unit circle',
          angle: Math.PI / 4,
          special_angles: [{ angle: Math.PI / 2, label: 'π/2' }],
        }}
      />,
    );
    expect(circle.container.textContent).toContain('Unit circle');
    expect(circle.container.textContent).toContain('π/2');
    expect(circle.container.innerHTML).not.toContain('NaN');
    circle.unmount();

    const sector = render(
      <DiagramRenderer data={{ type: 'sector', title: 'Sector in radians', angle: Math.PI / 3, arc_label: 's = rθ' }} />,
    );
    expect(sector.container.textContent).toContain('s = rθ');
    expect(sector.container.querySelector('path')).toBeTruthy();
    expect(sector.container.innerHTML).not.toContain('NaN');
  });

  it('expands a densely labelled unit circle and displays data-table titles', () => {
    const angles = Array.from({ length: 16 }, (_, index) => ({
      angle: (index * Math.PI) / 8,
      label: `${index}π/8`,
    }));
    const circle = render(
      <DiagramRenderer data={{ type: 'unit_circle', title: 'Full exact-angle circle', special_angles: angles }} />,
    );
    expect(circle.container.querySelector('svg')?.getAttribute('width')).toBe('420');
    expect(circle.container.textContent).toContain('15π/8');
    expect(circle.container.innerHTML).not.toContain('NaN');
    circle.unmount();

    const table = render(
      <DiagramRenderer
        data={{
          type: 'data_table',
          title: 'Relative-frequency table',
          headers: ['Event', 'Count'],
          rows: [['A', '30']],
        }}
      />,
    );
    expect(table.container.textContent).toContain('Relative-frequency table');
    // data_table renders a real <table>; the caption carries its accessible name
    // and the header cells expose column scope to assistive technology.
    const tableEl = table.container.querySelector('table');
    expect(tableEl).toBeTruthy();
    expect(tableEl?.querySelector('caption')?.textContent).toBe('Relative-frequency table');
    const columnHeaders = Array.from(tableEl?.querySelectorAll('th[scope="col"]') ?? []).map(
      (th) => th.textContent,
    );
    expect(columnHeaders).toEqual(['Event', 'Count']);
    expect(tableEl?.querySelectorAll('tbody td')?.length).toBe(2);
    table.unmount();

    const equationTable = render(
      <DiagramRenderer
        data={{
          type: 'data_table',
          title: 'Equations',
          headers: ['Form', 'Rule'],
          rows: [['Vertex', 'y = (x − 1)² − 4']],
        }}
      />,
    );
    // Non-breaking spaces (character code 160 / \u00A0) keep an equation from being
    // split across lines. In the HTML table these live in the cell text.
    const equationCells = Array.from(equationTable.container.querySelectorAll('td, th'));
    const equationCell = equationCells.find(cell => cell.textContent?.includes('y\u00a0='));
    expect(equationCell).toBeTruthy();
    equationTable.unmount();

    const mathTable = render(
      <DiagramRenderer
        data={{
          type: 'data_table',
          title: 'Table with $f(x_i)\\Delta x$',
          headers: ['Right endpoint $x_i$', '$0.5$'],
          rows: [['Rectangle area $f(x_i)\\Delta x$', '$0.125$']],
        }}
      />,
    );
    expect(mathTable.container.textContent).toContain('Table with f(xᵢ)Δx');
    expect(mathTable.container.textContent).toContain('Right endpoint xᵢ');
    expect(mathTable.container.textContent).toContain('Rectangle area');
    expect(mathTable.container.textContent).toContain('f(xᵢ)Δx');
    expect(mathTable.container.textContent).toContain('0.5');
    expect(mathTable.container.textContent).toContain('0.125');
    mathTable.unmount();

    const pascal = render(
      <DiagramRenderer
        data={{
          type: 'pascal_triangle',
          title: "Pascal's triangle",
          rows: [[1], [1, 1], [1, 2, 1]],
        }}
      />,
    );
    expect(pascal.container.textContent).toContain("Pascal's triangle");
    expect(pascal.container.textContent).toContain('n=2');
    expect(pascal.container.querySelectorAll('circle').length).toBe(6);
  });

  it('uses a square plotting area when a function graph requests equal scale', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'function_graph',
          title: 'Inverse functions',
          equal_scale: true,
          x_min: -2,
          x_max: 4,
          y_min: -2,
          y_max: 4,
          functions: [{ expression: 'x', label: 'y = x' }],
        }}
      />,
    );
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('380');
    expect(container.querySelector('svg')?.getAttribute('height')).toBe('380');
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders every authored Mathematical Methods Unit 1 lesson diagram', () => {
    const curriculumPath = resolve(process.cwd(), '../data/curriculum/qcaa_senior_maths/methods.json');
    const curriculum = JSON.parse(readFileSync(curriculumPath, 'utf8'));
    const diagrams = curriculum.topics
      .filter((topic: AuthoredTopicFixture) => topic.syllabus_subject === 'methods' && topic.unit === 1)
      .flatMap((topic: AuthoredTopicFixture) => topic.concept_card.lesson_content.explanation_sections)
      .map((section: ExplanationSectionFixture) => section.diagram)
      .filter(Boolean);

    expect(diagrams.length).toBe(19);
    for (const diagram of diagrams) {
      const view = render(<DiagramRenderer data={diagram} />);
      // data_table renders a <table>; every other type renders an <svg>.
      expect(view.container.querySelector('svg, table')).toBeTruthy();
      expect(view.container.innerHTML).not.toContain('NaN');
      view.unmount();
    }
  });

  it('renders every authored Mathematical Methods Unit 2 lesson diagram', () => {
    const curriculumPath = resolve(process.cwd(), '../data/curriculum/qcaa_senior_maths/methods.json');
    const curriculum = JSON.parse(readFileSync(curriculumPath, 'utf8'));
    const diagrams = curriculum.topics
      .filter((topic: AuthoredTopicFixture) => topic.syllabus_subject === 'methods' && topic.unit === 2)
      .flatMap((topic: AuthoredTopicFixture) => topic.concept_card.lesson_content.explanation_sections)
      .map((section: ExplanationSectionFixture) => section.diagram)
      .filter(Boolean);

    expect(diagrams.length).toBe(10);
    for (const diagram of diagrams) {
      const view = render(<DiagramRenderer data={diagram} />);
      // data_table renders a <table>; every other type renders an <svg>.
      expect(view.container.querySelector('svg, table')).toBeTruthy();
      expect(view.container.innerHTML).not.toContain('NaN');
      view.unmount();
    }
  });

  it('renders every authored Mathematical Methods Unit 3 lesson diagram', () => {
    const curriculumPath = resolve(process.cwd(), '../data/curriculum/qcaa_senior_maths/methods.json');
    const curriculum = JSON.parse(readFileSync(curriculumPath, 'utf8'));
    const diagrams = curriculum.topics
      .filter((topic: AuthoredTopicFixture) => topic.syllabus_subject === 'methods' && topic.unit === 3)
      .flatMap((topic: AuthoredTopicFixture) => topic.concept_card.lesson_content.explanation_sections)
      .map((section: ExplanationSectionFixture) => section.diagram)
      .filter(Boolean);

    expect(diagrams.length).toBe(13);
    for (const diagram of diagrams) {
      const view = render(<DiagramRenderer data={diagram} />);
      // data_table renders a <table>; every other type renders an <svg>.
      expect(view.container.querySelector('svg, table')).toBeTruthy();
      expect(view.container.innerHTML).not.toContain('NaN');
      view.unmount();
    }
  });

  it('renders every authored Mathematical Methods Unit 4 lesson diagram', () => {
    const curriculumPath = resolve(process.cwd(), '../data/curriculum/qcaa_senior_maths/methods.json');
    const curriculum = JSON.parse(readFileSync(curriculumPath, 'utf8'));
    const diagrams = curriculum.topics
      .filter((topic: AuthoredTopicFixture) => topic.syllabus_subject === 'methods' && topic.unit === 4)
      .flatMap((topic: AuthoredTopicFixture) => topic.concept_card.lesson_content.explanation_sections)
      .map((section: ExplanationSectionFixture) => section.diagram)
      .filter(Boolean);

    expect(diagrams.length).toBe(15);
    for (const diagram of diagrams) {
      const view = render(<DiagramRenderer data={diagram} />);
      // data_table renders a <table>; every other type renders an <svg>.
      expect(view.container.querySelector('svg, table')).toBeTruthy();
      expect(view.container.innerHTML).not.toContain('NaN');
      view.unmount();
    }
  });

  it('renders every authored Specialist Mathematics Unit 1 lesson diagram', () => {
    const curriculumPath = resolve(process.cwd(), '../data/curriculum/qcaa_senior_maths/specialist.json');
    const curriculum = JSON.parse(readFileSync(curriculumPath, 'utf8'));
    const diagrams = curriculum.topics
      .filter((topic: AuthoredTopicFixture) => topic.syllabus_subject === 'specialist' && topic.unit === 1)
      .flatMap((topic: AuthoredTopicFixture) => topic.concept_card.lesson_content.explanation_sections)
      .map((section: ExplanationSectionFixture) => section.diagram)
      .filter(Boolean);

    expect(diagrams.length).toBe(13);
    for (const diagram of diagrams) {
      const view = render(<DiagramRenderer data={diagram} />);
      // data_table renders a <table>; every other type renders an <svg>.
      expect(view.container.querySelector('svg, table')).toBeTruthy();
      expect(view.container.innerHTML).not.toContain('NaN');
      view.unmount();
    }
  });

  it('renders every authored Specialist Mathematics Unit 2 lesson diagram', () => {
    const curriculumPath = resolve(process.cwd(), '../data/curriculum/qcaa_senior_maths/specialist.json');
    const curriculum = JSON.parse(readFileSync(curriculumPath, 'utf8'));
    const diagrams = curriculum.topics
      .filter((topic: AuthoredTopicFixture) => topic.syllabus_subject === 'specialist' && topic.unit === 2)
      .flatMap((topic: AuthoredTopicFixture) => topic.concept_card.lesson_content.explanation_sections)
      .map((section: ExplanationSectionFixture) => section.diagram)
      .filter(Boolean);

    expect(diagrams.length).toBe(20);
    for (const diagram of diagrams) {
      const view = render(<DiagramRenderer data={diagram} />);
      // data_table renders a <table>; every other type renders an <svg>.
      expect(view.container.querySelector('svg, table')).toBeTruthy();
      expect(diagram.title).toBeTruthy();
      expect(view.container.innerHTML).not.toContain('NaN');
      view.unmount();
    }
  });

  it('renders every authored Specialist Mathematics Unit 3 lesson diagram', () => {
    const curriculumPath = resolve(process.cwd(), '../data/curriculum/qcaa_senior_maths/specialist.json');
    const curriculum = JSON.parse(readFileSync(curriculumPath, 'utf8'));
    const diagrams = curriculum.topics
      .filter((topic: AuthoredTopicFixture) => topic.syllabus_subject === 'specialist' && topic.unit === 3)
      .flatMap((topic: AuthoredTopicFixture) => topic.concept_card.lesson_content.explanation_sections)
      .map((section: ExplanationSectionFixture) => section.diagram)
      .filter(Boolean);

    expect(diagrams.length).toBe(15);
    for (const diagram of diagrams) {
      const view = render(<DiagramRenderer data={diagram} />);
      // data_table renders a <table>; every other type renders an <svg>.
      expect(view.container.querySelector('svg, table')).toBeTruthy();
      expect(diagram.title).toBeTruthy();
      expect(view.container.innerHTML).not.toContain('NaN');
      view.unmount();
    }
  });

  it('renders every authored Specialist Mathematics Unit 4 lesson diagram', () => {
    const curriculumPath = resolve(process.cwd(), '../data/curriculum/qcaa_senior_maths/specialist.json');
    const curriculum = JSON.parse(readFileSync(curriculumPath, 'utf8'));
    const diagrams = curriculum.topics
      .filter((topic: AuthoredTopicFixture) => topic.syllabus_subject === 'specialist' && topic.unit === 4)
      .flatMap((topic: AuthoredTopicFixture) => topic.concept_card.lesson_content.explanation_sections)
      .map((section: ExplanationSectionFixture) => section.diagram)
      .filter(Boolean);

    expect(diagrams.length).toBe(17);
    for (const diagram of diagrams) {
      const view = render(<DiagramRenderer data={diagram} />);
      // data_table renders a <table>; every other type renders an <svg>.
      expect(view.container.querySelector('svg, table')).toBeTruthy();
      expect(diagram.title).toBeTruthy();
      expect(view.container.innerHTML).not.toContain('NaN');
      view.unmount();
    }
  });

  it('renders a logistic slope field with equilibrium lines', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'slope_field',
          title: 'Logistic slope field',
          model: 'logistic',
          rate: 1,
          carrying_capacity: 4,
          x_min: 0,
          x_max: 5,
          y_min: 0,
          y_max: 5,
          x_steps: 6,
          y_steps: 6,
          equilibria: [0, 4],
        }}
      />,
    );
    expect(container.querySelectorAll('line').length).toBeGreaterThan(30);
    expect(container.textContent).toContain('equilibrium y = 4');
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('Logistic slope field');
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders a directed vector on a function graph', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'function_graph',
          title: 'Tangent velocity vector',
          x_min: 0,
          x_max: 3,
          y_min: 0,
          y_max: 3,
          functions: [{ expression: 'x', label: 'path' }],
          points: [{ x: 1, y: 1, label: 'particle' }],
          vectors: [{ from: { x: 1, y: 1 }, to: { x: 2, y: 2 }, label: 'v' }],
        }}
      />,
    );
    expect(container.querySelector('marker')).toBeTruthy();
    expect(container.querySelector('line[marker-end]')).toBeTruthy();
    expect(container.textContent).toContain('v');
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders standalone points with custom positions', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'function_graph',
          title: 'Custom point positions',
          x_min: 0,
          x_max: 3,
          y_min: 0,
          y_max: 3,
          points: [
            { x: 1, y: 1, label: 'P1', pos: 'bottom_left' },
            { x: 2, y: 2, label: 'P2', pos: 'top' },
          ],
        }}
      />,
    );
    expect(container.textContent).toContain('P1');
    expect(container.textContent).toContain('P2');
    expect(container.querySelectorAll('circle').length).toBe(2);
    expect(container.querySelectorAll('text').length).toBeGreaterThanOrEqual(2);
  });

  it('renders construction axes, shaded polygons and angle arcs', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'construction_diagram',
          title: 'Polar sector',
          axes: true,
          points: [
            { id: 'O', x: 0, y: 0 },
            { id: 'A', x: 3, y: 0 },
            { id: 'B', x: 2, y: 2 },
          ],
          polygons: [{ points: ['O', 'A', 'B'], label: 'region' }],
          segments: [{ from: 'O', to: 'B', directed: true }],
          angle_arcs: [{ vertex: 'O', from: 'A', to: 'B', label: 'θ' }],
        }}
      />,
    );
    expect(container.querySelector('polygon')).toBeTruthy();
    expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain('region');
    expect(container.textContent).toContain('θ');
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(3);
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders segments with custom label positions and vertical line heuristics', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'construction_diagram',
          title: 'Segment label positions',
          points: [
            { id: 'A', x: 0, y: 0 },
            { id: 'B', x: 0, y: 3 },
            { id: 'C', x: 3, y: 0 },
          ],
          segments: [
            { from: 'A', to: 'B', label: 'vertical', label_pos: 'right' },
            { from: 'A', to: 'C', label: 'horizontal', label_pos: 'bottom' },
          ],
        }}
      />,
    );
    expect(container.textContent).toContain('vertical');
    expect(container.textContent).toContain('horizontal');
    const texts = Array.from(container.querySelectorAll('text'));
    const verticalText = texts.find(t => t.textContent === 'vertical');
    const horizontalText = texts.find(t => t.textContent === 'horizontal');
    expect(verticalText).toBeTruthy();
    expect(verticalText?.getAttribute('text-anchor')).toBe('start');
    expect(horizontalText).toBeTruthy();
    expect(horizontalText?.getAttribute('text-anchor')).toBe('middle');
  });

  it('renders directed construction arrows and right-angle markers', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'construction_diagram',
          title: 'Projection with direction',
          points: [
            { id: 'O', x: 0, y: 0 },
            { id: 'A', x: 3, y: 2 },
            { id: 'P', x: 3, y: 0 },
          ],
          segments: [
            { from: 'O', to: 'A', label: 'a', directed: true },
            { from: 'O', to: 'P', label: 'projection', directed: true },
            { from: 'A', to: 'P', dashed: true },
          ],
          right_angles: [{ vertex: 'P', along1: 'A', along2: 'O' }],
        }}
      />,
    );
    expect(container.querySelectorAll('line[marker-end]').length).toBe(2);
    expect(container.querySelector('marker')).toBeTruthy();
    expect(container.querySelectorAll('polyline').length).toBe(1);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('Projection with direction');
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders a three-set inclusion-exclusion Venn diagram', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'venn_diagram',
          title: 'Three sets',
          set_a_label: 'A',
          set_b_label: 'B',
          set_c_label: 'C',
          regions: { a_only: 'A only', b_only: 'B only', c_only: 'C only', abc: 'A∩B∩C' },
        }}
      />,
    );
    expect(container.querySelectorAll('circle').length).toBe(3);
    expect(container.textContent).toContain('A∩B∩C');
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders repeated confidence intervals and marks a missed true value', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'confidence_intervals',
          title: 'Repeated 95% intervals',
          true_value: 0.4,
          x_min: 0.2,
          x_max: 0.6,
          intervals: [
            { low: 0.31, high: 0.48, estimate: 0.395 },
            { low: 0.43, high: 0.57, estimate: 0.50 },
          ],
        }}
      />,
    );
    expect(container.textContent).toContain('Repeated 95% intervals');
    expect(container.textContent).toContain('true p');
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('Repeated 95% intervals');
    expect(container.innerHTML).toContain('#dc2626');
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders Venn regions and distinguishes a vertical-line guide from an asymptote', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'venn_diagram',
          title: 'Events A and B',
          regions: { a_only: 'A only', intersection: 'A and B', b_only: 'B only', outside: 'neither' },
        }}
      />,
    );
    expect(container.textContent).toContain('A and B');
    expect(container.querySelectorAll('circle').length).toBe(2);

    const graph = render(
      <DiagramRenderer
        data={{ type: 'function_graph', x_min: -2, x_max: 2, y_min: -2, y_max: 2, functions: ['x'], guides: [{ x: 1, label: 'x = 1 vertical line' }] }}
      />,
    );
    expect(graph.container.textContent).toContain('x = 1 vertical line');
    expect(graph.container.innerHTML).not.toContain('NaN');
  });
});

describe('DiagramRenderer Year 9 maths renderer additions', () => {
  it('tree_diagram renders titled nodes, labelled arrows and stable SVG geometry', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'tree_diagram',
          title: 'Two-stage probability',
          nodes: [
            { id: 'start', label: 'Start', x: 0, y: 0.5 },
            { id: 'h1', label: 'H', x: 0.45, y: 0.25 },
            { id: 't1', label: 'T', x: 0.45, y: 0.75 },
            { id: 'hh', label: 'HH', x: 1, y: 0.15 },
            { id: 'ht', label: 'HT', x: 1, y: 0.35 },
          ],
          links: [
            { from: 'start', to: 'h1', label: '1/2' },
            { from: 'start', to: 't1', label: '1/2' },
            { from: 'h1', to: 'hh', label: '1/2' },
            { from: 'h1', to: 'ht', label: '1/2' },
            { from: 'ghost', to: 'ht', label: 'ignored' },
          ],
        }}
      />,
    );

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 360 240');
    expect(container.textContent).toContain('Two-stage probability');
    expect(container.textContent).toContain('Start');
    expect(container.textContent).toContain('HH');
    expect(container.textContent).not.toContain('ignored');
    expect(container.querySelectorAll('circle').length).toBe(5);
    expect(container.querySelectorAll('line').length).toBe(4);
    expect(container.querySelector('marker')).toBeTruthy();
  });

  it('box_plot renders boxes, whiskers, medians, outliers and axis labels', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'box_plot',
          title: 'Class results',
          x_label: 'Score',
          x_min: 0,
          x_max: 100,
          plots: [
            { label: 'A', min: 42, q1: 55, median: 68, q3: 81, max: 92, outliers: [15] },
            { label: 'B', min: 35, q1: 48, median: 60, q3: 75, max: 88 },
          ],
        }}
      />,
    );

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 360 230');
    expect(container.textContent).toContain('Class results');
    expect(container.textContent).toContain('Score');
    expect(container.textContent).toContain('A');
    expect(container.textContent).toContain('B');
    expect(container.querySelectorAll('rect').length).toBe(2);
    expect(container.querySelectorAll('circle').length).toBe(1);
    const lines = Array.from(container.querySelectorAll('line'));
    expect(lines.length).toBeGreaterThanOrEqual(11);
    expect(lines.some((line) => line.getAttribute('stroke-width') === '2')).toBe(true);
  });

  it('construction_diagram renders compass arcs, constructed segments and labelled points', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'construction_diagram',
          title: 'Perpendicular bisector',
          points: [
            { id: 'A', x: 0, y: 0 },
            { id: 'B', x: 4, y: 0 },
            { id: 'C', x: 2, y: 2.5 },
            { id: 'D', x: 2, y: -2.5 },
          ],
          segments: [
            { from: 'A', to: 'B', label: 'AB' },
            { from: 'C', to: 'D', label: 'bisector' },
            { from: 'missing', to: 'D', label: 'ignored' },
          ],
          circles: [
            { center: 'A', radius: 3, label: 'arc A' },
            { center: 'B', radius: 3, label: 'arc B' },
          ],
        }}
      />,
    );

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 340 250');
    expect(container.textContent).toContain('Perpendicular bisector');
    expect(container.textContent).toContain('arc A');
    expect(container.textContent).toContain('arc B');
    expect(container.textContent).toContain('bisector');
    expect(container.textContent).not.toContain('ignored');
    expect(container.querySelectorAll('line').length).toBe(2);
    expect(container.querySelectorAll('circle').length).toBe(6);
    expect(container.innerHTML).not.toContain('NaN');
  });
});

describe('DiagramRenderer science types', () => {
  it('food_web renders one node per node and one arrow per link', () => {
    const data = {
      type: 'food_web',
      nodes: [
        { id: 'grass', label: 'Grass' },
        { id: 'rabbit', label: 'Rabbit' },
        { id: 'fox', label: 'Fox' },
      ],
      links: [
        { from: 'grass', to: 'rabbit' },
        { from: 'rabbit', to: 'fox' },
      ],
    };
    const { container } = render(<DiagramRenderer data={data} />);
    expect(container.querySelectorAll('circle').length).toBe(3); // one per node
    expect(container.querySelectorAll('line').length).toBe(2);   // one per link
    expect(container.querySelector('marker')).toBeTruthy();      // arrowhead defined
  });

  it('food_web ignores links that reference unknown nodes', () => {
    const data = {
      type: 'food_web',
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ from: 'a', to: 'b' }, { from: 'a', to: 'ghost' }],
    };
    const { container } = render(<DiagramRenderer data={data} />);
    expect(container.querySelectorAll('line').length).toBe(1); // ghost link dropped
  });

  it('particle_model renders one particle per requested count', () => {
    const { container } = render(
      <DiagramRenderer data={{ type: 'particle_model', state: 'solid', particles: 16 }} />,
    );
    expect(container.querySelectorAll('circle').length).toBe(16);
  });

  it('particle_model defaults to 16 particles for gas', () => {
    const { container } = render(
      <DiagramRenderer data={{ type: 'particle_model', state: 'gas' }} />,
    );
    expect(container.querySelectorAll('circle').length).toBe(16);
  });

  it('process_flow renders boxes and arrows for linked steps', () => {
    const data = {
      type: 'process_flow',
      title: 'Energy flow',
      nodes: [
        { id: 'chemical', label: 'Chemical' },
        { id: 'electrical', label: 'Electrical' },
        { id: 'light', label: 'Light' },
      ],
      links: [
        { from: 'chemical', to: 'electrical' },
        { from: 'electrical', to: 'light' },
      ],
    };
    const { container } = render(<DiagramRenderer data={data} />);
    expect(container.querySelectorAll('rect').length).toBe(3);
    expect(container.querySelectorAll('line').length).toBe(2);
    expect(container.querySelector('marker')).toBeTruthy();
  });

  it('process_flow ignores links that reference unknown nodes', () => {
    const data = {
      type: 'process_flow',
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ from: 'a', to: 'b' }, { from: 'a', to: 'missing' }],
    };
    const { container } = render(<DiagramRenderer data={data} />);
    expect(container.querySelectorAll('line').length).toBe(1);
  });

  it('keeps authored dichotomous-key labels separated and wraps long nodes', () => {
    const scienceBank = JSON.parse(
      readFileSync(resolve(process.cwd(), '../data/exercise_7_science.json'), 'utf8'),
    );
    const exercise = scienceBank.find((item: { id?: string }) => item.id === 'science_7_u01_pf_dgm_01');
    expect(exercise?.diagram_data?.type).toBe('process_flow');

    const { container } = render(<DiagramRenderer data={exercise.diagram_data} />);
    expect(container.textContent).toContain('Cannot fly: emu');
    expect(container.querySelectorAll('g[data-process-node]')).toHaveLength(8);

    const branch = container.querySelector('g[data-process-link="feathers->flies"]');
    expect(branch).toBeTruthy();
    const line = branch!.querySelector('line')!;
    const label = branch!.querySelector('text')!;
    const midpointY = (Number(line.getAttribute('y1')) + Number(line.getAttribute('y2'))) / 2;
    expect(Math.abs(Number(label.getAttribute('y')) - midpointY)).toBeGreaterThan(6);
    expect(label.getAttribute('style')).toContain('stroke');

    const longLabel = render(
      <DiagramRenderer
        data={{
          type: 'process_flow',
          nodes: [{ id: 'long', label: 'A very long decision label wrapped' }],
        }}
      />,
    );
    expect(longLabel.container.querySelectorAll('g[data-process-node="long"] text tspan')).toHaveLength(3);
  });

  it('renders every authored process_flow without invalid SVG geometry', () => {
    const processFlows = ['exercise_7_science.json', 'exercise_8_science.json'].flatMap((filename) => {
      const bank = JSON.parse(readFileSync(resolve(process.cwd(), `../data/${filename}`), 'utf8'));
      return bank
        .map((item: { diagram_data?: DiagramFixture | null }) => item.diagram_data)
        .filter((diagram: DiagramFixture | null | undefined) => diagram?.type === 'process_flow');
    });
    expect(processFlows).toHaveLength(26);
    for (const diagram of processFlows) {
      const view = render(<DiagramRenderer data={diagram!} />);
      // data_table renders a <table>; every other type renders an <svg>.
      expect(view.container.querySelector('svg, table')).toBeTruthy();
      expect(view.container.innerHTML).not.toContain('NaN');
      view.unmount();
    }
  });

  it('force_diagram renders an object and one arrow per force', () => {
    const data = {
      type: 'force_diagram',
      object: { label: 'box' },
      surface: true,
      forces: [
        { label: 'push', direction: 'right', magnitude: 40 },
        { label: 'friction', direction: 'left', magnitude: 20 },
      ],
    };
    const { container } = render(<DiagramRenderer data={data} />);
    expect(container.textContent).toContain('box');
    expect(container.textContent).toContain('push 40');
    expect(container.textContent).toContain('friction 20');
    expect(container.querySelectorAll('rect').length).toBe(1);
    expect(container.querySelectorAll('line').length).toBe(3); // surface plus two force arrows
    expect(container.querySelector('marker')).toBeTruthy();
    expect(container.innerHTML).not.toContain('NaN');
  });
});

describe('DiagramRenderer payload edge cases', () => {
  it('renders negative bar values with positive SVG rect heights', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'simple_bar_chart',
          title: 'Temperature change',
          bars: [
            { label: 'midnight', value: -4 },
            { label: 'morning', value: 9 },
          ],
        }}
      />,
    );

    // The accessible name now carries the bar data as well as the title,
    // because bar captions are visually truncated to fit their slot.
    const accessibleName = container.querySelector('svg')?.getAttribute('aria-label') || '';
    expect(accessibleName).toContain('Temperature change');
    expect(accessibleName).toContain('midnight -4');
    expect(accessibleName).toContain('morning 9');
    expect(container.textContent).toContain('Temperature change');
    const rects = Array.from(container.querySelectorAll('rect'));
    expect(rects.length).toBe(2);
    for (const rect of rects) {
      expect(Number(rect.getAttribute('height'))).toBeGreaterThan(0);
    }
    expect(container.textContent).toContain('-4');
  });

  it('thins dense number-line ticks', () => {
    const { container } = render(
      <DiagramRenderer data={{ type: 'number_line', min: 8, max: 42, marks: [{ value: 31, label: 'A' }] }} />,
    );

    const tickLabels = Array.from(container.querySelectorAll('text'))
      .map((node) => node.textContent || '')
      .filter((text) => /^\d+$/.test(text));
    expect(tickLabels.length).toBeLessThanOrEqual(12);
    expect(container.textContent).toContain('A');
  });

  it('wraps long data-table cells at word boundaries', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'data_table',
          title: 'Technique guide',
          headers: ['Pattern', 'Likely technique', 'Check first'],
          rows: [['inner function + derivative', 'substitution', 'du is present']],
        }}
      />,
    );

    expect(container.textContent).toContain('Technique guide');
    // HTML table cells wrap natively, so no manual line splitting is needed:
    // each authored cell value must survive as one intact cell, never split
    // mid-word the way the hand-rolled SVG wrapper could.
    const cellText = Array.from(container.querySelectorAll('td, th')).map((node) => node.textContent || '');
    expect(cellText).toContain('inner function + derivative');
    expect(cellText).toContain('substitution');
    expect(cellText).toContain('du is present');
    expect(cellText.some((text) => /functi$|^on \+/.test(text))).toBe(false);

    const bodyCell = Array.from(container.querySelectorAll('td')).find((node) =>
      node.textContent?.includes('inner'),
    );
    expect(bodyCell?.getAttribute('style')).toContain('font-size: 13px');
    // Row height now comes from cell padding and line-height rather than a
    // computed rect height, so assert the padding contract instead.
    expect(bodyCell?.getAttribute('style')).toContain('padding: 8px 10px');
  });

  it('shows prism length labels passed through right-triangle diagram data', () => {
    const { container } = render(
      <DiagramRenderer data={{ type: 'right_triangle', labels: { base: '4 cm', height: '3 cm', depth: '10 cm' } }} />,
    );

    expect(container.textContent).toContain('length 10 cm');
  });

  it('renders coordinate_plane ticks cleanly without crowding for large ranges', () => {
    const { container } = render(
      <DiagramRenderer
        data={{
          type: 'coordinate_plane',
          points: [
            { x: 0, y: 12, label: '0 GB' },
            { x: 10, y: 47, label: '10 GB' },
          ],
        }}
      />,
    );

    const yTickTexts = Array.from(container.querySelectorAll('text'))
      .map(node => node.textContent || '')
      .filter(text => /^\d+$/.test(text) && Number(text) > 0 && Number(text) <= 47);

    expect(yTickTexts.length).toBeLessThanOrEqual(20);
    expect(container.textContent).toContain('0 GB');
    expect(container.textContent).toContain('10 GB');
  });
});
