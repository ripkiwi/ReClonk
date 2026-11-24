// Barrels and the fire bomb, ported from the original content
// (Items.c4d/Containers.c4d Barrel.c4d and its full barrels,
// Weapons.c4d/FireBomb.c4d). See licenses/clonk_engine_license.txt.

import { Mat } from '../landscape/materials';
import { Clonk } from '../objects/clonk';
import { ITEMS } from '../objects/defs';
import type { Item } from '../objects/item';
import { extinguish, fireCenter, type Burnable } from './fire';
import { spitFlame } from './liquids';
import type { World } from './world';
import type { ItemId } from '../landscape/materials';

export const BARREL = {
  /** Material pixels a barrel holds (BARL_MaxFill). */
  maxFill: 200,
  /** It checks for liquid to fill up with every 35 ticks (TimerCall FillCheck, the default Timer). */
  fillInterval: 35,
  /** Its contents splash out at CastPXS level 20. */
  castLevel: 20,
  /** A water barrel puts out fires in this box around it (BarrelEject: FindObject(0, -20, -15, 40, 30, OCF_OnFire)). */
  extinguishBox: { x: -20, y: -15, w: 40, h: 30 },
  /** The fire bomb throws 20 flames at level 20 (Hit: CastObjects(DFLM, 20, 20)). */
  bombFlames: 20,
  bombLevel: 20,
};

/** The full barrel for this material, if there is one (GetBarrelType). */
function barrelFor(mat: Mat): ItemId | null {
  switch (mat) {
    case Mat.Water:
      return 'waterBarrel';
    case Mat.Oil:
      return 'oilBarrel';
    case Mat.Acid:
      return 'acidBarrel';
    case Mat.Lava:
    case Mat.DuroLava:
      return 'lavaBarrel';
  }
  return null;
}

/** Turn it into another kind of barrel (ChangeDef), keeping it where it is. */
function changeDef(it: Item, id: ItemId): void {
  it.def = ITEMS[id];
}

/** Where a barrel is: its holder's place if it's carried or kept somewhere. */
function placeOf(it: Item): { x: number; y: number } {
  const c = it.container;
  return c ? { x: c.x, y: c.y } : { x: it.x, y: it.y };
}

/**
 * FillCheck, every 35 ticks: an empty barrel, or one of the same liquid that
 * isn't full yet, takes in the liquid where it is, from the top of the lake
 * (ExtractMaterialAmount). Carried by a clonk who swims, it fills too.
 */
export function stepBarrels(world: World): void {
  if (world.tick % BARREL.fillInterval !== 0) return;
  for (const it of world.items) {
    const b = it.def.barrel;
    if (!b || it.removed || it.fill >= BARREL.maxFill) continue;
    if (it.container && !(it.container instanceof Clonk)) continue;
    const p = placeOf(it);
    const mat = world.land.get(p.x, p.y);
    const id = barrelFor(mat);
    if (!id || (b.mat !== null && b.mat !== ITEMS[id].barrel!.mat)) continue;
    let n = 0;
    while (it.fill + n < BARREL.maxFill && world.land.get(p.x, p.y) === mat && world.land.extractMaterial(p.x, p.y) === mat) n++;
    if (!n) continue;
    it.fill += n;
    if (b.mat === null) changeDef(it, id);
  }
}

/**
 * BarrelEject: out splashes what's in it as loose pixels (CastPXS level 20),
 * and it's an empty barrel again. A water barrel puts out fires near it first.
 * Returns false for an empty barrel.
 */
export function ejectBarrel(world: World, it: Item): boolean {
  const mat = it.def.barrel?.mat;
  if (mat === undefined || mat === null) return false;
  const p = placeOf(it);
  if (mat === Mat.Water) {
    const box = BARREL.extinguishBox;
    const all: Burnable[] = [...world.clonks, ...world.items, ...world.plants, ...world.structures, ...world.vehicles, ...world.animals];
    for (const o of all) {
      if (!o.fire) continue;
      const f = fireCenter(o);
      if (f.x < p.x + box.x || f.x >= p.x + box.x + box.w || f.y < p.y + box.y || f.y >= p.y + box.y + box.h) continue;
      const mass = 'mass' in o && typeof o.mass === 'number' ? o.mass : 50;
      if (it.fill >= world.rng.int(Math.max(1, Math.trunc(mass)))) extinguish(world, o, true);
    }
  }
  const lv = BARREL.castLevel;
  for (let i = 0; i < it.fill; i++) {
    const xdir = (world.rng.int(lv + 1) - Math.trunc(lv / 2)) / 10;
    const ydir = (world.rng.int(lv + 1) - lv) / 10;
    world.land.pxs.create(mat, p.x, p.y - 1, xdir, ydir);
  }
  it.fill = 0;
  changeDef(it, 'barrel');
  world.events.push({ type: 'siege', sound: 'Splash1', x: p.x, y: p.y, smoke: 0, tick: world.tick });
  return true;
}

/**
 * An oil barrel that took damage (OilBarrel Damaged): it blows up, and the
 * empty barrel flies off.
 */
export function oilBarrelBlown(world: World, it: Item): void {
  const p = placeOf(it);
  world.spawnItem('barrel', p.x, p.y, (world.rng.int(7) - 3), world.rng.int(3) - 8, 1);
}

/** The fire bomb bursts where it lands into 20 burning flames (FireBomb Hit). */
export function firebombHit(world: World, it: Item): void {
  it.removed = true;
  const lv = BARREL.bombLevel;
  for (let i = 0; i < BARREL.bombFlames; i++) {
    const xdir = (world.rng.int(lv + 1) - Math.trunc(lv / 2)) / 10;
    const ydir = (world.rng.int(lv + 1) - lv) / 10;
    spitFlame(world, it.x, it.y - 2, xdir, ydir);
  }
  world.events.push({ type: 'inflame', x: it.x, y: it.y, loud: true, tick: world.tick });
  world.events.push({ type: 'fuse', x: it.x, y: it.y, tick: world.tick });
}

/** A barrel or fire bomb hit the ground. Returns true if it took care of it. */
export function barrelHit(world: World, it: Item): boolean {
  if (it.def.flames) {
    firebombHit(world, it);
    return true;
  }
  if (it.def.barrel) {
    ejectBarrel(world, it);
    return false;
  }
  return false;
}

/** Double dig with a barrel: empty it out (Activate). */
export function useBarrel(world: World, c: Clonk): boolean {
  const it = c.carrying;
  if (!it?.def.barrel) return false;
  if (!ejectBarrel(world, it)) world.say(c.owner, 'The barrel is empty');
  return true;
}
