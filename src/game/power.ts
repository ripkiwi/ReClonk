// Power: the buildings' energy, power lines and pipes laid with a line kit,
// the power plant and the windmill, pumps and the derrick. Ported from the
// original content (Structures.c4d: PowerPlant, Windmill, Pump, Derrick,
// Lines.c4d; Items.c4d/Equipment.c4d/Linekit.c4d) and the engine's energy
// rules (C4Object.cpp ExecAction EnergyUsage, ExecLife; C4Script.cpp
// EnergyCheck, CheckEnergyNeedChain). See licenses/clonk_engine_license.txt.

import { Mat, MATERIALS, type ItemId } from '../landscape/materials';
import type { Clonk, ControlState } from '../objects/clonk';
import { ITEMS } from '../objects/defs';
import type { Item } from '../objects/item';
import { endPoint, LINE_NAMES, Line, lineConnect, reduceLine, type LineEnd, type LineKind } from '../objects/line';
import { Structure } from '../objects/structure';
import type { World } from './world';

/** What can be connected to a building (DefCore LineConnect). */
export const LC = { powerIn: 1, powerOut: 2, liquidIn: 4, liquidOut: 8, generator: 16, consumer: 32, pump: 64 } as const;

const P = LC.powerIn | LC.powerOut | LC.consumer;
/** The buildings' LineConnect, from their DefCore.txt. */
export const LINE_CONNECT: Record<string, number> = {
  sawmill: P,
  workshop: P,
  chemicalPlant: P,
  researchLab: P,
  elevator: P,
  cannonTower: P | LC.liquidIn,
  pump: P | LC.liquidIn | LC.liquidOut | LC.pump,
  derrick: P | LC.liquidOut | LC.pump,
  powerPlant: LC.powerOut | LC.generator | LC.liquidIn,
  windmill: LC.powerOut | LC.generator,
  hut: LC.liquidIn,
  bambooHut: LC.liquidIn,
  cabin: LC.liquidIn,
  igloo: LC.liquidIn,
  smallCastle: LC.liquidIn,
  castle: LC.liquidIn,
  darkCastle: LC.liquidIn,
};

export const POWER = {
  /** Energy is kept like the original's: 1000 to a point, 100 points (Physical Energy 100000) in a building. */
  unit: 1000,
  /** A power line passes on a third of what its source has, at most 20 points and up to what the other end can take, every 10 ticks. */
  lineInterval: 10,
  lineMax: 20,
  /** Pipes move 3 pixels every 5 ticks, if the pump has 1 point of energy (EnergyCheck(1000)). */
  pipeInterval: 5,
  pipePixels: 3,
  pipeEnergy: 1000,
  /** Buildings that aren't a base lose a point every 10 ticks (ExecLife "nonlife normal energy loss"). */
  drainInterval: 10,
  /** The power plant gives 25 points every 8 ticks (its Burning action), for 2000 ticks on one load of fuel. */
  plant: { every: 8, gain: 25, burnTime: 2000 },
  /** It looks at what's in it every 35 ticks (ContentsCheck, the default Timer). */
  checkInterval: 35,
  /** The windmill's wing turns at wind/4 tenths of a degree a tick and gives 5 points for each, every 15 ticks (Wind2Turn). */
  wing: { every: 15, factor: 5 },
  /** The pump uses 350 a tick while it pumps (EnergyUsage); its Pump action checks every 60 ticks, its Wait every 50. */
  pump: { usage: 350, pumpCheck: 60, waitCheck: 50, frames: 20, delay: 3, capacity: 12 },
  /** The derrick's pump: 350 a tick, checks every 40 ticks (20 frames of 2). Its drill head starts 36 below it. */
  derrick: { usage: 350, pumpCheck: 40, waitCheck: 50, head: 36, transferEvery: 5, startEnergy: 1000 },
  /** A line kit finds a building 1 pixel right of the clonk; the engine's Energy command walks at most 650 pixels for one. */
  kitRange: 650,
};

/** The Power usage rule (ENRG): without it, buildings work without power (EnergyCheck always passes). */
export function powerRule(world: World): boolean {
  return world.rules.has('energy');
}

export function lineConnectOf(s: Structure): number {
  return LINE_CONNECT[s.def.id] ?? 0;
}

