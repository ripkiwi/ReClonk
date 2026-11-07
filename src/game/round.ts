import { generateMap, type GeneratedMap } from '../landscape/generate';
import type { Clonk, CrewInfo } from '../objects/clonk';
import { groundAt, setupDefaultBases } from './homeBase';
import { hireClonk, idleMember, type CrewMember, type CrewResult, type Profile } from './profiles';
import type { ScenarioDef } from './scenarios';
import { World } from './world';

/** The local player's number in the world. Multiplayer will hand out more. */
export const LOCAL_PLAYER = 0;

/** A scenario being played by one profile. */
export interface Round {
  scenario: ScenarioDef;
  profile: Profile;
  map: GeneratedMap;
  world: World;
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

/**
 * Build the world for a scenario and put the profile's crew into it. Clonks
 * come from the crew like in the original: the most experienced one who takes
 * part and isn't in the round yet, or a new recruit with a random name from
 * `names` who joins the crew for good. Buying a clonk in the shop works the same way.
 */
export function startRound(scenario: ScenarioDef, profile: Profile, names: readonly string[] = []): Round {
  const map = generateMap(scenario.width, scenario.height, scenario.seed, scenario.map);
  const world = World.fromMap(map, scenario.seed);
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

  // With a home base the crew starts at its door; otherwise on the surface at the spawn point.
  const start = scenario.homeBase
    ? setupDefaultBases(world, LOCAL_PLAYER, map.spawn.x, scenario.base).home.exitPoint()
    : map.spawn;
  for (let i = 0; i < scenario.crewSize; i++) {
    const info = recruit();
    // Line the rest of the crew up next to the first clonk.
    const x = Math.max(8, Math.min(scenario.width - 8, start.x + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 14));
    const c = world.addClonk(x, i === 0 ? start.y : groundAt(world, x) - 10, LOCAL_PLAYER);
    c.controlStyle = profile.controlStyle;
    c.info = info;
    for (const id of scenario.startItems) world.give(c, id);
  }
  return {
    scenario,
    profile,
    map,
    world,
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
      ? [{ memberId: c.info.memberId, experienceGained: c.info.gained, controlCount: c.info.controlCount, died: !c.alive }]
      : [],
  );
}
