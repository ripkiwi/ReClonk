import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { generateMap } from '../landscape/generate';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { applyRoundResults, createProfile, hireClonk, type Profile } from './profiles';
import { rankName } from './ranks';
import { LOCAL_PLAYER, roundResults, startRound } from './round';
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

/** A profile with `crew` hired clonks. */
function profile(crew = 2): Profile {
  const p = createProfile({ profiles: [], activeId: null }, 'Kevin');
  for (let i = 0; i < crew; i++) hireClonk(p, NAMES, new Rng(20 + i));
  return p;
}

const TAP_DIG = { pressedDig: true };

describe('Scenarios', () => {
  it('has the default scenarios', () => {
    expect(SCENARIOS.map((s) => s.title)).toEqual(['Gold Mine', 'Minor Melee', 'Shark Lake']);
    expect(scenarioById('minor-melee')?.title).toBe('Minor Melee');
    expect(scenarioById('nope')).toBeUndefined();
  });

  it('Gold Mine and Minor Melee have the landscape values of the originals', () => {
    const mine = scenarioById('goldmine')!.landscape;
    expect([mine.mapWidth.std, mine.mapHeight.std, mine.mapZoom.std]).toEqual([80, 60, 10]);
    expect([mine.amplitude, mine.phase, mine.period, mine.random, mine.liquidLevel].map((v) => [v.std, v.rnd])).toEqual([
      [10, 10],
      [50, 50],
      [10, 10],
      [20, 20],
      [20, 30],
    ]);
    expect(mine.mapPlayerExtend).toBe(true);
    expect(mine.inEarthLevel.std).toBe(65);
    const melee = scenarioById('minor-melee')!.landscape;
    expect([melee.mapWidth.std, melee.mapHeight.std, melee.amplitude.std, melee.random.std, melee.liquidLevel.std]).toEqual([100, 60, 11, 46, 43]);
    expect(melee.layers.map((l) => `${l.name}=${l.count}`).join(';')).toBe(
      'Rock=7;Rock-Ridge=7;Gold=7;Granite=4;Water-Smooth=7;Earth-Rough=50;Earth-Smooth2=50',
    );
  });

  it('Minor Melee: hills and lakes, flints in the earth and lying around', () => {
    const s = scenarioById('minor-melee')!;
    for (const seed of [1, 2, 3]) {
      const m = generateMap(s.landscape, seed, { players: 2 });
      expect([m.land.width, m.land.height]).toEqual([1000, 600]);
      // Water level 43: lakes fill the open air below 57% of the map height (map row 34 of 60).
      const lake = [...m.surface].filter((y, x) => m.land.get(x, y) === Mat.Water);
      expect(lake.length).toBeGreaterThan(50);
      expect(new Set(lake)).toEqual(new Set([340]));
      const flints = m.items.filter((i) => i.id === 'flint');
      const loose = flints.filter((i) => m.land.get(i.x, i.y) === Mat.Sky);
      expect(flints.length - loose.length).toBeGreaterThan(15);
      expect(loose.length).toBeGreaterThan(15);
      expect(m.land.isSolid(m.spawn.x, m.spawn.y + 11)).toBe(true);
    }
  });

  it('Shark Lake: an island for each crew with a lake between them, like the original', () => {
    const s = scenarioById('shark-lake')!;
    const l = s.landscape;
    expect([l.mapWidth.std, l.mapHeight.std, l.amplitude.std, l.phase.std, l.period.std, l.liquidLevel.std]).toEqual([64, 60, 45, 43, 9, 55]);
    expect([s.crewSize, s.opponents, s.goal, s.homeBase, s.base.wealth]).toEqual([5, 1, 'melee', true, 100]);
    for (const seed of [1, 2, 3]) {
      const round = startRound(s, profile(), NAMES, seed);
      const { world } = round;
      expect([world.land.width, world.land.height]).toEqual([1280, 600]);
      // One hut with a flag for each crew, and no spare hut.
      const huts = world.structures;
      expect(huts.map((h) => h.base)).toEqual([0, 1]);
      // Water all the way between the two bases.
      const surface = (x: number): number => {
        let y = 0;
        while (world.land.get(x, y) === Mat.Sky) y++;
        return world.land.get(x, y);
      };
      const between = Array.from({ length: 200 }, (_, i) => surface(Math.round(huts[0].x + (huts[1].x - huts[0].x) * (0.3 + (0.4 * i) / 200))));
      expect(between.every((m) => m === Mat.Water)).toBe(true);
      expect(world.clonks.filter((c) => c.owner === 0)).toHaveLength(5);
      expect(world.clonks.filter((c) => c.owner === 1)).toHaveLength(5);
    }
  });

  it('Shark Lake: the computer crew swims across the lake to attack', () => {
    const round = startRound(scenarioById('shark-lake')!, profile(), NAMES, 7);
    const { world } = round;
    const home = world.structures.find((h) => h.base === 0)!;
    let closest = Infinity;
    for (let t = 0; t < 36 * 60; t++) {
      world.step(new Map());
      world.events.length = 0;
      for (const c of world.clonks) if (c.owner === 1) closest = Math.min(closest, Math.abs(c.x - home.x));
    }
    expect(closest).toBeLessThan(80);
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
    const round = startRound(scenarioById('goldmine')!, p, NAMES);
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
    expect(roundResults(round)[0]).toEqual({ memberId: c.info!.memberId, experienceGained: 37, controlCount: 0, died: false, kills: 0 });
  });
});

