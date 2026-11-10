// Construction, elevators and guard towers, ported from the Clonk Rage engine
// (C4Game::CreateObjectConstruction, ConstructionCheck, C4Landscape::RaiseTerrain,
// C4Object::Build) and the original scripts (Conkit.c4d, Elevator.c4d,
// Elevator.c4d/Case.c4d, Tower2.c4d and its gates).
// See licenses/clonk_engine_license.txt.

import type { Landscape } from '../landscape/landscape';
import { MATERIALS, Mat, type ItemId } from '../landscape/materials';
import type { Clonk, ControlState } from '../objects/clonk';
import { CONSTRUCTION, ELEVATOR_CASE, GATE, ITEMS, STRUCTURES } from '../objects/defs';
import { maskFromArt, SolidMask } from '../objects/solidMask';
import type { Item } from '../objects/item';
import { ElevatorCase, Gate, type Structure } from '../objects/structure';
import { round, sign } from '../objects/physics';
import { layBasement } from './homeBase';
import { rebuilt } from './fire';
import type { World } from './world';

/** How many pixels in a rectangle are solid (C4Landscape::AreaSolidCount). */
export function areaSolidCount(land: Landscape, x: number, y: number, w: number, h: number): number {
  let n = 0;
  for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) if (land.isSolid(cx, cy)) n++;
  return n;
}

/**
 * Dig out everything diggable in a rectangle (C4Landscape::DigFreeRect).
 * Rock, gold and granite stay. Pixels from row `tunnelFrom` down become
 * underground (tunnel background).
 */
export function digFreeRect(land: Landscape, x: number, y: number, w: number, h: number, tunnelFrom = Infinity): number {
  let n = 0;
  for (let cy = y; cy < y + h; cy++) {
    for (let cx = x; cx < x + w; cx++) {
      if (!land.inBounds(cx, cy) || !MATERIALS[land.get(cx, cy)].digFree) continue;
      land.set(cx, cy, Mat.Sky);
      if (cy >= tunnelFrom) land.setTunnel(cx, cy, true);
      n++;
    }
  }
  return n;
}

/**
 * Fill the ground under a new building (C4Landscape::RaiseTerrain): in every
 * column from row `y` down, a gap of less than 20 pixels above the ground is
 * filled with the ground's own material, so a building on slightly uneven
 * ground stands on solid ground everywhere.
 */
export function raiseTerrain(land: Landscape, x: number, y: number, w: number): void {
  for (let cx = x; cx < x + w; cx++) {
    if (cx < 0 || cx >= land.width) continue;
    let cy = y;
    while (cy + 1 < land.height && !land.isSolid(cx, cy + 1)) cy++;
    if (cy + 1 >= land.height || cy - y >= CONSTRUCTION.raiseTerrain) continue;
    const m = land.get(cx, cy + 1);
    // Never copy a building's solid parts.
    if (m === Mat.Basement) continue;
    const tex = land.tex[(cy + 1) * land.width + cx];
    for (; cy >= y; cy--) land.paint(cx, cy, m, tex);
  }
}

/**
 * Can a building go up with its bottom centre at (x, bottom)? Like the
 * original's ConstructionCheck: the site may be at most 5% solid, the five
 * rows under it must be at least 40% solid (level enough), and it can't
 * overlap another building. Returns what's wrong, or null if it's fine.
 */
export function siteProblem(world: World, id: string, x: number, bottom: number): string | null {
  const def = STRUCTURES[id];
  const { land } = world;
  const w = def.width;
  const h = def.height;
  const left = x - Math.floor(w / 2);
  const top = bottom - h;
  if (left < 0 || left + w > land.width || top < 0 || bottom + 5 > land.height) return 'No room to build here';
  if (areaSolidCount(land, left, top, w, h) > (w * h) / 20) return 'No room to build here';
  if (areaSolidCount(land, left, bottom, w, 5) < w * 2) return 'The ground is not level enough';
  for (const s of world.structures) {
    const d = s.def;
    if (s.gone) continue;
    if (left < s.left + d.width && left + w > s.left && top < s.top + d.height && bottom > s.top) return `Too close to the ${d.name}`;
  }
  return null;
}

/**
 * Put up a construction site (C4Game::CreateObjectConstruction): clear the
 * site, fill the ground under it, lay its basement and start it at con 0.
 */
