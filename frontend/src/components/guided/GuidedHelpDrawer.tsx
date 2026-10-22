'use client';

import React, { useState, useRef, useEffect } from 'react';
import { HelpCircle, BookOpen, Send, MessageCircle, Volume2 } from 'lucide-react';
import MathMarkdown from '../MathMarkdown';
import DiagramRenderer from '../DiagramRenderer';
import type {
  TutorExplainResponse,
  WorkedExample,
  ChatMessage,
  LessonSection,
  WorkedExampleStep,
} from '../../lib/api-types';
import type { HelpChip } from '../../lib/guided-subject-adapters';

function sectionIcon(type: string | undefined): string {
  if (type === 'example') return '📝';
  if (type === 'warning') return '⚠️';
  if (type === 'connection') return '🔗';
  if (type === 'method') return '🔧';
  if (type === 'concept') return '💡';
  return '📌';
}

function PracticeBlock({
  title,
  items,
  subjectColor,
}: {
  title: string;
  items: WorkedExampleStep[];
  subjectColor: string;
}) {
  if (!items.length) return null;
  return (
    <div>
      <h4 style={{ fontSize: '16px', fontWeight: 700, color: subjectColor, marginBottom: '8px' }}>{title}</h4>
      {items.map((ex, i) => (
        <div
          key={i}
          style={{
            marginBottom: '10px',
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.02)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
          }}
        >
          {ex.question && (
            <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>
              <MathMarkdown>{`Q: ${ex.question}`}</MathMarkdown>
            </div>
          )}
          {(ex.steps ?? []).map((step) => (
            <div
              key={step.step}
              style={{ display: 'flex', gap: '8px', fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '3px', lineHeight: 1.5 }}
            >
              <span style={{ color: subjectColor, fontWeight: 600, minWidth: '24px', flexShrink: 0 }}>{step.step}.</span>
              <div style={{ minWidth: 0 }}>
                <MathMarkdown>{`${step.instruction} → ${step.result}`}</MathMarkdown>
              </div>
            </div>
          ))}
          {ex.answer && (
            <div style={{ fontSize: '15px', color: subjectColor, fontWeight: 600, marginTop: '4px' }}>
              <MathMarkdown>{`Answer: ${ex.answer}`}</MathMarkdown>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ExplanationSectionCard({ section }: { section: LessonSection }) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.02)',
        padding: '12px 14px',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
      }}
    >
      <h5 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 6px' }}>
        {sectionIcon(section.type)}{' '}
        <MathMarkdown>{section.heading}</MathMarkdown>
      </h5>
      <div style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        <MathMarkdown>{section.body}</MathMarkdown>
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
          <figcaption style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '2px', textAlign: 'center' }}>
            Figure: {section.heading}
          </figcaption>
          <DiagramRenderer data={section.diagram as { type: string; [key: string]: unknown }} />
        </figure>
      )}
    </div>
  );
}

interface GuidedHelpDrawerProps {
  lessonContent: TutorExplainResponse | null;
  workedExample: WorkedExample | null;
  chatHistory: ChatMessage[];
  onSendMessage: (msg: string) => void;
  suggestedActions?: string[];
  onSuggestedAction?: (action: string) => void;
  dialogueLoading: boolean;
  helpChips: HelpChip[];
  subjectColor: string;
  hasAttempted: boolean;
  isExplaining?: boolean;
  exampleOpenToken?: number;
  isIndependentPhase?: boolean;
  onSupportUsed?: (level: 1 | 2 | 3 | 4) => void;
}

const ACTION_LABELS: Record<string, string> = {
  show_worked_example: 'Show worked example',
  give_next_step: 'Ask a guiding question',
  try_again: 'Try again',
  explain_my_answer: 'Explain my answer',
  mark_final_answer: 'Submit my answer',
  change_topic: 'Change topic',
};

const SUPPORTED_ACTIONS = new Set(Object.keys(ACTION_LABELS));

