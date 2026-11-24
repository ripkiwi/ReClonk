import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type ControlState } from '../objects/clonk';
import { BUILD_PLANS, CONSTRUCTION, STRUCTURES } from '../objects/defs';
import type { Structure } from '../objects/structure';
import { breakApart, completeStructure, construct, IGLOO, siteProblem, stepBuildings } from './buildings';
import { World } from './world';

const GROUND = 200;

function flatWorld(w = 600, h = 320): World {
  const land = new Landscape(w, h);
  for (let y = GROUND; y < h; y++) for (let x = 0; x < w; x++) land.set(x, y, Mat.Earth);
  const world = new World(land, new Rng(1));
  world.addPlayer(0, { wealth: 100, stock: {} });
  world.addPlayer(1, { wealth: 100, stock: {} });
  return world;
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }], [1, { ...NO_CONTROL }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}
const tap = (world: World, ctrl: Partial<ControlState>): void => run(world, 1, ctrl);

function built(world: World, id: string, x: number, owner = 0): Structure {
  const s = construct(world, id, x, GROUND, owner);
  completeStructure(world, s);
  run(world, 1);
  return s;
}

describe('All the buildings', () => {
  it('every construction plan can be put up on flat ground and finished, with its basement', () => {
    for (const id of BUILD_PLANS) {
      const world = flatWorld();
      expect(siteProblem(world, id, 300, GROUND)).toBeNull();
      const s = construct(world, id, 300, GROUND, 0);
      expect(s.top + s.def.height).toBe(GROUND);
      expect(s.con).toBe(0);
      completeStructure(world, s);
      expect(s.complete).toBe(true);
      if (s.def.basement) expect(world.land.get(300, GROUND + 1)).toBe(Mat.Basement);
    }
  });

  it('homes are the original ones that can carry a flag (DefCore Base=1)', () => {
    const homes = Object.values(STRUCTURES).filter((d) => d.canBeBase).map((d) => d.id).sort();
    expect(homes).toEqual(['bambooHut', 'cabin', 'castle', 'darkCastle', 'hut', 'igloo', 'smallCastle'].sort());
  });

  it('a flag carried into a castle makes it a home base', () => {
    const world = flatWorld();
    const s = built(world, 'smallCastle', 300);
    const p = s.exitPoint();
    const c = world.addClonk(p.x, p.y, 0);
    run(world, 10);
    world.give(c, 'flag')!.owner = 0;
    tap(world, { pressedUp: true });
    expect(c.contained).toBe(s);
    tap(world, { pressedThrow: true });
    expect(s.base).toBe(0);
  });
});

describe('Guard tower roof', () => {
  it('up (jump) on the roof goes back in and out of the door at the bottom', () => {
    const world = flatWorld();
    const t = built(world, 'tower', 300);
    const p = t.exitPoint();
    const c = world.addClonk(p.x, p.y, 0);
    run(world, 10);
    tap(world, { pressedUp: true });
    run(world, 45);
    expect(c.contained).toBeNull();
    expect(c.y + 10).toBe(t.top + 12);
    // On the roof: up goes down through the tower and out of the door.
    tap(world, { pressedUp: true, up: true });
    expect(c.contained).toBeNull();
    expect(t.atEntrance(c.x, c.y)).toBe(true);
    run(world, 60);
    expect(c.contained).toBeNull();
    expect(c.y + 10).toBe(GROUND);
  });

  it('the railing over the way down is drawn on the roof', () => {
    expect(STRUCTURES.tower.hatches).toHaveLength(1);
  });
});

describe('Castles', () => {
  it('a castle gets its small tower; going into the tower puts the clonk on its platform', () => {
    const world = flatWorld();
    const s = built(world, 'castle', 300);
    const tower = world.structures.find((o) => o.def.id === 'smallTower')!;
    expect(tower.annexOf).toBe(s);
    expect(tower.top + tower.def.height).toBe(s.top + s.def.height);
    // The castle's wall walkway and the tower platform are level.
    expect(world.land.isSolid(s.x, s.y + 12)).toBe(true);
    const p = tower.exitPoint();
    const c = world.addClonk(p.x, p.y, 0);
    run(world, 10);
    tap(world, { pressedUp: true });
    expect(c.contained).toBe(tower);
    run(world, 45);
    expect(c.contained).toBeNull();
    run(world, 10);
    expect(c.y + 10).toBe(tower.top + 10);
  });

  it('dark castle: left and right lead up onto its platforms, up there leads back inside', () => {
    const world = flatWorld();
    const s = built(world, 'darkCastle', 300);
    const p = s.exitPoint();
    const c = world.addClonk(p.x, p.y, 0);
    run(world, 10);
    tap(world, { pressedUp: true });
    expect(c.contained).toBe(s);
    tap(world, { pressedLeft: true, left: true });
    expect(c.contained).toBeNull();
    run(world, 10);
    expect(c.y + 10).toBe(s.y + 13);
    tap(world, { pressedUp: true, up: true });
    expect(c.contained).toBe(s);
    tap(world, { pressedRight: true, right: true });
    run(world, 10);
    expect(c.y + 10).toBe(s.y - 11);
    tap(world, { pressedUp: true, up: true });
    expect(c.contained).toBe(s);
  });

  it("an enemy can't climb up in your dark castle", () => {
    const world = flatWorld();
    const s = built(world, 'darkCastle', 300, 1);
    expect(world.hostile(1, 0)).toBe(true);
    const p = s.exitPoint();
    const c = world.addClonk(p.x, p.y, 0);
    run(world, 10);
    tap(world, { pressedUp: true });
    expect(c.contained).toBe(s);
    tap(world, { pressedLeft: true });
    expect(c.contained).toBe(s);
  });
});

describe('Igloo and statues', () => {
  it('an igloo melts away when it is warm', () => {
    const world = flatWorld();
    const s = built(world, 'igloo', 300);
    world.weather = { temperature: 20, windAt: () => 0 } as never;
    for (let i = 0; i < IGLOO.interval * 60; i++) {
      world.tick++;
      stepBuildings(world);
    }
    expect(s.con).toBeLessThan(CONSTRUCTION.fullCon);
    expect(s.gone).toBe(true);
  });

  it('a statue breaks apart into what it is made of', () => {
    const world = flatWorld();
    const s = built(world, 'goldStatue', 300);
    const before = world.items.filter((i) => i.def.id === 'gold').length;
    world.explode(s.x, s.y, 40, null);
    world.explode(s.x, s.y, 40, null);
    world.explode(s.x, s.y, 40, null);
    expect(s.gone).toBe(true);
    expect(world.items.filter((i) => i.def.id === 'gold' && !i.removed).length).toBe(before + 4);
  });

  it('breaking apart drops the flag', () => {
    const world = flatWorld();
    const s = built(world, 'igloo', 300);
    s.base = 0;
    breakApart(world, s);
    expect(s.base).toBe(-1);
    expect(world.items.some((i) => i.def.id === 'flag')).toBe(true);
    expect(world.items.filter((i) => i.def.id === 'ice').length).toBe(6);
  });
});

describe('Construction plans', () => {
  it('the build menu offers only the scenario plans', () => {
    const world = flatWorld();
    expect(world.plans()).toEqual(BUILD_PLANS);
    world.knowledge = ['castle', 'hut'];
    expect(world.plans()).toEqual(['hut', 'castle']);
  });
});
