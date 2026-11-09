import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { sval } from '../landscape/mapCreator';
import { Mat } from '../landscape/materials';
import { NO_CONTROL } from '../objects/clonk';
import { startRound } from './round';
import { normalizeScenario, SCENARIOS } from './scenarios';
import { DEFAULT_WEATHER, Weather, type WeatherDef } from './weather';
import { World } from './world';
import { createProfile } from './profiles';

/** A flat test world: sky on top, earth from row `ground` down, optionally a lake. */
function flatWorld(w = 600, h = 200, ground = 150): World {
  const land = new Landscape(w, h);
  for (let y = ground; y < h; y++) for (let x = 0; x < w; x++) land.set(x, y, Mat.Earth);
  return new World(land, new Rng(1));
}

/** Water `depth` deep from x0 to x1, its surface at row `top` (dug into the ground, it's a lake). */
function lake(world: World, x0: number, x1: number, top: number, depth: number): void {
  for (let y = top; y < top + depth; y++) for (let x = x0; x <= x1; x++) world.land.set(x, y, Mat.Water);
}

function withWeather(world: World, def: Partial<WeatherDef>, seed = 7): Weather {
  world.weather = new Weather({ ...DEFAULT_WEATHER, ...def }, new Rng(seed), world.land.width);
  return world.weather;
}

/** Weather that stays at one temperature: early spring (no seasonal swing) and a year that stands still. */
const steady = (temp: number): Partial<WeatherDef> => ({ climate: sval(50 - temp), startSeason: sval(25), yearSpeed: sval(0) });

