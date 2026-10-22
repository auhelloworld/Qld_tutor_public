import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ParentQuestsPanel from '../components/parent/ParentQuestsPanel';

const apiMocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  settings: vi.fn(),
  deleteCatalog: vi.fn(),
  resolve: vi.fn(),
  saveCatalog: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  parentQuestsSnapshot: apiMocks.snapshot,
  parentQuestsSettings: apiMocks.settings,
  parentQuestsDeleteCatalog: apiMocks.deleteCatalog,
  parentQuestsResolve: apiMocks.resolve,
  parentQuestsSaveCatalog: apiMocks.saveCatalog,
}));
vi.mock('../lib/toast', () => ({ showToast: vi.fn() }));

const snapshot = {
  enabled: true,
  shop_enabled: true,
  chests_enabled: true,
  spin_enabled: true,
  daily_star_cap: 300,
  stars: 500,
  level: 2,
  title: 'Explorer',
  xp: 40,
  chests: 1,
  freeze_tokens: 0,
  catalog: [],
  pending: [],
  recent_redemptions: [],
  ledger: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Parent Quest settings', () => {
  it('loads and updates the active student Spin Wheel toggle', async () => {
    apiMocks.snapshot.mockResolvedValue(snapshot);
    apiMocks.settings.mockImplementation(async (patch: Record<string, unknown>) => ({
      ...snapshot,
      ...patch,
    }));

    render(<ParentQuestsPanel />);
    const toggle = await screen.findByLabelText('Spin wheel on') as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(apiMocks.settings).toHaveBeenCalledWith({ spin_enabled: false });
    });
    expect((screen.getByLabelText('Spin wheel on') as HTMLInputElement).checked).toBe(false);
  });
});
