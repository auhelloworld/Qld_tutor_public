'use client';

import { useState, useRef, useEffect } from 'react';
import MathMarkdown from '../MathMarkdown';
import MathSymbolKeyboard from '../MathSymbolKeyboard';
import { Send, Volume2, CheckCircle, XCircle, MessageCircle } from 'lucide-react';
import { getLocale } from '../../lib/preferences';

const ACTION_LABELS: Record<string, string> = {
  show_worked_example: "Show worked example",
  give_next_step: "Give next step",
  try_again: "Try again",
  explain_my_answer: "Explain my answer",
  mark_final_answer: "Submit my answer",
  change_topic: "Change topic",
};

const SUPPORTED_ACTIONS = new Set(Object.keys(ACTION_LABELS));

interface ChatMessage {
  role: 'tutor' | 'system' | 'student';
  content: string;
  type?: 'success' | 'error' | 'dialogue';
}

interface DialoguePanelProps {
  chat: ChatMessage[];
  loading: boolean;
  dialogueLoading: boolean;
  suggestedActions: string[];
  dialogueDisabled: boolean;
  currentEx: any;
  lastAnswerCorrect: boolean;
  lastAnswerIncorrect: boolean;
  lastAnswerPendingReview?: boolean;
  isExplaining: boolean;
  feedbackStyle?: { width: number };
  showMathToolbar?: boolean;
  onSendMessage: (message: string) => void;
  onStartExplain: () => void;
}

