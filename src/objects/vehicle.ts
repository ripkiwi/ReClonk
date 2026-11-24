// Vehicles from the original Clonk Rage content (Objects.c4d/Vehicles.c4d):
// the sailboat, the balloon, the blimp, the lorry, the catapult, the cannon,
// the crossbow, the wagon, the steam engine and the submarine, plus the
// other things the original files as vehicles: the chest, the bridge segment
// and the cannon tower's gun. Values follow their DefCore.txt, ActMap.txt and
// Script.c. See licenses/clonk_engine_license.txt.

import type { Facet } from './defs';
import type { FireState } from './fire';
import { GameObject } from './gameObject';
import type { Item } from './item';
import { CNAT, type Vertex } from './physics';
import { maskRect, SolidMask } from './solidMask';
import type { Structure } from './structure';

export type VehicleId =
  | 'boat' | 'balloon' | 'blimp' | 'lorry'
  | 'catapult' | 'cannon' | 'crossbow' | 'wagon' | 'engine' | 'sub' | 'chest' | 'bridge' | 'towerCannon' | 'artillery' | 'antiAir';

/**
 * A cannon tower's gun (CannonTower.c4d Cannon1-3 and their Attached
 * selves): pushed into a cannon tower, it's mounted on its roof.
 */
export interface MountDef {
  /** The mounted gun's graphic, a square of `size` (CTW2, CTW4, CTW6). */
  file: string;
  size: number;
  /** Degrees it turns a tick (RotationSpeed, SetRDir in tenths). */
  speed: number;
  /** Combat and artillery cannons shoot what's in the tower with gunpowder; the anti-air cannon shoots arrows. */
  kind: 'cannon' | 'arrows';
  /** Shooting speed (CannonPower; the anti-air cannon's arrows fly at 15). */
  power: number;
  /** Gunpowder for each shot (CannonPowderNeeded). */
  powder: number;
  /** The artillery cannon can shoot clonks too, with 4 gunpowder at 18. */
  clonks?: { powder: number; power: number };
}

/** A box relative to the centre. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A part of the graphics sheet drawn at (x, y) from the vehicle's top-left corner. */
export interface Part extends Facet {
  at: { x: number; y: number };
}

export interface VehicleDef {
  id: VehicleId;
  name: string;
  /** Price in gold (DefCore Value). */
  value: number;
  /** Sold back, it goes back into the shop (DefCore Rebuy). */
  rebuy: boolean;
  mass: number;
  width: number;
  height: number;
  /** Top-left corner relative to the centre (DefCore Offset). */
  offset: { x: number; y: number };
  vertices: Vertex[];
  /**
   * How deep it floats in liquids (DefCore Float): it is in a liquid when the
   * pixel `float - 1` below its centre is, and it rises until that pixel is
   * the liquid's top row.
   */
  float: number;
  /** Top speed of its FLOAT actions, in pixels per tick (Physical Float 100 = 1). */
  floatSpeed: number;
  /** The floor clonks stand on (DefCore SolidMask), from the top-left corner. */
  mask?: { x: number; y: number; w: number; h: number };
  /** Drawn in front of the clonks in it (DefCore TopFace): the front of the basket. */
  topFace?: Part;
  /** It can't be pushed into a building (DefCore NoPushEnter). */
  noPushEnter: boolean;
  /** A burning thing touching it sets it alight one time in this many (DefCore ContactIncinerate). */
  contactIncinerate: number;
  /** Blast damage that sets it alight (DefCore BlastIncinerate). */
  blastIncinerate: number;
  graphic: { file: string; facet: Facet; sheet: [number, number] };
  /** Its picture for menus (DefCore Picture). */
  picture: Facet;
  /** What it turns into when it catches fire (DefCore BurnTo). */
  burned: { file: string; mass: number; float: number; blastIncinerate: number; contactIncinerate: number };
  /**
   * Loose things falling into this box (DefCore Collection, from the centre)
   * go into it, up to `limit` of them (the Lorry script's MaxContents).
   */
  collection?: { x: number; y: number; w: number; h: number; limit: number };
  /**
   * Things a clonk holding on to it can put in and take out (DefCore
   * GrabPutGet), up to this many (CollectionLimit, or the script's own limit).
   */
  hold?: number;
  /** How it's held: 1 pushed along, 2 only held on to (DefCore Grab). The boat and the burned ones change it. */
  grabbed: Grab;
  /** Clonks can go in through this door, relative to the centre (DefCore Entrance): the wagon, the submarine. */
  entrance?: Box;
  /** Frames of its aiming strip (the Ready action's Length): the catapult's tension, the cannon's and crossbow's angle. */
  aim?: number;
  /** Wrecked by this much damage instead of burning (the submarine's Damage script). */
  wreckAt?: number;
  /** A cannon tower's gun. */
  mount?: MountDef;
}

