// Object definitions. Values follow the original Clonk Rage DefCore.txt files.
// These will move to content/objects/*/def.json once the mod loader exists.

import type { ItemId } from '../landscape/materials';
import type { Vertex } from './physics';
import { CNAT } from './physics';

export interface Facet {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Price in gold coins, for buying and selling at a home base (DefCore Value). */
  value: number;
  /** Selling it puts it back into the player's home base stock, so it can be bought again (DefCore Rebuy). */
  rebuy?: boolean;
  mass: number;
  vertices: Vertex[];
  /** Explosion radius when it hits something hard enough (flints). */
  explodeOnHit?: number;
  /** Image in the content pack and the in-game frame inside it. */
  graphic: { file: string; facet: Facet };
}

const itemVertex: Vertex[] = [{ x: 0, y: 0, cnat: CNAT.None, friction: 50 }];
const itemFacet: Facet = { x: 0, y: 0, w: 6, h: 6 };

export const ITEMS: Record<ItemId, ItemDef> = {
  rock: { id: 'rock', name: 'Rock', value: 1, rebuy: true, mass: 10, vertices: itemVertex, graphic: { file: 'items/Rock.png', facet: itemFacet } },
  gold: { id: 'gold', name: 'Gold', value: 5, mass: 15, vertices: itemVertex, graphic: { file: 'items/Gold.png', facet: itemFacet } },
  flint: {
    id: 'flint', name: 'Flint', value: 5, rebuy: true, mass: 10, vertices: itemVertex, explodeOnHit: 18,
    graphic: { file: 'items/Flint.png', facet: itemFacet },
  },
};

export type Procedure = 'walk' | 'flight' | 'scale' | 'hangle' | 'dig' | 'swim' | 'throw' | 'kneel' | 'fight' | 'dead';

export interface ActionDef {
  name: string;
  procedure: Procedure;
  length: number;
  delay: number;
  /** Row in the sprite sheet; frames run left to right. */
  facetX: number;
  facetY: number;
  /** Action to switch to after the last frame. 'Hold' freezes on the last frame. */
  next: string;
  /** Radius of the hole dug around the clonk each tick. */
  digFree?: number;
  /** While in this action the clonk can't be controlled (tumbling, getting up). */
  disabled?: boolean;
  /** Switch to this action when the clonk ends up in water. */
  inLiquid?: string;
  /** Play the animation backwards (climbing down). */
  reverse?: boolean;
}

const actions: ActionDef[] = [
  { name: 'Walk', procedure: 'walk', length: 16, delay: 15, facetX: 0, facetY: 0, next: 'Walk', inLiquid: 'Swim' },
  { name: 'Scale', procedure: 'scale', length: 16, delay: 15, facetX: 0, facetY: 20, next: 'Scale' },
  { name: 'Tumble', procedure: 'flight', length: 16, delay: 1, facetX: 0, facetY: 40, next: 'Tumble', disabled: true, inLiquid: 'Swim' },
  { name: 'Dig', procedure: 'dig', length: 16, delay: 15, facetX: 0, facetY: 60, next: 'Dig', digFree: 11, inLiquid: 'Swim' },
  { name: 'Swim', procedure: 'swim', length: 16, delay: 15, facetX: 0, facetY: 80, next: 'Swim' },
  { name: 'Hangle', procedure: 'hangle', length: 11, delay: 16, facetX: 0, facetY: 100, next: 'Hangle', inLiquid: 'Swim' },
  { name: 'Jump', procedure: 'flight', length: 8, delay: 3, facetX: 0, facetY: 120, next: 'Hold', inLiquid: 'Swim' },
  { name: 'KneelDown', procedure: 'kneel', length: 4, delay: 1, facetX: 0, facetY: 140, next: 'KneelUp' },
  { name: 'KneelUp', procedure: 'kneel', length: 4, delay: 1, facetX: 64, facetY: 140, next: 'Walk' },
  { name: 'FlatUp', procedure: 'kneel', length: 8, delay: 1, facetX: 0, facetY: 180, next: 'KneelUp', disabled: true },
  { name: 'Throw', procedure: 'throw', length: 8, delay: 1, facetX: 0, facetY: 200, next: 'Walk', inLiquid: 'Swim' },
  // Fist fights: standing off, punching, and reeling from a punch.
  { name: 'Fight', procedure: 'fight', length: 7, delay: 4, facetX: 128, facetY: 180, next: 'Fight', disabled: true },
  { name: 'Punch', procedure: 'fight', length: 8, delay: 2, facetX: 0, facetY: 220, next: 'Fight', disabled: true },
  { name: 'GetPunched', procedure: 'fight', length: 8, delay: 3, facetX: 128, facetY: 200, next: 'Fight', disabled: true },
  { name: 'Dead', procedure: 'dead', length: 6, delay: 3, facetX: 0, facetY: 240, next: 'Hold', disabled: true },
];

