import { texIndex, type ItemId } from '../landscape/materials';
import { DEFAULT_LANDSCAPE, MAX_MAP_PLAYER_EXTEND, sval, type LandscapeDef, type SVal } from '../landscape/mapCreator';
import { PLANT_IDS } from '../objects/vegetation';
import { SPELL_IDS, type SpellId } from './magic';
import { RULE_IDS, type RuleId } from './rules';
import { DEFAULT_WEATHER, type WeatherDef } from './weather';
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
  /** The map, described like the original's [Landscape] section. */
  landscape: LandscapeDef;
  /** Which of the maps the landscape values can make. */
  seed: number;
  /** A new map every round, like the original; otherwise always the seed's map. */
  newMapEachRound: boolean;
  /** How many clonks of the player's crew take part. */
  crewSize: number;
  /** How many sorcerers come along with them (Scenario.txt Crew=CLNK=..;SCLK=..). */
  sorcerers: number;
  /** The spells sorcerers can cast (Scenario.txt Magic). Like in the original, none named means all of them. */
  magic: SpellId[];
  /** The rules of the round (Scenario.txt Rules). */
  rules: RuleId[];
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
  /** Seasons, wind, rain, thunderstorms and disasters (the Weather page). */
  weather: WeatherDef;
  /** Set on a player's own scenario: the original it was copied from. */
  basedOn?: string;
}

/**
 * The home base starts with the original Gold Mine stock, plus vehicles and
 * sorcerer supplies so both features are available in the first scenario.
 */
export const DEFAULT_BASE: BaseSettings = {
  wealth: 50,
  stock: { flint: 5, tflint: 5, superflint: 1, wood: 4, conkit: 5, lorry: 2, boat: 2, balloon: 1, blimp: 1, crystal: 5, clonk: 3, sorcerer: 1 },
};

/** The trees of the original Gold Mine and Minor Melee (Vegetation=TRE1=1;TRE2=2;TRE3=1;TRE4=1, VegetationLevel=100). */
const TREES: Pick<LandscapeDef, 'vegetation' | 'vegetationLevel' | 'grass'> = {
  vegetation: { tree1: 1, tree2: 2, tree3: 1, tree4: 1 },
  vegetationLevel: sval(100),
  grass: true,
};

/** The material layers of the original Gold Mine and Minor Melee (without the ore, coal and sulphur we don't have yet). */
const LAYERS = (gold: number, water: number): LandscapeDef['layers'] => [
  { name: 'Rock', count: 7 },
  { name: 'Rock-Ridge', count: 7 },
  { name: 'Gold', count: gold },
  { name: 'Granite', count: 4 },
  { name: 'Water-Smooth', count: water },
  { name: 'Earth-Rough', count: 50 },
  { name: 'Earth-Smooth2', count: 50 },
];

