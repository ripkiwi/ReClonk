// The cannon tower and its guns, ported from the original content
// (Structures.c4d/CannonTower.c4d with Cannon1-3 and their Attached selves):
// push a combat, artillery or anti-air cannon into the tower and it's
// mounted on the roof. From inside, left and right turn it, dig shoots, up
// twice takes it off again. See licenses/clonk_engine_license.txt.

import { LIQUID, type ItemId } from '../landscape/materials';
import type { Clonk, ControlState } from '../objects/clonk';
import { CLONK_KINDS, ITEMS, type ClonkKind } from '../objects/defs';
import { GRAVITY } from '../objects/physics';
import { spitFlame } from './liquids';
import { doEnergy, energyPoints, POWER, productionSound, type ProductionSound } from './power';
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
  stepNewGun(world, v);
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
    else if (fireNewGun(world, c, s, v)) {
      // The flame thrower, the lightning cannon, or the liquid cannon's menu.
    } else {
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
  if (v.def.mount!.kind === 'liquid') return liquidAmmo(s);
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
  if (m.kind === 'liquid') return shootLiquid(world, s, v, id as ItemId);
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
    if (it.def.arrow || it.def.id === 'bullet') {
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
    // Bullets fly faster than arrows.
    const speed = a.def.id === 'bullet' ? GUNS.bulletSpeed : m.power;
    a.xdir = Math.trunc(sin(v.r) * speed);
    a.ydir = -Math.trunc(cos(v.r) * speed);
    a.r = v.r;
    a.rdir = Math.abs(v.r) <= 10 ? 0 : v.r < 0 ? -4 / 10 / 5 : 4 / 10 / 5;
    a.noCollect = 20;
    a.thrownBy = c.id;
    if (a.def.arrow) shootArrow(world, a, c);
  }
}

// ------------------------------------------------------------------ flame thrower, lightning and liquid cannons

export const GUNS = {
  /** The flame thrower: 50 oil a shot, out 18 pixels along the barrel at 5 pixels a tick (FlameThrowerAttached ComFire). */
  flame: { oil: 50, muzzle: 18, speed: 5, hitBox: 5, trail: 1, burst: 10, burstLevel: 7 },
  /** The lightning cannon drains 10 points from the tower every 15 ticks while it has more than 9; 350 make a crystal (EnergyTransfer). */
  lightning: { every: 15, drain: 10, keep: 9, perShot: 350, battery: 5, advance: 18, spread: 4, side: 5, blastFrom: 5, blast: 3, corners: 30 },
  /** The liquid cannon: each pixel out 20 (and one more every 50) along the barrel at 20 pixels a tick (Shoot: InsertMaterial). */
  liquid: { dist: 20, per: 50, speed: 200 },
  /** A munition pack holds 10 bullets; the anti-air cannon shoots them at 22 (Munitions.c4d Unpack). */
  bullets: 10,
  bulletSpeed: 22,
};

/** A flame thrower's shot (FlameShot.c4d): it flies, leaving flames, and bursts into ten on whatever it hits. */
export interface FlameShot {
  x: number;
  y: number;
  xdir: number;
  ydir: number;
  r: number;
  by: Clonk | null;
  removed: boolean;
}

/** A lightning cannon's bolt (Lightning.c4d, ADM4): a zigzag that grows a corner a tick. `fade` counts down once it's done, for drawing. */
export interface TowerBolt {
  points: { x: number; y: number }[];
  advX: number;
  varX: number;
  advY: number;
  varY: number;
  by: Clonk | null;
  fade: number;
}

function gunSound(world: World, s: ProductionSound, x: number, y: number): void {
  productionSound(world, s, x, y);
}

/**
 * ComEnter: what's put into the tower goes to the gun if it takes it. The
 * flame thrower empties oil barrels into its tank; the lightning cannon
 * takes crystals, and a battery gives it five; the anti-air cannon unpacks
 * munition packs into bullets.
 */