export function construct(world: World, id: string, x: number, bottom: number, owner: number): Structure {
  const def = STRUCTURES[id];
  const { land } = world;
  const left = x - Math.floor(def.width / 2);
  // Clear the site (ignored for huge buildings, like the original).
  if (def.width * def.height < 12000) digFreeRect(land, left, bottom - def.height, def.width, def.height);
  raiseTerrain(land, left, bottom, def.width);
  const s = world.addStructure(id, x, bottom - (def.offset.y + def.height));
  s.owner = owner;
  s.con = 0;
  layBasement(world, s, bottom);
  world.events.push({ type: 'construct', structure: s, tick: world.tick });
  return s;
}

/** Con a clonk adds to a building each tick (C4Object::Build at level 10 by a clonk). */
export function buildRate(id: string): number {
  return Math.floor(CONSTRUCTION.perTick / STRUCTURES[id].mass);
}

/**
 * One tick of a clonk working on a construction site (DFA_BUILD): it has to
 * stay at the site; when the building is done the clonk stops.
 */
export function buildStep(world: World, c: Clonk): void {
  const s = c.workOn;
  const d = s?.def;
  if (!s || !d || s.complete || c.x - s.left < 0 || c.x - s.left > d.width || c.y - s.top < -16 || c.y - s.top > d.height + 16) {
    c.letGo();
    return;
  }
  if (world.rules.has('constructionMaterial') && !s.burned) {
    const needs = takeMaterial(s, c);
    if (needs) {
      world.say(c.owner, `${d.name} needs: ${needs}`);
      c.letGo();
      return;
    }
  }
  s.con = Math.min(CONSTRUCTION.fullCon, s.con + buildRate(d.id));
  if (world.tick % 36 === 0) world.events.push({ type: 'building', structure: s, tick: world.tick });
  // A burned building built back up is the real one again (ConstructTo).
  if (s.burned && s.con >= CONSTRUCTION.fullCon) rebuilt(s);
  if (s.complete) {
    completeStructure(world, s);
    c.letGo();
  }
}

/**
 * The Construction Material rule (C4Object::Build): the site takes what it
 * still needs out of the builder's hands, and can only be built as far as the
 * material it has got allows. Returns what's missing ("3x Wood, 1x Rock"), or
 * an empty string if building can go on.
 */
export function takeMaterial(s: Structure, c: Clonk): string {
  const need = Object.entries(s.def.components) as [ItemId, number][];
  for (const [id, n] of need) {
    if ((s.components[id] ?? 0) >= n) continue;
    const item = c.contents.find((i) => i.def.id === id && !i.fire);
    if (!item) continue;
    c.contents.splice(c.contents.indexOf(item), 1);
    item.removed = true;
    s.components[id] = (s.components[id] ?? 0) + 1;
  }
  const short = need.some(([id, n]) => n > 0 && Math.trunc((100 * (s.components[id] ?? 0)) / n) < Math.trunc((100 * s.con) / CONSTRUCTION.fullCon));
  if (!short) return '';
  return need
    .filter(([id, n]) => (s.components[id] ?? 0) < n)
    .map(([id, n]) => `${n - (s.components[id] ?? 0)}x ${ITEMS[id].name}`)
    .join(', ');
}

/**
 * A building is finished: its solid parts go into the landscape, a guard
 * tower gets its gates and an elevator its case, hanging at the bottom of the
 * elevator with its floor level with the ground.
 */
export function completeStructure(world: World, s: Structure): void {
  const { land } = world;
  const def = s.def;
  s.con = CONSTRUCTION.fullCon;
  if (def.solidMask) {
    s.mask = new SolidMask(maskFromArt(def.solidMask));
    s.mask.place(land, s.left, s.top);
  }
  for (const gd of def.gates ?? []) {
    const g = new Gate(gd, s.x + gd.x, s.y + gd.y);
    g.mask.place(land, g.left, g.top);
    s.gates.push(g);
  }
  if (def.elevator) {
    const c = ELEVATOR_CASE;
    const bottom = s.top + def.height;
    const k = new ElevatorCase(s.x, bottom - (c.offset.y + c.floor.y));
    // Room for the case at the bottom of the elevator, its floor level with the ground.
    digFreeRect(land, k.left, k.boxTop, c.width, c.floor.y + c.floor.h, bottom);
    k.floor.place(land, k.left, k.floorY);
    k.timer = c.waitInterval;
    s.liftCase = k;
  }
  world.events.push({ type: 'built', structure: s, tick: world.tick });
}

