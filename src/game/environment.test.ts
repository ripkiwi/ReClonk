import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { generateMap } from '../landscape/generate';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL } from '../objects/clonk';
import { findPlantSpot, placeVegetation, PLANTS, TREE } from '../objects/vegetation';
import { Environment, lightAt, TIME } from './environment';
import { createProfile } from './profiles';
import { startRound } from './round';
import { normalizeScenario, SCENARIOS } from './scenarios';
import { World } from './world';

const GROUND = 120;

/** Flat earth, with a lake 40 pixels deep from x 400 to 560 if `lake`. */
function flatWorld(lake = false, w = 600, h = 260): World {
  const land = new Landscape(w, h);
  for (let y = GROUND; y < h; y++) for (let x = 0; x < w; x++) land.set(x, y, Mat.Earth);
  if (lake) for (let y = GROUND; y < GROUND + 40; y++) for (let x = 400; x < 560; x++) land.set(x, y, Mat.Water);
  const world = new World(land, new Rng(1));
  world.addPlayer(0, { wealth: 100, stock: {} });
  return world;
}

function run(world: World, ticks: number): void {
  const controls = new Map([[0, NO_CONTROL]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

describe('New vegetation', () => {
  it('palms and cacti grow on the ground, seaweed on the bottom of lakes', () => {
    const world = flatWorld(true);
    const rng = new Rng(3);
    const all = { x: 0, y: 0, w: 600, h: 260 };
    const palm = findPlantSpot(world.land, rng, PLANTS.palm1, all)!;
    expect(world.land.get(palm.x, palm.bottom - 5)).toBe(Mat.Earth);
    const weed = findPlantSpot(world.land, rng, PLANTS.seaweed1, { x: 420, y: 0, w: 100, h: 260 })!;
    expect(weed.x).toBeGreaterThanOrEqual(400);
    expect(weed.x).toBeLessThan(560);
    // On the lake bottom, 3 pixels into it.
    expect(weed.bottom).toBe(GROUND + 40 + 2);
  });

  it('cacti and seaweed can’t be chopped or blasted down, and don’t burn', () => {
    const world = flatWorld();
    const cactus = world.addPlant('cactus', 300, GROUND + 8);
    const c = world.addClonk(300, GROUND - 10, 0);
    run(world, 10);
    expect(world.choppableAt(c)).toBeNull();
    // A blast right at it, that doesn't reach the ground it stands on.
    world.explode(300, GROUND - 25, 12);
    run(world, 40);
    expect(cactus.state).toBe('standing');
    expect(cactus.fire).toBeNull();
  });

  it('seaweed wiggles under water and hangs limp out of it, and sinks when its ground goes', () => {
    const world = flatWorld(true);
    const weed = world.addPlant('seaweed1', 480, GROUND + 42);
    run(world, TREE.growthInterval + 1);
    expect(weed.wet).toBe(true);
    expect(weed.cell(world.tick)[1]).toBe(0);
    for (let y = GROUND; y < GROUND + 40; y++) for (let x = 400; x < 560; x++) world.land.set(x, y, Mat.Sky);
    run(world, TREE.growthInterval + 1);
    expect(weed.wet).toBe(false);
    expect(weed.cell(world.tick)).toEqual([0, 1]);
    // Dig the ground away under it: it drops down to the next.
    for (let y = GROUND + 40; y < GROUND + 70; y++) for (let x = 470; x < 490; x++) world.land.set(x, y, Mat.Sky);
    run(world, 60);
    expect(weed.bottom).toBeGreaterThan(GROUND + 60);
  });

  it('a tall palm bends in a storm', () => {
    const world = flatWorld();
    const palm = world.addPlant('palm2', 300, GROUND + 8);
    palm.breeze = true;
    expect(palm.cell(0)[1]).toBe(0);
    palm.storm = true;
    expect(palm.cell(0)[1]).toBe(1);
  });

  it('dead trees, shells, bones and skulls are vegetation too', () => {
    const world = flatWorld(true);
    const veg = placeVegetation(world.land, new Rng(5), { burnedTree1: 1, shell: 1, bone: 1 }, 1000);
    expect(veg.plants.some((p) => p.id === 'tree1' && p.burned)).toBe(true);
    expect(veg.items.some((i) => i.id === 'shell' && i.x >= 400 && i.x < 560)).toBe(true);
    expect(veg.items.some((i) => i.id === 'bone')).toBe(true);
  });

  it('Shark Lake has its shells and seaweed, Lava Caves its bones, skulls and dead trees', () => {
    const shark = SCENARIOS.find((s) => s.id === 'shark-lake')!;
    const map = generateMap(shark.landscape, shark.seed, { players: 2 });
    expect(map.plants.some((p) => p.id === 'seaweed1' || p.id === 'seaweed2')).toBe(true);
    expect(map.items.some((i) => i.id === 'bone' || i.id === 'skull')).toBe(true);
    const lava = SCENARIOS.find((s) => s.id === 'lava-caves')!;
    expect(lava.landscape.vegetation).toEqual({ bone: 6, skull: 6, burnedTree1: 1, burnedTree2: 1 });
  });
});

describe('Environment objects', () => {
  it('the light follows the time of day: bright at noon, dark at midnight', () => {
    expect(lightAt(0)).toBe(100);
    expect(lightAt(TIME.resolution / 2)).toBe(0);
    expect(lightAt(TIME.resolution / 4)).toBe(50);
  });

  it('time goes by and the light fades a step every 10 ticks', () => {
    const world = flatWorld();
    const env = new Environment({ time: 10 }, world, 1);
    world.environment = env;
    env.setTime(24);
    const light = env.light;
    run(world, 200);
    expect(env.time).toBe(2400 + 200);
    expect(env.light).toBeLessThan(light);
    expect(env.light).toBeGreaterThanOrEqual(light - 20);
  });

  it('stars come out at night and go at dawn', () => {
    const world = flatWorld();
    const env = new Environment({ time: 1, stars: 1 }, world, 1);
    world.environment = env;
    env.setTime(50);
    run(world, 200);
    const max = Math.trunc((600 * 260) / 20000);
    expect(env.stars.length).toBe(max);
    env.setTime(0);
    run(world, 100);
    expect(env.stars.length).toBe(0);
  });

  it('birds sing by day, cicadas and the owl at night', () => {
    const world = flatWorld();
    const env = new Environment({ time: 1, birdSong: 5, cicadas: 3, owl: 2 }, world, 1);
    world.environment = env;
    const sounds = (): string[] => world.events.flatMap((e) => (e.type === 'environment' ? [e.sound] : []));
    run(world, 2000);
    expect(sounds()).toContain('BirdSong');
    expect(sounds()).not.toContain('Cicada');
    world.events.length = 0;
    env.setTime(50);
    run(world, 4000);
    expect(sounds()).toContain('Cicada');
    expect(sounds()).toContain('Owl');
    expect(sounds()).not.toContain('BirdSong');
  });

  it('big rocks bounce, hurt clonks they fall on and break apart', () => {
    const world = flatWorld();
    const env = new Environment({ rockfall: 1 }, world, 2);
    world.environment = env;
    const c = world.addClonk(300, GROUND - 10, 0);
    run(world, 5);
    const energy = c.energy;
    // A half-size rock: its middle passes through the clonk.
    env.addRock(world, 300, 0, 0, 2, 50);
    let broke = false;
    for (let i = 0; i < 600 && !broke; i++) {
      run(world, 1);
      broke = world.events.some((e) => e.type === 'environment' && e.sound === 'RockBreak');
    }
    expect(world.events.some((e) => e.type === 'environment' && e.sound === 'RockHit')).toBe(true);
    expect(c.energy).toBeLessThan(energy);
    expect(broke).toBe(true);
  });

  it('drains hold a lake at its level', () => {
    const world = flatWorld(true);
    const env = new Environment({ seaLevel: 1 }, world, 1);
    world.environment = env;
    expect(env.drains.length).toBeGreaterThan(0);
    // Raise the lake 3 pixels.
    for (let y = GROUND - 3; y < GROUND; y++) for (let x = 400; x < 560; x++) world.land.set(x, y, Mat.Water);
    run(world, 200);
    expect(world.land.get(450, GROUND - 2)).toBe(Mat.Sky);
  });

  it('driftwood washes up on lakes', () => {
    const world = flatWorld(true, 600);
    world.environment = new Environment({ driftwood: 3 }, world, 4);
    run(world, 50 * 400);
    expect(world.items.some((i) => i.def.id === 'wood')).toBe(true);
  });

  it('scenarios keep their environment objects within their limits, and the originals have theirs', () => {
    const s = normalizeScenario({ ...SCENARIOS[0], environment: { time: 99, owl: 1, glint: -3 } });
    expect(s.environment).toEqual({ time: 10, owl: 1, glint: 0 });
    expect(SCENARIOS.find((x) => x.id === 'minor-melee')!.environment).toEqual({ glint: 1, birdSong: 4 });
    const round = startRound({ ...SCENARIOS[0], environment: { time: 1 } }, createProfile({ profiles: [], activeId: null }, 'Test'));
    expect(round.world.environment?.isDay).toBe(true);
  });
});
