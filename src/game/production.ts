// Production: the foundry, the sawmill, the workshop, the chemical plant and
// the anvil, ported from the original content (Structures.c4d: Foundry,
// Sawmill, Workshop, Chemical, Anvil) and the engine's building of objects
// inside a building (C4Object::Build, DFA_BUILD). See
// licenses/clonk_engine_license.txt.

import type { ItemId } from '../landscape/materials';
import type { Clonk, ControlState } from '../objects/clonk';
import { CLONK, ITEMS } from '../objects/defs';
import type { Item } from '../objects/item';
import type { Plant } from '../objects/vegetation';
import { Structure } from '../objects/structure';
import { VEHICLES, type VehicleId } from '../objects/vehicle';
import { contactCheck } from '../objects/physics';
import { menuMove } from './menus';
import { ejectItem, energyCheck, powerPlantBuilt, productionSound, usePower, useUp } from './power';
import type { World } from './world';

export type Producer = 'workshop' | 'chemicalPlant' | 'anvil';

/** Something a building can make: what it's made of and how heavy it is (DefCore Components, Mass). */
export interface ProductDef {
  id: ItemId | VehicleId;
  mass: number;
  components: Partial<Record<ItemId, number>>;
  at: Producer;
}

const product = (id: ItemId | VehicleId, mass: number, components: Partial<Record<ItemId, number>>, at: Producer): ProductDef => ({ id, mass, components, at });

/**
 * What the workshop (the vehicles you know), the chemical plant
 * (IsChemicalProduct) and the anvil (IsAnvilProduct) make, in the original's
 * definition order, with the original's masses and components.
 */
export const PRODUCTS: readonly ProductDef[] = [
  product('catapult', 60, { wood: 3, metal: 1 }, 'workshop'),
  product('sub', 100, { metal: 10 }, 'workshop'),
  product('boat', 50, { wood: 3 }, 'workshop'),
  product('cannon', 110, { metal: 3 }, 'workshop'),
  product('crossbow', 60, { wood: 3, metal: 1 }, 'workshop'),
  product('balloon', 45, { wood: 5, metal: 1 }, 'workshop'),
  product('lorry', 75, { metal: 2 }, 'workshop'),
  product('blimp', 80, { wood: 8, metal: 6 }, 'workshop'),
  product('engine', 50, { metal: 4 }, 'workshop'),
  product('wagon', 150, { wood: 3, metal: 2 }, 'workshop'),
  product('bridge', 100, { wood: 2 }, 'workshop'),
  product('towerCannon', 80, { metal: 3, wood: 2 }, 'workshop'),
  product('artillery', 150, { metal: 5, wood: 4 }, 'workshop'),
  product('antiAir', 80, { metal: 2, wood: 3 }, 'workshop'),
  product('flameThrower', 90, { metal: 5, oilBarrel: 1 }, 'workshop'),
  product('lightningCannon', 150, { metal: 4, wood: 2, crystal: 2 }, 'workshop'),
  product('liquidCannon', 100, { metal: 3, linekit: 1 }, 'workshop'),
  product('flint', 10, { sulphur: 1 }, 'chemicalPlant'),
  product('tflint', 10, { flint: 1, sulphur: 1 }, 'chemicalPlant'),
  product('gunpowder', 5, { coal: 1 }, 'chemicalPlant'),
  product('torpedo', 25, { metal: 1, flint: 1, sulphur: 1 }, 'chemicalPlant'),
  product('firebomb', 12, { flint: 1, oilBarrel: 1 }, 'chemicalPlant'),
  product('munitionPack', 30, { flint: 2, sulphur: 3 }, 'chemicalPlant'),
  product('battery', 30, { metal: 2, crystal: 1, sulphur: 1 }, 'chemicalPlant'),
  product('arrows', 15, { wood: 5, metal: 1 }, 'anvil'),
  product('barrel', 20, { metal: 1 }, 'anvil'),
  product('conkit', 15, { wood: 2, metal: 1 }, 'anvil'),
  product('linekit', 15, { metal: 1 }, 'anvil'),
];

const PRODUCT_BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

export function productDef(id: string): ProductDef | undefined {
  return PRODUCT_BY_ID.get(id as ItemId);
}

export function productName(id: string): string {
  return id in VEHICLES ? VEHICLES[id as VehicleId].name : ITEMS[id as ItemId].name;
}

/** The whole of a thing (FullCon). */
const FULL = 100000;

