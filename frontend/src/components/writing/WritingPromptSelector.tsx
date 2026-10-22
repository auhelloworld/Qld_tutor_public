'use client';
import { useState } from 'react';
import { PenLine, MessageSquareText, FileText } from 'lucide-react';

type PromptType = 'persuasive' | 'narrative' | 'analytical' | 'expository';

interface Props {
  onSelect: (promptType: PromptType) => void;
  yearLevel?: number;
}

const JUNIOR_PROMPTS: { type: PromptType; icon: typeof PenLine; title: string; description: string; example: string }[] = [
  {
    type: 'persuasive',
    icon: MessageSquareText,
    title: 'Persuasive',
    description: 'Argue for or against a topic using rhetorical devices to convince your reader.',
    example: '"Should students have to wear school uniforms?"',
  },
  {
    type: 'narrative',
    icon: PenLine,
    title: 'Narrative',
    description: 'Tell a story with characters, a setting, and a plot arc.',
    example: '"Write a story about a character who discovers a hidden door."',
  },
  {
    type: 'analytical',
    icon: FileText,
    title: 'Analytical Paragraph',
    description: 'Analyse how language, techniques, or themes construct meaning in a text using a TEEL paragraph structure.',
    example: 'TEEL paragraph response to novels, poems, or short films.',
  },
  {
    type: 'expository',
    icon: FileText,
    title: 'Informative / Expository',
    description: 'Explain a topic or concept clearly using facts, definitions, examples, and logical sections.',
    example: '"Explain the benefits and challenges of a technology-free school day."',
  },
];

const SENIOR_PROMPTS: { type: PromptType; icon: typeof PenLine; title: string; description: string; example: string }[] = [
  {
    type: 'analytical',
    icon: FileText,
    title: 'Analytical Essay (EA-style)',
    description: 'Analyse how perspectives and representations are constructed in a literary text.',
    example: 'EA-style practice for novels, plays, or unseen extracts.',
  },
  {
    type: 'persuasive',
    icon: MessageSquareText,
    title: 'Public Audience Written Response',
    description: 'Analyse representations in text/s while shaping a response for an identified public audience.',
    example: 'QCAA-style public audience practice such as an article, blog, essay, or column.',
  },
  {
    type: 'narrative',
    icon: PenLine,
    title: 'Imaginative Response (IA3-style)',
    description: 'Create an original imaginative text that "springboards" from a studied literary text.',
    example: 'IA3-style imaginative response practice.',
  },
];

export default function WritingPromptSelector({ onSelect, yearLevel }: Props) {
  const [selected, setSelected] = useState<PromptType | null>(null);
  const currentYear = yearLevel ?? 7;
  const isJunior = currentYear <= 10;
  const isNaplanYear = currentYear === 7 || currentYear === 9;

  const handleSelect = (type: PromptType) => {
    setSelected(type);
    onSelect(type);
  };

  const filteredPrompts = isJunior ? JUNIOR_PROMPTS : SENIOR_PROMPTS;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
        Choose Your Writing Type
      </h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
        Select the type of writing you want to practise. Your draft will be assessed
        {isJunior && isNaplanYear
          ? ' with NAPLAN-style rubric feedback for each criterion.'
          : isJunior
            ? ' with junior writing feedback based on NAPLAN-style criteria for skill development.'
            : ' with QCAA-style formative criteria tailored to your assessment type.'}
      </p>
      {!isJunior && (
        <div style={{
          padding: '0.75rem 1rem', marginBottom: '1rem',
          background: 'rgba(139,92,246,0.10)', border: '1px solid rgba(139,92,246,0.25)',
          borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5,
        }}>
          <strong style={{ color: '#8b5cf6' }}>Practice feedback modelled on QCAA English ISMG categories.</strong> Your official result depends on your school task sheet, exact ISMG, assessment conditions, and teacher/QCAA confirmation.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isJunior ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        {filteredPrompts.map((p) => {
          const Icon = p.icon;
          const isSelected = selected === p.type;
          return (
            <button
              key={p.type}
              onClick={() => handleSelect(p.type)}
              className={`glass-card`}
              style={{
                padding: '1.5rem',
                textAlign: 'left',
                cursor: 'pointer', color: 'var(--text-primary)',
                border: isSelected ? '2px solid var(--accent-color)' : '2px solid transparent',
                background: isSelected ? 'rgba(99,102,241,0.1)' : 'var(--bg-secondary)',
                transition: 'border-color 0.2s, background 0.2s',
                fontFamily: 'inherit',
              }}
            >
              <Icon size={28} style={{ marginBottom: '0.75rem', color: 'var(--accent-color)' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>{p.title}</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                {p.description}
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.4 }}>
                {p.example}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
