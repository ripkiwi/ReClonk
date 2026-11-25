// Loam and metal bridges, chunks dug out of veins, and what the material items
// do: earth and concrete break where they land, ice melts, gunpowder blows up.
// From the original's Items.c4d/Materials.c4d scripts (Loam.c4d, Metal.c4d,
// Earth.c4d, Concrete.c4d, Ice.c4d, Snowball.c4d), Gunpowder.c4d and the
// engine's C4Object::DigOutMaterialCast (Clonk Rage, see licenses/).

import { oilBarrelBlown } from './barrels';
import { MATERIALS, Mat } from '../landscape/materials';
import { Clonk, type ControlState } from '../objects/clonk';
import type { Item } from '../objects/item';
import { incinerate } from './fire';
import { menuMove } from './menus';
import type { World } from './world';

/** Ice and snowballs check the temperature this often (DefCore Timer). */
const MELT_INTERVAL = 35;
/** What melting takes off each time (DoCon(-2)), out of 100000. */
const MELT_CON = 2000;
/** Water drops a melting piece of ice gives off each time (CastPXS("Water", 4, 0)). */
const MELT_WATER = 4;
/** Digging drops its chunks this often (the engine's Tick5). */
export const DIG_OUT_INTERVAL = 5;

type Dir = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

/** One choice in the loam menu: a bridge or a wall, which way, and its arrow in LoamArrows.png. */
export interface BridgeChoice {
  caption: string;
  dir: Dir;
  wall: boolean;
  /** Frame in the arrows picture (64 px wide each). */
  frame: number;
}

const L: Dir = { x: -1, y: 0 };
const UL: Dir = { x: -1, y: -1 };
const U: Dir = { x: 0, y: -1 };
const UR: Dir = { x: 1, y: -1 };
const R: Dir = { x: 1, y: 0 };

/** The loam menu in the original's order (Loam.c4d Activate): walls and roofs on top, bridges below. */
export const BRIDGE_MENU: readonly BridgeChoice[] = [
  { caption: 'Wall left', dir: L, wall: true, frame: 5 },
  { caption: 'Roof diagonal left', dir: UL, wall: true, frame: 6 },
  { caption: 'Roof center', dir: U, wall: true, frame: 7 },
  { caption: 'Roof diagonal right', dir: UR, wall: true, frame: 8 },
  { caption: 'Wall right', dir: R, wall: true, frame: 9 },
  { caption: 'Bridge left', dir: L, wall: false, frame: 0 },
  { caption: 'Diagonal left', dir: UL, wall: false, frame: 1 },
  { caption: 'Wall center', dir: U, wall: false, frame: 2 },
  { caption: 'Diagonal right', dir: UR, wall: false, frame: 3 },
  { caption: 'Bridge right', dir: R, wall: false, frame: 4 },
];
/** The menu opens on the straight-up one (SelectMenuItem(7)). */
export const BRIDGE_MENU_START = 7;

/** Pictures of the loam menu (Loam.c4d/Menu.c4d), loaded with the other pictures. */
export const BRIDGE_MENU_GRAPHICS = { arrows: 'items/LoamArrows.png', symbol: 'items/LoamSymbol.png' };

/** Only standing out in the open (Loam.c4d CanBridgeHere). */
function canBridgeHere(c: Clonk): boolean {
  return c.action.procedure === 'walk' && !c.contained;
}

/**
 * The No metal in front of buildings rule (Metal.c4d RuleNoStructure): no
 * metal bridge where an enemy's building is.
 */
function noMetalHere(world: World, c: Clonk): boolean {
  if (!world.rules.has('noMetalTrick')) return false;
  return world.structures.some((s) => !s.gone && s.owner >= 0 && world.hostile(s.owner, c.owner) && s.inside(c.x, c.y + 1));
}

/**
 * Double dig with loam or metal (Loam.c4d Activate): the clonk stops and
 * the menu of bridges and walls opens. Returns false if it carries neither.
 */
export function openBridgeMenu(world: World, c: Clonk): boolean {
  const item = c.carrying;
  if (item?.def.bridge === undefined) return false;
  if (c.action.procedure === 'dig') c.setAction('Walk', 0, 0);
  c.comDir = { x: 0, y: 0 };
  c.xdir = 0;
  if (item.def.id === 'metal' && noMetalHere(world, c)) {
    world.say(c.owner, 'No bridge allowed here');
    return true;
  }
  if (!canBridgeHere(c)) {
    world.say(c.owner, `${c.info?.name ?? 'Clonk'} can't build here.`);
    return true;
  }
  c.bridgeMenu = BRIDGE_MENU_START;
  return true;
}

/** The loam menu is open: move the selection, throw to build, dig to close it. */
export function bridgeMenuControl(world: World, c: Clonk, ctl: ControlState): void {
  const i = menuMove(c.bridgeMenu ?? BRIDGE_MENU_START, BRIDGE_MENU.length, ctl);
  c.bridgeMenu = i;
  if (ctl.pressedThrow) {
    c.bridgeMenu = null;
    startBridge(world, c, BRIDGE_MENU[i]);
  } else if (ctl.pressedDig) c.bridgeMenu = null;
}

