// Trees, bushes and grass, from the original Clonk Rage content
// (Objects.c4d/Vegetation.c4d: Tree.c4d's tree control script, Tree1-4.c4d,
// Bush1.c4d, Grass.c4d; Environment.c4d/Grass.c4d) and engine
// (C4Game::PlaceVegetation, C4Object::ExecLife growth, C4Object::Chop).
// See licenses/clonk_engine_license.txt.

import type { Rng } from '../core/rng';
import type { Landscape } from '../landscape/landscape';
import { LIQUID, MATERIALS, Mat } from '../landscape/materials';
import type { Facet } from './defs';
import type { FireState } from './fire';

export type PlantId = 'tree1' | 'tree2' | 'tree3' | 'tree4' | 'bush';

/** A stretch of frames in a plant's graphics strip, like an ActMap action. */
export interface AnimSegment {
  /** First frame. */
  from: number;
  length: number;
  /** Ticks per frame. */
  delay: number;
  /** Play from the last frame to the first. */
  reverse?: boolean;
}

export interface PlantDef {
  id: PlantId;
  name: string;
  /** Shape (DefCore Width, Height, Offset): the offset is the top-left corner relative to the centre. */
  width: number;
  height: number;
  offset: { x: number; y: number };
  /** The root vertex (the first one), relative to the centre: the tree tips over around it. */
  root: { x: number; y: number };
  /** Con gained every 35 ticks, in hundreds (DefCore Growth). */
  growth: number;
  /** Price in gold (DefCore Value). */
  value: number;
  /** Pieces of wood in a fully grown one (DefCore Components WOOD). */
  wood: number;
  /** Damage it takes to fell a fully grown one (TreeStrength). */
  strength: number;
  file: string;
  /** Swaying in a calm (Still and the actions it leads to), as a loop. */
  still: AnimSegment[];
  /** Swaying in a strong wind (Breeze), as a loop. */
  breeze: AnimSegment | null;
  /** Its picture for the scenario settings (DefCore Picture), and the size of the whole file. */
  picture: Facet;
  sheet: [number, number];
  /** A burning object it touches sets it alight one time in this many (DefCore ContactIncinerate). */
  contactIncinerate: number;
  /** Blast damage that sets it alight (DefCore BlastIncinerate). */
  blastIncinerate: number;
  /**
   * What it turns into when it catches fire (DefCore BurnTo, the Burned.c4d
   * dead tree): one picture, a bit less wood, and it doesn't grow.
   */
  burned: { file: string; width: number; height: number; offset: { x: number; y: number }; wood: number; fireTop: number };
}

/** Con of a fully grown plant (FullCon). */
export const FULL_CON = 100000;

/** The tree control script's constants and the engine's timers. */
export const TREE = {
  /** Growth happens every 35 ticks (Tick35). */
  growthInterval: 35,
  /** Seed is called every 350 ticks (DefCore Timer)... */
  seedInterval: 350,
  /** ...and reproduces one time in this many (ReproductionRate). */
  reproductionRate: 500,
  /** New trees come up within a square this big around the parent (ReproductionAreaSize)... */
  reproductionArea: 400,
  /** ...unless this many trees already stand there (MaxTreeCount). */
  maxTrees: 40,
  /** Con of a tree that just came up (PlaceVegetation's growth 10). */
  seedlingCon: 10,
  /** Chopping hits every 30 ticks (Chop every 3 ticks, damage on every 10th) for 10 damage. */
  chopInterval: 30,
  chopDamage: 10,
  /** Small trees are as hard to fell as a 30% tree. */
  minStrengthCon: 30,
  /** Placement tries for each tree (PlaceVegetation). */
  placeTries: 20,
  /** Trees only come up this far from the top and bottom of the map. */
  placeMargin: 50,
};

const rows = (length: number, delay: number): AnimSegment => ({ from: 0, length, delay });

