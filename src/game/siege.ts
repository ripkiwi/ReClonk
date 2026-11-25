// Siege weapons and the other vehicles that came after the lorry, ported
// from the original content (Objects.c4d/Vehicles.c4d and friends): the
// catapult, the cannon and the crossbow with its arrows, the steam engine
// and its wagon, the submarine and its torpedoes, the chest and the bridge
// segment. The aiming follows the system script's JumpAndRun.c (AimUp,
// AimDown, AimUpdate), the train the engine's PULL procedure (C4Object.cpp).
// See licenses/clonk_engine_license.txt.

import type { ItemId } from '../landscape/materials';
import type { Animal } from '../objects/animal';
import { Clonk, type ControlState } from '../objects/clonk';
import { CLONK, ITEMS } from '../objects/defs';
import type { Item } from '../objects/item';
import { contactCheck, physical, SWIM_ACCEL, WALK_ACCEL } from '../objects/physics';
import { STOP, Vehicle, type Dir } from '../objects/vehicle';
import { contactIncinerate, incinerate } from './fire';
import { checkSignal, engineSteered, signalDelay } from './signals';
import type { World } from './world';

/** Sounds the new vehicles make (Sound.c4g and their own folders). */
export type SiegeSound =
  | 'Catapult' | 'CatapultSet' | 'Connect' | 'Click' | 'Error' | 'Blast2' | 'Blast3' | 'Arrow' | 'ArrowHit'
  | 'Chuff' | 'LineBreak' | 'Submarine' | 'Grapple' | 'Torpedo' | 'Airlock1' | 'Airlock2'
  | 'ChestOpen' | 'ChestClose' | 'SteelGate2' | 'Splash1' | 'CannonRotation' | 'CannonStop' | 'Fusing';

