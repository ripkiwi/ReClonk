// Fire, like the original's (C4Object::Incinerate, ExecFire, Extinguish and
// Blast; FnFxFireStart in C4Effect.cpp; C4GameObjects::CrossCheck). Trees,
// bushes, wood, clonks and buildings catch fire from blasts and from burning
// things that touch them; water and a clonk's home base put it out.
// See licenses/clonk_engine_license.txt.

import { MATERIALS } from '../landscape/materials';
import { Clonk } from '../objects/clonk';
import { CLONK, CONSTRUCTION } from '../objects/defs';
import { FIRE } from '../objects/fire';
import { Item } from '../objects/item';
import { Structure } from '../objects/structure';
import { Plant } from '../objects/vegetation';
import { Vehicle } from '../objects/vehicle';
import type { World } from './world';

export type Burnable = Clonk | Item | Plant | Structure | Vehicle;

/** Every 35 ticks burning things set fire to what they touch. */
export const FIRE_SPREAD_INTERVAL = FIRE.contactInterval;

/** Where it is, for water and contact checks: its centre, or the centre of whatever it's in. */
export function fireCenter(o: Burnable): { x: number; y: number } {
  if (o instanceof Plant) return o.center;
  if (o instanceof Clonk && o.contained) return { x: o.contained.x, y: o.contained.y };
  if (o instanceof Item && o.container) return fireCenter(o.container as Clonk);
  if (o instanceof Structure) return { x: o.x, y: structureShape(o).y };
  return { x: o.x, y: o.y };
}

/**
 * A building's shape as it burns down (or is still being built): the original
 * shrinks it from the top and keeps its bottom where it was (C4Shape::Jolt and
 * the bottom y-adjust in C4Object::DoCon), so its centre sinks towards the
 * ground. A shape is never less than 18 pixels tall when something checks
 * what's at a point (C4Object::At, addtop).
 */
export function structureShape(s: Structure): { y: number; top: number; height: number } {
  const d = s.def;
  const pct = Math.trunc((s.con * 100) / CONSTRUCTION.fullCon);
  if (pct >= 100) return { y: s.y, top: s.top, height: d.height };
  const height = Math.trunc((d.height * pct) / 100);
  const offY = Math.trunc((d.offset.y * pct) / 100);
  const y = s.top + d.height - height - offY;
  const addTop = Math.max(18 - height, 0);
  return { y, top: y + offY - addTop, height: height + addTop };
}

/** Is the point inside its shape? */
export function contains(o: Burnable, px: number, py: number): boolean {
  if (o instanceof Plant) return o.contains(px, py);
  if (o instanceof Structure) {
    if (o.gone || px < o.left || px >= o.left + o.def.width) return false;
    const sh = structureShape(o);
    return py >= sh.top && py < sh.top + sh.height;
  }
  if (o instanceof Vehicle) return o.inside(px, py);
  const w = o instanceof Clonk ? CLONK.width : o.def.graphic.facet.w;
  const h = o instanceof Clonk ? CLONK.height : o.def.graphic.facet.h;
  const dx = px - (o.x - Math.floor(w / 2));
  const dy = py - (o.y - Math.floor(h / 2));
  return dx >= 0 && dx < w && dy >= 0 && dy < h;
}

/** One time in how many a burning thing touching it sets it alight (0: never). */
export function contactIncinerate(o: Burnable): number {
  if (o instanceof Clonk) return FIRE.clonkContact;
  if (o instanceof Item) return o.def.contactIncinerate ?? 0;
  if (o instanceof Plant) return o.def.contactIncinerate;
  if (o instanceof Vehicle) return o.burned ? o.def.burned.contactIncinerate : o.def.contactIncinerate;
  return (o.burned ? o.def.burned.contactIncinerate : o.def.contactIncinerate) ?? 0;
}

/** Blast damage it takes to set it alight (0: blasts don't). */
export function blastIncinerate(o: Burnable): number {
  if (o instanceof Clonk) return 0;
  if (o instanceof Item) return o.def.blastIncinerate ?? 0;
  if (o instanceof Plant) return o.def.blastIncinerate;
  if (o instanceof Vehicle) return o.burned ? o.def.burned.blastIncinerate : o.def.blastIncinerate;
  return o.burned ? o.def.burned.blastIncinerate : o.def.blastIncinerate;
}

