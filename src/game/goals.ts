// The goals a scenario can set, from the original's Objects.c4d/Goals.c4d
// (the Goals list on the Game page of the Scenario Properties). Each goal is
// checked by the Goal control (Goal.c4d CheckTime): when every goal is
// fulfilled the round is won. With the Rivalry rule each player plays for
// themselves instead: the first to fulfil every goal wins, and the others lose.

import type { Clonk } from '../objects/clonk';
import { BUILD_PLANS, CLONK_KINDS, CONSTRUCTION, STRUCTURES } from '../objects/defs';
import type { AnimalId } from '../objects/animal';
import { Mat } from '../landscape/materials';
import type { Rng } from '../core/rng';
import { placeAnimal } from './animals';
import type { World } from './world';

export type GoalId = 'melee' | 'goldmine' | 'wealth' | 'value' | 'wipfhunt' | 'monsterkill' | 'race' | 'engineering';

/** How many of each goal a scenario has (Scenario.txt Goals=GLDM=1;VALG=16). More of some goals means more to do. */
export type Goals = Partial<Record<GoalId, number>>;

export interface GoalDef {
  id: GoalId;
  /** Its name in the original (Names.txt). */
  name: string;
  /** The original's description (DescUS.txt). */
  description: string;
  /** Its picture in the content pack. */
  icon: string;
  /** How many of it a scenario can have. */
  max: number;
  /** What a count means in the scenario settings, for goals where more of it asks for more. */
  count?: (n: number) => string;
}

export const GOALS: Record<GoalId, GoalDef> = {
  melee: {
    id: 'melee',
    name: 'Melee',
    description: 'All players or teams fight each other until only one survivor remains.',
    icon: 'goals/Melee.png',
    max: 1,
  },
  goldmine: {
    id: 'goldmine',
    name: 'Goldmine',
    description: 'All gold needs to be mined and sold.',
    icon: 'goals/Goldmine.png',
    max: 1,
  },
  wealth: {
    id: 'wealth',
    name: 'Money Points',
    description: 'Each player has to gain the indicated number of money points.',
    icon: 'goals/Wealth.png',
    max: 99,
    count: (n) => `${n * 100} gold`,
  },
  value: {
    id: 'value',
    name: 'Settlement points',
    description: 'Each player has to gain the indicated number of score points.',
    icon: 'goals/Value.png',
    max: 99,
    count: (n) => `${n * 100} points`,
  },
  wipfhunt: {
    id: 'wipfhunt',
    name: 'Wipf rescue',
    description: 'All wipfs have to be caught and sold. If the goal object is placed multiple times, the respective number of wipfs may die before the goal is lost.',
    icon: 'goals/Wipfhunt.png',
    max: 20,
    count: (n) => `${allowedWipfDeaths(n)} may die`,
  },
  monsterkill: {
    id: 'monsterkill',
    name: 'Monsterkill',
    description: 'All monsters and monster eggs have to be removed.',
    icon: 'goals/Monsterkill.png',
    max: 1,
  },
  race: {
    id: 'race',
    name: 'Race',
    description: 'The first player who reaches the goal wins.',
    icon: 'goals/Race.png',
    max: 1,
  },
  engineering: {
    id: 'engineering',
    name: 'Engineer',
    description: 'All constructable objects have to be built.',
    icon: 'goals/Engineering.png',
    max: 1,
  },
};

export const GOAL_IDS = Object.keys(GOALS) as GoalId[];

/** The original's other goals, shown greyed in the scenario settings with what they wait for. */
export const LATER_GOALS: readonly { name: string; icon: string; needs: string }[] = [
  { name: 'Ore Mining', icon: 'goals/Oremine.png', needs: 'ore' },
  { name: 'Oil Production', icon: 'goals/Oilproduction.png', needs: 'pumps and oil barrels' },
];

/** The Goal control checks every 35 ticks (the original's timer is 250, which feels slow on a small map). */
const INTERVAL = 35;
/** Goldmine: done when less than this much solid gold is left in the landscape (Goldmine.c4d). */
const GOLD_LEFT = 150;
/** Race: the goal line is this far from the right edge (Race.c4d GetEndOffset), the start this far from the left. */
export const RACE_OFFSET = 50;
/** The monsters Monsterkill hunts, and the eggs they hatch from (MONS, FMNS; MEGG, FMEG). */
export const MONSTERS: readonly AnimalId[] = ['monster', 'fireMonster'];

