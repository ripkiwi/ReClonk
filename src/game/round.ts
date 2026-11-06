import { generateMap, type GeneratedMap } from '../landscape/generate';
import type { Clonk } from '../objects/clonk';
import { groundAt, setupDefaultBases } from './homeBase';
import { crewForRound, type CrewResult, type Profile } from './profiles';
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
  /** The player's clonks, in crew order. */
  crew: Clonk[];
}

/** Build the world for a scenario and put the profile's crew into it. */
export function startRound(scenario: ScenarioDef, profile: Profile): Round {
  const map = generateMap(scenario.width, scenario.height, scenario.seed, scenario.map);
  const world = World.fromMap(map, scenario.seed);
  // With a home base the crew starts at its door; otherwise on the surface at the spawn point.
  const start = scenario.homeBase ? setupDefaultBases(world, LOCAL_PLAYER, map.spawn.x).home.exitPoint() : map.spawn;
  const crew = crewForRound(profile, scenario.crewSize).map((m, i) => {
    // Line the rest of the crew up next to the first clonk.
    const x = Math.max(8, Math.min(scenario.width - 8, start.x + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 14));
    const c = world.addClonk(x, i === 0 ? start.y : groundAt(world, x) - 10, LOCAL_PLAYER);
    c.controlStyle = profile.controlStyle;
    c.info = {
      memberId: m.id,
      name: m.name,
      rank: m.rank,
      experience: m.experience,
      gained: 0,
      controlCount: m.controlCount,
      portrait: m.portrait,
    };
    for (const id of scenario.startItems) world.give(c, id);
    return c;
  });
  return { scenario, profile, map, world, crew };
}

/** What the crew earned this round, to write back into the profile. */
export function roundResults(round: Round): CrewResult[] {
  return round.crew.flatMap((c) =>
    c.info ? [{ memberId: c.info.memberId, experienceGained: c.info.gained, controlCount: c.info.controlCount }] : [],
  );
}
