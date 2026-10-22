import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SCIENCE_ACTIVITIES } from '../lib/science-lab/activities';
import {
  getAllMappedScienceTopicIds,
  getAllTransferScienceTopicIds,
} from '../lib/science-lab/curriculum-map';

describe('Science Lab Curriculum & Transfer Consistency', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const curriculumDir = path.join(repoRoot, 'data', 'curriculum', 'ac9_science');

  it('all mapped topic IDs exist in data/curriculum/ac9_science/', () => {
    const topicFiles = ['year7.json', 'year8.json', 'year9.json', 'year10.json'];
    const validTopicIds = new Set<string>();

    for (const f of topicFiles) {
      const fullPath = path.join(curriculumDir, f);
      if (fs.existsSync(fullPath)) {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const topics = parsed.topics || [];
        for (const t of topics) {
          if (t.topic_id) validTopicIds.add(t.topic_id);
        }
      }
    }

    const mappedTopics = getAllMappedScienceTopicIds();
    expect(mappedTopics.length).toBeGreaterThanOrEqual(6);

    for (const tid of mappedTopics) {
      expect(
        validTopicIds.has(tid),
        `Topic ID "${tid}" must exist in AC9 Science curriculum data`,
      ).toBe(true);
    }
  });

  it('maps Measurement transfer practice to the inquiry descriptor for every year level', () => {
    expect(SCIENCE_ACTIVITIES['SCI-MEASUREMENT-01'].transferTopicIds).toEqual([
      'AC9S7I03',
      'AC9S8I03',
      'AC9S9I03',
      'AC9S10I03',
    ]);
  });

  it('all exercise-backed transfer topic IDs have questions in exercise banks', () => {
    const exerciseFiles = [
      'exercise_7_science.json',
      'exercise_8_science.json',
      'exercise_9_science.json',
      'exercise_10_science.json',
    ];

    const bankTopicCounts: Record<string, number> = {};

    for (const f of exerciseFiles) {
      const fullPath = path.join(repoRoot, 'data', f);
      if (fs.existsSync(fullPath)) {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const exercises = JSON.parse(raw);
        for (const ex of exercises) {
          const ids: string[] = ex.topic_ids || (ex.topic_id ? [ex.topic_id] : []);
          for (const tid of ids) {
            bankTopicCounts[tid] = (bankTopicCounts[tid] || 0) + 1;
          }
        }
      }
    }

    // Measurement transfers to year-specific inquiry descriptors, which are
    // curriculum process links rather than authored question-bank destinations.
    const curriculumOnlyTransfers = new Set(
      SCIENCE_ACTIVITIES['SCI-MEASUREMENT-01'].transferTopicIds,
    );
    const transferTopics = getAllTransferScienceTopicIds();
    for (const tid of transferTopics) {
      if (curriculumOnlyTransfers.has(tid)) continue;
      const count = bankTopicCounts[tid] || 0;
      expect(
        count,
        `Transfer topic "${tid}" must have available exercises (found ${count})`,
      ).toBeGreaterThan(0);
    }
  });
});


describe('Science Lab prediction distractor provenance', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');

  it('every MC_ distractor source exists in the approved misconception bank', async () => {
    const { SCIENCE_ACTIVITIES } = await import('../lib/science-lab/activities');
    const bankPath = path.join(
      repoRoot,
      'data',
      'misconceptions',
      'prod',
      'ac9_science_english.json',
    );
    expect(fs.existsSync(bankPath), `missing misconception bank at ${bankPath}`).toBe(true);

    const bank = JSON.parse(fs.readFileSync(bankPath, 'utf-8')) as {
      misconceptions: { misconception_id: string }[];
    };
    const approvedIds = new Set(bank.misconceptions.map((m) => m.misconception_id));

    for (const act of Object.values(SCIENCE_ACTIVITIES)) {
      for (const src of act.prediction.distractorSource) {
        if (src.startsWith('proposed:')) continue;
        // A prefix check alone would let a typo through, so resolve the real ID.
        expect(
          approvedIds.has(src),
          `${act.id} references misconception "${src}", which is not in data/misconceptions/prod/ac9_science_english.json`,
        ).toBe(true);
      }
    }
  });

  it('proposed distractor sources are still awaiting approval, not silently shipped as approved', async () => {
    const { SCIENCE_ACTIVITIES } = await import('../lib/science-lab/activities');
    const approvalsPath = path.join(repoRoot, 'data', 'misconceptions', 'approvals.yaml');
    const approvalsRaw = fs.existsSync(approvalsPath)
      ? fs.readFileSync(approvalsPath, 'utf-8')
      : '';

    for (const act of Object.values(SCIENCE_ACTIVITIES)) {
      for (const src of act.prediction.distractorSource) {
        if (!src.startsWith('proposed:')) continue;
        const slug = src.slice('proposed:'.length);
        expect(slug.length, `${act.id} has an empty proposed slug`).toBeGreaterThan(3);
        // Once a proposal is approved it must be re-declared as its MC_ id.
        expect(
          approvalsRaw.includes(slug),
          `${act.id} proposal "${slug}" appears in approvals.yaml — switch distractorSource to the approved MC_ id`,
        ).toBe(false);
      }
    }
  });
});
