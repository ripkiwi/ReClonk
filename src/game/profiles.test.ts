import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import {
  applyRoundResults,
  createProfile,
  crewForRound,
  deleteProfile,
  hireClonk,
  loadProfiles,
  ROUND_BONUS,
  saveProfiles,
  type KeyValueStore,
  type ProfileStore,
} from './profiles';

const NAMES = ['Alfons', 'Balder', 'Clifton', 'Durin'];

function memoryStorage(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function newStore(): ProfileStore {
  return { profiles: [], activeId: null };
}

describe('profiles', () => {
  it('starts a new player with two clonks with different names, and makes it active', () => {
    const store = newStore();
    const p = createProfile(store, '  Kevin ', NAMES, new Rng(1));
    expect(p.name).toBe('Kevin');
    expect(store.activeId).toBe(p.id);
    expect(p.crew).toHaveLength(2);
    expect(p.crew[0].name).not.toBe(p.crew[1].name);
    for (const m of p.crew) {
      expect(NAMES).toContain(m.name);
      expect(m.rank).toBe(0);
      expect(m.portrait).toBeGreaterThanOrEqual(1);
      expect(m.portrait).toBeLessThanOrEqual(5);
    }
    expect(p.controlStyle).toBe('jumpAndRun');
  });

  it('hires more clonks, preferring names not taken yet', () => {
    const store = newStore();
    const p = createProfile(store, 'Kevin', NAMES, new Rng(2));
    hireClonk(p, NAMES, new Rng(3));
    hireClonk(p, NAMES, new Rng(4));
    expect(new Set(p.crew.map((m) => m.name)).size).toBe(4);
  });

  it('saves and loads, and survives corrupt data', () => {
    const storage = memoryStorage();
    const store = newStore();
    createProfile(store, 'Kevin', NAMES);
    saveProfiles(storage, store);
    const loaded = loadProfiles(storage);
    expect(loaded.profiles[0].name).toBe('Kevin');
    expect(loaded.profiles[0].crew).toHaveLength(2);

    storage.data.set('reclonk.profiles.v1', '{not json');
    expect(loadProfiles(storage)).toEqual({ profiles: [], activeId: null });
  });

  it('deletes a profile and picks another active one', () => {
    const store = newStore();
    const a = createProfile(store, 'A', NAMES);
    const b = createProfile(store, 'B', NAMES);
    expect(store.activeId).toBe(b.id);
    deleteProfile(store, b.id);
    expect(store.activeId).toBe(a.id);
    deleteProfile(store, a.id);
    expect(store.activeId).toBeNull();
  });

  it('sends the most experienced clonks that take part', () => {
    const store = newStore();
    const p = createProfile(store, 'Kevin', NAMES, new Rng(5));
    hireClonk(p, NAMES, new Rng(6));
    p.crew[0].experience = 10;
    p.crew[1].experience = 500;
    p.crew[2].experience = 200;
    expect(crewForRound(p, 1).map((m) => m.experience)).toEqual([500]);
    expect(crewForRound(p, 2).map((m) => m.experience)).toEqual([500, 200]);
    p.crew[1].participates = false;
    expect(crewForRound(p, 1).map((m) => m.experience)).toEqual([200]);
    // With everybody benched, somebody still has to go.
    for (const m of p.crew) m.participates = false;
    expect(crewForRound(p, 1).map((m) => m.experience)).toEqual([500]);
  });

  it('writes round results back and reports promotions', () => {
    const store = newStore();
    const p = createProfile(store, 'Kevin', NAMES, new Rng(7));
    const [a, b] = p.crew;
    a.experience = 950;
    const promotions = applyRoundResults(p, [
      { memberId: a.id, experienceGained: 20, controlCount: 42 },
      { memberId: b.id, experienceGained: 0, controlCount: 3 },
    ]);
    expect(a.experience).toBe(950 + 20 + ROUND_BONUS);
    expect(a.rank).toBe(1);
    expect(a.rounds).toBe(1);
    expect(a.controlCount).toBe(42);
    expect(b.experience).toBe(ROUND_BONUS);
    expect(b.rank).toBe(0);
    expect(p.rounds).toBe(1);
    expect(promotions).toEqual([{ member: a, from: 0, to: 1 }]);
  });
});
