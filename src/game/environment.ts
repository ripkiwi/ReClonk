// Environment objects, from the original Clonk Rage content
// (Objects.c4d/Environment.c4d: Time.c4d, Stars.c4d, BirdSong.c4d, Cicadas.c4d,
// Owl.c4d, ColoredFishes.c4d, Driftwood.c4d, Glint.c4d, Lenseflare.c4d,
// Rockfall.c4d with BigRock.c4d, SeaLevel.c4d with Drain.c4d, Reproduction.c4d).
// A scenario lists them in its [Environment] section, each with a count
// (Objects=TIME=1;BRDS=4): more of them means more of what they do.
// See licenses/clonk_engine_license.txt.

import { Rng } from '../core/rng';
import type { Landscape } from '../landscape/landscape';
import { LIQUID } from '../landscape/materials';
import { ANIMAL_IDS, type AnimalId } from '../objects/animal';
import { CLONK } from '../objects/defs';
import { GameObject } from '../objects/gameObject';
import { CNAT, HIT_SPEED_2, type Vertex } from '../objects/physics';
import { reproduce } from './animals';
import { HIT_DAMAGE, type World } from './world';

export type EnvId = 'time' | 'stars' | 'birdSong' | 'cicadas' | 'owl' | 'coloredFishes' | 'driftwood' | 'glint' | 'lenseflare' | 'rockfall' | 'seaLevel' | 'reproduction';

export interface EnvDef {
  id: EnvId;
  name: string;
  /** What it does, for the scenario settings. */
  desc: string;
  /** The most a scenario can have (DefCore MaxUserSelect). */
  max: number;
  /** Its picture in the scenario settings (64x64). */
  file: string;
}

/** The environment objects, in the settings' order. */
export const ENVIRONMENT: Record<EnvId, EnvDef> = {
  time: { id: 'time', name: 'Time', desc: 'Day and night: the sky darkens at night. More of them make the days go by faster (one makes a day about 46 minutes).', max: 10, file: 'environment/Time.png' },
  stars: { id: 'stars', name: 'Stars', desc: 'Stars come out at night (with Time). More of them make more stars.', max: 10, file: 'environment/Stars.png' },
  birdSong: { id: 'birdSong', name: 'Bird song', desc: 'Birds sing in the daytime. More of them sing more often.', max: 5, file: 'environment/BirdSong.png' },
  cicadas: { id: 'cicadas', name: 'Cicadas', desc: 'Cicadas chirp at night (with Time).', max: 3, file: 'environment/Cicadas.png' },
  owl: { id: 'owl', name: 'Owl', desc: 'An owl hoots at night (with Time).', max: 2, file: 'environment/Owl.png' },
  coloredFishes: { id: 'coloredFishes', name: 'Colored fish', desc: 'The fish at the start come in all colours.', max: 1, file: 'environment/ColoredFishes.png' },
  driftwood: { id: 'driftwood', name: 'Driftwood', desc: 'Wood washes up on lakes now and then, up to ten pieces for each.', max: 3, file: 'environment/Driftwood.png' },
  glint: { id: 'glint', name: 'Glinting materials', desc: 'Gold, crystal and ice glint in the light, and so do gold nuggets and crystals lying about. More of them glint more.', max: 10, file: 'environment/Glint.png' },
  lenseflare: { id: 'lenseflare', name: 'Lens flare', desc: 'The sun shines down and flares in the view when you look its way, in the daytime.', max: 1, file: 'environment/Lenseflare.png' },
  rockfall: { id: 'rockfall', name: 'Rockfall', desc: 'Big rocks now and then fall out of the sky, bounce about and break apart. More of them make more rocks.', max: 10, file: 'environment/Rockfall.png' },
  seaLevel: { id: 'seaLevel', name: 'Sea level', desc: 'Drains hold the lakes at their level: rain or anything else that raises them runs off.', max: 1, file: 'environment/SeaLevel.png' },
  reproduction: { id: 'reproduction', name: 'Reproduction', desc: 'Animals that die out are replaced: their kind has young until there are as many as at the start.', max: 1, file: 'environment/Reproduction.png' },
};

