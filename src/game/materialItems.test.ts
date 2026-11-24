import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat, MATERIALS, TEXMAP, texIndex } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { ITEMS } from '../objects/defs';
import { BRIDGE_MENU, BRIDGE_MENU_START } from './materialItems';
import { SCENARIOS } from './scenarios';
import { World } from './world';

const GROUND = 120;

function flatWorld(w = 400, h = 220, mat: Mat = Mat.Earth): World {
  const land = new Landscape(w, h);
  for (let y = GROUND; y < h; y++) for (let x = 0; x < w; x++) land.set(x, y, mat);
  const world = new World(land, new Rng(1));
  world.addPlayer(0, { wealth: 100, stock: {} });
  return world;
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

const tap = (world: World, ctrl: Partial<ControlState>): void => run(world, 1, ctrl);

function standing(world: World, x: number): Clonk {
  const c = world.addClonk(x, GROUND - 10, 0);
  run(world, 10);
  return c;
}

/** Open the loam menu, move to the choice and build it. */
function build(world: World, c: Clonk, choice: number): void {
  tap(world, { pressedUse: true });
  expect(c.bridgeMenu).toBe(BRIDGE_MENU_START);
  let i = BRIDGE_MENU_START;
  while (i !== choice) {
    const right = choice > i;
    tap(world, right ? { pressedRight: true } : { pressedLeft: true });
    i += right ? 1 : -1;
  }
  expect(c.bridgeMenu).toBe(choice);
  tap(world, { pressedThrow: true });
}

const countMat = (land: Landscape, mat: Mat, x0: number, y0: number, x1: number, y1: number): number => {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (land.get(x, y) === mat) n++;
  return n;
};

describe('Veins and materials', () => {
  it('has the original vein materials, with their texture map entries in the original order', () => {
    expect(MATERIALS[Mat.Coal]).toMatchObject({ name: 'Coal', digFree: true, dig2Object: 'coal', dig2ObjectRatio: 300, blast2Object: 'coal' });
    expect(MATERIALS[Mat.Sulphur]).toMatchObject({ name: 'Sulphur', digFree: true, dig2Object: 'sulphur', blast2ObjectRatio: 80 });
    // Ore and crystal are hard like gold: only flints get them out.
    expect(MATERIALS[Mat.Ore]).toMatchObject({ name: 'Ore', digFree: false, blast2Object: 'ore', blast2ObjectRatio: 100 });
    expect(MATERIALS[Mat.Crystal]).toMatchObject({ name: 'Crystal', digFree: false, blast2Object: 'crystal' });
    expect(MATERIALS[Mat.FlySand].instable).toBe(true);
    const names = TEXMAP.map((t) => t.name);
    expect(names.indexOf('Ashes-Ridge') + 1).toBe(names.indexOf('Ore-Rough'));
    expect(names.indexOf('Rock-Rock') + 1).toBe(names.indexOf('Sulphur-Swirl'));
    expect(TEXMAP[texIndex('Sulphur')].name).toBe('Sulphur-Swirl');
    expect(TEXMAP[texIndex('Crystal')].name).toBe('Crystal-Structure');
  });

  it('puts ore, coal and sulphur into Gold Mine like the original, and loam into the earth', () => {
    const gm = SCENARIOS.find((s) => s.id === 'goldmine')!;
    expect(gm.landscape.layers.slice(-3)).toEqual([
      { name: 'Ore', count: 3 },
      { name: 'Coal-Swirl', count: 4 },
      { name: 'Sulphur-Swirl', count: 5 },
    ]);
    expect(gm.landscape.inEarth.loam).toBe(1);
    expect(gm.base.stock).toMatchObject({ loam: 6, metal: 5, sulphur: 3 });
  });

  it('blasting ore and crystal veins drops ore and crystals', () => {
    for (const [mat, id] of [[Mat.Ore, 'ore'], [Mat.Crystal, 'crystal']] as const) {
      const world = flatWorld(300, 220, mat);
      world.explode(150, GROUND + 10, 30);
      expect(world.items.filter((i) => i.def.id === id).length).toBeGreaterThan(5);
    }
  });
});

describe('Digging out chunks', () => {
  it('digging a coal vein drops coal at the clonk feet, one per 300 pixels', () => {
    const world = flatWorld(300, 220, Mat.Coal);
    const c = standing(world, 150);
    tap(world, { pressedDig: true, down: true });
    run(world, 80, { down: true });
    expect(c.action.procedure).toBe('dig');
    const coal = world.items.filter((i) => i.def.id === 'coal').length + (c.carrying?.def.id === 'coal' ? 1 : 0);
    expect(coal).toBeGreaterThan(0);
    // Sulphur too, but nothing comes out of plain earth unasked.
    const earth = flatWorld();
    standing(earth, 150);
    tap(earth, { pressedDig: true, down: true });
    run(earth, 80, { down: true });
    expect(earth.items).toHaveLength(0);
  });

  it('earth only gives chunks on request: throw with empty hands while digging', () => {
    const world = flatWorld();
    const c = standing(world, 150);
    tap(world, { pressedDig: true, down: true });
    run(world, 150, { down: true });
    const chunks = (): number => world.items.filter((i) => i.def.id === 'earth').length + (c.carrying?.def.id === 'earth' ? 1 : 0);
    expect(chunks()).toBe(0);
    tap(world, { pressedThrow: true, down: true });
    expect(c.digRequest).toBe(true);
    expect(c.action.procedure).toBe('dig');
    run(world, 5, { down: true });
    expect(chunks()).toBeGreaterThanOrEqual(1);
    // The clonk picks the first one up: throwing now throws it, and stops digging.
    expect(c.carrying?.def.id).toBe('earth');
    tap(world, { pressedThrow: true, down: true });
    expect(c.action.procedure).not.toBe('dig');
  });

  it('a chunk of earth thrown bursts into loose earth', () => {
    const world = flatWorld();
    const chunk = world.spawnItem('earth', 150, 40, 0, 2);
    run(world, 60);
    expect(chunk.removed).toBe(true);
    expect(world.events.some((e) => e.type === 'itemBreak')).toBe(true);
    run(world, 100);
    expect(countMat(world.land, Mat.Earth, 100, 100, 200, GROUND - 1)).toBeGreaterThan(50);
  });

  it('snowballs only come out of snow with the snowball rule', () => {
    for (const rule of [false, true]) {
      const world = flatWorld(300, 220, Mat.Snow);
      if (rule) world.rules.add('snowballs');
      const c = standing(world, 150);
      tap(world, { pressedDig: true, down: true });
      tap(world, { pressedThrow: true, down: true });
      run(world, 300, { down: true });
      const balls = world.items.filter((i) => i.def.id === 'snowball').length + (c.carrying?.def.id === 'snowball' ? 1 : 0);
      expect(balls > 0).toBe(rule);
    }
  });
});

describe('Loam bridges', () => {
  it('the loam menu has the original ten bridges and walls, starting on the straight one', () => {
    expect(BRIDGE_MENU.map((b) => b.caption)).toEqual([
      'Wall left', 'Roof diagonal left', 'Roof center', 'Roof diagonal right', 'Wall right',
      'Bridge left', 'Diagonal left', 'Wall center', 'Diagonal right', 'Bridge right',
    ]);
    expect(BRIDGE_MENU[BRIDGE_MENU_START].caption).toBe('Wall center');
  });

  it('a bridge to the right reaches 20 pixels over a gap, the clonk walking along it', () => {
    const world = flatWorld();
    // A gap right of x=160.
    for (let y = GROUND; y < 220; y++) for (let x = 161; x < 220; x++) world.land.set(x, y, Mat.Sky);
    const c = standing(world, 154);
    world.give(c, 'loam');
    build(world, c, 9);
    expect(c.action.name).toBe('Bridge');
    expect(c.carrying).toBeUndefined();
    const x0 = c.x;
    run(world, 110);
    expect(c.action.procedure).toBe('walk');
    expect(c.x - x0).toBeGreaterThanOrEqual(18);
    expect(countMat(world.land, Mat.Earth, 161, GROUND, 185, GROUND + 3)).toBeGreaterThan(40);
  });

  it('straight up, the clonk builds a pillar under its feet and rises 25 pixels', () => {
    const world = flatWorld();
    const c = standing(world, 150);
    world.give(c, 'loam');
    const y0 = c.y;
    build(world, c, BRIDGE_MENU_START);
    run(world, 110);
    expect(y0 - c.y).toBeGreaterThanOrEqual(22);
    expect(world.land.get(c.x, c.y + 10)).toBe(Mat.Earth);
  });

  it('a roof over the clonk does not move it, and metal builds granite', () => {
    const world = flatWorld();
    const c = standing(world, 150);
    world.give(c, 'metal');
    const x0 = c.x;
    build(world, c, 2);
    run(world, 110);
    expect(c.x).toBe(x0);
    expect(countMat(world.land, Mat.Granite, x0 - 15, c.y - 16, x0 + 15, c.y - 10)).toBeGreaterThan(40);
  });

  it('down stops building, and dig closes the menu', () => {
    const world = flatWorld();
    const c = standing(world, 150);
    world.give(c, 'loam');
    build(world, c, 9);
    run(world, 20);
    tap(world, { pressedDown: true });
    expect(c.action.procedure).toBe('walk');
    world.give(c, 'loam');
    tap(world, { pressedUse: true });
    expect(c.bridgeMenu).toBe(BRIDGE_MENU_START);
    tap(world, { pressedDig: true });
    expect(c.bridgeMenu).toBeNull();
    expect(c.carrying?.def.id).toBe('loam');
    expect(ITEMS.metal.bridge).toBe(Mat.Granite);
    expect(ITEMS.loam.bridge).toBe(Mat.Earth);
  });
});

describe('Gunpowder, ice and concrete', () => {
  it('gunpowder lying about blows up in a blast', () => {
    const world = flatWorld();
    const g = world.spawnItem('gunpowder', 150, GROUND - 3);
    run(world, 5);
    world.explode(130, GROUND - 3, 25);
    expect(g.fire).not.toBeNull();
    run(world, 15);
    expect(g.removed).toBe(true);
    // Its own blast (30) dug a much bigger hole than the small one.
    expect(world.land.get(150, GROUND + 20)).toBe(Mat.Sky);
  });

  it('burning gunpowder in a clonk hands goes out instead', () => {
    const world = flatWorld();
    const c = standing(world, 150);
    const g = world.give(c, 'gunpowder')!;
    g.fire = { by: -1, since: world.tick };
    g.damage = 5;
    run(world, 2);
    expect(g.removed).toBe(false);
    expect(g.fire).toBeNull();
  });

  it('concrete breaks into rock where it lands', () => {
    const world = flatWorld();
    world.spawnItem('concrete', 150, 40, 0, 2);
    run(world, 200);
    expect(countMat(world.land, Mat.Rock, 120, 90, 180, GROUND - 1)).toBeGreaterThan(50);
  });
});
