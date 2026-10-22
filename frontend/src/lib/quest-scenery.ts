/** Quest Board scenic backgrounds (CSS-only — no external image deps). */

export type SceneryRegion = 'qld' | 'china' | 'neutral';

export interface QuestScenery {
  id: string;
  region: SceneryRegion;
  /** Short label for picker */
  name: string;
  /** One-line flavour */
  subtitle: string;
  emoji: string;
  /** Full-page background layers (comma-separated for background-image) */
  backgroundImage: string;
  backgroundColor: string;
  /** Tint for glass panels on this scene */
  panelTint: string;
  panelBorder: string;
  /** Accent for buttons / progress */
  accent: string;
  accentSoft: string;
  /** Hero title gradient text colors */
  titleFrom: string;
  titleTo: string;
  /** Text color mode on scenic backdrop */
  ink: 'dark' | 'light';
}

const STORAGE_KEY = 'qld_tutor_quest_scenery';

export const QUEST_SCENERIES: QuestScenery[] = [
  {
    id: 'default',
    region: 'neutral',
    name: 'Starfield',
    subtitle: 'Quiet indigo sky',
    emoji: '✨',
    backgroundColor: '#0f172a',
    backgroundImage: `
      radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.45), transparent 55%),
      radial-gradient(ellipse 60% 40% at 90% 80%, rgba(245,158,11,0.18), transparent 50%),
      radial-gradient(ellipse 50% 35% at 10% 70%, rgba(56,189,248,0.15), transparent 50%),
      linear-gradient(165deg, #0f172a 0%, #1e1b4b 45%, #0f172a 100%)
    `,
    panelTint: 'rgba(15, 23, 42, 0.72)',
    panelBorder: 'rgba(148, 163, 184, 0.22)',
    accent: '#818cf8',
    accentSoft: 'rgba(129, 140, 248, 0.25)',
    titleFrom: '#e0e7ff',
    titleTo: '#fbbf24',
    ink: 'light',
  },
  {
    id: 'reef',
    region: 'qld',
    name: 'Great Barrier Reef',
    subtitle: 'Coral gardens off Queensland',
    emoji: '🐠',
    backgroundColor: '#0c4a6e',
    backgroundImage: `
      radial-gradient(ellipse 70% 45% at 20% 85%, rgba(244,114,182,0.35), transparent 50%),
      radial-gradient(ellipse 50% 40% at 80% 70%, rgba(45,212,191,0.4), transparent 45%),
      radial-gradient(ellipse 90% 50% at 50% 0%, rgba(56,189,248,0.35), transparent 55%),
      linear-gradient(180deg, #0c4a6e 0%, #0369a1 35%, #0e7490 70%, #134e4a 100%)
    `,
    panelTint: 'rgba(8, 47, 73, 0.78)',
    panelBorder: 'rgba(94, 234, 212, 0.28)',
    accent: '#2dd4bf',
    accentSoft: 'rgba(45, 212, 191, 0.28)',
    titleFrom: '#a5f3fc',
    titleTo: '#f9a8d4',
    ink: 'light',
  },
  {
    id: 'goldcoast',
    region: 'qld',
    name: 'Gold Coast',
    subtitle: 'Surf, sand & sunset',
    emoji: '🏄',
    backgroundColor: '#7c2d12',
    backgroundImage: `
      radial-gradient(ellipse 100% 60% at 50% 100%, rgba(251,191,36,0.55), transparent 55%),
      radial-gradient(ellipse 70% 40% at 80% 20%, rgba(251,146,60,0.4), transparent 50%),
      linear-gradient(185deg, #1e3a5f 0%, #0c4a6e 28%, #ea580c 62%, #fbbf24 88%, #fef3c7 100%)
    `,
    panelTint: 'rgba(67, 20, 7, 0.72)',
    panelBorder: 'rgba(251, 191, 36, 0.35)',
    accent: '#fbbf24',
    accentSoft: 'rgba(251, 191, 36, 0.3)',
    titleFrom: '#fef3c7',
    titleTo: '#fb923c',
    ink: 'light',
  },
  {
    id: 'daintree',
    region: 'qld',
    name: 'Daintree',
    subtitle: 'Ancient rainforest canopy',
    emoji: '🌿',
    backgroundColor: '#052e16',
    backgroundImage: `
      radial-gradient(ellipse 50% 40% at 15% 30%, rgba(74,222,128,0.25), transparent 50%),
      radial-gradient(ellipse 60% 50% at 85% 60%, rgba(34,197,94,0.2), transparent 45%),
      radial-gradient(ellipse 80% 35% at 50% 100%, rgba(21,128,61,0.5), transparent 50%),
      linear-gradient(160deg, #022c22 0%, #14532d 40%, #166534 70%, #052e16 100%)
    `,
    panelTint: 'rgba(5, 46, 22, 0.8)',
    panelBorder: 'rgba(74, 222, 128, 0.25)',
    accent: '#4ade80',
    accentSoft: 'rgba(74, 222, 128, 0.25)',
    titleFrom: '#bbf7d0',
    titleTo: '#86efac',
    ink: 'light',
  },
  {
    id: 'outback',
    region: 'qld',
    name: 'Outback dusk',
    subtitle: 'Red earth under a wide sky',
    emoji: '🏜️',
    backgroundColor: '#431407',
    backgroundImage: `
      radial-gradient(ellipse 80% 45% at 50% 0%, rgba(253,186,116,0.35), transparent 55%),
      radial-gradient(ellipse 100% 40% at 50% 100%, rgba(194,65,12,0.55), transparent 50%),
      linear-gradient(180deg, #1c1917 0%, #7c2d12 45%, #c2410c 72%, #9a3412 100%)
    `,
    panelTint: 'rgba(28, 25, 23, 0.78)',
    panelBorder: 'rgba(251, 146, 60, 0.3)',
    accent: '#fb923c',
    accentSoft: 'rgba(251, 146, 60, 0.28)',
    titleFrom: '#fed7aa',
    titleTo: '#f97316',
    ink: 'light',
  },
  {
    id: 'guilin',
    region: 'china',
    name: 'Guilin',
    subtitle: 'Karst peaks in the mist',
    emoji: '⛰️',
    backgroundColor: '#1a2e28',
    backgroundImage: `
      radial-gradient(ellipse 40% 55% at 18% 75%, rgba(15, 40, 35, 0.95) 0%, transparent 60%),
      radial-gradient(ellipse 35% 50% at 48% 70%, rgba(20, 50, 42, 0.9) 0%, transparent 55%),
      radial-gradient(ellipse 38% 58% at 78% 72%, rgba(12, 35, 30, 0.95) 0%, transparent 58%),
      radial-gradient(ellipse 90% 40% at 50% 100%, rgba(6, 78, 59, 0.4), transparent 50%),
      linear-gradient(180deg, #94a3b8 0%, #a8c5c0 22%, #6b9b8e 48%, #2d4a42 78%, #1a2e28 100%)
    `,
    panelTint: 'rgba(26, 46, 40, 0.82)',
    panelBorder: 'rgba(167, 243, 208, 0.22)',
    accent: '#6ee7b7',
    accentSoft: 'rgba(110, 231, 183, 0.25)',
    titleFrom: '#ecfdf5',
    titleTo: '#a7f3d0',
    ink: 'light',
  },
  {
    id: 'jiangnan',
    region: 'china',
    name: 'Jiangnan',
    subtitle: 'Water town lanterns',
    emoji: '🏮',
    backgroundColor: '#1e1b4b',
    backgroundImage: `
      radial-gradient(circle 12px at 18% 42%, rgba(251,146,60,0.7), transparent 50%),
      radial-gradient(circle 10px at 72% 38%, rgba(248,113,113,0.55), transparent 50%),
      radial-gradient(circle 8px at 55% 48%, rgba(251,191,36,0.5), transparent 50%),
      radial-gradient(ellipse 100% 50% at 50% 100%, rgba(15, 23, 42, 0.85), transparent 45%),
      linear-gradient(165deg, #312e81 0%, #1e3a5f 35%, #0f172a 70%, #020617 100%)
    `,
    panelTint: 'rgba(30, 27, 75, 0.8)',
    panelBorder: 'rgba(251, 146, 60, 0.3)',
    accent: '#fb923c',
    accentSoft: 'rgba(251, 146, 60, 0.28)',
    titleFrom: '#fde68a',
    titleTo: '#fdba74',
    ink: 'light',
  },
  {
    id: 'westlake',
    region: 'china',
    name: 'West Lake',
    subtitle: 'Hangzhou soft dawn',
    emoji: '🪷',
    backgroundColor: '#4c1d95',
    backgroundImage: `
      radial-gradient(ellipse 70% 40% at 30% 20%, rgba(251,207,232,0.45), transparent 50%),
      radial-gradient(ellipse 60% 35% at 80% 30%, rgba(196,181,253,0.4), transparent 50%),
      radial-gradient(ellipse 100% 45% at 50% 100%, rgba(52, 211, 153, 0.25), transparent 50%),
      linear-gradient(180deg, #fce7f3 0%, #ddd6fe 28%, #a5b4fc 55%, #5b21b6 100%)
    `,
    panelTint: 'rgba(76, 29, 149, 0.72)',
    panelBorder: 'rgba(233, 213, 255, 0.35)',
    accent: '#e9d5ff',
    accentSoft: 'rgba(233, 213, 255, 0.3)',
    titleFrom: '#fdf4ff',
    titleTo: '#f9a8d4',
    ink: 'light',
  },
  {
    id: 'zhangjiajie',
    region: 'china',
    name: 'Zhangjiajie',
    subtitle: 'Pillar peaks above the clouds',
    emoji: '🏞️',
    backgroundColor: '#0c1222',
    backgroundImage: `
      radial-gradient(ellipse 25% 55% at 22% 85%, rgba(30, 41, 59, 0.98) 0%, transparent 55%),
      radial-gradient(ellipse 20% 60% at 45% 80%, rgba(51, 65, 85, 0.95) 0%, transparent 50%),
      radial-gradient(ellipse 22% 58% at 68% 82%, rgba(30, 41, 59, 0.98) 0%, transparent 52%),
      radial-gradient(ellipse 18% 50% at 88% 78%, rgba(51, 65, 85, 0.9) 0%, transparent 48%),
      radial-gradient(ellipse 100% 40% at 50% 55%, rgba(226, 232, 240, 0.35), transparent 55%),
      linear-gradient(180deg, #1e3a5f 0%, #334155 35%, #64748b 55%, #1e293b 85%, #0f172a 100%)
    `,
    panelTint: 'rgba(15, 23, 42, 0.8)',
    panelBorder: 'rgba(148, 163, 184, 0.28)',
    accent: '#94a3b8',
    accentSoft: 'rgba(148, 163, 184, 0.3)',
    titleFrom: '#f1f5f9',
    titleTo: '#cbd5e1',
    ink: 'light',
  },
  {
    id: 'terracotta',
    region: 'china',
    name: 'Silk Road dusk',
    subtitle: 'Desert gold & temple red',
    emoji: '🏯',
    backgroundColor: '#7f1d1d',
    backgroundImage: `
      radial-gradient(ellipse 80% 40% at 50% 0%, rgba(253, 224, 71, 0.35), transparent 50%),
      radial-gradient(ellipse 60% 35% at 20% 60%, rgba(220, 38, 38, 0.3), transparent 45%),
      linear-gradient(165deg, #451a03 0%, #9a3412 35%, #b91c1c 65%, #7f1d1d 100%)
    `,
    panelTint: 'rgba(69, 10, 10, 0.8)',
    panelBorder: 'rgba(252, 165, 165, 0.28)',
    accent: '#fbbf24',
    accentSoft: 'rgba(251, 191, 36, 0.28)',
    titleFrom: '#fef3c7',
    titleTo: '#fca5a5',
    ink: 'light',
  },
];

export function getQuestSceneryId(): string {
  if (typeof window === 'undefined') return 'default';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && QUEST_SCENERIES.some((s) => s.id === stored)) return stored;
  return 'default';
}

export function setQuestSceneryId(id: string): void {
  if (typeof window === 'undefined') return;
  if (!QUEST_SCENERIES.some((s) => s.id === id)) return;
  localStorage.setItem(STORAGE_KEY, id);
}

export function getQuestScenery(id?: string): QuestScenery {
  const target = id || (typeof window !== 'undefined' ? getQuestSceneryId() : 'default');
  return QUEST_SCENERIES.find((s) => s.id === target) || QUEST_SCENERIES[0];
}

export function sceneriesByRegion(): { region: SceneryRegion; label: string; items: QuestScenery[] }[] {
  return [
    { region: 'qld', label: 'Queensland', items: QUEST_SCENERIES.filter((s) => s.region === 'qld') },
    { region: 'china', label: 'China', items: QUEST_SCENERIES.filter((s) => s.region === 'china') },
    { region: 'neutral', label: 'Classic', items: QUEST_SCENERIES.filter((s) => s.region === 'neutral') },
  ];
}
