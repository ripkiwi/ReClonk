import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { generateMap } from '../landscape/generate';
import { DEFAULT_LANDSCAPE, sval } from '../landscape/mapCreator';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type ControlState } from '../objects/clonk';
import { World } from './world';

/** A flat test world: sky on top, earth from row `ground` down. */
function flatWorld(w = 200, h = 120, ground = 80): World {
  const land = new Landscape(w, h);
  for (let y = ground; y < h; y++) for (let x = 0; x < w; x++) land.set(x, y, Mat.Earth);
  return new World(land, new Rng(1));
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

/** Press a button for one tick (the "pressed" flag), then hold `held` for the rest. */
function press(world: World, ctrl: Partial<ControlState>, held: Partial<ControlState> = {}, ticks = 1): void {
  run(world, 1, { ...held, ...ctrl });
  if (ticks > 1) run(world, ticks - 1, held);
}

describe('Clonk movement', () => {
  it('falls and lands on the ground, feet just above it', () => {
    const world = flatWorld();
    const c = world.addClonk(100, 20, 0);
    run(world, 120);
    expect(c.action.name).toBe('Walk');
    expect(c.y).toBe(80 - 10); // bottom vertex (y+9) rests one pixel above row 80
  });

  it('walks at the original speed (about 2 px per tick)', () => {
    const world = flatWorld();
    const c = world.addClonk(50, 70, 0);
    run(world, 60);
    const x0 = c.x;
    run(world, 36, { right: true });
    expect(c.x - x0).toBeGreaterThan(60);
    expect(c.x - x0).toBeLessThan(75);
    expect(c.dir).toBe(1);
  });

  it('jumps forward about 40 px high', () => {
    const world = flatWorld();
    const c = world.addClonk(100, 70, 0);
    run(world, 60);
    let minY = c.y;
    press(world, { up: true, pressedUp: true });
    for (let i = 0; i < 60; i++) {
      run(world, 1);
      minY = Math.min(minY, c.y);
    }
    expect(70 - minY).toBeGreaterThan(35);
    expect(70 - minY).toBeLessThan(45);
    expect(c.x).toBeGreaterThan(100);
    expect(c.action.name).toBe('Walk');
  });

  it('climbs a wall it walks into', () => {
    const world = flatWorld();
    for (let y = 0; y < 80; y++) for (let x = 120; x < 130; x++) world.land.set(x, y, Mat.Granite);
    const c = world.addClonk(100, 70, 0);
    run(world, 30);
    run(world, 30, { right: true });
    expect(c.action.name).toBe('Scale');
    const y0 = c.y;
    run(world, 30, { up: true });
    expect(c.y).toBeLessThan(y0 - 10);
  });
});

describe('Digging', () => {
  it('digs through earth', () => {
    const world = flatWorld();
    const c = world.addClonk(100, 70, 0);
    run(world, 30);
    press(world, { down: true, pressedDig: true }, { down: true }, 120);
    expect(c.y).toBeGreaterThan(90);
    expect(world.land.get(100, 85)).toBe(Mat.Sky);
  });

  it('cannot dig through rock, gold or granite', () => {
    for (const hard of [Mat.Rock, Mat.Gold, Mat.Granite]) {
      const world = flatWorld();
      for (let y = 80; y < 120; y++) for (let x = 0; x < 200; x++) world.land.set(x, y, hard);
      const c = world.addClonk(100, 70, 0);
      run(world, 30);
      press(world, { down: true, pressedDig: true }, { down: true }, 120);
      expect(c.y).toBe(70);
      expect(world.land.get(100, 80)).toBe(hard);
    }
  });
});

describe('Items', () => {
  it('a clonk carries only one item', () => {
    const world = flatWorld();
    world.spawnItem('rock', 100, 76);
    world.spawnItem('rock', 102, 76);
    const c = world.addClonk(100, 70, 0);
    run(world, 30);
    expect(c.contents.length).toBe(1);
    expect(world.items.filter((i) => !i.container).length).toBe(1);
  });

  it('throws the carried item forward and up', () => {
    const world = flatWorld();
    world.spawnItem('rock', 100, 76);
    const c = world.addClonk(100, 70, 0);
    run(world, 30);
    const rock = c.carrying!;
    press(world, { pressedThrow: true });
    expect(c.contents.length).toBe(0);
    expect(rock.container).toBeNull();
    run(world, 40);
    expect(rock.x).toBeGreaterThan(120);
  });

  it('buried items stay put until dug free', () => {
    const world = flatWorld();
    const flint = world.spawnItem('flint', 60, 100);
    run(world, 50);
    expect(flint.y).toBe(100);
    expect(world.items).toContain(flint);
  });

  it('a thrown flint explodes on impact and blasts gold into nuggets', () => {
    const world = flatWorld();
    // A gold vein right where the flint will land.
    for (let y = 80; y < 110; y++) for (let x = 110; x < 170; x++) world.land.set(x, y, Mat.Gold);
    world.spawnItem('flint', 100, 76);
    const c = world.addClonk(100, 70, 0);
    run(world, 30);
    expect(c.carrying?.def.id).toBe('flint');
    press(world, { pressedThrow: true });
    run(world, 60);
    expect(world.items.some((i) => i.def.id === 'flint')).toBe(false);
    const nuggets = world.items.filter((i) => i.def.id === 'gold');
    expect(nuggets.length).toBeGreaterThanOrEqual(3);
    expect(world.events.some((e) => e.type === 'explosion')).toBe(true);
  });

  it('explosions do not break granite open', () => {
    const world = flatWorld();
    for (let y = 80; y < 120; y++) for (let x = 0; x < 200; x++) world.land.set(x, y, Mat.Granite);
    world.explode(100, 85, 18);
    let sky = 0;
    for (let y = 80; y < 100; y++) for (let x = 85; x < 115; x++) if (world.land.get(x, y) === Mat.Sky) sky++;
    expect(sky).toBe(0);
  });
});

describe('Determinism', () => {
  it('the same seed and inputs give identical worlds', () => {
    const make = (): World => {
      const map = generateMap({ ...DEFAULT_LANDSCAPE, mapWidth: sval(40, 0, 20, 250), mapHeight: sval(25, 0, 20, 250) }, 7);
      const w = World.fromMap(map, 7);
      w.addClonk(map.spawn.x, map.spawn.y, 0);
      return w;
    };
    const a = make();
    const b = make();
    const script: Partial<ControlState>[] = [{ right: true }, { right: true, pressedUp: true, up: true }, { down: true, pressedDown: true }, {}];
    for (let t = 0; t < 400; t++) {
      const ctrl = new Map([[0, { ...NO_CONTROL, ...script[Math.floor(t / 100)] }]]);
      a.step(ctrl);
      b.step(ctrl);
    }
    expect(Array.from(a.land.cells)).toEqual(Array.from(b.land.cells));
    expect([a.clonks[0].x, a.clonks[0].y]).toEqual([b.clonks[0].x, b.clonks[0].y]);
    expect(a.items.map((i) => [i.x, i.y])).toEqual(b.items.map((i) => [i.x, i.y]));
  });
});

describe('Water', () => {
  it('settles instead of jittering forever', () => {
    const land = new Landscape(40, 20);
    for (let x = 0; x < 40; x++) land.set(x, 19, Mat.Granite);
    for (let y = 5; y < 10; y++) for (let x = 18; x < 22; x++) land.set(x, y, Mat.Water);
    const rng = new Rng(3);
    for (let t = 0; t < 400; t++) land.step(t, rng);
    const snapshot = Array.from(land.cells);
    for (let t = 400; t < 450; t++) land.step(t, rng);
    expect(Array.from(land.cells)).toEqual(snapshot);
    let water = 0;
    for (const c of land.cells) if (c === Mat.Water) water++;
    expect(water).toBe(20);
  });
});

describe('Open map edges', () => {
  it('with an open bottom, a clonk that falls out of the map dies and objects are gone', () => {
    const land = new Landscape(100, 60);
    land.bottomOpen = true;
    const world = new World(land, new Rng(1));
    const c = world.addClonk(50, 10, 0);
    world.spawnItem('rock', 30, 10);
    run(world, 200);
    expect(c.alive).toBe(false);
    expect(world.items).toHaveLength(0);
    expect(world.events.some((e) => e.type === 'death')).toBe(true);
  });

  it('with a closed top, a jump hits the ceiling', () => {
    const highest = (topOpen: boolean): number => {
      const land = new Landscape(100, 60);
      for (let x = 0; x < 100; x++) land.set(x, 20, Mat.Earth);
      land.topOpen = topOpen;
      const world = new World(land, new Rng(1));
      const c = world.addClonk(50, 9, 0);
      run(world, 20);
      press(world, { up: true, pressedUp: true });
      let top = c.y;
      for (let t = 0; t < 40; t++) {
        run(world, 1);
        top = Math.min(top, c.y);
      }
      return top;
    };
    // The head (7 px above the clonk's middle) stops at the top row.
    expect(highest(false)).toBe(7);
    expect(highest(true)).toBeLessThan(0);
  });
});