function run(world: World, ticks: number): void {
  const controls = new Map([[0, { ...NO_CONTROL }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

function count(land: Landscape, m: Mat): number {
  let n = 0;
  for (let i = 0; i < land.cells.length; i++) if (land.cells[i] === m) n++;
  return n;
}

describe('Seasons and temperature', () => {
  it('start at the climate and follow the season, one degree every 35 ticks', () => {
    const world = flatWorld();
    // Climate 50 is a base temperature of 0; mid winter (season 0) swings 30 below.
    const w = withWeather(world, { climate: sval(50), startSeason: sval(0), yearSpeed: sval(0) });
    expect(w.temperature).toBe(0);
    run(world, 35 * 10 + 1);
    expect(w.temperature).toBe(-11);
    run(world, 35 * 30);
    expect(w.temperature).toBe(-30);
  });

  it('a year of YearSpeed 50 takes about 6.5 minutes and goes round the scenario’s seasons', () => {
    const world = flatWorld();
    const w = withWeather(world, { startSeason: sval(0), yearSpeed: sval(50) });
    run(world, 140 * 25 + 1);
    expect(w.season).toBe(25);
    run(world, 140 * 75);
    expect(w.season).toBe(100);
    // Past 100 it starts over at the lowest season the scenario allows.
    run(world, 140);
    expect(w.season).toBe(0);
    expect((140 * 100) / 36 / 60).toBeCloseTo(6.5, 1);
  });
});

describe('Wind', () => {
  it('turns one step every 10 ticks towards a new wind every 1000 ticks, within the limits', () => {
    const world = flatWorld();
    const w = withWeather(world, { wind: sval(40, 0, -100, 100) });
    expect(w.wind).toBe(40);
    run(world, 2000);
    expect(w.wind).toBe(40);
    const world2 = flatWorld();
    const gusty = withWeather(world2, { wind: sval(0, 100, -100, 100) });
    const seen = new Set<number>();
    let prev = gusty.wind;
    for (let i = 0; i < 5000; i++) {
      run(world2, 1);
      expect(Math.abs(gusty.wind - prev)).toBeLessThanOrEqual(1);
      prev = gusty.wind;
      seen.add(gusty.wind);
    }
    expect(seen.size).toBeGreaterThan(20);
    expect(world2.land.wind).toBe(gusty.wind);
  });
});

describe('Rain and snow', () => {
  it('makes no clouds without rain, and one per 500 pixels of width with it', () => {
    expect(withWeather(flatWorld(1200), {}).clouds).toHaveLength(0);
    expect(withWeather(flatWorld(1200), { rain: sval(60) }).clouds).toHaveLength(2);
    expect(withWeather(flatWorld(400), { rain: sval(60) }).clouds).toHaveLength(0);
  });

  it('rain falls as fast streaks and gathers as water on the ground', () => {
    const world = flatWorld();
    const w = withWeather(world, { rain: sval(100), climate: sval(0), wind: sval(0) });
    run(world, 4);
    const drops = world.land.pxs.list;
    expect(drops.length).toBeGreaterThan(0);
    expect(drops.every((p) => p.mat === Mat.Water && p.ydir > 9)).toBe(true);
    run(world, 600);
    expect(count(world.land, Mat.Water)).toBeGreaterThan(100);
    expect(w.precipitation).toBe(Mat.Water);
  });

  it('below 0 degrees it snows, and the snow piles up', () => {
    const world = flatWorld();
    const w = withWeather(world, { rain: sval(100), climate: sval(100), startSeason: sval(0), yearSpeed: sval(0), wind: sval(0) });
    expect(w.temperature).toBeLessThan(0);
    run(world, 900);
    expect(count(world.land, Mat.Snow)).toBeGreaterThan(100);
    expect(count(world.land, Mat.Water)).toBe(0);
    // Snow falls slower than rain.
    expect(world.land.pxs.list.every((p) => p.ydir < 6)).toBe(true);
  });

  it('the wind blows snow sideways', () => {
    const world = flatWorld();
    withWeather(world, { rain: sval(100), climate: sval(100), startSeason: sval(0), yearSpeed: sval(0), wind: sval(100, 0, -100, 100) });
    run(world, 200);
    const flakes = world.land.pxs.list.filter((p) => p.y > 50);
    expect(flakes.length).toBeGreaterThan(10);
    expect(flakes.reduce((s, p) => s + p.xdir, 0) / flakes.length).toBeGreaterThan(2);
  });

  it('loose snow slides down off a pile and melts into water', () => {
    const world = flatWorld(100, 100, 80);
    lake(world, 40, 60, 75, 5);
    for (let y = 30; y < 40; y++) world.land.set(50, y, Mat.Snow);
    run(world, 200);
    expect(world.land.get(50, 30)).toBe(Mat.Sky);
    expect(count(world.land, Mat.Snow)).toBe(0);
  });
});

describe('Freezing and thawing', () => {
  it('a lake freezes over from the top below -10 degrees, deeper with every pass', () => {
    const world = flatWorld(200, 120, 90);
    lake(world, 50, 150, 90, 10);
    const w = withWeather(world, steady(-20));
    expect(w.temperature).toBe(-20);
    // The scan does 2 columns per tick on a narrow map: one pass is 100 ticks.
    run(world, 100);
    expect(world.land.get(100, 90)).toBe(Mat.Ice);
    expect(world.land.get(100, 93)).toBe(Mat.Ice);
    expect(world.land.get(100, 94)).toBe(Mat.Water);
    run(world, 100);
    expect(world.land.get(100, 97)).toBe(Mat.Ice);
    // Ice is solid: a clonk can walk across.
    expect(world.land.isSolid(100, 90)).toBe(true);
  });

  it('ice melts from below above 10 degrees, and snow above 5', () => {
    const world = flatWorld(200, 120, 100);
    for (let y = 92; y < 100; y++) for (let x = 50; x <= 150; x++) world.land.set(x, y, Mat.Ice);
    for (let x = 0; x < 200; x++) world.land.set(x, 99, Mat.Water);
    for (let x = 20; x < 40; x++) world.land.set(x, 99, Mat.Snow);
    withWeather(world, steady(6));
    run(world, 100);
    expect(count(world.land, Mat.Snow)).toBe(0);
    expect(world.land.get(100, 92)).toBe(Mat.Ice);
    withWeather(world, steady(20));
    run(world, 400);
    expect(count(world.land, Mat.Ice)).toBe(0);
  });

  it('nothing changes between -10 and 5 degrees', () => {
    const world = flatWorld(200, 120, 90);
    lake(world, 50, 150, 90, 10);
    withWeather(world, steady(-5));
    run(world, 300);
    expect(count(world.land, Mat.Ice)).toBe(0);
  });
});

describe('Lightning', () => {
  it('zigzags down from the sky, hurts and knocks over a clonk in its way, and ends at the ground', () => {
    const world = flatWorld();
    const c = world.addClonk(300, 140, 0);
    run(world, 30);
    const w = withWeather(world, {});
    const before = c.energy;
    // Straight down onto the clonk.
    w.launchLightning(world, 300, 0, 0, 1, 10, 1);
    run(world, 30);
    expect(c.energy).toBeLessThan(before);
    expect(w.bolts).toHaveLength(0);
    expect(w.flash).toBe(0);
  });

  it('lights up the world while a bolt is out', () => {
    const world = flatWorld();
    const w = withWeather(world, {});
    w.launchLightning(world, 100, 0, -20, 41, 5, 15);
    run(world, 2);
    expect(w.flash).toBeGreaterThan(0);
  });

  it('thunderstorms of 100 strike every 10 seconds or so', () => {
    const world = flatWorld(1200);
    const w = withWeather(world, { lightning: sval(100) });
    let bolts = 0;
    for (let i = 0; i < 36 * 120; i++) {
      const n = w.bolts.length;
      run(world, 1);
      if (w.bolts.length > n) bolts++;
    }
    expect(bolts).toBeGreaterThan(5);
    expect(bolts).toBeLessThan(40);
  });
});

describe('Earthquakes', () => {
  it('shake the ground loose and knock clonks over', () => {
    const world = flatWorld(600, 300, 150);
    const clonks = [250, 280, 310, 340].map((x) => world.addClonk(x, 140, 0));
    run(world, 30);
    const w = withWeather(world, {});
    const earth = count(world.land, Mat.Earth);
    let tumbled = 0;
    let loose = 0;
    w.launchEarthquake(300, 160, 150);
    for (let i = 0; i < 120; i++) {
      run(world, 1);
      loose = Math.max(loose, world.land.pxs.count);
      tumbled += clonks.filter((c) => c.action.name === 'Tumble').length;
    }
    expect(loose).toBeGreaterThan(50);
    expect(count(world.land, Mat.Earth)).toBeLessThanOrEqual(earth);
    expect(tumbled).toBeGreaterThan(0);
    run(world, 400);
    expect(w.quakes).toHaveLength(0);
    expect(world.land.pxs.count).toBe(0);
    // What fell came back down as earth.
    expect(count(world.land, Mat.Earth)).toBeGreaterThan(earth * 0.99);
  });

  it('shake hardest halfway through', () => {
    const w = new Weather(DEFAULT_WEATHER, new Rng(1), 600);
    w.launchEarthquake(0, 0, 150);
    const q = w.quakes[0];
    const at = (t: number): number => {
      q.time = t;
      return Weather.shake(q);
    };
    expect(at(q.lifeTime / 2)).toBeGreaterThan(at(10));
    expect(at(q.lifeTime / 2)).toBeGreaterThan(at(q.lifeTime - 10));
    expect(at(q.lifeTime / 2)).toBeLessThanOrEqual(150 / 10 + 1);
  });
});

describe('Meteorites', () => {
  it('fall out of the sky and explode where they hit', () => {
    const world = flatWorld();
    withWeather(world, {});
    const m = world.spawnItem('meteor', 300, -20, 1, 0, 0.2);
    let exploded = false;
    for (let i = 0; i < 200 && !exploded; i++) {
      run(world, 1);
      exploded = world.events.some((e) => e.type === 'explosion');
      world.events.length = 0;
    }
    expect(exploded).toBe(true);
    expect(world.items).not.toContain(m);
  });

  it('come down now and then with meteorites set', () => {
    const world = flatWorld(1200);
    withWeather(world, { meteorite: sval(100) });
    let seen = 0;
    for (let i = 0; i < 36 * 120; i++) {
      run(world, 1);
      seen = Math.max(seen, world.items.filter((it) => it.def.id === 'meteor').length);
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('Scenario weather', () => {
  it('Gold Mine and Minor Melee have the original Weather values', () => {
    const [gold, melee] = SCENARIOS;
    expect(gold.weather.climate).toEqual(sval(40, 10));
    expect(gold.weather.yearSpeed).toEqual(sval(20, 10));
    expect(gold.weather.wind).toEqual(sval(1, 100, -100, 100));
    expect(gold.weather.rain.std).toBe(0);
    expect(melee.weather.climate).toEqual(sval(19));
    expect(melee.weather.startSeason).toEqual(sval(23));
    expect(melee.weather.yearSpeed.std).toBe(0);
    expect(gold.landscape.gravity).toEqual(sval(100, 0, 10, 200));
  });

  it('scenarios saved before weather existed get the original’s weather', () => {
    const old = normalizeScenario({ ...SCENARIOS[0], weather: undefined, landscape: { ...SCENARIOS[0].landscape, gravity: undefined } } as never);
    expect(old.weather).toEqual(SCENARIOS[0].weather);
    expect(old.landscape.gravity).toEqual(sval(100, 0, 10, 200));
    const wild = normalizeScenario({ ...SCENARIOS[0], weather: { ...SCENARIOS[0].weather, wind: { std: 500, rnd: 3, min: -900, max: 900 }, rain: { std: -4, rnd: 0, min: 0, max: 100 } } });
    expect(wild.weather.wind).toEqual({ std: 100, rnd: 3, min: -100, max: 100 });
    expect(wild.weather.rain.std).toBe(0);
  });

  it('a round has its scenario’s weather and gravity, the same every time for the same map', () => {
    const def = normalizeScenario({ ...SCENARIOS[0], weather: { ...SCENARIOS[0].weather, rain: sval(50) }, landscape: { ...SCENARIOS[0].landscape, gravity: sval(50) } });
    const a = startRound(def, createProfile({ profiles: [], activeId: null }, 'A'), [], 99);
    const b = startRound(def, createProfile({ profiles: [], activeId: null }, 'B'), [], 99);
    expect(a.world.land.gravity).toBeCloseTo(0.1);
    expect(a.world.weather?.clouds.length).toBeGreaterThan(0);
    for (let i = 0; i < 300; i++) {
      a.world.step(new Map());
      b.world.step(new Map());
    }
    expect(a.world.weather?.wind).toBe(b.world.weather?.wind);
    expect(a.world.land.pxs.count).toBe(b.world.land.pxs.count);
    expect(a.world.land.cells).toEqual(b.world.land.cells);
  });
});
