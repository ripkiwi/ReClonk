import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { STRUCTURES } from '../objects/defs';
import type { Structure } from '../objects/structure';
import { extinguish, incinerate } from './fire';
import { buildOnSurface } from './homeBase';
import { createProfile, hireClonk } from './profiles';
import { startRound } from './round';
import { captainOf, flagsRemoveable, hasBase, hasFlag, LATER_RULES, RULE_IDS, RULES } from './rules';
import { normalizeScenario, scenarioById } from './scenarios';
import { World } from './world';

const GROUND = 100;

function flatWorld(rules: readonly (keyof typeof RULES)[] = []): World {
  const land = new Landscape(600, 260);
  for (let y = GROUND; y < 260; y++) for (let x = 0; x < 600; x++) land.set(x, y, Mat.Earth);
  const world = new World(land, new Rng(1));
  world.addPlayer(0, { wealth: 100, stock: { conkit: 5 } });
  world.addPlayer(1, { wealth: 100, stock: {} });
  for (const r of rules) world.rules.add(r);
  return world;
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}
const DOWN = { down: true, pressedDown: true };

function clonk(world: World, x: number, owner = 0): Clonk {
  const c = world.addClonk(x, GROUND - 10, owner);
  run(world, 10);
  return c;
}

function eliminatedIn(world: World, ticks: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    world.events.length = 0;
    run(world, 1);
    for (const e of world.events) if (e.type === 'eliminated') out.push(e.player);
  }
  return out;
}

describe('Rules', () => {
  it('the four rules we have and the original’s others, each with its picture', () => {
    expect(RULE_IDS).toEqual(['constructionMaterial', 'flagRemoveable', 'captureTheFlag', 'lossOfBase', 'killTheCaptain']);
    for (const id of RULE_IDS) expect(RULES[id].icon).toMatch(/^rules\/\w+\.png$/);
    expect(LATER_RULES.map((r) => r.name)).toContain('Power usage');
    expect(LATER_RULES.every((r) => r.needs && r.icon.startsWith('rules/'))).toBe(true);
  });

  it('without rules nothing changes: no base, no flag, nobody is out', () => {
    const world = flatWorld();
    clonk(world, 100);
    clonk(world, 400, 1);
    expect(eliminatedIn(world, 200)).toEqual([]);
    expect(world.winner).toBeNull();
  });
});

describe('Capture The Flag and Loss of Base', () => {
  it('Loss of Base: a player whose base burns down is out, and the other wins', () => {
    const world = flatWorld(['lossOfBase']);
    const mine = buildOnSurface(world, 'hut', 120, 0);
    buildOnSurface(world, 'hut', 480, 1);
    const me = clonk(world, 200);
    const foe = clonk(world, 400, 1);
    expect(hasBase(world, 0) && hasBase(world, 1)).toBe(true);
    expect(eliminatedIn(world, 80)).toEqual([]);
    incinerate(world, mine, foe, true);
    expect(hasBase(world, 0)).toBe(false);
    expect(eliminatedIn(world, 40)).toEqual([0]);
    expect(me.alive).toBe(false);
    expect(foe.alive).toBe(true);
    expect(world.winner).toBe(1);
  });

  it('Capture The Flag: a burned base isn’t the end while its fallen flag is still about', () => {
    const world = flatWorld(['captureTheFlag']);
    const mine = buildOnSurface(world, 'hut', 120, 0);
    buildOnSurface(world, 'hut', 480, 1);
    clonk(world, 300);
    const foe = clonk(world, 400, 1);
    incinerate(world, mine, foe, true);
    expect(hasBase(world, 0)).toBe(false);
    expect(hasFlag(world, 0)).toBe(true);
    expect(eliminatedIn(world, 80)).toEqual([]);
    // The flag is gone for good: out.
    world.items.find((i) => i.def.id === 'flag')!.removed = true;
    expect(eliminatedIn(world, 40)).toEqual([0]);
  });

  it('a player without any base is out at once', () => {
    const world = flatWorld(['lossOfBase']);
    buildOnSurface(world, 'hut', 480, 1);
    const me = clonk(world, 200);
    const foe = clonk(world, 400, 1);
    run(world, 40);
    expect([...world.eliminated]).toEqual([0]);
    expect(me.alive).toBe(false);
    expect(foe.alive).toBe(true);
  });
});

