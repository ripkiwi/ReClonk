// The rules a scenario can switch on, from the original's Objects.c4d/Rules.c4d
// (the Rules list on the Game page of the Scenario Properties).

import type { Clonk } from '../objects/clonk';
import { CLONK } from '../objects/defs';
import type { Item } from '../objects/item';
import { dropFlag } from './fire';
import type { World } from './world';

export type RuleId = 'flagRemoveable' | 'captureTheFlag' | 'lossOfBase' | 'killTheCaptain' | 'constructionMaterial';

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
  flagRemoveable: {
    id: 'flagRemoveable',
    name: 'Flag removeable',
    description: 'The flag can be removed from buildings: an enemy who reaches it takes it along.',
    icon: 'rules/FlagRemoveable.png',
  },
  captureTheFlag: {
    id: 'captureTheFlag',
    name: 'Capture The Flag',
    description: 'Players are eliminated by loss of their flags. Flags can be removed from buildings.',
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

/**
 * Does the player still have a flag (FindObjectOwner(FLAG))? One flying on a
 * building, lying about or in somebody's hands all count: it's lost when it's
 * sold or destroyed.
 */
export function hasFlag(world: World, player: number): boolean {
  return world.structures.some((s) => !s.gone && s.base === player) || world.items.some((i) => !i.removed && i.def.id === 'flag' && i.owner === player);
}

/** Can flags be taken off buildings? Capture The Flag brings the rule along (C4Scenario.cpp). */
export function flagsRemoveable(world: World): boolean {
  return world.rules.has('flagRemoveable') || world.rules.has('captureTheFlag');
}

/**
 * The Flag removeable rule (C4Object::Collect): a clonk who reaches a flag
 * flying on an enemy's building takes it off. The building is no base any
 * more; the flag is still its owner's, to carry off and sell.
 */
export function takeFlag(world: World, c: Clonk): Item | null {
  if (!flagsRemoveable(world) || c.contained || c.action.disabled || c.contents.length >= CLONK.maxContents) return null;
  const r = CLONK.collection;
  for (const s of world.structures) {
    if (s.gone || s.base < 0 || !world.hostile(s.base, c.owner)) continue;
    const dx = s.x + s.def.flagVertex.x - c.x;
    const dy = s.y + s.def.flagVertex.y - c.y;
    if (dx < r.x || dx >= r.x + r.w || dy < r.y || dy >= r.y + r.h) continue;
    const owner = s.base;
    const flag = dropFlag(world, s);
    flag.container = c;
    flag.xdir = flag.ydir = 0;
    c.contents.push(flag);
    world.say(c.owner, `You took the flag off the ${s.def.name.toLowerCase()}`);
    world.say(owner, `Your flag was taken off the ${s.def.name.toLowerCase()}`);
    return flag;
  }
  return null;
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
