// Magic, ported from the original content's scripts: the sorcerer
// (Objects.c4d/Crew.c4d/Sorcerer.c4d and MagiClonk.c4d), the crystal
// (Items.c4d/Materials.c4d/Crystal.c4d) and the spells in Objects.c4d/Magic.c4d.
// Every spell costs its DefCore Value in magic energy.

import { Clonk } from '../objects/clonk';
import { CLONK, MAGIC_UNIT } from '../objects/defs';
import { GameObject } from '../objects/gameObject';
import { Item } from '../objects/item';
import { CNAT, type Vertex } from '../objects/physics';
import { maskRect, SolidMask } from '../objects/solidMask';
import { extinguish, fireCenter, incinerate, type Burnable } from './fire';
import type { World } from './world';

export type SpellId = 'wind' | 'bridge' | 'gravityDown' | 'gravityUp' | 'earthquake' | 'extinguish' | 'lightning' | 'heal' | 'firefist' | 'meteor';

export interface SpellDef {
  id: SpellId;
  name: string;
  /** Magic energy it costs (DefCore Value). */
  value: number;
  description: string;
  /** Its picture in the content pack. */
  icon: string;
  /** Size of the picture file. */
  iconSize: number;
}

/** The spells, cheapest first, like the original's spell menu (C4Player sorts its Magic list by value). */
export const SPELLS: Record<SpellId, SpellDef> = {
  wind: { id: 'wind', name: 'Wind', value: 8, description: 'Blows the wind the way you face for a while. With a flint in hand: hurls a burning log.', icon: 'magic/Wind.png', iconSize: 40 },
  bridge: { id: 'bridge', name: 'Magic Bridge', value: 10, description: 'A force bridge in front of your feet that holds for a while.', icon: 'magic/Bridge.png', iconSize: 40 },
  gravityDown: { id: 'gravityDown', name: 'Lower Gravity', value: 11, description: 'Gravity drops by 20 percent and slowly comes back.', icon: 'magic/GravityDown.png', iconSize: 64 },
  gravityUp: { id: 'gravityUp', name: 'Raise Gravity', value: 11, description: 'Gravity rises by 20 percent and slowly comes back.', icon: 'magic/GravityUp.png', iconSize: 64 },
  earthquake: { id: 'earthquake', name: 'Earthquake', value: 12, description: 'Shakes the ground ahead of you and cracks the earth.', icon: 'magic/Earthquake.png', iconSize: 40 },
  extinguish: { id: 'extinguish', name: 'Extinguish', value: 15, description: 'Puts out the sorcerer and every fire nearby.', icon: 'magic/Extinguish.png', iconSize: 64 },
  lightning: { id: 'lightning', name: 'Lightning', value: 15, description: 'A bolt the way you face: sets trees alight and strikes clonks down.', icon: 'magic/Lightning.png', iconSize: 40 },
  heal: { id: 'heal', name: 'Heal', value: 19, description: 'Heals the sorcerer while the spell lasts.', icon: 'magic/Heal.png', iconSize: 64 },
  firefist: { id: 'firefist', name: 'Fire Fist', value: 21, description: 'Two fireballs hop away to the left and right, burn what they touch, and explode.', icon: 'magic/Firefist.png', iconSize: 64 },
  meteor: { id: 'meteor', name: 'Meteor Hail', value: 50, description: 'Meteors rain down far ahead of you. The best spell against enemy settlements.', icon: 'magic/Meteor.png', iconSize: 40 },
};

/** Every spell, cheapest first. */
export const SPELL_IDS = (Object.keys(SPELLS) as SpellId[]).sort((a, b) => SPELLS[a].value - SPELLS[b].value);

/** The spells of the original we don't have yet, for the scenario settings. */
export const LATER_SPELLS: readonly string[] = ['Force Field Wall', 'Small Force Field', 'Wormhole', 'Volcano', 'Eternal Flame', 'Camouflage', 'Warp to Base', 'Invisibility', 'Revaluation', 'Air Shield'];