export const SIEGE = {
  /** Ticks between two aiming steps while a jump'n'run key is held (the AimUp/AimDown interval). */
  aimInterval: { catapult: 8, cannon: 4, crossbow: 5 } as Record<string, number>,
  /** The catapult charges back up one frame every 5 ticks (the Charge action's Delay). */
  chargeDelay: 5,
  /** The crossbow's ReloadDelay. */
  reload: 10,
  /** A shot arrow can't hit its shooter for 10 ticks (NoArrowHit). */
  noArrowHit: 10,
  /** An arrow that hit something can't be picked up for 72 ticks (CannotBeCollected). */
  arrowNoCollect: 72,
  /** Most arrows the crossbow takes (its RejectCollect). */
  crossbowArrows: 10,
  /** The steam engine walks at Physical Walk 100000, 70000 while someone holds the train (AdjustTrainSpeed). */
  engineWalk: physical(280, 100000),
  engineHeldWalk: physical(280, 70000),
  /** The engine's pulling force (ValByPhysical(250, Push 100000)). */
  enginePush: physical(250, 100000),
  /** How far away a vehicle can be to be coupled (GrabTarget: ObjectDistance 50). */
  coupleRange: 50,
  /** The submarine swims at Physical Swim 100000 (ValByPhysical(160, Swim)). */
  subSwim: physical(160, 100000),
  /** Its airlock shuts every 35 ticks (TimerCall CloseAirlock, the default Timer). */
  airlockTimer: 35,
  /** The Turn and Grapple actions: 24 and 12 frames of 1 tick. */
  subTurn: 24,
  subGrapple: 12,
  /** The chest opens and closes in 8 frames of 3 ticks. */
  chestFrames: 8,
  chestDelay: 3,
  /** The wagon's door: opening 10, open 20, closing 10 ticks. */
  wagonDoor: { open: 10, wait: 20, close: 10 },
  /** A balloon or blimp hit by an arrow falls for this long (its DropOff action's Delay). */
  dropOff: { balloon: 50, blimp: 60 } as Record<string, number>,
  /** The balloon's and blimp's Collection boxes, where arrows hit them. */
  arrowBox: { balloon: { x: -14, y: -25, w: 30, h: 25 }, blimp: { x: -26, y: -30, w: 50, h: 30 } } as Record<string, { x: number; y: number; w: number; h: number }>,
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const isStop = (d: Dir): boolean => d.x === 0 && d.y === 0;

function sound(world: World, s: SiegeSound, x: number, y: number, smoke = 0): void {
  world.events.push({ type: 'siege', sound: s, x, y, smoke, tick: world.tick });
}

/** The clonk with this id, if it's still around. */
function clonkById(world: World, id: number): Clonk | null {
  return id < 0 ? null : (world.clonks.find((c) => c.id === id) ?? null);
}

// ------------------------------------------------------------------ loading

/** Arrows in it, counting the ones in packs (the crossbow's GetArrowCount). */
export function arrowCount(v: Vehicle): number {
  let n = 0;
  for (const it of v.contents) n += it.def.pack ? it.count : it.def.arrow ? 1 : 0;
  return n;
}

/** What a vehicle takes in (the vehicles' RejectCollect). */
export function accepts(v: Vehicle, it: Item): boolean {
  const id = v.def.id;
  if (id === 'crossbow') return (!!it.def.arrow || !!it.def.pack) && arrowCount(v) < SIEGE.crossbowArrows;
  if (id === 'cannon') return cannonAllows(v, it.def.id);
  return !v.full;
}

/**
 * The cannon's AllowLoad: room for 10, but the last place goes to gunpowder
 * if there's none yet, or to something to shoot if it's all gunpowder.
 */
function cannonAllows(v: Vehicle, id: ItemId): boolean {
  const n = v.contents.length;
  if (n < 9) return true;
  if (n >= 10) return false;
  const powder = v.contents.filter((o) => o.def.id === 'gunpowder').length;
  return id === 'gunpowder' ? powder !== 9 : powder !== 0;
}

/** Take something out of a vehicle into the world, flying off (C4Object::Exit). */
function launch(world: World, v: Vehicle, it: Item, x: number, y: number, xdir: number, ydir: number, rdir: number, by: Clonk | null): void {
  const i = v.contents.indexOf(it);
  if (i >= 0) v.contents.splice(i, 1);
  it.container = null;
  it.setPosition(Math.round(x), Math.round(y));
  it.xdir = xdir;
  it.ydir = ydir;
  it.r = world.rng.int(360);
  // Exit's rotation speed is in tenths of a degree; ReClonk turns items rdir * 5 degrees a tick.
  it.rdir = rdir / 10 / 5;
  it.noCollect = 20;
  it.thrownBy = by ? by.id : -1;
}

// ----------------------------------------------------------------- aiming

/** One step of aiming (AimStdConf): a frame further or back along its strip. */
export function aimStep(world: World, v: Vehicle, conf: -1 | 1): boolean {
  const len = v.def.aim;
  if (!len) return false;
  // The catapult can only be tensed while it's ready.
  if (v.def.id === 'catapult' && v.action !== 'Ready') return false;
  const old = v.phase;
  v.phase = clamp(v.phase + conf, 0, len - 1);
  if (v.phase === old) return false;
  if (v.def.id === 'catapult') v.tension = v.phase;
  sound(world, 'CatapultSet', v.x, v.y);
  return true;
}

/** Jump'n'run aiming: while up or down is held, a step every few ticks (FxIntJnRAimTimer). */
function aimHeld(world: World, v: Vehicle, pushers: Clonk[]): void {
  const h = v.aimHeld;
  if (!h) return;
  if (!pushers.length) {
    v.aimHeld = null;
    return;
  }
  if (--h.timer > 0) return;
  h.timer = SIEGE.aimInterval[v.def.id] ?? 5;
  aimStep(world, v, h.conf);
}

// ------------------------------------------------------------------- firing

/** Catapult Fire: the arm swings forward (the Fire action), then throws (Projectile). */
function fireCatapult(world: World, v: Vehicle, by: Clonk): void {
  v.firedBy = by.id;
  v.setAction('Fire');
  sound(world, 'Catapult', v.x, v.y);
}

/**
 * Catapult Projectile: out goes the last thing loaded, faster the more it was
 * tensed, with some scatter: 30 either way at the least, 80 at full tension.
 */
function catapultThrow(world: World, v: Vehicle): void {
  const it = v.contents[v.contents.length - 1];
  const by = clonkById(world, v.firedBy);
  v.firedBy = -1;
  if (!it) return;
  const t = v.tension;
  const xd = Math.trunc((8 * v.dir * t) / 6);
  const yd = Math.trunc((-12 * t) / 6);
  const spread = t * 10 + 20;
  const dev = world.rng.int(2 * spread + 1) - spread;
  launch(world, v, it, v.x + v.dir * 12, v.y - 10, xd + dev / 100, yd + dev / 100, 30, by);
}

/** Catapult Charging: back up to the tension it had, a frame every 5 ticks. */
function catapultScript(world: World, v: Vehicle): void {
  if (v.action === 'Fire') {
    // Fire runs backwards from the tension to 0, a frame a tick, then throws.
    v.phase = Math.max(0, v.tension - 1 - v.actTime);
    if (v.actTime + 1 >= Math.max(1, v.tension)) {
      catapultThrow(world, v);
      v.setAction('Charge');
      v.phase = 0;
    }
  } else if (v.action === 'Charge') {
    v.phase = Math.floor(v.actTime / SIEGE.chargeDelay);
    if (v.phase >= v.tension) {
      v.setAction('Ready');
      v.phase = v.tension;
    }
  }
}

/**
 * Cannon Fire: it takes one gunpowder and shoots the other thing in it, at
 * the angle it's aimed: frame 0 straight up, frame 18 level.
 */
export function fireCannon(world: World, v: Vehicle, by: Clonk | null): boolean {
  const powder = [...v.contents].reverse().find((o) => o.def.id === 'gunpowder');
  const shot = [...v.contents].reverse().find((o) => o.def.id !== 'gunpowder');
  if (!powder || !shot) {
    sound(world, 'Click', v.x, v.y);
    return false;
  }
  v.contents.splice(v.contents.indexOf(powder), 1);
  powder.container = null;
  powder.removed = true;
  const p = v.phase;
  const x = (p + 3) * v.dir;
  const y = p - 14;
  const angle = (clamp(p * 5 - 5, 0, 90) * Math.PI) / 180;
  const xd = Math.trunc(Math.sin(angle) * 32 * v.dir);
  const yd = Math.trunc(Math.cos(angle) * -18);
  launch(world, v, shot, v.x + x, v.y + y, xd, yd, 30, by);
  sound(world, 'Blast2', v.x + x, v.y + y, 6);
  return true;
}

/** The next arrow out of the crossbow: from a pack, or a loose one (SplitPacks). */
function takeArrow(world: World, v: Vehicle): Item | null {
  for (let i = v.contents.length - 1; i >= 0; i--) {
    const it = v.contents[i];
    if (it.def.arrow) {
      v.contents.splice(i, 1);
      it.container = null;
      return it;
    }
    const pack = it.def.pack;
    if (!pack) continue;
    const arrow = world.spawnItem(pack.arrow, v.x, v.y);
    if (--it.count <= 0) {
      v.contents.splice(i, 1);
      it.container = null;
      it.removed = true;
    }
    return arrow;
  }
  return null;
}

/**
 * Crossbow Fire: an arrow flies off at the angle it's aimed, frame 0
 * straight up to frame 19 level, at 13 pixels a tick. Then it reloads for 10 ticks.
 */
export function fireCrossbow(world: World, v: Vehicle, by: Clonk | null): boolean {
  if (v.reload > 0) return true;
  const arrow = takeArrow(world, v);
  if (!arrow) {
    sound(world, 'Click', v.x, v.y);
    return false;
  }
  const p = v.phase;
  const x = p * v.dir;
  const angle = (clamp(p * 5, 0, 90) * Math.PI) / 180;
  const xd = Math.trunc(Math.sin(angle) * 13 * v.dir);
  const yd = Math.trunc(Math.cos(angle) * -13);
  launch(world, v, arrow, v.x + x, v.y + p - 15, xd, yd, v.dir * 3, by);
  arrow.r = (x * 5 + 360) % 360;
  shootArrow(world, arrow, by);
  sound(world, 'Arrow', v.x, v.y);
  v.reload = SIEGE.reload;
  return true;
}

/** An arrow leaves the bow (Arrow.c4d Launch): it hits what lives on its way; a fire arrow burns, an explosive one is armed. */
export function shootArrow(world: World, arrow: Item, by: Clonk | null): void {
  arrow.shot = true;
  arrow.lastX = arrow.x;
  arrow.lastY = arrow.y;
  arrow.noHit = by ? { id: by.id, until: world.tick + SIEGE.noArrowHit } : null;
  if (arrow.def.arrow?.burns) incinerate(world, arrow, by);
  if (arrow.def.arrow?.explode) arrow.armed = true;
}

// ------------------------------------------------------------ arrows flying

/** Is the point inside this box? */
function inBox(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px < x + w && py >= y && py < y + h;
}

/**
 * Arrows in flight (Arrow.c4d InFlight, every tick): whatever lives on the
 * line from where it was to where it is now gets hit. A balloon or blimp it
 * flies into loses its gas and drops (their RejectCollect), or burns.
 */
export function stepArrows(world: World): void {
  for (const it of world.items) {
    if (!it.shot) continue;
    if (it.container || it.removed) {
      it.shot = false;
      continue;
    }
    if (Math.abs(it.xdir) < 0.05 && Math.abs(it.ydir) < 0.05) {
      it.shot = false;
      continue;
    }
    arrowFlight(world, it);
    it.lastX = it.x;
    it.lastY = it.y;
  }
}

function arrowFlight(world: World, it: Item): void {
  const by = clonkById(world, it.thrownBy);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(it.x - it.lastX), Math.abs(it.y - it.lastY))));
  for (let i = 0; i <= steps; i++) {
    const px = Math.round(it.lastX + ((it.x - it.lastX) * i) / steps);
    const py = Math.round(it.lastY + ((it.y - it.lastY) * i) / steps);
    for (const c of world.clonks) {
      if (!c.alive || c.contained) continue;
      if (it.noHit && it.noHit.id === c.id && world.tick < it.noHit.until) continue;
      if (!inBox(px, py, c.x - CLONK.width / 2, c.y - CLONK.height / 2, CLONK.width, CLONK.height)) continue;
      return hitTarget(world, it, c, by);
    }
    for (const a of world.animals) {
      if (!a.alive || a.removed || !a.at(px, py)) continue;
      return hitTarget(world, it, a, by);
    }
    for (const v of world.vehicles) {
      const box = SIEGE.arrowBox[v.def.id];
      if (!box || v.removed || v.burned || v.contained || !inBox(px, py, v.x + box.x, v.y + box.y, box.w, box.h)) continue;
      if (it.fire) incinerate(world, v, by);
      else dropOff(world, v);
      it.shot = false;
      if (it.armed) explodeArrow(world, it);
      return;
    }
  }
}