/** Wipf rescue: one goal lets no wipf die, two let two die, three three and so on (Wipfhunt.c4d Initialize). */
export function allowedWipfDeaths(count: number): number {
  return count <= 1 ? 0 : count;
}

/** What the Goal control keeps track of during a round. */
export class GoalState {
  /** Each player's value when the round started (C4Player::InitialValue), for Settlement points. */
  readonly initialValue = new Map<number, number>();
  /** Dead wipfs already counted (Wipfhunt.c4d marks them with Local(0)). */
  readonly countedWipfs = new WeakSet<object>();
  deadWipfs = 0;
  /** The first player to cross the race's goal line. */
  raceWinner: number | null = null;
  /** Solid gold pixels in the landscape, counted at the last check. */
  goldLeft = -1;
  started = false;
}

/** Does the round have any goal besides the melee? */
export function hasGoals(goals: Goals): boolean {
  return GOAL_IDS.some((id) => (goals[id] ?? 0) > 0);
}

/** Goals of the scenario that count, in the original's list order. */
export function activeGoals(world: World): GoalId[] {
  return GOAL_IDS.filter((id) => (world.goals[id] ?? 0) > 0);
}

/**
 * What the goals need at the start of the round: Monsterkill brings 2 to 6
 * monsters if there are none, extra Wipf rescue goals bring the wipfs that
 * may die and a couple more (Monsterkill.c4d and Wipfhunt.c4d Initialize).
 */
export function initGoals(world: World, rng: Rng): void {
  const g = world.goals;
  if (g.monsterkill && !world.animals.some((a) => MONSTERS.includes(a.def.id))) {
    for (let n = 2 + rng.int(5); n > 0; n--) placeAnimal(world, 'monster', rng);
  }
  const wipfGoals = g.wipfhunt ?? 0;
  if (wipfGoals > 1) {
    const wipfs = world.animals.filter((a) => a.def.id === 'wipf' && a.alive).length;
    for (let n = allowedWipfDeaths(wipfGoals) - wipfs + 1 + rng.int(3); n > 0; n--) placeAnimal(world, 'wipf', rng);
  }
}

/** The players in the round: everyone with clonks or a home base. */
export function playersOf(world: World): number[] {
  const ids = new Set<number>(world.players.keys());
  for (const c of world.clonks) ids.add(c.owner);
  return [...ids].filter((p) => p >= 0).sort((a, b) => a - b);
}

/**
 * A player's value (C4Player::UpdateValue): their gold plus everything they
 * own, buildings by how far they are built. Loose gold belongs to nobody, so
 * it only counts once it's sold.
 */
export function playerValue(world: World, player: number): number {
  let v = world.players.get(player)?.wealth ?? 0;
  for (const c of world.clonks) if (c.owner === player && c.alive && !c.released) v += CLONK_KINDS[c.kind].value;
  for (const s of world.structures) if (s.owner === player && !s.gone && !s.burned) v += Math.floor((s.def.value * Math.min(s.con, CONSTRUCTION.fullCon)) / CONSTRUCTION.fullCon);
  for (const ve of world.vehicles) if (ve.owner === player && !ve.removed && !ve.burned) v += ve.def.value;
  for (const it of world.items) if (it.owner === player && !it.removed) v += it.def.value;
  return v;
}

/** Settlement points: how much the player's value grew since the start (C4Player::ValueGain). */
export function valueGain(world: World, player: number): number {
  return playerValue(world, player) - (world.goalState.initialValue.get(player) ?? 0);
}

/** How far the player's leader is on the race track, 0 to 100 (Race.c4d GetWayPercent, left to right). */
export function racePercent(world: World, player: number): number {
  const c = raceRunner(world, player);
  if (!c) return 0;
  const w = world.land.width;
  if (c.x > w - RACE_OFFSET) return 100;
  return Math.max(0, Math.min(99, Math.floor(((c.x - RACE_OFFSET) * 100) / (w - 2 * RACE_OFFSET))));
}

/** The clonk that runs the race for a player: the one they control (GetCursor). */
function raceRunner(world: World, player: number): Clonk | null {
  const lead = world.cursor(player).leader;
  return lead && !lead.released ? lead : null;
}

/** Solid gold in the landscape, in pixels (GetMaterialCount). */
function countGold(world: World): number {
  const cells = world.land.cells;
  let n = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] === Mat.Gold) n++;
  return n;
}

