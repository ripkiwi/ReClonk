import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import {
  applyRoundResults,
  createProfile,
  crewForRound,
  deleteProfile,
  hireClonk,
  idleMember,
  loadProfiles,
  ROUND_BONUS,
  saveProfiles,
  type KeyValueStore,
  type Profile,
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

function withCrew(n: number): Profile {
  const p = createProfile(newStore(), 'Kevin');
  for (let i = 0; i < n; i++) hireClonk(p, NAMES, new Rng(10 + i));
  return p;
}

describe('profiles', () => {
  it('starts a new player with an empty crew, like the original, and makes it active', () => {
    const store = newStore();
    const p = createProfile(store, '  Kevin ');
    expect(p.name).toBe('Kevin');
    expect(store.activeId).toBe(p.id);
    expect(p.crew).toEqual([]);
    expect(p.controlStyle).toBe('jumpAndRun');
  });

  it('hires clonks with random names from the list, preferring names not taken yet', () => {
    const p = withCrew(4);
    expect(new Set(p.crew.map((m) => m.name)).size).toBe(4);
    for (const m of p.crew) {
      expect(NAMES).toContain(m.name);
      expect(m.rank).toBe(0);
      expect(m.portrait).toBeGreaterThanOrEqual(1);
      expect(m.portrait).toBeLessThanOrEqual(5);
    }
  });

  it('saves and loads, and survives corrupt data', () => {
    const storage = memoryStorage();
    const store = newStore();
    const p = createProfile(store, 'Kevin');
    hireClonk(p, NAMES);
    saveProfiles(storage, store);
    const loaded = loadProfiles(storage);
    expect(loaded.profiles[0].name).toBe('Kevin');
    expect(loaded.profiles[0].crew).toHaveLength(1);

    storage.data.set('reclonk.profiles.v1', '{not json');
    expect(loadProfiles(storage)).toEqual({ profiles: [], activeId: null });
  });

  it('deletes a profile and picks another active one', () => {
    const store = newStore();
    const a = createProfile(store, 'A');
    const b = createProfile(store, 'B');
    expect(store.activeId).toBe(b.id);
    deleteProfile(store, b.id);
    expect(store.activeId).toBe(a.id);
    deleteProfile(store, a.id);
    expect(store.activeId).toBeNull();
  });

  it('sends the most experienced idle clonks that take part, and nobody when all are benched', () => {
    const p = withCrew(3);
    p.crew[0].experience = 10;
    p.crew[1].experience = 500;
    p.crew[2].experience = 200;
    expect(crewForRound(p, 1).map((m) => m.experience)).toEqual([500]);
    expect(crewForRound(p, 2).map((m) => m.experience)).toEqual([500, 200]);
    expect(crewForRound(p, 5).map((m) => m.experience)).toEqual([500, 200, 10]);
    expect(idleMember(p, new Set([p.crew[1].id]))?.experience).toBe(200);
    p.crew[1].participates = false;
    expect(crewForRound(p, 1).map((m) => m.experience)).toEqual([200]);
    // With everybody benched, the round recruits someone new instead.
    for (const m of p.crew) m.participates = false;
    expect(crewForRound(p, 1)).toEqual([]);
    expect(idleMember(p)).toBeUndefined();
  });

  it('writes round results back, counts deaths and reports promotions', () => {
    const p = withCrew(2);
    const [a, b] = p.crew;
    a.experience = 950;
    const promotions = applyRoundResults(p, [
      { memberId: a.id, experienceGained: 20, controlCount: 42 },
      { memberId: b.id, experienceGained: 0, controlCount: 3, died: true },
    ]);
    expect(a.experience).toBe(950 + 20 + ROUND_BONUS);
    expect(a.rank).toBe(1);
    expect(a.rounds).toBe(1);
    expect(a.controlCount).toBe(42);
    expect(a.deaths ?? 0).toBe(0);
    // A clonk that died stays in the crew and keeps what it learned.
    expect(p.crew).toContain(b);
    expect(b.experience).toBe(ROUND_BONUS);
    expect(b.deaths).toBe(1);
    expect(b.rank).toBe(0);
    expect(p.rounds).toBe(1);
    expect(promotions).toEqual([{ member: a, from: 0, to: 1 }]);
  });
});
