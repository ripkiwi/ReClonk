import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { generateMap } from '../landscape/generate';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { createProfile, type Profile } from './profiles';
import { rankName } from './ranks';
import { roundResults, startRound } from './round';
import { scenarioById, SCENARIOS } from './scenarios';
import { EXPERIENCE, World } from './world';

const NAMES = ['Alfons', 'Balder', 'Clifton'];

function flatWorld(w = 200, h = 120, ground = 80): World {
  const land = new Landscape(w, h);
  for (let y = ground; y < h; y++) for (let x = 0; x < w; x++) land.set(x, y, Mat.Earth);
  return new World(land, new Rng(1));
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

/** A crew clonk standing on flat ground. */
function crewClonk(world: World, experience = 0, controlCount = 0): Clonk {
  const c = world.addClonk(100, 70, 0);
  c.info = { memberId: 'm1', name: 'Alfons', rank: 0, experience, gained: 0, controlCount, portrait: 1 };
  run(world, 20);
  return c;
}

function profile(): Profile {
  return createProfile({ profiles: [], activeId: null }, 'Kevin', NAMES, new Rng(9));
}

describe('Scenarios', () => {
  it('has the two default scenarios', () => {
    expect(SCENARIOS.map((s) => s.title)).toEqual(['Gold Mine', 'Minor Melee']);
    expect(scenarioById('minor-melee')?.title).toBe('Minor Melee');
    expect(scenarioById('nope')).toBeUndefined();
  });

  it('Gold Mine is the original rolling map with a lake', () => {
    const s = scenarioById('goldmine')!;
    expect(s.map).toEqual({});
    const map = generateMap(s.width, s.height, s.seed, s.map);
    let water = 0;
    for (let i = 0; i < map.land.cells.length; i++) if (map.land.cells[i] === Mat.Water) water++;
    expect(water).toBeGreaterThan(1000);
  });

  it('Minor Melee is pretty flat, with lots of flints and no lake', () => {
    const s = scenarioById('minor-melee')!;
    const melee = generateMap(s.width, s.height, s.seed, s.map);
    const mine = generateMap(s.width, s.height, s.seed, {});
    const spread = (surface: Int32Array): number => Math.max(...surface) - Math.min(...surface);
    expect(spread(melee.surface)).toBeLessThan(spread(mine.surface) / 3);
    expect(spread(melee.surface)).toBeLessThan(40);

    const flints = melee.items.filter((i) => i.id === 'flint');
    const loose = flints.filter((i) => melee.land.get(i.x, i.y) === Mat.Sky);
    expect(flints.length).toBeGreaterThan(80);
    expect(loose.length).toBeGreaterThan(30);
    expect(melee.land.cells.includes(Mat.Water)).toBe(false);
  });

  it('flints lying on the surface stay put until someone picks them up', () => {
    const s = scenarioById('minor-melee')!;
    const round = startRound(s, profile());
    const before = round.world.items.length;
    let explosions = 0;
    for (let t = 0; t < 200; t++) {
      round.world.step(new Map());
      explosions += round.world.events.filter((e) => e.type === 'explosion').length;
      round.world.events.length = 0;
    }
    expect(explosions).toBe(0);
    expect(round.world.items.length).toBe(before);
  });
});

describe('Rounds', () => {
  it('sends the profile’s lead clonk in with its name, rank, controls and a flint', () => {
    const p = profile();
    p.controlStyle = 'classic';
    p.crew[1].experience = 3000;
    p.crew[1].rank = 2;
    const round = startRound(scenarioById('goldmine')!, p);
    expect(round.crew).toHaveLength(1);
    const c = round.crew[0];
    expect(c.info?.name).toBe(p.crew[1].name);
    expect(c.info?.rank).toBe(2);
    expect(c.controlStyle).toBe('classic');
    expect(c.carrying?.def.id).toBe('flint');
    expect(round.world.clonks).toEqual([c]);
  });

  it('starts Gold Mine at the home base, and Minor Melee without one', () => {
    const mine = startRound(scenarioById('goldmine')!, profile());
    const home = mine.world.structures.find((s) => s.base === 0);
    expect(home).toBeDefined();
    expect(Math.abs(mine.crew[0].x - home!.x)).toBeLessThan(40);
    expect(mine.world.players.get(0)?.wealth).toBeGreaterThan(0);

    const melee = startRound(scenarioById('minor-melee')!, profile());
    expect(melee.world.structures).toHaveLength(0);
    expect(melee.world.players.size).toBe(0);
  });

  it('reports what the crew earned', () => {
    const round = startRound(scenarioById('minor-melee')!, profile());
    const c = round.crew[0];
    c.doExperience(37);
    expect(roundResults(round)).toEqual([{ memberId: c.info!.memberId, experienceGained: 37, controlCount: 0 }]);
  });
});

describe('Experience', () => {
  it('earns 1 experience for every 5th command, like the original', () => {
    const world = flatWorld();
    const c = crewClonk(world);
    run(world, 1, { commands: 4 });
    expect(c.info!.experience).toBe(0);
    run(world, 1, { commands: 1 });
    expect(c.info!.experience).toBe(1);
    run(world, 1, { commands: 12 });
    expect(c.info!.experience).toBe(3);
    expect(c.info!.controlCount).toBe(17);
    expect(c.info!.gained).toBe(3);
  });

  it('finding a gold nugget pays once', () => {
    const world = flatWorld();
    const c = crewClonk(world);
    world.spawnItem('gold', 100, 76);
    run(world, 10);
    expect(c.carrying?.def.id).toBe('gold');
    expect(c.info!.experience).toBe(EXPERIENCE.goldFound);
    // Throw it away and pick it up again: no more experience.
    const gold = c.carrying!;
    run(world, 1, { pressedThrow: true });
    run(world, 60);
    expect(c.carrying).toBeUndefined();
    gold.setPosition(c.x, c.y + 6);
    run(world, 10);
    expect(c.carrying).toBe(gold);
    expect(c.info!.experience).toBe(EXPERIENCE.goldFound);
  });

  it('credits the thrower for what a flint breaks loose', () => {
    const world = flatWorld();
    for (let y = 80; y < 110; y++) for (let x = 110; x < 170; x++) world.land.set(x, y, Mat.Gold);
    const c = crewClonk(world);
    world.give(c, 'flint');
    run(world, 1, { pressedThrow: true });
    run(world, 60);
    const nuggets = world.items.filter((i) => i.def.id === 'gold').length;
    expect(nuggets).toBeGreaterThan(0);
    // A nugget that flew back into its hands counts as found gold too.
    const found = c.carrying?.def.id === 'gold' ? EXPERIENCE.goldFound : 0;
    expect(c.info!.experience).toBe(nuggets * EXPERIENCE.blastedLoose + found);
  });

  it('announces a promotion when the experience crosses the next rank', () => {
    const world = flatWorld();
    const c = crewClonk(world, 999, 4);
    world.events.length = 0;
    run(world, 1, { commands: 1 });
    expect(c.info!.rank).toBe(1);
    const promo = world.events.find((e) => e.type === 'promotion');
    expect(promo && promo.type === 'promotion' && rankName(promo.rank)).toBe('Ensign');
  });

  it('higher ranks climb faster', () => {
    const climb = (rank: number): number => {
      const world = flatWorld();
      for (let y = 0; y < 80; y++) for (let x = 120; x < 130; x++) world.land.set(x, y, Mat.Granite);
      const c = world.addClonk(100, 70, 0);
      c.info = { memberId: 'm', name: 'A', rank, experience: 0, gained: 0, controlCount: 0, portrait: 1 };
      run(world, 30);
      run(world, 30, { right: true });
      expect(c.action.name).toBe('Scale');
      const y0 = c.y;
      run(world, 15, { up: true });
      return y0 - c.y;
    };
    expect(climb(20)).toBeGreaterThan(climb(0));
  });
});

describe('Classic controls', () => {
  function classicClonk(): { world: World; c: Clonk } {
    const world = flatWorld(400);
    const c = world.addClonk(100, 70, 0);
    c.controlStyle = 'classic';
    run(world, 20);
    return { world, c };
  }

  it('one tap starts walking and it keeps going until stop', () => {
    const { world, c } = classicClonk();
    run(world, 1, { pressedRight: true, right: true });
    run(world, 36);
    const x1 = c.x;
    expect(x1).toBeGreaterThan(160);
    run(world, 36);
    expect(c.x).toBeGreaterThan(x1 + 60);
    run(world, 1, { pressedDown: true, down: true });
    run(world, 20);
    const x2 = c.x;
    run(world, 20);
    expect(c.x).toBe(x2);
    expect(c.action.name).toBe('Walk');
  });

  it('jumps with its own key and digs with the dig key', () => {
    const { world, c } = classicClonk();
    run(world, 1, { pressedUp: true, up: true });
    expect(c.action.name).toBe('Jump');
    run(world, 60);
    run(world, 1, { pressedDig: true });
    expect(c.action.name).toBe('Dig');
    run(world, 40);
    expect(c.y).toBeGreaterThan(75);
  });

  it('left and right turn the dig direction one step at a time', () => {
    const { world, c } = classicClonk();
    run(world, 1, { pressedDig: true });
    expect(c.comDir).toEqual({ x: 1, y: 1 });
    run(world, 1, { pressedRight: true });
    expect(c.comDir).toEqual({ x: 1, y: 0 });
    run(world, 1, { pressedRight: true });
    expect(c.comDir).toEqual({ x: 1, y: -1 });
    // Can't turn further up than diagonal.
    run(world, 1, { pressedRight: true });
    expect(c.comDir).toEqual({ x: 1, y: -1 });
    run(world, 1, { pressedLeft: true });
    run(world, 1, { pressedLeft: true });
    run(world, 1, { pressedLeft: true });
    expect(c.comDir).toEqual({ x: 0, y: 1 });
    run(world, 1, { pressedDown: true });
    expect(c.action.name).toBe('Walk');
  });
});