export const PRODUCTION = {
  /** Inside a building a clonk builds at level 1: 1 * 100 * 150 / mass con a tick (C4Object::Build, iLevel 1 for internal builds). */
  buildRate: 15000,
  /** The workshop's and chemical plant's Build action uses 500 power a tick. */
  buildUsage: 500,
  /** The sawmill needs 25 points of power to start (EnergyCheck(25000)), and 500 a tick while it saws for 35 ticks. */
  saw: { start: 25000, usage: 500, ticks: 35, out: { x: -20, y: 14 } },
  /** The foundry burns ore with its fuel for 150 ticks; metal comes out at -27, +13. */
  foundry: { ticks: 150, out: { x: -27, y: 13 } },
  /** The anvil forges for 150 ticks (Forging); it takes at most 10 things (CollectionLimit). */
  anvil: { ticks: 150, limit: 10, effects: 21 },
  /** Both look at what's in them every 35 ticks (ContentsCheck). */
  checkInterval: 35,
};

/** What this building makes, for the menu: the ones the scenario's construction plans allow (all if it names none). */
export function productsOf(world: World, at: string): ProductDef[] {
  const named = world.knowledge.filter((k) => PRODUCT_BY_ID.has(k as ItemId));
  return PRODUCTS.filter((p) => p.at === at && (!named.length || named.includes(p.id)));
}

/** "2 metal, 1 wood": what a list of components reads like. */
export function componentText(c: Partial<Record<ItemId, number>>): string {
  return (Object.entries(c) as [ItemId, number][]).map(([id, n]) => `${n} ${ITEMS[id].name.toLowerCase()}`).join(', ');
}

function take(world: World, from: Item[], id: ItemId): Item | null {
  const it = from.find((o) => o.def.id === id && !o.fire);
  if (!it) return null;
  from.splice(from.indexOf(it), 1);
  it.container = null;
  it.removed = true;
  world.items = world.items.filter((o) => o !== it);
  return it;
}

// ------------------------------------------------------------------ workshop and chemical plant

/**
 * Pick something to make (Workshop.c4d SelectProduction, StartProduction):
 * an unfinished one of it is taken up again, otherwise a new one is begun,
 * and the clonk sets to work on it.
 */
export function startProduction(world: World, c: Clonk, s: Structure, id: string): void {
  const p = productDef(id);
  if (!p || !s.complete) return;
  if (!s.products.some((o) => o.id === id)) s.products.push({ id, con: 0, got: {} });
  c.producing = id;
  world.say(c.owner, `Construction: ${productName(id)}`);
}

/**
 * One tick of a clonk's work on a product (C4Object::Build from inside):
 * it takes what's still missing from its hands and the building, a piece of
 * each kind at a time, and goes on as long as there's enough for how far
 * the thing is built. Short of something, it says what and stops.
 */
function buildProduct(world: World, s: Structure, c: Clonk): void {
  const id = c.producing!;
  const p = productDef(id)!;
  const job = s.products.find((o) => o.id === id);
  if (!job) {
    c.producing = null;
    return;
  }
  for (const [mat, need] of Object.entries(p.components) as [ItemId, number][]) {
    if ((job.got[mat] ?? 0) >= need) continue;
    if (take(world, c.contents, mat) ?? take(world, s.contents, mat)) job.got[mat] = (job.got[mat] ?? 0) + 1;
  }
  const missing: Partial<Record<ItemId, number>> = {};
  let short = false;
  for (const [mat, need] of Object.entries(p.components) as [ItemId, number][]) {
    const got = job.got[mat] ?? 0;
    if ((100 * got) / need < (100 * job.con) / FULL) short = true;
    if (got < need) missing[mat] = need - got;
  }
  if (short) {
    world.say(c.owner, `${productName(id)} needs: ${componentText(missing)}`);
    productionSound(world, 'Error', s.x, s.y);
    c.producing = null;
    return;
  }
  job.con = Math.min(FULL, job.con + Math.trunc(PRODUCTION.buildRate / p.mass));
  if (job.con < FULL) return;
  s.products.splice(s.products.indexOf(job), 1);
  c.producing = null;
  finish(world, s, c, id);
}