/** A balloon or blimp loses its gas and drops for a while (DropOff, with the Fusing sound). */
export function dropOff(world: World, v: Vehicle): void {
  if (v.action === 'DropOff') return;
  v.setAction('DropOff');
  v.comDir = { x: 0, y: 1 };
  v.windX = v.windY = v.clearX = v.clearY = false;
  sound(world, 'Fusing', v.x, v.y);
}

/**
 * Arrow HitTarget: the damage grows with its speed (strength × speed in
 * tenths / 50), and sometimes the target tumbles. A normal or fire arrow
 * stops; a fire arrow may set it alight; an explosive one flies on.
 */
function hitTarget(world: World, it: Item, t: Clonk | Animal, by: Clonk | null): void {
  const a = it.def.arrow!;
  sound(world, 'ArrowHit', it.x, it.y);
  const speed = Math.trunc(Math.hypot(it.xdir, it.ydir) * 10);
  const strength = a.strength + (a.random ? world.rng.int(a.random) : 0);
  const dmg = Math.trunc((strength * speed) / 50);
  if (t instanceof Clonk) world.hurt(t, dmg, by);
  else world.hurtAnimal(t, dmg, by);
  if (t.alive && !world.rng.int(a.tumble)) {
    if (t instanceof Clonk) t.fling(t.xdir + it.xdir / 3, t.ydir + it.ydir / 3 - 1);
    else t.fling(t.xdir + it.xdir / 3, t.ydir + it.ydir / 3 - 1);
  }
  if (a.burns) {
    const ci = contactIncinerate(t);
    if (ci && !world.rng.int(ci) && !world.rng.int(3)) incinerate(world, t, by);
  }
  if (!a.stops) return;
  it.xdir = t.xdir;
  it.ydir = t.ydir;
  it.shot = false;
  it.noCollect = SIEGE.arrowNoCollect;
}