function goldItems(world: World): { total: number; outside: number } {
  let total = 0;
  let outside = 0;
  for (const it of world.items) {
    if (it.removed || it.def.id !== 'gold') continue;
    total++;
    if (!it.container) outside++;
  }
  return { total, outside };
}

/** Live wipfs anywhere: running about, or carried (FindObject(WIPF)). */
function wipfsLeft(world: World): number {
  return world.animals.filter((a) => a.def.id === 'wipf' && a.alive && !a.removed).length + world.items.filter((i) => !i.removed && i.def.id === 'wipf').length;
}

function monstersLeft(world: World): { monsters: number; eggs: number } {
  return {
    monsters: world.animals.filter((a) => MONSTERS.includes(a.def.id) && a.alive && !a.removed).length,
    eggs: world.items.filter((i) => !i.removed && !!i.def.egg && MONSTERS.includes(i.def.egg)).length,
  };
}

/** The plans that aren't built yet: by anyone, or with `player` by that player (Engineering.c4d). */
export function unbuilt(world: World, player?: number): string[] {
  return BUILD_PLANS.filter((id) => !world.structures.some((s) => s.def.id === id && s.complete && !s.gone && (player === undefined || s.owner === player)));
}

/**
 * Is the goal fulfilled? For everyone (IsFulfilled), or with `player` for
 * that player alone, the way Rivalry asks (IsFulfilledforPlr).
 */
export function goalFulfilled(world: World, id: GoalId, player?: number): boolean {
  const st = world.goalState;
  const n = world.goals[id] ?? 0;
  const humans = (): number[] => playersOf(world).filter((p) => !world.brains.has(p) && !world.eliminated.has(p));
  switch (id) {
    case 'melee': {
      // Only one crew left standing (or nobody).
      const standing = playersOf(world).filter((p) => !world.eliminated.has(p));
      return player === undefined ? standing.length <= 1 : standing.length === 1 && standing[0] === player;
    }
    case 'goldmine':
      return st.goldLeft >= 0 && st.goldLeft < GOLD_LEFT && goldItems(world).total === 0;
    case 'wealth': {
      const ok = (p: number): boolean => (world.players.get(p)?.wealth ?? 0) >= n * 100;
      return player === undefined ? humans().every(ok) : ok(player);
    }
    case 'value': {
      const ok = (p: number): boolean => valueGain(world, p) >= n * 100;
      return player === undefined ? humans().every(ok) : ok(player);
    }
    case 'wipfhunt':
      return st.deadWipfs <= allowedWipfDeaths(n) && wipfsLeft(world) === 0;
    case 'monsterkill': {
      const m = monstersLeft(world);
      return m.monsters === 0 && m.eggs === 0;
    }
    case 'race':
      return st.raceWinner !== null && (player === undefined || st.raceWinner === player);
    case 'engineering':
      return unbuilt(world, player).length === 0;
  }
}

/** The goal's message when its picture is clicked (the goals' Activate). */
export function goalStatus(world: World, id: GoalId, player: number): string {
  const st = world.goalState;
  const n = world.goals[id] ?? 0;
  const rivalry = world.rules.has('rivalry');
  const done = goalFulfilled(world, id, rivalry ? player : undefined);
  switch (id) {
    case 'melee': {
      const others = playersOf(world).filter((p) => p !== player && !world.eliminated.has(p)).length;
      return done || !others ? 'All opponents eliminated.' : `Still ${others} opponent${others === 1 ? '' : 's'} in the game.`;
    }
    case 'goldmine': {
      if (done) return 'All gold has been mined.';
      const g = goldItems(world);
      const solid = Math.max(0, Math.floor((st.goldLeft - 50) / 100));
      return `You still have to mine ${solid} units of solid gold and collect ${g.total} gold chunks, ${g.outside} of which are outside.`;
    }
    case 'wealth': {
      const w = world.players.get(player)?.wealth ?? 0;
      return w >= n * 100 ? `${n * 100} wealth points reached!` : `${w} wealth points of ${n * 100} reached.`;
    }
    case 'value': {
      const v = valueGain(world, player);
      return v >= n * 100 ? `${n * 100} score points reached!` : `${Math.max(0, v)} score points of ${n * 100} reached.`;
    }
    case 'wipfhunt':
      if (st.deadWipfs > allowedWipfDeaths(n)) return 'Too many wipfs have died.';
      if (done) return 'No more wipfs to rescue.';
      return `Still ${wipfsLeft(world)} wipfs to rescue. ${st.deadWipfs} wipfs have already died (${allowedWipfDeaths(n)} allowed).`;
    case 'monsterkill': {
      const { monsters, eggs } = monstersLeft(world);
      if (!monsters && !eggs) return 'All monsters have been eliminated.';
      if (!monsters) return eggs === 1 ? "There's still a monster egg somewhere around." : `There are ${eggs} monster eggs left.`;
      if (!eggs) return monsters === 1 ? "There's still one monster about." : `There are ${monsters} monsters about.`;
      if (eggs === 1) return `One egg and ${monsters} monsters are still to be taken care of.`;
      return `${monsters} monsters and ${eggs} eggs are to be taken care of.`;
    }
    case 'race': {
      if (st.raceWinner !== null) return st.raceWinner === player ? 'You have won the race!' : `${world.playerName(st.raceWinner)} has won the race!`;
      let lead = player;
      for (const p of playersOf(world)) if (racePercent(world, p) > racePercent(world, lead)) lead = p;
      if (lead === player) return `You're ahead at ${racePercent(world, player)}%!`;
      return `${world.playerName(lead)} is ahead at ${racePercent(world, lead)}% of the way. You're behind at ${racePercent(world, player)}%.`;
    }
    case 'engineering': {
      const left = unbuilt(world, rivalry ? player : undefined);
      return left.length ? `Still to build: ${left.map((d) => STRUCTURES[d].name).join(', ')}.` : 'You have built every constructable object!';
    }
  }
}