/** A finished product: a thing stays in the building, a vehicle rolls out of the door (C4CMD_Activate). */
function finish(world: World, s: Structure, c: Clonk, id: string): void {
  world.say(c.owner, `${productName(id)} is ready`);
  world.events.push({ type: 'built', structure: s, tick: world.tick });
  if (id in VEHICLES) {
    const def = VEHICLES[id as VehicleId];
    const at = s.exitPoint();
    const bottom = Math.max(...def.vertices.map((v) => v.y));
    const v = world.addVehicle(id as VehicleId, at.x, at.y + 9 - bottom, c.owner);
    for (let up = 1; up <= def.height && contactCheck(world.land, v.vertices, v.x, v.y).count; up++) v.setPosition(v.x, v.y - 1);
    s.openDoor();
    return;
  }
  const it = world.spawnItem(id as ItemId, s.x, s.y);
  it.owner = c.owner;
  world.store(s, it);
}

/**
 * The workshop and chemical plant (CheckBuild): while someone works inside,
 * the building's Build action runs, using 500 power a tick, and only then
 * does the work go on. Smoke comes out of the chimney.
 */
function stepWorkshop(world: World, s: Structure): void {
  const workers = world.clonks.filter((c) => c.contained === s && c.alive && c.producing);
  if (!workers.length) {
    if (s.activity === 'build') {
      s.activity = null;
      energyCheck(world, s, 0);
    }
    return;
  }
  s.activity = 'build';
  if (!usePower(world, s, PRODUCTION.buildUsage)) return;
  s.actTime++;
  const chem = s.def.id === 'chemicalPlant';
  if (chem) {
    if (s.actTime % 8 === 0) {
      if (world.rng.int(2)) smoke(world, s, 7, -27, 8);
      smoke(world, s, -5, -28, 5 + world.rng.int(3));
    }
  } else {
    if (s.actTime % 4 === 0) s.phase = (s.phase + 1) % 20;
    if (s.actTime % 12 === 0) {
      if (world.rng.int(6)) smoke(world, s, 16, -20, 8);
      if (world.rng.int(8)) smoke(world, s, 10, -24, 5 + world.rng.int(3));
    }
  }
  if (s.actTime % 36 === 0) productionSound(world, 'Gear', s.x, s.y);
  for (const c of workers) buildProduct(world, s, c);
}

function smoke(world: World, s: Structure, x: number, y: number, size: number): void {
  world.events.push({ type: 'smoke', x: s.x + x, y: s.y + y, size, tick: world.tick });
}

// ------------------------------------------------------------------ foundry

const FOUNDRY_RAW = new Set<ItemId>(['coal', 'oilBarrel', 'wood', 'ore']);

/**
 * Foundry.c4d: every 35 ticks while it's cold, it puts out what isn't ore or
 * fuel. With ore inside it burns two pieces of wood, an oil barrel or a
 * piece of coal, and 150 ticks later a piece of ore comes out as metal.
 * It needs no power.
 */
function stepFoundry(world: World, s: Structure): void {
  const k = PRODUCTION.foundry;
  if (s.activity === 'burn') {
    s.actTime++;
    s.phase = s.actTime % 8;
    if (s.actTime % 8 === 1) smoke(world, s, 23, -24 + world.rng.int(3), 8 + world.rng.int(5));
    if (s.actTime < k.ticks) return;
    s.activity = null;
    s.actTime = 0;
    const ore = s.contents.find((o) => o.def.id === 'ore');
    if (!ore) return;
    useUp(s, 'ore');
    const metal = world.spawnItem('metal', s.x + k.out.x, s.y + k.out.y);
    metal.ydir = -1;
    productionSound(world, 'Pshshsh', s.x, s.y);
    return;
  }
  if ((world.tick + s.x) % PRODUCTION.checkInterval !== 0) return;
  const first = s.contents[0];
  if (first && !FOUNDRY_RAW.has(first.def.id)) ejectItem(s, first, first.def.barrel ? undefined : k.out);
  if (!s.contents.some((o) => o.def.id === 'ore')) return;
  const count = (id: ItemId): number => s.contents.filter((o) => o.def.id === id).length;
  if (count('wood') > 1) useUp(s, 'wood', 2);
  else if (count('oilBarrel')) {
    const b = s.contents.find((o) => o.def.id === 'oilBarrel')!;
    b.def = ITEMS.barrel;
    b.fill = 0;
  } else if (count('coal')) useUp(s, 'coal');
  else return;
  s.activity = 'burn';
  s.actTime = 0;
}

// ------------------------------------------------------------------ sawmill

/** Vehicles made of wood only (ComponentAll WOOD): the sawmill cuts them up. */
const WOODEN: Partial<Record<VehicleId, number>> = { boat: 3, bridge: 2 };

