import type { Landscape } from '../landscape/landscape';
import type { ItemDef } from './defs';
import { GameObject } from './gameObject';
import { FLOAT_ACCEL, HIT_SPEED_1 } from './physics';

/** A loose object: rock, gold nugget, flint, meteor. */
export class Item extends GameObject {
  /** Ticks during which a clonk that just threw or dropped this won't pick it straight back up. */
  noCollect = 0;
  /** Id of the clonk that last threw it, credited with what its explosion breaks loose. */
  thrownBy = -1;
  /** Gold only earns experience the first time someone picks it up. */
  found = false;

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

  /** Advance one tick. Returns true if the item hit something hard (flints explode). */
  tick(land: Landscape): boolean {
    if (this.noCollect > 0) this.noCollect--;
    const g = land.gravity;
    if (this.inLiquid(land)) {
      // Sink slowly through liquids.
      this.ydir = Math.min(this.ydir + g, 1);
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