const vtx = (xs: number[], ys: number[], cnat: number[], friction: number | number[]): Vertex[] =>
  xs.map((x, i) => ({ x, y: ys[i], cnat: cnat[i], friction: typeof friction === 'number' ? friction : friction[i] }));
const CORNERS = [CNAT.Top | CNAT.Left, CNAT.Top | CNAT.Right, CNAT.Bottom | CNAT.Left, CNAT.Bottom | CNAT.Right];

export const VEHICLES: Record<VehicleId, VehicleDef> = {
  // Sailboat.c4d (SLBT on land) and Sailboat.c4d/Sailing.c4d (SLBS in the water, with its deck).
  boat: {
    id: 'boat',
    name: 'Sailboat',
    value: 15,
    rebuy: true,
    mass: 50,
    width: 36,
    height: 44,
    offset: { x: -18, y: -22 },
    vertices: vtx([-16, 17, -17, 17], [13, 13, 21, 21], CORNERS, 80),
    float: 19,
    floatSpeed: 0,
    // SLBS SolidMask=0,42,36,2,0,42 and TopFace=0,35,36,9,0,35 (the hull's side).
    mask: { x: 0, y: 42, w: 36, h: 2 },
    topFace: { x: 0, y: 35, w: 36, h: 9, at: { x: 0, y: 35 } },
    noPushEnter: false,
    grabbed: 1,
    contactIncinerate: 5,
    blastIncinerate: 35,
    graphic: { file: 'vehicles/Sailboat.png', facet: { x: 0, y: 0, w: 36, h: 44 }, sheet: [72, 108] },
    picture: { x: 0, y: 44, w: 64, h: 64 },
    // SLBB: Mass=30, no Float (it sinks).
    burned: { file: 'vehicles/SailboatBurned.png', mass: 30, float: 0, blastIncinerate: 35, contactIncinerate: 5 },
  },
  // Balloon.c4d (BALN).
  balloon: {
    id: 'balloon',
    name: 'Balloon',
    value: 50,
    rebuy: true,
    mass: 45,
    width: 36,
    height: 50,
    offset: { x: -18, y: -25 },
    vertices: vtx([-15, 12, -12, 8], [-18, -19, 21, 21], CORNERS, 80),
    float: 22,
    floatSpeed: 1,
    // SolidMask=36,108,36,3,0,47 and TopFace=36,111,36,26,0,24.
    mask: { x: 0, y: 47, w: 36, h: 3 },
    topFace: { x: 36, y: 111, w: 36, h: 26, at: { x: 0, y: 24 } },
    noPushEnter: true,
    grabbed: 2,
    contactIncinerate: 5,
    blastIncinerate: 35,
    graphic: { file: 'vehicles/Balloon.png', facet: { x: 0, y: 0, w: 36, h: 50 }, sheet: [156, 450] },
    picture: { x: 36, y: 140, w: 64, h: 64 },
    // BALB: Mass=20, Float=1, BlastIncinerate=50.
    burned: { file: 'vehicles/BalloonBurned.png', mass: 20, float: 1, blastIncinerate: 50, contactIncinerate: 5 },
  },
  // Blimp.c4d (BLMP): the airship.
  blimp: {
    id: 'blimp',
    name: 'Blimp',
    value: 100,
    rebuy: true,
    mass: 80,
    width: 68,
    height: 60,
    offset: { x: -34, y: -30 },
    vertices: vtx([-27, 24, -15, 15], [-25, -25, 25, 25], CORNERS, 80),
    float: 27,
    floatSpeed: 1,
    // SolidMask=16,57,36,3,16,57 and TopFace=16,47,36,13,16,47 (taken from the current frame, FacetTopFace=1).
    mask: { x: 16, y: 57, w: 36, h: 3 },
    topFace: { x: 16, y: 47, w: 36, h: 13, at: { x: 16, y: 47 } },
    noPushEnter: true,
    grabbed: 2,
    contactIncinerate: 5,
    blastIncinerate: 35,
    graphic: { file: 'vehicles/Blimp.png', facet: { x: 0, y: 0, w: 68, h: 60 }, sheet: [1764, 120] },
    picture: { x: 1700, y: 0, w: 64, h: 64 },
    // BLMB: Mass=40, Float=1.
    burned: { file: 'vehicles/BlimpBurned.png', mass: 40, float: 1, blastIncinerate: 35, contactIncinerate: 5 },
  },
  // Lorry.c4d (LORY): pushed along, holds up to 50 things (GrabPutGet), empties
  // into buildings. It's metal: no ContactIncinerate or BlastIncinerate, so it
  // never burns, and with no Float it sinks.
  lorry: {
    id: 'lorry',
    name: 'Lorry',
    value: 20,
    rebuy: true,
    mass: 75,
    width: 24,
    height: 20,
    offset: { x: -12, y: -10 },
    vertices: vtx([-8, 7, -8, 7], [-6, -6, 9, 9], [5, 6, 9, 10], [80, 80, 10, 10]),
    float: 0,
    floatSpeed: 0,
    noPushEnter: false,
    grabbed: 1,
    hold: 50,
    contactIncinerate: 0,
    blastIncinerate: 0,
    graphic: { file: 'vehicles/Lorry.png', facet: { x: 0, y: 0, w: 24, h: 20 }, sheet: [74, 40] },
    picture: { x: 24, y: 0, w: 50, h: 40 },
    // Never happens: it doesn't burn.
    burned: { file: 'vehicles/Lorry.png', mass: 75, float: 0, blastIncinerate: 0, contactIncinerate: 0 },
    // Collection=-12,-10,24,12 and CollectionLimit=51; the script turns away the 51st (MaxContents 50).
    collection: { x: -12, y: -10, w: 24, h: 12, limit: 50 },
  },

  // Catapult.c4d (CATA): pushed along, loaded with up to 5 things, tensed with
  // up and dig (7 frames), throw fires the first thing in it.
  catapult: {
    id: 'catapult',
    name: 'Catapult',
    value: 25,
    rebuy: true,
    mass: 60,
    width: 24,
    height: 25,
    offset: { x: -12, y: -12 },
    vertices: vtx([-8, 8, -1], [12, 12, -5], [9, 10, 4], [15, 15, 90]),
    float: 0,
    floatSpeed: 0,
    noPushEnter: false,
    grabbed: 1,
    hold: 5,
    aim: 7,
    contactIncinerate: 0,
    blastIncinerate: 45,
    graphic: { file: 'vehicles/Catapult.png', facet: { x: 0, y: 0, w: 24, h: 25 }, sheet: [168, 89] },
    picture: { x: 0, y: 25, w: 64, h: 64 },
    // CATB: Mass=30.
    burned: { file: 'vehicles/CatapultBurned.png', mass: 30, float: 0, blastIncinerate: 0, contactIncinerate: 0 },
  },
  // Cannon.c4d (CANN): metal, so it never burns. Holds 10: gunpowder and
  // something to shoot. 19 frames from straight up (0) to level (18).
  cannon: {
    id: 'cannon',
    name: 'Cannon',
    value: 35,
    rebuy: true,
    mass: 110,
    width: 32,
    height: 28,
    offset: { x: -16, y: -14 },
    vertices: vtx([1, -8, 7], [1, 13, 13], [4, 9, 10], [100, 10, 10]),
    float: 0,
    floatSpeed: 0,
    noPushEnter: false,
    grabbed: 1,
    hold: 10,
    aim: 19,
    contactIncinerate: 0,
    blastIncinerate: 0,
    graphic: { file: 'vehicles/Cannon.png', facet: { x: 0, y: 0, w: 32, h: 28 }, sheet: [672, 64] },
    picture: { x: 608, y: 0, w: 64, h: 64 },
    burned: { file: 'vehicles/Cannon.png', mass: 110, float: 0, blastIncinerate: 0, contactIncinerate: 0 },
  },
  // Crossbow.c4d (XBOW): shoots arrows, 10 at most, 20 frames from straight up to level.
  crossbow: {
    id: 'crossbow',
    name: 'Crossbow',
    value: 25,
    rebuy: true,
    mass: 60,
    width: 32,
    height: 28,
    offset: { x: -16, y: -14 },
    vertices: vtx([1, -8, 7], [1, 13, 13], [4, 9, 10], [100, 10, 10]),
    float: 0,
    floatSpeed: 0,
    noPushEnter: false,
    grabbed: 1,
    hold: 10,
    aim: 20,
    contactIncinerate: 0,
    blastIncinerate: 45,
    graphic: { file: 'vehicles/Crossbow.png', facet: { x: 0, y: 0, w: 32, h: 28 }, sheet: [704, 64] },
    picture: { x: 640, y: 0, w: 64, h: 64 },
    // XBOB: Mass=30.
    burned: { file: 'vehicles/CrossbowBurned.png', mass: 30, float: 0, blastIncinerate: 0, contactIncinerate: 0 },
  },
  // Wagon.c4d (WAGN): a railway wagon clonks get into through its door. A
  // steam engine pulls it, steered from inside or by whoever holds on to it.
  wagon: {
    id: 'wagon',
    name: 'Wagon',
    value: 50,
    rebuy: true,
    mass: 150,
    width: 40,
    height: 28,
    offset: { x: -20, y: -14 },
    vertices: vtx([-11, 9, -11, 9], [-5, -5, 12, 12], [5, 6, 9, 10], [80, 80, 10, 10]),
    float: 0,
    floatSpeed: 0,
    noPushEnter: false,
    grabbed: 1,
    entrance: { x: -11, y: -6, w: 20, h: 20 },
    contactIncinerate: 0,
    blastIncinerate: 55,
    graphic: { file: 'vehicles/Wagon.png', facet: { x: 0, y: 0, w: 40, h: 28 }, sheet: [150, 106] },
    picture: { x: 0, y: 42, w: 64, h: 64 },
    // WAGB: Mass=150.
    burned: { file: 'vehicles/WagonBurned.png', mass: 150, float: 0, blastIncinerate: 0, contactIncinerate: 0 },
  },
  // SteamEngine.c4d (STMG): drives itself (its own Walk action) and pulls
  // the vehicle it's coupled to (the PULL procedure). Metal: it never burns.
  engine: {
    id: 'engine',
    name: 'Steam engine',
    value: 50,
    rebuy: true,
    mass: 50,
    width: 32,
    height: 28,
    offset: { x: -16, y: -14 },
    vertices: vtx([0, 0, -2, 2, -4, 4], [-3, 13, 1, 1, 7, 7], [4, 8, 1, 2, 1, 2], 100),
    float: 0,
    floatSpeed: 0,
    noPushEnter: false,
    grabbed: 1,
    contactIncinerate: 0,
    blastIncinerate: 0,
    graphic: { file: 'vehicles/SteamEngine.png', facet: { x: 0, y: 0, w: 32, h: 28 }, sheet: [384, 64] },
    picture: { x: 320, y: 0, w: 64, h: 64 },
    burned: { file: 'vehicles/SteamEngine.png', mass: 50, float: 0, blastIncinerate: 0, contactIncinerate: 0 },
  },
  // Sub.c4d (SUB1): steered from inside, under water. Its grapple picks up
  // things in front of it; dig launches a torpedo. 150 damage wrecks it (SUBB).
  sub: {
    id: 'sub',
    name: 'Submarine',
    value: 85,
    rebuy: true,
    mass: 100,
    width: 80,
    height: 40,
    offset: { x: -40, y: -20 },
    vertices: vtx([-25, -4, 22, -29, 22, -2], [-6, -10, -7, 7, 7, 11], [5, 4, 6, 9, 10, 8], 20),
    float: 0,
    floatSpeed: 0,
    noPushEnter: false,
    grabbed: 1,
    hold: 50,
    entrance: { x: -10, y: -15, w: 20, h: 30 },
    collection: { x: -35, y: -10, w: 70, h: 30, limit: 50 },
    wreckAt: 150,
    contactIncinerate: 0,
    blastIncinerate: 0,
    graphic: { file: 'vehicles/Submarine.png', facet: { x: 0, y: 0, w: 80, h: 40 }, sheet: [1920, 160] },
    picture: { x: 1856, y: 0, w: 64, h: 64 },
    // SUBB: Mass=100, sinks.
    burned: { file: 'vehicles/SubmarineBurned.png', mass: 100, float: 0, blastIncinerate: 0, contactIncinerate: 0 },
  },
  // Chest.c4d (CHST): held on to (Grab=2), it opens; holds 10 things.
  chest: {
    id: 'chest',
    name: 'Chest',
    value: 15,
    rebuy: true,
    mass: 10,
    width: 20,
    height: 24,
    offset: { x: -10, y: -12 },
    vertices: vtx([-8, -8, 8, 8], [-2, 11, -2, 11], [5, 9, 6, 10], [50, 50, 100, 100]),
    float: 0,
    floatSpeed: 0,
    noPushEnter: false,
    grabbed: 2,
    hold: 10,
    contactIncinerate: 0,
    blastIncinerate: 30,
    graphic: { file: 'vehicles/Chest.png', facet: { x: 0, y: 0, w: 20, h: 24 }, sheet: [200, 88] },
    picture: { x: 0, y: 24, w: 64, h: 64 },
    // CHSB: 18x18, Mass=10.
    burned: { file: 'vehicles/ChestBurned.png', mass: 10, float: 0, blastIncinerate: 0, contactIncinerate: 0 },
  },
  // Bridge.c4d (BRDG): a wooden segment, pushed into place and locked with a
  // double dig; locked, its top is solid to walk on (SolidMask 0,11,72,3).
  bridge: {
    id: 'bridge',
    name: 'Bridge segment',
    value: 5,
    rebuy: true,
    mass: 100,
    width: 72,
    height: 11,
    offset: { x: -36, y: -5 },
    vertices: vtx([-36, 35, -36, 35], [-4, -4, 4, 4], [5, 6, 9, 10], [100, 100, 20, 20]),
    float: 1,
    floatSpeed: 0,
    mask: { x: 0, y: 0, w: 72, h: 3 },
    noPushEnter: false,
    grabbed: 1,
    contactIncinerate: 0,
    blastIncinerate: 65,
    graphic: { file: 'vehicles/Bridge.png', facet: { x: 0, y: 0, w: 72, h: 11 }, sheet: [144, 64] },
    picture: { x: 0, y: 14, w: 70, h: 50 },
    // BRDB: Float=1, BlastIncinerate=50.
    burned: { file: 'vehicles/BridgeBurned.png', mass: 100, float: 1, blastIncinerate: 50, contactIncinerate: 0 },
  },
  // CannonTower.c4d/Cannon1.c4d (CTW3): the cannon tower's gun, pushed into the tower to mount it.
  towerCannon: {
    id: 'towerCannon',
    name: 'Combat cannon',
    value: 30,
    rebuy: true,
    mass: 80,
    width: 19,
    height: 8,
    offset: { x: -10, y: -4 },
    vertices: vtx([-10, 9, -10, 9], [-4, -4, 3, 3], CORNERS, 40),
    float: 0,
    floatSpeed: 0,
    noPushEnter: false,
    grabbed: 1,
    contactIncinerate: 0,
    blastIncinerate: 0,
    graphic: { file: 'vehicles/CombatCannon.png', facet: { x: 0, y: 0, w: 19, h: 8 }, sheet: [83, 64] },
    picture: { x: 19, y: 0, w: 64, h: 64 },
    mount: { file: 'vehicles/CombatCannonAttached.png', size: 26, speed: 0.5, kind: 'cannon', power: 12, powder: 1 },
    burned: { file: 'vehicles/CombatCannon.png', mass: 80, float: 0, blastIncinerate: 0, contactIncinerate: 0 },
  },
  // Cannon2.c4d (CTW5): turns very slowly and needs lots of gunpowder, but shoots far, clonks too.
  artillery: {
    id: 'artillery',
    name: 'Artillery cannon',
    value: 55,
    rebuy: true,
    mass: 150,
    width: 30,
    height: 16,
    offset: { x: -15, y: -8 },
    vertices: vtx([-14, 9, -14, 9], [-8, -8, 7, 7], CORNERS, 40),
    float: 0,
    floatSpeed: 0,
    noPushEnter: false,
    grabbed: 1,
    contactIncinerate: 0,
    blastIncinerate: 0,
    graphic: { file: 'vehicles/ArtilleryCannon.png', facet: { x: 0, y: 0, w: 30, h: 16 }, sheet: [94, 64] },
    picture: { x: 30, y: 0, w: 64, h: 64 },
    mount: { file: 'vehicles/ArtilleryCannonAttached.png', size: 52, speed: 0.1, kind: 'cannon', power: 20, powder: 2, clonks: { powder: 4, power: 18 } },
    burned: { file: 'vehicles/ArtilleryCannon.png', mass: 150, float: 0, blastIncinerate: 0, contactIncinerate: 0 },
  },
  // Cannon3.c4d (CTW7): fends off balloons and blimps, turns fast, shoots two arrows at a time.
  antiAir: {
    id: 'antiAir',
    name: 'Anti-air cannon',
    value: 25,
    rebuy: true,
    mass: 80,
    width: 17,
    height: 10,
    offset: { x: -8, y: -5 },
    vertices: vtx([-7, -7, 6, 6], [5, -5, 5, -5], [CNAT.Bottom | CNAT.Left, CNAT.Top | CNAT.Left, CNAT.Bottom | CNAT.Right, CNAT.Top | CNAT.Right], 40),
    float: 0,
    floatSpeed: 0,
    noPushEnter: false,
    grabbed: 1,
    contactIncinerate: 0,
    blastIncinerate: 0,
    graphic: { file: 'vehicles/AntiAirCannon.png', facet: { x: 0, y: 0, w: 17, h: 10 }, sheet: [81, 64] },
    picture: { x: 17, y: 0, w: 64, h: 64 },
    mount: { file: 'vehicles/AntiAirCannonAttached.png', size: 20, speed: 0.6, kind: 'arrows', power: 15, powder: 0 },
    burned: { file: 'vehicles/AntiAirCannon.png', mass: 80, float: 0, blastIncinerate: 0, contactIncinerate: 0 },
  },
};

