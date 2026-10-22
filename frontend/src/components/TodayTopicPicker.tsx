'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import type { TodayStudyTask } from '../lib/api-types';

function topicName(task: TodayStudyTask): string {
  return task.topic_names?.[0] || task.topic_id || task.title;
}

function optionLabel(option: TodayStudyTask): string {
  return `${topicName(option)}${option.recommended ? ' (suggested)' : ''}${option.mastered ? ' (mastered)' : ''}`;
}

/**
 * Choose the topic of a new-topic step before its first answer. Every topic of
 * the year or unit can be chosen. A topic with open prerequisites says which.
 */
export default function TodayTopicPicker({
  task,
  hrefFor,
}: {
  task: TodayStudyTask;
  hrefFor: (href: string) => string;
}) {
  const options = task.topic_options ?? [];
  const selectId = useId();
  const [selectedId, setSelectedId] = useState(() => options.find(option => option.recommended)?.id ?? task.id);
  const selected = options.find(option => option.id === selectedId) ?? task;
  const name = topicName(selected);
  const missing = (selected.missing_prerequisite_names ?? []).filter(Boolean);

  return (
    <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '6px' }}>
      <label htmlFor={selectId} style={{ fontSize: '13px', fontWeight: 700 }}>Choose a topic</label>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* The select can shrink below its longest topic name, so a phone does not scroll sideways. */}
        <select
          id={selectId}
          value={selectedId}
          onChange={event => setSelectedId(event.target.value)}
          style={{ flex: '1 1 260px', minWidth: 0, maxWidth: '100%', minHeight: '40px', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '14px' }}
        >
          {options.map(option => (
            <option key={option.id} value={option.id}>{optionLabel(option)}</option>
          ))}
        </select>
        <Link
          href={hrefFor(selected.href)}
          className="btn-secondary"
          aria-label={`Start: ${name}`}
          style={{ minHeight: '40px', display: 'inline-flex', alignItems: 'center', padding: '6px 14px', textDecoration: 'none', fontSize: '14px', fontWeight: 750 }}
        >
          Start →
        </Link>
      </div>
      {missing.length > 0 && (
        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)' }}>
          {`This topic builds on ${missing.join(' and ')}. It is easier to learn ${missing.length > 1 ? 'those' : 'that'} first.`}
        </p>
      )}
    </div>
  );
}
