import { CONSTRUCTION, ELEVATOR_CASE, GATE, type GateDef, type StructureDef } from './defs';
import { maskRect, SolidMask } from './solidMask';

/** A building's stone basement: solid landscape under it, and what was there before. */
export interface Basement {
  /** Top-left corner and size, in landscape pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Blast damage taken so far. */
  damage: number;
  /** Material, texture and tunnel flag of the pixels the basement replaced, row by row. */
  saved: { cells: Uint8Array; tex: Uint8Array; tunnel: Uint8Array };
}

/** Ticks of the door animation: opening (10), open (20), closing (10), as in the original DOOR script. */
export const DOOR_TICKS = 40;

/** What an elevator case is doing: waiting, riding to a place, or drilling its shaft deeper. */
export type CaseMode = 'wait' | 'ride' | 'drill';

/** The elevator's case (Elevator.c4d/Case.c4d). Its floor is a solid mask clonks stand on. */
export class ElevatorCase {
  /** Centre, in whole pixels, and the exact height. */
  readonly x: number;
  y: number;
  fy: number;
  ydir = 0;
  mode: CaseMode = 'wait';
  /** -1 up, 1 down, 0 stopped (the case's ComDir). */
  dir: -1 | 0 | 1 = 0;
  /** Where a ride stops (the case's centre), or null to ride until it bumps into something. */
  target: number | null = null;
  /** The highest the case goes: where it hangs when the elevator is finished. */
  readonly top: number;
  /** A ride with jump'n'run controls: it goes on only while the key is held. */
  manual = false;
  /** The last tick the ride key was held. */
  held = -1;
  /** Ticks until it next looks for a waiting clonk. */
  timer = 0;
  readonly floor: SolidMask;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = this.fy = this.top = y;
    const c = ELEVATOR_CASE;
    this.floor = new SolidMask(maskRect(c.width, c.floor.h, { x: 0, y: 0, w: c.width, h: c.floor.h }));
  }

  get left(): number {
    return this.x + ELEVATOR_CASE.offset.x;
  }

  /** Top of the case's box. */
  get boxTop(): number {
    return this.y + ELEVATOR_CASE.offset.y;
  }

  /** Top row of the floor: things standing in the case stand on this row. */
  get floorY(): number {
    return this.boxTop + ELEVATOR_CASE.floor.y;
  }

  /** True if a point is inside the case's box. */
  inside(px: number, py: number): boolean {
    const c = ELEVATOR_CASE;
    return px >= this.left && px < this.left + c.width && py >= this.boxTop && py < this.boxTop + c.height;
  }
}

/** A guard tower gate. It floats up (open) or down (shut) until it bumps into something. */
export class Gate {
  readonly x: number;
  y: number;
  fy: number;
  ydir = 0;
  /** -1 moving up (opening), 1 moving down (closing). A new gate opens (the gate's Completion). */
  dir: -1 | 1 = -1;
  readonly mask: SolidMask;

  constructor(
    readonly def: GateDef,
    x: number,
    y: number,
  ) {
    this.x = x;
    this.y = this.fy = y;
    this.mask = new SolidMask(maskRect(GATE.width, GATE.height, { x: def.mask.x, y: 0, w: def.mask.w, h: GATE.height }));
  }

  get left(): number {
    return this.x - GATE.width / 2;
  }

  get top(): number {
    return this.y - GATE.height / 2;
  }
}

/**
 * A building standing in the landscape. It isn't solid: clonks walk past it
 * and go in through the door. With a flag on it, it is that player's home base.
 */
export class Structure {
  /** Player whose home base this is (the flag's owner), or -1 for an ordinary building. */
  base = -1;
  /** Player who put it up, or -1. Hostile clonks can't work its elevator. */
  owner = -1;
  /** Energy stored for healing clonks. Starts empty; the base buys more with its owner's gold. */
  energy = 0;
  /** Ticks left in the door animation (0 = closed). */
  door = 0;
  /** The stone basement it stands on, until blasts break it. */
  basement: Basement | null = null;
  /** How far it's built: a construction site grows to CONSTRUCTION.fullCon. */
  con = CONSTRUCTION.fullCon;
  /** Its solid parts in the landscape, once it's finished. */
  mask: SolidMask | null = null;
  /** An elevator's case, once the elevator is finished. */
  liftCase: ElevatorCase | null = null;
  /** A guard tower's gates, once it's finished. */
  gates: Gate[] = [];

  constructor(
    readonly def: StructureDef,
    /** Centre, in whole pixels. */
    readonly x: number,
    readonly y: number,
  ) {}

  get hasFlag(): boolean {
    return this.base >= 0;
  }

  /** Finished building (not a construction site any more). */
  get complete(): boolean {
    return this.con >= CONSTRUCTION.fullCon;
  }

  get left(): number {
    return this.x + this.def.offset.x;
  }

  get top(): number {
    return this.y + this.def.offset.y;
  }

  /** True if a point is within the building's shape. */
  inside(px: number, py: number): boolean {
    const d = this.def;
    return px >= this.left && px < this.left + d.width && py >= this.top && py < this.top + d.height;
  }

  /** True if a point is in the doorway of a finished building. */
  atEntrance(px: number, py: number): boolean {
    const e = this.def.entrance;
    if (!e || !this.complete) return false;
    const dx = px - this.x;
    const dy = py - this.y;
    return dx >= e.x && dx < e.x + e.w && dy >= e.y && dy < e.y + e.h;
  }

  /** Where a clonk stands when it comes out: in the doorway, feet on the ground. */
  exitPoint(): { x: number; y: number } {
    const e = this.def.entrance ?? { x: -1, y: 0, w: 2, h: this.def.height / 2 };
    return { x: this.x + e.x + Math.floor(e.w / 2), y: this.y + e.y + e.h - 10 };
  }

  openDoor(): void {
    // Re-opening while open just keeps it open.
    this.door = this.door > 10 ? Math.max(this.door, 30) : DOOR_TICKS;
  }

  tick(): void {
    if (this.door > 0) this.door--;
  }

  /** Door animation frame while `door` > 0. */
  get doorFrame(): number {
    const t = DOOR_TICKS - this.door;
    if (this.door === 0 || !this.def.graphic.door) return 0;
    const n = this.def.graphic.door.length;
    return t < n ? t : t < DOOR_TICKS - n ? n - 1 : DOOR_TICKS - 1 - t;
  }
}