describe('Crew', () => {
  it('an empty crew recruits its first clonk at the start of the round, for good', () => {
    const p = profile(0);
    const round = startRound(scenarioById('goldmine')!, p, NAMES);
    expect(p.crew).toHaveLength(1);
    const c = round.crew[0];
    expect(NAMES).toContain(c.info?.name);
    expect(c.info?.memberId).toBe(p.crew[0].id);
    expect(round.recruited.has(p.crew[0].id)).toBe(true);
  });

  it('Minor Melee brings three clonks: the crew first, then new recruits', () => {
    const p = profile(1);
    p.crew[0].experience = 50;
    const round = startRound(scenarioById('minor-melee')!, p, NAMES);
    expect(round.crew).toHaveLength(3);
    expect(round.crew[0].info?.memberId).toBe(p.crew[0].id);
    expect(p.crew).toHaveLength(3);
    expect(new Set(round.crew.map((c) => c.info?.name)).size).toBe(3);
    expect(round.world.cursor(LOCAL_PLAYER).leader).toBe(round.crew[0]);
  });

  it('a dead clonk stays in the crew and counts a death', () => {
    const p = profile(1);
    const round = startRound(scenarioById('goldmine')!, p, NAMES);
    round.crew[0].doEnergy(-100);
    const results = roundResults(round);
    expect(results[0].died).toBe(true);
    applyRoundResults(p, results);
    expect(p.crew).toHaveLength(1);
    expect(p.crew[0].deaths).toBe(1);
  });
});

describe('Buying clonks', () => {
  /** Gold Mine with the lead clonk standing inside its home base. */
  function inBase(crew: number) {
    const p = profile(crew);
    const round = startRound(scenarioById('goldmine')!, p, NAMES);
    const { world } = round;
    const lead = round.crew[0];
    run(world, 10);
    run(world, 1, { up: true, pressedUp: true });
    expect(lead.contained?.base).toBe(LOCAL_PLAYER);
    world.players.get(LOCAL_PLAYER)!.wealth = 100;
    return { p, round, world, lead };
  }

  /** Open the buy menu and buy what's at `index`. */
  function buy(world: World, index: number): void {
    run(world, 1, { up: true, pressedUp: true });
    for (let i = 0; i < index; i++) run(world, 1, { pressedRight: true });
    run(world, 1, { pressedThrow: true });
    run(world, 1, { pressedDig: true });
  }

  it('the shop sells clonks for 25 gold', () => {
    const { world } = inBase(1);
    expect(world.shopList(LOCAL_PLAYER)).toContain('clonk');
  });

  it('brings in the best idle crew member first, then recruits new ones for good', () => {
    const { p, round, world } = inBase(2);
    const player = world.players.get(LOCAL_PLAYER)!;
    const clonkAt = world.shopList(LOCAL_PLAYER).indexOf('clonk');
    const idle = p.crew.find((m) => m.id !== round.crew[0].info?.memberId)!;
    buy(world, clonkAt);
    expect(round.crew).toHaveLength(2);
    expect(round.crew[1].info?.memberId).toBe(idle.id);
    expect(round.crew[1].contained).toBeNull();
    expect(player.wealth).toBe(75);
    expect(round.recruited.size).toBe(0);

    buy(world, clonkAt);
    expect(round.crew).toHaveLength(3);
    expect(p.crew).toHaveLength(3);
    expect(round.recruited.has(round.crew[2].info!.memberId)).toBe(true);
    expect(player.wealth).toBe(50);
    expect(world.events.some((e) => e.type === 'recruit')).toBe(true);
    // Everyone who played is in the results, the new recruit too.
    expect(roundResults(round).map((r) => r.memberId)).toEqual(round.crew.map((c) => c.info!.memberId));
  });

  it("won't sell a clonk without the gold", () => {
    const { round, world } = inBase(1);
    world.players.get(LOCAL_PLAYER)!.wealth = 10;
    buy(world, world.shopList(LOCAL_PLAYER).indexOf('clonk'));
    expect(round.crew).toHaveLength(1);
    expect(world.messages.some((m) => m.text.includes('Not enough gold'))).toBe(true);
  });
});

