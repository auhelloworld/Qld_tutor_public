import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LAB_ACTIVITIES } from '../lib/lab-activities';
import {
  buildLabDeepLink,
  getLabActivitiesForScope,
  getLabActivitiesForTopic,
} from '../lib/lab-topic-links';

function collectTopicIds(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectTopicIds(item, result));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      if (key === 'topic_id' && typeof item === 'string') result.add(item);
      collectTopicIds(item, result);
    });
  }
  return result;
}

function realTopicIds(): Set<string> {
  const root = path.resolve(process.cwd(), '..', 'data', 'curriculum');
  const files = [
    ...fs.readdirSync(path.join(root, 'ac9_maths')).map((name) => path.join(root, 'ac9_maths', name)),
    path.join(root, 'qcaa_senior_maths', 'methods.json'),
    path.join(root, 'qcaa_senior_maths', 'specialist.json'),
  ];
  return files.reduce((ids, file) => collectTopicIds(JSON.parse(fs.readFileSync(file, 'utf8')), ids), new Set<string>());
}

describe('Lab topic links', () => {
  it('maps every declared topicId to a real curriculum topic', () => {
    const ids = realTopicIds();
    const declared = Object.values(LAB_ACTIVITIES).flatMap((activity) => activity.topicIds);
    expect(declared.length).toBeGreaterThanOrEqual(12);
    expect(declared.every((topicId) => ids.has(topicId))).toBe(true);
  });

  it('returns mapped activities and an empty result for unknown topics', () => {
    expect(getLabActivitiesForTopic('AC9M9A03').map((activity) => activity.id)).toContain('explorer-two-point-measures');
    expect(getLabActivitiesForTopic('not-a-real-topic')).toEqual([]);
  });

  it('filters by AC9 and senior scopes without hiding unrelated activities', () => {
    expect(getLabActivitiesForScope('math', 'year9').length).toBeGreaterThan(0);
    expect(getLabActivitiesForScope('methods', 'unit4').map((a) => a.id)).toContain('statistics-normal-zscore');
    expect(getLabActivitiesForScope('specialist', 'unit2').map((a) => a.id)).toContain('linear-complex-plane');
    expect(getLabActivitiesForScope('math', 'year11')).toEqual([]);
  });

  it('builds canonical learn and explore deep links', () => {
    expect(buildLabDeepLink('geometry-pythagoras', 'learn')).toBe(
      '/lab?tab=geometry&mode=learn&activity=geometry-pythagoras',
    );
    expect(buildLabDeepLink('statistics-normal-zscore', 'explore')).toBe(
      '/lab?tab=statistics&mode=explore&activity=statistics-normal-zscore',
    );
  });
});
