'use client';
import { useState, useRef, useCallback } from 'react';
import type { WritingPromptExport } from '../../lib/api';

const CONSENT_KEY = 'qld_byo_consent';

interface Props {
  /** Render in the prominent (mock-mode) style vs a compact opt-in. */
  prominent?: boolean;
  /** Fetch the export prompts (structured + readable). */
  onExport: () => Promise<WritingPromptExport>;
  /** Submit the pasted external reply; resolves when the new result is rendered. */
  onImport: (externalText: string) => Promise<void>;
}

/**
 * Bring-your-own-LLM panel (Audit F-BYO).
 *
 * Lets the student/parent copy a ready-to-run assessment prompt into an
 * external LLM (Gemini/Claude web) and paste the reply back for a full,
 * rubric-aligned result. All transfer is manual copy/paste — nothing is sent
 * to a third party by the app itself.
 */
export default function WritingByoPanel({ prominent = false, onExport, onImport }: Props) {
  const [open, setOpen] = useState(prominent);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [prompts, setPrompts] = useState<WritingPromptExport | null>(null);
  const [copied, setCopied] = useState<'readable' | 'structured' | null>(null);
  // Which prompt is currently shown in the preview textarea
  const [showingPrompt, setShowingPrompt] = useState<'readable' | 'structured' | null>(null);
  const [externalText, setExternalText] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptPreviewRef = useRef<HTMLTextAreaElement>(null);

  const ensureConsent = (): boolean => {
    try {
      if (localStorage.getItem(CONSENT_KEY) === 'yes') return true;
    } catch { /* ignore */ }
    const ok = window.confirm(
      'This copies your writing so you can paste it into an external AI (e.g. Gemini or Claude). '
      + 'Your draft leaves this app only when you choose to paste it there. Continue?'
    );
    if (ok) {
      try { localStorage.setItem(CONSENT_KEY, 'yes'); } catch { /* ignore */ }
    }
    return ok;
  };

  const loadPrompts = async () => {
    if (!ensureConsent()) return;
    setLoadingPrompt(true);
    setError(null);
    try {
      const res = await onExport();
      setPrompts(res);
    } catch {
      setError('Could not build the prompt. Please try again.');
    } finally {
      setLoadingPrompt(false);
    }
  };

  const copyPrompt = useCallback(async (which: 'readable' | 'structured') => {
    if (!prompts) return;
    const text = which === 'readable' ? prompts.readable_prompt : prompts.structured_prompt;

    // 1. Try the modern Clipboard API first (works on HTTPS / localhost)
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setShowingPrompt(null);
      setTimeout(() => setCopied(null), 2000);
      return;
    } catch {
      // Clipboard API not available (HTTP context) — fall through to textarea fallback
    }

    // 2. Fallback: show the prompt text in a visible textarea and auto-select it
    setShowingPrompt(which);
    setError(null);
    // Wait for React to render the textarea, then select all text
    setTimeout(() => {
      const ta = promptPreviewRef.current;
      if (ta) {
        ta.focus();
        ta.select();
      }
    }, 50);
  }, [prompts]);

  const handlePromptPreviewFocus = () => {
    // Auto-select all text when user clicks/focuses the prompt preview
    promptPreviewRef.current?.select();
  };

  const submitImport = async () => {
    if (!externalText.trim() || importing) return;
    setImporting(true);
    setError(null);
    try {
      await onImport(externalText.trim());
      setExternalText('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      setError(
        msg.includes('unparseable')
          ? 'Could not read that reply. Paste the assistant\'s full reply including the outer { } braces, or use the readable prompt and enter scores yourself.'
          : 'Could not import the assessment. Please try again.'
      );
    } finally {
      setImporting(false);
    }
  };

  const accent = '#0891b2';

  if (!open) {
    return (
      <div style={{ marginBottom: '1.25rem' }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            background: 'transparent', border: `1px solid ${accent}`, color: accent,
            borderRadius: '8px', padding: '8px 14px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
          }}
        >
          🤖 Assess with my own AI (Gemini / Claude)
        </button>
      </div>
    );
  }

  const currentPromptText = showingPrompt && prompts
    ? (showingPrompt === 'readable' ? prompts.readable_prompt : prompts.structured_prompt)
    : null;

  return (
    <div className="glass-card" style={{
      padding: '1.1rem 1.25rem', marginBottom: '1.5rem',
      border: `1px solid ${accent}40`, borderLeft: `3px solid ${accent}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: accent, margin: 0 }}>
          🤖 Assess with your own AI
        </h3>
        {!prominent && (
          <button onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}>
            Hide
          </button>
        )}
      </div>
      <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 0.75rem' }}>
        {prominent ? 'No AI is configured here, but you can still get a real assessment: ' : 'Optional: '}
        copy the prompt, paste it into Gemini or Claude, then paste the reply back below. Use the <strong>structured</strong> prompt to get
        the full scored results screen; the <strong>readable</strong> prompt gives plain feedback to read.
      </p>

      {!prompts ? (
        <button
          onClick={loadPrompts}
          disabled={loadingPrompt}
          style={{
            background: accent, color: '#fff', border: 'none', borderRadius: '8px',
            padding: '9px 16px', fontSize: '0.85rem', fontWeight: 700, cursor: loadingPrompt ? 'default' : 'pointer',
          }}
        >
          {loadingPrompt ? 'Preparing…' : 'Prepare prompt'}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => copyPrompt('readable')}
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '8px', padding: '8px 14px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
            >
              {copied === 'readable' ? '✓ Copied' : '📋 Copy readable prompt'}
            </button>
            <button
              onClick={() => copyPrompt('structured')}
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '8px', padding: '8px 14px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
            >
              {copied === 'structured' ? '✓ Copied' : '📋 Copy structured prompt (for full results)'}
            </button>
          </div>

          {/* Prompt preview textarea — shown when Clipboard API is unavailable (HTTP) */}
          {currentPromptText && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <p style={{ fontSize: '0.78rem', color: accent, margin: 0, fontWeight: 600 }}>
                ↓ Prompt text is shown below — press Ctrl+C (or ⌘+C) to copy, then paste into your AI:
              </p>
              <textarea
                ref={promptPreviewRef}
                readOnly
                aria-label="Prompt to copy into your AI"
                value={currentPromptText}
                onFocus={handlePromptPreviewFocus}
                rows={10}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: '8px',
                  border: `2px solid ${accent}`, background: 'var(--bg-primary)',
                  color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical',
                }}
              />
              <button
                onClick={() => setShowingPrompt(null)}
                style={{
                  alignSelf: 'flex-end', background: 'transparent', border: 'none',
                  color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem',
                }}
              >
                Hide prompt ✕
              </button>
            </div>
          )}

          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>{prompts.schema_hint}</p>
          <textarea
            aria-label="Your AI's reply"
            value={externalText}
            onChange={(e) => setExternalText(e.target.value)}
            placeholder="Paste the AI's reply here…"
            rows={5}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: '8px',
              border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
              color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.85rem', resize: 'vertical',
            }}
          />
          <div>
            <button
              onClick={submitImport}
              disabled={!externalText.trim() || importing}
              style={{
                background: accent, color: '#fff', border: 'none', borderRadius: '8px',
                padding: '9px 18px', fontSize: '0.85rem', fontWeight: 700,
                cursor: (!externalText.trim() || importing) ? 'default' : 'pointer',
                opacity: (!externalText.trim() || importing) ? 0.6 : 1,
              }}
            >
              {importing ? 'Generating…' : 'Generate my assessment'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p style={{ fontSize: '0.8rem', color: '#dc2626', marginTop: '0.6rem', lineHeight: 1.45 }}>{error}</p>
      )}
    </div>
  );
}
