// The cannon tower and its guns, ported from the original content
// (Structures.c4d/CannonTower.c4d with Cannon1-3 and their Attached selves):
// push a combat, artillery or anti-air cannon into the tower and it's
// mounted on the roof. From inside, left and right turn it, dig shoots, up
// twice takes it off again. See licenses/clonk_engine_license.txt.

import type { ItemId } from '../landscape/materials';
import type { Clonk, ControlState } from '../objects/clonk';
import { CLONK_KINDS, type ClonkKind } from '../objects/defs';
import type { Item } from '../objects/item';
import type { Structure } from '../objects/structure';
import type { Vehicle } from '../objects/vehicle';
import { shootArrow } from './siege';
import type { MenuEntry, World } from './world';

export const TOWER = {
  /** The gun sits on the tower's first vertex (0, -19): ATTACH to it. */
  mount: { x: 0, y: -19 },
  /** Shots leave 13 pixels out along the barrel (Exit(Sin(R, 13), -Cos(R, 13))). */
  muzzle: 13,
  /** The anti-air cannon's two arrows leave 9 pixels out, 45° either side. */
  arrowMuzzle: 9,
  /** Not in the original, where it turns all the way round: at most this far from straight up. */
  maxR: 100,
  /** Ticks between two presses of up that count as a double press. */
  double: 12,
};

const sin = (deg: number): number => Math.sin((deg * Math.PI) / 180);
const cos = (deg: number): number => Math.cos((deg * Math.PI) / 180);

function sound(world: World, s: 'Connect' | 'Click' | 'Error' | 'Blast3' | 'Arrow' | 'CannonStop', x: number, y: number, smoke = 0): void {
  world.events.push({ type: 'siege', sound: s, x, y, smoke, tick: world.tick });
}

/** The gun mounted on this tower, if any. */
export function towerGun(world: World, s: Structure): Vehicle | null {
  return world.vehicles.find((v) => v.mountedOn === s && !v.removed) ?? null;
}

/**
 * A cannon was pushed into a cannon tower (Collection2, ConnectCannon): it's
 * mounted on the roof, aimed 45° towards the middle of the map. Returns
 * false if this isn't a gun, or the tower already has one.
 */
export function mountGun(world: World, s: Structure, v: Vehicle): boolean {
  if (s.def.id !== 'cannonTower' || !v.def.mount || s.burned || !s.complete || towerGun(world, s)) return false;
  v.mountedOn = s;
  v.contained = s;
  v.mask?.remove(world.land);
  v.mask = null;
  v.xdir = v.ydir = 0;
  v.r = s.x > world.land.width / 2 ? -45 : 45;
  v.turning = 0;
  v.setPosition(s.x + TOWER.mount.x, s.y + TOWER.mount.y);
  for (const c of world.clonks) if (c.vehicle === v) c.letGo();
  sound(world, 'Connect', s.x, s.y);
  return true;
}

/** Take the gun off (ReleaseCannon): it comes out at the door, a loose cannon again. */
export function releaseGun(world: World, s: Structure): void {
  const v = towerGun(world, s);
  if (!v) return;
  v.mountedOn = null;
  v.contained = null;
  v.turning = 0;
  v.r = 0;
  const p = s.exitPoint();
  const bottom = Math.max(...v.def.vertices.map((o) => o.y));
  v.setPosition(p.x, p.y + 9 - bottom);
  for (const c of world.clonks) if (c.contained === s) c.menu = null;
  sound(world, 'Connect', s.x, s.y);
}

/** Each tick: a mounted gun turns while told to (the Rotating action), and comes off a burned tower. */
export function stepGun(world: World, v: Vehicle): void {
  const s = v.mountedOn!;
  if (s.burned || s.gone || !world.structures.includes(s)) return releaseGun(world, s);
  v.setPosition(s.x + TOWER.mount.x, s.y + TOWER.mount.y);
  if (!v.turning) return;
  const r = Math.max(-TOWER.maxR, Math.min(TOWER.maxR, v.r + v.turning * v.def.mount!.speed));
  if (r === v.r) {
    v.turning = 0;
    sound(world, 'CannonStop', v.x, v.y);
  }
  v.r = r;
}

function turn(world: World, v: Vehicle, dir: -1 | 0 | 1): void {
  if (v.turning === dir) return;
  sound(world, dir ? 'Click' : 'CannonStop', v.x, v.y);
  v.turning = dir;
}

/**
 * Controls inside a cannon tower with a gun (ContainedLeft, ContainedRight,
 * ContainedUp, ContainedUpDouble, ContainedDig). Jump'n'run: the gun turns
 * while left or right is held. Classic: a press starts it turning, up stops
 * it. Down stops it and goes out. Returns true if it took the controls.
 */
export function towerControl(world: World, c: Clonk, s: Structure, ctl: ControlState): boolean {
  const v = towerGun(world, s);
  if (!v) return false;
  const mount = v.def.mount!;
  if (c.controlStyle === 'classic') {
    if (ctl.pressedLeft) turn(world, v, -1);
    if (ctl.pressedRight) turn(world, v, 1);
  } else {
    const d: -1 | 0 | 1 = ctl.left ? -1 : ctl.right ? 1 : 0;
    // Only this clonk's keys: another one inside may be holding them.
    if (d || v.turning) turn(world, v, d);
  }
  if (ctl.pressedLeft || ctl.pressedRight) return true;
  if (ctl.pressedUp) {
    const dbl = world.tick - v.lastUp <= TOWER.double;
    v.lastUp = world.tick;
    if (dbl) releaseGun(world, s);
    else turn(world, v, 0);
    return true;
  }
  if (ctl.pressedDown) {
    turn(world, v, 0);
    return false;
  }
  if (ctl.pressedDig) {
    turn(world, v, 0);
    if (mount.kind === 'arrows') fireArrows(world, c, s, v);
    else {
      c.menuKind = 'fire';
      c.menu = 0;
    }
    return true;
  }
  return false;
}

