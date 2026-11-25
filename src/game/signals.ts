// Railway signals (Structures.c4d/Signal.c4d) and the steam engine's and
// wagon's signal scripts (SteamEngine.c4d CheckSignal, SignalDelay,
// DepartFromSignal; Wagon.c4d SignalCall, SignalLoad, SignalUnload).
// See licenses/clonk_engine_license.txt.

import type { Clonk, ControlState } from '../objects/clonk';
import type { Structure } from '../objects/structure';
import type { Vehicle } from '../objects/vehicle';
import { productionSound } from './power';
import { putIn, takeOut } from './vehicles';
import type { World } from './world';

export const SIGNAL = {
  /** The engine counts down its wait at a signal every 15 ticks (Timer=15, SignalDelay). */
  timer: 15,
  /** It waits this many counts when it stops (iWait = 9) and leaves at 2. */
  wait: 9,
  depart: 2,
  /** What the wagon loads at a signal: around it (FindObject(0, -11, -6, 20, 20)). */
  loadBox: { x: -11, y: -6, w: 20, h: 20 },
};

/** Phase 0: go through. 1: halt, then go right. 2: halt, then go left. 3: halt, then go on. */
export const SIGNAL_PHASES = ['Through', 'Halt and turn right', 'Halt and turn left', 'Halt and go'] as const;
/** Load setting (the signal's Dir): 0 nothing, 1 unload, 2 load. */
export const SIGNAL_LOADS = ['No loading', 'Unload', 'Load'] as const;

/**
 * Holding on to a signal (Grab=2: it can't be pushed): down sets it to go
 * through, up to halt and go, left and right to halt and turn that way,
 * throw switches between no loading, unloading and loading. Dig lets go.
 * Returns true if it took the keys.
 */
export function signalControl(world: World, c: Clonk, s: Structure, ctl: ControlState): boolean {
  if (s.def.id !== 'signal') return false;
  const g = s.signal;
  let said: string | null = null;
  if (ctl.pressedDown) g.phase = 0;
  else if (ctl.pressedUp) g.phase = 3;
  else if (ctl.pressedLeft) g.phase = 2;
  else if (ctl.pressedRight) g.phase = 1;
  else if (ctl.pressedThrow) {
    g.load = (g.load + 1) % 3;
    said = SIGNAL_LOADS[g.load];
  } else if (ctl.pressedDig) {
    c.letGo();
    return true;
  } else return true;
  productionSound(world, 'SignalClick', s.x, s.y);
  world.say(c.owner, `Signal: ${said ?? SIGNAL_PHASES[g.phase]}`);
  return true;
}

/** The signal the engine stands at (FindObject(SGNL, 0, +1)): a finished one whose shape takes in the point below the engine. */
function signalAt(world: World, v: Vehicle): Structure | null {
  return world.structures.find((s) => s.def.id === 'signal' && s.complete && !s.gone && s.inside(v.x, v.y + 1)) ?? null;
}

/**
 * CheckSignal, each new phase of the engine's wheels and when it's stopped:
 * at a signal that isn't set to go through it stops, and the signal tells
 * the wagon it pulls to load or unload. Returns true if it stopped.
 */
export function checkSignal(world: World, e: Vehicle): boolean {
  if (e.signalWait) return false;
  const s = signalAt(world, e);
  if (!s || !s.signal.phase) return false;
  // TrainArrive: pass the load setting on to the wagon.
  const w = e.pulling;
  if (s.signal.load && w?.def.id === 'wagon') {
    if (s.signal.load === 2) wagonLoad(world, w);
    else wagonUnload(world, w);
  }
  e.signalWait = SIGNAL.wait;
  e.comDir = { x: 0, y: 0 };
  return true;
}

/** SignalDelay, every 15 ticks: count down the wait, and leave as set when it's nearly over. */
export function signalDelay(world: World, e: Vehicle): void {
  if (world.tick % SIGNAL.timer !== 0 || !e.signalWait) return;
  if (--e.signalWait !== SIGNAL.depart) return;
  const s = signalAt(world, e);
  if (!s || !s.signal.phase) return;
  const p = s.signal.phase;
  const x: -1 | 1 = p === 1 ? 1 : p === 2 ? -1 : e.dir;
  e.comDir = { x, y: 0 };
  productionSound(world, 'Click', e.x, e.y);
}

/** A player steering the engine: left or right hold the signal count off (iWait = 2), stop looks for a signal. */
export function engineSteered(world: World, e: Vehicle, x: -1 | 0 | 1): void {
  if (x) {
    e.signalWait = SIGNAL.depart;
    return;
  }
  e.signalWait = 0;
  checkSignal(world, e);
}

/** SignalLoad: the loose things around the wagon go into it, as many as fit. */
export function wagonLoad(world: World, w: Vehicle): number {
  const b = SIGNAL.loadBox;
  let n = 0;
  for (const it of world.items) {
    if (it.container || it.removed) continue;
    if (it.x < w.x + b.x || it.x >= w.x + b.x + b.w || it.y < w.y + b.y || it.y >= w.y + b.y + b.h) continue;
    if (putIn(world, w, it)) n++;
  }
  return n;
}

/** SignalUnload: everything in the wagon comes out (Exit). */
export function wagonUnload(world: World, w: Vehicle): number {
  const out = [...w.contents];
  for (const it of out) {
    takeOut(w, it);
    it.setPosition(w.x, w.y);
    it.xdir = (world.rng.int(21) - 10) / 10;
    it.ydir = -1;
    it.noCollect = 10;
  }
  if (out.length) world.events.push({ type: 'vehicle', sound: 'Clonk', x: w.x, y: w.y, tick: world.tick });
  return out.length;
}
