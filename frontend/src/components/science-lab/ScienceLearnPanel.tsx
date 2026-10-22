'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { ScienceActivityMeta } from '../../lib/science-lab/activity-types';
import {
  createEmptyInquiryNotebook,
  isInquiryNotebookEvidenceComplete,
  loadInquiryNotebookWithStatus,
  saveInquiryNotebook,
  type InquiryNotebookDraft,
} from '../../lib/science-lab/inquiry-notebook';
import MathMarkdown from '../MathMarkdown';
import InquiryNotebook, { type InquiryNotebookSaveStatus } from './InquiryNotebook';
import PredictionPanel from './controls/PredictionPanel';
import ObservationPanel from './controls/ObservationPanel';
import ExplanationPanel from './controls/ExplanationPanel';
import {
  getCompletedScienceActivityIds,
  markScienceActivityCompleted,
} from '../../lib/science-lab/completion';

export interface ScienceLearnPanelProps {
  activity: ScienceActivityMeta;
  readouts: Record<string, string | number>;
  onTransfer: () => void;
  onStepChange?: (stepIndex: number) => void;
  /** Notifies the page when the prediction gate opens, so the scene can reveal
   * the quantitative result that answers the prediction. */
  onRevealChange?: (revealed: boolean) => void;
}

/** A keyed boundary prevents one activity's local inquiry state reaching another. */
export default function ScienceLearnPanel(props: ScienceLearnPanelProps) {
  return <ScienceLearnActivityPanel key={props.activity.id} {...props} />;
}

