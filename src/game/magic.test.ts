import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { CLONK, CLONK_KINDS, ITEMS, MAGIC_UNIT, SORCERER } from '../objects/defs';
import { completeStructure, construct } from './buildings';
import { incinerate } from './fire';
import { execSpell, MAGIC, SPELL_IDS, spellList, SPELLS, startSpell, type SpellId } from './magic';
import { DEFAULT_WEATHER, Weather } from './weather';
import { sval } from '../landscape/mapCreator';
import { World } from './world';

const GROUND = 160;

function flatWorld(w = 1200, h = 300, seed = 1): World {
  const land = new Landscape(w, h);
  for (let y = GROUND; y < h; y++) for (let x = 0; x < w; x++) land.set(x, y, Mat.Earth);
  const world = new World(land, new Rng(seed));
  world.addPlayer(0, { wealth: 100, stock: {} });
  world.addPlayer(1, { wealth: 0, stock: {} });
  return world;
}

function calm(world: World): Weather {
  world.weather = new Weather({ ...DEFAULT_WEATHER, wind: sval(0) }, new Rng(7), world.land.width);
  return world.weather;
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}
const tap = (world: World, ctrl: Partial<ControlState>): void => run(world, 1, ctrl);
const MAGIC_KEY = { pressedMagic: true };

function sorcerer(world: World, x = 300, mana = 100, owner = 0): Clonk {
  const c = world.addClonk(x, GROUND - 10, owner, 'sorcerer');
  run(world, 10);
  c.doMagicEnergy(mana);
  return c;
}

/** Cast and let the casting animation play out; true if the spell went off (it cost magic energy). */
function cast(world: World, c: Clonk, id: SpellId): boolean {
  const before = c.magicEnergy;
  if (!startSpell(world, c, id)) return false;
  for (let i = 0; i < 40 && (c.casting || c.doesMagic); i++) run(world, 1);
  return c.magicEnergy === before - SPELLS[id].value * MAGIC_UNIT;
}

/** Step and remember which spells went off. */
function watch(world: World): SpellId[] {
  const got: SpellId[] = [];
  const step = world.step.bind(world);
  world.step = (controls) => {
    world.events.length = 0;
    step(controls);
    for (const e of world.events) if (e.type === 'magic') got.push(e.spell);
  };
  return got;
}

describe('The sorcerer', () => {
  it('is a clonk of its own kind: 50 gold, 100 magic points, weaker in a fight, no magic energy to begin with', () => {
    expect(SORCERER.value).toBe(50);
    expect(SORCERER.physical.magic).toBe(100 * MAGIC_UNIT);
    expect(SORCERER.physical.fight).toBeLessThan(CLONK.physical.fight);
    expect(CLONK_KINDS.sorcerer).toBe(SORCERER);
    const world = flatWorld();
    const s = world.addClonk(300, GROUND - 10, 0, 'sorcerer');
    const c = world.addClonk(340, GROUND - 10, 0);
    expect(s.maxMagic).toBe(100 * MAGIC_UNIT);
    expect(s.magicEnergy).toBe(0);
    expect(c.maxMagic).toBe(0);
    run(world, 500);
    expect(s.magicEnergy).toBe(0);
  });

  it('an ordinary clonk can’t take magic energy, and the magic key does nothing for it', () => {
    const world = flatWorld();
    const c = world.addClonk(300, GROUND - 10, 0);
    run(world, 10);
    expect(c.doMagicEnergy(5)).toBe(false);
    tap(world, MAGIC_KEY);
    expect(c.spellMenu).toBeNull();
  });

  it('a crystal in its hands turns into 10 points of magic energy and is used up', () => {
    const world = flatWorld();
    const s = sorcerer(world, 300, 0);
    world.give(s, 'crystal');
    run(world, 3);
    expect(s.magicEnergy).toBe(ITEMS.crystal.manaGain! * MAGIC_UNIT);
    expect(s.carrying).toBeFalsy();
    expect(s.doesMagic).toBe(true);
  });

  it('a crystal that doesn’t fit stays in hand, smaller, and gives the rest later', () => {
    const world = flatWorld();
    const s = sorcerer(world, 300, 96);
    const crystal = world.give(s, 'crystal')!;
    run(world, 3);
    expect(s.magicEnergy).toBe(100 * MAGIC_UNIT);
    expect(crystal.removed).toBe(false);
    expect(s.carrying).toBe(crystal);
    s.doMagicEnergy(-50);
    run(world, 40);
    expect(s.magicEnergy).toBe(56 * MAGIC_UNIT);
    expect(crystal.removed).toBe(true);
  });

  it('an ordinary clonk just carries a crystal', () => {
    const world = flatWorld();
    const c = world.addClonk(300, GROUND - 10, 0);
    run(world, 10);
    const crystal = world.give(c, 'crystal')!;
    run(world, 50);
    expect(c.carrying).toBe(crystal);
  });
});