const readAloud = (text: string) => {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const cleanText = text.replace(/[*_#`]/g, '');
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = getLocale();
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
};

function roleLabel(msg: ChatMessage): string {
  if (msg.role === 'student') return 'You';
  if (msg.role === 'system') return 'System';
  if (msg.type === 'success') return 'Tutor · Correct';
  if (msg.type === 'error') return 'Tutor · Incorrect';
  if (msg.type === 'dialogue') return 'Tutor';
  return 'Tutor';
}

export default function DialoguePanel({
  chat, loading, dialogueLoading, suggestedActions, dialogueDisabled, currentEx,
  lastAnswerCorrect, lastAnswerIncorrect, lastAnswerPendingReview = false, isExplaining,
  feedbackStyle,
  showMathToolbar = false,
  onSendMessage, onStartExplain,
}: DialoguePanelProps) {
  const [localInput, setLocalInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const studentTurnsCount = chat.filter(m => m.role === 'student').length;
  const isPreAttempt = !lastAnswerCorrect && !lastAnswerIncorrect && !lastAnswerPendingReview;
  const isDialogueCapped = dialogueDisabled || !currentEx || (isPreAttempt && studentTurnsCount >= 2);
  const visibleSuggestedActions = suggestedActions.filter(action => SUPPORTED_ACTIONS.has(action));

  // Keep transcript pinned to the latest append while this question is open.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chat.length, loading, dialogueLoading]);

  const handleSend = () => {
    const msg = localInput.trim();
    if (!msg || isDialogueCapped) return;
    onSendMessage(msg);
    setLocalInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && localInput.trim() && !isDialogueCapped) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="tutor-feedback-column" style={feedbackStyle ? { width: feedbackStyle.width } : undefined}>
      <div className="tutor-feedback-mobile-header">
        <h2 style={{ fontSize: '20px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
          AI Tutor Feedback
        </h2>
        <div style={{ marginTop: '3px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          Continuous log · clears on next question
        </div>
      </div>
      {/* Desktop title sits in TutorHeader; mobile title stays with this panel after the question. */}

      {/* Single scrollable transcript: all messages append in one stream */}
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-atomic="false"
        className="tutor-feedback-transcript"
        style={{
          flex: 1,
          minHeight: 0,
          padding: '16px 18px 20px',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {chat.length === 0 && !loading && !dialogueLoading && (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
            Feedback and dialogue for this question will appear here as a continuous log.
          </div>
        )}

        {chat.map((msg, i) => {
          const isSystem = msg.role === 'system';
          const isStudent = msg.role === 'student';
          const label = roleLabel(msg);
          const accent =
            msg.type === 'success' ? 'var(--success, #16a34a)'
            : msg.type === 'error' ? 'var(--error, #dc2626)'
            : isStudent ? 'var(--accent-color)'
            : isSystem ? 'var(--text-muted)'
            : 'var(--text-secondary)';

          return (
            <div
              key={i}
              role={msg.type === 'error' ? 'alert' : msg.type === 'success' ? 'status' : undefined}
              className="tutor-transcript-entry animate-fade-in"
              style={{
                padding: '10px 0',
                borderBottom: i < chat.length - 1 ? '1px solid var(--border-color)' : 'none',
                width: '100%',
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                marginBottom: isSystem ? 0 : '6px',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: accent,
                }}>
                  {msg.type === 'success' && <CheckCircle size={13} aria-hidden="true" />}
                  {msg.type === 'error' && <XCircle size={13} aria-hidden="true" />}
                  {msg.type === 'dialogue' && <MessageCircle size={13} aria-hidden="true" />}
                  <span>{label}</span>
                </div>
                {(msg.role === 'tutor' || msg.role === 'student') && (
                  <button
                    type="button"
                    onClick={() => readAloud(msg.content)}
                    aria-label="Read aloud"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: '2px 4px',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      minWidth: 28,
                      minHeight: 28,
                    }}
                  >
                    <Volume2 size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              {isSystem ? (
                <div style={{
                  fontSize: '12.5px',
                  color: 'var(--text-muted)',
                  lineHeight: 1.55,
                  textAlign: 'left',
                }}>
                  {msg.content}
                </div>
              ) : isStudent ? (
                <div style={{
                  fontSize: '14.5px',
                  color: 'var(--text-primary)',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {msg.content}
                </div>
              ) : (
                <div
                  className="tutor-transcript-body"
                  style={{
                    fontSize: '14.5px',
                    color: msg.type === 'error' ? 'var(--error)' : 'var(--text-primary)',
                    lineHeight: 1.55,
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                  }}
                >
                  <MathMarkdown>{msg.content}</MathMarkdown>
                </div>
              )}
            </div>
          );
        })}

        {dialogueDisabled && (
          <div className="animate-fade-in" style={{
            padding: '12px 0',
            color: '#d97706',
            fontSize: '13px',
            fontWeight: 600,
            borderTop: '1px solid rgba(251,191,36,0.25)',
            marginTop: '4px',
          }}>
            Chat limit reached. Submit your answer or{' '}
            <button
              type="button"
              onClick={() => onSendMessage('change_topic')}
              style={{
                background: 'rgba(251,191,36,0.15)',
                border: '1px solid rgba(251,191,36,0.4)',
                padding: '2px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                color: '#d97706',
                fontWeight: 700,
                fontSize: '12px',
              }}
            >
              pick a new topic →
            </button>
          </div>
        )}

        {(loading || dialogueLoading) && (
          <div role="status" className="animate-fade-in" style={{
            color: 'var(--text-secondary)',
            fontSize: '13px',
            fontStyle: 'italic',
            padding: '10px 0',
          }}>
            {dialogueLoading ? 'Tutor is typing…' : 'AI is thinking…'}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {visibleSuggestedActions.length > 0 && (
        <div style={{ padding: '8px 20px', display: 'flex', flexWrap: 'wrap', gap: '8px', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
          {visibleSuggestedActions.map(action => (
            <button
              key={action}
              type="button"
              onClick={() => onSendMessage(action)}
              disabled={dialogueLoading || isDialogueCapped}
              aria-label={`Suggested action: ${ACTION_LABELS[action]}`}
              style={{
                background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.3)',
                color: 'var(--text-primary)', padding: '6px 12px', borderRadius: '16px',
                fontSize: '12px', cursor: 'pointer', minHeight: '32px',
              }}
            >
              {ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      )}

      {currentEx && (
      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
        {isPreAttempt && studentTurnsCount >= 2 && (
          <div style={{ fontSize: '11px', color: '#b45309', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)', padding: '6px 12px', borderRadius: '8px', marginBottom: '12px' }}>
            ⚠️ Pre-attempt dialogue limit reached. Try attempting the answer before asking further!
          </div>
        )}
        {lastAnswerIncorrect && !isExplaining && (
          <button
            type="button"
            onClick={onStartExplain}
            disabled={isDialogueCapped}
            style={{
              display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center',
              width: '100%', padding: '14px', fontSize: '15px', fontWeight: '700',
              background: 'transparent', color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.4)', borderRadius: '10px',
              cursor: 'pointer', marginBottom: '14px',
              opacity: isDialogueCapped ? 0.5 : 1,
            }}
          >
            ✏️ Explain my answer — show me where I went wrong
          </button>
        )}
        <label htmlFor="dialogue-input" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
          {isExplaining ? '✏️ Write your solution step by step:' : '💬 Talk to the tutor'}
        </label>
        {isExplaining && (
          <div style={{ fontSize: '12px', color: 'var(--text-primary)', marginBottom: '8px', opacity: 0.85 }}>
            Describe each step of your working. I will find exactly where the mistake happened.
          </div>
        )}
        {showMathToolbar && (
          <MathSymbolKeyboard
            textareaId="dialogue-input"
            onInsert={setLocalInput}
            disabled={isDialogueCapped}
          />
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
          <textarea
            id="dialogue-input"
            value={localInput}
            onChange={e => setLocalInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isDialogueCapped || (lastAnswerIncorrect && !isExplaining) || lastAnswerPendingReview}
            aria-busy={dialogueLoading}
            maxLength={1000}
            placeholder={
              dialogueDisabled
                ? "Dialogue cap reached — submit your answer or pick a new question"
                : (isPreAttempt && studentTurnsCount >= 2)
                ? "Pre-attempt dialogue limit reached — try answering first"
                : (lastAnswerIncorrect && !isExplaining)
                ? "Click ✏️ Explain my answer above to start..."
                : lastAnswerPendingReview
                ? "Answer saved for parent review. You can continue to the next question."
                : "Ask the tutor anything… (Cmd/Ctrl+Enter to send)"
            }
            style={{ flex: 1, minHeight: '150px', resize: 'vertical', fontSize: '14px', opacity: (isDialogueCapped || lastAnswerPendingReview) ? 0.5 : 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={dialogueLoading || isDialogueCapped || !localInput.trim() || (lastAnswerIncorrect && !isExplaining) || lastAnswerPendingReview}
            aria-label="Send dialogue message"
            style={{ background: 'var(--accent-color)', color: 'white', padding: '10px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', width: '44px', flexShrink: 0, border: 'none' }}
          >
            <Send size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