export default function GuidedHelpDrawer({
  lessonContent,
  workedExample,
  chatHistory,
  onSendMessage,
  suggestedActions = [],
  onSuggestedAction,
  dialogueLoading,
  helpChips,
  subjectColor,
  hasAttempted,
  isExplaining = false,
  exampleOpenToken = 0,
  isIndependentPhase = false,
  onSupportUsed,
}: GuidedHelpDrawerProps) {
  const [activeTab, setActiveTab] = useState<'dialogue' | 'lesson' | 'example'>('dialogue');
  const [localInput, setLocalInput] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view. Scroll only the message list: the page
  // itself must not move when the panel opens or a reply arrives.
  useEffect(() => {
    const list = messagesRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chatHistory.length, dialogueLoading, activeTab]);

  // Socratic pre-attempt limit check
  const studentTurnsCount = chatHistory.filter(m => m.role === 'student').length;
  const isDialogueCapped = !hasAttempted && studentTurnsCount >= 2;
  const canViewWorkedExample = hasAttempted && !!workedExample?.has_worked_example;
  const visibleSuggestedActions = suggestedActions.filter(action => SUPPORTED_ACTIONS.has(action));
  const withPreAttemptPrefix = (message: string, mode: HelpChip['preAttemptMode'] = 'concept') => {
    if (hasAttempted) return message;
    return mode === 'first_step'
      ? `[PRE_ATTEMPT_FIRST_STEP] ${message}`
      : `[PRE_ATTEMPT_CONCEPT] ${message}`;
  };

  useEffect(() => {
    if (exampleOpenToken > 0 && canViewWorkedExample) {
      setActiveTab('example');
    }
  }, [exampleOpenToken, canViewWorkedExample]);

  const handleSend = () => {
    const msg = localInput.trim();
    if (!msg || dialogueLoading || isDialogueCapped || isIndependentPhase) return;
    onSendMessage(withPreAttemptPrefix(msg));
    setLocalInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const readAloud = (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[*_#`]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };

  if (isIndependentPhase) return null;

  return (
    <div
      className="glass-panel"
      style={{
        borderRadius: '16px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        height: '100%',
      }}
    >
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }}>
        <button
          onClick={() => setActiveTab('dialogue')}
          style={{
            flex: 1,
            background: 'transparent',
            color: activeTab === 'dialogue' ? subjectColor : 'var(--text-secondary)',
            borderBottom: activeTab === 'dialogue' ? `2px solid ${subjectColor}` : 'none',
            borderRadius: 0,
            padding: '12px 8px',
            fontSize: '15px',
            fontWeight: '700',
            boxShadow: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          <MessageCircle size={18} /> Chat
        </button>
        <button
          onClick={() => {
            onSupportUsed?.(1);
            setActiveTab('lesson');
          }}
          disabled={!lessonContent}
          style={{
            flex: 1,
            background: 'transparent',
            color: activeTab === 'lesson' ? subjectColor : 'var(--text-secondary)',
            borderBottom: activeTab === 'lesson' ? `2px solid ${subjectColor}` : 'none',
            borderRadius: 0,
            padding: '12px 8px',
            fontSize: '15px',
            fontWeight: '700',
            boxShadow: 'none',
            opacity: lessonContent ? 1 : 0.4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          <HelpCircle size={16} /> Concept
        </button>
        <button
          onClick={() => {
            if (canViewWorkedExample) {
              onSupportUsed?.(3);
              setActiveTab('example');
            }
          }}
          disabled={!canViewWorkedExample}
          style={{
            flex: 1,
            background: 'transparent',
            color: activeTab === 'example' ? subjectColor : 'var(--text-secondary)',
            borderBottom: activeTab === 'example' ? `2px solid ${subjectColor}` : 'none',
            borderRadius: 0,
            padding: '12px 8px',
            fontSize: '15px',
            fontWeight: '700',
            boxShadow: 'none',
            opacity: canViewWorkedExample ? 1 : 0.6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          <BookOpen size={16} /> Example
        </button>
      </div>

      {/* Tab Panels */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/*Dialogue Panel */}
        {activeTab === 'dialogue' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
            {/* Scrollable conversation bubbles. They shrink first, so the input stays in view. */}
            <div ref={messagesRef} style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              minHeight: 0
            }}>
              {chatHistory.length === 0 && (
                <div style={{ fontSize: '15px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '20px' }}>
                  {hasAttempted
                    ? 'Ask about this question. The tutor helps you find the next step.'
                    : 'Ask a question about the concept before you submit your answer!'}
                </div>
              )}
              {chatHistory.map((msg, i) => {
                const isStudent = msg.role === 'student';
                const isTutor = msg.role === 'tutor';
                const isSystem = msg.role === 'system';

                if (isSystem) {
                  return (
                    <div key={i} style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', margin: '4px 0' }}>
                      {msg.content}
                    </div>
                  );
                }

                return (
                  <div key={i} style={{
                    alignSelf: isStudent ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    background: isStudent ? subjectColor : 'rgba(255, 255, 255, 0.05)',
                    color: isStudent ? 'white' : 'var(--text-primary)',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    border: isStudent ? 'none' : '1px solid var(--border-color)',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.03)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', gap: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 'bold', opacity: 0.7 }}>
                        {isStudent ? 'You' : 'AI Tutor'}
                      </span>
                      {isTutor && (
                        <button
                          onClick={() => readAloud(msg.content)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: '2px',
                            cursor: 'pointer',
                            color: 'var(--text-muted)',
                            boxShadow: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <Volume2 size={12} />
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: '15px', lineHeight: '1.6' }}>
                      <MathMarkdown>{msg.content}</MathMarkdown>
                    </div>
                  </div>
                );
              })}
              {dialogueLoading && (
                <div style={{ alignSelf: 'flex-start', fontSize: '14px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  AI Tutor is typing...
                </div>
              )}
            </div>

            {/* Input area & Quick Chips */}
            <div style={{ padding: '12px', borderTop: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.01)', flexShrink: 0 }}>
              {/* Socratic limit warning */}
              {isDialogueCapped && (
                <div style={{ fontSize: '13px', color: '#b45309', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)', padding: '8px 12px', borderRadius: '8px', marginBottom: '8px' }}>
                  ⚠️ Pre-attempt dialogue limit reached. Try attempting the answer before asking further!
                </div>
              )}
              {isExplaining && (
                <div style={{ fontSize: '13px', color: '#4f46e5', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', padding: '8px 12px', borderRadius: '8px', marginBottom: '8px', lineHeight: 1.5 }}>
                  Write each step you tried. The tutor will look for the first step that needs fixing, without giving away the final answer.
                </div>
              )}

              {visibleSuggestedActions.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                  {visibleSuggestedActions.map(action => (
                    <button
                      key={action}
                      onClick={() => {
                        onSuggestedAction?.(action);
                      }}
                      disabled={dialogueLoading}
                      aria-label={`Suggested action: ${ACTION_LABELS[action]}`}
                      style={{
                        background: 'rgba(99,102,241,0.08)',
                        border: '1px solid rgba(99,102,241,0.25)',
                        color: 'var(--text-primary)',
                        padding: '6px 10px',
                        borderRadius: '14px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: 'none',
                      }}
                    >
                      {ACTION_LABELS[action]}
                    </button>
                  ))}
                </div>
              )}

              {/* Suggestions chips */}
              {!isExplaining && !isDialogueCapped && chatHistory.filter(m => m.role === 'student').length === 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  {helpChips.map((chip, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        onSendMessage(withPreAttemptPrefix(chip.prompt, chip.preAttemptMode));
                      }}
                      disabled={dialogueLoading}
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-secondary)',
                        padding: '6px 10px',
                        borderRadius: '12px',
                        fontSize: '13px',
                        fontWeight: '600',
                        boxShadow: 'none',
                        cursor: 'pointer',
                        textAlign: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Chat Input field */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                <textarea
                  value={localInput}
                  onChange={e => setLocalInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={dialogueLoading || isDialogueCapped}
                  placeholder={isDialogueCapped ? "Attempt the question to continue chatting..." : isExplaining ? "Write your working step by step..." : "Ask the Socratic tutor..."}
                  style={{
                    flex: 1,
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    fontSize: '15px',
                    outline: 'none',
                    resize: 'vertical',
                    height: '96px',
                    fontFamily: 'inherit',
                    lineHeight: '1.4'
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!localInput.trim() || dialogueLoading || isDialogueCapped}
                  style={{
                    background: subjectColor,
                    color: 'white',
                    padding: '10px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    width: '44px',
                    flexShrink: 0
                  }}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Lesson/Concept Panel — full content; scroll inside panel (height matches question card) */}
        {activeTab === 'lesson' && lessonContent && (() => {
          const lc = lessonContent.lesson_content;
          const sections = lc?.explanation_sections ?? [];
          const objectives = lc?.learning_objectives ?? [];
          const showExpandedLesson = hasAttempted;
          const hasAnyBody = Boolean(
            lessonContent.core_rule
            || objectives.length > 0
            || (lc?.success_criteria?.length ?? 0) > 0
            || (lc?.key_vocabulary?.length ?? 0) > 0
            || (showExpandedLesson && (
              lessonContent.explanation
              || sections.length > 0
              || (lc?.common_mistakes?.length ?? 0) > 0
              || (lc?.real_world_connections?.length ?? 0) > 0
              || (lc?.additional_worked_examples?.length ?? 0) > 0
              || (lc?.guided_practice?.length ?? 0) > 0
              || (lc?.independent_practice?.length ?? 0) > 0
            )),
          );
          return (
            <div
              role="region"
              aria-label="Concept lesson content"
              style={{
                padding: '16px',
                overflowY: 'auto',
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              {!hasAnyBody && (
                <div style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  No concept notes are available for this topic yet.
                </div>
              )}

              {lessonContent.core_rule && (
                <div
                  style={{
                    background: 'rgba(99, 102, 241, 0.06)',
                    borderLeft: `3px solid ${subjectColor}`,
                    padding: '12px 14px',
                    borderRadius: '4px',
                    fontSize: '16px',
                    fontStyle: 'italic',
                    lineHeight: 1.55,
                  }}
                >
                  <MathMarkdown>{`💡 ${lessonContent.core_rule}`}</MathMarkdown>
                </div>
              )}

              {showExpandedLesson && lessonContent.explanation && !lc && (
                <div style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  <MathMarkdown>{lessonContent.explanation}</MathMarkdown>
                </div>
              )}

              {objectives.length > 0 && (
                <div>
                  <h4 style={{ fontSize: '16px', fontWeight: 700, color: subjectColor, margin: '0 0 6px' }}>
                    What you will learn
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                    {objectives.map((o, idx) => (
                      <li key={idx} style={{ marginBottom: '4px' }}><MathMarkdown>{o}</MathMarkdown></li>
                    ))}
                  </ul>
                </div>
              )}

              {(lc?.success_criteria?.length ?? 0) > 0 && (
                <div>
                  <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#10b981', margin: '0 0 6px' }}>
                    🎯 Success Criteria
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                    {(lc?.success_criteria ?? []).map((s, idx) => (
                      <li key={idx} style={{ marginBottom: '4px' }}><MathMarkdown>{s}</MathMarkdown></li>
                    ))}
                  </ul>
                </div>
              )}

              {showExpandedLesson && sections.map((sec, idx) => (
                <ExplanationSectionCard key={idx} section={sec} />
              ))}

              {(lc?.key_vocabulary?.length ?? 0) > 0 && (
                <div>
                  <h4 style={{ fontSize: '16px', fontWeight: 700, color: subjectColor, margin: '0 0 6px' }}>
                    Key Vocabulary
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {(lc?.key_vocabulary ?? []).map((v, i) => (
                      <div
                        key={i}
                        style={{
                          fontSize: '15px',
                          padding: '8px 10px',
                          background: 'rgba(255,255,255,0.02)',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)',
                          lineHeight: 1.5,
                        }}
                      >
                        <strong>{v.term}:</strong>{' '}
                        <MathMarkdown>{v.definition}</MathMarkdown>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showExpandedLesson && (lc?.common_mistakes?.length ?? 0) > 0 && (
                <div>
                  <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#dc2626', margin: '0 0 6px' }}>
                    ⚠️ Common Mistakes
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                    {(lc?.common_mistakes ?? []).map((m, i) => (
                      <li key={i} style={{ marginBottom: '4px' }}><MathMarkdown>{m}</MathMarkdown></li>
                    ))}
                  </ul>
                </div>
              )}

              {showExpandedLesson && (lc?.real_world_connections?.length ?? 0) > 0 && (
                <div>
                  <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#16a34a', margin: '0 0 6px' }}>
                    🌍 Real-World Connections
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                    {(lc?.real_world_connections ?? []).map((c, i) => (
                      <li key={i} style={{ marginBottom: '4px' }}><MathMarkdown>{c}</MathMarkdown></li>
                    ))}
                  </ul>
                </div>
              )}

              {showExpandedLesson && (
                <>
                  <PracticeBlock
                    title="📝 Extra examples"
                    items={lc?.additional_worked_examples ?? []}
                    subjectColor={subjectColor}
                  />
                  <PracticeBlock
                    title="🤝 Guided practice (from lesson)"
                    items={lc?.guided_practice ?? []}
                    subjectColor={subjectColor}
                  />
                  <PracticeBlock
                    title="💪 Independent practice"
                    items={lc?.independent_practice ?? []}
                    subjectColor={subjectColor}
                  />
                </>
              )}
            </div>
          );
        })()}

        {/* Worked Example Panel */}
        {activeTab === 'example' && (!workedExample?.has_worked_example) && (
          <div style={{ padding: '16px', fontSize: '15px', color: 'var(--text-secondary)', lineHeight: '1.6', flex: 1, minHeight: 0, overflowY: 'auto' }}>
            No worked example is available for this concept yet.
          </div>
        )}
        {activeTab === 'example' && workedExample?.has_worked_example && !hasAttempted && (
          <div style={{ padding: '16px', fontSize: '15px', color: 'var(--text-secondary)', lineHeight: '1.6', flex: 1, minHeight: 0, overflowY: 'auto' }}>
            Try an answer first. The worked example unlocks after feedback so you can compare your thinking without seeing the final answer too early.
          </div>
        )}
        {activeTab === 'example' && hasAttempted && workedExample?.has_worked_example && workedExample?.worked_example && (
          <div
            role="region"
            aria-label="Worked example"
            style={{
              padding: '16px',
              overflowY: 'auto',
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            {workedExample.core_rule && (
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                <MathMarkdown>{`💡 ${workedExample.core_rule}`}</MathMarkdown>
              </div>
            )}
            <div style={{ fontWeight: '700', fontSize: '16px', color: '#16a34a' }}>
              📖 <MathMarkdown>{workedExample.worked_example.question}</MathMarkdown>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {workedExample.worked_example.steps.map((step: any) => (
                <div key={step.step} style={{ display: 'flex', gap: '10px', fontSize: '15px' }}>
                  <span style={{ color: '#16a34a', fontWeight: '700', flexShrink: 0 }}>Step {step.step}:</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: 'var(--text-primary)' }}><MathMarkdown>{step.instruction}</MathMarkdown></div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>→ <MathMarkdown>{step.result}</MathMarkdown></div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '15px', color: '#16a34a', fontWeight: '700', borderTop: '1px dashed var(--border-color)', paddingTop: '10px' }}>
              Final Answer: <MathMarkdown>{workedExample.worked_example.answer}</MathMarkdown>
            </div>
            {workedExample.worked_example.explanation && (
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <MathMarkdown>{workedExample.worked_example.explanation}</MathMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