/** Values from the spells' scripts. */
export const MAGIC = {
  /** The casting animation's frame at which the spell goes off (CheckMagic). */
  castPhase: 5,
  /** Lightning from the sky or a spell that strikes a sorcerer charges it (Sorcerer.c4d LightningStrike). */
  lightningGain: 10,
  heal: { ticks: 200, interval: 2, chance: 3, energy: 2 },
  /** Extinguish reaches three times the caster's height. */
  extinguishRadius: CLONK.height * 3,
  gravity: { step: 20, min: 30, max: 290, interval: 80 },
  wind: { ticks: 3000, change: 100 },
  bridge: { width: 72, height: 8, segments: 4, ticks: 1000 },
  firetail: { ticks: 200, explode: 20, speed: 2, hop: 1 },
  /** A lightning bolt's corners, how far apart they are, and the damage of a strike (Punch). */
  shot: { corners: 30, advance: 10, jitter: 5, attractAfter: 7, attract: 13, damage: 10, waterDamage: 12, glow: 30 },
  meteor: { ticks: 200, interval: 15, range: 800, near: 800, far: 1000 },
};

/** A fireball of the Fire Fist (Firetail.c4d): it hops along the ground leaving flames, and blows up after 200 ticks. */
export class Firetail extends GameObject {
  readonly vertices: readonly Vertex[] = [
    { x: -3, y: -3, cnat: CNAT.None, friction: 20 },
    { x: 3, y: 3, cnat: CNAT.None, friction: 20 },
  ];
  age = 0;
  constructor(
    x: number,
    y: number,
    readonly side: -1 | 1,
    readonly by: Clonk,
  ) {
    super(x, y);
    // Falls, so it hits the ground and starts hopping.
    this.ydir = 1;
  }
}

/** A lightning bolt cast by a sorcerer (LightningShot.c4d): it grows a corner each tick, mostly straight ahead. */
export interface Shot {
  points: { x: number; y: number }[];
  advX: number;
  by: Clonk;
  /** Ticks left to glow after it struck (the Connect action); -1 while it still grows. */
  glow: number;
}

/** A force bridge (ForceFieldBridge.c4d): four solid segments that vanish after a while. */
export interface Bridge {
  x: number;
  y: number;
  mask: SolidMask;
  time: number;
}

/** Everything spells have going on in a world. */
export class MagicState {
  heals: { caster: Clonk; time: number }[] = [];
  /** The scenario's gravity in percent, and how far spells have moved it. */
  gravity: { base: number; change: number; time: number } | null = null;
  /** The wind a spell holds, and for how long. */
  wind: { value: number; time: number } | null = null;
  showers: { x: number; dir: -1 | 1; time: number; by: Clonk }[] = [];
  bridges: Bridge[] = [];
  firetails: Firetail[] = [];
  shots: Shot[] = [];
  /** Bolts from the sky that already charged a sorcerer. */
  readonly struck = new WeakSet<object>();
}

/** The spells sorcerers know in this world, cheapest first. A scenario that names none allows them all, like the original. */
export function spellList(world: World): SpellId[] {
  return world.spells.length ? SPELL_IDS.filter((id) => world.spells.includes(id)) : SPELL_IDS;
}

/**
 * The magic key: open the spell menu if the clonk is a sorcerer who's ready
 * for it. Returns false for an ordinary clonk, whose key does nothing.
 */
export function openSpellMenu(world: World, c: Clonk): boolean {
  if (!c.maxMagic || !c.alive) return false;
  if (!c.readyToMagic) {
    world.say(c.owner, `${c.info?.name ?? 'The sorcerer'} is not ready to cast`);
    return true;
  }
  c.spellMenu = 0;
  c.comDir = { x: 0, y: 0 };
  return true;
}

/** Start casting (MagiClonk.c4d DoMagic): the spell goes off a moment later, in the casting animation. Swimming, right away. */
export function startSpell(world: World, c: Clonk, id: SpellId): boolean {
  if (!c.readyToMagic) {
    world.say(c.owner, `${c.info?.name ?? 'The sorcerer'} is not ready to cast`);
    return false;
  }
  if (!enoughMana(world, c, id)) return false;
  if (c.action.name === 'Swim') return execSpell(world, c, id);
  c.casting = id;
  c.startMagic();
  return true;
}

function enoughMana(world: World, c: Clonk, id: SpellId): boolean {
  if (c.magicEnergy >= SPELLS[id].value * MAGIC_UNIT) return true;
  world.say(c.owner, `Not enough magic energy for ${SPELLS[id].name}`);
  return false;
}