export const PLANTS: Record<PlantId, PlantDef> = {
  // Tree1.c4d: the big deciduous tree.
  tree1: {
    id: 'tree1', name: 'Deciduous tree', width: 73, height: 71, offset: { x: -36, y: -36 }, root: { x: -2, y: 29 },
    growth: 1, value: 5, wood: 7, strength: 150, file: 'vegetation/Tree1.png',
    still: [
      { from: 0, length: 10, delay: 4 },
      { from: 10, length: 2, delay: 5 },
      { from: 12, length: 2, delay: 7 },
      { from: 10, length: 4, delay: 7, reverse: true },
      { from: 0, length: 10, delay: 4, reverse: true },
    ],
    breeze: rows(40, 2),
    picture: { x: 0, y: 0, w: 73, h: 71 }, sheet: [2920, 71],
    contactIncinerate: 2, blastIncinerate: 10,
    burned: { file: 'vegetation/Tree1Burned.png', width: 73, height: 71, offset: { x: -36, y: -36 }, wood: 5, fireTop: 10 },
  },
  // Tree2.c4d: a conifer.
  tree2: {
    id: 'tree2', name: 'Conifer', width: 40, height: 56, offset: { x: -20, y: -28 }, root: { x: 2, y: 22 },
    growth: 2, value: 3, wood: 5, strength: 150, file: 'vegetation/Tree2.png',
    still: [rows(40, 10)], breeze: rows(40, 2),
    picture: { x: 0, y: 0, w: 40, h: 56 }, sheet: [1600, 56],
    contactIncinerate: 2, blastIncinerate: 10,
    burned: { file: 'vegetation/Tree2Burned.png', width: 40, height: 56, offset: { x: -20, y: -28 }, wood: 3, fireTop: 20 },
  },
  // Tree3.c4d: a tall leafy tree.
  tree3: {
    id: 'tree3', name: 'Leafy tree', width: 52, height: 75, offset: { x: -26, y: -37 }, root: { x: -2, y: 31 },
    growth: 2, value: 5, wood: 5, strength: 150, file: 'vegetation/Tree3.png',
    still: [rows(40, 10)], breeze: rows(40, 2),
    picture: { x: 0, y: 0, w: 52, h: 75 }, sheet: [2080, 75],
    contactIncinerate: 2, blastIncinerate: 10,
    burned: { file: 'vegetation/Tree3Burned.png', width: 52, height: 75, offset: { x: -26, y: -37 }, wood: 3, fireTop: 40 },
  },
  // Tree4.c4d: a young tree.
  tree4: {
    id: 'tree4', name: 'Young tree', width: 40, height: 56, offset: { x: -20, y: -28 }, root: { x: -4, y: 20 },
    growth: 2, value: 4, wood: 3, strength: 150, file: 'vegetation/Tree4.png',
    still: [rows(1, 50)], breeze: rows(20, 5),
    picture: { x: 0, y: 0, w: 40, h: 56 }, sheet: [800, 56],
    contactIncinerate: 2, blastIncinerate: 10,
    burned: { file: 'vegetation/Tree4Burned.png', width: 40, height: 56, offset: { x: -20, y: -28 }, wood: 2, fireTop: 5 },
  },
  // Bush1.c4d: "a little something for the practised clonk".
  bush: {
    id: 'bush', name: 'Bush', width: 41, height: 39, offset: { x: -20, y: -19 }, root: { x: 2, y: 11 },
    growth: 4, value: 2, wood: 1, strength: 40, file: 'vegetation/Bush1.png',
    still: [rows(1, 50)], breeze: null,
    picture: { x: 0, y: 0, w: 41, h: 39 }, sheet: [42, 39],
    contactIncinerate: 1, blastIncinerate: 10,
    burned: { file: 'vegetation/Bush1Burned.png', width: 48, height: 39, offset: { x: -24, y: -19 }, wood: 1, fireTop: 5 },
  },
};

export const PLANT_IDS = Object.keys(PLANTS) as PlantId[];

/** Grass.c4d: three tufts of 40x30, placed every 12 pixels along earth (Environment.c4d/Grass.c4d). */
export const GRASS = {
  file: 'vegetation/Grass.png',
  width: 40,
  height: 30,
  frames: 3,
  spacing: 12,
  sheet: [120, 30] as [number, number],
};

let nextPlantId = 1;

/**
 * A tree or bush. It stands until it's chopped or blasted down, then tips
 * over around its root and lies there, and can be chopped into wood.
 */