function ScienceLearnActivityPanel({
  activity,
  readouts,
  onTransfer,
  onStepChange,
  onRevealChange,
}: ScienceLearnPanelProps) {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [notebook, setNotebook] = useState<InquiryNotebookDraft>(
    () => createEmptyInquiryNotebook(activity.id),
  );
  const [saveStatus, setSaveStatus] = useState<InquiryNotebookSaveStatus>('idle');
  const [isDraftPersisted, setIsDraftPersisted] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const completionMarkedRef = useRef(false);
  const revealChangeRef = useRef(onRevealChange);

  useEffect(() => {
    revealChangeRef.current = onRevealChange;
  }, [onRevealChange]);

  useEffect(() => {
    completionMarkedRef.current = false;
    const loaded = loadInquiryNotebookWithStatus(activity.id);
    const firstStepId = activity.learnSteps[0]?.id;
    const needsFirstStep = Boolean(firstStepId && !loaded.notebook.visitedStepIds.includes(firstStepId));
    const hydrated = {
      ...loaded.notebook,
      visitedStepIds: firstStepId
        ? [...new Set([firstStepId, ...loaded.notebook.visitedStepIds])]
        : loaded.notebook.visitedStepIds,
    };

    let persisted = loaded.persisted;
    let nextSaveStatus: InquiryNotebookSaveStatus = loaded.persisted ? 'saved' : 'idle';
    if (needsFirstStep) {
      persisted = saveInquiryNotebook(hydrated);
      nextSaveStatus = persisted ? 'saved' : 'unavailable';
    } else if (!loaded.storageAvailable) {
      nextSaveStatus = 'unavailable';
    }

    const alreadyCompleted = getCompletedScienceActivityIds().has(activity.id);
    completionMarkedRef.current = alreadyCompleted;
    setNotebook(hydrated);
    setIsDraftPersisted(persisted);
    setSaveStatus(nextSaveStatus);
    setIsCompleted(alreadyCompleted);
    revealChangeRef.current?.(loaded.notebook.predictionIndex !== null);
  }, [activity.id, activity.learnSteps]);

  const updateNotebook = (nextNotebook: InquiryNotebookDraft) => {
    setNotebook(nextNotebook);
    const persisted = saveInquiryNotebook(nextNotebook);
    setIsDraftPersisted(persisted);
    setSaveStatus(persisted ? 'saved' : 'unavailable');
  };

  const isPredicted = notebook.predictionIndex !== null;
  const submittedPredictionIndex = notebook.predictionIndex ?? undefined;
  const visitedSteps = new Set(notebook.visitedStepIds);

  const handlePredict = (index: number) => {
    updateNotebook({
      ...notebook,
      predictionIndex: index,
      updatedAt: new Date().toISOString(),
    });
    revealChangeRef.current?.(true);
  };

  const handleStepSelect = (index: number) => {
    setActiveStepIndex(index);
    const stepId = activity.learnSteps[index]?.id;
    if (stepId && !visitedSteps.has(stepId)) {
      updateNotebook({
        ...notebook,
        visitedStepIds: [...notebook.visitedStepIds, stepId],
        updatedAt: new Date().toISOString(),
      });
    }
    onStepChange?.(index);
  };

  /**
   * Completion represents a documented inquiry, not a correct prediction:
   * prediction submitted + every inquiry step visited + notebook evidence.
   */
  const allStepsVisited = activity.learnSteps.every((step) => visitedSteps.has(step.id));
  const notebookEvidenceComplete = isInquiryNotebookEvidenceComplete(notebook);
  const canComplete = isPredicted && allStepsVisited && notebookEvidenceComplete;

  useEffect(() => {
    if (!canComplete || !isDraftPersisted || completionMarkedRef.current) return;

    if (markScienceActivityCompleted(activity.id)) {
      completionMarkedRef.current = true;
      setIsCompleted(true);
      return;
    }

    // The latest draft remains usable in memory, but neither it nor the
    // completion may be advertised as durable until storage succeeds again.
    setIsDraftPersisted(false);
    setSaveStatus('unavailable');
  }, [canComplete, isDraftPersisted, activity.id]);

  const currentStep = activity.learnSteps[activeStepIndex] ?? activity.learnSteps[0];
  const transferTopic = activity.transferTopicIds[0] ?? activity.topicIds[0];

  return (
    <div className="science-learn-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Activity Header */}
      <div
        className="glass-panel"
        style={{
          padding: '16px',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'rgba(16, 185, 129, 0.12)',
              color: '#10b981',
              textTransform: 'uppercase',
            }}
          >
            {activity.strand}
          </span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'rgba(59, 130, 246, 0.12)',
              color: '#3b82f6',
            }}
          >
            Years {activity.yearLevels.join(', ')}
          </span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'rgba(168, 85, 247, 0.12)',
              color: '#a855f7',
            }}
          >
            {activity.interactionLevel} Interactive
          </span>
        </div>
        <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '4px 0', color: 'var(--text-primary)' }}>
          {activity.title}
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
          <MathMarkdown inline>{activity.description}</MathMarkdown>
        </p>
      </div>

      {/* Inquiry Stepper */}
      <nav
        aria-label="Inquiry stages"
        style={{
          display: 'flex',
          gap: '4px',
          background: 'var(--bg-secondary)',
          padding: '4px',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
          overflowX: 'auto',
        }}
      >
        {activity.learnSteps.map((step, idx) => {
          const isActive = idx === activeStepIndex;
          const isDone = visitedSteps.has(step.id) && !isActive;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => handleStepSelect(idx)}
              aria-label={`Step ${idx + 1}: ${step.title}`}
              aria-current={isActive ? 'step' : undefined}
              style={{
                flex: '1 1 0',
                minWidth: '92px',
                padding: '8px 6px',
                borderRadius: '6px',
                border: 'none',
                background: isActive ? 'var(--accent-color, #10b981)' : 'transparent',
                color: isActive ? '#fff' : isDone ? 'var(--accent-color, #10b981)' : 'var(--text-secondary)',
                fontWeight: isActive || isDone ? 700 : 500,
                fontSize: '12px',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.15s ease',
                lineHeight: 1.3,
              }}
            >
              {idx + 1}. {step.title}
            </button>
          );
        })}
      </nav>

      {/* Current Step Instruction Card */}
      <div
        className="glass-panel"
        style={{
          padding: '16px',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h3
            style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}
          >
            {currentStep.title}
          </h3>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'var(--bg-primary)',
              color: 'var(--text-muted)',
            }}
          >
            <MathMarkdown inline>{currentStep.targetConcept}</MathMarkdown>
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <MathMarkdown inline>{currentStep.prompt}</MathMarkdown>
        </p>
        {currentStep.hint && (
          isPredicted ? (
            <div
              style={{
                marginTop: '10px',
                padding: '8px 12px',
                borderRadius: '6px',
                background: 'rgba(59, 130, 246, 0.08)',
                borderLeft: '3px solid #3b82f6',
                fontSize: '12px',
                color: 'var(--text-secondary)',
              }}
            >
              <span aria-hidden="true">💡</span>{' '}
              <strong>Observation Note:</strong>{' '}
              <MathMarkdown inline>{currentStep.hint}</MathMarkdown>
            </div>
          ) : (
            /* Step hints state the expected measurements, so they must stay
             * closed until the prediction is submitted. */
            <div
              style={{
                marginTop: '10px',
                padding: '8px 12px',
                borderRadius: '6px',
                background: 'var(--bg-primary)',
                borderLeft: '3px solid var(--border-color)',
                fontSize: '12px',
                color: 'var(--text-muted)',
                fontStyle: 'italic',
              }}
            >
              <span aria-hidden="true">🔒</span>{' '}
              Observation note unlocks after you submit your prediction.
            </div>
          )
        )}
      </div>

      {/* Prediction Gate Component */}
      <PredictionPanel
        key={`${activity.id}:${submittedPredictionIndex ?? 'draft'}`}
        prediction={activity.prediction}
        onPredict={handlePredict}
        submittedIndex={submittedPredictionIndex}
        isSubmitted={isPredicted}
      />

      {/* Live Quantitative Observation Readouts */}
      <ObservationPanel
        observation={activity.observation}
        readouts={readouts}
        isUnlocked={isPredicted}
      />

      <InquiryNotebook
        notebook={notebook}
        observation={activity.observation}
        readouts={readouts}
        modelLimitations={activity.modelLimitations}
        predictionSubmitted={isPredicted}
        inquiryStepsVisited={allStepsVisited}
        saveStatus={saveStatus}
        onChange={updateNotebook}
      />

      {saveStatus === 'unavailable' && !isCompleted && (
        <p
          role="status"
          aria-live="polite"
          style={{
            margin: 0,
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid rgba(245, 158, 11, 0.45)',
            background: 'rgba(245, 158, 11, 0.1)',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            lineHeight: 1.45,
          }}
        >
          <strong>Session draft only.</strong>{' '}
          Browser storage is unavailable, so this investigation cannot count as persistently complete.
        </p>
      )}

      {/* Scientific Explanation & Model Limitations */}
      <ExplanationPanel
        modelLimitations={activity.modelLimitations}
        transferTopicId={transferTopic}
        onTransfer={onTransfer}
        isCompleted={isCompleted}
      />
    </div>
  );
}
