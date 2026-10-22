'use client';

import React, { useId } from 'react';
import { compileFunction } from '../lib/function-plot';
import DiagramErrorBoundary from './DiagramErrorBoundary';

/**
 * DiagramRenderer: Renders structured diagram_data as inline SVG.
 * Supports common Year 7-8 math/science diagram types.
 */

interface DiagramData {
  type: string;
  [key: string]: any;
}

/**
 * Smallest font size any SVG branch uses, and the smallest size that stays
 * readable once the drawing is scaled down. `svgStyle` sets `maxWidth: 100%`
 * with an explicit width/height, so a narrow column scales the whole drawing —
 * text included. Measured at a ~290px column that pushed 13px labels to 5.2px
 * on `process_flow` and 5.9px on `number_line`.
 */
const SMALLEST_DIAGRAM_FONT_PX = 13;
const MIN_READABLE_FONT_PX = 9;
/** Never demand more horizontal scrolling than this. */
const MAX_DIAGRAM_FLOOR_PX = 560;

/**
 * Minimum rendered width that keeps the smallest label at or above
 * `MIN_READABLE_FONT_PX`. Below this the container scrolls instead of shrinking
 * the science past legibility.
 */
export function readableWidthFloor(intrinsicWidth: number): number {
  if (!Number.isFinite(intrinsicWidth) || intrinsicWidth <= 0) return 0;
  const requiredScale = MIN_READABLE_FONT_PX / SMALLEST_DIAGRAM_FONT_PX;
  return Math.min(MAX_DIAGRAM_FLOOR_PX, Math.round(intrinsicWidth * requiredScale));
}

/**
 * Every consumer imports the default export, so the local error boundary is
 * applied here rather than at each of the three call sites.
 */
export default function DiagramRenderer({ data }: { data: DiagramData }) {
  return (
    <DiagramErrorBoundary label={typeof data?.type === 'string' ? data.type.replace(/_/g, ' ') : undefined}>
      <DiagramSurface data={data} />
    </DiagramErrorBoundary>
  );
}

function DiagramSurface({ data }: { data: DiagramData }) {
  // The hook stays in the component; the render helper is a plain function.
  const clipId = useId();
  const body = renderDiagramBody(data, clipId);

  // A wide diagram keeps a legible floor and scrolls inside its own frame, so
  // the surrounding page never gains a horizontal scrollbar.
  if (React.isValidElement(body) && body.type === 'svg') {
    const svgProps = body.props as { width?: number | string; style?: React.CSSProperties };
    const floor = readableWidthFloor(Number(svgProps.width));
    if (floor > 0) {
      return (
        <div className="diagram-scroll-frame" style={{ overflowX: 'auto', maxWidth: '100%' }}>
          {React.cloneElement(body as React.ReactElement<{ style?: React.CSSProperties }>, {
            style: { ...svgProps.style, minWidth: `${floor}px` },
          })}
        </div>
      );
    }
  }

  return body;
}