export class Plant {
  readonly id = nextPlantId++;
  /** How grown it is, 0 to FULL_CON. It's drawn stretched to its size. */
  con: number;
  /** Damage from chopping and blasts. */
  damage = 0;
  state: 'standing' | 'falling' | 'fallen' = 'standing';
  /** Tilt in degrees (clockwise) while falling over, and how fast it tips. */
  r = 0;
  rdir = 0;
  /** Pieces of wood left in a felled tree. */
  wood = 0;
  removed = false;
  /** How strong a wind it takes to sway it (MotionThreshold), and where its animation starts. */
  readonly threshold: number;
  readonly animOffset: number;
  /** When its timers (growth, seeding) come round, so not every tree acts on the same tick. */
  readonly timerOffset: number;
  /** Swaying in a strong wind. */
  breeze = false;
  /** Burned (or burning): a dead tree that doesn't grow (BurnTo). */
  burned = false;
  fire: FireState | null = null;

  constructor(
    readonly def: PlantDef,
    /** Centre x. */
    readonly x: number,
    /** Bottom edge of the shape: it stays put as the plant grows (StretchGrowth). */
    readonly bottom: number,
    con: number,
    /** -1 or 1: drawn mirrored or not. */
    readonly dir: -1 | 1,
    rng: Rng,
  ) {
    this.con = Math.max(1, Math.min(FULL_CON, con));
    this.threshold = rng.int(10);
    this.animOffset = rng.int(400);
    this.timerOffset = rng.int(TREE.seedInterval);
  }

  get scale(): number {
    return this.con / FULL_CON;
  }

  /** Where the root is: the point it tips over around. */
  get pivot(): { x: number; y: number } {
    const d = this.def;
    const k = this.scale;
    return { x: this.x + d.root.x * k * this.dir, y: this.bottom - (d.offset.y + d.height - d.root.y) * k };
  }

  /** The shape of a standing plant: left, top, width, height. */
  get shape(): { x: number; y: number; w: number; h: number } {
    const d = this.def;
    const k = this.scale;
    const w = d.width * k;
    const h = d.height * k;
    return { x: this.x + d.offset.x * k, y: this.bottom - h, w, h };
  }

  /** The middle of its shape, tilted with it: the point that sets fire to what it's in. */
  get center(): { x: number; y: number } {
    const s = this.shape;
    return this.rotate(s.x + s.w / 2, s.y + s.h / 2, this.r);
  }

  /** The box around its shape, tilted as it is. */
  get bounds(): { x: number; y: number; w: number; h: number } {
    const s = this.shape;
    if (!this.r) return s;
    const pts = [
      this.rotate(s.x, s.y, this.r),
      this.rotate(s.x + s.w, s.y, this.r),
      this.rotate(s.x, s.y + s.h, this.r),
      this.rotate(s.x + s.w, s.y + s.h, this.r),
    ];
    const x = Math.min(...pts.map((p) => p.x));
    const y = Math.min(...pts.map((p) => p.y));
    return { x, y, w: Math.max(...pts.map((p) => p.x)) - x, h: Math.max(...pts.map((p) => p.y)) - y };
  }

  /** Is the point inside its shape, tilted as it is? */
  contains(px: number, py: number): boolean {
    const p = this.rotate(px, py, -this.r);
    const s = this.shape;
    return p.x >= s.x && p.x < s.x + s.w && p.y >= s.y && p.y < s.y + s.h;
  }

  /** A point turned `r` degrees clockwise around the root. */
  private rotate(px: number, py: number, r: number): { x: number; y: number } {
    if (!r) return { x: px, y: py };
    const p = this.pivot;
    const a = (r * Math.PI) / 180;
    const dx = px - p.x;
    const dy = py - p.y;
    return { x: p.x + dx * Math.cos(a) - dy * Math.sin(a), y: p.y + dx * Math.sin(a) + dy * Math.cos(a) };
  }

  /** Wood in it at its size: a burned one has less (DefCore Components, cut down with its con). */
  get woodAtCon(): number {
    return Math.trunc(((this.burned ? this.def.burned.wood : this.def.wood) * this.con) / FULL_CON);
  }

  /** A point along the trunk, `t` from the root (0) to the top (1), tilted by `r`. */
  trunkPoint(t: number, r = this.r): { x: number; y: number } {
    const d = this.def;
    const p = this.pivot;
    const len = (d.root.y - d.offset.y) * this.scale * t;
    const a = (r * Math.PI) / 180;
    return { x: p.x + Math.sin(a) * len, y: p.y - Math.cos(a) * len };
  }