/** A short line for the goal's picture in the game: how far along it is. */
export function goalProgress(world: World, id: GoalId, player: number): string {
  const n = world.goals[id] ?? 0;
  switch (id) {
    case 'wealth':
      return `${world.players.get(player)?.wealth ?? 0}/${n * 100}`;
    case 'value':
      return `${Math.max(0, valueGain(world, player))}/${n * 100}`;
    case 'race':
      return `${racePercent(world, player)}%`;
    case 'goldmine':
      return world.goalState.goldLeft < 0 ? '' : `${Math.max(0, Math.floor((world.goalState.goldLeft - 50) / 100)) + goldItems(world).total}`;
    case 'wipfhunt':
      return String(wipfsLeft(world));
    case 'monsterkill': {
      const m = monstersLeft(world);
      return String(m.monsters + m.eggs);
    }
    case 'engineering':
      return String(unbuilt(world, world.rules.has('rivalry') ? player : undefined).length);
    case 'melee':
      return '';
  }
}

/**
 * The Goal control's timer (Goal.c4d CheckTime). Without Rivalry the round
 * is won when every goal is fulfilled for everyone; computer crews don't
 * have to help with that. With Rivalry the first players to fulfil every
 * goal win and everyone else is eliminated.
 */
export function stepGoals(world: World): void {
  const goals = activeGoals(world);
  if (!goals.length || world.winner !== null) return;
  const st = world.goalState;
  if (!st.started) {
    st.started = true;
    for (const p of playersOf(world)) st.initialValue.set(p, playerValue(world, p));
  }
  if (world.goals.race && st.raceWinner === null) {
    for (const p of playersOf(world)) {
      if (world.eliminated.has(p) || racePercent(world, p) < 100) continue;
      st.raceWinner = p;
      break;
    }
  }
  if (world.tick % INTERVAL) return;
  if (world.goals.goldmine) st.goldLeft = countGold(world);
  if (world.goals.wipfhunt) {
    for (const it of world.items) {
      if (it.removed || it.def.id !== 'deadWipf' || st.countedWipfs.has(it)) continue;
      st.countedWipfs.add(it);
      st.deadWipfs++;
    }
    // Too many dead wipfs: everyone has lost.
    if (st.deadWipfs > allowedWipfDeaths(world.goals.wipfhunt)) {
      for (const p of playersOf(world)) world.eliminate(p, 'Too many wipfs have died');
      world.decide(-1, false);
      return;
    }
  }

  if (world.rules.has('rivalry')) {
    const winners = playersOf(world).filter((p) => !world.eliminated.has(p) && goals.every((g) => goalFulfilled(world, g, p)));
    if (!winners.length) return;
    for (const p of playersOf(world)) if (!winners.includes(p)) world.eliminate(p, `${world.playerName(winners[0])} fulfilled the goals first`);
    world.decide(winners[0], false);
    return;
  }
  if (!goals.every((g) => goalFulfilled(world, g))) return;
  // The race has a winner even without Rivalry; the other goals everyone wins together.
  world.decide(st.raceWinner ?? -1, true);
}