/** An explosive arrow that was shot blows up where it lands (Hit: Explode 10 + Random(5)). */
function explodeArrow(world: World, it: Item): void {
  it.removed = true;
  it.armed = false;
  world.explode(it.x, it.y, (it.def.arrow?.explode ?? 10) + world.rng.int(5), clonkById(world, it.thrownBy));
}

/** An item hit the ground hard. Returns true if it's gone. */
export function siegeItemHit(world: World, it: Item): boolean {
  if (it.def.arrow) {
    it.shot = false;
    if (it.armed) {
      explodeArrow(world, it);
      return true;
    }
  }
  return false;
}

/**
 * A loose arrow a clonk walks over goes into the pack it carries, if there's
 * room; with empty hands it becomes a new pack (Arrow.c4d Entrance, Pack, JoinPack).
 */
export function collectArrow(world: World, c: Clonk): Item | null {
  if (c.action.disabled) return null;
  const r = CLONK.collection;
  for (const it of world.items) {
    const a = it.def.arrow;
    if (!a || it.container || it.removed || it.shot || it.noCollect > 0 || it.fire) continue;
    const dx = it.x - c.x;
    const dy = it.y - c.y;
    if (dx < r.x || dx >= r.x + r.w || dy < r.y || dy >= r.y + r.h || world.land.isSolid(it.x, it.y)) continue;
    const held = c.carrying;
    if (held) {
      if (held.def.id !== a.pack || held.count >= ITEMS[a.pack].pack!.max) continue;
      held.count++;
      it.removed = true;
      return held;
    }
    if (c.contents.length >= CLONK.maxContents) return null;
    it.removed = true;
    const pack = world.give(c, a.pack)!;
    pack.count = 1;
    return pack;
  }
  return null;
}

// ------------------------------------------------------------------ the train

/** The steam engine pulling this vehicle, if any. */
export function engineOf(world: World, v: Vehicle): Vehicle | null {
  for (const e of world.vehicles) if (e.pulling === v && !e.removed && !e.burned) return e;
  return null;
}

