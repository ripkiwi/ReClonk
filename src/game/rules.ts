// The rules a scenario can switch on, from the original's Objects.c4d/Rules.c4d
// (the Rules list on the Game page of the Scenario Properties).

import type { Clonk } from '../objects/clonk';
import type { World } from './world';

export type RuleId = 'captureTheFlag' | 'lossOfBase' | 'killTheCaptain' | 'constructionMaterial';

export interface RuleDef {
  id: RuleId;
  name: string;
  /** The original's description (DescUS.txt). */
  description: string;
  /** Its picture in the content pack. */
  icon: string;
}

export const RULES: Record<RuleId, RuleDef> = {
  constructionMaterial: {
    id: 'constructionMaterial',
    name: 'Construction Material',
    description: 'Construction needs material: bring the wood and rock a building is made of to its site.',
    icon: 'rules/ConstructionMaterial.png',
  },
  captureTheFlag: {
    id: 'captureTheFlag',
    name: 'Capture The Flag',
    description: 'Players are eliminated by loss of their flags.',
    icon: 'rules/CaptureTheFlag.png',
  },
  lossOfBase: {
    id: 'lossOfBase',
    name: 'Loss of Base',
    description: 'Players are eliminated when they lose their last base building.',
    icon: 'rules/LossOfBase.png',
  },
  killTheCaptain: {
    id: 'killTheCaptain',
    name: 'Kill The Captain',
    description: 'The highest rank clonk of each player will be the captain. If this captain is killed, the player will be eliminated.',
    icon: 'rules/KillTheCaptain.png',
  },
};

export const RULE_IDS = Object.keys(RULES) as RuleId[];

/** The original's other rules, shown greyed in the scenario settings with what they wait for. */
export const LATER_RULES: readonly { name: string; icon: string; needs: string }[] = [
  { name: 'Flag removeable', icon: 'rules/FlagRemoveable.png', needs: 'flags you can carry' },
  { name: 'Power usage', icon: 'rules/Energy.png', needs: 'windmills and power lines' },
  { name: 'Snow balls', icon: 'rules/SnowBalls.png', needs: 'snowballs' },
  { name: 'Buildings can snow in', icon: 'rules/ConstructionSnowIn.png', needs: 'buildings that clear their doorstep' },
  { name: 'Rivalry', icon: 'rules/Rivalry.png', needs: 'goals other than the melee' },
  { name: 'Team account', icon: 'rules/TeamAccount.png', needs: 'allied players' },
  { name: 'Team home base material', icon: 'rules/TeamHomebase.png', needs: 'allied players' },
  { name: 'Team knowledge', icon: 'rules/TeamKnowledge.png', needs: 'allied players' },
  { name: 'Collectible animals', icon: 'rules/CollectibleAnimals.png', needs: 'animals' },
  { name: 'No metal in front of buildings', icon: 'rules/NoMetalTrick.png', needs: 'metal bridges' },
  { name: 'Research at Wizardtower', icon: 'rules/WizardTowerResearch.png', needs: 'the wizard tower' },
];

/** The rules check every 35 ticks, like the original rule objects' timers. */
const INTERVAL = 35;

/** Does the player still have a flag flying (FindObjectOwner(FLAG))? */
export function hasFlag(world: World, player: number): boolean {
  return world.structures.some((s) => !s.gone && s.base === player);
}

/** Does the player still have a home base (FindBase)? */
export function hasBase(world: World, player: number): boolean {
  return world.structures.some((s) => !s.gone && s.base === player);
}

/** The player's captain: its highest ranking clonk when the round started (the first of them, if several share the rank). */
export function captainOf(world: World, player: number): Clonk | null {
  let captain = world.captains.get(player);
  if (captain) return captain;
  captain = undefined;
  for (const c of world.crewOf(player)) if (!captain || (c.info?.rank ?? 0) > (captain.info?.rank ?? 0)) captain = c;
  if (captain) world.captains.set(player, captain);
  return captain ?? null;
}

/** The rule objects' Execute: whoever lost their flag, base or captain is out. */
export function stepRules(world: World): void {
  if (!world.rules.size || world.tick % INTERVAL) return;
  const players = new Set(world.clonks.map((c) => c.owner));
  for (const p of players) {
    if (world.eliminated.has(p)) continue;
    if (world.rules.has('killTheCaptain')) {
      const captain = captainOf(world, p);
      if (captain && !captain.alive) {
        world.eliminate(p, `${captain.info?.name ?? 'The captain'}, the captain, is dead`);
        continue;
      }
    }
    if (world.rules.has('captureTheFlag') && !hasFlag(world, p)) {
      world.eliminate(p, 'The flag is lost');
      continue;
    }
    if (world.rules.has('lossOfBase') && !hasBase(world, p)) world.eliminate(p, 'The last base is lost');
  }
}