function feedGun(world: World, s: Structure, v: Vehicle): void {
  const kind = v.def.mount!.kind;
  for (const it of [...s.contents]) {
    if (kind === 'flame' && it.def.id === 'oilBarrel' && it.fill > 0) {
      v.oil += it.fill;
      it.fill = 0;
      it.def = ITEMS.barrel;
      gunSound(world, 'Click', s.x, s.y);
    } else if (kind === 'lightning' && (it.def.id === 'crystal' || it.def.id === 'battery')) {
      takeOut(s, it);
      it.removed = true;
      if (it.def.id === 'battery') {
        v.crystals += GUNS.lightning.battery;
        gunSound(world, 'LightningLoad', s.x, s.y);
      } else {
        v.crystals++;
        gunSound(world, 'Electric', s.x, s.y);
      }
    } else if (kind === 'arrows' && it.def.id === 'munitionPack') {
      takeOut(s, it);
      it.removed = true;
      for (let i = 0; i < GUNS.bullets; i++) world.store(s, world.spawnItem('bullet', s.x, s.y));
      gunSound(world, 'Click', s.x, s.y);
    }
  }
}

/** Each tick, for the new guns: take what's put in, and the lightning cannon charges from the tower's power. */
export function stepNewGun(world: World, v: Vehicle): void {
  const s = v.mountedOn;
  if (!s) return;
  feedGun(world, s, v);
  const k = GUNS.lightning;
  if (v.def.mount!.kind !== 'lightning' || (world.tick + v.id) % k.every !== 0) return;
  if (energyPoints(s) <= k.keep) return;
  doEnergy(s, -k.drain);
  v.charge += k.drain * POWER.unit;
  if (v.charge <= k.perShot * POWER.unit) return;
  v.charge -= k.perShot * POWER.unit;
  v.crystals++;
  gunSound(world, 'LightningLoad', v.x, v.y);
}

/** Dig with a flame thrower, lightning cannon or liquid cannon on the tower. Returns false for the other guns. */
function fireNewGun(world: World, c: Clonk, s: Structure, v: Vehicle): boolean {
  switch (v.def.mount!.kind) {
    case 'flame':
      fireFlame(world, c, s, v);
      return true;
    case 'lightning':
      fireLightning(world, c, v);
      return true;
    case 'liquid':
      c.menuKind = 'fire';
      c.menu = 0;
      return true;
  }
  return false;
}

/** FlameThrowerAttached ComFire: 50 of its oil make a shot, out along the barrel. */
function fireFlame(world: World, c: Clonk, s: Structure, v: Vehicle): void {
  const k = GUNS.flame;
  gunSound(world, 'Click', v.x, v.y);
  feedGun(world, s, v);
  if (v.oil < k.oil) {
    gunSound(world, 'Error', s.x, s.y);
    world.say(c.owner, 'The flame thrower needs oil: put an oil barrel in the tower');
    return;
  }
  v.oil -= k.oil;
  world.flameShots.push({
    x: v.x + Math.trunc(sin(v.r) * k.muzzle),
    y: v.y - Math.trunc(cos(v.r) * k.muzzle),
    xdir: Math.trunc(sin(v.r) * k.speed),
    ydir: -Math.trunc(cos(v.r) * k.speed),
    r: v.r,
    by: c,
    removed: false,
  });
  gunSound(world, 'FlameThrower', v.x, v.y);
}

/** LightningCannonAttached ComFire: a crystal makes two bolts side by side along the barrel. */
function fireLightning(world: World, c: Clonk, v: Vehicle): void {
  const k = GUNS.lightning;
  if (v.crystals < 1) {
    gunSound(world, 'Error', v.x, v.y);
    world.say(c.owner, 'The lightning cannon has no charge: connect power or put in crystals');
    return;
  }
  v.crystals--;
  gunSound(world, 'LightningCannon', v.x, v.y);
  const advX = Math.trunc(sin(v.r) * k.advance);
  const advY = -Math.trunc(cos(v.r) * k.advance);
  const starts = [
    { x: v.x, y: v.y },
    { x: v.x + Math.trunc(sin(v.r + 90) * k.side), y: v.y + Math.trunc(cos(v.r + 90) * k.side) },
  ];
  for (const p of starts) world.towerBolts.push({ points: [p], advX, varX: k.spread, advY, varY: k.spread, by: c, fade: -1 });
  world.events.push({ type: 'sparks', x: v.x + advX, y: v.y + advY, tick: world.tick });
}

/** The liquid cannon's menu (DoMenu): each kind of filled barrel in the tower, and all of them if there's more than one kind. */
export function liquidAmmo(s: Structure): MenuEntry[] {
  const out: MenuEntry[] = [];
  let all = 0;
  for (const it of s.contents) {
    if (!it.def.barrel?.mat || it.fill <= 0) continue;
    all++;
    const e = out.find((o) => o.id === it.def.id);
    if (e) e.count++;
    else out.push({ id: it.def.id, count: 1, value: 0 });
  }
  if (out.length > 1) out.push({ id: 'barrel', count: all, value: 0 });
  return out;
}

