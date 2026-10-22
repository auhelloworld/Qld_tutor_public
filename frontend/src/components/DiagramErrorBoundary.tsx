'use client';

import React from 'react';

interface DiagramErrorBoundaryProps {
  children: React.ReactNode;
  /** Short description used in the fallback so the student knows what is missing. */
  label?: string;
}

interface DiagramErrorBoundaryState {
  failed: boolean;
}

/**
 * Local boundary around a single diagram.
 *
 * `DiagramRenderer` tolerates missing payload fields, but a field of the wrong
 * shape still throws — for example `bars: 'not-an-array'` raises
 * `bars.map is not a function`. Without a local boundary that propagates to the
 * application-level `ErrorBoundary` in `app/layout.tsx`, replacing the whole
 * page for one malformed diagram. Containing it here keeps the question, its
 * choices and the rest of the session usable.
 */
export default class DiagramErrorBoundary extends React.Component<
  DiagramErrorBoundaryProps,
  DiagramErrorBoundaryState
> {
  constructor(props: DiagramErrorBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): DiagramErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Surfaced for local debugging; never shown to the student.
    if (process.env.NODE_ENV !== 'production') {
      console.error('[DiagramErrorBoundary] diagram failed to render:', error);
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          role="status"
          style={{
            display: 'block',
            margin: '12px auto',
            padding: '12px',
            borderRadius: '8px',
            border: '1px dashed var(--border-color)',
            background: 'rgba(0,0,0,0.06)',
            fontSize: '13px',
            color: 'var(--text-secondary)',
            textAlign: 'center',
          }}
        >
          {this.props.label
            ? `This ${this.props.label} could not be displayed. The question text still applies.`
            : 'This diagram could not be displayed. The question text still applies.'}
        </div>
      );
    }
    return this.props.children;
  }
}
