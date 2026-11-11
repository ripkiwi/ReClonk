import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { CONSTRUCTION } from '../objects/defs';
import { FIRE } from '../objects/fire';
import { FULL_CON, PLANTS } from '../objects/vegetation';
import { completeStructure, construct } from './buildings';
import { extinguish, incinerate } from './fire';
import { buildOnSurface } from './homeBase';
import { World } from './world';

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

/** Run until the condition holds, at most `max` ticks; returns the ticks it took. */
function until(world: World, cond: () => boolean, max: number): number {
  const t0 = world.tick;
  while (!cond() && world.tick - t0 < max) run(world, 1);
  return world.tick - t0;
}

function standing(world: World, x: number): Clonk {
  const c = world.addClonk(x, GROUND - 10, 0);
  run(world, 10);
  return c;
}

const tree = (world: World, x = 300, id: keyof typeof PLANTS = 'tree1') => world.addPlant(id, x, GROUND + 8);

/** A pool of water from x0 to x1, `depth` deep, dug into the ground. */
function pool(world: World, x0: number, x1: number, depth = 20): void {
  for (let y = GROUND; y < GROUND + depth; y++) for (let x = x0; x < x1; x++) world.land.set(x, y, Mat.Water);
}

describe('Trees on fire', () => {
  it('a flint that hits a tree sets it alight: it turns into a dead tree, falls over and burns away', () => {
    const world = flatWorld();
    const p = tree(world);
    world.explode(300, GROUND - 20, 18);
    expect(p.fire).not.toBeNull();
    expect(p.burned).toBe(true);
    expect(world.events.some((e) => e.type === 'inflame' && e.loud)).toBe(true);
    // Burning does 2 damage every 10 ticks while it burns away by 0.1% a tick: it falls at about 57%.
    const fell = until(world, () => p.state !== 'standing', 600);
    expect(fell).toBeGreaterThan(300);
    expect(fell).toBeLessThan(500);
    // A full tree is gone after 1000 ticks of burning.
    run(world, 1000 - fell - 30);
    expect(world.plants).toContain(p);
    run(world, 40);
    expect(world.plants).not.toContain(p);
  });

  it('a blast that only grazes a tree does not light it: it needs 10 damage', () => {
    const world = flatWorld();
    const p = tree(world);
    world.blastObjects(300, GROUND - 20, 5);
    expect(p.fire).toBeNull();
    // Lightning comes down in steps of 5: two of them light it.
    world.blastObjects(300, GROUND - 20, 5);
    expect(p.fire).not.toBeNull();
  });

  it('fire spreads to a tree the burning one reaches into, not to one far away', () => {
    const world = flatWorld();
    const a = tree(world, 200);
    const near = tree(world, 230);
    const far = tree(world, 450);
    incinerate(world, a, null);
    // One time in two every 35 ticks (ContactIncinerate=2).
    until(world, () => !!near.fire, 35 * 20);
    expect(near.fire).not.toBeNull();
    expect(far.fire).toBeNull();
  });

  it('a dead tree does not grow, and gives less wood', () => {
    const world = flatWorld();
    const p = world.addPlant('tree1', 300, GROUND + 8, FULL_CON / 2);
    incinerate(world, p, null);
    extinguish(world, p);
    const con = p.con;
    run(world, 35 * 10);
    expect(p.con).toBe(con);
    p.chopDown(1);
    expect(p.wood).toBe(Math.trunc((PLANTS.tree1.burned.wood * p.con) / FULL_CON));
  });

  it('a felled tree that burns has less and less wood in it', () => {
    const world = flatWorld();
    const p = tree(world);
    p.chopDown(1);
    run(world, 80);
    incinerate(world, p, null);
    run(world, 500);
    expect(p.wood).toBeLessThanOrEqual(Math.trunc((PLANTS.tree1.burned.wood * p.con) / FULL_CON));
    expect(p.wood).toBeLessThan(PLANTS.tree1.wood);
  });

  it('water puts a burning tree out, with a hiss', () => {
    const world = flatWorld();
    const p = tree(world);
    incinerate(world, p, null);
    // Flood it up to its middle.
    const c = p.center;
    for (let y = Math.floor(c.y) - 2; y < GROUND; y++) for (let x = 270; x < 330; x++) if (!world.land.isSolid(x, y)) world.land.set(x, y, Mat.Water);
    run(world, FIRE.checkInterval + 1);
    expect(p.fire).toBeNull();
    expect(world.events.some((e) => e.type === 'extinguish' && e.hiss)).toBe(true);
  });
});

