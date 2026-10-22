'use client';

import React, { useId, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface ProgressiveDisclosureProps {
  label: string;
  icon?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function ProgressiveDisclosure({
  label,
  icon,
  defaultOpen = false,
  children
}: ProgressiveDisclosureProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const buttonId = useId();
  const regionId = useId();

  return (
    <div style={{ width: '100%' }}>
      <button
        id={buttonId}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={regionId}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 4px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-primary)',
          fontSize: '18px',
          fontWeight: '600',
          cursor: 'pointer',
          textAlign: 'left',
          borderRadius: '0',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {icon && <span aria-hidden="true">{icon}</span>}
          {label}
        </span>
        {isOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>
      <div id={regionId} role="region" aria-labelledby={buttonId} hidden={!isOpen}>{children}</div>
    </div>
  );
}