/** The spell goes off (ExecMagic). It only costs magic energy if it worked. */
export function execSpell(world: World, c: Clonk, id: SpellId): boolean {
  if (!enoughMana(world, c, id)) return false;
  if (!CAST[id](world, c)) return false;
  c.doMagicEnergy(-SPELLS[id].value);
  world.events.push({ type: 'magic', clonk: c, spell: id, tick: world.tick });
  return true;
}

/**
 * A sorcerer's own tick: a crystal in its hands turns into magic energy
 * (CheckContents), and a spell it's casting goes off at the fifth frame.
 */
export function stepSorcerer(world: World, c: Clonk): void {
  if (!c.maxMagic || !c.alive) return;
  const a = c.action.name;
  if (c.casting) {
    const id = c.casting as SpellId;
    if (c.doesMagic) {
      if (c.phase >= MAGIC.castPhase) {
        c.casting = null;
        execSpell(world, c, id);
      }
    } else if (a === 'Walk' || a === 'Jump') {
      // Landed in mid-spell, or got up from kneeling: carry on (AfterMagicJump, CheckMagicStart).
      c.startMagic();
    } else if (a !== 'KneelDown' && a !== 'KneelUp' && a !== 'FlatUp') {
      c.casting = null;
      world.say(c.owner, `${c.info?.name ?? 'The sorcerer'} is not ready to cast`);
    }
    return;
  }
  // Crystals turn into magic energy while it walks (IsConvertReady).
  const crystal = c.carrying;
  if (a === 'Walk' && crystal?.def.manaGain && c.magicEnergy < c.maxMagic) convertCrystal(world, c, crystal);
}

/**
 * Crystal.c4d Apply: each point of magic energy takes a twentieth off the
 * crystal; a whole one gives 10 points and is used up. One that didn't fit
 * stays in hand, smaller, for later.
 */
function convertCrystal(world: World, c: Clonk, crystal: Item): void {
  const gain = crystal.def.manaGain ?? 0;
  const left = Math.round(((crystal.con - 50000) / 50000) * gain);
  let used = 0;
  while (used < left && c.doMagicEnergy(1)) used++;
  if (!used) return;
  crystal.con -= (used * 50000) / gain;
  if (used >= left) {
    crystal.removed = true;
    c.contents.splice(c.contents.indexOf(crystal), 1);
  }
  c.comDir = { x: 0, y: 0 };
  c.startMagic();
  world.events.push({ type: 'charge', clonk: c, points: used, tick: world.tick });
}

/** Struck by lightning: 10 points of magic energy (Sorcerer.c4d LightningStrike). */
function lightningStrike(world: World, c: Clonk): void {
  if (!c.maxMagic || !c.alive) return;
  let got = 0;
  for (let i = 0; i < MAGIC.lightningGain; i++) if (c.doMagicEnergy(1)) got++;
  c.comDir = { x: 0, y: 0 };
  if (c.action.name === 'Walk') c.startMagic();
  world.events.push({ type: 'charge', clonk: c, points: got, tick: world.tick });
}

