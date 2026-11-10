// Oil, lava and acid against the things in the world, like the original's:
// burning oil is a crowd of Flame objects (Objects.c4d/Effects.c4d/Flame.c4d,
// BurnProcess) that eat the oil from the top; lava sets fire to what's in it
// and acid eats at clonks (C4Object::ExecLife, the InMat checks); burning
// things and blasts light oil (C4Object::ExecFire, Explosion in C4Effect.cpp).
// See licenses/clonk_engine_license.txt.

import { MATERIALS } from '../landscape/materials';
import { Clonk } from '../objects/clonk';
import { Item } from '../objects/item';
import { contactIncinerate, contains, fireCenter, FIRE_SPREAD_INTERVAL, incinerate, type Burnable } from './fire';
import type { World } from './world';

export const OIL_FIRE = {
  /** The flame's shape at full size (Flame.c4d Width, Height, Offset); it grows and shrinks with its con (StretchGrowth). */
  width: 16,
  height: 18,
  /** Its one vertex, 3 px below its centre, and how deep it floats (Float=8). */
  vertexY: 3,
  float: 8,
  /** The Burn action: BurnProcess every 10 ticks. */
  interval: 10,
  /** Con gained while there's oil to eat, lost when there isn't, in percent. */
  grow: 5,
  /** Rising in a liquid (FloatAccel), at most this fast, and slowing sideways (FloatFriction): px per tick. */
  floatAccel: 0.1,
  floatFriction: 0.02,
  /** Every 10 ticks: lava sets fire to what's in it, acid takes Corrosive/15 energy (C4Object::ExecLife). */
  inMatInterval: 10,
};

let nextFlameId = 1;

/** A flame on burning oil (the original's FLAM): it floats on the oil, eats it, and spreads. */
export class OilFlame {
  readonly id = nextFlameId++;
  xdir = 0;
  ydir = 0;
  /** Size in percent (Con): grows to 100 while it eats, dies away at 0. */
  con = 100;
  removed = false;
  /** Tick it was created: its Burn action counts from there. */
  readonly born: number;

  constructor(
    public x: number,
    public y: number,
    tick: number,
  ) {
    this.born = tick;
  }

  /** Its shape now, centred on x, y. */
  get w(): number {
    return Math.max(1, Math.trunc((OIL_FIRE.width * this.con) / 100));
  }

  get h(): number {
    return Math.max(1, Math.trunc((OIL_FIRE.height * this.con) / 100));
  }

  contains(px: number, py: number): boolean {
    const w = this.w;
    const h = this.h;
    const left = Math.round(this.x) - Math.trunc(w / 2);
    const top = Math.round(this.y) - Math.trunc(h / 2);
    return px >= left && px < left + w && py >= top && py < top + h;
  }
}

/**
 * Set oil on fire at a spot: a new flame, unless there's one close by already
 * (C4Landscape::Incinerate: no other FLAM in the 8x20 box from x-4, y-1).
 */
export function igniteOil(world: World, x: number, y: number): boolean {
  if (flameIn(world, x - 4, y - 1, 8, 20, null)) return false;
  addFlame(world, x, y);
  return true;
}

function addFlame(world: World, x: number, y: number): OilFlame {
  const f = new OilFlame(x, y, world.tick);
  world.flames.push(f);
  world.events.push({ type: 'inflame', x, y, loud: false, tick: world.tick });
  return f;
}

/** Is there a flame (not `self`) whose centre is in this box? (FindObject with a rectangle) */
function flameIn(world: World, x: number, y: number, w: number, h: number, self: OilFlame | null): boolean {
  for (const f of world.flames) {
    if (f === self || f.removed) continue;
    if (f.x >= x && f.x < x + w && f.y >= y && f.y < y + h) return true;
  }
  return false;
}

/** Is there a flame (not `self`) at this point? (FindObject with only an offset) */
function flameAt(world: World, x: number, y: number, self: OilFlame): boolean {
  return world.flames.some((f) => f !== self && !f.removed && f.contains(x, y));
}

