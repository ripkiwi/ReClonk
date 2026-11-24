// What animals do, from their scripts in the original Clonk Rage content
// (Objects.c4d/Animals.c4d: Animal.c4d's reproduction, and the Activity timers,
// contact calls and action calls of Wipf.c4d, Bird.c4d, Fish.c4d, Shark.c4d and
// Monster.c4d), and how the engine places them (C4Game::PlaceAnimal, InitAnimals).
// See licenses/clonk_engine_license.txt.

import { Rng } from '../core/rng';
import { MATERIALS } from '../landscape/materials';
import { ITEMS } from '../objects/defs';
import { Clonk } from '../objects/clonk';
import { Animal, ANIMALS, BIRTH_CON, COMD, type AnimalId, type Comd } from '../objects/animal';
import type { Item } from '../objects/item';
import { CLONK } from '../objects/defs';
import { CNAT } from '../objects/physics';
import type { World } from './world';

/** Scripts' TimerCall=Activity runs every 35 ticks (DefCore Timer). */
export const ACTIVITY_INTERVAL = 35;
/** Area around an animal in which it counts its own kind before having young (ReproductionAreaSize). */
const REPRODUCTION_AREA = 800;
/** A MoveTo command gives up after this many ticks. */
const MOVE_TICKS = 200;
/** An egg hatches by itself one time in this many every 35 ticks (MonsterEgg.c4d Breed). */
const EGG_HATCH = 2000;

/** Sounds animals make (Sound.c4g). */
export type AnimalSound = 'Snuff' | 'WipfHurt' | 'WipfDead' | 'Raven' | 'RavenHurt' | 'Munch1' | 'Growl' | 'DeathGrowl' | 'EggBreak';

function sound(world: World, a: { x: number; y: number }, s: AnimalSound): void {
  world.events.push({ type: 'animal', sound: s, x: a.x, y: a.y, tick: world.tick });
}

// ------------------------------------------------------------ placement

/**
 * Put an animal where its kind lives (C4Game::PlaceAnimal): on solid ground
 * somewhere, in a liquid, or in the air above the ground. Returns null when
 * the random spot doesn't work out, like the original.
 */
export function placeAnimal(world: World, id: AnimalId, rng: Rng): Animal | null {
  const def = ANIMALS[id];
  const land = world.land;
  let x = rng.int(land.width);
  let y = rng.int(land.height);
  switch (def.placement) {
    case 'surface': {
      // FindSolidGround: down to the ground (or up out of it), with room above.
      for (let tries = 0; tries < 20; tries++) {
        y = rng.int(land.height);
        while (y < land.height && !land.isSolid(x, y)) y++;
        while (y > 0 && land.isSolid(x, y)) y--;
        if (y > 0 && y < land.height - 1 && !land.isLiquid(x, y) && free(world, x, y - def.height / 2, def.width)) {
          const a = addBorn(world, id, x, y - Math.ceil(def.height / 2) + 2, rng);
          if (a) return a;
        }
        x = rng.int(land.width);
      }
      return null;
    }
    case 'liquid': {
      // FindLiquid: a random spot, then the nearest liquid deep enough around it.
      for (let tries = 0; tries < 200; tries++) {
        if (land.isLiquid(x, y) && land.isLiquid(x, y + def.height / 2) && land.isLiquid(x - def.width / 2, y) && land.isLiquid(x + def.width / 2, y)) {
          const a = addBorn(world, id, x, y + Math.trunc(def.height / 2), rng);
          if (a) return a;
        }
        x = rng.int(land.width);
        y = rng.int(land.height);
      }
      return null;
    }
    case 'air': {
      // Somewhere above the ground in this column.
      let ground = 0;
      while (ground < land.height && !land.isSolid(x, ground) && !land.isLiquid(x, ground)) ground++;
      if (ground <= def.height) return null;
      return addBorn(world, id, x, def.height / 2 + rng.int(ground - def.height));
    }
  }
}

function free(world: World, x: number, y: number, w: number): boolean {
  const land = world.land;
  return !land.isSolid(x, y) && !land.isSolid(x - w / 2, y) && !land.isSolid(x + w / 2, y) && !land.isLiquid(x, y);
}

/** Sharks and monsters don't start right next to a crew (ReClonk's own: the original places them anywhere). */
const SAFE_START = 200;

