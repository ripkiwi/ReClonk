// Weather and disasters, ported from the Clonk Rage engine (C4Weather.cpp,
// C4Game::ShakeObjects) and the original content's weather objects
// (Objects.c4d/Effects.c4d: Precipitation, Lightning, Earthquake, Meteor).
// See licenses/clonk_engine_license.txt.

import type { Rng } from '../core/rng';
import { evaluate, sval, type SVal } from '../landscape/mapCreator';
import { LIQUID, MATERIALS, Mat } from '../landscape/materials';
import { CNAT } from '../objects/physics';
import type { World } from './world';

/** The Weather page of a scenario: the original's [Weather] and [Disasters] sections. */
export interface WeatherDef {
  /** 0 hot to 100 cold. The temperature swings 30 degrees around 50 minus this over a year. */
  climate: SVal;
  /** Where in the year the round starts: 0 winter, 25 spring, 50 summer, 75 autumn, 100 winter again. */
  startSeason: SVal;
  /** How fast the year goes by (YearSpeed): 50 makes a year about 6.5 minutes. */
  yearSpeed: SVal;
  /** How hard it rains from the rain clouds (snow when it's freezing). 0 is no clouds. */
  rain: SVal;
  /** Chance of lightning strikes (thunderstorms). */
  lightning: SVal;
  /** Wind from -100 (to the left) to 100 (to the right); a new wind every 1000 ticks. */
  wind: SVal;
  earthquake: SVal;
  /** Volcanoes need lava, which isn't in the game yet: kept for later. */
  volcano: SVal;
  meteorite: SVal;
  /**
   * Not on the original's Weather page: tint the world with the season, like
   * its season gamma ramps (Scenario.txt NoGamma=0).
   */
  seasonColors: boolean;
  /** Not on the original's Weather page: the sky drifts with the wind (Scenario.txt SkyScrollMode=1). */
  skyWind: boolean;
}

/** The original's defaults (C4SWeather::Default, C4SDisasters::Default). */
export const DEFAULT_WEATHER: WeatherDef = {
  climate: sval(50, 10),
  startSeason: sval(50, 50),
  yearSpeed: sval(50),
  rain: sval(0),
  lightning: sval(0),
  wind: sval(0, 70, -100, 100),
  earthquake: sval(0),
  volcano: sval(0),
  meteorite: sval(0),
  seasonColors: false,
  skyWind: false,
};

/**
 * A rain cloud (FXP1): rain or snow falls from the top of the map along its
 * width. In the original the cloud object can't move (it has no Float
 * physical), so its rain always falls in the same place; here it drifts slowly
 * with the wind instead, at the sky's speed.
 */
export interface Cloud {
  x: number;
  width: number;
  /** 0 to 100: how much falls. */
  strength: number;
}

/** A lightning bolt (FXL1) zigzagging down from the sky, one corner per tick. */
export interface Bolt {
  points: { x: number; y: number }[];
  advX: number;
  varX: number;
  advY: number;
  varY: number;
}

/** An earthquake (FXQ1): the ground shakes loose around it and clonks fall over. */
export interface Quake {
  x: number;
  y: number;
  level: number;
  /** Ticks the quake shakes for. */
  lifeTime: number;
  time: number;
  /** The view shakes along a parabola: a*t - b*t^2/100, at most level/10 pixels. */
  a: number;
  b: number;
}

/** Corners a bolt can have (C4D_MaxVertex). */
const BOLT_CORNERS = 30;
/** The seasonal temperature swing, in whole degrees for each season (TemperatureRange 30). */
const TEMPERATURE_RANGE = 30;
const SEASON_SWING = Array.from({ length: 101 }, (_, s) => Math.trunc(TEMPERATURE_RANGE * Math.cos((6.28 * s) / 100)));

const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/**
 * The weather of a round (C4Weather): seasons, temperature and wind, the rain
 * clouds, and the lightning, meteorites and earthquakes it sets off. It has
 * its own random numbers, so a world without weather plays exactly as before.
 */
export class Weather {
  /** 0 to 100 through the year: winter, spring (25), summer (50), autumn (75), winter. */
  season: number;
  readonly yearSpeed: number;
  private seasonDelay = 0;
  /** Base temperature: 50 minus the scenario's climate. */
  readonly climate: number;
  /** Degrees; follows the season by one degree every 35 ticks. Water freezes below -10. */
  temperature: number;
  wind: number;
  private targetWind: number;
  readonly lightningLevel: number;
  readonly meteoriteLevel: number;
  readonly earthquakeLevel: number;
  readonly volcanoLevel: number;
  readonly clouds: Cloud[] = [];
  bolts: Bolt[] = [];
  quakes: Quake[] = [];
  /** How bright lightning lights up the world (lgt_enlightment), and the brightness shown: 0 to 255. */
  private enlightenment = 0;
  flash = 0;
  /** How far the sky has drifted with the wind, in pixels. */
  skyX = 0;

