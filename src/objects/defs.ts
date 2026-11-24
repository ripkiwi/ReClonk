// Object definitions. Values follow the original Clonk Rage DefCore.txt files.
// These will move to content/objects/*/def.json once the mod loader exists.

import { Mat, type ItemId } from '../landscape/materials';
import type { Vertex } from './physics';
import { CNAT } from './physics';
import type { AnimalId } from './animal';

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
  /** Double dig uses it (construction kits). */
  usable?: boolean;
  /** Explosion radius when it hits something hard enough (flints). */
  explodeOnHit?: number;
  /** Plus 0 to this many less one, picked at random for each explosion (meteors). */
  explodeRandom?: number;
  /**
   * T-flints: hitting something (or using it) lights the fuse instead, and it
   * blows up with `explode` this many ticks later, wherever it is (the Activated action's Delay).
   */
  fuse?: { ticks: number; explode: number };
  /** Frame shown while the fuse burns. */
  litFacet?: Facet;
  /** A burning object it touches sets it alight one time in this many (DefCore ContactIncinerate; 0 or missing: it doesn't burn). */
  contactIncinerate?: number;
  /** Blast damage that sets it alight (DefCore BlastIncinerate). */
  blastIncinerate?: number;
  /** A sorcerer turns it into this many points of magic energy (Crystal.c4d Apply). */
  manaGain?: number;
  /** Image in the content pack and the in-game frame inside it; an overlay gets tinted in its owner's colour (DefCore ColorByOwner). */
  graphic: { file: string; facet: Facet; overlay?: string };
  /** Floats up in water instead of sinking (DefCore Float). */
  float?: boolean;
  /** Its picture in the same file, for menus and the scenario settings (DefCore Picture). */
  picture: Facet;
  /** A live animal in a clonk's hands: let go of, it runs (or swims) off again. */
  animal?: AnimalId;
  /** A dead animal rots: after `after` ticks it shrinks by `step` percent every `every` ticks, drawn with the `facet` (its Decay action). */
  decay?: { after: number; every: number; step: number; facet: Facet };
  /** An egg: a hard landing breaks it one time in two, a blast always, and now and then it hatches by itself (MonsterEgg.c4d). */
  egg?: AnimalId;
  /**
   * Breaks when it lands hard, into this many loose pixels of a material
   * flying out at up to `level`/10 px per tick (Hit: CastPXS, like a chunk of earth).
   */
  breaksInto?: { mat: Mat; amount: number; level: number };
  /** Loam and metal: using it builds a bridge or wall of this material (Loam.c4d BridgeMaterial). */
  bridge?: Mat;
  /** Melts when it's warmer than 0 degrees: shrinks and drips water (Ice.c4d CheckTemp). */
  melts?: boolean;
  /** Blows up with this radius when it takes any damage, unless a clonk holds it: then the fire goes out (Gunpowder.c4d Damage). */
  explodeOnDamage?: number;
  /** A bird egg: it only hatches after brooding in a nest, and a young bird only comes out once it has lain there half that long (BirdEgg.c4d). */
  eggInNest?: boolean;
  /** A zap nest: when it hits the ground it breaks and lets out this many zaps (ZapNest.c4d Hit, BreakUp(28)). */
  swarm?: number;
}

const itemVertex: Vertex[] = [{ x: 0, y: 0, cnat: CNAT.None, friction: 50 }];
const itemFacet: Facet = { x: 0, y: 0, w: 6, h: 6 };
/** The 64x64 picture under the 6x6 in-game frame of most items. */
const picture6: Facet = { x: 0, y: 6, w: 64, h: 64 };

