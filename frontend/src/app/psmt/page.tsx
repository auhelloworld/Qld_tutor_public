'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import MathMarkdown from '../../components/MathMarkdown';
import BackToPracticeLink from '../../components/BackToPracticeLink';
import { BookOpen, CheckSquare, Compass, Edit3, Loader2, Send, Trash2 } from 'lucide-react';
import { checkPSMT } from '../../lib/api';
import { PSMT_GUIDELINES } from '../../lib/psmt_guidelines';
import type { PSMTStructuredFeedback } from '../../lib/api-types';

const PSMT_DRAFT_KEY = 'qld_tutor_psmt_draft';
const AUTO_SAVE_DELAY_MS = 1500;
const PSMT_SUBJECT = 'math';
const MAX_PSMT_IMAGES = 5;
const MAX_PSMT_IMAGE_BYTES = 2 * 1024 * 1024;
const PSMT_SECTIONS = ['Formulate', 'Solve', 'Evaluate', 'Communicate'] as const;
type PSMTSectionName = typeof PSMT_SECTIONS[number];

function newMutationRequestId(prefix: string): string {
  const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomUuid}`;
}

function sectionLabel(section: PSMTSectionName): string {
  return section === 'Evaluate' ? 'Evaluate and verify' : section;
}

interface PsmtDraft {
  subject: string;
  section: string;
  draftText: string;
  uploadedImages: string[];
  checkedCriteria: Record<string, boolean>;
  savedAt: string;
}

export default function PSMTPage() {
  const [subject, setSubject] = useState(PSMT_SUBJECT);
  const [section, setSection] = useState<PSMTSectionName>("Formulate");
  const [draftText, setDraftText] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [structuredFeedback, setStructuredFeedback] = useState<PSMTStructuredFeedback | null>(null);
  const [llmStatus, setLlmStatus] = useState<'live' | 'mock' | 'unavailable' | null>(null);
  const [checkedCriteria, setCheckedCriteria] = useState<Record<string, boolean>>({});
  const [expandedCriteria, setExpandedCriteria] = useState<Record<string, boolean>>({});
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const autoSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const psmtRequestRef = useRef<{ key: string; requestId: string } | null>(null);

  // Load draft from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PSMT_DRAFT_KEY);
      if (raw) {
        const draft: PsmtDraft = JSON.parse(raw);
        setSubject(PSMT_SUBJECT);
        if (draft.section && PSMT_GUIDELINES[draft.section]) setSection(draft.section as typeof section);
        if (draft.draftText) setDraftText(draft.draftText);
        if (draft.uploadedImages) setUploadedImages(draft.uploadedImages);
        if (draft.checkedCriteria) setCheckedCriteria(draft.checkedCriteria);
        if (draft.savedAt) setLastSavedAt(draft.savedAt);
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Auto-save draft to localStorage with debounce
  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      const now = new Date().toISOString();
      const draft: PsmtDraft = {
        subject,
        section,
        draftText,
        uploadedImages: [], // images are too large for localStorage; only save text
        checkedCriteria,
        savedAt: now,
      };
      try {
        localStorage.setItem(PSMT_DRAFT_KEY, JSON.stringify(draft));
        setLastSavedAt(now);
      } catch {
        // Ignore quota errors
      }
    }, AUTO_SAVE_DELAY_MS);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [subject, section, draftText, uploadedImages, checkedCriteria]);

  const activeGuidelines = PSMT_GUIDELINES[section];

  const handleCheckCriteria = (criterionText: string) => {
    setCheckedCriteria(prev => ({
      ...prev,
      [criterionText]: !prev[criterionText]
    }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const remainingSlots = MAX_PSMT_IMAGES - uploadedImages.length;
    if (remainingSlots <= 0) {
      setFeedback(`### Image limit reached\nYou can attach up to ${MAX_PSMT_IMAGES} screenshots for one PSMT check.`);
      e.target.value = '';
      return;
    }
    const files = Array.from(e.target.files).slice(0, remainingSlots);
    files.forEach(file => {
      if (file.size > MAX_PSMT_IMAGE_BYTES) {
        setFeedback(`### Image too large\n"${file.name}" is larger than 2 MB. Compress it or crop the screenshot before uploading.`);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setUploadedImages(prev => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleRemoveImage = (idx: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== idx));
  };

  const handleClear = () => {
    psmtRequestRef.current = null;
    setDraftText('');
    setUploadedImages([]);
    setFeedback(null);
    setStructuredFeedback(null);
    setLlmStatus(null);
    setCheckedCriteria({});
    localStorage.removeItem(PSMT_DRAFT_KEY);
  };

  const handleEvaluate = async () => {
    if (!draftText.trim()) return;
    setLoading(true);
    setFeedback(null);
    setStructuredFeedback(null);
    setLlmStatus(null);
    const requestKey = JSON.stringify([subject, section, draftText, uploadedImages]);
    const request = psmtRequestRef.current?.key === requestKey
      ? psmtRequestRef.current
      : { key: requestKey, requestId: newMutationRequestId('psmt-check') };
    psmtRequestRef.current = request;
    try {
      const res = await checkPSMT(subject, section, draftText, uploadedImages, undefined, request.requestId);
      psmtRequestRef.current = null;
      setFeedback(res.feedback);
      setStructuredFeedback(res.structured_feedback || null);
      setLlmStatus(res.llm_status === 'mock' ? 'mock' : res.llm_status === 'unavailable' ? 'unavailable' : 'live');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '';
      setFeedback(`### Error\nFailed to evaluate draft. ${message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
      {/* Back button & Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ marginBottom: '16px' }}>
          <BackToPracticeLink />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', padding: '4px 10px', background: 'linear-gradient(135deg, rgba(8,145,178,0.15), rgba(6,182,212,0.1))', color: '#0891b2', border: '1px solid rgba(8,145,178,0.3)', borderRadius: '9999px', fontWeight: '700' }}>
            QCAA IA1 Syllabus Tool
          </span>
        </div>
        <h1 style={{ fontSize: '32px', fontWeight: '800', background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.03em' }}>
          🏆 PSMT & Investigation Assistant
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '8px', fontSize: '15px' }}>
          Get expert AI feedback on your draft report sections against the official Queensland QCAA criteria. <strong>No answers written, only high-quality mentoring support.</strong>
        </p>
      </div>

      <div className="psmt-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '24px', alignItems: 'start' }}>
        {/* Left Column: Guidelines & Checklist */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Select Subject & Section */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Compass size={18} color="var(--accent-color)" /> Select Target Task
            </h3>
            
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase' }}>Subject</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['math'].map(sub => (
                  <button
                    key={sub}
                    onClick={() => setSubject(sub)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '8px',
                      border: `1px solid ${subject === sub ? 'rgba(79, 70, 229, 0.4)' : 'var(--border-color)'}`,
                      background: subject === sub ? 'rgba(79, 70, 229, 0.08)' : 'var(--bg-secondary)',
                      color: subject === sub ? 'var(--accent-color)' : 'var(--text-primary)',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      textTransform: 'capitalize',
                      fontSize: '12px',
                    }}
                  >
                    {sub === 'math' ? '🔢 Mathematics' : sub}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase' }}>Report Stage</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {PSMT_SECTIONS.map(sec => (
                  <button
                    key={sec}
                    onClick={() => {
                      setSection(sec);
                      setFeedback(null);
                      setCheckedCriteria({});
                    }}
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      border: `1px solid ${section === sec ? 'rgba(8, 145, 178, 0.4)' : 'var(--border-color)'}`,
                      background: section === sec ? 'rgba(8, 145, 178, 0.08)' : 'var(--bg-secondary)',
                      color: section === sec ? '#0891b2' : 'var(--text-primary)',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    {sectionLabel(sec)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section Guidelines & Self-Audit Checklist */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px', color: '#0891b2' }}>
              {activeGuidelines.title}
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: '1.5' }}>
              {activeGuidelines.description}
            </p>

            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckSquare size={16} color="var(--success)" /> Self-Audit Checklist & Helper
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {activeGuidelines.criteria.map((c, i) => {
                  const isChecked = !!checkedCriteria[c.text];
                  const isExpanded = !!expandedCriteria[c.text];
                  return (
                    <div 
                      key={i} 
                      style={{ 
                        padding: '12px', 
                        border: '1px solid var(--border-color)', 
                        borderRadius: '8px', 
                        background: isChecked ? 'rgba(5, 150, 105, 0.02)' : 'rgba(255,255,255,0.01)', 
                        transition: 'all 0.2s' 
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', flexGrow: 1 }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleCheckCriteria(c.text)}
                            style={{ 
                              width: '16px', 
                              height: '16px', 
                              marginTop: '3px', 
                              accentColor: 'var(--accent-color)', 
                              cursor: 'pointer',
                              flexShrink: 0
                            }}
                          />
                          <span style={{ fontSize: '13.5px', color: isChecked ? 'var(--text-secondary)' : 'var(--text-primary)', fontWeight: '600', lineHeight: '1.4', textDecoration: isChecked ? 'line-through' : 'none' }}>
                            {c.text}
                          </span>
                        </label>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedCriteria(prev => ({ ...prev, [c.text]: !prev[c.text] }));
                          }}
                          style={{
                            background: isExpanded ? 'rgba(8, 145, 178, 0.15)' : 'transparent',
                            border: '1px solid rgba(8, 145, 178, 0.3)',
                            borderRadius: '4px',
                            color: '#0891b2',
                            fontSize: '11px',
                            fontWeight: '700',
                            padding: '3px 8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            transition: 'all 0.2s',
                            flexShrink: 0
                          }}
                        >
                          {isExpanded ? 'Hide ✕' : 'Guide 💡'}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="animate-fade-in" style={{ marginTop: '12px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '6px', fontSize: '12.5px', borderLeft: '3px solid #0891b2', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div>
                            <strong style={{ color: 'var(--text-primary)' }}>🤔 What it means:</strong>
                            <div style={{ color: 'var(--text-secondary)', marginTop: '2px', lineHeight: '1.4' }}>{c.explanation}</div>
                          </div>
                          <div>
                            <strong style={{ color: '#16a34a' }}>✅ High-Scoring Example:</strong>
                            <div style={{ color: 'var(--text-secondary)', marginTop: '4px', fontFamily: 'monospace', background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', lineHeight: '1.4', whiteSpace: 'pre-line' }}>{c.example}</div>
                          </div>
                          <div>
                            <strong style={{ color: '#ef4444' }}>❌ Common Pitfall:</strong>
                            <div style={{ color: 'var(--text-secondary)', marginTop: '2px', lineHeight: '1.4' }}>{c.mistake}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Draft Editor & Feedback */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Editor */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Edit3 size={18} color="var(--accent-color)" /> Edit Your Draft
            </h3>
            <textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder={`Paste your ${section} draft here... (e.g. assumptions list, variables table description, or calculations summary)`}
              maxLength={10000}
              style={{
                width: '100%',
                height: '480px',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
                fontSize: '14px',
                lineHeight: '1.6',
                resize: 'vertical',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              className="focus-ring"
            />
            {/* Image Upload Zone */}
            <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px' }}>
                📸 Attach Screenshots (Graphs, Tables, or Equations):
              </label>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleImageUpload}
                style={{ display: 'none' }}
                id="psmt-image-upload"
              />
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <label
                  htmlFor="psmt-image-upload"
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px dashed var(--accent-color)',
                    background: 'rgba(79, 70, 229, 0.05)',
                    color: 'var(--accent-color)',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s'
                  }}
                  className="hover-scale"
                >
                  ➕ Choose Images
                </label>
                
                {uploadedImages.map((img, idx) => (
                  <div key={idx} style={{ position: 'relative', width: '60px', height: '60px', borderRadius: '6px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                    <Image
                      src={img}
                      alt={`Uploaded PSMT evidence ${idx + 1}`}
                      width={60}
                      height={60}
                      unoptimized
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(idx)}
                      style={{
                        position: 'absolute',
                        top: '2px',
                        right: '2px',
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: 'rgba(239, 68, 68, 0.9)',
                        color: '#fff',
                        border: 'none',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {draftText.length} / 10000
                </span>
                {lastSavedAt && (
                  <span style={{ fontSize: '12px', color: 'var(--success)' }}>
                    ✓ Saved {new Date(lastSavedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleClear}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    padding: '8px 16px', borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                    background: 'transparent', color: 'var(--text-secondary)',
                    fontWeight: '600', fontSize: '13px', cursor: 'pointer',
                  }}>
                  <Trash2 size={14} /> Clear
                </button>
                <button
                  onClick={handleEvaluate}
                  disabled={loading || !draftText.trim()}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    padding: '12px 24px', borderRadius: '10px', border: 'none',
                    background: 'var(--accent-gradient)', color: '#fff',
                    fontWeight: '600', fontSize: '14px',
                    cursor: draftText.trim() ? 'pointer' : 'not-allowed',
                    opacity: draftText.trim() ? 1 : 0.6,
                    boxShadow: '0 4px 14px rgba(79, 70, 229, 0.2)',
                    transition: 'transform 0.2s, opacity 0.2s'
                  }}>
                  {loading ? (
                    <><Loader2 size={16} /> Evaluating...</>
                  ) : (
                    <><Send size={16} /> Run QCAA ISMG Evaluation</>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Feedback Output */}
          {llmStatus === 'mock' && (feedback || structuredFeedback) && (
            <div className="glass-panel animate-fade-in" style={{
              padding: '14px 16px',
              border: '1px solid rgba(245,158,11,0.35)',
              background: 'rgba(245,158,11,0.12)',
              color: 'var(--text-primary)',
              fontSize: '13px',
              lineHeight: 1.5,
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: '16px' }}>⚠️</span>
              <span>
                <strong>Practice placeholder — no AI is configured.</strong> This mentor feedback is a
                deterministic placeholder, not a real ISMG evaluation. Add an LLM key for genuine PSMT mentoring.
              </span>
            </div>
          )}
          {llmStatus === 'unavailable' && (feedback || structuredFeedback) && (
            <div className="glass-panel animate-fade-in" style={{
              padding: '14px 16px',
              border: '1px solid rgba(245,158,11,0.35)',
              background: 'rgba(245,158,11,0.12)',
              color: 'var(--text-primary)',
              fontSize: '13px',
              lineHeight: 1.5,
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: '16px' }}>!</span>
              <span>
                <strong>AI mentor temporarily unavailable.</strong> Your draft has not been marked as wrong.
                Please try again later for a live ISMG-style review.
              </span>
            </div>
          )}
          {llmStatus === 'live' && structuredFeedback && (
            <div className="glass-panel animate-fade-in" style={{
              padding: '18px',
              border: '1px solid rgba(99,102,241,0.24)',
              background: 'rgba(99,102,241,0.06)',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>
                    Readiness
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: structuredFeedback.readiness_level === 'ready' ? '#16a34a' : structuredFeedback.readiness_level === 'needs_attention' ? '#dc2626' : '#d97706' }}>
                    {structuredFeedback.readiness_level.replace('_', ' ')}
                  </div>
                </div>
                {structuredFeedback.top_gaps?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>
                      Top Gap
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                      {structuredFeedback.top_gaps[0]}
                    </div>
                  </div>
                )}
                {structuredFeedback.next_revision_actions?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>
                      Next Action
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                      {structuredFeedback.next_revision_actions[0]}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {feedback && (
            <div className="glass-panel animate-fade-in" style={{ padding: '24px', borderLeft: '4px solid var(--accent-color)' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-color)' }}>
                <BookOpen size={18} /> Mentor Feedback
              </h3>
              <div style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--text-primary)' }} className="markdown-body">
                <MathMarkdown>
                  {feedback}
                </MathMarkdown>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