const CAST: Record<SpellId, (world: World, c: Clonk) => boolean> = {
  /** Heal.c4d: only works out of the casting animation, and not at full energy. */
  heal(world, c) {
    if (!c.doesMagic || c.energy >= c.maxEnergy) return false;
    world.magic.heals.push({ caster: c, time: 0 });
    return true;
  },

  /** Extinguish.c4d: the sorcerer and everything burning nearby, but not enemy clonks. */
  extinguish(world, c) {
    let n = 0;
    const all: Burnable[] = [...world.clonks, ...world.items, ...world.plants, ...world.structures];
    for (const o of all) {
      if (!o.fire) continue;
      if (o instanceof Clonk && world.hostile(o.owner, c.owner)) continue;
      const p = fireCenter(o);
      if (o !== c && Math.hypot(p.x - c.x, p.y - c.y) > MAGIC.extinguishRadius) continue;
      extinguish(world, o, true);
      n++;
    }
    if (!n) world.say(c.owner, 'Nothing to extinguish');
    return n > 0;
  },

  /** Firefist.c4d: a fireball 15 pixels to each side. */
  firefist(world, c) {
    let made = 0;
    for (const side of [-1, 1] as const) {
      const f = new Firetail(c.x + side * 15, c.y, side, c);
      // Up out of the ground, at most 5 pixels (Firetail.c4d Initialize).
      for (let i = 0; i < 5 && stuck(world, f); i++) f.setPosition(f.x, f.y - 1);
      if (stuck(world, f)) continue;
      world.magic.firetails.push(f);
      made++;
    }
    return made > 0;
  },

  /** Lightning.c4d: a bolt straight ahead from the sorcerer's middle. */
  lightning(world, c) {
    world.magic.shots.push({ points: [{ x: c.x, y: c.y + 2 }], advX: c.dir * MAGIC.shot.advance, by: c, glow: -1 });
    world.events.push({ type: 'thunder', x: c.x, y: c.y, tick: world.tick });
    return true;
  },

  /** Wind.c4d: with a flint, a burning log; otherwise the wind blows the sorcerer's way for a good minute. */
  wind(world, c) {
    const flint = c.contents.find((i) => i.def.id === 'flint');
    if (flint) {
      flint.removed = true;
      c.contents.splice(c.contents.indexOf(flint), 1);
      const wood = world.spawnItem('wood', c.x + 5 * c.dir, c.y, 4 * c.dir, -1, 1);
      wood.thrownBy = c.id;
      wood.noCollect = 20;
      incinerate(world, wood, c);
      return true;
    }
    const w = world.weather;
    if (!w) return false;
    const m = world.magic;
    const from = m.wind ? m.wind.value : w.wind;
    m.wind = { value: Math.max(-100, Math.min(100, from + c.dir * MAGIC.wind.change)), time: m.wind?.time ?? 0 };
    return true;
  },

  gravityDown: (world, c) => changeGravity(world, c, -MAGIC.gravity.step),
  gravityUp: (world, c) => changeGravity(world, c, MAGIC.gravity.step),

  /** Earthquake.c4d: a quake 100 to 120 pixels ahead, on the ground, and three extra shakes right there. */
  earthquake(world, c) {
    const w = world.weather;
    if (!w) return false;
    const { land, rng } = world;
    const x = c.x + c.dir * (100 + rng.int(21));
    let y = c.y;
    while (!land.isSolid(x, y) && y <= land.height) y += 5;
    w.launchEarthquake(x, y);
    for (let i = 0; i < 3; i++) land.shakeFree(x + rng.int(33) - 16, y + rng.int(33) - 16, 14 + rng.int(13));
    return true;
  },

  /**
   * ForceFieldBrigde.c4d: a 72 pixel force bridge from the sorcerer's feet
   * out the way it faces, two pixels below the soles. In the air it starts
   * right under the sorcerer.
   */
  bridge(world, c) {
    const b = MAGIC.bridge;
    let reach = Math.trunc((b.width * 55) / 100);
    if (c.tAttach === CNAT.None) reach -= Math.trunc(reach / 10);
    const x = c.x + c.dir * reach - b.width / 2;
    const y = c.y + 12;
    const mask = new SolidMask(maskRect(b.width, b.height, { x: 0, y: 0, w: b.width, h: b.height }));
    mask.place(world.land, x, y);
    world.magic.bridges.push({ x, y, mask, time: 0 });
    unstick(world, x, y, b.width, b.height);
    return true;
  },

  /**
   * Meteor.c4d: for 200 ticks a meteor comes down every 15, somewhere within
   * 400 pixels of a spot 800 to 1000 pixels ahead of the sorcerer.
   */
  meteor(world, c) {
    const k = MAGIC.meteor;
    const w = world.land.width;
    const dist = k.near + world.rng.int(k.far - k.near + 1);
    const x = Math.max(Math.min(k.range / 2, w / 2), Math.min(w - k.range / 2, c.x + c.dir * dist));
    world.magic.showers.push({ x, dir: c.dir, time: 0, by: c });
    return true;
  },
};

/** GravitationDown.c4d and GravitationUp.c4d: 20 percent either way, between 30 and 290 percent. */
function changeGravity(world: World, c: Clonk, change: number): boolean {
  const { land, magic: m } = world;
  const now = Math.round(land.gravity * 500);
  if (change < 0 && now <= MAGIC.gravity.min) {
    world.say(c.owner, 'Gravity is at its lowest');
    return false;
  }
  if (change > 0 && now >= MAGIC.gravity.max) {
    world.say(c.owner, 'Gravity is at its highest');
    return false;
  }
  if (!m.gravity) m.gravity = { base: now, change: 0, time: 0 };
  m.gravity.change += change;
  land.gravity = (m.gravity.base + m.gravity.change) / 500;
  world.say(c.owner, `Gravity: ${m.gravity.base + m.gravity.change}%`);
  return true;
}