function addBorn(world: World, id: AnimalId, x: number, y: number, rng?: Rng): Animal | null {
  if ((id === 'shark' || id === 'monster') && world.clonks.some((c) => Math.abs(c.x - x) < SAFE_START && Math.abs(c.y - y) < SAFE_START)) return null;
  const a = world.addAnimal(id, Math.round(x), Math.round(y));
  birth(a, rng ?? world.rng);
  return a;
}

/** Bury nests (here: monster eggs) in the earth (C4Game::PlaceInEarth). */
export function placeInEarth(world: World, id: 'monsterEgg', rng: Rng): Item | null {
  const land = world.land;
  for (let tries = 0; tries < 50; tries++) {
    const x = rng.int(land.width);
    const y = rng.int(land.height);
    if (digable(world, x, y)) return world.spawnItem(id, x, y);
  }
  return null;
}

/** Earth or sand all around (PlaceInEarth looks for diggable ground). */
function digable(world: World, x: number, y: number): boolean {
  const land = world.land;
  const dig = (px: number, py: number): boolean => land.inBounds(px, py) && MATERIALS[land.get(px, py)].digFree;
  return dig(x, y) && dig(x, y - 3) && dig(x, y + 3) && dig(x - 3, y) && dig(x + 3, y);
}

/** Place a scenario's animals and nests at the start of a round (C4Game::InitAnimals). */
export function initAnimals(world: World, animals: Partial<Record<AnimalId, number>>, nests: Partial<Record<'monsterEgg', number>>, seed: number): void {
  const rng = new Rng(seed ^ 0xa417);
  for (const [id, n] of Object.entries(animals) as [AnimalId, number][]) for (let i = 0; i < n; i++) placeAnimal(world, id, rng);
  for (const [id, n] of Object.entries(nests) as ['monsterEgg', number][]) for (let i = 0; i < n; i++) placeInEarth(world, id, rng);
}

// ------------------------------------------------------------ the scripts

/** Birth: off it goes, to the left or the right (Animal.c4d Birth and the animals' own). */
function birth(a: Animal, rng: Rng): void {
  a.setAction(a.def.start);
  const d = rng.bool() ? 1 : -1;
  a.dir = d;
  a.comd = d < 0 ? COMD.Left : COMD.Right;
}

function turn(a: Animal, d: -1 | 1, allowed: readonly string[]): boolean {
  if (a.stuck() || !allowed.includes(a.action.name)) return false;
  if (d > 0 && a.xdir < 0) a.xdir = 0;
  if (d < 0 && a.xdir > 0) a.xdir = 0;
  a.setDir(d);
  a.comd = d < 0 ? COMD.Left : COMD.Right;
  if (a.action.name === 'Sit') a.setAction('Walk');
  return true;
}

const WIPF_TURN = ['Walk', 'Swim', 'Sit'];
const SWIM_TURN = ['Walk', 'Swim'];
const BIRD_TURN = ['Fly'];

function turnRight(a: Animal): boolean {
  return turn(a, 1, turnable(a));
}
function turnLeft(a: Animal): boolean {
  return turn(a, -1, turnable(a));
}
function turnable(a: Animal): readonly string[] {
  return a.def.id === 'wipf' ? WIPF_TURN : a.def.id === 'bird' ? BIRD_TURN : SWIM_TURN;
}
function turnRandom(world: World, a: Animal): void {
  if (world.rng.int(2)) turnRight(a);
  else turnLeft(a);
}

/** Things alive that sharks and monsters go for: clonks and wipfs (OCF_Prey). */
function* preys(world: World): Generator<Clonk | Animal> {
  for (const c of world.clonks) if (c.alive && !c.contained) yield c;
  for (const a of world.animals) if (a.alive && a.def.prey && !a.removed) yield a;
}

function preyBox(p: Clonk | Animal): { l: number; t: number; w: number; h: number } {
  if (p instanceof Clonk) return { l: p.x - CLONK.width / 2, t: p.y - CLONK.height / 2, w: CLONK.width, h: CLONK.height };
  return { l: p.left, t: p.top, w: p.width, h: p.height };
}

function preyIsSwimming(p: Clonk | Animal): boolean {
  return p instanceof Clonk ? p.action.procedure === 'swim' : p.action.name === 'Swim';
}

/**
 * A bite or a blow (ObjectComPunch): the punch in energy, then a hard one
 * (10 and up) knocks the victim over, a lighter one makes it reel back.
 */
