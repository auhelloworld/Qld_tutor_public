'use client';

import React, { useState, useCallback } from 'react';

export interface ExplorePrompt {
  /** Short task/question for the student to try. */
  prompt: string;
}

export interface TryItCardProps {
  prompts: ExplorePrompt[];
}

/**
 * Collapsible "Try it" card for Explore mode.
 * Renders a list of micro-task prompts that guide exploration.
 * Does NOT score, store state, or reveal answers.
 * Only rendered in Explore mode — Learn mode never mounts this component.
 */
export default function TryItCard({ prompts }: TryItCardProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    },
    [toggle],
  );

  if (prompts.length === 0) return null;

  return (
    <div
      className="try-it-card glass-panel"
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: '10px',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="try-it-content"
        onClick={toggle}
        onKeyDown={handleKeyDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          padding: '12px 16px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 700,
          color: 'var(--accent-color)',
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            transition: 'transform 0.2s',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ▶
        </span>
        💡 Try it — explore suggestions
      </button>
      {expanded && (
        <ul
          id="try-it-content"
          role="list"
          style={{
            margin: 0,
            padding: '0 16px 12px 40px',
            listStyle: 'disc',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          {prompts.map((p, i) => (
            <li
              key={i}
              style={{
                fontSize: '13px',
                lineHeight: 1.5,
                color: 'var(--text-secondary)',
              }}
            >
              {p.prompt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
