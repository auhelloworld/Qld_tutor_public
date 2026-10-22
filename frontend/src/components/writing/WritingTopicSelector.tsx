'use client';
import { useState } from 'react';
import { PRESCRIBED_TEXT_LIST_NOTE, SENIOR_TASK_VERSION_NOTE, usesPrescribedText, WritingTopic } from '../../lib/writing-topics';
import { Info, BookOpen, Target, Users, ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  promptType: 'persuasive' | 'narrative' | 'analytical' | 'expository';
  yearLevel: number;
  topics: WritingTopic[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSelect: (topic: WritingTopic | null) => void;
  onBack: () => void;
}

export default function WritingTopicSelector({ promptType, yearLevel, topics, loading = false, error = null, onRetry, onSelect, onBack }: Props) {
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');

  const filteredTopics = topics.filter(t => t.type === promptType && !t.disabled && t.status !== 'draft');
  const selectedTopic = filteredTopics.find(t => t.id === selectedTopicId);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontWeight: 600 }}>
          Change Writing Type
        </button>
        <h2 style={{ fontSize: '20px', fontWeight: 700 }}>Select a Topic</h2>
        <div style={{ width: 100 }}></div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
          <div style={{
            width: 28, height: 28, margin: '0 auto 0.75rem',
            border: '3px solid var(--accent-color)',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <p>Loading writing topics...</p>
        </div>
      )}

      {!loading && error && (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
          <p>{error}</p>
          {onRetry && (
            <button onClick={onRetry} className="btn-secondary" style={{ padding: '0.5rem 1rem', color: 'var(--text-primary)' }}>
              Try loading topics again
            </button>
          )}
        </div>
      )}

      {!loading && !error && filteredTopics.length === 0 && (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
          <p>No specific topics found for this category in Year {yearLevel}.</p>
          <p style={{ fontSize: '0.85rem' }}>You can still use your own teacher topic or write freely.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {!loading && filteredTopics.length > 0 && (
          <div style={{ position: 'relative' }}>
            <select
              aria-label="Writing topic"
              value={selectedTopicId}
              onChange={e => setSelectedTopicId(e.target.value)}
              style={{
                width: '100%', padding: '0.85rem 1rem', fontSize: '1rem',
                border: '1px solid var(--border-color)', borderRadius: '12px',
                background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                cursor: 'pointer', outline: 'none',
                appearance: 'none', WebkitAppearance: 'none',
                fontFamily: 'inherit',
              }}
            >
              <option value="" disabled>Choose a topic...</option>
              {filteredTopics.map(t => (
                <option key={t.id} value={t.id}>
                  [{t.category}] {t.title}
                </option>
              ))}
            </select>
            <ChevronDown
              size={18}
              style={{
                position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)',
                pointerEvents: 'none', color: 'var(--text-muted)',
              }}
            />
          </div>
          )}

          {/* Topic Details */}
          {selectedTopic && (
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem', color: 'var(--text-primary)' }}>
                {selectedTopic.title}
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-color)', fontWeight: 700, textTransform: 'uppercase' }}>
                {selectedTopic.category}
              </span>
              {selectedTopic.difficulty && (
                <span style={{ fontSize: '0.7rem', background: 'var(--border-color)', padding: '2px 6px', borderRadius: '4px', marginLeft: '0.5rem' }}>
                  {selectedTopic.difficulty}
                </span>
              )}
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.75rem', lineHeight: 1.5 }}>
                {selectedTopic.description}
              </p>
              {yearLevel >= 11 && (
                <div style={{ marginTop: '0.75rem', padding: '0.65rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {selectedTopic.taskConditions?.label && (
                    <div><strong style={{ color: 'var(--text-primary)' }}>Task type:</strong> {selectedTopic.taskConditions.label}</div>
                  )}
                  <div>{SENIOR_TASK_VERSION_NOTE}</div>
                  {usesPrescribedText(selectedTopic) && <div>{PRESCRIBED_TEXT_LIST_NOTE}</div>}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1.25rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                {/* Context / Mode */}
                {(selectedTopic.context || selectedTopic.mode) && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-color)', marginBottom: '0.4rem' }}>
                      <Users size={16} />
                      <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>SCENARIO & AUDIENCE</span>
                    </div>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {selectedTopic.context} {selectedTopic.targetAudience && `Aim for: ${selectedTopic.targetAudience}`}
                    </p>
                  </div>
                )}

                {/* Word Limit */}
                {selectedTopic.wordLimit && (
                  <div style={{ padding: '0.75rem', background: 'var(--border-color)', borderRadius: '8px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {selectedTopic.wordLimit.min}-{selectedTopic.wordLimit.max} words
                    </span>
                  </div>
                )}

                {/* Prompt */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-color)', marginBottom: '0.4rem' }}>
                    <Target size={16} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>THE PROMPT</span>
                  </div>
                  <p style={{ fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 600, lineHeight: 1.5, background: 'rgba(99,102,241,0.05)', padding: '0.75rem', borderRadius: '8px' }}>
                    {selectedTopic.prompt}
                  </p>
                </div>

                {/* Guiding Questions */}
                {selectedTopic.guidingQuestions && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-color)', marginBottom: '0.4rem' }}>
                      <Info size={16} />
                      <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>GUIDING QUESTIONS</span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      {selectedTopic.guidingQuestions.map((q, i) => <li key={i}>{q}</li>)}
                    </ul>
                  </div>
                )}

                {/* Prescribed Text */}
                {selectedTopic.prescribedText && (
                  <div style={{ padding: '0.75rem', background: 'var(--border-color)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <BookOpen size={18} color="var(--accent-color)" />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Text: {selectedTopic.prescribedText}</span>
                  </div>
                )}
              </div>

              <button
                onClick={() => onSelect(selectedTopic)}
                className="btn-primary"
                style={{ width: '100%', marginTop: '1.5rem', padding: '1rem' }}
              >
                Start Writing
              </button>
            </div>
          )}

          {/* Custom task standalone button */}
          {!selectedTopicId && (
            <button
              onClick={() => onSelect(null)}
              className="glass-card"
              style={{
                width: '100%', textAlign: 'left', padding: '1rem',
                border: '1px dashed var(--border-color)',
                cursor: 'pointer', color: 'var(--text-primary)',
                display: 'flex', alignItems: 'center', gap: '0.75rem'
              }}
            >
              <div style={{ width: 40, height: 40, borderRadius: '20%', background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ChevronRight size={20} color="var(--accent-color)" />
              </div>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Use My Own Topic</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                  Write freely or follow a task from your teacher.
                </p>
              </div>
            </button>
          )}
        </div>
    </div>
  );
}