export const ENV_IDS = Object.keys(ENVIRONMENT) as EnvId[];

/** Time.c4d: the day goes round in 10000 steps, advanced by the speed every 10 ticks. */
export const TIME = { resolution: 10000, interval: 10 };

/** Light (0 to 100) at a time of day, 0 being noon (Time.c4d GetLightIntensity). */
export function lightAt(time: number): number {
  const c = Math.round(Math.cos((((time * 360) / TIME.resolution) * Math.PI) / 180) * 250);
  return Math.max(-50, Math.min(50, c)) + 50;
}

/** A star (Stars.c4d/Star.c4d): fades in to its brightness, far away behind the landscape. */
export interface Star {
  x: number;
  y: number;
  /** 1 to 10. */
  brightness: number;
  /** Frame of its graphics, counting up to its brightness as it appears. */
  phase: number;
  age: number;
  /** How much it moves with the view, in percent (its parallax). */
  parallax: number;
  /** A light colour, or white. */
  color: number;
}

/** A big rock tumbling down (Rockfall.c4d/BigRock.c4d, RCK2): 48x48 at full size. */
export const BIG_ROCK = {
  size: 48,
  mass: 250,
  frames: 20,
  file: 'environment/BigRock.png',
  /** Rolling1 forward one frame a tick; Rolling2 backward and Rolling3 forward every two ticks. */
  rolls: [
    { delay: 1, reverse: false },
    { delay: 2, reverse: true },
    { delay: 2, reverse: false },
  ],
};

export class BigRock extends GameObject {
  /** Size in percent: smaller ones break off big ones. */
  con: number;
  roll = 0;
  age = 0;
  private verts: Vertex[] = [];
  private vertCon = -1;

  constructor(x: number, y: number, con: number) {
    super(x, y);
    this.con = con;
  }

  /** Its four corners (bottom, top, right, left), shrunk with its size. */
  get vertices(): readonly Vertex[] {
    if (this.vertCon !== this.con) {
      const r = Math.trunc((22 * this.con) / 100);
      this.verts = [
        { x: 0, y: r, cnat: CNAT.Bottom, friction: 100 },
        { x: 0, y: -r, cnat: CNAT.Top, friction: 100 },
        { x: r, y: 0, cnat: CNAT.Right, friction: 100 },
        { x: -r, y: 0, cnat: CNAT.Left, friction: 100 },
      ];
      this.vertCon = this.con;
    }
    return this.verts;
  }

  get mass(): number {
    return (BIG_ROCK.mass * this.con) / 100;
  }

  /** The frame of its rolling animation. */
  frame(): number {
    const r = BIG_ROCK.rolls[this.roll];
    const i = Math.floor(this.age / r.delay) % BIG_ROCK.frames;
    return r.reverse ? BIG_ROCK.frames - 1 - i : i;
  }
}

/** Sounds from the environment: birds, cicadas and the owl anywhere; rocks where they are. */
export type EnvSound = 'BirdSong' | 'Cicada' | 'Owl' | 'RockHit' | 'RockBreak' | 'Earthquake';

/**
 * The scenario's environment objects and what they keep track of. They get
 * random numbers of their own, so they don't change the rest of the round.
 */
export class Environment {
  readonly rng: Rng;
  readonly counts: Partial<Record<EnvId, number>>;
  /** Time of day, 0 (noon) to 9999, and how light it is, 0 (night) to 100. */
  time = 0;
  light = 100;
  readonly stars: Star[] = [];
  private starMode: 'day' | 'dusk' | 'night' | 'dawn' = 'day';
  private starTicks = 0;
  readonly rocks: BigRock[] = [];
  /** Where the lakes drain (SeaLevel.c4d's drains). */
  readonly drains: { x: number; y: number }[] = [];
  /** Colours of the fish at the start (ColoredFishes.c4d). */
  readonly fishColors = new Map<object, number>();
  /** Where the sun stands (Lenseflare.c4d). */
  sun: { x: number; y: number } | null = null;
  /** How many of each animal there were at the start (Reproduction.c4d). */
  private stock: Partial<Record<AnimalId, number>> | null = null;
  /** The view shakes when a big rock crashes (ShakeViewPort): where, and how hard. */
  readonly shakes: { x: number; y: number; level: number }[] = [];

