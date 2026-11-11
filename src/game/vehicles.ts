// Vehicles, like the original's: the engine's PUSH and FLOAT procedures,
// floating in liquids (DoGravity), solid masks that carry whoever stands on
// them (C4SolidMask), the Sailboat, Balloon and Blimp scripts, and the
// lorry's load (Collection, GrabPutGet and the Lorry script).
// See licenses/clonk_engine_license.txt.

import type { ItemId } from '../landscape/materials';
import type { Clonk, ControlState } from '../objects/clonk';
import type { Item } from '../objects/item';
import { CLONK } from '../objects/defs';
import { CNAT, contactCheck, FLOAT_ACCEL, physical, round } from '../objects/physics';
import { BLIMP, STOP, type Dir, type Vehicle, type VehicleAction } from '../objects/vehicle';
import { menuMove } from './menus';
import type { World } from './world';

/** Float friction on xdir in liquids (C4Movement FloatFriction). */
const FLOAT_FRICTION = 0.02;
/** A clonk pushing a vehicle (ValByPhysical(250, Push) with the clonk's Push 40000). */
const PUSH_FORCE = physical(250, 40000);
/** The pushing clonk walks it along at its walking speed (ValByPhysical(280, Walk)). */
export const PUSH_SPEED = physical(280, CLONK.physical.walk);
/** Ticks between two presses of up that count as a double press. */
const DOUBLE_TICKS = 12;


// ----------------------------------------------------------------- helpers

/** The clonks holding on to a vehicle. */
export function pushersOf(world: World, v: Vehicle): Clonk[] {
  return world.clonks.filter((c) => c.vehicle === v && c.alive && !c.contained && c.action.procedure === 'push');
}

/** The vehicle a clonk standing here could hold on to (ObjectComDownDouble finds it at the clonk's position). */
export function vehicleAt(world: World, c: Clonk): Vehicle | null {
  for (const v of world.vehicles) if (!v.removed && !v.burned && !v.contained && v.inside(c.x, c.y)) return v;
  return null;
}

/** Its lowest vertex, below its centre. */
export function vehicleBottom(v: Vehicle): number {
  return Math.max(...v.def.vertices.map((p) => p.y));
}

// ------------------------------------------------------------------- lorry

/** What's in a lorry, one entry per kind of thing, in the order they went in (the Get menu). */
export function loadList(v: Vehicle): { id: ItemId; count: number }[] {
  const out: { id: ItemId; count: number }[] = [];
  for (const it of v.contents) {
    const e = out.find((o) => o.id === it.def.id);
    if (e) e.count++;
    else out.push({ id: it.def.id, count: 1 });
  }
  return out;
}

/**
 * Put something into a vehicle that holds things. Returns false when it's
 * full (the Lorry script's RejectCollect); otherwise it goes in with a clonk.
 */
export function putIn(world: World, v: Vehicle, it: Item): boolean {
  if (v.full) return false;
  it.container = v;
  it.xdir = it.ydir = it.rdir = 0;
  it.setPosition(v.x, v.y);
  v.contents.push(it);
  world.events.push({ type: 'vehicle', sound: 'Clonk', x: v.x, y: v.y, tick: world.tick });
  return true;
}

/** Take something out of a vehicle (it's then in nobody's hands). */
export function takeOut(v: Vehicle, it: Item): void {
  const i = v.contents.indexOf(it);
  if (i >= 0) v.contents.splice(i, 1);
  it.container = null;
}

/**
 * Every 3 ticks a lorry takes in the loose things in its open top, the
 * Collection box (C4GameObjects::CrossCheck). Full, it turns them away: fast
 * ones bounce up off it (RejectCollect).
 */
