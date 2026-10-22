'use client';

import React, { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import MathMarkdown from '../MathMarkdown';

interface AdvancedLessonData {
  why_it_works?: string[];
  alternate_methods?: string[];
  challenge_prompts?: string[];
  parent_note?: string;
}

interface AdvancedLessonExtensionProps {
  data: AdvancedLessonData | null;
  subjectColor: string;
  labLink?: { href: string; label: string };
}

export default function AdvancedLessonExtension({
  data,
  subjectColor,
  labLink,
}: AdvancedLessonExtensionProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!data && !labLink) return null;
  if (!labLink && (!data || (!data?.why_it_works && !data?.alternate_methods && !data?.challenge_prompts && !data?.parent_note))) {
    return null;
  }

  return (
    <div className="glass-panel animate-fade-in" style={{
      borderRadius: '16px',
      overflow: 'hidden',
      border: isOpen ? `1px solid ${subjectColor}40` : '1px solid var(--border-color)',
      transition: 'all 0.3s ease'
    }}>
      {/* Trigger Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 20px',
          background: 'rgba(255,255,255,0.02)',
          color: 'var(--text-primary)',
          fontSize: '14px',
          fontWeight: '700',
          boxShadow: 'none',
          borderRadius: 0,
          cursor: 'pointer'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={16} style={{ color: subjectColor }} /> 🚀 Stretch Thinking & Extensions
        </span>
        {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {/* Collapsible Panel */}
      {isOpen && (
        <div style={{
          padding: '20px',
          background: 'rgba(255,255,255,0.01)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          borderTop: '1px solid var(--border-color)',
          animation: 'fadeIn 0.25s ease'
        }}>
          {labLink && (
            <a
              href={labLink.href}
              style={{
                display: 'block',
                padding: '10px 12px',
                borderRadius: '8px',
                border: `1px solid ${subjectColor}55`,
                color: subjectColor,
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              🧪 {labLink.label}
            </a>
          )}
          {/* Why it works */}
          {data?.why_it_works && data?.why_it_works.length > 0 && (
            <div>
              <h4 style={{ fontSize: '13px', fontWeight: '700', color: subjectColor, marginBottom: '6px' }}>
                💡 Why It Works (Deep Concept)
              </h4>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                {data?.why_it_works.map((item, idx) => (
                  <p key={idx} style={{ margin: 0, marginBottom: '4px' }}>
                    <MathMarkdown>{item}</MathMarkdown>
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Alternate methods */}
          {data?.alternate_methods && data?.alternate_methods.length > 0 && (
            <div>
              <h4 style={{ fontSize: '13px', fontWeight: '700', color: subjectColor, marginBottom: '6px' }}>
                🔧 Alternative Solution Methods
              </h4>
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                {data?.alternate_methods.map((method, idx) => (
                  <li key={idx} style={{ marginBottom: '4px' }}>
                    <MathMarkdown>{method}</MathMarkdown>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Challenge Prompts */}
          {data?.challenge_prompts && data?.challenge_prompts.length > 0 && (
            <div>
              <h4 style={{ fontSize: '13px', fontWeight: '700', color: subjectColor, marginBottom: '6px' }}>
                ❓ Challenge & Extension Investigations
              </h4>
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                {data?.challenge_prompts.map((prompt, idx) => (
                  <li key={idx} style={{ marginBottom: '6px', fontStyle: 'italic' }}>
                    <MathMarkdown>{prompt}</MathMarkdown>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Parent coaching note */}
          {data?.parent_note && (
            <div style={{
              background: 'rgba(99, 102, 241, 0.04)',
              border: '1px dashed rgba(99, 102, 241, 0.3)',
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start',
              marginTop: '4px'
            }}>
              <AlertCircle size={16} style={{ color: 'var(--accent-color)', flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                <strong>Coaching Tip for You:</strong> {data?.parent_note}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