function punch(world: World, a: Animal, p: Clonk | Animal, points: number): void {
  if (p instanceof Clonk) {
    world.hurt(p, points, null);
    world.events.push({ type: 'hit', clonk: p, points, tick: world.tick });
    if (!p.alive) return;
    p.comDir = { x: 0, y: 0 };
    if (points >= 10) p.fling(1.5 * a.dir, -2);
    else if (p.action.procedure === 'walk' || p.action.procedure === 'fight') p.setAction('GetPunched', 2.5 * a.dir, 0);
    else p.xdir = 2.5 * a.dir;
  } else {
    world.hurtAnimal(p, points, null);
    if (p.alive && points >= 10) p.fling(1.5 * a.dir, -2);
  }
}

/** Animal.c4d Reproduction: grown up, the right action, and not too many of its kind around. */
export function reproduce(world: World, a: Animal): void {
  if (!a.alive || a.con < 100) return;
  const id = a.def.id;
  if ((id === 'fish' || id === 'shark') && a.action.name !== 'Swim') return;
  if (id === 'bird' && (a.action.name !== 'Fly' || a.target)) return;
  const half = REPRODUCTION_AREA / 2;
  let count = 0;
  for (const o of world.animals) {
    if (o.def.id === id && o.alive && !o.removed && Math.abs(o.x - a.x) <= half && Math.abs(o.y - a.y) <= half) count++;
  }
  // The monster counts its eggs too.
  if (id === 'monster') {
    for (const it of world.items) if (!it.removed && it.def.egg === 'monster' && Math.abs(it.x - a.x) <= half && Math.abs(it.y - a.y) <= half) count++;
  }
  if (count >= a.def.maxCount) return;
  // A monster lays an egg; the others have their young right there.
  if (id === 'monster') {
    world.spawnItem('monsterEgg', a.x, a.y + 10);
    return;
  }
  const child = world.addAnimal(id, a.x, a.y, BIRTH_CON);
  birth(child, world.rng);
}

/** Wipf.c4d Activity. */
function wipfActivity(world: World, a: Animal): void {
  const rng = world.rng;
  if (!rng.int(15)) sound(world, a, 'Snuff');
  if (a.action.name === 'Dig' && a.comd === COMD.Stop) a.setAction('Walk');
  if (a.action.name !== 'Walk' && a.action.name !== 'Swim') return;
  // Up for air when it runs out of breath.
  if (a.inLiquid(world.land) && a.breath <= 25000 && a.comd !== COMD.Up) a.comd = COMD.Up;
  // Away from burning things ahead of it, or over them in a desperate leap.
  const x0 = a.dir < 0 ? a.x - 80 : a.x;
  if (burningIn(world, x0, a.y - 30, 80, 35)) {
    if (!rng.int(5)) {
      a.comd = a.dir > 0 ? COMD.Right : COMD.Left;
      a.jump();
    } else a.comd = a.comd === COMD.Left ? COMD.Right : COMD.Left;
  }
  if (rng.int(2)) return;
  // Dig itself free if it's stuck.
  if (a.stuck()) {
    a.setAction('DigFree');
    a.comd = a.dir < 0 ? COMD.Right : COMD.Left;
    return;
  }
  if (!rng.int(a.def.reproductionRate)) reproduce(world, a);
  if (a.action.name === 'Walk') {
    if (!rng.int(3)) {
      a.jump();
      return;
    }
    if (!rng.int(3)) {
      a.setAction('Sit');
      return;
    }
    if (!rng.int(25)) return startDig(world, a);
  }
  turnRandom(world, a);
}

/** Wipf.c4d StartDig: off in any direction but straight down. */
function startDig(world: World, a: Animal): void {
  a.setAction('Dig');
  const c = (2 + world.rng.int(7)) as Comd;
  a.comd = c === COMD.Down ? COMD.Stop : c;
}

/** Is anything burning in this box? */
function burningIn(world: World, x: number, y: number, w: number, h: number): boolean {
  const inBox = (px: number, py: number): boolean => px >= x && px < x + w && py >= y && py < y + h;
  for (const c of world.clonks) if (c.fire && !c.contained && inBox(c.x, c.y)) return true;
  for (const p of world.plants) if (p.fire && inBox(p.center.x, p.center.y)) return true;
  for (const s of world.structures) if (s.fire && inBox(s.x, s.y)) return true;
  for (const i of world.items) if (i.fire && !i.container && inBox(i.x, i.y)) return true;
  for (const o of world.animals) if (o.fire && inBox(o.x, o.y)) return true;
  for (const f of world.flames) if (inBox(f.x, f.y)) return true;
  return false;
}