function stuck(world: World, o: GameObject): boolean {
  return o.vertices.some((v) => world.land.isSolid(o.x + v.x, o.y + v.y));
}

/** Clonks a new force field caught in the middle are pushed out, up or down (CheckStuck). */
function unstick(world: World, x: number, y: number, w: number, h: number): void {
  for (const c of world.clonks) {
    if (c.contained || c.x < x - 10 || c.x > x + w + 10 || Math.abs(c.y - (y + h / 2)) > 20) continue;
    const x0 = c.x;
    const y0 = c.y;
    const step = c.y <= y + h / 2 ? -1 : 1;
    for (let i = 0; i < 20 && stuck(world, c); i++) c.setPosition(c.x, c.y + step);
    if (stuck(world, c)) c.setPosition(x0, y0);
  }
}

/** One tick of everything spells have going on. Call after the weather's step, which the wind spell overrules. */
export function stepMagic(world: World): void {
  const m = world.magic;
  const { land, rng } = world;

  // Heal: every other tick, one time in three, 2 points, while the sorcerer keeps casting.
  if (m.heals.length) {
    m.heals = m.heals.filter((h) => {
      const c = h.caster;
      h.time++;
      if (h.time >= MAGIC.heal.ticks || !c.alive || !c.doesMagic) return false;
      // The casting animation plays on between a third and five sixths of its length.
      if (c.phase >= Math.trunc((c.action.length * 5) / 6)) c.phase = Math.trunc((c.action.length * 2) / 6);
      if (h.time % MAGIC.heal.interval) return true;
      if (!rng.int(MAGIC.heal.chance)) c.doEnergy(MAGIC.heal.energy);
      return c.energy < c.maxEnergy;
    });
  }

  // Gravity creeps back to normal: a point every 80 ticks, two while it's far off.
  const g = m.gravity;
  if (g && ++g.time % MAGIC.gravity.interval === 0) {
    if (Math.abs(g.change) <= 1) {
      land.gravity = g.base / 500;
      m.gravity = null;
    } else {
      g.change -= Math.sign(g.change) * (Math.abs(g.change) > 40 ? 2 : 1);
      land.gravity = (g.base + g.change) / 500;
    }
  }

  // The wind spell holds the wind; afterwards the weather takes over again.
  if (m.wind) {
    const w = world.weather;
    if (!w || ++m.wind.time > MAGIC.wind.ticks) m.wind = null;
    else land.wind = w.wind = m.wind.value;
  }

  // Meteor hail.
  if (m.showers.length) {
    const k = MAGIC.meteor;
    m.showers = m.showers.filter((s) => {
      if (s.time % k.interval === 0) {
        const x = s.x + rng.int(k.range + 1) - k.range / 2;
        const meteor = world.spawnItem('meteor', x, land.topOpen ? 0 : 5, (s.dir * (5 + rng.int(26)) + rng.int(41) - 20) / 10, 1.5, 0.2);
        meteor.thrownBy = s.by.id;
      }
      return ++s.time <= k.ticks;
    });
  }

  // Force bridges run out.
  if (m.bridges.length) {
    m.bridges = m.bridges.filter((b) => {
      if (++b.time < MAGIC.bridge.ticks) return true;
      b.mask.remove(land);
      return false;
    });
  }

  stepFiretails(world);
  stepShots(world);

  // Lightning from the sky charges a sorcerer it comes down on (AttractLightning).
  for (const b of world.weather?.bolts ?? []) {
    if (m.struck.has(b)) continue;
    const tip = b.points[b.points.length - 1];
    const c = world.clonks.find((c) => c.maxMagic && c.alive && !c.contained && Math.abs(c.x - tip.x) <= MAGIC.shot.attract && Math.abs(c.y - tip.y) <= MAGIC.shot.attract);
    if (!c) continue;
    m.struck.add(b);
    lightningStrike(world, c);
  }
}

/**
 * Firetail.c4d: each time it lands it hops on, 2 pixels a tick sideways and 1
 * up, unless a wall is 20 pixels ahead (then only one time in five), and
 * leaves a flame that sets alight what it touches. After 200 ticks it explodes.
 */
