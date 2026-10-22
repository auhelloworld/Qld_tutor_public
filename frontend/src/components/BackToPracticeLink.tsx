'use client';

import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import {
  buildPracticeHref,
  type ScopedNavigationParams,
} from '../lib/scoped_navigation';

/**
 * Canonical “← Back to Practice” control used across secondary pages
 * (Error Book, Dashboard, Parent, PSMT, Lab, Challenge, Writing, Diagnostic, Exam).
 */
export const BACK_TO_PRACTICE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '13px',
  padding: '8px 14px',
  borderRadius: '8px',
  background: 'rgba(99,102,241,0.12)',
  color: 'var(--accent-color)',
  border: '1px solid rgba(99,102,241,0.3)',
  textDecoration: 'none',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  lineHeight: 1.3,
};

type BackToPracticeLinkProps = ScopedNavigationParams & {
  /** Override href (defaults to buildPracticeHref from scope props). */
  href?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export default function BackToPracticeLink({
  href,
  subject,
  year,
  topic,
  question,
  mode,
  syllabusSubject,
  className,
  style,
  children = '← Back to Practice',
}: BackToPracticeLinkProps) {
  const to = href ?? buildPracticeHref({
    subject,
    year,
    topic,
    question,
    mode,
    syllabusSubject,
  });

  return (
    <Link
      href={to}
      className={className}
      style={{ ...BACK_TO_PRACTICE_STYLE, ...style }}
    >
      {children}
    </Link>
  );
}

/** Same look as the link, for router.push / onClick cases (e.g. Diagnostic). */
export function BackToPracticeButton({
  onClick,
  className,
  style,
  children = '← Back to Practice',
  type = 'button',
  disabled,
}: {
  onClick: () => void;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={className}
      style={{
        ...BACK_TO_PRACTICE_STYLE,
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