/** Its shape, for the whoosh: things over 500 square pixels catch fire loudly. */
function area(o: Burnable): number {
  if (o instanceof Clonk) return CLONK.width * CLONK.height;
  if (o instanceof Item) return o.def.graphic.facet.w * o.def.graphic.facet.h;
  if (o instanceof Plant) return o.def.width * o.def.height;
  return o.def.width * o.def.height;
}

/** In water, or anything else that puts fires out (the material's Extinguisher). */
function inWater(world: World, o: Burnable): boolean {
  const p = fireCenter(o);
  return !!MATERIALS[world.land.get(Math.round(p.x), Math.round(p.y))].extinguisher;
}

/**
 * Set it alight (C4Object::Incinerate, FnFxFireStart). Living things only
 * burn while they're alive. In water nothing catches fire, but a blast still
 * turns it into its burned self. Trees turn into dead trees, buildings into
 * burned ones: their flag falls off (a loose flag anyone can take), everyone inside comes out, and lifts and
 * gates are gone. Returns false if it didn't catch fire.
 */
export function incinerate(world: World, o: Burnable, by: Clonk | null, blasted = false): boolean {
  if (o.fire || o.removed || (o instanceof Clonk && !o.alive) || (o instanceof Structure && o.gone)) return false;
  const wet = inWater(world, o);
  if (wet && !blasted) return false;
  burnTo(world, o);
  if (wet) return false;
  o.fire = { by: by?.id ?? -1, since: world.tick };
  const p = fireCenter(o);
  world.events.push({ type: 'inflame', x: p.x, y: p.y, loud: area(o) > FIRE.inflameArea, tick: world.tick });
  return true;
}

/** Turn it into its burned self (DefCore BurnTo; Wood.c4d Incineration darkens wood). */
function burnTo(world: World, o: Burnable): void {
  if (o instanceof Plant) o.burned = true;
  else if (o instanceof Item) o.burned = o.burned || !!o.def.contactIncinerate;
  else if (o instanceof Structure && !o.burned) burnStructure(world, o);
  else if (o instanceof Vehicle && !o.burned) burnVehicle(world, o);
}

/**
 * A vehicle becomes its burned self (BurnTo): no floor, nothing to steer,
 * whoever held on lets go. A burned balloon or blimp falls out of the sky.
 */
function burnVehicle(world: World, v: Vehicle): void {
  v.burned = true;
  v.mask?.remove(world.land);
  v.mask = null;
  v.comDir = { x: 0, y: 0 };
  v.windX = v.windY = v.clearX = v.clearY = false;
  for (const c of world.clonks) if (c.vehicle === v) c.letGo();
}

/**
 * A building becomes its burned ruin (ChangeDef to BurnTo, then FnFxFireStart
 * ejects contents and detaches attached objects): no door, no solid parts, no
 * elevator case or gates, and the flag falls off.
 */
function burnStructure(world: World, s: Structure): void {
  const { land } = world;
  s.burned = true;
  for (const c of world.clonks) {
    if (c.contained === s) world.exit(c);
    if (c.workOn === s) c.letGo();
  }
  s.mask?.remove(land);
  s.mask = null;
  for (const g of s.gates) g.mask.remove(land);
  s.gates = [];
  s.liftCase?.floor.remove(land);
  s.liftCase = null;
  if (s.base >= 0) dropFlag(world, s);
}

/**
 * The flag comes off its building (detached from FlyBase) and falls where it
 * flew. It's a loose flag now: anyone can pick it up and sell it in their own
 * base, or carry it into a building without a flag to make it its owner's base.
 */
export function dropFlag(world: World, s: Structure): Item {
  const flag = world.spawnItem('flag', s.x + s.def.flagVertex.x, s.y + s.def.flagVertex.y, 0, -1);
  flag.owner = s.base;
  s.base = -1;
  return flag;
}

/** A clonk built a burned building back up (ConstructTo): it's the real one again, but without a flag until someone brings one. */
export function rebuilt(s: Structure): void {
  s.burned = false;
  s.fire = null;
  s.damage = 0;
}

/** Put the fire out (C4Object::Extinguish). */
export function extinguish(world: World, o: Burnable, hiss = false): void {
  if (!o.fire) return;
  o.fire = null;
  const p = fireCenter(o);
  world.events.push({ type: 'extinguish', x: p.x, y: p.y, hiss, tick: world.tick });
}

/**
 * A blast hit it directly (C4Object::Blast): it takes the blast's level in
 * damage, and catches fire once the damage reaches its BlastIncinerate.
 */
