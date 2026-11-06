// Movement ported from the Clonk Rage engine (C4Object::DoMovement in C4Movement.cpp).
// See licenses/clonk_engine_license.txt.

import type { Landscape } from '../landscape/landscape';
import {
  CNAT,
  MAX_SPEED,
  applyFriction,
  attach,
  contactCheck,
  redirect,
  round,
  sign,
  type Vertex,
} from './physics';

export interface MoveResult {
  /** CNAT flags of every vertex that bumped into something. */
  contact: number;
  /** True if the object was attached (walking, climbing) and lost its hold. */
  lostAttach: boolean;
}

let nextId = 1;

/** Anything that moves through the landscape: clonks and items. */
export abstract class GameObject {
  readonly id = nextId++;
  /** Integer pixel position (centre). */
  x: number;
  y: number;
  /** Exact position. */
  fx: number;
  fy: number;
  xdir = 0;
  ydir = 0;
  /** Rotation in degrees and rotation speed (items spin when thrown or blasted). */
  r = 0;
  rdir = 0;
  removed = false;
  /** The clonk carrying this object, if any. Contained objects don't move on their own. */
  container: GameObject | null = null;
  /** Which side the object is held to while moving (bottom when walking). */
  tAttach: number = CNAT.None;

  abstract readonly vertices: readonly Vertex[];

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.fx = x;
    this.fy = y;
  }

  setPosition(x: number, y: number): void {
    this.x = this.fx = x;
    this.y = this.fy = y;
  }

  inLiquid(land: Landscape): boolean {
    return land.isLiquid(this.x, this.y);
  }

  /**
   * Move by the current speed one pixel at a time, stopping at solid ground.
   * Unattached objects move horizontally then vertically and slide off slopes;
   * attached ones (walking, climbing) snap to the surface they hold on to.
   */
  doMovement(land: Landscape): MoveResult {
    const res: MoveResult = { contact: 0, lostAttach: false };
    this.xdir = clamp(this.xdir);
    this.ydir = clamp(this.ydir);

    if (!this.tAttach) {
      // Horizontal
      this.fx += this.xdir;
      let tx = Math.max(-1000, Math.min(land.width + 1000, round(this.fx)));
      while (this.x !== tx) {
        const nx = this.x + sign(tx - this.x);
        const c = contactCheck(land, this.vertices, nx, this.y);
        if (c.count) {
          res.contact |= c.cnat || CNAT.Left | CNAT.Right;
          tx = this.x;
          this.fx = this.x;
          // Bumping into a wall pushes you up a little and slows the fall.
          [this.xdir, this.ydir] = redirect(this.xdir, this.ydir, -1);
          this.ydir = applyFriction(this.ydir, c.friction);
        } else this.x = nx;
      }
      // Vertical
      this.fy += this.ydir;
      let ty = round(this.fy);
      while (this.y !== ty) {
        const ny = this.y + sign(ty - this.y);
        const c = contactCheck(land, this.vertices, this.x, ny);
        if (c.count) {
          res.contact |= c.cnat || (ny > this.y ? CNAT.Bottom : CNAT.Top);
          ty = this.y;
          this.fy = this.y;
          this.xdir = applyFriction(this.xdir, c.friction);
          // Slide off slopes towards the open side, otherwise stop.
          if (!(c.around & CNAT.Left)) [this.ydir, this.xdir] = redirect(this.ydir, this.xdir, -1);
          else if (!(c.around & CNAT.Right)) [this.ydir, this.xdir] = redirect(this.ydir, this.xdir, +1);
          else this.ydir = 0;
        } else this.y = ny;
      }
    } else {
      this.fx += this.xdir;
      this.fy += this.ydir;
      let tx = round(this.fx);
      let ty = round(this.fy);
      do {
        let nx = this.x + sign(tx - this.x);
        let ny = this.y + sign(ty - this.y);
        let xOverride = false;
        let yOverride = false;
        const a = attach(land, this.vertices, nx, ny, this.tAttach);
        if (!a) res.lostAttach = true;
        else {
          if (a.y !== ny) yOverride = true;
          if (a.x !== nx) xOverride = true;
          nx = a.x;
          ny = a.y;
        }
        const c = contactCheck(land, this.vertices, nx, ny);
        if (c.count) {
          res.contact |= c.cnat;
          tx = this.x;
          ty = this.y;
          this.fx = this.x;
          this.fy = this.y;
        } else {
          this.x = nx;
          this.y = ny;
        }
        if (xOverride) {
          tx = this.x;
          this.xdir = 0;
          this.fx = this.x;
        }
        if (yOverride) {
          ty = this.y;
          this.ydir = 0;
          this.fy = this.y;
        }
      } while (this.x !== tx || this.y !== ty);
    }

    // Spin (visual only, but kept in the simulation so replays match).
    if (this.rdir) {
      this.r = (this.r + this.rdir * 5 + 360) % 360;
      if (res.contact) this.rdir = applyFriction(this.rdir, 100);
    }
    return res;
  }
}

function clamp(v: number): number {
  return v > MAX_SPEED ? MAX_SPEED : v < -MAX_SPEED ? -MAX_SPEED : v;
}
