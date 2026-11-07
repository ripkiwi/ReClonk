import { describe, expect, it } from 'vitest';
import { generateMap } from '../landscape/generate';
import { createProfile, hireClonk, type KeyValueStore } from './profiles';
import { LOCAL_PLAYER, startRound } from './round';
import { deleteScenario, loadScenarios, saveEdit, saveScenarios } from './scenarioStore';
import { DEFAULT_BASE, isOriginal, landscapeSize, normalizeScenario, SCENARIOS, scenarioById, type ScenarioDef } from './scenarios';

function memoryStorage(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const goldMine = (): ScenarioDef => structuredClone(scenarioById('goldmine')!);

describe('Scenario settings', () => {
  it('editing an original saves a copy with the changes; the original stays as it is', () => {
    const own: ScenarioDef[] = [];
    const edited = goldMine();
    edited.landscape.mapWidth.std = 200;
    edited.crewSize = 4;
    const saved = saveEdit(own, edited);
    expect(own).toEqual([saved]);
    expect(saved.id).not.toBe('goldmine');
    expect(saved.title).toBe('Gold Mine (copy)');
    expect(saved.basedOn).toBe('goldmine');
    expect(saved.landscape.mapWidth.std).toBe(200);
    expect(saved.crewSize).toBe(4);
    expect(isOriginal(saved)).toBe(false);
    expect(scenarioById('goldmine')!.landscape.mapWidth.std).toBe(80);
    expect(scenarioById('goldmine')!.crewSize).toBe(1);
  });

  it('an unchanged copy makes exactly the same map as the original', () => {
    const s = goldMine();
    const copy = saveEdit([], s);
    const a = generateMap(s.landscape, s.seed);
    const b = generateMap(copy.landscape, copy.seed);
    expect(b.items).toEqual(a.items);
    expect(b.land.cells).toEqual(a.land.cells);
  });

  it('keeps a new name for the copy', () => {
    const own: ScenarioDef[] = [];
    expect(saveEdit(own, { ...goldMine(), title: 'Deep Mine' }).title).toBe('Deep Mine');
  });

  it('editing your own scenario changes it in place', () => {
    const own: ScenarioDef[] = [];
    const copy = saveEdit(own, goldMine());
    const again = saveEdit(own, { ...copy, seed: 77, homeBase: false });
    expect(own).toHaveLength(1);
    expect(again.id).toBe(copy.id);
    expect(own[0].seed).toBe(77);
    expect(own[0].homeBase).toBe(false);
    expect(own[0].basedOn).toBe('goldmine');
  });

  it('saves, loads and deletes your scenarios, and survives corrupt data', () => {
    const storage = memoryStorage();
    const own: ScenarioDef[] = [];
    const a = saveEdit(own, goldMine());
    const b = saveEdit(own, structuredClone(scenarioById('minor-melee')!));
    saveScenarios(storage, own);
    expect(loadScenarios(storage)).toEqual([a, b]);
    deleteScenario(own, a.id);
    saveScenarios(storage, own);
    expect(loadScenarios(storage).map((s) => s.id)).toEqual([b.id]);
    storage.data.set('reclonk.scenarios.v1', '{oops');
    expect(loadScenarios(storage)).toEqual([]);
  });

  it('keeps every setting in range and fills in what is missing', () => {
    const s = normalizeScenario(
      {
        id: 'x',
        seed: -4,
        crewSize: 40,
        startItems: ['dynamite' as never, 'rock'],
        landscape: {
          mapWidth: { std: 9999, rnd: 0, min: 64, max: 250 },
          mapZoom: { std: 1, rnd: 0, min: 0, max: 99 },
          amplitude: { std: 50, rnd: -3, min: 60, max: 40 },
          layers: [{ name: 'Gold', count: 500 }, { name: 'Lava', count: 5 }, { name: 'Rock-Ridge', count: 3 }],
          inEarth: { flint: 1e6, rock: -3, gold: 2 },
          material: 'Cheese',
        } as never,
        base: { wealth: Number.NaN, stock: { flint: 500, clonk: 2 } },
      },
      goldMine(),
    );
    expect(s.seed).toBe(0);
    expect(s.crewSize).toBe(12);
    expect(s.startItems).toEqual(['rock']);
    expect(s.title).toBe('Gold Mine');
    const l = s.landscape;
    expect(l.mapWidth).toEqual({ std: 250, rnd: 0, min: 64, max: 250 });
    expect(l.mapZoom).toEqual({ std: 5, rnd: 0, min: 5, max: 15 });
    // A range the wrong way round becomes an empty one at its minimum.
    expect(l.amplitude).toEqual({ std: 60, rnd: 0, min: 60, max: 60 });
    expect(l.layers).toEqual([{ name: 'Gold', count: 100 }, { name: 'Rock-Ridge', count: 3 }]);
    expect(l.inEarth).toEqual({ flint: 10, rock: 0, gold: 2 });
    expect(l.material).toBe('Earth');
    // Missing values come from the original.
    expect(l.liquidLevel).toEqual(goldMine().landscape.liquidLevel);
    expect(s.base).toEqual({ wealth: 50, stock: { flint: 99, clonk: 2 } });
  });

  it('a scenario saved before the original landscape values keeps its size and surface objects', () => {
    const old = { id: 'old', title: 'Flatland', width: 1400, height: 640, seed: 5, map: { hilliness: 0.1, onSurface: { flint: 20 } }, crewSize: 2 };
    const s = normalizeScenario(old as never, goldMine());
    expect(landscapeSize(s)).toEqual({ width: 1400, height: 640 });
    expect(s.landscape.mapPlayerExtend).toBe(false);
    expect(s.landscape.onSurface).toEqual({ flint: 20 });
    expect(s.newMapEachRound).toBe(false);
    expect(s.seed).toBe(5);
    const map = generateMap(s.landscape, s.seed);
    expect([map.land.width, map.land.height]).toEqual([1400, 640]);
  });

  it('a map gets wider with every crew, up to 4 times', () => {
    const s = goldMine();
    expect(landscapeSize(s).width).toBe(800);
    expect(landscapeSize({ ...s, opponents: 1 }).width).toBe(1600);
    expect(landscapeSize({ ...s, opponents: 3 }).width).toBe(2500);
    expect(generateMap(s.landscape, 1, { players: 2 }).land.width).toBe(1600);
  });

  it('a round uses the settings: home base, gold, stock and crew size', () => {
    const p = createProfile({ profiles: [], activeId: null }, 'Kevin');
    hireClonk(p, ['A']);
    const own: ScenarioDef[] = [];
    const rich = saveEdit(own, { ...goldMine(), crewSize: 2, base: { wealth: 300, stock: { clonk: 1 } } });
    const round = startRound(rich, p, ['A', 'B']);
    expect(round.crew).toHaveLength(2);
    expect(round.world.players.get(LOCAL_PLAYER)).toEqual({ wealth: 300, stock: { clonk: 1 } });

    const noBase = saveEdit(own, { ...goldMine(), homeBase: false });
    expect(startRound(noBase, p, ['A']).world.structures).toHaveLength(0);
  });

  it('the originals are untouched by all of this', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(['goldmine', 'minor-melee']);
    expect(scenarioById('goldmine')!.base).toEqual(DEFAULT_BASE);
    expect(DEFAULT_BASE).toEqual({ wealth: 50, stock: { flint: 5, clonk: 3 } });
  });
});