  constructor(counts: Partial<Record<EnvId, number>>, world: World, seed: number) {
    this.rng = new Rng(seed);
    this.counts = Object.fromEntries(ENV_IDS.filter((id) => (counts[id] ?? 0) > 0).map((id) => [id, Math.min(ENVIRONMENT[id].max, Math.round(counts[id]!))]));
    const land = world.land;
    if (this.has('seaLevel')) {
      // A drain every 200 pixels where there's a lake, at its surface (SeaLevel.c4d).
      for (let x = 50; x < land.width; x += 200) {
        const y = horizon(land, x);
        if (land.isLiquid(x, y + 1)) this.drains.push({ x, y });
      }
    }
    if (this.has('lenseflare')) {
      // At the golden section of the width, either side, half way up from the ground there.
      let x = Math.trunc((land.width * 1000) / 1618);
      if (this.rng.bool()) x = land.width - x;
      let y = 0;
      while (y < land.height && !land.isSolid(x, y)) y++;
      this.sun = { x, y: Math.trunc(y / 2) };
    }
  }

  count(id: EnvId): number {
    return this.counts[id] ?? 0;
  }

  has(id: EnvId): boolean {
    return this.count(id) > 0;
  }

  /** Day, unless there's a Time object and it's dark (IsDay). */
  get isDay(): boolean {
    return !this.has('time') || this.light > 0;
  }

  get isNight(): boolean {
    return !this.isDay;
  }

  /** Set the time of day: 0 to 100 from noon to noon (Time.c4d SetTime). */
  setTime(percent: number): void {
    this.time = Math.trunc((percent * TIME.resolution) / 100) % TIME.resolution;
    this.light = lightAt(this.time);
  }

  /** Colour the fish there are now (ColoredFishes.c4d Initialize): any hue, bright. */
  colorFish(world: World): void {
    if (!this.has('coloredFishes')) return;
    for (const a of world.animals) if (a.def.id === 'fish' && !this.fishColors.has(a)) this.fishColors.set(a, hsl(this.rng.int(256), 255, 100 + this.rng.int(60)));
  }

  step(world: World): void {
    const t = world.tick;
    const rng = this.rng;
    if (this.has('time') && t % TIME.interval === 0) {
      this.time = (this.time + this.count('time')) % TIME.resolution;
      const target = lightAt(this.time);
      if (target > this.light) this.light++;
      else if (target < this.light) this.light--;
    }
    if (this.has('stars')) this.stepStars(world.land);
    // Bird song by day, cicadas and the owl by night, each object on its own.
    if (t % 25 === 0 && this.isDay) for (let i = this.count('birdSong'); i > 0; i--) if (!rng.int(8)) this.sound(world, 'BirdSong');
    if (t % 25 === 0 && this.isNight) for (let i = this.count('cicadas'); i > 0; i--) if (!rng.int(20)) this.sound(world, 'Cicada');
    if (t % 60 === 0 && this.isNight) for (let i = this.count('owl'); i > 0; i--) if (!rng.int(30)) this.sound(world, 'Owl');
    if (this.has('driftwood') && t % 50 === 0) this.driftwood(world);
    if (this.has('rockfall') && t % 100 === 0) {
      for (let i = this.count('rockfall'); i > 0; i--) {
        if (rng.int(150)) continue;
        this.addRock(world, rng.int(world.land.width), 0, (25 - rng.int(51)) / 10, (20 - rng.int(16)) / 10);
      }
    }
    this.stepRocks(world);
    if (t % 5 === 0) {
      // A drain takes 20 pixels of whatever liquid rises up to it (Drain.c4d).
      for (const d of this.drains) for (let i = 0; i < 20 && world.land.isLiquid(d.x, d.y); i++) world.land.extractMaterial(d.x, d.y);
    }
    if (this.has('reproduction')) this.reproduction(world);
    for (const s of this.shakes) s.level--;
    if (this.shakes.some((s) => s.level <= 0)) this.shakes.splice(0, this.shakes.length, ...this.shakes.filter((s) => s.level > 0));
  }