export const ITEMS: Record<ItemId, ItemDef> = {
  rock: { id: 'rock', name: 'Rock', value: 1, rebuy: true, mass: 10, vertices: itemVertex, graphic: { file: 'items/Rock.png', facet: itemFacet }, picture: picture6 },
  gold: { id: 'gold', name: 'Gold', value: 5, mass: 15, vertices: itemVertex, graphic: { file: 'items/Gold.png', facet: itemFacet }, picture: picture6 },
  // Flint.c4d: explodes when it hits something.
  flint: {
    id: 'flint', name: 'Flint', value: 5, rebuy: true, mass: 10, vertices: itemVertex, explodeOnHit: 18,
    graphic: { file: 'items/Flint.png', facet: itemFacet }, picture: picture6,
  },
  // TFlint.c4d: a hit (or using it) lights the fuse; it blows up 60 ticks later.
  tflint: {
    id: 'tflint', name: 'T-Flint', value: 4, rebuy: true, mass: 10, vertices: itemVertex, usable: true,
    fuse: { ticks: 60, explode: 20 }, litFacet: { x: 0, y: 6, w: 6, h: 6 },
    graphic: { file: 'items/TFlint.png', facet: itemFacet }, picture: { x: 0, y: 12, w: 64, h: 64 },
  },
  // SuperFlint.c4d: a bigger flint.
  superflint: {
    id: 'superflint', name: 'Super-Flint', value: 10, rebuy: true, mass: 15, vertices: itemVertex, explodeOnHit: 30,
    graphic: { file: 'items/SuperFlint.png', facet: itemFacet }, picture: picture6,
  },
  // SuperTFlint.c4d: a bigger T-flint with a longer fuse.
  supertflint: {
    id: 'supertflint', name: 'Super-T-Flint', value: 8, rebuy: true, mass: 13, vertices: itemVertex, usable: true,
    fuse: { ticks: 120, explode: 27 }, litFacet: { x: 0, y: 6, w: 6, h: 6 },
    graphic: { file: 'items/SuperTFlint.png', facet: itemFacet }, picture: { x: 0, y: 12, w: 64, h: 64 },
  },
  // TeraFlint.c4d: the biggest flint of all.
  teraflint: {
    id: 'teraflint', name: 'Tera-Flint', value: 30, rebuy: true, mass: 20, vertices: itemVertex, explodeOnHit: 40,
    graphic: { file: 'items/TeraFlint.png', facet: itemFacet }, picture: picture6,
  },
  // Wood.c4d: what trees are made of.
  wood: {
    id: 'wood', name: 'Wood', value: 2, rebuy: true, mass: 7, vertices: itemVertex, contactIncinerate: 1, blastIncinerate: 5,
    graphic: { file: 'items/Wood.png', facet: { x: 0, y: 0, w: 8, h: 7 } }, picture: { x: 0, y: 7, w: 64, h: 64 },
  },
  // Construction kit (Conkit.c4d): use it to put up a construction site.
  conkit: {
    id: 'conkit', name: 'Construction kit', value: 15, rebuy: true, mass: 15, vertices: itemVertex, usable: true,
    graphic: { file: 'items/Conkit.png', facet: { x: 0, y: 0, w: 8, h: 6 } }, picture: { x: 8, y: 0, w: 80, h: 60 },
  },
  // Meteor (Meteor.c4d): falls out of the sky with a trail of smoke and sparks, and explodes where it hits.
  meteor: {
    id: 'meteor', name: 'Meteor', value: 10, mass: 10, vertices: itemVertex, explodeOnHit: 10, explodeRandom: 12,
    graphic: { file: 'items/Meteor.png', facet: { x: 0, y: 0, w: 6, h: 5 } }, picture: { x: 8, y: 0, w: 120, h: 120 },
  },
  // Crystal.c4d: holds a charge of magic energy; a sorcerer who picks one up turns it into 10 points.
  crystal: {
    id: 'crystal', name: 'Crystal', value: 5, rebuy: true, mass: 10, manaGain: 10,
    vertices: [
      { x: -4, y: -4, cnat: CNAT.None, friction: 50 },
      { x: 1, y: 4, cnat: CNAT.None, friction: 50 },
      { x: 4, y: -4, cnat: CNAT.None, friction: 50 },
    ],
    graphic: { file: 'items/Crystal.png', facet: { x: 0, y: 0, w: 10, h: 10 } }, picture: { x: 0, y: 10, w: 64, h: 64 },
  },
  // Flag.c4d: put it on a building and it's your home base. When the base burns
  // it falls off, and anyone can pick it up and sell it for 100 gold.
  flag: {
    id: 'flag', name: 'Flag', value: 100, rebuy: true, mass: 2, float: true,
    vertices: [
      { x: -1, y: 5, cnat: CNAT.None, friction: 50 },
      { x: -1, y: -6, cnat: CNAT.None, friction: 50 },
    ],
    graphic: { file: 'items/Flag.png', facet: { x: 0, y: 0, w: 24, h: 12 }, overlay: 'items/FlagOverlay.png' },
    picture: { x: 144, y: 0, w: 64, h: 64 },
  },
  // Loam.c4d: use it to build a bridge or a wall of earth.
  loam: {
    id: 'loam', name: 'Loam', value: 3, rebuy: true, mass: 8, vertices: itemVertex, usable: true, bridge: Mat.Earth,
    graphic: { file: 'items/Loam.png', facet: itemFacet }, picture: picture6,
  },
  // Metal.c4d: needed for buildings; its bridges and walls are granite.
  metal: {
    id: 'metal', name: 'Metal', value: 8, rebuy: true, mass: 15, usable: true, bridge: Mat.Granite,
    vertices: [
      { x: -4, y: 3, cnat: CNAT.None, friction: 50 },
      { x: 3, y: -3, cnat: CNAT.None, friction: 50 },
    ],
    graphic: { file: 'items/Metal.png', facet: { x: 0, y: 0, w: 8, h: 7 } }, picture: { x: 8, y: 0, w: 64, h: 64 },
  },
  // Coal.c4d: firing fuel.
  coal: {
    id: 'coal', name: 'Coal', value: 2, rebuy: true, mass: 9,
    vertices: [
      { x: -3, y: -4, cnat: CNAT.None, friction: 50 },
      { x: 4, y: 3, cnat: CNAT.None, friction: 50 },
      { x: -3, y: 5, cnat: CNAT.None, friction: 50 },
    ],
    graphic: { file: 'items/Coal.png', facet: { x: 0, y: 0, w: 10, h: 10 } }, picture: { x: 10, y: 0, w: 35, h: 35 },
  },
  // Ore.c4d: a foundry makes metal of it.
  ore: {
    id: 'ore', name: 'Ore', value: 3, rebuy: true, mass: 12,
    vertices: [
      { x: -4, y: 4, cnat: CNAT.None, friction: 50 },
      { x: 0, y: -4, cnat: CNAT.None, friction: 50 },
      { x: 4, y: 4, cnat: CNAT.None, friction: 50 },
    ],
    graphic: { file: 'items/Ore.png', facet: { x: 0, y: 0, w: 10, h: 10 } }, picture: { x: 10, y: 0, w: 35, h: 35 },
  },
  // Sulphur.c4d: base substance for explosives; a big enough blast sets it alight.
  sulphur: {
    id: 'sulphur', name: 'Sulphur', value: 3, rebuy: true, mass: 5, vertices: itemVertex, blastIncinerate: 50,
    graphic: { file: 'items/Sulphur.png', facet: itemFacet }, picture: { x: 6, y: 0, w: 40, h: 40 },
  },
  // Concrete.c4d: breaks into rock where it lands, for level basements.
  concrete: {
    id: 'concrete', name: 'Concrete', value: 2, rebuy: true, mass: 10, vertices: itemVertex, breaksInto: { mat: Mat.Rock, amount: 100, level: 30 },
    graphic: { file: 'items/Concrete.png', facet: itemFacet }, picture: { x: 6, y: 0, w: 35, h: 35 },
  },
  // LiquidGranite.c4d: like concrete, but granite.
  liquidGranite: {
    id: 'liquidGranite', name: 'Liquid granite', value: 5, rebuy: true, mass: 15, vertices: itemVertex, breaksInto: { mat: Mat.Granite, amount: 150, level: 30 },
    graphic: { file: 'items/LiquidGranite.png', facet: itemFacet }, picture: { x: 6, y: 0, w: 35, h: 35 },
  },
  // Gunpowder.c4d: catches fire easily and blows up.
  gunpowder: {
    id: 'gunpowder', name: 'Gunpowder', value: 3, rebuy: true, mass: 5, vertices: itemVertex, contactIncinerate: 1, blastIncinerate: 1, explodeOnDamage: 30,
    graphic: { file: 'items/Gunpowder.png', facet: itemFacet }, picture: picture6,
  },
  // Earth.c4d, Sand.c4d, Ashes.c4d: chunks dug out on request, which break where they land.
  earth: {
    id: 'earth', name: 'Earth', value: 0, mass: 8, vertices: itemVertex, breaksInto: { mat: Mat.Earth, amount: 100, level: 20 },
    graphic: { file: 'items/Earth.png', facet: itemFacet }, picture: { x: 6, y: 0, w: 35, h: 35 },
  },
  sand: {
    id: 'sand', name: 'Sand', value: 0, mass: 8, vertices: itemVertex, breaksInto: { mat: Mat.Sand, amount: 100, level: 20 },
    graphic: { file: 'items/Sand.png', facet: itemFacet }, picture: { x: 6, y: 0, w: 35, h: 35 },
  },
  ashes: {
    id: 'ashes', name: 'Ashes', value: 0, mass: 8, vertices: itemVertex, breaksInto: { mat: Mat.Ashes, amount: 100, level: 20 },
    graphic: { file: 'items/Ashes.png', facet: itemFacet }, picture: { x: 6, y: 0, w: 35, h: 35 },
  },
  // Ice.c4d: floats, and melts into water when it's warm.
  ice: {
    id: 'ice', name: 'Ice', value: 0, mass: 8, float: true, melts: true,
    vertices: [
      { x: -3, y: -4, cnat: CNAT.None, friction: 50 },
      { x: 4, y: 3, cnat: CNAT.None, friction: 50 },
      { x: -3, y: 5, cnat: CNAT.None, friction: 50 },
    ],
    graphic: { file: 'items/Ice.png', facet: { x: 0, y: 0, w: 10, h: 10 } }, picture: { x: 10, y: 0, w: 35, h: 35 },
  },
  // Snowball.c4d: a light throwing weapon that bursts into snow (and melts like ice).
  snowball: {
    id: 'snowball', name: 'Snowball', value: 0, mass: 12, vertices: itemVertex, melts: true, breaksInto: { mat: Mat.Snow, amount: 100, level: 20 },
    graphic: { file: 'items/Snowball.png', facet: itemFacet }, picture: { x: 6, y: 0, w: 32, h: 32 },
  },
  // A wipf picked up alive (Wipf.c4d with the Collectible animals rule): 15 gold in a base.
  wipf: {
    id: 'wipf', name: 'Wipf', value: 15, mass: 20, vertices: [{ x: 0, y: 6, cnat: CNAT.Bottom, friction: 100 }], animal: 'wipf', contactIncinerate: 1,
    graphic: { file: 'animals/Wipf.png', facet: { x: 0, y: 54, w: 24, h: 18 } }, picture: { x: 432, y: 0, w: 64, h: 64 },
  },
  // A fish caught alive (Fish.c4d with the Collectible animals rule).
  fish: {
    id: 'fish', name: 'Fish', value: 10, mass: 15, vertices: [{ x: 0, y: 4, cnat: CNAT.Bottom, friction: 100 }], animal: 'fish', float: true,
    graphic: { file: 'animals/Fish.png', facet: { x: 0, y: 0, w: 16, h: 12 } }, picture: { x: 320, y: 0, w: 64, h: 64 },
  },
  // DeadWipf (Wipf.c4d/Dead.c4d): lies about for 3000 ticks, then rots away (Decay: DoCon(-4) every 100 ticks).
  deadWipf: {
    id: 'deadWipf', name: 'Dead wipf', value: 10, mass: 15, vertices: [{ x: 0, y: 6, cnat: CNAT.Bottom, friction: 100 }], contactIncinerate: 1, float: true,
    decay: { after: 3000, every: 100, step: 4, facet: { x: 0, y: 18, w: 24, h: 18 } },
    graphic: { file: 'animals/WipfDead.png', facet: { x: 0, y: 0, w: 24, h: 18 } }, picture: { x: 0, y: 0, w: 24, h: 18 },
  },
  // DeadFish (Fish.c4d/Dead.c4d): floats, then rots like a dead wipf.
  deadFish: {
    id: 'deadFish', name: 'Dead fish', value: 6, mass: 15, vertices: [{ x: 0, y: 4, cnat: CNAT.Bottom, friction: 100 }], float: true,
    decay: { after: 3000, every: 100, step: 4, facet: { x: 0, y: 12, w: 16, h: 12 } },
    graphic: { file: 'animals/FishDead.png', facet: { x: 0, y: 0, w: 16, h: 12 } }, picture: { x: 16, y: 0, w: 64, h: 64 },
  },
  // DeadBird (Bird.c4d/Dead.c4d): it has no Decay action, so it stays.
  deadBird: {
    id: 'deadBird', name: 'Dead bird', value: 1, mass: 5, vertices: [{ x: 0, y: 3, cnat: CNAT.Bottom, friction: 100 }], contactIncinerate: 1, float: true,
    graphic: { file: 'animals/BirdDead.png', facet: { x: 0, y: 0, w: 28, h: 24 } }, picture: { x: 28, y: 0, w: 64, h: 64 },
  },
  // MonsterEgg.c4d (MEGG): breaks on a hard landing one time in two, and in a blast; a monster hatches if there's room.
  monsterEgg: {
    id: 'monsterEgg', name: 'Monster egg', value: 10, mass: 10, vertices: itemVertex, egg: 'monster',
    graphic: { file: 'animals/MonsterEgg.png', facet: { x: 0, y: 0, w: 6, h: 6 } }, picture: { x: 6, y: 0, w: 40, h: 40 },
  },
  // Shell.c4d: lies on the bottom of lakes; worth 10 gold (it holds a pearl).
  shell: {
    id: 'shell', name: 'Shell', value: 10, mass: 5, vertices: [{ x: 0, y: 2, cnat: CNAT.None, friction: 50 }],
    graphic: { file: 'items/Shell.png', facet: { x: 0, y: 0, w: 12, h: 8 } }, picture: { x: 12, y: 0, w: 64, h: 64 },
  },
  // Bone.c4d: lies about on the ground or buried in the earth.
  bone: {
    id: 'bone', name: 'Bone', value: 1, mass: 10,
    vertices: [
      { x: -2, y: 2, cnat: CNAT.None, friction: 20 },
      { x: 2, y: -2, cnat: CNAT.None, friction: 20 },
    ],
    graphic: { file: 'items/Bone.png', facet: { x: 0, y: 0, w: 6, h: 6 } }, picture: { x: 6, y: 0, w: 64, h: 64 },
  },
  // Skull.c4d: the same, a bit more valuable.
  skull: {
    id: 'skull', name: 'Skull', value: 2, mass: 5, vertices: [{ x: 0, y: 6, cnat: CNAT.None, friction: 50 }],
    graphic: { file: 'items/Skull.png', facet: { x: 0, y: 0, w: 24, h: 14 } }, picture: { x: 24, y: 0, w: 64, h: 64 },
  },
  // A snake picked up alive (Snake.c4d is Collectible, with the Collectible animals rule). It bites whoever holds it.
  snake: {
    id: 'snake', name: 'Snake', value: 7, mass: 5, vertices: [{ x: 0, y: 4, cnat: CNAT.Bottom, friction: 100 }], animal: 'snake', float: true,
    graphic: { file: 'animals/Snake.png', facet: { x: 0, y: 0, w: 28, h: 10 } }, picture: { x: 560, y: 0, w: 64, h: 64 },
  },
  // A dead snake: Snake.c4d has no Dead.c4d, so it's the snake in its Dead action, and it doesn't rot.
  deadSnake: {
    id: 'deadSnake', name: 'Dead snake', value: 7, mass: 5, vertices: [{ x: 0, y: 4, cnat: CNAT.Bottom, friction: 100 }], float: true,
    graphic: { file: 'animals/Snake.png', facet: { x: 0, y: 40, w: 28, h: 10 } }, picture: { x: 560, y: 0, w: 64, h: 64 },
  },
  // FireMonsterEgg.c4d (FMEG): like the monster egg, with a fire monster in it.
  fireMonsterEgg: {
    id: 'fireMonsterEgg', name: 'Fire monster egg', value: 20, mass: 10, vertices: itemVertex, egg: 'fireMonster',
    graphic: { file: 'animals/FireMonsterEgg.png', facet: { x: 0, y: 0, w: 6, h: 6 } }, picture: { x: 6, y: 0, w: 40, h: 40 },
  },
  // BirdEgg.c4d (BEGG): laid in a nest, it hatches after 50 times 35 ticks there; broken before half that, there's no bird in it yet.
  birdEgg: {
    id: 'birdEgg', name: 'Bird egg', value: 10, mass: 10, vertices: itemVertex, egg: 'bird', eggInNest: true,
    graphic: { file: 'animals/BirdEgg.png', facet: { x: 0, y: 0, w: 6, h: 6 } }, picture: { x: 6, y: 0, w: 40, h: 40 },
  },
  // ZapNest.c4d (ZAPN): thrown or dropped, it bursts on the ground into 28 zaps.
  zapNest: {
    id: 'zapNest', name: 'Zap nest', value: 5, rebuy: true, mass: 3, vertices: [{ x: 0, y: 1, cnat: CNAT.None, friction: 100 }], swarm: 28,
    graphic: { file: 'animals/ZapNest.png', facet: { x: 0, y: 0, w: 6, h: 6 } }, picture: { x: 6, y: 0, w: 64, h: 64 },
  },
};