/** Bird.c4d Activity. */
function birdActivity(world: World, a: Animal): void {
  const rng = world.rng;
  if (!rng.int(25)) sound(world, a, 'Raven');
  // Flying backwards: turn round.
  if (a.xdir > 0 && a.dir < 0) {
    turnRight(a);
    return;
  }
  if (a.xdir < 0 && a.dir > 0) {
    turnLeft(a);
    return;
  }
  if (rng.int(2) || a.action.name !== 'Fly') return;
  a.comd = rng.int(2) ? COMD.Down : COMD.Up;
  if (!rng.int(4)) return;
  if (!rng.int(a.def.reproductionRate)) reproduce(world, a);
  turnRandom(world, a);
}

/** Bird.c4d Survive, every frame of flying: up and away from liquids and fire. */
function birdSurvive(world: World, a: Animal): void {
  const land = world.land;
  const ahead = (k: number): boolean => land.isLiquid(Math.round(a.x + a.xdir * k), Math.round(a.y + a.ydir * k));
  if (a.inLiquid(land) || ahead(2) || ahead(3) || burningIn(world, a.x - 20 + a.xdir * 2, a.y - 20 + a.ydir * 2, 40, 40)) a.comd = COMD.Up;
}

/** Fish.c4d Activity. */
function fishActivity(world: World, a: Animal): void {
  const rng = world.rng;
  const land = world.land;
  if (a.action.name === 'Walk') a.comd = rng.int(2) ? COMD.Right : COMD.Left;
  if (!rng.int(a.def.reproductionRate)) reproduce(world, a);
  // Flee from what moves in the water nearby: clonks, and thrown things.
  let threat: { x: number; y: number } | null = null;
  if (a.inLiquid(land)) {
    let best = 101;
    const consider = (o: { x: number; y: number; xdir: number; ydir: number }): void => {
      const d = Math.hypot(o.x - a.x, o.y - a.y);
      if (d >= best) return;
      if (Math.abs(o.xdir) <= 2 && Math.abs(o.ydir) <= 3) return;
      if (!land.isLiquid(o.x, o.y) || land.isSolid(o.x, o.y + 8)) return;
      best = d;
      threat = o;
    };
    for (const c of world.clonks) if (c.alive && !c.contained) consider(c);
    for (const i of world.items) if (!i.container && !i.removed) consider(i);
    for (const v of world.vehicles) if (!v.removed && !v.contained) consider(v);
  }
  if (threat) {
    const t = threat as { x: number; y: number };
    const xd = t.x - a.x;
    const yd = t.y - a.y;
    const fx = a.x - Math.sign(xd) * Math.trunc(1500 / clamp(Math.abs(xd), 20, 80));
    const fy = a.y - Math.sign(yd) * Math.trunc(1000 / clamp(Math.abs(yd), 20, 80));
    moveTo(a, fx, fy);
  } else if (a.target || !a.inLiquid(land)) a.target = null;
  if (!land.isLiquid(a.x, a.y - 8) && a.action.name !== 'Walk') {
    a.comd = COMD.Down;
    return;
  }
  if (rng.int(2) || a.action.name !== 'Swim') return;
  if (!rng.int(10)) {
    a.comd = COMD.Up;
    return;
  }
  if (!rng.int(10)) {
    a.comd = COMD.Down;
    return;
  }
  turnRandom(world, a);
}

/** Shark.c4d Activity. */
function sharkActivity(world: World, a: Animal): void {
  const rng = world.rng;
  if (!world.land.isLiquid(a.x, a.y - 8) && a.action.name !== 'Walk') {
    a.comd = downward(a.comd);
    return;
  }
  if (rng.int(2) || a.action.name !== 'Swim') return;
  turnRandom(world, a);
  // Keep out of other sharks' way.
  const other = world.animals.find((o) => o !== a && o.def.id === 'shark' && o.alive && o.action.name === 'Swim' && Math.abs(o.x - a.x) <= 100 && o.y - a.y >= -25 && o.y - a.y < 25);
  if (other) {
    if (other.y < a.y) a.comd = downward(a.comd);
    else a.comd = a.comd === COMD.Right ? COMD.UpRight : COMD.UpLeft;
  }
}