/** Energy points (GetEnergy), 0 to 100. */
export function energyPoints(s: Structure): number {
  return Math.trunc(s.energy / POWER.unit);
}

/** DoEnergy: add (or take) points, within what the building holds. */
export function doEnergy(s: Structure, points: number): void {
  s.energy = Math.max(0, Math.min(s.def.energy, s.energy + points * POWER.unit));
}

/**
 * EnergyCheck: does the building have `amount` (in 1/1000 points)? Without
 * the Power usage rule, or for something that doesn't use power, it always
 * does. If it doesn't, it needs energy: power plants connected to it start up.
 */
export function energyCheck(world: World, s: Structure, amount: number): boolean {
  if (!powerRule(world) || s.energy >= amount || !(lineConnectOf(s) & LC.consumer)) {
    s.needEnergy = false;
    return true;
  }
  s.needEnergy = true;
  return false;
}

/**
 * An action's EnergyUsage (ExecAction): with the Power usage rule it takes
 * `usage` each tick, and with too little the action stands still. Returns
 * false while it's out of power.
 */
export function usePower(world: World, s: Structure, usage: number): boolean {
  if (!powerRule(world) || !usage) return true;
  if (usage <= s.energy) {
    s.energy -= usage;
    s.needEnergy = false;
    return true;
  }
  s.needEnergy = true;
  return false;
}

/**
 * CheckEnergyNeedChain: does anything this building passes power on to,
 * along its power lines and further, need energy?
 */
export function needsEnergyChain(world: World, s: Structure, seen = new Set<Structure>()): boolean {
  if (seen.has(s)) return false;
  seen.add(s);
  if (lineConnectOf(s) & LC.consumer && s.needEnergy) return true;
  for (const l of world.lines) {
    if (l.removed || l.kind !== 'power' || l.from !== s || !(l.to instanceof Structure)) continue;
    if (needsEnergyChain(world, l.to, seen)) return true;
  }
  return false;
}

/** Has a power line connected to it (FindObject(PWRL, ..., "Connect", obj)). */
export function hasPowerLine(world: World, s: Structure): boolean {
  return world.lines.some((l) => !l.removed && l.kind === 'power' && (l.from === s || l.to === s));
}

/** The lines hanging from something. */
export function linesOf(world: World, e: LineEnd): Line[] {
  return world.lines.filter((l) => !l.removed && (l.from === e || l.to === e));
}

/** Sounds of power and production (Sound.c4g and the buildings' own). */
export type ProductionSound =
  | 'Connect' | 'LineBreak' | 'Error' | 'Click' | 'MetalHit3' | 'PowerPlant' | 'Sawmill' | 'Gear' | 'GateOpen' | 'GateClose'
  | 'SteelGate2' | 'Pshshsh' | 'Clonk' | 'AnvilWork' | 'SignalClick' | 'FlameThrower' | 'LightningCannon' | 'LightningLoad'
  | 'Electric' | 'Splash';

export function productionSound(world: World, sound: ProductionSound, x: number, y: number): void {
  world.events.push({ type: 'production', sound, x, y, tick: world.tick });
}

const lineSound = productionSound;

// ------------------------------------------------------------------ line kit

/**
 * The building a line kit can lay a line from (OCF_LineConstruct at the
 * clonk's position): a finished one that takes lines.
 */
function kitTarget(world: World, c: Clonk): Structure | null {
  for (const s of world.structures) if (s.complete && lineConnectOf(s) && s.inside(c.x + 1, c.y)) return s;
  return null;
}

/** The kind of line a new one from here is (DefaultLineType, the derrick's LineConnectType). */
function newLineKind(world: World, s: Structure): LineKind | null {
  const lc = lineConnectOf(s);
  const from = (kind: LineKind): boolean => world.lines.some((l) => !l.removed && l.kind === kind && l.from === s);
  if (s.def.id === 'derrick') return from('drain') ? 'power' : 'drain';
  if (lc & LC.pump && lc & LC.liquidIn && !from('source')) return 'source';
  if (lc & LC.pump && lc & LC.liquidOut && !from('drain')) return 'drain';
  if (lc & LC.powerOut) return 'power';
  if (lc & LC.pump) return 'source';
  return null;
}

