import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { ITEMS } from '../objects/defs';
import type { Item } from '../objects/item';
import { incinerate } from './fire';
import { buildOnSurface } from './homeBase';
import { World } from './world';

const GROUND = 120;
const UP = { up: true, pressedUp: true };
const THROW = { pressedThrow: true };

/** Players 0 and 1, each with a home base, and an ordinary hut between them. */
function twoBases() {
  const land = new Landscape(700, 260);
  for (let y = GROUND; y < 260; y++) for (let x = 0; x < 700; x++) land.set(x, y, Mat.Earth);
  const world = new World(land, new Rng(1));
  const me = world.addPlayer(0, { wealth: 10, stock: {} });
  const them = world.addPlayer(1, { wealth: 10, stock: {} });
  const mine = buildOnSurface(world, 'hut', 100, 0);
  const free = buildOnSurface(world, 'hut', 350, -1);
  const theirs = buildOnSurface(world, 'hut', 600, 1);
  return { world, me, them, mine, free, theirs };
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}, player = 0): void {
  const controls = new Map([[player, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

/** Put a clonk in a building's doorway and let it settle. */
function atDoor(world: World, s: { exitPoint(): { x: number; y: number } }, owner: number): Clonk {
  const p = s.exitPoint();
  const c = world.addClonk(p.x, p.y, owner);
  run(world, 20);
  return c;
}

function carry(c: Clonk, flag: Item): void {
  flag.container = c;
  flag.xdir = flag.ydir = 0;
  c.contents.push(flag);
}

describe('Flags', () => {
  it('a flag is worth 100 gold and can be bought again once sold (Flag.c4d Value=100, Rebuy=1)', () => {
    expect(ITEMS.flag.value).toBe(100);
    expect(ITEMS.flag.rebuy).toBe(true);
  });

  it("when a base burns its flag falls off as a loose flag in its owner's colour", () => {
    const { world, theirs } = twoBases();
    incinerate(world, theirs, null, true);
    expect(theirs.hasFlag).toBe(false);
    const flag = world.items.find((i) => i.def.id === 'flag')!;
    expect(flag).toBeDefined();
    expect(flag.owner).toBe(1);
    run(world, 120);
    // It lands on the ground next to the ruin.
    expect(Math.abs(flag.x - theirs.x)).toBeLessThan(30);
    expect(flag.y).toBeGreaterThan(GROUND - 15);
    expect(flag.y).toBeLessThanOrEqual(GROUND);
  });

  it('an enemy clonk can pick up the dropped flag and sell it at home for 100 gold', () => {
    const { world, me, theirs, mine } = twoBases();
    incinerate(world, theirs, null, true);
    run(world, 120);
    const flag = world.items.find((i) => i.def.id === 'flag')!;
    // My clonk walks over the fallen flag and grabs it.
    const thief = world.addClonk(flag.x, GROUND - 10, 0);
    run(world, 5);
    expect(thief.carrying).toBe(flag);
    // It still belongs to player 1: picking things up doesn't change their owner.
    expect(flag.owner).toBe(1);
    // Back home, throw sells it.
    const p = mine.exitPoint();
    thief.setPosition(p.x, p.y);
    run(world, 5);
    run(world, 1, UP);
    expect(thief.contained).toBe(mine);
    run(world, 1, THROW);
    expect(thief.carrying).toBeUndefined();
    expect(me.wealth).toBe(110);
    expect(me.stock.flag).toBe(1);
    expect(world.messages.map((m) => m.text)).toContain('Sold Flag for 100 gold');
  });

  it('carrying your flag into a building without one makes it your home base (with the trumpet)', () => {
    const { world, free } = twoBases();
    const c = atDoor(world, free, 0);
    const flag = world.spawnItem('flag', c.x, c.y);
    flag.owner = 0;
    carry(c, flag);
    run(world, 1, UP);
    expect(c.contained).toBe(free);
    // Not a base yet: nothing to buy.
    expect(world.inOwnBase(c)).toBe(false);
    run(world, 1, THROW);
    expect(free.base).toBe(0);
    expect(free.hasFlag).toBe(true);
    expect(flag.removed).toBe(true);
    expect(world.inOwnBase(c)).toBe(true);
    expect(world.events.some((e) => e.type === 'newBase' && e.structure === free && e.player === 0)).toBe(true);
  });

  it("a stolen flag makes the building its owner's base, not the thief's, like the original", () => {
    const { world, free } = twoBases();
    const c = atDoor(world, free, 0);
    const flag = world.spawnItem('flag', c.x, c.y);
    flag.owner = 1;
    carry(c, flag);
    run(world, 1, UP);
    run(world, 1, THROW);
    expect(free.base).toBe(1);
    // The thief is now inside an enemy base, so out it goes.
    expect(c.contained).toBeNull();
  });

  it("a flag can't go on a building that has one, or on one that can't be a base", () => {
    const { world, free } = twoBases();
    const tower = buildOnSurface(world, 'tower', 230, -1);
    const c = atDoor(world, tower, 0);
    const flag = world.spawnItem('flag', c.x, c.y);
    flag.owner = 0;
    carry(c, flag);
    run(world, 1, UP);
    expect(c.contained).toBe(tower);
    run(world, 1, THROW);
    expect(tower.base).toBe(-1);
    expect(c.carrying).toBe(flag);
    expect(world.messages.map((m) => m.text)).toContain('No flag can go on this building');
    free.base = 1;
    const d = atDoor(world, free, 1);
    const other = world.spawnItem('flag', d.x, d.y);
    other.owner = 1;
    carry(d, other);
    run(world, 1, UP, 1);
    expect(d.contained).toBe(free);
    // In your own base, throw sells it instead.
    run(world, 1, THROW, 1);
    expect(world.players.get(1)!.wealth).toBe(110);
  });

  it('a flag you buy is yours', () => {
    const { world, me, mine } = twoBases();
    me.wealth = 100;
    me.stock.flag = 1;
    const c = atDoor(world, mine, 0);
    run(world, 1, UP);
    run(world, 1, UP);
    expect(c.menu).toBe(0);
    run(world, 1, THROW);
    expect(c.carrying?.def.id).toBe('flag');
    expect(c.carrying?.owner).toBe(0);
    expect(me.wealth).toBe(0);
  });

  it('a flag floats up in water (Float=1)', () => {
    const land = new Landscape(100, 100);
    for (let y = 40; y < 100; y++) for (let x = 0; x < 100; x++) land.set(x, y, y < 90 ? Mat.Water : Mat.Earth);
    const world = new World(land, new Rng(1));
    const flag = world.spawnItem('flag', 50, 80);
    for (let i = 0; i < 200; i++) world.step(new Map());
    expect(flag.y).toBeLessThan(45);
  });
});