// ------------------------------------------------------------------ grabbing

/**
 * What a clonk can work on where it stands (ObjectComDownDouble): a
 * construction site to help build, an elevator case or a guard tower to hold
 * on to and work it.
 */
export function grabTarget(world: World, c: Clonk): { structure: Structure; build: boolean } | null {
  for (const s of world.structures) {
    if (!s.complete) {
      if (s.inside(c.x, c.y) && !world.hostile(s.owner, c.owner)) return { structure: s, build: true };
      continue;
    }
    if (s.liftCase?.inside(c.x, c.y)) return { structure: s, build: false };
    // The guard tower's ground floor, between the gates.
    if (s.gates.length && s.inside(c.x, c.y) && c.y > s.y) return { structure: s, build: false };
  }
  return null;
}

/** Start working on what's where the clonk stands. Returns false if there's nothing. */
export function grabOrBuild(world: World, c: Clonk): boolean {
  const t = grabTarget(world, c);
  if (!t) return false;
  if (t.build) {
    c.startBuild(t.structure);
    return true;
  }
  // Hold on to the case standing on its floor.
  const k = t.structure.liftCase;
  if (k && c.y + 10 !== k.floorY) return false;
  c.startPush(t.structure);
  world.events.push({ type: 'click', x: c.x, y: c.y, tick: world.tick });
  return true;
}

/**
 * Controls for a clonk holding on to an elevator case or a guard tower.
 * Elevator (Case.c4d controls): up and down ride, dig drills the shaft deeper.
 * With jump'n'run controls the case moves while the key is held. Guard tower
 * (Tower2.c4d): left and right open or shut that side's gate.
 */
export function pushControl(world: World, c: Clonk, ctl: ControlState): void {
  const s = c.workOn;
  if (!s) return c.letGo();
  const classic = c.controlStyle === 'classic';
  const k = s.liftCase;
  if (k) {
    // Enemies can hold on, but the elevator won't listen to them.
    const ours = !world.hostile(s.owner, c.owner);
    if (ctl.pressedLeft || ctl.pressedRight) {
      // Classic: left and right stop a moving case. Otherwise they let go, once it's standing still.
      if (ours && k.mode !== 'wait') {
        if (classic) haltCase(k);
        return;
      }
      return c.letGo(ctl.pressedLeft ? -1 : 1);
    }
    if (!ours) return;
    if (classic) {
      if (ctl.pressedUp) rideTo(world, k, k.top, false);
      else if (ctl.pressedDown) rideTo(world, k, null, false);
      else if (ctl.pressedDig) drill(world, k, k.mode !== 'drill');
      return;
    }
    if (ctl.pressedDig) return drill(world, k, k.mode !== 'drill');
    if (k.mode === 'drill') return;
    if (ctl.up) rideTo(world, k, k.top, true, -1);
    else if (ctl.down) rideTo(world, k, null, true, 1);
    return;
  }
  if (s.gates.length) {
    if (ctl.pressedLeft || ctl.pressedRight) {
      const side = ctl.pressedLeft ? -1 : 1;
      const g = s.gates.find((x) => x.def.side === side);
      if (g) {
        // Activate: a gate on its way up (or open) shuts, otherwise it opens.
        g.dir = g.dir === -1 ? 1 : -1;
        world.events.push({ type: 'gate', x: g.x, y: g.y, tick: world.tick });
      }
    } else if (ctl.pressedUp || ctl.pressedDown || ctl.pressedDig || ctl.pressedThrow) c.letGo();
    return;
  }
  c.letGo();
}

// ------------------------------------------------------------------ elevator

/** The clonk holding on to an elevator, if any. */
function pusher(world: World, s: Structure): Clonk | undefined {
  return world.clonks.find((c) => c.workOn === s && c.action.procedure === 'push' && !c.contained);
}

