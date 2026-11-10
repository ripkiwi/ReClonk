import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { VEHICLES, type Vehicle, type VehicleId } from '../objects/vehicle';
import { comDirTransform, PUSH_SPEED } from './vehicles';
import type { Weather } from './weather';
import { World } from './world';

const GROUND = 100;
/** The lake: from x 200 to 380, its top at y 105, 65 deep. */
const LAKE = { x0: 200, x1: 380, top: 105, bottom: 170 };

function lakeWorld(wind = 0): World {
  const land = new Landscape(480, 260);
  for (let y = GROUND; y < 260; y++) for (let x = 0; x < 480; x++) land.set(x, y, Mat.Earth);
  for (let y = GROUND; y < LAKE.bottom; y++) {
    for (let x = LAKE.x0; x < LAKE.x1; x++) land.set(x, y, y < LAKE.top ? Mat.Sky : Mat.Water);
  }
  const world = new World(land, new Rng(1));
  world.weather = { windAt: () => wind, step: () => {} } as unknown as Weather;
  world.addPlayer(0, { wealth: 200, stock: { boat: 1, balloon: 1, blimp: 1 } });
  return world;
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

const tap = (world: World, ctrl: Partial<ControlState>): void => run(world, 1, ctrl);

/** A vehicle standing on the ground (its lowest vertex one pixel above it). */
function onGround(world: World, id: VehicleId, x: number): Vehicle {
  const bottom = Math.max(...VEHICLES[id].vertices.map((v) => v.y));
  const v = world.addVehicle(id, x, GROUND - 1 - bottom, 0);
  run(world, 2);
  return v;
}

/** A clonk standing at x on whatever is there. */
function clonkAt(world: World, x: number, y = GROUND - 10): Clonk {
  const c = world.addClonk(x, y, 0);
  run(world, 10);
  return c;
}

function grab(world: World, c: Clonk): void {
  tap(world, { down: true, pressedDown: true });
  expect(c.vehicle).not.toBeNull();
}

describe('Sailboat', () => {
  it('is pushed into the water, floats at the top of it and sets sail', () => {
    const world = lakeWorld();
    const boat = onGround(world, 'boat', 150);
    const c = clonkAt(world, 140);
    grab(world, c);
    expect(c.action.name).toBe('Push');
    // Pushing it along walks it at the clonk's walking speed.
    run(world, 20, { right: true });
    expect(boat.xdir).toBeCloseTo(PUSH_SPEED);
    expect(boat.x).toBeGreaterThan(160);
    // The clonk walks behind it, inside its width.
    expect(c.x).toBeGreaterThanOrEqual(boat.left - 3);
    run(world, 120, { right: true });
    // Into the lake: the clonk swims (and lets go), the boat floats.
    expect(c.vehicle).toBeNull();
    run(world, 120);
    expect(['LowerSail', 'Sailing']).toContain(boat.action);
    run(world, 40);
    expect(boat.action).toBe('Sailing');
    // DefCore Float=19: the pixel 18 below its centre is the lake's top row.
    expect(boat.y + 18).toBe(LAKE.top);
    // The deck is in the landscape.
    expect(boat.floorY).not.toBeNull();
    expect(world.land.get(boat.x, boat.floorY!)).toBe(Mat.Basement);
  });

  it('sails where its pilot steers, carrying the crew on its deck; double up raises the sail', () => {
    const world = lakeWorld();
    const boat = world.addVehicle('boat', 260, LAKE.top - 18, 0);
    run(world, 40);
    expect(boat.action).toBe('Sailing');
    // On deck, feet on its floor.
    const c = world.addClonk(boat.x, boat.floorY! - 10, 0);
    run(world, 5);
    grab(world, c);
    const x0 = boat.x;
    run(world, 60, { right: true });
    // Wind2Sail: every 20 ticks 7 + wind/20 tenths a tick (without wind 0.7), slowed by the water in between.
    expect(boat.xdir).toBeGreaterThan(0.3);
    expect(boat.xdir).toBeLessThanOrEqual(0.7);
    expect(boat.x).toBeGreaterThan(x0 + 25);
    // The clonk went along on the deck.
    expect(c.y + 10).toBe(boat.floorY);
    expect(Math.abs(c.x - boat.x)).toBeLessThan(18);
    // Without a pilot it drifts with the wind (none here): it stops.
    tap(world, { up: true, pressedUp: true });
    run(world, 3);
    tap(world, { up: true, pressedUp: true });
    expect(boat.action).toBe('RaiseSail');
    run(world, 12);
    expect(boat.action).toBe('JustLanded');
    expect(boat.floorY).toBeNull();
    expect(c.vehicle).toBeNull();
  });

  it('drifts with the wind when nobody steers', () => {
    const world = lakeWorld(40);
    const boat = world.addVehicle('boat', 260, LAKE.top - 18, 0);
    run(world, 80);
    expect(boat.action).toBe('Sailing');
    // wind 40 → wind_push 10 → 1 pixel a tick every 20 ticks, slowed by the water in between.
    expect(boat.xdir).toBeGreaterThan(0.6);
    expect(boat.xdir).toBeLessThanOrEqual(1);
  });
});

describe('Balloon', () => {
  /** A balloon on the ground with a clonk in its basket holding on. */
  function manned(world: World): { b: Vehicle; c: Clonk } {
    const b = onGround(world, 'balloon', 100);
    const c = world.addClonk(b.x, b.floorY! - 10, 0);
    run(world, 5);
    expect(c.y + 10).toBe(b.floorY);
    grab(world, c);
    return { b, c };
  }

  it('rises with up held, taking its pilot along, at 1 pixel a tick at most', () => {
    const world = lakeWorld();
    const { b, c } = manned(world);
    const y0 = b.y;
    run(world, 60, { up: true });
    expect(b.ydir).toBeCloseTo(-1);
    expect(b.y).toBeLessThan(y0 - 40);
    expect(c.y + 10).toBe(b.floorY);
    expect(c.vehicle).toBe(b);
  });

  it('stops and bobs when the keys are let go, and sinks without a pilot', () => {
    const world = lakeWorld();
    const { b, c } = manned(world);
    run(world, 40, { up: true });
    run(world, 40);
    expect(b.comDir).toEqual({ x: 0, y: 0 });
    expect(Math.abs(b.ydir)).toBeLessThanOrEqual(0.3);
    const y = b.y;
    // Let go: it sinks (Wind2Float sets ComDir down without a pilot).
    tap(world, { doubleDown: true, pressedDown: true, down: true });
    expect(c.vehicle).toBeNull();
    run(world, 60);
    expect(b.y).toBeGreaterThan(y);
  });

  it('drifts with the wind in the air', () => {
    const world = lakeWorld(-40);
    const { b } = manned(world);
    run(world, 40, { up: true });
    // Wind2Float: wind/4 tenths, at most 1 pixel a tick.
    expect(b.xdir).toBeCloseTo(-1);
  });

  it('lands on water and waits there until told to go up', () => {
    const world = lakeWorld();
    const b = world.addVehicle('balloon', 290, 40, 0);
    run(world, 150);
    expect(b.action).toBe('WaterLand');
    // Float=22: it sits in the lake.
    expect(b.y + 21).toBe(LAKE.top);
  });

  it('burns from a blast and falls; its pilot lets go', () => {
    const world = lakeWorld();
    const { b, c } = manned(world);
    run(world, 60, { up: true });
    const y = b.y;
    // A tera-flint's blast (40) in the basket is more than its BlastIncinerate (35).
    // The burned balloon can be pushed (Grab=1), so the shock wave flings it first.
    world.explode(b.x, b.y + 15, 40);
    expect(b.burned).toBe(true);
    expect(b.fire).not.toBeNull();
    expect(c.vehicle).toBeNull();
    run(world, 120);
    expect(b.y).toBeGreaterThan(y + 5);
  });

  it("isn't shoved by blasts while it flies (only pushable vehicles are)", () => {
    const world = lakeWorld();
    const { b } = manned(world);
    run(world, 60, { up: true });
    world.explode(b.x + 30, b.y, 20);
    expect(b.burned).toBe(false);
    expect(Math.abs(b.xdir)).toBeLessThanOrEqual(1);
  });
});

describe('Blimp', () => {
  it('turns round to fly the other way, carrying its pilot to the other side', () => {
    const world = lakeWorld();
    const p = onGround(world, 'blimp', 100);
    expect(p.dir).toBe(-1);
    const c = world.addClonk(p.x - 10, p.floorY! - 10, 0);
    run(world, 5);
    grab(world, c);
    run(world, 30, { up: true });
    const dx = c.x - p.x;
    tap(world, { right: true, pressedRight: true, up: true });
    expect(p.action).toBe('Turn');
    expect(p.dir).toBe(1);
    run(world, 52, { right: true, up: true });
    expect(p.action).toBe('FloatPropel');
    expect(c.x - p.x).toBe(-dx);
    run(world, 30, { right: true });
    expect(p.xdir).toBeCloseTo(1);
    expect(c.y + 10).toBe(p.floorY);
  });

  it('classic keys turn its direction one step per press', () => {
    expect(comDirTransform({ x: 0, y: 0 }, { x: 0, y: -1 })).toEqual({ x: 0, y: -1 });
    expect(comDirTransform({ x: 0, y: -1 }, { x: 1, y: 0 })).toEqual({ x: 1, y: -1 });
    expect(comDirTransform({ x: 1, y: -1 }, { x: 1, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(comDirTransform({ x: 0, y: -1 }, { x: 0, y: 1 })).toEqual({ x: 0, y: 0 });
  });
});

describe('Buying vehicles', () => {
  it('a home base sells them: they come out of the door', () => {
    const world = lakeWorld();
    const hut = world.addStructure('hut', 60, GROUND - 25, 0);
    const c = clonkAt(world, hut.exitPoint().x);
    tap(world, { up: true, pressedUp: true });
    expect(c.contained).toBe(hut);
    tap(world, { up: true, pressedUp: true });
    const list = world.shopList(0);
    c.menu = list.indexOf('balloon');
    tap(world, { pressedThrow: true });
    const p = world.players.get(0)!;
    expect(p.wealth).toBe(150);
    expect(p.stock.balloon).toBe(0);
    expect(world.vehicles).toHaveLength(1);
    const b = world.vehicles[0];
    expect(b.def.id).toBe('balloon');
    expect(b.owner).toBe(0);
    run(world, 30);
    expect(Math.abs(b.x - hut.exitPoint().x)).toBeLessThan(3);
    expect(b.y + 21).toBeLessThan(GROUND);
  });
});