export const VEHICLE_IDS = Object.keys(VEHICLES) as VehicleId[];

/** The sailboat's sail (Sailing.c4d): 10 frames from full sail (0) to furled (9). */
export const SAIL = { file: 'vehicles/SailboatSailing.png', frames: 10 };

/**
 * The balloon's flag (the Float action's facet 36,0,20,12 drawn at 18,20):
 * 9 rows for the wind from strong left (0) to strong right (8), 6 frames each,
 * 3 ticks a frame. Its blue pixels take the owner's colour (ColorByOwner).
 */
export const BALLOON_FLAG = { x: 36, y: 0, w: 20, h: 12, at: { x: 18, y: 20 }, length: 6, delay: 3 };

/** The blimp's frames: propeller turning (FloatPropel, row 0, 12 frames) and turning round (Turn, row 60, 25 frames, 2 ticks each). */
export const BLIMP = { propel: 12, turnFrames: 25, turnDelay: 2 };

/**
 * Actions, by the original's names. Boat: OnLand, InWater, JustLanded,
 * LowerSail, Sailing, RaiseSail. Balloon: Float, WaterLand, WaterLaunch,
 * DropOff. Blimp: FloatIdle, FloatPropel, Turn, WaterLand, WaterLaunch, DropOff.
 * The lorry has no actions (Idle). Catapult: Ready, Charge, Fire. Cannon and
 * crossbow: Ready. Steam engine: Walk, Push (pulling). Submarine: Walk,
 * Swim, Grapple, Turn. Chest: Closed, Opening, Open, Closing. Bridge: Idle,
 * Locked. Wagon: Idle, OpenDoor, DoorOpen, CloseDoor.
 */