describe('Flag removeable', () => {
  /** A clonk of `owner` dropped onto the flag on a building's roof. */
  const atFlag = (world: World, s: Structure, owner: number): Clonk => {
    const c = world.addClonk(s.x + s.def.flagVertex.x, s.y + s.def.flagVertex.y, owner);
    run(world, 3);
    return c;
  };

  it('without the rule a flag stays on its building, whoever touches it', () => {
    const world = flatWorld();
    const hut = buildOnSurface(world, 'hut', 480, 1);
    const thief = atFlag(world, hut, 0);
    run(world, 30);
    expect(hut.base).toBe(1);
    expect(thief.carrying).toBeUndefined();
  });

  it('with it an enemy who reaches the flag takes it off: the building is no base any more, the flag is still its owner’s', () => {
    const world = flatWorld(['flagRemoveable']);
    const hut = buildOnSurface(world, 'hut', 480, 1);
    const friend = atFlag(world, hut, 1);
    expect(friend.carrying).toBeUndefined();
    expect(hut.base).toBe(1);
    const thief = atFlag(world, hut, 0);
    expect(hut.hasFlag).toBe(false);
    expect(thief.carrying?.def.id).toBe('flag');
    expect(thief.carrying?.owner).toBe(1);
    expect(hasBase(world, 1)).toBe(false);
    expect(hasFlag(world, 1)).toBe(true);
    // The rule alone puts nobody out.
    run(world, 80);
    expect(world.eliminated.size).toBe(0);
  });

  it('a clonk with its hands full can’t take a flag', () => {
    const world = flatWorld(['flagRemoveable']);
    const hut = buildOnSurface(world, 'hut', 480, 1);
    const thief = world.addClonk(hut.x + hut.def.flagVertex.x, hut.y + hut.def.flagVertex.y, 0);
    world.give(thief, 'rock');
    run(world, 3);
    expect(hut.base).toBe(1);
  });

  it('Capture The Flag brings the rule along: steal the flag and sell it, and its owner is out', () => {
    const world = flatWorld(['captureTheFlag']);
    expect(flagsRemoveable(world)).toBe(true);
    const mine = buildOnSurface(world, 'hut', 120, 0);
    const theirs = buildOnSurface(world, 'hut', 480, 1);
    const foe = clonk(world, 400, 1);
    const thief = atFlag(world, theirs, 0);
    const flag = thief.carrying!;
    expect(flag.def.id).toBe('flag');
    // Carrying it off isn't enough: they are still in while the flag exists.
    expect(eliminatedIn(world, 80)).toEqual([]);
    // Home with it, and sell.
    const door = mine.exitPoint();
    thief.setPosition(door.x, door.y);
    run(world, 20);
    run(world, 1, { up: true, pressedUp: true });
    expect(thief.contained).toBe(mine);
    const wealth = world.players.get(0)!.wealth;
    run(world, 1, { pressedThrow: true });
    run(world, 1, { pressedDig: true });
    run(world, 1, { pressedThrow: true });
    expect(flag.removed).toBe(true);
    expect(world.players.get(0)!.wealth).toBe(wealth + 100);
    expect(eliminatedIn(world, 40)).toEqual([1]);
    expect(foe.alive).toBe(false);
    expect(world.winner).toBe(0);
  });
});

describe('Kill The Captain', () => {
  it('the highest ranking clonk is the captain; when it dies the whole crew is out', () => {
    const world = flatWorld();
    const a = clonk(world, 100);
    const b = clonk(world, 140);
    a.join({ memberId: 'a', name: 'Anna', rank: 1, experience: 0, portrait: 1, kind: 'clonk' } as never);
    b.join({ memberId: 'b', name: 'Bert', rank: 4, experience: 0, portrait: 1, kind: 'clonk' } as never);
    const foe = clonk(world, 400, 1);
    world.rules.add('killTheCaptain');
    expect(captainOf(world, 0)).toBe(b);
    expect(captainOf(world, 1)).toBe(foe);
    // Losing somebody else changes nothing.
    world.hurt(a, 1e6, foe);
    expect(eliminatedIn(world, 80)).toEqual([]);
    // A later promotion doesn't make a new captain.
    world.hurt(b, 1e6, foe);
    expect(eliminatedIn(world, 40)).toEqual([0]);
    expect(world.winner).toBe(1);
  });
});