  /** Damage that fells it: its strength, for small trees as if 30% grown (Tree.c4d Damage). */
  get fellDamage(): number {
    return (this.def.strength * Math.max(Math.trunc((this.con * 100) / FULL_CON), TREE.minStrengthCon)) / 100;
  }

  /** Is the point (a clonk's centre) at this plant, so a clonk there can chop it? */
  isAt(px: number, py: number): boolean {
    if (this.state === 'standing') {
      const s = this.shape;
      return px >= s.x && px < s.x + s.w && py >= s.y && py < s.y + s.h;
    }
    if (this.state !== 'fallen') return false;
    // Near the trunk lying on the ground.
    const a = this.trunkPoint(0);
    const b = this.trunkPoint(0.9);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(a.x + dx * t - px, a.y + dy * t - py) <= 12;
  }

  /** Fell it (Tree.c4d ChopDown): it tips over to one side. Its wood is what its size is worth. */
  chopDown(side: -1 | 1): void {
    if (this.state !== 'standing') return;
    this.state = 'falling';
    this.rdir = side * 0.6;
    this.wood = this.woodAtCon;
  }

  /**
   * One tick of tipping over: it swings down faster and faster until its
   * crown hits the ground or it lies flat. Returns true when it lands.
   */
  fall(land: Landscape): boolean {
    if (this.state !== 'falling') return false;
    this.rdir += Math.sign(this.rdir) * 0.25;
    const next = this.r + this.rdir;
    const hit = [0.55, 0.75, 0.95].some((t) => {
      const p = this.trunkPoint(t, next);
      return land.isSolid(Math.round(p.x), Math.round(p.y));
    });
    if (hit || Math.abs(next) >= 100) {
      if (!hit) this.r = Math.sign(next) * 100;
      this.state = 'fallen';
      this.rdir = 0;
      return true;
    }
    this.r = next;
    return false;
  }

  /** The animation frame for this tick: the calm or breeze loop. */
  frame(tick: number): number {
    const segs = this.breeze && this.def.breeze ? [this.def.breeze] : this.def.still;
    const total = segs.reduce((n, s) => n + s.length * s.delay, 0);
    let t = (tick + this.animOffset) % total;
    for (const s of segs) {
      const len = s.length * s.delay;
      if (t < len) {
        const i = Math.floor(t / s.delay);
        return s.reverse ? s.from + s.length - 1 - i : s.from + i;
      }
      t -= len;
    }
    return 0;
  }
}

/** A tuft of grass: drawn only, it goes when the ground under it goes or a blast blows it away. */
export interface Grass {
  x: number;
  /** Centre of the tuft. */
  y: number;
  /** Size, 0..1. */
  scale: number;
  frame: number;
  dir: -1 | 1;
  /** Tilt in degrees, along the ground. */
  r: number;
  removed?: boolean;
}

/** Earth and sand are soil things grow in (the material's Soil). */
function isSoil(m: Mat): boolean {
  return m === Mat.Earth || m === Mat.Sand;
}

function semiSolid(land: Landscape, x: number, y: number): boolean {
  return land.density(x, y) >= LIQUID;
}

/** The nearest free pixel right above something semi-solid, searching up and down from y (AboveSemiSolid). */
function aboveSemiSolid(land: Landscape, x: number, y: number): number | null {
  let up = y;
  let down = y;
  let upSolid = false;
  let downFree = false;
  while (up >= 0 || down < land.height) {
    if (up >= 0) {
      if (semiSolid(land, x, up)) upSolid = true;
      else if (upSolid) return up;
    }
    if (down < land.height) {
      if (!semiSolid(land, x, down)) downFree = true;
      else if (downFree) return down;
    }
    up--;
    down++;
  }
  return null;
}

/**
 * Find a place for a plant on soil in the given area and say where its
 * bottom goes (C4Game::PlaceVegetation, surface placement): open above,
 * open to the upper left and right, 2 pixels into earth or sand.
 */
