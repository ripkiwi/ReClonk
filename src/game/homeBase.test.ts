import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { generateMap } from '../landscape/generate';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type ControlState } from '../objects/clonk';
import { CLONK } from '../objects/defs';
import { incinerate } from './fire';
import { buildOnSurface, setupDefaultBases } from './homeBase';
import { World } from './world';
import { scenarioById } from './scenarios';

function flatWorld(w = 300, h = 120, ground = 80): World {
  const land = new Landscape(w, h);
  for (let y = ground; y < h; y++) for (let x = 0; x < w; x++) land.set(x, y, Mat.Earth);
  return new World(land, new Rng(1));
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

const tap = (world: World, ctrl: Partial<ControlState>): void => run(world, 1, ctrl);
const UP = { up: true, pressedUp: true };
const DOWN = { down: true, pressedDown: true };
const THROW = { pressedThrow: true };
const RIGHT = { right: true, pressedRight: true };
const DIG = { pressedDig: true };

/** A world with player 0, a hut at x=100 (with flag if `own`), and a clonk standing in its door. */
function atHut(own = true, wealth = 25) {
  const world = flatWorld();
  const player = world.addPlayer(0, { wealth, stock: { flint: 2, rock: 5 } });
  const hut = buildOnSurface(world, 'hut', 100, own ? 0 : -1);
  const p = hut.exitPoint();
  const clonk = world.addClonk(p.x, p.y, 0);
  run(world, 30);
  return { world, player, hut, clonk };
}

describe('Buildings and home bases', () => {
  it('stands on the ground; a flag makes it a home base', () => {
    const { hut, clonk } = atHut();
    expect(hut.y + hut.def.offset.y + hut.def.height).toBe(80);
    expect(hut.hasFlag).toBe(true);
    expect(clonk.action.name).toBe('Walk');
  });

  it('jump in a doorway goes in instead of jumping; down comes back out', () => {
    const { world, hut, clonk } = atHut(false);
    tap(world, UP);
    expect(clonk.contained).toBe(hut);
    run(world, 20);
    expect(clonk.contained).toBe(hut);
    tap(world, DOWN);
    expect(clonk.contained).toBeNull();
    expect(hut.atEntrance(clonk.x, clonk.y)).toBe(true);
    run(world, 10);
    expect(clonk.action.name).toBe('Walk');
  });

  it('jump away from any door still jumps', () => {
    const { world, clonk } = atHut();
    run(world, 40, { right: true });
    tap(world, UP);
    expect(clonk.contained).toBeNull();
    expect(clonk.action.name).toBe('Jump');
  });

  it('heals in your own base, paying 5 gold per 100 energy', () => {
    const { world, player, clonk } = atHut(true, 25);
    clonk.doEnergy(-40);
    tap(world, UP);
    run(world, 3 * 20 + 3);
    expect(clonk.energy).toBe(CLONK.energy);
    expect(player.wealth).toBe(20);
  });

  it('does not heal in a building without your flag', () => {
    const { world, player, clonk } = atHut(false, 25);
    clonk.doEnergy(-40);
    tap(world, UP);
    run(world, 100);
    expect(clonk.energy).toBe(CLONK.energy - 40_000);
    expect(player.wealth).toBe(25);
  });

  it('no gold, no healing', () => {
    const { world, clonk } = atHut(true, 0);
    clonk.doEnergy(-40);
    tap(world, UP);
    run(world, 100);
    expect(clonk.energy).toBe(CLONK.energy - 40_000);
  });

  it('carried gold is sold for 5 when you walk into your base', () => {
    const { world, player, clonk } = atHut(true, 0);
    const gold = world.spawnItem('gold', clonk.x, clonk.y);
    run(world, 2);
    expect(clonk.carrying).toBe(gold);
    tap(world, UP);
    expect(clonk.carrying).toBeUndefined();
    expect(player.wealth).toBe(5);
  });

  it('buys a flint for 5 and a rock for 1; throw puts things in, and the sell menu sells them back', () => {
    const { world, player, hut, clonk } = atHut(true, 10);
    tap(world, UP);
    tap(world, UP); // open the buy menu
    expect(clonk.menu).toBe(0);
    expect(clonk.menuKind).toBe('buy');
    expect(world.menuList(clonk).map((e) => [e.id, e.count, e.value])).toEqual([['flint', 2, 5], ['rock', 5, 1]]);
    tap(world, THROW); // flint
    expect(clonk.carrying?.def.id).toBe('flint');
    expect(player.wealth).toBe(5);
    expect(player.stock.flint).toBe(1);
    expect(clonk.menu).toBe(0); // the menu stays open

    tap(world, RIGHT);
    tap(world, THROW); // a rock: hands are full, so it's kept in the hut
    expect(player.wealth).toBe(4);
    expect(clonk.carrying?.def.id).toBe('flint');
    expect(hut.contents.map((i) => i.def.id)).toEqual(['rock']);
    tap(world, DIG); // close the menu
    expect(clonk.menu).toBeNull();

    tap(world, THROW); // put the flint in
    expect(clonk.carrying).toBeUndefined();
    expect(hut.contents.map((i) => i.def.id)).toEqual(['rock', 'flint']);
    expect(player.wealth).toBe(4);

    tap(world, DIG); // the sell menu: what's kept in the base
    expect(clonk.menuKind).toBe('sell');
    expect(world.menuList(clonk).map((e) => [e.id, e.count, e.value])).toEqual([['rock', 1, 1], ['flint', 1, 5]]);
    tap(world, THROW); // sell the rock
    expect(player.wealth).toBe(5);
    expect(player.stock.rock).toBe(5);
    tap(world, THROW); // and the flint
    expect(player.wealth).toBe(10);
    expect(player.stock.flint).toBe(2);
    expect(hut.contents).toHaveLength(0);
    expect(world.menuList(clonk)).toEqual([]);
  });

  it('gold thrown into your base is sold at once', () => {
    const { world, player, hut, clonk } = atHut(true, 0);
    tap(world, UP);
    const gold = world.spawnItem('gold', clonk.x, clonk.y);
    gold.container = clonk;
    clonk.contents.push(gold);
    tap(world, THROW);
    expect(player.wealth).toBe(5);
    expect(hut.contents).toHaveLength(0);
  });

  it('any building keeps things; the get menu takes one out, swapping it for what the clonk holds', () => {
    const { world, player, hut, clonk } = atHut(false, 0);
    tap(world, UP);
    world.give(clonk, 'rock');
    tap(world, THROW);
    world.give(clonk, 'gold');
    tap(world, THROW);
    // Not a base: gold isn't sold, there's no buying or selling.
    expect(hut.contents.map((i) => i.def.id)).toEqual(['rock', 'gold']);
    expect(player.wealth).toBe(0);
    tap(world, UP);
    expect(clonk.menu).toBeNull();
    tap(world, DIG); // the get menu
    expect(clonk.menuKind).toBe('get');
    tap(world, THROW); // a rock
    expect(clonk.carrying?.def.id).toBe('rock');
    expect(hut.contents.map((i) => i.def.id)).toEqual(['gold']);
    tap(world, THROW); // the gold, putting the rock down
    expect(clonk.carrying?.def.id).toBe('gold');
    expect(hut.contents.map((i) => i.def.id)).toEqual(['rock']);
    tap(world, DIG);
    expect(clonk.menu).toBeNull();
    tap(world, DOWN);
    expect(clonk.contained).toBeNull();
    expect(clonk.carrying?.def.id).toBe('gold');
  });

  it('a burning building throws out what it keeps', () => {
    const { world, hut, clonk } = atHut(false, 0);
    tap(world, UP);
    world.give(clonk, 'rock');
    tap(world, THROW);
    const rock = hut.contents[0];
    incinerate(world, hut, null);
    expect(hut.contents).toHaveLength(0);
    expect(rock.container).toBeNull();
    run(world, 30);
    expect(rock.removed).toBe(false);
    expect(Math.abs(rock.x - hut.exitPoint().x)).toBeLessThan(15);
  });

  it("can't buy without enough gold", () => {
    const { world, player, clonk } = atHut(true, 3);
    tap(world, UP);
    tap(world, UP);
    tap(world, THROW);
    expect(clonk.carrying).toBeUndefined();
    expect(player.wealth).toBe(3);
  });

  it('a flint blast hurts a clonk, and enough of them kill it', () => {
    const world = flatWorld();
    const c = world.addClonk(100, 70, 0);
    run(world, 20);
    world.explode(c.x, c.y, 18);
    expect(c.energy).toBe(CLONK.energy - 15_000); // 18/3 direct hit + 18/2 shock wave
    for (let i = 0; i < 3; i++) world.explode(c.x, c.y, 18);
    expect(c.alive).toBe(false);
    run(world, 60);
    expect(c.action.name).toBe('Dead');
  });

  it('stands on a stone basement that can be walked on but not dug', () => {
    const { world, hut } = atHut();
    const b = hut.basement!;
    expect([b.x, b.y, b.w, b.h]).toEqual([70, 80, 60, 8]);
    for (const [x, y] of [[70, 80], [129, 87], [100, 84]]) expect(world.land.get(x, y)).toBe(Mat.Basement);
    expect(world.land.get(69, 80)).toBe(Mat.Earth);
    expect(world.land.get(100, 88)).toBe(Mat.Earth);
    expect(world.land.isSolid(100, 80)).toBe(true);
    world.land.dig(100, 84, 6);
    expect(world.land.get(100, 84)).toBe(Mat.Basement);
  });

  it('a basement takes blasts until it breaks into 4 rocks, and the ground comes back', () => {
    const { world, hut } = atHut();
    const rocks = (): number => world.items.filter((i) => i.def.id === 'rock').length;
    const before = rocks();
    // Flints go off right next to it: 8 of them are 144 damage, the 9th breaks it (150, like the original).
    for (let i = 0; i < 8; i++) world.explode(100, 92, 18);
    expect(hut.basement).not.toBeNull();
    expect(world.land.get(100, 82)).toBe(Mat.Basement);
    world.explode(100, 92, 18);
    expect(hut.basement).toBeNull();
    expect(rocks()).toBe(before + 4);
    expect(world.land.get(75, 81)).toBe(Mat.Earth);
  });

  it('default scenario: your hut with a flag and an ordinary hut, on dry ground', () => {
    const map = generateMap(scenarioById('goldmine')!.landscape, 1337);
    const world = World.fromMap(map, 1337);
    const { home } = setupDefaultBases(world, 0, map.spawn.x);
    expect(world.structures).toHaveLength(2);
    expect(home.base).toBe(0);
    expect(world.structures[1].base).toBe(-1);
    expect(Math.abs(world.structures[0].x - world.structures[1].x)).toBeGreaterThan(70);
    const p = home.exitPoint();
    const c = world.addClonk(p.x, p.y, 0);
    run(world, 40);
    expect(c.action.name).toBe('Walk');
    tap(world, UP);
    expect(c.contained).toBe(home);
  });
});
