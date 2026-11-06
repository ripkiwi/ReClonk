import { BufferImageSource, Sprite, Texture } from 'pixi.js';
import type { Landscape } from '../landscape/landscape';
import { MATERIALS } from '../landscape/materials';

/**
 * Draws the landscape as a single texture, one texel per material cell.
 * Only re-uploads when the simulation marked the landscape dirty.
 */
export class LandscapeView {
  readonly sprite: Sprite;
  private readonly pixels: Uint8Array;
  private readonly source: BufferImageSource;
  private readonly palette: Uint32Array;

  constructor(private readonly land: Landscape) {
    this.pixels = new Uint8Array(land.width * land.height * 4);
    this.source = new BufferImageSource({
      resource: this.pixels,
      width: land.width,
      height: land.height,
      scaleMode: 'nearest',
    });
    this.sprite = new Sprite(new Texture({ source: this.source }));
    this.palette = new Uint32Array(MATERIALS.map((m) => m.color));
  }

  update(): void {
    if (!this.land.dirty) return;
    const { cells } = this.land;
    const px = this.pixels;
    for (let i = 0; i < cells.length; i++) {
      const c = this.palette[cells[i]];
      // Cheap per-pixel shading so solid ground doesn't look flat.
      const shade = cells[i] === 0 ? 0 : ((i * 2654435761) >>> 29) - 4;
      const o = i * 4;
      px[o] = clamp(((c >> 16) & 0xff) + shade);
      px[o + 1] = clamp(((c >> 8) & 0xff) + shade);
      px[o + 2] = clamp((c & 0xff) + shade);
      px[o + 3] = 255;
    }
    this.source.update();
    this.land.dirty = false;
  }
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
