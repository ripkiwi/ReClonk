import { Rng } from '../core/rng';
import type { ControlStyle } from '../objects/clonk';
import { CLONK_KINDS, type ClonkKind } from '../objects/defs';
import { rankForExperience } from './ranks';

export type { ControlStyle };

/** Shirt colours a player can pick, like the original's ColorByOwner overlay. */
export const PLAYER_COLORS = [0x2a5bd7, 0xd23c2c, 0x2fa83a, 0xe0b020];

/** One clonk in a player's crew. Survives between rounds, gains experience and ranks. */
export interface CrewMember {
  id: string;
  name: string;
  experience: number;
  rank: number;
  /** Rounds this clonk took part in. */
  rounds: number;
  /** Which of the five original portraits to show. */
  portrait: number;
  /** Commands given to this clonk; every 5th earns a point of experience (original rule). */
  controlCount: number;
  hired: number;
  /** Takes part in the next round. Missing in old saves, which means yes. */
  participates?: boolean;
  /** Rounds in which this clonk lost all its energy. Missing in old saves, which means none. */
  deaths?: number;
  /** Enemy clonks it knocked out, over all rounds. */
  kills?: number;
  /** What kind of clonk it is. Missing means an ordinary clonk. */
  kind?: ClonkKind;
}

/** A crew member's kind: an ordinary clonk unless it says otherwise. */
export function kindOf(m: Pick<CrewMember, 'kind'>): ClonkKind {
  return m.kind && m.kind in CLONK_KINDS ? m.kind : 'clonk';
}

/** A player profile, like the original's .c4p player file. */
export interface Profile {
  id: string;
  name: string;
  /** Index into PLAYER_COLORS. */
  color: number;
  controlStyle: ControlStyle;
  crew: CrewMember[];
  rounds: number;
  created: number;
}

export interface ProfileStore {
  profiles: Profile[];
  /** The profile that plays next. */
  activeId: string | null;
}

/** Minimal storage interface, satisfied by window.localStorage. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'reclonk.profiles.v1';
/** Used if the original name list can't be loaded. */
const FALLBACK_NAMES = ['Alfons', 'Balder', 'Friedrich', 'Gustav', 'Hilda', 'Knut', 'Olaf', 'Wilma'];

let idCounter = 0;
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function loadProfiles(storage: KeyValueStore): ProfileStore {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as ProfileStore;
      if (Array.isArray(data.profiles)) return data;
    }
  } catch {
    // Corrupt data: start fresh rather than crash the menu.
  }
  return { profiles: [], activeId: null };
}

export function saveProfiles(storage: KeyValueStore, store: ProfileStore): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Pick a name nobody in the crew has yet. */
function pickName(names: readonly string[], crew: CrewMember[], rng: Rng): string {
  const pool = names.length ? names : FALLBACK_NAMES;
  const taken = new Set(crew.map((c) => c.name));
  const free = pool.filter((n) => !taken.has(n));
  const from = free.length ? free : pool;
  return from[rng.int(from.length)];
}

/** Menu-side randomness for names and portraits; not part of the deterministic simulation. */
const menuRng = (): Rng => new Rng((Math.random() * 0x100000000) >>> 0);

export function hireClonk(profile: Profile, names: readonly string[], rng: Rng = menuRng(), kind: ClonkKind = 'clonk'): CrewMember {
  const member: CrewMember = {
    id: newId('clonk'),
    name: pickName(names, profile.crew, rng),
    experience: 0,
    rank: 0,
    rounds: 0,
    portrait: 1 + rng.int(CLONK_KINDS[kind].portraits.count),
    controlCount: 0,
    hired: Date.now(),
    participates: true,
    ...(kind !== 'clonk' ? { kind } : {}),
  };
  profile.crew.push(member);
  return member;
}

/**
 * A new player starts with an empty crew, like the original: the first round
 * recruits the first clonk, and more can be hired in the crew screen.
 */
export function createProfile(store: ProfileStore, name: string): Profile {
  const profile: Profile = {
    id: newId('player'),
    name: name.trim() || 'Player',
    color: store.profiles.length % 4,
    controlStyle: 'jumpAndRun',
    crew: [],
    rounds: 0,
    created: Date.now(),
  };
  store.profiles.push(profile);
  store.activeId = profile.id;
  return profile;
}

export function activeProfile(store: ProfileStore): Profile | undefined {
  return store.profiles.find((p) => p.id === store.activeId) ?? store.profiles[0];
}

export function deleteProfile(store: ProfileStore, id: string): void {
  store.profiles = store.profiles.filter((p) => p.id !== id);
  if (store.activeId === id) store.activeId = store.profiles[0]?.id ?? null;
}

/**
 * The crew member of a kind who goes next (C4ObjectInfoList::GetIdle): the most
 * experienced one who takes part and isn't busy (already in the round, or
 * died in it). Undefined if there's nobody left, and a new clonk has to be recruited.
 */
export function idleMember(profile: Profile, busy: ReadonlySet<string> = new Set(), kind: ClonkKind = 'clonk'): CrewMember | undefined {
  let best: CrewMember | undefined;
  for (const m of profile.crew) {
    if (m.participates === false || busy.has(m.id) || kindOf(m) !== kind) continue;
    if (!best || m.experience > best.experience) best = m;
  }
  return best;
}

/**
 * Who of the crew goes into a round of `crewSize` clonks, best first. If
 * there are fewer, the round recruits new clonks for the rest.
 */
export function crewForRound(profile: Profile, crewSize: number, sorcerers = 0): CrewMember[] {
  const picked: CrewMember[] = [];
  const busy = new Set<string>();
  for (const [kind, n] of [['clonk', crewSize], ['sorcerer', sorcerers]] as const) {
    for (let i = 0; i < n; i++) {
      const m = idleMember(profile, busy, kind);
      if (!m) break;
      picked.push(m);
      busy.add(m.id);
    }
  }
  return picked;
}

/** What happened to one clonk during a round. */
export interface CrewResult {
  memberId: string;
  experienceGained: number;
  controlCount: number;
  /** Lost all its energy. It stays in the crew; only its death count goes up. */
  died?: boolean;
  /** Enemy clonks it knocked out this round. */
  kills?: number;
}

/** Bonus experience for finishing a round, so a crew visibly grows over a few games. */
export const ROUND_BONUS = 100;

/**
 * Write a finished round back into the profile: experience, ranks, round counts.
 * Returns the members that were promoted, with their old and new rank.
 */
export function applyRoundResults(
  profile: Profile,
  results: CrewResult[],
): { member: CrewMember; from: number; to: number }[] {
  const promotions: { member: CrewMember; from: number; to: number }[] = [];
  profile.rounds++;
  for (const r of results) {
    const m = profile.crew.find((c) => c.id === r.memberId);
    if (!m) continue;
    const from = m.rank;
    m.experience += r.experienceGained + ROUND_BONUS;
    m.controlCount = r.controlCount;
    m.rounds++;
    if (r.died) m.deaths = (m.deaths ?? 0) + 1;
    if (r.kills) m.kills = (m.kills ?? 0) + r.kills;
    m.rank = Math.max(m.rank, rankForExperience(m.experience));
    if (m.rank > from) promotions.push({ member: m, from, to: m.rank });
  }
  return promotions;
}
