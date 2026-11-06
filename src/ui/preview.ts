import { generateMap } from '../landscape/generate';
import { MATERIALS, Mat } from '../landscape/materials';
import type { ScenarioDef } from '../game/scenarios';

const SKY_TOP = [0x6f, 0xa6, 0xe0];
const SKY_BOTTOM = [0xc4, 0xdf, 0xf6];
const TUNNEL = [0x5c, 0x42, 0x1e];
const ITEM_COLORS: Record<string, number[]> = { flint: [0xc0, 0x20, 0x10], gold: [0xff, 0xe0, 0x30], rock: [0x50, 0x50, 0x50] };

const cache = new Map<string, HTMLCanvasElement>();

/**
 * A small picture of a scenario's map, like the title image the original shows
 * in its scenario book. Generated from the scenario itself, so mods get one for free.
 */
export function scenarioPreview(s: ScenarioDef, width = 206, height = 156): HTMLCanvasElement {
  const key = `${s.id}:${width}x${height}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const map = generateMap(s.width, s.height, s.seed, s.map);
  const { land } = map;
  // Fill the picture: show the full map height and crop the sides, centred on the start.
  const scale = Math.min(s.width / width, s.height / height);
  const x0 = Math.max(0, Math.min(s.width - width * scale, map.spawn.x - (width * scale) / 2));
  const y0 = 0;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(width, height);
  const d = img.data;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = Math.floor(x0 + px * scale);
      const y = Math.floor(y0 + py * scale);
      const m = land.get(x, y);
      let c: number[];
      if (y >= s.height) c = [0x20, 0x18, 0x10];
      else if (m === Mat.Sky) {
        if (land.isTunnel(x, y)) c = TUNNEL;
        else {
          const t = py / height;
          c = SKY_TOP.map((v, i) => v + (SKY_BOTTOM[i] - v) * t);
        }
      } else {
        const col = MATERIALS[m].colors[m === Mat.Earth ? 1 : 2];
        c = [(col >> 16) & 0xff, (col >> 8) & 0xff, col & 0xff];
      }
      const o = (py * width + px) * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
  }
  // Loose objects lying on the surface show as dots.
  for (const it of map.items) {
    if (land.get(it.x, it.y) !== Mat.Sky) continue;
    const px = Math.floor((it.x - x0) / scale);
    const py = Math.floor((it.y - y0) / scale);
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    const c = ITEM_COLORS[it.id] ?? [0, 0, 0];
    const o = (py * width + px) * 4;
    d[o] = c[0];
    d[o + 1] = c[1];
    d[o + 2] = c[2];
  }
  ctx.putImageData(img, 0, 0);
  cache.set(key, canvas);
  return canvas;
}