export type Procedure = 'walk' | 'flight' | 'scale' | 'hangle' | 'dig' | 'swim' | 'throw' | 'kneel' | 'fight' | 'push' | 'build' | 'chop' | 'bridge' | 'dead';

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
  /** Frame height if it isn't the clonk's own, and how far the frame is shifted (the Facet's last values): the magic sparkles. */
  facetH?: number;
  offsetY?: number;
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
  // Holding on to an elevator case or a guard tower (Push), and working on a construction site (Build).
  { name: 'Push', procedure: 'push', length: 8, delay: 15, facetX: 128, facetY: 140, next: 'Push', inLiquid: 'Swim' },
  { name: 'Build', procedure: 'build', length: 8, delay: 2, facetX: 128, facetY: 220, next: 'Build', inLiquid: 'Swim' },
  // Chopping a tree down, or a felled one into wood (the Chopping StartCall swings the axe).
  { name: 'Chop', procedure: 'chop', length: 8, delay: 3, facetX: 128, facetY: 160, next: 'Chop', inLiquid: 'Swim' },
  // Building a loam or metal bridge (DFA_BRIDGE): the digging animation, fast.
  { name: 'Bridge', procedure: 'bridge', length: 16, delay: 1, facetX: 0, facetY: 60, next: 'Bridge', inLiquid: 'Swim' },
  { name: 'Dead', procedure: 'dead', length: 6, delay: 3, facetX: 0, facetY: 240, next: 'Hold', disabled: true },
];