function collect(world: World, v: Vehicle): void {
  const box = v.def.collection;
  if (!box || world.tick % 3 !== 0) return;
  const x0 = v.x + box.x;
  const y0 = v.y + box.y;
  for (const it of world.items) {
    if (it.container || it.removed) continue;
    if (it.x < x0 || it.x >= x0 + box.w || it.y < y0 || it.y >= y0 + box.h) continue;
    if (putIn(world, v, it)) continue;
    // Full. Only things on the move clatter (a resting one would every 3 ticks).
    if (Math.abs(it.xdir) > 0.6) it.ydir = -0.5;
    if (it.xdir || it.ydir) world.events.push({ type: 'vehicle', sound: `WoodHit${1 + world.rng.int(3)}` as 'WoodHit1', x: v.x, y: v.y, tick: world.tick });
  }
}

/** Hold on to the vehicle where the clonk stands. Returns false if there's none. */
export function grabVehicle(world: World, c: Clonk): boolean {
  const v = vehicleAt(world, c);
  if (!v) return false;
  c.startPushVehicle(v);
  world.events.push({ type: 'grab', x: c.x, y: c.y, tick: world.tick });
  return true;
}

/** Something solid right below the bottom edge (the scripts' GBackSolid(0, GetObjHeight()/2+2)). */
function solidBelow(world: World, v: Vehicle): boolean {
  return world.land.isSolid(v.x, v.y + Math.trunc(v.def.height / 2) + 2);
}

/** A bottom vertex stands on something (GetContact(0, -1, CNAT_Bottom)). */
function onGround(world: World, v: Vehicle): boolean {
  return v.vertices.some((p) => p.cnat & CNAT.Bottom && world.land.isSolid(v.x + p.x, v.y + p.y + 1));
}

function inLiquid(world: World, v: Vehicle): boolean {
  const f = v.float;
  return f > 0 ? world.land.isLiquid(v.x, v.y + f - 1) : world.land.isLiquid(v.x, v.y);
}

/** The wind here, -100..100. */
function wind(world: World, v: Vehicle): number {
  return world.weather?.windAt(world, v.x, v.y) ?? 0;
}

/** C4Script's integer division, which rounds towards zero. */
const div = (a: number, b: number): number => Math.trunc(a / b);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const tenths = (v: number): number => round(v * 10);