/** Close the menu once the clonk does something else or lets go of the loam. */
export function checkBridgeMenu(c: Clonk): void {
  if (c.bridgeMenu !== null && (c.action.procedure !== 'walk' || c.carrying?.def.bridge === undefined)) c.bridgeMenu = null;
}

/** Use up the loam (or metal) and start building (Loam.c4d StartBridge). */
export function startBridge(world: World, c: Clonk, choice: BridgeChoice, alternate = false): boolean {
  const item = c.carrying;
  const mat = item?.def.bridge;
  if (!item || mat === undefined) return false;
  if (!canBridgeHere(c)) {
    world.say(c.owner, `${c.info?.name ?? 'Clonk'} can't build here.`);
    return false;
  }
  c.contents.splice(c.contents.indexOf(item), 1);
  item.removed = true;
  item.container = null;
  c.startBridge(choice.dir, choice.wall, mat, alternate);
  world.events.push({ type: 'bridge', clonk: c, tick: world.tick });
  return true;
}

/**
 * Every 5 ticks a digging clonk drops a chunk of each material it has dug
 * enough of (C4Object::DigOutMaterialCast): coal and sulphur always, earth,
 * sand, ashes, ice and snow only on request (dig again while digging).
 * Snowballs need the Snowballs rule. What's dug beyond one chunk is lost.
 */
export function digOut(world: World, c: Clonk): void {
  if (c.dug.size === 0) return;
  for (const [mat, amount] of c.dug) {
    const m = MATERIALS[mat];
    if (!m.dig2Object || !m.dig2ObjectRatio) continue;
    if (m.dig2ObjectRequest && !c.digRequest) continue;
    if (amount < m.dig2ObjectRatio) continue;
    c.dug.set(mat, 0);
    // Snowball.c4d Construction: dug out without the rule, it's gone straight away.
    if (m.dig2Object === 'snowball' && !world.rules.has('snowballs')) continue;
    // At the clonk's feet; nudged up out of the ground like Coal.c4d Initialize.
    let y = c.y + 8;
    for (let k = 0; k < 12 && world.land.isSolid(c.x, y); k++) y--;
    const item = world.spawnItem(m.dig2Object, c.x, y, 0, 0, 0);
    item.r = world.rng.int(360);
  }
}

/** It landed hard: earth, sand, ashes, snow, concrete and liquid granite burst into loose pixels (Hit: CastPXS). */
export function breakApart(world: World, item: Item): boolean {
  const b = item.def.breaksInto;
  if (!b || item.removed) return false;
  item.removed = true;
  const n = Math.max(1, Math.round((b.amount * item.con) / 100000));
  for (let i = 0; i < n; i++) {
    const xdir = (world.rng.int(b.level + 1) - Math.trunc(b.level / 2)) / 10;
    const ydir = (world.rng.int(b.level + 1) - b.level) / 10;
    world.land.pxs.create(b.mat, item.x, item.y - 1, xdir, ydir);
  }
  world.events.push({ type: 'itemBreak', item, tick: world.tick });
  return true;
}

/**
 * The shock wave of a blast sets loose gunpowder within its reach alight
 * (Gunpowder.c4d OnShockwaveHit), and the fire soon blows it up.
 */
export function shockwaveHits(world: World, x: number, y: number, level: number, by: Clonk | null): void {
  for (const item of world.items) {
    if (item.removed || item.container || !item.def.explodeOnDamage) continue;
    if (Math.abs(item.x - x) <= level && Math.abs(item.y - y) <= level) incinerate(world, item, by);
  }
}

/** Who to credit with a gunpowder blast: whoever lit it, else whoever threw it. */
function culprit(world: World, item: Item): Clonk | null {
  const id = item.fire && item.fire.by >= 0 ? item.fire.by : item.thrownBy;
  return id < 0 ? null : (world.clonks.find((c) => c.id === id) ?? null);
}

/**
 * Each tick: ice and snowballs melt when it's warm (Ice.c4d CheckTemp),
 * gunpowder that has taken damage from a fire or a blast blows up
 * (Gunpowder.c4d Damage), unless a clonk holds it: then the fire goes out.
 */
export function stepMaterialItems(world: World): void {
  const melt = world.tick % MELT_INTERVAL === 0 && (world.weather?.temperature ?? 0) > 0;
  for (const item of world.items) {
    if (item.removed) continue;
    const def = item.def;
    if (melt && def.melts) {
      item.con -= MELT_CON;
      if (!item.container) for (let i = 0; i < MELT_WATER; i++) world.land.pxs.create(Mat.Water, item.x, item.y, 0, 0);
      if (item.con <= 0) removeItem(item);
    }
    if (def.explodeOnDamage && (item.damage > 0 || item.fire)) {
      if (item.container instanceof Clonk) {
        item.fire = null;
        item.damage = 0;
        continue;
      }
      if (item.damage <= 0 || item.container) continue;
      removeItem(item);
      // An oil barrel's empty barrel flies off (OilBarrel Damaged).
      if (def.barrel) oilBarrelBlown(world, item);
      world.explode(item.x, item.y, def.explodeOnDamage, culprit(world, item));
    }
  }
}

function removeItem(item: Item): void {
  item.removed = true;
  const holder = item.container;
  if (holder && 'contents' in holder) {
    const list = holder.contents as Item[];
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
  }
  item.container = null;
}