/** The kinds of clonk a crew can have (Crew.c4d). */
export type ClonkKind = 'clonk' | 'sorcerer';

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
  physical: { walk: 70000, jump: 40000, scale: 30000, hangle: 30000, dig: 40000, swim: 60000, throw: 50000, fight: 50000, magic: 0 },
  actions: Object.fromEntries(actions.map((a) => [a.name, a])) as Record<string, ActionDef>,
  graphic: { file: 'clonk/Graphics.png', overlay: 'clonk/Overlay.png' },
  /** How many portraits it has, and where. */
  portraits: { count: 5, path: 'clonk/portraits/' },
};

/**
 * The sorcerer (Sorcerer.c4d, which includes MagiClonk.c4d): a clonk that
 * casts spells with magic energy. It fights a little worse, costs twice as
 * much, and its sprite sheet has the casting animations: Magic on the ground
 * and JumpMagic in the air, 16 frames with the spell going off at frame 5.
 */
const sorcererActions: ActionDef[] = [
  ...actions.map((a) => (a.name === 'Dead' ? { ...a, facetY: 308 } : a)),
  { name: 'Magic', procedure: 'throw', length: 16, delay: 1, facetX: 0, facetY: 260, facetH: 24, offsetY: -4, next: 'Walk' },
  { name: 'JumpMagic', procedure: 'flight', length: 16, delay: 1, facetX: 0, facetY: 260, facetH: 24, offsetY: -4, next: 'Jump', inLiquid: 'Swim' },
];