/** BoundBy(comdir, COMD_DownRight, COMD_DownLeft). */
function downward(c: Comd): Comd {
  return Math.max(COMD.DownRight, Math.min(COMD.DownLeft, c)) as Comd;
}

/** Shark.c4d SwimStart, each time the swim animation starts over: bite, or go after prey. */
function sharkSwimStart(world: World, a: Animal): void {
  if (sharkAttack(world, a)) return;
  const prey = findPrey(world, a);
  if (!prey) return;
  // Always from behind, a bit away.
  const fromSide = prey.dir > 0 ? -1 : 1;
  moveTo(a, prey.x + 15 * fromSide, prey.y);
}

/** Shark.c4d FindPrey: something swimming nearby, else anything alive in the water. */
function findPrey(world: World, a: Animal): Clonk | Animal | null {
  const near = (p: Clonk | Animal): boolean => p.x - a.x >= -250 && p.x - a.x < 250 && p.y - a.y >= -100 && p.y - a.y < 100;
  let any: Clonk | Animal | null = null;
  for (const p of preys(world)) {
    if (!near(p)) continue;
    if (preyIsSwimming(p)) return p;
    if (!any && world.land.isLiquid(p.x, p.y)) any = p;
  }
  return any;
}

/** Shark.c4d Attack: every 2 seconds at most, a bite at whatever is right in front of its mouth. */
function sharkAttack(world: World, a: Animal): boolean {
  if (a.attackDelay > 0 || a.action.name !== 'Swim') return false;
  const rx = a.x + (a.dir > 0 ? 15 : -25);
  const ry = a.y;
  for (const p of preys(world)) {
    const b = preyBox(p);
    if (b.l >= rx + 10 || b.l + b.w <= rx || b.t >= ry + 10 || b.t + b.h <= ry) continue;
    punch(world, a, p, 8);
    a.setAction('Jaw');
    sound(world, a, 'Munch1');
    a.attackDelay = 70;
    return true;
  }
  return false;
}

/** Shark.c4d Swimming, every frame: calm the up and down, and turn before it hits the bank. */
function sharkSwimming(world: World, a: Animal): void {
  const rng = world.rng;
  a.ydir = (a.ydir * 100) / 120;
  if (world.land.isSolid(a.x + 75, a.y)) {
    turnLeft(a);
    a.comd = !rng.int(5) ? COMD.UpLeft : !rng.int(6) ? COMD.DownLeft : COMD.Left;
  } else if (world.land.isSolid(a.x - 75, a.y)) {
    turnRight(a);
    a.comd = !rng.int(5) ? COMD.UpRight : !rng.int(6) ? COMD.DownRight : COMD.Right;
  }
}

/** Monster.c4d Activity. */
function monsterActivity(world: World, a: Animal): void {
  const rng = world.rng;
  if (rng.int(2) || (a.action.name !== 'Walk' && a.action.name !== 'Swim')) return;
  if (!rng.int(a.def.reproductionRate)) reproduce(world, a);
  if (a.action.name === 'Walk') {
    if (!rng.int(3)) {
      if (rng.int(2)) sound(world, a, 'Growl');
      a.jump();
      return;
    }
    if (!rng.int(8)) {
      a.setAction('LookUp');
      return;
    }
  }
  turnRandom(world, a);
}

/** Monster.c4d HitCheck, each time it starts a step or a stroke: it knocks over whatever prey it runs into. */
function monsterHitCheck(world: World, a: Animal): void {
  for (const p of preys(world)) {
    if (p === a) continue;
    const b = preyBox(p);
    const px = a.x + 1;
    if (px >= b.l && px < b.l + b.w && a.y >= b.t && a.y < b.t + b.h) {
      punch(world, a, p, 10);
      return;
    }
  }
}

function activity(world: World, a: Animal): void {
  switch (a.def.id) {
    case 'wipf':
      return wipfActivity(world, a);
    case 'bird':
      return birdActivity(world, a);
    case 'fish':
      return fishActivity(world, a);
    case 'shark':
      return sharkActivity(world, a);
    case 'monster':
      return monsterActivity(world, a);
  }
}