  constructor(
    readonly def: WeatherDef,
    private readonly rng: Rng,
    width: number,
  ) {
    this.season = evaluate(def.startSeason, rng);
    this.yearSpeed = evaluate(def.yearSpeed, rng);
    this.climate = 100 - evaluate(def.climate, rng) - 50;
    this.temperature = this.climate;
    this.wind = this.targetWind = evaluate(def.wind, rng);
    // Rain clouds: one per 500 pixels of width, at most 5.
    if (evaluate(def.rain, rng)) {
      for (let i = Math.min(Math.trunc(width / 500), 5); i > 0; i--) {
        const w = Math.trunc(width / 15) + rng.int(320);
        const x = rng.int(width);
        this.clouds.push({ x, width: w, strength: evaluate(def.rain, rng) });
      }
    }
    this.lightningLevel = evaluate(def.lightning, rng);
    this.meteoriteLevel = evaluate(def.meteorite, rng);
    this.volcanoLevel = evaluate(def.volcano, rng);
    this.earthquakeLevel = evaluate(def.earthquake, rng);
  }

  /** Rain falls as snow below 0 degrees. */
  get precipitation(): Mat {
    return this.temperature < 0 ? Mat.Snow : Mat.Water;
  }

  /** The wind at a spot: none underground (C4Weather::GetWind). */
  windAt(world: World, x: number, y: number): number {
    return world.land.isTunnel(x, y) ? 0 : this.wind;
  }

  /** C4Weather::Execute, plus the weather objects' own timers. Call once per tick, before the tick counter moves on. */
  step(world: World): void {
    const t = world.tick;
    const land = world.land;
    const rng = this.rng;
    const def = this.def;
    if (t % 35 === 0) {
      this.seasonDelay += this.yearSpeed;
      if (this.seasonDelay >= 200) {
        this.seasonDelay = 0;
        this.season++;
        if (this.season > def.startSeason.max) this.season = def.startSeason.min;
      }
      const target = this.climate - SEASON_SWING[Math.max(0, Math.min(100, this.season))];
      this.temperature += sign(target - this.temperature);
    }
    if (t % 1000 === 0) this.targetWind = evaluate(def.wind, rng);
    if (t % 10 === 0) this.wind = Math.max(def.wind.min, Math.min(def.wind.max, this.wind + sign(this.targetWind - this.wind)));
    land.wind = this.wind;
    if (def.skyWind) this.skyX += this.wind / 100;

    // Disasters, rolled every 10 ticks.
    if (t % 10 === 0) {
      if (this.meteoriteLevel && !rng.int(60) && rng.int(100) < this.meteoriteLevel) {
        // In caves they come in a bit lower so they don't hit the ceiling.
        const top = land.topOpen;
        world.spawnItem('meteor', rng.int(land.width), top ? -20 : 5, (rng.int(101) - 50) / 10, top ? 0 : 2, 0.2);
      }
      if (this.lightningLevel && !rng.int(35) && rng.int(100) < this.lightningLevel) {
        this.launchLightning(world, rng.int(land.width), 0, -20, 41, 5, 15);
      }
      if (this.earthquakeLevel && !rng.int(50) && rng.int(100) < this.earthquakeLevel) {
        this.launchEarthquake(rng.int(land.width), rng.int(land.height));
      }
    }

    this.rain(world);
    this.stepBolts(world);
    this.stepQuakes(world);
    land.scanTemperature(this.temperature);
  }

  /** Every other tick each cloud drops up to three pixels of rain or snow (Precipitation.c4d). */
  private rain(world: World): void {
    if (!this.clouds.length) return;
    const land = world.land;
    const w = land.width;
    const rng = this.rng;
    for (const c of this.clouds) {
      c.x = (((c.x + this.wind / 100) % w) + w) % w;
      if (world.tick % 2) continue;
      if (rng.int(50) > c.strength) continue;
      const mat = this.precipitation;
      const x = Math.trunc(c.x);
      const vx = Math.trunc(this.windAt(world, x, 2) / 10);
      const vy = 150 - Math.trunc((Math.min(MATERIALS[mat].windDrift ?? 0, 100) * 3) / 2);
      const l = c.width;
      const drop = (a: number, b: number): void => {
        land.insertMaterial(mat, (a + rng.int(b - a + 1)) % w, 0, vx, vy);
      };
      drop(x, x + l);
      drop(x + Math.trunc(l / 3), x + Math.trunc((l * 2) / 3));
      drop(x - Math.trunc(l / 3), x + Math.trunc((l * 4) / 3));
    }
  }