/**
 * Use a line kit (Linekit.c4d Activate). At a building with no line on the
 * kit yet, a new line starts there and the kit carries its other end. At the
 * next building it's connected, if that building can take it, and the kit is
 * used up. Back at the building it started from, the line is taken away
 * again. Returns false if the clonk doesn't carry a kit.
 */
export function useLinekit(world: World, c: Clonk): boolean {
  const kit = c.carrying;
  if (kit?.def.id !== 'linekit') return false;
  c.comDir = { x: 0, y: 0 };
  const s = kitTarget(world, c);
  if (!s) {
    world.say(c.owner, 'Cannot create a new line here.');
    return true;
  }
  const line = linesOf(world, kit)[0];
  if (line) {
    if (line.from === s || line.to === s) {
      line.removed = true;
      world.say(c.owner, `${LINE_NAMES[line.kind]} disconnected.`);
      lineSound(world, 'Connect', c.x, c.y);
      return true;
    }
    connectLine(world, c, kit, line, s);
    return true;
  }
  const kind = newLineKind(world, s);
  if (!kind) {
    lineSound(world, 'Error', c.x, c.y);
    world.say(c.owner, 'Cannot create a new line here.');
    return true;
  }
  world.lines.push(new Line(kind, s, kit, c.owner, world.tick));
  world.say(c.owner, `New ${LINE_NAMES[kind].toLowerCase()}`);
  lineSound(world, 'Connect', c.x, c.y);
  return true;
}

/** ConnectLine: hang the kit's end of the line on `to`, if it can take that kind of line. */
function connectLine(world: World, c: Clonk, kit: Item, line: Line, to: Structure): void {
  const lc = lineConnectOf(to);
  // The end that stays where it is, and the one that moves from the kit to `to`.
  let t1: LineEnd = line.from;
  let t2: LineEnd = to;
  if (t1 === kit) {
    t2 = line.to;
    t1 = to;
  }
  let ok = false;
  if (line.kind === 'power') ok = (t1 === to && !!(lc & LC.powerOut)) || (t2 === to && !!(lc & LC.powerIn));
  else if (line.kind === 'source') {
    // A pump takes only one source pipe.
    if (t1 === to && lc & LC.pump && lc & LC.liquidIn) ok = !world.lines.some((l) => !l.removed && l.kind === 'source' && l.from === to);
    if (t2 === to && lc & LC.liquidOut) ok = true;
  } else ok = (t1 === to && !!(lc & LC.pump) && !!(lc & LC.liquidOut)) || (t2 === to && !!(lc & LC.liquidIn));
  if (!ok) {
    lineSound(world, 'Error', c.x, c.y);
    world.say(c.owner, `${LINE_NAMES[line.kind]} cannot be connected to ${to.def.name}.`);
    return;
  }
  line.from = t1;
  line.to = t2;
  world.say(c.owner, `${LINE_NAMES[line.kind]} connected to ${to.def.name}.`);
  lineSound(world, 'Connect', c.x, c.y);
  c.contents.splice(c.contents.indexOf(kit), 1);
  kit.container = null;
  kit.removed = true;
}

// ------------------------------------------------------------------ lines

/** A line's end is still there: a finished building, or a line kit that hasn't been used up. */
function endValid(e: LineEnd): boolean {
  return e instanceof Structure ? e.complete && !e.gone : !e.removed;
}

/** LineBreak: the line snaps (with a message, unless an end simply went away). */
function breakLine(world: World, l: Line, message: boolean): void {
  l.removed = true;
  const p = endPoint(l.to instanceof Structure ? l.from : l.to);
  lineSound(world, 'LineBreak', p.x, p.y);
  if (message && l.owner >= 0) world.say(l.owner, `${LINE_NAMES[l.kind]} broke.`);
}

/**
 * Each tick (DFA_CONNECT): a line follows its ends and bends around the
 * landscape, every 35 ticks it straightens where it can, and it does its
 * work: a power line passes on energy, a pipe moves liquid.
 */
