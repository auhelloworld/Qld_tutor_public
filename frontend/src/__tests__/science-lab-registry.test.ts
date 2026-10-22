import { describe, expect, it } from 'vitest';
import { SCIENCE_RENDERERS } from '../lib/science-lab/renderer-registry';
import { SCIENCE_ACTIVITIES } from '../lib/science-lab/activities';
import type { ScienceSceneData } from '../lib/science-lab/activity-types';

describe('Science Lab Renderer Registry Completeness', () => {
  const registeredKinds = Object.keys(SCIENCE_RENDERERS) as ScienceSceneData['kind'][];

  it('contains loader for every scene kind in activity catalogue', () => {
    const activityKinds = new Set(
      Object.values(SCIENCE_ACTIVITIES).map((act) => act.sceneData.kind),
    );

    for (const kind of activityKinds) {
      expect(registeredKinds).toContain(kind);
    }
  });

  it('all renderer loaders resolve to a component module with default export', async () => {
    for (const [kind, loader] of Object.entries(SCIENCE_RENDERERS)) {
      const loadedModule = await loader();
      expect(loadedModule).toBeDefined();
      expect(loadedModule.default, `Renderer for "${kind}" must have a default export`).toBeDefined();
    }
  });
});
