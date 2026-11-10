// Loose pixels of material, ported from the Clonk Rage engine (C4PXS.cpp,
// C4Material.cpp mrfInsert/mrfConvert). See licenses/clonk_engine_license.txt.

import type { Rng } from '../core/rng';
import type { Landscape } from './landscape';
import { MATERIALS, Mat, reaction } from './materials';

/** At most this many loose pixels at once (the original's 20 chunks of 500). */
export const MAX_PXS = 10000;

/** One loose pixel in flight: a rain drop, a snow flake, a crumb of earth. */
export interface Pxs {
  x: number;
  y: number;
  xdir: number;
  ydir: number;
  mat: Mat;
}

/**
 * Rain, snow and earth shaken loose fly as single pixels until they land,
 * then become part of the landscape again (C4PXSSystem). Their own speed,
 * gravity and, for light materials, the wind move them.
 */
export class PxsSystem {
  list: Pxs[] = [];

  constructor(private readonly land: Landscape) {}

  get count(): number {
    return this.list.length;
  }

  create(mat: Mat, x: number, y: number, xdir = 0, ydir = 0): boolean {
    if (this.list.length >= MAX_PXS) return false;
    this.list.push({ x, y, xdir, ydir, mat });
    return true;
  }

  step(rng: Rng): void {
    if (!this.list.length) return;
    let n = 0;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (this.move(p, rng)) list[n++] = p;
    }
    list.length = n;
  }

  /** C4PXS::Execute. Returns false once the pixel is gone (landed or out of the map). */
  private move(p: Pxs, rng: Rng): boolean {
    const land = this.land;
    if (p.x < 0 || p.x >= land.width || p.y < -10 || p.y >= land.height) return false;
    let ix = Math.floor(p.x);
    let iy = Math.floor(p.y);
    const mat = MATERIALS[p.mat];
    // Snow that sinks into water melts into it.
    const conv = mat.inMatConvert;
    if (conv && land.get(ix, iy) === conv.mat) {
      p.mat = conv.to;
      p.xdir = p.ydir = 0;
      return true;
    }
    p.ydir += land.gravity;
    const d = mat.density;
    const drift = Math.max((mat.windDrift ?? 0) - 20, 0) / 800;
    if (drift > 0 && land.density(ix, iy + 1) < d) {
      // In the air: the wind (none underground) plus some gusts pull light stuff along.
      const wind = land.isTunnel(ix, iy) ? 0 : land.wind;
      const txdir = wind / 15 + (rng.int(1200) - 600) / 256;
      const tydir = (rng.int(1200) - 600) / 256;
      p.xdir += (txdir - p.xdir) * drift;
      p.ydir += (tydir - p.ydir) * drift;
    }
    const nx = p.x + p.xdir;
    const ny = p.y + p.ydir;
    const tx = Math.floor(nx);
    const ty = Math.floor(ny);
    // Walk the path pixel by pixel; land on the first pixel at least as dense.
    while (ix !== tx || iy !== ty) {
      const sx = ix + Math.sign(tx - ix);
      const sy = iy + Math.sign(ty - iy);
      // Snow falling into lava melts (it's lighter, so it would sink through otherwise).
      if (mat.incindiaryConvert !== undefined && sy >= 0 && MATERIALS[land.get(sx, sy)].incindiary) {
        p.mat = mat.incindiaryConvert;
        p.x = ix;
        p.y = iy;
        p.xdir = p.ydir = 0;
        return true;
      }
      if (sy >= 0 && land.density(sx, sy) >= d) {
        const r = reaction(p.mat, land.get(sx, sy));
        // Snow falling on lava turns to water, and goes on falling.
        if (r === 'convert') {
          p.mat = mat.incindiaryConvert!;
          p.x = ix;
          p.y = iy;
          p.xdir = p.ydir = 0;
          return true;
        }
        // Lava and water boil each other away; acid eats what it lands on.
        if ((r === 'poof' || r === 'corrode') && land.landReaction(p.mat, sx, sy, rng)) return false;
        land.insertMaterial(p.mat, ix, Math.max(iy, 0));
        return false;
      }
      ix = sx;
      iy = sy;
    }
    p.x = nx;
    p.y = ny;
    return true;
  }
}
