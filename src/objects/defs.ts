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
  /** Sell value in gold coins (used once bases and selling exist). */
  value: number;
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
  rock: { id: 'rock', name: 'Rock', value: 1, mass: 10, vertices: itemVertex, graphic: { file: 'items/Rock.png', facet: itemFacet } },
  gold: { id: 'gold', name: 'Gold', value: 5, mass: 15, vertices: itemVertex, graphic: { file: 'items/Gold.png', facet: itemFacet } },
  flint: {
    id: 'flint', name: 'Flint', value: 5, mass: 10, vertices: itemVertex, explodeOnHit: 18,
    graphic: { file: 'items/Flint.png', facet: itemFacet },
  },
};

export type Procedure = 'walk' | 'flight' | 'scale' | 'hangle' | 'dig' | 'swim' | 'throw' | 'kneel';

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
];

export const CLONK = {
  name: 'Clonk',
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
  physical: { walk: 70000, jump: 40000, scale: 30000, hangle: 30000, dig: 40000, swim: 60000, throw: 50000 },
  actions: Object.fromEntries(actions.map((a) => [a.name, a])) as Record<string, ActionDef>,
  graphic: { file: 'clonk/Graphics.png', overlay: 'clonk/Overlay.png' },
};
