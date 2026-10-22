'use client';

import MathMarkdown from '../MathMarkdown';
import DiagramRenderer from '../DiagramRenderer';
import type { TutorExplainResponse, LessonSection, WorkedExampleStep, TutorLabLink } from '../../lib/api-types';

/**
 * Displays lesson content (learning objectives, explanations, vocabulary, etc.)
 * shown after clicking "Explain Concept". All sections are shown expanded.
 */
interface LessonContentPanelProps {
  lessonContent: TutorExplainResponse;
  topic: string;
  labLink?: TutorLabLink;
  /** Shows a Dismiss button when given. */
  onDismiss?: () => void;
}

function sectionIcon(type: string | undefined): string {
  if (type === 'example') return '📝';
  if (type === 'warning') return '⚠️';
  if (type === 'connection') return '🔗';
  if (type === 'method') return '🔧';
  if (type === 'concept') return '💡';
  return '📌';
}

function ExplanationSectionBlock({ section, index }: { section: LessonSection; index: number }) {
  const icon = sectionIcon(section.type);
  return (
    <div key={index} style={{ marginBottom: '12px', padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
      <div style={{ fontSize: '14.5px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
        <MathMarkdown>
          {`${icon} ${section.heading}`}
        </MathMarkdown>
      </div>
      <div style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
        <MathMarkdown>
          {section.body}
        </MathMarkdown>
      </div>
      {section.diagram && (
        <figure
          role="group"
          aria-label={`${section.heading} diagram`}
          style={{
            margin: '12px 0 2px',
            padding: '8px 8px 4px',
            background: 'rgba(0,0,0,0.12)',
            border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
            borderRadius: '8px',
            overflowX: 'auto',
          }}
        >
          <figcaption style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '2px', textAlign: 'center' }}>
            Figure: {section.heading}
          </figcaption>
          <DiagramRenderer data={section.diagram as { type: string; [key: string]: unknown }} />
        </figure>
      )}
    </div>
  );
}

export default function LessonContentPanel({ lessonContent, topic, labLink, onDismiss }: LessonContentPanelProps) {
  const lc = lessonContent.lesson_content;
  if (!lc) return null;
  const explanationSections = lc.explanation_sections ?? [];

  return (
    <div
      role="region"
      aria-label="Lesson content"
      style={{
        background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.05))',
        border: '1px solid rgba(99,102,241,0.3)',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '16px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>📖</span>
          <span style={{ fontSize: '15px', fontWeight: '700', color: '#818cf8' }}>
            Lesson: {topic.replace(/_/g, ' ')}
          </span>
        </div>
        {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss lesson content"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-secondary)', fontSize: '14px', padding: '4px 8px',
          }}
        >
          ✕ Dismiss
        </button>
        )}
      </div>

      {lessonContent.core_rule && (
        <div style={{ fontSize: '14.5px', color: 'var(--text-secondary)', marginBottom: '12px', fontStyle: 'italic' }}>
          <MathMarkdown>
            {`💡 ${lessonContent.core_rule}`}
          </MathMarkdown>
        </div>
      )}

      {(lc.learning_objectives?.length ?? 0) > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#818cf8', marginBottom: '4px' }}>Learning Objectives</div>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px' }}>
            {(lc.learning_objectives ?? []).map((o: string, i: number) => (
              <li key={i} style={{ marginBottom: '4px' }}>
                <MathMarkdown>
                  {o}
                </MathMarkdown>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(lc.success_criteria?.length ?? 0) > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#10b981', marginBottom: '4px' }}>🎯 Success Criteria (I can...)</div>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px' }}>
            {(lc.success_criteria ?? []).map((s: string, i: number) => (
              <li key={i} style={{ marginBottom: '4px' }}>
                <MathMarkdown>
                  {s}
                </MathMarkdown>
              </li>
            ))}
          </ul>
        </div>
      )}

      {explanationSections.map((section, i) => (
        <ExplanationSectionBlock key={i} section={section} index={i} />
      ))}

      {labLink && (
        <aside
          aria-label="Related Math Lab activity"
          style={{
            marginBottom: '12px',
            padding: '14px',
            background: 'rgba(16,185,129,0.08)',
            border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: '10px',
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#10b981', marginBottom: '4px' }}>
            🧪 Explore this concept visually
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '10px' }}>
            {labLink.objective}
          </div>
          <a
            href={labLink.href}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '8px 12px',
              background: '#10b981',
              color: '#052e20',
              borderRadius: '7px',
              textDecoration: 'none',
              fontSize: '13px',
              fontWeight: '800',
            }}
          >
            Open {labLink.title} in Math Lab →
          </a>
        </aside>
      )}

      {(lc.key_vocabulary?.length ?? 0) > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#818cf8', marginBottom: '6px' }}>Key Vocabulary</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {(lc.key_vocabulary ?? []).map((v: { term: string; definition: string }, i: number) => (
              <div key={i} style={{ fontSize: '14px', padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                <strong>{v.term}:</strong>{' '}
                <MathMarkdown>
                  {v.definition}
                </MathMarkdown>
              </div>
            ))}
          </div>
        </div>
      )}

      {(lc.common_mistakes?.length ?? 0) > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#dc2626', marginBottom: '4px' }}>⚠️ Common Mistakes</div>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px' }}>
            {(lc.common_mistakes ?? []).map((m: string, i: number) => (
              <li key={i} style={{ marginBottom: '4px' }}>
                <MathMarkdown>
                  {m}
                </MathMarkdown>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(lc.real_world_connections?.length ?? 0) > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#16a34a', marginBottom: '4px' }}>🌍 Real-World Connections</div>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px' }}>
            {(lc.real_world_connections ?? []).map((c: string, i: number) => (
              <li key={i} style={{ marginBottom: '4px' }}>
                <MathMarkdown>
                  {c}
                </MathMarkdown>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(lc.additional_worked_examples?.length ?? 0) > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#818cf8', marginBottom: '6px' }}>📝 Additional Worked Examples</div>
          {(lc.additional_worked_examples ?? []).map((ex: WorkedExampleStep, i: number) => (
            <div key={i} style={{ marginBottom: '10px', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
              <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                <MathMarkdown>
                  {`Q: ${ex.question}`}
                </MathMarkdown>
              </div>
              {ex.steps?.map((step: { step: number; instruction: string; result: string }) => (
                <div key={step.step} style={{ display: 'flex', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                  <span style={{ color: '#818cf8', fontWeight: '600', minWidth: '24px' }}>{step.step}.</span>
                  <MathMarkdown>
                    {`${step.instruction} → ${step.result}`}
                  </MathMarkdown>
                </div>
              ))}
              <div style={{ fontSize: '13px', color: '#818cf8', fontWeight: '600', marginTop: '4px' }}>
                <MathMarkdown>
                  {`Answer: ${ex.answer}`}
                </MathMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}

      {(lc.guided_practice?.length ?? 0) > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#818cf8', marginBottom: '6px' }}>🤝 Try with help (Guided Practice)</div>
          {(lc.guided_practice ?? []).map((ex: WorkedExampleStep, i: number) => (
            <div key={i} style={{ marginBottom: '10px', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
              <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                <MathMarkdown>
                  {`Q: ${ex.question}`}
                </MathMarkdown>
              </div>
              {ex.steps && ex.steps.length > 0 && ex.steps?.map((step: { step: number; instruction: string; result: string }) => (
                <div key={step.step} style={{ display: 'flex', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                  <span style={{ color: '#818cf8', fontWeight: '600', minWidth: '24px' }}>{step.step}.</span>
                  <MathMarkdown>
                    {`${step.instruction} → ${step.result}`}
                  </MathMarkdown>
                </div>
              ))}
              <div style={{ fontSize: '13px', color: '#818cf8', fontWeight: '600', marginTop: '4px' }}>
                <MathMarkdown>
                  {`Answer: ${ex.answer}`}
                </MathMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}

      {(lc.independent_practice?.length ?? 0) > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#818cf8', marginBottom: '6px' }}>💪 Try alone (Independent Practice)</div>
          {(lc.independent_practice ?? []).map((ex: WorkedExampleStep, i: number) => (
            <div key={i} style={{ marginBottom: '10px', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
              <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                <MathMarkdown>
                  {`Q: ${ex.question}`}
                </MathMarkdown>
              </div>
              {ex.steps && ex.steps.length > 0 && ex.steps?.map((step: { step: number; instruction: string; result: string }) => (
                <div key={step.step} style={{ display: 'flex', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                  <span style={{ color: '#818cf8', fontWeight: '600', minWidth: '24px' }}>{step.step}.</span>
                  <MathMarkdown>
                    {`${step.instruction} → ${step.result}`}
                  </MathMarkdown>
                </div>
              ))}
              <div style={{ fontSize: '13px', color: '#818cf8', fontWeight: '600', marginTop: '4px' }}>
                <MathMarkdown>
                  {`Answer: ${ex.answer}`}
                </MathMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}

      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            marginTop: '16px', padding: '8px 16px', fontSize: '13px', fontWeight: '600',
            background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: '6px', cursor: 'pointer',
          }}
        >
          Got it — start practising →
        </button>
      )}
    </div>
  );
}