/** Things standing on the case's floor, and whoever holds on to it: they ride along. */
function riders(world: World, s: Structure, k: ElevatorCase): (Clonk | Item)[] {
  const out: (Clonk | Item)[] = [];
  const x0 = k.left;
  const x1 = k.left + ELEVATOR_CASE.width;
  for (const c of world.clonks) {
    if (c.contained) continue;
    if ((c.workOn === s && c.action.procedure === 'push') || (c.x >= x0 && c.x < x1 && c.y + 10 === k.floorY)) out.push(c);
  }
  for (const it of world.items) {
    if (!it.container && !it.removed && it.x >= x0 && it.x < x1 && it.y + 1 === k.floorY) out.push(it);
  }
  return out;
}

function haltCase(k: ElevatorCase): void {
  k.mode = 'wait';
  k.dir = 0;
  k.ydir = 0;
  k.target = null;
  k.manual = false;
  k.fy = k.y;
}

/**
 * Ride to a height (the case's centre), or all the way down when `y` is null.
 * Never above where it started (SetMoveTo). A `manual` ride with jump'n'run
 * controls stops when the key is let go.
 */
function rideTo(world: World, k: ElevatorCase, y: number | null, manual: boolean, held: -1 | 1 | 0 = 0): void {
  const target = y === null ? null : Math.max(y, k.top);
  const dir = target === null ? 1 : sign(target - k.y);
  if (dir === 0) return;
  // Already at the bottom of the shaft.
  if (dir > 0 && k.mode === 'wait' && blockedBelow(world.land, k)) return;
  if (k.mode !== 'ride' || k.dir !== dir) {
    k.ydir = 0;
    world.events.push({ type: 'click', x: k.x, y: k.y, tick: world.tick });
  }
  k.mode = 'ride';
  k.dir = dir as -1 | 1;
  k.target = target;
  k.manual = manual;
  if (held) k.held = world.tick;
}

function drill(world: World, k: ElevatorCase, on: boolean): void {
  world.events.push({ type: 'click', x: k.x, y: k.y, tick: world.tick });
  if (!on) return haltCase(k);
  k.mode = 'drill';
  k.manual = false;
  k.dir = 1;
  k.target = null;
  k.ydir = 0;
}

/**
 * A crew member standing still near the shaft, who the case can reach
 * (FindWaitingClonk): its player's leader first, otherwise the nearest one.
 */