/** What the gun can shoot (CannonAmmo): what's kept in the tower but gunpowder, and for the artillery the clonks inside. */
export function towerAmmo(world: World, c: Clonk): MenuEntry[] {
  const s = c.contained as Structure;
  const v = towerGun(world, s);
  if (!v) return [];
  const out: MenuEntry[] = [];
  for (const it of s.contents) {
    if (it.def.id === 'gunpowder') continue;
    const e = out.find((o) => o.id === it.def.id);
    if (e) e.count++;
    else out.push({ id: it.def.id, count: 1, value: v.def.mount!.powder });
  }
  const crew = v.def.mount!.clonks;
  if (crew) {
    for (const o of world.clonks) {
      if (o.contained !== s || !o.alive) continue;
      const e = out.find((x) => x.id === o.kind);
      if (e) e.count++;
      else out.push({ id: o.kind, count: 1, value: crew.powder });
    }
  }
  return out;
}

/**
 * Shoot one of these (Shoot): it takes the gunpowder from the tower and the
 * shot flies off along the barrel, with the Blast3 sound and smoke. A clonk
 * shot from the artillery tumbles through the air; it shoots others before itself.
 */
export function shootFromTower(world: World, c: Clonk, id: ItemId | ClonkKind): void {
  const s = c.contained as Structure;
  const v = towerGun(world, s);
  if (!v) return;
  const m = v.def.mount!;
  const crew = id in CLONK_KINDS;
  const powderNeeded = crew ? m.clonks!.powder : m.powder;
  const powder = s.contents.filter((o) => o.def.id === 'gunpowder');
  if (powder.length < powderNeeded) {
    sound(world, 'Error', s.x, s.y);
    world.say(c.owner, `Needs ${powderNeeded} gunpowder`);
    return;
  }
  const power = crew ? m.clonks!.power : m.power;
  const x = v.x + Math.trunc(sin(v.r) * TOWER.muzzle);
  const y = v.y - Math.trunc(cos(v.r) * TOWER.muzzle);
  const xdir = Math.trunc(sin(v.r) * power);
  const ydir = -Math.trunc(cos(v.r) * power);
  if (crew) {
    const shot = world.clonks.filter((o) => o.contained === s && o.alive && o.kind === id);
    const target = shot.find((o) => o !== c) ?? shot[0];
    if (!target) return;
    usePowder(s, powder, powderNeeded);
    world.exitTo(target, x, y);
    target.fling(xdir, ydir);
  } else {
    const it = [...s.contents].reverse().find((o) => o.def.id === id);
    if (!it) return;
    usePowder(s, powder, powderNeeded);
    takeOut(s, it);
    it.setPosition(x, y);
    it.xdir = xdir;
    it.ydir = ydir;
    it.r = v.r;
    it.rdir = 20 / 10 / 5;
    it.noCollect = 20;
    it.thrownBy = c.id;
  }
  sound(world, 'Blast3', x, y, 4);
}

function usePowder(s: Structure, powder: Item[], n: number): void {
  for (const p of powder.slice(0, n)) {
    takeOut(s, p);
    p.removed = true;
  }
}

function takeOut(s: Structure, it: Item): void {
  const i = s.contents.indexOf(it);
  if (i >= 0) s.contents.splice(i, 1);
  it.container = null;
}

/** The next arrow kept in the tower, out of a pack if need be. */
function nextArrow(world: World, s: Structure): Item | null {
  for (let i = s.contents.length - 1; i >= 0; i--) {
    const it = s.contents[i];
    if (it.def.arrow) {
      takeOut(s, it);
      return it;
    }
    const pack = it.def.pack;
    if (!pack) continue;
    const a = world.spawnItem(pack.arrow, s.x, s.y);
    if (--it.count <= 0) {
      takeOut(s, it);
      it.removed = true;
    }
    return a;
  }
  return null;
}

/** The anti-air cannon's ComFire: up to two arrows at once, 45° apart at the muzzle, at 15 pixels a tick. */
function fireArrows(world: World, c: Clonk, s: Structure, v: Vehicle): void {
  const m = v.def.mount!;
  for (let i = 0; i < 2; i++) {
    const a = nextArrow(world, s);
    if (!a) {
      if (!i) {
        sound(world, 'Error', s.x, s.y);
        world.say(c.owner, 'No arrows in the tower');
      }
      return;
    }
    if (!i) sound(world, 'Arrow', v.x, v.y);
    const off = v.r - 45 + 90 * i;
    a.setPosition(v.x + Math.trunc(sin(off) * TOWER.arrowMuzzle), v.y - Math.trunc(cos(off) * TOWER.arrowMuzzle));
    a.xdir = Math.trunc(sin(v.r) * m.power);
    a.ydir = -Math.trunc(cos(v.r) * m.power);
    a.r = v.r;
    a.rdir = Math.abs(v.r) <= 10 ? 0 : v.r < 0 ? -4 / 10 / 5 : 4 / 10 / 5;
    a.noCollect = 20;
    a.thrownBy = c.id;
    shootArrow(world, a, c);
  }
}