export const SORCERER: typeof CLONK = {
  ...CLONK,
  name: 'Sorcerer',
  value: 50,
  physical: { ...CLONK.physical, fight: 40000, magic: 100000 },
  actions: Object.fromEntries(sorcererActions.map((a) => [a.name, a])) as Record<string, ActionDef>,
  graphic: { file: 'sorcerer/Graphics.png', overlay: 'sorcerer/Overlay.png' },
  portraits: { count: 2, path: 'sorcerer/portraits/' },
};

export const CLONK_KINDS: Record<ClonkKind, typeof CLONK> = { clonk: CLONK, sorcerer: SORCERER };

/** Magic energy units per displayed point (MagicPhysicalFactor). */
export const MAGIC_UNIT = 1000;

/** Energy units per displayed point (C4MaxPhysical / 100 in the original). */
export const ENERGY_UNIT = 1000;

export interface StructureDef {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Top-left corner relative to the centre. */
  offset: { x: number; y: number };
  /** Weight (DefCore Mass): heavier buildings take longer to build. */
  mass: number;
  /** Price in gold (DefCore Value). */
  value: number;
  /** Door area relative to the centre: a clonk standing here can go in. Buildings without one can't be entered. */
  entrance?: { x: number; y: number; w: number; h: number };
  /** Where a clonk who goes in comes out again once the door has shut, relative to the centre (the guard tower's roof). */
  exitTo?: { x: number; y: number };
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
    door?: Facet & { length: number; at: { x: number; y: number } };
    /** The building's picture for menus (DefCore Picture). */
    picture: Facet;
  };
  /** The stone basement the building stands on (the original's BASx objects), centred under it. */
  basement?: { width: number; height: number; file: string };
  /** Solid parts (DefCore SolidMask) as text rows from the top-left corner, '#' solid. */
  solidMask?: readonly string[];
  /** It has a case that rides up and down a shaft (Elevator.c4d). */
  elevator?: boolean;
  /** Gates that slide up and down (the guard tower's), relative to the centre. */
  gates?: readonly GateDef[];
  /**
   * What it's made of (DefCore Components). With the Construction Material
   * rule a clonk has to bring these to the site. (The original elevator takes
   * metal, which isn't in the game yet: rock stands in for it.)
   */
  components: Partial<Record<ItemId, number>>;
  /** Blast damage that sets it alight (DefCore BlastIncinerate). */
  blastIncinerate: number;
  /** A burning object it touches sets it alight one time in this many (DefCore ContactIncinerate; missing: never). */
  contactIncinerate?: number;
  /**
   * What it turns into when it catches fire (DefCore BurnTo): the burned
   * building (Burned.c4d), which a clonk can build back up into the real one (ConstructTo).
   */
  burned: { file: string; blastIncinerate: number; contactIncinerate?: number };
}