function waitingClonk(world: World, s: Structure, k: ElevatorCase): Clonk | null {
  const { land } = world;
  const r = ELEVATOR_CASE.waitRange;
  let best: Clonk | null = null;
  let bestD = Infinity;
  for (const c of world.clonks) {
    if (!c.alive || c.contained || c.owner < 0 || world.hostile(c.owner, s.owner)) continue;
    if (c.x < k.x - r || c.x >= k.x + r || c.y < k.top - 20) continue;
    const proc = c.action.procedure;
    if (proc !== 'walk' && proc !== 'scale' && proc !== 'hangle' && proc !== 'swim') continue;
    if (c.comDir.x !== 0 || c.comDir.y !== 0) continue;
    // Out of reach?
    if (c.y < k.y - 7 && !pathFree(land, k.x, k.y, c.y)) continue;
    if (c.y > k.y + 7 && !pathFree(land, k.x, k.y + 16, c.y)) continue;
    const lead = world.cursor(c.owner).leader === c;
    const d = lead ? -1 : Math.abs(c.x - k.x) + Math.abs(c.y - k.y);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function pathFree(land: Landscape, x: number, y0: number, y1: number): boolean {
  const d = sign(y1 - y0);
  for (let y = y0; y !== y1; y += d) if (land.isSolid(x, y) && land.get(x, y) !== Mat.Basement) return false;
  return true;
}

function blockedBelow(land: Landscape, k: ElevatorCase): boolean {
  const below = k.floorY + ELEVATOR_CASE.floor.h;
  if (below >= land.height) return true;
  for (let x = k.left; x < k.left + ELEVATOR_CASE.width; x++) if (land.isSolid(x, below)) return true;
  return false;
}

/** Try to move the case one pixel up (-1) or down (1). False if something's in the way. */
function moveCase(world: World, s: Structure, k: ElevatorCase, step: -1 | 1): boolean {
  const { land } = world;
  const c = ELEVATOR_CASE;
  const x0 = k.left;
  if (step < 0) {
    if (k.y - 1 < k.top) return false;
    // Bumping into the top of the shaft.
    for (let x = x0; x < x0 + c.width; x++) if (land.isSolid(x, k.boxTop - 1) && land.get(x, k.boxTop - 1) !== Mat.Basement) return false;
  } else {
    const below = k.floorY + c.floor.h;
    if (below >= land.height) return false;
    if (k.mode === 'drill') digFreeRect(land, x0, below, c.width, 1, 0);
    if (blockedBelow(land, k)) return false;
    // Never squash a clonk under the floor.
    for (const o of world.clonks) {
      if (o.contained || o.x < x0 - 3 || o.x >= x0 + c.width + 3) continue;
      if (o.y - 7 <= below && o.y + 9 >= below) return false;
    }
  }
  const ride = riders(world, s, k);
  k.floor.move(land, 0, step);
  k.y += step;
  for (const o of ride) o.setPosition(o.x, o.y + step);
  return true;
}

/**
 * One tick of an elevator (Case.c4d Timer and FLOAT movement): every 30
 * ticks a waiting case rides to a clonk waiting at the shaft; a moving case
 * floats towards its target, taking along whatever stands on it, and stops
 * when it gets there or bumps into something. Drilling digs the shaft deeper
 * through earth and sand, never through rock.
 */
export function stepElevator(world: World, s: Structure): void {
  const k = s.liftCase;
  if (!k) return;
  const c = ELEVATOR_CASE;
  if (--k.timer <= 0) {
    k.timer = c.waitInterval;
    const busy = world.clonks.some((o) => o.alive && !o.contained && riders(world, s, k).includes(o));
    if (k.mode === 'wait' && !busy) {
      const w = waitingClonk(world, s, k);
      // The case's floor goes level with the clonk's feet.
      const target = w ? w.y + 10 - (c.offset.y + c.floor.y) : k.y;
      if (w && Math.abs(target - k.y) >= 4) rideTo(world, k, target, false);
    }
  }
  if (k.mode === 'wait') return;
  // A jump'n'run ride stops as soon as the key is let go.
  if (k.manual && (k.held !== world.tick || !pusher(world, s))) return haltCase(k);
  if (k.mode === 'drill' && !pusher(world, s)) return haltCase(k);
  const limit = k.mode === 'drill' ? c.drillSpeed : c.speed;
  k.ydir = Math.max(-limit, Math.min(limit, k.ydir + k.dir * c.accel));
  k.fy += k.ydir;
  let ty = round(k.fy);
  if (k.target !== null && (k.dir > 0 ? ty > k.target : ty < k.target)) ty = k.target;
  while (k.y !== ty) {
    if (!moveCase(world, s, k, sign(ty - k.y) as -1 | 1)) return haltCase(k);
  }
  if (k.target !== null && k.y === k.target) haltCase(k);
  else if (k.mode === 'ride' && world.tick % 25 === 0) world.events.push({ type: 'elevator', x: k.x, y: k.y, tick: world.tick });
}

// --------------------------------------------------------------------- gates

/** One tick of a guard tower gate: it floats up or down until it bumps into something. */
export function stepGate(world: World, g: Gate): void {
  const { land } = world;
  g.ydir = Math.max(-GATE.speed, Math.min(GATE.speed, g.ydir + g.dir * GATE.accel));
  g.fy += g.ydir;
  const ty = round(g.fy);
  while (g.y !== ty) {
    const step = sign(ty - g.y) as -1 | 1;
    // The gate's top and bottom vertex, in the middle of it.
    const vy = step < 0 ? g.y - GATE.height / 2 - 1 : g.y + GATE.height / 2;
    let blocked = land.isSolid(g.x, vy) && !g.mask.covers(g.x, vy);
    if (step > 0 && !blocked) {
      // It doesn't come down on a clonk.
      const x0 = g.left + g.def.mask.x;
      const x1 = x0 + g.def.mask.w - 1;
      const row = g.top + GATE.height;
      blocked = world.clonks.some((c) => !c.contained && c.x + 4 >= x0 && c.x - 4 <= x1 && c.y - 7 <= row && c.y + 9 >= row);
    }
    if (blocked) {
      g.fy = g.y;
      g.ydir = 0;
      return;
    }
    g.mask.move(land, 0, step);
    g.y += step;
  }
}
