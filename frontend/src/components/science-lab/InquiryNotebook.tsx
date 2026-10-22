'use client';

import React, { useId } from 'react';
import type {
  ObservationDefinition,
  ObservationReadouts,
} from '../../lib/science-lab/activity-types';
import {
  countDistinctInquiryObservations,
  createInquiryObservationSnapshot,
  formatInquiryObservationValue,
  getInquiryNotebookCompletion,
  type InquiryNotebookDraft,
} from '../../lib/science-lab/inquiry-notebook';

export type InquiryNotebookSaveStatus = 'idle' | 'saved' | 'unavailable';

export interface InquiryNotebookProps {
  notebook: InquiryNotebookDraft;
  observation: ObservationDefinition;
  readouts: ObservationReadouts;
  modelLimitations: string[];
  predictionSubmitted: boolean;
  inquiryStepsVisited: boolean;
  saveStatus: InquiryNotebookSaveStatus;
  onChange: (notebook: InquiryNotebookDraft) => void;
}

interface ChecklistItem {
  label: string;
  complete: boolean;
}

export default function InquiryNotebook({
  notebook,
  observation,
  readouts,
  modelLimitations,
  predictionSubmitted,
  inquiryStepsVisited,
  saveStatus,
  onChange,
}: InquiryNotebookProps) {
  const idPrefix = useId();
  const completion = getInquiryNotebookCompletion(notebook);
  const distinctObservationCount = countDistinctInquiryObservations(notebook.observations);
  const canCapture = predictionSubmitted && observation.fields.some(
    (field) => formatInquiryObservationValue(readouts[field.id], field) !== null,
  );

  const update = (changes: Partial<InquiryNotebookDraft>) => {
    onChange({
      ...notebook,
      ...changes,
      updatedAt: new Date().toISOString(),
    });
  };

  const checklist: ChecklistItem[] = [
    { label: 'Prediction submitted', complete: predictionSubmitted },
    { label: 'All inquiry steps visited', complete: inquiryStepsVisited },
    { label: 'Prediction reasoning recorded', complete: completion.predictionReasoning },
    { label: 'Independent, dependent and controlled variables recorded', complete: completion.variables },
    {
      label: `${notebook.observations.length}/3 observation snapshots recorded`,
      complete: completion.observationCount,
    },
    {
      label: `${distinctObservationCount}/2 different snapshots recorded`,
      complete: completion.distinctObservations,
    },
    { label: 'Claim, evidence and reasoning recorded', complete: completion.cer },
    { label: 'Model limitation recorded', complete: completion.modelLimitation },
  ];

  const recordObservation = () => {
    const snapshot = createInquiryObservationSnapshot(observation, readouts);
    if (!snapshot) return;
    update({ observations: [...notebook.observations, snapshot] });
  };

  const deleteObservation = (snapshotId: string) => {
    update({
      observations: notebook.observations.filter((snapshot) => snapshot.id !== snapshotId),
    });
  };

  const saveMessage = saveStatus === 'saved'
    ? 'Draft saved in this browser.'
    : saveStatus === 'unavailable'
      ? 'Browser storage is unavailable. Your draft remains editable in this tab.'
      : 'Your draft is stored only in this browser.';

  return (
    <section
      className="glass-panel science-lab-notebook science-inquiry-notebook"
      aria-labelledby={`${idPrefix}-title`}
    >
      <div className="science-inquiry-notebook__header">
        <div>
          <p className="science-inquiry-notebook__eyebrow">Local inquiry record</p>
          <h3 id={`${idPrefix}-title`}>Inquiry Notebook</h3>
        </div>
        <p
          className={`science-inquiry-notebook__save-status science-inquiry-notebook__save-status--${saveStatus}`}
          role="status"
          aria-live="polite"
        >
          {saveMessage}
        </p>
      </div>

      <div className="science-inquiry-notebook__checklist" aria-label="Inquiry notebook completion checklist">
        <strong>Completion checklist</strong>
        <ul>
          {checklist.map((item) => (
            <li key={item.label} data-complete={item.complete}>
              <span aria-hidden="true">{item.complete ? '✓' : '○'}</span>
              <span>{item.label}</span>
              <span className="science-inquiry-notebook__sr-only">
                {item.complete ? ' complete' : ' incomplete'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <details className="science-inquiry-notebook__section" open>
        <summary>1. Prediction reasoning and variables</summary>
        <div className="science-inquiry-notebook__section-body">
          <label htmlFor={`${idPrefix}-prediction-reasoning`}>Prediction reasoning</label>
          <textarea
            id={`${idPrefix}-prediction-reasoning`}
            value={notebook.predictionReasoning}
            onChange={(event) => update({ predictionReasoning: event.target.value })}
            placeholder="Why do you expect that outcome? Your prediction does not need to be correct."
            rows={3}
          />

          <div className="science-inquiry-notebook__field-grid">
            <div>
              <label htmlFor={`${idPrefix}-independent-variable`}>Independent variable</label>
              <input
                id={`${idPrefix}-independent-variable`}
                value={notebook.variables.independent}
                onChange={(event) => update({
                  variables: { ...notebook.variables, independent: event.target.value },
                })}
              />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-dependent-variable`}>Dependent variable</label>
              <input
                id={`${idPrefix}-dependent-variable`}
                value={notebook.variables.dependent}
                onChange={(event) => update({
                  variables: { ...notebook.variables, dependent: event.target.value },
                })}
              />
            </div>
          </div>

          <label htmlFor={`${idPrefix}-controlled-variables`}>Controlled variables</label>
          <input
            id={`${idPrefix}-controlled-variables`}
            value={notebook.variables.controlled}
            onChange={(event) => update({
              variables: { ...notebook.variables, controlled: event.target.value },
            })}
            placeholder="List what you kept the same."
          />
        </div>
      </details>

      <details className="science-inquiry-notebook__section" open>
        <summary>2. Observation evidence</summary>
        <div className="science-inquiry-notebook__section-body">
          <div className="science-inquiry-notebook__observation-actions">
            <button
              type="button"
              onClick={recordObservation}
              disabled={!canCapture}
            >
              Record current observation
            </button>
            <span>
              Record at least 3 snapshots, including at least 2 different readouts.
            </span>
          </div>
          {!predictionSubmitted && (
            <p className="science-inquiry-notebook__hint">
              Submit your prediction before recording observations.
            </p>
          )}
          {predictionSubmitted && !canCapture && (
            <p className="science-inquiry-notebook__hint" role="status">
              Change or run the scene until a live readout is available.
            </p>
          )}

          {notebook.observations.length === 0 ? (
            <p className="science-inquiry-notebook__empty">No observations recorded yet.</p>
          ) : (
            <div className="science-lab-data-table">
              <table>
                <caption className="science-inquiry-notebook__sr-only">Recorded observation snapshots</caption>
                <thead>
                  <tr>
                    <th scope="col">Snapshot</th>
                    {observation.fields.map((field) => (
                      <th scope="col" key={field.id}>{field.label}</th>
                    ))}
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {notebook.observations.map((snapshot, index) => (
                    <tr key={snapshot.id}>
                      <th scope="row">{index + 1}</th>
                      {observation.fields.map((field) => (
                        <td key={field.id}>
                          {snapshot.measurements.find((measurement) => measurement.fieldId === field.id)?.value ?? '—'}
                        </td>
                      ))}
                      <td>
                        <button
                          type="button"
                          className="science-inquiry-notebook__delete"
                          aria-label={`Delete observation ${index + 1}`}
                          onClick={() => deleteObservation(snapshot.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>

      <details className="science-inquiry-notebook__section">
        <summary>3. Claim, evidence, reasoning and limitation</summary>
        <div className="science-inquiry-notebook__section-body">
          <label htmlFor={`${idPrefix}-cer-claim`}>CER claim</label>
          <textarea
            id={`${idPrefix}-cer-claim`}
            value={notebook.cer.claim}
            onChange={(event) => update({ cer: { ...notebook.cer, claim: event.target.value } })}
            rows={2}
          />

          <label htmlFor={`${idPrefix}-cer-evidence`}>CER evidence</label>
          <textarea
            id={`${idPrefix}-cer-evidence`}
            value={notebook.cer.evidence}
            onChange={(event) => update({ cer: { ...notebook.cer, evidence: event.target.value } })}
            placeholder="Refer to recorded snapshots and how they compare."
            rows={2}
          />

          <label htmlFor={`${idPrefix}-cer-reasoning`}>CER reasoning</label>
          <textarea
            id={`${idPrefix}-cer-reasoning`}
            value={notebook.cer.reasoning}
            onChange={(event) => update({ cer: { ...notebook.cer, reasoning: event.target.value } })}
            rows={3}
          />

          <label htmlFor={`${idPrefix}-model-limitation`}>Model limitation</label>
          <select
            id={`${idPrefix}-model-limitation`}
            value={notebook.modelLimitation}
            onChange={(event) => update({ modelLimitation: event.target.value })}
          >
            <option value="">Choose a limitation of this model</option>
            {modelLimitations.map((limitation) => (
              <option key={limitation} value={limitation}>{limitation}</option>
            ))}
          </select>
        </div>
      </details>
    </section>
  );
}