/** Couple the nearest vehicle within 50 pixels (GrabTarget): not a held one, not a locked bridge. */
function couple(world: World, e: Vehicle): boolean {
  let best: Vehicle | null = null;
  let bd = Infinity;
  for (const v of world.vehicles) {
    if (v === e || v.removed || v.contained || v.burned || v.grab !== 1 || v.locked || engineOf(world, v)) continue;
    const d = Math.hypot(v.x - e.x, v.y - e.y);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  if (!best || bd > SIEGE.coupleRange) return false;
  e.pulling = best;
  e.setAction('Push');
  sound(world, 'Connect', e.x, e.y);
  return true;
}

/** Let go of what it pulls (ReleaseTarget, GrabLost). */
export function decouple(world: World, e: Vehicle): void {
  if (!e.pulling) return;
  e.pulling = null;
  e.setAction('Walk');
  e.comDir = STOP;
  sound(world, 'LineBreak', e.x, e.y);
}

/** Drive the engine (SetDirection): faster with nobody holding on to the train. */
function setEngine(world: World, e: Vehicle, x: -1 | 0 | 1): void {
  if (e.comDir.x !== x) sound(world, 'Click', e.x, e.y);
  e.comDir = { x, y: 0 };
  engineSteered(world, e, x);
}

/** Its walking speed (AdjustTrainSpeed): slower while a clonk holds the engine or its wagon. */
function engineSpeed(world: World, e: Vehicle): number {
  const held = world.clonks.some((c) => c.alive && c.action.procedure === 'push' && (c.vehicle === e || (!!e.pulling && c.vehicle === e.pulling)));
  return held ? SIEGE.engineHeldWalk : SIEGE.engineWalk;
}

/** Push something towards a speed with a force (C4Object::Push). */
function pushTo(v: Vehicle, txdir: number, force: number): void {
  const f = (force * 100) / v.mass;
  if (Math.abs(v.xdir - txdir) <= f) v.xdir = txdir;
  else v.xdir += v.xdir < txdir ? f : -f;
  if (v.xdir < 0) v.dir = -1;
  if (v.xdir > 0) v.dir = 1;
}

/**
 * The steam engine's WALK and PULL procedures: its ComDir speeds it up to its
 * walking speed (WalkAccel 0.5). Coupled, it keeps the other vehicle one
 * half-width each apart, in front of it or behind, and pulls it along.
 */
function engineScript(world: World, v: Vehicle): void {
  const t = v.pulling;
  if (t && (t.removed || t.contained || t.burned || v.contained)) decouple(world, v);
  const lim = engineSpeed(world, v);
  const onGround = contactCheck(world.land, v.vertices, v.x, v.y + 1).count > 0;
  if (!v.pulling) {
    if (!onGround) return;
    if (v.comDir.x) v.xdir = clamp(v.xdir + v.comDir.x * WALK_ACCEL, -lim, lim);
    else v.xdir = Math.abs(v.xdir) <= WALK_ACCEL ? 0 : v.xdir - Math.sign(v.xdir) * WALK_ACCEL;
  } else {
    const tg = v.pulling;
    const dist = tg.def.width / 2 + v.def.width / 2;
    const move = v.comDir.x * lim;
    const targetX = v.comDir.x > 0 ? tg.x + dist : v.comDir.x < 0 ? tg.x - dist : v.x;
    const pullX = v.comDir.x > 0 ? v.x - dist : v.comDir.x < 0 ? v.x + dist : tg.x;
    pushTo(tg, move + (lim * clamp(pullX - tg.x, -10, 10)) / 10, SIEGE.enginePush);
    if (onGround) v.xdir = move + (lim * clamp(targetX - v.x, -10, 10)) / 10;
    // Out of reach: the coupling breaks.
    const range = Math.max(v.def.width / 2 - 8, 0) + 20;
    if (v.x < tg.left - range || v.x > tg.left + tg.def.width - 1 + range || v.y < tg.top - range || v.y > tg.top + tg.def.height - 1 + range) {
      decouple(world, v);
    }
  }
  if (v.xdir < 0) v.dir = -1;
  if (v.xdir > 0) v.dir = 1;
  // The wheels turn with its speed; each round coupled it chuffs a puff of smoke (Puff).
  const before = Math.floor(v.phase);
  v.phase = (v.phase + Math.min(1, Math.abs(v.xdir) * 10 / 20)) % 10;
  if (v.pulling && Math.floor(v.phase) < before) sound(world, 'Chuff', v.x - 5 * -v.dir, v.y - 14, 1);
  // Railway signals (PhaseCall=CheckSignal, TimerCall=SignalDelay).
  if (Math.floor(v.phase) !== before && v.comDir.x) checkSignal(world, v);
  signalDelay(world, v);
}

/** Wagon, from inside or holding on: steer the engine pulling it (ControlLeft, ControlRight...). */
function engineControl(world: World, e: Vehicle, ctl: ControlState, classic: boolean, held: Vehicle, c: Clonk): void {
  if (classic) {
    if (ctl.pressedLeft) setEngine(world, e, -1);
    if (ctl.pressedRight) setEngine(world, e, 1);
    if (ctl.pressedDown && c.contained !== held) setEngine(world, e, 0);
    return;
  }
  const x = ctl.left ? -1 : ctl.right ? 1 : 0;
  const was = held.held?.x ?? 0;
  if (x !== was || !held.held) setEngine(world, e, x);
  held.held = { x, y: 0 };
}

/** A double press left or right drives the engine on its own (ControlLeftDouble): the clonk lets go. */
function doublePress(world: World, v: Vehicle, ctl: ControlState): -1 | 0 | 1 {
  let d: -1 | 0 | 1 = 0;
  if (ctl.pressedLeft) {
    if (world.tick - v.lastLeft <= 12) d = -1;
    v.lastLeft = world.tick;
  }
  if (ctl.pressedRight) {
    if (world.tick - v.lastRight <= 12) d = 1;
    v.lastRight = world.tick;
  }
  return d;
}

// --------------------------------------------------------------- submarine

/** Submarine SetDirection: in the water it goes that way, turning round first if it must. */
function subDirection(world: World, v: Vehicle, d: Dir): void {
  if (v.action === 'Turn' || v.action === 'Grapple') {
    v.subTurnEnd = d;
    return;
  }
  if (v.action !== 'Swim') return;
  v.comDir = d;
  if (d.y === 0 && d.x !== 0) v.ydir = 0;
  if (d.x === 0 && d.y !== 0) v.xdir = 0;
  if (d.x > 0 && v.dir < 0) {
    v.setAction('Turn');
    v.dir = 1;
    sound(world, 'Submarine', v.x, v.y);
  } else if (d.x < 0 && v.dir > 0) {
    v.setAction('Turn');
    v.dir = -1;
    sound(world, 'Submarine', v.x, v.y);
  }
}

/** Is the submarine's middle in a liquid? */
function subWet(world: World, v: Vehicle): boolean {
  return world.land.isLiquid(v.x, v.y);
}

/**
 * The submarine: in the water it swims (SWIM, SwimAccel 0.2 up to 1.6 pixels
 * a tick, no gravity); out of it it falls like anything else. Its grapple
 * picks up what's in front of and below it; it wrecks at 150 damage.
 */
function subScript(world: World, v: Vehicle): void {
  if (world.tick % SIEGE.airlockTimer === 0 && v.airlock) {
    v.airlock = false;
    sound(world, 'Airlock2', v.x, v.y);
  }
  if (v.def.wreckAt && v.damage >= v.def.wreckAt) return wreck(world, v);
  const wet = subWet(world, v);
  if (v.action === 'Walk') {
    if (wet) {
      v.setAction('Swim');
      v.comDir = STOP;
    }
    return;
  }
  if (!wet) {
    // Just above the water it dips back in; out in the air it falls (ObjectActionWalk).
    if (world.land.isLiquid(v.x, v.y + 1)) v.ydir = SWIM_ACCEL;
    else {
      v.setAction('Walk');
      v.comDir = STOP;
    }
    return;
  }
  if ((v.action === 'Turn' && v.actTime >= SIEGE.subTurn) || (v.action === 'Grapple' && v.actTime >= SIEGE.subGrapple)) {
    v.setAction('Swim');
    const d = v.subTurnEnd;
    v.subTurnEnd = null;
    if (d) subDirection(world, v, d);
  }
  if (v.action === 'Swim') grapple(world, v);
}

/** The swimming submarine's movement (DFA_SWIM). */
export function subSwim(v: Vehicle): void {
  const lim = SIEGE.subSwim;
  const a = SWIM_ACCEL;
  if (isStop(v.comDir)) {
    v.xdir = Math.abs(v.xdir) < a ? 0 : v.xdir - Math.sign(v.xdir) * a;
    v.ydir = Math.abs(v.ydir) < a ? 0 : v.ydir - Math.sign(v.ydir) * a;
  } else {
    v.xdir += v.comDir.x * a;
    v.ydir += v.comDir.y * a;
  }
  v.xdir = clamp(v.xdir, -lim, lim);
  v.ydir = clamp(v.ydir, -lim, lim);
}

/** Swimming vehicles: the submarine in the water, turning or grappling. */
export function isSwimming(v: Vehicle): boolean {
  return v.def.id === 'sub' && !v.burned && (v.action === 'Swim' || v.action === 'Turn' || v.action === 'Grapple');
}

/**
 * The grapple (RejectCollect, Collection): a loose thing within 8 pixels of
 * the spot 30 pixels ahead and 14 below its middle goes in. A torpedo that
 * has swum for 25 ticks blows up on it instead.
 */
function grapple(world: World, v: Vehicle): void {
  const box = v.def.collection!;
  for (const it of world.items) {
    if (it.container || it.removed || !inBox(it.x - v.x, it.y - v.y, box.x, box.y, box.w, box.h)) continue;
    if (it.def.swim && it.swimDir) {
      if (it.swimTime >= 25) {
        it.removed = true;
        world.explode(it.x, it.y, it.def.explodeOnHit ?? 30, clonkById(world, it.thrownBy));
      }
      continue;
    }
    if (Math.abs(it.x - v.x + 30 * -v.dir) > 8 || Math.abs(it.y - v.y - 14) > 8) continue;
    if (v.full) return;
    it.container = v;
    it.xdir = it.ydir = it.rdir = 0;
    it.swimDir = 0;
    it.setPosition(v.x, v.y);
    v.contents.push(it);
    v.setAction('Grapple');
    sound(world, 'Grapple', v.x, v.y);
    return;
  }
}

/** Launch a torpedo (ContainedDig, Ejection, Torpedo Launch): it swims off the way the submarine faces. */
function launchTorpedo(world: World, v: Vehicle, by: Clonk): void {
  const t = [...v.contents].reverse().find((o) => !!o.def.swim);
  if (!t) return sound(world, 'Error', v.x, v.y);
  launch(world, v, t, v.x, v.y, v.xdir, 0, 0, by);
  t.r = 0;
  t.rdir = 0;
  t.swimDir = v.dir;
  t.swimTime = 0;
  t.noCollect = 35;
  sound(world, 'Torpedo', v.x, v.y);
}

/** The submarine is wrecked (Damage: ChangeDef SUBB); whoever is inside gets out. */
export function wreck(world: World, v: Vehicle): void {
  if (v.burned) return;
  v.burned = true;
  v.comDir = STOP;
  for (const c of world.clonks) {
    if (c.contained === v) world.exit(c);
    if (c.vehicle === v) c.letGo();
  }
}

// ------------------------------------------------------------ chest, bridge

/** The chest opens while a clonk holds on to it and shuts again when let go (CheckGrab). */
function chestScript(world: World, v: Vehicle, pushers: Clonk[]): void {
  const len = SIEGE.chestFrames * SIEGE.chestDelay;
  switch (v.action) {
    case 'Closed':
      if (pushers.length) {
        v.setAction('Opening');
        sound(world, 'ChestOpen', v.x, v.y);
      }
      break;
    case 'Opening':
      if (v.actTime >= len) v.setAction(pushers.length ? 'Open' : 'Closing');
      break;
    case 'Open':
      if (!pushers.length) {
        v.setAction('Closing');
        sound(world, 'ChestClose', v.x, v.y);
      }
      break;
    case 'Closing':
      if (v.actTime >= len) v.setAction(pushers.length ? 'Opening' : 'Closed');
      break;
  }
}

/** The chest's frame: closed, opening or closing (8 frames from 20,0), open (180,0). */
export function chestFrame(v: Vehicle): number {
  const f = Math.min(SIEGE.chestFrames - 1, Math.floor(v.actTime / SIEGE.chestDelay));
  switch (v.action) {
    case 'Opening':
      return 1 + f;
    case 'Open':
      return 9;
    case 'Closing':
      return SIEGE.chestFrames - f;
    default:
      return 0;
  }
}

/**
 * Lock a bridge segment (Lock): its top turns solid, and over a gap it sinks
 * 10 pixels so its ends dig into the edges and hold it.
 */
export function lockBridge(world: World, v: Vehicle, quiet = false, descend = true): void {
  v.locked = true;
  v.setAction('Locked');
  v.xdir = v.ydir = 0;
  if (!quiet) sound(world, 'Connect', v.x, v.y);
  if (descend && !world.land.isSolid(v.x, v.y + 10)) v.setPosition(v.x, v.y + 10);
}

/** Release it (Release): no longer solid, and it climbs out of the ground it was stuck in. */
export function releaseBridge(world: World, v: Vehicle): void {
  v.locked = false;
  v.setAction('Idle');
  v.mask?.remove(world.land);
  v.mask = null;
  sound(world, 'Connect', v.x, v.y);
  for (let up = 0; up < 12 && contactCheck(world.land, v.vertices, v.x, v.y).count; up++) v.setPosition(v.x, v.y - 1);
}

/** A locked bridge stays where it's stuck in the ground. */
export function anchored(world: World, v: Vehicle): boolean {
  return v.locked && contactCheck(world.land, v.vertices, v.x, v.y).count > 0;
}

/** The wagon's door: opening, open, closing (the DOOR script's actions). */
function wagonScript(v: Vehicle): void {
  const d = SIEGE.wagonDoor;
  if (v.action === 'OpenDoor' && v.actTime >= d.open) v.setAction('DoorOpen');
  else if (v.action === 'DoorOpen' && v.actTime >= d.wait) v.setAction('CloseDoor');
  else if (v.action === 'CloseDoor' && v.actTime >= d.close) v.setAction('Idle');
}

// ------------------------------------------------------------------ scripts

/** One tick of the new vehicles' scripts. */
export function siegeScript(world: World, v: Vehicle, pushers: Clonk[]): void {
  switch (v.def.id) {
    case 'catapult':
      catapultScript(world, v);
      break;
    case 'crossbow':
      if (v.reload > 0) v.reload--;
      break;
    case 'engine':
      engineScript(world, v);
      break;
    case 'sub':
      subScript(world, v);
      break;
    case 'chest':
      chestScript(world, v, pushers);
      break;
    case 'wagon':
      wagonScript(v);
      break;
  }
  if (v.def.aim) aimHeld(world, v, pushers);
  // Riders inside go where it goes.
  for (const c of world.clonks) if (c.contained === v) c.setPosition(v.x, v.y);
}

/** Whether its own pusher's walking moves it: not the engine (it drives itself), nor what it pulls, nor a stuck bridge. */
export function pushedByClonk(world: World, v: Vehicle): boolean {
  if (v.def.id === 'engine' || engineOf(world, v)) return false;
  return !v.locked;
}

// ----------------------------------------------------------------- controls

/**
 * Controls for a clonk holding on to one of the new vehicles, before the
 * usual pushing (the vehicles' Control functions, which may take over).
 * Returns true if the vehicle took the controls.
 */
export function siegeControl(world: World, c: Clonk, v: Vehicle, ctl: ControlState, putOrGet: () => void): boolean {
  const classic = c.controlStyle === 'classic';
  switch (v.def.id) {
    case 'catapult':
    case 'cannon':
    case 'crossbow':
      return aimerControl(world, c, v, ctl, classic, putOrGet);
    case 'engine': {
      if (ctl.pressedUse) {
        if (v.pulling) decouple(world, v);
        else if (!couple(world, v)) world.say(c.owner, 'Nothing to couple here');
        return true;
      }
      const dbl = doublePress(world, v, ctl);
      if (dbl) {
        setEngine(world, v, dbl);
        c.letGo();
        return true;
      }
      engineControl(world, v, ctl, classic, v, c);
      c.comDir = STOP;
      return !ctl.pressedThrow && !ctl.pressedUp;
    }
    case 'wagon': {
      const e = engineOf(world, v);
      if (!e) return false;
      const dbl = doublePress(world, v, ctl);
      if (dbl) {
        setEngine(world, e, dbl);
        c.letGo();
        return true;
      }
      engineControl(world, e, ctl, classic, v, c);
      c.comDir = STOP;
      return !ctl.pressedThrow && !ctl.pressedUp;
    }
    case 'chest':
      // Held, not pushed: throw puts in or takes out, dig opens the menu of what's in it (ControlDig).
      c.comDir = STOP;
      if (ctl.pressedThrow) putOrGet();
      else if (ctl.pressedDig) {
        if (v.contents.length) c.loadMenu = 0;
        else world.say(c.owner, 'The chest is empty');
      }
      return true;
    case 'bridge':
      if (!ctl.pressedUse) return false;
      if (v.locked) releaseBridge(world, v);
      else lockBridge(world, v);
      return true;
  }
  return false;
}

/**
 * The catapult, cannon and crossbow: up and (classic) dig aim, or holding up
 * or down (jump'n'run); throw fires, loads, or opens the menu of what's in it.
 */
function aimerControl(world: World, c: Clonk, v: Vehicle, ctl: ControlState, classic: boolean, putOrGet: () => void): boolean {
  if (classic) {
    if (ctl.pressedUp && aimStep(world, v, -1)) return true;
    if (ctl.pressedDig) aimStep(world, v, 1);
  } else {
    const conf: -1 | 0 | 1 = ctl.up ? -1 : ctl.down ? 1 : 0;
    if (!conf) v.aimHeld = null;
    else if (!v.aimHeld || v.aimHeld.conf !== conf) v.aimHeld = { conf, timer: SIEGE.aimInterval[v.def.id] ?? 5 };
  }
  if (!ctl.pressedThrow) return false;
  c.comDir = STOP;
  v.firedBy = c.id;
  const held = c.carrying;
  switch (v.def.id) {
    case 'catapult':
      // Not ready: nothing. Tensed and loaded: fire. Otherwise load or unload.
      if (v.action !== 'Ready') return true;
      if (v.phase > 0 && v.contents.length) fireCatapult(world, v, c);
      else putOrGet();
      return true;
    case 'cannon':
      // Carrying something it takes: load it rather than fire too soon.
      if (held && accepts(v, held)) putOrGet();
      else if (!fireCannon(world, v, c)) putOrGet();
      return true;
    case 'crossbow':
      // Not in the original, where throw always fires: arrows in hand get loaded.
      if (held && (held.def.arrow || held.def.pack)) putOrGet();
      else if (!fireCrossbow(world, v, c)) putOrGet();
      return true;
  }
  return false;
}

/** Go in through a wagon's door or a submarine's turret (ActivateEntrance, OpenAirlock). */
export function enterVehicle(world: World, c: Clonk): boolean {
  const v = world.vehicles.find((o) => !o.removed && !o.contained && o.enterable && o.atEntrance(c.x, c.y));
  if (!v) return false;
  c.contained = v;
  c.menu = null;
  c.menuKind = 'get';
  c.buildMenu = null;
  c.comDir = STOP;
  c.xdir = c.ydir = 0;
  c.setPosition(v.x, v.y);
  v.held = null;
  if (v.def.id === 'sub') openAirlock(world, v);
  else {
    v.openDoor();
    sound(world, 'SteelGate2', v.x, v.y);
  }
  return true;
}

function openAirlock(world: World, v: Vehicle): void {
  if (v.airlock) return;
  v.airlock = true;
  sound(world, 'Airlock1', v.x, v.y);
}

/** Leave a wagon or a submarine. */
function leave(world: World, c: Clonk, v: Vehicle): void {
  if (v.def.id === 'sub') openAirlock(world, v);
  else sound(world, 'SteelGate2', v.x, v.y);
  world.exit(c);
}

/**
 * Controls inside a vehicle (ContainedUp, ContainedDig, ContainedUpdate...).
 * Submarine: the arrow keys steer, up twice gets out, dig launches a
 * torpedo. Wagon: left and right drive the engine pulling it, down stops it
 * or gets out. In both, throw puts in what the clonk carries or opens the
 * menu of what's in it, and dig in the wagon opens that menu.
 */
export function ridingControl(world: World, c: Clonk, ctl: ControlState): void {
  const v = c.contained as Vehicle;
  const classic = c.controlStyle === 'classic';
  if (ctl.pressedThrow) {
    const item = c.carrying;
    if (!item) {
      if (v.contents.length) {
        c.menuKind = 'get';
        c.menu = 0;
      } else world.say(c.owner, `The ${v.def.name.toLowerCase()} is empty`);
      return;
    }
    c.contents.splice(c.contents.indexOf(item), 1);
    world.store(v, item);
    return;
  }
  if (v.def.id === 'sub') {
    if (ctl.pressedUp) {
      const dbl = world.tick - v.lastUp <= 12;
      v.lastUp = world.tick;
      if (dbl) {
        leave(world, c, v);
        subDirection(world, v, STOP);
        return;
      }
    }
    if (ctl.pressedDig) return launchTorpedo(world, v, c);
    if (ctl.pressedUp || ctl.pressedDown) {
      if (v.airlock) {
        v.airlock = false;
        sound(world, 'Airlock2', v.x, v.y);
      }
    }
    if (classic) {
      const cur = v.comDir;
      if (ctl.pressedUp) subDirection(world, v, comDirTransform(cur, { x: 0, y: -1 }));
      else if (ctl.pressedDown) subDirection(world, v, comDirTransform(cur, { x: 0, y: 1 }));
      else if (ctl.pressedLeft) subDirection(world, v, comDirTransform(cur, { x: -1, y: 0 }));
      else if (ctl.pressedRight) subDirection(world, v, comDirTransform(cur, { x: 1, y: 0 }));
      return;
    }
    const d: Dir = { x: ctl.left ? -1 : ctl.right ? 1 : 0, y: ctl.up ? -1 : ctl.down ? 1 : 0 };
    if (!v.held || v.held.x !== d.x || v.held.y !== d.y) subDirection(world, v, d);
    v.held = d;
    return;
  }
  // The wagon.
  if (ctl.pressedDig) {
    if (v.contents.length) {
      c.menuKind = 'get';
      c.menu = 0;
    } else world.say(c.owner, 'The wagon is empty');
    return;
  }
  const e = engineOf(world, v);
  if (ctl.pressedDown && (!e || e.comDir.x === 0)) return leave(world, c, v);
  if (!e) return;
  if (ctl.pressedDown && classic) return setEngine(world, e, 0);
  const dbl = doublePress(world, v, ctl);
  if (dbl) return setEngine(world, e, dbl);
  engineControl(world, e, ctl, classic, v, c);
}

/** The system script's ComDirTransform, for the submarine's classic steering (see vehicles.ts). */
function comDirTransform(from: Dir, to: Dir): Dir {
  const DIRS: Dir[] = [
    { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
  ];
  const same = (a: Dir, b: Dir): boolean => a.x === b.x && a.y === b.y;
  if (same(from, to) || isStop(to)) return from;
  if (isStop(from)) return to;
  const a = DIRS.findIndex((d) => same(d, from));
  const b = DIRS.findIndex((d) => same(d, to));
  const diff = (b - a + 8) % 8;
  if (diff === 4) return STOP;
  return DIRS[(a + (diff < 4 ? 1 : 7)) % 8];
}

/** Things a submarine or a vehicle holds: what the HUD shows (a pack shows its arrows). */
export function packCount(it: Item): number {
  return it.def.pack ? it.count : 1;
}

/** Sell value of a pack or a barrel (ArrowPack CalcValue, Barrel CalcValue). */
export function itemValue(it: Item): number {
  const d = it.def;
  if (d.pack) return Math.trunc((d.value * it.count) / d.pack.max);
  if (d.barrel?.mat !== undefined && d.barrel.mat !== null) {
    const empty = ITEMS.barrel.value;
    return empty + Math.trunc(((d.value - empty) * it.fill) / 200);
  }
  return d.value;
}

/** The vehicles that take part in siegeScript. */
export const isSiegeVehicle = (v: Vehicle): boolean => v instanceof Vehicle;