  private sound(world: World, sound: EnvSound, x = -1, y = -1): void {
    world.events.push({ type: 'environment', sound, x, y, tick: world.tick });
  }

  /**
   * Stars.c4d: when night falls, a star a tick comes out until there are
   * enough (one per 20000 pixels of landscape for each Stars object); when day
   * breaks, a star a tick goes.
   */
  private stepStars(land: Landscape): void {
    const rng = this.rng;
    const max = Math.trunc((land.width * land.height * this.count('stars')) / 20000);
    this.starTicks++;
    switch (this.starMode) {
      case 'day':
        if (this.starTicks % 30 === 0 && this.isNight) {
          this.starMode = 'dusk';
          this.starTicks = 0;
        }
        break;
      case 'dusk':
        if (this.starTicks > max) {
          this.starMode = 'night';
          this.starTicks = 0;
          break;
        }
        {
          const brightness = rng.int(10) + 1;
          const tinted = rng.int(3) !== 0;
          const color = tinted ? ((rng.int(100) + 156) << 16) | ((rng.int(100) + 156) << 8) | (rng.int(100) + 156) : 0xffffff;
          this.stars.push({ x: rng.int(land.width), y: rng.int(land.height), brightness, phase: 0, age: 0, parallax: rng.int(20) + brightness * 5 - 5, color });
        }
        break;
      case 'night':
        if (this.starTicks % 30 === 0 && this.isDay) {
          this.starMode = 'dawn';
          this.starTicks = 0;
        }
        break;
      case 'dawn':
        if (!this.stars.length) this.starMode = 'day';
        else this.stars.shift();
        break;
    }
    // A star appears one frame every 10 ticks up to its brightness (Appear, then Shine).
    for (const s of this.stars) {
      s.age++;
      if (s.phase < s.brightness - 1 && s.age % 10 === 0) s.phase++;
    }
  }

  /** Driftwood.c4d: now and then a piece of wood washes up somewhere on a lake, up to ten pieces for each object. */
  private driftwood(world: World): void {
    const rng = this.rng;
    if (rng.int(30)) return;
    let wood = 0;
    for (const it of world.items) if (it.def.id === 'wood' && !it.removed) wood++;
    if (wood > this.count('driftwood') * 10) return;
    const land = world.land;
    const x = rng.int(land.width);
    let y = 0;
    while (y < land.height && land.density(x, y) < LIQUID) y += 20;
    if (!land.isLiquid(x, y)) return;
    const it = world.spawnItem('wood', x, y);
    it.r = rng.int(360);
  }

  addRock(_world: World, x: number, y: number, xdir: number, ydir: number, con = 100): BigRock {
    const r = new BigRock(x, y, con);
    r.xdir = xdir;
    r.ydir = ydir;
    r.roll = this.rng.int(3);
    // One in three is smaller (BigRock.c4d Initialize).
    if (con === 100 && !this.rng.int(3)) r.con -= this.rng.int(40);
    this.rocks.push(r);
    return r;
  }

  /** Big rocks fall, bounce off whatever they hit, crash into things and break apart (BigRock.c4d). */
  private stepRocks(world: World): void {
    if (!this.rocks.length) return;
    const land = world.land;
    const g = land.gravity;
    for (const r of [...this.rocks]) {
      if (r.removed) continue;
      r.age++;
      if (land.isLiquid(r.x, r.y)) {
        r.ydir = Math.min(r.ydir + g, 1);
        r.xdir *= 0.9;
      } else r.ydir += g;
      const res = r.doMovement(land);
      if (land.bottomOpen && r.y > land.height + 30) r.removed = true;
      else if (r.y > land.height + 200) r.removed = true;
      if (r.removed) continue;
      const c = res.contact;
      // One contact call a tick, like the engine's (the first vertex that hit).
      if (c & CNAT.Bottom) this.contactBottom(world, r);
      else if (c & CNAT.Top) this.contactTop(world, r);
      else if (c & CNAT.Left) this.contactSide(world, r, -1);
      else if (c & CNAT.Right) this.contactSide(world, r, 1);
      if (!r.removed) this.rockHits(world, r);
    }
    if (this.rocks.some((r) => r.removed)) this.rocks.splice(0, this.rocks.length, ...this.rocks.filter((r) => !r.removed));
  }