/** The ContactLeft/Right/Top/Bottom calls. */
function contact(world: World, a: Animal, cnat: number): void {
  const rng = world.rng;
  const id = a.def.id;
  if (cnat & CNAT.Left) {
    turnRight(a);
    if (id === 'bird' && !rng.int(5)) a.comd = rng.int(2) ? COMD.DownRight : COMD.UpRight;
  }
  if (cnat & CNAT.Right) {
    turnLeft(a);
    if (id === 'bird' && !rng.int(5)) a.comd = rng.int(2) ? COMD.DownLeft : COMD.UpLeft;
  }
  if (id === 'bird' || id === 'fish' || id === 'shark') {
    if (cnat & CNAT.Top) a.comd = COMD.Down;
    if (cnat & CNAT.Bottom) {
      if (id === 'bird') a.comd = COMD.Up;
      else {
        if (a.action.name !== 'Walk') a.comd = COMD.Up;
        if (rng.int(10)) a.comd = COMD.Right;
        if (rng.int(10)) a.comd = COMD.Left;
      }
    }
  }
}

/** Head for the MoveTo target, if it has one. */
function moveTo(a: Animal, x: number, y: number): void {
  a.target = { x: Math.round(x), y: Math.round(y) };
  a.targetTicks = MOVE_TICKS;
}