/** Burn one pixel of oil away at x, y, from the top of its pool (FlameConsumeMaterial). */
function consume(world: World, x: number, y: number): boolean {
  const land = world.land;
  x = Math.round(x);
  y = Math.round(y);
  if (!land.inBounds(x, y) || !MATERIALS[land.get(x, y)].inflammable) return false;
  land.extractMaterial(x, y);
  return true;
}

/** One tick of every oil flame: they float, and every 10 ticks they burn (Flame.c4d BurnProcess). */
export function stepFlames(world: World): void {
  if (!world.flames.length) return;
  const land = world.land;
  for (const f of [...world.flames]) {
    if (f.removed) continue;
    move(world, f);
    if (f.removed) continue;
    if ((world.tick - f.born) % OIL_FIRE.interval === OIL_FIRE.interval - 1) burnProcess(world, f);
    // Water puts it out (ExecFire, every 5 ticks); then it's gone.
    if (!f.removed && world.tick % 5 === 0 && MATERIALS[land.get(Math.round(f.x), Math.round(f.y))].extinguisher) {
      f.removed = true;
      world.events.push({ type: 'extinguish', x: f.x, y: f.y, hiss: true, tick: world.tick });
    }
  }
  world.flames = world.flames.filter((f) => !f.removed);
}

/** Float on liquids, fall otherwise, stop at walls and floors (DoGravity, DoMovement with one vertex). */
function move(world: World, f: OilFlame): void {
  const land = world.land;
  const depth = Math.trunc((OIL_FIRE.float * f.con) / 100);
  const x = Math.round(f.x);
  const y = Math.round(f.y);
  if (land.isLiquid(x, y + depth - 1)) {
    f.ydir = Math.max(f.ydir - OIL_FIRE.floatAccel, -OIL_FIRE.floatAccel * 10);
    if (f.xdir < -OIL_FIRE.floatFriction) f.xdir += OIL_FIRE.floatFriction;
    else if (f.xdir > OIL_FIRE.floatFriction) f.xdir -= OIL_FIRE.floatFriction;
    if (!land.isLiquid(x, y - 1 + depth - 1) && f.ydir < 0) f.ydir = 0;
  } else f.ydir += land.gravity;
  const vy = OIL_FIRE.vertexY;
  // Sideways, then up or down, pixel by pixel until something solid is in the way.
  const tx = f.x + f.xdir;
  let cx = Math.round(f.x);
  while (cx !== Math.round(tx)) {
    const nx = cx + Math.sign(Math.round(tx) - cx);
    if (land.isSolid(nx, Math.round(f.y) + vy)) {
      f.xdir = 0;
      break;
    }
    cx = nx;
  }
  f.x = f.xdir === 0 ? cx : tx;
  const ty = f.y + f.ydir;
  let cy = Math.round(f.y);
  while (cy !== Math.round(ty)) {
    const ny = cy + Math.sign(Math.round(ty) - cy);
    if (land.isSolid(Math.round(f.x), ny + vy)) {
      f.ydir = 0;
      break;
    }
    cy = ny;
  }
  f.y = f.ydir === 0 ? cy : ty;
  if (f.x < 0 || f.x >= land.width || f.y >= land.height + 20) f.removed = true;
}

function shrink(f: OilFlame): void {
  f.y -= 1;
  f.con -= OIL_FIRE.grow;
  if (f.con <= 0) f.removed = true;
}

/**
 * Flame.c4d BurnProcess: eat a pixel of oil below (or at) the flame; with
 * none left it rises and dies down. Too many flames on one spot die down
 * too; a flame alone lights another one next to it, so the fire spreads over
 * the whole pool.
 */