/** CannonLiquidAttached Shoot: empty these barrels (all with 'barrel') out of the barrel, pixel by pixel, spreading as it goes. */
export function shootLiquid(world: World, s: Structure, v: Vehicle, id: ItemId): void {
  const k = GUNS.liquid;
  let n = 0;
  for (const it of [...s.contents]) {
    const mat = it.def.barrel?.mat;
    if (!mat || it.fill <= 0 || (id !== 'barrel' && it.def.id !== id)) continue;
    const amount = it.fill;
    it.fill = 0;
    it.def = ITEMS.barrel;
    for (let j = 0; j < amount; j++) {
      n++;
      const f = Math.trunc(n / k.per);
      const dist = k.dist + f;
      const spread = Math.trunc(f / 3);
      const angle = v.r + (spread ? world.rng.int(2 * spread + 1) - spread : 0);
      world.land.insertMaterial(mat, v.x + Math.trunc(sin(angle) * dist), v.y - Math.trunc(cos(angle) * dist), Math.trunc(sin(v.r) * k.speed), -Math.trunc(cos(v.r) * k.speed));
    }
  }
  if (n) gunSound(world, 'Splash', v.x, v.y);
  else gunSound(world, 'Error', s.x, s.y);
}

/** Each tick: flame shots fly and lightning bolts grow. */
export function stepTowerShots(world: World): void {
  const kf = GUNS.flame;
  for (const f of world.flameShots) {
    if (f.removed) continue;
    // Travel: a hit on something alive, otherwise a flame left behind.
    const prey = world.clonks.some((c) => c.alive && !c.contained && Math.abs(c.x - f.x) <= kf.hitBox && Math.abs(c.y - f.y) <= kf.hitBox) ||
      world.animals.some((a) => a.alive && !a.removed && a.def.prey && Math.abs(a.x - f.x) <= kf.hitBox && Math.abs(a.y - f.y) <= kf.hitBox);
    if (!prey) {
      spitFlame(world, f.x, f.y, (world.rng.int(kf.trail * 2 + 1) - kf.trail) / 10, (world.rng.int(kf.trail + 1) - kf.trail) / 10);
      f.ydir += GRAVITY;
      const nx = f.x + f.xdir;
      const ny = f.y + f.ydir;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(f.xdir), Math.abs(f.ydir))));
      let hit = false;
      for (let i = 1; i <= n && !hit; i++) {
        const x = Math.round(f.x + (f.xdir * i) / n);
        const y = Math.round(f.y + (f.ydir * i) / n);
        if (world.land.isSolid(x, y) || y >= world.land.height) hit = true;
        else {
          f.x = x;
          f.y = y;
        }
      }
      if (!hit) {
        f.x = nx;
        f.y = ny;
        f.r = (Math.atan2(f.xdir, -f.ydir) * 180) / Math.PI;
        if (f.x < 0 || f.x >= world.land.width || f.y < -200) f.removed = true;
        continue;
      }
    }
    // Hit: ten flames, cast about.
    f.removed = true;
    for (let i = 0; i < kf.burst; i++) {
      const lv = kf.burstLevel;
      spitFlame(world, f.x, f.y - 2, (world.rng.int(lv + 1) - Math.trunc(lv / 2)) / 10, (world.rng.int(lv + 1) - lv) / 10);
    }
    world.events.push({ type: 'inflame', x: f.x, y: f.y, loud: true, tick: world.tick });
  }
  if (world.flameShots.some((f) => f.removed)) world.flameShots = world.flameShots.filter((f) => !f.removed);

  const kl = GUNS.lightning;
  for (const b of world.towerBolts) {
    if (b.fade >= 0) {
      b.fade--;
      continue;
    }
    const tip = b.points[b.points.length - 1];
    // Into the ground (or a liquid): done.
    if (world.land.density(tip.x, tip.y) >= LIQUID || b.points.length >= kl.corners) {
      b.fade = 4;
      continue;
    }
    if (b.points.length - 1 > kl.blastFrom) world.blastObjects(tip.x, tip.y, kl.blast, b.by);
    b.points.push({ x: tip.x + b.advX + world.rng.int(b.varX), y: tip.y + b.advY + world.rng.int(b.varY) });
  }
  if (world.towerBolts.some((b) => b.fade === 0)) world.towerBolts = world.towerBolts.filter((b) => b.fade !== 0);
}
