import { BufferImageSource, Sprite, Texture } from 'pixi.js';
import type { Landscape } from '../landscape/landscape';
import { MATERIALS, Mat, TUNNEL } from '../landscape/materials';
import type { GrayTexture } from './assets';

/** Precomputed 256-step colour ramp from a material's dark/base/light colours. */
function ramp(colors: [number, number, number], brightness: number): Uint8Array {
  const out = new Uint8Array(256 * 3);
  const ch = (c: number, s: number): number => (c >> s) & 0xff;
  for (let g = 0; g < 256; g++) {
    const [a, b, t] = g < 128 ? [colors[0], colors[1], g / 128] : [colors[1], colors[2], (g - 128) / 127];
    for (let k = 0; k < 3; k++) {
      const s = 16 - k * 8;
      const v = (ch(a, s) + (ch(b, s) - ch(a, s)) * t) * brightness;
      out[g * 3 + k] = v > 255 ? 255 : v;
    }
  }
  return out;
}

/**
 * Draws the landscape as one texture, one texel per material pixel, coloured
 * by the original material textures. Only re-colours the pixels that changed.
 */
export class LandscapeView {
  readonly sprite: Sprite;
  private readonly pixels: Uint8Array;
  private readonly source: BufferImageSource;
  private readonly ramps: Uint8Array[];
  private readonly textures: GrayTexture[];
  private readonly tunnelRamp: Uint8Array;
  private readonly tunnelTex: GrayTexture;

  constructor(
    private readonly land: Landscape,
    textures: Record<string, GrayTexture>,
  ) {
    this.pixels = new Uint8Array(land.width * land.height * 4);
    this.source = new BufferImageSource({
      resource: this.pixels,
      width: land.width,
      height: land.height,
      scaleMode: 'nearest',
      alphaMode: 'premultiplied-alpha',
    });
    this.sprite = new Sprite(new Texture({ source: this.source }));
    this.ramps = MATERIALS.map((m) => ramp(m.colors, 1.15));
    this.textures = MATERIALS.map((m) => textures[m.texture]);
    this.tunnelRamp = ramp(TUNNEL.colors, 1.0);
    this.tunnelTex = textures[TUNNEL.texture];
  }

  update(): void {
    const d = this.land.dirty;
    d.clamp(this.land.width, this.land.height);
    if (d.empty) return;
    const { cells, width } = this.land;
    const px = this.pixels;
    for (let y = d.y0; y <= d.y1; y++) {
      for (let x = d.x0; x <= d.x1; x++) {
        const i = y * width + x;
        const m = cells[i];
        const o = i * 4;
        if (m === Mat.Sky) {
          if (this.land.tunnel[i]) this.shade(o, x, y, this.tunnelTex, this.tunnelRamp, 255);
          else px[o] = px[o + 1] = px[o + 2] = px[o + 3] = 0;
        } else if (m === Mat.Water) {
          this.shade(o, x, y, this.textures[m], this.ramps[m], 190);
        } else this.shade(o, x, y, this.textures[m], this.ramps[m], 255);
      }
    }
    d.clear();
    this.source.update();
  }

  private shade(o: number, x: number, y: number, tex: GrayTexture, r: Uint8Array, alpha: number): void {
    const g = tex.data[(y % tex.height) * tex.width + (x % tex.width)] * 3;
    const a = alpha / 255;
    this.pixels[o] = r[g] * a;
    this.pixels[o + 1] = r[g + 1] * a;
    this.pixels[o + 2] = r[g + 2] * a;
    this.pixels[o + 3] = alpha;
  }
}
