// Vehicles from the original Clonk Rage content (Objects.c4d/Vehicles.c4d):
// the sailboat, the balloon, the blimp and the lorry. Values follow their DefCore.txt,
// ActMap.txt and Script.c. See licenses/clonk_engine_license.txt.

import type { Facet } from './defs';
import type { FireState } from './fire';
import { GameObject } from './gameObject';
import type { Item } from './item';
import { CNAT, type Vertex } from './physics';
import { maskRect, SolidMask } from './solidMask';
import type { Structure } from './structure';

export type VehicleId = 'boat' | 'balloon' | 'blimp' | 'lorry';

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
    contactIncinerate: 0,
    blastIncinerate: 0,
    graphic: { file: 'vehicles/Lorry.png', facet: { x: 0, y: 0, w: 24, h: 20 }, sheet: [74, 40] },
    picture: { x: 24, y: 0, w: 50, h: 40 },
    // Never happens: it doesn't burn.
    burned: { file: 'vehicles/Lorry.png', mass: 75, float: 0, blastIncinerate: 0, contactIncinerate: 0 },
    // Collection=-12,-10,24,12 and CollectionLimit=51; the script turns away the 51st (MaxContents 50).
    collection: { x: -12, y: -10, w: 24, h: 12, limit: 50 },
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
 * The lorry has no actions (Idle).
 */
export type VehicleAction =
  | 'Idle'
  | 'OnLand' | 'InWater' | 'JustLanded' | 'LowerSail' | 'Sailing' | 'RaiseSail'
  | 'Float' | 'FloatIdle' | 'FloatPropel' | 'Turn' | 'WaterLand' | 'WaterLaunch' | 'DropOff';

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

  constructor(
    readonly def: VehicleDef,
    x: number,
    y: number,
  ) {
    super(x, y);
    this.action = def.id === 'boat' ? 'OnLand' : def.id === 'balloon' ? 'Float' : def.id === 'blimp' ? 'FloatIdle' : 'Idle';
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
    const c = this.def.collection;
    return !c || this.contents.length >= c.limit;
  }

  /** Float depth now: burned ones barely float. */
  get float(): number {
    return this.burned ? this.def.burned.float : this.def.float;
  }

  /** The boat only has its deck while it sails (SLBS). */
  get hasMask(): boolean {
    if (this.burned || !this.def.mask) return false;
    return this.def.id !== 'boat' || isSailing(this.action);
  }

  /** Pushed along (1) or only held on to and steered (2). */
  get grab(): Grab {
    // Burned: BLMB keeps Grab=2, SLBB and BALB are Grab=1.
    if (this.burned) return this.def.id === 'blimp' ? 2 : 1;
    if (this.def.id === 'boat') return isSailing(this.action) ? 2 : 1;
    return this.def.id === 'lorry' ? 1 : 2;
  }

  /** It takes its pilot's controls (DefCore VehicleControl). */
  get steered(): boolean {
    return !this.burned && this.grab === 2;
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
