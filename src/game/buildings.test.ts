import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { BUILD_PLANS, CONSTRUCTION, ELEVATOR_CASE, STRUCTURES } from '../objects/defs';
import type { Structure } from '../objects/structure';
import { buildRate, completeStructure, construct, raiseTerrain, siteProblem } from './buildings';
import { World } from './world';

const GROUND = 100;

function flatWorld(w = 400, h = 260, ground = GROUND): World {
  const land = new Landscape(w, h);
  for (let y = ground; y < h; y++) for (let x = 0; x < w; x++) land.set(x, y, Mat.Earth);
  const world = new World(land, new Rng(1));
  world.addPlayer(0, { wealth: 100, stock: { conkit: 5 } });
  return world;
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

const tap = (world: World, ctrl: Partial<ControlState>): void => run(world, 1, ctrl);
const USE = { pressedUse: true };
const RIGHT = { pressedRight: true };
const DOWN = { down: true, pressedDown: true };
const DIG = { pressedDig: true };

/** A clonk standing on the ground at x, holding a construction kit. */
function withKit(world: World, x = 200): Clonk {
  const c = world.addClonk(x, GROUND - 10, 0);
  run(world, 10);
  world.give(c, 'conkit');
  return c;
}

/** Finish a building right away. */
function built(world: World, id: string, x: number): Structure {
  const s = construct(world, id, x, GROUND, 0);
  completeStructure(world, s);
  run(world, 1);
  return s;
}

describe('Construction kits', () => {
  it('double dig opens the build menu; choosing a building puts up a site and starts building', () => {
    const world = flatWorld();
    const c = withKit(world);
    tap(world, USE);
    expect(c.buildMenu).toBe(0);
    tap(world, RIGHT);
    expect(BUILD_PLANS[c.buildMenu!]).toBe('elevator');
    tap(world, { pressedThrow: true });
    expect(c.buildMenu).toBeNull();
    const s = world.structures[0];
    expect(s.def.id).toBe('elevator');
    expect(s.complete).toBe(false);
    expect(s.top + s.def.height).toBe(GROUND);
    expect(c.carrying).toBeUndefined();
    expect(c.action.name).toBe('Build');
  });

  it("the first press of a double dig doesn't break ground while holding a kit", () => {
    const world = flatWorld();
    const c = withKit(world);
    tap(world, DIG);
    expect(c.action.name).toBe('Dig');
    run(world, 4);
    tap(world, USE);
    expect(c.buildMenu).toBe(0);
    expect(c.action.name).toBe('Walk');
    expect(world.land.get(c.x, GROUND)).toBe(Mat.Earth);
    expect(siteProblem(world, 'elevator', c.x, c.y + 10)).toBeNull();
    // Without a second press it digs as usual.
    tap(world, { pressedDig: true });
    tap(world, DIG);
    run(world, 30);
    expect(world.land.get(c.x, GROUND + 2)).toBe(Mat.Sky);
  });

  it('the building grows while the clonk works on it, and is done after con 100000', () => {
    const world = flatWorld();
    const c = withKit(world);
    const s = world.placeSite(c, 'hut')!;
    const ticks = Math.ceil(CONSTRUCTION.fullCon / buildRate('hut'));
    // About 18 seconds for a wooden hut, like the original.
    expect(ticks / 36).toBeGreaterThan(17);
    expect(ticks / 36).toBeLessThan(20);
    run(world, ticks - 5);
    expect(s.complete).toBe(false);
    run(world, 10);
    expect(s.complete).toBe(true);
    expect(c.action.name).toBe('Walk');
  });

  it('walking away stops the work; down at the site carries on', () => {
    const world = flatWorld();
    const c = withKit(world);
    const s = world.placeSite(c, 'hut')!;
    run(world, 20);
    run(world, 3, { right: true, pressedRight: true });
    expect(c.action.name).toBe('Walk');
    const con = s.con;
    run(world, 20);
    expect(s.con).toBe(con);
    tap(world, DOWN);
    expect(c.action.name).toBe('Build');
    run(world, 10);
    expect(s.con).toBeGreaterThan(con);
  });

  it('needs room and level ground, and no other building in the way', () => {
    const world = flatWorld();
    expect(siteProblem(world, 'tower', 200, GROUND)).toBeNull();
    // A cliff under half the site.
    for (let y = GROUND; y < GROUND + 30; y++) for (let x = 185; x < 260; x++) world.land.set(x, y, Mat.Sky);
    expect(siteProblem(world, 'tower', 200, GROUND)).toMatch(/level/);
    // A rock in the way.
    for (let y = GROUND - 40; y < GROUND; y++) for (let x = 90; x < 110; x++) world.land.set(x, y, Mat.Rock);
    expect(siteProblem(world, 'elevator', 100, GROUND)).toMatch(/room/);
    construct(world, 'hut', 320, GROUND, 0);
    expect(siteProblem(world, 'elevator', 300, GROUND)).toMatch(/Wooden Hut/);
    // Without a kit nothing happens; with one, the clonk is told what's wrong.
    const c = withKit(world, 300);
    expect(world.placeSite(c, 'elevator')).toBeNull();
    expect(c.carrying?.def.id).toBe('conkit');
    expect(world.messages.at(-1)?.text).toMatch(/Wooden Hut/);
  });

  it('fills small dips in the ground under a new building (RaiseTerrain)', () => {
    const world = flatWorld();
    // Slightly skewed ground: a dip 6 deep on one side, a 25 deep hole on the other.
    for (let x = 190; x < 200; x++) for (let y = GROUND; y < GROUND + 6; y++) world.land.set(x, y, Mat.Sky);
    for (let x = 205; x < 207; x++) for (let y = GROUND; y < GROUND + 25; y++) world.land.set(x, y, Mat.Sky);
    raiseTerrain(world.land, 186, GROUND, 28);
    for (let x = 190; x < 200; x++) for (let y = GROUND; y < GROUND + 6; y++) expect(world.land.get(x, y)).toBe(Mat.Earth);
    // Too deep to fill.
    expect(world.land.get(205, GROUND + 3)).toBe(Mat.Sky);
  });

  it('an elevator has no basement; a hut and a guard tower have one', () => {
    const world = flatWorld();
    const e = construct(world, 'elevator', 60, GROUND, 0);
    const h = construct(world, 'hut', 160, GROUND, 0);
    const t = construct(world, 'tower', 300, GROUND, 0);
    expect(e.basement).toBeNull();
    expect(world.land.get(60, GROUND)).toBe(Mat.Earth);
    expect(h.basement?.w).toBe(60);
    expect(t.basement?.w).toBe(48);
    expect(world.land.get(300, GROUND)).toBe(Mat.Basement);
  });
});

describe('Elevator', () => {
  /** A finished elevator at x=200 with a clonk standing in its case. */
  function inCase() {
    const world = flatWorld();
    const s = built(world, 'elevator', 200);
    const k = s.liftCase!;
    const c = world.addClonk(200, k.floorY - 10, 0);
    run(world, 5);
    return { world, s, k, c };
  }

  it('the case hangs at the bottom with its floor level with the ground', () => {
    const { k, c } = inCase();
    expect(k.floorY).toBe(GROUND);
    expect(c.y + 10).toBe(GROUND);
    expect(c.action.name).toBe('Walk');
  });

  it('down grabs the case; dig drills a shaft through earth and stops at rock', () => {
    const { world, k, c } = inCase();
    // Rock 60 pixels down.
    for (let y = GROUND + 60; y < GROUND + 70; y++) for (let x = 150; x < 250; x++) world.land.set(x, y, Mat.Rock);
    tap(world, DOWN);
    expect(c.action.name).toBe('Push');
    // Down alone can't go anywhere: there's no shaft yet.
    run(world, 10, { down: true });
    expect(k.y).toBe(k.top);
    tap(world, DIG);
    expect(k.mode).toBe('drill');
    run(world, 36 * 8);
    expect(k.mode).toBe('wait');
    expect(k.floorY + ELEVATOR_CASE.floor.h).toBe(GROUND + 60);
    // The clonk rode down with it.
    expect(c.y + 10).toBe(k.floorY);
    // The shaft is open, a tunnel.
    expect(world.land.get(200, GROUND + 20)).toBe(Mat.Sky);
    expect(world.land.isTunnel(200, GROUND + 20)).toBe(true);
    // Holding up rides back up; letting go stops it.
    run(world, 10, { up: true });
    const y = k.y;
    expect(y).toBeLessThan(k.top + 58);
    run(world, 5);
    expect(k.y).toBe(y);
    run(world, 60, { up: true });
    expect(k.y).toBe(k.top);
    expect(c.y + 10).toBe(GROUND);
    // Left lets go and walks off.
    tap(world, { left: true, pressedLeft: true });
    expect(c.action.name).toBe('Walk');
  });

  it('comes to a clonk waiting at the shaft', () => {
    const { world, k, c } = inCase();
    tap(world, DOWN);
    tap(world, DIG);
    run(world, 36 * 6);
    tap(world, DIG);
    const bottom = k.y;
    expect(bottom).toBeGreaterThan(k.top + 50);
    // Get off at the bottom and up to the top by other means; the case is called back up.
    tap(world, { left: true, pressedLeft: true });
    c.setPosition(170, GROUND - 10);
    c.setAction('Walk', 0, 0);
    run(world, 36 * 4);
    expect(k.y).toBe(k.top);
  });

  it("an enemy can't work it", () => {
    const { world, k } = inCase();
    world.addPlayer(1);
    world.clonks.splice(0, 1);
    const e = world.addClonk(200, k.floorY - 10, 1);
    for (let i = 0; i < 5; i++) world.step(new Map());
    world.step(new Map([[1, { ...NO_CONTROL, pressedDown: true, down: true }]]));
    world.step(new Map([[1, { ...NO_CONTROL, pressedDig: true }]]));
    expect(e.action.name).toBe('Push');
    expect(k.mode).toBe('wait');
  });
});

describe('Guard tower', () => {
  it('stands on a 48 pixel stone basement, with walls and a roof platform', () => {
    const world = flatWorld();
    const t = built(world, 'tower', 200);
    expect(t.def.name).toBe('Guard Tower');
    expect(STRUCTURES.tower.basement?.width).toBe(48);
    // Roof platform and walls are solid, the hall between them isn't.
    expect(world.land.isSolid(200, t.y - 18)).toBe(true);
    expect(world.land.isSolid(t.x - 19, t.y)).toBe(true);
    expect(world.land.isSolid(200, t.y)).toBe(false);
  });

  it('going in through the door puts the clonk on the roof', () => {
    const world = flatWorld();
    const t = built(world, 'tower', 200);
    const p = t.exitPoint();
    const c = world.addClonk(p.x, p.y, 0);
    run(world, 10);
    tap(world, { pressedUp: true });
    expect(c.contained).toBe(t);
    run(world, 45);
    expect(c.contained).toBeNull();
    run(world, 10);
    expect(c.action.name).toBe('Walk');
    expect(c.y + 10).toBe(t.top + 12);
  });

  it('its gates open when it is finished; holding on to it, left and right shut and open them', () => {
    const world = flatWorld();
    const t = built(world, 'tower', 200);
    run(world, 60);
    const [left, right] = t.gates;
    // Open: pushed up against the roof platform.
    expect(left.y).toBe(t.y - 2);
    expect(right.y).toBe(t.y - 2);
    const c = world.addClonk(200, GROUND - 10, 0);
    run(world, 10);
    tap(world, DOWN);
    expect(c.action.name).toBe('Push');
    tap(world, { pressedLeft: true });
    run(world, 60);
    // Shut: down on the basement.
    expect(left.y).toBe(t.y + 20);
    expect(right.y).toBe(t.y - 2);
    expect(world.land.isSolid(t.x - 19, GROUND - 5)).toBe(true);
    tap(world, { pressedLeft: true });
    run(world, 60);
    expect(left.y).toBe(t.y - 2);
    expect(world.land.isSolid(t.x - 19, GROUND - 5)).toBe(false);
  });

  it('a shut gate keeps clonks out', () => {
    const world = flatWorld();
    const t = built(world, 'tower', 200);
    run(world, 60);
    t.gates[0].dir = 1;
    run(world, 60);
    const c = world.addClonk(150, GROUND - 10, 0);
    run(world, 36 * 3, { right: true });
    expect(c.x).toBeLessThan(t.x - 20);
  });
});
