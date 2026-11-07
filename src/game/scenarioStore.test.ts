import { describe, expect, it } from 'vitest';
import { generateMap } from '../landscape/generate';
import { createProfile, hireClonk, type KeyValueStore } from './profiles';
import { LOCAL_PLAYER, startRound } from './round';
import { deleteScenario, loadScenarios, saveEdit, saveScenarios } from './scenarioStore';
import { isOriginal, mapOptions, normalizeScenario, SCENARIOS, scenarioById, type ScenarioDef } from './scenarios';

function memoryStorage(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const goldMine = (): ScenarioDef => structuredClone(scenarioById('goldmine')!);

describe('Scenario settings', () => {
  it('editing an original saves a copy with the changes; the original stays as it is', () => {
    const own: ScenarioDef[] = [];
    const edited = { ...goldMine(), width: 2000, crewSize: 4 };
    const saved = saveEdit(own, edited);
    expect(own).toEqual([saved]);
    expect(saved.id).not.toBe('goldmine');
    expect(saved.title).toBe('Gold Mine (copy)');
    expect(saved.basedOn).toBe('goldmine');
    expect(saved.width).toBe(2000);
    expect(saved.crewSize).toBe(4);
    expect(isOriginal(saved)).toBe(false);
    expect(scenarioById('goldmine')!.width).toBe(1400);
    expect(scenarioById('goldmine')!.crewSize).toBe(1);
  });

  it('an unchanged copy makes exactly the same map as the original', () => {
    const s = goldMine();
    const copy = saveEdit([], { ...s, map: mapOptions(s) });
    const a = generateMap(s.width, s.height, s.seed, s.map);
    const b = generateMap(copy.width, copy.height, copy.seed, copy.map);
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
        width: 50,
        height: 99999,
        seed: -4,
        crewSize: 40,
        startItems: ['dynamite' as never, 'rock'],
        map: { hilliness: 9, lake: false, buried: { flint: 1e6, rock: -3, gold: 2 } },
        base: { wealth: Number.NaN, stock: { flint: 500, clonk: 2 } },
      },
      goldMine(),
    );
    expect(s.width).toBe(400);
    expect(s.height).toBe(1000);
    expect(s.seed).toBe(0);
    expect(s.crewSize).toBe(12);
    expect(s.startItems).toEqual(['rock']);
    expect(s.title).toBe('Gold Mine');
    expect(s.map.hilliness).toBe(2);
    expect(s.map.lake).toBe(false);
    expect(s.map.buried).toEqual({ flint: 200, rock: 0, gold: 2 });
    expect(s.base).toEqual({ wealth: 25, stock: { flint: 99, clonk: 2 } });
  });

  it('spells out the full map settings of a scenario', () => {
    const m = mapOptions(scenarioById('minor-melee')!);
    expect(m.lake).toBe(false);
    expect(m.buried.flint).toBe(90);
    expect(m.onSurface.flint).toBe(45);
    expect(mapOptions(goldMine()).hilliness).toBe(1);
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
    expect(scenarioById('goldmine')!.base).toEqual({ wealth: 25, stock: { flint: 10, rock: 10, clonk: 5 } });
  });
});