describe('Several clonks', () => {
  /** Three clonks on flat ground, spread out, controlled by player 0. */
  function crew(style: 'jumpAndRun' | 'classic' = 'jumpAndRun') {
    const world = flatWorld(400);
    const clonks = [60, 200, 340].map((x, i) => {
      const c = world.addClonk(x, 70, 0);
      c.controlStyle = style;
      c.info = { memberId: `m${i}`, name: NAMES[i], rank: 0, experience: 0, gained: 0, controlCount: 0, portrait: 1 };
      return c;
    });
    run(world, 20);
    return { world, clonks };
  }

  it('only the leader follows the keys at first', () => {
    const { world, clonks } = crew();
    run(world, 20, { right: true });
    expect(clonks[0].x).toBeGreaterThan(80);
    expect(clonks[1].x).toBe(200);
    expect(clonks[2].x).toBe(340);
  });

  it('Tab, Shift+Tab and the number keys switch the leader', () => {
    const { world, clonks } = crew();
    const cursor = () => world.cursor(0);
    run(world, 1, { crew: { type: 'next' } });
    expect(cursor().leader).toBe(clonks[1]);
    expect([...cursor().selected]).toEqual([clonks[1]]);
    run(world, 1, { crew: { type: 'prev' } });
    run(world, 1, { crew: { type: 'prev' } });
    expect(cursor().leader).toBe(clonks[2]);
    run(world, 1, { crew: { type: 'pick', index: 0 } });
    expect(cursor().leader).toBe(clonks[0]);
    run(world, 1, { crew: { type: 'toggle', index: 2 } });
    expect(cursor().selected.has(clonks[2])).toBe(true);
    expect(cursor().leader).toBe(clonks[0]);
  });

  it('a clonk left digging keeps digging while you control another', () => {
    const { world, clonks } = crew();
    run(world, 1, TAP_DIG);
    expect(clonks[0].action.name).toBe('Dig');
    run(world, 1, { crew: { type: 'next' } });
    run(world, 40, { right: true });
    expect(clonks[0].action.name).toBe('Dig');
    expect(clonks[0].y).toBeGreaterThan(75);
    expect(clonks[1].x).toBeGreaterThan(240);
  });

  it('a walking clonk stops when you switch away from it', () => {
    const { world, clonks } = crew();
    run(world, 10, { right: true });
    run(world, 1, { right: true, crew: { type: 'next' } });
    const x = clonks[0].x;
    run(world, 30);
    expect(Math.abs(clonks[0].x - x)).toBeLessThan(4);
  });

  it('the whole crew follows the keys together, and down gathers it at the leader', () => {
    const { world, clonks } = crew();
    run(world, 1, { crew: { type: 'all' } });
    expect(world.cursor(0).selected.size).toBe(3);
    run(world, 10, { left: true });
    expect(clonks.every((c, i) => c.x < [60, 200, 340][i])).toBe(true);
    run(world, 1, { down: true, pressedDown: true });
    run(world, 200);
    for (const c of clonks) expect(Math.abs(c.x - clonks[0].x)).toBeLessThan(10);
  });

  it('classic: stop twice gathers the crew', () => {
    const { world, clonks } = crew('classic');
    run(world, 1, { crew: { type: 'all' } });
    run(world, 1, { pressedDown: true, doubleDown: true });
    run(world, 200);
    for (const c of clonks) expect(Math.abs(c.x - clonks[0].x)).toBeLessThan(10);
  });

  it('when the leader dies, the next living clonk takes over', () => {
    const { world, clonks } = crew();
    clonks[0].doEnergy(-100);
    run(world, 1);
    expect(world.cursor(0).leader).toBe(clonks[1]);
    run(world, 1, { crew: { type: 'pick', index: 0 } });
    expect(world.cursor(0).leader).toBe(clonks[1]);
  });

  it('commands only earn the leader experience', () => {
    const { world, clonks } = crew();
    run(world, 1, { commands: 5 });
    expect(clonks[0].info!.experience).toBe(1);
    expect(clonks[1].info!.experience).toBe(0);
  });
});

describe('Digging with jump\'n\'run controls', () => {
  it('Q starts digging, the clonk keeps going on its own, and Q again stops', () => {
    const world = flatWorld();
    const c = crewClonk(world);
    run(world, 1, TAP_DIG);
    expect(c.action.name).toBe('Dig');
    run(world, 40);
    expect(c.action.name).toBe('Dig');
    expect(c.y).toBeGreaterThan(80);
    run(world, 1, TAP_DIG);
    expect(c.action.name).toBe('Walk');
  });

  it('digs the way you hold, and keeps that way when you let go', () => {
    const world = flatWorld();
    const c = crewClonk(world);
    run(world, 1, { pressedDig: true, right: true });
    expect(c.comDir).toEqual({ x: 1, y: 0 });
    run(world, 5, { down: true });
    expect(c.comDir).toEqual({ x: 0, y: 1 });
    run(world, 5);
    expect(c.comDir).toEqual({ x: 0, y: 1 });
  });

  it('a quick second tap (use) with nothing usable keeps digging', () => {
    const world = flatWorld();
    const c = crewClonk(world);
    run(world, 1, TAP_DIG);
    run(world, 3);
    run(world, 1, { pressedDig: true, pressedUse: true });
    expect(c.action.name).toBe('Dig');
  });

  it('E throws, and S no longer digs', () => {
    const world = flatWorld();
    const c = crewClonk(world);
    run(world, 1, { down: true, pressedDown: true });
    expect(c.action.name).toBe('Walk');
    world.give(c, 'rock');
    run(world, 1, { pressedThrow: true });
    expect(c.carrying).toBeUndefined();
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
