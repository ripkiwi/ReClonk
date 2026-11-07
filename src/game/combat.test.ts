import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { sval } from '../landscape/mapCreator';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { ENERGY_UNIT } from '../objects/defs';
import { CrewAI } from './ai';
import { applyRoundResults, createProfile, hireClonk } from './profiles';
import { LOCAL_PLAYER, roundResults, startRound } from './round';
import { scenarioById, type ScenarioDef } from './scenarios';
import { World, type WorldEvent } from './world';

/** A flat test world: sky on top, earth from row `ground` down. */
function flatWorld(w = 200, h = 120, ground = 80): World {
  const land = new Landscape(w, h);
  for (let y = ground; y < h; y++) for (let x = 0; x < w; x++) land.set(x, y, Mat.Earth);
  return new World(land, new Rng(1));
}

/** Player 0 holds `ctrl`; everyone else does nothing (or follows their brain). */
function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

function press(world: World, ctrl: Partial<ControlState>): void {
  run(world, 1, ctrl);
}

const ofType = <T extends WorldEvent['type']>(w: World, type: T) =>
  w.events.filter((e): e is Extract<WorldEvent, { type: T }> => e.type === type);

function member(c: Clonk, rank = 0): void {
  c.join({ memberId: `m${c.id}`, name: `Clonk ${c.id}`, rank, experience: 0, gained: 0, controlCount: 0, portrait: 1 });
}

const scenario = (id: string, changes: Partial<ScenarioDef> = {}): ScenarioDef => ({ ...structuredClone(scenarioById(id)!), ...changes });

function profileWithCrew(n: number) {
  const p = createProfile({ profiles: [], activeId: null }, 'Kevin');
  for (let i = 0; i < n; i++) hireClonk(p, [`C${i}`]);
  return p;
}

describe('Thrown objects', () => {
  it('a fast rock hurts the clonk it hits and flings it the way it flies', () => {
    const w = flatWorld();
    const a = w.addClonk(40, 70, 0);
    const b = w.addClonk(100, 70, 1);
    run(w, 30);
    const before = b.energy;
    const rock = w.spawnItem('rock', 94, 66, 5, -1);
    rock.thrownBy = a.id;
    run(w, 2);
    expect(ofType(w, 'hit').length).toBeGreaterThan(0);
    expect(b.energy).toBeLessThan(before);
    expect(b.action.name).toBe('Tumble');
    expect(b.xdir).toBeGreaterThan(0);
    expect(b.lastHurtBy).toBe(a);
  });

  it('a slow object does nothing', () => {
    const w = flatWorld();
    const b = w.addClonk(100, 70, 1);
    run(w, 30);
    w.spawnItem('rock', 96, 66, 1, 0);
    run(w, 2);
    expect(ofType(w, 'hit')).toHaveLength(0);
    expect(b.energy).toBe(b.maxEnergy);
  });

  it('the thrower is not hit by what it just threw, even jumping after it', () => {
    const w = flatWorld();
    const a = w.addClonk(100, 70, 0);
    run(w, 30);
    w.give(a, 'rock');
    press(w, { pressedThrow: true });
    press(w, { up: true, pressedUp: true });
    run(w, 40);
    expect(ofType(w, 'hit')).toHaveLength(0);
    expect(a.energy).toBe(a.maxEnergy);
  });
});