export function stepLines(world: World): void {
  const { land } = world;
  for (const l of world.lines) {
    if (l.removed) continue;
    if (!endValid(l.from) || !endValid(l.to)) {
      breakLine(world, l, false);
      continue;
    }
    const a = endPoint(l.from);
    const b = endPoint(l.to);
    if (!lineConnect(land, l, 0, a.x, a.y) || !lineConnect(land, l, l.xs.length - 1, b.x, b.y)) {
      breakLine(world, l, true);
      continue;
    }
    if (world.tick % 35 === 0) reduceLine(land, l, world.tick % 2 === 0);
    const age = world.tick - l.born;
    if (l.kind === 'power' && age % POWER.lineInterval === 0) transferPower(l);
    else if (l.kind === 'source' && age % POWER.pipeInterval === 0) sourceTransfer(world, l);
    else if (l.kind === 'drain' && age % POWER.pipeInterval === 0) drainTransfer(world, l);
  }
  if (world.lines.some((l) => l.removed)) world.lines = world.lines.filter((l) => !l.removed);
}

/** PowerLine Transfer: a third of what the source has, at most 20 points, as much as the other end can take. */
function transferPower(l: Line): void {
  if (!(l.from instanceof Structure) || !(l.to instanceof Structure)) return;
  const from = l.from;
  const to = l.to;
  const room = Math.trunc(to.def.energy / POWER.unit) - energyPoints(to);
  const e = Math.min(Math.trunc(energyPoints(from) / 3), room, POWER.lineMax);
  if (e <= 0) return;
  doEnergy(from, -e);
  doEnergy(to, e);
}

// ------------------------------------------------------------------ liquids

