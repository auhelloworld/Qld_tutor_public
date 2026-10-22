'use client';

import React, { useMemo } from 'react';
import katex from 'katex';

interface LaTeXProps {
  math: string;
  style?: React.CSSProperties;
}

export function LaTeX({ math: mathText, style }: LaTeXProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(mathText, { displayMode: false, throwOnError: false });
    } catch {
      return mathText;
    }
  }, [mathText]);

  return <span style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

interface BlockLaTeXProps {
  math: string;
  style?: React.CSSProperties;
}

export function BlockLaTeX({ math: mathText, style }: BlockLaTeXProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(mathText, { displayMode: true, throwOnError: false });
    } catch {
      return mathText;
    }
  }, [mathText]);

  return <div style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

interface KaTeXBubbleProps {
  x: number;
  y: number;
  latex: string;
  label?: string;
  color?: string;
  yOffset?: number;
}

export function KaTeXBubble({
  x,
  y,
  latex,
  label,
  color = 'var(--accent-purple)',
  yOffset = 0,
}: KaTeXBubbleProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, { throwOnError: false });
    } catch {
      return latex;
    }
  }, [latex]);

  return (
    <g transform={`translate(${x}, ${y})`}>
      <foreignObject
        x={-120}
        y={yOffset}
        width={240}
        height={80}
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(4px)',
              color: '#f8fafc',
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: '600',
              boxShadow: '0 4px 10px rgba(0, 0, 0, 0.15)',
              border: `1px solid ${color}`,
              display: 'inline-block',
              whiteSpace: 'nowrap',
              transform: 'translateY(-120%)',
              position: 'relative',
            }}
          >
            {label && <span style={{ color: '#94a3b8', marginRight: '4px' }}>{label}:</span>}
            <span dangerouslySetInnerHTML={{ __html: html }} />
            {/* Tooltip arrow */}
            <div
              style={{
                position: 'absolute',
                bottom: '-5px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 0,
                height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: `5px solid rgba(15, 23, 42, 0.85)`,
              }}
            />
          </div>
        </div>
      </foreignObject>
    </g>
  );
}