/** A guard tower gate (GateLeft.c4d / GateRight.c4d). */
export interface GateDef {
  side: -1 | 1;
  /** Centre relative to the building's centre when it's put up. */
  x: number;
  y: number;
  /** The solid column of the gate (its SolidMask), relative to its top-left corner. */
  mask: { x: number; w: number };
  file: string;
}

/** A gate: 12x24, floats up or down at 1 pixel per tick (Physical Float 100). */
export const GATE = { width: 12, height: 24, speed: 1, accel: 0.1 };

/**
 * The elevator case (Elevator.c4d/Case.c4d): 24x26, floor at the bottom (its
 * SolidMask), floats at up to 2 pixels per tick (Physical Float 200). Every 30
 * ticks it looks for a waiting clonk up to 30 pixels to the side.
 */
export const ELEVATOR_CASE = {
  width: 24,
  height: 26,
  offset: { x: -12, y: -13 },
  /** The floor's rows, from the top of the case. */
  floor: { y: 24, h: 2 },
  speed: 2,
  accel: 0.1,
  /** Drilling a shaft is slower than riding down an open one. */
  drillSpeed: 0.5,
  waitInterval: 30,
  waitRange: 30,
  file: 'structures/ElevatorCase.png',
  /** The rope from the elevator's top to the case (the LiftCase action), x from the elevator's left edge. */
  rope: { x: 13, y: 5, facet: { x: 58, y: 5, w: 2, h: 4 } },
};

