import { Rng } from '../core/rng';
import { MATERIALS, Mat, type Behaviour } from './materials';

/**
 * The world: a 2D grid of material ids, one byte per pixel.
 * Pure simulation, no rendering. Deterministic given the same seed and inputs.
 */
export class Landscape {
  readonly cells: Uint8Array;
  /** Set whenever a cell changes; the renderer clears it after uploading. */
  dirty = true;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cells = new Uint8Array(width * height);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Mat {
    // Out of bounds counts as granite: a solid, indestructible border.
    return this.inBounds(x, y) ? (this.cells[y * this.width + x] as Mat) : Mat.Granite;
  }

  set(x: number, y: number, m: Mat): void {
    if (!this.inBounds(x, y)) return;
    this.cells[y * this.width + x] = m;
    this.dirty = true;
  }

  /**
   * Dig a circular hole. Returns how many pixels of each material were removed,
   * so the game can turn dug gold into nuggets later.
   */
  dig(cx: number, cy: number, radius: number): Map<Mat, number> {
    const removed = new Map<Mat, number>();
    const r2 = radius * radius;
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
        const m = this.get(x, y);
        if (!MATERIALS[m].diggable) continue;
        removed.set(m, (removed.get(m) ?? 0) + 1);
        this.set(x, y, Mat.Sky);
      }
    }
    return removed;
  }

  /** Fill a circle with a material, only replacing sky. */
  paint(cx: number, cy: number, radius: number, m: Mat): void {
    const r2 = radius * radius;
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r2 && this.get(x, y) === Mat.Sky) this.set(x, y, m);
      }
    }
  }

  /**
   * Advance loose and liquid materials by one tick.
   * Scans bottom-up; horizontal scan direction alternates by tick so piles
   * stay symmetric without using floats or unseeded randomness.
   */
  step(tick: number, rng: Rng): void {
    const { width, height, cells } = this;
    const moved = new Uint8Array(cells.length);
    const leftToRight = (tick & 1) === 0;
    let changed = false;

    for (let y = height - 1; y >= 0; y--) {
      for (let i = 0; i < width; i++) {
        const x = leftToRight ? i : width - 1 - i;
        const idx = y * width + x;
        if (moved[idx]) continue;
        const m = cells[idx] as Mat;
        const behaviour = MATERIALS[m].behaviour;
        if (behaviour !== 'loose' && behaviour !== 'liquid') continue;

        const target = this.findMove(x, y, behaviour, rng);
        if (target < 0) continue;
        // Swap, so sand sinks through water and water rises around it.
        cells[idx] = cells[target];
        cells[target] = m;
        moved[target] = 1;
        changed = true;
      }
    }
    if (changed) this.dirty = true;
  }

  private canEnter(x: number, y: number, behaviour: Behaviour): boolean {
    const there = this.get(x, y);
    if (there === Mat.Sky) return true;
    // Loose material sinks through liquids.
    return behaviour === 'loose' && MATERIALS[there].behaviour === 'liquid';
  }

  private findMove(x: number, y: number, behaviour: Behaviour, rng: Rng): number {
    const w = this.width;
    if (this.canEnter(x, y + 1, behaviour)) return (y + 1) * w + x;

    const dir = rng.bool() ? 1 : -1;
    for (const dx of [dir, -dir]) {
      if (this.canEnter(x + dx, y + 1, behaviour)) return (y + 1) * w + x + dx;
    }
    if (behaviour === 'liquid') {
      for (const dx of [dir, -dir]) {
        if (this.canEnter(x + dx, y, behaviour)) return y * w + x + dx;
      }
    }
    return -1;
  }
}