/** The scenarios that come with the game, with the original's values. They are never changed: editing one saves a copy. */
export const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: 'goldmine',
    title: 'Gold Mine',
    description:
      'Mining gold is one of the most basic activities in Clonk. Collect loose chunks of gold and sell them at your hut. With the money, buy flints to blast the solid gold veins loose.',
    landscape: {
      ...DEFAULT_LANDSCAPE,
      mapWidth: sval(80, 0, 64, 250),
      mapHeight: sval(60, 0, 40, 250),
      amplitude: sval(10, 10),
      phase: sval(50, 50),
      period: sval(10, 10),
      random: sval(20, 20),
      liquid: 'Water-Smooth',
      liquidLevel: sval(20, 30),
      mapPlayerExtend: true,
      layers: LAYERS(8, 5),
      inEarth: { rock: 1, gold: 1, flint: 1 },
      inEarthLevel: sval(65),
      ...TREES,
    },
    seed: 1337,
    newMapEachRound: true,
    crewSize: 1,
    sorcerers: 0,
    magic: [],
    rules: [],
    startItems: ['flint'],
    homeBase: true,
    base: DEFAULT_BASE,
    opponents: 0,
    goal: 'none',
    // Gold Mine's Scenario.txt: a cool climate, a slow year, gusty winds.
    weather: { ...DEFAULT_WEATHER, climate: sval(40, 10), yearSpeed: sval(20, 10), wind: sval(1, 100, -100, 100) },
  },
  {
    id: 'minor-melee',
    title: 'Minor Melee',
    description:
      'The most basic and straightforward battle in Clonk. Run, dodge, jump, and throw rocks and flints: weaken the enemy with hits before you take them on with your fists. Flints lie all around. The last crew standing wins.',
    landscape: {
      ...DEFAULT_LANDSCAPE,
      mapHeight: sval(60, 0, 40, 250),
      amplitude: sval(11),
      phase: sval(50, 50),
      random: sval(46),
      liquid: 'Water-Smooth',
      liquidLevel: sval(43),
      layers: LAYERS(7, 7),
      inEarth: { rock: 1, flint: 1 },
      onSurface: { flint: 30 },
      ...TREES,
    },
    seed: 4242,
    newMapEachRound: true,
    crewSize: 3,
    sorcerers: 0,
    magic: [],
    rules: [],
    startItems: ['flint'],
    homeBase: false,
    base: { wealth: 0, stock: { flint: 5, clonk: 5 } },
    opponents: 1,
    goal: 'melee',
    // Minor Melee's Scenario.txt: always late spring, gusty winds.
    weather: { ...DEFAULT_WEATHER, climate: sval(19), startSeason: sval(23), yearSpeed: sval(0), wind: sval(1, 100, -100, 100) },
  },
];

export function scenarioById(id: string, own: readonly ScenarioDef[] = []): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id) ?? own.find((s) => s.id === id);
}

/** True for the scenarios that come with the game. */
export function isOriginal(s: ScenarioDef): boolean {
  return SCENARIOS.some((o) => o.id === s.id);
}

/** How many crews take part in a round of the scenario: the player and the computer crews. */
export function crewCount(s: ScenarioDef): number {
  return 1 + s.opponents;
}

/** The usual size of the scenario's landscape in pixels (without its random spread). */
export function landscapeSize(s: ScenarioDef): { width: number; height: number } {
  const l = s.landscape;
  const extend = l.mapPlayerExtend ? Math.min(crewCount(s), MAX_MAP_PLAYER_EXTEND) : 1;
  return {
    width: Math.min(l.mapWidth.std * extend, l.mapWidth.max) * l.mapZoom.std,
    height: l.mapHeight.std * l.mapZoom.std,
  };
}

/** Limits for every setting, so a hand-edited or old save can't break the game. */
export const LIMITS = {
  seed: { min: 0, max: 999999, step: 1 },
  /** Map size in map pixels and zoom (landscape pixels per map pixel). */
  mapWidth: { min: 20, max: 250, step: 1 },
  mapHeight: { min: 20, max: 250, step: 1 },
  mapZoom: { min: 5, max: 15, step: 1 },
  /** Amplitude, phase, period, random, water level and objects-in-earth level. */
  percent: { min: 0, max: 100, step: 1 },
  /** Amount of a material layer, and share of an object in the earth. */
  layer: { min: 0, max: 100, step: 1 },
  share: { min: 0, max: 10, step: 1 },
  maxLayers: 12,
  /** Objects on the surface per 1000 pixels of map width. */
  objects: { min: 0, max: 200, step: 1 },
  crewSize: { min: 1, max: 12, step: 1 },
  sorcerers: { min: 0, max: 12, step: 1 },
  /** Gravity in percent of normal. */
  gravity: { min: 10, max: 200, step: 1 },
  /** Wind, to the left (negative) or right. */
  wind: { min: -100, max: 100, step: 1 },
  opponents: { min: 0, max: 3, step: 1 },
  wealth: { min: 0, max: 1000, step: 5 },
  stock: { min: 0, max: 99, step: 1 },
};