function stepFiretails(world: World): void {
  const m = world.magic;
  if (!m.firetails.length) return;
  const { land, rng } = world;
  const k = MAGIC.firetail;
  for (const f of m.firetails) {
    if (++f.age > k.ticks || land.isLiquid(f.x, f.y)) {
      f.removed = true;
      if (f.age > k.ticks) world.explode(f.x, f.y, k.explode, f.by);
      continue;
    }
    f.ydir += land.gravity;
    const res = f.doMovement(land);
    if (!res.contact) continue;
    if (!land.isSolid(f.x + f.side * 20, f.y) || !rng.int(5)) {
      f.xdir = f.side * k.speed;
      f.ydir = -k.hop;
      flame(world, f);
    }
  }
  m.firetails = m.firetails.filter((f) => !f.removed);
}

/** The flame a fireball leaves (FLAM): whatever burns and stands in it catches fire. */
function flame(world: World, f: Firetail): void {
  world.events.push({ type: 'flame', x: f.x, y: f.y, tick: world.tick });
  for (const p of world.plants) if (!p.removed && p.isAt(f.x, f.y)) incinerate(world, p, f.by);
  for (const item of world.items) {
    if (item.container || item.removed || !item.def.contactIncinerate) continue;
    if (Math.abs(item.x - f.x) <= 8 && Math.abs(item.y - f.y) <= 8) incinerate(world, item, f.by);
  }
  for (const c of world.clonks) {
    if (!c.alive || c.contained || (c === f.by && f.age < 20)) continue;
    if (Math.abs(c.x - f.x) <= CLONK.width / 2 && Math.abs(c.y - f.y) <= CLONK.height / 2) incinerate(world, c, f.by);
  }
  for (const s of world.structures) {
    if (s.gone || !s.burned || !s.def.burned.contactIncinerate) continue;
    if (f.x >= s.left && f.x < s.left + s.def.width && f.y >= s.top && f.y < s.top + s.def.height) incinerate(world, s, f.by);
  }
}

/**
 * LightningShot.c4d Advance: the bolt grows by a corner a tick until it runs
 * into the ground or out of corners. Past its seventh corner it jumps to a
 * living clonk within 13 pixels and strikes it for 10 points; in water it
 * shocks every clonk swimming nearby for 12. Trees it passes catch fire.
 */
function stepShots(world: World): void {
  const m = world.magic;
  if (!m.shots.length) return;
  const { land, rng } = world;
  const k = MAGIC.shot;
  const strike = (s: Shot, c: Clonk, points: number, from: number): void => {
    lightningStrike(world, c);
    world.hurt(c, points, s.by);
    if (c.alive) c.fling(1.5 * (Math.sign(c.x - from) || Math.sign(s.advX)), -2);
  };
  m.shots = m.shots.filter((s) => {
    if (s.glow >= 0) return --s.glow > 0;
    const tip = s.points[s.points.length - 1];
    const end = (): boolean => {
      s.glow = 6;
      return true;
    };
    if (land.isSolid(tip.x, tip.y) || s.points.length >= k.corners) return end();
    if (land.isLiquid(tip.x, tip.y)) {
      for (const c of world.clonks) {
        if (!c.alive || c.contained || !land.isLiquid(c.x, c.y)) continue;
        if (Math.abs(c.x - tip.x) > 400 || Math.abs(c.y - tip.y) > 400) continue;
        strike(s, c, k.waterDamage, tip.x);
      }
      return end();
    }
    for (const p of world.plants) if (!p.removed && p.isAt(tip.x, tip.y)) incinerate(world, p, s.by);
    const next = { x: tip.x + s.advX + rng.int(2 * k.jitter + 1) - k.jitter, y: tip.y + rng.int(2 * k.jitter + 1) - k.jitter };
    s.points.push(next);
    if (s.points.length - 1 > k.attractAfter) {
      const c = world.clonks.find((c) => c !== s.by && c.alive && !c.contained && Math.abs(c.x - next.x) <= k.attract && Math.abs(c.y - next.y) <= k.attract);
      if (c) {
        s.points.push({ x: c.x, y: c.y + 2 });
        strike(s, c, k.damage, tip.x);
        s.glow = k.glow;
      }
    }
    return true;
  });
}
