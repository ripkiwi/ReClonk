import type { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';

/**
 * The solid part of an object, like the original's SolidMask: pixels that are
 * put into the landscape as solid "vehicle" material (Mat.Basement), so clonks
 * stand on them and bump into them. Moving objects (an elevator case, a gate)
 * take their mask out of the landscape and put it back at the new place.
 */
export interface MaskShape {
  w: number;
  h: number;
  /** Offsets of the solid pixels from the top-left corner. */
  pixels: readonly (readonly [number, number])[];
}

/** A mask drawn as text rows: '#' is solid. */
export function maskFromArt(rows: readonly string[]): MaskShape {
  const pixels: [number, number][] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') pixels.push([x, y]);
  });
  return { w: Math.max(0, ...rows.map((r) => r.length)), h: rows.length, pixels };
}

/** A solid rectangle at (x, y) within a w x h shape. */
export function maskRect(w: number, h: number, rect: { x: number; y: number; w: number; h: number }): MaskShape {
  const pixels: [number, number][] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) pixels.push([x, y]);
  return { w, h, pixels };
}

export class SolidMask {
  /** Top-left corner while placed. */
  x = 0;
  y = 0;
  placed = false;
  /** Material and texture of each pixel the mask covers, to put back when it moves away. */
  private readonly saved: Uint8Array;
  private readonly savedTex: Uint8Array;

  constructor(readonly shape: MaskShape) {
    this.saved = new Uint8Array(shape.pixels.length);
    this.savedTex = new Uint8Array(shape.pixels.length);
  }

  /** Put the mask into the landscape with its top-left corner at (x, y). */
  place(land: Landscape, x: number, y: number): void {
    if (this.placed) this.remove(land);
    this.x = x;
    this.y = y;
    const { pixels } = this.shape;
    for (let i = 0; i < pixels.length; i++) {
      const px = x + pixels[i][0];
      const py = y + pixels[i][1];
      if (!land.inBounds(px, py)) continue;
      const k = py * land.width + px;
      this.saved[i] = land.cells[k];
      this.savedTex[i] = land.tex[k];
      land.set(px, py, Mat.Basement);
    }
    this.placed = true;
  }

  /** Take the mask out of the landscape again: what was under it comes back. */
  remove(land: Landscape): void {
    if (!this.placed) return;
    const { pixels } = this.shape;
    // Backwards, so a mask that overlaps itself puts back the oldest pixel last.
    for (let i = pixels.length - 1; i >= 0; i--) {
      const px = this.x + pixels[i][0];
      const py = this.y + pixels[i][1];
      if (land.inBounds(px, py)) land.paint(px, py, this.saved[i], this.savedTex[i]);
    }
    this.placed = false;
  }

  /** Move the mask by (dx, dy). */
  move(land: Landscape, dx: number, dy: number): void {
    const { x, y } = this;
    this.remove(land);
    this.place(land, x + dx, y + dy);
  }

  /** True if the landscape pixel (px, py) is one of this mask's while it's placed. */
  covers(px: number, py: number): boolean {
    if (!this.placed) return false;
    const lx = px - this.x;
    const ly = py - this.y;
    if (lx < 0 || ly < 0 || lx >= this.shape.w || ly >= this.shape.h) return false;
    return this.shape.pixels.some(([mx, my]) => mx === lx && my === ly);
  }
}