export type VehicleAction =
  | 'Idle'
  | 'OnLand' | 'InWater' | 'JustLanded' | 'LowerSail' | 'Sailing' | 'RaiseSail'
  | 'Float' | 'FloatIdle' | 'FloatPropel' | 'Turn' | 'WaterLand' | 'WaterLaunch' | 'DropOff'
  | 'Ready' | 'Charge' | 'Fire'
  | 'Walk' | 'Push' | 'Swim' | 'Grapple'
  | 'Closed' | 'Opening' | 'Open' | 'Closing'
  | 'Locked'
  | 'OpenDoor' | 'DoorOpen' | 'CloseDoor';

/** The first action of each vehicle (its Initialize). */
const FIRST_ACTION: Partial<Record<VehicleId, VehicleAction>> = {
  boat: 'OnLand', balloon: 'Float', blimp: 'FloatIdle',
  catapult: 'Ready', cannon: 'Ready', crossbow: 'Ready', engine: 'Walk', sub: 'Walk', chest: 'Closed',
};

/** Where the aiming vehicles start (Initialize: SetPhase). */
const FIRST_PHASE: Partial<Record<VehicleId, number>> = { cannon: 10, crossbow: 15 };

/** Command direction (ComDir), as a unit-ish vector. */
export interface Dir {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
}
export const STOP: Dir = { x: 0, y: 0 };