export function findPlantSpot(
  land: Landscape,
  rng: Rng,
  def: PlantDef,
  area: { x: number; y: number; w: number; h: number },
): { x: number; bottom: number } | null {
  for (let i = 0; i < TREE.placeTries; i++) {
    const x = area.x + rng.int(Math.max(1, area.w));
    let y = area.y + rng.int(Math.max(1, area.h));
    if (x < 0 || x >= land.width) continue;
    // Out of the underground, then onto the nearest ground.
    while (y > 0 && land.isTunnel(x, y)) y--;
    const top = aboveSemiSolid(land, x, y);
    if (top === null || top < TREE.placeMargin || top >= land.height - TREE.placeMargin) continue;
    if (semiSolid(land, x, top - def.height) || semiSolid(land, x, top - Math.trunc(def.height / 2))) continue;
    const up = top - Math.trunc((def.height * 2) / 3);
    if (semiSolid(land, x - Math.trunc(def.width / 2), up) || semiSolid(land, x + Math.trunc(def.width / 2), up)) continue;
    if (!isSoil(land.get(x, top + 3))) continue;
    return { x, bottom: top + 8 };
  }
  return null;
}

/**
 * The scenario's trees at the start (C4Game::InitVegetation): one try per 50
 * pixels of map width at amount 100, each picking one of the listed kinds by
 * its share. A third of them are only partly grown.
 */
export function placeVegetation(
  land: Landscape,
  rng: Rng,
  shares: Partial<Record<PlantId, number>>,
  level: number,
): { id: PlantId; x: number; bottom: number; con: number; dir: -1 | 1 }[] {
  const kinds = PLANT_IDS.flatMap((id) => Array<PlantId>(Math.max(0, Math.round(shares[id] ?? 0))).fill(id));
  const out: { id: PlantId; x: number; bottom: number; con: number; dir: -1 | 1 }[] = [];
  if (!kinds.length) return out;
  const amount = Math.trunc((Math.trunc(land.width / 50) * level) / 100);
  for (let i = 0; i < amount; i++) {
    const def = PLANTS[kinds[rng.int(kinds.length)]];
    const con = def.growth && rng.int(3) === 0 ? rng.int(FULL_CON) + 1 : FULL_CON;
    const spot = findPlantSpot(land, rng, def, { x: 0, y: 0, w: land.width, h: land.height });
    if (!spot) continue;
    out.push({ id: def.id, ...spot, con, dir: rng.bool() ? 1 : -1 });
  }
  return out;
}

/** How high the ground is at x near y: the solid offset the grass script measures (GetSolidOffset). */
function solidOffset(land: Landscape, x: number, y: number): number {
  let i = -15;
  while (land.isSolid(x, y - i) && i < 15) i++;
  return i;
}

/**
 * Grass along the earth surface (Environment.c4d/Grass.c4d): every 12
 * pixels where the surface is earth, a tuft of random size and shape, tilted
 * along the ground and set a little into it.
 */
export function placeGrass(land: Landscape, rng: Rng, surface: Int32Array): Grass[] {
  const out: Grass[] = [];
  for (let x = 0; x < land.width; x += GRASS.spacing) {
    const y0 = surface[x];
    if (y0 >= land.height || land.get(x, y0) !== Mat.Earth || MATERIALS[land.get(x, y0 - 1)].density >= LIQUID) continue;
    const pct = rng.int(5) ? 100 - rng.int(20) - 40 : 100 - rng.int(50) - 20;
    let frame = rng.int(2);
    if (rng.int(20) === 0) frame = 2;
    const dir: -1 | 1 = rng.int(2) ? 1 : -1;
    const k = pct / 100;
    // The script looks for the ground in steps of 10 pixels, so tufts sit up to 9 pixels into it, drawn over its edge.
    let y = Math.ceil(y0 / 10) * 10;
    while (!land.isSolid(x, y + 5) && y < land.height) y++;
    const xo = Math.trunc(18 * k);
    const yo = Math.trunc(15 * k);
    const r = solidOffset(land, x - xo, y + yo) - solidOffset(land, x + xo, y + yo);
    out.push({ x, y, scale: k, frame, dir, r });
  }
  return out;
}

/** Does the grass still have ground under it? */
export function grassRooted(land: Landscape, g: Grass): boolean {
  for (let dy = -4; dy <= 8; dy++) if (land.isSolid(g.x, Math.round(g.y + dy))) return true;
  return false;
}

/** Does a standing plant still have ground at its root? */
export function plantRooted(land: Landscape, p: Plant): boolean {
  const k = Math.max(p.scale, 0.2);
  for (let dy = -2; dy <= Math.max(4, Math.round(8 * k)); dy++) {
    for (const dx of [-2, 0, 2]) if (land.isSolid(Math.round(p.x + dx), Math.round(p.bottom - 8 * k + dy))) return true;
  }
  return false;
}