/**
 * Sawmill.c4d ContentsCheck, every 35 ticks while it's idle: with 25 points
 * of power (if power is needed), it cuts a felled tree, or a vehicle made of
 * wood only, into its wood, and saws for 35 ticks, using 500 power a tick.
 * Each round of sawing a piece of wood comes out at -20, +14. Anything else
 * it puts out.
 */
function stepSawmill(world: World, s: Structure): void {
  const k = PRODUCTION.saw;
  if (s.activity === 'saw') {
    if (!usePower(world, s, k.usage)) return;
    s.actTime++;
    s.phase = s.actTime % 10;
    if (world.rng.int(5) === 0) world.events.push({ type: 'dust', x: s.x - 23, y: s.y + 6, tick: world.tick });
    if (s.actTime < k.ticks) return;
    s.activity = null;
    s.actTime = 0;
    const wood = s.contents.find((o) => o.def.id === 'wood');
    if (wood) ejectItem(s, wood, k.out);
    return;
  }
  if ((world.tick + s.x) % PRODUCTION.checkInterval !== 0) return;
  energyCheck(world, s, 0);
  const vehicle = world.vehicles.find((v) => v.contained === s && !v.removed && !v.mountedOn);
  const first = s.contents[0];
  if (!s.logs.length && !first && !vehicle) return;
  if (!energyCheck(world, s, k.start)) return;
  if (s.logs.length) {
    const n = s.logs.shift()!;
    for (let i = 0; i < n; i++) world.store(s, world.spawnItem('wood', s.x, s.y));
  } else if (vehicle && WOODEN[vehicle.def.id]) {
    const n = WOODEN[vehicle.def.id]!;
    for (const c of world.clonks) if (c.vehicle === vehicle) c.letGo();
    world.removeVehicle(vehicle);
    for (let i = 0; i < n; i++) world.store(s, world.spawnItem('wood', s.x, s.y));
  } else if (first && first.def.id !== 'wood') {
    ejectItem(s, first, first.def.barrel ? undefined : k.out);
    return;
  } else if (!first) return;
  s.activity = 'saw';
  s.actTime = 0;
  productionSound(world, 'Sawmill', s.x, s.y);
}

/**
 * A clonk dragging a felled tree pushes it in at a sawmill's door (the
 * Production command's PushTo): the sawmill takes the tree and its wood.
 * Returns false if it isn't at a sawmill.
 */
export function pushTreeIn(world: World, c: Clonk): boolean {
  const p = c.dragging;
  if (!p) return false;
  const s = world.structures.find((o) => o.def.id === 'sawmill' && (o.atEntrance(c.x, c.y) || o.atEntrance(p.pivot.x, p.pivot.y)));
  if (!s) return false;
  if (s.base >= 0 && world.hostile(s.base, c.owner)) return false;
  s.logs.push(Math.max(1, p.wood));
  p.removed = true;
  c.letGo();
  s.openDoor();
  productionSound(world, 'Clonk', s.x, s.y);
  world.say(c.owner, 'The tree goes into the sawmill');
  return true;
}

/** Start dragging a felled tree the clonk stands at (grab it: the Push action). */
export function grabTree(world: World, c: Clonk): boolean {
  const p = world.plants.find((o) => !o.removed && o.state === 'fallen' && o.def.chop && !o.fire && o.isAt(c.x, c.y));
  if (!p || world.clonks.some((o) => o.dragging === p)) return false;
  c.startPush(null);
  c.dragging = p;
  c.dragFrom = { x: p.x - c.x, y: p.bottom - c.y };
  world.events.push({ type: 'grab', x: c.x, y: c.y, tick: world.tick });
  return true;
}

/** The dragged tree follows the clonk (a pushed object moves with its pusher). */
export function dragTree(c: Clonk): void {
  const p: Plant | null = c.dragging;
  if (!p || !c.dragFrom) return;
  p.x = Math.round(c.x + c.dragFrom.x);
  p.bottom = Math.round(c.y + c.dragFrom.y);
}

// ------------------------------------------------------------------ anvil

/**
 * Controls for a clonk holding on to an anvil (GrabPutGet): throw puts what
 * it carries on the anvil, dig opens the menu of what it can forge (the
 * original's double dig). Returns true if it took the keys.
 */