describe('Clonks on fire', () => {
  it('a burning clonk loses one energy point every 5 ticks, and burns to death in about 7 seconds', () => {
    const world = flatWorld();
    const c = standing(world, 100);
    expect(incinerate(world, c, null)).toBe(true);
    const e0 = c.energy;
    run(world, 50);
    expect(c.energy).toBe(e0 - 10 * 1000);
    const t = until(world, () => !c.alive, 400);
    expect(c.alive).toBe(false);
    expect(50 + t).toBeLessThanOrEqual(255);
  });

  it('flint blasts do not set clonks alight (no BlastIncinerate), but burning wood under them does', () => {
    const world = flatWorld();
    const c = standing(world, 100);
    world.explode(c.x + 15, c.y, 18);
    expect(c.fire).toBeNull();
    const d = standing(world, 400);
    // Hands full, so it doesn't just pick the wood up.
    world.give(d, 'rock');
    const wood = world.spawnItem('wood', d.x, GROUND - 4);
    run(world, 5);
    incinerate(world, wood, null);
    // ContactIncinerate=1: the next contact check lights it.
    until(world, () => !!d.fire, 36);
    expect(d.fire).not.toBeNull();
  });

  it('a burning clonk lights the tree it walks through', () => {
    const world = flatWorld();
    const p = tree(world, 300);
    const c = standing(world, 300);
    incinerate(world, c, null);
    until(world, () => !!p.fire, 35 * 20);
    expect(p.fire).not.toBeNull();
  });

  it('jumping into water puts a burning clonk out', () => {
    const world = flatWorld();
    pool(world, 200, 300, 30);
    const c = world.addClonk(250, GROUND + 15, 0);
    run(world, 2);
    incinerate(world, c, null);
    // In water it doesn't even catch fire.
    expect(c.fire).toBeNull();
    const d = standing(world, 150);
    incinerate(world, d, null);
    d.setPosition(250, GROUND + 15);
    run(world, FIRE.checkInterval + 1);
    expect(d.fire).toBeNull();
    expect(d.alive).toBe(true);
  });

  it('getting into a home base puts a burning clonk out', () => {
    const world = flatWorld();
    const hut = buildOnSurface(world, 'hut', 100, 0);
    const p = hut.exitPoint();
    const c = world.addClonk(p.x, p.y, 0);
    run(world, 30);
    incinerate(world, c, null);
    run(world, 1, { up: true, pressedUp: true });
    expect(c.contained).toBe(hut);
    run(world, FIRE.checkInterval);
    expect(c.fire).toBeNull();
  });

  it('whoever lit the fire gets the kill when it burns an enemy', () => {
    const world = flatWorld();
    world.addPlayer(1, { wealth: 0, stock: {} });
    const me = standing(world, 100);
    const foe = world.addClonk(400, GROUND - 10, 1);
    run(world, 10);
    world.give(foe, 'rock');
    const wood = world.spawnItem('wood', foe.x, GROUND - 4);
    run(world, 5);
    incinerate(world, wood, me);
    until(world, () => !foe.alive, 600);
    const death = world.events.find((e) => e.type === 'death');
    expect(death && death.type === 'death' && death.killer).toBe(me);
  });
});

