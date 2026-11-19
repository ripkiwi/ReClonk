import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { ANIMALS, type Animal, type AnimalId } from '../objects/animal';
import { contactCheck } from '../objects/physics';
import { breakEgg, initAnimals } from './animals';
import { createProfile } from './profiles';
import { LOCAL_PLAYER, startRound } from './round';
import { normalizeScenario, scenarioById, SCENARIOS } from './scenarios';
import type { Weather } from './weather';
import { World } from './world';

const GROUND = 100;
/** A lake from x 300 to 560, its top at y 110, 90 deep. */
const LAKE = { x0: 300, x1: 560, top: 110, bottom: 200 };

function lakeWorld(): World {
  const land = new Landscape(640, 260);
  for (let y = GROUND; y < 260; y++) for (let x = 0; x < 640; x++) land.set(x, y, Mat.Earth);
  for (let y = GROUND; y < LAKE.bottom; y++) {
    for (let x = LAKE.x0; x < LAKE.x1; x++) land.set(x, y, y < LAKE.top ? Mat.Sky : Mat.Water);
  }
  const world = new World(land, new Rng(1));
  world.weather = { windAt: () => 0, step: () => {} } as unknown as Weather;
  world.addPlayer(0, { wealth: 0, stock: {} });
  return world;
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

/** An animal standing on the ground at x. */
function onGround(world: World, id: AnimalId, x: number): Animal {
  const bottom = Math.max(...ANIMALS[id].vertices.map((v) => v.y));
  return world.addAnimal(id, x, GROUND - 1 - bottom);
}

function clonkAt(world: World, x: number, y = GROUND - 10): Clonk {
  const c = world.addClonk(x, y, 0);
  run(world, 10);
  return c;
}

describe('Wipf', () => {
  it('runs about on the ground, jumping and sitting, without getting stuck', () => {
    const world = lakeWorld();
    const w = onGround(world, 'wipf', 100);
    const actions = new Set<string>();
    const xs: number[] = [];
    for (let t = 0; t < 36 * 60; t++) {
      run(world, 1);
      actions.add(w.action.name);
      xs.push(w.x);
    }
    expect(w.alive).toBe(true);
    expect(actions.has('Walk')).toBe(true);
    expect(actions.has('Jump') || actions.has('Sit')).toBe(true);
    // It got around, and it is not stuck in the earth.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(30);
    expect(contactCheck(world.land, w.vertices, w.x, w.y).count).toBeLessThan(w.vertices.length);
  });

  it('dies in a flint blast and leaves a dead wipf, which a clonk picks up and sells', () => {
    const world = lakeWorld();
    const w = onGround(world, 'wipf', 100);
    run(world, 2);
    // A flint (18) takes 6 + 9 points of its 50, a tera-flint (40) 13 + 20.
    world.explode(w.x, w.y, 18);
    run(world, 1);
    expect(w.energy).toBe(35000);
    world.explode(w.x, w.y, 40);
    run(world, 1);
    world.explode(w.x, w.y, 40);
    run(world, 2);
    expect(world.animals.includes(w)).toBe(false);
    const body = world.items.find((i) => i.def.id === 'deadWipf');
    expect(body).toBeDefined();
    expect(body!.def.value).toBe(10);
    run(world, 60);
    const c = clonkAt(world, body!.x);
    run(world, 5);
    expect(c.carrying?.def.id).toBe('deadWipf');
  });

  it('a dead wipf rots away after a while (Dead 3000 ticks, then DoCon(-4) every 100)', () => {
    const world = lakeWorld();
    const it = world.spawnItem('deadWipf', 50, GROUND - 10);
    run(world, 3000);
    expect(it.con).toBe(100000);
    run(world, 2600);
    expect(it.removed).toBe(true);
  });

  it('the Collectible animals rule: a clonk picks it up alive, and dropped it runs off again', () => {
    const world = lakeWorld();
    const w = onGround(world, 'wipf', 100);
    w.comd = 0;
    const c = clonkAt(world, 60);
    w.setPosition(c.x, w.y);
    run(world, 2);
    expect(c.carrying).toBeUndefined();
    world.rules.add('collectibleAnimals');
    w.setAction('Sit');
    w.setPosition(c.x, w.y);
    run(world, 2);
    expect(c.carrying?.def.id).toBe('wipf');
    expect(world.animals.some((a) => a.def.id === 'wipf')).toBe(false);
    run(world, 30, { pressedThrow: true });
    const free = world.animals.find((a) => a.def.id === 'wipf');
    expect(free?.alive).toBe(true);
  });
});

describe('Fish', () => {
  it('swims about in the lake and stays in it', () => {
    const world = lakeWorld();
    const fish = world.addAnimal('fish', 430, 160);
    for (let t = 0; t < 36 * 60; t++) {
      run(world, 1);
      expect(world.land.isLiquid(fish.x, fish.y + 1) || world.land.isLiquid(fish.x, fish.y)).toBe(true);
    }
    expect(fish.alive).toBe(true);
  });

  it('suffocates on land and becomes a dead fish', () => {
    const world = lakeWorld();
    onGround(world, 'fish', 100);
    run(world, 36 * 20);
    expect(world.animals.length).toBe(0);
    expect(world.items.some((i) => i.def.id === 'deadFish')).toBe(true);
  });
});

describe('Shark', () => {
  it('hunts a swimming clonk and bites it from behind', () => {
    const world = lakeWorld();
    const shark = world.addAnimal('shark', 500, 170);
    const c = world.addClonk(400, LAKE.top + 4, 0);
    run(world, 5);
    expect(c.action.procedure).toBe('swim');
    const start = c.energy;
    let bites = 0;
    for (let t = 0; t < 36 * 30 && c.alive; t++) {
      // Keep the clonk paddling at the surface in the middle of the lake.
      c.setPosition(400, Math.min(c.y, LAKE.top + 8));
      run(world, 1);
      if (shark.action.name === 'Jaw' && shark.phase === 0) bites++;
    }
    expect(bites).toBeGreaterThan(0);
    expect(c.energy).toBeLessThan(start);
  });

  it('stays in the water', () => {
    const world = lakeWorld();
    const shark = world.addAnimal('shark', 430, 170);
    run(world, 36 * 60);
    expect(shark.alive).toBe(true);
    expect(world.land.isLiquid(shark.x, shark.y)).toBe(true);
  });
});

describe('Monster', () => {
  it('knocks over a clonk it runs into (Punch 10)', () => {
    const world = lakeWorld();
    const c = clonkAt(world, 100);
    const m = onGround(world, 'monster', 140);
    m.setDir(-1);
    m.setAction('Walk');
    m.comd = 7;
    const start = c.energy;
    let knocked = false;
    for (let t = 0; t < 200 && !knocked; t++) {
      m.timer = 0;
      run(world, 1);
      if (c.action.name === 'Tumble') knocked = true;
    }
    expect(knocked).toBe(true);
    expect(c.energy).toBeLessThanOrEqual(start - 10000);
  });

  it('takes a lot to kill: 250 energy, and its body stays and rots', () => {
    const world = lakeWorld();
    const m = onGround(world, 'monster', 100);
    world.explode(m.x, m.y, 30);
    run(world, 2);
    expect(m.alive).toBe(true);
    for (let i = 0; i < 10 && m.alive; i++) {
      world.explode(m.x, m.y, 30);
      run(world, 2);
    }
    expect(m.alive).toBe(false);
    expect(world.animals.includes(m)).toBe(true);
    run(world, 3000 + 180 * 51);
    expect(world.animals.includes(m)).toBe(false);
  });

  it('a blasted egg hatches a young monster, an egg buried in the earth does not', () => {
    const world = lakeWorld();
    const egg = world.spawnItem('monsterEgg', 50, GROUND - 3);
    breakEgg(world, egg);
    const young = world.animals.find((a) => a.def.id === 'monster');
    expect(young?.con).toBe(40);
    const buried = world.spawnItem('monsterEgg', 50, GROUND + 50);
    breakEgg(world, buried);
    expect(world.animals.filter((a) => a.def.id === 'monster').length).toBe(1);
    // It grows up: 1.5% every 35 ticks.
    run(world, 35 * 40 + 1);
    expect(young!.con).toBe(100);
  });
});

describe('Bird', () => {
  it('flies about above the ground and stays in the map', () => {
    const world = lakeWorld();
    const bird = world.addAnimal('bird', 200, 40);
    for (let t = 0; t < 36 * 60; t++) {
      run(world, 1);
      expect(bird.y).toBeGreaterThanOrEqual(0);
      // It may dip into the water (the original turns up only once it sees water 3 ticks ahead), and comes up again.
      expect(bird.y).toBeLessThan(LAKE.top + 25);
    }
    expect(bird.alive).toBe(true);
    expect(bird.action.procedure).toBe('float');
  });
});

describe('Scenarios', () => {
  it('Shark Lake has its five sharks in the lake, Lava Caves its monsters and eggs', () => {
    const p = createProfile({ profiles: [], activeId: null }, 'Kevin');
    const shark = startRound(scenarioById('shark-lake')!, p, ['Alfons'], 7);
    const sharks = shark.world.animals.filter((a) => a.def.id === 'shark');
    expect(sharks.length).toBe(5);
    for (const s of sharks) expect(shark.world.land.isLiquid(s.x, s.y)).toBe(true);
    const lava = startRound(scenarioById('lava-caves')!, p, ['Alfons'], 7);
    expect(lava.world.animals.filter((a) => a.def.id === 'monster').length).toBeGreaterThan(0);
    // Not right next to the crew.
    for (const m of lava.world.animals) for (const c of lava.world.crewOf(LOCAL_PLAYER)) expect(Math.abs(m.x - c.x) >= 200 || Math.abs(m.y - c.y) >= 200).toBe(true);
    expect(lava.world.items.filter((i) => i.def.id === 'monsterEgg').length).toBe(4);
  });

  it('a scenario saved before animals gets the original’s; animals are kept within limits', () => {
    const shark = SCENARIOS.find((s) => s.id === 'shark-lake')!;
    const old = JSON.parse(JSON.stringify(shark));
    delete old.animals;
    delete old.nests;
    expect(normalizeScenario(old, shark).animals).toEqual({ shark: 5 });
    expect(normalizeScenario({ ...old, animals: { wipf: 500, bogus: 3 } }, shark).animals).toEqual({ wipf: 50 });
  });

  it('the same seed places the same animals', () => {
    const a = lakeWorld();
    const b = lakeWorld();
    initAnimals(a, { wipf: 3, fish: 3, bird: 2 }, {}, 5);
    initAnimals(b, { wipf: 3, fish: 3, bird: 2 }, {}, 5);
    run(a, 500);
    run(b, 500);
    expect(a.animals.map((x) => [x.x, x.y])).toEqual(b.animals.map((x) => [x.x, x.y]));
    expect(a.animals.length).toBeGreaterThan(5);
  });
});