describe('The spell menu', () => {
  it('the magic key opens it; left and right choose, up casts, and the spell costs its value', () => {
    const world = flatWorld();
    const got = watch(world);
    const s = sorcerer(world);
    tap(world, MAGIC_KEY);
    expect(s.spellMenu).toBe(0);
    tap(world, { pressedRight: true });
    expect(spellList(world)[s.spellMenu!]).toBe('bridge');
    tap(world, { pressedLeft: true });
    tap(world, { pressedLeft: true });
    expect(spellList(world)[s.spellMenu!]).toBe('meteor');
    tap(world, { pressedRight: true });
    tap(world, { pressedRight: true });
    tap(world, { pressedUp: true });
    expect(s.spellMenu).toBeNull();
    expect(s.casting).toBe('bridge');
    expect(s.doesMagic).toBe(true);
    // Nothing happens before the fifth frame of the animation.
    expect(s.magicEnergy).toBe(100 * MAGIC_UNIT);
    run(world, 20);
    expect(got).toEqual(['bridge']);
    expect(s.magicEnergy).toBe((100 - SPELLS.bridge.value) * MAGIC_UNIT);
  });

  it('the magic key, down or dig closes it without casting', () => {
    const world = flatWorld();
    const s = sorcerer(world);
    for (const close of [MAGIC_KEY, { pressedDown: true }, { pressedDig: true }]) {
      tap(world, MAGIC_KEY);
      expect(s.spellMenu).toBe(0);
      tap(world, close);
      expect(s.spellMenu).toBeNull();
    }
    expect(s.magicEnergy).toBe(100 * MAGIC_UNIT);
    expect(s.casting).toBeNull();
  });

  it('the spells are listed cheapest first, and a scenario can allow only some', () => {
    const world = flatWorld();
    expect(SPELL_IDS[0]).toBe('wind');
    expect(SPELL_IDS[SPELL_IDS.length - 1]).toBe('meteor');
    expect(spellList(world)).toEqual(SPELL_IDS);
    world.spells = ['heal', 'wind'];
    expect(spellList(world)).toEqual(['wind', 'heal']);
  });

  it('without enough magic energy nothing is cast and nothing is spent', () => {
    const world = flatWorld();
    const got = watch(world);
    const s = sorcerer(world, 300, 9);
    expect(startSpell(world, s, 'bridge')).toBe(false);
    run(world, 30);
    expect(got).toEqual([]);
    expect(s.magicEnergy).toBe(9 * MAGIC_UNIT);
  });

  it('the costs are the original’s', () => {
    expect(Object.fromEntries(SPELL_IDS.map((id) => [id, SPELLS[id].value]))).toEqual({
      wind: 8, bridge: 10, gravityDown: 11, gravityUp: 11, earthquake: 12, extinguish: 15, lightning: 15, heal: 19, firefist: 21, meteor: 50,
    });
  });
});

/** A pit between x 310 and 385, so a bolt across it has room: on flat ground bolts often run into the floor. */
function gap(world: World): void {
  for (let y = GROUND; y < GROUND + 80; y++) for (let x = 310; x < 385; x++) world.land.set(x, y, Mat.Sky);
}