  /** Lightning.c4d Activate: a bolt starts, sometimes with thunder, and lights up the world. */
  launchLightning(world: World, x: number, y: number, advX: number, varX: number, advY: number, varY: number): void {
    this.bolts.push({ points: [{ x, y }], advX, varX, advY, varY });
    if (!this.rng.int(5)) world.events.push({ type: 'thunder', x, y, tick: world.tick });
    this.enlightenment += this.rng.int(10) + 5;
  }

  /**
   * Lightning.c4d Advance: each tick a bolt gets another corner, until it
   * strikes something (liquid or solid) or runs out of corners. Past its
   * first few corners it blasts whatever it passes (BlastObjects level 5),
   * and now and then it forks.
   */
  private stepBolts(world: World): void {
    if (!this.bolts.length) {
      this.flash = 0;
      return;
    }
    const rng = this.rng;
    const land = world.land;
    const current = this.bolts;
    // Forks started this tick land in the new list and go on next tick.
    this.bolts = [];
    const alive: Bolt[] = [];
    for (const b of current) {
      const tip = b.points[b.points.length - 1];
      if (land.density(tip.x, tip.y) >= LIQUID) continue;
      if (b.points.length - 1 > 5) world.blastObjects(tip.x, tip.y, 5);
      if (!rng.int(35)) this.launchLightning(world, tip.x, tip.y, b.advX, b.varX, b.advY, b.varY);
      if (b.points.length >= BOLT_CORNERS) continue;
      b.points.push({ x: tip.x + b.advX + rng.int(b.varX), y: tip.y + b.advY + rng.int(b.varY) });
      this.enlightenment += rng.int(4) + 2;
      alive.push(b);
    }
    this.bolts = alive.concat(this.bolts);
    if (this.enlightenment > 0) {
      this.flash = Math.min(this.enlightenment * 3, 255);
      this.enlightenment = Math.max(Math.trunc((this.enlightenment * 4) / 8) - 1, 0);
    }
    if (!this.bolts.length) this.flash = 0;
  }

  /** Earthquake.c4d Activate: level 100 to 200, shaking for level/2 ticks. */
  launchEarthquake(x: number, y: number, level = 100 + this.rng.int(101)): void {
    const lifeTime = Math.trunc(level / 2);
    const a = Math.trunc((4 * 10 * level) / (10 * lifeTime));
    const b = Math.trunc((100 * a) / lifeTime);
    this.quakes.push({ x, y, level, lifeTime, time: 0, a, b });
  }

  /** How hard a quake shakes the view right now (before the distance falloff). */
  static shake(q: Quake): number {
    return Math.trunc((q.a * q.time - Math.trunc((q.b * q.time * q.time) / 100)) / 10);
  }

  /**
   * Earthquake.c4d ShakeEarth, every third tick and then only one time in
   * three: clonks nearby may fall over, and a crack of ground around the
   * quake shakes loose and falls.
   */
  private stepQuakes(world: World): void {
    if (!this.quakes.length) return;
    const rng = this.rng;
    this.quakes = this.quakes.filter((q) => {
      q.time++;
      if (q.time % 3) return true;
      if (rng.int(3)) return true;
      this.shakeObjects(world, q.x, q.y, q.level);
      const l = q.level;
      let x = q.x + rng.int(2 * l + 1) - l;
      let y = q.y + rng.int(2 * l + 1) - l;
      const sx = rng.int(7) - 3;
      const sy = rng.int(5) - 2;
      const amount = 35 + rng.int(6);
      for (let i = 1; i < amount; i++) world.land.shakeFree((x += sx), (y += sy), rng.int(15));
      return q.time <= q.lifeTime;
    });
  }

  /**
   * C4Game::ShakeObjects: a clonk standing or climbing within range falls
   * over one time in three, unless it stands on a building's basement.
   */
  private shakeObjects(world: World, x: number, y: number, range: number): void {
    for (const c of world.clonks) {
      if (!c.alive || c.contained) continue;
      if (Math.abs(y - c.y) > range || Math.abs(x - c.x) > range) continue;
      if (this.rng.int(3)) continue;
      if (c.tAttach === CNAT.None) continue;
      if (world.land.get(c.x, c.y + 10) === Mat.Basement) continue;
      c.fling(this.rng.int(3) - 1, 0);
    }
  }
}