/** Objects a scenario can hand out, bury or scatter, in the settings' order. */
export const ITEM_IDS: ItemId[] = ['flint', 'tflint', 'superflint', 'supertflint', 'teraflint', 'rock', 'gold', 'wood', 'crystal'];
/** What a home base can sell, in the settings' and the shop's order. */
export const SHOP_IDS: ShopId[] = ['flint', 'tflint', 'superflint', 'supertflint', 'teraflint', 'rock', 'wood', 'conkit', 'lorry', 'boat', 'balloon', 'blimp', 'flag', 'crystal', 'clonk', 'sorcerer'];

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

/** A value with a random spread, kept within its own range and the setting's limits. */
function svalIn(raw: unknown, f: SVal, lim: { min: number; max: number }): SVal {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SVal>;
  const min = Math.round(clamp(r.min, lim, f.min));
  const max = Math.round(clamp(r.max, { min, max: lim.max }, Math.max(f.max, min)));
  return {
    std: Math.round(clamp(r.std, { min, max }, f.std)),
    rnd: Math.round(clamp(r.rnd, { min: 0, max: lim.max - lim.min }, f.rnd)),
    min,
    max,
  };
}

/** The landscape section within limits, missing values taken from `f`. */
function landscapeIn(raw: unknown, f: LandscapeDef): LandscapeDef {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<LandscapeDef>;
  const P = LIMITS.percent;
  const bool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb);
  const mat = (v: unknown, fb: string): string => (typeof v === 'string' && texIndex(v) ? v : fb);
  const layers = Array.isArray(r.layers)
    ? r.layers
        .filter((l): l is { name: string; count: number } => !!l && typeof l === 'object' && typeof l.name === 'string' && texIndex(l.name) > 0)
        .slice(0, LIMITS.maxLayers)
        .map((l) => ({ name: l.name, count: Math.round(clamp(l.count, LIMITS.layer, 0)) }))
    : f.layers.map((l) => ({ ...l }));
  return {
    mapWidth: svalIn(r.mapWidth, f.mapWidth, LIMITS.mapWidth),
    mapHeight: svalIn(r.mapHeight, f.mapHeight, LIMITS.mapHeight),
    mapZoom: svalIn(r.mapZoom, f.mapZoom, LIMITS.mapZoom),
    amplitude: svalIn(r.amplitude, f.amplitude, P),
    phase: svalIn(r.phase, f.phase, P),
    period: svalIn(r.period, f.period, P),
    random: svalIn(r.random, f.random, P),
    liquidLevel: svalIn(r.liquidLevel, f.liquidLevel, P),
    mapPlayerExtend: bool(r.mapPlayerExtend, f.mapPlayerExtend),
    topOpen: bool(r.topOpen, f.topOpen),
    bottomOpen: bool(r.bottomOpen, f.bottomOpen),
    material: mat(r.material, f.material),
    liquid: mat(r.liquid, f.liquid),
    layers,
    inEarth: r.inEarth ? counts(ITEM_IDS, r.inEarth, LIMITS.share) : { ...f.inEarth },
    inEarthLevel: svalIn(r.inEarthLevel, f.inEarthLevel, P),
    onSurface: r.onSurface ? counts(ITEM_IDS, r.onSurface, LIMITS.objects, false) : { ...f.onSurface },
    gravity: svalIn(r.gravity, f.gravity, LIMITS.gravity),
    vegetation: r.vegetation ? counts(PLANT_IDS, r.vegetation, LIMITS.share) : { ...f.vegetation },
    vegetationLevel: svalIn(r.vegetationLevel, f.vegetationLevel, P),
    grass: bool(r.grass, f.grass),
  };
}

