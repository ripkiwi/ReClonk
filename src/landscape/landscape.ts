import { Rng } from '../core/rng';
import { DEFAULT_TEX, LIQUID, MATERIALS, Mat, SOLID } from './materials';

/** How far a liquid pixel looks sideways for somewhere lower to flow to. */
const LIQUID_SLIDE = 12;

/** An axis-aligned pixel rectangle, inclusive on all edges. Empty when x0 > x1. */
export class Rect {
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;

  get empty(): boolean {
    return this.x0 > this.x1;
  }

  add(x: number, y: number, margin = 0): void {
    if (x - margin < this.x0) this.x0 = x - margin;
    if (y - margin < this.y0) this.y0 = y - margin;
    if (x + margin > this.x1) this.x1 = x + margin;
    if (y + margin > this.y1) this.y1 = y + margin;
  }

  addRect(x0: number, y0: number, x1: number, y1: number): void {
    this.add(x0, y0);
    this.add(x1, y1);
  }

  clear(): void {
    this.x0 = this.y0 = Infinity;
    this.x1 = this.y1 = -Infinity;
  }

  /** Clamp to [0, w) x [0, h). */
  clamp(w: number, h: number): void {
    if (this.empty) return;
    this.x0 = Math.max(0, this.x0);
    this.y0 = Math.max(0, this.y0);
    this.x1 = Math.min(w - 1, this.x1);
    this.y1 = Math.min(h - 1, this.y1);
  }
}

/**
 * The world: a 2D grid of material ids, one byte per pixel, plus a background
 * layer that says whether an empty pixel is open sky or a dug-out tunnel.
 * Pure simulation, no rendering. Deterministic given the same seed and inputs.
 */
export class Landscape {
  readonly cells: Uint8Array;
  /** Texture map index of every pixel: which texture its material is drawn with. */
  readonly tex: Uint8Array;
  /** Open sky above the map (otherwise it's a ceiling). */
  topOpen = true;
  /** Nothing below the map: things that fall out are gone (otherwise it's a floor). */
  bottomOpen = false;
  /** 1 where an empty pixel shows tunnel background instead of sky. */
  readonly tunnel: Uint8Array;
  /** Pixels changed since the renderer last looked. */
  readonly dirty = new Rect();
  /** Where liquids may still move; the simulation only scans this area. */
  private active = new Rect();

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cells = new Uint8Array(width * height);
    this.tex = new Uint8Array(width * height);
    this.tunnel = new Uint8Array(width * height);
    this.dirty.addRect(0, 0, width - 1, height - 1);
    this.active.addRect(0, 0, width - 1, height - 1);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Mat {
    if (this.inBounds(x, y)) return this.cells[y * this.width + x] as Mat;
    // The sides are solid walls; above and below depend on the scenario.
    if (x < 0 || x >= this.width) return Mat.Granite;
    if (y < 0) return this.topOpen ? Mat.Sky : Mat.Granite;
    return this.bottomOpen ? Mat.Sky : Mat.Granite;
  }

  density(x: number, y: number): number {
    return MATERIALS[this.get(x, y)].density;
  }

  isSolid(x: number, y: number): boolean {
    return this.density(x, y) >= SOLID;
  }

  isLiquid(x: number, y: number): boolean {
    const d = this.density(x, y);
    return d >= LIQUID && d < SOLID;
  }