export function blastBurn(world: World, o: Item | Plant | Structure | Vehicle, level: number, by: Clonk | null): void {
  o.damage += level;
  const at = blastIncinerate(o);
  if (at && o.damage >= at) incinerate(world, o, by, true);
}

/** Everything that can burn, in the order the original checks it. */
function* burnables(world: World): Generator<Burnable> {
  yield* world.clonks;
  yield* world.items;
  yield* world.plants;
  for (const s of world.structures) if (!s.gone) yield s;
  for (const v of world.vehicles) if (!v.removed) yield v;
}

/** One tick of every fire (FnFxFireTimer → C4Object::ExecFire), and every 35 ticks fire spreads. */
export function stepFire(world: World): void {
  const t = world.tick;
  for (const o of burnables(world)) {
    if (o.fire && !o.removed) burn(world, o, t);
  }
  if (t % FIRE.contactInterval === 0) spread(world);
}

function burn(world: World, o: Burnable, t: number): void {
  const fire = o.fire!;
  const by = fire.by < 0 ? null : (world.clonks.find((c) => c.id === fire.by) ?? null);
  // A clonk in a home base is put out (BASEFUNC_Extinguish).
  if (t % FIRE.checkInterval === 0 && o instanceof Clonk && o.contained && o.contained.base >= 0) return extinguish(world, o);
  // Burning away (DoCon(-100)); clonks don't (NoBurnDecay).
  if (!(o instanceof Clonk)) {
    o.con -= FIRE.decay;
    if (o.con <= 0) return burnedAway(world, o);
    // A felled tree has less and less wood in it (ComponentConCutoff).
    if (o instanceof Plant && o.state !== 'standing') o.wood = Math.min(o.wood, o.woodAtCon);
  }
  if (t % FIRE.damageInterval === 0 && !(o instanceof Clonk)) {
    o.damage += FIRE.damage;
    if (o instanceof Plant && o.state === 'standing' && o.damage > o.fellDamage) world.fell(o, world.rng.bool() ? 1 : -1);
  }
  if (t % FIRE.energyInterval === 0 && o instanceof Clonk && o.alive) world.hurt(o, FIRE.energy, by);
  // Water puts it out (the material's Extinguisher).
  if (t % FIRE.checkInterval === 0 && inWater(world, o)) extinguish(world, o, true);
}

/** Nothing left of it (C4Object::DoCon at con 0). */
function burnedAway(world: World, o: Item | Plant | Structure | Vehicle): void {
  o.con = 0;
  o.fire = null;
  if (o instanceof Item) {
    o.removed = true;
    const holder = o.container as Clonk | null;
    if (holder) holder.contents.splice(holder.contents.indexOf(o), 1);
    o.container = null;
  } else if (o instanceof Plant) {
    o.removed = true;
  } else if (o instanceof Vehicle) {
    world.removeVehicle(o);
  } else {
    // The basement it stood on stays.
    o.gone = true;
    for (const c of world.clonks) if (c.workOn === o) c.letGo();
  }
}

/**
 * Every 35 ticks each burning thing that's out in the open sets fire to the
 * first inflammable thing its centre is in, one time in that thing's
 * ContactIncinerate (C4GameObjects::CrossCheck, OCF_OnFire at OCF_Inflammable).
 * So a burning tree lights the trees it reaches into, a burning clonk the
 * tree it runs through, and burning wood the clonk standing over it. A
 * burning building's centre sinks as it burns down, so once it's low enough
 * it lights a clonk standing in the middle of it (a hut after a fifth of it
 * has burned), every time this check comes round.
 */
function spread(world: World): void {
  const all = [...burnables(world)];
  for (const o of all) {
    if (!o.fire || o.removed || isContained(o)) continue;
    const p = fireCenter(o);
    const target = all.find((x) => x !== o && !x.fire && !x.removed && !isContained(x) && contactIncinerate(x) > 0 && contains(x, p.x, p.y));
    if (!target) continue;
    if (world.rng.int(contactIncinerate(target)) !== 0) continue;
    const by = o.fire.by < 0 ? null : (world.clonks.find((c) => c.id === o.fire!.by) ?? null);
    incinerate(world, target, by);
  }
}

function isContained(o: Burnable): boolean {
  if (o instanceof Clonk) return !!o.contained;
  if (o instanceof Item) return !!o.container;
  return false;
}