describe('Spells', () => {
  it('Magic Bridge: a solid bridge ahead of the sorcerer’s feet that vanishes after 1000 ticks', () => {
    const world = flatWorld();
    // A pit to bridge.
    for (let y = GROUND; y < GROUND + 60; y++) for (let x = 310; x < 370; x++) world.land.set(x, y, Mat.Sky);
    watch(world);
    const s = sorcerer(world, 300);
    s.dir = 1;
    expect(cast(world, s, 'bridge')).toBe(true);
    expect(world.magic.bridges).toHaveLength(1);
    expect(world.land.isSolid(340, GROUND + 3)).toBe(true);
    // Walk across the pit.
    run(world, 30);
    run(world, 150, { right: true });
    expect(s.x).toBeGreaterThan(372);
    expect(s.y).toBeLessThan(GROUND);
    run(world, MAGIC.bridge.ticks);
    expect(world.magic.bridges).toHaveLength(0);
    expect(world.land.isSolid(340, GROUND + 3)).toBe(false);
  });

  it('Lower and Raise Gravity: 20 percent either way, creeping back to normal', () => {
    const world = flatWorld();
    watch(world);
    const s = sorcerer(world);
    const normal = world.land.gravity;
    expect(cast(world, s, 'gravityDown')).toBe(true);
    expect(world.land.gravity).toBeCloseTo(normal - 20 / 500);
    run(world, 30);
    expect(cast(world, s, 'gravityUp')).toBe(true);
    expect(cast(world, s, 'gravityUp')).toBe(true);
    expect(world.land.gravity).toBeGreaterThan(normal);
    run(world, 25 * MAGIC.gravity.interval);
    expect(world.land.gravity).toBeCloseTo(normal);
    expect(world.magic.gravity).toBeNull();
  });

  it('Wind: the wind blows the sorcerer’s way and the weather can’t change it for a while', () => {
    const world = flatWorld();
    const w = calm(world);
    watch(world);
    const s = sorcerer(world);
    s.dir = -1;
    expect(cast(world, s, 'wind')).toBe(true);
    run(world, 500);
    expect(w.wind).toBe(-100);
    expect(world.land.wind).toBe(-100);
    run(world, MAGIC.wind.ticks);
    expect(world.magic.wind).toBeNull();
  });

  it('Wind with a flint in hand hurls a burning log instead', () => {
    const world = flatWorld();
    calm(world);
    watch(world);
    const s = sorcerer(world);
    world.give(s, 'flint');
    expect(cast(world, s, 'wind')).toBe(true);
    expect(s.contents.some((i) => i.def.id === 'flint')).toBe(false);
    const log = world.items.find((i) => i.def.id === 'wood')!;
    expect(log.fire).toBeTruthy();
    expect(world.magic.wind).toBeNull();
  });

  it('Earthquake: shakes the ground ahead', () => {
    const world = flatWorld();
    const w = calm(world);
    watch(world);
    const s = sorcerer(world);
    s.dir = 1;
    expect(cast(world, s, 'earthquake')).toBe(true);
    expect(w.quakes).toHaveLength(1);
    expect(w.quakes[0].x).toBeGreaterThanOrEqual(400);
    expect(w.quakes[0].x).toBeLessThanOrEqual(420);
  });

  it('Extinguish: puts out the sorcerer and fires nearby, but costs nothing when nothing burns', () => {
    const world = flatWorld();
    watch(world);
    const s = sorcerer(world);
    expect(cast(world, s, 'extinguish')).toBe(false);
    expect(s.magicEnergy).toBe(100 * MAGIC_UNIT);
    const near = world.addPlant('tree1', 330, GROUND);
    const far = world.addPlant('tree1', 700, GROUND);
    run(world, 30);
    incinerate(world, near, null);
    incinerate(world, far, null);
    incinerate(world, s, null);
    expect(execSpell(world, s, 'extinguish')).toBe(true);
    expect(s.fire).toBeFalsy();
    expect(near.fire).toBeFalsy();
    expect(far.fire).toBeTruthy();
    expect(s.magicEnergy).toBe(85 * MAGIC_UNIT);
  });

  it('Lightning: the bolt strikes an enemy ahead for 10 points, and whoever cast it gets the kill', () => {
    // A bolt wanders: with this seed it finds its mark.
    const world = flatWorld(1200, 300, 2);
    watch(world);
    gap(world);
    const s = sorcerer(world, 300);
    const foe = world.addClonk(395, GROUND - 10, 1);
    run(world, 10);
    s.dir = 1;
    const before = foe.energy;
    expect(cast(world, s, 'lightning')).toBe(true);
    run(world, 40);
    expect(before - foe.energy).toBeGreaterThanOrEqual(MAGIC.shot.damage * 1000);
    expect(foe.lastHurtBy).toBe(s);
    expect(world.magic.shots).toHaveLength(0);
  });

  it('Lightning that strikes a sorcerer charges it with 10 points', () => {
    // A bolt wanders: with this seed it finds its mark.
    const world = flatWorld(1200, 300, 2);
    watch(world);
    gap(world);
    const s = sorcerer(world, 300);
    const other = sorcerer(world, 395, 0, 1);
    s.dir = 1;
    expect(cast(world, s, 'lightning')).toBe(true);
    run(world, 40);
    expect(other.magicEnergy).toBe(MAGIC.lightningGain * MAGIC_UNIT);
  });

  it('Heal: gives the sorcerer energy back while it casts, and does not work at full energy', () => {
    const world = flatWorld();
    watch(world);
    const s = sorcerer(world);
    expect(cast(world, s, 'heal')).toBe(false);
    expect(s.magicEnergy).toBe(100 * MAGIC_UNIT);
    run(world, 30);
    s.doEnergy(-40);
    const hurt = s.energy;
    expect(cast(world, s, 'heal')).toBe(true);
    run(world, MAGIC.heal.ticks);
    expect(s.energy).toBeGreaterThan(hurt + 20 * 1000);
    expect(world.magic.heals).toHaveLength(0);
    expect(s.magicEnergy).toBe((100 - SPELLS.heal.value) * MAGIC_UNIT);
  });

  it('Fire Fist: two fireballs hop off left and right, light a tree on the way and explode after 200 ticks', () => {
    const world = flatWorld();
    watch(world);
    const s = sorcerer(world, 600);
    const tree = world.addPlant('tree1', 680, GROUND);
    expect(cast(world, s, 'firefist')).toBe(true);
    expect(world.magic.firetails.map((f) => f.side)).toEqual([-1, 1]);
    const blasts: number[] = [];
    for (let i = 0; i < MAGIC.firetail.ticks + 5; i++) {
      run(world, 1);
      for (const e of world.events) if (e.type === 'explosion') blasts.push(e.x);
    }
    expect(tree.fire).toBeTruthy();
    expect(world.magic.firetails).toHaveLength(0);
    expect(blasts).toHaveLength(2);
    expect(Math.min(...blasts)).toBeLessThan(500);
    expect(Math.max(...blasts)).toBeGreaterThan(700);
    expect(s.fire).toBeFalsy();
  });

  it('Meteor Hail: meteors come down far ahead of the sorcerer, not on its own head', () => {
    const world = flatWorld(2400);
    watch(world);
    const s = sorcerer(world, 300);
    s.dir = 1;
    expect(cast(world, s, 'meteor')).toBe(true);
    const xs: number[] = [];
    const seenIds = new Set<number>();
    for (let i = 0; i < MAGIC.meteor.ticks + 5; i++) {
      run(world, 1);
      for (const m of world.items) if (m.def.id === 'meteor' && !seenIds.has(m.id)) (seenIds.add(m.id), xs.push(m.x));
    }
    expect(xs.length).toBeGreaterThanOrEqual(13);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(300 + MAGIC.meteor.near - MAGIC.meteor.range / 2);
    expect(world.magic.showers).toHaveLength(0);
    expect(s.magicEnergy).toBe(50 * MAGIC_UNIT);
  });

  it('a spell cast in mid-air goes off too', () => {
    const world = flatWorld();
    const got = watch(world);
    const s = sorcerer(world);
    run(world, 3, { pressedUp: true, up: true });
    expect(startSpell(world, s, 'gravityDown')).toBe(true);
    run(world, 40);
    expect(got).toEqual(['gravityDown']);
  });
});

describe('Sorcerers in the shop', () => {
  it('a home base that stocks sorcerers and crystals sells them', () => {
    const world = flatWorld();
    const p = world.players.get(0)!;
    p.wealth = 100;
    p.stock = { sorcerer: 1, crystal: 2 };
    const hut = construct(world, 'hut', 500, GROUND, 0);
    completeStructure(world, hut);
    expect(world.shopList(0)).toEqual(expect.arrayContaining(['sorcerer', 'crystal']));
  });

  it('magic is deterministic: the same spells in the same world end the same', () => {
    const play = (): string => {
      const world = flatWorld();
      calm(world);
      const s = sorcerer(world, 600);
      world.addClonk(700, GROUND - 10, 1);
      for (const id of ['firefist', 'lightning', 'earthquake'] as const) {
        startSpell(world, s, id);
        run(world, 60);
      }
      run(world, 200);
      return JSON.stringify(world.clonks.map((c) => [Math.round(c.x * 100), Math.round(c.y * 100), c.energy, c.magicEnergy]));
    };
    expect(play()).toBe(play());
  });
});
