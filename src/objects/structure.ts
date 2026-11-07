import type { StructureDef } from './defs';

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

/**
 * A building standing in the landscape. It isn't solid: clonks walk past it
 * and go in through the door. With a flag on it, it is that player's home base.
 */
export class Structure {
  /** Player whose home base this is (the flag's owner), or -1 for an ordinary building. */
  base = -1;
  /** Energy stored for healing clonks. Starts empty; the base buys more with its owner's gold. */
  energy = 0;
  /** Ticks left in the door animation (0 = closed). */
  door = 0;
  /** The stone basement it stands on, until blasts break it. */
  basement: Basement | null = null;

  constructor(
    readonly def: StructureDef,
    /** Centre, in whole pixels. */
    readonly x: number,
    readonly y: number,
  ) {}

  get hasFlag(): boolean {
    return this.base >= 0;
  }

  /** True if a point is in the doorway. */
  atEntrance(px: number, py: number): boolean {
    const e = this.def.entrance;
    const dx = px - this.x;
    const dy = py - this.y;
    return dx >= e.x && dx < e.x + e.w && dy >= e.y && dy < e.y + e.h;
  }

  /** Where a clonk stands when it comes out: in the doorway, feet on the ground. */
  exitPoint(): { x: number; y: number } {
    const e = this.def.entrance;
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
    if (this.door === 0) return 0;
    const n = this.def.graphic.door.length;
    return t < n ? t : t < DOOR_TICKS - n ? n - 1 : DOOR_TICKS - 1 - t;
  }
}