  /** Put a material into a pixel, drawn with the material's own texture. */
  set(x: number, y: number, m: Mat): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.width + x;
    if (this.cells[i] === m) return;
    this.cells[i] = m;
    this.tex[i] = DEFAULT_TEX[m];
    this.dirty.add(x, y);
    this.active.add(x, y, LIQUID_SLIDE + 1);
  }

  /** Put a material into a pixel with a given texture map entry (for map zooming). */
  paint(x: number, y: number, m: Mat, tex: number): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.width + x;
    this.cells[i] = m;
    this.tex[i] = tex;
    this.dirty.add(x, y);
    this.active.add(x, y, LIQUID_SLIDE + 1);
  }

  /** Mark everything below the given surface line as underground (tunnel background). */
  setTunnel(x: number, y: number, on: boolean): void {
    if (this.inBounds(x, y)) this.tunnel[y * this.width + x] = on ? 1 : 0;
  }

  isTunnel(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tunnel[y * this.width + x] === 1;
  }

  /** Calls fn for every pixel of a filled circle, using the original engine's row widths. */
  private forCircle(cx: number, cy: number, r: number, fn: (x: number, y: number) => void): void {
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(r * r - dy * dy));
      for (let dx = -w; dx < w + (w === 0 ? 1 : 0); dx++) fn(cx + dx, cy + dy);
    }
  }

  /**
   * Dig a round hole. Only diggable materials (earth, sand) are removed; rock,
   * gold and granite stay. Returns how many pixels of each material were dug.
   */
  dig(cx: number, cy: number, r: number): Map<Mat, number> {
    const dug = new Map<Mat, number>();
    this.forCircle(cx, cy, r, (x, y) => {
      const m = this.get(x, y);
      if (!this.inBounds(x, y) || !MATERIALS[m].digFree) return;
      dug.set(m, (dug.get(m) ?? 0) + 1);
      this.set(x, y, Mat.Sky);
    });
    return dug;
  }

  /**
   * Blast a round hole, like a flint explosion. Clears blastable material and
   * cracks some granite into rock. Returns how many pixels of each material
   * were in the blast, so the caller can drop rocks and gold nuggets.
   */
  blast(cx: number, cy: number, r: number, rng: Rng): Map<Mat, number> {
    const counts = new Map<Mat, number>();
    this.forCircle(cx, cy, r, (x, y) => {
      if (!this.inBounds(x, y)) return;
      const m = this.get(x, y);
      if (m !== Mat.Sky) counts.set(m, (counts.get(m) ?? 0) + 1);
    });
    this.forCircle(cx, cy, r, (x, y) => {
      if (!this.inBounds(x, y)) return;
      const mat = MATERIALS[this.get(x, y)];
      if (mat.blastShiftTo !== undefined && rng.int(3) === 0) this.set(x, y, mat.blastShiftTo);
      else if (mat.blastFree) this.set(x, y, Mat.Sky);
    });
    return counts;
  }

  /**
   * Advance liquids by one tick. Only the area where something recently changed
   * is scanned, so a settled world costs almost nothing.
   * Scans bottom-up; horizontal direction alternates by tick so flows stay symmetric.
   */
  step(tick: number, rng: Rng): void {
    const area = this.active;
    area.clamp(this.width, this.height);
    if (area.empty) return;
    const { x0, y0, x1, y1 } = area;
    this.active = new Rect();

    const w = this.width;
    const cells = this.cells;
    const moved = new Set<number>();
    const leftToRight = (tick & 1) === 0;

    for (let y = y1; y >= y0; y--) {
      for (let i = x0; i <= x1; i++) {
        const x = leftToRight ? i : x0 + x1 - i;
        const idx = y * w + x;
        if (moved.has(idx)) continue;
        const m = cells[idx] as Mat;
        const d = MATERIALS[m].density;
        if (d < LIQUID || d >= SOLID) continue;

        if (y === this.height - 1 && this.bottomOpen) {
          // Pours out of the bottom of the map.
          cells[idx] = Mat.Sky;
          this.tex[idx] = 0;
          this.dirty.add(x, y);
          this.active.add(x, y, LIQUID_SLIDE + 1);
          continue;
        }
        const target = this.findFlow(x, y, rng);
        if (target < 0) continue;
        cells[idx] = Mat.Sky;
        cells[target] = m;
        this.tex[target] = this.tex[idx];
        this.tex[idx] = 0;
        moved.add(target);
        const tx = target % w;
        const ty = (target - tx) / w;
        this.dirty.add(x, y);
        this.dirty.add(tx, ty);
        this.active.add(x, y, LIQUID_SLIDE + 1);
        this.active.add(tx, ty, LIQUID_SLIDE + 1);
      }
    }
  }

  private empty(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.cells[y * this.width + x] === Mat.Sky;
  }

  private findFlow(x: number, y: number, rng: Rng): number {
    const w = this.width;
    if (this.empty(x, y + 1)) return (y + 1) * w + x;
    const dir = rng.bool() ? 1 : -1;
    for (const dx of [dir, -dir]) {
      if (this.empty(x + dx, y + 1)) return (y + 1) * w + x + dx;
    }
    // Flow sideways only towards a spot where the liquid can drop, so lakes settle flat.
    for (const dx of [dir, -dir]) {
      for (let k = 1; k <= LIQUID_SLIDE; k++) {
        const sx = x + dx * k;
        if (!this.empty(sx, y)) break;
        if (this.empty(sx, y + 1)) return y * w + x + dx;
      }
    }
    return -1;
  }
}
