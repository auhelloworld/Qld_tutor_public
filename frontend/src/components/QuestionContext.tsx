'use client';

import Image from 'next/image';
import MathMarkdown from './MathMarkdown';
import DiagramRenderer from './DiagramRenderer';
import type { Exercise, SubPart } from '../lib/api-types';

interface DiagramData extends Record<string, unknown> {
  type: string;
}

interface QuestionLike {
  question?: string;
  passage?: string | null;
  resolved_passage?: string | null;
  english_metadata?: Exercise['english_metadata'];
  diagram_data?: Record<string, unknown> | null;
  image?: string | null;
  diagram_description?: string | null;
  sub_parts?: SubPart[] | null;
}

function isDiagramData(diagram: Record<string, unknown>): diagram is DiagramData {
  return typeof diagram.type === 'string';
}

function Visual({ diagram, image, alt }: { diagram?: Record<string, unknown> | null; image?: string | null; alt: string }) {
  if (diagram && isDiagramData(diagram)) return <DiagramRenderer data={diagram} />;
  if (image) {
    return (
      <Image
        src={image}
        alt={alt}
        width={1200}
        height={800}
        unoptimized
        style={{ display: 'block', margin: '12px auto', width: 'auto', height: 'auto', maxWidth: 'min(100%, 450px)', maxHeight: 'min(400px, 60vh)', objectFit: 'contain', borderRadius: '8px', background: 'rgba(0,0,0,0.05)', padding: '8px', border: '1px solid var(--border-color)' }}
      />
    );
  }
  return null;
}

export default function QuestionContext({ question, showSubParts = false }: { question: QuestionLike; showSubParts?: boolean }) {
  const passage = question.passage || question.resolved_passage || question.english_metadata?.passage;
  
  // If the passage is rendered separately in the Stimulus section, strip it from the question body to prevent duplication.
  let displayQuestion = question.question || '';
  if (passage && displayQuestion) {
    const questionMatch = displayQuestion.match(/^\*\*Passage:\*\*[\s\S]*?\*\*Question:\*\*\s*([\s\S]*)$/i);
    if (questionMatch) {
      displayQuestion = questionMatch[1].trim();
    } else {
      const cleanPassage = passage.trim();
      const prefix = `**Passage:**\n${cleanPassage}`;
      const prefixAlt = `**Passage:**${cleanPassage}`;
      if (displayQuestion.trim().startsWith(prefix)) {
        displayQuestion = displayQuestion.trim().slice(prefix.length).trim();
      } else if (displayQuestion.trim().startsWith(prefixAlt)) {
        displayQuestion = displayQuestion.trim().slice(prefixAlt.length).trim();
      }
    }
  }

  return (
    <>
      {passage && (
        <section aria-label="Stimulus" style={{ padding: '14px 16px', marginBottom: '16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.04)' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase' }}>Stimulus</div>
          <div style={{ fontSize: '16.5px', lineHeight: 1.75 }}><MathMarkdown>{passage}</MathMarkdown></div>
        </section>
      )}
      {displayQuestion && <div style={{ fontSize: '18px', lineHeight: 1.6 }}><MathMarkdown>{displayQuestion}</MathMarkdown></div>}
      {/* Authored `diagram_description` is the real description of the image, so it
          is the alt text; "Question diagram" only says that an image exists. */}
      <Visual
        diagram={question.diagram_data}
        image={question.image}
        alt={question.diagram_description?.trim() || 'Question diagram'}
      />
      {showSubParts && question.sub_parts?.map(part => (
        <section key={String(part.label)} style={{ marginTop: '14px', padding: '12px', borderLeft: '3px solid var(--border-color)' }}>
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>Part {String(part.label).toUpperCase()} {part.marks ? `(${part.marks} mark${part.marks === 1 ? '' : 's'})` : ''}</div>
          <MathMarkdown>{part.question}</MathMarkdown>
          <Visual
            diagram={part.diagram_data}
            image={part.image}
            alt={part.diagram_description?.trim() || `Part ${part.label} diagram`}
          />
        </section>
      ))}
    </>
  );
}