describe('Fist fights', () => {
  /** Two clonks of different crews, walked into each other. */
  function brawl(sameCrew = false): { w: World; a: Clonk; b: Clonk } {
    const w = flatWorld();
    const a = w.addClonk(80, 70, 0);
    const b = w.addClonk(110, 70, sameCrew ? 0 : 1);
    run(w, 30);
    for (let i = 0; i < 60 && a.action.procedure !== 'fight'; i++) {
      if (sameCrew) w.cursor(0).selected.delete(b);
      run(w, 1, { right: true });
    }
    return { w, a, b };
  }

  it('enemies who walk into each other start fighting', () => {
    const { a, b } = brawl();
    expect(a.action.procedure).toBe('fight');
    expect(b.action.procedure).toBe('fight');
    expect(a.fightTarget).toBe(b);
    expect(b.fightTarget).toBe(a);
  });

  it('clonks of the same crew do not', () => {
    const { a } = brawl(true);
    expect(a.action.procedure).not.toBe('fight');
  });

  it('a punch between equals costs 5 energy', () => {
    const { w, a, b } = brawl();
    const total = a.energy + b.energy;
    w.events.length = 0;
    run(w, 36 * 8);
    const punches = ofType(w, 'punch').length;
    expect(punches).toBeGreaterThan(0);
    expect(total - a.energy - b.energy).toBe(punches * 5 * ENERGY_UNIT);
    expect(ofType(w, 'swing').length).toBeGreaterThanOrEqual(punches);
  });

  it('E swings a punch, down walks away', () => {
    const { w, a } = brawl();
    for (let i = 0; i < 80 && !(a.action.name === 'Fight' && a.phase >= 2); i++) run(w, 1);
    expect(a.action.name).toBe('Fight');
    press(w, { pressedThrow: true });
    expect(a.action.name).toBe('Punch');
    for (let i = 0; i < 40 && a.action.name !== 'Fight'; i++) run(w, 1);
    press(w, { down: true, pressedDown: true });
    expect(a.action.procedure).toBe('walk');
    expect(a.fightTarget).toBe(null);
  });

  it('a stronger fighter hits harder', () => {
    const w = flatWorld();
    const a = w.addClonk(80, 70, 0);
    const b = w.addClonk(110, 70, 1);
    member(a, 10);
    member(b, 0);
    run(w, 30);
    for (let i = 0; i < 60 && a.action.procedure !== 'fight'; i++) run(w, 1, { right: true });
    const before = b.energy;
    w.events.length = 0;
    for (let i = 0; i < 36 * 20 && !ofType(w, 'punch').some((e) => e.clonk === a); i++) run(w, 1);
    const hit = ofType(w, 'punch').find((e) => e.clonk === a);
    expect(hit).toBeDefined();
    expect(before - b.energy).toBeGreaterThan(5 * ENERGY_UNIT);
  });
});

describe('Knockouts and the last crew standing', () => {
  it('the enemy who hurt a clonk gets the knockout, even if it finishes itself off', () => {
    const w = flatWorld();
    const a = w.addClonk(40, 70, 0);
    const b = w.addClonk(100, 70, 1);
    member(a);
    member(b);
    run(w, 10);
    w.hurt(b, 10, a);
    w.hurt(b, 100, b);
    run(w, 1);
    const deaths = ofType(w, 'death');
    expect(deaths).toHaveLength(1);
    expect(deaths[0].killer).toBe(a);
    expect(a.info!.kills).toBe(1);
  });

  it('knockouts are counted in the round results and the crew', () => {
    const p = profileWithCrew(3);
    const round = startRound(scenario('minor-melee'), p);
    round.crew[0].info!.kills = 2;
    const results = roundResults(round);
    expect(results[0].kills).toBe(2);
    applyRoundResults(p, results);
    applyRoundResults(p, results);
    expect(p.crew.find((m) => m.id === results[0].memberId)!.kills).toBe(4);
  });

  it('a crew with nobody left is out, and the last crew standing wins', () => {
    const round = startRound(scenario('minor-melee', { opponents: 2 }), profileWithCrew(3));
    const w = round.world;
    expect(round.players.map((p) => p.computer)).toEqual([false, true, true]);
    for (const c of w.crewOf(1)) w.hurt(c, 1000, null);
    run(w, 1);
    expect([...w.eliminated]).toEqual([1]);
    expect(w.winner).toBe(null);
    for (const c of w.crewOf(2)) w.hurt(c, 1000, null);
    run(w, 1);
    expect(w.winner).toBe(LOCAL_PLAYER);
    expect(ofType(w, 'gameOver')).toEqual([expect.objectContaining({ winner: LOCAL_PLAYER })]);
  });

  it('without that goal, the round goes on', () => {
    const round = startRound(scenario('minor-melee', { goal: 'none' }), profileWithCrew(3));
    for (const c of round.world.crewOf(1)) round.world.hurt(c, 1000, null);
    run(round.world, 1);
    expect(round.world.winner).toBe(null);
    expect(round.world.eliminated.size).toBe(0);
  });

  it('two computer crews fight it out until one is left', () => {
    const round = startRound(scenario('minor-melee'), profileWithCrew(3));
    const w = round.world;
    w.brains.set(LOCAL_PLAYER, new CrewAI(w, LOCAL_PLAYER));
    let throws = 0;
    for (let t = 0; t < 36 * 150 && w.winner === null; t++) {
      run(w, 1);
      throws += ofType(w, 'throw').length;
      w.events.length = 0;
    }
    expect(throws).toBeGreaterThan(0);
    expect(w.winner).not.toBe(null);
  }, 60000);
});

