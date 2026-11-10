import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { createMap, DEFAULT_LANDSCAPE, sval } from '../landscape/mapCreator';
import { MATERIALS, Mat, reaction, TEXMAP, texIndex } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { incinerate } from './fire';
import { igniteOil } from './liquids';
import { launchVolcano, stepVolcanoes } from './volcano';
import { DEFAULT_WEATHER, Weather } from './weather';
import { World } from './world';

const GROUND = 120;

function flatWorld(w = 400, h = 240, ground = GROUND): World {
  const land = new Landscape(w, h);
  for (let y = ground; y < h; y++) for (let x = 0; x < w; x++) land.set(x, y, Mat.Earth);
  const world = new World(land, new Rng(1));
  world.addPlayer(0, { wealth: 100, stock: {} });
  return world;
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

function until(world: World, cond: () => boolean, max: number): number {
  const t0 = world.tick;
  while (!cond() && world.tick - t0 < max) run(world, 1);
  return world.tick - t0;
}

/** A pool of `m` from x0 to x1, `depth` deep, dug into the ground. */
function pool(world: World, m: Mat, x0: number, x1: number, depth = 20, top = GROUND): void {
  for (let y = top; y < top + depth; y++) for (let x = x0; x < x1; x++) world.land.set(x, y, m);
}

function count(land: Landscape, m: Mat): number {
  let n = 0;
  for (const c of land.cells) if (c === m) n++;
  return n;
}

function swimmer(world: World, x: number): Clonk {
  const c = world.addClonk(x, GROUND + 8, 0);
  run(world, 3);
  return c;
}

describe('Liquid materials', () => {
  it('have the original values', () => {
    expect(MATERIALS[Mat.Oil]).toMatchObject({ density: 25, inflammable: true, corrode: 100 });
    expect(MATERIALS[Mat.Acid]).toMatchObject({ density: 25, corrosive: 75 });
    expect(MATERIALS[Mat.Lava]).toMatchObject({ density: 25, incindiary: true, belowTemp: { temp: 100, to: Mat.Ashes, dir: 0 }, tempConvStrength: 12 });
    expect(MATERIALS[Mat.DuroLava].belowTemp).toBeUndefined();
    expect(MATERIALS[Mat.Ashes]).toMatchObject({ density: 50, digFree: true, blastFree: true, corrode: 75 });
    // Earth 75, sand 30; rock, gold and granite don't corrode.
    expect([Mat.Earth, Mat.Sand, Mat.Rock, Mat.Gold, Mat.Granite].map((m) => MATERIALS[m].corrode ?? 0)).toEqual([75, 30, 0, 0, 0]);
  });

  it('react like the original reaction map', () => {
    expect(reaction(Mat.Lava, Mat.Water)).toBe('poof');
    expect(reaction(Mat.Water, Mat.Lava)).toBe('poof');
    expect(reaction(Mat.Oil, Mat.Lava)).toBe('incinerate');
    expect(reaction(Mat.Acid, Mat.Earth)).toBe('corrode');
    expect(reaction(Mat.Acid, Mat.Water)).toBe('corrode');
    expect(reaction(Mat.Acid, Mat.Rock)).toBeNull();
    expect(reaction(Mat.Snow, Mat.Lava)).toBe('convert');
    // Only against something at least as dense: earth doesn't react with the acid above it.
    expect(reaction(Mat.Earth, Mat.Acid)).toBeNull();
    expect(reaction(Mat.Lava, Mat.Sky)).toBeNull();
  });

  it('are in the texture map in the original order', () => {
    const names = TEXMAP.map((t) => t.name);
    expect(names.indexOf('DuroLava-Smooth')).toBeLessThan(names.indexOf('Water-Liquid'));
    expect(names.slice(names.indexOf('Water-Liquid'), names.indexOf('Water-Liquid') + 5)).toEqual(['Water-Liquid', 'Oil-Liquid', 'Acid-Liquid', 'Lava-Liquid', 'DuroLava-Liquid']);
    expect(TEXMAP[texIndex('Lava', 'Smooth')].mat).toBe(Mat.Lava);
    expect(TEXMAP[texIndex('Ashes')].mat).toBe(Mat.Ashes);
  });
});

describe('Acid', () => {
  it('eats its way down through earth and is used up doing it, but not through rock', () => {
    const world = flatWorld();
    pool(world, Mat.Acid, 100, 120, 10);
    // A rock floor 30 px down.
    for (let x = 90; x < 130; x++) for (let y = GROUND + 30; y < GROUND + 34; y++) world.land.set(x, y, Mat.Rock);
    const acid0 = count(world.land, Mat.Acid);
    const earth0 = count(world.land, Mat.Earth);
    run(world, 2000);
    const eaten = earth0 - count(world.land, Mat.Earth);
    const used = acid0 - count(world.land, Mat.Acid);
    expect(eaten).toBeGreaterThan(50);
    // One acid pixel per pixel eaten.
    expect(used).toBe(eaten);
    // Never below the rock.
    for (let x = 90; x < 130; x++) expect(world.land.get(x, GROUND + 31)).toBe(Mat.Rock);
    expect(world.events.length).toBeGreaterThan(0);
  });

  it('hurts a clonk swimming in it by 5 energy every 10 ticks', () => {
    const world = flatWorld();
    pool(world, Mat.Acid, 100, 200, 30);
    const c = swimmer(world, 150);
    const e0 = c.energy;
    run(world, 40);
    expect(e0 - c.energy).toBeGreaterThanOrEqual(15);
    expect(e0 - c.energy).toBeLessThanOrEqual(25);
    // A fresh clonk dies in a few seconds.
    until(world, () => !c.alive, 400);
    expect(c.alive).toBe(false);
  });

  it('the kill goes to whoever threw the clonk in', () => {
    const world = flatWorld();
    world.addPlayer(1, { wealth: 0, stock: {} });
    pool(world, Mat.Acid, 100, 200, 30);
    const enemy = world.addClonk(20, GROUND - 10, 1);
    const c = swimmer(world, 150);
    c.lastHurtBy = enemy;
    until(world, () => !c.alive, 600);
    const death = world.events.find((e) => e.type === 'death');
    expect(c.alive).toBe(false);
    expect(death && death.type === 'death' && death.killer).toBe(enemy);
  });
});

describe('Lava', () => {
  it('sets a clonk in it alight, and lava does not put the fire out', () => {
    const world = flatWorld();
    pool(world, Mat.DuroLava, 100, 200, 30);
    const c = swimmer(world, 150);
    run(world, 12);
    expect(c.fire).not.toBeNull();
    until(world, () => !c.alive, 600);
    expect(c.alive).toBe(false);
  });

  it('and water boil each other away with a hiss', () => {
    const world = flatWorld();
    pool(world, Mat.Water, 100, 150, 15);
    pool(world, Mat.DuroLava, 150, 200, 15);
    const water0 = count(world.land, Mat.Water);
    const lava0 = count(world.land, Mat.DuroLava);
    let poofs = 0;
    for (let i = 0; i < 300; i++) {
      run(world, 1);
      poofs += world.events.filter((e) => e.type === 'poof').length;
      world.events.length = 0;
    }
    const water = water0 - count(world.land, Mat.Water);
    const lava = lava0 - count(world.land, Mat.DuroLava);
    expect(poofs).toBeGreaterThan(10);
    // Each reaction takes one pixel of each.
    expect(water).toBe(poofs);
    expect(lava).toBe(poofs);
  });

  it('hardens into ashes from the top; DuroLava never does', () => {
    const world = flatWorld();
    pool(world, Mat.Lava, 100, 150, 30);
    pool(world, Mat.DuroLava, 250, 300, 30);
    // A whole pass of the temperature scan over the map, at any temperature.
    for (let i = 0; i < 400; i++) world.land.scanTemperature(20);
    expect(world.land.get(120, GROUND)).toBe(Mat.Ashes);
    expect(world.land.get(120, GROUND + 12)).toBe(Mat.Ashes);
    // 13 pixels a pass: the deep part is still lava.
    expect(world.land.get(120, GROUND + 20)).toBe(Mat.Lava);
    expect(world.land.get(270, GROUND)).toBe(Mat.DuroLava);
    // Ashes can be dug like earth.
    expect(world.land.dig(120, GROUND + 2, 4).get(Mat.Ashes)).toBeGreaterThan(0);
  });

  it('melts snow that falls on it', () => {
    const world = flatWorld();
    pool(world, Mat.DuroLava, 100, 200, 20);
    world.land.pxs.create(Mat.Snow, 150, GROUND - 30);
    for (let i = 0; i < 60; i++) world.land.pxs.step(world.rng);
    // It turned to water on the lava, and then boiled away with some of it.
    expect(count(world.land, Mat.Snow)).toBe(0);
  });
});

describe('Burning oil', () => {
  it('a flint blast sets an oil pool alight; flames spread over it and burn it away from the top', () => {
    const world = flatWorld();
    pool(world, Mat.Oil, 100, 200, 6);
    const oil0 = count(world.land, Mat.Oil);
    world.explode(110, GROUND - 2, 18);
    expect(world.flames.length).toBe(1);
    run(world, 300);
    expect(world.flames.length).toBeGreaterThan(3);
    // Spread across the pool.
    const xs = world.flames.map((f) => f.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(30);
    expect(count(world.land, Mat.Oil)).toBeLessThan(oil0);
    // In the end the oil is gone and the flames die down.
    until(world, () => count(world.land, Mat.Oil) === 0 && world.flames.length === 0, 20000);
    expect(count(world.land, Mat.Oil)).toBe(0);
    expect(world.flames.length).toBe(0);
  });

  it('a burning clonk swimming in oil lights it', () => {
    const world = flatWorld();
    pool(world, Mat.Oil, 100, 200, 30);
    const c = swimmer(world, 150);
    incinerate(world, c, null);
    until(world, () => world.flames.length > 0, 100);
    expect(world.flames.length).toBeGreaterThan(0);
  });

  it('flames set a clonk in the oil on fire', () => {
    const world = flatWorld();
    pool(world, Mat.Oil, 100, 200, 30);
    const c = swimmer(world, 150);
    igniteOil(world, Math.round(c.x), Math.round(c.y));
    until(world, () => !!c.fire, 200);
    expect(c.fire).not.toBeNull();
  });

  it('lava flowing next to oil lights it', () => {
    const world = flatWorld();
    pool(world, Mat.Oil, 100, 150, 10);
    pool(world, Mat.DuroLava, 150, 152, 10);
    until(world, () => world.flames.length > 0, 300);
    expect(world.flames.length).toBeGreaterThan(0);
  });

  it('there is never a second flame right next to the first (C4Landscape::Incinerate)', () => {
    const world = flatWorld();
    pool(world, Mat.Oil, 100, 200, 10);
    expect(igniteOil(world, 150, GROUND)).toBe(true);
    expect(igniteOil(world, 152, GROUND + 4)).toBe(false);
    expect(igniteOil(world, 170, GROUND)).toBe(true);
    expect(world.land.incinerate(150, GROUND - 20)).toBe(false);
  });

  it('flames in water go out', () => {
    const world = flatWorld();
    pool(world, Mat.Water, 100, 200, 30);
    igniteOil(world, 150, GROUND + 5);
    run(world, 10);
    expect(world.flames.length).toBe(0);
  });
});

describe('Volcanoes', () => {
  it('climb from the bottom of the map to the surface and pour out lava', () => {
    const world = flatWorld(400, 300);
    const rng = new Rng(7);
    let list = [launchVolcano(world, rng, Mat.Lava, 200, 299, 16)!];
    expect(list[0]).toBeTruthy();
    let out = false;
    for (let i = 0; i < 400 && list.length; i++) {
      list = stepVolcanoes(world, rng, list);
      world.tick++;
      if (list.some((v) => v.mode === 'discharge')) out = true;
    }
    expect(out).toBe(true);
    // A vein of lava through the ground, and lava on the surface or flying.
    let vein = 0;
    for (let y = GROUND + 20; y < 290; y++) for (let x = 120; x < 280; x++) if (world.land.get(x, y) === Mat.Lava) vein++;
    expect(vein).toBeGreaterThan(100);
    expect(world.land.pxs.list.some((p) => p.mat === Mat.Lava) || count(world.land, Mat.Lava) > vein).toBe(true);
  });

  it('come with the Volcano weather setting', () => {
    const world = flatWorld(400, 300);
    const w = new Weather({ ...DEFAULT_WEATHER, volcano: sval(100) }, new Rng(3), 400);
    world.weather = w;
    until(world, () => w.volcanoes.length > 0, 3000);
    expect(w.volcanoes.length).toBeGreaterThan(0);
  });
});

describe('Scenario lakes', () => {
  it('the map creator fills lakes with the scenario liquid', () => {
    const l = { ...DEFAULT_LANDSCAPE, liquid: 'Lava-Smooth', liquidLevel: sval(50), amplitude: sval(60), period: sval(20) };
    const map = createMap(l, new Rng(5), 1);
    const mats = new Set([...map.pix].map((p) => TEXMAP[p & 127].mat));
    expect(mats.has(Mat.Lava)).toBe(true);
    expect(mats.has(Mat.Water)).toBe(false);
  });
});
