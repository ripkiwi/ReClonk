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
  /** Double dig uses it (construction kits). */
  usable?: boolean;
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
  // Construction kit (Conkit.c4d): use it to put up a construction site.
  conkit: {
    id: 'conkit', name: 'Construction kit', value: 15, rebuy: true, mass: 15, vertices: itemVertex, usable: true,
    graphic: { file: 'items/Conkit.png', facet: { x: 0, y: 0, w: 8, h: 6 } },
  },
};

export type Procedure = 'walk' | 'flight' | 'scale' | 'hangle' | 'dig' | 'swim' | 'throw' | 'kneel' | 'fight' | 'push' | 'build' | 'dead';

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
  // Holding on to an elevator case or a guard tower (Push), and working on a construction site (Build).
  { name: 'Push', procedure: 'push', length: 8, delay: 15, facetX: 128, facetY: 140, next: 'Push', inLiquid: 'Swim' },
  { name: 'Build', procedure: 'build', length: 8, delay: 2, facetX: 128, facetY: 220, next: 'Build', inLiquid: 'Swim' },
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