function steer(a: Animal): void {
  const t = a.target;
  if (!t) return;
  if (--a.targetTicks <= 0) {
    a.target = null;
    return;
  }
  const dx = t.x - a.x;
  const dy = t.y - a.y;
  if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
    a.target = null;
    return;
  }
  const sx = Math.abs(dx) < 4 ? 0 : Math.sign(dx);
  const sy = Math.abs(dy) < 4 ? 0 : Math.sign(dy);
  const c: Comd = sy < 0 ? (sx < 0 ? COMD.UpLeft : sx > 0 ? COMD.UpRight : COMD.Up) : sy > 0 ? (sx < 0 ? COMD.DownLeft : sx > 0 ? COMD.DownRight : COMD.Down) : sx < 0 ? COMD.Left : COMD.Right;
  a.comd = c;
  if (sx && sx !== a.dir) a.setDir(sx as -1 | 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ------------------------------------------------------------ the world

/** One tick of every animal: growing, breathing, its script, the engine's movement, and dying. */
export function stepAnimals(world: World): void {
  const land = world.land;
  for (const a of world.animals) {
    if (a.removed) continue;
    if (land.bottomOpen && a.y > land.height + 20) {
      a.removed = true;
      continue;
    }
    if (a.alive) {
      // Growing up (C4Object::ExecLife: Growth every 35 ticks, not while burning).
      if (world.tick % 35 === 0 && a.con < 100 && !a.fire) a.con = Math.min(100, a.con + a.def.growth);
      if (world.tick % 5 === 0) breathe(world, a);
      if (++a.timer >= ACTIVITY_INTERVAL) {
        a.timer = 0;
        activity(world, a);
      }
      steer(a);
    }
    if (!a.alive && !a.corpse) died(world, a);
    if (a.removed) continue;
    const hit = a.tick(land);
    if (a.alive && hit) contact(world, a, hit);
    if (a.alive) actionCalls(world, a);
    if (!a.alive && !a.corpse) died(world, a);
  }
  if (world.animals.some((a) => a.removed)) world.animals = world.animals.filter((a) => !a.removed);
  stepEggs(world);
  releaseCarried(world);
}

/** The StartCall, PhaseCall and EndCall functions of their actions. */
function actionCalls(world: World, a: Animal): void {
  const rng = world.rng;
  const name = a.action.name;
  switch (a.def.id) {
    case 'wipf':
      // Dig: DigSound now and then digs off another way; Sit: Sitting gets up again.
      if (a.actionStarted && name === 'Dig' && !rng.int(10)) startDig(world, a);
      if (a.actionStarted && name === 'Sit' && !rng.int(10)) a.setAction('Walk');
      break;
    case 'bird':
      if (a.phaseStarted && name === 'Fly') birdSurvive(world, a);
      break;
    case 'shark':
      if (a.actionStarted && name === 'Swim') sharkSwimStart(world, a);
      if (a.phaseStarted && name === 'Swim') sharkSwimming(world, a);
      break;
    case 'monster':
      if (a.actionStarted && (name === 'Walk' || name === 'Swim')) monsterHitCheck(world, a);
      break;
  }
}

/** Breathing, every 5 ticks (C4Object::ExecLife): out of air, it loses breath, then energy. */
function breathe(world: World, a: Animal): void {
  if (a.breathes(world.land)) {
    a.breath = a.def.breath * 1000;
    return;
  }
  if (a.breath > 0) a.breath = Math.max(0, a.breath - 2000);
  else world.hurtAnimal(a, 1, null);
}

/**
 * It died (Death and ChangeDef to its Dead.c4d): small animals become a dead
 * body to pick up and sell, the shark and the monster lie where they fell and rot.
 */
function died(world: World, a: Animal): void {
  a.corpse = true;
  a.fire = null;
  if (a.def.id === 'wipf') sound(world, a, 'WipfDead');
  if (a.def.id === 'monster') sound(world, a, 'DeathGrowl');
  const dead = a.def.dead;
  if ('item' in dead) {
    const it = world.spawnItem(dead.item, a.x, a.y, a.xdir, a.ydir);
    it.con = a.con * 1000;
    a.removed = true;
  } else {
    a.setAction(a.def.start);
    a.tAttach = CNAT.None;
  }
}

/** It got hurt: the wipf squeaks, the bird croaks one time in three (CatchBlow). */
export function animalHurt(world: World, a: Animal): void {
  if (!a.alive || world.rng.int(3)) return;
  if (a.def.id === 'wipf') sound(world, a, 'WipfHurt');
  if (a.def.id === 'bird') sound(world, a, 'RavenHurt');
}

// ------------------------------------------------------------ eggs and carried animals

/**
 * Monster eggs (MonsterEgg.c4d): now and then one hatches by itself, if
 * nothing solid is around it and nobody carries it.
 */
function stepEggs(world: World): void {
  if (world.tick % ACTIVITY_INTERVAL !== 0) return;
  for (const it of world.items) {
    if (it.removed || !it.def.egg || it.container) continue;
    if (!world.rng.int(EGG_HATCH)) breakEgg(world, it);
  }
}

/** The egg breaks (DoBreak): a young monster comes out, unless it's buried in the ground. */
export function breakEgg(world: World, egg: Item): void {
  if (egg.removed || !egg.def.egg) return;
  const holder = egg.container as Clonk | null;
  if (holder && holder.contents) holder.contents.splice(holder.contents.indexOf(egg), 1);
  egg.container = null;
  egg.removed = true;
  sound(world, egg, 'EggBreak');
  if (world.land.isSolid(egg.x, egg.y)) return;
  const child = world.addAnimal(egg.def.egg, egg.x, egg.y - 4, BIRTH_CON);
  birth(child, world.rng);
}

/** A thrown egg breaks one time in two when it lands (Hit). */
export function eggHit(world: World, egg: Item): void {
  if (egg.def.egg && world.rng.int(2)) breakEgg(world, egg);
}

/**
 * The Collectible animals rule (CollectibleAnimals.c4d): a clonk picks up
 * a wipf or a fish it runs into, as long as its hands are free and the wipf
 * isn't jumping. It stays alive in its hands.
 */
export function collectAnimal(world: World, c: Clonk): Item | null {
  if (!world.rules.has('collectibleAnimals') || c.contents.length >= CLONK.maxContents || c.action.disabled) return null;
  const r = CLONK.collection;
  for (const a of world.animals) {
    if (!a.alive || a.removed || !a.def.collectible || !a.def.carried || a.action.name === 'Jump') continue;
    const dx = a.x - c.x;
    const dy = a.y - c.y;
    if (dx < r.x || dx >= r.x + r.w || dy < r.y || dy >= r.y + r.h) continue;
    a.removed = true;
    const it = world.spawnItem(a.def.carried, c.x, c.y);
    it.life = { energy: a.energy, con: a.con };
    it.container = c;
    c.contents.push(it);
    return it;
  }
  return null;
}

/** A live animal let go of (thrown, dropped, out of a building) runs or swims off again. */
function releaseCarried(world: World): void {
  for (const it of world.items) {
    const id = it.def.animal;
    if (!id || it.removed || it.container) continue;
    it.removed = true;
    const a = world.addAnimal(id, it.x, it.y, it.life?.con ?? 100);
    if (it.life) a.energy = it.life.energy;
    a.xdir = it.xdir;
    a.ydir = it.ydir;
    birth(a, world.rng);
    if (a.has('Jump') && (it.xdir || it.ydir)) a.setAction('Jump', it.xdir, it.ydir);
  }
}

/** True for item kinds that are animals (alive, dead, or an egg). */
export function isAnimalItem(id: keyof typeof ITEMS): boolean {
  const d = ITEMS[id];
  return !!(d.animal || d.egg || d.decay || id === 'deadBird');
}
