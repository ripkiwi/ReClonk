import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { generateMap } from '../landscape/generate';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, THROW_SPEED, type Clonk, type ControlState } from '../objects/clonk';
import { ENERGY_UNIT, ITEMS } from '../objects/defs';
import { FULL_CON, PLANTS, TREE } from '../objects/vegetation';
import { startRound } from './round';
import { SCENARIOS } from './scenarios';
import { World } from './world';
import { createProfile } from './profiles';

const emptyProfile = (name: string) => createProfile({ profiles: [], activeId: null }, name);

const GROUND = 120;

function flatWorld(w = 600, h = 260, ground = GROUND): World {
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

const tap = (world: World, ctrl: Partial<ControlState>): void => run(world, 1, ctrl);
const USE = { pressedUse: true };

function standing(world: World, x: number): Clonk {
  const c = world.addClonk(x, GROUND - 10, 0);
  run(world, 10);
  return c;
}

/** A full grown tree standing on the flat ground, its bottom 8 pixels in like the original places them. */
function tree(world: World, x = 300, id: keyof typeof PLANTS = 'tree1', con = FULL_CON) {
  return world.addPlant(id, x, GROUND + 8, con);
}

describe('T-flints and bigger flints', () => {
  it('a T-flint lights when it lands and blows up 60 ticks later, not on impact', () => {
    const world = flatWorld();
    const t = world.spawnItem('tflint', 200, GROUND - 40, 0, 3);
    run(world, 12);
    expect(t.lit).toBe(true);
    expect(world.events.some((e) => e.type === 'fuse')).toBe(true);
    expect(world.land.get(200, GROUND + 2)).toBe(Mat.Earth);
    const litAt = world.tick;
    while (!t.removed && world.tick < litAt + 100) run(world, 1);
    expect(t.removed).toBe(true);
    expect(world.tick - litAt).toBeGreaterThan(50);
    expect(world.tick - litAt).toBeLessThanOrEqual(61);
    // The blast made a hole.
    expect(world.land.get(200, GROUND + 2)).toBe(Mat.Sky);
  });

  it('a super T-flint has a fuse twice as long', () => {
    expect(ITEMS.supertflint.fuse).toEqual({ ticks: 120, explode: 27 });
    expect(ITEMS.tflint.fuse).toEqual({ ticks: 60, explode: 20 });
  });

  it('double dig lights a T-flint in hand; it goes off there and hurts whoever holds it', () => {
    const world = flatWorld();
    const c = standing(world, 200);
    const t = world.give(c, 'tflint')!;
    tap(world, USE);
    expect(t.lit).toBe(true);
    expect(c.carrying).toBe(t);
    const before = c.energy;
    run(world, 61);
    expect(t.removed).toBe(true);
    expect(c.carrying).toBeUndefined();
    expect(c.energy).toBeLessThan(before - 10 * ENERGY_UNIT);
  });

  it('a lit T-flint can be thrown and still goes off on time', () => {
    const world = flatWorld();
    const c = standing(world, 200);
    const t = world.give(c, 'tflint')!;
    tap(world, USE);
    tap(world, { pressedThrow: true });
    expect(t.container).toBeNull();
    expect(t.xdir).toBeCloseTo(THROW_SPEED * c.dir);
    run(world, 60);
    expect(t.removed).toBe(true);
  });

  it('super and tera flints blast bigger holes', () => {
    const hole = (id: 'flint' | 'superflint' | 'teraflint'): number => {
      const world = flatWorld();
      world.spawnItem(id, 300, GROUND - 30, 0, 3);
      run(world, 15);
      let n = 0;
      for (let y = GROUND; y < GROUND + 60; y++) for (let x = 240; x < 360; x++) if (world.land.get(x, y) === Mat.Sky) n++;
      return n;
    };
    const flint = hole('flint');
    const superflint = hole('superflint');
    const tera = hole('teraflint');
    expect(flint).toBeGreaterThan(0);
    expect(superflint).toBeGreaterThan(flint * 2);
    expect(tera).toBeGreaterThan(superflint * 1.5);
  });
});

describe('Trees', () => {
  it('a clonk chops a tree down with a double dig: 10 damage every 30 ticks until it falls', () => {
    const world = flatWorld();
    const p = tree(world);
    const c = standing(world, 290);
    tap(world, USE);
    expect(c.action.name).toBe('Chop');
    // 150 strength: the 16th hit fells it, about 15 seconds of chopping.
    run(world, TREE.chopInterval * 14);
    expect(p.state).toBe('standing');
    run(world, TREE.chopInterval * 2 + 1);
    expect(p.state).not.toBe('standing');
    expect(c.action.name).toBe('Walk');
    // It falls away from the clonk, and lands.
    run(world, 80);
    expect(p.state).toBe('fallen');
    expect(p.r).toBeGreaterThan(45);
  });

  it('the first dig at a tree waits for the second press instead of digging a hole', () => {
    const world = flatWorld();
    tree(world);
    const c = standing(world, 290);
    tap(world, { pressedDig: true });
    expect(c.action.name).toBe('Dig');
    run(world, 4);
    tap(world, USE);
    expect(c.action.name).toBe('Chop');
    expect(world.land.get(c.x, GROUND + 1)).toBe(Mat.Earth);
  });

  it('moving stops the chopping', () => {
    const world = flatWorld();
    tree(world);
    const c = standing(world, 290);
    tap(world, USE);
    tap(world, { left: true, pressedLeft: true });
    expect(c.action.name).toBe('Walk');
  });

  it('a felled tree is chopped into its wood, one piece at a time, and is gone after the last', () => {
    const world = flatWorld();
    const p = tree(world);
    p.chopDown(1);
    run(world, 80);
    expect(p.state).toBe('fallen');
    expect(p.wood).toBe(PLANTS.tree1.wood);
    // Stand on the trunk.
    const mid = p.trunkPoint(0.5);
    const c = standing(world, Math.round(mid.x));
    tap(world, USE);
    expect(c.action.name).toBe('Chop');
    run(world, TREE.chopInterval * PLANTS.tree1.wood + 2);
    expect(world.plants).not.toContain(p);
    // All of it is lying around, or one piece is in the clonk's hands.
    expect(world.items.filter((i) => i.def.id === 'wood').length).toBe(PLANTS.tree1.wood);
    expect(c.action.name).toBe('Walk');
  });

  it('a half grown tree is quicker to fell and has less wood', () => {
    const world = flatWorld();
    const p = tree(world, 300, 'tree1', FULL_CON / 2);
    expect(p.fellDamage).toBe(75);
    p.chopDown(-1);
    expect(p.wood).toBe(3);
  });

  it('flints damage trees they hit, and enough blasts fell them', () => {
    const world = flatWorld();
    const p = tree(world, 300, 'bush');
    // A bush has 40 strength: three flints.
    for (let i = 0; i < 2; i++) world.explode(300, GROUND - 4, 18);
    expect(p.state).toBe('standing');
    world.explode(300, GROUND - 4, 18);
    expect(p.state).toBe('falling');
  });

  it('a tree whose ground is blasted away falls over', () => {
    const world = flatWorld();
    const p = tree(world);
    for (let y = GROUND - 2; y < GROUND + 30; y++) for (let x = 290; x < 310; x++) world.land.set(x, y, Mat.Sky);
    run(world, TREE.growthInterval + 1);
    expect(p.state).not.toBe('standing');
  });

  it('trees grow by their Growth every 35 ticks, from the bottom up', () => {
    const world = flatWorld();
    const p = tree(world, 300, 'tree2', 1000);
    const top0 = p.shape.y;
    run(world, TREE.growthInterval * 10);
    expect(p.con).toBe(1000 + 10 * PLANTS.tree2.growth * 100);
    expect(p.bottom).toBe(GROUND + 8);
    expect(p.shape.y).toBeLessThan(top0);
  });

  it('a tree seeds a tiny new one of its kind nearby, on soil', () => {
    const world = flatWorld();
    const p = tree(world);
    const kid = world.reproduce(p);
    expect(kid).not.toBeNull();
    expect(kid!.def.id).toBe('tree1');
    expect(kid!.con).toBe(TREE.seedlingCon);
    expect(Math.abs(kid!.x - p.x)).toBeLessThanOrEqual(TREE.reproductionArea / 2);
    expect(kid!.bottom).toBe(GROUND + 8);
  });

  it("no more seedlings once 40 trees stand around", () => {
    const world = flatWorld();
    for (let i = 0; i < 40; i++) tree(world, 100 + i * 10, 'tree2');
    expect(world.reproduce(world.plants[20])).toBeNull();
  });
});

describe('Vegetation in the scenarios', () => {
  it('Gold Mine has trees and grass, the same ones for the same map', () => {
    const gm = SCENARIOS.find((s) => s.id === 'goldmine')!;
    const a = generateMap(gm.landscape, 7);
    const b = generateMap(gm.landscape, 7);
    expect(a.plants.length).toBeGreaterThan(3);
    expect(a.grass.length).toBeGreaterThan(10);
    expect(a.plants).toEqual(b.plants);
    for (const p of a.plants) {
      expect(['tree1', 'tree2', 'tree3', 'tree4']).toContain(p.id);
      // Rooted in earth or sand.
      expect([Mat.Earth, Mat.Sand]).toContain(a.land.get(p.x, p.bottom - 5));
    }
  });

  it('trees and grass don’t change the rest of the map', () => {
    const gm = SCENARIOS[0];
    const a = generateMap(gm.landscape, 11);
    const b = generateMap({ ...gm.landscape, vegetation: {}, grass: false }, 11);
    expect(b.plants).toEqual([]);
    expect(b.grass).toEqual([]);
    expect(a.items).toEqual(b.items);
    expect(a.land.cells).toEqual(b.land.cells);
  });

  it('the home base hut stands in a clearing', () => {
    const gm = SCENARIOS[0];
    const round = startRound(gm, emptyProfile('Test'), [], 5);
    const hut = round.world.structures.find((s) => s.base === 0)!;
    for (const p of round.world.plants) {
      const s = p.shape;
      expect(s.x + s.w <= hut.left - 4 || s.x >= hut.left + hut.def.width + 4).toBe(true);
    }
  });

  it('a blast blows the grass around it away', () => {
    const gm = SCENARIOS[0];
    const round = startRound(gm, emptyProfile('Test'), [], 5);
    const w = round.world;
    const g = w.grass[Math.floor(w.grass.length / 2)];
    const n = w.grass.length;
    w.explode(g.x, g.y, 18);
    expect(w.grass.includes(g) && !g.removed).toBe(false);
    w.step(new Map());
    expect(w.grass.length).toBeLessThan(n);
  });
});
