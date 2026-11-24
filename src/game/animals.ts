// What animals do, from their scripts in the original Clonk Rage content
// (Objects.c4d/Animals.c4d: Animal.c4d's reproduction, and the Activity timers,
// contact calls and action calls of Wipf.c4d, Bird.c4d, Fish.c4d, Shark.c4d,
// Monster.c4d, Snake.c4d, FireMonster.c4d and ZapNest.c4d/Zap.c4d; the eggs,
// the zap nest and the bird's nest), and how the engine places them
// (C4Game::PlaceAnimal, PlaceInEarth, InitAnimals).
// See licenses/clonk_engine_license.txt.

import { Rng } from '../core/rng';
import { MATERIALS, type ItemId } from '../landscape/materials';
import { ITEMS } from '../objects/defs';
import { Clonk } from '../objects/clonk';
import { Animal, ANIMALS, BIRTH_CON, COMD, type AnimalId, type Comd } from '../objects/animal';
import type { Item } from '../objects/item';
import { CLONK } from '../objects/defs';
import { CNAT } from '../objects/physics';
import { NEST, TreeNest } from '../objects/nest';
import { FULL_CON, type Plant } from '../objects/vegetation';
import { spitFlame } from './liquids';
import type { World } from './world';

/** Scripts' TimerCall=Activity runs every 35 ticks (DefCore Timer). */
export const ACTIVITY_INTERVAL = 35;
/** Area around an animal in which it counts its own kind before having young (ReproductionAreaSize). */
const REPRODUCTION_AREA = 800;
/** A MoveTo command gives up after this many ticks. */
const MOVE_TICKS = 200;
/** An egg hatches by itself one time in this many every 35 ticks (MonsterEgg.c4d and FireMonsterEgg.c4d Breed). */
const EGG_HATCH = 2000;
/** A bird egg in a nest hatches after brooding this many times 35 ticks; broken before half that, it's empty (BirdEgg.c4d). */
const BIRD_EGG = { hatch: 50, alive: 25 };
/** A Call command (a bird off to build or sit in its nest) gives up after this many ticks. */
const CALL_TICKS = 600;

/** Sounds animals make (Sound.c4g). */
export type AnimalSound = 'Snuff' | 'WipfHurt' | 'WipfDead' | 'Raven' | 'RavenHurt' | 'Munch1' | 'Growl' | 'DeathGrowl' | 'EggBreak' | 'Snake' | 'Inflame' | 'Bsss' | 'Sting';

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
  if ((id === 'shark' || id === 'monster' || id === 'fireMonster') && world.clonks.some((c) => Math.abs(c.x - x) < SAFE_START && Math.abs(c.y - y) < SAFE_START)) return null;
  const a = world.addAnimal(id, Math.round(x), Math.round(y));
  birth(a, rng ?? world.rng);
  return a;
}