/** Basements (Basements.c4d): blast damage that breaks one, and the rocks it falls apart into. */
export const BASEMENT = { breakDamage: 150, rocks: 4 };

/**
 * Construction (C4Game::CreateObjectConstruction, C4Object::Build): a site
 * starts at con 0 and a clonk adds 150000 / mass con per tick until it reaches
 * FULL_CON. Ground gaps up to `raiseTerrain` pixels deep under a new site are filled.
 */
export const CONSTRUCTION = { fullCon: 100000, perTick: 150000, raiseTerrain: 20 };

/** Values from the original DefCore.txt, ActMap.txt and scripts of each building. */
export const STRUCTURES: Record<string, StructureDef> = {
  // Hut2.c4d (wooden hut) with the DOOR script.
  hut: {
    id: 'hut',
    name: 'Wooden Hut',
    width: 60,
    height: 50,
    offset: { x: -30, y: -25 },
    mass: 1000,
    value: 35,
    entrance: { x: -18, y: 8, w: 16, h: 17 },
    canBeBase: true,
    energy: 100000,
    flagVertex: { x: 13, y: -17 },
    graphic: {
      file: 'structures/Hut2.png',
      facet: { x: 0, y: 0, w: 60, h: 50 },
      door: { x: 0, y: 50, w: 10, h: 16, length: 10, at: { x: 15, y: 34 } },
      picture: { x: 0, y: 0, w: 60, h: 50 },
    },
    basement: { width: 60, height: 8, file: 'structures/Basement60.png' },
    components: { wood: 4, rock: 1 },
    // Hut2.c4d BlastIncinerate=45, BurnTo=HTB2 (ContactIncinerate=3, BlastIncinerate=10).
    blastIncinerate: 45,
    burned: { file: 'structures/Hut2Burned.png', blastIncinerate: 10, contactIncinerate: 3 },
  },
  // Elevator.c4d: no basement, its case drills the shaft below it.
  elevator: {
    id: 'elevator',
    name: 'Elevator',
    width: 28,
    height: 56,
    offset: { x: -14, y: -28 },
    mass: 900,
    value: 50,
    canBeBase: false,
    energy: 0,
    flagVertex: { x: -11, y: -28 },
    graphic: { file: 'structures/Elevator.png', facet: { x: 0, y: 0, w: 28, h: 56 }, picture: { x: 0, y: 0, w: 28, h: 56 } },
    elevator: true,
    components: { wood: 4, rock: 2 },
    // Elevator.c4d BlastIncinerate=50, BurnTo=ELVB (ContactIncinerate=5, BlastIncinerate=50).
    blastIncinerate: 50,
    burned: { file: 'structures/ElevatorBurned.png', blastIncinerate: 50, contactIncinerate: 5 },
  },
  // Tower2.c4d (guard tower): a 48 wide basement (BAS3), walls and a roof
  // platform (SolidMask), a door that takes clonks up to the roof, and two gates.
  tower: {
    id: 'tower',
    name: 'Guard Tower',
    width: 48,
    height: 64,
    offset: { x: -24, y: -32 },
    mass: 2000,
    value: 150,
    entrance: { x: -8, y: 17, w: 13, h: 15 },
    // DoorClosed puts everyone inside out onto the platform (Exit at 0,-20): feet on its top row.
    exitTo: { x: 0, y: -30 },
    canBeBase: false,
    energy: 0,
    flagVertex: { x: -24, y: -32 },
    graphic: {
      file: 'structures/Tower2.png',
      facet: { x: 0, y: 0, w: 48, h: 64 },
      door: { x: 0, y: 64, w: 10, h: 15, length: 10, at: { x: 17, y: 49 } },
      picture: { x: 144, y: 0, w: 48, h: 64 },
    },
    basement: { width: 48, height: 8, file: 'structures/Basement48.png' },
    solidMask: [
      '#####......................................#####',
      '#####......................................#####',
      '#####......................................#####',
      '#####......................................#####',
      '#####......................................#####',
      '#####......................................#####',
      '#####......................................#####',
      '#####......................................#####',
      '#####......................................#####',
      '#####......................................####.',
      '.#####....................................####..',
      '..####....................................###...',
      '...##..##################################..#....',
      '......####################################......',
      '.....######################################.....',
      '....########################################....',
      '....#########################################...',
      '....#########################################...',
      ...Array<string>(22).fill('....###...................................###...'),
    ],
    gates: [
      { side: -1, x: -14, y: 10, mask: { x: 0, w: 3 }, file: 'structures/GateLeft.png' },
      { side: 1, x: 15, y: 10, mask: { x: 8, w: 3 }, file: 'structures/GateRight.png' },
    ],
    components: { rock: 5, wood: 2 },
    // Tower2.c4d BlastIncinerate=250, BurnTo=TWB2 (BlastIncinerate=250).
    blastIncinerate: 250,
    burned: { file: 'structures/Tower2Burned.png', blastIncinerate: 250 },
  },
};

/** Buildings a construction kit can put up, in menu order (the original's construction plans). */
export const BUILD_PLANS = ['hut', 'elevator', 'tower'] as const;

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