function burnProcess(world: World, f: OilFlame): void {
  let i = -5;
  for (; i <= 10; i++) if (consume(world, f.x, f.y + i)) break;
  // Don't get stuck at the bottom.
  if (i === -5) f.y -= 1;
  if (i > 10) return shrink(f);
  consume(world, f.x, f.y + 8);
  if (flameAt(world, Math.round(f.x), Math.round(f.y) - 5, f)) return shrink(f);
  if (!flameIn(world, f.x - 4, f.y - 9, 8, 18, f)) {
    const n = addFlame(world, f.x + world.rng.int(7) - 3, f.y + Math.trunc((8 * f.con) / 100));
    n.ydir = f.ydir;
  }
  f.con = Math.min(100, f.con + OIL_FIRE.grow);
  f.xdir = (world.rng.int(31) - 15) / 10;
}

/**
 * Every 35 ticks, a flame sets fire to the first inflammable thing its
 * centre is in, one time in that thing's ContactIncinerate, like any burning
 * object (C4GameObjects::CrossCheck). So a clonk swimming through burning oil
 * catches fire.
 */
function flamesSpread(world: World, things: readonly Burnable[]): void {
  for (const f of world.flames) {
    if (f.removed) continue;
    const target = things.find((x) => !x.fire && !x.removed && !isContained(x) && contactIncinerate(x) > 0 && contains(x, Math.round(f.x), Math.round(f.y)));
    if (!target || world.rng.int(contactIncinerate(target))) continue;
    incinerate(world, target, null);
  }
}

function isContained(o: Burnable): boolean {
  if (o instanceof Clonk) return !!o.contained;
  if (o instanceof Item) return !!o.container;
  return false;
}

/**
 * What the material around a thing does to it, every 10 ticks (C4Object::
 * ExecLife): lava (Incindiary) sets it alight if it can burn at all, acid
 * (Corrosive 75) takes 5 energy from a living clonk, credited to whoever hurt
 * it last, so throwing an enemy into an acid lake counts as the kill.
 */
export function stepInMaterial(world: World, things: readonly Burnable[]): void {
  if (world.tick % OIL_FIRE.inMatInterval !== 0) return;
  const land = world.land;
  for (const o of things) {
    if (o.removed || isContained(o)) continue;
    const p = fireCenter(o);
    const mat = MATERIALS[land.get(Math.round(p.x), Math.round(p.y))];
    if (mat.corrosive && o instanceof Clonk && o.alive) world.hurt(o, Math.trunc(mat.corrosive / 15), o.lastHurtBy);
    if (mat.incindiary && !o.fire && contactIncinerate(o) > 0) incinerate(world, o, o instanceof Clonk ? o.lastHurtBy : null);
  }
}

/**
 * A burning thing sitting in oil lights it, one time in three every 5 ticks
 * (C4Object::ExecFire, the background effects).
 */
function burningInOil(world: World, o: Burnable): void {
  if (world.rng.int(3)) return;
  const p = fireCenter(o);
  world.land.incinerate(Math.round(p.x), Math.round(p.y));
}

/** A blast lights oil at its centre, or 10 px above, or to either side above (Explosion in C4Effect.cpp). */
export function blastIgnite(world: World, x: number, y: number): void {
  const land = world.land;
  if (!land.incinerate(x, y)) if (!land.incinerate(x, y - 10)) if (!land.incinerate(x - 5, y - 5)) land.incinerate(x + 5, y - 5);
}

/**
 * Everything oil, lava and acid do to the things in the world in a tick,
 * after the fires have burned: the flames on oil, burning things lighting
 * the oil they're in, lava and acid.
 */
export function stepLiquids(world: World): void {
  const things = [...burnablesOf(world)];
  stepFlames(world);
  if (world.tick % 5 === 0) for (const o of things) if (o.fire && !o.removed && !isContained(o)) burningInOil(world, o);
  if (world.tick % FIRE_SPREAD_INTERVAL === 0) flamesSpread(world, things);
  stepInMaterial(world, things);
}

function* burnablesOf(world: World): Generator<Burnable> {
  yield* world.clonks;
  yield* world.items;
  yield* world.plants;
  for (const s of world.structures) if (!s.gone) yield s;
}
