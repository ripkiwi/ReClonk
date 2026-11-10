import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { STRUCTURES } from '../objects/defs';
import { extinguish, incinerate } from './fire';
import { buildOnSurface } from './homeBase';
import { createProfile, hireClonk } from './profiles';
import { startRound } from './round';
import { captainOf, hasBase, hasFlag, LATER_RULES, RULE_IDS, RULES } from './rules';
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
    expect(RULE_IDS).toEqual(['constructionMaterial', 'captureTheFlag', 'lossOfBase', 'killTheCaptain']);
    for (const id of RULE_IDS) expect(RULES[id].icon).toMatch(/^rules\/\w+\.png$/);
    expect(LATER_RULES.map((r) => r.name)).toContain('Flag removeable');
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
  for (const rule of ['captureTheFlag', 'lossOfBase'] as const) {
    it(`${RULES[rule].name}: a player whose base burns down is out, and the other wins`, () => {
      const world = flatWorld([rule]);
      const mine = buildOnSurface(world, 'hut', 120, 0);
      buildOnSurface(world, 'hut', 480, 1);
      const me = clonk(world, 200);
      const foe = clonk(world, 400, 1);
      expect(hasFlag(world, 0) && hasBase(world, 1)).toBe(true);
      expect(eliminatedIn(world, 80)).toEqual([]);
      incinerate(world, mine, foe, true);
      expect(hasFlag(world, 0)).toBe(false);
      expect(eliminatedIn(world, 40)).toEqual([0]);
      expect(me.alive).toBe(false);
      expect(foe.alive).toBe(true);
      expect(world.winner).toBe(1);
    });
  }

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
    expect(hut.hasFlag).toBe(true);
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