export const CLONK = {
  name: 'Clonk',
  /** Price of a new crew member in the shop (DefCore Value). */
  value: 25,
  width: 16,
  height: 20,
  vertices: [
    { x: 0, y: 2, cnat: CNAT.None, friction: 300 },
    { x: 0, y: -7, cnat: CNAT.Top, friction: 300 },
    { x: 0, y: 9, cnat: CNAT.Bottom, friction: 100 },
    { x: -2, y: -3, cnat: CNAT.Left, friction: 300 },
    { x: 2, y: -3, cnat: CNAT.Right, friction: 300 },
    { x: -4, y: 3, cnat: CNAT.Left, friction: 300 },
    { x: 4, y: 3, cnat: CNAT.Right, friction: 300 },
  ] as Vertex[],
  /** Area (relative to the centre) in which the clonk picks things up. */
  collection: { x: -8, y: -10, w: 16, h: 27 },
  /** A default clonk carries one object. */
  maxContents: 1,
  /** Full energy (Physical Energy) at the lowest rank. The HUD shows it divided by 1000, so 50. */
  energy: 50000,
  /** Weight, for how far hits fling it (DefCore Mass). */
  mass: 50,
  physical: { walk: 70000, jump: 40000, scale: 30000, hangle: 30000, dig: 40000, swim: 60000, throw: 50000, fight: 50000 },
  actions: Object.fromEntries(actions.map((a) => [a.name, a])) as Record<string, ActionDef>,
  graphic: { file: 'clonk/Graphics.png', overlay: 'clonk/Overlay.png' },
};

/** Energy units per displayed point (C4MaxPhysical / 100 in the original). */
export const ENERGY_UNIT = 1000;

export interface StructureDef {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Top-left corner relative to the centre. */
  offset: { x: number; y: number };
  /** Door area relative to the centre: a clonk standing here can go in. */
  entrance: { x: number; y: number; w: number; h: number };
  /** Becomes a player's home base when a flag is put on it. */
  canBeBase: boolean;
  /** Energy store a home base heals clonks from (Physical Energy). */
  energy: number;
  /** Where the flag pole goes (the structure's first vertex). */
  flagVertex: { x: number; y: number };
  graphic: {
    file: string;
    facet: Facet;
    /** Door animation strip, drawn at `at` relative to the top-left corner. */
    door: Facet & { length: number; at: { x: number; y: number } };
  };
}

/** Values from the original Hut2.c4d (wooden hut) DefCore.txt, ActMap.txt and the DOOR script. */
export const STRUCTURES: Record<string, StructureDef> = {
  hut: {
    id: 'hut',
    name: 'Wooden Hut',
    width: 60,
    height: 50,
    offset: { x: -30, y: -25 },
    entrance: { x: -18, y: 8, w: 16, h: 17 },
    canBeBase: true,
    energy: 100000,
    flagVertex: { x: 13, y: -17 },
    graphic: {
      file: 'structures/Hut2.png',
      facet: { x: 0, y: 0, w: 60, h: 50 },
      door: { x: 0, y: 50, w: 10, h: 16, length: 10, at: { x: 15, y: 34 } },
    },
  },
};

/** The flag on a home base (Flag.c4d, action FlyBase). */
export const FLAG = {
  width: 24,
  height: 12,
  /** The flag's own attach vertex, aligned with the structure's flag vertex. */
  vertex: { x: -1, y: 5 },
  /** FlyBase: 9 wind directions (0 = strong wind to the left, 4 = calm, 8 = strong right) stacked from y=12, 6 frames each, 3 ticks per frame. There's no wind yet, so use a light breeze. */
  fly: { y: 12, length: 6, delay: 3, dir: 6 },
  graphic: { file: 'items/Flag.png', overlay: 'items/FlagOverlay.png' },
};

/** Home base rules (Scenario.txt Realism defaults and C4Object::ExecLife). */
export const BASE = {
  /** Gold paid when the base's energy store runs dry, for 100 points of energy (BaseRegenerateEnergyPrice). */
  regenerateEnergyPrice: 5,
  /** Energy moved from the base into a clonk every `healInterval` ticks: 2 points. */
  healTransfer: 2 * ENERGY_UNIT,
  healInterval: 3,
  /** A player's wealth never goes above this. */
  maxWealth: 10000,
};