/** Bury nests (eggs and zap nests) in the earth (C4Game::PlaceInEarth). */
export function placeInEarth(world: World, id: ItemId, rng: Rng): Item | null {
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
export function initAnimals(world: World, animals: Partial<Record<AnimalId, number>>, nests: Partial<Record<ItemId, number>>, seed: number): void {
  const rng = new Rng(seed ^ 0xa417);
  for (const [id, n] of Object.entries(animals) as [AnimalId, number][]) for (let i = 0; i < n; i++) placeAnimal(world, id, rng);
  for (const [id, n] of Object.entries(nests) as [ItemId, number][]) for (let i = 0; i < n; i++) placeInEarth(world, id, rng);
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
function punch(world: World, a: { dir: -1 | 1 }, p: Clonk | Animal, points: number): void {
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
function reproduce(world: World, a: Animal): void {
  if (!a.alive || a.con < 100) return;
  const id = a.def.id;
  if ((id === 'fish' || id === 'shark') && a.action.name !== 'Swim') return;
  if (id === 'bird' && (a.action.name !== 'Fly' || a.target)) return;
  const half = REPRODUCTION_AREA / 2;
  let count = 0;
  for (const o of world.animals) {
    if (o.def.id === id && o.alive && !o.removed && Math.abs(o.x - a.x) <= half && Math.abs(o.y - a.y) <= half) count++;
  }
  // Monsters count their eggs too, birds their young on the way: the ones they're expecting and the eggs they've laid.
  for (const it of world.items) {
    if (it.removed || it.def.egg !== id || (id === 'bird' && !it.laid)) continue;
    const at = it.container ?? it;
    if (Math.abs(at.x - a.x) <= half && Math.abs(at.y - a.y) <= half) count++;
  }
  if (id === 'bird') for (const o of world.animals) if (o.def.id === 'bird' && o.expecting && Math.abs(o.x - a.x) <= half && Math.abs(o.y - a.y) <= half) count++;
  if (count >= a.def.maxCount) return;
  // Monsters lay an egg, a bird sees to a nest; the others have their young right there.
  if (id === 'monster' || id === 'fireMonster') {
    world.spawnItem(id === 'monster' ? 'monsterEgg' : 'fireMonsterEgg', a.x, a.y + 10);
    return;
  }
  if (id === 'bird') return birdNesting(world, a);
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
  // Off somewhere: to a tree, or its nest.
  if (a.target) return;
  // A young one on the way: on with the nest.
  if (a.expecting) reproduce(world, a);
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


// ------------------------------------------------------------ bird nests

/**
 * Bird.c4d SpecialRepr: a bird with a young one on the way needs a nest. With
 * none, it looks for a grown tree nearby without one and flies into its crown
 * to build one; with a nest and no egg in it, it flies there to lay one.
 */
function birdNesting(world: World, a: Animal): void {
  const land = world.land;
  // A nest that fell out of its tree, or got flooded, is no good any more.
  if (a.nest && (a.nest.removed || a.nest.state !== 'be' || land.isLiquid(Math.round(a.nest.x), Math.round(a.nest.y)) || land.isSolid(Math.round(a.nest.x), Math.round(a.nest.y)))) a.nest = null;
  if (!a.nest) {
    const tree = findTree(world, a);
    if (tree) {
      // A nice spot in its crown.
      const s = tree.shape;
      const fireTop = tree.def.burned.fireTop * tree.scale;
      const x = s.x + world.rng.int(Math.max(1, Math.trunc(s.w - 20))) + 10;
      const y = s.y + world.rng.int(Math.max(1, Math.trunc(s.h - fireTop - 20))) + 10;
      moveTo(a, x, y, { call: 'buildNest', tree });
    }
    a.expecting = true;
    return;
  }
  if (!world.items.some((i) => i.onNest === a.nest && !i.removed)) {
    a.expecting = true;
    moveTo(a, a.nest.x, a.nest.y, { call: 'breed' });
  }
}

/** Bird.c4d FindTree: a standing, grown tree within 500 px, not burning, not under water, without a nest. */
function findTree(world: World, a: Animal): Plant | null {
  for (const p of world.plants) {
    if (!p.def.id.startsWith('tree') || p.state !== 'standing' || p.removed || p.fire || p.con < FULL_CON) continue;
    const c = p.center;
    if (Math.hypot(c.x - a.x, c.y - a.y) >= 500) continue;
    if (world.land.isSolid(Math.round(c.x), Math.round(c.y)) || world.land.isLiquid(Math.round(c.x), Math.round(c.y))) continue;
    if (world.treeNests.some((n) => n.tree === p && !n.removed && n.state !== 'decay')) continue;
    return p;
  }
  return null;
}

/** Bird.c4d BuildNest: there, it starts a nest beside it, half built, and stops to work on it. */
function buildNest(world: World, a: Animal, tree: Plant): void {
  if (tree.removed || tree.state !== 'standing') return;
  a.dir = tree.x < a.x ? -1 : 1;
  const nest = new TreeNest(a.x + (a.dir > 0 ? 12 : -12), a.y + 5, tree);
  world.treeNests.push(nest);
  a.nest = nest;
  a.setAction('BuildNest');
  a.comd = COMD.Stop;
  a.xdir = a.ydir = 0;
}

/** Bird.c4d Build, every 40 ticks of building: 10 more percent, and when it's done it goes and sits in it. */
function buildStep(world: World, a: Animal): void {
  const nest = a.nest;
  if (!nest || nest.removed || nest.state === 'decay') {
    a.setAction('Fly');
    birdActivity(world, a);
    return;
  }
  nest.con = Math.min(100, nest.con + NEST.buildStep);
  if (nest.con < 100) return;
  a.setAction('Fly');
  moveTo(a, nest.x, nest.y, { call: 'breed' });
}

/** Bird.c4d StartBreeding: into the nest, to sit on it (the nest's Bird action). */
function startBreeding(a: Animal): void {
  const nest = a.nest;
  if (!nest || nest.removed || nest.state !== 'be') return;
  a.inNest = nest;
  a.setPosition(Math.round(nest.x), Math.round(nest.y));
  a.xdir = a.ydir = 0;
  a.target = null;
  nest.state = 'bird';
  nest.time = 0;
}

/** Bird.c4d LayEgg: an egg in the nest with the young one in it, and off it flies. */
function layEgg(world: World, a: Animal, nest: TreeNest): void {
  const egg = world.spawnItem('birdEgg', nest.x, nest.y - 1);
  egg.onNest = nest;
  egg.laid = a.expecting;
  a.expecting = false;
  leaveNest(world, a);
  birdActivity(world, a);
}

function leaveNest(world: World, a: Animal): void {
  const nest = a.inNest;
  a.inNest = null;
  if (nest && nest.state === 'bird') nest.state = 'be';
  a.setAction('Fly');
  birth(a, world.rng);
}

/**
 * Nest.c4d: it hangs in its tree, and when the tree is gone, burns or falls
 * (Check4Tree, every 10 ticks), or the nest catches fire or gets wet, it
 * drops with whatever is in it, and rots away.
 */
function stepNests(world: World): void {
  if (!world.treeNests.length) return;
  const land = world.land;
  for (const n of world.treeNests) {
    if (n.removed) continue;
    n.time++;
    const x = Math.round(n.x);
    const y = Math.round(n.y);
    if (n.state !== 'decay') {
      const t = n.tree;
      if (world.tick % NEST.checkInterval === 0 && (t.removed || t.fire || t.state !== 'standing')) dropNest(world, n);
      else if (land.isLiquid(x, y)) dropNest(world, n);
      else if (world.tick % ACTIVITY_INTERVAL === 0 && burningAt(world, n)) dropNest(world, n);
    }
    if (n.state === 'bird' && n.time >= NEST.brood) {
      // Breed: the bird in it lays its egg.
      n.time = 0;
      const bird = world.animals.find((b) => b.inNest === n);
      if (bird) layEgg(world, bird, n);
      else n.state = 'be';
    }
    if (n.state === 'decay') {
      // Fallen: it drops to the ground and lies there.
      n.ydir = land.isLiquid(x, y) ? Math.max(n.ydir - land.gravity, -1) : n.ydir + land.gravity;
      const bottom = Math.trunc(n.h / 2);
      let ny = n.y;
      const steps = Math.ceil(Math.abs(n.ydir));
      for (let i = 0; i < steps; i++) {
        const next = ny + n.ydir / steps;
        if (land.isSolid(x, Math.round(next) + bottom)) {
          n.ydir = 0;
          break;
        }
        ny = next;
      }
      n.y = ny;
      if (n.time >= NEST.decay || n.y > land.height + 20) n.removed = true;
    }
  }
  if (world.treeNests.some((n) => n.removed)) world.treeNests = world.treeNests.filter((n) => !n.removed);
}

/** The nest comes down: the egg in it falls, the bird in it flies off (Check4Tree, Incineration). */
export function dropNest(world: World, n: TreeNest): void {
  if (n.state === 'decay') return;
  n.fall();
  for (const i of world.items) if (i.onNest === n) i.onNest = null;
  for (const b of world.animals) if (b.inNest === n) leaveNest(world, b);
}

/** Is a burning thing's centre in the nest (it catches fire: ContactIncinerate 1)? */
function burningAt(world: World, n: TreeNest): boolean {
  const at = (o: { x: number; y: number }): boolean => n.contains(Math.round(o.x), Math.round(o.y));
  for (const c of world.clonks) if (c.fire && !c.contained && at(c)) return true;
  for (const p of world.plants) if (p.fire && p !== n.tree && at(p.center)) return true;
  for (const i of world.items) if (i.fire && !i.container && at(i)) return true;
  for (const o of world.animals) if (o.fire && at(o)) return true;
  for (const f of world.flames) if (at(f)) return true;
  return false;
}

// ------------------------------------------------------------ snake

/** Snake.c4d Activity. */
function snakeActivity(world: World, a: Animal): void {
  const rng = world.rng;
  if (!rng.int(15)) sound(world, a, 'Snake');
  if (a.action.name !== 'Walk' && a.action.name !== 'Swim') return;
  snakeAttack(world, a);
  if (!rng.int(a.def.reproductionRate)) reproduce(world, a);
  if (rng.int(2)) return;
  if (a.action.name === 'Walk' && !rng.int(3)) {
    a.jump();
    return;
  }
  turnRandom(world, a);
}

/** Snake.c4d Attack: walking or swimming, every 2 seconds at most, it bites the prey right in front of it. */
function snakeAttack(world: World, a: Animal): boolean {
  if (a.attackDelay > 0 || (a.action.name !== 'Walk' && a.action.name !== 'Swim')) return false;
  const px = a.x + (a.dir > 0 ? 13 : -13);
  const py = a.y;
  for (const p of preys(world)) {
    const b = preyBox(p);
    if (px < b.l || px >= b.l + b.w || py < b.t || py >= b.t + b.h) continue;
    punch(world, a, p, 8);
    sound(world, a, 'Snake');
    a.attackDelay = 70;
    return true;
  }
  return false;
}

/**
 * A snake in a clonk's hands keeps on with its Activity: it does nothing two
 * times in three (it's contained), else it bites whoever holds it (Attack:
 * pPrey = Contained()).
 */
function carriedSnakes(world: World): void {
  for (const it of world.items) {
    if (it.removed || it.def.animal !== 'snake' || !(it.container instanceof Clonk)) continue;
    if (it.biteDelay > 0) it.biteDelay--;
    if (world.tick % ACTIVITY_INTERVAL !== 0 || world.rng.int(3) || it.biteDelay > 0) continue;
    const c = it.container;
    if (!c.alive) continue;
    punch(world, { dir: c.dir }, c, 8);
    sound(world, c, 'Snake');
    it.biteDelay = 70;
  }
}

// ------------------------------------------------------------ fire monster

/** FireMonster.c4d Activity: like the monster's, and now and then it spits fire. */
function fireMonsterActivity(world: World, a: Animal): void {
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
      startFlame(world, a);
      return;
    }
    if (!rng.int(8)) {
      a.setAction('LookUp');
      return;
    }
  }
  turnRandom(world, a);
}

/** FireMonster.c4d StartFlame: at most every 140 ticks (IntNoAttack). */
function startFlame(world: World, a: Animal): void {
  if (a.action.name !== 'Walk' || a.attackDelay > 0) return;
  a.attackDelay = 140;
  a.setAction('Flame');
  sound(world, a, 'Inflame');
  sound(world, a, 'Growl');
}

/**
 * FireMonster.c4d Flaming, every 2 ticks of the Flame action: a burning
 * DuraFlame out of its mouth, flying 3 or 4 px a tick, until it has spat
 * for 10 ticks.
 */
function flaming(world: World, a: Animal): void {
  const right = a.dir > 0;
  // Exit(pFlame, -15 + Dir * 30, +2, 0, -4 + Dir * 6 + Random(2)), the flame's top-left offset making it 9 px higher.
  spitFlame(world, a.x + (right ? 15 : -15), a.y + 2 - 9, (right ? 2 : -4) + world.rng.int(2), 0);
  if (a.actionTime > 10) a.setAction('Walk');
}

// ------------------------------------------------------------ zaps

/** ZapNest.c4d BreakUp: the nest bursts into zaps, wherever there's room around it. */
export function burstZapNest(world: World, nest: Item): void {
  if (nest.removed || !nest.def.swarm) return;
  const holder = nest.container as Clonk | null;
  if (holder && holder.contents) holder.contents.splice(holder.contents.indexOf(nest), 1);
  nest.container = null;
  nest.removed = true;
  for (let i = 0; i < nest.def.swarm; i++) {
    const x = Math.round(nest.x) + world.rng.int(11) - 5;
    const y = Math.round(nest.y) + world.rng.int(11) - 5;
    if (world.land.isSolid(x, y)) continue;
    const z = world.addAnimal('zap', x, y);
    z.setAction('Fly');
    z.phase = world.rng.int(6);
  }
  sound(world, nest, 'Bsss');
}

/** Zap.c4d Flying, each frame (every 3 ticks): one time in four a new random speed, towards its target if it has one. */
function zapFlying(world: World, a: Animal): void {
  const rng = world.rng;
  if (rng.int(4)) return;
  let xdir = rng.int(13) - 6;
  let ydir = rng.int(9) - 4;
  const t = a.chase;
  if (t) {
    xdir += clamp(Math.round(t.x - a.x), -11, 11);
    ydir += clamp(Math.trunc((t.y - a.y) / 3), -7, 7);
  }
  // SetSpeed is in tenths of a pixel a tick.
  if (world.land.isLiquid(a.x + xdir, a.y + ydir)) xdir = ydir = 0;
  a.xdir = xdir / 10;
  a.ydir = ydir / 10;
}

/** Zap.c4d Check, every 18 ticks: it dies buried, in water or of old age; it picks its victims, and stings them. */
function zapCheck(world: World, a: Animal): void {
  const rng = world.rng;
  const land = world.land;
  const semiSolid = (x: number, y: number): boolean => land.isSolid(Math.round(x), Math.round(y)) || land.isLiquid(Math.round(x), Math.round(y));
  if (semiSolid(a.x, a.y) || !rng.int(160)) return zapDies(a);
  if (!rng.int(50)) sound(world, a, 'Bsss');
  if (!rng.int(10)) a.chase = zapTarget(world, a, 200);
  if (!rng.int(30)) a.chase = null;
  const t = a.chase as Clonk | Animal | null;
  if (t && (t.removed || !t.alive || (t instanceof Clonk && t.contained) || semiSolid(t.x, t.y))) a.chase = null;
  if (a.chase && !rng.int(5) && !pathFree(world, a.x, a.y, a.chase.x, a.chase.y)) a.chase = null;
  if (rng.int(2)) return;
  for (const p of preys(world)) {
    const b = preyBox(p);
    const px = a.x + 1;
    if (px < b.l || px >= b.l + b.w || a.y < b.t || a.y >= b.t + b.h) continue;
    // Sting.
    punch(world, a, p, 3 + rng.int(2));
    sound(world, a, 'Sting');
    if (!rng.int(3)) zapDies(a);
    return;
  }
}

function zapDies(a: Animal): void {
  a.alive = false;
  a.removed = true;
}

/** Zap.c4d FindTarget: the nearest prey, if it's close enough and not in water. */
function zapTarget(world: World, a: Animal, maxDist: number): Clonk | Animal | null {
  let best: Clonk | Animal | null = null;
  let bestD = Infinity;
  for (const p of preys(world)) {
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (!best || bestD >= maxDist) return null;
  const land = world.land;
  if (land.isSolid(Math.round(best.x), Math.round(best.y)) || land.isLiquid(Math.round(best.x), Math.round(best.y))) return null;
  return best;
}

/** No solid pixel on the line between two points (PathFree). */
function pathFree(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
  for (let i = 0; i <= n; i++) {
    const k = n ? i / n : 0;
    if (world.land.isSolid(Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k))) return false;
  }
  return true;
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
    case 'snake':
      return snakeActivity(world, a);
    case 'fireMonster':
      return fireMonsterActivity(world, a);
    // Zaps have no timer: they do everything in their action calls.
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

/** Head for the MoveTo target, and then (a Call command) do something there. */
function moveTo(a: Animal, x: number, y: number, then: Animal['then'] = null): void {
  a.target = { x: Math.round(x), y: Math.round(y) };
  a.targetTicks = then ? CALL_TICKS : MOVE_TICKS;
  a.then = then;
}

function steer(world: World, a: Animal): void {
  const t = a.target;
  if (!t) return;
  if (--a.targetTicks <= 0) {
    a.target = null;
    a.then = null;
    return;
  }
  const dx = t.x - a.x;
  const dy = t.y - a.y;
  if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
    a.target = null;
    const then = a.then;
    a.then = null;
    if (then?.call === 'buildNest') buildNest(world, a, then.tree);
    if (then?.call === 'breed') startBreeding(a);
    return;
  }
  // Flying, it slows down on the way in, so it doesn't overshoot (the engine's MoveTo for FLOAT).
  if (a.action.procedure === 'float') {
    if (Math.abs(dx) < 12) a.xdir *= 0.8;
    if (Math.abs(dy) < 12) a.ydir *= 0.8;
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
    if (a.removed || a.inNest) continue;
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
      steer(world, a);
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
  carriedSnakes(world);
  stepNests(world);
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
    case 'fireMonster':
      if (a.actionStarted && (name === 'Walk' || name === 'Swim')) monsterHitCheck(world, a);
      if (a.actionStarted && name === 'Flame') flaming(world, a);
      break;
    case 'zap':
      if (a.phaseStarted && name === 'Fly') zapFlying(world, a);
      if (a.actionEnded === 'Fly') zapCheck(world, a);
      break;
  }
  if (a.def.id === 'bird' && a.actionEnded === 'BuildNest') buildStep(world, a);
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
  if (a.def.id === 'monster' || a.def.id === 'fireMonster') sound(world, a, 'DeathGrowl');
  const dead = a.def.dead;
  if ('gone' in dead) {
    a.removed = true;
    return;
  }
  if (a.def.id === 'fireMonster') a.dir = -1;
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
 * Monster eggs (MonsterEgg.c4d, FireMonsterEgg.c4d): now and then one hatches
 * by itself, if nothing solid is around it and nobody carries it. A bird egg
 * (BirdEgg.c4d) only broods in a nest, and hatches there.
 */
function stepEggs(world: World): void {
  if (world.tick % ACTIVITY_INTERVAL !== 0) return;
  for (const it of world.items) {
    if (it.removed || !it.def.egg || it.container) continue;
    if (it.def.eggInNest) {
      if (it.onNest && ++it.breed >= BIRD_EGG.hatch) breakEgg(world, it);
    } else if (!world.rng.int(EGG_HATCH)) breakEgg(world, it);
  }
}

/** The egg breaks (DoBreak): the young one comes out, unless it's buried in the ground (or a bird egg hasn't brooded long enough). */
export function breakEgg(world: World, egg: Item): void {
  if (egg.removed || !egg.def.egg) return;
  const holder = egg.container as Clonk | null;
  if (holder && holder.contents) holder.contents.splice(holder.contents.indexOf(egg), 1);
  egg.container = null;
  egg.removed = true;
  sound(world, egg, 'EggBreak');
  if (egg.def.eggInNest && egg.breed < BIRD_EGG.alive) return;
  if (world.land.isSolid(egg.x, egg.y)) return;
  const child = world.addAnimal(egg.def.egg, egg.x, egg.y - 4, BIRTH_CON);
  birth(child, world.rng);
}

/** Something landed hard: an egg breaks one time in two, a zap nest bursts (their Hit). */
export function itemLanded(world: World, it: Item): void {
  if (it.def.egg && world.rng.int(2)) breakEgg(world, it);
  if (it.def.swarm) burstZapNest(world, it);
}

/** A clonk picked it up: an egg out of its nest stops brooding, and the young one in it is gone (BirdEgg.c4d Entrance). */
export function collected(it: Item): void {
  if (!it.onNest && !it.def.eggInNest) return;
  it.onNest = null;
  it.breed = 0;
  it.laid = false;
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
    if (!a.alive || a.removed || !a.def.collectible || !a.def.carried || a.action.name === 'Jump' || a.action.name === 'Tumble') continue;
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
  return !!(d.animal || d.egg || d.decay || d.swarm || id === 'deadBird' || id === 'deadSnake');
}