describe('Buildings on fire', () => {
  it('three flint hits set a wooden hut alight (BlastIncinerate 45): the flag falls, everyone inside comes out', () => {
    const world = flatWorld();
    const hut = buildOnSurface(world, 'hut', 100, 0);
    const p = hut.exitPoint();
    const c = world.addClonk(p.x, p.y, 0);
    run(world, 30);
    run(world, 1, { up: true, pressedUp: true });
    expect(c.contained).toBe(hut);
    world.explode(hut.x + 20, hut.top + 5, 18);
    world.explode(hut.x + 20, hut.top + 5, 18);
    expect(hut.fire).toBeNull();
    world.explode(hut.x + 20, hut.top + 5, 18);
    expect(hut.fire).not.toBeNull();
    expect(hut.burned).toBe(true);
    expect(hut.hasFlag).toBe(false);
    expect(hut.complete).toBe(false);
    expect(c.contained).toBeNull();
  });

  it('a burning building burns away in 1000 ticks; its basement stays', () => {
    const world = flatWorld();
    const hut = buildOnSurface(world, 'hut', 100, 0);
    incinerate(world, hut, null, true);
    run(world, 990);
    expect(hut.gone).toBe(false);
    expect(hut.con).toBeLessThan(CONSTRUCTION.fullCon / 50);
    run(world, 20);
    expect(hut.gone).toBe(true);
    expect(hut.basement).not.toBeNull();
    expect(world.land.get(hut.x, hut.basement!.y + 1)).toBe(Mat.Basement);
  });

  it('a burned hut that was put out can be built back up into a hut; its flag lies where it fell', () => {
    const world = flatWorld();
    const hut = buildOnSurface(world, 'hut', 100, 0);
    incinerate(world, hut, null, true);
    run(world, 200);
    extinguish(world, hut);
    const c = standing(world, 100);
    run(world, 1, { down: true, pressedDown: true, doubleDown: true });
    expect(c.action.procedure).toBe('build');
    until(world, () => !hut.burned, 2000);
    expect(hut.burned).toBe(false);
    expect(hut.complete).toBe(true);
    // The flag came off as a loose object (unless the builder picked it up); it doesn't magically go back up.
    expect(hut.hasFlag).toBe(false);
    const flag = world.items.find((i) => i.def.id === 'flag')!;
    expect(flag.owner).toBe(0);
  });

  it('a T-flint going off in a hut hurts the building too', () => {
    const world = flatWorld();
    const hut = buildOnSurface(world, 'hut', 100, -1);
    const p = hut.exitPoint();
    const c = world.addClonk(p.x, p.y, 0);
    run(world, 30);
    run(world, 1, { up: true, pressedUp: true });
    expect(c.contained).toBe(hut);
    for (let i = 0; i < 3; i++) {
      const t = world.give(c, 'tflint')!;
      t.light();
      run(world, 61);
    }
    // 60 damage is past the hut's 45, but a clonk inside comes out when it catches fire.
    expect(hut.burned).toBe(true);
    expect(c.contained).toBeNull();
  });

  it('a burned elevator loses its case, a burned guard tower its gates and walls', () => {
    const world = flatWorld();
    const e = construct(world, 'elevator', 200, GROUND, 0);
    completeStructure(world, e);
    const t = construct(world, 'tower', 400, GROUND, 0);
    completeStructure(world, t);
    run(world, 1);
    expect(e.liftCase).not.toBeNull();
    expect(world.land.isSolid(t.left + 1, t.top + 1)).toBe(true);
    incinerate(world, e, null, true);
    incinerate(world, t, null, true);
    expect(e.liftCase).toBeNull();
    expect(t.gates).toEqual([]);
    expect(world.land.isSolid(t.left + 1, t.top + 1)).toBe(false);
  });
});

describe('Wood on fire', () => {
  it('a blast sets wood lying next to it alight (BlastIncinerate 5); it burns away and is charred', () => {
    const world = flatWorld();
    const wood = world.spawnItem('wood', 300, GROUND - 4);
    run(world, 5);
    world.explode(304, GROUND - 2, 18);
    expect(wood.fire).not.toBeNull();
    expect(wood.burned).toBe(true);
    // Small things catch fire quietly.
    expect(world.events.some((e) => e.type === 'inflame' && !e.loud)).toBe(true);
    until(world, () => wood.removed, 1100);
    expect(wood.removed).toBe(true);
    expect(world.items).not.toContain(wood);
  });

  it('burning wood in a clonk’s hands burns away there, without lighting the clonk', () => {
    const world = flatWorld();
    const c = standing(world, 100);
    const wood = world.give(c, 'wood')!;
    incinerate(world, wood, null);
    run(world, 500);
    expect(c.fire).toBeNull();
    run(world, 510);
    expect(c.carrying).toBeUndefined();
    expect(c.contents).not.toContain(wood);
  });

  it('rock, gold and flints do not burn', () => {
    const world = flatWorld();
    const items = (['rock', 'gold', 'flint'] as const).map((id, i) => world.spawnItem(id, 100 + i * 60, GROUND - 4));
    run(world, 5);
    for (const it of items) world.explode(it.x, GROUND + 6, 10);
    expect(items.every((i) => !i.fire)).toBe(true);
  });
});

describe('Fire is deterministic', () => {
  it('the same fire in the same world spreads the same way', () => {
    const play = (): string => {
      const world = flatWorld();
      for (let i = 0; i < 8; i++) tree(world, 100 + i * 30, i % 2 ? 'tree2' : 'tree1');
      incinerate(world, world.plants[0], null);
      run(world, 1500);
      return world.plants.map((p) => `${p.x}:${p.con}:${p.state}:${!!p.fire}`).join(',');
    };
    expect(play()).toEqual(play());
  });
});