export function anvilControl(world: World, c: Clonk, s: Structure, ctl: ControlState): boolean {
  if (s.def.id !== 'anvil') return false;
  if (c.forgeMenu !== null) {
    const list = productsOf(world, 'anvil');
    c.forgeMenu = menuMove(c.forgeMenu, list.length, ctl);
    if (ctl.pressedDig) c.forgeMenu = null;
    else if (ctl.pressedThrow && list.length) {
      const id = list[c.forgeMenu].id;
      c.forgeMenu = null;
      forge(world, c, s, id);
    }
    return true;
  }
  if (ctl.pressedThrow) {
    const it = c.carrying;
    if (!it) return true;
    if (s.contents.length >= PRODUCTION.anvil.limit) {
      world.say(c.owner, 'The anvil is full');
      return true;
    }
    c.contents.splice(c.contents.indexOf(it), 1);
    world.store(s, it);
    productionSound(world, 'Clonk', s.x, s.y);
    return true;
  }
  if (ctl.pressedDig || ctl.pressedUse) {
    if (!s.complete) return true;
    if (s.activity) {
      world.say(c.owner, 'The anvil is in use');
      return true;
    }
    c.forgeMenu = 0;
    return true;
  }
  if (ctl.pressedUp) {
    // Take back what's on it, the last thing first.
    const it = s.contents[s.contents.length - 1];
    if (!it || c.contents.length >= CLONK.maxContents) return true;
    s.contents.pop();
    it.container = c;
    c.contents.push(it);
    world.events.push({ type: 'collect', clonk: c, item: it, tick: world.tick });
    return true;
  }
  return false;
}

/**
 * Anvil.c4d ProductionStart: with everything the thing is made of on the
 * anvil (or in the clonk's hands), the clonk steps in and forges for 150
 * ticks; then the thing comes out. Short of something, it says what.
 */
export function forge(world: World, c: Clonk, s: Structure, id: string): void {
  const p = productDef(id);
  if (!p) return;
  const pool = [...s.contents, ...c.contents];
  const missing: Partial<Record<ItemId, number>> = {};
  for (const [mat, need] of Object.entries(p.components) as [ItemId, number][]) {
    const have = pool.filter((o) => o.def.id === mat).length;
    if (have < need) missing[mat] = need - have;
  }
  if (Object.keys(missing).length) {
    world.say(c.owner, `${productName(id)} needs: ${componentText(missing)}`);
    productionSound(world, 'Error', s.x, s.y);
    return;
  }
  for (const [mat, need] of Object.entries(p.components) as [ItemId, number][]) {
    for (let i = 0; i < need; i++) take(world, s.contents, mat) ?? take(world, c.contents, mat);
  }
  s.forging = id;
  s.activity = 'forge';
  s.actTime = 0;
  s.owner = c.owner;
  c.letGo();
  world.enter(c, s);
}

/** Forging: sparks and the sound of the hammer, until the thing is done and the clonk comes out again. */
function stepAnvil(world: World, s: Structure): void {
  if (s.activity !== 'forge') return;
  s.actTime++;
  s.phase = Math.trunc(s.actTime / 3) % 7;
  if (s.actTime % PRODUCTION.anvil.effects === 0) {
    productionSound(world, 'AnvilWork', s.x, s.y);
    world.events.push({ type: 'sparks', x: s.x, y: s.y, tick: world.tick });
  }
  if (s.actTime < PRODUCTION.anvil.ticks) return;
  const id = s.forging;
  cancelForge(world, s);
  if (!id) return;
  const it = world.spawnItem(id as ItemId, s.x, s.y - 4, 0, -1);
  it.owner = s.owner;
  it.noCollect = 10;
}

/** ProductionCancel: the work stops and the clonk comes out. */
export function cancelForge(world: World, s: Structure): void {
  s.activity = null;
  s.forging = null;
  s.actTime = 0;
  for (const c of world.clonks) if (c.contained === s) world.exitTo(c, s.x, s.y + 1);
}

// ------------------------------------------------------------------ the building's turn

/** Each tick: every production building does its work. */
export function stepProduction(world: World): void {
  for (const s of world.structures) {
    if (s.gone || !s.complete) continue;
    switch (s.def.id) {
      case 'workshop':
      case 'chemicalPlant':
        stepWorkshop(world, s);
        break;
      case 'foundry':
        stepFoundry(world, s);
        break;
      case 'sawmill':
        stepSawmill(world, s);
        break;
      case 'anvil':
        stepAnvil(world, s);
        break;
    }
  }
}

/** A building was just finished: the power plant gets its coal (Initialize). */
export function buildingFinished(world: World, s: Structure): void {
  powerPlantBuilt(world, s);
}

/** Inside a workshop or chemical plant, up opens the production menu. Returns true if this is one. */
export function isFactory(s: Structure): boolean {
  return s.def.id === 'workshop' || s.def.id === 'chemicalPlant';
}