/** How a vehicle is held: 1 pushed along, 2 only held on to (DefCore Grab). */
export type Grab = 1 | 2;

/** A vehicle in the world. Clonks push or steer it by holding on to it (the Push action). */
export class Vehicle extends GameObject {
  /** Player who bought it (the balloon's flag colour), or -1. */
  owner = -1;
  action: VehicleAction;
  /** Ticks since the action started. */
  actTime = 0;
  /** Facing: -1 left, 1 right. The blimp's picture faces left. */
  dir: -1 | 1 = -1;
  comDir: Dir = STOP;
  /** The sailing boat has nobody at the helm and drifts with the wind (ComDir None). */
  drift = false;
  /** Its floor in the landscape while it has one (the sailing boat's deck, the baskets). */
  mask: SolidMask | null = null;
  /** In a liquid last tick, for the InLiquidAction. */
  wasInLiquid = false;
  /** Bobbing up and down in the wind (the IntWindYDir effect). */
  windY = false;
  /** The blimp drifts with the wind while idle (IntWindXDir). */
  windX = false;
  /** Slowing the other axis to a stop, 0.1 per tick (the scripts' ClearDir calls). */
  clearX = false;
  clearY = false;
  /** Where the blimp goes once it has turned round (turn_end_dir). */
  turnEnd: Dir | null = null;
  /** Clonks steering the blimp when it started to turn, and where they stood (IntTurn). */
  turnRiders: { id: number; dx: number }[] = [];
  /** The balloon's flag in the wind, 0..8 (Wind2Flag). */
  flagDir = 4;
  /** The last tick a clonk pressed up on it, for the sailboat's double up. */
  lastUp = -100;
  /** The direction a jump'n'run pilot held last tick (ControlUpdate is only called when it changes). */
  held: Dir | null = null;
  /** How much of it is left, up to 100000: fire burns it away. */
  con = 100000;
  damage = 0;
  fire: FireState | null = null;
  burned = false;
  /** What's in it (the lorry's load). */
  readonly contents: Item[] = [];
  /** The building it was pushed into, if any: it's hidden there. */
  contained: Structure | null = null;
  /** Frame of its strip: how far the catapult is tensed, where the cannon and crossbow aim (GetPhase). */
  phase = 0;
  /** The catapult's tension when it was last set: it fires and charges back up to this (iPhase). */
  tension = 0;
  /** Ticks until the crossbow has reloaded (the IntReload effect). */
  reload = 0;
  /** Jump'n'run aiming: the held direction (-1 up, 1 down) and the ticks to the next step (IntJnRAim). */
  aimHeld: { conf: -1 | 1; timer: number } | null = null;
  /** The clonk who fired it last, credited with the hits (Controller). */
  firedBy = -1;
  /** The steam engine's coupled vehicle (its Push action's target). */
  pulling: Vehicle | null = null;
  /** The steam engine's wait at a signal (iWait), counted down every 15 ticks. */
  wait = 0;
  /** The last ticks a clonk pressed left or right on it, for the steam engine's double press. */
  lastLeft = -100;
  lastRight = -100;
  /** The submarine's airlock is open (its Entrance). */
  airlock = false;
  /** The submarine's direction once it has turned round, or the grapple has finished (turn_end_dir). */
  subTurnEnd: Dir | null = null;
  /** A bridge segment anchored in the ground (is_locked). */
  locked = false;
  /** A cannon tower's gun mounted on its tower (the ATTACH procedure): it turns there, `r` degrees from straight up. */
  mountedOn: Structure | null = null;
  r = 0;
  /** Degrees a tick it's turning (-1 left, 1 right, 0 still, times its speed). */
  turning: -1 | 0 | 1 = 0;

