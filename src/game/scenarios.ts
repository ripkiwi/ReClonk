import type { ItemId } from '../landscape/materials';
import { DEFAULT_MAP, type MapOptions } from '../landscape/generate';
import type { Goal, ShopId } from './world';

/** Starting gold and what the home base's shop has in stock (Scenario.txt Wealth and HomeBaseMaterial). */
export interface BaseSettings {
  wealth: number;
  stock: Partial<Record<ShopId, number>>;
}

/**
 * A scenario: the map, what each clonk starts with, and how many clonks a player brings.
 * Scenarios are plain data, so players can copy and change them, and later
 * they can live in JSON files and come from mods.
 */
export interface ScenarioDef {
  id: string;
  title: string;
  description: string;
  width: number;
  height: number;
  seed: number;
  map: Partial<MapOptions>;
  /** How many clonks of the player's crew take part. */
  crewSize: number;
  /** What each clonk carries at the start. */
  startItems: ItemId[];
  /** Start next to your own hut with your flag (gold, healing, buying and selling). */
  homeBase: boolean;
  /** Starting gold and shop stock, used with a home base. */
  base: BaseSettings;
  /** Computer crews to play against, each as big as the player's crew. */
  opponents: number;
  /** How the round is won: 'melee' ends it when only one crew is left standing. */
  goal: Goal;
  /** Set on a player's own scenario: the original it was copied from. */
  basedOn?: string;
}

/** The default home base start: 25 gold, and flints, rocks and clonks to buy. */
export const DEFAULT_BASE: BaseSettings = {
  wealth: 25,
  stock: { flint: 10, rock: 10, clonk: 5 },
};

/** The scenarios that come with the game. They are never changed: editing one saves a copy. */
export const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: 'goldmine',
    title: 'Gold Mine',
    description:
      'Rolling hills full of rock and gold veins. Dig down, find flints in the earth, blast the gold veins loose and sell the nuggets at your hut. Watch out for the lake.',
    width: 1400,
    height: 640,
    seed: 1337,
    map: {},
    crewSize: 1,
    startItems: ['flint'],
    homeBase: true,
    base: DEFAULT_BASE,
    opponents: 0,
    goal: 'none',
  },
  {
    id: 'minor-melee',
    title: 'Minor Melee',
    description:
      'A pretty flat stretch of land with flints everywhere: lying around, and buried just below the surface. A computer crew wants the place for itself. Grab a flint and let it fly: the last crew standing wins.',
    width: 1000,
    height: 480,
    seed: 4242,
    map: {
      hilliness: 0.12,
      rockVeins: 0.6,
      goldVeins: 0.4,
      lake: false,
      buried: { flint: 90, rock: 10, gold: 4 },
      onSurface: { flint: 45 },
    },
    crewSize: 3,
    startItems: ['flint'],
    homeBase: false,
    base: DEFAULT_BASE,
    opponents: 1,
    goal: 'melee',
  },
];

export function scenarioById(id: string, own: readonly ScenarioDef[] = []): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id) ?? own.find((s) => s.id === id);
}

/** True for the scenarios that come with the game. */
export function isOriginal(s: ScenarioDef): boolean {
  return SCENARIOS.some((o) => o.id === s.id);
}

/** The full map options of a scenario, with the defaults filled in. */
export function mapOptions(s: ScenarioDef): MapOptions {
  const m = s.map;
  return {
    ...DEFAULT_MAP,
    ...m,
    buried: { ...DEFAULT_MAP.buried, ...m.buried },
    onSurface: { ...DEFAULT_MAP.onSurface, ...m.onSurface },
  };
}

/** Limits for every setting, so a hand-edited or old save can't break the game. */
export const LIMITS = {
  width: { min: 400, max: 3000, step: 50 },
  height: { min: 240, max: 1000, step: 20 },
  seed: { min: 0, max: 999999, step: 1 },
  hilliness: { min: 0, max: 2, step: 0.05 },
  veins: { min: 0, max: 3, step: 0.1 },
  /** Objects per 1000 pixels of map width. */
  objects: { min: 0, max: 200, step: 1 },
  crewSize: { min: 1, max: 12, step: 1 },
  opponents: { min: 0, max: 3, step: 1 },
  wealth: { min: 0, max: 1000, step: 5 },
  stock: { min: 0, max: 99, step: 1 },
};

const ITEM_IDS: ItemId[] = ['flint', 'rock', 'gold'];
const SHOP_IDS: ShopId[] = ['flint', 'rock', 'clonk'];

function clamp(v: unknown, lim: { min: number; max: number }, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.max(lim.min, Math.min(lim.max, n));
}

/** Per-item numbers within limits. Object densities keep their fractions, so an unchanged copy makes the same map. */
function counts<K extends string>(ids: readonly K[], raw: unknown, lim: { min: number; max: number }, whole = true): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of ids) {
    const v = (raw as Record<string, unknown>)[id];
    if (v === undefined) continue;
    const n = clamp(v, lim, 0);
    out[id] = whole ? Math.round(n) : n;
  }
  return out;
}

/**
 * Make a scenario safe to play: every setting in range, missing settings
 * taken from `fallback` (the original it was copied from, or Gold Mine).
 */
export function normalizeScenario(raw: Partial<ScenarioDef>, fallback: ScenarioDef = SCENARIOS[0]): ScenarioDef {
  const f = fallback;
  const m = (raw.map ?? f.map) as Partial<MapOptions>;
  const map: Partial<MapOptions> = {};
  if (m.hilliness !== undefined) map.hilliness = clamp(m.hilliness, LIMITS.hilliness, 1);
  if (m.rockVeins !== undefined) map.rockVeins = clamp(m.rockVeins, LIMITS.veins, 1);
  if (m.goldVeins !== undefined) map.goldVeins = clamp(m.goldVeins, LIMITS.veins, 1);
  if (m.lake !== undefined) map.lake = !!m.lake;
  if (m.buried) map.buried = counts(ITEM_IDS, m.buried, LIMITS.objects, false) as Record<ItemId, number>;
  if (m.onSurface) map.onSurface = counts(ITEM_IDS, m.onSurface, LIMITS.objects, false);
  const base = raw.base ?? f.base;
  const items = Array.isArray(raw.startItems) ? raw.startItems.filter((i) => ITEM_IDS.includes(i)).slice(0, 1) : f.startItems;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : f.id,
    title: (typeof raw.title === 'string' ? raw.title.trim().slice(0, 40) : '') || f.title,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 400) : f.description,
    width: Math.round(clamp(raw.width, LIMITS.width, f.width)),
    height: Math.round(clamp(raw.height, LIMITS.height, f.height)),
    seed: Math.round(clamp(raw.seed, LIMITS.seed, f.seed)),
    map,
    crewSize: Math.round(clamp(raw.crewSize, LIMITS.crewSize, f.crewSize)),
    startItems: items,
    homeBase: typeof raw.homeBase === 'boolean' ? raw.homeBase : f.homeBase,
    base: {
      wealth: Math.round(clamp(base?.wealth, LIMITS.wealth, f.base.wealth)),
      stock: counts(SHOP_IDS, base?.stock, LIMITS.stock),
    },
    opponents: Math.round(clamp(raw.opponents, LIMITS.opponents, f.opponents)),
    goal: raw.goal === 'melee' || raw.goal === 'none' ? raw.goal : f.goal,
    ...(raw.basedOn ? { basedOn: String(raw.basedOn) } : {}),
  };
}
