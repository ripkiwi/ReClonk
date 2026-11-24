import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type ControlState } from '../objects/clonk';
import { completeStructure, construct } from './buildings';
import { allowedWipfDeaths, GOAL_IDS, GOALS, goalStatus, initGoals, playerValue, racePercent, unbuilt, valueGain, type Goals } from './goals';
import { createProfile, hireClonk } from './profiles';
import { startRound } from './round';
import { normalizeScenario, scenarioById } from './scenarios';
import { World, type Brain } from './world';

const GROUND = 100;
const WIDTH = 600;

function flatWorld(goals: Goals, rules: string[] = []): World {
  const land = new Landscape(WIDTH, 200);
  for (let y = GROUND; y < 200; y++) for (let x = 0; x < WIDTH; x++) land.set(x, y, Mat.Earth);
  const world = new World(land, new Rng(1));
  world.goals = goals;
  world.addPlayer(0, { wealth: 0, stock: {} });
  world.addPlayer(1, { wealth: 0, stock: {} });
  for (const r of rules) world.rules.add(r as never);
  world.names.set(0, 'Kim').set(1, 'Computer');
  return world;
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

/** Run until the round is decided, or give up. Returns the gameOver event. */
function decided(world: World, ticks = 200) {
  for (let i = 0; i < ticks; i++) {
    world.events.length = 0;
    run(world, 1);
    const e = world.events.find((ev) => ev.type === 'gameOver');
    if (e) return e;
  }
  return null;
}

const idle: Brain = { control: () => ({ ...NO_CONTROL }) };

describe('Goals', () => {
  it('has the original goals, each with its picture', () => {
    expect(GOAL_IDS).toEqual(['melee', 'goldmine', 'oremine', 'wealth', 'value', 'wipfhunt', 'monsterkill', 'race', 'engineering']);
    for (const id of GOAL_IDS) expect(GOALS[id].icon).toMatch(/^goals\/\w+\.png$/);
  });

  it('without goals the round goes on', () => {
    const world = flatWorld({});
    world.addClonk(100, GROUND - 10, 0);
    expect(decided(world, 100)).toBeNull();
  });

  it('Goldmine: won once the gold veins are gone and every nugget is sold', () => {
    const world = flatWorld({ goldmine: 1 });
    world.addClonk(100, GROUND - 10, 0);
    for (let x = 0; x < 20; x++) for (let y = 120; y < 130; y++) world.land.set(x, y, Mat.Gold);
    world.spawnItem('gold', 200, GROUND - 5);
    expect(decided(world, 80)).toBeNull();
    expect(goalStatus(world, 'goldmine', 0)).toBe('You still have to mine 1 units of solid gold and collect 1 gold chunks, 1 of which are outside.');
    // Under 150 pixels of solid gold is as good as none.
    for (let x = 0; x < 20; x++) for (let y = 120; y < 124; y++) world.land.set(x, y, Mat.Earth);
    expect(decided(world, 80)).toBeNull();
    world.items[0].removed = true;
    const e = decided(world, 80);
    expect(e).toMatchObject({ winner: -1, fulfilled: true });
    expect(world.fulfilled).toBe(true);
    expect(goalStatus(world, 'goldmine', 0)).toBe('All gold has been mined.');
  });

  it('Ore Mining: won once the ore veins are gone and every chunk of ore is sold', () => {
    const world = flatWorld({ oremine: 1 });
    world.addClonk(100, GROUND - 10, 0);
    for (let x = 0; x < 20; x++) for (let y = 120; y < 130; y++) world.land.set(x, y, Mat.Ore);
    world.spawnItem('ore', 200, GROUND - 5);
    expect(goalStatus(world, 'oremine', 0)).toBe('You still have to mine an unknown amount of solid ore and collect 1 ore chunks, 1 of which are outside.');
    expect(decided(world, 80)).toBeNull();
    expect(goalStatus(world, 'oremine', 0)).toBe('You still have to mine 1 units of solid ore and collect 1 ore chunks, 1 of which are outside.');
    for (let x = 0; x < 20; x++) for (let y = 120; y < 124; y++) world.land.set(x, y, Mat.Earth);
    world.items[0].removed = true;
    expect(decided(world, 80)).toMatchObject({ winner: -1, fulfilled: true });
    expect(goalStatus(world, 'oremine', 0)).toBe('All ore has been mined.');
  });

  it('Money Points: every player needs the gold, computer crews don\'t have to help', () => {
    const world = flatWorld({ wealth: 2 });
    world.addClonk(100, GROUND - 10, 0);
    world.addClonk(400, GROUND - 10, 1);
    world.brains.set(1, idle);
    world.players.get(0)!.wealth = 199;
    expect(decided(world, 80)).toBeNull();
    expect(goalStatus(world, 'wealth', 0)).toBe('199 wealth points of 200 reached.');
    world.players.get(0)!.wealth = 200;
    expect(decided(world, 80)).toMatchObject({ winner: -1, fulfilled: true });
  });

  it('Rivalry: whoever fulfils the goals first wins, the others are out', () => {
    const world = flatWorld({ wealth: 1 }, ['rivalry']);
    world.addClonk(100, GROUND - 10, 0);
    const enemy = world.addClonk(400, GROUND - 10, 1);
    world.brains.set(1, idle);
    world.players.get(1)!.wealth = 100;
    const e = decided(world, 80);
    expect(e).toMatchObject({ winner: 1, fulfilled: false });
    expect(world.eliminated.has(0)).toBe(true);
    expect(world.eliminated.has(1)).toBe(false);
    expect(enemy.alive).toBe(true);
  });

  it('Settlement points: what the player owns grew by the target', () => {
    const world = flatWorld({ value: 1 });
    world.players.delete(1);
    world.addClonk(100, GROUND - 10, 0);
    world.players.get(0)!.wealth = 50;
    run(world, 1);
    const start = playerValue(world, 0);
    expect(start).toBe(50 + 25);
    expect(valueGain(world, 0)).toBe(0);
    // A hut (35) and gold (70) make 105 points.
    const s = construct(world, 'hut', 300, GROUND, 0);
    completeStructure(world, s);
    world.players.get(0)!.wealth += 70;
    expect(valueGain(world, 0)).toBe(105);
    expect(decided(world, 80)).toMatchObject({ fulfilled: true });
  });

  it('Wipf rescue: lost when too many wipfs die, won when none are left', () => {
    expect([1, 2, 3, 5].map(allowedWipfDeaths)).toEqual([0, 2, 3, 5]);
    const world = flatWorld({ wipfhunt: 1 });
    world.addClonk(100, GROUND - 10, 0);
    const w = world.addAnimal('wipf', 300, GROUND - 6);
    expect(decided(world, 40)).toBeNull();
    world.hurtAnimal(w, 1000, null);
    const e = decided(world, 80);
    expect(e).toMatchObject({ winner: -1, fulfilled: false });
    expect(world.eliminated.has(0)).toBe(true);
    expect(goalStatus(world, 'wipfhunt', 0)).toBe('Too many wipfs have died.');

    const saved = flatWorld({ wipfhunt: 1 });
    saved.addClonk(100, GROUND - 10, 0);
    const it = saved.spawnItem('wipf', 300, GROUND - 6);
    it.container = saved.clonks[0];
    saved.clonks[0].contents.push(it);
    expect(decided(saved, 40)).toBeNull();
    // Sold.
    saved.clonks[0].contents.length = 0;
    it.removed = true;
    expect(decided(saved, 80)).toMatchObject({ fulfilled: true });
  });

  it('Monsterkill: monsters come along if there are none, and every monster and egg must go', () => {
    const world = flatWorld({ monsterkill: 1 });
    world.addClonk(100, GROUND - 10, 0);
    initGoals(world, new Rng(3));
    const monsters = world.animals.filter((a) => a.def.id === 'monster');
    expect(monsters.length).toBeGreaterThanOrEqual(2);
    expect(monsters.length).toBeLessThanOrEqual(6);
    world.spawnItem('monsterEgg', 50, GROUND + 50);
    for (const m of monsters) world.hurtAnimal(m, 1e6, null);
    expect(decided(world, 80)).toBeNull();
    expect(goalStatus(world, 'monsterkill', 0)).toBe("There's still a monster egg somewhere around.");
    world.items.find((i) => i.def.id === 'monsterEgg')!.removed = true;
    expect(decided(world, 80)).toMatchObject({ fulfilled: true });
  });

  it('Race: nobody fights, and the first across the line on the right wins', () => {
    const world = flatWorld({ race: 1 });
    const me = world.addClonk(100, GROUND - 10, 0);
    const other = world.addClonk(110, GROUND - 10, 1);
    world.brains.set(1, idle);
    expect(world.hostile(0, 1)).toBe(false);
    run(world, 5);
    expect(racePercent(world, 0)).toBe(10);
    expect(goalStatus(world, 'race', 1)).toMatch(/^Kim is ahead|^You're ahead/);
    other.setPosition(WIDTH - 40, GROUND - 10);
    const e = decided(world, 80);
    expect(e).toMatchObject({ winner: 1 });
    expect(goalStatus(world, 'race', 0)).toBe('Computer has won the race!');
    expect(me.alive).toBe(true);
  });

  it('Engineer: everything a construction kit can build has to stand', () => {
    const world = flatWorld({ engineering: 1 });
    world.addClonk(100, GROUND - 10, 0);
    expect(unbuilt(world)).toEqual(['hut', 'elevator', 'tower']);
    let x = 150;
    for (const id of ['hut', 'elevator']) {
      completeStructure(world, construct(world, id, x, GROUND, 0));
      x += 120;
    }
    expect(decided(world, 40)).toBeNull();
    expect(goalStatus(world, 'engineering', 0)).toBe('Still to build: Guard Tower.');
    completeStructure(world, construct(world, 'tower', x, GROUND, 0));
    expect(decided(world, 80)).toMatchObject({ fulfilled: true });
  });

  it('Melee with other goals: wiping out the enemy is not enough', () => {
    const world = flatWorld({ melee: 1, wealth: 1 });
    world.addClonk(100, GROUND - 10, 0);
    const enemy = world.addClonk(400, GROUND - 10, 1);
    world.brains.set(1, idle);
    world.hurt(enemy, 1e6, null);
    expect(decided(world, 80)).toBeNull();
    expect(world.eliminated.has(1)).toBe(true);
    world.players.get(0)!.wealth = 100;
    expect(decided(world, 80)).toMatchObject({ fulfilled: true });
  });
});

describe('Rules for goals and buildings', () => {
  it('Release Clonk: the clonk fades away and is gone for the round, nobody gets the kill', () => {
    const world = flatWorld({});
    const a = world.addClonk(100, GROUND - 10, 0);
    const b = world.addClonk(130, GROUND - 10, 0);
    expect(world.releaseClonk(0)).toBeNull();
    world.rules.add('releaseClonk');
    expect(world.releaseClonk(0)).toBe(a);
    run(world, 10);
    expect(a.alive).toBe(true);
    run(world, 10);
    expect([a.alive, a.released]).toEqual([false, true]);
    expect(world.cursor(0).leader).toBe(b);
  });

  it('buildings clear snow out of themselves, unless they can snow in', () => {
    for (const snowIn of [false, true]) {
      const world = flatWorld({}, snowIn ? ['constructionSnowIn'] : []);
      const s = construct(world, 'hut', 300, GROUND, 0);
      completeStructure(world, s);
      const count = (): number => {
        let n = 0;
        for (let y = s.top; y < s.top + s.def.height; y++) for (let x = s.left; x < s.left + s.def.width; x++) if (world.land.get(x, y) === Mat.Snow) n++;
        return n;
      };
      for (let x = s.left + 20; x < s.left + 30; x++) world.land.set(x, s.top + 10, Mat.Snow);
      expect(count()).toBe(10);
      run(world, 36);
      if (snowIn) expect(count()).toBeGreaterThan(0);
      else expect(count()).toBe(0);
    }
  });
});

describe('Scenario goals', () => {
  it('Gold Mine has its original goal, Lava Caves its two', () => {
    expect(scenarioById('goldmine')!.goals).toEqual({ goldmine: 1 });
    expect(scenarioById('lava-caves')!.goals).toEqual({ monsterkill: 1, value: 16 });
    expect(scenarioById('minor-melee')!.goals).toEqual({ melee: 1 });
  });

  it('scenarios saved with the old single goal keep it', () => {
    const gm = scenarioById('goldmine')!;
    expect(normalizeScenario({ ...gm, goals: undefined, goal: 'melee' } as never).goals).toEqual({ melee: 1 });
    expect(normalizeScenario({ ...gm, goals: undefined, goal: 'none' } as never).goals).toEqual({});
    expect(normalizeScenario({ ...gm, goals: { wealth: 500, race: 1, nonsense: 3 } as never }).goals).toEqual({ wealth: 99, race: 1 });
  });

  it('a race starts everyone at the left edge', () => {
    const s = normalizeScenario({ ...scenarioById('minor-melee')!, goals: { race: 1 }, opponents: 1 });
    const p = createProfile({ profiles: [], activeId: null }, 'Kim');
    for (let i = 0; i < 3; i++) hireClonk(p, ['A', 'B', 'C'], new Rng(20 + i));
    const round = startRound(s, p, ['A', 'B', 'C']);
    for (const c of round.world.clonks) expect(c.x).toBeLessThan(250);
    expect(round.world.hostile(0, 1)).toBe(false);
  });
});