describe('Construction Material', () => {
  it('buildings are made of wood and rock', () => {
    expect(STRUCTURES.hut.components).toEqual({ wood: 4, rock: 1 });
    expect(STRUCTURES.elevator.components).toEqual({ wood: 4, rock: 2 });
    expect(STRUCTURES.tower.components).toEqual({ rock: 5, wood: 2 });
  });

  it('without the rule a building needs nothing', () => {
    const world = flatWorld();
    const c = clonk(world, 300);
    world.give(c, 'conkit');
    const s = world.placeSite(c, 'hut')!;
    run(world, 800);
    expect(s.complete).toBe(true);
  });

  it('with the rule the site only grows as far as the material brought to it allows', () => {
    const world = flatWorld(['constructionMaterial']);
    const c = clonk(world, 300);
    world.give(c, 'conkit');
    const s = world.placeSite(c, 'hut')!;
    run(world, 100);
    expect(c.action.name).toBe('Walk');
    expect(s.con).toBeLessThan(2000);
    // Bring it piece by piece: the site takes each out of the clonk's hands.
    const bring = (id: 'wood' | 'rock'): void => {
      world.give(c, id);
      run(world, 1, DOWN);
      run(world, 800);
    };
    bring('wood');
    expect(s.components).toEqual({ wood: 1 });
    expect(c.carrying).toBeUndefined();
    expect(s.complete).toBe(false);
    const quarter = s.con;
    expect(quarter).toBeGreaterThan(0);
    bring('wood');
    bring('wood');
    bring('wood');
    // All the wood is in, but the rock is still missing.
    expect(s.complete).toBe(false);
    expect(s.con).toBeGreaterThanOrEqual(quarter);
    bring('rock');
    expect(s.components).toEqual({ wood: 4, rock: 1 });
    expect(s.complete).toBe(true);
  });

  it('a site doesn’t take what it has no use for', () => {
    const world = flatWorld(['constructionMaterial']);
    const c = clonk(world, 300);
    world.give(c, 'conkit');
    const s = world.placeSite(c, 'hut')!;
    run(world, 50);
    const gold = world.give(c, 'gold');
    run(world, 1, DOWN);
    run(world, 50);
    expect(c.carrying).toBe(gold);
    expect(s.components).toEqual({});
  });

  it('a burned ruin is built back up without new material', () => {
    const world = flatWorld(['constructionMaterial']);
    const hut = buildOnSurface(world, 'hut', 300, 0);
    incinerate(world, hut, null, true);
    run(world, 200);
    extinguish(world, hut);
    const c = clonk(world, 300);
    run(world, 1, { ...DOWN, doubleDown: true });
    expect(c.action.procedure).toBe('build');
    for (let i = 0; i < 2000 && hut.burned; i++) run(world, 1);
    expect(hut.complete).toBe(true);
  });
});

describe('Rules and magic in a scenario', () => {
  it('a scenario carries its rules, spells and sorcerers into the round', () => {
    const base = scenarioById('goldmine')!;
    expect(base.rules).toEqual([]);
    expect(base.magic).toEqual([]);
    expect(base.sorcerers).toBe(0);
    const s = normalizeScenario({ ...base, id: 'x', rules: ['killTheCaptain', 'nonsense'], magic: ['heal', 'wind', 'heal', 'zap'], sorcerers: 2 } as never);
    expect(s.rules).toEqual(['killTheCaptain']);
    expect(s.magic).toEqual(['wind', 'heal']);
    expect(s.sorcerers).toBe(2);
    const profile = createProfile({ profiles: [], activeId: null }, 'Tester');
    hireClonk(profile, ['A'], new Rng(1));
    const round = startRound(s, profile, ['A', 'B', 'C'], 5, ['Merlin', 'Morgana']);
    const { world } = round;
    expect([...world.rules]).toEqual(['killTheCaptain']);
    expect(world.spells).toEqual(['wind', 'heal']);
    const mine = world.crewOf(0);
    expect(mine.filter((c) => c.info?.kind === 'sorcerer')).toHaveLength(2);
    expect(mine.filter((c) => c.maxMagic > 0).map((c) => c.info!.name).sort()).toEqual(['Merlin', 'Morgana']);
    // The new sorcerers joined the crew for good.
    expect(profile.crew.filter((m) => m.kind === 'sorcerer')).toHaveLength(2);
  });
});
