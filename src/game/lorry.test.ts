import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { VEHICLES, type Vehicle } from '../objects/vehicle';
import { completeStructure, construct } from './buildings';
import { PUSH_SPEED } from './vehicles';
import { World } from './world';

const GROUND = 100;

function flatWorld(): World {
  const land = new Landscape(480, 260);
  for (let y = GROUND; y < 260; y++) for (let x = 0; x < 480; x++) land.set(x, y, Mat.Earth);
  const world = new World(land, new Rng(1));
  world.addPlayer(0, { wealth: 100, stock: { lorry: 2 } });
  return world;
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}, player = 0): void {
  const controls = new Map([[player, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

const tap = (world: World, ctrl: Partial<ControlState>, player = 0): void => run(world, 1, ctrl, player);
const DOWN = { down: true, pressedDown: true };
const THROW = { pressedThrow: true };
const UP = { up: true, pressedUp: true };

/** A lorry standing on the ground at x, and a clonk holding on to it. */
function pushing(world: World, x = 150, owner = 0): { lorry: Vehicle; c: Clonk } {
  const lorry = world.addVehicle('lorry', x, GROUND - 10, owner);
  run(world, 2);
  const c = world.addClonk(x, GROUND - 10, owner);
  run(world, 10);
  tap(world, DOWN, owner);
  expect(c.vehicle).toBe(lorry);
  return { lorry, c };
}

function load(world: World, lorry: Vehicle, id: 'gold' | 'rock' | 'flint', n: number): void {
  for (let i = 0; i < n; i++) {
    const it = world.spawnItem(id, lorry.x, lorry.y);
    it.container = lorry;
    lorry.contents.push(it);
  }
}

describe('Lorry', () => {
  it('stands on its wheels (DefCore vertices) and is pushed at walking speed, slower to get going when loaded', () => {
    const world = flatWorld();
    const { lorry, c } = pushing(world);
    expect(lorry.y + 9 + 1).toBe(GROUND);
    run(world, 30, { right: true });
    expect(lorry.xdir).toBeCloseTo(PUSH_SPEED);
    expect(lorry.x).toBeGreaterThan(155);
    expect(c.action.name).toBe('Push');
    // 50 nuggets weigh 750 more: the same push speeds it up far slower.
    const empty = lorry.mass;
    load(world, lorry, 'gold', 50);
    expect(lorry.mass).toBe(empty + 50 * 15);
    run(world, 30);
    expect(lorry.xdir).toBe(0);
    tap(world, { right: true });
    expect(lorry.xdir).toBeLessThan(PUSH_SPEED / 5);
  });

  it('throw puts in what the clonk carries; with empty hands it opens the menu of what is in it', () => {
    const world = flatWorld();
    const { lorry, c } = pushing(world);
    world.give(c, 'rock');
    tap(world, THROW);
    expect(c.contents).toHaveLength(0);
    expect(lorry.contents.map((i) => i.def.id)).toEqual(['rock']);
    expect(world.events.some((e) => e.type === 'vehicle' && e.sound === 'Clonk')).toBe(true);
    // Still holding on.
    expect(c.vehicle).toBe(lorry);
    load(world, lorry, 'gold', 2);
    tap(world, THROW);
    expect(c.loadMenu).toBe(0);
    // Rock first (it went in first), then gold.
    tap(world, { pressedRight: true });
    expect(c.loadMenu).toBe(1);
    tap(world, UP);
    expect(c.loadMenu).toBeNull();
    expect(c.carrying?.def.id).toBe('gold');
    expect(c.carrying?.container).toBe(c);
    expect(lorry.contents).toHaveLength(2);
    // The load moves with the lorry.
    run(world, 20, { left: true });
    for (const it of lorry.contents) expect([it.x, it.y]).toEqual([lorry.x, lorry.y]);
  });

  it('catches what falls into its top, up to 50 things', () => {
    const world = flatWorld();
    const lorry = world.addVehicle('lorry', 150, GROUND - 10);
    run(world, 2);
    const rock = world.spawnItem('rock', 150, GROUND - 60);
    run(world, 40);
    expect(rock.container).toBe(lorry);
    // Things lying next to it on the ground stay there.
    const beside = world.spawnItem('rock', 170, GROUND - 2);
    run(world, 20);
    expect(beside.container).toBeNull();
    load(world, lorry, 'rock', 49);
    expect(lorry.full).toBe(true);
    const more = world.spawnItem('flint', 150, GROUND - 60);
    run(world, 40);
    expect(more.container).toBeNull();
    expect(lorry.contents).toHaveLength(50);
  });

  it('full, it says so when a clonk tries to put something in', () => {
    const world = flatWorld();
    const { lorry, c } = pushing(world);
    load(world, lorry, 'rock', 50);
    world.give(c, 'flint');
    world.messages.length = 0;
    tap(world, THROW);
    expect(c.carrying?.def.id).toBe('flint');
    expect(world.messages.map((m) => m.text)).toContain('Lorry is full!');
  });

  it('pushed into its own base, the gold in it is sold; it comes back out with the clonk', () => {
    const world = flatWorld();
    const hut = world.addStructure('hut', 60, GROUND - 25, 0);
    const door = hut.exitPoint().x;
    const { lorry, c } = pushing(world, door + 30);
    load(world, lorry, 'gold', 6);
    load(world, lorry, 'rock', 2);
    for (let i = 0; i < 60 && Math.abs(lorry.x - door) > 1; i++) tap(world, { left: true });
    run(world, 30);
    expect(hut.atEntrance(lorry.x, lorry.y)).toBe(true);
    const wealth = world.players.get(0)!.wealth;
    tap(world, UP);
    expect(c.contained).toBe(hut);
    expect(lorry.contained).toBe(hut);
    expect(world.players.get(0)!.wealth).toBe(wealth + 30);
    expect(lorry.contents.map((i) => i.def.id)).toEqual(['rock', 'rock']);
    run(world, 10);
    expect(lorry.contained).toBe(hut);
    // Down leaves, pushing it out again.
    tap(world, DOWN);
    expect(c.contained).toBeNull();
    expect(lorry.contained).toBeNull();
    expect(c.vehicle).toBe(lorry);
    run(world, 20, { right: true });
    expect(lorry.x).toBeGreaterThan(door + 5);
    expect(lorry.y + 10).toBe(GROUND);
  });

  it("can't be pushed into an enemy base", () => {
    const world = flatWorld();
    world.addPlayer(1);
    const hut = world.addStructure('hut', 60, GROUND - 25, 1);
    const { lorry, c } = pushing(world, hut.exitPoint().x);
    run(world, 20);
    tap(world, UP);
    expect(c.contained).toBeNull();
    expect(lorry.contained).toBeNull();
  });

  it('a lorry left in a building comes out when nobody holds it any more', () => {
    const world = flatWorld();
    const hut = world.addStructure('hut', 60, GROUND - 25, 0);
    const { lorry, c } = pushing(world, hut.exitPoint().x);
    run(world, 20);
    tap(world, UP);
    expect(lorry.contained).toBe(hut);
    c.setAction('Walk', 0, 0);
    run(world, 2);
    expect(lorry.contained).toBeNull();
    expect(world.vehicles).toContain(lorry);
  });

  it('bumps up small steps when pushed (the engine turns a bump into a hop), not high walls', () => {
    const world = flatWorld();
    // A 3 pixel step at x 180, a 30 pixel wall at x 260.
    for (let y = GROUND - 3; y < GROUND; y++) for (let x = 180; x < 480; x++) world.land.set(x, y, Mat.Earth);
    for (let y = GROUND - 33; y < GROUND - 3; y++) for (let x = 260; x < 480; x++) world.land.set(x, y, Mat.Earth);
    const { lorry } = pushing(world);
    run(world, 160, { right: true });
    expect(lorry.y + 10).toBe(GROUND - 3);
    expect(lorry.x).toBeGreaterThan(230);
    expect(lorry.x).toBeLessThan(260);
  });

  it("doesn't burn: blasts only shove it", () => {
    const world = flatWorld();
    const lorry = world.addVehicle('lorry', 150, GROUND - 10);
    run(world, 2);
    world.explode(150, GROUND - 10, 40);
    expect(lorry.fire).toBeNull();
    expect(lorry.burned).toBe(false);
  });

  it('a lit T-flint in it goes off where the lorry is', () => {
    const world = flatWorld();
    const lorry = world.addVehicle('lorry', 150, GROUND - 10);
    run(world, 2);
    const t = world.spawnItem('tflint', 150, GROUND - 60);
    run(world, 30);
    expect(t.container).toBe(lorry);
    t.light();
    run(world, 70);
    expect(t.removed).toBe(true);
    expect(lorry.contents).toHaveLength(0);
    expect(world.land.get(150, GROUND + 5)).toBe(Mat.Sky);
  });

  it('rides the elevator: pushed into the case, the clonk takes hold of the case', () => {
    const world = flatWorld();
    const s = construct(world, 'elevator', 200, GROUND, 0);
    completeStructure(world, s);
    run(world, 1);
    const k = s.liftCase!;
    const { lorry, c } = pushing(world, 160);
    load(world, lorry, 'gold', 3);
    for (let i = 0; i < 80 && lorry.x < k.x - 2; i++) tap(world, { right: true });
    run(world, 40);
    expect(lorry.x).toBe(k.x);
    expect(c.vehicle).toBeNull();
    expect(c.workOn).toBe(s);
    // Drill down; the lorry and the clonk come along.
    tap(world, { pressedDig: true });
    run(world, 36 * 4);
    tap(world, { pressedDig: true });
    expect(k.floorY).toBeGreaterThan(GROUND + 20);
    expect(lorry.y + 10).toBe(k.floorY);
    expect(c.y + 10).toBe(k.floorY);
    run(world, 60, { up: true });
    expect(k.y).toBe(k.top);
    expect(lorry.y + 10).toBe(GROUND);
    expect(lorry.contents).toHaveLength(3);
  });

  it('a home base sells it for 20 gold; it comes out of the door', () => {
    const world = flatWorld();
    const hut = world.addStructure('hut', 60, GROUND - 25, 0);
    const c = world.addClonk(hut.exitPoint().x, GROUND - 10, 0);
    run(world, 10);
    tap(world, UP);
    tap(world, UP);
    c.menu = world.shopList(0).indexOf('lorry');
    tap(world, THROW);
    expect(world.players.get(0)!.wealth).toBe(100 - VEHICLES.lorry.value);
    const lorry = world.vehicles.find((v) => v.def.id === 'lorry')!;
    run(world, 30);
    expect(lorry.y + 10).toBe(GROUND);
  });
});
