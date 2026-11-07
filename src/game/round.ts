import { Rng } from '../core/rng';
import { generateMap, type GeneratedMap } from '../landscape/generate';
import type { Clonk, CrewInfo } from '../objects/clonk';
import { CrewAI } from './ai';
import { dryGround, groundAt, setupDefaultBases } from './homeBase';
import { hireClonk, idleMember, PLAYER_COLORS, type CrewMember, type CrewResult, type Profile } from './profiles';
import { crewCount, type ScenarioDef } from './scenarios';
import { World } from './world';

/** The local player's number in the world. Multiplayer will hand out more. */
export const LOCAL_PLAYER = 0;

/** Someone taking part in a round: the local player or a computer crew. */
export interface RoundPlayer {
  id: number;
  name: string;
  /** Shirt and flag colour. */
  color: number;
  computer: boolean;
}

/** A scenario being played by one profile. */
export interface Round {
  scenario: ScenarioDef;
  /** The map's seed: the scenario's, or a new one when the scenario wants a new map every round. */
  seed: number;
  profile: Profile;
  map: GeneratedMap;
  world: World;
  players: RoundPlayer[];
  /** The player's clonks in the round, in the order they joined (the crew bar order). */
  readonly crew: Clonk[];
  /** Crew members who were recruited during this round. */
  recruited: Set<string>;
}

/** A crew member's identity for a clonk in the world. */
function crewInfo(m: CrewMember): CrewInfo {
  return {
    memberId: m.id,
    name: m.name,
    rank: m.rank,
    experience: m.experience,
    gained: 0,
    controlCount: m.controlCount,
    portrait: m.portrait,
  };
}

/** Where each crew starts: the map's spawn point alone, or spread out evenly for several crews. */
function startColumns(world: World, map: GeneratedMap, crews: number): number[] {
  if (crews === 1) return [map.spawn.x];
  const w = world.land.width;
  return Array.from({ length: crews }, (_, i) => dryGround(world, Math.round((w * (i + 0.5)) / crews)));
}

/** A seed for a new map, for scenarios that want a new map every round. */
export function newSeed(): number {
  return Math.floor(Math.random() * 1e6);
}

/**
 * Build the world for a scenario and put the profile's crew into it. Clonks
 * come from the crew like in the original: the most experienced one who takes
 * part and isn't in the round yet, or a new recruit with a random name from
 * `names` who joins the crew for good. Buying a clonk in the shop works the same way.
 */
export function startRound(scenario: ScenarioDef, profile: Profile, names: readonly string[] = [], seed = scenario.seed): Round {
  const map = generateMap(scenario.landscape, seed, { players: crewCount(scenario) });
  const world = World.fromMap(map, seed);
  const recruited = new Set<string>();
  const recruit = (): CrewInfo => {
    const busy = new Set(world.crewOf(LOCAL_PLAYER).flatMap((c) => (c.info ? [c.info.memberId] : [])));
    let m = idleMember(profile, busy);
    if (!m) {
      m = hireClonk(profile, names);
      recruited.add(m.id);
    }
    return crewInfo(m);
  };
  world.recruit = (player) => (player === LOCAL_PLAYER ? recruit() : null);
  world.goal = scenario.goal;

  const colors = PLAYER_COLORS.map((_, i) => i).filter((i) => i !== profile.color % PLAYER_COLORS.length);
  const players: RoundPlayer[] = [
    { id: LOCAL_PLAYER, name: profile.name, color: PLAYER_COLORS[profile.color % PLAYER_COLORS.length], computer: false },
  ];
  for (let i = 0; i < scenario.opponents; i++) {
    const color = PLAYER_COLORS[colors[i % colors.length]];
    players.push({ id: LOCAL_PLAYER + 1 + i, name: scenario.opponents > 1 ? `Computer ${i + 1}` : 'Computer', color, computer: true });
  }

  // Computer clonks get names too, from a generator of their own so the map and the round stay the same.
  const aiNames = new Rng(seed ^ 0xa1);
  const pool = names.length ? names : ['Clonk'];
  const columns = startColumns(world, map, players.length);
  const localCrew: CrewInfo[] = [];
  players.forEach((p, n) => {
    // With a home base the crew starts at its door; otherwise on the surface.
    const x0 = columns[n];
    const start = scenario.homeBase
      ? setupDefaultBases(world, p.id, x0, scenario.base, !p.computer).home.exitPoint()
      : { x: x0, y: n === 0 && players.length === 1 ? map.spawn.y : groundAt(world, x0) - 10 };
    if (p.computer) world.brains.set(p.id, new CrewAI(world, p.id));
    for (let i = 0; i < scenario.crewSize; i++) {
      // Computer clonks match the rank of the player's clonk in the same place, so crews are even.
      const info = p.computer
        ? {
            memberId: `computer-${p.id}-${i}`,
            name: pool[aiNames.int(pool.length)],
            rank: localCrew[i]?.rank ?? 0,
            experience: localCrew[i]?.experience ?? 0,
            gained: 0,
            controlCount: 0,
            portrait: 1 + aiNames.int(5),
          }
        : recruit();
      if (!p.computer) localCrew.push(info);
      // Line the rest of the crew up next to the first clonk.
      const x = Math.max(8, Math.min(world.land.width - 8, start.x + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 14));
      const c = world.addClonk(x, i === 0 ? start.y : groundAt(world, x) - 10, p.id);
      if (!p.computer) c.controlStyle = profile.controlStyle;
      c.join(info);
      for (const id of scenario.startItems) world.give(c, id);
    }
  });
  return {
    scenario,
    seed,
    profile,
    map,
    world,
    players,
    get crew() {
      return world.crewOf(LOCAL_PLAYER);
    },
    recruited,
  };
}

/** What the crew earned this round, to write back into the profile. */
export function roundResults(round: Round): CrewResult[] {
  return round.crew.flatMap((c) =>
    c.info
      ? [
          {
            memberId: c.info.memberId,
            experienceGained: c.info.gained,
            controlCount: c.info.controlCount,
            died: !c.alive,
            kills: c.info.kills ?? 0,
          },
        ]
      : [],
  );
}