const same = (a: Dir, b: Dir): boolean => a.x === b.x && a.y === b.y;
const isStop = (d: Dir): boolean => d.x === 0 && d.y === 0;
/** The original's ComDirs in order: up, up-right, right, ..., up-left. */
const COMDIRS: Dir[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

/**
 * Turn a direction one step towards another (the system script's
 * ComDirTransform): from stop straight to it, from the opposite to stop,
 * otherwise 45 degrees closer.
 */
export function comDirTransform(from: Dir, to: Dir): Dir {
  if (same(from, to) || isStop(to)) return from;
  if (isStop(from)) return to;
  const a = COMDIRS.findIndex((d) => same(d, from));
  const b = COMDIRS.findIndex((d) => same(d, to));
  const diff = (b - a + 8) % 8;
  if (diff === 4) return STOP;
  return COMDIRS[(a + (diff < 4 ? 1 : 7)) % 8];
}

// ---------------------------------------------------------------- movement

/** Gravity, or floating up in a liquid and drifting slower (C4Movement DoGravity). */
function doGravity(world: World, v: Vehicle): void {
  const { land } = world;
  if (inLiquid(world, v) && v.float > 0) {
    v.ydir = Math.max(v.ydir - FLOAT_ACCEL, -FLOAT_ACCEL * 10);
    if (v.xdir < -FLOAT_FRICTION) v.xdir += FLOAT_FRICTION;
    else if (v.xdir > FLOAT_FRICTION) v.xdir -= FLOAT_FRICTION;
    // Not above the liquid's top.
    if (!land.isLiquid(v.x, v.y - 1 + v.float - 1) && v.ydir < 0) v.ydir = 0;
  } else v.ydir += land.gravity;
}

/** The FLOAT procedure: the ComDir speeds it up to the Physical Float in any direction, with no gravity. */
function doFloat(v: Vehicle): void {
  const lim = v.def.floatSpeed;
  v.xdir = clamp(v.xdir + v.comDir.x * FLOAT_ACCEL, -lim, lim);
  v.ydir = clamp(v.ydir + v.comDir.y * FLOAT_ACCEL, -lim, lim);
}

const FLOATING: ReadonlySet<VehicleAction> = new Set(['Float', 'FloatIdle', 'FloatPropel', 'Turn', 'WaterLaunch']);

/** A pushing clonk works the vehicle's speed towards its own walking speed (C4Object::Push). */
function push(v: Vehicle, txdir: number): void {
  const force = (PUSH_FORCE * 100) / v.mass;
  if (Math.abs(v.xdir - txdir) <= force) v.xdir = txdir;
  else v.xdir += v.xdir < txdir ? force : -force;
  if (v.xdir < 0) v.dir = -1;
  if (v.xdir > 0) v.dir = 1;
}

/** Whatever stands on the vehicle's floor, and whoever holds on to it: they move with it. */
function riders(world: World, v: Vehicle): (Clonk | Item)[] {
  const m = v.mask;
  if (!m?.placed) return [];
  const x0 = m.x;
  const x1 = m.x + m.shape.w;
  const out: (Clonk | Item)[] = [];
  for (const c of world.clonks) {
    if (c.contained) continue;
    if (c.vehicle === v || (c.x >= x0 && c.x < x1 && c.y + 10 === m.y)) out.push(c);
  }
  for (const it of world.items) {
    if (!it.container && !it.removed && it.x >= x0 && it.x < x1 && it.y + 1 === m.y) out.push(it);
  }
  return out;
}

/**
 * One tick of a vehicle: its script, then gravity or floating, pushing,
 * moving, and its floor put back into the landscape at the new place,
 * taking along whatever stands on it.
 */
export function stepVehicle(world: World, v: Vehicle): void {
  const { land } = world;
  const pushers = v.burned ? [] : pushersOf(world, v);
  const ride = riders(world, v);
  const x0 = v.x;
  const y0 = v.y;
  v.mask?.remove(land);

  if (!v.burned) script(world, v, pushers);
  if (!v.burned && FLOATING.has(v.action)) doFloat(v);
  else doGravity(world, v);
  if (v.grab === 1 && !v.burned) {
    const p = pushers[0];
    if (p) push(v, p.comDir.x * PUSH_SPEED);
  }
  if (v.clearX) {
    v.xdir = Math.abs(v.xdir) <= FLOAT_ACCEL ? 0 : v.xdir - Math.sign(v.xdir) * FLOAT_ACCEL;
    if (v.xdir === 0) v.clearX = false;
  }
  if (v.clearY) {
    v.ydir = Math.abs(v.ydir) <= FLOAT_ACCEL ? 0 : v.ydir - Math.sign(v.ydir) * FLOAT_ACCEL;
    if (v.ydir === 0) v.clearY = false;
  }
  v.doMovement(land);
  v.actTime++;

  // Entering a liquid switches to the InLiquidAction.
  const wet = inLiquid(world, v);
  if (wet && !v.wasInLiquid && !v.burned) {
    if (v.action === 'OnLand') v.setAction('InWater');
    else if (v.action === 'Float' || v.action === 'FloatIdle' || v.action === 'FloatPropel') {
      v.setAction('WaterLand');
      v.windX = v.windY = false;
    }
  }
  v.wasInLiquid = wet;

  // The floor goes back in at the new place, and what stood on it comes along.
  if (v.hasMask) {
    v.mask ??= v.makeMask();
    const m = v.def.mask!;
    v.mask!.place(land, v.left + m.x, v.top + m.y);
  } else v.mask = null;
  const dx = v.x - x0;
  const dy = v.y - y0;
  if (dx || dy) {
    for (const o of ride) {
      carryTo(world, o, o.x + dx, o.y + dy);
    }
  }
  // Its load goes where it goes.
  for (const it of v.contents) it.setPosition(v.x, v.y);
  collect(world, v);
}

/** Steps a carried clonk or item may go up to keep up with its vehicle on uneven ground. */
const CARRY_STEP = 3;

/**
 * Take a rider or pilot along to (x, y). Where the ground there is a little
 * higher (the edge of a building's basement, a bump), it steps up onto it
 * instead of staying behind, the way a clonk walks up a slope.
 */
function carryTo(world: World, o: Clonk | Item, x: number, y: number): void {
  for (let up = 0; up <= CARRY_STEP; up++) {
    if (contactCheck(world.land, o.vertices, x, y - up).count) continue;
    o.setPosition(x, y - up);
    return;
  }
}

// ------------------------------------------------------------------ scripts

function script(world: World, v: Vehicle, pushers: Clonk[]): void {
  switch (v.def.id) {
    case 'boat':
      return boatScript(world, v, pushers);
    case 'balloon':
      return balloonScript(world, v, pushers);
    case 'blimp':
      return blimpScript(world, v, pushers);
    case 'lorry':
      // Nothing runs on its own; see collect and lorryControl.
      return;
  }
}

/**
 * Sailboat.c4d: pushed into the water, it lowers its sail (InWater, every 5
 * ticks Floating). Sailing, every 20 ticks the wind and its pilot set its
 * speed (Wind2Sail). Raising the sail (double up) turns it back into a boat
 * to push onto land (RaiseSail, LandOn, JustLanded for 150 ticks).
 */
function boatScript(world: World, v: Vehicle, pushers: Clonk[]): void {
  switch (v.action) {
    case 'InWater':
      if (v.actTime % 5 !== 0) return;
      // Floating: the boat is always upright here, so it sets sail at once.
      if (!inLiquid(world, v)) return v.setAction('OnLand');
      v.setAction('LowerSail');
      world.events.push({ type: 'vehicle', sound: 'SailDown', x: v.x, y: v.y, tick: world.tick });
      return;
    case 'LowerSail':
      if (v.actTime >= 10) {
        v.setAction('Sailing');
        v.drift = true;
      }
      return;
    case 'Sailing': {
      if (v.actTime % 20 !== 0) return;
      // Wind2Sail
      if (!pushers.length) {
        v.comDir = STOP;
        v.drift = true;
      }
      const windPush = clamp(div(wind(world, v), 4), -10, 10);
      const xdir = 7 + div(windPush, 5);
      if (v.drift) v.xdir = windPush / 10;
      else if (v.comDir.x < 0) v.xdir = -xdir / 10;
      else if (v.comDir.x > 0) v.xdir = xdir / 10;
      return;
    }
    case 'RaiseSail':
      if (v.actTime >= 10) {
        // LandOn
        v.comDir = STOP;
        v.drift = false;
        v.setAction('JustLanded');
        for (const c of pushers) c.letGo();
      }
      return;
    case 'JustLanded':
      if (v.actTime >= 150) v.setAction('OnLand');
      return;
  }
}

/**
 * Balloon.c4d: it floats up or down as its pilot says and drifts with the
 * wind (every 18 ticks Wind2Float). Without a pilot it sinks. Idle in the air
 * it bobs up and down a little (IntWindYDir). On the water it sits until
 * told to go up (WaterLand, WaterLaunch).
 */
function balloonScript(world: World, v: Vehicle, pushers: Clonk[]): void {
  if (v.action === 'WaterLaunch' && v.actTime >= 18) v.setAction('Float');
  if (world.tick % 10 === 0 && v.windY) windBob(world, v);
  if (world.tick % 18 !== 0) return;
  // Wind2Float
  if (!onGround(world, v)) v.xdir = clamp(div(wind(world, v), 4), -10, 10) / 10;
  if (!pushers.length) v.comDir = { x: 0, y: 1 };
  balloonCheckWindY(world, v);
  // Wind2Flag
  v.flagDir = clamp(div(wind(world, v), 10) + 4, 0, 8);
}

/** CheckWindY: bob in the air when told to stop, sink when on the ground. */
function balloonCheckWindY(world: World, v: Vehicle): void {
  if (isStop(v.comDir) && !solidBelow(world, v)) v.windY = true;
  else {
    v.windY = false;
    if (isStop(v.comDir)) v.comDir = { x: 0, y: 1 };
  }
}

/** FxIntWindYDirTimer: up and down by a tenth now and then, up to 0.3 pixels a tick. */
function windBob(world: World, v: Vehicle): void {
  const yd = tenths(v.ydir);
  const lo = Math.min(-yd, 0);
  const rx = lo + world.rng.int(Math.abs(yd) + 1);
  const n = clamp(yd + rx - 1 + world.rng.int(3), Math.max(yd - 1, -3), Math.min(yd + 1, 3));
  v.ydir = n / 10;
}

/** Balloon SetDirection: up or down, or stop (letting the speed run out). */
function balloonSetDirection(world: World, v: Vehicle, d: Dir): void {
  if (d.y < 0) v.comDir = { x: 0, y: -1 };
  else if (d.y > 0) v.comDir = { x: 0, y: 1 };
  else {
    v.clearY = true;
    v.comDir = STOP;
  }
  balloonCheckWindY(world, v);
}

/**
 * Blimp.c4d: steered in any direction with its propeller (FloatPropel).
 * Steering the other way it turns round first (Turn), carrying its pilots to
 * the other side. Idle, it drifts with the wind (IntWindXDir) and bobs.
 */
function blimpScript(world: World, v: Vehicle, pushers: Clonk[]): void {
  const t = v.actTime;
  switch (v.action) {
    case 'FloatIdle':
      if (t % 50 === 0) floatProcess(world, v, pushers);
      break;
    case 'FloatPropel':
      if (t % BLIMP.propel === 0) {
        if (!pushers.length) floatIdleDown(v);
        else checkCommandAction(world, v);
      }
      break;
    case 'Turn':
      turnStep(world, v, t);
      break;
    case 'WaterLaunch':
      if (t >= 50) {
        v.setAction('FloatIdle');
        floatProcess(world, v, pushers);
      }
      break;
  }
  if (v.windX && world.tick % 5 === 0) {
    if (v.action !== 'FloatIdle' && v.action !== 'WaterLand') v.windX = false;
    else if (!onGround(world, v)) {
      const xd = tenths(v.xdir);
      v.xdir = clamp(div(wind(world, v), 4), Math.max(xd - 2, -10), Math.min(xd + 2, 10)) / 10;
    }
  }
  if (v.windY && world.tick % 10 === 0) {
    if (solidBelow(world, v)) v.windY = false;
    else windBob(world, v);
  }
}

function floatProcess(world: World, v: Vehicle, pushers: Clonk[]): void {
  v.windX = true;
  if (!solidBelow(world, v)) v.windY = true;
  if (!pushers.length) floatIdleDown(v);
  checkCommandAction(world, v);
}

function floatIdleDown(v: Vehicle): void {
  v.setAction('FloatIdle');
  v.comDir = { x: 0, y: 1 };
}

/** Turn round when flying away from where it faces; with nowhere to go, idle. */
function checkCommandAction(world: World, v: Vehicle): void {
  if (v.action === 'FloatPropel') {
    if (v.comDir.x > 0 && v.dir < 0) return startTurn(world, v, 1);
    if (v.comDir.x < 0 && v.dir > 0) return startTurn(world, v, -1);
  }
  if (isStop(v.comDir)) blimpSetDirection(world, v, STOP);
}

function startTurn(world: World, v: Vehicle, dir: -1 | 1): void {
  v.dir = dir;
  v.setAction('Turn');
  // TurnStart: remember where the pilots stand, to carry them round.
  v.turnRiders = pushersOf(world, v).map((c) => ({ id: c.id, dx: c.x - v.x }));
  world.events.push({ type: 'vehicle', sound: 'Propel', x: v.x, y: v.y, tick: world.tick });
}

/** FxIntTurnTimer: the pilots swing round to the other side along a sine curve. TurnEnd at the last frame. */
function turnStep(world: World, v: Vehicle, t: number): void {
  const total = BLIMP.turnFrames * BLIMP.turnDelay;
  const phase = (t * 180) / total - 90;
  const pos = Math.sin((phase * Math.PI) / 180) * 50 + 50;
  for (const r of v.turnRiders) {
    const c = world.clonks.find((o) => o.id === r.id);
    if (!c || c.vehicle !== v || c.action.procedure !== 'push') continue;
    if (t === total / 2) c.dir = v.dir;
    const x = t >= total ? v.x - r.dx : v.x + r.dx - Math.trunc((r.dx * 2 * pos) / 100);
    carryTo(world, c, x, c.y);
  }
  if (t < total) return;
  v.turnRiders = [];
  v.setAction('FloatPropel');
  if (v.turnEnd) {
    const d = v.turnEnd;
    v.turnEnd = null;
    blimpSetDirection(world, v, d);
  }
}

/** Blimp SetDirection. */
function blimpSetDirection(world: World, v: Vehicle, d: Dir): void {
  if (v.action === 'Turn') {
    v.turnEnd = d;
    if (isStop(d) || (d.x > 0 && v.dir < 0) || (d.x < 0 && v.dir > 0)) return;
  }
  v.comDir = d;
  if (v.action !== 'Turn' && v.action !== 'WaterLaunch') {
    if (!isStop(d) && v.action !== 'FloatPropel') v.setAction('FloatPropel');
    if (isStop(d) && v.action !== 'FloatIdle') v.setAction('FloatIdle');
  }
  // Only up or down: the sideways speed runs out; only sideways or stop: the
  // vertical speed runs out, and it bobs a little.
  v.clearX = v.clearY = false;
  if (d.x === 0 && d.y !== 0) v.clearX = true;
  if (d.y === 0) {
    v.clearY = true;
    v.windY = true;
  } else v.windY = false;
  if (d.x > 0 && v.dir < 0) startTurn(world, v, 1);
  else if (d.x < 0 && v.dir > 0) startTurn(world, v, -1);
  // Landing: keep pressing down, or it hops straight back up.
  if (isStop(d) && solidBelow(world, v)) v.comDir = { x: 0, y: 1 };
}

// ----------------------------------------------------------------- controls

/** The direction the jump'n'run keys hold. */
function heldDir(ctl: ControlState): Dir {
  return { x: ctl.left ? -1 : ctl.right ? 1 : 0, y: ctl.up ? -1 : ctl.down ? 1 : 0 };
}

/**
 * Controls for a clonk holding on to a vehicle (DFA_PUSH in
 * C4Object::DirectCom, and the vehicles' Control functions). Down twice lets
 * go; throw lets go and throws. A vehicle it pushes (the boat on land) goes
 * where it walks. A vehicle it steers (VehicleControl) gets the controls:
 * with jump'n'run keys the held direction (ControlUpdate), with classic keys
 * each press (ControlUp, ControlDownSingle, ControlLeft, ControlRight).
 */
export function vehicleControl(world: World, c: Clonk, ctl: ControlState, throwIt: () => void, enter: () => boolean): void {
  const v = c.vehicle;
  if (!v || v.removed || v.burned) return c.letGo();
  const classic = c.controlStyle === 'classic';
  if (c.loadMenu !== null) return loadMenuControl(world, c, v, ctl);
  if (ctl.doubleDown) {
    world.events.push({ type: 'grab', x: c.x, y: c.y, tick: world.tick });
    return c.letGo();
  }
  if (ctl.pressedThrow) {
    // The lorry (GrabPutGet): throw puts in what the clonk carries, or with
    // empty hands opens the menu of what's in it (ObjectComPutTake).
    if (v.def.collection) return putOrGet(world, c, v);
    c.letGo();
    return throwIt();
  }
  if (!v.steered) {
    // Up with it in a doorway pushes it in (ObjectComEnter).
    if (ctl.pressedUp && !v.def.noPushEnter && enter()) return;
    // Pushing: walk it along.
    if (classic) {
      if (ctl.pressedLeft) c.comDir = { x: -1, y: 0 };
      if (ctl.pressedRight) c.comDir = { x: 1, y: 0 };
      if (ctl.pressedDown) c.comDir = { x: 0, y: 0 };
    } else c.comDir = { x: ctl.left ? -1 : ctl.right ? 1 : 0, y: 0 };
    return;
  }
  const up = ctl.pressedUp;
  const doubleUp = up && world.tick - v.lastUp <= DOUBLE_TICKS;
  if (up) v.lastUp = world.tick;
  switch (v.def.id) {
    case 'boat': {
      if (doubleUp && v.action === 'Sailing') {
        v.setAction('RaiseSail');
        world.events.push({ type: 'vehicle', sound: 'SailUp', x: v.x, y: v.y, tick: world.tick });
        return;
      }
      if (classic) {
        if (ctl.pressedLeft) setBoat(v, -1);
        if (ctl.pressedRight) setBoat(v, 1);
        // Not in the original: down stops, like letting go of the keys.
        if (ctl.pressedDown) setBoat(v, 0);
        return;
      }
      const d = heldDir(ctl);
      if (!v.held || v.held.x !== d.x) setBoat(v, d.x);
      v.held = d;
      return;
    }
    case 'balloon': {
      if (up && v.action === 'WaterLand') v.setAction('WaterLaunch');
      if (classic) {
        if (up) {
          // ControlUp: on the ground it always goes up; in the air up stops it sinking.
          const sinking = !solidBelow(world, v) && v.comDir.y > 0;
          balloonSetDirection(world, v, sinking ? STOP : { x: 0, y: -1 });
        } else if (ctl.pressedDown) balloonSetDirection(world, v, v.comDir.y < 0 ? STOP : { x: 0, y: 1 });
        return;
      }
      const d = heldDir(ctl);
      if (!v.held || !same(v.held, d)) balloonSetDirection(world, v, d);
      v.held = d;
      return;
    }
    case 'blimp': {
      if (up && v.action === 'WaterLand') v.setAction('WaterLaunch');
      if (classic) {
        const press = (to: Dir): void => {
          const cur = v.action === 'FloatIdle' ? STOP : v.comDir;
          blimpSetDirection(world, v, comDirTransform(cur, to));
        };
        if (up) press({ x: 0, y: -1 });
        else if (ctl.pressedDown) press({ x: 0, y: 1 });
        else if ((ctl.pressedLeft || ctl.pressedRight) && v.action !== 'Turn') {
          if (v.action !== 'WaterLand') v.setAction('FloatPropel');
          press({ x: ctl.pressedLeft ? -1 : 1, y: 0 });
        }
        return;
      }
      const d = heldDir(ctl);
      if (!v.held || !same(v.held, d)) blimpSetDirection(world, v, d);
      v.held = d;
      return;
    }
  }
}

/** Throw at a lorry: put in what's carried, or open the Get menu. */
function putOrGet(world: World, c: Clonk, v: Vehicle): void {
  c.comDir = STOP;
  const item = c.carrying;
  if (!item) {
    if (v.contents.length) c.loadMenu = 0;
    else world.say(c.owner, `The ${v.def.name.toLowerCase()} is empty`);
    return;
  }
  if (v.full) return world.say(c.owner, `${v.def.name} is full!`);
  c.contents.splice(c.contents.indexOf(item), 1);
  putIn(world, v, item);
}

/**
 * The Get menu (C4MN_Get, C4Menu::Control): the arrow keys choose, throw
 * takes one into the clonk's hands, dig closes it.
 */
function loadMenuControl(world: World, c: Clonk, v: Vehicle, ctl: ControlState): void {
  const list = loadList(v);
  c.comDir = STOP;
  if (!list.length || ctl.pressedDig) {
    c.loadMenu = null;
    return;
  }
  const i = menuMove(c.loadMenu ?? 0, list.length, ctl);
  c.loadMenu = i;
  if (!ctl.pressedThrow) return;
  c.loadMenu = null;
  if (c.contents.length >= CLONK.maxContents) return world.say(c.owner, 'Hands full: put it in first');
  const it = [...v.contents].reverse().find((o) => o.def.id === list[i].id)!;
  takeOut(v, it);
  it.container = c;
  c.contents.push(it);
  world.events.push({ type: 'collect', clonk: c, item: it, tick: world.tick });
}

/** Sailboat ControlUpdate / ControlLeft / ControlRight. */
function setBoat(v: Vehicle, x: -1 | 0 | 1): void {
  v.comDir = { x, y: 0 };
  v.drift = false;
}