describe('Crews', () => {
  it('higher ranks have more energy, up to twice as much', () => {
    const w = flatWorld();
    const [a, b, c] = [w.addClonk(40, 70, 0), w.addClonk(80, 70, 0), w.addClonk(120, 70, 0)];
    member(a, 0);
    member(b, 4);
    member(c, 15);
    expect(a.maxEnergy).toBe(50 * ENERGY_UNIT);
    expect(b.maxEnergy).toBe(70 * ENERGY_UNIT);
    expect(c.maxEnergy).toBe(100 * ENERGY_UNIT);
    expect(c.energy).toBe(c.maxEnergy);
  });

  it('computer crews start as strong as the player', () => {
    const p = profileWithCrew(3);
    p.crew[0].rank = 5;
    const round = startRound(scenario('minor-melee'), p);
    const ranks = (player: number) => round.world.crewOf(player).map((c) => c.info!.rank).sort();
    expect(ranks(1)).toEqual(ranks(LOCAL_PLAYER));
    expect(round.world.crewOf(1).every((c) => c.info!.name)).toBe(true);
  });

  it('the door of an enemy base stays shut', () => {
    const round = startRound(scenario('goldmine', { opponents: 1 }), profileWithCrew(1));
    const w = round.world;
    const enemyHut = w.structures.find((s) => s.base === 1)!;
    expect(enemyHut).toBeDefined();
    // The computer crew waits inside, out of the way.
    w.brains.delete(1);
    for (const e of w.crewOf(1)) e.contained = enemyHut;
    const c = round.crew[0];
    const at = enemyHut.exitPoint();
    c.setPosition(at.x, at.y);
    run(w, 20);
    press(w, { up: true, pressedUp: true });
    expect(c.contained).toBe(null);
    expect(w.messages.map((m) => m.text)).toContain('Enemy base: the door stays shut');
  });
});

describe('Lakes', () => {
  it('a clonk can always swim out of the lake', () => {
    const s = scenario('goldmine');
    // Hills and a water level that fills the valleys with lakes.
    s.landscape.amplitude = sval(40);
    s.landscape.period = sval(15);
    s.landscape.liquidLevel = sval(50);
    for (const seed of [1337, 4242, 777, 1, 2, 3]) {
      for (const side of [-1, 1]) {
        const round = startRound(s, profileWithCrew(1), [], seed);
        const w = round.world;
        // A lake with a bank on both sides (not one that runs into the edge of the map).
        const lakeTop = (x: number): number => {
          for (let y = 0; y < w.land.height; y++) {
            if (w.land.isLiquid(x, y)) return y;
            if (w.land.isSolid(x, y)) return -1;
          }
          return -1;
        };
        let lx = -1;
        let rx = -1;
        for (let x = 1; x < w.land.width && rx < 0; x++) {
          if (lakeTop(x) < 0 || lakeTop(x - 1) >= 0) continue;
          let end = x;
          while (end < w.land.width && lakeTop(end) >= 0) end++;
          if (end < w.land.width && end - x > 40) [lx, rx] = [x, end];
        }
        expect(lx).toBeGreaterThanOrEqual(0);
        const c = round.crew[0];
        c.setPosition(Math.floor((lx + rx) / 2), lakeTop(lx) + 3);
        c.setAction('Swim');
        let out = false;
        for (let t = 0; t < 36 * 30 && !out; t++) {
          run(w, 1, { left: side < 0, right: side > 0, up: true, pressedUp: t % 20 === 0 });
          out = c.action.procedure === 'walk' && !w.land.isLiquid(c.x, c.y + 11);
        }
        expect(out, `seed ${seed}, swimming ${side < 0 ? 'left' : 'right'}`).toBe(true);
      }
    }
  });
});

describe('Getting stuck', () => {
  it('a clonk flung against a lump of earth does not hang in mid-air for ever', () => {
    const w = flatWorld();
    // A floating lump with an edge that hooks the clonk's head (found in a real match).
    const lump: [number, number, number][] = [[-10, 1, 2], [-9, 1, 3], [-8, 1, 5], [-7, 1, 4], [-6, 0, 3], [-5, 0, 1], [-4, 0, 0]];
    for (const [dy, x0, x1] of lump) for (let dx = x0; dx <= x1; dx++) w.land.set(100 + dx, 40 + dy, Mat.Earth);
    const c = w.addClonk(100, 40, 0);
    c.setAction('Tumble', 0, 0);
    run(w, 100);
    expect(c.y).toBe(70);
  });
});