/** The weather page within limits, missing values taken from `f`. */
function weatherIn(raw: unknown, f: WeatherDef): WeatherDef {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<WeatherDef>;
  const P = LIMITS.percent;
  const bool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb);
  return {
    climate: svalIn(r.climate, f.climate, P),
    startSeason: svalIn(r.startSeason, f.startSeason, P),
    yearSpeed: svalIn(r.yearSpeed, f.yearSpeed, P),
    rain: svalIn(r.rain, f.rain, P),
    lightning: svalIn(r.lightning, f.lightning, P),
    wind: svalIn(r.wind, f.wind, LIMITS.wind),
    earthquake: svalIn(r.earthquake, f.earthquake, P),
    volcano: svalIn(r.volcano, f.volcano, P),
    meteorite: svalIn(r.meteorite, f.meteorite, P),
    seasonColors: bool(r.seasonColors, f.seasonColors),
    skyWind: bool(r.skyWind, f.skyWind),
  };
}

/** A scenario saved before maps had the original's landscape values: keep its size and surface objects. */
function migrateLandscape(raw: Partial<ScenarioDef> & { width?: unknown; height?: unknown; map?: { onSurface?: unknown } }, f: LandscapeDef): unknown {
  if (raw.landscape || raw.width === undefined) return raw.landscape;
  const zoom = f.mapZoom.std;
  const size = (v: unknown, s: SVal): SVal => ({ ...s, std: typeof v === 'number' ? Math.round(v / zoom) : s.std, max: Math.max(s.max, 250) });
  return {
    ...f,
    mapWidth: size(raw.width, f.mapWidth),
    mapHeight: size(raw.height, f.mapHeight),
    mapPlayerExtend: false,
    onSurface: raw.map?.onSurface ?? f.onSurface,
  };
}

/**
 * Make a scenario safe to play: every setting in range, missing settings
 * taken from `fallback` (the original it was copied from, or Gold Mine).
 */
export function normalizeScenario(raw: Partial<ScenarioDef>, fallback: ScenarioDef = SCENARIOS[0]): ScenarioDef {
  const f = fallback;
  const base = raw.base ?? f.base;
  const items = Array.isArray(raw.startItems) ? raw.startItems.filter((i) => ITEM_IDS.includes(i)).slice(0, 1) : f.startItems;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : f.id,
    title: (typeof raw.title === 'string' ? raw.title.trim().slice(0, 40) : '') || f.title,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 400) : f.description,
    landscape: landscapeIn(migrateLandscape(raw, f.landscape), f.landscape),
    seed: Math.round(clamp(raw.seed, LIMITS.seed, f.seed)),
    // Scenarios saved before this setting existed always had the same map.
    newMapEachRound: typeof raw.newMapEachRound === 'boolean' ? raw.newMapEachRound : raw.landscape ? f.newMapEachRound : false,
    crewSize: Math.round(clamp(raw.crewSize, LIMITS.crewSize, f.crewSize)),
    // Scenarios saved before sorcerers, spells and rules existed have none.
    sorcerers: Math.round(clamp(raw.sorcerers, LIMITS.sorcerers, raw.landscape ? 0 : f.sorcerers)),
    magic: Array.isArray(raw.magic) ? SPELL_IDS.filter((id) => raw.magic!.includes(id)) : [],
    rules: Array.isArray(raw.rules) ? RULE_IDS.filter((id) => raw.rules!.includes(id)) : [],
    startItems: items,
    homeBase: typeof raw.homeBase === 'boolean' ? raw.homeBase : f.homeBase,
    base: {
      wealth: Math.round(clamp(base?.wealth, LIMITS.wealth, f.base.wealth)),
      stock: counts(SHOP_IDS, base?.stock, LIMITS.stock),
    },
    opponents: Math.round(clamp(raw.opponents, LIMITS.opponents, f.opponents)),
    goal: raw.goal === 'melee' || raw.goal === 'none' ? raw.goal : f.goal,
    weather: weatherIn(raw.weather, f.weather),
    ...(raw.basedOn ? { basedOn: String(raw.basedOn) } : {}),
  };
}