  constructor(
    readonly def: VehicleDef,
    x: number,
    y: number,
  ) {
    super(x, y);
    this.action = FIRST_ACTION[def.id] ?? 'Idle';
    this.phase = FIRST_PHASE[def.id] ?? 0;
    // Balloon and blimp Initialize: sink down until someone steers.
    if (def.id === 'balloon' || def.id === 'blimp') this.comDir = { x: 0, y: 1 };
  }

  get vertices(): readonly Vertex[] {
    return this.def.vertices;
  }

  get left(): number {
    return this.x + this.def.offset.x;
  }

  get top(): number {
    return this.y + this.def.offset.y;
  }

  /** Its own mass plus what's in it (C4Object::UpdateMass). */
  get mass(): number {
    let m = this.burned ? this.def.burned.mass : this.def.mass;
    for (const it of this.contents) m += it.def.mass;
    return m;
  }

  /** Room for more (the lorry's RejectCollect). */
  get full(): boolean {
    const limit = this.def.hold ?? this.def.collection?.limit;
    return limit === undefined || this.contents.length >= limit;
  }

  /** Float depth now: burned ones barely float. */
  get float(): number {
    return this.burned ? this.def.burned.float : this.def.float;
  }

  /** The boat only has its deck while it sails (SLBS), a bridge segment only while it's locked. */
  get hasMask(): boolean {
    if (this.burned || !this.def.mask) return false;
    if (this.def.id === 'bridge') return this.locked;
    return this.def.id !== 'boat' || isSailing(this.action);
  }