  private reroll(r: BigRock): void {
    r.roll = this.rng.int(3);
  }

  private contactTop(world: World, r: BigRock): void {
    const rng = this.rng;
    r.xdir = (5 - rng.int(11)) / 10;
    if (!rng.int(3)) return this.destruct(world, r);
    this.crash(world, r, -4, -14);
    this.crash(world, r, 0, -16);
    this.crash(world, r, 4, -14);
    this.shake(r);
    this.reroll(r);
  }

  private contactBottom(world: World, r: BigRock): void {
    const rng = this.rng;
    r.xdir = (50 - rng.int(101)) / 10;
    r.ydir = (-45 - rng.int(10)) / 10;
    this.crash(world, r, -4, 14);
    this.crash(world, r, 0, 16);
    this.crash(world, r, 4, 14);
    this.reroll(r);
    this.shake(r);
    if (!rng.int(10)) this.crashFree(world, r);
    if (!rng.int(8)) this.destruct(world, r);
  }

  private contactSide(world: World, r: BigRock, side: -1 | 1): void {
    const rng = this.rng;
    r.xdir = (-side * (10 + rng.int(10))) / 10;
    r.ydir = (-40 - rng.int(10)) / 10;
    this.crash(world, r, side * 14, -4);
    this.crash(world, r, side * 16, 0);
    this.crash(world, r, side * 14, 4);
    this.reroll(r);
    this.shake(r);
    if (!rng.int(5)) this.destruct(world, r);
  }

  private shake(r: BigRock): void {
    const level = Math.trunc(r.con / 5);
    if (level > 0) this.shakes.push({ x: r.x, y: r.y, level });
  }

  /** It hits the ground hard: it knocks things about where it hits, and now and then blasts (BigRock.c4d Crash). */
  private crash(world: World, r: BigRock, dx: number, dy: number): void {
    if (r.removed) return;
    const rng = this.rng;
    this.sound(world, 'RockHit', r.x, r.y);
    if (r.con < 40) return;
    // Its offsets are for a full-size rock.
    const x = r.x + dx;
    const y = r.y + dy;
    if (!rng.int(4)) world.blastObjects(x, y, 3);
    if (!rng.int(4)) world.blastObjects(x, y, 2);
    if (!rng.int(75)) world.explode(r.x + dx, r.y + dy, rng.int(2) + 3);
  }

  /** It breaks apart into smaller rocks with a puff of smoke (BigRock.c4d Destruct). */
  private destruct(world: World, r: BigRock): void {
    if (r.removed) return;
    const rng = this.rng;
    for (let i = 1; i * 20 < r.con; i++) {
      // A rock created full size, then DoCon(con - 110 - Random(con)).
      const con = r.con - 10 - rng.int(r.con);
      if (con <= 0) continue;
      const piece = this.addRock(world, r.x, r.y, (-50 + rng.int(101)) / 10, (-60 + rng.int(80)) / 10, 100);
      piece.con = Math.min(piece.con, con);
    }
    this.sound(world, 'RockBreak', r.x, r.y);
    for (let i = 0; i < 4; i++) world.events.push({ type: 'poof', x: r.x + rng.int(11) - 5, y: r.y + rng.int(11) - 5, tick: world.tick });
    r.removed = true;
  }

  /** It shakes the ground below loose (BigRock.c4d CrashFree). */
  private crashFree(world: World, r: BigRock): void {
    const rng = this.rng;
    for (let i = 0; i < 3; i++) world.land.shakeFree(r.x - 50 + rng.int(100), r.y + rng.int(120), Math.trunc(r.con / 5));
    if (!rng.int(3)) this.sound(world, 'Earthquake', r.x, r.y);
  }