function renderDiagramBody(data: DiagramData, clipId: string) {
  const w = 360;
  const h = 300;
  const pad = 40; // padding for labels
  // SVG text nodes do not pass through MathMarkdown/KaTeX. Normalize all
  // user-visible diagram strings once at the boundary instead of rendering
  // raw `$8\\text{ cm}$` as literal SVG text.
  const diagram = reconcileLegacyDiagramShapes(normalizeDiagramData(data));
  // Same facts the LLM receives, exposed to assistive technology.
  const a11yName = describeDiagram(diagram);

  switch (diagram.type) {

    case 'right_triangle': {
      const availW = w - 2 * pad;
      const availH = h - 2 * pad;
      // Draw to scale when the labels carry numeric side lengths.
      // base -> horizontal leg (bottom), height -> vertical leg (left).
      // Trigonometry items label the legs `adjacent`/`opposite` rather than
      // `base`/`height`, and add an `angle`. Treating them as aliases keeps the
      // triangle drawn to scale and the labels visible
      // (e.g. math_9_graph3_SP01_tangent_triangle_002).
      const baseLabel = diagram.labels?.base ?? diagram.labels?.adjacent;
      const heightLabel = diagram.labels?.height ?? diagram.labels?.opposite;
      let legBase = parseLen(baseLabel);
      let legHeight = parseLen(heightLabel);
      const hyp = parseLen(diagram.labels?.hypotenuse);
      // Recover a missing leg via Pythagoras when the hypotenuse is known.
      if (legBase == null && legHeight != null && hyp != null && hyp > legHeight) {
        legBase = Math.sqrt(hyp * hyp - legHeight * legHeight);
      }
      if (legHeight == null && legBase != null && hyp != null && hyp > legBase) {
        legHeight = Math.sqrt(hyp * hyp - legBase * legBase);
      }
      // Fallback to the original fixed shape if we can't determine both legs.
      let drawnW = availW, drawnH = availH;
      if (legBase != null && legHeight != null && legBase > 0 && legHeight > 0) {
        const scale = Math.min(availW / legBase, availH / legHeight);
        drawnW = legBase * scale;
        drawnH = legHeight * scale;
      }
      const bx = pad, by = h - pad;                  // bottom-left (right angle)
      const cx = pad + drawnW, cy = h - pad;         // bottom-right
      const tx = pad, ty = h - pad - drawnH;         // top-left
      return (
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          <polygon points={`${bx},${by} ${cx},${cy} ${tx},${ty}`} fill="rgba(59,130,246,0.1)" stroke="var(--accent-color)" strokeWidth="2" />
          {/* Right angle marker */}
          <polyline points={`${bx+16},${by} ${bx+16},${by-16} ${bx},${by-16}`} fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" />
          {/* Labels */}
          {baseLabel && (
            <text x={(bx + cx) / 2} y={by + 20} textAnchor="middle" style={labelStyle}>{baseLabel}</text>
          )}
          {heightLabel && (
            <text x={bx - 20} y={(by + ty) / 2} textAnchor="middle" style={labelStyle} transform={`rotate(-90, ${bx - 20}, ${(by + ty) / 2})`}>{heightLabel}</text>
          )}
          {/* Angle marker at the non-right vertex the trig ratio is taken from. */}
          {diagram.labels?.angle && (
            <>
              <path
                d={`M ${cx - 26},${cy} A 26 26 0 0 1 ${cx - 18},${cy - 18}`}
                fill="none"
                stroke="var(--text-secondary)"
                strokeWidth="1.5"
              />
              <text x={cx - 40} y={cy - 10} textAnchor="end" style={labelStyle}>{diagram.labels.angle}</text>
            </>
          )}
          {diagram.labels?.hypotenuse && (
            <text x={(cx + tx) / 2 + 14} y={(cy + ty) / 2} textAnchor="start" style={labelStyle}>{diagram.labels.hypotenuse}</text>
          )}
          {(diagram.labels?.depth || diagram.labels?.length) && (
            <text x={cx + 8} y={by - 6} textAnchor="start" style={{...labelStyle, fontSize: '14px'}}>
              length {diagram.labels.depth || diagram.labels.length}
            </text>
          )}
        </svg>
      );
    }

    case 'triangle': {
      const ax = w / 2, ay = pad;                  // top vertex
      const bx = pad, by = h - pad;               // bottom-left
      const cx = w - pad, cy = h - pad;            // bottom-right
      return (
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          <polygon points={`${ax},${ay} ${bx},${by} ${cx},${cy}`} fill="rgba(59,130,246,0.1)" stroke="var(--accent-color)" strokeWidth="2" />
          {diagram.labels?.base && (
            <text x={(bx + cx) / 2} y={by + 20} textAnchor="middle" style={labelStyle}>{diagram.labels.base}</text>
          )}
          {diagram.labels?.height && (
            <>
              <line x1={w/2} y1={ay} x2={w/2} y2={by} stroke="var(--text-secondary)" strokeWidth="1" strokeDasharray="4" />
              <text x={w/2 + 14} y={(ay + by) / 2} textAnchor="start" style={labelStyle}>{diagram.labels.height}</text>
            </>
          )}
          {/* Vertex labels are authored as either `a` or `A`; angle questions
              such as math_10_core_AC9M10SP01_016 use the uppercase form, which
              previously rendered nothing. */}
          {vertexLabel(diagram.labels, 'a') && (
            <text x={ax} y={ay - 8} textAnchor="middle" style={labelStyle}>{vertexLabel(diagram.labels, 'a')}</text>
          )}
          {vertexLabel(diagram.labels, 'b') && (
            <text x={bx - 10} y={by + 4} textAnchor="end" style={labelStyle}>{vertexLabel(diagram.labels, 'b')}</text>
          )}
          {vertexLabel(diagram.labels, 'c') && (
            <text x={cx + 10} y={cy + 4} textAnchor="start" style={labelStyle}>{vertexLabel(diagram.labels, 'c')}</text>
          )}
          {diagram.labels?.side_a && (
            <text x={(bx + cx) / 2} y={by + 20} textAnchor="middle" style={labelStyle}>{diagram.labels.side_a}</text>
          )}
          {diagram.labels?.side_b && (
            <text x={(ax + cx) / 2 + 12} y={(ay + cy) / 2} textAnchor="start" style={labelStyle}>{diagram.labels.side_b}</text>
          )}
          {diagram.labels?.side_c && (
            <text x={(ax + bx) / 2 - 12} y={(ay + by) / 2} textAnchor="end" style={labelStyle}>{diagram.labels.side_c}</text>
          )}
        </svg>
      );
    }

    case 'rectangle': {
      const rx = pad, ry = pad;
      const rw = w - 2 * pad, rh = h - 2 * pad;
      return (
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          <rect x={rx} y={ry} width={rw} height={rh} fill="rgba(59,130,246,0.1)" stroke="var(--accent-color)" strokeWidth="2" rx="2" />
          {diagram.labels?.width && (
            <text x={w / 2} y={h - pad + 20} textAnchor="middle" style={labelStyle}>{diagram.labels.width}</text>
          )}
          {diagram.labels?.height && (
            <text x={pad - 20} y={h / 2} textAnchor="middle" style={labelStyle} transform={`rotate(-90, ${pad - 20}, ${h / 2})`}>{diagram.labels.height}</text>
          )}
        </svg>
      );
    }

    case 'circle': {
      const cx = w / 2, cy = h / 2;
      const r = Math.min(w, h) / 2 - pad;
      return (
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          <circle cx={cx} cy={cy} r={r} fill="rgba(59,130,246,0.1)" stroke="var(--accent-color)" strokeWidth="2" />
          <line x1={cx} y1={cy} x2={cx + r} y2={cy} stroke="var(--accent-color)" strokeWidth="1.5" />
          <circle cx={cx} cy={cy} r={3} fill="var(--accent-color)" />
          {diagram.labels?.radius && (
            <text x={cx + r / 2} y={cy - 8} textAnchor="middle" style={labelStyle}>{diagram.labels.radius}</text>
          )}
          {diagram.labels?.diameter && (
            <>
              <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="var(--text-secondary)" strokeWidth="1" strokeDasharray="4" />
              <text x={cx} y={cy + 18} textAnchor="middle" style={labelStyle}>{diagram.labels.diameter}</text>
            </>
          )}
        </svg>
      );
    }

    case 'coordinate_plane': {
      const axisW = w - 2 * pad, axisH = h - 2 * pad;
      const points: {x: number, y: number, label?: string}[] = diagram.points || [];
      // An authored window wins over the auto-fit, so a question that frames a
      // specific region gets that region (e.g. math_10_core_AC9M10SP03_016
      // declares -1..5 on both axes).
      const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : null);
      const minX = num(diagram.x_min) ?? Math.min(0, ...points.map(p => p.x));
      const maxX = num(diagram.x_max) ?? Math.max(6, ...points.map(p => p.x));
      const minY = num(diagram.y_min) ?? Math.min(0, ...points.map(p => p.y));
      const maxY = num(diagram.y_max) ?? Math.max(6, ...points.map(p => p.y));
      const spanX = Math.max(1, maxX - minX);
      const spanY = Math.max(1, maxY - minY);
      const scaleX = axisW / spanX;
      const scaleY = axisH / spanY;
      const px = (xValue: number) => pad + (xValue - minX) * scaleX;
      const py = (yValue: number) => pad + (maxY - yValue) * scaleY;
      const ox = px(0);
      const oy = py(0);
      const stepX = chooseTickStep(spanX, 6);
      const stepY = chooseTickStep(spanY, 6);
      const startX = Math.ceil(minX / stepX) * stepX;
      const xTicks: number[] = [];
      for (let x = startX; x <= maxX; x += stepX) {
        xTicks.push(Math.round(x * 1e10) / 1e10);
      }
      const startY = Math.ceil(minY / stepY) * stepY;
      const yTicks: number[] = [];
      for (let y = startY; y <= maxY; y += stepY) {
        yTicks.push(Math.round(y * 1e10) / 1e10);
      }

      return (
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          {/* Axes */}
          <line x1={ox} y1={pad - 10} x2={ox} y2={h - pad + 10} stroke="var(--text-secondary)" strokeWidth="1.5" />
          <line x1={pad - 10} y1={oy} x2={w - pad + 10} y2={oy} stroke="var(--text-secondary)" strokeWidth="1.5" />
          {/* Axis labels */}
          <text x={w - pad + 14} y={oy + 4} style={{...labelStyle, fontSize: '14px'}}>x</text>
          <text x={ox - 4} y={pad - 14} textAnchor="middle" style={{...labelStyle, fontSize: '14px'}}>y</text>
          {/* Grid ticks */}
          {xTicks.map(i => (
            <g key={`tx${i}`}>
              <line x1={px(i)} y1={oy - 3} x2={px(i)} y2={oy + 3} stroke="var(--text-secondary)" strokeWidth="1" />
              <text x={px(i)} y={oy + 16} textAnchor="middle" style={{...labelStyle, fontSize: '13px'}}>{i}</text>
            </g>
          ))}
          {yTicks.map(i => (
            <g key={`ty${i}`}>
              <line x1={ox - 3} y1={py(i)} x2={ox + 3} y2={py(i)} stroke="var(--text-secondary)" strokeWidth="1" />
              <text x={ox - 10} y={py(i) + 4} textAnchor="end" style={{...labelStyle, fontSize: '13px'}}>{i}</text>
            </g>
          ))}
          {/* Points */}
          {points.map((p: any, i) => {
            let labelX = px(p.x);
            let labelY = py(p.y);
            let textAnchor: 'start' | 'middle' | 'end' = 'start';
            
            if (p.hide_dot || p.hideDot) {
              labelY += 4;
              textAnchor = 'middle';
            } else {
              const position = p.position || 'top_right';
              if (position === 'left') {
                labelX -= 8;
                labelY += 4;
                textAnchor = 'end';
              } else if (position === 'right') {
                labelX += 8;
                labelY += 4;
                textAnchor = 'start';
              } else if (position === 'top') {
                labelY -= 8;
                textAnchor = 'middle';
              } else if (position === 'bottom') {
                labelY += 16;
                textAnchor = 'middle';
              } else if (position === 'top_left') {
                labelX -= 8;
                labelY -= 8;
                textAnchor = 'end';
              } else if (position === 'bottom_left') {
                labelX -= 8;
                labelY += 14;
                textAnchor = 'end';
              } else if (position === 'bottom_right') {
                labelX += 8;
                labelY += 14;
                textAnchor = 'start';
              } else {
                labelX += 8;
                labelY -= 8;
                textAnchor = 'start';
              }
            }

            if (typeof p.x_offset === 'number') labelX += p.x_offset;
            if (typeof p.y_offset === 'number') labelY += p.y_offset;
            if (p.align === 'left') textAnchor = 'end';
            if (p.align === 'right') textAnchor = 'start';
            if (p.align === 'center' || p.align === 'middle') textAnchor = 'middle';

            return (
              <g key={i}>
                {!(p.hide_dot || p.hideDot) && <circle cx={px(p.x)} cy={py(p.y)} r={5} fill="var(--accent-color)" />}
                {p.label && (
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor={textAnchor}
                    style={{...labelStyle, fontWeight: '600'}}
                  >
                    {p.label}
                  </text>
                )}
              </g>
            );
          })}
          {/* Connect points if exactly 2 */}
          {points.length === 2 && (
            <line
              x1={px(points[0].x)} y1={py(points[0].y)}
              x2={px(points[1].x)} y2={py(points[1].y)}
              stroke="var(--accent-color)" strokeWidth="1.5" strokeDasharray="6"
            />
          )}
        </svg>
      );
    }

    case 'number_line': {
      const customW = 640;
      const nlPad = 30;
      const min = diagram.min ?? 0;
      const max = diagram.max ?? 10;
      const marks: {value: number, label?: string}[] = diagram.marks || [];
      const range = Math.max(1, max - min);
      const lineW = customW - 2 * nlPad;
      const tickStep = chooseTickStep(range, 8);
      const firstTick = Math.ceil(min / tickStep) * tickStep;
      const tickValues: number[] = [];
      for (let v = firstTick; v <= max + tickStep / 1000; v += tickStep) {
        tickValues.push(roundTick(v));
      }

      return (
        <svg viewBox={`0 0 ${customW} 80`} width={customW} height={80} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          <line x1={nlPad} y1={40} x2={customW - nlPad} y2={40} stroke="var(--text-secondary)" strokeWidth="2" />
          {/* Arrow */}
          <polygon points={`${customW - nlPad},40 ${customW - nlPad - 8},35 ${customW - nlPad - 8},45`} fill="var(--text-secondary)" />
          {/* Ticks */}
          {tickValues.map(v => (
            <g key={v}>
              <line x1={nlPad + ((v - min) / range) * lineW} y1={35} x2={nlPad + ((v - min) / range) * lineW} y2={45} stroke="var(--text-secondary)" strokeWidth="1.5" />
              <text x={nlPad + ((v - min) / range) * lineW} y={60} textAnchor="middle" style={{...labelStyle, fontSize: '13px'}}>{v}</text>
            </g>
          ))}
          {/* Marked points */}
          {marks.map((m, i) => {
            const xPos = nlPad + ((m.value - min) / range) * lineW;
            const isOdd = i % 2 !== 0;
            const textY = isOdd ? 9 : 22;
            const lineY2 = isOdd ? 12 : 25;
            return (
              <g key={i}>
                <circle cx={xPos} cy={40} r={5} fill="var(--accent-color)" />
                {m.label && (
                  <>
                    <line
                      x1={xPos}
                      y1={35}
                      x2={xPos}
                      y2={lineY2}
                      stroke="var(--accent-color)"
                      strokeWidth="0.8"
                      strokeDasharray="2,2"
                    />
                    <text
                      x={xPos}
                      y={textY}
                      textAnchor="middle"
                      style={{ ...labelStyle, fontWeight: '600', fill: 'var(--accent-color)' }}
                    >
                      {m.label}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      );
    }

    case 'rectangular_prism': {
      // Size the prism relative to the canvas so it scales with w/h.
      const rw = Math.round(w * 0.5), rh = Math.round(h * 0.45);
      const dx = Math.round(w * 0.18), dy = -Math.round(h * 0.22);
      const x = Math.round(w / 2 - rw / 2 - dx / 2);
      const y = Math.round(h / 2 - (dy + rh) / 2);
      return (
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          <polygon points={`${x},${y} ${x + dx},${y + dy} ${x + rw + dx},${y + dy} ${x + rw},${y}`} fill="rgba(59,130,246,0.08)" stroke="var(--accent-color)" strokeWidth="1.5" />
          <polygon points={`${x + rw},${y} ${x + rw + dx},${y + dy} ${x + rw + dx},${y + rh + dy} ${x + rw},${y + rh}`} fill="rgba(59,130,246,0.13)" stroke="var(--accent-color)" strokeWidth="1.5" />
          <rect x={x} y={y} width={rw} height={rh} fill="rgba(59,130,246,0.1)" stroke="var(--accent-color)" strokeWidth="2" rx="2" />
          <line x1={x} y1={y + rh} x2={x + dx} y2={y + rh + dy} stroke="var(--accent-color)" strokeWidth="1.5" />
          <line x1={x + dx} y1={y + dy} x2={x + dx} y2={y + rh + dy} stroke="var(--accent-color)" strokeWidth="1.5" />
          <line x1={x + dx} y1={y + rh + dy} x2={x + rw + dx} y2={y + rh + dy} stroke="var(--accent-color)" strokeWidth="1.5" />
          {diagram.labels?.length && <text x={x + rw / 2} y={y + rh + 20} textAnchor="middle" style={labelStyle}>{diagram.labels.length}</text>}
          {diagram.labels?.height && <text x={x - 18} y={y + rh / 2} textAnchor="middle" style={labelStyle} transform={`rotate(-90, ${x - 18}, ${y + rh / 2})`}>{diagram.labels.height}</text>}
          {diagram.labels?.width && <text x={x + rw + dx + 8} y={y + rh / 2 + dy} textAnchor="start" style={labelStyle}>{diagram.labels.width}</text>}
        </svg>
      );
    }

    case 'simple_bar_chart': {
      const bars: {label: string, value: number}[] = diagram.bars || [];
      const chartX = 44, chartY = 32;
      const chartW = w - 72, chartH = h - 82;
      const values = bars.map(b => Number.isFinite(b.value) ? b.value : 0);
      const minValue = Math.min(0, ...values);
      const maxValue = Math.max(0, ...values, 1);
      const spanValue = Math.max(1, maxValue - minValue);
      const yForValue = (value: number) => chartY + ((maxValue - value) / spanValue) * chartH;
      const baselineY = yForValue(0);
      const slot = chartW / Math.max(1, bars.length);
      const barW = Math.min(32, slot * 0.62);

      return (
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          {diagram.title && <text x={w / 2} y={18} textAnchor="middle" style={{...labelStyle, fontWeight: '600'}}>{diagram.title}</text>}
          <line x1={chartX} y1={chartY} x2={chartX} y2={chartY + chartH} stroke="var(--text-secondary)" strokeWidth="1.5" />
          <line x1={chartX} y1={baselineY} x2={chartX + chartW} y2={baselineY} stroke="var(--text-secondary)" strokeWidth="1.5" />
          {bars.map((bar, i) => {
            const value = Number.isFinite(bar.value) ? bar.value : 0;
            const valueY = yForValue(value);
            const bh = Math.max(1, Math.abs(baselineY - valueY));
            const bx = chartX + i * slot + (slot - barW) / 2;
            const by = Math.min(valueY, baselineY);
            const valueLabelY = value >= 0 ? by - 4 : by + bh + 12;
            return (
              <g key={`${bar.label}-${i}`}>
                <rect x={bx} y={by} width={barW} height={bh} fill="rgba(59,130,246,0.55)" stroke="var(--accent-color)" strokeWidth="1" rx="2" />
                <text x={bx + barW / 2} y={valueLabelY} textAnchor="middle" style={{...labelStyle, fontSize: '13px'}}>{value}</text>
                <text x={bx + barW / 2} y={chartY + chartH + 15} textAnchor="middle" style={{...labelStyle, fontSize: '13px'}}>{shortLabel(bar.label, 8)}</text>
              </g>
            );
          })}
          {diagram.y_label && <text x={14} y={chartY + chartH / 2} textAnchor="middle" style={{...labelStyle, fontSize: '13px'}} transform={`rotate(-90, 14, ${chartY + chartH / 2})`}>{diagram.y_label}</text>}
          {diagram.x_label && <text x={chartX + chartW / 2} y={h - 8} textAnchor="middle" style={{...labelStyle, fontSize: '13px'}}>{diagram.x_label}</text>}
        </svg>
      );
    }

    case 'confidence_intervals': {
      const intervals: { low: number; high: number; estimate?: number; label?: string }[] = Array.isArray(diagram.intervals)
        ? diagram.intervals.filter((interval: any) => Number.isFinite(interval?.low) && Number.isFinite(interval?.high))
        : [];
      const trueValue = Number(diagram.true_value);
      const allValues = intervals.flatMap((interval) => [interval.low, interval.high]);
      if (Number.isFinite(trueValue)) allValues.push(trueValue);
      const xMin = Number.isFinite(diagram.x_min) ? Number(diagram.x_min) : Math.min(...allValues, 0);
      const xMax = Number.isFinite(diagram.x_max) ? Number(diagram.x_max) : Math.max(...allValues, 1);
      const span = Math.max(1e-9, xMax - xMin);
      const ciW = 360;
      const left = 54;
      const right = 22;
      const top = diagram.title ? 42 : 20;
      const rowGap = 20;
      const axisY = top + Math.max(1, intervals.length) * rowGap + 8;
      const ciH = axisY + 34;
      const sx = (value: number) => left + ((value - xMin) / span) * (ciW - left - right);
      const ticks = Array.from({ length: 5 }, (_, index) => xMin + (index / 4) * span);

      return (
        <svg
          viewBox={`0 0 ${ciW} ${ciH}`}
          width={ciW}
          height={ciH}
          style={svgStyle}
          role="img"
          aria-label={diagram.title || 'Repeated confidence intervals'}
        >
          <title>{diagram.title || 'Repeated confidence intervals'}</title>
          {diagram.title && <text x={ciW / 2} y={18} textAnchor="middle" style={{ ...labelStyle, fontWeight: '600' }}>{diagram.title}</text>}
          {Number.isFinite(trueValue) && (
            <>
              <line x1={sx(trueValue)} y1={top - 5} x2={sx(trueValue)} y2={axisY} stroke="var(--text-muted, #94a3b8)" strokeWidth="1.5" strokeDasharray="4,4" />
              <text x={sx(trueValue) + 4} y={top - 8} style={{ ...labelStyle, fontSize: '13px' }}>{diagram.parameter_label || (typeof diagram.title === 'string' && (diagram.title.includes('μ') || diagram.title.includes('\u03bc') || diagram.title.toLowerCase().includes('mean')) ? 'true μ' : 'true p')}</text>
            </>
          )}
          {intervals.map((interval, index) => {
            const y = top + index * rowGap + 6;
            const estimate = Number.isFinite(interval.estimate) ? Number(interval.estimate) : (interval.low + interval.high) / 2;
            const misses = Number.isFinite(trueValue) && (trueValue < interval.low || trueValue > interval.high);
            const stroke = misses ? '#dc2626' : 'var(--accent-color)';
            return (
              <g key={`${interval.low}-${interval.high}-${index}`}>
                <text x={left - 8} y={y + 3} textAnchor="end" style={{ ...labelStyle, fontSize: '13px' }}>{interval.label || `S${index + 1}`}</text>
                <line x1={sx(interval.low)} y1={y} x2={sx(interval.high)} y2={y} stroke={stroke} strokeWidth="2" />
                <line x1={sx(interval.low)} y1={y - 4} x2={sx(interval.low)} y2={y + 4} stroke={stroke} strokeWidth="1.5" />
                <line x1={sx(interval.high)} y1={y - 4} x2={sx(interval.high)} y2={y + 4} stroke={stroke} strokeWidth="1.5" />
                <circle cx={sx(estimate)} cy={y} r={3.2} fill={stroke} />
              </g>
            );
          })}
          <line x1={left} y1={axisY} x2={ciW - right} y2={axisY} stroke="var(--text-secondary)" strokeWidth="1.2" />
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={sx(tick)} y1={axisY - 3} x2={sx(tick)} y2={axisY + 3} stroke="var(--text-secondary)" />
              <text x={sx(tick)} y={axisY + 16} textAnchor="middle" style={{ ...labelStyle, fontSize: '12px' }}>{tick.toFixed(2)}</text>
            </g>
          ))}
        </svg>
      );
    }

    case 'pascal_triangle': {
      const rows: Array<Array<number | string>> = Array.isArray(diagram.rows)
        ? diagram.rows.filter((row: unknown) => Array.isArray(row))
        : [];
      const maxCols = Math.max(1, ...rows.map((row) => row.length));
      const cellGap = 42;
      const rowGap = 30;
      const top = diagram.title ? 42 : 22;
      const ptW = Math.max(280, (maxCols - 1) * cellGap + 96);
      const ptH = Math.max(120, top + Math.max(1, rows.length - 1) * rowGap + 38);

      return (
        <svg
          viewBox={`0 0 ${ptW} ${ptH}`}
          width={ptW}
          height={ptH}
          style={svgStyle}
          role="img"
          aria-label={diagram.title || "Pascal's triangle"}
        >
          <title>{diagram.title || "Pascal's triangle"}</title>
          {diagram.title && <text x={ptW / 2} y={18} textAnchor="middle" style={{...labelStyle, fontWeight: '600'}}>{diagram.title}</text>}
          {rows.map((row, rowIndex) => {
            const startX = ptW / 2 - ((row.length - 1) * cellGap) / 2;
            const y = top + rowIndex * rowGap;
            return (
              <g key={`pascal-row-${rowIndex}`}>
                <text x={18} y={y + 4} style={{...labelStyle, fontSize: '12px'}}>n={rowIndex}</text>
                {row.map((value, colIndex) => (
                  <g key={`pascal-${rowIndex}-${colIndex}`}>
                    <circle
                      cx={startX + colIndex * cellGap}
                      cy={y}
                      r={12}
                      fill="rgba(59,130,246,0.12)"
                      stroke="var(--accent-color)"
                      strokeWidth="1"
                    />
                    <text
                      x={startX + colIndex * cellGap}
                      y={y + 4}
                      textAnchor="middle"
                      style={{...labelStyle, fontSize: '13px', fontWeight: '600'}}
                    >
                      {String(value)}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
      );
    }

    case 'data_table': {
      /**
       * Rendered as a real HTML table rather than SVG text.
       *
       * `data_table` is the most common diagram in the banks. As SVG it gave
       * assistive technology a single flat label instead of row/column
       * semantics, could not be selected or copied usefully, relied on a
       * hard-coded 7.2px character-width estimate for line wrapping, and was
       * the worst-scaling diagram on phones (a 560px viewBox squeezed into a
       * ~290px column rendered 13px text at about 6.7px). A table element
       * fixes all four: the browser handles wrapping and reflow, the text is
       * real text, and screen readers announce headers with each cell.
       */
      const headers: string[] = (diagram.headers || []).map((h: unknown) =>
        keepMathExpressionsTogether(formatMathForDiagramText(String(h))),
      );
      const rows: string[][] = (diagram.rows || []).map((row: unknown) =>
        (Array.isArray(row) ? row : [row]).map((cell: unknown) =>
          keepMathExpressionsTogether(formatMathForDiagramText(String(cell))),
        ),
      );
      const formattedTitle = diagram.title ? formatMathForDiagramText(String(diagram.title)) : '';
      const columnCount = Math.max(headers.length, ...rows.map((row) => row.length), 1);

      const cellBase: React.CSSProperties = {
        border: '1px solid var(--border-color)',
        padding: '8px 10px',
        textAlign: 'left',
        verticalAlign: 'top',
        fontSize: '13px',
        lineHeight: 1.45,
        color: 'var(--text-primary)',
      };

      return (
        <figure
          className="diagram-table-figure"
          style={{
            display: 'block',
            margin: '12px auto',
            maxWidth: '100%',
            overflowX: 'auto',
            background: 'rgba(0,0,0,0.15)',
            borderRadius: '8px',
            padding: '8px',
          }}
        >
          <table
            style={{
              borderCollapse: 'collapse',
              width: '100%',
              minWidth: `${Math.min(560, columnCount * 96)}px`,
              fontFamily: 'inherit',
            }}
          >
            {formattedTitle && (
              <caption
                style={{
                  captionSide: 'top',
                  padding: '2px 0 8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  textAlign: 'center',
                }}
              >
                {formattedTitle}
              </caption>
            )}
            {headers.length > 0 && (
              <thead>
                <tr>
                  {headers.map((header, c) => (
                    <th
                      key={c}
                      scope="col"
                      style={{ ...cellBase, fontWeight: 600, background: 'rgba(59,130,246,0.24)' }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={{ ...cellBase, background: 'rgba(59,130,246,0.08)' }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      );
    }

    case 'sample_space_grid': {
      const outcomes: string[] = diagram.outcomes || [];
      const highlight = new Set<string>(diagram.highlight || []);
      const cols = Math.ceil(Math.sqrt(Math.max(1, outcomes.length)));
      const cell = Math.min(42, (w - 48) / cols);
      const rows = Math.ceil(outcomes.length / cols);
      const gridW = cols * cell;
      const startX = (w - gridW) / 2;
      const startY = diagram.title ? 34 : 18;

      return (
        <svg viewBox={`0 0 ${w} ${Math.max(h, startY + rows * cell + 48)}`} width={w} height={Math.max(h, startY + rows * cell + 48)} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          {diagram.title && <text x={w / 2} y={20} textAnchor="middle" style={{...labelStyle, fontWeight: '600'}}>{diagram.title}</text>}
          {outcomes.map((outcome, i) => {
            const x = startX + (i % cols) * cell;
            const y = startY + Math.floor(i / cols) * cell;
            const isHighlighted = highlight.has(outcome);
            return (
              <g key={`${outcome}-${i}`}>
                <rect x={x + 3} y={y + 3} width={cell - 6} height={cell - 6} rx="4" fill={isHighlighted ? 'rgba(34,197,94,0.35)' : 'rgba(59,130,246,0.1)'} stroke={isHighlighted ? 'rgb(34,197,94)' : 'var(--accent-color)'} strokeWidth="1.3" />
                <text x={x + cell / 2} y={y + cell / 2 + 4} textAnchor="middle" style={{...labelStyle, fontWeight: '600'}}>{outcome}</text>
              </g>
            );
          })}
          {diagram.legend && (
            <text x={w / 2} y={startY + rows * cell + 24} textAnchor="middle" style={{...labelStyle, fontSize: '13px'}}>
              {Object.entries(diagram.legend).map(([key, value]) => `${key}=${value}`).join('  ')}
            </text>
          )}
        </svg>
      );
    }

    case 'tree_diagram': {
      const tdW = 360, tdH = 240;
      const nodes: { id: string; label?: string; x?: number; y?: number }[] = Array.isArray(diagram.nodes) ? diagram.nodes : [];
      const links: { from: string; to: string; label?: string }[] = Array.isArray(diagram.links) ? diagram.links : [];
      const pos: Record<string, { x: number; y: number }> = {};
      nodes.forEach((node, index) => {
        const fallbackX = nodes.length <= 1 ? 0.5 : index / Math.max(1, nodes.length - 1);
        pos[node.id] = {
          x: 28 + (typeof node.x === 'number' ? node.x : fallbackX) * (tdW - 56),
          y: 28 + (typeof node.y === 'number' ? node.y : 0.5) * (tdH - 56),
        };
      });
      const markerId = `td-${clipId}`;
      return (
        <svg viewBox={`0 0 ${tdW} ${tdH}`} width={tdW} height={tdH} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          <defs>
            <marker id={markerId} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6 Z" fill="var(--text-secondary)" />
            </marker>
          </defs>
          {diagram.title && <text x={tdW / 2} y={18} textAnchor="middle" style={{...labelStyle, fontWeight: '600'}}>{diagram.title}</text>}
          {links.map((link, index) => {
            const a = pos[link.from], b = pos[link.to];
            if (!a || !b) return null;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            return (
              <g key={`${link.from}-${link.to}-${index}`}>
                <line x1={a.x + 10} y1={a.y} x2={b.x - 10} y2={b.y} stroke="var(--text-secondary)" strokeWidth="1.4" markerEnd={`url(#${markerId})`} />
                {link.label && (
                  <text x={mx} y={my - 5} textAnchor="middle" style={{...labelStyle, fontSize: '13px', fontWeight: '600'}}>
                    {link.label}
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map((node) => {
            const p = pos[node.id];
            if (!p) return null;
            return (
              <g key={node.id}>
                <circle cx={p.x} cy={p.y} r={12} fill="rgba(59,130,246,0.16)" stroke="var(--accent-color)" strokeWidth="1.4" />
                <text x={p.x} y={p.y + 24} textAnchor="middle" style={{...labelStyle, fontSize: '13px', fontWeight: '600'}}>
                  {shortLabel(node.label || node.id, 14)}
                </text>
              </g>
            );
          })}
        </svg>
      );
    }

    case 'venn_diagram': {
      const vdW = 360;
      const regions = diagram.regions && typeof diagram.regions === 'object' ? diagram.regions : {};
      const setA = diagram.set_a_label || 'A';
      const setB = diagram.set_b_label || 'B';
      const setC = diagram.set_c_label || 'C';
      const hasC = Boolean(
        diagram.set_c_label || regions.c_only || regions.ab_only || regions.ac_only || regions.bc_only || regions.abc,
      );
      const vdH = hasC ? 270 : 240;
      return (
        <svg
          viewBox={`0 0 ${vdW} ${vdH}`}
          width={vdW}
          height={vdH}
          style={svgStyle}
          role="img"
          aria-label={diagram.title || 'Venn diagram'}
        >
          <title>{diagram.title || 'Venn diagram'}</title>
          <rect x={22} y={30} width={vdW - 44} height={vdH - 52} rx={8} fill="rgba(59,130,246,0.04)" stroke="var(--text-secondary)" strokeWidth="1.2" />
          {diagram.title && <text x={vdW / 2} y={18} textAnchor="middle" style={{ ...labelStyle, fontWeight: '600' }}>{diagram.title}</text>}
          <text x={32} y={48} style={{ ...labelStyle, fontSize: '13px', fontWeight: '600' }}>{diagram.universe_label || 'Sample space S'}</text>
          {hasC ? (
            <>
              <circle cx={145} cy={125} r={62} fill="rgba(59,130,246,0.17)" stroke="var(--accent-color)" strokeWidth="1.6" />
              <circle cx={215} cy={125} r={62} fill="rgba(16,185,129,0.14)" stroke="#10b981" strokeWidth="1.6" />
              <circle cx={180} cy={170} r={62} fill="rgba(245,158,11,0.13)" stroke="#d97706" strokeWidth="1.6" />
              <text x={105} y={72} textAnchor="middle" style={{ ...labelStyle, fontWeight: '700' }}>{setA}</text>
              <text x={255} y={72} textAnchor="middle" style={{ ...labelStyle, fontWeight: '700' }}>{setB}</text>
              <text x={180} y={237} textAnchor="middle" style={{ ...labelStyle, fontWeight: '700' }}>{setC}</text>
              {regions.a_only && <text x={108} y={119} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px' }}>{shortLabel(regions.a_only, 12)}</text>}
              {regions.b_only && <text x={252} y={119} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px' }}>{shortLabel(regions.b_only, 12)}</text>}
              {regions.c_only && <text x={180} y={204} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px' }}>{shortLabel(regions.c_only, 12)}</text>}
              {regions.ab_only && <text x={180} y={91} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px' }}>{shortLabel(regions.ab_only, 12)}</text>}
              {regions.ac_only && <text x={145} y={158} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px' }}>{shortLabel(regions.ac_only, 12)}</text>}
              {regions.bc_only && <text x={215} y={158} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px' }}>{shortLabel(regions.bc_only, 12)}</text>}
              {regions.abc && <text x={180} y={139} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px', fontWeight: '700' }}>{shortLabel(regions.abc, 12)}</text>}
              {regions.outside && <text x={300} y={244} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px' }}>{shortLabel(regions.outside, 18)}</text>}
            </>
          ) : (
            <>
              <circle cx={146} cy={132} r={70} fill="rgba(59,130,246,0.18)" stroke="var(--accent-color)" strokeWidth="1.6" />
              <circle cx={214} cy={132} r={70} fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth="1.6" />
              <text x={112} y={74} textAnchor="middle" style={{ ...labelStyle, fontWeight: '700' }}>{setA}</text>
              <text x={248} y={74} textAnchor="middle" style={{ ...labelStyle, fontWeight: '700' }}>{setB}</text>
              {regions.a_only && <text x={112} y={136} textAnchor="middle" style={{ ...labelStyle, fontSize: '14px' }}>{shortLabel(regions.a_only, 16)}</text>}
              {regions.intersection && <text x={180} y={136} textAnchor="middle" style={{ ...labelStyle, fontSize: '14px', fontWeight: '600' }}>{shortLabel(regions.intersection, 16)}</text>}
              {regions.b_only && <text x={248} y={136} textAnchor="middle" style={{ ...labelStyle, fontSize: '14px' }}>{shortLabel(regions.b_only, 16)}</text>}
              {regions.outside && <text x={180} y={202} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px' }}>{shortLabel(regions.outside, 28)}</text>}
            </>
          )}
        </svg>
      );
    }

    case 'unit_circle': {
      const specialAngles: { angle: number; label: string }[] = Array.isArray(diagram.special_angles)
        ? diagram.special_angles.filter((item: any) => typeof item?.angle === 'number' && typeof item?.label === 'string')
        : [];
      const denseLabels = specialAngles.length > 10;
      const ucW = denseLabels ? 420 : 310;
      const ucH = denseLabels ? 360 : 270;
      const ucR = denseLabels ? 112 : 84;
      const ucX = ucW / 2;
      const ucY = denseLabels ? 188 : 142;
      const labelRadius = ucR + (denseLabels ? 28 : 19);
      const angle = typeof diagram.angle === 'number' ? diagram.angle : Math.PI / 6;
      const endX = ucX + ucR * Math.cos(angle);
      const endY = ucY - ucR * Math.sin(angle);
      const midAngle = angle / 2;
      const arcR = denseLabels ? 40 : 32;
      const arcEndX = ucX + arcR * Math.cos(angle);
      const arcEndY = ucY - arcR * Math.sin(angle);
      const largeArc = Math.abs(angle) > Math.PI ? 1 : 0;
      return (
        <svg
          viewBox={`0 0 ${ucW} ${ucH}`}
          width={ucW}
          height={ucH}
          style={svgStyle}
          role="img"
          aria-label={diagram.title || 'Unit circle'}
        >
          <title>{diagram.title || 'Unit circle'}</title>
          {diagram.title && <text x={ucW / 2} y={18} textAnchor="middle" style={{ ...labelStyle, fontWeight: '600' }}>{diagram.title}</text>}
          <line x1={ucX - ucR - 18} y1={ucY} x2={ucX + ucR + 18} y2={ucY} stroke="var(--text-secondary)" strokeWidth="1.4" />
          <line x1={ucX} y1={ucY - ucR - 18} x2={ucX} y2={ucY + ucR + 18} stroke="var(--text-secondary)" strokeWidth="1.4" />
          <text x={ucX + ucR + 22} y={ucY + 4} style={{ ...labelStyle, fontSize: '14px' }}>x</text>
          <text x={ucX + 5} y={ucY - ucR - 21} style={{ ...labelStyle, fontSize: '14px' }}>y</text>
          <circle cx={ucX} cy={ucY} r={ucR} fill="rgba(59,130,246,0.08)" stroke="var(--accent-color)" strokeWidth="2" />
          <line x1={ucX} y1={ucY} x2={endX} y2={endY} stroke="#f59e0b" strokeWidth="2" />
          <path d={`M ${ucX + arcR} ${ucY} A ${arcR} ${arcR} 0 ${largeArc} 0 ${arcEndX} ${arcEndY}`} fill="none" stroke="#f59e0b" strokeWidth="1.6" />
          <circle cx={endX} cy={endY} r={4.5} fill="#f59e0b" />
          <text x={ucX + (ucR * 0.54)} y={ucY - 8} textAnchor="middle" style={{ ...labelStyle, fontSize: '14px' }}>{diagram.radius_label || 'r = 1'}</text>
          <text x={ucX + (arcR + 17) * Math.cos(midAngle)} y={ucY - (arcR + 17) * Math.sin(midAngle)} textAnchor="middle" style={{ ...labelStyle, fontWeight: '700' }}>{diagram.angle_label || 'θ'}</text>
          {diagram.coordinate_label && <text x={endX + 9} y={endY - 8} style={{ ...labelStyle, fontSize: '13px', fontWeight: '600' }}>{diagram.coordinate_label}</text>}
          {specialAngles.map((item) => {
            const x = ucX + ucR * Math.cos(item.angle);
            const y = ucY - ucR * Math.sin(item.angle);
            const labelX = ucX + labelRadius * Math.cos(item.angle);
            const labelY = ucY - labelRadius * Math.sin(item.angle) + 4;
            return (
              <g key={`${item.angle}-${item.label}`}>
                <circle cx={x} cy={y} r={3.5} fill="var(--accent-color)" />
                <text x={labelX} y={labelY} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px' }}>{item.label}</text>
              </g>
            );
          })}
        </svg>
      );
    }

    case 'sector': {
      const secW = 310, secH = 245, secX = 142, secY = 150, secR = 88;
      const theta = Math.max(0.1, Math.min(Math.PI * 1.9, typeof diagram.angle === 'number' ? diagram.angle : Math.PI / 3));
      const start = -Math.PI / 2;
      const end = start + theta;
      const endX = secX + secR * Math.cos(end);
      const endY = secY + secR * Math.sin(end);
      const arcR = 34;
      const arcEndX = secX + arcR * Math.cos(end);
      const arcEndY = secY + arcR * Math.sin(end);
      const largeArc = theta > Math.PI ? 1 : 0;
      return (
        <svg
          viewBox={`0 0 ${secW} ${secH}`}
          width={secW}
          height={secH}
          style={svgStyle}
          role="img"
          aria-label={diagram.title || 'Circular sector'}
        >
          <title>{diagram.title || 'Circular sector'}</title>
          {diagram.title && <text x={secW / 2} y={18} textAnchor="middle" style={{ ...labelStyle, fontWeight: '600' }}>{diagram.title}</text>}
          <path d={`M ${secX} ${secY} L ${secX} ${secY - secR} A ${secR} ${secR} 0 ${largeArc} 1 ${endX} ${endY} Z`} fill="rgba(59,130,246,0.16)" stroke="var(--accent-color)" strokeWidth="1.8" />
          <path d={`M ${secX} ${secY - arcR} A ${arcR} ${arcR} 0 ${largeArc} 1 ${arcEndX} ${arcEndY}`} fill="none" stroke="#f59e0b" strokeWidth="1.5" />
          <circle cx={secX} cy={secY} r={3.5} fill="var(--accent-color)" />
          <text x={secX - 16} y={secY - secR / 2} textAnchor="end" style={labelStyle}>{diagram.radius_label || 'r'}</text>
          <text x={secX + (arcR + 16) * Math.cos(start + theta / 2)} y={secY + (arcR + 16) * Math.sin(start + theta / 2)} textAnchor="middle" style={{ ...labelStyle, fontWeight: '700' }}>{diagram.angle_label || 'θ'}</text>
          {diagram.arc_label && <text x={secX + secR * Math.cos(start + theta / 2)} y={secY + secR * Math.sin(start + theta / 2) - 10} textAnchor="middle" style={{ ...labelStyle, fontSize: '14px' }}>{diagram.arc_label}</text>}
        </svg>
      );
    }

    case 'box_plot': {
      const bpW = 360, bpH = 230;
      const plots: { label: string; min: number; q1: number; median: number; q3: number; max: number; outliers?: number[] }[] =
        Array.isArray(diagram.plots) ? diagram.plots : (diagram.min != null ? [{
          label: diagram.label || 'Data',
          min: diagram.min,
          q1: diagram.q1,
          median: diagram.median,
          q3: diagram.q3,
          max: diagram.max,
          outliers: diagram.outliers,
        }] : []);
      const values = plots.flatMap((plot) => [plot.min, plot.q1, plot.median, plot.q3, plot.max, ...(plot.outliers || [])])
        .filter((value) => typeof value === 'number' && Number.isFinite(value));
      const minValue = diagram.x_min ?? Math.min(...values, 0);
      const maxValue = diagram.x_max ?? Math.max(...values, 1);
      const range = Math.max(1, maxValue - minValue);
      const chartX = 48, chartW = bpW - 78;
      const xFor = (value: number) => chartX + ((value - minValue) / range) * chartW;
      const rowGap = Math.min(52, (bpH - 82) / Math.max(1, plots.length));
      const boxH = 22;
      return (
        <svg viewBox={`0 0 ${bpW} ${bpH}`} width={bpW} height={bpH} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          {diagram.title && <text x={bpW / 2} y={18} textAnchor="middle" style={{...labelStyle, fontWeight: '600'}}>{diagram.title}</text>}
          <line x1={chartX} y1={bpH - 34} x2={chartX + chartW} y2={bpH - 34} stroke="var(--text-secondary)" strokeWidth="1.4" />
          {[minValue, (minValue + maxValue) / 2, maxValue].map((value, index) => (
            <g key={index}>
              <line x1={xFor(value)} y1={bpH - 39} x2={xFor(value)} y2={bpH - 29} stroke="var(--text-secondary)" strokeWidth="1" />
              <text x={xFor(value)} y={bpH - 14} textAnchor="middle" style={{...labelStyle, fontSize: '13px'}}>{roundTick(value)}</text>
            </g>
          ))}
          {plots.map((plot, index) => {
            const y = 48 + index * rowGap;
            return (
              <g key={`${plot.label}-${index}`}>
                <text x={38} y={y + 4} textAnchor="end" style={{...labelStyle, fontSize: '13px', fontWeight: '600'}}>{shortLabel(plot.label, 10)}</text>
                <line x1={xFor(plot.min)} y1={y} x2={xFor(plot.max)} y2={y} stroke="var(--text-secondary)" strokeWidth="1.4" />
                <line x1={xFor(plot.min)} y1={y - 9} x2={xFor(plot.min)} y2={y + 9} stroke="var(--text-secondary)" strokeWidth="1.4" />
                <line x1={xFor(plot.max)} y1={y - 9} x2={xFor(plot.max)} y2={y + 9} stroke="var(--text-secondary)" strokeWidth="1.4" />
                <rect x={xFor(plot.q1)} y={y - boxH / 2} width={Math.max(1, xFor(plot.q3) - xFor(plot.q1))} height={boxH} fill="rgba(59,130,246,0.16)" stroke="var(--accent-color)" strokeWidth="1.5" />
                <line x1={xFor(plot.median)} y1={y - boxH / 2} x2={xFor(plot.median)} y2={y + boxH / 2} stroke="var(--accent-color)" strokeWidth="2" />
                {(plot.outliers || []).map((value, outlierIndex) => (
                  <circle key={outlierIndex} cx={xFor(value)} cy={y} r={3.5} fill="none" stroke="#dc2626" strokeWidth="1.4" />
                ))}
              </g>
            );
          })}
          {diagram.x_label && <text x={chartX + chartW / 2} y={bpH - 2} textAnchor="middle" style={{...labelStyle, fontSize: '13px'}}>{diagram.x_label}</text>}
        </svg>
      );
    }

    case 'construction_diagram': {
      const cdW = 340, cdH = 250;
      const constructionArrowId = `${clipId}-construction-arrow`;
      const points: { id: string; label?: string; x: number; y: number; show?: boolean }[] = Array.isArray(diagram.points) ? diagram.points : [];
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const minX = Math.min(...xs, -1), maxX = Math.max(...xs, 1);
      const minY = Math.min(...ys, -1), maxY = Math.max(...ys, 1);
      const spanX = Math.max(1, maxX - minX);
      const spanY = Math.max(1, maxY - minY);
      const scale = Math.min((cdW - 72) / spanX, (cdH - 72) / spanY);
      const px = (xValue: number) => cdW / 2 + (xValue - (minX + maxX) / 2) * scale;
      const py = (yValue: number) => cdH / 2 - (yValue - (minY + maxY) / 2) * scale;
      const pointMap: Record<string, { x: number; y: number; label?: string; show?: boolean }> = {};
      points.forEach((point) => { pointMap[point.id] = point; });
      const segments: { from: string; to: string; label?: string; label_pos?: string; labelPosition?: string; directed?: boolean; dashed?: boolean; color?: string }[] = Array.isArray(diagram.segments) ? diagram.segments : [];
      const circles: { center: string; radius: number; label?: string; dashed?: boolean; color?: string; fill?: string }[] = Array.isArray(diagram.circles) ? diagram.circles : [];
      const polygons: { points: string[]; label?: string; fill?: string; stroke?: string; dashed?: boolean }[] = Array.isArray(diagram.polygons) ? diagram.polygons : [];
      const rightAngles: { vertex: string; along1: string; along2: string; size?: number }[] = Array.isArray(diagram.right_angles) ? diagram.right_angles : [];
      const angleArcs: { vertex: string; from: string; to: string; radius?: number; label?: string; clockwise?: boolean; color?: string }[] = Array.isArray(diagram.angle_arcs) ? diagram.angle_arcs : [];
      return (
        <svg
          viewBox={`0 0 ${cdW} ${cdH}`}
          width={cdW}
          height={cdH}
          style={svgStyle}
          role="img"
          aria-label={diagram.title || 'Construction diagram'}
        >
          <title>{diagram.title || 'Construction diagram'}</title>
          <defs>
            <marker id={constructionArrowId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
            </marker>
          </defs>
          {diagram.title && <text x={cdW / 2} y={18} textAnchor="middle" style={{...labelStyle, fontWeight: '600'}}>{diagram.title}</text>}
          {diagram.axes && (
            <g>
              <line x1={px(minX)} y1={py(0)} x2={px(maxX)} y2={py(0)} stroke="var(--text-secondary)" strokeWidth="1.1" />
              <line x1={px(0)} y1={py(minY)} x2={px(0)} y2={py(maxY)} stroke="var(--text-secondary)" strokeWidth="1.1" />
              <text x={px(maxX) - 4} y={py(0) - 6} textAnchor="end" style={{...labelStyle, fontSize: '13px'}}>{diagram.x_label || 'x'}</text>
              <text x={px(0) + 6} y={py(maxY) + 12} style={{...labelStyle, fontSize: '13px'}}>{diagram.y_label || 'y'}</text>
            </g>
          )}
          {polygons.map((polygon, index) => {
            const vertices = polygon.points.map((id) => pointMap[id]).filter(Boolean);
            if (vertices.length < 3) return null;
            const svgPoints = vertices.map((point) => `${px(point.x)},${py(point.y)}`).join(' ');
            const cx = vertices.reduce((sum, point) => sum + px(point.x), 0) / vertices.length;
            const cy = vertices.reduce((sum, point) => sum + py(point.y), 0) / vertices.length;
            return (
              <g key={`polygon-${index}`}>
                <polygon points={svgPoints} fill={polygon.fill || 'rgba(59,130,246,0.12)'} stroke={polygon.stroke || 'var(--accent-color)'} strokeWidth="1.4" strokeDasharray={polygon.dashed ? '5,4' : undefined} />
                {polygon.label && <text x={cx} y={cy} textAnchor="middle" style={{...labelStyle, fontSize: '13px', fontWeight: '600'}}>{polygon.label}</text>}
              </g>
            );
          })}
          {circles.map((circle, index) => {
            const centre = pointMap[circle.center];
            if (!centre) return null;
            return (
              <g key={`${circle.center}-${index}`}>
                <circle cx={px(centre.x)} cy={py(centre.y)} r={circle.radius * scale} fill={circle.fill || 'none'} stroke={circle.color || 'rgba(59,130,246,0.48)'} strokeWidth="1.3" strokeDasharray={circle.dashed === false ? undefined : '5,4'} />
                {circle.label && <text x={px(centre.x) + circle.radius * scale * 0.7} y={py(centre.y) - circle.radius * scale * 0.7} style={{...labelStyle, fontSize: '13px'}}>{circle.label}</text>}
              </g>
            );
          })}
          {segments.map((segment, index) => {
            const a = pointMap[segment.from], b = pointMap[segment.to];
            if (!a || !b) return null;
            const stroke = segment.color || 'var(--accent-color)';
            
            // Calculate label position
            let lx = (px(a.x) + px(b.x)) / 2;
            const ly = (py(a.y) + py(b.y)) / 2;
            let anchor: 'start' | 'end' | 'middle' = 'middle';
            let dy = -6;
            
            const labelPos = segment.label_pos || segment.labelPosition;
            if (labelPos) {
              switch (labelPos) {
                case 'left':
                  lx -= 6;
                  dy = 3;
                  anchor = 'end';
                  break;
                case 'right':
                  lx += 6;
                  dy = 3;
                  anchor = 'start';
                  break;
                case 'top':
                  dy = -8;
                  anchor = 'middle';
                  break;
                case 'bottom':
                  dy = 14;
                  anchor = 'middle';
                  break;
              }
            } else {
              // Heuristic: for vertical lines, shift the label to the right so the line doesn't cross it
              const dx = Math.abs(px(a.x) - px(b.x));
              const dyLine = Math.abs(py(a.y) - py(b.y));
              if (dx < 5 && dyLine > 10) {
                lx += 6;
                dy = 3;
                anchor = 'start';
              }
            }

            return (
              <g key={`${segment.from}-${segment.to}-${index}`}>
                <line
                  x1={px(a.x)}
                  y1={py(a.y)}
                  x2={px(b.x)}
                  y2={py(b.y)}
                  stroke={stroke}
                  strokeWidth="1.8"
                  strokeDasharray={segment.dashed ? '5,4' : undefined}
                  markerEnd={segment.directed ? `url(#${constructionArrowId})` : undefined}
                />
                {segment.label && (
                  <text
                    x={lx}
                    y={ly + dy}
                    textAnchor={anchor}
                    style={{...labelStyle, fontSize: '13px'}}
                  >
                    {segment.label}
                  </text>
                )}
              </g>
            );
          })}
          {angleArcs.map((arc, index) => {
            const vertex = pointMap[arc.vertex];
            const from = pointMap[arc.from];
            const to = pointMap[arc.to];
            if (!vertex || !from || !to) return null;
            const vx = px(vertex.x), vy = py(vertex.y);
            const dx1 = px(from.x) - vx, dy1 = py(from.y) - vy;
            const dx2 = px(to.x) - vx, dy2 = py(to.y) - vy;
            const len1 = Math.hypot(dx1, dy1) || 1;
            const len2 = Math.hypot(dx2, dy2) || 1;
            const radius = arc.radius || 24;
            const start = { x: vx + (dx1 / len1) * radius, y: vy + (dy1 / len1) * radius };
            const end = { x: vx + (dx2 / len2) * radius, y: vy + (dy2 / len2) * radius };
            const sweep = arc.clockwise ? 1 : 0;
            const labelX = vx + ((dx1 / len1) + (dx2 / len2)) * radius * 0.72;
            const labelY = vy + ((dy1 / len1) + (dy2 / len2)) * radius * 0.72;
            return (
              <g key={`angle-${arc.vertex}-${index}`}>
                <path d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${sweep} ${end.x} ${end.y}`} fill="none" stroke={arc.color || '#f59e0b'} strokeWidth="1.6" />
                {arc.label && <text x={labelX} y={labelY} textAnchor="middle" style={{...labelStyle, fontSize: '13px', fontWeight: '600'}}>{arc.label}</text>}
              </g>
            );
          })}
          {rightAngles.map((marker, index) => {
            const vertex = pointMap[marker.vertex];
            const p1 = pointMap[marker.along1];
            const p2 = pointMap[marker.along2];
            if (!vertex || !p1 || !p2) return null;
            const vx = px(vertex.x), vy = py(vertex.y);
            const dx1 = px(p1.x) - vx, dy1 = py(p1.y) - vy;
            const dx2 = px(p2.x) - vx, dy2 = py(p2.y) - vy;
            const len1 = Math.hypot(dx1, dy1) || 1;
            const len2 = Math.hypot(dx2, dy2) || 1;
            const size = marker.size || 11;
            const q1 = { x: vx + (dx1 / len1) * size, y: vy + (dy1 / len1) * size };
            const q2 = { x: vx + (dx2 / len2) * size, y: vy + (dy2 / len2) * size };
            const corner = { x: q1.x + (dx2 / len2) * size, y: q1.y + (dy2 / len2) * size };
            return <polyline key={`${marker.vertex}-${index}`} points={`${q1.x},${q1.y} ${corner.x},${corner.y} ${q2.x},${q2.y}`} fill="none" stroke="var(--text-secondary)" strokeWidth="1.4" />;
          })}
          {points.filter((point) => point.show !== false).map((point) => (
            <g key={point.id}>
              <circle cx={px(point.x)} cy={py(point.y)} r={4.5} fill="var(--accent-color)" />
              <text x={px(point.x) + 8} y={py(point.y) - 8} style={{...labelStyle, fontWeight: '600'}}>{point.label || point.id}</text>
            </g>
          ))}
        </svg>
      );
    }

    case 'slope_field': {
      const sfW = 340, sfH = 280, sfPad = 42;
      const xMin = diagram.x_min ?? 0, xMax = diagram.x_max ?? 5;
      const yMin = diagram.y_min ?? 0, yMax = diagram.y_max ?? 5;
      const xSteps = Math.max(2, Math.floor(diagram.x_steps ?? 7));
      const ySteps = Math.max(2, Math.floor(diagram.y_steps ?? 7));
      const plotW = sfW - 2 * sfPad, plotH = sfH - 2 * sfPad;
      const sx = (x: number) => sfPad + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * plotW;
      const sy = (y: number) => sfPad + ((yMax - y) / Math.max(1e-9, yMax - yMin)) * plotH;
      const model = String(diagram.model || 'logistic');
      const r = Number(diagram.rate ?? 1);
      const k = Number(diagram.carrying_capacity ?? 4);
      const ambient = Number(diagram.ambient ?? 0);
      const slopeAt = (x: number, y: number) => {
        if (model === 'cooling') return -r * (y - ambient);
        if (model === 'linear_y') return r * y;
        if (model === 'x_plus_y') return x + y;
        return r * y * (1 - y / k);
      };
      const segmentPx = 16;
      const segments: React.ReactNode[] = [];
      for (let yi = 0; yi < ySteps; yi++) {
        const y = yMin + (yi / (ySteps - 1)) * (yMax - yMin);
        for (let xi = 0; xi < xSteps; xi++) {
          const x = xMin + (xi / (xSteps - 1)) * (xMax - xMin);
          const slope = slopeAt(x, y);
          const angle = Math.atan(slope * ((yMax - yMin) / Math.max(1e-9, xMax - xMin)) * (plotW / plotH));
          const dx = (segmentPx / 2) * Math.cos(angle);
          const dy = (segmentPx / 2) * Math.sin(angle);
          segments.push(
            <line
              key={`${xi}-${yi}`}
              x1={sx(x) - dx}
              y1={sy(y) + dy}
              x2={sx(x) + dx}
              y2={sy(y) - dy}
              stroke="var(--accent-color)"
              strokeWidth="1.35"
              strokeLinecap="round"
            />,
          );
        }
      }
      const equilibria: number[] = Array.isArray(diagram.equilibria) ? diagram.equilibria : [];
      return (
        <svg viewBox={`0 0 ${sfW} ${sfH}`} width={sfW} height={sfH} style={svgStyle} role="img" aria-label={diagram.title || 'Slope field'}>
          <title>{diagram.title || 'Slope field'}</title>
          {diagram.title && <text x={sfW / 2} y={18} textAnchor="middle" style={{ ...labelStyle, fontWeight: '600' }}>{diagram.title}</text>}
          <line x1={sfPad} y1={sy(0)} x2={sfPad + plotW} y2={sy(0)} stroke="var(--text-secondary)" strokeWidth="1.2" />
          <line x1={sx(0)} y1={sfPad} x2={sx(0)} y2={sfPad + plotH} stroke="var(--text-secondary)" strokeWidth="1.2" />
          {equilibria.map((value, index) => (
            <g key={`eq-${index}`}>
              <line x1={sfPad} y1={sy(value)} x2={sfPad + plotW} y2={sy(value)} stroke="#f59e0b" strokeWidth="1.2" strokeDasharray="5,4" />
              <text x={sfPad + plotW - 4} y={sy(value) - 5} textAnchor="end" style={{ ...labelStyle, fontSize: '13px', fill: '#f59e0b' }}>equilibrium y = {roundTick(value)}</text>
            </g>
          ))}
          <g>{segments}</g>
          <text x={sfPad + plotW + 4} y={sy(0) + 4} style={{ ...labelStyle, fontSize: '14px' }}>{diagram.x_label || 'x'}</text>
          <text x={sx(0) + 4} y={sfPad - 7} style={{ ...labelStyle, fontSize: '14px' }}>{diagram.y_label || 'y'}</text>
        </svg>
      );
    }

    case 'function_graph': {
      const equalScale = diagram.equal_scale === true;
      const fw = 380, fh = equalScale ? 380 : 340, fpad = 34;
      const xMin = diagram.x_min ?? -5, xMax = diagram.x_max ?? 5;
      /**
       * When the payload declares no y range, fit the window to the data
       * instead of assuming -5..5.
       *
       * Authored science items routinely plot real quantities — a cooling curve
       * from 80 °C, an energy total of 3200 J, a constant at -78.5 — and with a
       * fixed -5..5 window the curve was drawn entirely outside the plot area,
       * so the student saw only axes. Measured across the banks: 3 diagrams
       * rendered completely blank and 9 more showed under 40% of their curve.
       */
      const autoYRange = (): [number, number] => {
        const values: number[] = [];
        const specs = Array.isArray(diagram.functions) ? diagram.functions : [];
        for (const spec of specs) {
          if (spec && typeof spec === 'object' && Array.isArray(spec.points)) {
            for (const point of spec.points) {
              if (typeof point?.y === 'number' && Number.isFinite(point.y)) values.push(point.y);
            }
            continue;
          }
          const sampler = compileFunction(spec);
          if (!sampler) continue;
          for (let i = 0; i <= 80; i++) {
            const x = xMin + ((xMax - xMin) * i) / 80;
            const y = sampler(x);
            if (y !== null && Number.isFinite(y)) values.push(y);
          }
        }
        for (const point of Array.isArray(diagram.points) ? diagram.points : []) {
          if (typeof point?.y === 'number' && Number.isFinite(point.y)) values.push(point.y);
        }
        if (!values.length) return [-5, 5];

        let lo = Math.min(...values);
        let hi = Math.max(...values);
        if (lo === hi) {
          // A constant function still needs a window with height.
          const pad = Math.max(1, Math.abs(lo) * 0.2);
          lo -= pad;
          hi += pad;
        } else {
          const pad = (hi - lo) * 0.1;
          lo -= pad;
          hi += pad;
        }
        // Keep the x-axis in view when the data sits near zero.
        if (lo > 0 && lo <= (hi - lo) * 0.35) lo = 0;
        if (hi < 0 && -hi <= (hi - lo) * 0.35) hi = 0;
        return [lo, hi];
      };

      const explicitY = diagram.y_min !== undefined || diagram.y_max !== undefined;
      const [fittedYMin, fittedYMax] = explicitY ? [0, 0] : autoYRange();
      const yMin = diagram.y_min ?? (explicitY ? -5 : fittedYMin);
      const yMax = diagram.y_max ?? (explicitY ? 5 : fittedYMax);
      const plotW = fw - 2 * fpad, plotH = fh - 2 * fpad;
      const spanX = (xMax - xMin) || 1;
      const spanY = (yMax - yMin) || 1;
      const sx = (x: number) => fpad + ((x - xMin) / spanX) * plotW;
      const sy = (y: number) => fpad + ((yMax - y) / spanY) * plotH;
      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
      // Axes sit at the origin when 0 is in range, otherwise at the nearest edge.
      const axisX = clamp(sx(0), fpad, fpad + plotW);
      const axisY = clamp(sy(0), fpad, fpad + plotH);
      const palette = ['var(--accent-color)', '#16a34a', '#dc2626', '#d97706', '#8b5cf6'];

      const intTicks = (lo: number, hi: number, customStep?: number) => {
        const range = hi - lo;
        if (range <= 0) return [];
        
        let step;
        if (customStep != null && customStep > 0) {
          step = customStep;
        } else {
          // Dynamic step calculation to prevent crowded/overlapping ticks
          const targetTicks = 6;
          const rawStep = range / targetTicks;
          const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
          const normalized = rawStep / magnitude;
          
          let stepMultiplier;
          if (normalized < 1.5) stepMultiplier = 1;
          else if (normalized < 3) stepMultiplier = 2;
          else if (normalized < 7.5) stepMultiplier = 5;
          else stepMultiplier = 10;
          
          step = stepMultiplier * magnitude;
        }
        
        const out: number[] = [];
        const start = Math.ceil(lo / step) * step;
        for (let val = start; val <= hi; val += step) {
          const roundedVal = Math.round(val * 1e10) / 1e10;
          if (roundedVal !== 0 && roundedVal >= lo && roundedVal <= hi) {
            out.push(roundedVal);
          }
        }
        return out;
      };

      const namedTicks = (raw: any, fallback: () => number[]) => {
        if (Array.isArray(raw)) {
          const parsed = raw
            .map((tick: any) => {
              if (typeof tick === 'number') return { value: tick, label: String(tick) };
              if (tick && typeof tick.value === 'number') {
                return { value: tick.value, label: typeof tick.label === 'string' ? tick.label : String(tick.value) };
              }
              return null;
            })
            .filter((tick: { value: number; label: string } | null): tick is { value: number; label: string } => tick !== null);
          if (parsed.length) return parsed;
        }
        return fallback().map((value) => ({ value, label: String(value) }));
      };
      const xTicks = namedTicks(diagram.x_ticks, () => intTicks(xMin, xMax, diagram.x_step));
      const yTicks = namedTicks(diagram.y_ticks, () => intTicks(yMin, yMax, diagram.y_step));
      const authoredFeatures = functionGraphFeaturePrimitives(diagram.features);

      const evalFnPoints = (fn: any): string => {
        if (Array.isArray(fn.points) && fn.points.length) {
          return fn.points.map((p: any, i: number) => `${i === 0 ? 'M' : 'L'}${sx(p.x)},${sy(p.y)}`).join(' ');
        }
        return '';
      };

      // Build an SVG path for one function spec: either author-supplied
      // sampled points, or a compiled expression/kind sampled across the
      // x-window (exp, log, trig, rational, normal pdf, polynomials, …).
      const buildPath = (fn: any): string => {
        const pointPath = evalFnPoints(fn);
        if (pointPath) return pointPath;
        const sampler = compileFunction(fn);
        if (!sampler) return '';
        const N = 160;
        const cmds: string[] = [];
        let started = false;
        for (let i = 0; i <= N; i++) {
          const x = xMin + (i / N) * spanX;
          const y = sampler(x);
          if (y === null || !isFinite(y)) { started = false; continue; }
          // Drop points well outside the vertical window (e.g. near asymptotes).
          if (y < yMin - spanY || y > yMax + spanY) { started = false; continue; }
          cmds.push(`${started ? 'L' : 'M'}${sx(x)},${sy(clamp(y, yMin - spanY, yMax + spanY))}`);
          started = true;
        }
        return cmds.join(' ');
      };

      const fns: any[] = Array.isArray(diagram.functions) ? diagram.functions : [];
      const explicitPoints: { x: number; y: number; label?: string; open?: boolean; hide_dot?: boolean; hideDot?: boolean; pos?: string; position?: string }[] = Array.isArray(diagram.points) ? diagram.points : [];
      const pts: { x: number; y: number; label?: string; open?: boolean; hide_dot?: boolean; hideDot?: boolean; pos?: string; position?: string }[] = [...explicitPoints, ...authoredFeatures.points];
      const vectors: { from: { x: number; y: number }; to: { x: number; y: number }; label?: string; color?: string }[] = Array.isArray(diagram.vectors) ? diagram.vectors : [];
      const functionArrowId = `${clipId}-function-arrow`;
      const explicitAsymptotes: { x?: number; y?: number; label?: string }[] = Array.isArray(diagram.asymptotes) ? diagram.asymptotes : [];
      const asymptotes = [...explicitAsymptotes, ...authoredFeatures.asymptotes];
      const guides: { x?: number; y?: number; label?: string; dashed?: boolean }[] = Array.isArray(diagram.guides) ? diagram.guides : [];
      const shaded: { fn?: number; to_fn?: number; from: number; to: number; color?: string }[] = Array.isArray(diagram.shaded) ? diagram.shaded : [];

      // Filled region between functions[region.fn] and either
      // functions[region.to_fn] or the x-axis, over x in [from, to]
      // (definite-integral / area-between-curves visuals).
      const buildShade = (region: any): string => {
        const top = compileFunction(fns[region.fn ?? 0]);
        if (!top) return '';
        const bottom = region.to_fn != null ? compileFunction(fns[region.to_fn]) : null;
        const a = Math.max(xMin, Math.min(region.from, region.to));
        const b = Math.min(xMax, Math.max(region.from, region.to));
        if (!(b > a)) return '';
        const steps = 80;
        const yc = (y: number | null) => (y === null || !isFinite(y) ? null : clamp(y, yMin - spanY, yMax + spanY));
        const up: string[] = [];
        for (let i = 0; i <= steps; i++) {
          const x = a + (i / steps) * (b - a);
          const y = yc(top(x));
          if (y === null) return '';
          up.push(`${i === 0 ? 'M' : 'L'}${sx(x)},${sy(y)}`);
        }
        const down: string[] = [];
        for (let i = steps; i >= 0; i--) {
          const x = a + (i / steps) * (b - a);
          const y = yc(bottom ? bottom(x) : 0);
          if (y === null) return '';
          down.push(`L${sx(x)},${sy(y)}`);
        }
        return up.join(' ') + ' ' + down.join(' ') + ' Z';
      };

      return (
        <svg viewBox={`0 0 ${fw} ${fh}`} width={fw} height={fh} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          <defs>
            <clipPath id={`fg-${clipId}`}>
              <rect x={fpad} y={fpad} width={plotW} height={plotH} />
            </clipPath>
            <marker id={functionArrowId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
            </marker>
          </defs>
          {/* Gridlines + ticks */}
          {xTicks.map((tick) => (
            <g key={`gx${tick.value}`}>
              <line x1={sx(tick.value)} y1={fpad} x2={sx(tick.value)} y2={fpad + plotH} stroke="var(--border-color, rgba(255,255,255,0.08))" strokeWidth="0.6" />
              <text x={sx(tick.value)} y={axisY + 13} textAnchor="middle" style={{ ...labelStyle, fontSize: '12px' }}>{tick.label}</text>
            </g>
          ))}
          {yTicks.map((tick) => (
            <g key={`gy${tick.value}`}>
              <line x1={fpad} y1={sy(tick.value)} x2={fpad + plotW} y2={sy(tick.value)} stroke="var(--border-color, rgba(255,255,255,0.08))" strokeWidth="0.6" />
              <text x={axisX - 6} y={sy(tick.value) + 3} textAnchor="end" style={{ ...labelStyle, fontSize: '12px' }}>{tick.label}</text>
            </g>
          ))}
          <line x1={axisX} y1={fpad} x2={axisX} y2={fpad + plotH} stroke="var(--text-secondary)" strokeWidth="1.4" />
          <line x1={fpad} y1={axisY} x2={fpad + plotW} y2={axisY} stroke="var(--text-secondary)" strokeWidth="1.4" />
          {/* Origin zero coordinate */}
          {xMin < 0 && xMax > 0 && yMin < 0 && yMax > 0 && (
            <text x={axisX - 7} y={axisY + 11} textAnchor="end" style={{ ...labelStyle, fontSize: '12px', fill: 'var(--text-secondary)' }}>0</text>
          )}
          <text x={fpad + plotW + 2} y={axisY + 4} style={{ ...labelStyle, fontSize: '14px' }}>{diagram.x_label || 'x'}</text>
          <text x={axisX + 4} y={fpad - 6} style={{ ...labelStyle, fontSize: '14px' }}>{diagram.y_label || 'y'}</text>
          {/* Asymptotes (dashed reference lines) */}
          {asymptotes.map((as, i) => {
            if (typeof as.x === 'number') {
              return (
                <g key={`asx${i}`}>
                  <line x1={sx(as.x)} y1={fpad} x2={sx(as.x)} y2={fpad + plotH} stroke="var(--text-muted, #94a3b8)" strokeWidth="1" strokeDasharray="4,4" />
                  {as.label && <text x={sx(as.x) + 5} y={fpad + 12} style={{ ...labelStyle, fontSize: '12px', fill: 'var(--text-muted, #94a3b8)' }}>{as.label}</text>}
                </g>
              );
            }
            if (typeof as.y === 'number') {
              return (
                <g key={`asy${i}`}>
                  <line x1={fpad} y1={sy(as.y)} x2={fpad + plotW} y2={sy(as.y)} stroke="var(--text-muted, #94a3b8)" strokeWidth="1" strokeDasharray="4,4" />
                  {as.label && <text x={fpad + 5} y={sy(as.y) - 5} style={{ ...labelStyle, fontSize: '12px', fill: 'var(--text-muted, #94a3b8)' }}>{as.label}</text>}
                </g>
              );
            }
            return null;
          })}
          {/* Reference guides (for example, a vertical-line test) are not asymptotes. */}
          {guides.map((guide, i) => {
            const dash = guide.dashed === false ? undefined : '3,3';
            if (typeof guide.x === 'number') {
              return (
                <g key={`guide-x${i}`}>
                  <line x1={sx(guide.x)} y1={fpad} x2={sx(guide.x)} y2={fpad + plotH} stroke="#f59e0b" strokeWidth="1.2" strokeDasharray={dash} />
                  {guide.label && <text x={sx(guide.x) + 5} y={fpad + 12} style={{ ...labelStyle, fontSize: '13px', fill: '#f59e0b', fontWeight: '600' }}>{guide.label}</text>}
                </g>
              );
            }
            if (typeof guide.y === 'number') {
              return (
                <g key={`guide-y${i}`}>
                  <line x1={fpad} y1={sy(guide.y)} x2={fpad + plotW} y2={sy(guide.y)} stroke="#f59e0b" strokeWidth="1.2" strokeDasharray={dash} />
                  {guide.label && <text x={fpad + 5} y={sy(guide.y) - 5} style={{ ...labelStyle, fontSize: '13px', fill: '#f59e0b', fontWeight: '600' }}>{guide.label}</text>}
                </g>
              );
            }
            return null;
          })}
          {/* Shaded regions (area under / between curves) */}
          <g clipPath={`url(#fg-${clipId})`}>
            {shaded.map((region, i) => {
              const d = buildShade(region);
              if (!d) return null;
              return <path key={`sh${i}`} d={d} fill={region.color || 'rgba(59,130,246,0.18)'} stroke="none" />;
            })}
          </g>
          {/* Function curves (clipped to plot area) */}
          <g clipPath={`url(#fg-${clipId})`}>
            {fns.map((fn, i) => {
              const d = buildPath(fn);
              if (!d) return null;
              const stroke = (fn && typeof fn === 'object' && fn.color) ? fn.color : palette[i % palette.length];
              const dash = (fn && typeof fn === 'object' && fn.dashed) ? '5,4' : undefined;
              return <path key={i} d={d} fill="none" stroke={stroke} strokeWidth="2" strokeDasharray={dash} />;
            })}
          </g>
          {/* Directed vectors such as tangent velocity arrows. */}
          {vectors.map((vector, i) => {
            const stroke = vector.color || '#dc2626';
            const midX = (sx(vector.from.x) + sx(vector.to.x)) / 2;
            const midY = (sy(vector.from.y) + sy(vector.to.y)) / 2;
            return (
              <g key={`vector-${i}`}>
                <line
                  x1={sx(vector.from.x)}
                  y1={sy(vector.from.y)}
                  x2={sx(vector.to.x)}
                  y2={sy(vector.to.y)}
                  stroke={stroke}
                  strokeWidth="2"
                  markerEnd={`url(#${functionArrowId})`}
                />
                {vector.label && <text x={midX} y={midY - 7} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px', fill: stroke, fontWeight: '600' }}>{vector.label}</text>}
              </g>
            );
          })}
          {/* Standalone plotted points (filled, or open circles for excluded endpoints) */}
          {pts.map((p, i) => {
            const pos = p.pos || p.position || 'top_right';
            let dx = 7;
            let dy = -7;
            let anchor: 'start' | 'end' | 'middle' = 'start';
            
            if (p.hide_dot || p.hideDot) {
              dx = 0;
              dy = 4;
              anchor = 'middle';
            } else {
              switch (pos) {
                case 'left':
                  dx = -7;
                  dy = 3;
                  anchor = 'end';
                  break;
                case 'right':
                  dx = 7;
                  dy = 3;
                  anchor = 'start';
                  break;
                case 'top':
                  dx = 0;
                  dy = -8;
                  anchor = 'middle';
                  break;
                case 'bottom':
                  dx = 0;
                  dy = 12;
                  anchor = 'middle';
                  break;
                case 'top_left':
                  dx = -7;
                  dy = -7;
                  anchor = 'end';
                  break;
                case 'bottom_left':
                  dx = -7;
                  dy = 12;
                  anchor = 'end';
                  break;
                case 'bottom_right':
                  dx = 7;
                  dy = 12;
                  anchor = 'start';
                  break;
                case 'top_right':
                default:
                  dx = 7;
                  dy = -7;
                  anchor = 'start';
                  break;
              }
            }
            
            return (
              <g key={`p${i}`}>
                {!(p.hide_dot || p.hideDot) && <circle cx={sx(p.x)} cy={sy(p.y)} r={4} fill={p.open ? 'var(--card-bg, #0b1220)' : 'var(--accent-color)'} stroke="var(--accent-color)" strokeWidth={p.open ? 1.5 : 0} />}
                {p.label && (
                  <text
                    x={sx(p.x) + dx}
                    y={sy(p.y) + dy}
                    textAnchor={anchor}
                    style={{ ...labelStyle, fontWeight: '600' }}
                  >
                    {p.label}
                  </text>
                )}
              </g>
            );
          })}
          {fns.some((fn) => fn && typeof fn === 'object' && fn.label) && (
            <g>
              {fns.map((fn, i) => {
                if (fn && typeof fn === 'object' && fn.label) {
                  const isAxisOnLeft = axisX < (fpad + plotW / 2);
                  let legendX = isAxisOnLeft ? (fpad + plotW - 8) : (fpad + 8);
                  let anchor: 'start' | 'end' | 'middle' | 'inherit' = isAxisOnLeft ? 'end' : 'start';
                  let legendY = fpad + 12 + i * 13;

                  const labelledFns = fns.filter(f => f && typeof f === 'object' && f.label);
                  const labelIndex = labelledFns.indexOf(fn);

                  if (diagram.legend_position === 'top_left') {
                    legendX = fpad + 8;
                    anchor = 'start';
                    legendY = fpad + 12 + labelIndex * 13;
                  } else if (diagram.legend_position === 'top_right') {
                    legendX = fpad + plotW - 8;
                    anchor = 'end';
                    legendY = fpad + 12 + labelIndex * 13;
                  } else if (diagram.legend_position === 'bottom_left') {
                    legendX = fpad + 8;
                    anchor = 'start';
                    legendY = fpad + plotH - 12 - (labelledFns.length - 1 - labelIndex) * 13;
                  } else if (diagram.legend_position === 'bottom_right') {
                    legendX = fpad + plotW - 8;
                    anchor = 'end';
                    legendY = fpad + plotH - 12 - (labelledFns.length - 1 - labelIndex) * 13;
                  } else if (diagram.legend_position === 'above_x_axis') {
                    legendX = isAxisOnLeft ? (fpad + plotW - 8) : (fpad + 8);
                    anchor = isAxisOnLeft ? 'end' : 'start';
                    legendY = axisY - 12 - (labelledFns.length - 1 - labelIndex) * 13;
                  }

                  return (
                    <text
                      key={`l${i}`}
                      x={legendX}
                      y={legendY}
                      textAnchor={anchor}
                      style={{
                        ...labelStyle,
                        fontSize: '13px',
                        fill: (fn.color || palette[i % palette.length]),
                        fontWeight: '600'
                      }}
                    >
                      {fn.label}
                    </text>
                  );
                }
                return null;
              })}
            </g>
          )}
        </svg>
      );
    }

    case 'food_web': {
      // Nodes carry optional normalized {x,y} in [0,1]; otherwise auto-laid out
      // around a circle. Arrows point from prey -> predator (energy flow).
      const fwW = 300, fwH = 240, m = 34;
      const nodes: { id: string; label?: string; x?: number; y?: number }[] = Array.isArray(diagram.nodes) ? diagram.nodes : [];
      const links: { from: string; to: string }[] = Array.isArray(diagram.links) ? diagram.links : [];
      const n = Math.max(1, nodes.length);
      const pos: Record<string, { x: number; y: number }> = {};
      nodes.forEach((nd, i) => {
        if (typeof nd.x === 'number' && typeof nd.y === 'number') {
          pos[nd.id] = { x: m + nd.x * (fwW - 2 * m), y: m + nd.y * (fwH - 2 * m) };
        } else {
          const a = (2 * Math.PI * i) / n - Math.PI / 2;
          pos[nd.id] = { x: fwW / 2 + Math.cos(a) * (fwW / 2 - m), y: fwH / 2 + Math.sin(a) * (fwH / 2 - m) };
        }
      });
      const R = 16;
      const aid = `aw-${clipId}`;
      return (
        <svg viewBox={`0 0 ${fwW} ${fwH}`} width={fwW} height={fwH} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          <defs>
            <marker id={aid} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6 Z" fill="var(--text-secondary)" />
            </marker>
          </defs>
          {links.map((lk, i) => {
            const a = pos[lk.from], b = pos[lk.to];
            if (!a || !b) return null;
            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            // trim the segment to the node circle edges so the arrowhead sits outside
            const ax = a.x + (dx / len) * R, ay = a.y + (dy / len) * R;
            const bx = b.x - (dx / len) * (R + 4), by = b.y - (dy / len) * (R + 4);
            return <line key={i} x1={ax} y1={ay} x2={bx} y2={by} stroke="var(--text-secondary)" strokeWidth="1.4" markerEnd={`url(#${aid})`} />;
          })}
          {nodes.map((nd) => {
            const p = pos[nd.id];
            if (!p) return null;
            return (
              <g key={nd.id}>
                <circle cx={p.x} cy={p.y} r={R} fill="rgba(34,197,94,0.18)" stroke="var(--accent-color)" strokeWidth="1.5" />
                <text x={p.x} y={p.y + R + 11} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px' }}>{nd.label || nd.id}</text>
              </g>
            );
          })}
        </svg>
      );
    }

    case 'particle_model': {
      // Deterministic particle layout for solid / liquid / gas.
      const pmW = 240, pmH = 200, pmPad = 24;
      const state = String(diagram.state || 'solid').toLowerCase();
      const count = typeof diagram.particles === 'number' ? diagram.particles : 16;
      const innerW = pmW - 2 * pmPad, innerH = pmH - 2 * pmPad;
      // deterministic pseudo-random in [0,1)
      const rnd = (k: number) => {
        const v = Math.sin((k + 1) * 12.9898) * 43758.5453;
        return v - Math.floor(v);
      };
      const pts: { x: number; y: number }[] = [];
      if (state === 'solid') {
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        for (let i = 0; i < count; i++) {
          const c = i % cols, r = Math.floor(i / cols);
          pts.push({ x: pmPad + ((c + 0.5) / cols) * innerW, y: pmPad + ((r + 0.5) / rows) * innerH });
        }
      } else if (state === 'liquid') {
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        for (let i = 0; i < count; i++) {
          const c = i % cols, r = Math.floor(i / cols);
          const jx = (rnd(i) - 0.5) * (innerW / cols) * 0.8;
          const jy = (rnd(i + 99) - 0.5) * (innerH / rows) * 0.6;
          // settle liquid toward the lower half of the container
          pts.push({ x: pmPad + ((c + 0.5) / cols) * innerW + jx, y: pmPad + innerH * 0.45 + ((r + 0.5) / rows) * innerH * 0.5 + jy });
        }
      } else { // gas
        for (let i = 0; i < count; i++) {
          pts.push({ x: pmPad + rnd(i) * innerW, y: pmPad + rnd(i + 50) * innerH });
        }
      }
      const pr = 7;
      return (
        <svg viewBox={`0 0 ${pmW} ${pmH + (diagram.label ? 16 : 0)}`} width={pmW} height={pmH + (diagram.label ? 16 : 0)} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          <rect x={pmPad - 8} y={pmPad - 8} width={innerW + 16} height={innerH + 16} fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" rx="3" />
          {pts.map((p, i) => (
            <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={pr} fill="rgba(59,130,246,0.55)" stroke="var(--accent-color)" strokeWidth="1" />
          ))}
          <text x={pmW / 2} y={pmH + 11} textAnchor="middle" style={{ ...labelStyle, fontSize: '14px', fontWeight: '600' }}>
            {diagram.label || state.charAt(0).toUpperCase() + state.slice(1)}
          </text>
        </svg>
      );
    }

    case 'process_flow': {
      const pfW = 720, pfH = 360;
      const marginX = 60, marginY = 48;
      const nodes: { id: string; label?: string; x?: number; y?: number }[] = Array.isArray(diagram.nodes) ? diagram.nodes : [];
      const links: { from: string; to: string; label?: string }[] = Array.isArray(diagram.links) ? diagram.links : [];
      const nodeLayouts = new Map<string, { width: number; height: number; lines: string[] }>();
      const nodeLineHeight = 13;
      const labelWithHalo = {
        ...labelStyle,
        fontSize: '13px',
        paintOrder: 'stroke' as const,
        stroke: 'var(--bg-primary, #f1f5f9)',
        strokeWidth: 4,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
      };

      nodes.forEach((node) => {
        const lines = wrapSvgLabel(node.label || node.id, 18);
        const longestLine = Math.max(...lines.map(line => line.length), 1);
        nodeLayouts.set(node.id, {
          lines,
          width: Math.max(90, Math.min(160, longestLine * 6.5 + 16)),
          height: Math.max(34, lines.length * nodeLineHeight + 12),
        });
      });

      const pos: Record<string, { x: number; y: number }> = {};
      const n = Math.max(1, nodes.length);
      nodes.forEach((nd, i) => {
        if (typeof nd.x === 'number' && typeof nd.y === 'number') {
          pos[nd.id] = {
            x: marginX + nd.x * (pfW - 2 * marginX),
            y: marginY + nd.y * (pfH - 2 * marginY),
          };
        } else {
          const x = marginX + (i / Math.max(1, n - 1)) * (pfW - 2 * marginX);
          pos[nd.id] = { x, y: pfH / 2 };
        }
      });
      const aid = `pf-${clipId}`;
      const edgePoint = (
        nodePos: { x: number; y: number },
        otherPos: { x: number; y: number },
        nw: number,
        nh: number,
        inset: number
      ) => {
        const dx = otherPos.x - nodePos.x, dy = otherPos.y - nodePos.y;
        const scale = Math.min(
          Math.abs(dx) > 0 ? (nw / 2 + inset) / Math.abs(dx) : Infinity,
          Math.abs(dy) > 0 ? (nh / 2 + inset) / Math.abs(dy) : Infinity,
        );
        const t = Number.isFinite(scale) ? scale : 0;
        return { x: nodePos.x + dx * t, y: nodePos.y + dy * t };
      };

      return (
        <svg viewBox={`0 0 ${pfW} ${pfH}`} width={pfW} height={pfH} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          <defs>
            <marker id={aid} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6 Z" fill="var(--text-secondary)" />
            </marker>
          </defs>
          {diagram.title && <text x={pfW / 2} y={24} textAnchor="middle" style={{ ...labelStyle, fontWeight: '600' }}>{diagram.title}</text>}
          {links.map((lk, i) => {
            const a = pos[lk.from], b = pos[lk.to];
            if (!a || !b) return null;

            const layoutA = nodeLayouts.get(lk.from) || { width: 90, height: 34, lines: [] };
            const layoutB = nodeLayouts.get(lk.to) || { width: 90, height: 34, lines: [] };
            const start = edgePoint(a, b, layoutA.width, layoutA.height, 4);
            const end = edgePoint(b, a, layoutB.width, layoutB.height, 10);
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.hypot(dx, dy) || 1;
            const mx = (start.x + end.x) / 2;
            const my = (start.y + end.y) / 2;
            // Keep branch labels away from the edge itself and from node text.
            const labelX = mx - (dy / length) * 14;
            const labelY = my + (dx / length) * 14;
            const lines = lk.label ? wrapSvgLabel(lk.label, 16) : [];
            const firstY = labelY - ((lines.length - 1) * 12) / 2;
            return (
              <g key={`${lk.from}-${lk.to}-${i}`} data-process-link={`${lk.from}->${lk.to}`}>
                <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="var(--text-secondary)" strokeWidth="1.4" markerEnd={`url(#${aid})`} />
                {lk.label && (
                  <text x={labelX} y={firstY} textAnchor="middle" style={labelWithHalo}>
                    {lines.map((line, lineIndex) => (
                      <tspan key={`${line}-${lineIndex}`} x={labelX} dy={lineIndex === 0 ? 0 : 12}>{line}</tspan>
                    ))}
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map((nd) => {
            const p = pos[nd.id];
            if (!p) return null;
            const layout = nodeLayouts.get(nd.id) || { width: 90, height: 34, lines: [nd.label || nd.id] };
            const firstY = p.y - ((layout.lines.length - 1) * nodeLineHeight) / 2 + 4;
            return (
              <g key={nd.id} data-process-node={nd.id}>
                <rect x={p.x - layout.width / 2} y={p.y - layout.height / 2} width={layout.width} height={layout.height} rx="5" fill="rgba(59,130,246,0.14)" stroke="var(--accent-color)" strokeWidth="1.4" />
                <text x={p.x} y={firstY} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px', fontWeight: '600' }}>
                  {layout.lines.map((line, lineIndex) => (
                    <tspan key={`${line}-${lineIndex}`} x={p.x} dy={lineIndex === 0 ? 0 : nodeLineHeight}>{line}</tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      );
    }

    case 'force_diagram': {
      const fdW = 360, fdH = 240;
      const object = diagram.object || {};
      const objX = typeof object.x === 'number' ? object.x : 0.5;
      const objY = typeof object.y === 'number' ? object.y : 0.55;
      const cx = 40 + objX * (fdW - 80);
      const cy = 36 + objY * (fdH - 76);
      const objW = typeof object.width === 'number' ? object.width : 82;
      const objH = typeof object.height === 'number' ? object.height : 44;
      const forces: { label?: string; direction?: string; magnitude?: number | string }[] = Array.isArray(diagram.forces) ? diagram.forces : [];
      const aid = `force-${clipId}`;
      const directionVector = (direction: string | undefined) => {
        switch (String(direction || '').toLowerCase()) {
          case 'up': return { dx: 0, dy: -1 };
          case 'down': return { dx: 0, dy: 1 };
          case 'left': return { dx: -1, dy: 0 };
          case 'right': return { dx: 1, dy: 0 };
          default: return { dx: 1, dy: 0 };
        }
      };
      const maxMag = Math.max(1, ...forces.map((f) => {
        const n = typeof f.magnitude === 'number' ? f.magnitude : parseLen(String(f.magnitude || ''));
        return n || 0;
      }));
      const edgeOffset = (dx: number, dy: number) => ({
        x: dx === 0 ? 0 : dx * (objW / 2 + 4),
        y: dy === 0 ? 0 : dy * (objH / 2 + 4),
      });

      return (
        <svg viewBox={`0 0 ${fdW} ${fdH}`} width={fdW} height={fdH} style={svgStyle} role="img" aria-label={a11yName}>
          <title>{a11yName}</title>
          <defs>
            <marker id={aid} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6 Z" fill="var(--text-secondary)" />
            </marker>
          </defs>
          {diagram.title && <text x={fdW / 2} y={18} textAnchor="middle" style={{ ...labelStyle, fontWeight: '600' }}>{diagram.title}</text>}
          {diagram.surface && <line x1="40" y1={cy + objH / 2 + 2} x2={fdW - 40} y2={cy + objH / 2 + 2} stroke="var(--text-secondary)" strokeWidth="1.2" />}
          <rect x={cx - objW / 2} y={cy - objH / 2} width={objW} height={objH} rx="6" fill="rgba(59,130,246,0.14)" stroke="var(--accent-color)" strokeWidth="1.6" />
          <text x={cx} y={cy + 4} textAnchor="middle" style={{ ...labelStyle, fontSize: '14px', fontWeight: '600' }}>{shortLabel(object.label || 'object', 18)}</text>
          {forces.map((force, i) => {
            const { dx, dy } = directionVector(force.direction);
            const offset = edgeOffset(dx, dy);
            const mag = typeof force.magnitude === 'number' ? force.magnitude : parseLen(String(force.magnitude || ''));
            const len = 44 + 54 * ((mag || maxMag) / maxMag);
            const start = { x: cx + offset.x, y: cy + offset.y };
            const end = { x: start.x + dx * len, y: start.y + dy * len };
            const label = [force.label, force.magnitude].filter(Boolean).join(' ');
            const lx = end.x + (dx === 0 ? 0 : dx * 20);
            const ly = end.y + (dy === 0 ? -8 : dy * 12);
            return (
              <g key={`${force.label || 'force'}-${i}`}>
                <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="var(--text-secondary)" strokeWidth="2" markerEnd={`url(#${aid})`} />
                {label && <text x={lx} y={ly} textAnchor="middle" style={{ ...labelStyle, fontSize: '13px' }}>{shortLabel(label, 22)}</text>}
              </g>
            );
          })}
        </svg>
      );
    }

    default:
      return (
        <div style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          Diagram: {diagram.type} {diagram.labels ? `(${Object.values(diagram.labels).join(', ')})` : ''}
        </div>
      );
  }
}

/**
 * Builds an informative accessible name for a diagram.
 *
 * A screen reader gets the same facts the LLM receives from
 * `TutorEngine._diagram_to_text`, so an unsighted student is not left with a
 * bare type name. Falls back to the diagram title, then to a readable form of
 * the type, and never returns an empty string.
 */
/**
 * Reconciles authored payload shapes the renderer would otherwise ignore.
 *
 * Several authored items nest their payload under a key named after the type,
 * or use a different field name for the same data. Because each branch read one
 * fixed field name, that content rendered as an empty diagram with no error:
 *
 * - `simple_bar_chart` authored as `{ simple_bar_chart: { data: [...] } }`
 *   instead of top-level `bars` — 3 science items drew an empty chart.
 * - `tree_diagram` authored as `branches: [{ label, children }]` instead of
 *   `nodes`/`links` — one Year 7 sub-part drew an empty tree.
 *
 * Normalising here keeps every branch reading one shape.
 */
/** Vertex labels are authored in either case (`a` or `A`). */
function vertexLabel(labels: unknown, key: 'a' | 'b' | 'c'): string {
  if (!labels || typeof labels !== 'object') return '';
  const map = labels as Record<string, unknown>;
  const value = map[key] ?? map[key.toUpperCase()];
  return value === undefined || value === null ? '' : String(value);
}

type FunctionGraphFeaturePrimitives = {
  asymptotes: { x?: number; y?: number; label?: string }[];
  points: { x: number; y: number; label: string }[];
  descriptions: string[];
};

function functionGraphFeaturePrimitives(features: unknown): FunctionGraphFeaturePrimitives {
  const result: FunctionGraphFeaturePrimitives = { asymptotes: [], points: [], descriptions: [] };
  if (!Array.isArray(features)) return result;

  for (const raw of features) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const feature = raw.trim();
    const vertical = feature.match(/^vertical_asymptote_x\s*=\s*(-?\d+(?:\.\d+)?)$/i);
    const horizontal = feature.match(/^horizontal_asymptote_y\s*=\s*(-?\d+(?:\.\d+)?)$/i);
    const point = feature.match(/^(x_intercept|y_intercept|turning_point|stationary_point)_\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/i);

    if (vertical) {
      const x = Number(vertical[1]);
      result.asymptotes.push({ x, label: `x = ${x}` });
      result.descriptions.push(`vertical asymptote x = ${x}`);
    } else if (horizontal) {
      const y = Number(horizontal[1]);
      result.asymptotes.push({ y, label: `y = ${y}` });
      result.descriptions.push(`horizontal asymptote y = ${y}`);
    } else if (point) {
      const x = Number(point[2]);
      const y = Number(point[3]);
      const label = point[1].replace(/_/g, ' ');
      result.points.push({ x, y, label });
      result.descriptions.push(`${label} (${x}, ${y})`);
    } else {
      result.descriptions.push(feature.replace(/_/g, ' '));
    }
  }
  return result;
}

export function reconcileLegacyDiagramShapes(diagram: DiagramData): DiagramData {
  const result: DiagramData = { ...diagram };

  // A payload nested under its own type name.
  const nested = result[result.type];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
      if (result[key] === undefined) result[key] = value;
    }
  }

  if (result.type === 'simple_bar_chart' && !Array.isArray(result.bars) && Array.isArray(result.data)) {
    result.bars = result.data;
  }

  // `branches: [{ label, children: [{ label }] }]` -> nodes + links.
  if (result.type === 'tree_diagram' && !Array.isArray(result.nodes) && Array.isArray(result.branches)) {
    const nodes: { id: string; label: string; depth: number }[] = [];
    const links: { from: string; to: string; label?: string }[] = [];
    const rootId = 'root';
    nodes.push({ id: rootId, label: '', depth: 0 });
    (result.branches as unknown[]).forEach((branch, branchIndex) => {
      const parent = branch as { label?: unknown; children?: unknown[]; probability?: unknown };
      const parentId = `b${branchIndex}`;
      nodes.push({ id: parentId, label: String(parent.label ?? ''), depth: 1 });
      links.push({
        from: rootId,
        to: parentId,
        label: parent.probability !== undefined ? String(parent.probability) : undefined,
      });
      (Array.isArray(parent.children) ? parent.children : []).forEach((child, childIndex) => {
        const leaf = child as { label?: unknown; probability?: unknown };
        const childId = `b${branchIndex}c${childIndex}`;
        nodes.push({ id: childId, label: String(leaf.label ?? ''), depth: 2 });
        links.push({
          from: parentId,
          to: childId,
          label: leaf.probability !== undefined ? String(leaf.probability) : undefined,
        });
      });
    });
    result.nodes = nodes;
    result.links = links;
  }

  return result;
}

export function describeDiagram(diagram: DiagramData): string {
  const labels = (diagram.labels || {}) as Record<string, unknown>;
  const title = typeof diagram.title === 'string' && diagram.title.trim() ? String(diagram.title).trim() : '';
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const named = (parts: string[], head: string) =>
    parts.length ? `${head}: ${parts.join(', ')}` : head;
  const dims = (keys: string[]) =>
    keys.filter((k) => labels[k] !== undefined && labels[k] !== null && String(labels[k]).length > 0)
      .map((k) => `${k} ${String(labels[k])}`);

  switch (diagram.type) {
    case 'right_triangle':
      // Trig items use adjacent/opposite/angle instead of base/height.
      return named(
        dims(['base', 'height', 'adjacent', 'opposite', 'hypotenuse', 'angle']),
        'Right-angled triangle',
      );
    case 'triangle': {
      const sides = dims(['base', 'height', 'side']);
      const vertices = ['a', 'b', 'c']
        .map((key) => {
          const value = labels[key] ?? labels[key.toUpperCase()];
          return value === undefined || value === null || String(value) === ''
            ? null
            : `${key.toUpperCase()} ${String(value)}`;
        })
        .filter((entry): entry is string => entry !== null);
      return named([...sides, ...vertices], 'Triangle');
    }
    case 'rectangle':
      return named(dims(['width', 'height', 'length']), 'Rectangle');
    case 'circle':
      return named(dims(['radius', 'diameter', 'circumference']), 'Circle');
    case 'rectangular_prism':
      return named(dims(['length', 'width', 'height', 'depth']), 'Rectangular prism');
    case 'coordinate_plane': {
      const pts = list(diagram.points)
        .map((p) => {
          const point = p as { label?: unknown; x?: unknown; y?: unknown };
          const name = point.label ? `${String(point.label)} ` : '';
          return `${name}(${String(point.x)}, ${String(point.y)})`;
        })
        .join(', ');
      return pts ? `Coordinate plane with points ${pts}` : 'Coordinate plane';
    }
    case 'number_line': {
      const min = diagram.min ?? 0;
      const max = diagram.max ?? 10;
      const marks = list(diagram.marks)
        .map((m) => {
          const mark = m as { label?: unknown; value?: unknown };
          return mark.label ? `${String(mark.label)} at ${String(mark.value)}` : String(mark.value);
        })
        .join(', ');
      return marks
        ? `Number line from ${String(min)} to ${String(max)}, marked at ${marks}`
        : `Number line from ${String(min)} to ${String(max)}`;
    }
    case 'simple_bar_chart': {
      // Bar captions are visually truncated to fit their slot, so the full
      // label/value pairs must survive in the accessible name.
      const bars = list(diagram.bars)
        .map((b) => {
          const bar = b as { label?: unknown; value?: unknown };
          return `${String(bar.label ?? '')} ${String(bar.value ?? '')}`.trim();
        })
        .filter(Boolean);
      const axes = [
        diagram.x_label ? `x-axis ${String(diagram.x_label)}` : '',
        diagram.y_label ? `y-axis ${String(diagram.y_label)}` : '',
      ].filter(Boolean);
      const head = `${title ? `${title}. ` : ''}Bar chart${axes.length ? ` (${axes.join('; ')})` : ''}`;
      return bars.length ? `${head}. Bars: ${bars.join(', ')}` : head;
    }
    case 'function_graph': {
      const xMin = diagram.x_min ?? -5;
      const xMax = diagram.x_max ?? 5;
      const curves = list(diagram.functions)
        .map((spec) => {
          if (typeof spec === 'string') return spec;
          const fn = spec as { label?: unknown; kind?: unknown };
          if (fn.label) return String(fn.label);
          if (fn.kind) return `${String(fn.kind)} curve`;
          return 'a plotted curve';
        })
        .filter(Boolean);
      const plotted = list(diagram.points)
        .map((p) => {
          const point = p as { label?: unknown; x?: unknown; y?: unknown };
          const name = point.label ? `${String(point.label)} ` : '';
          return `${name}(${String(point.x)}, ${String(point.y)})`;
        })
        .join(', ');
      const features = functionGraphFeaturePrimitives(diagram.features).descriptions;
      const axes = [
        diagram.x_label ? String(diagram.x_label) : 'x',
        diagram.y_label ? String(diagram.y_label) : 'y',
      ];
      let text = `${title ? `${title}. ` : ''}Graph of ${axes[1]} against ${axes[0]}, ${axes[0]} from ${String(xMin)} to ${String(xMax)}`;
      if (curves.length) text += `. Plotted: ${curves.join('; ')}`;
      if (plotted) text += `. Points: ${plotted}`;
      if (features.length) text += `. Features: ${features.join('; ')}`;
      return text;
    }
    case 'sample_space_grid': {
      const outcomes = list(diagram.outcomes);
      const highlight = list(diagram.highlight);
      const head = title ? `${title}. ` : '';
      const base = `${head}Sample space grid of ${outcomes.length} outcomes`;
      return highlight.length
        ? `${base}, ${highlight.length} highlighted: ${highlight.map(String).join(', ')}`
        : base;
    }
    case 'tree_diagram': {
      const nodes = list(diagram.nodes).length;
      const links = list(diagram.links).length;
      return `${title ? `${title}. ` : ''}Probability tree diagram with ${nodes} nodes and ${links} branches`;
    }
    case 'box_plot': {
      const plots = list(diagram.plots);
      if (plots.length > 1) {
        return `${title ? `${title}. ` : ''}Box plots comparing ${plots.length} data sets`;
      }
      const five = ['min', 'q1', 'median', 'q3', 'max']
        .filter((k) => diagram[k] !== undefined && diagram[k] !== null)
        .map((k) => `${k} ${String(diagram[k])}`);
      return named(five, `${title ? `${title}. ` : ''}Box plot`.trim());
    }
    case 'food_web': {
      const nodes = list(diagram.nodes)
        .map((n) => String((n as { name?: unknown; label?: unknown }).name ?? (n as { label?: unknown }).label ?? ''))
        .filter(Boolean);
      const links = list(diagram.links).length;
      return nodes.length
        ? `Food web with ${links} feeding relationships between ${nodes.join(', ')}`
        : 'Food web diagram';
    }
    case 'particle_model': {
      const state = typeof diagram.state === 'string' ? diagram.state : '';
      const count = list(diagram.particles).length;
      const label = typeof diagram.label === 'string' && diagram.label ? `${diagram.label}. ` : '';
      const stateText = state ? `particles arranged as a ${state}` : 'particle arrangement';
      return `${label}Particle model: ${stateText}${count ? `, ${count} particles shown` : ''}`;
    }
    case 'process_flow': {
      const nodes = list(diagram.nodes)
        .map((n) => String((n as { label?: unknown; name?: unknown }).label ?? (n as { name?: unknown }).name ?? ''))
        .filter(Boolean);
      const head = title ? `${title}. ` : '';
      return nodes.length
        ? `${head}Process flow diagram: ${nodes.join(' → ')}`
        : `${head}Process flow diagram`;
    }
    case 'force_diagram': {
      const forces = list(diagram.forces)
        .map((f) => {
          const force = f as { label?: unknown; direction?: unknown; magnitude?: unknown };
          const name = force.label ? String(force.label) : 'force';
          const dir = force.direction ? ` ${String(force.direction)}` : '';
          const mag = force.magnitude !== undefined ? ` ${String(force.magnitude)}` : '';
          return `${name}${mag}${dir}`.trim();
        })
        .filter(Boolean);
      const head = title ? `${title}. ` : '';
      return forces.length
        ? `${head}Force diagram showing ${forces.join(', ')}`
        : `${head}Force diagram`;
    }
    default:
      return title || String(diagram.type).replace(/_/g, ' ');
  }
}

const svgStyle: React.CSSProperties = {
  display: 'block',
  margin: '12px auto',
  maxWidth: '100%',
  height: 'auto',
  background: 'rgba(0,0,0,0.15)',
  borderRadius: '8px',
  padding: '8px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  fill: 'var(--text-primary)',
  fontFamily: 'inherit',
};

const PRESERVED_DIAGRAM_STRING_KEYS = new Set([
  'type', 'id', 'from', 'to', 'center', 'vertex', 'along1', 'along2',
  'expression', 'expr', 'model', 'color', 'fill', 'stroke', 'label_pos',
  'labelPosition',
]);

function normalizeDiagramData(data: DiagramData): DiagramData {
  return normalizeDiagramValue(data) as DiagramData;
}

function normalizeDiagramValue(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    // A bare function string is an expression, not display text. Object
    // expressions are covered by PRESERVED_DIAGRAM_STRING_KEYS above.
    if (key === 'functions' || (key && PRESERVED_DIAGRAM_STRING_KEYS.has(key))) return value;
    return formatMathForDiagramText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDiagramValue(item, key));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        normalizeDiagramValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

/**
 * Extract a positive numeric length from a label string such as "5 cm",
 * "20 m" or "13". Returns null for non-numeric labels like "h", "?" or
 * "ground", so the renderer can fall back to a fixed schematic shape.
 */
function parseLen(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function chooseTickStep(range: number, maxTicks: number): number {
  const raw = range / maxTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1));
  for (const factor of [1, 2, 5, 10]) {
    const step = factor * magnitude;
    if (range / step <= maxTicks) return step;
  }
  return 10 * magnitude;
}

function roundTick(value: number): number {
  return Number(value.toFixed(6));
}

function shortLabel(value: unknown, maxLength: number): string {
  const text = String(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
}

function wrapSvgLabel(value: unknown, maxChars: number): string[] {
  const text = String(value ?? '').trim();
  if (!text) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}


function keepMathExpressionsTogether(text: string): string {
  // If the text contains arrow separator, process parts individually
  if (/→/.test(text)) {
    return text.split('→').map(part => keepMathExpressionsTogether(part)).join(' → ');
  }

  // Replace spaces inside coordinate pairs like (1, -4) or (1, −4) with non-breaking spaces
  let result = text.replace(/\(\s*[-−]?\d+\s*,\s*[-−]?\d+\s*\)/g, (match) => {
    return match.replace(/\s+/g, '\u00A0');
  });

  // If the text looks like an algebraic equation (starts with y = or similar, or contains = and math symbols),
  // keep the equation together.
  if (/=/.test(result) && (/[²³⁴⁵xθπ+−\-*()]/i.test(result) || /^[a-z_()]+\s*=/i.test(result))) {
    result = result.replace(/\s+/g, '\u00A0');
  }
  
  return result;
}


function formatMathForDiagramText(text: string): string {
  if (!text) return text;
  
  let result = text;
  // Authored cells sometimes escape the math delimiter as `\$`.
  result = result.replace(/\\\$/g, '');

  // Some legacy/transported labels lost the `t` command prefix and arrive as
  // `$8 ext{ cm}$` (or `\\ext{ cm}`). Treat only the brace-form token as a
  // malformed text command; ordinary words such as "text" remain untouched.
  result = result.replace(/(^|[\s\d)])\\?ext\{\s*([^}]*?)\s*\}/g, '$1$2');
  
  // Handle fractions: \tfrac{a}{b} or \frac{a}{b} -> a/b
  result = result.replace(/\\(?:tfrac|frac)\s*\{([^}]+)\}\s*\{([^}]+)\}/g, '$1/$2');
  result = result.replace(/\\(?:tfrac|frac)\s*(\d)\s*(\d)/g, '$1/$2');

  // Replace common LaTeX symbols
  const replacements: [RegExp, string][] = [
    [/\\(text|mathrm|operatorname)\{([^}]+)\}/g, '$2'],
    // Degrees are authored as `^\circ` or `^{\circ}`; collapse both to `°`
    // before the generic superscript pass turns the caret into a lone marker.
    [/\^\s*\{?\s*\\circ\s*\}?/g, '°'],
    [/\\circ\s*/g, '°'],
    [/\\degree\s*/g, '°'],
    [/\\Delta\s*/g, 'Δ'],
    [/\\delta\s*/g, 'δ'],
    [/\\theta\s*/g, 'θ'],
    [/\\pi\s*/g, 'π'],
    [/\\sum\s*/g, '∑'],
    [/\\int\s*/g, '∫'],
    [/\\approx\s*/g, '≈'],
    [/\\le(q)?\s*/g, '≤'],
    [/\\ge(q)?\s*/g, '≥'],
    [/\\neq\s*/g, '≠'],
    [/\\pm\s*/g, '±'],
    [/\\times\s*/g, '×'],
    [/\\div\s*/g, '÷'],
    [/\\(to|rightarrow)\s*/g, '→'],
    [/\\infty\s*/g, '∞'],
    [/\\alpha\s*/g, 'α'],
    [/\\beta\s*/g, 'β'],
    [/\\gamma\s*/g, 'γ'],
    [/\\cdot\s*/g, '·'],
    // `\sqrt{18}` and `\sqrt2` render as a radical rather than the raw command.
    [/\\sqrt\s*\{([^}]+)\}/g, '\u221A($1)'],
    [/\\sqrt\s*(\d+(?:\.\d+)?)/g, '\u221A$1'],
    [/\\,/g, ' '],
    [/\\;/g, ' '],
    [/\\ /g, ' '],
    [/\\\\/g, ' '],
  ];

  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }

  // Subscripts mapping
  const subscripts: Record<string, string> = {
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
    '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
    '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
    'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ',
    'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'o': 'ₒ',
    'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ',
    'v': 'ᵥ', 'x': 'ₓ'
  };

  // Superscripts mapping
  const superscripts: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
    'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ',
    'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'i': 'ⁱ', 'j': 'ʲ',
    'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ', 'n': 'ⁿ', 'o': 'ᵒ',
    'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ',
    'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ'
  };

  // Process braced subscripts/superscripts first
  result = result.replace(/\^\{([^}]+)\}/g, (_, p1) => {
    return p1.split('').map((char: string) => superscripts[char] || char).join('');
  });
  result = result.replace(/_\{([^}]+)\}/g, (_, p1) => {
    return p1.split('').map((char: string) => subscripts[char] || char).join('');
  });

  // Process single character subscripts/superscripts
  result = result.replace(/\^([0-9+\-a-z])/gi, (_, p1) => superscripts[p1] || p1);
  result = result.replace(/_([0-9+\-a-z])/gi, (_, p1) => subscripts[p1] || p1);

  // Strip dollar signs
  result = result.replace(/\$/g, '');

  return result;
}
