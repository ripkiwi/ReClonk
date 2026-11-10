import type { Landscape } from '../landscape/landscape';
import type { ItemDef } from './defs';
import type { FireState } from './fire';
import { GameObject } from './gameObject';
import { FLOAT_ACCEL, HIT_SPEED_1 } from './physics';

/** A loose object: rock, gold nugget, flint, wood, meteor. */
export class Item extends GameObject {
  /** Ticks during which a clonk that just threw or dropped this won't pick it straight back up. */
  noCollect = 0;
  /** Id of the clonk that last threw it, credited with what its explosion breaks loose. */
  thrownBy = -1;
  /** Gold only earns experience the first time someone picks it up. */
  found = false;
  /** Ticks left on a lit T-flint's fuse; -1 while it isn't lit. */
  fuse = -1;
  /** How much of it is left, up to 100000: fire burns it away (wood is drawn smaller). */
  con = 100000;
  /** Blast damage taken; enough sets it alight (BlastIncinerate). */
  damage = 0;
  fire: FireState | null = null;
  /** It has burned: wood stays charred (Wood.c4d Incineration). */
  burned = false;
  /**
   * Player it belongs to, or -1. Only flags care: a flag shows its owner's
   * colour and makes a building that owner's base, whoever carries it there.
   * Picking a thing up doesn't change its owner (the original's Collect).
   */
  owner = -1;

  constructor(
    readonly def: ItemDef,
    x: number,
    y: number,
  ) {
    super(x, y);
  }

  get vertices() {
    return this.def.vertices;
  }

  get lit(): boolean {
    return this.fuse >= 0;
  }

  /** Light a T-flint's fuse (TFlint.c4d Activate). Returns false if it can't be lit or already burns. */
  light(): boolean {
    if (!this.def.fuse || this.lit) return false;
    this.fuse = this.def.fuse.ticks;
    return true;
  }

  /** Advance one tick. Returns true if the item hit something hard (flints explode, T-flints light up). */
  tick(land: Landscape): boolean {
    if (this.noCollect > 0) this.noCollect--;
    const g = land.gravity;
    if (this.inLiquid(land)) {
      // Sink slowly through liquids; light things like flags bob up instead (Float).
      this.ydir = this.def.float ? Math.max(this.ydir - g, -1) : Math.min(this.ydir + g, 1);
      this.xdir *= 0.9;
    } else this.ydir += g;
    // Resting objects with ground right below don't need to simulate.
    if (this.xdir === 0 && this.ydir === g && land.isSolid(this.x, this.y + 1)) {
      this.ydir = 0;
      return false;
    }
    const speed = Math.abs(this.xdir) + Math.abs(this.ydir);
    const moved = this.doMovement(land);
    if (!moved.contact) return false;
    if (Math.abs(this.ydir) < FLOAT_ACCEL) this.ydir = 0;
    return speed >= HIT_SPEED_1;
  }
}