/** The full barrel for a liquid (GetBarrelType). */
export function barrelFor(mat: Mat): ItemId | null {
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

/** What a building keeps barrels in: its own tank first, then its contents. */
function barrelsIn(e: LineEnd): Item[] {
  if (!(e instanceof Structure)) return [];
  const out = e.tank ? [e.tank] : [];
  for (const it of e.contents) if (it.def.barrel) out.push(it);
  return out;
}

/** FindFillBarrel: a barrel of this liquid that isn't full, else an empty one (which becomes one for this liquid). */
function fillBarrel(e: LineEnd, id: ItemId): Item | null {
  const bs = barrelsIn(e);
  const max = 200;
  const same = bs.find((b) => b.def.id === id && b.fill < max);
  if (same) return same;
  const empty = bs.find((b) => b.def.id === 'barrel');
  if (!empty) return null;
  empty.def = ITEMS[id];
  empty.fill = 0;
  return empty;
}

/**
 * ObjectInsertMaterial: a pixel of liquid goes into a barrel in the target;
 * with none to take it, it spills out where the target is.
 */
export function insertInto(world: World, mat: Mat, e: LineEnd): void {
  const id = barrelFor(mat);
  const b = id ? fillBarrel(e, id) : null;
  if (b) {
    b.fill++;
    return;
  }
  const p = e instanceof Structure ? { x: e.x, y: e.y } : endPoint(e);
  world.land.insertMaterial(mat, p.x, p.y);
}

/** ObjectExtractLiquid: a pixel out of the first barrel in it that has some, or null. */
export function extractFrom(e: LineEnd): Mat | null {
  for (const b of barrelsIn(e)) {
    const mat = b.def.barrel?.mat;
    if (mat === undefined || mat === null || b.fill <= 0) continue;
    b.fill--;
    if (b.fill <= 0) b.def = ITEMS.barrel;
    return mat;
  }
  return null;
}

/** ExtractLiquid: the liquid at a point, taken out of the landscape (from the top of its pool), or null. */
export function extractLiquid(world: World, x: number, y: number): Mat | null {
  if (!world.land.isLiquid(x, y)) return null;
  return world.land.extractMaterial(x, y);
}

/** Room for `amount` pixels of this liquid in the target's barrels (CheckCapacity). */
function hasCapacity(e: LineEnd, mat: Mat, amount: number): boolean {
  const id = barrelFor(mat);
  if (!id) return false;
  let left = amount;
  for (const b of barrelsIn(e)) {
    if (b.def.id === id) left -= 200 - b.fill;
    else if (b.def.id === 'barrel') left -= 200;
    if (left <= 0) return true;
  }
  return false;
}

/** Pumps and derricks take liquid in only while they pump (AcceptTransfer). */
function acceptsTransfer(s: Structure): boolean {
  return s.activity === 'pump';
}

/**
 * SourcePipe Transfer: the pump draws 3 pixels through it, out of the
 * barrels of what it's connected to, or out of the landscape where its end lies.
 */
function sourceTransfer(world: World, l: Line): void {
  const pump = l.from;
  if (!(pump instanceof Structure) || !acceptsTransfer(pump) || !energyCheck(world, pump, POWER.pipeEnergy)) return;
  const end = l.last;
  for (let i = 0; i < POWER.pipePixels; i++) {
    const mat = extractFrom(l.to) ?? extractLiquid(world, end.x, end.y);
    if (mat === null) continue;
    insertInto(world, mat, pump);
  }
  if (world.rng.int(5) === 0 && world.land.isLiquid(end.x, end.y)) world.events.push({ type: 'bubble', x: end.x, y: end.y, tick: world.tick });
}

/** DrainPipe Transfer: 3 pixels out of the pump's barrels, into the barrels at the other end or out onto the ground there. */
function drainTransfer(world: World, l: Line): void {
  const src = l.from;
  if (!(src instanceof Structure) || !energyCheck(world, src, POWER.pipeEnergy)) return;
  for (let i = 0; i < POWER.pipePixels; i++) {
    const mat = extractFrom(src);
    if (mat === null) return;
    insertInto(world, mat, l.to);
  }
}

/** A pump's source pipe and drain pipe. */
function pipesOf(world: World, s: Structure): { source: Line | null; drain: Line | null } {
  let source: Line | null = null;
  let drain: Line | null = null;
  for (const l of world.lines) {
    if (l.removed || l.from !== s) continue;
    if (l.kind === 'source') source = l;
    if (l.kind === 'drain') drain = l;
  }
  return { source, drain };
}

/** The material a pipe end lies in (GetMaterial(0, 1) below the line kit). */
function materialAt(world: World, e: LineEnd): Mat {
  const p = endPoint(e);
  return world.land.get(p.x, p.y + 1);
}

/**
 * Pump.c4d ReadyToPump: it needs a source pipe. Without a drain pipe, or with
 * one lying loose, it pumps (and spills); into a building only while its
 * barrels have room for 12 more pixels.
 */
function pumpReady(world: World, s: Structure): boolean {
  const { source, drain } = pipesOf(world, s);
  if (!source) return false;
  if (source.to instanceof Structure) return true;
  if (!drain || !(drain.to instanceof Structure)) return true;
  return hasCapacity(drain.to, materialAt(world, source.to), POWER.pump.capacity);
}

/** Derrick.c4d ReadyToPump: like the pump's, with the liquid at the drill head. */
function derrickReady(world: World, s: Structure): boolean {
  const { drain } = pipesOf(world, s);
  if (!drain || !(drain.to instanceof Structure)) return true;
  const d = s.drill;
  const mat = world.land.get(s.x, d ? Math.round(d.y) : s.y);
  return hasCapacity(drain.to, mat, POWER.pump.capacity);
}

/** A new pump or derrick gets its barrel inside (Initialize: CreateContents(BARL)). */
function ensureTank(world: World, s: Structure): void {
  if (s.tank) return;
  const b = world.spawnItem('barrel', s.x, s.y);
  b.container = s;
  b.removed = true; // Kept by the building, not lying about in the world.
  s.tank = b;
  s.activity = 'pump';
  s.actTime = 0;
}

/**
 * The pump's actions: Pump (20 frames of 3 ticks, using 350 power a tick)
 * looks every round whether it can go on, Wait (50 ticks) whether it can start again.
 */
function stepPump(world: World, s: Structure): void {
  ensureTank(world, s);
  const k = s.def.id === 'derrick' ? POWER.derrick : POWER.pump;
  const ready = s.def.id === 'derrick' ? derrickReady : pumpReady;
  if (s.activity === 'pump') {
    if (!usePower(world, s, k.usage)) return;
    s.actTime++;
    if (s.actTime % POWER.pump.delay === 0) s.phase = (s.phase + 1) % POWER.pump.frames;
    if (s.actTime % k.pumpCheck === 0 && !ready(world, s)) {
      s.activity = 'wait';
      s.actTime = 0;
    }
  } else {
    s.actTime++;
    if (s.actTime % k.waitCheck === 0 && ready(world, s)) {
      s.activity = 'pump';
      s.actTime = 0;
    }
  }
}

// ------------------------------------------------------------------ derrick

/**
 * Controls for a clonk holding on to a derrick (Derrick.c4d ControlDown,
 * ControlUp, ControlLeft...): the drill head goes down drilling, comes back
 * up, or stops. Jump'n'run: while the key is held. Returns true if it took the keys.
 */
export function derrickControl(world: World, c: Clonk, s: Structure, ctl: ControlState): boolean {
  if (s.def.id !== 'derrick') return false;
  ensureDrill(s);
  const d = s.drill!;
  const start = (mode: 'move' | 'drill'): void => {
    lineSound(world, 'Click', s.x, s.y);
    if (!energyCheck(world, s, POWER.derrick.startEnergy)) return;
    d.mode = mode;
  };
  const stop = (): void => {
    if (d.mode === 'stop') return;
    d.mode = 'stop';
    world.events.push({ type: 'click', x: s.x, y: s.y, tick: world.tick });
  };
  if (c.controlStyle === 'classic') {
    if (ctl.pressedDown) start('drill');
    else if (ctl.pressedUp) start('move');
    else if (ctl.pressedLeft || ctl.pressedRight) {
      if (d.mode !== 'stop') stop();
      else c.letGo(ctl.pressedLeft ? -1 : 1);
    } else if (ctl.pressedDig || ctl.pressedThrow) c.letGo();
    return true;
  }
  if (ctl.pressedDown) start('drill');
  else if (ctl.pressedUp) start('move');
  else if ((d.mode === 'drill' && !ctl.down) || (d.mode === 'move' && !ctl.up)) stop();
  if (ctl.pressedLeft || ctl.pressedRight) c.letGo(ctl.pressedLeft ? -1 : 1);
  else if (ctl.pressedDig || ctl.pressedThrow) c.letGo();
  return true;
}

function ensureDrill(s: Structure): void {
  if (!s.drill) s.drill = { y: s.y + POWER.derrick.head, mode: 'stop', speed: 1.5 };
}

/**
 * The drill head (Derrick.c4d/PipeHead.c4d): drilling, it goes down through
 * the ground, slower in rock (0.25 to 0.75 a tick) and granite (0.1 to 0.3),
 * and can't get through buildings' basements. Moving up it stops below the
 * derrick. Every 5 ticks it pumps up 3 pixels of the liquid it's in, while
 * the derrick pumps.
 */
function stepDrill(world: World, s: Structure): void {
  ensureDrill(s);
  const d = s.drill!;
  const { land } = world;
  const x = s.x;
  const top = s.y + POWER.derrick.head;
  if (d.mode === 'drill') {
    const y = Math.round(d.y);
    const below = land.get(x, y + 3);
    if (below === Mat.Basement) {
      d.mode = 'stop';
      productionSound(world, 'MetalHit3', x, y);
    } else {
      const m = MATERIALS[below];
      if (!land.isSolid(x, y + 3)) d.speed = 1.5;
      else if (m.digFree) d.speed = 1;
      else {
        const base = below === Mat.Granite ? 0.1 : 0.25;
        d.speed = base + world.rng.int(201) / 100 * base;
      }
      // Its pipe takes a 3 pixel wide shaft down (FreeRect, DigFreeRect).
      for (let dy = 0; dy < 4; dy++) for (let dx = -1; dx <= 1; dx++) if (land.isSolid(x + dx, y + dy) && land.get(x + dx, y + dy) !== Mat.Basement) land.set(x + dx, y + dy, Mat.Sky);
      d.y = Math.min(land.height - 2, d.y + d.speed);
      if (d.y >= land.height - 2) d.mode = 'stop';
    }
  } else if (d.mode === 'move') {
    d.y -= 1.5;
    if (d.y <= top) {
      d.y = top;
      d.mode = 'stop';
      world.events.push({ type: 'click', x, y: top, tick: world.tick });
    }
  }
  if (d.mode !== 'drill' && world.tick % POWER.derrick.transferEvery === 0) {
    if (!acceptsTransfer(s) || (!energyCheck(world, s, POWER.pipeEnergy) && powerRule(world))) return;
    const hy = Math.round(d.y);
    for (let i = 0; i < POWER.pipePixels; i++) {
      const mat = extractLiquid(world, x, hy);
      if (mat !== null) insertInto(world, mat, s);
    }
    if (world.rng.int(5) === 0 && land.isLiquid(x, hy)) world.events.push({ type: 'bubble', x, y: hy, tick: world.tick });
  }
}

// ------------------------------------------------------------------ generators

/** The power plant's first load of coal, as a welcome (Initialize: CreateContents(COAL)). */
export function powerPlantBuilt(world: World, s: Structure): void {
  if (s.def.id !== 'powerPlant') return;
  const coal = world.spawnItem('coal', s.x, s.y);
  world.store(s, coal);
}

export function useUp(s: Structure, id: ItemId, n = 1): void {
  for (let i = 0; i < n; i++) {
    const it = s.contents.find((o) => o.def.id === id);
    if (!it) return;
    s.contents.splice(s.contents.indexOf(it), 1);
    it.container = null;
    it.removed = true;
  }
}

/** Something that doesn't belong in it comes out of the door (SetCommand(obj, "Exit")). */
export function ejectItem(s: Structure, it: Item, at?: { x: number; y: number }): void {
  const i = s.contents.indexOf(it);
  if (i >= 0) s.contents.splice(i, 1);
  it.container = null;
  const p = at ? { x: s.x + at.x, y: s.y + at.y } : s.exitPoint();
  it.setPosition(Math.round(p.x), Math.round(p.y + (at ? 0 : 6)));
  it.xdir = 0;
  it.ydir = -1;
  it.noCollect = 20;
  s.openDoor();
}

const FUEL = new Set<ItemId>(['coal', 'oilBarrel', 'wood']);

/**
 * PowerPlant.c4d ContentsCheck, every 35 ticks while it doesn't burn:
 * anything but fuel goes out again. When something it's connected to needs
 * energy, it burns two pieces of wood, an oil barrel (which comes back
 * empty) or a piece of coal. Burning, it gives 25 points every 8 ticks for 2000 ticks.
 */
function stepPowerPlant(world: World, s: Structure): void {
  if (s.activity === 'burn') {
    s.actTime++;
    s.phase = s.actTime % 8;
    if (s.actTime % POWER.plant.every === 1) {
      doEnergy(s, POWER.plant.gain);
      world.events.push({ type: 'smoke', x: s.x - 15, y: s.y - 20, size: 12, tick: world.tick });
      world.events.push({ type: 'smoke', x: s.x - 1, y: s.y - 23, size: 8, tick: world.tick });
    }
    if (s.actTime >= POWER.plant.burnTime) {
      s.activity = null;
      s.actTime = 0;
    }
    return;
  }
  if ((world.tick + s.x) % POWER.checkInterval !== 0) return;
  const first = s.contents[0];
  if (first && !FUEL.has(first.def.id)) ejectItem(s, first);
  if (!needsEnergyChain(world, s)) return;
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
  productionSound(world, 'PowerPlant', s.x, s.y);
}

/** Wing.c4d Wind2Turn, every 15 ticks: the windmill gets 5 points for every tenth of a degree the wing turns a tick. */
function stepWindmill(world: World, s: Structure): void {
  const wg = s.def.wing;
  if (!wg || (world.tick + s.x) % POWER.wing.every !== 0) return;
  const wind = world.weather ? world.weather.windAt(world, s.x + wg.at.x, s.y + wg.at.y) : 0;
  doEnergy(s, Math.abs(s.wingRDir * POWER.wing.factor));
  s.wingRDir = Math.trunc(wind / 4);
}

/**
 * Each tick: the generators make power, pumps and derricks pump, and
 * buildings that aren't anybody's base slowly lose their energy (ExecLife).
 */
export function stepPower(world: World): void {
  for (const s of world.structures) {
    if (s.gone || !s.complete) continue;
    switch (s.def.id) {
      case 'powerPlant':
        stepPowerPlant(world, s);
        break;
      case 'windmill':
        stepWindmill(world, s);
        break;
      case 'pump':
        stepPump(world, s);
        break;
      case 'derrick':
        stepPump(world, s);
        stepDrill(world, s);
        break;
    }
    if (world.tick % POWER.drainInterval === 0 && s.energy > 0 && s.base < 0) doEnergy(s, -1);
  }
  stepLines(world);
}