  /** Pushed along (1) or only held on to and steered (2). */
  get grab(): Grab {
    // Burned: BLMB keeps Grab=2, SLBB and BALB are Grab=1, and so are the rest.
    if (this.burned) return this.def.id === 'blimp' ? 2 : 1;
    if (this.def.id === 'boat') return isSailing(this.action) ? 2 : 1;
    return this.def.grabbed;
  }

  /** It takes its pilot's controls (DefCore VehicleControl): the balloon, the blimp, the sailing boat. */
  get steered(): boolean {
    return !this.burned && this.grab === 2 && this.def.id !== 'chest';
  }

  /** Clonks can be inside it (the wagon, the submarine). */
  get enterable(): boolean {
    return !this.burned && !!this.def.entrance;
  }

  /** Is the point in its door (DefCore Entrance)? */
  atEntrance(px: number, py: number): boolean {
    const e = this.def.entrance;
    if (!e || this.burned) return false;
    return px >= this.x + e.x && px < this.x + e.x + e.w && py >= this.y + e.y && py < this.y + e.y + e.h;
  }

  /** Where a clonk inside comes out: in the door, feet on its floor. */
  exitPoint(): { x: number; y: number } {
    const e = this.def.entrance ?? { x: 0, y: 0, w: 0, h: this.def.height / 2 };
    return { x: this.x + e.x + Math.trunc(e.w / 2), y: this.y + e.y + e.h - 10 };
  }

  /** Doors don't animate on vehicles the way they do on buildings: the wagon has its own (OpenDoor). */
  openDoor(): void {
    if (this.def.id === 'wagon' && (this.action === 'Idle' || this.action === 'CloseDoor')) this.setAction('OpenDoor');
  }

  /** A vehicle is never anyone's home base (for clonks inside it). */
  get base(): number {
    return -1;
  }

  /** Is the point inside its shape? */
  inside(px: number, py: number): boolean {
    return px >= this.left && px < this.left + this.def.width && py >= this.top && py < this.top + this.def.height;
  }

  /** Top row of its floor, while it has one. */
  get floorY(): number | null {
    const m = this.def.mask;
    return m && this.hasMask ? this.top + m.y : null;
  }

  setAction(a: VehicleAction): void {
    if (a === this.action) return;
    this.action = a;
    this.actTime = 0;
  }

  /** Make the solid mask for its floor. */
  makeMask(): SolidMask | null {
    const m = this.def.mask;
    return m ? new SolidMask(maskRect(m.w, m.h, { x: 0, y: 0, w: m.w, h: m.h })) : null;
  }
}

export function isSailing(a: VehicleAction): boolean {
  return a === 'Sailing' || a === 'LowerSail' || a === 'RaiseSail';
}