  /** A rock flying fast hits the clonks and animals it passes through, like a thrown rock, only much heavier. */
  private rockHits(world: World, r: BigRock): void {
    if (Math.abs(r.xdir) + Math.abs(r.ydir) < HIT_SPEED_2) return;
    for (const c of world.clonks) {
      if (!c.alive || c.contained) continue;
      const dx = r.x - (c.x - CLONK.width / 2);
      const dy = r.y - (c.y - CLONK.height / 2);
      if (dx < 0 || dx >= CLONK.width || dy < 0 || dy >= CLONK.height) continue;
      const rx = r.xdir - c.xdir;
      const ry = r.ydir - c.ydir;
      let energy = Math.round(((rx * rx + ry * ry) * r.mass) / 5);
      energy = Math.max(Math.trunc(energy / 3), energy ? 1 : 0);
      const points = Math.trunc(energy / 5) * HIT_DAMAGE;
      world.hurt(c, points, null);
      world.events.push({ type: 'hit', clonk: c, points, tick: world.tick });
      if (c.alive && (world.tick % 3 === 0 || c.action.procedure !== 'flight')) {
        const k = 50 / Math.max(CLONK.mass, 50);
        c.fling(r.xdir * k, -Math.abs(r.ydir / 2) * k);
      }
    }
    for (const a of world.animals) {
      if (!a.alive || a.removed || !a.at(r.x, r.y)) continue;
      const rx = r.xdir - a.xdir;
      const ry = r.ydir - a.ydir;
      let energy = Math.round(((rx * rx + ry * ry) * r.mass) / 5);
      energy = Math.max(Math.trunc(energy / 3), energy ? 1 : 0);
      world.hurtAnimal(a, Math.trunc(energy / 5) * HIT_DAMAGE, null);
    }
  }

  /**
   * Reproduction.c4d: it remembers how many of each animal there were at the
   * start, and every 200 ticks, one time in 23, a kind that has fewer has young
   * somewhere (the one nearest a random spot that can).
   */
  private reproduction(world: World): void {
    const t = world.tick;
    if (t === 5 || (!this.stock && t > 5)) {
      this.stock = {};
      for (const a of world.animals) if (a.alive && !a.removed) this.stock[a.def.id] = (this.stock[a.def.id] ?? 0) + 1;
    }
    if (!this.stock || t % 200 !== 0) return;
    for (const id of ANIMAL_IDS) {
      const want = this.stock[id] ?? 0;
      if (!want || this.alive(world, id) >= want || this.rng.int(23)) continue;
      const px = this.rng.int(world.land.width);
      const py = this.rng.int(world.land.height);
      const kind = world.animals.filter((a) => a.def.id === id && a.alive && !a.removed).sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py));
      for (const a of kind) {
        const before = world.animals.length + world.items.length;
        reproduce(world, a);
        if (world.animals.length + world.items.length > before || this.alive(world, id) >= want) break;
      }
    }
  }

  private alive(world: World, id: AnimalId): number {
    let n = 0;
    for (const a of world.animals) if (a.def.id === id && a.alive && !a.removed) n++;
    return n;
  }
}

/** The last free pixel above the ground or a lake in column x (SeaLevel.c4d GetHorizonHeight). */
function horizon(land: Landscape, x: number): number {
  let y = 0;
  while (y < land.height && land.density(x, y) < LIQUID) y += 10;
  while (y > land.height || (y >= 0 && land.density(x, y) >= LIQUID)) y--;
  return y;
}

/** The engine's HSL(hue, saturation, lightness), all 0 to 255, as 0xRRGGBB. */
export function hsl(h: number, s: number, l: number): number {
  const H = (h / 255) * 360;
  const S = s / 255;
  const L = l / 255;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] = H < 60 ? [c, x, 0] : H < 120 ? [x, c, 0] : H < 180 ? [0, c, x] : H < 240 ? [0, x, c] : H < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number): number => Math.round((v + m) * 255);
  return (to(r) << 16) | (to(g) << 8) | to(b);
}
